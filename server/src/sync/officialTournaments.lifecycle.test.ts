import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { configureChppRuntime } from '../chpp/client.js';
import evidence from '../data/recovered-cup-final-evidence.json' with { type: 'json' };
import { prisma } from '../db/client.js';
import { captureEvidence, configureEvidenceStore, matchEvidenceKey } from '../update/evidence.js';
import { LocalObjectStore } from '../update/storage.js';
import { NT_CUPS } from './ntCups.js';
import {
  MODERN_WORLD_CUP_TOURNAMENTS,
  refreshOfficialTournaments,
} from './officialTournaments.js';

const token = { token: 'test-token', tokenSecret: 'test-secret' };
const FAR_FUTURE = new Date('2100-01-01T00:00:00.000Z');

function sample(name: string): string {
  return readFileSync(new URL(`../../samples/${name}`, import.meta.url), 'utf8');
}

function stub(
  t: TestContext,
  target: object,
  method: string,
  implementation: (...args: any[]) => any,
): void {
  const object = target as Record<string, unknown>;
  const original = object[method];
  object[method] = implementation;
  t.after(() => { object[method] = original; });
}

/** A small in-memory Prisma substitute that preserves coordinator state between refreshes. */
function tournamentArchive(t: TestContext) {
  const createdAt = new Date('2026-09-01T00:00:00.000Z');
  const tables: Record<string, any[]> = {
    updateSource: [],
    updateItem: [],
    cup: [],
    cupChampion: [],
    worldCupChampion: [],
    nationalCupChampion: [],
    nationalLeague: [],
    match: [],
    matchDetail: [],
  };
  const matches = (row: any, where: any = {}): boolean => Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'OR') return value.some((entry: any) => matches(row, entry));
    if (key.includes('_')) return matches(row, value);
    const actual = row[key];
    if (value === null || typeof value !== 'object' || value instanceof Date) return actual === value;
    return Object.entries(value).every(([operator, expected]: [string, any]) => operator === 'in' ? expected.includes(actual)
      : operator === 'not' ? actual !== expected
      : operator === 'lte' ? actual !== null && actual <= expected
      : false);
  });
  const apply = (row: any, data: any) => {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      row[key] = value && typeof value === 'object' && 'increment' in value
        ? (row[key] ?? 0) + (value as { increment: number }).increment
        : value;
    }
    return row;
  };
  const create = (name: string, data: any) => {
    const row = {
      id: tables[name]!.length + 1,
      baseline: null,
      observedThrough: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
      nextCheckAt: null,
      metadataJson: '{}',
      edition: null,
      attempts: 0,
      nextAttemptAt: null,
      completedAt: null,
      lastError: null,
      errorCategory: null,
      createdAt,
      updatedAt: createdAt,
      ...data,
    };
    tables[name]!.push(row);
    return row;
  };

  for (const [name, rows] of Object.entries(tables)) {
    const delegate = (prisma as any)[name];
    stub(t, delegate, 'findMany', async (args: any = {}) => rows.filter(row => matches(row, args.where)));
    stub(t, delegate, 'findUnique', async (args: any) => rows.find(row => matches(row, args.where)) ?? null);
    stub(t, delegate, 'findFirst', async (args: any) => rows.find(row => matches(row, args.where)) ?? null);
    stub(t, delegate, 'create', async (args: any) => create(name, args.data));
    stub(t, delegate, 'upsert', async (args: any) => {
      const row = rows.find(candidate => matches(candidate, args.where));
      return row ? apply(row, args.update) : create(name, args.create);
    });
    stub(t, delegate, 'update', async (args: any) => {
      const row = rows.find(candidate => matches(candidate, args.where));
      assert.ok(row, `${name} update target`);
      return apply(row, args.data);
    });
    stub(t, delegate, 'updateMany', async (args: any) => {
      const found = rows.filter(row => matches(row, args.where));
      for (const row of found) apply(row, args.data);
      return { count: found.length };
    });
  }
  stub(t, prisma as any, '$transaction', async (operation: any) => operation(prisma));
  return tables;
}

