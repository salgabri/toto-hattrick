import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { acquireLease } from './lease.js';
import { acknowledgeReviewCaptureManifest, adoptReviewedArchive, checkoutForReview } from './review.js';
import { DOMAIN_TABLES, readStatePointer, restoreSnapshot, saveSnapshot } from './snapshots.js';
import { LocalObjectStore, sha256, StorageConflictError } from './storage.js';

const ELECTION_URL = 'https://www.hattrick.org/WorldCup/Elections.aspx?LeagueID=4';
const HOST_URL = 'https://www.hattrick.org/WorldCup/Hosts.aspx?Cup=Senior';
const CAPTURE_TIME = '2000-01-04T12:00:00.000Z';

interface Fixture {
  directory: string;
  source: string;
  store: LocalObjectStore;
  saved: Awaited<ReturnType<typeof saveSnapshot>>;
  repositoryPath: string;
  databasePath: string;
}

async function fixture(t: TestContext): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'archive-review-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'original.db');
  const db = new DatabaseSync(source);
  for (const table of DOMAIN_TABLES) {
    const extra = table === 'CupChampion' ? ', finalMatchId INTEGER, championTeamId INTEGER, championUserId INTEGER' : '';
    db.exec(`CREATE TABLE "${table}" (id INTEGER PRIMARY KEY, value TEXT${extra}); INSERT INTO "${table}"(id, value) VALUES (1, '${table} fact')`);
  }
  db.exec(`
    UPDATE CupChampion SET finalMatchId=123, championTeamId=42 WHERE id=1;
    CREATE TABLE _prisma_migrations(id TEXT PRIMARY KEY, checksum TEXT NOT NULL, migration_name TEXT NOT NULL);
    INSERT INTO _prisma_migrations VALUES ('migration-1','checksum-1','initial');
    CREATE TABLE UpdateSource(
      sourceKey TEXT PRIMARY KEY, kind TEXT NOT NULL, lastAttemptAt INTEGER, lastSuccessAt INTEGER,
      nextCheckAt INTEGER, metadataJson TEXT NOT NULL, updatedAt INTEGER NOT NULL
    );
    INSERT INTO UpdateSource VALUES
      ('elections:4','manual',NULL,NULL,NULL,'{"sourceUrl":"${ELECTION_URL}"}',0),
      ('hosts:senior','manual',NULL,NULL,NULL,'{"sourceUrl":"${HOST_URL}"}',0);
    CREATE TABLE UpdateItem(
      id INTEGER PRIMARY KEY, sourceKey TEXT, itemKey TEXT, task TEXT, state TEXT,
      nextAttemptAt INTEGER, lastError TEXT, errorCategory TEXT, evidenceRef TEXT,
      completedAt INTEGER, updatedAt INTEGER
    );
    INSERT INTO UpdateItem VALUES
      (1,'elections:4','capture:2000-01-03','capture','needs_review',NULL,'capture required','evidence',NULL,NULL,0),
      (2,'hosts:senior','capture:2000-01-03','capture','needs_review',NULL,'capture required','evidence',NULL,NULL,0);
  `);
  db.close();
  const store = new LocalObjectStore(join(directory, 'private'));
  const saved = await saveSnapshot({ store, databasePath: source, evidenceRefs: [], runId: 'initial', codeRevision: 'test', expectedStateEtag: null });
  const repositoryPath = join(directory, 'repo');
  await mkdir(join(repositoryPath, '.scrape', 'review-captures'), { recursive: true });
  return { directory, source, store, saved, repositoryPath, databasePath: join(directory, 'operator.db') };
}

interface ManifestOptions {
  assertions?: Array<{ sourceKey: string; itemKey: string; sourceUrl: string; capturedAt: string; artifactPath: string }>;
  generatedAt?: string;
  manifestName?: string;
  artifactContents?: Record<string, string>;
}

