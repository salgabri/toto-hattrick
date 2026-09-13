import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { readArtifactPointer, restoreArtifactSubset, type ArtifactPointer } from './artifacts.js';
import { acquireLease } from './lease.js';
import { RELEASE_FILES, validateRelease, type ReleaseFile, type ReleaseManifest } from './release.js';
import { jsonBytes, type ObjectStore } from './storage.js';

const sha256 = (body: Uint8Array | string) => createHash('sha256').update(body).digest('hex');
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const source = z.object({
  key: z.string().min(1), label: z.string().min(1), lastSuccessfulCheck: z.string().datetime().nullable(),
  pending: z.number().int().nonnegative(), status: z.enum(['ok', 'pending', 'failed']),
}).strict();
const releaseFile = z.object({ path: z.string(), sha256: sha, bytes: z.number().int().positive() }).strict();
const releaseManifest = z.object({
  schemaVersion: z.literal(1), dataVersion: sha, codeRevision: z.string().min(1),
  generatedAt: z.string().datetime(), lastChangedAt: z.string().datetime(), sources: z.array(source),
  files: z.object(Object.fromEntries(RELEASE_FILES.map(name => [name, releaseFile])) as Record<ReleaseFile, typeof releaseFile>).strict(),
}).strict();

export interface InspectedGitRelease {
  manifest: ReleaseManifest;
  manifestBytes: Buffer;
  versions: string[];
}

async function entries(directory: string) {
  return (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
}

async function assertRegularFile(path: string, label: string) {
  const value = await lstat(path);
  if (value.isSymbolicLink() || !value.isFile()) throw new Error(`Git release contains an unsafe ${label}`);
}

async function inspectVersion(directory: string, version: string) {
  if (!sha.safeParse(version).success) throw new Error('Git release contains an invalid version directory');
  const contents = await entries(directory);
  const expected = [...RELEASE_FILES].sort();
  if (contents.length !== expected.length || contents.some((entry, index) => entry.name !== expected[index]))
    throw new Error(`Git release version ${version} does not contain exactly the public bundles`);
  for (const entry of contents) {
    if (entry.isSymbolicLink() || !entry.isFile()) throw new Error('Git release bundle paths must be regular files');
  }
  const hashes = await Promise.all(RELEASE_FILES.map(async name => `${name}:${sha256(await readFile(join(directory, name)))}`));
  if (sha256(hashes.join('\n')) !== version) throw new Error(`Git release version ${version} does not match its bundle contents`);
  await validateRelease(directory);
}

async function readManifest(directory: string) {
  const path = join(directory, 'manifest.json');
  await assertRegularFile(path, 'manifest');
  const bytes = await readFile(path);
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('Git release manifest is not valid JSON'); }
  const result = releaseManifest.safeParse(parsed);
  if (!result.success) throw new Error(`Git release manifest is invalid: ${result.error.message}`);
  const manifest = result.data as ReleaseManifest;
  for (const name of RELEASE_FILES) {
    const file = manifest.files[name];
    if (file.path !== `/data/versions/${manifest.dataVersion}/${name}`)
      throw new Error(`Git release manifest has an invalid path for ${name}`);
  }
  return { manifest, bytes };
}

async function inspectTree(candidateDataDir: string): Promise<InspectedGitRelease> {
  const root = resolve(candidateDataDir);
  const rootEntries = await entries(root);
  if (rootEntries.length !== 2 || rootEntries[0]?.name !== 'manifest.json' || rootEntries[1]?.name !== 'versions')
    throw new Error('Git release data must contain exactly manifest.json and versions/');
  if (rootEntries.some(entry => entry.isSymbolicLink())) throw new Error('Git release data must not contain symbolic links');
  if (!rootEntries[0]!.isFile() || !rootEntries[1]!.isDirectory()) throw new Error('Git release data tree has invalid entry types');
  const { manifest, bytes: manifestBytes } = await readManifest(root);
  const versionEntries = await entries(join(root, 'versions'));
  if (versionEntries.some(entry => entry.isSymbolicLink() || !entry.isDirectory()))
    throw new Error('Git release versions must be real directories');
  const versions = versionEntries.map(entry => entry.name).sort();
  if (versions.length < 1 || versions.length > 2 || !versions.includes(manifest.dataVersion))
    throw new Error('Git release must contain its current generation and at most one prior generation');
  for (const version of versions) await inspectVersion(join(root, 'versions', version), version);
  await validateRelease(root);
  return { manifest, manifestBytes, versions };
}

