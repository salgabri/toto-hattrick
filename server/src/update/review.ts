import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  captureEvidence, discoverBootstrapEvidence, EvidenceReferenceSchema, importedEvidenceKey,
  type EvidenceReference,
} from './evidence.js';
import { acquireLease } from './lease.js';
import { assertArchivePreserved, readStatePointer, restoreSnapshot, saveSnapshot, snapshotDatabase } from './snapshots.js';
import { jsonBytes, sha256, StorageConflictError, type ObjectStore } from './storage.js';

const CAPTURE_DIRECTORY = '.scrape/review-captures';
const WEEK_MS = 7 * 86_400_000;

const CaptureArtifactSchema = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive(),
}).strict();
const CaptureAssertionSchema = z.object({
  sourceKey: z.string().min(1),
  itemKey: z.string().regex(/^capture:\d{4}-\d{2}-\d{2}$/),
  sourceUrl: z.string().url(),
  capturedAt: z.string().datetime(),
  complete: z.literal(true),
  artifactPaths: z.array(z.string().min(1)).min(1),
}).strict();
export const AssistedCaptureManifestSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('assisted-source-capture'),
  generatedAt: z.string().datetime(),
  tool: z.object({ name: z.string().min(1), version: z.string().min(1) }).strict(),
  artifacts: z.array(CaptureArtifactSchema).min(1),
  assertions: z.array(CaptureAssertionSchema).min(1),
}).strict();
type AssistedCaptureManifest = z.infer<typeof AssistedCaptureManifestSchema>;

const ReviewCaptureManifestSchema = z.object({
  path: z.string().min(1),
  evidenceRef: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive(),
}).strict();
type ReviewCaptureManifest = z.infer<typeof ReviewCaptureManifestSchema>;

const ReviewCheckoutSchema = z.object({
  schemaVersion: z.literal(1),
  databasePath: z.string().min(1),
  snapshotId: z.string().min(1),
  etag: z.string().min(1),
  checkedOutAt: z.string().datetime(),
  evidenceRefs: z.array(EvidenceReferenceSchema),
  captureManifests: z.array(ReviewCaptureManifestSchema).default([]),
}).strict();
type ReviewCheckout = z.infer<typeof ReviewCheckoutSchema>;

interface CaptureFile { path: string; body: Buffer }
interface LoadedCaptureBatch {
  descriptor: ReviewCaptureManifest;
  manifest: AssistedCaptureManifest;
  manifestFile: CaptureFile;
  artifactFiles: CaptureFile[];
}
interface CaptureResolution {
  sourceKey: string;
  itemKey: string;
  capturedAt: number;
  evidenceRef: string;
}

export const reviewSidecarPath = (databasePath: string) => `${resolve(databasePath)}.review.json`;

function captureInstant(itemKey: string, value: string): Date {
  const capturedAt = new Date(value);
  if (Number.isNaN(capturedAt.getTime()) || capturedAt.getTime() > Date.now() + 5 * 60_000)
    throw new Error('Capture time must be a valid time that is not in the future');
  const cycle = /^capture:(\d{4}-\d{2}-\d{2})$/.exec(itemKey);
  if (!cycle || capturedAt.getTime() < new Date(`${cycle[1]}T00:00:00.000Z`).getTime())
    throw new Error('Capture time must fall within or after the queued capture cycle');
  return capturedAt;
}

async function readReviewSidecar(databasePath: string): Promise<ReviewCheckout> {
  try { return ReviewCheckoutSchema.parse(JSON.parse(await readFile(reviewSidecarPath(databasePath), 'utf8'))); }
  catch { throw new Error('A valid review checkout sidecar is required; start with update checkout'); }
}

function pathIsInside(parent: string, child: string): boolean {
  const fragment = relative(parent, child);
  return fragment !== '' && !fragment.startsWith('..') && !isAbsolute(fragment);
}

async function readCaptureFile(repositoryPath: string, requestedPath: string, allowed: ReadonlySet<string>): Promise<CaptureFile> {
  const absolute = resolve(repositoryPath, requestedPath);
  const relativePath = relative(repositoryPath, absolute).replaceAll('\\', '/');
  if (!relativePath.startsWith(`${CAPTURE_DIRECTORY}/`) || !allowed.has(relativePath))
    throw new Error(`Assisted capture files must be regular allowlisted files under ${CAPTURE_DIRECTORY}/`);
  const directInfo = await lstat(absolute).catch(() => null);
  if (!directInfo?.isFile() || directInfo.isSymbolicLink()) throw new Error('Assisted capture files cannot be missing, directories, or symlinks');
  const realRoot = await realpath(resolve(repositoryPath, CAPTURE_DIRECTORY));
  const realFile = await realpath(absolute);
  if (!pathIsInside(realRoot, realFile)) throw new Error('Assisted capture file escapes the review-captures directory');
  return { path: relativePath, body: await readFile(realFile) };
}