function seedSources(
  tables: Record<string, any[]>,
  target: string,
  targetData: Record<string, unknown>,
): void {
  const entries = [
    ...MODERN_WORLD_CUP_TOURNAMENTS.map(cup => ({ sourceKey: cup.sourceKey, tournamentId: cup.tournamentId })),
    ...NT_CUPS.map(cup => ({ sourceKey: `national-cup:${cup.cupId}`, tournamentId: cup.cupId })),
  ];
  for (const entry of entries) tables.updateSource!.push({
    sourceKey: entry.sourceKey,
    kind: 'tournament',
    externalId: entry.tournamentId,
    numberingSystem: 'national-team:cycle',
    baseline: null,
    observedThrough: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    nextCheckAt: FAR_FUTURE,
    metadataJson: '{}',
    ...(entry.sourceKey === target ? { nextCheckAt: null, ...targetData } : {}),
  });
}

function runtime(t: TestContext, maxCalls = 10): void {
  const configured = configureChppRuntime({ maxCalls, pacingMs: 0, maxRetries: 0 });
  t.after(() => configured.dispose());
}

function tournamentDetailsXml(tournamentId: number, season: number, lastMatchRound: number, name = 'Test Tournament'): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<HattrickData><FileName>tournamentdetails.xml</FileName><Version>1.0</Version><Tournament>
<TournamentId>${tournamentId}</TournamentId><Name>${name}</Name><Season>${season}</Season>
<LastMatchRound>${lastMatchRound}</LastMatchRound><FirstMatchRoundDate>2004-08-01 03:00:00</FirstMatchRoundDate>
<NextMatchRoundDate>2004-08-25 03:00:00</NextMatchRoundDate><IsMatchesOngoing>0</IsMatchesOngoing>
</Tournament></HattrickData>`;
}

test('a completed national final is retained without assigning the current coach as the historical winner', async t => {
  runtime(t);
  const db = tournamentArchive(t);
  const sourceKey = 'national-cup:5001278';
  seedSources(db, sourceKey, { baseline: 41, observedThrough: 40 });
  db.nationalCupChampion!.push({
    cupId: 5_001_278,
    season: 41,
    cupName: 'Africa Cup',
    isYouth: false,
    host: 'Known host',
    startedDate: null,
    finalDate: null,
    status: null,
    champion: null,
    championTeamId: null,
    championLeagueId: null,
    runnerUp: null,
    runnerUpTeamId: null,
    runnerUpLeagueId: null,
    thirdFourth: '',
    thirdFourthTeamIds: '',
    thirdFourthLeagueIds: '',
    championUserId: null,
    championUserName: null,
    runnerUpUserId: null,
    thirdFourthUserIds: '',
  });
  for (const [leagueId, nationalTeamId] of [[1, 3_198], [2, 3_208], [3, 3_309], [4, 3_210]]) {
    db.nationalLeague!.push({ leagueId, nationalTeamId, u20TeamId: null });
  }
  const files: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    const file = url.searchParams.get('file')!;
    files.push(file);
    assert.equal(url.searchParams.get('tournamentId'), '5001278');
    if (file === 'tournamentdetails') return new Response(sample('tournamentdetails-1.0-africa-current.xml'));
    if (file === 'tournamentfixtures') {
      assert.equal(url.searchParams.get('season'), '41');
      return new Response(sample('tournamentfixtures-1.1-africa-s41.xml'));
    }
    throw new Error(`Unexpected current-identity lookup: ${file}`);
  });

  const result = await refreshOfficialTournaments(token, {
    now: new Date('2026-09-13T05:17:00.000Z'),
    maxMetadataChecks: 1,
    maxItems: 1,
  });

  assert.deepEqual(files, ['tournamentdetails', 'tournamentfixtures']);
  assert.equal(result.nationalTrophiesAdded, 1);
  const champion = db.nationalCupChampion![0];
  assert.equal(champion.champion, 'Senegal');
  assert.equal(champion.championUserId, null);
  assert.equal(champion.championUserName, null);
  assert.ok(db.updateItem!.some(item => item.sourceKey === sourceKey && item.edition === 41 &&
    item.task === 'attribution' && item.state === 'needs_review'));
  assert.equal(db.updateItem!.find(item => item.sourceKey === sourceKey && item.edition === 41 && item.task === 'result')?.state, 'complete');
});

test('a completed current edition is never re-fetched while an older due edition remains selectable', async t => {
  runtime(t);
  const db = tournamentArchive(t);
  const sourceKey = 'worldcup:senior';
  seedSources(db, sourceKey, { baseline: 40, observedThrough: 41 });
  db.worldCupChampion!.push(
    { isYouth: false, edition: 40, host: 'Known host', finishedDate: null, champion: null },
    { isYouth: false, edition: 41, host: 'Known host', finishedDate: '01.09.2026', champion: 'Current winner' },
  );
  const requestedSeasons: number[] = [];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    if (url.searchParams.get('file') === 'tournamentdetails') {
      return new Response(sample('tournamentdetails-1.0-worldcup-current.xml'));
    }
    assert.equal(url.searchParams.get('file'), 'tournamentfixtures');
    requestedSeasons.push(Number(url.searchParams.get('season')));
    return new Response(sample('tournamentfixtures-1.1-u21worldcup-s41.xml'));
  });

  const result = await refreshOfficialTournaments(token, {
    now: new Date('2026-09-13T05:17:00.000Z'),
    maxMetadataChecks: 1,
    maxItems: 1,
  });

  assert.equal(result.itemsAttempted, 1);
  assert.deepEqual(requestedSeasons, [40]);
  assert.equal(db.updateItem!.find(item => item.sourceKey === sourceKey && item.edition === 40 && item.task === 'result')?.state, 'needs_review');
  assert.equal(db.updateItem!.find(item => item.sourceKey === sourceKey && item.edition === 41 && item.task === 'result')?.state, 'complete');
});

test('successful metadata refresh clears a prior failure marker without discarding retained metadata', async t => {
  runtime(t);
  const db = tournamentArchive(t);
  const sourceKey = 'worldcup:senior';
  seedSources(db, sourceKey, {
    baseline: 41,
    observedThrough: 41,
    metadataJson: JSON.stringify({ retainedEvidence: 'keep-me' }),
  });
  db.worldCupChampion!.push({
    isYouth: false,
    edition: 41,
    host: 'Known host',
    finishedDate: '01.09.2026',
    champion: 'Current winner',
  });
  db.updateItem!.push({
    id: 1,
    sourceKey,
    itemKey: '41',
    task: 'host',
    edition: 41,
    state: 'needs_review',
    attempts: 0,
    nextAttemptAt: null,
    completedAt: null,
    lastError: 'Host needs reviewed evidence',
    errorCategory: 'evidence',
  });
  let fail = true;
  t.mock.method(globalThis, 'fetch', async () => {
    if (fail) throw new Error('temporary outage');
    return new Response(sample('tournamentdetails-1.0-worldcup-current.xml'));
  });

  const first = await refreshOfficialTournaments(token, {
    now: new Date('2026-09-13T05:17:00.000Z'),
    maxMetadataChecks: 1,
    maxItems: 0,
  });
  assert.equal(first.issues.length, 1);
  assert.ok(JSON.parse(db.updateSource!.find(source => source.sourceKey === sourceKey).metadataJson).failure);

  fail = false;
  const second = await refreshOfficialTournaments(token, {
    now: new Date('2026-09-14T05:17:00.000Z'),
    maxMetadataChecks: 1,
    maxItems: 0,
  });
  const metadata = JSON.parse(db.updateSource!.find(source => source.sourceKey === sourceKey).metadataJson);
  assert.equal(second.metadataChecked, 1);
  assert.equal(metadata.retainedEvidence, 'keep-me');
  assert.equal('failure' in metadata, false);
  const hostTask = db.updateItem!.find(item => item.sourceKey === sourceKey && item.edition === 41 && item.task === 'host');
  assert.equal(hostTask?.state, 'complete');
  assert.equal(hostTask?.lastError, null);
  assert.equal(hostTask?.errorCategory, null);
  assert.equal(hostTask?.nextAttemptAt, null);
});

test('an ongoing current World Cup alternates with historical backfill instead of starving it', async t => {
  runtime(t);
  const db = tournamentArchive(t);
  const sourceKey = 'worldcup:senior';
  seedSources(db, sourceKey, { baseline: 40, observedThrough: 41 });
  db.worldCupChampion!.push({
    isYouth: false,
    edition: 41,
    host: 'Known host',
    finishedDate: null,
    champion: null,
  });
  const requestedSeasons: number[] = [];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    if (url.searchParams.get('file') === 'tournamentdetails') {
      return new Response(sample('tournamentdetails-1.0-worldcup-current.xml'));
    }
    assert.equal(url.searchParams.get('file'), 'tournamentfixtures');
    requestedSeasons.push(Number(url.searchParams.get('season')));
    return new Response(sample('tournamentfixtures-1.1-worldcup-s41.xml'));
  });

  await refreshOfficialTournaments(token, {
    now: new Date('2026-09-13T05:17:00.000Z'),
    maxMetadataChecks: 1,
    maxItems: 1,
  });
  await refreshOfficialTournaments(token, {
    now: new Date('2026-09-14T05:17:00.000Z'),
    maxMetadataChecks: 1,
    maxItems: 1,
  });

  assert.deepEqual(requestedSeasons, [41, 40]);
  assert.equal(db.updateItem!.find(item => item.sourceKey === sourceKey && item.edition === 41 && item.task === 'result')?.state, 'pending');
  assert.equal(db.updateItem!.find(item => item.sourceKey === sourceKey && item.edition === 40 && item.task === 'result')?.state, 'needs_review');
});

test('a reported regional-cup ingest conflict leaves the result task incomplete', async t => {
  runtime(t);
  const db = tournamentArchive(t);
  const sourceKey = 'national-cup:5001278';
  seedSources(db, sourceKey, { baseline: 41, observedThrough: 40 });
  db.nationalCupChampion!.push({
    cupId: 5_001_278,
    season: 41,
    cupName: 'Africa Cup',
    isYouth: false,
    host: 'Known host',
    startedDate: null,
    finalDate: null,
    status: null,
    champion: 'Conflicting retained nation',
    championTeamId: null,
    championLeagueId: null,
    runnerUp: null,
    runnerUpTeamId: null,
    runnerUpLeagueId: null,
    thirdFourth: '',
    thirdFourthTeamIds: '',
    thirdFourthLeagueIds: '',
  });
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const file = new URL(String(input)).searchParams.get('file');
    return new Response(sample(file === 'tournamentdetails'
      ? 'tournamentdetails-1.0-africa-current.xml'
      : 'tournamentfixtures-1.1-africa-s41.xml'));
  });

  const result = await refreshOfficialTournaments(token, {
    now: new Date('2026-09-13T05:17:00.000Z'),
    maxMetadataChecks: 1,
    maxItems: 1,
  });

  assert.equal(result.nationalTrophiesAdded, 0);
  assert.equal(result.issues[0]?.category, 'evidence');
  assert.equal(db.nationalCupChampion![0].champion, 'Conflicting retained nation');
  assert.equal(db.updateItem!.find(item => item.sourceKey === sourceKey && item.edition === 41 && item.task === 'result')?.state, 'needs_review');
});

test('a reported World Cup ingest conflict leaves the result task incomplete', async t => {
  runtime(t);
  const db = tournamentArchive(t);
  const sourceKey = 'worldcup:youth';
  seedSources(db, sourceKey, { baseline: 40, observedThrough: 39 });
  db.worldCupChampion!.push({
    isYouth: true,
    edition: 40,
    ageGroup: 'U21',
    host: 'Known host',
    finishedDate: null,
    champion: 'Conflicting retained nation',
    runnerUp: null,
    thirdFourth: '',
  });
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const file = new URL(String(input)).searchParams.get('file');
    return new Response(sample(file === 'tournamentdetails'
      ? 'tournamentdetails-1.0-u21worldcup-current.xml'
      : 'tournamentfixtures-1.1-u21worldcup-s40.xml'));
  });

  const result = await refreshOfficialTournaments(token, {
    now: new Date('2026-09-13T05:17:00.000Z'),
    maxMetadataChecks: 1,
    maxItems: 1,
  });

  assert.equal(result.nationalTrophiesAdded, 0);
  assert.equal(result.issues[0]?.category, 'evidence');
  assert.equal(db.worldCupChampion![0].champion, 'Conflicting retained nation');
  assert.equal(db.updateItem!.find(item => item.sourceKey === sourceKey && item.edition === 40 && item.task === 'result')?.state, 'needs_review');
});

test('a tied knockout retains existing matchdetails evidence without inferring or re-fetching a winner', async t => {
  runtime(t);
  const root = await mkdtemp(join(tmpdir(), 'official-tournament-evidence-'));
  const store = new LocalObjectStore(join(root, 'store'));
  const retained = evidence.entries.find(entry => entry.summary.matchId === 23_440_755)!;
  const reference = await captureEvidence({ store, key: matchEvidenceKey(retained.summary.matchId), source: 'matchdetails', apiVersion: '3.0',
    parserVersion: 'test-retained-v1', payload: retained.rawMatch, capturedAt: '2026-09-11T00:15:10.000Z' });
  const resetEvidence = configureEvidenceStore({ store, workspacePath: join(root, 'workspace'), references: [reference] });
  t.after(async () => { resetEvidence(); await rm(root, { recursive: true, force: true }); });
  const db = tournamentArchive(t);
  const sourceKey = 'seasonal:59';
  seedSources(db, 'none', {});
  db.cup!.push({ cupId: 59, leagueId: 0, countryName: 'International', cupName: 'Evidence harness',
    cupLevel: 0, cupLevelIndex: 0, isMain: false, currentSeason: 5 });
  db.updateSource!.push({ sourceKey, kind: 'tournament', externalId: 59, numberingSystem: 'tournament:59:season',
    baseline: 5, observedThrough: 4, lastAttemptAt: null, lastSuccessAt: null, nextCheckAt: null, metadataJson: '{}' });
  const files: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const file = new URL(String(input)).searchParams.get('file')!;
    files.push(file);
    if (file === 'tournamentdetails') return new Response(tournamentDetailsXml(59, 5, 2, 'Evidence harness'));
    if (file === 'tournamentfixtures') return new Response(`<?xml version="1.0" encoding="utf-8"?>
