/** One immutable data generation per page lifetime, including lazy-loaded categories. */
export const DATA_FILES = ['managers.json', 'leagues.json', 'cups.json', 'masters.json', 'seasonal.json', 'worldcup.json', 'elections.json'] as const;
type DataFile = typeof DATA_FILES[number];
export interface DataManifest {
  schemaVersion: 1;
  dataVersion: string;
  generatedAt: string;
  lastChangedAt: string;
  sources: Array<{ key: string; label: string; lastSuccessfulCheck: string | null; pending: number; status: 'ok' | 'pending' | 'failed' }>;
  files: Record<DataFile, { path: string; sha256: string; bytes: number }>;
}
export class SnapshotError extends Error {
  constructor(message: string, public readonly reloadRequired = false) { super(message); this.name = 'SnapshotError'; }
}
function parseManifest(value: unknown): DataManifest {
  if (!value || typeof value !== 'object') throw new SnapshotError('The archive update information could not be read. Please try reloading.');
  const m = value as DataManifest;
  if (m.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(m.dataVersion) || !m.files || !Array.isArray(m.sources)
    || !Number.isFinite(Date.parse(m.generatedAt)) || !Number.isFinite(Date.parse(m.lastChangedAt))) throw new SnapshotError('The archive update information is invalid. Please try reloading.');
  for (const name of DATA_FILES) {
    const f = m.files[name];
    if (!f || f.path !== `/data/versions/${m.dataVersion}/${name}` || !/^[a-f0-9]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.bytes) || f.bytes < 1) throw new SnapshotError('The archive files do not describe a complete update. Please try reloading.');
  }
  for (const s of m.sources) {
    if (!s || typeof s.key !== 'string' || typeof s.label !== 'string' || !Number.isSafeInteger(s.pending) || s.pending < 0 || !['ok', 'pending', 'failed'].includes(s.status)
      || (s.lastSuccessfulCheck !== null && !Number.isFinite(Date.parse(s.lastSuccessfulCheck)))) throw new SnapshotError('The archive source status is invalid. Please try reloading.');
  }
  return m;
}
async function sha256(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function createSnapshotLoader(fetcher: typeof fetch = fetch) {
  let manifestPromise: Promise<DataManifest | null> | undefined;
  const bundles = new Map<DataFile, Promise<unknown>>();
  const listeners = new Set<(error: SnapshotError) => void>();
  let error: SnapshotError | null = null;
  const report = (cause: unknown): never => {
    error = cause instanceof SnapshotError ? cause : new SnapshotError('The archive could not be loaded. Please try reloading.');
    for (const listener of listeners) listener(error);
    throw error;
  };
  const manifest = () => manifestPromise ??= (async () => {
    const response = await fetcher('/data/manifest.json', { cache: 'no-cache', headers: { Accept: 'application/json' } });
    // Only a genuinely missing manifest denotes an older deployment. Invalid JSON, the host's
    // HTML fallback, permissions and network failures must never downgrade to mutable paths.
    if (response.status === 404) return null;
    if (!response.ok) throw new SnapshotError('The archive update information is unavailable. Please try reloading.');
    return parseManifest(await response.json());
  })().catch(report);
  return {
    manifest,
    subscribe(listener: (error: SnapshotError) => void) {
      listeners.add(listener);
      if (error) listener(error);
      return () => { listeners.delete(listener); };
    },
    load<T>(name: DataFile, legacyMissing?: T): Promise<T> {
      let promise = bundles.get(name);
      if (!promise) {
        promise = (async () => {
          const pinned = await manifest();
          const response = await fetcher(pinned ? pinned.files[name].path : `/data/${name}`);
          if (!pinned && response.status === 404 && legacyMissing !== undefined) return legacyMissing;
          if (pinned && (response.status === 404 || response.status === 410)) throw new SnapshotError('A newer archive is available. Reload this page to continue with all results from the same update.', true);
          if (!response.ok) throw new SnapshotError('Some archive results are unavailable. Please try reloading.');
          const bytes = await response.arrayBuffer();
          if (pinned && (bytes.byteLength !== pinned.files[name].bytes || await sha256(bytes) !== pinned.files[name].sha256)) throw new SnapshotError('The archive files could not be verified. Please try reloading.');
          return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
        })().catch(report);
        bundles.set(name, promise);
      }
      return promise as Promise<T>;
    },
  };
}
export const snapshot = createSnapshotLoader();
