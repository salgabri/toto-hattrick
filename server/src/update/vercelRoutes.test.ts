import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { VERCEL_ROUTES } from './vercelRoutes.js';

test('Vercel Git and validated-artifact deployments use identical routing', async () => {
  const config = JSON.parse(await readFile(new URL('../../../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.routes, VERCEL_ROUTES);
  assert.equal(config.rewrites, undefined, 'high-level rewrites must not conflict with low-level routes');
});
test('missing JSON and assets return 404, while page URLs retain SPA fallback', () => {
  // Contract-level routing check; the adapter also verifies actual staged content before promote.
  function route(path: string, files: string[]) {
    for (const row of VERCEL_ROUTES) {
      if ('handle' in row) { if (files.includes(path)) return { status: 200, destination: path }; continue; }
      if (!new RegExp(row.src).test(path) || ('continue' in row && row.continue)) continue;
      return { status: 'status' in row ? row.status : 200, destination: 'dest' in row ? row.dest : undefined };
    }
    return undefined;
  }
  for (const path of ['/data/manifest.json', '/data/versions/missing/leagues.json', '/assets/missing.js', '/flags/missing.svg']) assert.equal(route(path, [])?.status, 404);
  assert.deepEqual(route('/data/manifest.json', ['/data/manifest.json']), { status: 200, destination: '/data/manifest.json' });
  assert.deepEqual(route('/champions', []), { status: 200, destination: '/index.html' });
});
