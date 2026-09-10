import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, type TestContext } from 'node:test';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { backfillCups } from './backfillCups.js';

const token = { token: 'test-token', tokenSecret: 'test-secret' };
const cupXML = await readFile(new URL('../../samples/cupmatches-1.2.xml', import.meta.url), 'utf8');
const matchXML = (await readFile(new URL('../../samples/matchdetails.xml', import.meta.url), 'utf8'))
  .replace('<MatchID>761952861</MatchID>', '<MatchID>747054745</MatchID>')
  .replace('<HomeTeamName>Panormus 2024</HomeTeamName>', '<HomeTeamName>Real Pignola</HomeTeamName>')
  .replace('<AwayTeamName>FC Parmareggio</AwayTeamName>', '<AwayTeamName>milantriste</AwayTeamName>')
  .replace('<HomeGoals>5</HomeGoals>', '<HomeGoals>2</HomeGoals>')
  .replace('<AwayGoals>2</AwayGoals>', '<AwayGoals>1</AwayGoals>');
const final = () => ({ cupId: 7, season: 90, finalMatchId: 0, championTeamId: null as number | null, championTeamName: 'Real Pignola', homeGoals: 0, awayGoals: 0 });
const storedMatch = () => ({ matchId: 747054745, homeTeamId: 2241372, homeTeamName: 'Real Pignola', awayTeamId: 2554706, awayTeamName: 'milantriste', homeGoals: 2, awayGoals: 1 });
function mockMethod<T extends (...args: any[]) => unknown>(t: TestContext, delegate: object, method: string, fn: T) {
  const object = delegate as Record<string, unknown>;
  const original = object[method];
  const replacement = t.mock.fn(fn);
  object[method] = replacement;
  t.after(() => { object[method] = original; });
  return replacement;
}
function setup(t: TestContext, rows = [final()]) {
  mockMethod(t, prisma.cup, 'findMany', async () => [{ cupId: 7, currentSeason: 95 }]);
  mockMethod(t, prisma.cupChampion, 'findMany', async () => rows);
  mockMethod(t, prisma.cupChampion, 'count', async () => rows.length);
  mockMethod(t, prisma.match, 'findUnique', async () => null);
  mockMethod(t, prisma.matchDetail, 'findUnique', async () => null);
  mockMethod(t, prisma.hattrickUser, 'upsert', async () => { throw new Error('Facts-only job must not create managers'); });
  const writes: Prisma.CupChampionUpdateManyArgs[] = [];
  mockMethod(t, prisma.cupChampion, 'updateMany', async (args: Prisma.CupChampionUpdateManyArgs) => { writes.push(args); return { count: 1 }; });
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const file = new URL(String(input)).searchParams.get('file')!;
    calls.push(file);
    if (file !== 'cupmatches' && file !== 'matchdetails') throw new Error('Unexpected CHPP file');
    return new Response(file === 'cupmatches' ? cupXML : matchXML);
  });
  return { writes, calls };
}

test('facts-only backfill validates the sampled final before filling match and team IDs', async (t) => {
  const { writes, calls } = setup(t);
  const result = await backfillCups(token, { pacingMs: 0 });
  assert.equal(result.materialized, 1);
  assert.equal(result.teamIdsResolved, 1);
  assert.equal(result.attributed, 0);
  assert.deepEqual(calls, ['cupmatches', 'matchdetails']);
  assert.equal(writes[0]!.data.finalMatchId, 747054745);
  assert.equal(writes[1]!.data.championTeamId, 2241372);
  assert.ok(writes.every((write) => write.where?.championUserId === null));
  assert.ok(writes.every((write) => !('championUserId' in write.data)));
});

