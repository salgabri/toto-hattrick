import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { RELEASE_FILES, type ReleaseManifest } from './release.js';

/** API contract: https://docs.netlify.com/api-and-cli-guides/api-guides/get-started-with-api/
 * File-digest drafts are private to their deploy URL until the exact deploy is restored. */
export interface DeployReleaseOptions {
  provider: 'netlify' | 'vercel';
  artifactDir: string;
  manifest: ReleaseManifest;
  netlifySiteId?: string;
  netlifyAuthToken?: string;
  vercelProjectId?: string;
  vercelTeamId?: string;
  vercelToken?: string;
  vercelProtectionBypass?: string;
  publicUrl?: string;
  publish?: boolean;
  existingDeployId?: string;
  onDraftCreated?: (deployId: string) => Promise<void>;
  /** Recheck the coordinator's writer lease immediately before changing the live deployment. */
  onBeforePublish?: () => Promise<void>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}
export interface DeploymentReceipt {
  provider: 'netlify' | 'vercel';
  deployId: string;
  dataVersion: string;
  codeRevision: string;
  url: string;
  published: boolean;
  verifiedAt: string;
}
const deployment = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/), site_id: z.string().optional(), state: z.string(),
  required: z.array(z.string().regex(/^[a-f0-9]{40}$/)).optional(),
  required_functions: z.array(z.string()).optional(), required_edge_functions: z.array(z.string()).optional(),
  deploy_ssl_url: z.string().optional(), deploy_url: z.string().optional(), ssl_url: z.string().optional(), url: z.string().optional(),
});
type Deployment = z.infer<typeof deployment>;
export const digest = (body: Buffer, algorithm = 'sha256') => createHash(algorithm).update(body).digest('hex');
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
function siteOrigin(raw: string | undefined, draft = false): string {
  if (!raw) throw new Error('Deployment has no verification URL');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || (draft && !url.hostname.endsWith('.netlify.app'))) throw new Error('Deployment verification requires a valid HTTPS site origin');
  return url.origin;
}
export async function artifactFiles(root: string) {
  const files = new Map<string, Buffer>();
  const walk = async (relative: string) => {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || /[#?\\]/.test(name)) throw new Error('Deployment artifact contains an unsafe file path');
      if (entry.isDirectory()) { await walk(name); continue; }
      if (!entry.isFile() || !(/^(index\.html|favicon\.[a-z]+|_headers|_redirects)$/.test(name) || /^(assets|flags)\/[a-zA-Z0-9_./-]+\.(js|css|svg|png|jpg|jpeg|webp|ico|woff2?|ttf|map)$/.test(name) || /^data\/(manifest\.json|versions\/[a-f0-9]{64}\/(managers|leagues|cups|masters|seasonal|worldcup|elections)\.json)$/.test(name))) throw new Error('Deployment artifact contains a file outside the static site');
      files.set(`/${name}`, await readFile(join(root, name)));
    }
  };
  await walk('');
  if (!files.has('/index.html') || !files.has('/data/manifest.json')) throw new Error('Deployment artifact lacks its page or release manifest');
  return files;
}

