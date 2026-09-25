import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, type TestContext } from 'node:test';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { prisma } from '../db/client.js';
import { configureChppRuntime } from '../chpp/client.js';
import { parseWorldDetailsCups } from '../schemas/index.js';
import { syncNationalChampions } from '../sync/nationalChampions.js';
import { syncCupChampions } from '../sync/cups.js';
import { orderDueItems, reconcileCupCatalog, reconcilePodiumAttribution, reconcileSeasonalAttribution,
  refreshScheduled, reportScheduled, sourceError, trackedBaseline } from './refresh.js';

const token = { token: 'test-token', tokenSecret: 'test-secret' };
const worldRaw = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(readFileSync(new URL('../../samples/worlddetails-1.9-italy.xml', import.meta.url), 'utf8'));
const builder = new XMLBuilder({ ignoreAttributes: false });
const worldXML = (season: number, leagueId = 4) => {
  const raw = structuredClone(worldRaw);
  raw.HattrickData.LeagueList.League.LeagueID = String(leagueId);
  raw.HattrickData.LeagueList.League.Season = String(season);
  raw.HattrickData.LeagueList.League.Cups = '';
  return builder.build(raw);
};
const fixturesXML = (season: number, empty = false) => builder.build({ HattrickData: {
  LeagueLevelUnitID: 10, LeagueLevelUnitName: 'Serie A', Season: season,
  ...(empty ? {} : { Match: { MatchID: 900000 + season, MatchRound: 14, MatchDate: '2026-07-04 12:00:00',
    HomeTeam: { HomeTeamID: 101, HomeTeamName: 'Home' }, AwayTeam: { AwayTeamID: 102, AwayTeamName: 'Away' }, HomeGoals: 1, AwayGoals: 0 } }),
} });
function stub(t: TestContext, target: object, method: string, implementation: (...args: any[]) => any) {
  const object = target as Record<string, unknown>;
  const original = object[method]; object[method] = implementation;
  t.after(() => { object[method] = original; });
}

// An isolated in-memory delegate fake: the actual scheduler/parsers/sync functions run; no test
// connects to dev.db or writes baked public JSON. Keeping rows across calls simulates restoration.
function archive(t: TestContext, seasons: number[], currentSeason: number) {
  const at = new Date('2026-09-01T00:00:00Z');
  const tables: Record<string, any[]> = {
    updateSource: [], updateItem: [], cup: [], cupChampion: [], nationalCoachElection: [],
    worldCupChampion: [], nationalCupChampion: [], hattrickUser: [],
    nationalLeague: [{ leagueId: 4, countryName: 'Italy', topSeriesId: 10, currentSeason, isCountry: true }],
    leagueChampion: seasons.map(season => ({ leagueId: 4, season, complete: true, championTeamId: 101, championTeamName: 'Home', championUserId: 200 })),
  };
  const matches = (row: any, where: any = {}): boolean => Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'OR') return value.some((entry: any) => matches(row, entry));
    if (key === 'source') return matches(tables.updateSource!.find(source => source.sourceKey === row.sourceKey), value);
    if (key.includes('_')) return matches(row, value);
    const actual = row[key];
    if (value === null || typeof value !== 'object' || value instanceof Date) return actual === value;
    return Object.entries(value).every(([operator, expected]: [string, any]) => operator === 'in' ? expected.includes(actual)
      : operator === 'notIn' ? !expected.includes(actual) : operator === 'not' ? actual !== expected
      : operator === 'lte' ? actual !== null && actual <= expected : operator === 'gt' ? actual > expected : false);
  });
  const apply = (row: any, data: any) => { for (const [key, value] of Object.entries(data)) if (value !== undefined) row[key] = value && typeof value === 'object' && 'increment' in value ? (row[key] ?? 0) + value.increment : value; return row; };
  const create = (name: string, data: any) => {
    const row = { id: tables[name]!.length + 1, baseline: null, observedThrough: null, externalId: null,
      lastAttemptAt: null, lastSuccessAt: null, nextCheckAt: null, metadataJson: '{}',
      edition: null, attempts: 0, nextAttemptAt: null, completedAt: null, lastError: null, errorCategory: null,
      createdAt: at, updatedAt: at, championUserId: null, ...data };
    tables[name]!.push(row); return row;
  };
  for (const [name, rows] of Object.entries(tables)) {
    const delegate = (prisma as any)[name];
    stub(t, delegate, 'findMany', async (args: any = {}) => rows.filter(row => matches(row, args.where)).map(row => args.include?.source ? { ...row, source: tables.updateSource!.find(source => source.sourceKey === row.sourceKey) } : row));
    stub(t, delegate, 'findUnique', async (args: any) => rows.find(row => matches(row, args.where)) ?? null);
    stub(t, delegate, 'findFirst', async (args: any) => rows.find(row => matches(row, args.where)) ?? null);
    stub(t, delegate, 'create', async (args: any) => create(name, args.data));
    stub(t, delegate, 'createMany', async (args: any) => { for (const data of args.data) create(name, data); return { count: args.data.length }; });
    stub(t, delegate, 'upsert', async (args: any) => { const row = rows.find(row => matches(row, args.where)); return row ? apply(row, args.update) : create(name, args.create); });
    stub(t, delegate, 'update', async (args: any) => { const row = rows.find(row => matches(row, args.where)); assert.ok(row, `${name} update target`); return apply(row, args.data); });
    stub(t, delegate, 'updateMany', async (args: any) => { const found = rows.filter(row => matches(row, args.where)); for (const row of found) apply(row, args.data); return { count: found.length }; });
    stub(t, delegate, 'aggregate', async () => ({ _max: { edition: null } }));
  }
  return tables;
}

