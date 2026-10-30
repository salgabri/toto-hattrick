import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import {
  applyPlannedClearances, CLEARANCE_DIRECTORY, committedClearanceAllowance, parseClearanceManifest, planClearances,
} from './clearances.js';
import { adoptReviewedArchive, applyReviewClearances, checkoutForReview, reviewSidecarPath } from './review.js';
import { DOMAIN_TABLES, readStatePointer, restoreSnapshot, saveSnapshot } from './snapshots.js';
import { LocalObjectStore } from './storage.js';

const TAMPE = 10520814;
const MANIFEST = `${CLEARANCE_DIRECTORY}/reviewed-attribution-clearances-test.json`;

interface Anchor { anchorUserId: number; signup: string; gapDays: number }
interface ClearanceInput {
  kind: string; table: string; competitionId: number; season: number; leagueId: number; teamName: string;
  expectedPriorTeamId: number | null; expectedPriorUserId: number; expectedPriorUserName: string | null;
  confidence: string; reason: string; reviewedAt: string | null;
  evidence: { family: string; titleLatest: string; globalSeason: number; accountNotBefore: Anchor; corroboratingAnchor: Anchor | null; ownSignupOnChain: boolean | null };
}

// Real audit rows: Tampe's account (10520814) signed up 2010-04-20, after these 2006 titles.
function leagueRecord(): ClearanceInput {
  return {
    kind: 'clear-attribution', table: 'leagueChampion', competitionId: 110, season: 3, leagueId: 110, teamName: 'Tunapuna Unit',
    expectedPriorTeamId: 0, expectedPriorUserId: TAMPE, expectedPriorUserName: 'Tampe', confidence: 'high',
    reason: 'Won by 2006-04-23 (global season 28); account 10520814 was created no earlier than 2010-04-20.',
    evidence: { family: 'league', titleLatest: '2006-04-23', globalSeason: 28,
      accountNotBefore: { anchorUserId: TAMPE, signup: '2010-04-20', gapDays: 1458 },
      corroboratingAnchor: { anchorUserId: 10502329, signup: '2010-04-16', gapDays: 1454 }, ownSignupOnChain: true },
    reviewedAt: '2026-10-30',
  };
}
function cupRecord(): ClearanceInput {
  return {
    kind: 'clear-attribution', table: 'cupChampion', competitionId: 170, season: 5, leagueId: 110, teamName: 'Tunapuna Unit',
    expectedPriorTeamId: null, expectedPriorUserId: TAMPE, expectedPriorUserName: 'Tampe', confidence: 'high',
    reason: 'Won by 2006-11-29 (global season 30); account 10520814 was created no earlier than 2010-04-20.',
    evidence: { family: 'main-cup', titleLatest: '2006-11-29', globalSeason: 30,
      accountNotBefore: { anchorUserId: TAMPE, signup: '2010-04-20', gapDays: 1238 },
      corroboratingAnchor: { anchorUserId: 10502329, signup: '2010-04-16', gapDays: 1234 }, ownSignupOnChain: true },
    reviewedAt: '2026-10-30',
  };
}
function manifest(records: ClearanceInput[] = [leagueRecord(), cupRecord()]) {
  return {
    format: 'reviewed-attribution-clearance-v1', status: 'reviewed', generatedAt: '2026-10-30T14:36:02.480Z',
    snapshot: { snapshotId: 'fixture', createdAt: '2026-10-30T13:44:58.095Z', databaseSha256: '0'.repeat(64) },
    audit: { script: 'qa/audit-pre-signup-attributions.mjs', report: 'docs/PRE_SIGNUP_ATTRIBUTION_AUDIT_2026-10-30.md',
      marginDays: 112, firstCalibratedSeason: 15 },
    effect: 'Manager pending.', guard: 'All or nothing.', records,
  };
}
const body = (document: unknown) => Buffer.from(JSON.stringify(document));

