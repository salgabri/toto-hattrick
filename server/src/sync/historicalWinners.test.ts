import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, type TestContext } from 'node:test';
import { applyHistoricalWinners, extractHistoricalWinnerEvidence, planHistoricalWinners, type HistoricalClubHistory, type HistoricalRow, type HistoricalWinnerSnapshot } from './historicalWinners.js';

const user = { text: 'SebasM', href: '/en/Club/Manager/?userId=11687578' };
const ownership: HistoricalRow = {
  text: '13-07-2019 The club changed owner as SebasM took control and renamed it Re Picante.', links: [user],
};
const cupWin: HistoricalRow = {
  text: '27-08-2024 In season 88, Re Picante emerged victorious from Coppa Italia. They were managed by SebasM.',
  links: [{ text: 'Coppa Italia', href: '/en/World/Cup/?CupID=7' }, user, { text: 'Re Picante', href: '/en/Club/?TeamID=1726060' }],
};
const tournamentWin: HistoricalRow = {
  text: '28-01-2024 Participated in season 17 of Heroes of 2019 Trophy and finished as number 1.',
  links: [{ text: 'Heroes of 2019 Trophy', href: '/en/Club/ArenaHub/Tournaments/TournamentHistory.aspx?tournamentId=3427550&season=17' }],
};
const leagueWin: HistoricalRow = {
  text: '01-09-2024 The team finished as number 1 in Serie A season 88.',
  links: [{ text: 'Serie A', href: '/en/World/Series/?LeagueLevelUnitID=724&RequestedSeason=88' }],
};
const history = (rows = [cupWin, leagueWin, tournamentWin, ownership], complete = true): HistoricalClubHistory => ({
  teamId: 1726060, leagueId: 4, club: 'Re Picante', complete,
  pages: [{ page: 1, sourceURL: 'https://www88.hattrick.org/en/Club/History/?teamId=1726060', rows }],
});
function snapshot(): HistoricalWinnerSnapshot {
  const common = { leagueId: 4, season: 88, championTeamId: null, championTeamName: 'Re Picante', championUserId: null, championUserName: null };
  return {
    cups: [{ cupId: 7, leagueId: 4 }, { cupId: 3427550, leagueId: 0 }],
    tournamentIds: [3427550],
    cupChampions: [{ ...common, cupId: 7 }, { ...common, cupId: 3427550, leagueId: 0, season: 17, championUserId: 0, championLeagueId: 0 }],
    leagueChampions: [{ ...common, championTeamId: 0, topSeriesId: 724, complete: true }],
  };
}

test('extracts direct cup and historical league/tournament identities with full source evidence', () => {
  const result = extractHistoricalWinnerEvidence([history()]);
  assert.equal(result.rejected.length, 0);
  assert.deepEqual(result.evidence.map((item) => [item.kind, item.competitionId, item.season, item.userId, item.basis]), [
    ['cup', 7, 88, 11687578, 'direct-manager'],
    ['league', 724, 88, 11687578, 'ownership-tenure'],
    ['tournament', 3427550, 17, 11687578, 'ownership-tenure'],
  ]);
  assert.deepEqual(result.evidence[2]!.ownershipEvent?.links, [user]);
  assert.equal(result.evidence[0]!.sourceURL, history().pages[0]!.sourceURL);
  assert.equal(result.evidence[0]!.event.date, '2024-08-27');
});

test('partial or noncontiguous histories allow direct cup evidence but never infer tenure', () => {
  for (const input of [history(undefined, false), { ...history(), pages: [{ ...history().pages[0]!, page: 2 }] }]) {
    const result = extractHistoricalWinnerEvidence([input]);
    assert.deepEqual(result.evidence.map((item) => item.kind), ['cup']);
    assert.equal(result.rejected.length, 2);
  }
});