test('worlddetails scheduling hints are modelled from the real Italy sample', () => {
  const result = parseWorldDetailsCups(worldRaw);
  assert.equal(result.matchRound, 14); assert.equal(result.seasonOffset, 0);
  assert.equal(result.cups.find(cup => cup.cupId === 7)?.matchRoundsLeft, 0);
  assert.equal(result.cups.find(cup => cup.cupId === 515)?.matchRoundsLeft, 1);
  assert.equal(result.seriesMatchDate?.toISOString(), '2026-07-04T12:00:00.000Z');
});

test('baseline retains historical holes and older work alternates with fresh finals', () => {
  assert.equal(trackedBaseline([90, 92, 95], 100), 90);
  assert.equal(trackedBaseline([], 100), 97);
  const source = { observedThrough: 100 };
  const createdAt = new Date();
  const items = [100, 99, 90, 91].map(edition => ({ edition, source, nextAttemptAt: null, createdAt }));
  assert.deepEqual(orderDueItems(items).map(item => item.edition), [100, 90, 99, 91]);
});

test('a full update probes the due current Masters result before a larger domestic backlog', async t => {
  const db = archive(t, [], 95);
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    const file = url.searchParams.get('file');
    if (file === 'worlddetails') {
      calls.push('worlddetails');
      return new Response(worldXML(95));
    }
    assert.equal(file, 'cupmatches');
    calls.push(`${url.searchParams.get('cupId')}:${url.searchParams.get('season')}`);
    return new Response(builder.build({ HattrickData: { Cup: {
      CupID: 183, CupName: 'Hattrick Masters', CupSeason: 95, CupRound: 0, Match: '',
    } } }));
  });

  const result = await refreshScheduled(token, { now: new Date('2026-09-25T05:17:00Z'),
    maxMetadataChecks: 1, maxItems: 1, pacingMs: 0 });
  assert.deepEqual(calls, ['worlddetails', '183:95']);
  assert.equal(result.counts.itemsAttempted, 1);
  assert.equal(db.updateItem!.find(item => item.sourceKey === 'cup:183' && item.edition === 95 && item.task === 'result')?.attempts, 1);
  assert.equal(db.updateItem!.find(item => item.sourceKey === 'league:4' && item.edition === 95 && item.task === 'result')?.attempts, 0);
});

test('newly discovered cups enter the catalog and missing catalog entries remain', async t => {
  const db = archive(t, [], 94);
  db.cup!.push({ cupId: 99999, leagueId: 4, cupName: 'Temporarily missing' });
  await reconcileCupCatalog({ leagueId: 4, countryName: 'Italy' }, parseWorldDetailsCups(worldRaw));
  assert.equal(db.cup!.length, 6);
  assert.ok(db.cup!.some(cup => cup.cupId === 99999));
  assert.ok(db.cup!.some(cup => cup.cupId === 7 && cup.currentSeason === 94));
  assert.ok(!db.cup!.some(cup => cup.cupId === 1332));
});