async function writeManifest(f: Fixture, options: ManifestOptions = {}) {
  const assertions = options.assertions ?? [
    { sourceKey: 'elections:4', itemKey: 'capture:2000-01-03', sourceUrl: ELECTION_URL, capturedAt: CAPTURE_TIME, artifactPath: '.scrape/review-captures/elections-4.jsonl' },
    { sourceKey: 'hosts:senior', itemKey: 'capture:2000-01-03', sourceUrl: HOST_URL, capturedAt: CAPTURE_TIME, artifactPath: '.scrape/review-captures/hosts-senior.html' },
  ];
  const contents = options.artifactContents ?? {};
  const artifactPaths = [...new Set(assertions.map(assertion => assertion.artifactPath))];
  const artifacts = [];
  for (const path of artifactPaths) {
    const body = Buffer.from(contents[path] ?? `captured payload for ${path}`);
    await writeFile(join(f.repositoryPath, ...path.split('/')), body);
    artifacts.push({ path, sha256: sha256(body), bytes: body.length });
  }
  const manifest = {
    schemaVersion: 1,
    kind: 'assisted-source-capture',
    generatedAt: options.generatedAt ?? '2000-01-05T00:00:00.000Z',
    tool: { name: 'review-fixture', version: '1.0.0' },
    artifacts,
    assertions: assertions.map(({ artifactPath, ...assertion }) => ({ ...assertion, complete: true, artifactPaths: [artifactPath] })),
  };
  const relativePath = `.scrape/review-captures/${options.manifestName ?? 'capture-manifest.json'}`;
  await writeFile(join(f.repositoryPath, ...relativePath.split('/')), JSON.stringify(manifest));
  return { relativePath, manifest };
}

test('review checkout adopts missing identities without publishing or asserting fresh source coverage', async t => {
  const f = await fixture(t);
  await f.store.putImmutable('releases/current.json', Buffer.from('previous published receipt'));
  const checkout = await checkoutForReview({ store: f.store, databasePath: f.databasePath });
  assert.equal(checkout.snapshotId, f.saved.pointer.snapshotId);
  await assert.rejects(checkoutForReview({ store: f.store, databasePath: f.databasePath }), /new database/);
  const edit = new DatabaseSync(f.databasePath);
  edit.exec('UPDATE CupChampion SET championUserId=77 WHERE id=1'); edit.close();
  const editedBytes = await readFile(f.databasePath);
  const result = await adoptReviewedArchive({ ...f, codeRevision: 'review-test' });
  assert.equal(result.published, false);
  assert.equal(result.sourceFreshnessChanged, false);
  assert.equal(result.evidenceFiles, 0);
  assert.deepEqual(await readFile(f.databasePath), editedBytes, 'Adoption leaves the operator database intact');
  assert.equal((await f.store.get('releases/current.json'))?.body.toString(), 'previous published receipt');
  const state = await readStatePointer(f.store);
  assert.equal(state?.pointer.snapshotId, result.snapshotId);
  const restored = join(f.directory, 'accepted.db');
  await restoreSnapshot(f.store, state!.pointer, restored);
  const db = new DatabaseSync(restored, { readOnly: true });
  assert.equal(db.prepare('SELECT championUserId FROM CupChampion').get()?.championUserId, 77);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM UpdateSource WHERE lastSuccessAt IS NOT NULL').get()?.count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM UpdateItem WHERE state='needs_review'").get()?.count, 2);
  db.close();
  await assert.rejects(adoptReviewedArchive({ ...f, codeRevision: 'repeat' }), StorageConflictError, 'A sidecar cannot silently replay against a newer accepted archive');
});

