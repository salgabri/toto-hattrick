import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { prisma } from '../db/client.js';
import { applyVerifiedWinners, planVerifiedWinner, processVerifiedWinners, verifiedWinnerSchema,
  type VerifiedWinner, type WinnerIdentity } from './verifiedWinners.js';

const evidence: VerifiedWinner = {
  table: 'cupChampion', competitionId: 183, season: 81, teamId: 1629842, teamName: 'DarthFenuz',
  userId: 11898902, name: 'Historical alias', sources: ['https://www.hattrick.org/en/Community/Press/?ArticleID=22809'],
  evidence: 'Direct post-title interview linking this user and exact club/season.',
};
const identity: WinnerIdentity = {
  table: 'cupChampion', competitionId: 183, season: 81, championTeamId: 1629842,
  championTeamName: 'DarthFenuz', championUserId: null,
};
const restoredMethods = new WeakMap<TestContext, Map<object, Set<string>>>();

function mockDbMethod(t: TestContext, delegate: object, method: string, fn: (...args: any[]) => unknown) {
  const target = delegate as Record<string, unknown>;
  const delegates = restoredMethods.get(t) ?? new Map<object, Set<string>>();
  const methods = delegates.get(delegate) ?? new Set<string>();
  if (!methods.has(method)) {
    const original = target[method];
    t.after(() => { target[method] = original; });
    methods.add(method);
    delegates.set(delegate, methods);
    restoredMethods.set(t, delegates);
  }
  const replacement = t.mock.fn(fn);
  target[method] = replacement;
  return replacement;
}

function mockDb(t: TestContext, row: Record<string, unknown> | null = {}) {
  const current = row === null ? null : { ...identity, cupId: identity.competitionId, ...row };
  const cupRead = mockDbMethod(t, prisma.cupChampion, 'findUnique', async () => current);
  const leagueRead = mockDbMethod(t, prisma.leagueChampion, 'findUnique', async () => current);
  const unexpectedWrite = async () => { throw new Error('Unexpected DB mutation'); };
  const cupWrite = mockDbMethod(t, prisma.cupChampion, 'updateMany', unexpectedWrite);
  const leagueWrite = mockDbMethod(t, prisma.leagueChampion, 'updateMany', unexpectedWrite);
  const userWrite = mockDbMethod(t, prisma.hattrickUser, 'upsert', unexpectedWrite);
  return { cupRead, leagueRead, cupWrite, leagueWrite, userWrite };
}

test('exact title proof fills both null and the old unresolved zero sentinel', () => {
  for (const championUserId of [null, 0]) {
    assert.equal(planVerifiedWinner(evidence, { ...identity, championUserId }).action, 'fill');
  }
});

test('lost cached team IDs are allowed only alongside exact competition, season, and name', () => {
  for (const championTeamId of [null, 0]) {
    assert.equal(planVerifiedWinner(evidence, { ...identity, championTeamId }).action, 'fill');
    assert.equal(planVerifiedWinner(evidence, { ...identity, championTeamId, season: 82 }).action, 'conflict');
  }
});

test('rejects another competition, season, club, recycled numeric team ID, or negative owner', () => {
  for (const changes of [
    { table: 'leagueChampion' as const }, { competitionId: 198 }, { season: 82 },
    { championTeamName: 'darthfenuz' }, { championTeamId: 999 }, { championTeamId: -1 }, { championUserId: -1 },
  ]) assert.equal(planVerifiedWinner(evidence, { ...identity, ...changes }).action, 'conflict');
});

test('never overwrites an established historical owner and is idempotent for the same owner', () => {
  assert.equal(planVerifiedWinner(evidence, { ...identity, championUserId: 123 }).reason, 'existingHistoricalOwner');
  assert.equal(planVerifiedWinner(evidence, { ...identity, championUserId: evidence.userId }).action, 'unchanged');
});

test('league titles must be marked complete', () => {
  const league = { ...evidence, table: 'leagueChampion' as const };
  const target = { ...identity, table: 'leagueChampion' as const };
  assert.equal(planVerifiedWinner(league, { ...target, complete: false }).reason, 'unfinishedLeague');
  assert.equal(planVerifiedWinner(league, target).reason, 'unfinishedLeague');
  assert.equal(planVerifiedWinner(league, { ...target, complete: true }).action, 'fill');
});