test('a five-season outage queues every missed season and does not relabel retained facts as freshly checked', async t => {
  const db = archive(t, [94], 94);
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input)); calls.push(url.searchParams.get('file')!);
    assert.equal(url.searchParams.get('file'), 'worlddetails');
    return new Response(worldXML(99));
  });
  const result = await refreshScheduled(token, { onlyLeagueIds: [4], now: new Date('2026-09-12T05:17:00Z'), maxItems: 0 });
  assert.deepEqual(db.updateItem!.filter(item => item.task === 'result' && item.state === 'pending').map(item => item.edition), [95, 96, 97, 98, 99]);
  assert.equal(result.sources.find(source => source.sourceKey === 'league:4')?.lastSuccessAt, null);
  assert.equal(result.counts.metadataChecked, 1);
  assert.equal(calls.length, 1);
});

test('failed S94 remains queued after S95 succeeds and after five further season advances', async t => {
  const db = archive(t, [93], 95);
  let liveSeason = 95;
  const requested: number[] = [];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    if (url.searchParams.get('file') === 'worlddetails') return new Response(worldXML(liveSeason));
    const season = Number(url.searchParams.get('season')); requested.push(season);
    if (season === 94) throw new Error('The source is temporarily unavailable');
    return new Response(fixturesXML(season));
  });
  const first = await refreshScheduled(token, { onlyLeagueIds: [4], now: new Date('2026-09-12T05:17:00Z'), pacingMs: 0 });
  assert.equal(first.status, 'degraded');
  assert.ok(db.leagueChampion!.some(row => row.season === 95 && row.complete));
  assert.equal(db.updateItem!.find(item => item.task === 'result' && item.edition === 94)?.state, 'retry');
  assert.equal(first.sources.find(source => source.sourceKey === 'league:4')?.lastSuccessAt, null);
  liveSeason = 100;
  await refreshScheduled(token, { onlyLeagueIds: [4], now: new Date('2026-10-12T05:17:00Z'), maxItems: 0 });
  const pending = db.updateItem!.filter(item => item.task === 'result' && item.state !== 'complete').map(item => item.edition);
  assert.deepEqual(pending, [94, 96, 97, 98, 99, 100]);
  assert.ok(!requested.includes(93));
  assert.equal(requested.filter(season => season === 95).length, 1);
});

test('an empty latest league season does not suppress a preceding explicitly selected season', async t => {
  const db = archive(t, [], 95);
  const calls: number[] = [];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const season = Number(new URL(String(input)).searchParams.get('season')); calls.push(season);
    return new Response(fixturesXML(season, season === 95));
  });
  await syncNationalChampions(token, 4, { seasons: [95, 94], pacingMs: 0 });
  assert.deepEqual(calls, [95, 94]);
  assert.ok(db.leagueChampion!.some(row => row.season === 94));
});

test('explicit cup work lists continue across empty old seasons and do not re-fetch stored finals', async t => {
  const db = archive(t, [], 95);
  db.cup!.push({ cupId: 7, leagueId: 4, cupName: 'Coppa Italia', currentSeason: 95 });
  db.cupChampion!.push({ cupId: 7, season: 93, finalMatchId: 1234, championUserId: null });
  const seasons: number[] = [];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input)); assert.equal(url.searchParams.get('file'), 'cupmatches');
    const season = Number(url.searchParams.get('season')); seasons.push(season);
    return new Response(builder.build({ HattrickData: { Cup: { CupID: 7, CupName: 'Coppa Italia', CupSeason: season, CupRound: 0, Match: '' } } }));
  });
  await syncCupChampions(token, 7, { seasons: [95, 94, 93, 92], pacingMs: 0 });
  assert.deepEqual(seasons, [95, 94, 92]);
});

test('report mode is read-only and reports unresolved identities without assigning current owners', async t => {
  const db = archive(t, [94], 94);
  db.leagueChampion![0].championUserId = null;
  t.mock.method(globalThis, 'fetch', async () => new Response(worldXML(94)));
  await refreshScheduled(token, { onlyLeagueIds: [4], maxItems: 0 });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Report must not fetch'); });
  const before = JSON.stringify(db);
  const report = await reportScheduled();
  assert.equal(JSON.stringify(db), before);
  assert.ok(report.pendingEvidence.some(item => item.sourceKey === 'league:4' && item.task === 'attribution' && item.edition === 94));
  assert.ok(report.pendingEvidence.some(item => item.sourceKey === 'elections:4' && item.task === 'capture'));
  assert.equal(report.sources.find(source => source.sourceKey === 'elections:4')?.lastSuccessAt, null);
  assert.equal(db.leagueChampion![0].championUserId, null);
});