test('a strict batch manifest advances each bound source atomically only during import', async t => {
  const f = await fixture(t);
  await checkoutForReview({ store: f.store, databasePath: f.databasePath });
  const { relativePath } = await writeManifest(f);
  const beforeAcknowledge = await readFile(f.databasePath);
  const acknowledgement = await acknowledgeReviewCaptureManifest({
    databasePath: f.databasePath, repositoryPath: f.repositoryPath, manifestPath: relativePath,
  });
  assert.equal(acknowledgement.assertions, 2);
  assert.equal(acknowledgement.artifacts, 2);
  assert.match(acknowledgement.evidenceRef, /^evidence\/imports\/[a-f0-9]{64}\/[a-f0-9]{64}\.json$/);
  assert.deepEqual(await readFile(f.databasePath), beforeAcknowledge, 'Acknowledgement does not edit the checkout');
  const beforeImport = Date.now();
  const result = await adoptReviewedArchive({ ...f, codeRevision: 'review-capture' });
  const afterImport = Date.now();
  assert.equal(result.sourceFreshnessChanged, true);
  assert.equal(result.acknowledgedCaptures, 2);
  assert.equal(result.evidenceFiles, 3, 'The manifest and its two declared artifacts are retained');
  const state = await readStatePointer(f.store);
  const restored = join(f.directory, 'accepted-capture.db');
  await restoreSnapshot(f.store, state!.pointer, restored);
  const db = new DatabaseSync(restored, { readOnly: true });
  const items = db.prepare('SELECT state, evidenceRef, completedAt, updatedAt FROM UpdateItem ORDER BY id').all() as Array<Record<string, unknown>>;
  const sources = db.prepare('SELECT lastAttemptAt, lastSuccessAt, nextCheckAt, updatedAt FROM UpdateSource ORDER BY sourceKey').all() as Array<Record<string, unknown>>;
  for (const item of items) {
    assert.equal(item.state, 'complete');
    assert.equal(item.evidenceRef, acknowledgement.evidenceRef);
    assert.ok(Number(item.completedAt) >= beforeImport && Number(item.completedAt) <= afterImport);
    assert.equal(item.updatedAt, item.completedAt);
  }
  for (const source of sources) {
    assert.equal(source.lastAttemptAt, Date.parse(CAPTURE_TIME));
    assert.equal(source.lastSuccessAt, Date.parse(CAPTURE_TIME));
    assert.equal(source.nextCheckAt, Date.parse(CAPTURE_TIME) + 7 * 86_400_000);
    assert.ok(Number(source.updatedAt) >= beforeImport && Number(source.updatedAt) <= afterImport);
  }
  db.close();
});

test('manifest assertions are bound to exact manual source URL, task state, and monotonic time', async t => {
  const f = await fixture(t);
  await checkoutForReview({ store: f.store, databasePath: f.databasePath });
  let written = await writeManifest(f, { assertions: [{
    sourceKey: 'elections:4', itemKey: 'capture:2000-01-03', sourceUrl: 'https://example.invalid/wrong', capturedAt: CAPTURE_TIME,
    artifactPath: '.scrape/review-captures/wrong.json',
  }] });
  await assert.rejects(acknowledgeReviewCaptureManifest({ databasePath: f.databasePath, repositoryPath: f.repositoryPath, manifestPath: written.relativePath }), /source URL/);

  const db = new DatabaseSync(f.databasePath);
  db.exec(`UPDATE UpdateSource SET lastSuccessAt=${Date.parse(CAPTURE_TIME)} WHERE sourceKey='elections:4'`); db.close();
  written = await writeManifest(f, { assertions: [{
    sourceKey: 'elections:4', itemKey: 'capture:2000-01-03', sourceUrl: ELECTION_URL, capturedAt: CAPTURE_TIME,
    artifactPath: '.scrape/review-captures/stale.json',
  }] });
  await assert.rejects(acknowledgeReviewCaptureManifest({ databasePath: f.databasePath, repositoryPath: f.repositoryPath, manifestPath: written.relativePath }), /not newer/);
});

test('invalid manifest structure, timestamp, paths, and artifact digests fail closed', async t => {
  const f = await fixture(t);
  await checkoutForReview({ store: f.store, databasePath: f.databasePath });
  const preCycle = await writeManifest(f, { assertions: [{
    sourceKey: 'elections:4', itemKey: 'capture:2000-01-03', sourceUrl: ELECTION_URL, capturedAt: '2000-01-02T23:59:59.000Z',
    artifactPath: '.scrape/review-captures/pre-cycle.json',
  }] });
  await assert.rejects(acknowledgeReviewCaptureManifest({ databasePath: f.databasePath, repositoryPath: f.repositoryPath, manifestPath: preCycle.relativePath }), /queued capture cycle/);

  const valid = await writeManifest(f, { manifestName: 'bad-hash-manifest.json', assertions: [{
    sourceKey: 'elections:4', itemKey: 'capture:2000-01-03', sourceUrl: ELECTION_URL, capturedAt: CAPTURE_TIME,
    artifactPath: '.scrape/review-captures/bad-hash.json',
  }] });
  const path = join(f.repositoryPath, ...valid.relativePath.split('/'));
  const document = JSON.parse(await readFile(path, 'utf8')) as any;
  document.artifacts[0].sha256 = '0'.repeat(64);
  await writeFile(path, JSON.stringify(document));
  await assert.rejects(acknowledgeReviewCaptureManifest({ databasePath: f.databasePath, repositoryPath: f.repositoryPath, manifestPath: valid.relativePath }), /byte count and SHA-256/);
  await assert.rejects(acknowledgeReviewCaptureManifest({ databasePath: f.databasePath, repositoryPath: f.repositoryPath, manifestPath: '../outside.json' }), /review-captures/);
});

