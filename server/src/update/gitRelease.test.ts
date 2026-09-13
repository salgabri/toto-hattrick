import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readArtifactPointer, saveArtifact, type ArtifactPointer } from './artifacts.js';
import { confirmGitRelease, exportGitRelease, validateGitRelease } from './gitRelease.js';
import { prepareRelease, RELEASE_FILES } from './release.js';
import { jsonBytes, LocalObjectStore } from './storage.js';

function fixture(seasons: number[]) {
  const latest = Math.max(...seasons);
  const titles = seasons.map(season => ({
    country: 'Italy', leagueId: 4, season, club: `Club ${season}`, teamId: 7 + season,
    last: season === latest, ago: latest - season,
  }));
  return {
    'managers.json': [{
      userId: 1, userName: 'Manager', nationality: 'Italy', lg: seasons.length, main: 0, sec: 0, hm: 0, sn: 0, wc: 0,
      wcSilver: 0, wcBronze: 0, lgLast: 1, mainLast: 0, secLast: 0, hmLast: 0, snLast: 0, wcLast: 0,
      titles, cupsMain: [], cupsSec: [], masters: [], seasonal: [], worldCup: [], medals: [],
    }],
    'leagues.json': [{ leagueId: 4, country: 'Italy', champions: seasons.map(season => ({ season, club: `Club ${season}`, manager: 'Manager', teamId: 7 + season, userId: 1 })) }],
    'cups.json': [{ leagueId: 4, country: 'Italy', cups: [{ cupId: 10, cupName: 'National Cup', isMain: true, cupLevel: 1, cupLevelIndex: 1, winners: [] }] }],
    'masters.json': [], 'seasonal.json': [],
    'worldcup.json': { senior: [], youth: [], regional: [] }, 'elections.json': [],
  };
}

async function saveCandidate(directory: string, seasons: number[]) {
  const data = fixture(seasons);
  await mkdir(directory, { recursive: true });
  for (const name of RELEASE_FILES) await writeFile(join(directory, name), JSON.stringify(data[name]));
}

async function prepared(directory: string, seasons: number[], previousDataDir?: string) {
  const candidate = join(directory, 'candidate');
  const data = join(directory, 'data');
  await saveCandidate(candidate, seasons);
  const release = await prepareRelease({ candidateDir: candidate, outputDataDir: data, previousDataDir,
    codeRevision: 'a'.repeat(40), generatedAt: `2026-09-${seasons.length === 1 ? '12' : '13'}T05:17:00.000Z` });
  return { ...release, data };
}

async function saveSite(store: LocalObjectStore, directory: string, releaseId: string, dataVersion: string) {
  const site = join(directory, 'site');
  await mkdir(site, { recursive: true });
  await cp(join(directory, 'data'), join(site, 'data'), { recursive: true });
  await writeFile(join(site, 'index.html'), '<html>public app</html>');
  await writeFile(join(site, 'private.db'), 'must never be exported or restored by the Git path');
  return saveArtifact(store, site, { releaseId, snapshotId: `snapshot-${releaseId}`, dataVersion, codeRevision: 'a'.repeat(40) });
}

async function point(store: LocalObjectStore, key: string, pointer: ArtifactPointer) {
  await store.compareAndSwap(key, jsonBytes(pointer), null);
}

async function setupRelease(root: string) {
  const store = new LocalObjectStore(join(root, 'store'));
  const old = await prepared(join(root, 'old'), [94]);
  const oldPointer = await saveSite(store, join(root, 'old'), 'old', old.dataVersion);
  await point(store, 'releases/current.json', oldPointer);
  const next = await prepared(join(root, 'next'), [94, 95], old.data);
  await cp(join(old.data, 'versions', old.dataVersion), join(next.data, 'versions', old.dataVersion), { recursive: true });
  const nextPointer = await saveSite(store, join(root, 'next'), 'next', next.dataVersion);
  await point(store, 'releases/pending.json', nextPointer);
  return { store, old, next, oldPointer, nextPointer };
}

