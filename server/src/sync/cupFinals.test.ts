import assert from 'node:assert/strict';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import evidence from '../data/recovered-cup-final-evidence.json' with { type: 'json' };
import { prisma } from '../db/client.js';
import { parseCupFinalMatch } from '../schemas/cupFinal.js';
import { cupFinalScore, loadCupFinalMatch, resolveCupFinal, resolveStoredCupFinal } from './cupFinals.js';
import { enrichCupTeamIds, syncCupChampions } from './cups.js';

const token = { token: 'test-token', tokenSecret: 'test-secret' };
const at = (cupId: number, season: number) => evidence.entries.find(e => e.summary.cupId === cupId && e.summary.season === season)!;
const clone = <T>(v: T): T => structuredClone(v);
function mock(t: TestContext, target: object, method: string, implementation: (...args: any[]) => any) {
  const object = target as Record<string, unknown>;
  const original = object[method];
  object[method] = implementation;
  t.after(() => { object[method] = original; });
}

test('all 49 retained historical two-leg gaps resolve, and no tied second leg is mislabeled penalties', () => {
  let count = 0;
  for (const e of evidence.entries) {
    const result = resolveCupFinal(e.summary, parseCupFinalMatch(e.rawMatch), [], e.previous);
    if (e.summary.cupId === 714) { assert.equal(result.noWinner, true); continue; }
    assert.ok(result.winner, `${e.summary.cupId}/${e.summary.season}: ${result.reason}`);
    assert.equal(result.winner.basis, 'aggregate');
    assert.equal(result.winner.penalties, false);
    assert.ok(result.winner.teamId > 0);
    count++;
  }
  assert.equal(count, 49);
  const poland = at(25, 9);
  assert.equal(resolveCupFinal(poland.summary, parseCupFinalMatch(poland.rawMatch), [], poland.previous).winner?.teamName, 'MKS Narew Ostroleka');
});

test('actual Masters XML has type7/context183 and passes the shared cup resolver', () => {
  const raw = new XMLParser({ parseTagValue: false }).parse(readFileSync(new URL('../../samples/cup-final-771464494-3.0.xml', import.meta.url), 'utf8'));
  const match = parseCupFinalMatch(raw);
  assert.equal(match.matchType, 7);
  assert.equal(match.cupId, 183);
  // Format is already established for this unit test; actual captured IDs/scores remain intact.
  const summary = { ...match, season: 95, round: 1, homeGoals: match.homeGoals!, awayGoals: match.awayGoals! };
  assert.equal(resolveCupFinal(summary, match).winner?.teamName, 'e to the i*pi');
  assert.match(resolveCupFinal(summary, { ...match, matchType: 3 }).reason!, /identity/);
  assert.match(resolveCupFinal(summary, { ...match, cupId: 1 }).reason!, /identity/);
});

test('archived summaries cannot infer a winner for an unresolved single-match tie', () => {
  const e = at(714, 38);
  const match = parseCupFinalMatch(e.rawMatch);
  assert.match(resolveStoredCupFinal(e.summary, match, e.previous).reason!, /no retained winner events/);
});

test('aggregate winner can lose the second leg, including a second-leg extra-time event', () => {
  const e = clone(at(56, 7));
  const match = parseCupFinalMatch(e.rawMatch);
  const home = match.homeTeamId;
  assert.ok(match.events.some(event => event.type === 72 && event.teamId === home));
  // The captured format is a two-leg final. Construct a first-leg away-side advantage and a
  // second-leg home win to prove neither the leg score nor event 72 overrides the aggregate.
  e.summary.homeGoals = match.homeGoals = 1;
  e.summary.awayGoals = match.awayGoals = 0;
  e.previous.matches[0]!.homeTeamName = e.summary.awayTeamName;
  e.previous.matches[0]!.awayTeamName = e.summary.homeTeamName;
  e.previous.matches[0]!.homeGoals = 5;
  e.previous.matches[0]!.awayGoals = 0;
  const result = resolveCupFinal(e.summary, match, [], e.previous);
  assert.equal(result.winner?.teamId, match.awayTeamId);
  assert.equal(result.winner?.basis, 'aggregate');
  assert.equal(result.winner?.penalties, false);
});

test('no away-goals rule, penalty count, or last-leg fallback is invented for a level aggregate', () => {
  const e = clone(at(25, 9));
  e.previous.matches[0]!.homeGoals = 1;
  e.previous.matches[0]!.awayGoals = 1;
  assert.match(resolveCupFinal(e.summary, parseCupFinalMatch(e.rawMatch), [], e.previous).reason!, /aggregate remains level/);
  assert.match(resolveCupFinal(e.summary, parseCupFinalMatch(e.rawMatch)).reason!, /Preceding round/);
});

