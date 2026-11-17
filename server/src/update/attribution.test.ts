import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { XMLParser } from 'fast-xml-parser';
import {
  applyDecisions, currentCoach, decideClubOwner, decideNationalCoach, leagueFinalRoundDate, ownerSnapshot,
  type ClubTarget, type CoachTarget, type OwnerSnapshot,
} from './attribution.js';

const xml = (name: string) => new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: true })
  .parse(readFileSync(new URL(`../../samples/${name}`, import.meta.url), 'utf8'));

const target = (overrides: Partial<ClubTarget> = {}): ClubTarget => ({ family: 'cup', table: 'CupChampion', competitionId: 70, season: 95,
  teamId: 2241372, teamName: 'Panormus 2024', competitionLeagueId: 4, decisiveDate: '2026-10-21T19:00:00.000Z', dateSource: 'retained matchdetails', ...overrides });
const snapshot = (overrides: { team?: Partial<NonNullable<OwnerSnapshot['team']>>; owner?: Partial<NonNullable<OwnerSnapshot['owner']>> | null } = {}): OwnerSnapshot => ({
  deleted: false,
  team: { teamId: 2241372, name: 'Panormus 2024', leagueId: 4, isBot: false, foundedDate: '2024-09-24T21:31:00.000Z', ...overrides.team },
  owner: overrides.owner === null ? null : { userId: 9491504, loginName: 'TotoNovanta', activationDate: '2024-09-24T21:31:00.000Z', ...overrides.owner },
});

test('real teamdetails samples parse into owner snapshots, and a deleted club is account_gone', () => {
  const parsed = ownerSnapshot(xml('teamdetails.xml'), 2241372);
  assert.deepEqual(parsed.owner, { userId: 9491504, loginName: 'TotoNovanta', activationDate: '2024-09-24T21:31:00.000Z' });
  assert.deepEqual(parsed.team, { teamId: 2241372, name: 'Panormus 2024', leagueId: 4, isBot: false, foundedDate: '2024-09-24T21:31:00.000Z' });
  const deleted = ownerSnapshot(xml('teamdetails-3.6-deleted-team.xml'), 54696);
  assert.equal(decideClubOwner(target({ teamId: 54696 }), deleted).status, 'account_gone');
});

test('an owner who held the club well before the decisive match is attributed', () => {
  const decision = decideClubOwner(target(), snapshot());
  assert.equal(decision.status, 'attribute');
  assert.equal(decision.status === 'attribute' && decision.userId, 9491504);
});

test('every club guard rejects with a reason instead of guessing', () => {
  const cases: Array<[string, ClubTarget, OwnerSnapshot, RegExp]> = [
    ['recent takeover', target(), snapshot({ team: { foundedDate: '2026-10-01T10:00:00.000Z' } }), /20 days before/],
    ['bot club', target(), snapshot({ team: { isBot: true } }), /bot/],
    ['no owner', target(), snapshot({ owner: null }), /no current owner/],
    ['no decisive date', target({ decisiveDate: null }), snapshot(), /No retained date/],
    ['other country', target(), snapshot({ team: { leagueId: 5 } }), /plays in league 5/],
    ['account after final', target(), snapshot({ team: { foundedDate: '2020-01-01T00:00:00.000Z' }, owner: { activationDate: '2026-11-01T00:00:00.000Z' } }), /activated after/],
    ['different club returned', target(), snapshot({ team: { teamId: 7 } }), /exact winning club/],
  ];
  for (const [name, t, s, reason] of cases) {
    const decision = decideClubOwner(t, s);
    assert.equal(decision.status, 'unresolved', name);
    assert.match(decision.status === 'unresolved' ? decision.reason : '', reason, name);
  }
  const conflict = decideClubOwner(target(), snapshot(), [123]);
  assert.match(conflict.status === 'unresolved' ? conflict.reason : '', /credits this club to 123/);
  const sameOwner = decideClubOwner(target(), snapshot(), [9491504]);
  assert.equal(sameOwner.status, 'attribute');
  const renamed = decideClubOwner(target({ teamName: 'Old name' }), snapshot());
  assert.deepEqual(renamed.status === 'attribute' && renamed.notes, ['club renamed: stored "Old name", now "Panormus 2024"']);
  // International competitions have no country restriction.
  assert.equal(decideClubOwner(target({ family: 'seasonal', competitionLeagueId: null }), snapshot({ team: { leagueId: 99 } })).status, 'attribute');
});

