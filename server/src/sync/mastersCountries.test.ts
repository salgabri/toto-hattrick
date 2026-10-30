import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, type TestContext } from 'node:test';
import { XMLParser } from 'fast-xml-parser';
import { prisma } from '../db/client.js';
import { configureChppRuntime } from '../chpp/client.js';
import { isDeletedTeamDetails } from '../schemas/index.js';
import { dueMastersCountryTasks, mastersCountryQuota, MastersCountryEvidenceError,
  reconcileMastersCountryTasks, resolveMastersCountryTask } from './mastersCountries.js';

const token = { token: 'test-token', tokenSecret: 'test-secret' };
const teamDetailsXml = readFileSync(new URL('../../samples/teamdetails.xml', import.meta.url), 'utf8');
// Real CHPP response for the deleted S38 champion Hackers United (teamID 54696).
const deletedTeamXml = readFileSync(new URL('../../samples/teamdetails-3.6-deleted-team.xml', import.meta.url), 'utf8');
const at = new Date('2026-09-13T05:17:00.000Z');

type Row = Record<string, any>;

function stub(t: TestContext, target: object, method: string, implementation: (...args: any[]) => any) {
  const object = target as Record<string, any>;
  const original = object[method];
  object[method] = implementation;
  t.after(() => { object[method] = original; });
}

function fakeArchive(t: TestContext, champions: Row[], initialTasks: Row[] = []) {
  const sources: Row[] = [{ sourceKey: 'cup:183' }];
  const tasks: Row[] = initialTasks.map((task, index) => ({ id: index + 1, sourceKey: 'cup:183', task: 'country',
    itemKey: String(task.edition), state: 'pending', attempts: 0, nextAttemptAt: null, completedAt: null,
    lastError: null, errorCategory: null, createdAt: at, ...task }));
  let nextId = tasks.length + 1;
  const taskFor = (where: Row) => {
    if (where.id !== undefined) return tasks.find(task => task.id === where.id);
    const key = where.sourceKey_itemKey_task;
    return tasks.find(task => task.sourceKey === key.sourceKey && task.itemKey === key.itemKey && task.task === key.task);
  };
  const apply = (row: Row, data: Row) => {
    for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value
      ? (row[key] ?? 0) + value.increment : value;
    return row;
  };

  stub(t, prisma.updateSource, 'findUnique', async ({ where }: Row) => sources.find(source => source.sourceKey === where.sourceKey) ?? null);
  stub(t, prisma.cupChampion, 'findMany', async () => [...champions].sort((a, b) => b.season - a.season));
  stub(t, prisma.cupChampion, 'findUnique', async ({ where }: Row) => {
    const key = where.cupId_season;
    return champions.find(row => row.cupId === key.cupId && row.season === key.season) ?? null;
  });
  stub(t, prisma.cupChampion, 'updateMany', async ({ where, data }: Row) => {
    const found = champions.filter(row => row.cupId === where.cupId && row.season === where.season &&
      row.championTeamId === where.championTeamId && row.championLeagueId === where.championLeagueId);
    found.forEach(row => apply(row, data));
    return { count: found.length };
  });
  stub(t, prisma.updateItem, 'findUnique', async ({ where }: Row) => taskFor(where) ?? null);
  stub(t, prisma.updateItem, 'create', async ({ data }: Row) => {
    const row = { id: nextId++, attempts: 0, nextAttemptAt: null, completedAt: null, lastError: null,
      errorCategory: null, createdAt: at, ...data };
    tasks.push(row); return row;
  });
  stub(t, prisma.updateItem, 'upsert', async ({ where, create, update }: Row) => {
    const row = taskFor(where);
    if (row) return apply(row, update);
    const made = { id: nextId++, attempts: 0, nextAttemptAt: null, completedAt: null, lastError: null,
      errorCategory: null, createdAt: at, ...create };
    tasks.push(made); return made;
  });
  stub(t, prisma.updateItem, 'update', async ({ where, data }: Row) => {
    const row = taskFor(where); assert.ok(row); return apply(row, data);
  });
  stub(t, prisma.updateItem, 'findMany', async ({ where, take }: Row) => tasks
    .filter(task => task.sourceKey === where.sourceKey && task.task === where.task && where.state.in.includes(task.state) &&
      (task.nextAttemptAt === null || task.nextAttemptAt <= where.OR[1].nextAttemptAt.lte))
    .sort((a, b) => b.edition - a.edition || (a.nextAttemptAt?.getTime() ?? 0) - (b.nextAttemptAt?.getTime() ?? 0))
    .slice(0, take));
  return { champions, tasks };
}