test('earlier-round identity, participants, and duplicate match guard the aggregate calculation', () => {
  const e = clone(at(25, 9));
  const wrongSeason = cupFinalScore(e.summary, { ...e.previous, season: 8 });
  assert.ok('reason' in wrongSeason);
  assert.match(wrongSeason.reason, /identity/);
  const sameMatch = clone(e.previous);
  sameMatch.matches[0]!.matchId = e.summary.matchId;
  const duplicate = cupFinalScore(e.summary, sameMatch);
  assert.ok('reason' in duplicate);
  assert.match(duplicate.reason, /distinct/);
  const mismatch = parseCupFinalMatch(e.rawMatch);
  mismatch.homeTeamName = 'Different club';
  assert.match(resolveCupFinal(e.summary, mismatch, [], e.previous).reason!, /participants/);
});

test('a mismatched first-leg candidate cannot be mistaken for a single final, and semis must contain separate finalists', () => {
  const e = clone(at(25, 9));
  e.summary.homeGoals = 3; e.summary.awayGoals = 1;
  e.previous.matches[0]!.homeTeamName = 'A different or renamed club';
  const malformedFirst = cupFinalScore(e.summary, e.previous);
  assert.ok('reason' in malformedFirst);
  assert.match(malformedFirst.reason, /neither a matching first leg nor two semifinals/);
  const previous = { ...e.previous, matches: [
    { matchId: 1111, homeTeamName: e.summary.homeTeamName, awayTeamName: 'Semi opponent1', homeGoals: 2, awayGoals: 0 },
    { matchId: 2222, homeTeamName: e.summary.awayTeamName, awayTeamName: 'Semi opponent2', homeGoals: 2, awayGoals: 0 },
  ] };
  assert.deepEqual(cupFinalScore(e.summary, previous), { homeWon: true, basis: 'score', format: 'single' });
  previous.matches[1]!.homeTeamName = 'Unrelated semifinal team';
  const missingFinalist = cupFinalScore(e.summary, previous);
  assert.ok('reason' in missingFinalist);
  assert.match(missingFinalist.reason, /two finalists separately/);
});

test('sampled mutual walkover never creates a winner even with an asserted external candidate', () => {
  const e = at(714, 38);
  const m = parseCupFinalMatch(e.rawMatch);
  assert.ok(m.events.some(event => event.type === 500 && event.teamId === 0));
  const result = resolveCupFinal(e.summary, m, [{ cupId: 714, season: 38, matchId: m.matchId, teamId: m.homeTeamId, teamName: m.homeTeamName,
    sources: ['https://wiki.hattrick.org/wiki/Iran'], evidence: 'A hypothetical unsupported winner claim must not override the mutual walkover.' }], e.previous);
  assert.equal(result.winner, undefined);
  assert.equal(result.noWinner, true);
});

test('stored Match, MatchDetail, or cup-final markers prevent a second matchdetails call', async t => {
  for (const stored of ['match', 'detail', 'cup']) await t.test(stored, async child => {
    mock(child, prisma.match, 'findUnique', async () => stored === 'match' ? { matchId: 990001234 } : null);
    mock(child, prisma.matchDetail, 'findUnique', async () => stored === 'detail' ? { matchId: 990001234 } : null);
    mock(child, prisma.cupChampion, 'findFirst', async () => stored === 'cup' ? { cupId: 1 } : null);
    child.mock.method(globalThis, 'fetch', async () => { throw new Error('Stored match must never be fetched'); });
    const result = await loadCupFinalMatch(token, 990001234);
    assert.equal(result.fetched, false);
    assert.match(result.reason!, /already stored/);
  });
});

test('sync skips an archived final without fetching cupmatches, prior rounds, or matchdetails', async t => {
  mock(t, prisma.cup, 'findUnique', async () => ({ cupId: 7, cupName: 'Coppa Italia', currentSeason: 21 }));
  mock(t, prisma.cupChampion, 'findUnique', async () => ({ finalMatchId: 13913642, championUserId: null }));
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Archived final must not be fetched'); });
  const result = await syncCupChampions(token, 7, { minSeason: 21, pacingMs: 0 });
  assert.equal(result.seasonsStored, 0);
  assert.equal(result.issues.length, 0);
});

