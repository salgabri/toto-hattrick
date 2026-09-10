import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../db/client.js';
import { ingestWorldCupHistory, type WorldCupEdition } from './worldCup.js';
import { ingestNtCupSeasons, type NtCupSeason } from './ntCups.js';

/** Exercise the real Prisma transaction/read/create/update integration against an isolated DB.
 * The application singleton's sole entry point here is redirected before any ingest is called. */
async function isolated(t: TestContext) {
  const tempRoot = resolve(tmpdir());
  const folder = await mkdtemp(join(tempRoot, 'hattrick-podium-test-'));
  const db = new PrismaClient({ datasources: { db: { url: `file:${join(folder, 'podium.sqlite').replaceAll('\\', '/')}` } } });
  const original = prisma.$transaction;
  const target = prisma as unknown as { $transaction: unknown };
  target.$transaction = db.$transaction.bind(db);
  t.after(async () => {
    target.$transaction = original;
    await db.$disconnect();
    // Only the exact fresh test directory is eligible for recursive removal.
    const exact = resolve(folder);
    assert.equal(dirname(exact), tempRoot);
    assert.ok(basename(exact).startsWith('hattrick-podium-test-'));
    await rm(exact, { recursive: true });
  });
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Ingest integration test must not call network'); });
  await db.$executeRawUnsafe(`CREATE TABLE WorldCupChampion (
    isYouth BOOLEAN NOT NULL DEFAULT false, edition INTEGER NOT NULL, ageGroup TEXT,
    host TEXT NOT NULL, finishedDate TEXT, champion TEXT, runnerUp TEXT,
    thirdFourth TEXT NOT NULL DEFAULT '', championUserId INTEGER, championUserName TEXT,
    runnerUpUserId INTEGER, thirdFourthUserIds TEXT NOT NULL DEFAULT '',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (isYouth, edition))`);
  await db.$executeRawUnsafe(`CREATE TABLE NationalCupChampion (
    cupId INTEGER NOT NULL, season INTEGER NOT NULL, cupName TEXT NOT NULL,
    isYouth BOOLEAN NOT NULL DEFAULT false, host TEXT NOT NULL DEFAULT '', finalDate TEXT,
    startedDate TEXT, status TEXT, champion TEXT, runnerUp TEXT, thirdFourth TEXT NOT NULL DEFAULT '',
    championTeamId INTEGER, championLeagueId INTEGER, runnerUpTeamId INTEGER, runnerUpLeagueId INTEGER,
    thirdFourthTeamIds TEXT NOT NULL DEFAULT '', thirdFourthLeagueIds TEXT NOT NULL DEFAULT '',
    championUserId INTEGER, championUserName TEXT, runnerUpUserId INTEGER,
    thirdFourthUserIds TEXT NOT NULL DEFAULT '', createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (cupId, season))`);
  return db;
}
const wc = (overrides: Partial<WorldCupEdition> = {}): WorldCupEdition => ({
  edition: 12, ageGroup: 'U21', host: 'England', finished: '15.01.2006', champion: 'Sverige',
  runnerUp: 'England', thirdFourth: ['Hong Kong, China', 'Malta'], ...overrides,
});
const regional = (overrides: Partial<NtCupSeason> = {}): NtCupSeason => ({
  cupId: 4878483, season: 33, cupName: 'Loading...', status: 'Finished', finalDate: '15-01-2006',
  host: 'England', champion: 'U21 Sverige', championTeamId: 3041, championLeagueId: 1,
  runnerUp: 'U21 England', runnerUpTeamId: 3042, runnerUpLeagueId: 2,
  thirdFourth: ['U21 Hong Kong, China', 'U21 Malta'], thirdFourthTeamIds: [3103, 3175], thirdFourthLeagueIds: [59, 101], ...overrides,
});
async function seedRegional(db: PrismaClient, extra: Record<string, unknown> = {}) {
  await ingestNtCupSeasons([regional()]);
  await db.nationalCupChampion.update({ where: { cupId_season: { cupId: 4878483, season: 33 } }, data: {
    championUserId: 11, championUserName: 'Known champion', runnerUpUserId: 22, thirdFourthUserIds: '33,44', ...extra,
  } });
  return db.nationalCupChampion.findUniqueOrThrow({ where: { cupId_season: { cupId: 4878483, season: 33 } } });
}