test('unlinked owner, relinquishment, undated ownership and same-day changes block inference', () => {
  for (const boundary of [
    { text: '01-01-2024 The club changed owner as A former user took control.', links: [] },
    { text: '01-01-2024 SebasM left the club.', links: [user] },
    { text: 'The club changed owner as SebasM took control.', links: [user] },
    { text: '28-01-2024 The club changed owner as SebasM took control.', links: [user] },
  ]) {
    const result = extractHistoricalWinnerEvidence([history([tournamentWin, boundary, ownership])]);
    assert.equal(result.evidence.length, 0, boundary.text);
    assert.equal(result.rejected.length, 1);
  }
});

test('a later owner never receives an earlier title; no prior known owner stays unresolved', () => {
  const later = { text: '01-01-2025 The club changed owner as Another took control.', links: [{ text: 'Another', href: '/en/Club/Manager/?userId=222' }] };
  assert.equal(extractHistoricalWinnerEvidence([history([tournamentWin, later, ownership])]).evidence[0]!.userId, 11687578);
  assert.equal(extractHistoricalWinnerEvidence([history([tournamentWin, later])]).evidence.length, 0);
});

test('rejects contradictory competition season/team links and unlinked cup managers', () => {
  const wrongSeason = { ...tournamentWin, links: [{ ...tournamentWin.links[0]!, href: tournamentWin.links[0]!.href.replace('season=17', 'season=18') }] };
  const wrongTeam = { ...cupWin, links: cupWin.links.map((link) => ({ ...link, href: link.href.replace('TeamID=1726060', 'TeamID=123') })) };
  const noManager = { ...cupWin, links: cupWin.links.filter((link) => link !== user) };
  const foreignManager = { ...cupWin, links: cupWin.links.map((link) => link === user ? { ...link, href: 'https://example.com/en/Club/Manager/?userId=11687578' } : link) };
  for (const row of [wrongSeason, wrongTeam, noManager, foreignManager]) {
    assert.equal(extractHistoricalWinnerEvidence([history([row, ownership])]).evidence.length, 0);
  }
});

test('actual HI cup event uses local season 1 despite the global season 64 archive link', () => {
  const result = extractHistoricalWinnerEvidence([{
    teamId: 2052478, leagueId: 1000, club: 'Arlekinats 2017', complete: false,
    pages: [{ page: 1, rows: [{
      text: '04-04-2017 In season 1, Arlekinats 2017 emerged victorious from Hattrick International Cup. They were managed by dealerxx.',
      links: [
        { href: '/Club/Matches/Archive.aspx?season=64&TeamID=2052478&actiontype=viewcup', text: '1' },
        { href: '/Club/?TeamID=2052478', text: 'Arlekinats 2017' },
        { href: '/World/Cup/Cup.aspx?CupID=1433', text: 'Hattrick International Cup' },
        { href: '/Club/Manager/?userId=3270054', text: 'dealerxx' },
      ],
    }] }],
  }]);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.evidence[0]!.season, 1);
  assert.equal(result.evidence[0]!.competitionId, 1433);
  assert.equal(result.evidence[0]!.userId, 3270054);
});