/** Validate the exact data tree committed to Git. No store, credentials, DB, or network needed. */
export async function validateGitRelease(
  candidateDataDir: string,
  previousDataDir?: string,
): Promise<InspectedGitRelease> {
  const inspected = await inspectTree(candidateDataDir);
  if (previousDataDir) {
    let previous: InspectedGitRelease | undefined;
    try {
      await assertRegularFile(join(previousDataDir, 'manifest.json'), 'previous manifest');
      previous = await inspectTree(previousDataDir);
    } catch (error) {
      // The first Git release legitimately compares against the repository's legacy flat
      // bundle directory. validateRelease below still applies all historical invariants.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (previous) {
      const expected = previous.manifest.dataVersion === inspected.manifest.dataVersion
        ? new Set([inspected.manifest.dataVersion, ...previous.versions.filter(version => version !== inspected.manifest.dataVersion)])
        : new Set([inspected.manifest.dataVersion, previous.manifest.dataVersion]);
      // For unchanged contents, dropping an obsolete older generation is safe; adding or
      // substituting an unrelated generation is not. A changed release must retain exactly
      // the generation which was live immediately before it.
      const sameAndCurrentOnly = previous.manifest.dataVersion === inspected.manifest.dataVersion
        && inspected.versions.length === 1 && inspected.versions[0] === inspected.manifest.dataVersion;
      if (!sameAndCurrentOnly && (inspected.versions.length !== expected.size || inspected.versions.some(version => !expected.has(version))))
        throw new Error('Git release must contain exactly the current and immediately prior data generations');
    }
  }
  await validateRelease(resolve(candidateDataDir), previousDataDir);
  return inspected;
}

function isPublicDataPath(path: string) {
  return path === 'data/manifest.json'
    || /^data\/(managers|leagues|cups|masters|seasonal|worldcup|elections)\.json$/.test(path)
    || /^data\/versions\/[a-f0-9]{64}\/(managers|leagues|cups|masters|seasonal|worldcup|elections)\.json$/.test(path);
}

async function assertReplaceableDirectory(path: string) {
  if (path === parse(path).root) throw new Error('Refusing to replace a filesystem root');
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Git release output must be a real directory');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  if (await realpath(parent) !== resolve(parent)) throw new Error('Git release output parent must not be a symbolic link');
}

