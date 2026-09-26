import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, type TestContext } from 'node:test';
import { applyManagerProfileWinner, parseManagerProfileWinnerEvidence, planManagerProfileWinner,
  type ManagerProfileCapture, type StoredManagerProfileWinner } from './managerProfileWinners.js';

const checkedIn = JSON.parse(readFileSync(new URL('../../src/data/verified-manager-profile-hro-2026-09.json', import.meta.url), 'utf8')) as ManagerProfileCapture;
const copy = (): ManagerProfileCapture => structuredClone(checkedIn);
const stored = (): StoredManagerProfileWinner => ({
  leagueId: 164, season: 19, topSeriesId: 258666, countryName: 'Haiti',
  championTeamId: 2066186, championTeamName: 'HRO',
  championUserId: null, championUserName: null, complete: true,
});

test('checked-in profile and club history prove one bounded HRO season 19 identity', () => {
  const proof = parseManagerProfileWinnerEvidence(checkedIn);
  assert.deepEqual({
    leagueId: proof.leagueId, seriesId: proof.topSeriesId, season: proof.season,
    teamId: proof.teamId, userId: proof.userId, userName: proof.userName,
    tenureStart: proof.tenureStart, tenureEnd: proof.tenureEnd, winDate: proof.winDate,
  }, {
    leagueId: 164, seriesId: 258666, season: 19, teamId: 2066186,
    userId: 4178181, userName: 'ooooo', tenureStart: '2021-02-12',
    tenureEnd: '2026-07-12', winDate: '2026-07-05',
  });
  assert.equal(proof.seriesName, 'Première Ligue Haïtienne');
  assert.equal(proof.profileURL, checkedIn.managerProfile.sourceURL);
  assert.equal(proof.historyURL, checkedIn.clubHistory.sourceURL);
});

test('profile and history links, text, and tenure must all agree', () => {
  const changes: Array<[string, (source: ManagerProfileCapture) => void]> = [
    ['profile user', source => { source.managerProfile.sourceURL += '0'; }],
    ['heading user', source => { source.managerProfile.heading = source.managerProfile.heading.replace('4178181', '4178182'); }],
    ['untrusted profile host', source => { source.managerProfile.sourceURL = 'https://example.com/en/Club/Manager/?userId=4178181'; }],
    ['team history link', source => { source.managerProfile.previousTeam.team.href = '/en/Club/History/?teamId=2066187'; }],
    ['history source team', source => { source.clubHistory.sourceURL += '7'; }],
    ['no tenure', source => { source.managerProfile.previousTeam.tenure = '12.02.2021–01.07.2026'; }],
    ['invalid date', source => { source.managerProfile.previousTeam.tenure = '31.02.2021–12.07.2026'; }],
    ['profile trophy text season', source => { source.managerProfile.previousTeam.trophy.text = source.managerProfile.previousTeam.trophy.text.replace('19', '18'); }],
    ['profile trophy link season', source => { source.managerProfile.previousTeam.trophy.href = source.managerProfile.previousTeam.trophy.href.replace('RequestedSeason=19', 'RequestedSeason=18'); }],
    ['club history prose season', source => { source.clubHistory.event.text = source.clubHistory.event.text.replace('season 19', 'season 18'); }],
    ['club history prose team', source => { source.clubHistory.event.text = source.clubHistory.event.text.replace('HRO,', 'Other,'); }],
    ['club history linked team', source => { source.clubHistory.event.links[0]!.href = '/en/Club/?TeamID=2066187'; }],
    ['club history linked season', source => { source.clubHistory.event.links[1]!.href = source.clubHistory.event.links[1]!.href.replace('RequestedSeason=19', 'RequestedSeason=18'); }],
    ['club history linked series', source => { source.clubHistory.event.links[1]!.href = source.clubHistory.event.links[1]!.href.replace('258666', '258667'); }],
    ['duplicate series parameter', source => { source.clubHistory.event.links[1]!.href += '&LeagueLevelUnitID=258666'; }],
    ['missing team link', source => { source.clubHistory.event.links = source.clubHistory.event.links.slice(1); }],
  ];
  for (const [label, mutate] of changes) {
    const source = copy(); mutate(source);
    assert.throws(() => parseManagerProfileWinnerEvidence(source), label);
  }
  const wrongCountry = copy();
  wrongCountry.managerProfile.previousTeam.country.href = '/en/World/Leagues/League.aspx?LeagueID=165';
  assert.equal(planManagerProfileWinner(wrongCountry, stored()).status, 'unmatched');
});