function validateManifestStructure(manifest: AssistedCaptureManifest): void {
  const generatedAt = new Date(manifest.generatedAt);
  if (generatedAt.getTime() > Date.now() + 5 * 60_000) throw new Error('Capture manifest generation time cannot be in the future');
  const artifacts = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (artifacts.has(artifact.path)) throw new Error(`Capture manifest repeats artifact ${artifact.path}`);
    artifacts.add(artifact.path);
  }
  const sources = new Set<string>();
  const tasks = new Set<string>();
  const referenced = new Set<string>();
  for (const assertion of manifest.assertions) {
    const task = `${assertion.sourceKey}\u0000${assertion.itemKey}`;
    if (sources.has(assertion.sourceKey)) throw new Error(`Capture manifest repeats source ${assertion.sourceKey}`);
    if (tasks.has(task)) throw new Error(`Capture manifest repeats task ${assertion.sourceKey}/${assertion.itemKey}`);
    sources.add(assertion.sourceKey); tasks.add(task);
    const capturedAt = captureInstant(assertion.itemKey, assertion.capturedAt);
    if (capturedAt.getTime() > generatedAt.getTime()) throw new Error('Capture manifest was generated before one of its captures');
    const assertionArtifacts = new Set<string>();
    for (const path of assertion.artifactPaths) {
      if (!artifacts.has(path)) throw new Error(`Capture assertion references undeclared artifact ${path}`);
      if (assertionArtifacts.has(path)) throw new Error(`Capture assertion repeats artifact ${path}`);
      assertionArtifacts.add(path); referenced.add(path);
    }
  }
  for (const artifact of artifacts) if (!referenced.has(artifact)) throw new Error(`Capture artifact is not bound to an assertion: ${artifact}`);
}

async function loadCaptureBatch(
  repositoryPath: string,
  manifestPath: string,
  allowed: ReadonlySet<string>,
  expected?: ReviewCaptureManifest,
): Promise<LoadedCaptureBatch> {
  const manifestFile = await readCaptureFile(repositoryPath, manifestPath, allowed);
  if (!manifestFile.path.endsWith('.json')) throw new Error('Assisted capture manifest must be JSON');
  let manifest: AssistedCaptureManifest;
  try { manifest = AssistedCaptureManifestSchema.parse(JSON.parse(manifestFile.body.toString('utf8'))); }
  catch (error) { throw new Error(`Invalid assisted capture manifest: ${error instanceof Error ? error.message : 'parse failed'}`); }
  validateManifestStructure(manifest);
  const descriptor = ReviewCaptureManifestSchema.parse({
    path: manifestFile.path,
    evidenceRef: importedEvidenceKey(manifestFile.path, manifestFile.body),
    sha256: sha256(manifestFile.body),
    bytes: manifestFile.body.length,
  });
  if (expected && JSON.stringify(descriptor) !== JSON.stringify(expected))
    throw new Error('Acknowledged capture manifest changed after review');
  const artifactFiles: CaptureFile[] = [];
  for (const artifact of manifest.artifacts) {
    const file = await readCaptureFile(repositoryPath, artifact.path, allowed);
    if (file.path !== artifact.path) throw new Error(`Capture artifact path is not canonical: ${artifact.path}`);
    if (file.path === manifestFile.path) throw new Error('Capture manifest cannot list itself as an artifact');
    if (file.body.length !== artifact.bytes || sha256(file.body) !== artifact.sha256)
      throw new Error(`Capture artifact does not match its byte count and SHA-256: ${artifact.path}`);
    artifactFiles.push(file);
  }
  return { descriptor, manifest, manifestFile, artifactFiles };
}

function sqliteMillis(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error('Stored source freshness timestamp is invalid');
}

