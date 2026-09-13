import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { captureEvidence } from './evidence.js';
import { assertArchivePreserved, DOMAIN_TABLES, readStatePointer, restoreSnapshot, saveSnapshot, snapshotDatabase, validateDatabase } from './snapshots.js';
import { LocalObjectStore, StorageConflictError, StorageUnavailableError, type ObjectStore } from './storage.js';

function fixture(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL');
  for (const table of DOMAIN_TABLES) {
    const columns = table === 'CupChampion' ? ', finalMatchId INTEGER, championTeamId INTEGER, championUserId INTEGER, homeGoals INTEGER'
      : table === 'WorldCupChampion' ? ', thirdFourthUserIds TEXT' : '';
    db.exec(`CREATE TABLE "${table}" (id INTEGER PRIMARY KEY, value TEXT${columns}); INSERT INTO "${table}"(id, value) VALUES (1, '${table} fact')`);
  }
  db.exec('UPDATE CupChampion SET finalMatchId=123, championTeamId=42, homeGoals=0 WHERE id=1');
  return db;
}
test('online SQLite snapshot includes WAL commits and restores every domain and evidence', async t => {
  const root = await mkdtemp(join(tmpdir(), 'archive-snapshot-'));
  const path = join(root, 'source.db');
  const db = fixture(path);
  t.after(async () => { db.close(); await rm(root, { recursive: true, force: true }); });
  const store = new LocalObjectStore(join(root, 'private'));
  const ref = await captureEvidence({ store, key: 'evidence/test.json', source: 'test fixture', parserVersion: 'v1', payload: { fact: 42 } });
  const saved = await saveSnapshot({ store, databasePath: path, evidenceRefs: [ref], runId: 'fixture', codeRevision: 'test', expectedStateEtag: null });
  assert.equal((await readStatePointer(store))?.etag, saved.etag);
  const target = join(root, 'restored.db');
  const restored = await restoreSnapshot(store, saved.pointer, target);
  assert.deepEqual(restored.evidence, [ref]);
  const counts = validateDatabase(target);
  for (const name of DOMAIN_TABLES) assert.equal(counts[name], 1, `${name} survives the actual DB snapshot`);
  assertArchivePreserved(path, target);
  await assert.rejects(restoreSnapshot(store, saved.pointer, target), /new isolated/);
});

test('record replacement and changes from zero scores cannot pass preservation by count', async t => {
  const root = await mkdtemp(join(tmpdir(), 'archive-preserve-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'before.db');
  const db = fixture(source);
  db.exec("UPDATE WorldCupChampion SET thirdFourthUserIds=',29' WHERE id=1");
  db.close();
  const candidate = join(root, 'after.db');
  await snapshotDatabase(source, candidate);
  const edited = new DatabaseSync(candidate);
  edited.exec('UPDATE CupChampion SET homeGoals=1 WHERE id=1');
  assert.throws(() => assertArchivePreserved(source, candidate), /homeGoals/);
  edited.exec('UPDATE CupChampion SET homeGoals=0, championUserId=19 WHERE id=1');
  edited.exec("UPDATE WorldCupChampion SET thirdFourthUserIds='12,29' WHERE id=1");
  assert.doesNotThrow(() => assertArchivePreserved(source, candidate), 'A newly evidenced missing manager can be added');
  edited.exec("UPDATE WorldCupChampion SET thirdFourthUserIds='29,12' WHERE id=1");
  assert.throws(() => assertArchivePreserved(source, candidate), /thirdFourthUserIds/, 'Known joint-third attribution cannot move to the other nation');
  edited.exec("UPDATE WorldCupChampion SET thirdFourthUserIds='12,29' WHERE id=1");
  edited.exec('DELETE FROM WorldCupChampion; INSERT INTO WorldCupChampion(id,value) VALUES (2,\'replacement\')');
  assert.throws(() => assertArchivePreserved(source, candidate), /record was removed/);
  edited.close();
});

test('failed upload and CAS conflict cannot advance accepted state', async t => {
  const root = await mkdtemp(join(tmpdir(), 'archive-checkpoint-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'db.sqlite'); const db = fixture(source); db.close();
  const store = new LocalObjectStore(join(root, 'private'));
  const first = await saveSnapshot({ store, databasePath: source, evidenceRefs: [], runId: 'one', codeRevision: 'test', expectedStateEtag: null });
  const broken: ObjectStore = { get: key => store.get(key), putImmutable: async () => { throw new StorageUnavailableError(); }, compareAndSwap: (...args) => store.compareAndSwap(...args) };
  await assert.rejects(saveSnapshot({ store: broken, databasePath: source, evidenceRefs: [], runId: 'fail', codeRevision: 'test', expectedStateEtag: first.etag, previousDatabasePath: source }), StorageUnavailableError);
  assert.equal((await readStatePointer(store))?.etag, first.etag);
  const second = await saveSnapshot({ store, databasePath: source, evidenceRefs: [], runId: 'two', codeRevision: 'test', expectedStateEtag: first.etag, previousDatabasePath: source });
  await assert.rejects(saveSnapshot({ store, databasePath: source, evidenceRefs: [], runId: 'stale', codeRevision: 'test', expectedStateEtag: first.etag, previousDatabasePath: source }), StorageConflictError);
  assert.equal((await readStatePointer(store))?.etag, second.etag);
});

test('restore rejects a corrupt DB or a missing retained capture without creating an empty archive', async t => {
  const root = await mkdtemp(join(tmpdir(), 'archive-corrupt-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'db.sqlite'); const db = fixture(source); db.close();
  const store = new LocalObjectStore(join(root, 'private'));
  const ref = await captureEvidence({ store, key: 'evidence/test.json', source: 'fixture', parserVersion: 'v1', payload: {} });
  const saved = await saveSnapshot({ store, databasePath: source, evidenceRefs: [ref], runId: 'fixture', codeRevision: 'test', expectedStateEtag: null });
  const remotePath = join(store.root, saved.manifest.database.key);
  const original = await readFile(remotePath);
  await writeFile(remotePath, 'corrupted');
  await assert.rejects(restoreSnapshot(store, saved.pointer, join(root, 'bad.db')), /missing or corrupt/);
  await writeFile(remotePath, original);
  await rm(join(store.root, ref.key));
  await assert.rejects(restoreSnapshot(store, saved.pointer, join(root, 'bad.db')), /missing or corrupt/);
});
