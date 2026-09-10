import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { prisma } from '../db/client.js';
import { applyReviewedCorrections, planReviewedCorrection, processReviewedCorrections,
  reviewedCorrectionSchema, type CorrectionTarget, type ReviewedCorrection } from './reviewedCorrections.js';

const manifest: ReviewedCorrection[] = JSON.parse(readFileSync(new URL('../../src/data/reviewed-winner-corrections.json', import.meta.url), 'utf8'));
const source = manifest[0]!;
const target = (record = source): CorrectionTarget => ({
  cupId: record.competitionId, season: record.season, leagueId: record.leagueId,
  championTeamId: record.expectedPriorTeamId, championTeamName: record.teamName,
  championUserId: record.expectedPriorUserId, championUserName: 'Chapeaux',
});
function fixture(rows: CorrectionTarget[] = manifest.map((record) => target(record)), changedCount = 1) {
  const reads: unknown[] = [], updates: any[] = [], users: any[] = [];
  const db = {
    cupChampion: {
      findUnique: async (args: any) => {
        reads.push(args);
        const key = args.where.cupId_season;
        return rows.find((row) => row.cupId === key.cupId && row.season === key.season) ?? null;
      },
      updateMany: async (args: any) => { updates.push(args); return { count: changedCount }; },
    },
    hattrickUser: { upsert: async (args: any) => {
      users.push(args);
      return { userId: source.userId, loginName: 'CurrentLogin', nationality: 'Italy', isBot: false };
    } },
  } as unknown as Parameters<typeof processReviewedCorrections>[0];
  return { db, reads, updates, users };
}

test('reviewed manifest is exactly the four Ghana titles with direct evidence and explicit prior identity', () => {
  assert.deepEqual(manifest.map((row) => [row.competitionId, row.season]), [[198, 28], [198, 29], [758, 34], [887, 33]]);
  for (const row of manifest) {
    assert.equal(reviewedCorrectionSchema.safeParse(row).success, true);
    assert.equal(row.expectedPriorUserId, 1741737);
    assert.equal(row.expectedPriorTeamId, null);
    assert.equal(row.userId, 11687578);
    assert.equal(row.teamId, 1832842);
    assert.equal(row.leagueId, 137);
  }
});

test('schema rejects missing/zero prior identity and unrelated or unlinked direct trophy proof', () => {
  for (const changes of [
    { expectedPriorUserId: undefined }, { expectedPriorUserId: 0 }, { expectedPriorUserId: source.userId },
    { expectedPriorTeamId: undefined }, { expectedPriorTeamId: 999 }, { table: 'leagueChampion' },
    { competitionId: 7 }, { season: 29 }, { teamId: 1726060 }, { userId: 123 }, { name: 'Chapeaux' },
    { event: { ...source.event, links: source.event.links.filter((link) => !link.href.includes('userId=')) } },
    { event: { ...source.event, sourceURL: 'https://example.com/Club/History/?teamId=1832842' } },
    { event: { ...source.event, sourceURL: 'https://www.hattrick.org/en/Club/History/?teamId=1726060' } },
  ]) assert.equal(reviewedCorrectionSchema.safeParse({ ...source, ...changes }).success, false, JSON.stringify(changes));
});

test('correcting is limited to the exact expected old owner, club, season and country', () => {
  assert.equal(planReviewedCorrection(source, target()).status, 'wouldApply');
  assert.equal(planReviewedCorrection(source, null).reason, 'missingExactRow');
  for (const changes of [
    { cupId: 7 }, { season: 29 }, { leagueId: 4 }, { championTeamName: 're picante' },
    { championTeamId: 999 }, { championTeamId: 1832842 }, { championTeamId: 0 },
    { championUserId: null }, { championUserId: 0 }, { championUserId: 123 },
  ]) assert.equal(planReviewedCorrection(source, { ...target(), ...changes }).status, 'conflict');
});