test('World Cup partial refresh preserves every known podium fact and coach in SQLite', async (t) => {
  const db = await isolated(t);
  await ingestWorldCupHistory({ senior: [], youth: [wc()] });
  await db.worldCupChampion.update({ where: { isYouth_edition: { isYouth: true, edition: 12 } }, data: { championUserId: 11, championUserName: 'Known champion', runnerUpUserId: 22, thirdFourthUserIds: '33,44' } });
  const before = await db.worldCupChampion.findUniqueOrThrow({ where: { isYouth_edition: { isYouth: true, edition: 12 } } });
  const result = await ingestWorldCupHistory({ senior: [], youth: [wc({ ageGroup: undefined, host: '', finished: null, champion: null, runnerUp: null, thirdFourth: [] })] });
  assert.equal(result.conflicts, 0);
  assert.deepEqual(await db.worldCupChampion.findUniqueOrThrow({ where: { isYouth_edition: { isYouth: true, edition: 12 } } }), before);
});

test('regional partial refresh cannot clear completion, identities, or medals in SQLite', async (t) => {
  const db = await isolated(t), before = await seedRegional(db);
  const result = await ingestNtCupSeasons([{ cupId: 4878483, season: 33, cupName: '', status: 'Ongoing', champion: null, runnerUp: null, thirdFourth: [] }]);
  assert.equal(result.conflicts, 0);
  assert.deepEqual(await db.nationalCupChampion.findUniqueOrThrow({ where: { cupId_season: { cupId: 4878483, season: 33 } } }), before);
});

test('bronze nation reorder rejects the entire WC and regional update without changing coaches', async (t) => {
  const db = await isolated(t), before = await seedRegional(db);
  await ingestWorldCupHistory({ senior: [], youth: [wc()] });
  await db.worldCupChampion.update({ where: { isYouth_edition: { isYouth: true, edition: 12 } }, data: { thirdFourthUserIds: '33,44' } });
  const wcBefore = await db.worldCupChampion.findUniqueOrThrow({ where: { isYouth_edition: { isYouth: true, edition: 12 } } });
  const wcResult = await ingestWorldCupHistory({ senior: [], youth: [wc({ thirdFourth: ['Malta', 'Hong Kong, China'] })] });
  const ntResult = await ingestNtCupSeasons([regional({ thirdFourth: ['U21 Malta', 'U21 Hong Kong, China'], thirdFourthTeamIds: [3175, 3103], thirdFourthLeagueIds: [101, 59], startedDate: '01-01-2006' })]);
  assert.equal(wcResult.conflicts, 1); assert.equal(ntResult.conflicts, 1);
  assert.deepEqual(await db.worldCupChampion.findUniqueOrThrow({ where: { isYouth_edition: { isYouth: true, edition: 12 } } }), wcBefore);
  assert.deepEqual(await db.nationalCupChampion.findUniqueOrThrow({ where: { cupId_season: { cupId: 4878483, season: 33 } } }), before);
});

test('same-name conflicting national team ID or bronze ID cannot overwrite existing identity', async (t) => {
  const db = await isolated(t), before = await seedRegional(db);
  for (const change of [{ championTeamId: 3000 }, { runnerUpTeamId: 3001 }, { thirdFourthTeamIds: [3103, 3041] }]) {
    const result = await ingestNtCupSeasons([regional(change)]);
    assert.equal(result.conflicts, 1);
    assert.deepEqual(await db.nationalCupChampion.findUniqueOrThrow({ where: { cupId_season: { cupId: 4878483, season: 33 } } }), before);
  }
});

