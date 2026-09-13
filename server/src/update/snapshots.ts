import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { EvidenceReferenceSchema, type EvidenceReference } from './evidence.js';
import { jsonBytes, sha256, StorageConflictError, type ObjectStore } from './storage.js';

export const DOMAIN_TABLES = ['Team', 'Match', 'MatchDetail', 'SeasonStanding', 'NationalLeague', 'LeagueChampion', 'Cup', 'CupChampion', 'WorldCupChampion', 'NationalCupChampion', 'NationalCoachElection', 'HattrickUser', 'ChppToken'] as const;
const ObjectReferenceSchema = EvidenceReferenceSchema;
const StatePointerSchema = z.object({
  schemaVersion: z.literal(1), snapshotId: z.string().min(1), manifestKey: z.string().min(1),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/), updatedAt: z.string().datetime(),
});
export type StatePointer = z.infer<typeof StatePointerSchema>;
const SnapshotManifestSchema = z.object({
  schemaVersion: z.literal(1), snapshotId: z.string().min(1), runId: z.string().min(1), codeRevision: z.string().min(1),
  createdAt: z.string().datetime(), database: ObjectReferenceSchema, evidence: z.array(EvidenceReferenceSchema),
  tableCounts: z.record(z.number().int().nonnegative()),
});
export type SnapshotManifest = z.infer<typeof SnapshotManifestSchema>;
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
type Row = Record<string, unknown>;
function tables(db: DatabaseSync): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map(row => row.name);
}
export function validateDatabase(databasePath: string): Record<string, number> {
  const db = new DatabaseSync(resolve(databasePath), { readOnly: true });
  try {
    const check = db.prepare('PRAGMA integrity_check').all();
    if (check.length !== 1 || Object.values(check[0]!)[0] !== 'ok') throw new Error('SQLite integrity validation failed');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('SQLite foreign-key validation failed');
    const names = tables(db);
    if (DOMAIN_TABLES.some(name => !names.includes(name))) throw new Error('Archive is missing required domain tables; refusing a partial reconstruction');
    return Object.fromEntries(names.map(name => [name, Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quote(name)}`).get()!.count)]));
  } finally { db.close(); }
}

/** Uses SQLite's online backup API: committed WAL pages are included even when the source has
 * another open connection. Never copy the main file of an active SQLite DB by itself. */
export async function snapshotDatabase(source: string, target: string): Promise<void> {
  if (resolve(source) === resolve(target) || existsSync(target)) throw new Error('Snapshot target must be a new isolated file');
  await mkdir(dirname(resolve(target)), { recursive: true });
  const database = new DatabaseSync(resolve(source), { readOnly: true });
  try { await backup(database, resolve(target)); } finally { database.close(); }
  await chmod(target, 0o600);
  validateDatabase(target);
}

/** Every old primary key must survive. Completed results and proven attribution cannot be
 * overwritten during an automatic run. Newly resolved null identities remain permitted. */
export function assertArchivePreserved(beforePath: string, afterPath: string): void {
  validateDatabase(afterPath);
  const before = new DatabaseSync(resolve(beforePath), { readOnly: true });
  const after = new DatabaseSync(resolve(afterPath), { readOnly: true });
  try {
    const afterTables = new Set(tables(after));
    for (const name of tables(before).filter(name => name !== '_prisma_migrations')) {
      if (!afterTables.has(name)) throw new Error(`Archive table was removed: ${name}`);
      const columns = before.prepare(`PRAGMA table_info(${quote(name)})`).all() as Array<{ name: string; pk: number }>;
      const primary = columns.filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk).map(column => column.name);
      if (!primary.length) throw new Error(`Archive table lacks a stable primary key: ${name}`);
      const rows = before.prepare(`SELECT * FROM ${quote(name)}`).all() as Row[];
      const lookup = after.prepare(`SELECT * FROM ${quote(name)} WHERE ${primary.map(key => `${quote(key)} = ?`).join(' AND ')}`);
      for (const row of rows) {
        const next = lookup.get(...primary.map(key => row[key] as string | number | null)) as Row | undefined;
        if (!next) throw new Error(`Archive record was removed: ${name}`);
        const protectedFields = protectedColumns(name, row);
        for (const field of protectedFields) {
          const value = row[field];
          if (/^thirdFourth(User|Team)Ids$/.test(field) && typeof value === 'string') {
            const oldIds = value.split(',');
            const newIds = String(next[field] ?? '').split(',');
            if (oldIds.some((id, index) => Number(id) > 0 && Number(newIds[index]) !== Number(id)))
              throw new Error(`Protected archive fact changed: ${name}.${field}`);
            continue;
          }
          const unresolvedId = /Id$/.test(field) && value === 0;
          if (value !== null && value !== undefined && value !== '' && !unresolvedId && next[field] !== value)
            throw new Error(`Protected archive fact changed: ${name}.${field}`);
        }
      }
    }
  } finally { before.close(); after.close(); }
}
function protectedColumns(name: string, row: Row): string[] {
  const identities = Object.keys(row).filter(key => /(?:champion|runnerUp|winner)UserId$/.test(key) || key === 'thirdFourthUserIds');
  switch (name) {
    case 'Match': return ['teamId', 'season', 'matchDate', 'homeTeamId', 'awayTeamId', 'homeTeamName', 'awayTeamName', 'homeGoals', 'awayGoals', 'matchType'];
    case 'MatchDetail': return ['lineupJson', 'scorersJson', 'ratingsJson'];
    case 'LeagueChampion': return [...identities, ...(row.complete ? ['championTeamId', 'championTeamName', 'played', 'points', 'complete'] : [])];
    case 'SeasonStanding': return row.complete ? ['championTeamId', 'championTeamName', 'standingsJson', 'complete'] : [];
    case 'CupChampion': return [...identities, ...(Number(row.finalMatchId) > 0 || Number(row.championUserId) > 0 ? ['finalMatchId', 'championTeamId', 'championTeamName', 'runnerUpTeamName', 'homeGoals', 'awayGoals', 'penalties'] : [])];
    case 'WorldCupChampion': return [...identities, 'champion', 'runnerUp', 'thirdFourth', 'finishedDate'];
    case 'NationalCupChampion': return [...identities, 'champion', 'runnerUp', 'thirdFourth', 'finalDate', 'championTeamId', 'runnerUpTeamId', 'thirdFourthTeamIds'];
    case 'NationalCoachElection': return [...identities, 'leagueId', 'edition', 'isYouth', 'host', 'votes'];
    default: return identities;
  }
}

export async function readStatePointer(store: ObjectStore): Promise<{ pointer: StatePointer; etag: string } | null> {
  const object = await store.get('state/current.json');
  if (!object) return null;
  try { return { pointer: StatePointerSchema.parse(JSON.parse(object.body.toString('utf8'))), etag: object.etag }; }
  catch { throw new Error('Accepted archive pointer is invalid; refusing to start empty'); }
}
async function checkedObject(store: ObjectStore, reference: EvidenceReference): Promise<Buffer> {
  const object = await store.get(reference.key);
  if (!object || object.body.length !== reference.bytes || sha256(object.body) !== reference.sha256)
    throw new Error('A required private archive object is missing or corrupt');
  return object.body;
}
export async function readSnapshotManifest(store: ObjectStore, pointer: StatePointer): Promise<SnapshotManifest> {
  StatePointerSchema.parse(pointer);
  const object = await store.get(pointer.manifestKey);
  if (!object || sha256(object.body) !== pointer.manifestSha256) throw new Error('Archive snapshot manifest is missing or corrupt');
  const manifest = SnapshotManifestSchema.parse(JSON.parse(object.body.toString('utf8')));
  if (manifest.snapshotId !== pointer.snapshotId) throw new Error('Archive snapshot identity does not match its pointer');
  return manifest;
}
export async function restoreSnapshot(store: ObjectStore, pointer: StatePointer, targetPath: string): Promise<SnapshotManifest> {
  if (existsSync(targetPath)) throw new Error('Restore target must be a new isolated database');
  const manifest = await readSnapshotManifest(store, pointer);
  const database = await checkedObject(store, manifest.database);
  // Evidence must be available before acquisition starts. Read all required captures, not just
  // their object metadata, so checksum failures fail the restore rather than prompting fetches.
  for (const reference of manifest.evidence) await checkedObject(store, reference);
  await mkdir(dirname(resolve(targetPath)), { recursive: true });
  await writeFile(targetPath, database, { flag: 'wx', mode: 0o600 });
  try {
    const counts = validateDatabase(targetPath);
    if (JSON.stringify(counts) !== JSON.stringify(manifest.tableCounts)) throw new Error('Restored database differs from snapshot inventory');
  } catch (error) { await unlink(targetPath); throw error; }
  return manifest;
}
export async function saveSnapshot(options: {
  store: ObjectStore; databasePath: string; evidenceRefs: readonly EvidenceReference[]; runId: string; codeRevision: string;
  expectedStateEtag: string | null; previousDatabasePath?: string;
}): Promise<{ pointer: StatePointer; etag: string; manifest: SnapshotManifest }> {
  if (options.expectedStateEtag !== null && !options.previousDatabasePath) throw new Error('Updating accepted state requires its previous database for preservation checks');
  const accepted = await readStatePointer(options.store);
  if ((accepted?.etag ?? null) !== options.expectedStateEtag) throw new StorageConflictError();
  if (accepted) {
    const previous = await readSnapshotManifest(options.store, accepted.pointer);
    const nextReferences = new Map(options.evidenceRefs.map(ref => [ref.key, ref]));
    for (const ref of previous.evidence) {
      const next = nextReferences.get(ref.key);
      if (!next || next.sha256 !== ref.sha256 || next.bytes !== ref.bytes) throw new Error('Previously retained evidence was removed or changed');
    }
  }
  const snapshotId = randomUUID();
  const temporary = resolve(dirname(options.databasePath), `.snapshot-${snapshotId}.db`);
  try {
    await snapshotDatabase(options.databasePath, temporary);
    if (options.previousDatabasePath) assertArchivePreserved(options.previousDatabasePath, temporary);
    const evidence = [...options.evidenceRefs].sort((a, b) => a.key.localeCompare(b.key));
    for (const reference of evidence) await checkedObject(options.store, EvidenceReferenceSchema.parse(reference));
    const body = await readFile(temporary);
    const database = { key: `state/snapshots/${snapshotId}/archive.db`, sha256: sha256(body), bytes: body.length };
    const manifest: SnapshotManifest = {
      schemaVersion: 1, snapshotId, runId: options.runId, codeRevision: options.codeRevision, createdAt: new Date().toISOString(),
      database, evidence, tableCounts: validateDatabase(temporary),
    };
    await options.store.putImmutable(database.key, body);
    const manifestKey = `state/snapshots/${snapshotId}/manifest.json`;
    const manifestBody = jsonBytes(manifest);
    await options.store.putImmutable(manifestKey, manifestBody);
    const pointer: StatePointer = { schemaVersion: 1, snapshotId, manifestKey, manifestSha256: sha256(manifestBody), updatedAt: manifest.createdAt };
    const { etag } = await options.store.compareAndSwap('state/current.json', jsonBytes(pointer), options.expectedStateEtag);
    return { pointer, etag, manifest };
  } finally { if (existsSync(temporary)) await unlink(temporary); }
}