test('requires positive numeric identities, evidence, URLs, and a supported table', () => {
  for (const changes of [{ userId: 0 }, { teamId: 0 }, { teamLeagueId: 0 }, { teamLeagueId: -1 }, { season: 0 }, { sources: [] },
    { sources: ['file:///secret'] }, { evidence: ' ' }, { name: '' }, { table: 'worldCupChampion' }]) {
    assert.equal(verifiedWinnerSchema.safeParse({ ...evidence, ...changes }).success, false);
  }
});

test('default dry run performs no user or winner writes and uses the exact composite key', async (t) => {
  const mocked = mockDb(t);
  const result = await applyVerifiedWinners([evidence]);
  assert.equal(result.dryRun, true);
  assert.equal(result.wouldApply, 1);
  assert.equal(result.applied, 0);
  assert.deepEqual(mocked.cupRead.mock.calls[0]?.arguments, [{ where: { cupId_season: { cupId: 183, season: 81 } } }]);
  assert.equal(mocked.leagueRead.mock.callCount(), 0);
  assert.equal(mocked.cupWrite.mock.callCount() + mocked.userWrite.mock.callCount(), 0);
});

test('missing exact row is reported without creating a title', async (t) => {
  mockDb(t, null);
  const result = await processVerifiedWinners(prisma, [evidence], true);
  assert.equal(result.missingRows, 1);
  assert.equal(result.applied, 0);
});

test('conflicting evidence for the same title is rejected before any DB lookup', async (t) => {
  const mocked = mockDb(t);
  const result = await processVerifiedWinners(prisma, [evidence, { ...evidence, userId: 999 }], true);
  assert.equal(result.conflicts, 2);
  assert.equal(mocked.cupRead.mock.callCount(), 0);
});

test('identical duplicate evidence produces only one candidate', async (t) => {
  const mocked = mockDb(t);
  const result = await processVerifiedWinners(prisma, [evidence, { ...evidence }]);
  assert.equal(result.duplicates, 1);
  assert.equal(result.wouldApply, 1);
  assert.equal(mocked.cupRead.mock.callCount(), 1);
});

test('duplicate evidence retains known team IDs rather than weakening identity validation', async (t) => {
  mockDb(t, { championTeamId: 999 });
  const withoutId = { ...evidence };
  delete withoutId.teamId;
  const result = await processVerifiedWinners(prisma, [withoutId, evidence]);
  assert.equal(result.conflicts, 1);
  assert.equal(result.wouldApply, 0);
  assert.equal(result.results.at(-1)?.reason, 'teamIdMismatch');
});

test('apply preserves current manager metadata and writes only attribution under an optimistic guard', async (t) => {
  mockDb(t, { championUserId: 0 });
  const user = { userId: evidence.userId, loginName: 'Current login', nationality: 'Italy', countryId: 4, isBot: true };
  const before = { ...user };
  const upsert = mockDbMethod(t, prisma.hattrickUser, 'upsert', async (args) => {
    assert.deepEqual(args.update, {});
    assert.deepEqual(args.create, { userId: evidence.userId, loginName: evidence.name });
    return user;
  });
  const update = mockDbMethod(t, prisma.cupChampion, 'updateMany', async (args) => {
    assert.deepEqual(args.where, { cupId: 183, season: 81, championTeamId: 1629842,
      championTeamName: 'DarthFenuz', championUserId: 0 });
    assert.deepEqual(args.data, { championUserId: evidence.userId, championUserName: 'Current login' });
    return { count: 1 };
  });
  const result = await processVerifiedWinners(prisma, [evidence], true);
  assert.equal(result.applied, 1);
  assert.equal(upsert.mock.callCount(), 1);
  assert.equal(update.mock.callCount(), 1);
  assert.deepEqual(user, before);
});

test('established conflicting owners are reported without touching users', async (t) => {
  const mocked = mockDb(t, { championUserId: 999 });
  const result = await processVerifiedWinners(prisma, [evidence], true);
  assert.equal(result.conflicts, 1);
  assert.equal(mocked.userWrite.mock.callCount(), 0);
});