test('ArenaHub seasonal tournaments keep their dedicated ingestion route and make no cupmatches calls', async t => {
  mock(t, prisma.cup, 'findUnique', async () => ({ cupId: 2108472, cupName: 'Supporter Week Trophy', leagueId: 0, currentSeason: 35 }));
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Seasonal history cannot be requested from cupmatches'); });
  const result = await syncCupChampions(token, 2108472, { pacingMs: 0 });
  assert.equal(result.seasonsStored, 0);
  assert.match(result.issues[0]!.reason, /seasonal history ingestion/);
});

test('cupmatches failures become sanitized actionable issues', async t => {
  mock(t, prisma.cup, 'findUnique', async () => ({ cupId: 7, cupName: 'Coppa Italia', leagueId: 4, currentSeason: 21 }));
  mock(t, prisma.cupChampion, 'findUnique', async () => null);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Do not expose a signed OAuth URL'); });
  const result = await syncCupChampions(token, 7, { minSeason: 21, pacingMs: 0 });
  assert.deepEqual(result.issues, [{ season: 21, reason: 'Cup round could not be fetched or validated' }]);
});

test('enrichment preserves the archived aggregate winner while resolving its numeric ID from stored facts', async t => {
  mock(t, prisma.cupChampion, 'findMany', async () => [{ cupId: 25, season: 9, finalMatchId: 990001235, championTeamId: null, championTeamName: 'Aggregate winner', homeGoals: 1, awayGoals: 3 }]);
  mock(t, prisma.match, 'findUnique', async () => ({ matchId: 990001235, homeTeamId: 17, awayTeamId: 19, homeTeamName: 'Aggregate winner', awayTeamName: 'Leg winner', homeGoals: 1, awayGoals: 3 }));
  let write: any;
  mock(t, prisma.cupChampion, 'updateMany', async args => { write = args; return { count: 1 }; });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Stored final cannot be fetched'); });
  await enrichCupTeamIds(token);
  assert.deepEqual(write.data, { championTeamId: 17 });
  assert.equal(write.where.championTeamName, 'Aggregate winner');
});

test('new two-leg sync captures once, stores the aggregate winner, and leaves historical ownership unassigned', async t => {
  const e = clone(at(25, 9));
  const cupId = 9901000 + process.pid;
  const matchId = 991000000 + process.pid;
  e.summary.cupId = e.previous.cupId = cupId;
  e.summary.matchId = matchId;
  e.rawMatch.HattrickData.Match.MatchID = String(matchId);
  e.rawMatch.HattrickData.Match.MatchContextId = String(cupId);
  const files = [new URL(`../../../.scrape/cup-final-rounds/${cupId}-9-${e.summary.round - 1}.json`, import.meta.url), new URL(`../../../.scrape/cup-final-details/${matchId}.json`, import.meta.url)];
  t.after(() => { for (const file of files) if (existsSync(file)) unlinkSync(fileURLToPath(file)); });
  const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const roundXML = (round: typeof e.previous) => builder.build({ HattrickData: { Cup: { CupID: cupId, CupName: 'Test cup', CupSeason: 9, CupRound: round.round,
    Match: round.matches.map(m => ({ MatchID: m.matchId, MatchDate: '2004-02-18 12:00:00', HomeTeamName: m.homeTeamName, AwayTeamName: m.awayTeamName, MatchResult: { '@_Available': 'True', HomeGoals: m.homeGoals, AwayGoals: m.awayGoals } })) } } });
  const calls: string[] = [];
  let archived: any = null;
  mock(t, prisma.cup, 'findUnique', async () => ({ cupId, leagueId: 24, countryName: 'Poland', cupName: 'Test cup', isMain: true, currentSeason: 9 }));
  mock(t, prisma.cupChampion, 'findUnique', async () => archived);
  mock(t, prisma.cupChampion, 'findFirst', async () => null);
  mock(t, prisma.match, 'findUnique', async () => null);
  mock(t, prisma.matchDetail, 'findUnique', async () => null);
  mock(t, prisma.cupChampion, 'create', async args => { archived = args.data; return archived; });
  t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    const file = url.searchParams.get('file')!;
    calls.push(file);
    if (file === 'matchdetails') { assert.equal(url.searchParams.get('matchEvents'), 'true'); return new Response(builder.build(e.rawMatch)); }
    const round = url.searchParams.has('cupRound') ? e.previous : { ...e.previous, round: e.summary.round, matches: [{ ...e.previous.matches[0]!, ...e.summary }] };
    return new Response(roundXML(round));
  });
  const result = await syncCupChampions(token, cupId, { minSeason: 9, pacingMs: 0 });
  assert.equal(result.seasonsStored, 1, JSON.stringify(result.issues));
  assert.equal(archived.championTeamName, 'MKS Narew Ostroleka');
  assert.equal(archived.penalties, false);
  assert.equal(archived.championUserId, undefined);
  assert.deepEqual(calls, ['cupmatches', 'cupmatches', 'matchdetails']);
  await syncCupChampions(token, cupId, { minSeason: 9, pacingMs: 0 });
  assert.equal(calls.length, 3);
});