export async function deployRelease(options: DeployReleaseOptions): Promise<DeploymentReceipt> {
  if (options.provider === 'vercel') return (await import('./vercel.js')).deployVercelRelease(options);
  if (options.provider !== 'netlify') throw new Error('Unsupported deployment provider');
  const siteId = options.netlifySiteId;
  if (!siteId || !/^[a-zA-Z0-9_-]+$/.test(siteId) || !options.netlifyAuthToken) throw new Error('Netlify site ID and authentication token are required');
  if (options.existingDeployId && !/^[a-zA-Z0-9_-]+$/.test(options.existingDeployId)) throw new Error('Invalid saved deploy ID');
  const publicOrigin = options.publish ? siteOrigin(options.publicUrl) : undefined;
  const files = await artifactFiles(options.artifactDir);
  if (canonical(JSON.parse(files.get('/data/manifest.json')!.toString('utf8'))) !== canonical(options.manifest)) throw new Error('Artifact manifest differs from the saved candidate');
  for (const name of RELEASE_FILES) {
    const expected = options.manifest.files[name];
    const body = files.get(expected.path);
    if (!body || body.length !== expected.bytes || digest(body) !== expected.sha256) throw new Error('Artifact data does not match the saved candidate');
  }
  const fetcher = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;
  const deadline = now() + (options.timeoutMs ?? 10 * 60_000);
  const pause = async (milliseconds: number) => {
    if (now() + milliseconds >= deadline) throw new Error('Deployment verification deadline exceeded; retry the saved artifact');
    await sleep(milliseconds);
  };
  const request = async (path: string, init: RequestInit = {}, api = true, retry = true): Promise<Response> => {
    const url = api ? `https://api.netlify.com/api/v1${path}` : path;
    for (let attempt = 0; ; attempt++) {
      const remaining = deadline - now();
      if (remaining <= 0) throw new Error('Deployment deadline exceeded; retry the saved artifact');
      let response: Response | undefined;
      try {
        response = await fetcher(url, { ...init, headers: { ...(api ? { Authorization: `Bearer ${options.netlifyAuthToken}` } : {}), ...init.headers }, redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, remaining))) });
      } catch {
        if (!retry || attempt >= 3) throw new Error('Deployment request failed; retry the saved artifact');
      }
      if (response?.ok) return response;
      if (response && (!retry || attempt >= 3 || (response.status !== 429 && response.status < 500))) throw new Error(`Deployment request failed (HTTP ${response.status})`);
      const after = response?.headers.get('retry-after');
      const wait = after ? (/^\d+$/.test(after) ? Number(after) * 1000 : Math.max(0, Date.parse(after) - now())) : 1000 * 2 ** attempt;
      await pause(Number.isFinite(wait) ? Math.max(100, wait) : 1000 * 2 ** attempt);
    }
  };
  const parseDeploy = async (response: Response) => {
    let parsed: z.SafeParseReturnType<unknown, Deployment>;
    try { parsed = deployment.safeParse(await response.json()); } catch { throw new Error('Netlify returned an unreadable deployment response'); }
    if (!parsed.success || (parsed.data.site_id && parsed.data.site_id !== siteId)) throw new Error('Netlify returned an invalid deployment response');
    return parsed.data;
  };
  const getDeploy = async (id: string) => parseDeploy(await request(`/sites/${siteId}/deploys/${id}`));
  const waitFor = async (initial: Deployment, ready: boolean) => {
    let current = initial;
    for (;;) {
      if (['error', 'failed', 'rejected'].includes(current.state)) throw new Error('Netlify could not prepare this deployment');
      if (ready ? current.state === 'ready' : current.state !== 'preparing' && (current.required !== undefined || current.state === 'ready')) return current;
      await pause(2000);
      current = await getDeploy(initial.id);
    }
  };
  const fileUrl = (origin: string, path: string) => `${origin}${path}?release=${options.manifest.dataVersion}&check=${encodeURIComponent(options.manifest.generatedAt)}`;
  const verify = async (origin: string) => {
    const response = await request(fileUrl(origin, '/data/manifest.json'), { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } }, false);
    let live: unknown;
    try { live = await response.json(); } catch { throw new Error('Published manifest is unreadable'); }
    if (canonical(live) !== canonical(options.manifest)) throw new Error('Published manifest does not match the saved release');
    const assets = RELEASE_FILES.map((name) => options.manifest.files[name].path);
    const script = [...files.keys()].find((name) => name.startsWith('/assets/') && name.endsWith('.js'));
    if (script) assets.push(script);
    for (const path of assets) {
      const result = await request(fileUrl(origin, path), {}, false);
      const bytes = Buffer.from(await result.arrayBuffer());
      if (digest(bytes) !== digest(files.get(path)!)) throw new Error('Published asset does not match the saved release');
    }
    const page = await request(fileUrl(origin, '/index.html'), {}, false);
    const html = await page.text();
    if (!html.includes('<html') || (script && !html.includes(script))) throw new Error('Published page does not reference the saved application');
  };
  const receipt = (deploy: Deployment, url: string, published: boolean): DeploymentReceipt => ({ provider: 'netlify', deployId: deploy.id, dataVersion: options.manifest.dataVersion, codeRevision: options.manifest.codeRevision, url, published, verifiedAt: new Date(now()).toISOString() });
  if (publicOrigin) {
    const siteSchema = z.object({ id: z.string(), ssl_url: z.string().optional(), url: z.string().optional(), custom_domain: z.string().nullable().optional(), domain_aliases: z.array(z.string()).optional() });
    let site: z.infer<typeof siteSchema>;
    try { site = siteSchema.parse(await (await request(`/sites/${siteId}`)).json()); }
    catch { throw new Error('Could not verify the configured Netlify site'); }
    const origins = [site.ssl_url, site.url, site.custom_domain ? `https://${site.custom_domain}` : undefined, ...(site.domain_aliases ?? []).map((domain) => `https://${domain}`)]
      .filter((url): url is string => !!url).map((url) => { try { return new URL(url).origin; } catch { return ''; } });
    if (site.id !== siteId || !origins.includes(publicOrigin)) throw new Error('Configured public URL does not belong to the Netlify site');
  }
  let draft: Deployment;
  if (options.existingDeployId) {
    draft = await getDeploy(options.existingDeployId);
  } else {
    const hashes = Object.fromEntries([...files].map(([path, content]) => [path, digest(content, 'sha1')]));
    // A failed creation response is not retried automatically: a draft might already exist.
    // It cannot publish anything, and a subsequent run can safely create a fresh draft.
    draft = await parseDeploy(await request(`/sites/${siteId}/deploys`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: hashes, draft: true, async: true }) }, true, false));
    await options.onDraftCreated?.(draft.id);
  }
  draft = await waitFor(draft, false);
  if (draft.required_functions?.length || draft.required_edge_functions?.length) throw new Error('Unexpected server functions in static deployment');
  for (const required of draft.required ?? []) {
    const file = [...files].find(([, bytes]) => digest(bytes, 'sha1') === required);
    if (!file) throw new Error('Netlify requested a file outside the saved artifact');
    const [path, bytes] = file;
    await request(`/deploys/${draft.id}/files${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(bytes) });
  }
  draft = await waitFor(await getDeploy(draft.id), true);
  const draftOrigin = siteOrigin(draft.deploy_ssl_url ?? draft.deploy_url, true);
  await verify(draftOrigin);
  if (!options.publish) return receipt(draft, draftOrigin, false);
  // A prior attempt may already have published this exact release before losing its response.
  // Inspect before repeating a promotion, and never roll back based on an uncertain response.
  try { await verify(publicOrigin!); return receipt(draft, publicOrigin!, true); } catch { /* not yet confirmed */ }
  await options.onBeforePublish?.();
  try { await request(`/sites/${siteId}/deploys/${draft.id}/restore`, { method: 'POST' }, true, false); }
  catch { /* the response can be lost after a successful promotion; inspect the public files */ }
  for (let attempt = 0; ; attempt++) {
    try { await verify(publicOrigin!); return receipt(draft, publicOrigin!, true); }
    catch { if (attempt >= 5) throw new Error('Publication could not be confirmed; inspect the live site or retry the saved artifact'); }
    await pause(2000 * (attempt + 1));
  }
}
