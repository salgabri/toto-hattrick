import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { prisma } from '../db/client.js';
import { captureEvidence, configureEvidenceStore, evidenceReferences, importedEvidenceKey } from './evidence.js';
import { BHUTAN_HISTORY_PATH, BULK_HISTORY_PATH, CHECKED_IN_HISTORY_PATH, ETHIOPIA_HISTORY_PATH, GIBRALTAR_HISTORY_PATH, HAITI_HISTORY_PATH,
  HRO_PROFILE_PATH, replayRetainedBulkClubHistories, replayRetainedClubHistories, replayRetainedHroProfile,
  retainCheckedInBulkClubHistory, retainCheckedInClubHistory, retainCheckedInHroProfile,
  retainedBulkClubHistories, retainedClubHistories } from './historicalReplay.js';
import { LocalObjectStore, sha256 } from './storage.js';

const repositoryPath = resolve('..');
const reviewedHistory = () => readFile(join(repositoryPath, CHECKED_IN_HISTORY_PATH));
function mock(t: TestContext, target: object, method: string, implementation: (...args: any[]) => any) {
  const object = target as Record<string, unknown>;
  const original = object[method]; object[method] = implementation;
  t.after(() => { object[method] = original; });
}

test('checked-in history is retained immutably and replayed only from accepted references', async t => {
  const root = await mkdtemp(join(tmpdir(), 'archive-history-replay-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = join(root, 'checkout');
  const path = join(checkout, CHECKED_IN_HISTORY_PATH);
  await mkdir(join(checkout, 'server/src/data'), { recursive: true });
  const original = await reviewedHistory();
  await writeFile(path, original);
  const store = new LocalObjectStore(join(root, 'private'));
  const reset = configureEvidenceStore({ store, workspacePath: root }); t.after(reset);
  const first = await retainCheckedInClubHistory(store, checkout);
  assert.equal(first.key, importedEvidenceKey(CHECKED_IN_HISTORY_PATH, original));
  assert.equal((await retainedClubHistories(store, [])).histories.length, 0, 'Unreferenced captures cannot silently affect the archive');
  const retained = await retainedClubHistories(store, evidenceReferences());
  assert.equal(retained.captures, 1);
  assert.equal(retained.histories[0]?.teamId, 820764);
  assert.deepEqual(await retainCheckedInClubHistory(store, checkout), first, 'Identical replay preserves the first immutable capture');
  await writeFile(path, Buffer.concat([original, Buffer.from('\n')]));
  const second = await retainCheckedInClubHistory(store, checkout);
  assert.notEqual(second.key, first.key, 'Changed checkout bytes create a new capture; the old one is not overwritten');
  assert.ok(await store.get(first.key));
  assert.equal((await retainedClubHistories(store, evidenceReferences())).captures, 2);
});

test('reviewed country captures are retained only with their exact linked winners', async t => {
  const root = await mkdtemp(join(tmpdir(), 'archive-history-countries-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = join(root, 'checkout');
  await mkdir(join(checkout, 'server/src/data'), { recursive: true });
  for (const path of [ETHIOPIA_HISTORY_PATH, BHUTAN_HISTORY_PATH, GIBRALTAR_HISTORY_PATH, HAITI_HISTORY_PATH])
    await writeFile(join(checkout, path), await readFile(join(repositoryPath, path)));
  const store = new LocalObjectStore(join(root, 'private'));
  const reset = configureEvidenceStore({ store, workspacePath: root }); t.after(reset);
  await retainCheckedInClubHistory(store, checkout, ETHIOPIA_HISTORY_PATH);
  await retainCheckedInClubHistory(store, checkout, BHUTAN_HISTORY_PATH);
  await retainCheckedInClubHistory(store, checkout, GIBRALTAR_HISTORY_PATH);
  await retainCheckedInClubHistory(store, checkout, HAITI_HISTORY_PATH);
  const retained = await retainedClubHistories(store, evidenceReferences());
  assert.equal(retained.captures, 4);
  assert.deepEqual(retained.histories.map(({ teamId }) => teamId).sort(),
    [2064714, 2064759, 2064846, 2064763, 2064747, 2787850, 2787812, 2785354, 2785355,
      2790688, 2787922, 2788315, 2815169, 2788215,
      2066127, 2066072, 2066147, 2066044, 2066113].sort());
});

test('retained HRO manager-profile trophy applies only to its exact completed league winner', async t => {
  const root = await mkdtemp(join(tmpdir(), 'archive-history-profile-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = join(root, 'checkout');
  await mkdir(join(checkout, 'server/src/data'), { recursive: true });
  const body = await readFile(join(repositoryPath, HRO_PROFILE_PATH));
  await writeFile(join(checkout, HRO_PROFILE_PATH), body);
  const store = new LocalObjectStore(join(root, 'private'));
  const reset = configureEvidenceStore({ store, workspacePath: root }); t.after(reset);
  const ref = await retainCheckedInHroProfile(store, checkout);
  assert.equal(ref.key, importedEvidenceKey(HRO_PROFILE_PATH, body));
  assert.equal((await replayRetainedHroProfile(store, [])).captures, 0);
  mock(t, prisma.leagueChampion, 'findUnique', async () => ({ leagueId: 164, season: 19,
    topSeriesId: 258666, countryName: 'Haiti', championTeamId: 2066186, championTeamName: 'HRO',
    championUserId: 0, championUserName: null, complete: true }));
  const writes: unknown[] = [];
  mock(t, prisma, '$transaction', async (run: (tx: object) => Promise<unknown>) => run({
    leagueChampion: { updateMany: async (args: unknown) => { writes.push(args); return { count: 1 }; } },
    hattrickUser: { upsert: async () => ({}) },
  }));
  const tasks: unknown[] = [];
  mock(t, prisma.updateItem, 'updateMany', async (args: unknown) => { tasks.push(args); return { count: 1 }; });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network request is allowed'); });
  const result = await replayRetainedHroProfile(store, evidenceReferences(), new Date('2026-09-26T12:00:00.000Z'));
  assert.equal(result.applied, 1);
  assert.equal(result.attributionTasksCompleted, 1);
  assert.deepEqual((writes[0] as { data: object }).data, { championUserId: 4178181, championUserName: 'ooooo' });
  assert.deepEqual((tasks[0] as { where: object }).where, {
    sourceKey: 'league:164', itemKey: '19', task: 'attribution', state: { not: 'complete' },
  });
  const changed = JSON.parse(body.toString('utf8')) as { managerProfile: { sourceURL: string } };
  changed.managerProfile.sourceURL = changed.managerProfile.sourceURL.replace('4178181', '4178182');
  await writeFile(join(checkout, HRO_PROFILE_PATH), JSON.stringify(changed));
  await assert.rejects(retainCheckedInHroProfile(store, checkout), /Retained evidence cannot be validated/);
});

test('malformed, mislabeled, and changed retained captures fail closed', async t => {
  const root = await mkdtemp(join(tmpdir(), 'archive-history-invalid-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new LocalObjectStore(join(root, 'private'));
  const original = await reviewedHistory();
  const key = importedEvidenceKey(CHECKED_IN_HISTORY_PATH, original);
  const payload = { path: CHECKED_IN_HISTORY_PATH, encoding: 'base64', contents: original.toString('base64') };
  const wrong = await captureEvidence({ store, key, source: 'another/history.json', parserVersion: 'checked-in-history-v1', payload });
  await assert.rejects(retainedClubHistories(store, [wrong]), /Retained evidence cannot be validated/);
  const other = new LocalObjectStore(join(root, 'other'));
  const changed = await captureEvidence({ store: other, key, source: CHECKED_IN_HISTORY_PATH, parserVersion: 'checked-in-history-v1',
    payload: { ...payload, contents: Buffer.from('[]').toString('base64') } });
  await assert.rejects(retainedClubHistories(other, [changed]), /Retained evidence cannot be validated/);
  assert.notEqual(sha256(original), sha256(Buffer.from('[]')));
});

test('retained win-time manager link attributes a newly arrived Masters winner and closes its review task', async t => {
  const root = await mkdtemp(join(tmpdir(), 'archive-history-apply-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new LocalObjectStore(join(root, 'private'));
  const reset = configureEvidenceStore({ store, workspacePath: root }); t.after(reset);
  await captureEvidence({ store, key: importedEvidenceKey(CHECKED_IN_HISTORY_PATH, await reviewedHistory()),
    source: CHECKED_IN_HISTORY_PATH, parserVersion: 'checked-in-history-v1',
    payload: { path: CHECKED_IN_HISTORY_PATH, encoding: 'base64', contents: (await reviewedHistory()).toString('base64') } });
  const winner = { cupId: 183, leagueId: 0, season: 95, championTeamId: 820764, championTeamName: 'FC Wieselhausen',
    championUserId: null, championUserName: null, championLeagueId: null };
  mock(t, prisma.cup, 'findMany', async () => [{ cupId: 183, leagueId: 0 }]);
  mock(t, prisma.cupChampion, 'findMany', async () => [winner]);
  mock(t, prisma.leagueChampion, 'findMany', async () => []);
  const writes: unknown[] = [];
  const tasks: unknown[] = [];
  mock(t, prisma, '$transaction', async (run: (tx: object) => Promise<unknown>) => run({
    cupChampion: { updateMany: async (args: unknown) => { writes.push(args); return { count: 1 }; } },
    hattrickUser: { upsert: async () => ({}) },
  }));
  mock(t, prisma.updateItem, 'updateMany', async (args: unknown) => { tasks.push(args); return { count: 1 }; });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network request is allowed'); });
  const result = await replayRetainedClubHistories(store, evidenceReferences(), new Date('2026-09-26T12:00:00.000Z'));
  assert.equal(result.applied, 1);
  assert.equal(result.attributionTasksCompleted, 1);
  assert.equal(writes.length, 1);
  assert.deepEqual((writes[0] as { data: object }).data, { championUserId: 13557250,
    championUserName: 'WitzigesWiesel', championTeamId: 820764 });
  assert.deepEqual((tasks[0] as { where: object }).where, {
    sourceKey: 'cup:183', itemKey: '95', task: 'attribution', state: { not: 'complete' },
  });
});

function bulkBody(userId = 11687578) {
  const header = { format: 'hattrick-cup-history-v1', capturedAt: '2026-09-26T12:00:00.000Z', page: 1,
    sourceURLTemplate: 'https://www.hattrick.org/en/Club/History/?teamId={teamId}', hrefPrefix: '/en' };
  return Buffer.from(`${JSON.stringify(header)}\n${JSON.stringify([7, 88, 1726060, '27-08-2024', 0,
    'Re Picante', 'Coppa Italia', 'SebasM', userId, 88])}\n`);
}

test('bulk JSONL is retained by byte hash, replayed from accepted references, and closes only exact tasks', async t => {
  const root = await mkdtemp(join(tmpdir(), 'archive-bulk-history-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = join(root, 'checkout');
  const path = join(checkout, BULK_HISTORY_PATH);
  await mkdir(join(checkout, 'server/src/data'), { recursive: true });
  const body = bulkBody();
  await writeFile(path, body);
  const store = new LocalObjectStore(join(root, 'private'));
  const reset = configureEvidenceStore({ store, workspacePath: root }); t.after(reset);
  const ref = await retainCheckedInBulkClubHistory(store, checkout);
  assert.equal(ref.key, importedEvidenceKey(BULK_HISTORY_PATH, body));
  assert.equal((await retainedBulkClubHistories(store, [])).batch, null);
  const retained = await retainedBulkClubHistories(store, evidenceReferences());
  assert.equal(retained.captures, 1);
  assert.equal(retained.batch?.captures.length, 1);
  const winner = { cupId: 7, season: 88, leagueId: 4, championTeamId: 1726060,
    championTeamName: 'Re Picante', championUserId: null as number | null, championUserName: null as string | null };
  const writes: unknown[] = [];
  mock(t, prisma, '$transaction', async (run: (tx: object) => Promise<unknown>) => run({
    cupChampion: {
      findUnique: async () => winner,
      updateMany: async (args: { data: { championUserId: number; championUserName: string } }) => {
        writes.push(args); Object.assign(winner, args.data); return { count: 1 };
      },
    },
    hattrickUser: { upsert: async () => ({ loginName: 'SebasM' }) },
  }));
  const tasks: unknown[] = [];
  mock(t, prisma.updateItem, 'updateMany', async (args: unknown) => { tasks.push(args); return { count: 1 }; });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network request is allowed'); });
  const first = await replayRetainedBulkClubHistories(store, evidenceReferences(), new Date('2026-09-26T12:00:00.000Z'));
  assert.deepEqual(first, { captures: 1, targets: 1, applied: 1, unchanged: 0,
    unresolved: 0, missingRows: 0, attributionTasksCompleted: 1 });
  assert.equal(writes.length, 1);
  assert.deepEqual((tasks[0] as { where: object }).where, {
    sourceKey: 'cup:7', itemKey: '88', task: 'attribution', state: { not: 'complete' },
  });
  const second = await replayRetainedBulkClubHistories(store, evidenceReferences());
  assert.equal(second.applied, 0);
  assert.equal(second.unchanged, 1);
  assert.equal(writes.length, 1);
  await writeFile(path, Buffer.concat([body, Buffer.from('\n')]));
  const changedBytes = await retainCheckedInBulkClubHistory(store, checkout);
  assert.notEqual(changedBytes.key, ref.key);
  assert.ok(await store.get(ref.key));
  assert.equal((await retainedBulkClubHistories(store, evidenceReferences())).captures, 2);
  assert.equal((await retainedBulkClubHistories(store, evidenceReferences())).batch?.captures.length, 1);
});

test('bulk retention rejects malformed links and contradictory amended manager claims before replay', async t => {
  const root = await mkdtemp(join(tmpdir(), 'archive-bulk-history-conflict-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = join(root, 'checkout');
  const path = join(checkout, BULK_HISTORY_PATH);
  await mkdir(join(checkout, 'server/src/data'), { recursive: true });
  const store = new LocalObjectStore(join(root, 'private'));
  const reset = configureEvidenceStore({ store, workspacePath: root }); t.after(reset);
  await writeFile(path, Buffer.from(`${JSON.stringify({ format: 'hattrick-cup-history-v1',
    capturedAt: '2026-09-26T12:00:00.000Z', page: 1,
    sourceURLTemplate: 'https://www.hattrick.org/en/Club/History/?teamId={teamId}', hrefPrefix: '/en' })}\n${JSON.stringify({
    status: 'linked', cupId: 7, season: 88, teamId: 1726060, teamName: 'Re Picante', page: 1,
    sourceURL: 'https://www.hattrick.org/en/Club/History/?teamId=1726060', winDate: '2024-08-27',
    row: { text: '27-08-2024 In season 88, Re Picante emerged victorious from Coppa Italia. They were managed by SebasM.',
      links: [{ text: 'Coppa Italia', href: '/en/World/Cup/Cup.aspx?CupID=7' }] },
  })}\n`));
  await assert.rejects(retainCheckedInBulkClubHistory(store, checkout), /Retained evidence cannot be validated/);
  await writeFile(path, bulkBody());
  await retainCheckedInBulkClubHistory(store, checkout);
  await writeFile(path, bulkBody(11687579));
  await retainCheckedInBulkClubHistory(store, checkout);
  await assert.rejects(retainedBulkClubHistories(store, evidenceReferences()), /Retained evidence cannot be validated/);
});