test('an already archived Match supplies numeric finalists for decisive single/aggregate cup results without matchdetails', async t => {
  for (const mode of ['single', 'aggregate'] as const) await t.test(mode, async child => {
    const e = clone(at(25, 9));
    const cupId = 9920000 + process.pid + (mode === 'single' ? 1 : 2);
    const matchId = 993000000 + process.pid + (mode === 'single' ? 1 : 2);
    const summary = { ...e.summary, cupId, matchId, homeGoals: 2, awayGoals: 1 };
    const previous = { ...e.previous, cupId, matches: mode === 'single' ? [
      { matchId: matchId - 1, homeTeamName: summary.homeTeamName, awayTeamName: 'Semi-final opponent', homeGoals: 3, awayGoals: 0 },
      { matchId: matchId - 2, homeTeamName: summary.awayTeamName, awayTeamName: 'Other semi-final opponent', homeGoals: 3, awayGoals: 0 },
    ] : [{ matchId: matchId - 1, homeTeamName: summary.awayTeamName, awayTeamName: summary.homeTeamName, homeGoals: 5, awayGoals: 0 }] };
    const cachedRound = new URL(`../../../.scrape/cup-final-rounds/${cupId}-9-${summary.round - 1}.json`, import.meta.url);
    child.after(() => { if (existsSync(cachedRound)) unlinkSync(cachedRound); });
    const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    let created: any;
    mock(child, prisma.cup, 'findUnique', async () => ({ cupId, leagueId: 24, countryName: 'Poland', cupName: 'Archived test cup', isMain: true, currentSeason: 9 }));
    mock(child, prisma.cupChampion, 'findUnique', async () => null);
    mock(child, prisma.cupChampion, 'findFirst', async () => null);
    mock(child, prisma.match, 'findUnique', async () => ({ ...summary, homeTeamId: 10, awayTeamId: 20, matchType: 3 }));
    mock(child, prisma.matchDetail, 'findUnique', async () => ({ matchId }));
    mock(child, prisma.cupChampion, 'create', async args => { created = args.data; return created; });
    const calls: string[] = [];
    child.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      calls.push(url.searchParams.get('file')!);
      assert.equal(url.searchParams.get('file'), 'cupmatches', 'Archived matchdetails must never be requested');
      const round = url.searchParams.has('cupRound') ? previous : { round: summary.round, matches: [summary] };
      return new Response(builder.build({ HattrickData: { Cup: { CupID: cupId, CupName: 'Archived test cup', CupSeason: 9, CupRound: round.round,
        Match: round.matches.map(m => ({ MatchID: m.matchId, MatchDate: '2004-02-18 12:00:00', HomeTeamName: m.homeTeamName, AwayTeamName: m.awayTeamName, MatchResult: { '@_Available': 'True', HomeGoals: m.homeGoals, AwayGoals: m.awayGoals } })) } } }));
    });
    const result = await syncCupChampions(token, cupId, { minSeason: 9, pacingMs: 0 });
    assert.equal(result.seasonsStored, 1, JSON.stringify(result.issues));
    assert.equal(created.championTeamId, mode === 'single' ? 10 : 20);
    assert.equal(created.championTeamName, mode === 'single' ? summary.homeTeamName : summary.awayTeamName);
    assert.deepEqual(calls, ['cupmatches', 'cupmatches']);
  });
});

