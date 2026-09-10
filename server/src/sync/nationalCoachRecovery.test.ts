import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { nationalDateISO, nationalCoachTeamRegistry, planNationalCoachRecovery, applyNationalCoachRecovery, type NationalCoachHistory, type NationalCoachSnapshot, type NationalPodiumRow, type VerifiedNationalTrophyWinner } from './nationalCoachRecovery.js';
import { prisma } from '../db/client.js';
import { attributeWorldCupCoaches } from './worldCup.js';
import { attributeNtCupCoaches } from './ntCups.js';

const now = '2026-09-10T12:00:00.000Z';
const teams = [
  { countryName: 'Sverige', nationalTeamId: 3000, u20TeamId: 3041 },
  { countryName: 'England', nationalTeamId: 3001, u20TeamId: 3042 },
  { countryName: 'Hong Kong, China', nationalTeamId: 3102, u20TeamId: 3103 },
];
const entry = (teamId = 3041, date = '20-09-2005', userId = 23283, name = '-Bolla-'): NationalCoachHistory['entries'][number] => ({
  teamId, date, userId, name, text: `${date} ${name}`, links: userId ? [{ text: name, href: `/Club/Manager/?userId=${userId}` }] : [],
});
const history = (overrides: Partial<NationalCoachHistory> = {}): NationalCoachHistory => ({
  teamId: 3041, isYouth: true, complete: true, capturedAt: now,
  sourceURL: 'https://www.hattrick.org/en/Club/NationalTeam/NTFormerCoaches.aspx?teamId=3041',
  entries: [entry(), entry(3041, '02-05-2006', 0, 'Retired user')], ...overrides,
});
const row = (overrides: Partial<NationalPodiumRow> = {}): NationalPodiumRow => ({
  isYouth: true, edition: 5, finishedDate: '15.01.2006', champion: 'Sverige', runnerUp: null, thirdFourth: '',
  championUserId: null, championUserName: null, runnerUpUserId: null, thirdFourthUserIds: '', ...overrides,
});
const snapshot = (worldCups = [row()], nationalCups: NationalPodiumRow[] = []): NationalCoachSnapshot => ({ teams, registeredCups: [{ cupId: 4878492, isYouth: true }], worldCups, nationalCups });
const verified = (overrides: Partial<VerifiedNationalTrophyWinner> = {}): VerifiedNationalTrophyWinner => ({
  table: 'worldCupChampion', isYouth: true, edition: 5, slot: 'champion', country: 'Sverige', finalDate: '2006-01-15', teamId: 3041,
  userId: 23283, name: '-Bolla-', sources: ['https://www.hattrick.org/en/World/WorldCup/History.aspx'], evidence: 'Reviewed direct title and linked manager evidence.', ...overrides,
});
const planned = (h = history(), r = row()) => planNationalCoachRecovery({ histories: [h] }, snapshot([r]), { now });

test('strict dates reject calendar rollover, mixed separators, invalid times and suffixes', () => {
  for (const value of ['31-02-2024', '29.02.2023', '01-13-2024', '00/01/2024', '01.02-2024', '2024-02-31', '01-02-2024 24:00', '01-02-2024 garbage']) assert.equal(nationalDateISO(value), null, value);
  assert.equal(nationalDateISO('29.02.2024'), '2024-02-29');
  assert.equal(nationalDateISO('15-01-2006 12:30'), '2006-01-15');
});

test('full linked history recovers a past coach and retains exact source and boundary', () => {
  const plan = planned().plans[0]!;
  assert.equal(plan.status, 'ready');
  assert.equal(plan.selected?.userId, 23283);
  assert.equal(plan.selected?.basis, 'complete-coach-history');
  assert.match(JSON.stringify(plan.evidence), /Retired user/);
  assert.match(JSON.stringify(plan.evidence), /userId=23283/);
});

test('retired boundary never extends its predecessor to later finals', () => {
  const plan = planned(history(), row({ finishedDate: '15.06.2006' })).plans[0]!;
  assert.equal(plan.status, 'unresolved');
  assert.match(plan.reason!, /retired\/unlinked/);
});

test('partial, malformed, unlinked positive, mixed-team and foreign-source histories cannot attribute', () => {
  const invalid = [
    history({ complete: false }), history({ capturedAt: '2027-01-01T00:00:00.000Z' }),
    history({ entries: [entry(3041, '31-02-2005')] }), history({ entries: [{ ...entry(), links: [] }] }),
    history({ entries: [entry(3000)] }), history({ sourceURL: 'https://example.org/NTFormerCoaches.aspx?teamId=3041' }),
    history({ sourceURL: 'https://www.hattrick.org/en/Club/NationalTeam/NTFormerCoaches.aspx?teamId=3000' }),
  ];
  for (const h of invalid) { const result = planned(h); assert.equal(result.plans[0]!.status, 'unresolved'); assert.equal(result.rejected.length, 1); }
});