function validateCaptureAssertions(databasePath: string, batches: readonly LoadedCaptureBatch[]): CaptureResolution[] {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const sourceQuery = database.prepare('SELECT kind, metadataJson, lastSuccessAt FROM UpdateSource WHERE sourceKey = ?');
    const itemQuery = database.prepare("SELECT state FROM UpdateItem WHERE sourceKey = ? AND itemKey = ? AND task = 'capture'");
    const sourceKeys = new Set<string>();
    const taskKeys = new Set<string>();
    const resolutions: CaptureResolution[] = [];
    for (const batch of batches) for (const assertion of batch.manifest.assertions) {
      const taskKey = `${assertion.sourceKey}\u0000${assertion.itemKey}`;
      if (sourceKeys.has(assertion.sourceKey) || taskKeys.has(taskKey))
        throw new Error('Only one capture assertion per source and task is allowed in a review import');
      sourceKeys.add(assertion.sourceKey); taskKeys.add(taskKey);
      const source = sourceQuery.get(assertion.sourceKey) as { kind?: string; metadataJson?: string; lastSuccessAt?: unknown } | undefined;
      let metadata: Record<string, unknown> = {};
      try { metadata = JSON.parse(source?.metadataJson ?? '{}') as Record<string, unknown>; } catch { /* fails exact URL check */ }
      if (source?.kind !== 'manual' || metadata.sourceUrl !== assertion.sourceUrl)
        throw new Error(`Capture assertion does not match manual source URL ${assertion.sourceKey}`);
      const item = itemQuery.get(assertion.sourceKey, assertion.itemKey) as { state?: string } | undefined;
      if (item?.state !== 'needs_review')
        throw new Error(`Capture assertion requires an exact needs_review task: ${assertion.sourceKey}/${assertion.itemKey}`);
      const capturedAt = captureInstant(assertion.itemKey, assertion.capturedAt).getTime();
      const lastSuccessAt = sqliteMillis(source.lastSuccessAt);
      if (lastSuccessAt !== null && capturedAt <= lastSuccessAt)
        throw new Error(`Capture assertion is not newer than source freshness: ${assertion.sourceKey}`);
      resolutions.push({ sourceKey: assertion.sourceKey, itemKey: assertion.itemKey, capturedAt, evidenceRef: batch.descriptor.evidenceRef });
    }
    return resolutions;
  } finally { database.close(); }
}

/** Export the complete accepted archive for the existing validated ingestion commands.
 * The new DB belongs to the operator; neither checkout nor adoption edits it afterwards. */
export async function checkoutForReview(options: { store: ObjectStore; databasePath: string }) {
  const databasePath = resolve(options.databasePath);
  const sidecarPath = reviewSidecarPath(databasePath);
  if (existsSync(databasePath) || existsSync(sidecarPath)) throw new Error('Review checkout requires a new database and sidecar path');
  const accepted = await readStatePointer(options.store);
  if (!accepted) throw new Error('Archive is not initialized; a review cannot start from an empty database');
  const manifest = await restoreSnapshot(options.store, accepted.pointer, databasePath);
  const sidecar: ReviewCheckout = {
    schemaVersion: 1,
    databasePath,
    snapshotId: accepted.pointer.snapshotId,
    etag: accepted.etag,
    checkedOutAt: new Date().toISOString(),
    evidenceRefs: manifest.evidence,
    captureManifests: [],
  };
  await writeFile(sidecarPath, jsonBytes(sidecar), { flag: 'wx', mode: 0o600 });
  return { databasePath, sidecarPath, snapshotId: accepted.pointer.snapshotId, etag: accepted.etag, evidenceFiles: manifest.evidence.length };
}

/** Bind one strict, potentially multi-source capture manifest to a checkout. Nothing is uploaded
 * or written to the editable database here; import repeats every validation against frozen bytes. */
export async function acknowledgeReviewCaptureManifest(options: {
  databasePath: string;
  repositoryPath: string;
  manifestPath: string;
}) {
  const databasePath = resolve(options.databasePath);
  const sidecar = await readReviewSidecar(databasePath);
  if (resolve(sidecar.databasePath) !== databasePath) throw new Error('Review sidecar belongs to a different database path');
  const repositoryPath = resolve(options.repositoryPath);
  const allowed = new Set(await discoverBootstrapEvidence(repositoryPath));
  const existing: LoadedCaptureBatch[] = [];
  for (const descriptor of sidecar.captureManifests)
    existing.push(await loadCaptureBatch(repositoryPath, descriptor.path, allowed, descriptor));
  const next = await loadCaptureBatch(repositoryPath, options.manifestPath, allowed);
  const duplicate = sidecar.captureManifests.find(descriptor => descriptor.path === next.descriptor.path);
  if (duplicate && JSON.stringify(duplicate) !== JSON.stringify(next.descriptor))
    throw new Error('Capture manifest path already has a different acknowledgement');
  const batches = duplicate ? existing : [...existing, next];
  const resolutions = validateCaptureAssertions(databasePath, batches);
  if (!duplicate) {
    sidecar.captureManifests.push(next.descriptor);
    await writeFile(reviewSidecarPath(databasePath), jsonBytes(sidecar), { mode: 0o600 });
  }
  return {
    manifestPath: next.descriptor.path,
    evidenceRef: next.descriptor.evidenceRef,
    assertions: resolutions.length,
    artifacts: next.artifactFiles.length,
  };
}

