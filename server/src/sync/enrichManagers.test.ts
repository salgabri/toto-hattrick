import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, type TestContext } from 'node:test';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { enrichChampionManagers, enrichRecentCupManagers, resolveTeamOwner } from './enrichManagers.js';
import { backfillCups } from './backfillCups.js';
import { attributeByClub } from './attributeByClub.js';
import { syncMasters } from './masters.js';

// Run from server/: node --import tsx --test src/sync/enrichManagers.test.ts
// All HTTP and database operations below are mocked; no CHPP request or DB write is permitted.
const token = { token: 'test-token', tokenSecret: 'test-secret' };
const sample = await readFile(new URL('../../samples/teamdetails.xml', import.meta.url), 'utf8');
const botSample = sample.replace('<IsBot>False</IsBot>', '<IsBot>True</IsBot>');
const targetTeamId = 2241372;

function mockResponse(t: TestContext, xml = sample, status = 200) {
  return t.mock.method(globalThis, 'fetch', async () => new Response(xml, { status }));
}

// Prisma delegates expose methods through a Proxy, without the property descriptors required by
// node:test mock.method. Replace those methods explicitly and restore them after each test.
function mockDbMethod<T extends (...args: any[]) => unknown>(t: TestContext, delegate: object, method: string, fn: T) {
  const target = delegate as Record<string, unknown>;
  const original = target[method];
  const replacement = t.mock.fn(fn);
  target[method] = replacement;
  t.after(() => { target[method] = original; });
  return replacement;
}

test('resolves the requested secondary club from the captured multi-club response', async (t) => {
  mockResponse(t);
  assert.deepEqual(await resolveTeamOwner(token, 2344637), { userId: 9491504, loginName: 'TotoNovanta', isBot: false });
});

test('never falls back to another club when the requested team is absent', async (t) => {
  mockResponse(t);
  await assert.rejects(resolveTeamOwner(token, 999), /did not contain requested team 999/);
});

test('a confirmed bot does not mark its former multi-club manager as a bot', async (t) => {
  mockResponse(t, botSample);
  assert.equal(await resolveTeamOwner(token, targetTeamId), null);
  assert.deepEqual(await resolveTeamOwner(token, 2344637), { userId: 9491504, loginName: 'TotoNovanta', isBot: false });
});

test('network failures and HTTP quota/outage responses propagate for retries', async (t) => {
  for (const status of [401, 429, 503]) {
    await t.test(`HTTP ${status}`, async (child) => {
      mockResponse(child, 'Temporarily unavailable', status);
      await assert.rejects(resolveTeamOwner(token, targetTeamId), { name: 'ChppRequestError', status });
    });
  }
  await t.test('network rejection', async (child) => {
    child.mock.method(globalThis, 'fetch', async () => { throw new Error('network unavailable'); });
    await assert.rejects(resolveTeamOwner(token, targetTeamId), { name: 'ChppRequestError', category: 'network' });
  });
});

test('HTTP 200 HTML, incomplete XML, and missing-owner responses stay retryable', async (t) => {
  const invalidBodies = [
    '<html><body>Temporary service error</body></html>',
    '<HattrickData><FileName>teamdetails.xml</FileName></HattrickData>',
    sample.replace(/<User>[\s\S]*?<\/User>/, ''),
    sample.replace('<Loginname>TotoNovanta</Loginname>', '<Loginname></Loginname>'),
  ];
  for (let i = 0; i < invalidBodies.length; i++) {
    await t.test(`invalid response ${i + 1}`, async (child) => {
      mockResponse(child, invalidBodies[i]!);
      await assert.rejects(resolveTeamOwner(token, targetTeamId));
    });
  }
});