test('export replaces legacy files atomically with only the exact pending current/prior data tree', async t => {
  const root = await mkdtemp(join(tmpdir(), 'git-release-export-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { store, old, next } = await setupRelease(root);
  const repository = join(root, 'repo');
  const output = join(repository, 'web', 'public', 'data');
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'leagues.json'), 'legacy');
  const readKeys: string[] = [];
  const trackedStore = {
    get: async (key: string) => { readKeys.push(key); return store.get(key); },
    putImmutable: store.putImmutable.bind(store), compareAndSwap: store.compareAndSwap.bind(store),
  };

  const result = await exportGitRelease({ store: trackedStore, repositoryPath: repository, outputDataDir: output });
  assert.equal(result.dataVersion, next.dataVersion);
  assert.deepEqual((await readdir(output)).sort(), ['manifest.json', 'versions']);
  assert.deepEqual((await readdir(join(output, 'versions'))).sort(), [old.dataVersion, next.dataVersion].sort());
  assert.equal(readKeys.some(key => key.endsWith('/private.db')), false, 'private artifact objects are never read');
  await validateGitRelease(output, old.data);
});

test('export rejects unexpected data paths without replacing the checkout data', async t => {
  const root = await mkdtemp(join(tmpdir(), 'git-release-unsafe-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new LocalObjectStore(join(root, 'store'));
  const release = await prepared(join(root, 'release'), [94]);
  const site = join(root, 'release', 'site');
  await cp(release.data, join(site, 'data'), { recursive: true });
  await writeFile(join(site, 'data', 'private.db'), 'not public');
  const pointer = await saveArtifact(store, site, { releaseId: 'unsafe', snapshotId: 'snapshot', dataVersion: release.dataVersion, codeRevision: 'a'.repeat(40) });
  await point(store, 'releases/pending.json', pointer);
  const repository = join(root, 'repo');
  const output = join(repository, 'web', 'public', 'data'); await mkdir(output, { recursive: true }); await writeFile(join(output, 'keep'), 'yes');
  await assert.rejects(exportGitRelease({ store, repositoryPath: repository, outputDataDir: output }), /outside the public Git data contract/);
  assert.equal(await readFile(join(output, 'keep'), 'utf8'), 'yes');

});

test('export can replace only the exact checkout web/public/data directory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'git-release-path-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { store } = await setupRelease(root);
  const repository = join(root, 'repo');
  await mkdir(join(repository, 'web', 'public', 'data'), { recursive: true });
  for (const unsafe of [repository, join(repository, '.git'), join(repository, 'server'), join(repository, 'web')]) {
    await assert.rejects(exportGitRelease({ store, repositoryPath: repository, outputDataDir: unsafe }), /checkout web\/public\/data/);
  }
  const linkedRepository = join(root, 'linked-repo');
  const realOutput = join(root, 'real-output');
  await mkdir(join(linkedRepository, 'web', 'public'), { recursive: true });
  await mkdir(realOutput);
  try { await symlink(realOutput, join(linkedRepository, 'web', 'public', 'data'), 'junction'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EPERM') return t.skip('symbolic links unavailable'); throw error; }
  await assert.rejects(exportGitRelease({ store, repositoryPath: linkedRepository,
    outputDataDir: join(linkedRepository, 'web', 'public', 'data') }), /real directory/);
});

test('standalone validation enforces exact shape and requires the prior live generation after a change', async t => {
  const root = await mkdtemp(join(tmpdir(), 'git-release-validate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const old = await prepared(join(root, 'old'), [94]);
  const next = await prepared(join(root, 'next'), [94, 95], old.data);
  await assert.rejects(validateGitRelease(next.data, old.data), /current and immediately prior/);
  await cp(join(old.data, 'versions', old.dataVersion), join(next.data, 'versions', old.dataVersion), { recursive: true });
  await validateGitRelease(next.data, old.data);
  await writeFile(join(next.data, 'debug.txt'), 'unexpected');
  await assert.rejects(validateGitRelease(next.data, old.data), /exactly manifest\.json and versions/);
});

test('standalone validation accepts the one-time transition from legacy flat public bundles', async t => {
  const root = await mkdtemp(join(tmpdir(), 'git-release-legacy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const legacy = join(root, 'legacy');
  await saveCandidate(legacy, [94]);
  const next = await prepared(join(root, 'next'), [94, 95], legacy);
  await validateGitRelease(next.data, legacy);
});

test('confirmation polls until Vercel serves the exact manifest and every checksummed bundle, then CAS-advances current', async t => {
  const root = await mkdtemp(join(tmpdir(), 'git-release-confirm-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { store, next } = await setupRelease(root);
  const publicFiles = new Map<string, Buffer>();
  publicFiles.set('/data/manifest.json', await readFile(join(next.data, 'manifest.json')));
  for (const name of RELEASE_FILES) publicFiles.set(`/data/versions/${next.dataVersion}/${name}`, await readFile(join(next.data, 'versions', next.dataVersion, name)));
  let manifestAttempts = 0;
  let clock = 0;
  const fetchImpl: typeof fetch = async input => {
    const path = new URL(String(input)).pathname;
    if (path === '/data/manifest.json' && manifestAttempts++ === 0) return new Response('{}');
    const body = publicFiles.get(path);
    return body ? new Response(body) : new Response('missing', { status: 404 });
  };
  const commit = 'b'.repeat(40);
  const result = await confirmGitRelease({ store, publicUrl: 'https://toto-hattrick.vercel.app', commit,
    timeoutMs: 10_000, fetchImpl, now: () => clock, sleep: async milliseconds => { clock += milliseconds; } });
  assert.equal(result.commit, commit);
  assert.equal(manifestAttempts, 2);
  const current = await readArtifactPointer(store, 'releases/current.json');
  assert.equal(current?.pointer.releaseId, 'next');
  assert.equal(current?.pointer.deploymentId, commit);
  assert.equal(current?.pointer.url, 'https://toto-hattrick.vercel.app');
});

test('Vercel confirmation requires production to identify the exact merged main commit', async t => {
  const root = await mkdtemp(join(tmpdir(), 'git-release-vercel-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { store, next } = await setupRelease(root);
  const publicFiles = new Map<string, Buffer>();
  publicFiles.set('/data/manifest.json', await readFile(join(next.data, 'manifest.json')));
  for (const name of RELEASE_FILES) publicFiles.set(`/data/versions/${next.dataVersion}/${name}`, await readFile(join(next.data, 'versions', next.dataVersion, name)));
  const commit = 'd'.repeat(40);
  let apiReads = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.vercel.com') {
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer private-test-token');
      assert.equal(url.searchParams.get('teamId'), 'team_test');
      apiReads += 1;
      if (url.pathname === '/v9/projects/prj_test') return new Response(JSON.stringify({ id: 'prj_test', targets: { production: { id: 'dpl_git' } } }));
      if (url.pathname === '/v13/deployments/dpl_git') return new Response(JSON.stringify({ id: 'dpl_git', projectId: 'prj_test', readyState: 'READY', target: 'production', meta: { githubCommitSha: commit, githubCommitRef: 'main' } }));
    }
    const body = publicFiles.get(url.pathname);
    return body ? new Response(body) : new Response('missing', { status: 404 });
  };
  const result = await confirmGitRelease({ store, publicUrl: 'https://toto-hattrick.vercel.app', commit,
    vercelProjectId: 'prj_test', vercelTeamId: 'team_test', vercelToken: 'private-test-token', fetchImpl });
  assert.equal(result.deploymentId, 'dpl_git');
  assert.equal(apiReads, 4, 'the production target is checked before and after public bytes');
  assert.equal((await readArtifactPointer(store, 'releases/current.json'))?.pointer.deploymentId, 'dpl_git');
  assert.equal((await readArtifactPointer(store, 'releases/current.json'))?.pointer.gitCommit, commit);
  assert.equal((await readArtifactPointer(store, 'releases/current.json'))?.pointer.delivery, 'vercel-git');
});

test('confirmation timeout or checksum mismatch never advances the current pointer', async t => {
  const root = await mkdtemp(join(tmpdir(), 'git-release-timeout-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { store, oldPointer } = await setupRelease(root);
  let clock = 0;
  await assert.rejects(confirmGitRelease({
    store, publicUrl: 'https://toto-hattrick.vercel.app', commit: 'c'.repeat(40), timeoutMs: 2,
    fetchImpl: async () => new Response('wrong bytes'), now: () => clock, sleep: async milliseconds => { clock += milliseconds; },
  }), /not verified before the timeout/);
  assert.equal((await readArtifactPointer(store, 'releases/current.json'))?.pointer.releaseId, oldPointer.releaseId);
});