test('placeholder upgrades clear nationality/manager names only when the winning club changes', async t => {
  const cases = [
    { name: 'same numeric club with renamed display', priorId: 10, priorName: 'Old club name', clear: false },
    { name: 'same club name gains numeric ID', priorId: null, priorName: 'Current winner', clear: false },
    { name: 'different numeric club with same display name', priorId: 11, priorName: 'Current winner', clear: true },
    { name: 'unknown club replaced by another winner', priorId: null, priorName: 'Wrong winner', clear: true },
  ];
  for (const example of cases) await t.test(example.name, async child => {
    const cupId = 9940000 + process.pid + cases.indexOf(example);
    const matchId = 995000000 + process.pid + cases.indexOf(example);
    const summary = { matchId, matchType: 3, homeTeamId: 10, awayTeamId: 20, homeTeamName: 'Current winner', awayTeamName: 'Runner-up', homeGoals: 2, awayGoals: 1 };
    const placeholder = { finalMatchId: 0, championUserId: null, championUserName: 'Old recorded manager', championLeagueId: 4, championTeamId: example.priorId, championTeamName: example.priorName };
    mock(child, prisma.cup, 'findUnique', async () => ({ cupId, leagueId: 24, countryName: 'Poland', cupName: 'Upgrade test cup', isMain: true, currentSeason: 9 }));
    mock(child, prisma.cupChampion, 'findUnique', async () => placeholder);
    mock(child, prisma.cupChampion, 'findFirst', async () => null);
    mock(child, prisma.match, 'findUnique', async () => summary);
    mock(child, prisma.matchDetail, 'findUnique', async () => null);
    let written: any;
    mock(child, prisma.cupChampion, 'updateMany', async args => { written = args; return { count: 1 }; });
    child.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
      assert.equal(new URL(String(input)).searchParams.get('file'), 'cupmatches');
      return new Response(new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_' }).build({ HattrickData: { Cup: { CupID: cupId, CupName: 'Upgrade test cup', CupSeason: 9, CupRound: 1,
        Match: { MatchID: matchId, MatchDate: '2004-02-18 12:00:00', HomeTeamName: summary.homeTeamName, AwayTeamName: summary.awayTeamName, MatchResult: { '@_Available': 'True', HomeGoals: 2, AwayGoals: 1 } } } } }));
    });
    const result = await syncCupChampions(token, cupId, { minSeason: 9, pacingMs: 0 });
    assert.equal(result.seasonsStored, 1, JSON.stringify(result.issues));
    assert.equal(written.data.championLeagueId, example.clear ? null : undefined);
    assert.equal(written.data.championUserName, example.clear ? null : undefined);
    assert.equal(written.where.championLeagueId, 4);
    assert.equal(written.where.championUserName, placeholder.championUserName);
  });
});

test('a final already assigned to another cup or season cannot create or upgrade a second winner row', async t => {
  for (const upgrade of [false, true]) for (const otherCup of [false, true]) await t.test(`${upgrade ? 'upgrade' : 'create'} / ${otherCup ? 'other cup' : 'other season'}`, async child => {
    const cupId = 9960000 + process.pid;
    const matchId = 997000000 + process.pid;
    const summary = { matchId, matchType: 3, homeTeamId: 10, awayTeamId: 20, homeTeamName: 'Winner', awayTeamName: 'Runner-up', homeGoals: 2, awayGoals: 1 };
    mock(child, prisma.cup, 'findUnique', async () => ({ cupId, leagueId: 24, countryName: 'Poland', cupName: 'Duplicate guard test', isMain: true, currentSeason: 9 }));
    mock(child, prisma.cupChampion, 'findUnique', async () => upgrade ? { finalMatchId: 0, championUserId: null, championTeamId: null, championTeamName: 'Winner' } : null);
    mock(child, prisma.cupChampion, 'findFirst', async () => ({ cupId: otherCup ? cupId + 1 : cupId, season: otherCup ? 9 : 8 }));
    mock(child, prisma.match, 'findUnique', async () => summary);
    mock(child, prisma.matchDetail, 'findUnique', async () => null);
    let writes = 0;
    mock(child, prisma.cupChampion, 'create', async () => { writes++; throw new Error('Duplicate final must not create'); });
    mock(child, prisma.cupChampion, 'updateMany', async () => { writes++; throw new Error('Duplicate final must not upgrade'); });
    child.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0]) => {
      assert.equal(new URL(String(input)).searchParams.get('file'), 'cupmatches');
      return new Response(new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_' }).build({ HattrickData: { Cup: { CupID: cupId, CupName: 'Duplicate guard test', CupSeason: 9, CupRound: 1,
        Match: { MatchID: matchId, MatchDate: '2004-02-18 12:00:00', HomeTeamName: 'Winner', AwayTeamName: 'Runner-up', MatchResult: { '@_Available': 'True', HomeGoals: 2, AwayGoals: 1 } } } } }));
    });
    const result = await syncCupChampions(token, cupId, { minSeason: 9, pacingMs: 0 });
    assert.equal(result.seasonsStored, 0);
    assert.equal(writes, 0);
    assert.match(result.issues[0]!.reason, /already assigned/);
  });
});
