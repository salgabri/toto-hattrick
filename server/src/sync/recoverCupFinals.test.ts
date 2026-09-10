import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import evidence from '../data/recovered-cup-final-evidence.json' with { type: 'json' };
import { prisma } from '../db/client.js';
import { applyCupFinalRecovery, planCupFinalRecovery } from './recoverCupFinals.js';

const entry = evidence.entries.find(e => e.summary.cupId === 25 && e.summary.season === 9)!;
const cup = { cupId: 25, leagueId: 24, countryName: 'Poland', cupName: 'Puchar Polski', isMain: true };
function mock(t: TestContext, object: object, method: string, implementation: (...args: any[]) => any) {
  const target = object as Record<string, unknown>;
  const old = target[method]; target[method] = implementation; t.after(() => { target[method] = old; });
}
function setup(t: TestContext) {
  mock(t, prisma.cup, 'findUnique', async () => cup);
  mock(t, prisma.cupChampion, 'findUnique', async () => null);
  mock(t, prisma.cupChampion, 'findFirst', async () => null);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Recovery is source-cache-only'); });
}

test('recovery is dry-run by default, numerically identifies the club, and does not infer a manager', async t => {
  setup(t);
  const [plan] = await planCupFinalRecovery({ entries: [entry] });
  assert.equal(plan!.status, 'ready');
  assert.equal(plan!.create!.championTeamName, 'MKS Narew Ostroleka');
  assert.ok(Number(plan!.create!.championTeamId) > 0);
  assert.equal(plan!.create!.championUserId, null);
  assert.equal(plan!.create!.championUserName, null);
  assert.equal(plan!.basis, 'aggregate');
});

test('apply checks absence and cup metadata, inserts once, and preserves a later historical attribution', async t => {
  setup(t);
  const plans = await planCupFinalRecovery({ entries: [entry] });
  let row: any = null;
  let writes = 0;
  mock(t, prisma, '$transaction', async action => action({ cup: { findUnique: async () => cup }, cupChampion: {
    findUnique: async () => row, findFirst: async () => null,
    create: async ({ data }: any) => { row = { ...data }; writes++; return row; },
  } }));
  assert.deepEqual(await applyCupFinalRecovery(plans), { inserted: 1, alreadyStored: 0 });
  row.championUserId = 12345; row.championUserName = 'Historically verified later';
  assert.deepEqual(await applyCupFinalRecovery(plans), { inserted: 0, alreadyStored: 1 });
  assert.equal(writes, 1);
  assert.equal(row.championUserId, 12345);
});

test('a changed competition or winner after dry-run aborts the guarded apply', async t => {
  for (const change of ['cup', 'winner']) await t.test(change, async child => {
    setup(child);
    const plans = await planCupFinalRecovery({ entries: [entry] });
    let writes = 0;
    mock(child, prisma, '$transaction', async action => action({ cup: { findUnique: async () => change === 'cup' ? { ...cup, leagueId: 999 } : cup }, cupChampion: {
      findUnique: async () => change === 'winner' ? { finalMatchId: 777, championTeamName: 'Another club' } : null,
      create: async () => { writes++; }, findFirst: async () => null,
    } }));
    await assert.rejects(applyCupFinalRecovery(plans), /changed/);
    assert.equal(writes, 0);
  });
});

test('duplicate evidence and existing contradictory winners cannot become recovery inserts', async t => {
  setup(t);
  await assert.rejects(planCupFinalRecovery({ entries: [entry, entry] }), /Duplicate/);
  mock(t, prisma.cupChampion, 'findUnique', async () => ({ finalMatchId: 777, championTeamId: 123, championTeamName: 'Different winner' }));
  const [plan] = await planCupFinalRecovery({ entries: [entry] });
  assert.equal(plan!.status, 'conflict');
  assert.equal(plan!.create, undefined);
});