test('reconciliation completes retained facts, preserves retry backoff, and reopens legacy sentinels only with an exact team id', async t => {
  const retryAt = new Date('2026-09-14T05:17:00.000Z');
  const db = fakeArchive(t, [
    { cupId: 183, season: 96, championTeamId: 2241372, championLeagueId: null },
    { cupId: 183, season: 95, championTeamId: 42, championLeagueId: 4 },
    { cupId: 183, season: 94, championTeamId: null, championLeagueId: null },
    { cupId: 183, season: 93, championTeamId: 2241372, championLeagueId: 0 },
  ], [{ edition: 96, state: 'retry', attempts: 2, nextAttemptAt: retryAt },
    { edition: 95, state: 'retry', lastError: 'old failure' },
    { edition: 93, state: 'complete', completedAt: at }]);

  const result = await reconcileMastersCountryTasks(at);
  assert.deepEqual(result, { complete: 1, pending: 2, needsReview: 1 });
  assert.equal(db.tasks.find(task => task.edition === 95)!.state, 'complete');
  assert.equal(db.tasks.find(task => task.edition === 95)!.lastError, null);
  assert.equal(db.tasks.find(task => task.edition === 96)!.state, 'retry');
  assert.equal(db.tasks.find(task => task.edition === 96)!.nextAttemptAt, retryAt, 'reconciliation must preserve transient backoff');
  assert.equal(db.tasks.find(task => task.edition === 94)!.state, 'needs_review');
  assert.equal(db.tasks.find(task => task.edition === 93)!.state, 'pending');

  const due = await dueMastersCountryTasks(at, 4);
  assert.deepEqual(due.map(task => task.edition), [93], 'a future retry is not made due early');
});

test('country resolution uses pinned official teamdetails for the exact champion id and never changes manager fields', async t => {
  const champion = { cupId: 183, season: 96, championTeamId: 2241372, championLeagueId: null,
    championUserId: 777, championUserName: 'Historical winner' };
  const db = fakeArchive(t, [champion]);
  await reconcileMastersCountryTasks(at);
  const task = (await dueMastersCountryTasks(at, 1))[0]!;
  const requests: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    requests.push(new URL(String(input)));
    return new Response(teamDetailsXml);
  });
  const runtime = configureChppRuntime({ maxCalls: 1, pacingMs: 0, maxRetries: 0 });
  t.after(runtime.dispose);

  assert.equal(await resolveMastersCountryTask(token, task, at), true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.searchParams.get('file'), 'teamdetails');
  assert.equal(requests[0]!.searchParams.get('version'), '3.6');
  assert.equal(requests[0]!.searchParams.get('teamID'), '2241372');
  assert.equal(champion.championLeagueId, 4);
  assert.equal(champion.championUserId, 777);
  assert.equal(champion.championUserName, 'Historical winner');
  assert.equal(db.tasks[0]!.state, 'complete');
});

test('a valid response without the exact club leaves country and manager untouched for review/retry handling', async t => {
  const champion = { cupId: 183, season: 96, championTeamId: 9999999, championLeagueId: null,
    championUserId: 777, championUserName: 'Historical winner' };
  const db = fakeArchive(t, [champion]);
  await reconcileMastersCountryTasks(at);
  t.mock.method(globalThis, 'fetch', async () => new Response(teamDetailsXml));
  const runtime = configureChppRuntime({ maxCalls: 1, pacingMs: 0, maxRetries: 0 });
  t.after(runtime.dispose);

  await assert.rejects(resolveMastersCountryTask(token, db.tasks[0]! as { id: number; sourceKey: string; task: string; edition: number }, at), MastersCountryEvidenceError);
  assert.equal(champion.championLeagueId, null);
  assert.equal(champion.championUserId, 777);
  assert.equal(champion.championUserName, 'Historical winner');
  assert.equal(db.tasks[0]!.state, 'pending');
});

