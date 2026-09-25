import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { childEnvironment } from '../config/env.js';

const run = promisify(execFile);

test('update modules do not load the Prisma client before selecting the working database', async () => {
  const runnerUrl = new URL('./runner.js', import.meta.url).href;
  const replayUrl = new URL('./historicalReplay.js', import.meta.url).href;
  const envUrl = new URL('../config/env.js', import.meta.url).href;
  const dbUrl = new URL('../db/client.js', import.meta.url).href;
  // A separate process gives this check a fresh ESM module graph. The loader hook fails on
  // transitive imports too, including an accidental static import through masters.ts.
  const script = `
    import { registerHooks } from 'node:module';
    const runnerUrl = ${JSON.stringify(runnerUrl)};
    const replayUrl = ${JSON.stringify(replayUrl)};
    const envUrl = ${JSON.stringify(envUrl)};
    const dbUrl = ${JSON.stringify(dbUrl)};
    let selected = false;
    let dbLoads = 0;
    registerHooks({ load(url, context, nextLoad) {
      if (url === dbUrl) {
        if (!selected) throw new Error('Prisma client loaded before useUpdateDatabase');
        dbLoads++;
      }
      return nextLoad(url, context);
    } });
    await import(runnerUrl);
    await import(replayUrl);
    const { useUpdateDatabase } = await import(envUrl);
    useUpdateDatabase('file:./selected-import-order.db');
    selected = true;
    await import(dbUrl);
    if (dbLoads !== 1) throw new Error('Expected one Prisma client load after database selection');
  `;
  const result = await run(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: process.cwd(), windowsHide: true, timeout: 20_000,
    env: childEnvironment({ CHPP_CONSUMER_KEY: 'offline', CHPP_CONSUMER_SECRET: 'offline',
      DATABASE_URL: 'file:./initial-import-order.db' }),
  });
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});