test('league round 14 date follows the 16-week season from a worlddetails observation', () => {
  // Stored on 2026-11-17: season 96, next league match (round 2) on 2026-11-22.
  const world = { currentSeason: 96, matchRound: 2, seriesMatchDate: '2026-11-22T10:00:00.000Z' };
  assert.equal(leagueFinalRoundDate(world, 96), '2027-02-14T10:00:00.000Z');
  assert.equal(leagueFinalRoundDate(world, 95), '2026-10-25T10:00:00.000Z');
  assert.equal(leagueFinalRoundDate({ ...world, seriesMatchDate: 'not a date' }, 95), null);
});

const coachTarget = (overrides: Partial<CoachTarget> = {}): CoachTarget => ({ table: 'NationalCupChampion', key: { cupId: 5001319, season: 41 },
  isYouth: false, slot: 'champion', country: 'Brasil', teamId: 3024, cycle: 41, finalDate: '2026-11-06', ...overrides });

test('a national coach elected for the cycle and still in charge is attributed; a changed coach needs tenure', () => {
  const current = currentCoach(xml('nationalteamdetails-1.1-sweden.xml'));
  assert.deepEqual(current, { teamId: 3000, leagueId: 1, coachId: 8877414, coachLogin: 'ZorroMP' });
  const kept = decideNationalCoach(coachTarget({ teamId: 3000, country: 'Sverige' }), { current, cycleElections: [{ winnerUserId: 8877414 }] });
  assert.equal(kept.status === 'attribute' && kept.userId, 8877414);
  const changed = decideNationalCoach(coachTarget({ teamId: 3000 }), { current, cycleElections: [{ winnerUserId: 13760173 }] });
  assert.match(changed.status === 'unresolved' ? changed.reason : '', /^needs_tenure: .*NTFormerCoaches\.aspx\?teamId=3000/);
  // A mid-cycle re-election: the latest election of the cycle counts.
  const reelected = decideNationalCoach(coachTarget({ teamId: 3000 }), { current, cycleElections: [{ winnerUserId: 1 }, { winnerUserId: 8877414 }] });
  assert.equal(reelected.status, 'attribute');
});