test('league enrichment leaves failures pending and a later run can resolve them', async (t) => {
  let attribution: number | null = null;
  let writes = 0;
  let shouldFail = true;
  t.mock.method(globalThis, 'fetch', async () => {
    if (shouldFail) throw new Error('network unavailable');
    return new Response(sample);
  });
  mockDbMethod(t, prisma.leagueChampion, 'findMany', async () => [{ championTeamId: targetTeamId }]);
  mockDbMethod(t, prisma.hattrickUser, 'upsert', async () => ({}));
  mockDbMethod(t, prisma.leagueChampion, 'updateMany', async (args: Prisma.LeagueChampionUpdateManyArgs) => {
    writes++;
    attribution = args!.data.championUserId as number;
    return { count: 1 };
  });

  assert.deepEqual(await enrichChampionManagers(token, { allowUnverifiedCurrentOwner: true }), { processed: 1, resolved: 0, errors: 1 });
  assert.equal(writes, 0);
  assert.equal(attribution, null);
  shouldFail = false;
  assert.deepEqual(await enrichChampionManagers(token, { allowUnverifiedCurrentOwner: true }), { processed: 1, resolved: 1, errors: 0 });
  assert.equal(attribution, 9491504);
});

test('league enrichment protects established historical owners for both resolved and bot clubs', async (t) => {
  for (const [label, xml, expected] of [['owner', sample, 9491504], ['bot', botSample, 0]] as const) {
    await t.test(label, async (child) => {
      mockResponse(child, xml);
      const rows = [{ championUserId: null as number | null }, { championUserId: 1234 }, { championUserId: 0 }];
      mockDbMethod(child, prisma.leagueChampion, 'findMany', async () => [{ championTeamId: targetTeamId }]);
      mockDbMethod(child, prisma.hattrickUser, 'upsert', async () => ({}));
      mockDbMethod(child, prisma.leagueChampion, 'updateMany', async (args: Prisma.LeagueChampionUpdateManyArgs) => {
        assert.equal(args!.where!.championTeamId, targetTeamId);
        assert.equal(args!.where!.championUserId, null);
        const pending = rows.filter((row) => row.championUserId === args!.where!.championUserId);
        for (const row of pending) row.championUserId = args!.data.championUserId as number;
        return { count: pending.length };
      });
      await enrichChampionManagers(token, { allowUnverifiedCurrentOwner: true });
      assert.deepEqual(rows.map((row) => row.championUserId), [expected, 1234, 0]);
    });
  }
});

test('a failed cup lookup stays pending and is requested only once per team per pass', async (t) => {
  const request = t.mock.method(globalThis, 'fetch', async () => { throw new Error('quota exhausted'); });
  mockDbMethod(t, prisma.cup, 'findMany', async () => [{ cupId: 1, currentSeason: 80 }]);
  mockDbMethod(t, prisma.cupChampion, 'findMany', async () => [
    { cupId: 1, season: 79, championTeamId: targetTeamId },
    { cupId: 1, season: 78, championTeamId: targetTeamId },
  ]);
  const write = mockDbMethod(t, prisma.cupChampion, 'updateMany', async () => { throw new Error('must not write on lookup failure'); });
  const oldWrite = mockDbMethod(t, prisma.cupChampion, 'update', async () => { throw new Error('must not write on lookup failure'); });
  assert.deepEqual(await enrichRecentCupManagers(token, { allowUnverifiedCurrentOwner: true }), { processed: 1, resolved: 0, errors: 1 });
  assert.equal(request.mock.callCount(), 1);
  assert.equal(write.mock.callCount(), 0);
  assert.equal(oldWrite.mock.callCount(), 0);
});

test('cup updates are scoped to the unresolved final even if attribution changed during the lookup', async (t) => {
  mockResponse(t);
  mockDbMethod(t, prisma.cup, 'findMany', async () => [{ cupId: 1, currentSeason: 80 }]);
  mockDbMethod(t, prisma.cupChampion, 'findMany', async () => [{ cupId: 1, season: 79, championTeamId: targetTeamId }]);
  mockDbMethod(t, prisma.hattrickUser, 'upsert', async () => ({}));
  mockDbMethod(t, prisma.cupChampion, 'updateMany', async (args: Prisma.CupChampionUpdateManyArgs) => {
    assert.deepEqual(args!.where, { cupId: 1, season: 79, championUserId: null });
    return { count: 0 }; // A historical attribution was filled after the initial pending read.
  });
  assert.deepEqual(await enrichRecentCupManagers(token, { allowUnverifiedCurrentOwner: true }), { processed: 1, resolved: 0, errors: 0 });
});