<HattrickData><FileName>tournamentFixtures.xml</FileName><Version>1.1</Version><Matches>
<Match><MatchId>23440001</MatchId><HomeTeamId>111453</HomeTeamId><HomeTeamName>Passive Aggressive</HomeTeamName><AwayTeamId>900001</AwayTeamId><AwayTeamName>Bronze One</AwayTeamName><MatchDate>2004-08-11 03:00:00</MatchDate><MatchType>3</MatchType><MatchRound>1</MatchRound><Group>0</Group><Status>2</Status><HomeGoals>2</HomeGoals><AwayGoals>0</AwayGoals></Match>
<Match><MatchId>23440002</MatchId><HomeTeamId>111556</HomeTeamId><HomeTeamName>NightWalkers</HomeTeamName><AwayTeamId>900002</AwayTeamId><AwayTeamName>Bronze Two</AwayTeamName><MatchDate>2004-08-11 03:00:00</MatchDate><MatchType>3</MatchType><MatchRound>1</MatchRound><Group>0</Group><Status>2</Status><HomeGoals>3</HomeGoals><AwayGoals>1</AwayGoals></Match>
<Match><MatchId>23440755</MatchId><HomeTeamId>111453</HomeTeamId><HomeTeamName>Passive Aggressive</HomeTeamName><AwayTeamId>111556</AwayTeamId><AwayTeamName>NightWalkers</AwayTeamName><MatchDate>2004-08-18 03:00:00</MatchDate><MatchType>3</MatchType><MatchRound>2</MatchRound><Group>0</Group><Status>2</Status><HomeGoals>4</HomeGoals><AwayGoals>4</AwayGoals></Match>
</Matches></HattrickData>`);
    throw new Error(`matchdetails must be reused from the retained sample, not fetched: ${file}`);
  });

  const result = await refreshOfficialTournaments(token, {
    now: new Date('2026-09-13T05:17:00.000Z'),
    maxMetadataChecks: 1,
    maxItems: 1,
  });

  assert.deepEqual(files, ['tournamentdetails', 'tournamentfixtures']);
  assert.equal(result.seasonalChampionsAdded, 0);
  const item = db.updateItem!.find(entry => entry.sourceKey === sourceKey && entry.edition === 5 && entry.task === 'result');
  assert.equal(item?.state, 'needs_review');
  assert.match(item?.lastError ?? '', /no matched Tournament sample/);
  assert.equal(item?.evidenceRef, JSON.stringify(['evidence/chpp/matchdetails/3.0/23440755/events.json']));
});

test('a tiebreaker capture that reaches the CHPP budget stays queued and stops acquisition', async t => {
  runtime(t, 2);
  const db = tournamentArchive(t);
  const sourceKey = 'seasonal:6000002';
  seedSources(db, 'none', {});
  db.cup!.push({ cupId: 6_000_002, leagueId: 0, countryName: 'International', cupName: 'Budget harness',
    cupLevel: 0, cupLevelIndex: 0, isMain: false, currentSeason: 1 });
  db.updateSource!.push({ sourceKey, kind: 'tournament', externalId: 6_000_002, numberingSystem: 'tournament:6000002:season',
    baseline: 1, observedThrough: null, lastAttemptAt: null, lastSuccessAt: null, nextCheckAt: null, metadataJson: '{}' });
  const files: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const file = new URL(String(input)).searchParams.get('file')!;
    files.push(file);
    if (file === 'tournamentdetails') return new Response(tournamentDetailsXml(6_000_002, 1, 2, 'Budget harness'));
    assert.equal(file, 'tournamentfixtures');
    return new Response(`<?xml version="1.0" encoding="utf-8"?>
