import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deployRelease, type DeployReleaseOptions } from './deploy.js';
import { RELEASE_FILES, type ReleaseManifest } from './release.js';

async function harness(run: (options: DeployReleaseOptions, fake: ReturnType<typeof server>) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'hattrick-deploy-'));
  const dataVersion = 'a'.repeat(64);
  const files = new Map<string, string>([['/index.html', '<html><script src="/assets/app.js"></script></html>'], ['/assets/app.js', 'document.title="Archive";']]);
  const manifest: ReleaseManifest = { schemaVersion: 1, dataVersion, codeRevision: 'abc', generatedAt: '2026-09-12T05:17:00Z', lastChangedAt: '2026-09-12T05:17:00Z', sources: [], files: {} as ReleaseManifest['files'] };
  for (const name of RELEASE_FILES) {
    const path = `/data/versions/${dataVersion}/${name}`;
    files.set(path, '[]');
    manifest.files[name] = { path, bytes: 2, sha256: createHash('sha256').update('[]').digest('hex') };
  }
  files.set('/data/manifest.json', JSON.stringify(manifest));
  for (const [path, body] of files) { await mkdir(join(dir, path.slice(1), '..'), { recursive: true }); await writeFile(join(dir, path.slice(1)), body); }
  const fake = server(files);
  let elapsed = 0;
  try {
    await run({ provider: 'netlify', artifactDir: dir, manifest, netlifySiteId: 'site123', netlifyAuthToken: 'TOPSECRET', publicUrl: 'https://archive.test', fetchImpl: fake.fetch, now: () => Date.UTC(2026, 8, 12) + elapsed, sleep: async (ms) => { elapsed += ms; } }, fake);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
function server(files: Map<string, string>) {
  const events: string[] = [];
  const state = { published: false, corrupt: false, loseRestoreResponse: false, neverReady: false, wrongSite: false, unauthorized: false };
  const draft = () => ({ id: 'deploy123', site_id: 'site123', state: state.neverReady ? 'processing' : 'ready', required: [], deploy_ssl_url: 'https://deploy123--archive.netlify.app' });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    events.push(`${method} ${url.hostname}${url.pathname}`);
    if (url.hostname === 'api.netlify.com') {
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer TOPSECRET');
      if (state.unauthorized) return new Response('TOPSECRET diagnostic', { status: 401 });
      if (url.pathname === '/api/v1/sites/site123') return Response.json({ id: 'site123', ssl_url: state.wrongSite ? 'https://another.test' : 'https://archive.test' });
      if (method === 'POST' && url.pathname.endsWith('/restore')) {
        state.published = true;
        if (state.loseRestoreResponse) throw new Error('TOPSECRET network failure');
        return Response.json(draft());
      }
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.draft, true);
        assert.equal(Object.keys(body.files).length, files.size);
        return Response.json({ ...draft(), state: 'prepared', required: [createHash('sha1').update('[]').digest('hex')] });
      }
      if (method === 'PUT') { assert.equal(new TextDecoder().decode(init?.body as Uint8Array), '[]'); return Response.json({}); }
      return Response.json(draft());
    }
    assert.equal((init?.headers as Record<string, string>)?.Authorization, undefined);
    if (url.hostname === 'archive.test' && !state.published) return Response.json({ dataVersion: 'previous' });
    if (state.corrupt && url.pathname.endsWith('cups.json')) return new Response('CORRUPT');
    const body = files.get(url.pathname);
    return body === undefined ? new Response('', { status: 404 }) : new Response(body);
  };
  return { events, state, fetch: fetcher };
}

test('draft upload is persisted before upload and verified without changing production', async () => harness(async (options, fake) => {
  const result = await deployRelease({ ...options, onDraftCreated: async (id) => { assert.equal(id, 'deploy123'); fake.events.push('saved'); } });
  assert.equal(result.published, false);
  assert.equal(fake.state.published, false);
  assert.ok(fake.events.indexOf('saved') < fake.events.findIndex((e) => e.startsWith('PUT')));
  assert.equal(fake.events.filter((e) => e.startsWith('PUT')).length, 1, 'duplicate file hashes upload only once');
  assert.equal(fake.events.filter((e) => e.endsWith('/restore')).length, 0);
}));
test('verify draft before promoting exact deploy; uncertain promotion is checked on public URL', async () => harness(async (options, fake) => {
  fake.state.loseRestoreResponse = true;
  const result = await deployRelease({ ...options, publish: true });
  assert.equal(result.published, true);
  const restore = fake.events.findIndex((e) => e.endsWith('/restore'));
  assert.ok(fake.events.findIndex((e) => e.includes('deploy123--archive.netlify.app/data/manifest.json')) < restore);
  assert.equal(fake.events.filter((e) => e.endsWith('/restore')).length, 1);
  assert.equal(result.url, 'https://archive.test');
}));
test('saved deployment retries use no new creation and do not republish an already verified release', async () => harness(async (options, fake) => {
  fake.state.published = true;
  const result = await deployRelease({ ...options, publish: true, existingDeployId: 'deploy123' });
  assert.equal(result.published, true);
  assert.equal(fake.events.filter((e) => e.startsWith('POST')).length, 0);
}));
test('failed asset verification prevents publication', async () => harness(async (options, fake) => {
  fake.state.corrupt = true;
  await assert.rejects(deployRelease({ ...options, publish: true }), /asset does not match/);
  assert.equal(fake.events.filter((e) => e.endsWith('/restore')).length, 0);
}));
test('production target must match the configured site', async () => harness(async (options, fake) => {
  fake.state.wrongSite = true;
  await assert.rejects(deployRelease({ ...options, publish: true }), /does not belong/);
  assert.equal(fake.events.filter((e) => e.startsWith('POST')).length, 0);
}));
test('losing the coordinator lease after upload prevents production promotion', async () => harness(async (options, fake) => {
  await assert.rejects(deployRelease({ ...options, publish: true, onBeforePublish: async () => { throw new Error('Lease lost'); } }), /Lease lost/);
  assert.equal(fake.events.filter((e) => e.endsWith('/restore')).length, 0);
}));
test('bounded polling stops and API response bodies or credentials never reach errors', async () => harness(async (options, fake) => {
  fake.state.neverReady = true;
  await assert.rejects(deployRelease({ ...options, timeoutMs: 5000 }), /deadline exceeded/);
  fake.state.neverReady = false;
  fake.state.unauthorized = true;
  await assert.rejects(deployRelease(options), (error: Error) => /HTTP 401/.test(error.message) && !error.message.includes('TOPSECRET'));
}));
test('unknown provider and missing public URL fail without network calls', async () => harness(async (options, fake) => {
  await assert.rejects(deployRelease({ ...options, provider: 'unknown' as DeployReleaseOptions['provider'] }), /Unsupported deployment provider/);
  await assert.rejects(deployRelease({ ...options, publish: true, publicUrl: undefined }), /verification URL/);
  assert.equal(fake.events.length, 0);
}));
