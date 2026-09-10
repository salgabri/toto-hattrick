import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import Fastify from 'fastify';
import { prisma } from '../db/client.js';
import { registerReadRoutes } from './read.js';

// Prisma delegates are proxies, so replace/restore methods explicitly. No test opens the
// production database or needs CHPP credentials; every reachable database operation is stubbed.
function mockDb(t: TestContext, delegate: object, method: string, fn: (...args: any[]) => unknown) {
  const target = delegate as Record<string, unknown>;
  const original = target[method];
  const replacement = t.mock.fn(fn);
  target[method] = replacement;
  t.after(() => { target[method] = original; });
  return replacement;
}

async function fixture(t: TestContext) {
  const app = Fastify({ logger: false });
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Read route tests must not request the network'); });
  await registerReadRoutes(app);
  t.after(() => app.close());
  return app;
}

const malformedIntegers = ['abc', 'NaN', 'Infinity', '1.5', '-1', '0', '9007199254740992', '1e2', '0x10', ' 1', '1 ', '01', '+1', '1_000'];

test('every numeric path rejects malformed, fractional, nonpositive and unsafe IDs before querying Prisma', async (t) => {
  const app = await fixture(t);
  const reads = [
    [prisma.match, 'findMany'], [prisma.match, 'findUnique'], [prisma.seasonStanding, 'findFirst'],
    [prisma.leagueChampion, 'findMany'], [prisma.hattrickUser, 'findUnique'],
  ].map(([delegate, method]) => mockDb(t, delegate as object, method as string, () => { throw new Error('Invalid input reached Prisma'); }));
  for (const template of ['/api/seasons/{id}/matches', '/api/matches/{id}', '/api/teams/{id}/summary', '/api/seasons/{id}/standings', '/api/national/leagues/{id}/champions', '/api/national/seasons/{id}', '/api/users/{id}']) {
    await t.test(template, async () => {
      for (const input of malformedIntegers) {
        const response = await app.inject({ url: template.replace('{id}', encodeURIComponent(input)) });
        assert.equal(response.statusCode, 400, `${template}: ${input}`);
        assert.equal(response.json().error, 'invalid parameter');
        assert.doesNotMatch(response.body, /prisma|findMany|findUnique|server[\\/]|SELECT|Invalid input reached/i);
      }
    });
  }
  for (const read of reads) assert.equal(read.mock.callCount(), 0);
});

test('valid positive decimal IDs retain exact values up to the safe-integer boundary', async (t) => {
  const app = await fixture(t);
  const read = mockDb(t, prisma.leagueChampion, 'findMany', async () => []);
  for (const id of [1, 46, 2147483647, Number.MAX_SAFE_INTEGER]) {
    const response = await app.inject({ url: `/api/national/leagues/${id}/champions` });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), []);
    assert.deepEqual(read.mock.calls.at(-1)?.arguments, [{ where: { leagueId: id }, orderBy: { season: 'desc' } }]);
  }
});

test('leaderboard rejects invalid limits and repeated query values without database access', async (t) => {
  const app = await fixture(t);
  const grouped = mockDb(t, prisma.leagueChampion, 'groupBy', () => { throw new Error('Invalid input reached Prisma'); });
  const users = mockDb(t, prisma.hattrickUser, 'findMany', () => { throw new Error('Invalid input reached Prisma'); });
  for (const query of [
    ...malformedIntegers.map((value) => `limit=${encodeURIComponent(value)}`),
    'limit=', 'limit=1&limit=2', 'nationality=Italia&nationality=Schweiz',
  ]) {
    const response = await app.inject({ url: `/api/users/leaderboard?${query}` });
    assert.equal(response.statusCode, 400, query);
    assert.equal(response.json().error, 'invalid query');
    assert.doesNotMatch(response.body, /prisma|groupBy|findMany|server[\\/]|SELECT|Invalid input reached/i);
  }
  assert.equal(grouped.mock.callCount(), 0);
  assert.equal(users.mock.callCount(), 0);
});

test('leaderboard keeps the default, positive limits, descending ranking and maximum-200 cap', async (t) => {
  const app = await fixture(t);
  const grouped = mockDb(t, prisma.leagueChampion, 'groupBy', async () => [{ championUserId: 42, _count: { _all: 33 } }]);
  mockDb(t, prisma.hattrickUser, 'findMany', async () => [{ userId: 42, loginName: 'Known winner', nationality: 'Schweiz' }]);
  for (const [query, expectedTake] of [['', 50], ['?limit=1', 1], ['?limit=2', 2], ['?limit=200', 200], ['?limit=201', 200], ['?limit=1000', 200], [`?limit=${Number.MAX_SAFE_INTEGER}`, 200]] as const) {
    const response = await app.inject({ url: `/api/users/leaderboard${query}` });
    assert.equal(response.statusCode, 200, query);
    assert.deepEqual(response.json(), [{ userId: 42, userName: 'Known winner', nationality: 'Schweiz', titles: 33 }]);
    assert.deepEqual(grouped.mock.calls.at(-1)?.arguments, [{
      by: ['championUserId'], where: { complete: true, championUserId: { gt: 0 } },
      _count: { _all: true }, orderBy: { _count: { championUserId: 'desc' } }, take: expectedTake,
    }]);
  }
});