test('reviewed official and seasonal identities close their retained attribution tasks', async t => {
  const db = archive(t, [], 94);
  const now = new Date('2026-09-13T05:17:00Z');
  db.updateItem!.push(
    { sourceKey: 'worldcup:senior', itemKey: '41', task: 'attribution', edition: 41, state: 'needs_review',
      completedAt: null, nextAttemptAt: null, lastError: 'review required', errorCategory: 'evidence' },
    { sourceKey: 'seasonal:4147445', itemKey: '18', task: 'attribution', edition: 18, state: 'needs_review',
      completedAt: null, nextAttemptAt: null, lastError: 'review required', errorCategory: 'evidence' },
  );

  await reconcilePodiumAttribution('worldcup:senior', 41, {
    champion: 'Switzerland', championUserId: 101,
    runnerUp: 'Italy', runnerUpUserId: 102,
    thirdFourth: 'Spain, Sweden', thirdFourthUserIds: '103,104',
  }, now);
  await reconcileSeasonalAttribution('seasonal:4147445', 18, {
    championTeamName: 'Verified winner', championUserId: 201,
  }, now);

  for (const item of db.updateItem!) {
    assert.equal(item.state, 'complete');
    assert.equal(item.completedAt, now);
    assert.equal(item.lastError, null);
    assert.equal(item.errorCategory, null);
  }
});

test('source error reporting cannot expose signed URLs and budgets/authorization stop acquisition', () => {
  const error = new Error('https://example.test/?oauth_token=secret');
  assert.ok(!sourceError(error).message.includes('secret'));
  error.name = 'ChppBudgetError'; assert.equal(sourceError(error).stop, true);
  error.name = 'ChppStorageError'; assert.equal(sourceError(error).stop, true);
  const denied = Object.assign(new Error(), { name: 'ChppRequestError', category: 'authentication' });
  assert.equal(sourceError(denied).stop, true);
});

test('source reports use readable labels and separate runnable backlog from review work', async t => {
  const db = archive(t, [], 94);
  db.updateSource!.push({ sourceKey: 'league:4', kind: 'league', externalId: 4, metadataJson: JSON.stringify({ name: 'Italy' }) });
  db.updateItem!.push(
    { sourceKey: 'league:4', itemKey: '93', task: 'result', edition: 93, state: 'needs_review' },
    { sourceKey: 'league:4', itemKey: '92', task: 'attribution', edition: 92, state: 'needs_review' },
    { sourceKey: 'league:4', itemKey: '94', task: 'result', edition: 94, state: 'pending' },
    { sourceKey: 'league:4', itemKey: '91', task: 'result', edition: 91, state: 'complete' },
  );
  const source = (await reportScheduled()).sources[0]!;
  assert.equal(source.label, 'Italy league results');
  assert.equal(source.pending, 1);
  assert.equal(source.needsReview, 2);
  assert.equal(source.totalOpen, 3);
});

test('automated nationality and country retries stay out of the evidence queue while failures remain visible', async t => {
  const db = archive(t, [], 94);
  db.updateSource!.push(
    { sourceKey: 'users:nationality', kind: 'enrichment', externalId: null, metadataJson: JSON.stringify({ name: 'Manager and coach nationality' }) },
    { sourceKey: 'cup:183', kind: 'masters', externalId: 183, metadataJson: JSON.stringify({ name: 'Hattrick Masters' }) },
  );
  db.updateItem!.push(
    { sourceKey: 'users:nationality', itemKey: '101', task: 'nationality', edition: 101, state: 'retry',
      errorCategory: 'network', lastError: 'CHPP source check failed' },
    { sourceKey: 'cup:183', itemKey: '95', task: 'country', edition: 95, state: 'pending',
      errorCategory: null, lastError: null },
    { sourceKey: 'users:nationality', itemKey: '102', task: 'nationality', edition: 102, state: 'needs_review',
      errorCategory: 'evidence', lastError: 'Exact user evidence required' },
  );

  const report = await reportScheduled();
  assert.equal(report.status, 'degraded');
  assert.equal(report.counts.pendingItems, 2);
  assert.equal(report.counts.pendingEvidence, 1);
  assert.deepEqual(report.pendingEvidence.map(item => [item.task, item.edition]), [['nationality', 102]]);
  assert.ok(report.issues.some(issue => issue.sourceKey === 'users:nationality' && issue.edition === 101 && issue.category === 'network'));
  assert.equal(report.sources.find(source => source.sourceKey === 'users:nationality')?.pending, 1);
  assert.equal(report.sources.find(source => source.sourceKey === 'users:nationality')?.needsReview, 1);
});