test('no inference before oldest entry, after capture, or on a coach transition date', () => {
  for (const finishedDate of ['15.01.2003', '20.09.2005', '02.05.2006', '15.01.2027']) assert.equal(planned(history(), row({ finishedDate })).plans[0]!.status, 'unresolved');
  assert.equal(planned(history({ capturedAt: '2005-12-31T12:00:00.000Z', entries: [entry()] })).plans[0]!.status, 'unresolved');
});

test('same-day contradictory coaches block later inference', () => {
  const h = history({ entries: [entry(), entry(3041, '20-09-2005', 99, 'Other')] });
  assert.equal(planned(h).plans[0]!.status, 'unresolved');
  const result = planNationalCoachRecovery({ histories: [history(), history({ entries: [entry(3041, '20-09-2005', 0, 'Retired user')] })] }, snapshot(), { now });
  assert.equal(result.plans[0]!.status, 'conflict');
});

test('senior and youth team identities never cross even when a podium supplies the wrong linked ID', () => {
  assert.equal(planned(history(), row({ isYouth: false })).plans[0]!.status, 'unresolved');
  const nt = row({ edition: undefined, cupId: 4878492, season: 9, status: 'Finished', finalDate: '15-01-2006', championTeamId: 3000 });
  const result = planNationalCoachRecovery({ histories: [history()] }, snapshot([], [nt]), { now });
  assert.match(result.plans[0]!.reason!, /senior\/youth/);
  const unknownNation = row({ ...nt, champion: 'Unverified country alias', championTeamId: 3041 });
  assert.match(planNationalCoachRecovery({ histories: [history()] }, snapshot([], [unknownNation]), { now }).plans[0]!.reason!, /identity cannot be verified/);
  const contradictory = snapshot(); contradictory.teams = [...teams, { countryName: 'Sverige', nationalTeamId: 3000, u20TeamId: 999 }];
  assert.match(planNationalCoachRecovery({ histories: [history()] }, contradictory, { now }).plans[0]!.reason!, /identity cannot be verified/);
});

test('positive attributions are preserved and disagreements reported, missing sentinel0 recoverable', () => {
  assert.equal(planned(history(), row({ championUserId: 99 })).plans[0]!.status, 'conflict');
  assert.equal(planned(history(), row({ championUserId: 23283 })).plans[0]!.status, 'already-attributed');
  assert.equal(planned(history(), row({ championUserId: 0 })).plans[0]!.status, 'ready');
  assert.equal(planned(history(), row({ championUserId: -1 })).plans[0]!.status, 'conflict');
  const withoutEvidence = planNationalCoachRecovery({}, snapshot([row({ championUserId: 99 })]), { now }).plans[0]!;
  assert.equal(withoutEvidence.status, 'already-attributed');
  assert.match(withoutEvidence.reason!, /not reverified/);
});

test('English/native aliases are joined by league ID and conflicting populated DB identities disable both', () => {
  const missing = nationalCoachTeamRegistry([{ leagueId: 1, countryName: 'Sweden', nationalTeamId: null, u20TeamId: null }]);
  assert.equal(missing.find((t) => t.countryName === 'Sweden')!.u20TeamId, 3041);
  assert.equal(missing.find((t) => t.countryName === 'Sverige')!.u20TeamId, 3041);
  const bad = nationalCoachTeamRegistry([{ leagueId: 1, countryName: 'Sweden', nationalTeamId: 3000, u20TeamId: 3042 }]);
  assert.equal(bad.find((t) => t.countryName === 'Sweden')!.u20TeamId, null);
  assert.equal(bad.find((t) => t.countryName === 'Sverige')!.u20TeamId, null);
  const s = snapshot(); s.teams = bad;
  assert.match(planNationalCoachRecovery({ histories: [history()] }, s, { now }).plans[0]!.reason!, /identity cannot be verified/);
});

test('regional attribution requires registered Finished competition and real past final date', () => {
  for (const change of [{ status: 'Ongoing' }, { status: null }, { finalDate: '31-02-2006' }, { finalDate: '15-01-2027' }, { cupId: 5001315 }, { isYouth: false }]) {
    const nt = row({ edition: undefined, cupId: 4878492, season: 9, status: 'Finished', finalDate: '15-01-2006', championTeamId: 3041, ...change });
    assert.equal(planNationalCoachRecovery({ histories: [history()] }, snapshot([], [nt]), { now }).plans[0]!.status, 'unresolved');
  }
});