interface Fixture { directory: string; store: LocalObjectStore; etag: string; repositoryPath: string; databasePath: string }

async function fixture(t: TestContext): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'archive-clearance-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'original.db');
  const db = new DatabaseSync(source);
  for (const table of DOMAIN_TABLES.filter(name => name !== 'LeagueChampion' && name !== 'CupChampion'))
    db.exec(`CREATE TABLE "${table}" (id INTEGER PRIMARY KEY, value TEXT)`);
  db.exec(`
    CREATE TABLE LeagueChampion (leagueId INTEGER NOT NULL, season INTEGER NOT NULL, championTeamId INTEGER NOT NULL,
      championTeamName TEXT NOT NULL, championUserId INTEGER, played INTEGER NOT NULL, points INTEGER NOT NULL,
      complete BOOLEAN NOT NULL, updatedAt DATETIME NOT NULL, championUserName TEXT, PRIMARY KEY (leagueId, season));
    CREATE TABLE CupChampion (cupId INTEGER NOT NULL, season INTEGER NOT NULL, leagueId INTEGER NOT NULL,
      finalMatchId INTEGER NOT NULL, championTeamId INTEGER, championTeamName TEXT NOT NULL, runnerUpTeamName TEXT NOT NULL,
      homeGoals INTEGER NOT NULL, awayGoals INTEGER NOT NULL, penalties BOOLEAN NOT NULL, championUserId INTEGER,
      championUserName TEXT, updatedAt DATETIME NOT NULL, PRIMARY KEY (cupId, season));
    INSERT INTO LeagueChampion VALUES (110, 3, 0, 'Tunapuna Unit', ${TAMPE}, 14, 30, 1, 1, 'Tampe'),
      (110, 19, 0, 'Tunapuna Unit', ${TAMPE}, 14, 31, 1, 1, 'Tampe');
    INSERT INTO CupChampion VALUES (170, 5, 110, 0, NULL, 'Tunapuna Unit', 'Runner-up', 2, 1, 0, ${TAMPE}, 'Tampe', 1);
    CREATE TABLE UpdateSource(sourceKey TEXT PRIMARY KEY, kind TEXT NOT NULL, lastAttemptAt INTEGER, lastSuccessAt INTEGER,
      nextCheckAt INTEGER, metadataJson TEXT NOT NULL, updatedAt INTEGER NOT NULL);
    CREATE TABLE UpdateItem(id INTEGER PRIMARY KEY, sourceKey TEXT, itemKey TEXT, task TEXT, state TEXT, nextAttemptAt INTEGER,
      lastError TEXT, errorCategory TEXT, evidenceRef TEXT, completedAt INTEGER, updatedAt INTEGER);
    INSERT INTO UpdateItem VALUES (1, 'league:110', '3', 'result', 'complete', NULL, NULL, NULL, NULL, 1, 1);
  `);
  db.close();
  const store = new LocalObjectStore(join(directory, 'private'));
  const saved = await saveSnapshot({ store, databasePath: source, evidenceRefs: [], runId: 'initial', codeRevision: 'test', expectedStateEtag: null });
  const repositoryPath = join(directory, 'repo');
  await mkdir(join(repositoryPath, ...CLEARANCE_DIRECTORY.split('/')), { recursive: true });
  await mkdir(join(repositoryPath, 'qa'), { recursive: true });
  const databasePath = join(directory, 'operator.db');
  await checkoutForReview({ store, databasePath });
  return { directory, store, etag: saved.etag, repositoryPath, databasePath };
}

async function writeManifest(f: Fixture, document: unknown = manifest(), path = MANIFEST) {
  await writeFile(join(f.repositoryPath, ...path.split('/')), JSON.stringify(document));
  return path;
}

