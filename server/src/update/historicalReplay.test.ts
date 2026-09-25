import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { prisma } from '../db/client.js';
import { captureEvidence, configureEvidenceStore, evidenceReferences, importedEvidenceKey } from './evidence.js';
import { CHECKED_IN_HISTORY_PATH, replayRetainedClubHistories, retainCheckedInClubHistory, retainedClubHistories } from './historicalReplay.js';
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
