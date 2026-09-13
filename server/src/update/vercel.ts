import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { artifactFiles, canonical, digest, type DeployReleaseOptions, type DeploymentReceipt } from './deploy.js';
import { RELEASE_FILES } from './release.js';
import { VERCEL_ROUTES } from './vercelRoutes.js';

/** API contracts (including the official CLI's prebuilt transport):
 * https://vercel.com/docs/rest-api/deployments/create-a-new-deployment
 * https://vercel.com/docs/rest-api/deployments/upload-deployment-files
 * https://vercel.com/docs/rest-api/projects/point-production-traffic-to-a-given-deployment
 * https://github.com/vercel/vercel/blob/main/packages/client/src/utils/query-string.ts
 * https://github.com/vercel/vercel/blob/main/packages/cli/src/commands/deploy/index.ts
 * `prebuilt=1` consumes only Build Output API files; `autoAssignCustomDomains:false`
 * is the same control as `vercel --prod --skip-domain`. Neither a remote source
 * build nor a project configuration mutation is part of this adapter.
 */
const identifier = z.string().regex(/^[a-zA-Z0-9_-]+$/);
const projectSchema = z.object({
  id: identifier, name: identifier, accountId: identifier, rootDirectory: z.string().nullable().optional(),
  rollingRelease: z.unknown().optional(),
  targets: z.object({ production: z.object({ id: identifier }).optional() }).optional(),
});
const deploymentSchema = z.object({
  id: identifier, projectId: identifier, readyState: z.string(), target: z.literal('production'),
  url: z.string(), ownerId: identifier.optional(), team: z.object({ id: identifier }).optional(), alias: z.array(z.string()).optional(),
  meta: z.record(z.string()).optional(), functions: z.record(z.unknown()).nullable().optional(),
  lambdas: z.array(z.unknown()).optional(),
});
const aliasSchema = z.object({
  alias: z.string(), deploymentId: identifier, projectId: identifier,
  redirect: z.string().nullable().optional(),
});
type Deployment = z.infer<typeof deploymentSchema>;

// Vercel includes one partial Build record for a static prebuilt deployment.
// Its `output` array is the runtime-function inventory, so an empty root build
// is metadata rather than a Lambda. Fail closed for every other shape.
const emptyStaticBuildSchema = z.object({
  id: identifier.optional(),
  createdAt: z.number().finite().optional(),
  entrypoint: z.literal('.'),
  output: z.tuple([]),
  readyState: z.enum(['BUILDING', 'ERROR', 'INITIALIZING', 'READY']).optional(),
  readyStateAt: z.number().finite().optional(),
}).passthrough();

function hasUnexpectedServerFunctions(deployment: Deployment): boolean {
  if (Object.keys(deployment.functions ?? {}).length) return true;
  const builds = deployment.lambdas ?? [];
  return builds.length > 1 || builds.some((build) => !emptyStaticBuildSchema.safeParse(build).success);
}

class VercelRequestError extends Error {
  constructor(readonly status?: number) {
    super(status ? `Vercel request failed (HTTP ${status})` : 'Vercel request failed; retry the saved artifact');
    this.name = 'VercelRequestError';
  }
}

function origin(raw: string | undefined, deploymentHost = false): string {
  if (!raw) throw new Error('Vercel deployment has no verification URL');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Vercel verification requires a valid HTTPS site origin'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (deploymentHost && !/^[a-z0-9-]+\.vercel\.app$/.test(url.hostname))) {
    throw new Error('Vercel verification requires a valid HTTPS site origin');
  }
  return url.origin;
}

function outputPrefix(rootDirectory: string | null | undefined): string {
  if (!rootDirectory || rootDirectory === '.') return '.vercel/output';
  if (!/^[a-zA-Z0-9_/-]+$/.test(rootDirectory) || rootDirectory.startsWith('/') || rootDirectory.endsWith('/') || rootDirectory.includes('//')) {
    throw new Error('Vercel project has an unsupported root directory');
  }
  return `${rootDirectory}/.vercel/output`;
}