test('actual memorable-season and leadership cup events resolve linked historical managers on partial histories', () => {
  const cases = [
    {
      teamId: 2052682, club: 'Caipirinha F.C', season: 6, cupId: 1435, userId: 352538,
      row: {
        text: '23-10-2018 Season 6 was memorable for LA-Magician, who led Caipirinha F.C to the title in Hattrick International Ruby Challenger Cup.',
        links: [
          { href: '/Club/Matches/Archive.aspx?season=69&TeamID=2052682&actiontype=viewcup', text: '6' },
          { href: '/Club/Manager/?userId=352538', text: 'LA-Magician' },
          { href: '/Club/?TeamID=2052682', text: 'Caipirinha F.C' },
          { href: '/World/Cup/Cup.aspx?CupID=1435', text: 'Hattrick International Ruby Challenger Cup' },
        ],
      },
    },
    {
      teamId: 2052703, club: 'United Federation of Planets F.C.', season: 5, cupId: 1434, userId: 7197589,
      row: {
        text: '03-07-2018 United Federation of Planets F.C., under the leadership of il-padrone, won Hattrick International Emerald Challenger Cup season 5.',
        links: [
          { href: '/Club/?TeamID=2052703', text: 'United Federation of Planets F.C.' },
          { href: '/Club/Manager/?userId=7197589', text: 'il-padrone' },
          { href: '/World/Cup/Cup.aspx?CupID=1434', text: 'Hattrick International Emerald Challenger Cup' },
          { href: '/Club/Matches/Archive.aspx?season=68&TeamID=2052703&actiontype=viewcup', text: '5' },
        ],
      },
    },
  ];
  for (const fixture of cases) {
    const result = extractHistoricalWinnerEvidence([{ teamId: fixture.teamId, leagueId: 1000, club: fixture.club, complete: false, pages: [{ page: 1, rows: [fixture.row] }] }]);
    assert.equal(result.rejected.length, 0);
    assert.equal(result.evidence[0]!.competitionId, fixture.cupId);
    assert.equal(result.evidence[0]!.season, fixture.season);
    assert.equal(result.evidence[0]!.userId, fixture.userId);
    assert.equal(result.evidence[0]!.club, fixture.club);
    assert.equal(result.evidence[0]!.basis, 'direct-manager');
  }
});

test('captured Wieselhausen Masters entry proves the manager at the win without a CupID link', () => {
  const input = JSON.parse(readFileSync(new URL('../../src/data/verified-club-history-wieselhausen-2026-09-17.json', import.meta.url), 'utf8')) as HistoricalClubHistory[];
  const extracted = extractHistoricalWinnerEvidence(input);
  assert.equal(extracted.rejected.length, 0);
  assert.deepEqual(extracted.evidence.map(({ kind, competitionId, season, teamId, userId, userName, basis, event }) =>
    [kind, competitionId, season, teamId, userId, userName, basis, event.date]),
  [['cup', 183, 95, 820764, 13557250, 'WitzigesWiesel', 'direct-manager', '2026-09-17']]);
  const stored: HistoricalWinnerSnapshot = {
    cups: [{ cupId: 183, leagueId: 0 }], tournamentIds: [], leagueChampions: [],
    cupChampions: [{ cupId: 183, leagueId: 0, season: 95, championTeamId: 820764,
      championTeamName: 'FC Wieselhausen', championUserId: null, championUserName: null }],
  };
  const plan = planHistoricalWinners(input, stored);
  assert.equal(plan.plans[0]!.status, 'ready');
  assert.equal(plan.plans[0]!.changes?.championUserId, 13557250);

  const row = input[0]!.pages[0]!.rows[0]!;
  for (const unsafe of [
    { ...row, links: row.links.filter((link) => !link.href.includes('Manager')) },
    { ...row, links: row.links.filter((link) => !link.href.includes('TeamID')) },
    { ...row, links: [...row.links, { text: 'Other cup', href: '/World/Cup/?CupID=999' }] },
    { ...row, text: row.text.replace('WitzigesWiesel', 'Another manager') },
  ]) {
    const bad = [{ ...input[0]!, pages: [{ ...input[0]!.pages[0]!, rows: [unsafe] }] }];
    assert.equal(extractHistoricalWinnerEvidence(bad).evidence.length, 0, unsafe.text);
  }
});

test('positive wording alone or a link to a different named manager is never attribution evidence', () => {
  const unknownWording = { ...cupWin, text: '27-08-2024 Re Picante won something memorable under a manager.' };
  const conflictingName = { ...cupWin, text: cupWin.text.replace('managed by SebasM.', 'managed by Another.') };
  assert.equal(extractHistoricalWinnerEvidence([history([unknownWording])]).evidence.length, 0);
  const conflict = extractHistoricalWinnerEvidence([history([conflictingName])]);
  assert.equal(conflict.evidence.length, 0);
  assert.match(conflict.rejected[0]!.reason, /Linked manager disagrees/);
});