function identities(databasePath: string) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return {
      leagues: db.prepare('SELECT season, championUserId, championUserName FROM LeagueChampion ORDER BY season').all().map(row => ({ ...row })),
      cup: { ...db.prepare('SELECT championUserId, championUserName, finalMatchId FROM CupChampion').get() },
    };
  } finally { db.close(); }
}
const TAMPE_ROWS = {
  leagues: [{ season: 3, championUserId: TAMPE, championUserName: 'Tampe' }, { season: 19, championUserId: TAMPE, championUserName: 'Tampe' }],
  cup: { championUserId: TAMPE, championUserName: 'Tampe', finalMatchId: 0 },
};
const CLEARED_ROWS = {
  leagues: [{ season: 3, championUserId: 0, championUserName: null }, { season: 19, championUserId: TAMPE, championUserName: 'Tampe' }],
  cup: { championUserId: 0, championUserName: null, finalMatchId: 0 },
};

test('reviewed clearance manifests reject drafts, short or edited gaps and unsupported confidence', () => {
  assert.equal(parseClearanceManifest(body(manifest())).records.length, 2);
  assert.throws(() => parseClearanceManifest(body({ ...manifest(), format: 'proposed-attribution-clearance-v1' })), /Invalid reviewed clearance/);
  assert.throws(() => parseClearanceManifest(body(manifest([{ ...leagueRecord(), reviewedAt: null }]))), /Invalid reviewed clearance/);

  const short = leagueRecord();
  short.evidence = { ...short.evidence, titleLatest: '2010-03-11', corroboratingAnchor: null,
    accountNotBefore: { anchorUserId: TAMPE, signup: '2010-04-20', gapDays: 40 } };
  short.confidence = 'medium';
  assert.throws(() => parseClearanceManifest(body(manifest([short]))), /at least 112 days/);

  const edited = leagueRecord();
  edited.evidence.accountNotBefore.gapDays = 2000;
  assert.throws(() => parseClearanceManifest(body(manifest([edited]))), /does not match its dates/);

  const single = leagueRecord();
  single.evidence.corroboratingAnchor = null;
  assert.throws(() => parseClearanceManifest(body(manifest([single]))), /High confidence/);
  single.confidence = 'medium';
  assert.equal(parseClearanceManifest(body(manifest([single]))).records[0]?.confidence, 'medium');

  // Before global S15 the date model is uncalibrated, so the corroborating anchor needs two seasons.
  const early: ClearanceInput = { ...leagueRecord(), competitionId: 18, leagueId: 18, season: 1, teamName: 'Santiago',
    expectedPriorUserId: 78207, expectedPriorUserName: 'clown1977', confidence: 'high',
    evidence: { family: 'league', titleLatest: '2001-09-16', globalSeason: 13, ownSignupOnChain: null,
      accountNotBefore: { anchorUserId: 55874, signup: '2002-01-17', gapDays: 123 },
      corroboratingAnchor: { anchorUserId: 50832, signup: '2001-12-19', gapDays: 94 } } };
  assert.throws(() => parseClearanceManifest(body(manifest([early]))), /High confidence/);
  assert.doesNotThrow(() => parseClearanceManifest(body(manifest([{ ...early, confidence: 'medium' }]))));

  const above = leagueRecord();
  above.expectedPriorUserId = TAMPE - 1;
  assert.throws(() => parseClearanceManifest(body(manifest([above]))), /at or below the credited user ID/);
  const family = leagueRecord();
  family.evidence.family = 'main-cup';
  assert.throws(() => parseClearanceManifest(body(manifest([family]))), /table and title family/);
  assert.throws(() => parseClearanceManifest(body(manifest([leagueRecord(), leagueRecord()]))), /Duplicate reviewed clearance league:110:3/);
});