async function replaceDirectory(staged: string, output: string) {
  await assertReplaceableDirectory(output);
  const backup = `${output}.previous-${process.pid}-${Date.now()}`;
  let movedOld = false;
  try {
    try { await rename(output, backup); movedOld = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await rename(staged, output);
  } catch (error) {
    if (movedOld) await rename(backup, output).catch(() => undefined);
    throw error;
  }
  if (movedOld) await rm(backup, { recursive: true, force: true });
}

export interface ExportGitReleaseOptions {
  store: ObjectStore;
  /** Root of the exact checkout/worktree whose public data directory may be replaced. */
  repositoryPath: string;
  outputDataDir: string;
  lease?: { assertHeld(reserveMs?: number): Promise<void> };
}

async function exactPublicDataDirectory(repositoryPath: string, outputDataDir: string) {
  const repository = resolve(repositoryPath);
  if (repository === parse(repository).root) throw new Error('Git release repository must not be a filesystem root');
  const repositoryInfo = await lstat(repository);
  if (repositoryInfo.isSymbolicLink() || !repositoryInfo.isDirectory())
    throw new Error('Git release repository must be a real directory');
  if (await realpath(repository) !== repository)
    throw new Error('Git release repository path must be canonical');
  const expected = join(repository, 'web', 'public', 'data');
  if (resolve(outputDataDir) !== expected)
    throw new Error('Git release output must be the checkout web/public/data directory');
  return expected;
}

/** Restore only public data objects from the immutable pending artifact and swap them into Git. */
export async function exportGitRelease(options: ExportGitReleaseOptions) {
  const output = await exactPublicDataDirectory(options.repositoryPath, options.outputDataDir);
  const parent = dirname(output);
  await assertReplaceableDirectory(output);
  const ownedLease = options.lease ? undefined : await acquireLease(options.store);
  const lease = options.lease ?? ownedLease!;
  let temporary: string | undefined;
  try {
    temporary = await mkdtemp(join(parent, '.git-release-'));
    const pending = await readArtifactPointer(options.store, 'releases/pending.json');
    if (!pending) throw new Error('There is no prepared release to export');
    const site = join(temporary, 'site');
    const record = await restoreArtifactSubset(options.store, pending.pointer, site, isPublicDataPath);
    if (record.files.some(file => file.path.startsWith('data/') && !isPublicDataPath(file.path)))
      throw new Error('Pending artifact contains a file outside the public Git data contract');
    const artifactData = join(site, 'data');
    if (record.dataVersion !== (await readManifest(artifactData)).manifest.dataVersion)
      throw new Error('Pending artifact data version does not match its manifest');

    let previousData: string | undefined;
    const current = await readArtifactPointer(options.store, 'releases/current.json');
    if (current) {
      const previousSite = join(temporary, 'previous-site');
      await restoreArtifactSubset(options.store, current.pointer, previousSite, isPublicDataPath);
      try { await lstat(join(previousSite, 'data')); previousData = join(previousSite, 'data'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const inspected = await validateGitRelease(artifactData, previousData);
    await lease.assertHeld();
    const latest = await readArtifactPointer(options.store, 'releases/pending.json');
    if (!latest || latest.etag !== pending.etag) throw new Error('Pending release changed during Git export');
    await replaceDirectory(artifactData, output);
    return { releaseId: pending.pointer.releaseId, dataVersion: inspected.manifest.dataVersion, outputDataDir: output, versions: inspected.versions };
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
    await ownedLease?.release();
  }
}

function productionOrigin(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Git release confirmation requires a public HTTPS site origin');
  return url.origin;
}

async function responseBytes(response: Response, label: string) {
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function verifyProduction(options: {
  origin: string; inspected: InspectedGitRelease; fetchImpl: typeof fetch; deadline: number; now: () => number;
}) {
  const query = `release=${options.inspected.manifest.dataVersion}&check=${options.now()}`;
  const request = (path: string) => {
    const remaining = options.deadline - options.now();
    if (remaining <= 0) throw new Error('Git deployment verification deadline exceeded');
    return options.fetchImpl(`${options.origin}${path}?${query}`, {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' }, redirect: 'error',
      signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, remaining))),
    });
  };
  const manifest = await responseBytes(await request('/data/manifest.json'), 'Published manifest');
  if (!manifest.equals(options.inspected.manifestBytes)) throw new Error('Published manifest does not exactly match the pending release');
  for (const name of RELEASE_FILES) {
    const expected = options.inspected.manifest.files[name];
    const body = await responseBytes(await request(expected.path), `Published ${name}`);
    if (body.length !== expected.bytes || sha256(body) !== expected.sha256)
      throw new Error(`Published ${name} does not match the pending release`);
  }
}

export interface ConfirmGitReleaseOptions {
  store: ObjectStore;
  publicUrl: string;
  commit: string;
  releaseId?: string;
  lease?: { assertHeld(reserveMs?: number): Promise<void> };
  vercelProjectId?: string;
  vercelTeamId?: string;
  vercelToken?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

async function verifyVercelGitCommit(options: {
  projectId: string; teamId?: string; token: string; commit: string; fetchImpl: typeof fetch; deadline: number; now: () => number;
}) {
  if (!/^[a-zA-Z0-9_-]+$/.test(options.projectId)) throw new Error('Git confirmation has an invalid Vercel project ID');
  if (options.teamId && !/^[a-zA-Z0-9_-]+$/.test(options.teamId)) throw new Error('Git confirmation has an invalid Vercel team ID');
  const request = async (path: string) => {
    const remaining = options.deadline - options.now();
    if (remaining <= 0) throw new Error('Git deployment verification deadline exceeded');
    const url = new URL(path, 'https://api.vercel.com');
    if (options.teamId) url.searchParams.set('teamId', options.teamId);
    const response = await options.fetchImpl(url, {
      headers: { Authorization: `Bearer ${options.token}`, Accept: 'application/json' }, redirect: 'error',
      signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, remaining))),
    });
    if (!response.ok) throw new Error(`Vercel deployment lookup returned HTTP ${response.status}`);
    try { return await response.json(); }
    catch { throw new Error('Vercel returned an unreadable deployment response'); }
  };
  const project = z.object({
    id: z.string(), targets: z.object({ production: z.object({ id: z.string() }).optional() }).optional(),
  }).safeParse(await request(`/v9/projects/${encodeURIComponent(options.projectId)}`));
  const deploymentId = project.success && project.data.id === options.projectId ? project.data.targets?.production?.id : undefined;
  if (!deploymentId) throw new Error('Vercel has no current production deployment for this project');
  const deployment = z.object({
    id: z.string(), projectId: z.string(), readyState: z.string(), target: z.string().nullable().optional(),
    meta: z.record(z.string()).optional(),
  }).safeParse(await request(`/v13/deployments/${encodeURIComponent(deploymentId)}`));
  if (!deployment.success || deployment.data.id !== deploymentId || deployment.data.projectId !== options.projectId)
    throw new Error('Vercel returned an invalid production deployment');
  if (deployment.data.readyState !== 'READY' || deployment.data.target !== 'production')
    throw new Error('The merged Vercel production deployment is not ready');
  if (deployment.data.meta?.githubCommitSha?.toLowerCase() !== options.commit || deployment.data.meta?.githubCommitRef !== 'main')
    throw new Error('Vercel production does not yet run the merged Git commit');
  return deploymentId;
}