test('leaderboard nationality remains a literal string and scopes the count to its matching managers', async (t) => {
  const app = await fixture(t);
  const users = mockDb(t, prisma.hattrickUser, 'findMany', async () => [{ userId: 42, loginName: 'Known winner', nationality: 'Côte d’Ivoire' }]);
  const grouped = mockDb(t, prisma.leagueChampion, 'groupBy', async () => [{ championUserId: 42, _count: { _all: 2 } }]);
  const response = await app.inject({ url: `/api/users/leaderboard?nationality=${encodeURIComponent('Côte d’Ivoire')}` });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(users.mock.calls[0]?.arguments, [{ where: { nationality: 'Côte d’Ivoire' }, select: { userId: true } }]);
  assert.deepEqual((grouped.mock.calls[0]?.arguments[0] as { where: unknown }).where, { complete: true, championUserId: { in: [42] } });
  assert.equal(response.json()[0].titles, 2);
});

const champion = (overrides: Record<string, unknown> = {}) => ({
  leagueId: 46, countryName: 'Switzerland', season: 81, championTeamId: 7,
  championTeamName: 'Historic winner', championUserId: 42, championUserName: 'Known winner',
  points: 35, played: 14, complete: true, ...overrides,
});

test('winner-only reconstruction exposes unavailable facts as null without erasing genuine zero statistics', async (t) => {
  const app = await fixture(t);
  const stored = [
    champion({ championTeamId: 0, points: 0, played: 0 }),
    champion({ points: 0, played: 14 }),
    champion({ complete: false, points: 0, played: 0 }),
    champion({ championTeamId: 0 }),
    champion({ points: 0, played: 0 }),
  ];
  const before = structuredClone(stored);
  mockDb(t, prisma.leagueChampion, 'findMany', async () => stored);
  const response = await app.inject({ url: '/api/national/leagues/46/champions' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().map((r: any) => ({ id: r.championTeamId, points: r.points, played: r.played, missingData: r.missingData })), [
    { id: null, points: null, played: null, missingData: ['championTeamId', 'points', 'played'] },
    { id: 7, points: 0, played: 14, missingData: [] },
    { id: 7, points: 0, played: 0, missingData: [] },
    { id: null, points: 35, played: 14, missingData: ['championTeamId'] },
    { id: 7, points: null, played: null, missingData: ['points', 'played'] },
  ]);
  assert.deepEqual(stored, before, 'projection must not change stored facts');
  assert.ok(response.json().every((r: any) => r.champion === 'Historic winner' && r.championUserId === 42));
});

test('country, manager and archive champion projections use the same nullable club identity contract', async (t) => {
  const app = await fixture(t);
  mockDb(t, prisma.leagueChampion, 'findMany', async () => [champion({ championTeamId: 0 }), champion()]);
  mockDb(t, prisma.hattrickUser, 'findUnique', async () => ({ userId: 42, loginName: 'Known winner', nationality: 'Schweiz' }));
  mockDb(t, prisma.seasonStanding, 'findMany', async () => [
    { season: 81, leagueLevelUnitName: 'Series', championTeamId: 0, championTeamName: 'Historic winner', complete: true },
  ]);
  const country = await app.inject({ url: '/api/national/seasons/81' });
  assert.deepEqual(country.json().map((r: any) => [r.championTeamId, r.missingData]), [[null, ['championTeamId']], [7, []]]);
  const profile = await app.inject({ url: '/api/users/42' });
  assert.deepEqual(profile.json().titles.map((r: any) => [r.clubId, r.missingData]), [[null, ['clubId']], [7, []]]);
  assert.equal(profile.json().titles.length, 2, 'unknown clubs do not remove known titles');
  const archive = await app.inject({ url: '/api/champions' });
  assert.deepEqual(archive.json()[0], { season: 81, league: 'Series', championTeamId: null, champion: 'Historic winner', complete: true, missingData: ['championTeamId'] });
});

test('valid absent resources retain their existing 404 or empty-list behavior', async (t) => {
  const app = await fixture(t);
  mockDb(t, prisma.match, 'findMany', async () => []);
  mockDb(t, prisma.match, 'findUnique', async () => null);
  mockDb(t, prisma.seasonStanding, 'findFirst', async () => null);
  mockDb(t, prisma.leagueChampion, 'findMany', async () => []);
  mockDb(t, prisma.hattrickUser, 'findUnique', async () => null);
  for (const url of ['/api/matches/123', '/api/seasons/123/standings', '/api/users/123']) assert.equal((await app.inject({ url })).statusCode, 404);
  for (const url of ['/api/seasons/123/matches', '/api/teams/123/summary', '/api/national/leagues/123/champions', '/api/national/seasons/123']) {
    const response = await app.inject({ url });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), []);
  }
});

test('validated team summaries preserve home/away goal orientation and separate season totals', async (t) => {
  const app = await fixture(t);
  const read = mockDb(t, prisma.match, 'findMany', async () => [
    { season: 81, homeTeamId: 42, homeGoals: 4, awayGoals: 1 },
    { season: 81, homeTeamId: 99, homeGoals: 3, awayGoals: 1 },
    { season: 81, homeTeamId: 42, homeGoals: 2, awayGoals: 2 },
    { season: 80, homeTeamId: 99, homeGoals: 0, awayGoals: 2 },
  ]);
  const response = await app.inject({ url: '/api/teams/42/summary' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), [
    { season: 81, wins: 1, draws: 1, losses: 1, goalsFor: 7, goalsAgainst: 6 },
    { season: 80, wins: 1, draws: 0, losses: 0, goalsFor: 2, goalsAgainst: 0 },
  ]);
  assert.deepEqual(read.mock.calls[0]?.arguments, [{ where: { teamId: 42, homeGoals: { not: null }, awayGoals: { not: null } }, orderBy: { season: 'desc' } }]);
});