test('planner requires an exact completed league, season, series, and team row', () => {
  const ready = planManagerProfileWinner(checkedIn, stored());
  assert.equal(ready.status, 'ready');
  assert.deepEqual(ready.changes, { championUserId: 4178181, championUserName: 'ooooo' });
  assert.equal(planManagerProfileWinner(checkedIn, null).status, 'unmatched');
  const changes: Array<[keyof StoredManagerProfileWinner, StoredManagerProfileWinner[keyof StoredManagerProfileWinner]]> = [
    ['leagueId', 165], ['season', 18], ['topSeriesId', 258667], ['countryName', 'Other'],
    ['championTeamId', 2066187], ['championTeamName', 'Other'], ['complete', false],
  ];
  for (const [key, value] of changes) {
    const row = { ...stored(), [key]: value };
    assert.equal(planManagerProfileWinner(checkedIn, row).status, 'unmatched', key);
  }
  assert.equal(planManagerProfileWinner(checkedIn, { ...stored(), championUserId: 0 }).status, 'ready');
  assert.equal(planManagerProfileWinner(checkedIn, { ...stored(), championUserId: 4178181 }).status, 'already-attributed');
  for (const id of [1, 4178182, -1]) {
    const plan = planManagerProfileWinner(checkedIn, { ...stored(), championUserId: id });
    assert.equal(plan.status, 'conflict');
    assert.equal(plan.changes, undefined);
  }
});

function mockMethod<T extends (...args: any[]) => unknown>(t: TestContext, delegate: object, method: string, fn: T) {
  const target = delegate as Record<string, unknown>;
  const original = target[method];
  const replacement = t.mock.fn(fn);
  target[method] = replacement;
  t.after(() => { target[method] = original; });
  return replacement;
}

test('dry-run does not write; apply guards the row and upserts only after a successful update', async (t) => {
  const { prisma } = await import('../db/client.js');
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network calls allowed'); });
  let row: StoredManagerProfileWinner | null = stored();
  mockMethod(t, prisma.leagueChampion, 'findUnique', async () => row);
  const writes: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const users: Array<{ update: Record<string, unknown>; create: Record<string, unknown> }> = [];
  let concurrentChange = false;
  const tx = {
    leagueChampion: { updateMany: async (args: typeof writes[number]) => {
      writes.push(args);
      return { count: concurrentChange ? 0 : 1 };
    } },
    hattrickUser: { upsert: async (args: typeof users[number]) => { users.push(args); } },
  };
  const transaction = mockMethod(t, prisma, '$transaction', async (run: (client: typeof tx) => Promise<unknown>) => run(tx));

  const dry = await applyManagerProfileWinner(checkedIn);
  assert.equal(dry.status, 'ready');
  assert.equal(transaction.mock.callCount(), 0);
  const applied = await applyManagerProfileWinner(checkedIn, { apply: true });
  assert.equal(applied.status, 'applied');
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0]!.data, { championUserId: 4178181, championUserName: 'ooooo' });
  assert.deepEqual(writes[0]!.where, { leagueId: 164, season: 19, topSeriesId: 258666,
    countryName: 'Haiti', championTeamId: 2066186, championTeamName: 'HRO',
    championUserId: null, championUserName: null, complete: true });
  assert.deepEqual(users, [{ where: { userId: 4178181 }, update: {},
    create: { userId: 4178181, loginName: 'ooooo', isBot: false } }]);

  concurrentChange = true;
  const stale = await applyManagerProfileWinner(checkedIn, { apply: true });
  assert.equal(stale.status, 'stale');
  assert.equal(users.length, 1, 'a stale winner must not create a user');
  row = { ...stored(), championUserId: 999 };
  const conflict = await applyManagerProfileWinner(checkedIn, { apply: true });
  assert.equal(conflict.status, 'conflict');
  assert.equal(writes.length, 2, 'existing positive ID is never updated');
});