test('league apply restores an exact source team ID with the non-null league schema and no country inference', async (t) => {
  mockDb(t);
  const source = { ...evidence, table: 'leagueChampion' as const, competitionId: 47 };
  mockDbMethod(t, prisma.leagueChampion, 'findUnique', async (args) => {
    assert.deepEqual(args.where, { leagueId_season: { leagueId: 47, season: 81 } });
    return { leagueId: 47, season: 81, complete: true, championTeamId: 0,
      championTeamName: source.teamName, championUserId: null };
  });
  mockDbMethod(t, prisma.hattrickUser, 'upsert', async () => ({ loginName: source.name }));
  mockDbMethod(t, prisma.leagueChampion, 'updateMany', async (args) => {
    assert.deepEqual(args.where, { leagueId: 47, season: 81, complete: true, championTeamId: 0,
      championTeamName: source.teamName, championUserId: null });
    assert.deepEqual(args.data, { championUserId: source.userId, championUserName: source.name, championTeamId: source.teamId });
    return { count: 1 };
  });
  const result = await processVerifiedWinners(prisma, [source], true);
  assert.equal(result.applied, 1);
  assert.equal(result.teamIdsRestored, 1);
});

test('cup apply restores source team IDs for both null and zero cache sentinels', async (t) => {
  for (const championTeamId of [null, 0]) {
    await t.test(`sentinel ${championTeamId}`, async (child) => {
      mockDb(child, { championTeamId });
      mockDbMethod(child, prisma.hattrickUser, 'upsert', async () => ({ loginName: evidence.name }));
      mockDbMethod(child, prisma.cupChampion, 'updateMany', async (args) => {
        assert.equal(args.where.championTeamId, championTeamId);
        assert.deepEqual(args.data, { championUserId: evidence.userId, championUserName: evidence.name,
          championTeamId: evidence.teamId });
        return { count: 1 };
      });
      const result = await processVerifiedWinners(prisma, [evidence], true);
      assert.equal(result.teamIdsRestored, 1);
      assert.equal(result.results[0]?.restoredTeamId, evidence.teamId);
    });
  }
});

test('dry run reports recoverable team IDs without writing them', async (t) => {
  mockDb(t, { championTeamId: null });
  const result = await processVerifiedWinners(prisma, [evidence]);
  assert.equal(result.teamIdsToRestore, 1);
  assert.equal(result.teamIdsRestored, 0);
  assert.equal(result.results[0]?.restoredTeamId, evidence.teamId);
});

test('a title already attributed to the verified owner can recover only its missing team ID', async (t) => {
  const mocked = mockDb(t, { championTeamId: null, championUserId: evidence.userId });
  mockDbMethod(t, prisma.cupChampion, 'updateMany', async (args) => {
    assert.deepEqual(args.data, { championTeamId: evidence.teamId });
    assert.equal(args.where.championUserId, evidence.userId);
    return { count: 1 };
  });
  const result = await processVerifiedWinners(prisma, [evidence], true);
  assert.equal(result.teamIdsRestored, 1);
  assert.equal(mocked.userWrite.mock.callCount(), 0);
});

test('evidence without a numeric club identity does not invent one', async (t) => {
  mockDb(t, { championTeamId: null });
  const source = { ...evidence };
  delete source.teamId;
  mockDbMethod(t, prisma.hattrickUser, 'upsert', async () => ({ loginName: source.name }));
  mockDbMethod(t, prisma.cupChampion, 'updateMany', async (args) => {
    assert.deepEqual(args.data, { championUserId: source.userId, championUserName: source.name });
    return { count: 1 };
  });
  assert.equal((await processVerifiedWinners(prisma, [source], true)).teamIdsRestored, 0);
});

test('international country-only recovery handles both sentinels without changing the manager', async (t) => {
  for (const championLeagueId of [null, 0]) {
    await t.test(`country ${championLeagueId}`, async (child) => {
      const mocked = mockDb(child, { leagueId: 0, championLeagueId, championUserId: evidence.userId });
      mockDbMethod(child, prisma.cupChampion, 'updateMany', async (args) => {
        assert.deepEqual(args.data, { championLeagueId: 4 });
        assert.equal(args.where.leagueId, 0);
        assert.equal(args.where.championLeagueId, championLeagueId);
        assert.equal(args.where.championUserId, evidence.userId);
        assert.equal(args.where.championTeamId, evidence.teamId);
        return { count: 1 };
      });
      const result = await processVerifiedWinners(prisma, [{ ...evidence, teamLeagueId: 4 }], true);
      assert.equal(result.applied, 1);
      assert.equal(result.teamCountriesRestored, 1);
      assert.equal(result.results[0]?.restoredTeamLeagueId, 4);
      assert.equal(mocked.userWrite.mock.callCount(), 0);
    });
  }
});