const identifier = (name: string) => `"${name.replaceAll('"', '""')}"`;

function schemaInventory(database: DatabaseSync): unknown {
  const schema = database.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
  const pragma = (name: string) => Object.values(database.prepare(`PRAGMA ${name}`).get() ?? {})[0] ?? null;
  const hasMigrations = Boolean(database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='_prisma_migrations'").get());
  let migrations: string[] = [];
  if (hasMigrations) {
    const columns = (database.prepare(`PRAGMA table_info(${identifier('_prisma_migrations')})`).all() as Array<{ name: string }>).map(row => row.name);
    migrations = (database.prepare(`SELECT ${columns.map(identifier).join(',')} FROM ${identifier('_prisma_migrations')}`).all() as Array<Record<string, unknown>>)
      .map(row => JSON.stringify(columns.map(column => row[column]))).sort();
  }
  return { schema, userVersion: pragma('user_version'), applicationId: pragma('application_id'), migrations };
}

/** Reviewed imports are data-only. Migrations and every table/index/view/trigger definition must
 * remain byte-for-byte equivalent to the accepted database. */
function assertReviewSchemaUnchanged(beforePath: string, reviewedPath: string): void {
  const before = new DatabaseSync(beforePath, { readOnly: true });
  const reviewed = new DatabaseSync(reviewedPath, { readOnly: true });
  try {
    if (JSON.stringify(schemaInventory(before)) !== JSON.stringify(schemaInventory(reviewed)))
      throw new Error('Review import cannot change SQLite schema, triggers, indexes, pragmas, or Prisma migration history');
  } finally { before.close(); reviewed.close(); }
}

function orderedTableRows(database: DatabaseSync, table: string): Array<Record<string, unknown>> {
  const columns = database.prepare(`PRAGMA table_info(${identifier(table)})`).all() as Array<{ name: string; pk: number }>;
  const keys = columns.filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk).map(column => identifier(column.name));
  if (!keys.length) throw new Error(`Update ledger table has no stable identity: ${table}`);
  return database.prepare(`SELECT ${columns.map(column => identifier(column.name)).join(',')} FROM ${identifier(table)} ORDER BY ${keys.join(',')}`).all() as Array<Record<string, unknown>>;
}

/** Editing source facts is not proof of a fresh, complete manual-source capture. Keep the
 * existing queue and observation timestamps intact; a strict manifest is the only exception. */
function assertReviewLedgerUnchanged(beforePath: string, reviewedPath: string): void {
  const before = new DatabaseSync(beforePath, { readOnly: true });
  const reviewed = new DatabaseSync(reviewedPath, { readOnly: true });
  try {
    const tableNames = (database: DatabaseSync) => new Set((database.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all() as Array<{ name: string }>).map(row => row.name));
    const beforeTables = tableNames(before), reviewedTables = tableNames(reviewed);
    for (const table of ['UpdateSource', 'UpdateItem', 'UpdateRun', 'SourceCapture']) {
      if (!beforeTables.has(table) && !reviewedTables.has(table)) continue;
      if (!beforeTables.has(table) || !reviewedTables.has(table)) throw new Error('Review import cannot add or remove the update ledger; migrate through the normal updater');
      if (JSON.stringify(orderedTableRows(before, table)) !== JSON.stringify(orderedTableRows(reviewed, table)))
        throw new Error('Review import must preserve pending tasks and source freshness; source coverage requires a strict capture manifest');
    }
  } finally { before.close(); reviewed.close(); }
}

function setExisting(row: Record<string, unknown>, values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) if (Object.hasOwn(row, key)) row[key] = value;
}

