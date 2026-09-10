import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, type TestContext } from 'node:test';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { prisma } from '../db/client.js';
import { syncMasters } from './masters.js';
import { refreshLatestChampions } from './refreshLatest.js';

const token = { token: 'test-token', tokenSecret: 'test-secret' };
const captured = new XMLParser({ ignoreAttributes: false }).parse(readFileSync(new URL('../../samples/cupmatches-1.2.xml', import.meta.url), 'utf8'));

// The real orchestrators, cup sync and resolver run below; only external DB/HTTP effects are mocked.
function stub(t: TestContext, target: object, method: string, fn: (...args: any[]) => any) {
  const delegate = target as Record<string, unknown>;
  const original = delegate[method];
  const replacement = t.mock.fn(fn);
  delegate[method] = replacement;
  t.after(() => { delegate[method] = original; });
  return replacement;
}

function finalFixture(t: TestContext, cupId: number, stored = false) {
  const cup = { cupId, cupName: cupId === 183 ? 'Hattrick Masters' : 'Coppa Italia', countryName: 'Italy', currentSeason: 1 };
  const matchId = 902007183;
  const raw = structuredClone(captured);
  Object.assign(raw.HattrickData.Cup, { CupID: cupId, CupSeason: 1, CupRound: 1, CupName: cup.cupName });
  Object.assign(raw.HattrickData.Cup.Match, { MatchID: matchId, HomeTeamName: 'Home finalist', AwayTeamName: 'Away finalist' });
  Object.assign(raw.HattrickData.Cup.Match.MatchResult, { HomeGoals: 0, AwayGoals: 0 });
  const xml = new XMLBuilder({ ignoreAttributes: false }).build(raw);
  const request = t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    assert.equal(new URL(String(input)).searchParams.get('file'), 'cupmatches', 'Archived final details must never be re-fetched');
    return new Response(xml);
  });
  stub(t, prisma.cup, 'upsert', async () => cup);
  stub(t, prisma.cup, 'findUnique', async () => cup);
  stub(t, prisma.cup, 'findMany', async () => [cup]);
  stub(t, prisma.nationalLeague, 'findMany', async () => []);
  stub(t, prisma.cupChampion, 'findUnique', async () => stored ? { finalMatchId: matchId, championUserId: 0 } : null);
  stub(t, prisma.cupChampion, 'findMany', async () => []);
  stub(t, prisma.cupChampion, 'findFirst', async () => null);
  stub(t, prisma.match, 'findUnique', async () => ({ matchId, matchType: cupId === 183 ? 7 : 3,
    homeTeamId: 100, awayTeamId: 200, homeTeamName: 'Home finalist', awayTeamName: 'Away finalist', homeGoals: 0, awayGoals: 0 }));
  stub(t, prisma.matchDetail, 'findUnique', async () => null);
  const create = stub(t, prisma.cupChampion, 'create', async () => { throw new Error('An unresolved final must not create a champion'); });
  const update = stub(t, prisma.cupChampion, 'updateMany', async () => { throw new Error('An unresolved final must not update a champion'); });
  const warnings = t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'log', () => {});
  return { cup, matchId, request, create, update, warnings };
}

test('Masters exposes and warns about an unresolved final even when it added no champions', async t => {
  const f = finalFixture(t, 183);
  const result = await syncMasters(token, { currentSeason: 1 });
  assert.equal(result.seasonsStored, 0);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0]!.season, 1);
  assert.equal(result.issues[0]!.matchId, f.matchId);
  assert.match(result.issues[0]!.reason, /no retained winner events/);
  assert.equal(f.warnings.mock.callCount(), 1);
  assert.match(String(f.warnings.mock.calls[0]!.arguments[0]), /Hattrick Masters \(cup 183\) S1 match 902007183: unresolved/);
  assert.equal(f.request.mock.callCount(), 1);
  assert.equal(f.create.mock.callCount() + f.update.mock.callCount(), 0);
});

test('normal latest refresh retains competition context and logs a final it could not resolve', async t => {
  const f = finalFixture(t, 7);
  const result = await refreshLatestChampions(token, { onlyLeagueIds: [4], lookback: 1 });
  assert.equal(result.cupChampionsAdded, 0);
  assert.equal(result.cupIssues.length, 1);
  const issue = result.cupIssues[0]!;
  assert.equal(issue.cupId, 7); assert.equal(issue.cupName, 'Coppa Italia'); assert.equal(issue.countryName, 'Italy');
  assert.equal(issue.season, 1); assert.equal(issue.matchId, f.matchId);
  assert.match(issue.reason, /no retained winner events/);
  assert.equal(f.warnings.mock.callCount(), 1);
  assert.match(String(f.warnings.mock.calls[0]!.arguments[0]), /Italy Coppa Italia \(cup 7\) S1 match 902007183: unresolved/);
  assert.equal(f.request.mock.callCount(), 1);
  assert.equal(f.create.mock.callCount() + f.update.mock.callCount(), 0);
});

test('an already stored final reports an empty issue list without a warning or HTTP request', async t => {
  const f = finalFixture(t, 183, true);
  const result = await syncMasters(token, { currentSeason: 1 });
  assert.deepEqual(result.issues, []);
  assert.equal(f.warnings.mock.callCount(), 0);
  assert.equal(f.request.mock.callCount(), 0);
  assert.equal(f.create.mock.callCount() + f.update.mock.callCount(), 0);
});

test('a full latest refresh visits domestic cups and Masters while leaving seasonal history to its own importer', async t => {
  const registry = [
    { cupId: 7, leagueId: 4, cupName: 'Coppa Italia', countryName: 'Italy', currentSeason: 1 },
    { cupId: 183, leagueId: 0, cupName: 'Hattrick Masters', countryName: 'Hattrick Masters', currentSeason: 1 },
    { cupId: 2108472, leagueId: 0, cupName: 'Supporter Week Trophy', countryName: 'Supporter Week Trophy', currentSeason: 1 },
  ];
  const matches = (row: Record<string, any>, where: Record<string, any>): boolean => Object.entries(where).every(([key, value]) =>
    key === 'OR' ? value.some((branch: Record<string, any>) => matches(row, branch))
      : typeof value === 'object' && 'not' in value ? row[key] !== value.not
      : typeof value === 'object' && 'in' in value ? value.in.includes(row[key])
      : row[key] === value);
  stub(t, prisma.nationalLeague, 'findMany', async () => []);
  stub(t, prisma.cup, 'findMany', async args => registry.filter(row => matches(row, args.where)));
  const visited: number[] = [];
  stub(t, prisma.cup, 'findUnique', async args => { visited.push(args.where.cupId); return registry.find(row => row.cupId === args.where.cupId); });
  stub(t, prisma.cupChampion, 'findUnique', async () => ({ finalMatchId: 12345, championUserId: null }));
  stub(t, prisma.cupChampion, 'findMany', async () => []);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Stored finals and seasonal histories must not cause HTTP requests'); });
  const warnings = t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'log', () => {});
  const result = await refreshLatestChampions(token);
  assert.deepEqual(visited.sort((a, b) => a - b), [7, 183]);
  assert.deepEqual(result.cupIssues, []);
  assert.equal(warnings.mock.callCount(), 0);
});