/** Poll the Git deployment, then CAS-advance current only after every public byte is verified. */
export async function confirmGitRelease(options: ConfirmGitReleaseOptions) {
  if (!/^[a-f0-9]{40}$/.test(options.commit)) throw new Error('Git release confirmation requires a full 40-character commit SHA');
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30 * 60_000) throw new Error('Git release confirmation timeout must be between 1 ms and 30 minutes');
  const origin = productionOrigin(options.publicUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;
  const ownedLease = options.lease ? undefined : await acquireLease(options.store);
  const lease = options.lease ?? ownedLease!;
  let temporary: string | undefined;
  try {
    temporary = await mkdtemp(join(tmpdir(), 'hattrick-git-confirm-'));
    const pending = await readArtifactPointer(options.store, 'releases/pending.json');
    if (!pending) throw new Error('There is no prepared release to confirm');
    if (options.releaseId && pending.pointer.releaseId !== options.releaseId)
      throw new Error('The pending release differs from the release exported to Git');
    const current = await readArtifactPointer(options.store, 'releases/current.json');
    const site = join(temporary, 'site');
    const record = await restoreArtifactSubset(options.store, pending.pointer, site, isPublicDataPath);
    if (record.files.some(file => file.path.startsWith('data/') && !isPublicDataPath(file.path)))
      throw new Error('Pending artifact contains a file outside the public Git data contract');
    let previousData: string | undefined;
    if (current) {
      const previousSite = join(temporary, 'previous-site');
      await restoreArtifactSubset(options.store, current.pointer, previousSite, isPublicDataPath);
      try { await lstat(join(previousSite, 'data')); previousData = join(previousSite, 'data'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const inspected = await validateGitRelease(join(site, 'data'), previousData);
    if (record.dataVersion !== inspected.manifest.dataVersion) throw new Error('Pending artifact data version does not match its manifest');
    const deadline = now() + timeoutMs;
    let lastError: unknown;
    let verified = false;
    let deploymentId: string | undefined;
    while (now() < deadline) {
      try {
        if (options.vercelProjectId || options.vercelToken) {
          if (!options.vercelProjectId || !options.vercelToken) throw new Error('Both Vercel project ID and token are required for exact Git confirmation');
          deploymentId = await verifyVercelGitCommit({ projectId: options.vercelProjectId, teamId: options.vercelTeamId, token: options.vercelToken,
            commit: options.commit, fetchImpl, deadline, now });
        }
        await verifyProduction({ origin, inspected, fetchImpl, deadline, now });
        if (options.vercelProjectId && options.vercelToken) {
          const after = await verifyVercelGitCommit({ projectId: options.vercelProjectId, teamId: options.vercelTeamId, token: options.vercelToken,
            commit: options.commit, fetchImpl, deadline, now });
          if (after !== deploymentId) throw new Error('Vercel production changed during public verification');
        }
        lastError = undefined;
        verified = true;
        break;
      } catch (error) {
        lastError = error;
        const remaining = deadline - now();
        if (remaining <= 0) break;
        await sleep(Math.min(2_000, remaining));
      }
    }
    if (!verified) throw new Error(`Git deployment was not verified before the timeout${lastError ? `: ${(lastError as Error).message}` : ''}`);
    await lease.assertHeld();
    const latest = await readArtifactPointer(options.store, 'releases/pending.json');
    if (!latest || latest.etag !== pending.etag) throw new Error('Pending release changed during Git confirmation');
    const publishedAt = new Date(now()).toISOString();
    const pointer: ArtifactPointer = { ...pending.pointer, publishedAt, deploymentId: deploymentId ?? options.commit,
      delivery: 'vercel-git', gitCommit: options.commit, url: origin };
    await options.store.compareAndSwap('releases/current.json', jsonBytes(pointer), current?.etag ?? null);
    return { releaseId: pointer.releaseId, dataVersion: inspected.manifest.dataVersion, commit: options.commit,
      deploymentId: deploymentId ?? null, url: origin, publishedAt };
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
    await ownedLease?.release();
  }
}
