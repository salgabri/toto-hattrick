import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { prisma } from '../db/client.js';
import { electionEvidenceSchema, electionKey, prepareElectionCaptures, processElectionRecovery, recoverElectionCaptures,
  recoverElections, type ElectionEvidence, type ElectionCapture } from './electionRecovery.js';
import { ingestElections, type ElectionRecord } from './elections.js';

const evidence: ElectionEvidence = {
  leagueId: 125, isYouth: true, edition: 18, host: 'Suomi', votes: '4 (67%)',
  winnerUserId: 9084974, winnerUserName: 'Noris',
  sourceURL: 'https://www.hattrick.org/en/World/Elections/History.aspx?LeagueID=125',
  rowText: 'World Cup 18 Suomi Noris 4 (67%)', winnerHref: '/Club/Manager/?userId=9084974',
  sourceTupleOccurrences: 1,
};
const stored = { id: 9012, leagueId: 125, isYouth: true, edition: 18, host: 'Suomi', votes: '4 (67%)',
  countryName: 'Cape Verde', winnerUserId: null as number | null, winnerUserName: null as string | null };
const input: ElectionRecord = { ...stored, winnerUserId: evidence.winnerUserId, winnerUserName: evidence.winnerUserName };
const restorations = new WeakMap<TestContext, Map<object, Set<string>>>();
function mock(t: TestContext, delegate: object, method: string, fn: (...args: any[]) => unknown) {
  const target = delegate as Record<string, unknown>;
  const objects = restorations.get(t) ?? new Map<object, Set<string>>();
  const methods = objects.get(delegate) ?? new Set<string>();
  if (!methods.has(method)) {
    const original = target[method]; t.after(() => { target[method] = original; });
    methods.add(method); objects.set(delegate, methods); restorations.set(t, objects);
  }
  const replacement = t.mock.fn(fn); target[method] = replacement; return replacement;
}
function setup(t: TestContext, rows: any[] = [stored]) {
  mock(t, prisma, '$transaction', async (callback) => callback(prisma));
  const read = mock(t, prisma.nationalCoachElection, 'findMany', async () => rows);
  const badWrite = async () => { throw new Error('Unexpected mutation'); };
  const write = mock(t, prisma.nationalCoachElection, 'updateMany', badWrite);
  const insert = mock(t, prisma.nationalCoachElection, 'create', badWrite);
  const remove = mock(t, prisma.nationalCoachElection, 'deleteMany', badWrite);
  const user = mock(t, prisma.hattrickUser, 'upsert', badWrite);
  return { read, write, insert, remove, user };
}

test('observed evidence verifies the exact league source, profile ID, and displayed tuple', () => {
  assert.equal(electionEvidenceSchema.safeParse(evidence).success, true);
  for (const changes of [{ winnerHref: '/Club/?teamId=9084974' }, { winnerHref: '/Club/Manager/?userId=4' },
    { sourceURL: 'https://www.hattrick.org/en/World/Elections/History.aspx?LeagueID=127' },
    { sourceURL: 'https://evil.example/en/World/Elections/History.aspx?LeagueID=125' },
    { edition: 19 }, { winnerUserId: 0 }, { rowText: '' }, { votes: '3 (50%)' }]) {
    assert.equal(electionEvidenceSchema.safeParse({ ...evidence, ...changes }).success, false);
  }
});

test('tuple distinguishes brackets, editions, host, vote text, and null versus empty votes', () => {
  for (const changed of [{ isYouth: false }, { edition: 19 }, { host: 'Ireland' }, { votes: null }, { votes: '' }]) {
    assert.notEqual(electionKey(evidence), electionKey({ ...evidence, ...changed }));
  }
});

test('default recovery dry run reads only the exact tuple and never writes', async (t) => {
  const db = setup(t);
  const result = await recoverElections([evidence]);
  assert.equal(result.dryRun, true);
  assert.equal(result.counts.ready, 1);
  assert.deepEqual(db.read.mock.calls[0]?.arguments, [{ where: { leagueId: 125, isYouth: true, edition: 18, host: 'Suomi', votes: '4 (67%)' } }]);
  assert.equal(db.user.mock.callCount() + db.write.mock.callCount() + db.remove.mock.callCount(), 0);
});

test('apply fills null and zero only and preserves existing user metadata/current login', async (t) => {
  for (const winnerUserId of [null, 0]) await t.test(String(winnerUserId), async (child) => {
    setup(child, [{ ...stored, winnerUserId }]);
    mock(child, prisma.hattrickUser, 'upsert', async (args) => {
      assert.deepEqual(args.update, {});
      assert.deepEqual(args.create, { userId: evidence.winnerUserId, loginName: 'Noris' });
      return { loginName: 'Current login', nationality: 'Italia', isBot: false };
    });
    mock(child, prisma.nationalCoachElection, 'updateMany', async (args) => {
      assert.deepEqual(args.where, { id: 9012, leagueId: 125, isYouth: true, edition: 18, host: 'Suomi', votes: '4 (67%)', winnerUserId });
      assert.deepEqual(args.data, { winnerUserId: evidence.winnerUserId, winnerUserName: 'Current login' });
      return { count: 1 };
    });
    assert.equal((await recoverElections([evidence], { apply: true })).counts.applied, 1);
  });
});

test('identical repeat-election tuples are ambiguous, never collapsed or arbitrarily filled', async (t) => {
  setup(t, [stored, { ...stored, id: 2 }]);
  assert.equal((await processElectionRecovery(prisma, [evidence], true)).counts.ambiguous, 1);
});

test('absent election rows are not created by the recovery path', async (t) => {
  setup(t, []);
  assert.equal((await processElectionRecovery(prisma, [evidence], true)).counts.missingRows, 1);
});