test('dated tenure decides the coach at the final, including retired and same-day changes', () => {
  const tenure = [{ date: '2025-08-26', userId: 13760173, name: 'GM-Corusant' }, { date: '2026-04-07', userId: 13760173, name: 'GM-Corusant' },
    { date: '2026-11-17', userId: 6770115, name: 'M-Giannini' }];
  const decision = decideNationalCoach(coachTarget(), { current: null, cycleElections: [], tenure });
  assert.equal(decision.status === 'attribute' && decision.loginName, 'GM-Corusant');
  const retired = decideNationalCoach(coachTarget(), { current: null, cycleElections: [], tenure: [{ date: '2026-04-07', userId: 0, name: 'Retired user' }] });
  assert.equal(retired.status, 'account_gone');
  const sameDay = decideNationalCoach(coachTarget(), { current: null, cycleElections: [], tenure: [...tenure, { date: '2026-11-06', userId: 5, name: 'x' }] });
  assert.match(sameDay.status === 'unresolved' ? sameDay.reason : '', /shares the final's date/);
  assert.equal(decideNationalCoach(coachTarget({ teamId: null }), { current: null, cycleElections: [] }).status, 'unresolved');
});

function archive() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE HattrickUser (userId INTEGER PRIMARY KEY, loginName TEXT, countryId INTEGER, nationality TEXT, isBot INTEGER, updatedAt INTEGER);
    CREATE TABLE CupChampion (cupId INTEGER, season INTEGER, championTeamId INTEGER, championUserId INTEGER, championUserName TEXT, updatedAt INTEGER);
    CREATE TABLE LeagueChampion (leagueId INTEGER, season INTEGER, championTeamId INTEGER, championUserId INTEGER, championUserName TEXT, updatedAt INTEGER);
    CREATE TABLE WorldCupChampion (isYouth INTEGER, edition INTEGER, champion TEXT, runnerUp TEXT, thirdFourth TEXT, championUserId INTEGER, championUserName TEXT, runnerUpUserId INTEGER, thirdFourthUserIds TEXT, updatedAt INTEGER);
    CREATE TABLE NationalCupChampion (cupId INTEGER, season INTEGER, champion TEXT, runnerUp TEXT, thirdFourth TEXT, championUserId INTEGER, championUserName TEXT, runnerUpUserId INTEGER, thirdFourthUserIds TEXT, updatedAt INTEGER);
    INSERT INTO HattrickUser VALUES (12748823, 'Balthazar-Boma', 44, 'Belgium', 0, 0);
    INSERT INTO CupChampion VALUES (70, 95, 2241372, NULL, NULL, 0);
    INSERT INTO WorldCupChampion VALUES (0, 41, 'Belgium', 'Sverige', 'Belarus, Danmark', NULL, NULL, 8877414, ',13477145', 0);`);
  return db;
}

test('guarded application fills only empty slots and keeps positional bronze ids', () => {
  const db = archive();
  const clubs = [{ target: target(), decision: { status: 'attribute' as const, userId: 9491504, loginName: 'TotoNovanta', basis: 'test', notes: [] } }];
  const coaches = [
    { target: { table: 'WorldCupChampion' as const, key: { isYouth: 0, edition: 41 }, isYouth: false, slot: 'champion' as const, country: 'Belgium', teamId: 3037, cycle: 41, finalDate: '2026-11-06' },
      decision: { status: 'attribute' as const, userId: 12748823, loginName: 'Balthazar-Boma', basis: 'tenure', notes: [] } },
    { target: { table: 'WorldCupChampion' as const, key: { isYouth: 0, edition: 41 }, isYouth: false, slot: 'thirdFourth' as const, index: 0, country: 'Belarus', teamId: 3156, cycle: 41, finalDate: '2026-11-06' },
      decision: { status: 'attribute' as const, userId: 14345112, loginName: 'gurkovanton', basis: 'tenure', notes: [] } },
  ];
  const applied = applyDecisions(db, clubs, coaches, new Map([[9491504, { loginName: 'TotoNovanta', countryId: 4, nationality: 'Italia' }],
    [14345112, { loginName: 'gurkovanton', countryId: 91, nationality: 'Belarus' }]]));
  assert.equal(applied, 3);
  assert.deepEqual({ ...db.prepare('SELECT championUserId, championUserName FROM CupChampion').get() }, { championUserId: 9491504, championUserName: 'TotoNovanta' });
  assert.deepEqual({ ...db.prepare('SELECT championUserId, championUserName, runnerUpUserId, thirdFourthUserIds FROM WorldCupChampion').get() },
    { championUserId: 12748823, championUserName: 'Balthazar-Boma', runnerUpUserId: 8877414, thirdFourthUserIds: '14345112,13477145' });
  // A second pass finds the slot taken and rolls everything back.
  assert.throws(() => applyDecisions(db, clubs, [], new Map()), /Guard rejected CupChampion/);
  assert.equal((db.prepare('SELECT count(*) AS n FROM HattrickUser').get() as { n: number }).n, 3);
});