test('country dry run reports only exact verified international country evidence', async (t) => {
  mockDb(t, { leagueId: 0, championLeagueId: 0, championUserId: evidence.userId });
  const result = await processVerifiedWinners(prisma, [{ ...evidence, teamLeagueId: 4 }]);
  assert.equal(result.wouldApply, 1);
  assert.equal(result.teamCountriesToRestore, 1);
  assert.equal(result.teamCountriesRestored, 0);
  assert.equal(result.results[0]?.reason, 'verifiedExactTitleCountry');
});

test('known positive international country conflicts reject the whole title without writes', async (t) => {
  const mocked = mockDb(t, { leagueId: 0, championLeagueId: 9 });
  const result = await processVerifiedWinners(prisma, [{ ...evidence, teamLeagueId: 4 }], true);
  assert.equal(result.conflicts, 1);
  assert.equal(result.results[0]?.reason, 'teamCountryMismatch');
  assert.equal(mocked.userWrite.mock.callCount(), 0);
});

test('matching positive international countries are preserved and replay is idempotent', async (t) => {
  mockDb(t, { leagueId: 0, championLeagueId: 4, championUserId: evidence.userId });
  const result = await processVerifiedWinners(prisma, [{ ...evidence, teamLeagueId: 4 }], true);
  assert.equal(result.unchanged, 1);
  assert.equal(result.teamCountriesRestored, 0);
});

test('domestic cup rows never receive champion-country writes or manager nationality inference', async (t) => {
  mockDb(t, { leagueId: 4, championLeagueId: null });
  mockDbMethod(t, prisma.hattrickUser, 'upsert', async (args) => {
    assert.deepEqual(args.create, { userId: evidence.userId, loginName: evidence.name });
    assert.deepEqual(args.update, {});
    return { loginName: evidence.name };
  });
  mockDbMethod(t, prisma.cupChampion, 'updateMany', async (args) => {
    assert.deepEqual(args.data, { championUserId: evidence.userId, championUserName: evidence.name });
    return { count: 1 };
  });
  const result = await processVerifiedWinners(prisma, [{ ...evidence, teamLeagueId: 4 }], true);
  assert.equal(result.applied, 1);
  assert.equal(result.teamCountriesRestored, 0);
});

test('conflicting duplicate country evidence is rejected before any lookup', async (t) => {
  const mocked = mockDb(t);
  const result = await processVerifiedWinners(prisma, [{ ...evidence, teamLeagueId: 4 }, { ...evidence, teamLeagueId: 9 }]);
  assert.equal(result.conflicts, 2);
  assert.equal(mocked.cupRead.mock.callCount(), 0);
});

test('duplicate evidence retains a country missing from the first source', async (t) => {
  mockDb(t, { leagueId: 0, championLeagueId: null, championUserId: evidence.userId });
  const result = await processVerifiedWinners(prisma, [evidence, { ...evidence, teamLeagueId: 4 }]);
  assert.equal(result.duplicates, 1);
  assert.equal(result.teamCountriesToRestore, 1);
});

test('concurrent identity changes abort the enclosing transaction', async (t) => {
  mockDb(t);
  mockDbMethod(t, prisma.hattrickUser, 'upsert', async () => ({ loginName: 'Current login' }));
  mockDbMethod(t, prisma.cupChampion, 'updateMany', async () => ({ count: 0 }));
  await assert.rejects(processVerifiedWinners(prisma, [evidence], true), /must be rolled back/);
});

test('explicit apply uses the shared Prisma interactive transaction', async (t) => {
  mockDb(t, { championUserId: evidence.userId });
  const transaction = mockDbMethod(t, prisma, '$transaction', async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
  const result = await applyVerifiedWinners([evidence], { apply: true });
  assert.equal(transaction.mock.callCount(), 1);
  assert.equal(result.unchanged, 1);
});