test('update clear dry-runs, then applies all-or-nothing and binds the manifest to the checkout', async t => {
  const f = await fixture(t);
  const manifestPath = await writeManifest(f);
  const options = { databasePath: f.databasePath, repositoryPath: f.repositoryPath, manifestPath };
  const dry = await applyReviewClearances(options);
  assert.deepEqual([dry.dryRun, dry.wouldApply, dry.applied, dry.conflicts], [true, 2, 0, 0]);
  assert.deepEqual(identities(f.databasePath), TAMPE_ROWS, 'A dry run changes nothing');
  await assert.rejects(applyReviewClearances({ ...options, apply: true }), /--report/);

  const report = join(f.directory, 'clear-applied.json');
  const applied = await applyReviewClearances({ ...options, apply: true, reportPath: report });
  assert.deepEqual([applied.dryRun, applied.applied, applied.unchanged, applied.conflicts], [false, 2, 0, 0]);
  assert.deepEqual(identities(f.databasePath), CLEARED_ROWS, 'Only the listed credits become manager pending; the cup stays a settled result');
  const sidecar = JSON.parse(await readFile(reviewSidecarPath(f.databasePath), 'utf8'));
  assert.equal(sidecar.clearanceManifests.length, 1);
  assert.equal(sidecar.clearanceManifests[0].path, MANIFEST);
  assert.equal(JSON.parse(await readFile(report, 'utf8')).results.length, 2);
  await assert.rejects(applyReviewClearances({ ...options, apply: true, reportPath: report }), /EEXIST/, 'An audit report is never overwritten');

  const again = await applyReviewClearances({ ...options, apply: true, reportPath: join(f.directory, 'clear-again.json') });
  assert.deepEqual([again.applied, again.unchanged, again.conflicts], [0, 2, 0], 'Re-applying the same manifest is a no-op');
  await writeManifest(f, manifest([leagueRecord()]), `${CLEARANCE_DIRECTORY}/reviewed-attribution-clearances-overlap.json`);
  await assert.rejects(applyReviewClearances({ ...options, manifestPath: `${CLEARANCE_DIRECTORY}/reviewed-attribution-clearances-overlap.json` }),
    /already lists league:110:3/);
});

test('one stale prior identity blocks the whole clearance batch', async t => {
  const f = await fixture(t);
  const stale = cupRecord();
  stale.expectedPriorUserId = 13356038;
  const manifestPath = await writeManifest(f, manifest([leagueRecord(), stale]));
  const result = await applyReviewClearances({ databasePath: f.databasePath, repositoryPath: f.repositoryPath, manifestPath,
    apply: true, reportPath: join(f.directory, 'blocked.json') });
  assert.equal(result.blocked, true);
  assert.equal(result.applied, 0);
  assert.deepEqual(result.conflictExamples, [{ key: 'cup:170:5', reason: 'expectedPriorUserIdMismatch' }]);
  assert.deepEqual(identities(f.databasePath), TAMPE_ROWS, 'Nothing is cleared when any record conflicts');
  assert.deepEqual(JSON.parse(await readFile(reviewSidecarPath(f.databasePath), 'utf8')).clearanceManifests, []);
  const db = new DatabaseSync(f.databasePath);
  try {
    const plans = planClearances(db, parseClearanceManifest(body(manifest([leagueRecord(), stale]))).records);
    assert.throws(() => applyPlannedClearances(db, plans, 2), /blocks the whole batch/, 'The applicator itself refuses a partial batch');
  } finally { db.close(); }
  assert.deepEqual(identities(f.databasePath), TAMPE_ROWS);

  const draftPath = 'qa/reviewed-attribution-clearances-test.json';
  await writeManifest(f, manifest(), draftPath);
  await assert.rejects(applyReviewClearances({ databasePath: f.databasePath, repositoryPath: f.repositoryPath, manifestPath: draftPath }),
    /must be server\/src\/data/);
});

