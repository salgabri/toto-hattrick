import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { jsonBytes, sha256, validateObjectKey, type ObjectStore } from './storage.js';

const Reference = z.object({ path: z.string(), key: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative() });
const RecordSchema = z.object({ schemaVersion: z.literal(1), releaseId: z.string(), snapshotId: z.string(), dataVersion: z.string(), codeRevision: z.string(), files: z.array(Reference) });
export type ArtifactRecord = z.infer<typeof RecordSchema>;
const PointerSchema = z.object({
  key: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), releaseId: z.string(),
  publishedAt: z.string().optional(), deploymentId: z.string().optional(), url: z.string().optional(),
  delivery: z.enum(['vercel-git']).optional(), gitCommit: z.string().regex(/^[a-f0-9]{40}$/).optional(),
});
export type ArtifactPointer = z.infer<typeof PointerSchema>;

export async function artifactFiles(dir: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const item of await readdir(join(dir, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    validateObjectKey(path);
    if (item.isSymbolicLink()) throw new Error('Release artifacts must not contain symbolic links');
    if (item.isDirectory()) files.push(...await artifactFiles(dir, path));
    else if (item.isFile()) files.push(path);
    else throw new Error('Unsupported artifact entry');
  }
  return files.sort();
}
export async function saveArtifact(store: ObjectStore, directory: string, metadata: Omit<ArtifactRecord, 'schemaVersion' | 'files'>): Promise<ArtifactPointer> {
  validateObjectKey(metadata.releaseId);
  const files: ArtifactRecord['files'] = [];
  for (const path of await artifactFiles(directory)) {
    const body = await readFile(join(directory, path));
    const key = `releases/artifacts/${metadata.releaseId}/files/${path}`;
    await store.putImmutable(key, body);
    files.push({ path, key, sha256: sha256(body), bytes: body.length });
  }
  const record: ArtifactRecord = { schemaVersion: 1, ...metadata, files };
  const key = `releases/artifacts/${metadata.releaseId}/record.json`;
  const body = jsonBytes(record);
  await store.putImmutable(key, body);
  return { key, sha256: sha256(body), releaseId: metadata.releaseId };
}
export async function readArtifactPointer(store: ObjectStore, key: string) {
  const current = await store.get(key);
  if (!current) return null;
  return { pointer: PointerSchema.parse(JSON.parse(current.body.toString())), etag: current.etag };
}
export async function restoreArtifact(store: ObjectStore, pointer: ArtifactPointer, directory: string): Promise<ArtifactRecord> {
  return restoreArtifactSubset(store, pointer, directory, () => true);
}

/** Restore selected immutable artifact files without reading any excluded object bodies. */
export async function restoreArtifactSubset(
  store: ObjectStore,
  pointer: ArtifactPointer,
  directory: string,
  include: (path: string) => boolean,
): Promise<ArtifactRecord> {
  const object = await store.get(pointer.key);
  if (!object || sha256(object.body) !== pointer.sha256) throw new Error('Release artifact record is missing or corrupt');
  const record = RecordSchema.parse(JSON.parse(object.body.toString()));
  if (record.releaseId !== pointer.releaseId) throw new Error('Release artifact identity mismatch');
  const seen = new Set<string>();
  for (const file of record.files) {
    validateObjectKey(file.path); validateObjectKey(file.key);
    if (seen.has(file.path)) throw new Error('Duplicate artifact path'); seen.add(file.path);
    if (!include(file.path)) continue;
    const target = resolve(directory, file.path);
    if (!target.startsWith(resolve(directory) + sep)) throw new Error('Invalid artifact path');
    const body = await store.get(file.key);
    if (!body || sha256(body.body) !== file.sha256 || body.body.length !== file.bytes) throw new Error('Release artifact file is missing or corrupt');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body.body, { flag: 'wx' });
  }
  return record;
}
