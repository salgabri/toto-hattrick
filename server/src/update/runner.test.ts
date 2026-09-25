import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { childEnvironment } from '../config/env.js';
import { LocalObjectStore, jsonBytes, sha256 } from './storage.js';
import { readStatePointer, saveSnapshot } from './snapshots.js';
import { readArtifactPointer, restoreArtifact, saveArtifact } from './artifacts.js';
import { RELEASE_FILES } from './release.js';

const run = promisify(execFile);
test('offline coordinator restores isolated state, migrates, validates and retains an exact build', { timeout: 120_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'archive-coordinator-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = resolve('..');
  const db = join(root, 'source.db');
  new DatabaseSync(db).close();
  const cliEnv = childEnvironment({ CHPP_CONSUMER_KEY: 'offline', CHPP_CONSUMER_SECRET: 'offline',
    DATABASE_URL: `file:${db.replaceAll('\\', '/')}`, UPDATE_STORE_DIR: join(root, 'store'), UPDATE_STATE_BUCKET: '',
    UPDATE_WORK_DIR: join(root, 'work'), UPDATE_DEPLOY_PROVIDER: 'none', UPDATE_HEARTBEAT_URL: '', GITHUB_STEP_SUMMARY: '',
    UPDATE_CHPP_AUTOMATION_APPROVED: 'false' });
  await run(process.execPath, [join(repo, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { cwd: process.cwd(), env: cliEnv, windowsHide: true, timeout: 40_000 });
  const sourceHash = sha256(await readFile(db));
  const store = new LocalObjectStore(join(root, 'store'));
  const first = await saveSnapshot({ store, databasePath: db, evidenceRefs: [], runId: 'fixture', codeRevision: 'fixture', expectedStateEtag: null });
  const baselineDir = join(root, 'baseline'); await mkdir(join(baselineDir, 'data'), { recursive: true });
  for (const name of RELEASE_FILES) await writeFile(join(baselineDir, 'data', name), JSON.stringify(name === 'worldcup.json' ? { senior: [], youth: [], regional: [] } : []));
  const baseline = await saveArtifact(store, baselineDir, { releaseId: 'baseline', snapshotId: first.pointer.snapshotId, dataVersion: 'legacy', codeRevision: 'test' });
  await store.compareAndSwap('releases/baseline.json', jsonBytes(baseline), null);
  const result = await run(process.execPath, ['dist/scripts/update.js', 'run', '--no-fetch'], { cwd: process.cwd(), env: cliEnv, windowsHide: true, timeout: 60_000 });
  assert.match(result.stdout, /"calls": 0/); assert.match(result.stdout, /"published": false/);
  assert.match(result.stdout, /"status": "degraded"/);
  const releaseId = result.stdout.match(/"releaseId": "([a-f0-9-]+)"/)?.[1];
  assert.ok(releaseId);
  const recorded = await store.get(`runs/${releaseId}/result.json`);
  assert.ok(recorded);
  const outcome = JSON.parse(recorded.body.toString()) as {
    status: string; acquisitionStatus: string; coverage: { complete: boolean; reasons: string[];
      recentManagerAttribution: { complete: boolean; checked: number; missing: number } };
  };
  assert.equal(outcome.status, 'degraded');
  assert.equal(outcome.acquisitionStatus, 'success');
  assert.equal(outcome.coverage.complete, false);
  assert.ok(outcome.coverage.reasons.includes('no competition sources have been registered'));
  assert.equal(outcome.coverage.recentManagerAttribution.checked, 0);
  assert.equal(sha256(await readFile(db)), sourceHash, 'the source DB remains byte-for-byte unchanged');
  assert.notEqual((await readStatePointer(store))?.pointer.snapshotId, first.pointer.snapshotId);
  const pending = await readArtifactPointer(store, 'releases/pending.json'); assert.ok(pending);
  const record = await restoreArtifact(store, pending.pointer, join(root, 'restored-site'));
  assert.ok(record.files.some(file => file.path === 'index.html'));
  assert.ok(record.files.some(file => file.path === 'data/manifest.json'));
  assert.equal(record.files.filter(file => /^data\/versions\/[^/]+\/[^/]+\.json$/.test(file.path)).length, 7);
  assert.equal(record.files.some(file => file.path === 'data/managers.json'), false, 'stale committed data is excluded');
  assert.equal(await readArtifactPointer(store, 'releases/current.json'), null, 'preparation cannot claim a published release');
  // Selecting Vercel must use its own configuration guard, before touching state or CHPP.
  await assert.rejects(run(process.execPath, ['dist/scripts/update.js', 'run', '--draft', '--no-fetch'], {
    cwd: process.cwd(), env: { ...cliEnv, UPDATE_DEPLOY_PROVIDER: 'vercel', VERCEL_PROJECT_ID: '', VERCEL_TOKEN: '' },
    windowsHide: true, timeout: 20_000,
  }), (error: unknown) => {
    assert.match((error as { stderr: string }).stderr, /Configure the selected deployment provider/); return true;
  });
  await assert.rejects(run(process.execPath, ['dist/scripts/update.js', 'run'], { cwd: process.cwd(), env: cliEnv, windowsHide: true, timeout: 20_000 }), (error: unknown) => {
    assert.match((error as { stderr: string }).stderr, /Confirm your CHPP application/); return true;
  });
  const stash = join(root, 'broken-token.json');
  await writeFile(stash, '{"token":"PRIVATE-STASH-TOKEN",broken');
  await assert.rejects(run(process.execPath, ['dist/scripts/update.js', 'run'], { cwd: process.cwd(),
    env: { ...cliEnv, UPDATE_CHPP_AUTOMATION_APPROVED: 'true', CHPP_ACCESS_TOKEN: '', CHPP_ACCESS_TOKEN_SECRET: '', OAUTH_ACCESS_STASH: stash },
    windowsHide: true, timeout: 20_000 }), (error: unknown) => {
    const stderr = (error as { stderr: string }).stderr;
    assert.match(stderr, /Missing or invalid CHPP access credentials/);
    assert.ok(!stderr.includes('PRIVATE-STASH-TOKEN')); return true;
  });
});