test('bronze index is preserved across missing first ID and comma-containing country names', () => {
  const nt = row({ edition: undefined, cupId: 4878492, season: 9, status: 'Finished', finalDate: '15-01-2006', champion: 'England', championTeamId: 3042,
    thirdFourth: 'Hong Kong, China, Sverige', thirdFourthTeamIds: ',3041', thirdFourthUserIds: ',0' });
  const proof = verified({ table: 'nationalCupChampion', edition: undefined, cupId: 4878492, season: 9, slot: 'thirdFourth', podiumIndex: 1 });
  const plans = planNationalCoachRecovery({ histories: [history()], verifiedWinners: [proof] }, snapshot([], [nt]), { now }).plans;
  const bronze = plans.find((p) => p.slot === 'thirdFourth' && p.podiumIndex === 1)!;
  assert.equal(bronze.country, 'Sverige'); assert.equal(bronze.status, 'ready');
  assert.equal(plans.find((p) => p.slot === 'thirdFourth' && p.podiumIndex === 0)!.country, 'Hong Kong, China');
  assert.match(planNationalCoachRecovery({ histories: [history()] }, snapshot([], [nt]), { now }).plans.find((p) => p.slot === 'thirdFourth' && p.podiumIndex === 1)!.reason!, /semifinal coach/);
});

test('direct reviewed evidence recovers older gaps but must exactly match nation/date/team/bracket/slot', () => {
  assert.equal(planNationalCoachRecovery({ verifiedWinners: [verified()] }, snapshot(), { now }).plans[0]!.status, 'ready');
  for (const bad of [{ country: 'England' }, { finalDate: '2006-01-16' }, { teamId: 3000 }, { isYouth: false }, { slot: 'runnerUp' as const }]) {
    const result = planNationalCoachRecovery({ verifiedWinners: [verified(bad)] }, snapshot(), { now });
    assert.equal(result.plans[0]!.status, 'unresolved'); assert.equal(result.rejected.length, 1);
  }
  const conflict = planNationalCoachRecovery({ histories: [history()], verifiedWinners: [verified({ userId: 99, name: 'Other' })] }, snapshot(), { now });
  assert.equal(conflict.plans[0]!.status, 'conflict');
});

function mockMethod(t: TestContext, target: object, method: string, replacement: unknown) {
  const record = target as Record<string, unknown>, original = record[method]; record[method] = replacement;
  t.after(() => { record[method] = original; });
}
function mockDatabase(t: TestContext, r: NationalPodiumRow, count = 1) {
  const writes: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const users: Array<Record<string, unknown>> = [];
  mockMethod(t, prisma.nationalLeague, 'findMany', async () => teams);
  mockMethod(t, prisma.worldCupChampion, 'findMany', async () => [r]);
  mockMethod(t, prisma.nationalCupChampion, 'findMany', async () => []);
  mockMethod(t, prisma, '$transaction', async (fn: (tx: object) => Promise<unknown>) => fn({
    worldCupChampion: { updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => { writes.push(args); return { count }; } },
    hattrickUser: { upsert: async (args: Record<string, unknown>) => { users.push(args); } },
  }));
  return { writes, users };
}

test('apply groups podium patches atomically, preserves established slots and current user metadata', async (t) => {
  const r = row({ championUserId: 99, championUserName: 'Existing', runnerUp: 'Sverige', runnerUpUserId: 0, thirdFourth: 'England, Sverige', thirdFourthUserIds: '88,' });
  const { writes, users } = mockDatabase(t, r);
  const result = await applyNationalCoachRecovery({ histories: [history()], verifiedWinners: [verified({ slot: 'thirdFourth', podiumIndex: 1 })] }, { apply: true });
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0]!.data, { runnerUpUserId: 23283, thirdFourthUserIds: '88,23283' });
  assert.equal(writes[0]!.where.championUserId, 99);
  assert.equal(writes[0]!.where.thirdFourthUserIds, '88,');
  assert.equal(writes[0]!.where.finishedDate, '15.01.2006');
  assert.equal(result.counts.applied, 2); assert.equal(result.counts.conflicts, 1);
  assert.ok(users.every((u) => JSON.stringify(u.update) === '{}'));
});

test('dry run does not write, stale row does not create users', async (t) => {
  const { writes, users } = mockDatabase(t, row(), 0);
  assert.equal((await applyNationalCoachRecovery({ histories: [history()] })).counts.ready, 1);
  assert.equal(writes.length, 0);
  assert.equal((await applyNationalCoachRecovery({ histories: [history()] }, { apply: true })).counts.stale, 1);
  assert.equal(users.length, 0);
});

test('old flat-tenure entry points fail before DB/API calls and cannot clear coach medals', async (t) => {
  const nope = () => { assert.fail('Legacy path must not read or write'); };
  mockMethod(t, prisma.worldCupChampion, 'findMany', nope);
  mockMethod(t, prisma.nationalCupChampion, 'findMany', nope);
  mockMethod(t, globalThis, 'fetch', nope);
  const token = { token: 'test-token', tokenSecret: 'test-secret' };
  await assert.rejects(attributeWorldCupCoaches(token, []), /Unverified flat coach-tenure attribution is disabled/);
  await assert.rejects(attributeNtCupCoaches(token, []), /Unverified flat coach-tenure attribution is disabled/);
});