test('scheduled nationality authentication failures retain null and receive durable retry backoff', async t => {
  const db = archive(t, [], 94);
  db.hattrickUser!.push({ userId: 4242, loginName: 'Exact user', countryId: null, nationality: null, isBot: false });
  t.mock.method(globalThis, 'fetch', async () => new Response('Authorization required', { status: 401 }));
  const at = new Date('2026-09-13T05:17:00.000Z');

  const report = await refreshScheduled(token, { now: at, maxMetadataChecks: 0, maxItems: 1, pacingMs: 0 });
  const task = db.updateItem!.find(item => item.sourceKey === 'users:nationality' && item.edition === 4242);
  assert.equal(report.status, 'degraded');
  assert.equal(report.counts.itemsAttempted, 1);
  assert.equal(db.hattrickUser![0]?.nationality, null);
  assert.equal(task?.state, 'retry');
  assert.equal(task?.attempts, 1);
  assert.equal(task?.errorCategory, 'authentication');
  assert.equal(task?.nextAttemptAt?.toISOString(), '2026-09-14T05:17:00.000Z');
  assert.ok(!report.pendingEvidence.some(item => item.sourceKey === 'users:nationality' && item.edition === 4242));
  assert.ok(report.issues.some(issue => issue.sourceKey === 'users:nationality' && issue.category === 'authentication'));
});

test('a small metadata cap rotates through countries while leaving calls for result tasks', async t => {
  const db = archive(t, [93], 94);
  for (const leagueId of [5, 6]) {
    db.nationalLeague!.push({ leagueId, countryName: `Country ${leagueId}`, topSeriesId: 10, currentSeason: 94, isCountry: true });
    db.leagueChampion!.push({ ...db.leagueChampion![0], leagueId });
  }
  const metadataCalls: number[] = [], resultCalls: number[] = [];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    if (url.searchParams.get('file') === 'worlddetails') {
      const leagueId = Number(url.searchParams.get('leagueID')); metadataCalls.push(leagueId);
      return new Response(worldXML(94, leagueId));
    }
    const season = Number(url.searchParams.get('season')); resultCalls.push(season);
    return new Response(fixturesXML(season));
  });
  for (let day = 12; day <= 15; day++) {
    const runtime = configureChppRuntime({ maxCalls: 3, pacingMs: 0, maxRetries: 0 });
    try {
      const result = await refreshScheduled(token, { onlyLeagueIds: [4, 5, 6], now: new Date(`2026-09-${day}T05:17:00Z`), maxMetadataChecks: 1, maxItems: 1, pacingMs: 0 });
      assert.equal(result.status, 'success');
      assert.equal(result.counts.metadataChecked, 1);
      if (day <= 14) assert.equal(result.counts.itemsAttempted, 1);
      assert.ok(runtime.stats().calls <= 2);
      if (day === 12) assert.equal(result.sources.find(source => source.sourceKey === 'worlddetails:5')!.lastAttemptAt, null);
    } finally { runtime.dispose(); }
  }
  assert.deepEqual(metadataCalls, [4, 5, 6, 4]);
  assert.equal(resultCalls.length, 3);
});

test('zero metadata allowance preserves stored observations and negative allowances are rejected', async t => {
  const db = archive(t, [94], 94);
  const world = parseWorldDetailsCups(worldRaw);
  db.updateSource!.push({ sourceKey: 'worlddetails:4', kind: 'worlddetails', externalId: 4, numberingSystem: 'league:4:season',
    nextCheckAt: null, lastAttemptAt: null, lastSuccessAt: null, metadataJson: JSON.stringify({ name: 'Italy', world }) });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('A zero metadata allowance must not fetch'); });
  const result = await refreshScheduled(token, { onlyLeagueIds: [4], maxMetadataChecks: 0, maxItems: 0 });
  assert.equal(result.status, 'success');
  assert.equal(result.counts.metadataChecked, 0);
  assert.equal(JSON.parse(db.updateSource!.find(source => source.sourceKey === 'league:4').metadataJson).matchRound, 14);
  assert.equal(result.sources.find(source => source.sourceKey === 'worlddetails:4')!.lastAttemptAt, null);
  await assert.rejects(refreshScheduled(token, { maxMetadataChecks: -1 }), /Invalid scheduled refresh options/);
});