test('only the captured deleted-club envelope is recognised as a deleted team', () => {
  const parse = (xml: string) => new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: true }).parse(xml);
  assert.equal(isDeletedTeamDetails(parse(deletedTeamXml)), true);
  assert.equal(isDeletedTeamDetails(parse(teamDetailsXml)), false);
  // Neither half of the shape is enough on its own, and a different endpoint/version never matches.
  assert.equal(isDeletedTeamDetails(parse(deletedTeamXml.replace('<UserID>0</UserID>', '<UserID>777</UserID>'))), false);
  assert.equal(isDeletedTeamDetails(parse(deletedTeamXml.replace('<Teams />', '<Teams><Team><TeamID>54696</TeamID></Team></Teams>'))), false);
  assert.equal(isDeletedTeamDetails(parse(deletedTeamXml.replace('<Version>3.6</Version>', '<Version>3.5</Version>'))), false);
  assert.equal(isDeletedTeamDetails(parse(deletedTeamXml.replace('teamdetails.xml', 'chpperror.xml'))), false);
});

test('a deleted champion club becomes a terminal evidence gap that reconciliation reopens only for a corrected team id', async t => {
  const champion = { cupId: 183, season: 38, championTeamId: 54696, championLeagueId: 0,
    championUserId: null, championUserName: null };
  const db = fakeArchive(t, [champion]);
  assert.deepEqual(await reconcileMastersCountryTasks(at), { complete: 0, pending: 1, needsReview: 0 });
  const requests: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    requests.push(new URL(String(input)));
    return new Response(deletedTeamXml);
  });
  const runtime = configureChppRuntime({ maxCalls: 1, pacingMs: 0, maxRetries: 0 });
  t.after(runtime.dispose);

  assert.equal(await resolveMastersCountryTask(token, (await dueMastersCountryTasks(at, 1))[0]!, at), false);
  assert.deepEqual(requests.map(url => url.searchParams.get('teamID')), ['54696']);
  const task = db.tasks[0]!;
  assert.equal(task.state, 'needs_review');
  assert.equal(task.errorCategory, 'team_deleted');
  assert.match(task.lastError, /champion club 54696 no longer exists/);
  assert.equal(task.nextAttemptAt, null);
  assert.deepEqual(champion, { cupId: 183, season: 38, championTeamId: 54696, championLeagueId: 0,
    championUserId: null, championUserName: null }, 'neither country nor manager is inferred');

  const later = new Date('2026-09-20T05:17:00.000Z');
  assert.deepEqual(await reconcileMastersCountryTasks(later), { complete: 0, pending: 0, needsReview: 1 });
  assert.equal(task.state, 'needs_review');
  assert.deepEqual(await dueMastersCountryTasks(later, 4), [], 'the same deleted club is never re-fetched');

  champion.championTeamId = 2241372;
  assert.deepEqual(await reconcileMastersCountryTasks(later), { complete: 0, pending: 1, needsReview: 0 });
  assert.deepEqual([task.state, task.errorCategory, task.lastError], ['pending', null, null]);
  assert.deepEqual((await dueMastersCountryTasks(later, 4)).map(item => item.edition), [38]);
});

test('the scheduler reserves a bounded country lane without consuming a zero-item run', () => {
  assert.equal(mastersCountryQuota(0), 0);
  assert.equal(mastersCountryQuota(1), 1);
  assert.equal(mastersCountryQuota(20), 1);
  assert.equal(mastersCountryQuota(60), 3);
  assert.equal(mastersCountryQuota(400), 4);
  assert.throws(() => mastersCountryQuota(-1), /Invalid scheduled item limit/);
});
