/** Read-only exhaustive audit. Run from server/: node --experimental-strip-types ../qa/api-audit.ts
 * Requires the existing server build (npm run build -w server). Never registers auth/sync.
 * The oracle uses independent read-only SQLite SELECTs, never production aggregators.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';
import { env } from '../server/dist/config/env.js';
import { prisma } from '../server/dist/db/client.js';
import { registerReadRoutes } from '../server/dist/routes/read.js';
import { registerScrapeRoutes } from '../server/dist/routes/scrape.js';

type Row = Record<string, any>;
const root = fileURLToPath(new URL('../', import.meta.url));
const dbPath = resolve(root, 'server/prisma', env.DATABASE_URL.replace(/^file:/, ''));
const fingerprint = () => createHash('sha256').update(readFileSync(dbPath)).digest('hex');
const initialFingerprint = fingerprint();
const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = (sql: string, ...params: any[]): Row[] => db.prepare(sql).all(...params).map((r) => ({ ...r })) as Row[];
const scalar = (sql: string, ...params: any[]) => Object.values(rows(sql, ...params)[0]!)[0];
const app = Fastify({ logger: false });
const requests: Record<string, number> = {};
let assertions = 0;
const failures: Row[] = [];
const findings: Row[] = [];
const equal = (label: string, actual: unknown, expected: unknown) => {
  assertions++;
  try { assert.deepEqual(actual, expected); }
  catch { failures.push({ label, actual, expected }); }
};
const truth = (label: string, condition: boolean, detail?: unknown) => {
  assertions++;
  if (!condition) failures.push({ label, detail });
};
const sorted = (items: Row[]) => items.map((r) => JSON.stringify(Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b))))).sort();
const sameRows = (label: string, actual: Row[], expected: Row[]) => equal(label, sorted(actual), sorted(expected));
async function get(path: string, family: string, status = 200) {
  requests[family] = (requests[family] ?? 0) + 1;
  const response = await app.inject({ method: 'GET', url: path });
  equal(`${path}: status`, response.statusCode, status);
  truth(`${path}: JSON content type`, String(response.headers['content-type']).includes('application/json'));
  const body = response.json();
  truth(`${path}: no credential-shaped response keys`, !/"(?:accessToken|tokenSecret|consumerSecret|oauth_token|oauth_token_secret)"\s*:/.test(response.body));
  return { body, response };
}
const withKnownIdentity = (r: Row, field: string) => ({ ...r, [field]: r[field] > 0 ? r[field] : null, missingData: r[field] > 0 ? [] : [field] });
const leagueShape = (r: Row) => {
  const absentStats = r.complete && r.played === 0 && r.points === 0;
  const projected = {
    season: r.season, championTeamId: r.championTeamId > 0 ? r.championTeamId : null,
    champion: r.championTeamName, championUserId: r.championUserId, championUserName: r.championUserName,
    points: absentStats ? null : r.points, played: absentStats ? null : r.played, complete: !!r.complete,
  };
  return { ...projected, missingData: ['championTeamId', 'points', 'played'].filter((field) => projected[field as keyof typeof projected] === null) };
};

async function main() {
  // A read endpoint attempting an outbound fetch must fail this audit immediately.
  globalThis.fetch = (() => { throw new Error('QA audit forbids network requests'); }) as typeof fetch;
  await registerReadRoutes(app);
  await registerScrapeRoutes(app);
  app.get('/api/health', async () => ({ ok: true }));
  equal('health', (await get('/api/health', 'health')).body, { ok: true });
  for (const route of ['targets', 'done']) {
    const { body } = await get(`/api/scrape/${route}`, `scrape/${route}`);
    truth(`scrape ${route}: array`, Array.isArray(body));
    if (route === 'done') truth('scrape done: unique numeric IDs', body.every((id: unknown) => typeof id === 'number') && new Set(body).size === body.length);
  }
  const seasons = (await get('/api/seasons', 'seasons')).body;
  equal('all archive seasons/counts/order', seasons, rows('SELECT season, COUNT(*) matches FROM Match GROUP BY season ORDER BY season DESC'));
  let returnedMatchCount = 0;
  for (const { season, matches } of seasons) {
    const body = (await get(`/api/seasons/${season}/matches`, 'season/matches')).body;
    returnedMatchCount += body.length;
    equal(`season ${season}: advertised count`, body.length, matches);
    equal(`season ${season}: exact IDs`, body.map((r: Row) => r.matchId).sort(), rows('SELECT matchId FROM Match WHERE season=?', season).map((r) => r.matchId).sort());
    truth(`season ${season}: date order`, body.every((r: Row, i: number) => !i || r.matchDate >= body[i-1].matchDate));
    for (const m of body) {
      const detail = (await get(`/api/matches/${m.matchId}`, 'match/detail')).body;
      for (const k of Object.keys(m)) equal(`match ${m.matchId}: ${k}`, detail[k], m[k]);
      const storedDetail = rows('SELECT matchId,lineupJson,scorersJson,ratingsJson FROM MatchDetail WHERE matchId=?', m.matchId)[0];
      equal(`match ${m.matchId}: detail presence`, detail.detail != null, storedDetail != null);
      if (storedDetail) for (const k of Object.keys(storedDetail)) equal(`match ${m.matchId}: ${k}`, detail.detail[k], storedDetail[k]);
    }
  }
  equal('all season counts conserve matches', returnedMatchCount, scalar('SELECT COUNT(*) n FROM Match'));
  for (const { teamId } of rows('SELECT teamId FROM Team')) {
    const expected = rows(`SELECT season, SUM(CASE WHEN (CASE WHEN homeTeamId=? THEN homeGoals-awayGoals ELSE awayGoals-homeGoals END)>0 THEN 1 ELSE 0 END) wins,
      SUM(homeGoals=awayGoals) draws, SUM(CASE WHEN (CASE WHEN homeTeamId=? THEN homeGoals-awayGoals ELSE awayGoals-homeGoals END)<0 THEN 1 ELSE 0 END) losses,
      SUM(CASE WHEN homeTeamId=? THEN homeGoals ELSE awayGoals END) goalsFor, SUM(CASE WHEN homeTeamId=? THEN awayGoals ELSE homeGoals END) goalsAgainst
      FROM Match WHERE teamId=? AND homeGoals IS NOT NULL AND awayGoals IS NOT NULL GROUP BY season ORDER BY season DESC`, teamId, teamId, teamId, teamId, teamId);
    equal(`team ${teamId}: summary`, (await get(`/api/teams/${teamId}/summary`, 'team/summary')).body, expected);
  }
  const champions = (await get('/api/champions', 'champions')).body;
  sameRows('archive champions exact rows', champions, rows('SELECT season,leagueLevelUnitName league,championTeamId,championTeamName champion,complete FROM SeasonStanding').map((r) => withKnownIdentity({ ...r, complete: !!r.complete }, 'championTeamId')));
  for (const { season } of champions) {
    const expected = rows('SELECT * FROM SeasonStanding WHERE season=? LIMIT 1', season)[0]!;
    equal(`season ${season}: standings`, (await get(`/api/seasons/${season}/standings`, 'season/standings')).body, { season, league: expected.leagueLevelUnitName, complete: !!expected.complete, table: JSON.parse(expected.standingsJson) });
    const table = JSON.parse(expected.standingsJson);
    for (const r of table) {
      equal(`standing ${season}/${r.teamId}: played`, r.played, r.won+r.drawn+r.lost);
      equal(`standing ${season}/${r.teamId}: points`, r.points, 3*r.won+r.drawn);
      equal(`standing ${season}/${r.teamId}: difference`, r.goalDiff, r.goalsFor-r.goalsAgainst);
    }
    const sum = (key: string) => table.reduce((total: number, r: Row) => total+r[key], 0);
    equal(`standing ${season}: goals balance`, sum('goalsFor'), sum('goalsAgainst'));
    equal(`standing ${season}: wins/losses balance`, sum('won'), sum('lost'));
    equal(`standing ${season}: champion`, table[0]?.teamId, expected.championTeamId);
  }
  // Explicit empty/not-found paths keep archive routes covered when no archive was imported.
  equal('absent season matches', (await get('/api/seasons/999999/matches', 'season/matches')).body, []);
  equal('absent team summary', (await get('/api/teams/999999999/summary', 'team/summary')).body, []);
  await get('/api/seasons/999999/standings', 'season/standings', 404);
  await get('/api/matches/999999999', 'match/detail', 404);

  const leagues = (await get('/api/national/leagues', 'national/leagues')).body;
  equal('national league identity/count/current-season fields', leagues, rows(`SELECT n.leagueId,n.countryName country,n.topSeriesId,n.currentSeason,COUNT(c.season) seasonsStored
    FROM NationalLeague n LEFT JOIN LeagueChampion c ON c.leagueId=n.leagueId WHERE n.isCountry=1 GROUP BY n.leagueId ORDER BY n.countryName`));
  let countryTitleCount = 0;
  for (const { leagueId } of rows('SELECT leagueId FROM NationalLeague')) {
    const body = (await get(`/api/national/leagues/${leagueId}/champions`, 'national/league/champions')).body;
    equal(`league ${leagueId}: all winner fields/order`, body, rows('SELECT * FROM LeagueChampion WHERE leagueId=? ORDER BY season DESC', leagueId).map(leagueShape));
    const listRow = leagues.find((r: Row) => r.leagueId === leagueId);
    if (listRow) { equal(`league ${leagueId}: advertised stored count`, body.length, listRow.seasonsStored); countryTitleCount += body.length; }
  }
  equal('country counts conserve eligible league titles', countryTitleCount, scalar('SELECT COUNT(*) n FROM LeagueChampion c JOIN NationalLeague n ON n.leagueId=c.leagueId WHERE n.isCountry=1'));
  let seasonTitleCount = 0;
  for (const { season } of rows('SELECT DISTINCT season FROM LeagueChampion')) {
    const body = (await get(`/api/national/seasons/${season}`, 'national/season')).body;
    sameRows(`national season ${season}: all winners`, body, rows('SELECT leagueId,countryName country,season,championTeamId,championTeamName champion,complete FROM LeagueChampion WHERE season=?', season).map((r) => withKnownIdentity({ ...r, complete: !!r.complete }, 'championTeamId')));
    seasonTitleCount += body.length;
  }
  equal('national seasons conserve all league titles', seasonTitleCount, scalar('SELECT COUNT(*) n FROM LeagueChampion'));

  const nationalities = (await get('/api/users/nationalities', 'users/nationalities')).body;
  sameRows('nationality manager counts', nationalities, rows("SELECT nationality,COUNT(*) managers FROM HattrickUser WHERE nationality IS NOT NULL AND nationality!='' AND nationality!='Unknown' GROUP BY nationality"));
  truth('nationality count descending', nationalities.every((r: Row, i: number) => !i || r.managers <= nationalities[i-1].managers));
  equal('nationality counts conserve eligible users', nationalities.reduce((n: number, r: Row) => n+r.managers, 0), scalar("SELECT COUNT(*) n FROM HattrickUser WHERE nationality IS NOT NULL AND nationality!='' AND nationality!='Unknown'"));
  async function leaderboard(nationality?: string, limit = 200) {
    const path = `/api/users/leaderboard?limit=${limit}${nationality ? `&nationality=${encodeURIComponent(nationality)}` : ''}`;
    const actual = (await get(path, 'users/leaderboard')).body;
    const expected = rows(`SELECT c.championUserId userId,COUNT(*) titles FROM LeagueChampion c LEFT JOIN HattrickUser u ON u.userId=c.championUserId
      WHERE c.complete=1 AND c.championUserId>0 ${nationality ? 'AND u.nationality=?' : ''} GROUP BY c.championUserId ORDER BY titles DESC`, ...(nationality ? [nationality] : []));
    equal(`${path}: count`, actual.length, Math.min(limit, 200, expected.length));
    equal(`${path}: title counts/rank cutoffs`, actual.map((r: Row) => r.titles), expected.slice(0, Math.min(limit, 200)).map((r) => r.titles));
    truth(`${path}: unique managers`, new Set(actual.map((r: Row) => r.userId)).size === actual.length);
    for (const r of actual) {
      const user = rows('SELECT * FROM HattrickUser WHERE userId=?', r.userId)[0];
      equal(`${path}/${r.userId}: counted titles`, r.titles, expected.find((x) => x.userId === r.userId)?.titles);
      equal(`${path}/${r.userId}: metadata`, [r.userName, r.nationality], [user?.loginName ?? `user ${r.userId}`, user?.nationality ?? null]);
    }
  }
  await leaderboard();
  for (const { nationality } of nationalities) await leaderboard(nationality);
  for (const limit of [1, 2, 50, 201, 1000, Number.MAX_SAFE_INTEGER]) await leaderboard(undefined, limit);
  await leaderboard('QA nonexistent nationality');

  let returnedUserTitleCount = 0;
  for (const user of rows('SELECT userId,loginName,nationality FROM HattrickUser ORDER BY userId')) {
    const body = (await get(`/api/users/${user.userId}`, 'user/detail')).body;
    equal(`user ${user.userId}: identity`, { userId: body.userId, userName: body.userName, nationality: body.nationality }, { userId: user.userId, userName: user.loginName, nationality: user.nationality });
    sameRows(`user ${user.userId}: every title`, body.titles, rows('SELECT countryName country,season,championTeamName club,championTeamId clubId,complete FROM LeagueChampion WHERE championUserId=?', user.userId).map((r) => withKnownIdentity({ ...r, complete: !!r.complete }, 'clubId')));
    truth(`user ${user.userId}: title order`, body.titles.every((t: Row, i: number) => !i || (Number(body.titles[i-1].complete) > Number(t.complete) || (body.titles[i-1].complete === t.complete && body.titles[i-1].season >= t.season))));
    returnedUserTitleCount += body.titles.length;
  }
  equal('profiles conserve user-attributed league titles', returnedUserTitleCount, scalar('SELECT COUNT(*) n FROM LeagueChampion c JOIN HattrickUser u ON u.userId=c.championUserId'));
  await get('/api/users/999999999', 'user/detail', 404);
  equal('unknown national league', (await get('/api/national/leagues/999999/champions', 'national/league/champions')).body, []);
  equal('unknown national season', (await get('/api/national/seasons/999999', 'national/season')).body, []);

  const badParams: Row[] = [];
  const invalidIntegers = ['abc', 'NaN', 'Infinity', '1.5', '-1', '0', '9007199254740993', '1e2', '0x10', ' 1', '1 ', '01', '+1', '1_000'];
  for (const template of ['/api/seasons/{x}/matches', '/api/matches/{x}', '/api/teams/{x}/summary', '/api/seasons/{x}/standings', '/api/national/leagues/{x}/champions', '/api/national/seasons/{x}', '/api/users/{x}']) {
    for (const value of invalidIntegers) {
      const path = template.replace('{x}', encodeURIComponent(value));
      const { response, body } = await get(path, 'invalid/path', 400);
      equal(`${path}: controlled validation error`, body.error, 'invalid parameter');
      const leaksQuery = /prisma|findMany|findUnique|[\\/]server[\\/]/i.test(response.body);
      truth(`${path}: no internal query details`, !leaksQuery);
      badParams.push({ path, status: response.statusCode, leaksQuery, message: body.message?.slice(-200) });
    }
  }
  const badLimits: Row[] = [];
  for (const query of [...invalidIntegers.map((limit) => `limit=${encodeURIComponent(limit)}`), 'limit=-50', 'limit=', 'limit=1&limit=2', 'nationality=Italia&nationality=Schweiz']) {
    const { response, body } = await get(`/api/users/leaderboard?${query}`, 'invalid/limit', 400);
    equal(`${query}: controlled validation error`, body.error, 'invalid query');
    const leaksQuery = /prisma|groupBy|findMany|[\\/]server[\\/]/i.test(response.body);
    truth(`${query}: no internal query details`, !leaksQuery);
    badLimits.push({ query, status: response.statusCode, leaksQuery, message: body.message?.slice(-160) });
  }
  const zeroFacts = rows('SELECT COUNT(*) n,SUM(complete=1 AND played=0 AND points=0) unavailableStatistics,SUM(championTeamId=0) unknownClubIds,SUM(championUserId IS NULL OR championUserId=0) unattributedManagers FROM LeagueChampion')[0]!;
  findings.push({ severity: 'data-gap', id: 'league-unavailable-facts', description: 'Historical winner-only reconstruction lacks some statistics and club identities. Every affected API row was checked to expose null plus missingData, preserving known winners and counts without inventing source facts.', counts: zeroFacts });
  const emptyArchive = scalar('SELECT COUNT(*) n FROM Match') === 0;
  if (emptyArchive) findings.push({ severity: 'coverage-gap', id: 'empty-archive', description: 'Team, Match, MatchDetail and SeasonStanding are empty; real-data match statistics, goals, W/D/L, lineups, ratings and reconstructed league-table arithmetic cannot be verified from this snapshot.' });
  truth('database file unchanged', fingerprint() === initialFingerprint);
  const result = {
    generatedAt: new Date().toISOString(), readOnly: true, databaseSha256: initialFingerprint,
    rows: Object.fromEntries(['Team','Match','MatchDetail','SeasonStanding','NationalLeague','LeagueChampion','HattrickUser'].map((table) => [table, scalar(`SELECT COUNT(*) n FROM ${table}`)])),
    requests, requestCount: Object.values(requests).reduce((a,b) => a+b, 0), assertions, failureCount: failures.length, failures, findings,
    validationProbes: { path: badParams, query: badLimits },
    scope: 'All 12 registerReadRoutes GET families plus health and two scrape reads. Every stored country, season, manager profile and nationality leaderboard checked. No CHPP or writes. Invalid-input 400 contracts and null/missingData semantics are required assertions.',
  };
  writeFileSync(resolve(root, 'qa/api-audit-results.json'), JSON.stringify(result, null, 2)+'\n');
  console.log(JSON.stringify({ ...result, validationProbes: { path: badParams.length, query: badLimits.length }, failures: failures.slice(0, 5).map(({label}) => ({label})) }, null, 2));
  if (failures.length) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { db.close(); await app.close(); await prisma.$disconnect(); });