<HattrickData><FileName>tournamentFixtures.xml</FileName><Version>1.1</Version><Matches>
<Match><MatchId>88888001</MatchId><HomeTeamId>101</HomeTeamId><HomeTeamName>Finalist One</HomeTeamName><AwayTeamId>301</AwayTeamId><AwayTeamName>Bronze One</AwayTeamName><MatchDate>2026-09-06 12:00:00</MatchDate><MatchType>51</MatchType><MatchRound>1</MatchRound><Group>0</Group><Status>2</Status><HomeGoals>1</HomeGoals><AwayGoals>0</AwayGoals></Match>
<Match><MatchId>88888002</MatchId><HomeTeamId>201</HomeTeamId><HomeTeamName>Finalist Two</HomeTeamName><AwayTeamId>401</AwayTeamId><AwayTeamName>Bronze Two</AwayTeamName><MatchDate>2026-09-06 12:00:00</MatchDate><MatchType>51</MatchType><MatchRound>1</MatchRound><Group>0</Group><Status>2</Status><HomeGoals>2</HomeGoals><AwayGoals>0</AwayGoals></Match>
<Match><MatchId>88888003</MatchId><HomeTeamId>101</HomeTeamId><HomeTeamName>Finalist One</HomeTeamName><AwayTeamId>201</AwayTeamId><AwayTeamName>Finalist Two</AwayTeamName><MatchDate>2026-09-13 12:00:00</MatchDate><MatchType>51</MatchType><MatchRound>2</MatchRound><Group>0</Group><Status>2</Status><HomeGoals>1</HomeGoals><AwayGoals>1</AwayGoals></Match>
</Matches></HattrickData>`);
  });

  const result = await refreshOfficialTournaments(token, {
    now: new Date('2026-09-13T05:17:00.000Z'), maxMetadataChecks: 1, maxItems: 1,
  });

  assert.deepEqual(files, ['tournamentdetails', 'tournamentfixtures']);
  assert.equal(result.issues[0]?.category, 'budget');
  assert.equal(db.updateItem!.find(item => item.sourceKey === sourceKey && item.task === 'result')?.state, 'retry');
});

test('seasonal country reconciliation fairly drains legacy gaps and skips already resolved rows', async t => {
  runtime(t);
  const db = tournamentArchive(t);
  const sourceKey = 'seasonal:6000001';
  seedSources(db, 'none', {});
  db.cup!.push({ cupId: 6_000_001, leagueId: 0, countryName: 'International', cupName: 'Country harness',
    cupLevel: 0, cupLevelIndex: 0, isMain: false, currentSeason: 5 });
  db.updateSource!.push({ sourceKey, kind: 'tournament', externalId: 6_000_001, numberingSystem: 'tournament:6000001:season',
    baseline: 3, observedThrough: 5, lastAttemptAt: null, lastSuccessAt: null, nextCheckAt: null, metadataJson: '{}' });
  db.cupChampion!.push(
    { cupId: 6_000_001, season: 3, championTeamName: 'Panormus 2024', championTeamId: 2_241_372, championLeagueId: null },
    { cupId: 6_000_001, season: 4, championTeamName: 'Durian Durian', championTeamId: 2_344_637, championLeagueId: 0 },
    { cupId: 6_000_001, season: 5, championTeamName: 'Already resolved', championTeamId: 2_332_276, championLeagueId: 91 },
  );
  db.updateItem!.push({ id: 1, sourceKey, itemKey: '5', task: 'country', edition: 5, state: 'pending', attempts: 0,
    nextAttemptAt: null, completedAt: null, lastError: null, errorCategory: null });
  const teamIds: number[] = [];
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    const file = url.searchParams.get('file');
    if (file === 'tournamentdetails') return new Response(tournamentDetailsXml(6_000_001, 5, 0, 'Country harness'));
    assert.equal(file, 'teamdetails');
    teamIds.push(Number(url.searchParams.get('teamID')));
    return new Response(sample('teamdetails.xml'));
  });

  const first = await refreshOfficialTournaments(token, {
    now: new Date('2026-09-13T05:17:00.000Z'), maxMetadataChecks: 1, maxItems: 1,
  });
  const second = await refreshOfficialTournaments(token, {
    now: new Date('2026-09-14T05:17:00.000Z'), maxMetadataChecks: 1, maxItems: 1,
  });

  assert.equal(first.itemsAttempted, 1);
  assert.equal(second.itemsAttempted, 1);
  assert.deepEqual(teamIds, [2_241_372, 2_344_637]);
  assert.deepEqual(db.cupChampion!.map(row => row.championLeagueId), [4, 45, 91]);
  for (const edition of [3, 4, 5]) {
    assert.equal(db.updateItem!.find(item => item.sourceKey === sourceKey && item.itemKey === String(edition) && item.task === 'country')?.state, 'complete');
  }
});