export async function deployVercelRelease(options: DeployReleaseOptions): Promise<DeploymentReceipt> {
  const projectId = options.vercelProjectId;
  if (!identifier.safeParse(projectId).success || !options.vercelToken) throw new Error('Vercel project ID and authentication token are required');
  if (options.vercelTeamId && !identifier.safeParse(options.vercelTeamId).success) throw new Error('Invalid Vercel team ID');
  if (options.existingDeployId && !identifier.safeParse(options.existingDeployId).success) throw new Error('Invalid saved Vercel deployment ID');
  // Validate a configured public target even for a staged-only run, before any uploads.
  const publicOrigin = options.publicUrl ? origin(options.publicUrl) : options.publish ? origin(undefined) : undefined;
  const files = await artifactFiles(options.artifactDir);
  let artifactManifest: unknown;
  try { artifactManifest = JSON.parse(files.get('/data/manifest.json')!.toString('utf8')); }
  catch { throw new Error('Artifact manifest is unreadable'); }
  if (canonical(artifactManifest) !== canonical(options.manifest)) throw new Error('Artifact manifest differs from the saved candidate');
  for (const name of RELEASE_FILES) {
    const expected = options.manifest.files[name];
    const bytes = files.get(expected.path);
    if (!bytes || bytes.length !== expected.bytes || digest(bytes) !== expected.sha256) throw new Error('Artifact data does not match the saved candidate');
  }
  const scripts = [...files.keys()].filter((path) => path.startsWith('/assets/') && path.endsWith('.js'));
  const page = files.get('/index.html')!.toString('utf8');
  if (!scripts.length || !page.includes('<html') || !scripts.some((script) => page.includes(script))) throw new Error('Artifact page does not reference its application');
  const outputConfig = Buffer.from(JSON.stringify({ version: 3, routes: VERCEL_ROUTES }));
  const artifactHash = digest(Buffer.from(canonical({
    files: [...files].map(([path, bytes]) => [path, digest(bytes)]).sort(([a], [b]) => a!.localeCompare(b!)),
    outputConfig: digest(outputConfig),
  })));
  const fetcher = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;
  const deadline = now() + (options.timeoutMs ?? 10 * 60_000);
  const pause = async (milliseconds: number) => {
    if (now() + milliseconds >= deadline) throw new Error('Vercel deployment deadline exceeded; retry the saved artifact');
    await sleep(milliseconds);
  };
  const apiUrl = (path: string) => {
    const url = new URL(path, 'https://api.vercel.com');
    if (options.vercelTeamId) url.searchParams.set('teamId', options.vercelTeamId);
    return url.toString();
  };
  const request = async (url: string, init: RequestInit = {}, api = true, retry = true): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      const remaining = deadline - now();
      if (remaining <= 0) throw new Error('Vercel deployment deadline exceeded; retry the saved artifact');
      const headers = new Headers(init.headers);
      if (api) headers.set('Authorization', `Bearer ${options.vercelToken}`);
      let response: Response | undefined;
      try {
        response = await fetcher(api ? apiUrl(url) : url, { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, remaining))) });
      } catch { if (!retry || attempt >= 3) throw new VercelRequestError(); }
      if (response?.ok) return response;
      if (response && (!retry || attempt >= 3 || (response.status !== 429 && response.status < 500))) {
        await response.body?.cancel().catch(() => {});
        throw new VercelRequestError(response.status);
      }
      const retryAfter = response?.headers.get('retry-after');
      const wait = retryAfter ? (/^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now()) : 1000 * 2 ** attempt;
      await response?.body?.cancel().catch(() => {});
      await pause(Number.isFinite(wait) ? Math.max(100, wait) : 1000 * 2 ** attempt);
    }
  };
  const json = async (response: Response): Promise<unknown> => {
    try { return await response.json(); } catch { throw new Error('Vercel returned an unreadable response'); }
  };
  const getProject = async () => {
    const result = projectSchema.safeParse(await json(await request(`/v9/projects/${projectId}`)));
    if (!result.success || result.data.id !== projectId || (options.vercelTeamId && result.data.accountId !== options.vercelTeamId)) throw new Error('Configured Vercel project could not be verified');
    if (result.data.rollingRelease) throw new Error('Vercel rolling releases are not supported by the atomic archive publisher');
    return result.data;
  };
  const project = await getProject();
  const prefix = outputPrefix(project.rootDirectory);
  const publicHost = publicOrigin ? new URL(publicOrigin).hostname : undefined;
  const checkDomain = async () => {
    if (!publicOrigin) return;
    const host = new URL(publicOrigin).hostname;
    const result = z.object({
      name: z.string(), projectId: z.string(), verified: z.boolean(),
      redirect: z.string().nullable().optional(), gitBranch: z.string().nullable().optional(), customEnvironmentId: z.string().nullable().optional(),
    }).safeParse(await json(await request(`/v9/projects/${projectId}/domains/${encodeURIComponent(host)}`)));
    if (!result.success || result.data.name !== host || result.data.projectId !== projectId || !result.data.verified || result.data.redirect || result.data.gitBranch || result.data.customEnvironmentId) {
      throw new Error('Configured public URL does not belong to the Vercel production project');
    }
  };
  await checkDomain();
  const getPublicAlias = async () => {
    if (!publicHost) return undefined;
    const result = aliasSchema.safeParse(await json(await request(`/v4/aliases/${encodeURIComponent(publicHost)}`)));
    if (!result.success || result.data.alias !== publicHost || result.data.projectId !== projectId || result.data.redirect) {
      throw new Error('Configured Vercel production alias could not be verified');
    }
    return result.data;
  };
  const initialProductionId = project.targets?.production?.id;
  const initialPublicAlias = await getPublicAlias();
  if (initialPublicAlias && initialPublicAlias.deploymentId !== initialProductionId) {
    throw new Error('Configured Vercel production alias does not match the current deployment');
  }
  const getDeployment = async (id: string): Promise<Deployment> => {
    const result = deploymentSchema.safeParse(await json(await request(`/v13/deployments/${id}`)));
    if (!result.success || result.data.id !== id || result.data.projectId !== projectId || (result.data.ownerId && result.data.ownerId !== project.accountId) || (options.vercelTeamId && result.data.team?.id !== options.vercelTeamId)) throw new Error('Vercel deployment does not belong to the configured production project');
    const deployment = result.data;
    if (deployment.meta?.archiveDataVersion !== options.manifest.dataVersion || deployment.meta?.archiveCodeRevision !== options.manifest.codeRevision || deployment.meta?.archiveArtifactHash !== artifactHash) throw new Error('Saved Vercel deployment does not match this release artifact');
    if (hasUnexpectedServerFunctions(deployment)) throw new Error('Unexpected server functions in static Vercel deployment');
    return deployment;
  };
  let deploymentId = options.existingDeployId;
  if (!deploymentId) {
    const uploadFiles = new Map([...files].map(([path, bytes]) => [`${prefix}/static${path}`, bytes]));
    uploadFiles.set(`${prefix}/config.json`, outputConfig);
    const uploaded = new Set<string>();
    for (const bytes of uploadFiles.values()) {
      const sha = digest(bytes, 'sha1');
      if (uploaded.has(sha)) continue;
      const uploadedFile = await request('/v2/files', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length), 'x-vercel-digest': sha }, body: new Uint8Array(bytes) });
      await uploadedFile.body?.cancel().catch(() => {});
      uploaded.add(sha);
    }
    // Never retry creation automatically: a lost response may leave an unassigned
    // staged deployment. A subsequent run may safely create another staged copy.
    const created = z.object({ id: identifier }).safeParse(await json(await request('/v13/deployments?prebuilt=1', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        name: project.name, project: projectId, version: 2, target: 'production', autoAssignCustomDomains: false,
        files: [...uploadFiles].map(([file, bytes]) => ({ file, sha: digest(bytes, 'sha1'), size: bytes.length, mode: 0o100644 })),
        meta: { archiveDataVersion: options.manifest.dataVersion, archiveCodeRevision: options.manifest.codeRevision, archiveArtifactHash: artifactHash },
      }),
    }, true, false)));
    if (!created.success) throw new Error('Vercel returned an invalid deployment response');
    deploymentId = created.data.id;
    await options.onDraftCreated?.(deploymentId);
  }
  let deployment = await getDeployment(deploymentId);
  for (;;) {
    if (['ERROR', 'CANCELED'].includes(deployment.readyState)) throw new Error('Vercel could not prepare this deployment');
    if (deployment.readyState === 'READY') break;
    await pause(2000);
    deployment = await getDeployment(deploymentId);
  }
  if (!options.existingDeployId) {
    // Vercel always gives a deployment a provider-owned *.vercel.app address, even
    // with --skip-domain semantics. Only that staging address is expected here.
    // The configured production hostname, any custom hostname, or an already moved
    // production target means traffic may have changed before byte verification.
    const unexpectedAlias = (deployment.alias ?? []).some(alias => alias === publicHost || !/^[a-z0-9-]+\.vercel\.app$/.test(alias));
    const current = await getProject();
    const currentPublicAlias = await getPublicAlias();
    if (unexpectedAlias || current.targets?.production?.id !== initialProductionId ||
        currentPublicAlias?.deploymentId !== initialPublicAlias?.deploymentId) {
      throw new Error('Vercel assigned production domains before release verification; inspect the deployment');
    }
  }
  const deploymentOrigin = origin(`https://${deployment.url}`, true);
  if (publicOrigin === deploymentOrigin) throw new Error('Public URL must be the production domain, not an immutable deployment URL');
  const verify = async (site: string, protectedDeployment = false) => {
    const headers = new Headers({ 'Cache-Control': 'no-cache' });
    // Never attach either token to a custom domain, redirects, or browser-visible URL.
    if (protectedDeployment && site === deploymentOrigin && options.vercelProtectionBypass) headers.set('x-vercel-protection-bypass', options.vercelProtectionBypass);
    const fileUrl = (path: string) => `${site}${path}?release=${options.manifest.dataVersion}&check=${encodeURIComponent(options.manifest.generatedAt)}`;
    const live = await json(await request(fileUrl('/data/manifest.json'), { headers }, false));
    if (canonical(live) !== canonical(options.manifest)) throw new Error('Published manifest does not match the saved release');
    const paths = new Set(['/index.html', ...RELEASE_FILES.map((name) => options.manifest.files[name].path), ...[...files.keys()].filter((path) => path.startsWith('/assets/'))]);
    for (const path of paths) {
      let bytes: Buffer;
      try { bytes = Buffer.from(await (await request(fileUrl(path), { headers }, false)).arrayBuffer()); }
      catch (error) { if (error instanceof VercelRequestError) throw error; throw new Error('Published asset could not be read'); }
      if (digest(bytes) !== digest(files.get(path)!)) throw new Error('Published asset does not match the saved release');
    }
  };
  const receipt = (url: string, published: boolean): DeploymentReceipt => ({ provider: 'vercel', deployId: deploymentId, dataVersion: options.manifest.dataVersion, codeRevision: options.manifest.codeRevision, url, published, verifiedAt: new Date(now()).toISOString() });
  await verify(deploymentOrigin, true);
  if (!options.publish) return receipt(deploymentOrigin, false);
  const verifyProduction = async () => {
    if ((await getProject()).targets?.production?.id !== deploymentId) throw new Error('Vercel has not made the saved deployment current');
    if ((await getPublicAlias())?.deploymentId !== deploymentId) throw new Error('Vercel production alias does not point to the saved deployment');
    await verify(publicOrigin!);
    if ((await getProject()).targets?.production?.id !== deploymentId) throw new Error('Vercel production changed during public verification');
    if ((await getPublicAlias())?.deploymentId !== deploymentId) throw new Error('Vercel production alias changed during public verification');
  };
  // An uncertain prior promotion might already be live. Confirm exact bytes before
  // sending any promotion again; never create/rebuild in the saved-deploy path.
  try { await verifyProduction(); return receipt(publicOrigin!, true); } catch { /* not confirmed */ }
  await checkDomain();
  const current = await getProject();
  const currentPublicAlias = await getPublicAlias();
  if ((current.targets?.production?.id !== initialProductionId && current.targets?.production?.id !== deploymentId) ||
      (currentPublicAlias?.deploymentId !== initialPublicAlias?.deploymentId && currentPublicAlias?.deploymentId !== deploymentId)) {
    throw new Error('Vercel production changed during verification; retry after inspecting the current deployment');
  }
  await options.onBeforePublish?.();
  const readyToPromote = await getProject();
  const readyPublicAlias = await getPublicAlias();
  if ((readyToPromote.targets?.production?.id !== initialProductionId && readyToPromote.targets?.production?.id !== deploymentId) ||
      (readyPublicAlias?.deploymentId !== initialPublicAlias?.deploymentId && readyPublicAlias?.deploymentId !== deploymentId)) {
    throw new Error('Vercel production changed immediately before promotion; inspect the current deployment');
  }
  if (readyToPromote.targets?.production?.id === deploymentId && readyPublicAlias?.deploymentId === deploymentId) {
    await verifyProduction();
    return receipt(publicOrigin!, true);
  }
  let promotionError: unknown;
  try {
    const promoted = await request(`/v10/projects/${projectId}/promote/${deploymentId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, true, false);
    await promoted.body?.cancel().catch(() => {});
  }
  catch (error) { promotionError = error; }
  for (let attempt = 0; ; attempt++) {
    try { await verifyProduction(); return receipt(publicOrigin!, true); }
    catch {
      if (promotionError instanceof VercelRequestError && promotionError.status && promotionError.status < 500 && promotionError.status !== 429) throw promotionError;
      if (attempt >= 5) throw new Error('Vercel publication could not be confirmed; inspect the live site or retry the saved artifact');
    }
    await pause(2000 * (attempt + 1));
  }
}