test('sparse bronze IDs fill only aligned holes and keep coach slot positions', async (t) => {
  const db = await isolated(t);
  await ingestNtCupSeasons([regional({ thirdFourthTeamIds: [null, 3175], thirdFourthLeagueIds: [null, 101] })]);
  await db.nationalCupChampion.update({ where: { cupId_season: { cupId: 4878483, season: 33 } }, data: { thirdFourthUserIds: ',44' } });
  const result = await ingestNtCupSeasons([regional({ thirdFourthTeamIds: [3103, null], thirdFourthLeagueIds: [59, null] })]);
  assert.equal(result.conflicts, 0);
  const saved = await db.nationalCupChampion.findUniqueOrThrow({ where: { cupId_season: { cupId: 4878483, season: 33 } } });
  assert.equal(saved.thirdFourthTeamIds, '3103,3175'); assert.equal(saved.thirdFourthLeagueIds, '59,101'); assert.equal(saved.thirdFourthUserIds, ',44');
});

test('orphaned positive coach cannot be attached to a newly supplied nation', async (t) => {
  const db = await isolated(t);
  await db.worldCupChampion.create({ data: { isYouth: true, edition: 12, host: 'England', championUserId: 11 } });
  const before = await db.worldCupChampion.findUniqueOrThrow({ where: { isYouth_edition: { isYouth: true, edition: 12 } } });
  assert.equal((await ingestWorldCupHistory({ senior: [], youth: [wc()] })).conflicts, 1);
  assert.deepEqual(await db.worldCupChampion.findUniqueOrThrow({ where: { isYouth_edition: { isYouth: true, edition: 12 } } }), before);
});

test('same edition senior and youth podiums remain separate records', async (t) => {
  const db = await isolated(t);
  const result = await ingestWorldCupHistory({ senior: [wc({ ageGroup: undefined, champion: 'England' })], youth: [wc()] });
  assert.equal(result.senior, 1); assert.equal(result.youth, 1);
  const records = await db.worldCupChampion.findMany({ orderBy: { isYouth: 'asc' } });
  assert.deepEqual(records.map((r) => [r.isYouth, r.champion, r.ageGroup]), [[false, 'England', null], [true, 'Sverige', 'U21']]);
});

test('nonempty invalid dates are rejected before initial insert or a fill-only update', async (t) => {
  const db = await isolated(t);
  for (const date of ['31.02.2024', '29.02.2023', '01.13.2024', '2024-02-31', '01-01-2024 24:00', '1-1-2024', 'not a date']) {
    assert.equal((await ingestWorldCupHistory({ senior: [wc({ finished: date })], youth: [] })).conflicts, 1);
    assert.equal((await ingestNtCupSeasons([regional({ finalDate: date })])).conflicts, 1);
    assert.equal((await ingestNtCupSeasons([regional({ startedDate: date })])).conflicts, 1);
  }
  assert.equal(await db.worldCupChampion.count(), 0);
  assert.equal(await db.nationalCupChampion.count(), 0);
  const before = await seedRegional(db);
  assert.equal((await ingestNtCupSeasons([regional({ startedDate: '31-02-2024 20:00' })])).conflicts, 1);
  assert.deepEqual(await db.nationalCupChampion.findUniqueOrThrow({ where: { cupId_season: { cupId: 4878483, season: 33 } } }), before);
});

test('actual dotted WC and hyphenated timed NT formats accept leap days and ignore empty supplied dates', async (t) => {
  const db = await isolated(t);
  assert.equal((await ingestWorldCupHistory({ senior: [wc({ finished: '29.02.2004' })], youth: [] })).senior, 1);
  assert.equal((await ingestNtCupSeasons([regional({ startedDate: '17-04-2026 20:00', finalDate: '19-06-2026 20:00' })])).seasons, 1);
  const before = await db.nationalCupChampion.findUniqueOrThrow({ where: { cupId_season: { cupId: 4878483, season: 33 } } });
  assert.equal((await ingestNtCupSeasons([regional({ startedDate: '', finalDate: '' })])).conflicts, 0);
  const after = await db.nationalCupChampion.findUniqueOrThrow({ where: { cupId_season: { cupId: 4878483, season: 33 } } });
  assert.equal(after.startedDate, before.startedDate); assert.equal(after.finalDate, before.finalDate);
});

test('initial ID-only partial scrapes cannot create an orphan national identity', async (t) => {
  const db = await isolated(t);
  const result = await ingestNtCupSeasons([{ cupId: 4878483, season: 33, cupName: '', championTeamId: 3041 }]);
  assert.equal(result.conflicts, 1);
  assert.equal(await db.nationalCupChampion.count(), 0);
});