test('same-user replay is unchanged and conflicting established owners are protected', async (t) => {
  for (const [winnerUserId, status] of [[evidence.winnerUserId, 'alreadyAttributed'], [42, 'conflicts']] as const) {
    await t.test(status, async (child) => {
      setup(child, [{ ...stored, winnerUserId }]);
      assert.equal((await processElectionRecovery(prisma, [evidence], true)).counts[status], 1);
    });
  }
});

test('conflicting evidence is rejected before any DB lookup', async (t) => {
  const db = setup(t);
  const conflicting = { ...evidence, winnerUserId: 42, winnerHref: '/Club/Manager/?userId=42' };
  assert.equal((await processElectionRecovery(prisma, [evidence, conflicting])).counts.conflicts, 1);
  assert.equal(db.read.mock.callCount(), 0);
});

test('concurrent updates abort the enclosing recovery transaction', async (t) => {
  setup(t);
  mock(t, prisma.hattrickUser, 'upsert', async () => ({ loginName: 'Noris' }));
  mock(t, prisma.nationalCoachElection, 'updateMany', async () => ({ count: 0 }));
  await assert.rejects(processElectionRecovery(prisma, [evidence], true), /transaction must roll back/);
});

test('partial election ingest cannot delete or insert rows', async (t) => {
  const db = setup(t, []);
  assert.equal(await ingestElections([input]), 0);
  assert.equal(db.insert.mock.callCount() + db.remove.mock.callCount(), 0);
});

test('partial ingest cannot falsely resolve one occurrence of an incomplete repeat-election tuple', async (t) => {
  const db = setup(t);
  assert.equal(await ingestElections([input]), 0);
  assert.equal(db.write.mock.callCount() + db.user.mock.callCount(), 0);
});

test('partial or former-user scrapes cannot erase a known election winner or user metadata', async (t) => {
  const db = setup(t, [{ ...stored, winnerUserId: 42, winnerUserName: 'Historic' }]);
  assert.equal(await ingestElections([{ ...input, winnerUserId: null, winnerUserName: null }]), 1);
  assert.equal(await ingestElections([input], { complete: true }), 1);
  assert.equal(db.write.mock.callCount() + db.user.mock.callCount() + db.remove.mock.callCount(), 0);
});

test('complete snapshot may append distinct re-election tuples without deleting existing rows', async (t) => {
  const db = setup(t, []);
  mock(t, prisma.hattrickUser, 'upsert', async () => ({ loginName: 'Noris' }));
  const creates = mock(t, prisma.nationalCoachElection, 'create', async () => ({}));
  assert.equal(await ingestElections([input, { ...input, votes: '2 (50%)' }], { complete: true }), 2);
  assert.equal(creates.mock.callCount(), 2);
  assert.equal(db.remove.mock.callCount(), 0);
});

test('source and stored ambiguous re-election tuples are left untouched during ingest', async (t) => {
  const db = setup(t);
  assert.equal(await ingestElections([input, { ...input }], { complete: true }), 0);
  assert.equal(db.read.mock.callCount(), 0);
  mock(t, prisma.nationalCoachElection, 'findMany', async () => [stored, { ...stored, id: 2 }]);
  assert.equal(await ingestElections([input], { complete: true }), 0);
});

test('empty-country sentinel never deletes existing elections', async (t) => {
  const db = setup(t);
  assert.equal(await ingestElections([{ ...input, edition: 0 }], { complete: true }), 0);
  assert.equal(db.read.mock.callCount() + db.remove.mock.callCount(), 0);
});

test('ingest exact missing winner uses current login and optimistic identity guard', async (t) => {
  setup(t);
  mock(t, prisma.hattrickUser, 'upsert', async (args) => { assert.deepEqual(args.update, {}); return { loginName: 'Current login' }; });
  mock(t, prisma.nationalCoachElection, 'updateMany', async (args) => {
    assert.equal(args.where.id, stored.id); assert.equal(args.where.winnerUserId, null);
    assert.equal(args.data.winnerUserName, 'Current login'); return { count: 1 };
  });
  assert.equal(await ingestElections([input], { complete: true }), 1);
});

const capture: ElectionCapture = { leagueId: evidence.leagueId, sourceURL: evidence.sourceURL, complete: true, rows: [evidence] };
test('a former-user occurrence colliding with a live winner is source-ambiguous before positive filtering', async (t) => {
  const db = setup(t);
  const repeated = { ...capture, rows: [evidence, { ...evidence, winnerUserId: null, winnerUserName: null,
    winnerHref: null, rowText: 'World Cup 18 Suomi A former user 4 (67%)' }] };
  const result = await recoverElectionCaptures([repeated], { apply: true });
  assert.equal(result.counts.sourceAmbiguous, 1);
  assert.equal(result.counts.applied, 0);
  assert.equal(db.read.mock.callCount() + db.write.mock.callCount(), 0);
});

test('incomplete snapshots never imply that an occurrence is unique', () => {
  const result = prepareElectionCaptures([{ ...capture, complete: false }]);
  assert.equal(result.evidence.length, 0);
  assert.equal(result.incomplete.length, 1);
});

test('unique complete snapshots retain verified profile links and source occurrence count', () => {
  const result = prepareElectionCaptures([capture]);
  assert.equal(result.evidence[0]?.sourceTupleOccurrences, 1);
  assert.equal(result.evidence[0]?.winnerUserId, evidence.winnerUserId);
});

test('an ambiguous later snapshot blocks a candidate from an earlier apparently unique snapshot', () => {
  const result = prepareElectionCaptures([capture, { ...capture, rows: [evidence, evidence] }]);
  assert.equal(result.evidence.length, 0);
  assert.equal(result.ambiguities.length, 1);
});