function assertExpectedLedgerDelta(beforePath: string, reviewedPath: string, resolutions: readonly CaptureResolution[], importedAt: number): void {
  const before = new DatabaseSync(beforePath, { readOnly: true });
  const reviewed = new DatabaseSync(reviewedPath, { readOnly: true });
  try {
    const bySource = new Map(resolutions.map(resolution => [resolution.sourceKey, resolution]));
    const byTask = new Map(resolutions.map(resolution => [`${resolution.sourceKey}\u0000${resolution.itemKey}`, resolution]));
    const hasTable = (database: DatabaseSync, table: string) => Boolean(database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table));
    for (const table of ['UpdateSource', 'UpdateItem', 'UpdateRun', 'SourceCapture']) {
      const beforeHas = hasTable(before, table), reviewedHas = hasTable(reviewed, table);
      if (!beforeHas && !reviewedHas) continue;
      if (!beforeHas || !reviewedHas) throw new Error('Capture acknowledgement changed the update ledger schema');
      const expected = orderedTableRows(before, table);
      if (table === 'UpdateSource') for (const row of expected) {
        const resolution = bySource.get(String(row.sourceKey));
        if (resolution) setExisting(row, {
          lastAttemptAt: resolution.capturedAt,
          lastSuccessAt: resolution.capturedAt,
          nextCheckAt: resolution.capturedAt + WEEK_MS,
          updatedAt: importedAt,
        });
      }
      if (table === 'UpdateItem') for (const row of expected) {
        const resolution = byTask.get(`${String(row.sourceKey)}\u0000${String(row.itemKey)}`);
        if (resolution && row.task === 'capture') setExisting(row, {
          state: 'complete',
          nextAttemptAt: null,
          lastError: null,
          errorCategory: null,
          evidenceRef: resolution.evidenceRef,
          completedAt: importedAt,
          updatedAt: importedAt,
        });
      }
      if (JSON.stringify(expected) !== JSON.stringify(orderedTableRows(reviewed, table)))
        throw new Error(`Capture acknowledgement changed unexpected ${table} fields or rows`);
    }
  } finally { before.close(); reviewed.close(); }
}

function applyCaptureResolutions(databasePath: string, resolutions: readonly CaptureResolution[], importedAt: number): void {
  if (!resolutions.length) return;
  const database = new DatabaseSync(databasePath);
  try {
    database.exec('BEGIN IMMEDIATE');
    const source = database.prepare('SELECT kind, lastSuccessAt FROM UpdateSource WHERE sourceKey = ?');
    const complete = database.prepare("UPDATE UpdateItem SET state='complete', completedAt=?, nextAttemptAt=NULL, lastError=NULL, errorCategory=NULL, evidenceRef=?, updatedAt=? WHERE sourceKey=? AND itemKey=? AND task='capture' AND state='needs_review'");
    const fresh = database.prepare("UPDATE UpdateSource SET lastAttemptAt=?, lastSuccessAt=?, nextCheckAt=?, updatedAt=? WHERE sourceKey=? AND kind='manual'");
    for (const resolution of resolutions) {
      const current = source.get(resolution.sourceKey) as { kind?: string; lastSuccessAt?: unknown } | undefined;
      if (current?.kind !== 'manual' || (sqliteMillis(current.lastSuccessAt) ?? -Infinity) >= resolution.capturedAt)
        throw new Error('Acknowledged capture source is no longer eligible for this observation');
      if (complete.run(importedAt, resolution.evidenceRef, importedAt, resolution.sourceKey, resolution.itemKey).changes !== 1)
        throw new Error('Acknowledged capture task is missing or no longer needs review');
      if (fresh.run(resolution.capturedAt, resolution.capturedAt, resolution.capturedAt + WEEK_MS, importedAt, resolution.sourceKey).changes !== 1)
        throw new Error('Acknowledged capture source could not be advanced');
    }
    database.exec('COMMIT');
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch { /* transaction may not have started */ }
    throw error;
  } finally { database.close(); }
}

async function retainCaptureBatch(store: ObjectStore, batch: LoadedCaptureBatch): Promise<EvidenceReference[]> {
  const files = [batch.manifestFile, ...batch.artifactFiles];
  const references: EvidenceReference[] = [];
  for (const file of files) {
    const reference = await captureEvidence({
      store,
      key: importedEvidenceKey(file.path, file.body),
      source: file.path,
      parserVersion: 'assisted-capture-manifest-v1',
      capturedAt: batch.manifest.generatedAt,
      payload: { path: file.path, encoding: 'base64', contents: file.body.toString('base64') },
    });
    references.push(reference);
  }
  return references;
}

