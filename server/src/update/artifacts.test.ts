import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalObjectStore, jsonBytes, sha256 } from './storage.js';
import { restoreArtifact, saveArtifact } from './artifacts.js';

test('stored builds restore byte-for-byte without rebuilding and reject missing/corrupt files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'archive-artifact-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const site = join(root, 'site'); await mkdir(join(site, 'assets'), { recursive: true });
  await writeFile(join(site, 'index.html'), '<html>tested candidate</html>');
  await writeFile(join(site, 'assets/app.js'), Buffer.from([0, 1, 2, 255]));
  const store = new LocalObjectStore(join(root, 'private'));
  const pointer = await saveArtifact(store, site, { releaseId: 'r1', snapshotId: 's1', dataVersion: 'v1', codeRevision: 'c1' });
  const record = await restoreArtifact(store, pointer, join(root, 'restored'));
  assert.equal(record.snapshotId, 's1');
  assert.deepEqual(await readFile(join(root, 'restored/assets/app.js')), Buffer.from([0, 1, 2, 255]));
  await writeFile(join(store.root, record.files[0]!.key), 'corrupted');
  await assert.rejects(restoreArtifact(store, pointer, join(root, 'invalid')), /missing or corrupt/);
});
test('a checksummed record cannot escape the restore directory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'archive-traversal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new LocalObjectStore(join(root, 'private'));
  const body = jsonBytes({ schemaVersion: 1, releaseId: 'bad', snapshotId: 's', dataVersion: 'v', codeRevision: 'c', files: [{ path: '../outside', key: 'payload', sha256: sha256('x'), bytes: 1 }] });
  await store.putImmutable('bad-record', body);
  await assert.rejects(restoreArtifact(store, { key: 'bad-record', sha256: sha256(body), releaseId: 'bad' }, join(root, 'output')), /Invalid private object key/);
});
