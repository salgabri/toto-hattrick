import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSnapshotLoader, DATA_FILES, type DataManifest, SnapshotError } from '../src/aggregate/snapshot.js';

const generation = 'a'.repeat(64);
const body = JSON.stringify([{ season: 94 }]);
function manifest(): DataManifest {
  return {
    schemaVersion: 1, dataVersion: generation, generatedAt: '2026-09-12T05:17:00Z', lastChangedAt: '2026-09-12T05:17:00Z', sources: [],
    files: Object.fromEntries(DATA_FILES.map((name) => [name, { path: `/data/versions/${generation}/${name}`, sha256: createHash('sha256').update(body).digest('hex'), bytes: Buffer.byteLength(body) }])) as DataManifest['files'],
  };
}
test('all lazy requests stay pinned even after the published manifest changes', async () => {
  const calls: string[] = [];
  let current = manifest();
  const loader = createSnapshotLoader(async (input) => {
    calls.push(String(input));
    return new Response(String(input) === '/data/manifest.json' ? JSON.stringify(current) : body);
  });
  await loader.load('managers.json');
  current = { ...manifest(), dataVersion: 'b'.repeat(64) };
  await loader.load('cups.json');
  await loader.load('managers.json');
  assert.deepEqual(calls, ['/data/manifest.json', `/data/versions/${generation}/managers.json`, `/data/versions/${generation}/cups.json`]);
});
test('retired generation reports a coordinated reload, never newest-file fallback', async () => {
  const calls: string[] = [];
  const loader = createSnapshotLoader(async (input) => {
    calls.push(String(input));
    return String(input) === '/data/manifest.json' ? Response.json(manifest()) : new Response('', { status: 404 });
  });
  let reported: SnapshotError | undefined;
  loader.subscribe((error) => { reported = error; });
  await assert.rejects(loader.load('cups.json', []), (error) => error instanceof SnapshotError && error.reloadRequired);
  assert.equal(reported?.reloadRequired, true);
  assert.deepEqual(calls, ['/data/manifest.json', `/data/versions/${generation}/cups.json`]);
});
test('only a 404 manifest allows legacy loading; malformed JSON and HTTP failures remain errors', async () => {
  for (const response of [new Response('<html>fallback</html>'), new Response('{}'), new Response('', { status: 503 })]) {
    let calls = 0;
    const loader = createSnapshotLoader(async () => { calls++; return response; });
    await assert.rejects(loader.load('cups.json', []), SnapshotError);
    assert.equal(calls, 1);
  }
  const loader = createSnapshotLoader(async (input) => String(input) === '/data/manifest.json' ? new Response('', { status: 404 }) : new Response(body));
  assert.deepEqual(await loader.load('leagues.json'), JSON.parse(body));
});
test('mismatched checksum and incomplete manifests cannot produce empty categories', async () => {
  const loader = createSnapshotLoader(async (input) => String(input) === '/data/manifest.json' ? Response.json(manifest()) : new Response('[]'));
  await assert.rejects(loader.load('cups.json', []), /could not be verified/);
  const invalid = manifest();
  delete (invalid.files as Partial<DataManifest['files']>)['cups.json'];
  const missing = createSnapshotLoader(async () => Response.json(invalid));
  await assert.rejects(missing.load('cups.json', []), /complete update/);
});