function sameEvidence(left: readonly EvidenceReference[], right: readonly EvidenceReference[]): boolean {
  const sort = (rows: readonly EvidenceReference[]) => [...rows].sort((a, b) => a.key.localeCompare(b.key));
  return JSON.stringify(sort(left)) === JSON.stringify(sort(right));
}

/** Adopt checked-out, evidence-reviewed additions into private state. This is deliberately
 * separate from publication: the next normal code/data update still validates the full bake. */
export async function adoptReviewedArchive(options: {
  store: ObjectStore;
  databasePath: string;
  repositoryPath: string;
  codeRevision: string;
}) {
  const lease = await acquireLease(options.store);
  let temporary: string | undefined;
  const databasePath = resolve(options.databasePath);
  const parent = dirname(databasePath);
  try {
    const sidecar = await readReviewSidecar(databasePath);
    if (resolve(sidecar.databasePath) !== databasePath) throw new Error('Review sidecar belongs to a different database path');
    const accepted = await readStatePointer(options.store);
    if (!accepted || accepted.etag !== sidecar.etag || accepted.pointer.snapshotId !== sidecar.snapshotId)
      throw new StorageConflictError();
    await mkdir(parent, { recursive: true });
    temporary = await mkdtemp(join(parent, '.review-import-'));
    const baselinePath = join(temporary, 'before.db');
    const acceptedManifest = await restoreSnapshot(options.store, accepted.pointer, baselinePath);
    if (!sameEvidence(sidecar.evidenceRefs, acceptedManifest.evidence)) throw new Error('Review sidecar evidence inventory was changed');
    const candidatePath = join(temporary, 'reviewed.db');
    // Freeze the operator's file once with SQLite's online backup API. Further local edits
    // cannot slip into a snapshot after validation, and an open WAL is captured correctly.
    await snapshotDatabase(databasePath, candidatePath);
    assertReviewSchemaUnchanged(baselinePath, candidatePath);
    assertArchivePreserved(baselinePath, candidatePath);
    assertReviewLedgerUnchanged(baselinePath, candidatePath);

    // Load every declared byte into memory before any private-store write. Only strict manifests
    // and their hash-bound artifacts are retained; unrelated allowlisted repository files are not.
    const repositoryPath = resolve(options.repositoryPath);
    const allowed = new Set(await discoverBootstrapEvidence(repositoryPath));
    const batches: LoadedCaptureBatch[] = [];
    for (const descriptor of sidecar.captureManifests)
      batches.push(await loadCaptureBatch(repositoryPath, descriptor.path, allowed, descriptor));
    const resolutions = validateCaptureAssertions(candidatePath, batches);
    const importedAt = Date.now();
    applyCaptureResolutions(candidatePath, resolutions, importedAt);
    assertReviewSchemaUnchanged(baselinePath, candidatePath);
    assertExpectedLedgerDelta(baselinePath, candidatePath, resolutions, importedAt);

    const evidence = new Map(acceptedManifest.evidence.map(reference => [reference.key, reference]));
    for (const batch of batches) for (const reference of await retainCaptureBatch(options.store, batch)) {
      const old = evidence.get(reference.key);
      if (old && (old.sha256 !== reference.sha256 || old.bytes !== reference.bytes))
        throw new Error('Reviewed evidence conflicts with the accepted archive');
      evidence.set(reference.key, reference);
    }
    await lease.assertHeld();
    const runId = `review-${randomUUID()}`;
    const result = await saveSnapshot({
      store: options.store,
      databasePath: candidatePath,
      previousDatabasePath: baselinePath,
      evidenceRefs: [...evidence.values()],
      runId,
      codeRevision: options.codeRevision,
      expectedStateEtag: accepted.etag,
    });
    return {
      status: 'adopted' as const,
      snapshotId: result.pointer.snapshotId,
      previousSnapshotId: accepted.pointer.snapshotId,
      evidenceFiles: evidence.size,
      published: false as const,
      sourceFreshnessChanged: resolutions.length > 0,
      acknowledgedCaptures: resolutions.length,
    };
  } finally {
    try {
      if (temporary) {
        const target = resolve(temporary);
        if (dirname(target) !== parent || !basename(target).startsWith('.review-import-')) throw new Error('Unexpected review temporary path');
        await rm(target, { recursive: true, force: true });
      }
    } finally { await lease.release(); }
  }
}