test('a manager link matching the explicit league-champion template is direct evidence', () => {
  // Controlled variation of the captured retired-manager template: identity must be both named
  // in that positive champion statement and linked, rather than inferred from current ownership.
  const row = {
    text: '01-09-2024 Re Picante, under the leadership of SebasM, became league champions season 88.',
    links: [...leagueWin.links, { href: '/Club/?TeamID=1726060', text: 'Re Picante' }, user],
  };
  const result = extractHistoricalWinnerEvidence([history([row], false)]);
  assert.equal(result.evidence[0]!.basis, 'direct-manager');
  assert.equal(result.evidence[0]!.userId, 11687578);
  assert.equal(result.evidence[0]!.season, 88);
});

test('actual abandoned-club league label is resolved only by a known prior linked ownership event', () => {
  const input: HistoricalClubHistory = {
    teamId: 2053266, leagueId: 1000, club: 'HI-Dandy de Tazmania', complete: true,
    pages: [{ page: 1, rows: [
      {
        text: '22-02-2019 HI-Dandy de Tazmania, under the leadership of a now retired manager, became league champions season 7.',
        links: [
          { href: '/Club/?TeamID=2053266', text: 'HI-Dandy de Tazmania' },
          { href: '/World/Series/SeriesHistory.aspx?LeagueLevelUnitID=256687&RequestedSeason=7&Games=all', text: '7' },
        ],
      },
      {
        text: '09-01-2017 The club changed owner as ercanto took control and renamed it HI-Dandy de Tazmania.',
        links: [{ href: '/Club/Manager/?userId=8118689', text: 'ercanto' }],
      },
    ] }],
  };
  const resolved = extractHistoricalWinnerEvidence([input]);
  assert.equal(resolved.evidence[0]!.userId, 8118689);
  assert.equal(resolved.evidence[0]!.basis, 'ownership-tenure');
  assert.equal(resolved.evidence[0]!.competitionId, 256687);
  input.pages[0]!.rows.pop();
  const missing = extractHistoricalWinnerEvidence([input]);
  assert.equal(missing.evidence.length, 0);
  assert.equal(missing.rejected.length, 1);
});

test('plans both null and sentinel winners, recovering team IDs and international club country', () => {
  const result = planHistoricalWinners([history()], snapshot());
  assert.equal(result.plans.length, 3);
  assert.ok(result.plans.every((plan) => plan.status === 'ready' && plan.changes?.championTeamId === 1726060));
  const tournament = result.plans.find((plan) => plan.stored?.cupId === 3427550)!;
  assert.equal(tournament.changes?.championLeagueId, 4);
  assert.ok(result.plans.filter((plan) => plan !== tournament).every((plan) => plan.changes?.championLeagueId === undefined));
});

test('matching requires registered exact competition, season, country and stored team identity', () => {
  const fixtures = [
    (data: HistoricalWinnerSnapshot) => { data.cups = []; data.tournamentIds = []; data.leagueChampions = []; },
    (data: HistoricalWinnerSnapshot) => { for (const row of [...data.cupChampions, ...data.leagueChampions]) row.season = 999; },
    (data: HistoricalWinnerSnapshot) => { for (const row of [...data.cupChampions, ...data.leagueChampions]) row.championTeamId = 555; },
    (data: HistoricalWinnerSnapshot) => { for (const row of [...data.cupChampions, ...data.leagueChampions]) row.championTeamName = 'Different club'; },
    (data: HistoricalWinnerSnapshot) => { for (const row of [...data.cupChampions, ...data.leagueChampions]) row.leagueId = 99; },
  ];
  for (const alter of fixtures) {
    const data = snapshot(); alter(data);
    assert.ok(planHistoricalWinners([history()], data).plans.every((plan) => plan.status === 'unmatched'));
  }
});

test('existing positive identities survive and every differing direct or tenure attribution conflicts', () => {
  const data = snapshot();
  for (const row of [...data.cupChampions, ...data.leagueChampions]) row.championUserId = 222;
  const result = planHistoricalWinners([history()], data);
  assert.equal(result.plans.find((plan) => plan.stored?.cupId === 7)?.status, 'conflict');
  assert.equal(result.plans.filter((plan) => plan.status === 'conflict').length, 3);
  assert.ok(result.plans.every((plan) => !plan.changes));
});