test('already corrected exact identity is idempotent but another current manager is never overwritten', () => {
  const corrected = { ...target(), championUserId: source.userId, championTeamId: source.teamId };
  assert.equal(planReviewedCorrection(source, corrected).status, 'unchanged');
  assert.equal(planReviewedCorrection(source, { ...corrected, championUserId: 999 }).status, 'conflict');
  assert.equal(planReviewedCorrection(source, { ...corrected, championTeamId: 999 }).status, 'conflict');
});

test('default runner dry-run reads exact keys without any manager or trophy writes', async () => {
  const f = fixture();
  const result = await processReviewedCorrections(f.db, manifest);
  assert.equal(result.dryRun, true);
  assert.equal(result.wouldApply, 4);
  assert.equal(result.conflicts, 0);
  assert.equal(result.applied, 0);
  assert.equal(f.reads.length, 4);
  assert.equal(f.updates.length + f.users.length, 0);
  assert.deepEqual(result.results[0]?.before, target());
  assert.deepEqual(result.results[0]?.correction.event, source.event);
});

test('one unexpected row blocks the complete apply batch before any writes', async () => {
  const rows = manifest.map((record) => target(record));
  rows[3]!.championUserId = 999;
  const f = fixture(rows);
  const result = await processReviewedCorrections(f.db, manifest, true);
  assert.equal(result.blocked, true);
  assert.equal(result.conflicts, 1);
  assert.equal(result.applied, 0);
  assert.equal(f.updates.length + f.users.length, 0);
});

test('duplicate manifest keys are rejected before reads or writes', async () => {
  const f = fixture();
  await assert.rejects(processReviewedCorrections(f.db, [source, source], true), /Duplicate reviewed correction/);
  assert.equal(f.reads.length + f.updates.length + f.users.length, 0);
});

test('apply guards every prior identity field, preserves manager metadata and restores proven team ID', async () => {
  const f = fixture();
  const result = await processReviewedCorrections(f.db, manifest, true);
  assert.equal(result.applied, 4);
  assert.equal(result.wouldApply, 0);
  assert.equal(f.updates.length, 4);
  assert.deepEqual(f.users[0], {
    where: { userId: source.userId }, create: { userId: source.userId, loginName: 'SebasM' }, update: {},
  });
  assert.deepEqual(f.updates[0], {
    where: { cupId: 198, season: 28, leagueId: 137, championTeamName: 'Re Picante',
      championTeamId: null, championUserId: 1741737, championUserName: 'Chapeaux' },
    data: { championTeamId: 1832842, championUserId: 11687578, championUserName: 'CurrentLogin' },
  });
  assert.equal(result.results[0]?.before?.championUserId, 1741737);
});

test('all already-corrected rows are a no-op, including manager records', async () => {
  const f = fixture(manifest.map((record) => ({ ...target(record), championTeamId: record.teamId, championUserId: record.userId })));
  const result = await processReviewedCorrections(f.db, manifest, true);
  assert.equal(result.unchanged, 4);
  assert.equal(result.applied, 0);
  assert.equal(f.updates.length + f.users.length, 0);
});

test('concurrent row changes throw so the enclosing transaction rolls back', async () => {
  const f = fixture(undefined, 0);
  await assert.rejects(processReviewedCorrections(f.db, manifest, true), /changed concurrently.*transaction rolled back/);
  assert.equal(f.updates.length, 1);
});

test('public apply wrapper uses one shared transaction for the entire reviewed manifest', async (t) => {
  const f = fixture();
  const original = prisma.$transaction;
  let transactions = 0;
  prisma.$transaction = (async (callback: (tx: typeof f.db) => Promise<unknown>) => {
    transactions++;
    return callback(f.db);
  }) as typeof prisma.$transaction;
  t.after(() => { prisma.$transaction = original; });
  const result = await applyReviewedCorrections(manifest, { apply: true });
  assert.equal(transactions, 1);
  assert.equal(result.applied, 4);
});