test('recent main/exact-final filters use each cup local season and intersect requested keys', async (t) => {
  const { calls } = setup(t, []);
  mockMethod(t, prisma.cup, 'findMany', async (args: Prisma.CupFindManyArgs) => {
    assert.deepEqual(args.where, { isMain: true, cupId: { in: [7, 1433] } });
    return [{ cupId: 7, currentSeason: 95 }, { cupId: 1433, currentSeason: 32 }];
  });
  const queries: Prisma.CupChampionFindManyArgs[] = [];
  mockMethod(t, prisma.cupChampion, 'findMany', async (args: Prisma.CupChampionFindManyArgs) => { queries.push(args); return []; });
  await backfillCups(token, { pacingMs: 0, lookbackSeasons: 6, onlyMain: true, onlyFinals: [{ cupId: 7, season: 90 }, { cupId: 1433, season: 29 }] });
  assert.deepEqual(queries.map((query) => query.where), [
    { cupId: 7, championUserId: null, season: { gte: 89, lte: 95, in: [90] } },
    { cupId: 1433, championUserId: null, season: { gte: 26, lte: 32, in: [29] } },
  ]);
  assert.equal(calls.length, 0);
});

test('unknown current season and explicit empty selection cannot expand into full history', async (t) => {
  const { calls } = setup(t);
  mockMethod(t, prisma.cup, 'findMany', async () => [{ cupId: 7, currentSeason: null }]);
  const recent = await backfillCups(token, { pacingMs: 0, lookbackSeasons: 6 });
  assert.equal(recent.issues.length, 1);
  await backfillCups(token, { pacingMs: 0, onlyFinals: [] });
  assert.equal(calls.length, 0);
});

test('mismatching fetched cup/season or winner name never overwrites an archived winner', async (t) => {
  for (const row of [{ ...final(), cupId: 8 }, { ...final(), season: 89 }, { ...final(), championTeamName: 'A different historical club' }]) {
    await t.test(JSON.stringify([row.cupId, row.season, row.championTeamName]), async (child) => {
      const { writes, calls } = setup(child, [row]);
      const result = await backfillCups(token, { pacingMs: 0 });
      assert.equal(result.materialized, 0);
      assert.equal(result.issues.length, 1);
      assert.equal(writes.length, 0);
      assert.deepEqual(calls, ['cupmatches']);
    });
  }
});

test('stored match facts resolve a cup winner without fetching the match again', async (t) => {
  const { writes, calls } = setup(t, [{ ...final(), finalMatchId: 747054745, homeGoals: 2, awayGoals: 1 }]);
  mockMethod(t, prisma.match, 'findUnique', async () => storedMatch());
  const result = await backfillCups(token, { pacingMs: 0 });
  assert.equal(result.storedMatchesReused, 1);
  assert.equal(result.teamIdsResolved, 1);
  assert.equal(calls.length, 0);
  assert.equal(writes.length, 1);
});

test('already-stored but inconsistent matches and bare detail markers are skipped without re-fetching', async (t) => {
  for (const markerOnly of [false, true]) {
    await t.test(markerOnly ? 'bare MatchDetail' : 'conflicting Match', async (child) => {
      const { writes, calls } = setup(child, [{ ...final(), finalMatchId: 747054745, homeGoals: 2, awayGoals: 1 }]);
      mockMethod(child, prisma.match, 'findUnique', async () => markerOnly ? null : { ...storedMatch(), homeGoals: 7 });
      mockMethod(child, prisma.matchDetail, 'findUnique', async () => markerOnly ? { matchId: 747054745 } : null);
      const result = await backfillCups(token, { pacingMs: 0 });
      assert.equal(result.issues.length, 1);
      assert.equal(calls.length, 0);
      assert.equal(writes.length, 0);
    });
  }
});

test('a cached match can complete phase 2 after phase 1 uses the final allowed API call', async (t) => {
  const { calls } = setup(t);
  mockMethod(t, prisma.match, 'findUnique', async () => storedMatch());
  const result = await backfillCups(token, { pacingMs: 0, maxCalls: 1 });
  assert.equal(result.calls, 1);
  assert.equal(result.teamIdsResolved, 1);
  assert.deepEqual(calls, ['cupmatches']);
});

test('concurrent winner change prevents fact overwrite and subsequent detail fetch', async (t) => {
  const { calls } = setup(t);
  mockMethod(t, prisma.cupChampion, 'updateMany', async () => ({ count: 0 }));
  const result = await backfillCups(token, { pacingMs: 0 });
  assert.equal(result.materialized, 0);
  assert.equal(result.issues.length, 1);
  assert.deepEqual(calls, ['cupmatches']);
});