test('contradictory direct winner identities conflict instead of using the first record', () => {
  const other = { ...cupWin, text: cupWin.text.replace('SebasM', 'Another'), links: cupWin.links.map((link) => link === user ? { text: 'Another', href: '/en/Club/Manager/?userId=222' } : link) };
  const result = planHistoricalWinners([history([cupWin, other])], snapshot());
  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0]!.status, 'conflict');
  assert.equal(result.plans[0]!.evidence.length, 2);
});

test('unsupported stored owner sentinels and contradictory club countries never become writes', () => {
  const data = snapshot();
  data.cupChampions[0]!.championUserId = -1;
  const invalid = planHistoricalWinners([history([cupWin])], data);
  assert.equal(invalid.plans[0]!.status, 'conflict');
  assert.equal(invalid.plans[0]!.changes, undefined);
  const contradictory = planHistoricalWinners([history([tournamentWin, ownership]), { ...history([tournamentWin, ownership]), leagueId: 99 }], snapshot());
  assert.equal(contradictory.plans[0]!.status, 'conflict');
});

function mockMethod<T extends (...args: any[]) => unknown>(t: TestContext, delegate: object, method: string, fn: T) {
  const target = delegate as Record<string, unknown>;
  const original = target[method];
  const replacement = t.mock.fn(fn);
  target[method] = replacement;
  t.after(() => { target[method] = original; });
  return replacement;
}

test('dry run performs no transactions, and apply guards old values and preserves current manager details', async (t) => {
  const { prisma } = await import('../db/client.js');
  const data = snapshot();
  mockMethod(t, prisma.cup, 'findMany', async () => data.cups);
  mockMethod(t, prisma.cupChampion, 'findMany', async () => data.cupChampions);
  mockMethod(t, prisma.leagueChampion, 'findMany', async () => data.leagueChampions);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network calls allowed'); });
  const writes: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const users: Array<{ update: Record<string, unknown>; create: Record<string, unknown> }> = [];
  const currentManager = { userId: 11687578, loginName: 'Current renamed alias', isBot: true, nationality: 'Italia', countryId: 4 };
  let storedManager: Record<string, unknown> = { ...currentManager };
  let changedDuringPlanning = false;
  const tx = {
    cupChampion: { updateMany: async (args: typeof writes[number]) => { writes.push(args); return { count: changedDuringPlanning ? 0 : 1 }; } },
    leagueChampion: { updateMany: async (args: typeof writes[number]) => { writes.push(args); return { count: changedDuringPlanning ? 0 : 1 }; } },
    hattrickUser: { upsert: async (args: typeof users[number]) => { users.push(args); storedManager = { ...storedManager, ...args.update }; } },
  };
  const transaction = mockMethod(t, prisma, '$transaction', async (run: (client: typeof tx) => Promise<unknown>) => run(tx));
  const dry = await applyHistoricalWinners([history()]);
  assert.equal(dry.counts.ready, 3);
  assert.equal(transaction.mock.callCount(), 0);
  const applied = await applyHistoricalWinners([history()], { apply: true });
  assert.equal(applied.counts.applied, 3);
  assert.deepEqual(writes.map((write) => write.where.championUserId).sort(), [null, null, 0].sort());
  assert.ok(writes.every((write) => write.where.championTeamName === 'Re Picante'));
  assert.ok(users.every((record) => !('nationality' in record.update) && !('countryId' in record.update)));
  assert.ok(users.every((record) => record.create.userId === 11687578));
  assert.deepEqual(storedManager, currentManager, 'historical aliases must not replace current login, bot flag or nationality');
  changedDuringPlanning = true;
  const stale = await applyHistoricalWinners([history()], { apply: true });
  assert.equal(stale.counts.stale, 3);
  assert.equal(users.length, 3, 'stale updates must not upsert managers');
});