test('review import adopts exactly the applied clearances and retains their manifest', async t => {
  const f = await fixture(t);
  const manifestPath = await writeManifest(f);
  await applyReviewClearances({ databasePath: f.databasePath, repositoryPath: f.repositoryPath, manifestPath,
    apply: true, reportPath: join(f.directory, 'applied.json') });
  const result = await adoptReviewedArchive({ store: f.store, databasePath: f.databasePath, repositoryPath: f.repositoryPath, codeRevision: 'clearance' });
  assert.equal(result.clearedAttributions, 2);
  assert.equal(result.evidenceFiles, 1, 'The reviewed manifest is retained by hash');
  const state = await readStatePointer(f.store);
  const restored = join(f.directory, 'accepted.db');
  const snapshot = await restoreSnapshot(f.store, state!.pointer, restored);
  assert.match(snapshot.evidence[0]!.key, /^evidence\/imports\/[a-f0-9]{64}\/[a-f0-9]{64}\.json$/);
  assert.deepEqual(identities(restored), CLEARED_ROWS);
});

test('review import refuses unlisted clears, extra edits, unapplied rows and changed manifests', async t => {
  const attempts: Array<[string, (f: Fixture) => Promise<void>, RegExp]> = [
    ['unlisted clear', async f => {
      const db = new DatabaseSync(f.databasePath);
      db.exec('UPDATE LeagueChampion SET championUserId=0, championUserName=NULL WHERE season=19'); db.close();
    }, /Protected archive fact changed: LeagueChampion\.championUserId/],
    ['reassigned listed title', async f => {
      await apply(f);
      const db = new DatabaseSync(f.databasePath);
      db.exec('UPDATE LeagueChampion SET championUserId=13356038 WHERE season=3'); db.close();
    }, /Protected archive fact changed: LeagueChampion\.championUserId/],
    ['extra edit to a cleared row', async f => {
      await apply(f);
      const db = new DatabaseSync(f.databasePath);
      db.exec("UPDATE CupChampion SET championUserName='Someone'"); db.close();
    }, /not applied exactly: cup:170:5/],
    ['listed row left unchanged', async f => {
      await apply(f);
      const db = new DatabaseSync(f.databasePath);
      db.exec(`UPDATE LeagueChampion SET championUserId=${TAMPE}, championUserName='Tampe' WHERE season=3`); db.close();
    }, /not applied exactly: league:110:3/],
    ['manifest edited after apply', async f => {
      await apply(f);
      await writeManifest(f, { ...manifest(), guard: 'Edited after review.' });
    }, /changed after it was applied/],
  ];
  async function apply(f: Fixture) {
    await applyReviewClearances({ databasePath: f.databasePath, repositoryPath: f.repositoryPath, manifestPath: await writeManifest(f),
      apply: true, reportPath: join(f.directory, `applied-${Date.now()}.json`) });
  }
  for (const [label, prepare, error] of attempts) {
    const f = await fixture(t);
    await prepare(f);
    await assert.rejects(adoptReviewedArchive({ store: f.store, databasePath: f.databasePath, repositoryPath: f.repositoryPath, codeRevision: label }), error, label);
    assert.equal((await readStatePointer(f.store))?.etag, f.etag, `${label}: accepted state is unchanged`);
  }
});

test('release continuity allows only committed (fact, prior manager) pairs', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'clearance-allowance-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.deepEqual(await committedClearanceAllowance(join(directory, 'missing')), new Map());
  await writeFile(join(directory, 'reviewed-attribution-clearances-a.json'), JSON.stringify(manifest()));
  await writeFile(join(directory, 'verified-unrelated.json'), '{}');
  assert.deepEqual([...await committedClearanceAllowance(directory)], [['league:110:3', TAMPE], ['cup:170:5', TAMPE]]);
  await writeFile(join(directory, 'reviewed-attribution-clearances-b.json'), JSON.stringify(manifest([leagueRecord()])));
  await assert.rejects(committedClearanceAllowance(directory), /Two committed clearance manifests list league:110:3/);
  await writeFile(join(directory, 'reviewed-attribution-clearances-b.json'), JSON.stringify({ ...manifest(), status: 'proposed' }));
  await assert.rejects(committedClearanceAllowance(directory), /Invalid reviewed clearance manifest/);
});