test('default enrichers and name bridge never query current owners or attribute old trophies', async (t) => {
  const request = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Current ownership is not historical evidence'); });
  const leagues = mockDbMethod(t, prisma.leagueChampion, 'findMany', async () => { throw new Error('Default heuristic must not run'); });
  const cups = mockDbMethod(t, prisma.cup, 'findMany', async () => { throw new Error('Default heuristic must not run'); });
  assert.deepEqual(await enrichChampionManagers(token), { processed: 0, resolved: 0, errors: 0 });
  assert.deepEqual(await enrichRecentCupManagers(token), { processed: 0, resolved: 0, errors: 0 });
  assert.deepEqual(await attributeByClub(), { cupFinals: 0, leagueTitles: 0, ambiguousClubs: 0, ambiguousRows: 0 });
  assert.equal(request.mock.callCount(), 0);
  assert.equal(leagues.mock.callCount(), 0);
  assert.equal(cups.mock.callCount(), 0);
});

test('explicit name-match opt-in retains the legacy approximation without enabling it by default', async (t) => {
  const donor = { leagueId: 4, championTeamName: 'Old club', championUserId: 123, championUserName: 'Known manager' };
  mockDbMethod(t, prisma.leagueChampion, 'findMany', async (args: { where: { championUserId: unknown } }) => args.where.championUserId === null ? [] : [donor]);
  mockDbMethod(t, prisma.cupChampion, 'findMany', async (args: { where: { championUserId: unknown } }) => args.where.championUserId === null ? [{ cupId: 7, season: 80, leagueId: 4, championTeamName: 'Old club' }] : []);
  const write = mockDbMethod(t, prisma.cupChampion, 'update', async (args: { data: { championUserId: number } }) => {
    assert.equal(args.data.championUserId, 123);
    return {};
  });
  assert.deepEqual(await attributeByClub({ allowUnverifiedNameMatch: true }), { cupFinals: 1, leagueTitles: 0, ambiguousClubs: 0, ambiguousRows: 0 });
  assert.equal(write.mock.callCount(), 1);
});

test('cup backfill materialization defaults to no owner approximation, while explicit opt-in still works', async (t) => {
  const request = mockResponse(t);
  mockDbMethod(t, prisma.cup, 'findMany', async () => [{ cupId: 7 }]);
  mockDbMethod(t, prisma.cupChampion, 'findMany', async () => [{ cupId: 7, season: 80, finalMatchId: 123, championTeamId: targetTeamId, homeGoals: 2, awayGoals: 1 }]);
  mockDbMethod(t, prisma.cupChampion, 'count', async () => 1);
  mockDbMethod(t, prisma.hattrickUser, 'upsert', async () => ({}));
  const write = mockDbMethod(t, prisma.cupChampion, 'update', async () => ({}));
  const normal = await backfillCups(token, { pacingMs: 0 });
  assert.equal(normal.calls, 0);
  assert.equal(normal.attributed, 0);
  assert.equal(write.mock.callCount(), 0);
  const optedIn = await backfillCups(token, { pacingMs: 0, attributeOwners: true });
  assert.equal(optedIn.attributed, 1);
  assert.equal(request.mock.callCount(), 1);
  assert.equal(write.mock.callCount(), 1);
});

test('Masters sync keeps stored facts and unknown sentinels without current-owner lookups by default', async (t) => {
  const request = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Stored finals must not be re-fetched'); });
  mockDbMethod(t, prisma.cup, 'upsert', async () => ({}));
  mockDbMethod(t, prisma.cup, 'findUnique', async () => ({ currentSeason: 1, cupName: 'Hattrick Masters' }));
  mockDbMethod(t, prisma.cupChampion, 'findUnique', async () => ({ finalMatchId: 123, championUserId: 0 }));
  mockDbMethod(t, prisma.cupChampion, 'findMany', async () => []);
  const write = mockDbMethod(t, prisma.cupChampion, 'updateMany', async () => { throw new Error('Do not reopen unknown sentinels'); });
  const result = await syncMasters(token, { currentSeason: 1 });
  assert.equal(result.seasonsStored, 0);
  assert.equal(request.mock.callCount(), 0);
  assert.equal(write.mock.callCount(), 0);
});