test('changed manifest or artifact after acknowledgement cannot be imported or retained', async t => {
  const f = await fixture(t);
  await checkoutForReview({ store: f.store, databasePath: f.databasePath });
  const written = await writeManifest(f, { assertions: [{
    sourceKey: 'elections:4', itemKey: 'capture:2000-01-03', sourceUrl: ELECTION_URL, capturedAt: CAPTURE_TIME,
    artifactPath: '.scrape/review-captures/elections.jsonl',
  }] });
  const acknowledgement = await acknowledgeReviewCaptureManifest({ databasePath: f.databasePath, repositoryPath: f.repositoryPath, manifestPath: written.relativePath });
  await writeFile(join(f.repositoryPath, '.scrape', 'review-captures', 'elections.jsonl'), 'changed after acknowledgement');
  await assert.rejects(adoptReviewedArchive({ ...f, codeRevision: 'changed-artifact' }), /byte count and SHA-256/);
  assert.equal(await f.store.get(acknowledgement.evidenceRef), null, 'A rejected import uploads no manifest object');
  assert.equal((await readStatePointer(f.store))?.etag, f.saved.etag);
});

test('review import rejects trigger, index, pragma, and Prisma migration tampering', async t => {
  for (const [label, sql] of [
    ['trigger', "CREATE TRIGGER injected AFTER UPDATE ON UpdateItem BEGIN UPDATE CupChampion SET championUserId=999 WHERE id=1; END"],
    ['index', 'CREATE INDEX injected_index ON UpdateItem(state)'],
    ['user version', 'PRAGMA user_version=42'],
    ['application id', 'PRAGMA application_id=42'],
    ['migration history', "INSERT INTO _prisma_migrations VALUES ('migration-2','checksum-2','injected')"],
  ] as const) {
    const f = await fixture(t);
    await checkoutForReview({ store: f.store, databasePath: f.databasePath });
    const db = new DatabaseSync(f.databasePath); db.exec(sql); db.close();
    await assert.rejects(adoptReviewedArchive({ ...f, codeRevision: `tamper-${label}` }), /schema|migration/i, label);
    assert.equal((await readStatePointer(f.store))?.etag, f.saved.etag);
  }
});

test('stale review edits and a missing sidecar cannot replace newer accepted state', async t => {
  const f = await fixture(t);
  await assert.rejects(adoptReviewedArchive({ ...f, codeRevision: 'test' }), /sidecar/);
  await checkoutForReview({ store: f.store, databasePath: f.databasePath });
  const newer = await saveSnapshot({ store: f.store, databasePath: f.source, previousDatabasePath: f.source, evidenceRefs: [], runId: 'next', codeRevision: 'test', expectedStateEtag: f.saved.etag });
  await assert.rejects(adoptReviewedArchive({ ...f, codeRevision: 'test' }), StorageConflictError);
  assert.equal((await readStatePointer(f.store))?.etag, newer.etag);
});

test('review import rejects changed historical winners and edits claiming queue completion', async t => {
  const f = await fixture(t);
  await checkoutForReview({ store: f.store, databasePath: f.databasePath });
  let db = new DatabaseSync(f.databasePath);
  db.exec('UPDATE CupChampion SET championTeamId=43 WHERE id=1'); db.close();
  await assert.rejects(adoptReviewedArchive({ ...f, codeRevision: 'test' }), /Protected archive fact/);
  db = new DatabaseSync(f.databasePath);
  db.exec("UPDATE CupChampion SET championTeamId=42 WHERE id=1; UPDATE UpdateItem SET state='complete' WHERE id=1"); db.close();
  await assert.rejects(adoptReviewedArchive({ ...f, codeRevision: 'test' }), /preserve pending tasks/);
  assert.equal((await readStatePointer(f.store))?.etag, f.saved.etag);
});

test('review import shares the update/publication lease', async t => {
  const f = await fixture(t);
  await checkoutForReview({ store: f.store, databasePath: f.databasePath });
  const lease = await acquireLease(f.store);
  try { await assert.rejects(adoptReviewedArchive({ ...f, codeRevision: 'test' }), /Another updater holds/); }
  finally { await lease.release(); }
  assert.equal((await readStatePointer(f.store))?.etag, f.saved.etag);
});
