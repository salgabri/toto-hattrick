import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, posix, relative, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { importedEvidenceKey } from './evidence.js';
import { sha256 } from './storage.js';

/**
 * Reviewed clearances return an impossible manager credit to "manager pending". They exist for
 * titles won before the credited Hattrick account existed (docs/PRE_SIGNUP_ATTRIBUTION_AUDIT_*):
 * no evidence path may overwrite a positive manager, so each clearance is an explicit, reviewed
 * exception bound to the exact prior row.
 */
export const CLEARANCE_DIRECTORY = 'server/src/data';
const CLEARANCE_FILE = /^reviewed-attribution-clearances-[a-z0-9-]+\.json$/;
const COMMITTED_DIRECTORY = fileURLToPath(new URL('../../src/data/', import.meta.url));
const MARGIN_DAYS = 112;
const FIRST_CALIBRATED_SEASON = 15;
/** The archive's "known result, manager unknown" sentinel. NULL would make a cup placeholder
 * look unfinished and fetchable again; 0 keeps the result while every evidence path can fill it. */
export const CLEARED_USER_ID = 0;

const id = z.number().int().safe().positive();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(`${value}T00:00:00Z`)));
const days = (later: string, earlier: string) => Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000);
const AnchorSchema = z.object({ anchorUserId: id, signup: isoDate, gapDays: z.number().int() }).strict();

export const AttributionClearanceSchema = z.object({
  kind: z.literal('clear-attribution'),
  table: z.enum(['leagueChampion', 'cupChampion']),
  competitionId: id, season: id, leagueId: z.number().int().safe().nonnegative(),
  teamName: z.string().min(1),
  expectedPriorTeamId: z.number().int().safe().nonnegative().nullable(),
  expectedPriorUserId: id,
  expectedPriorUserName: z.string().min(1).nullable(),
  confidence: z.enum(['high', 'medium']),
  reason: z.string().trim().min(1),
  evidence: z.object({
    family: z.enum(['league', 'main-cup', 'secondary-cup', 'masters', 'seasonal']),
    titleLatest: isoDate, globalSeason: id,
    accountNotBefore: AnchorSchema, corroboratingAnchor: AnchorSchema.nullable(),
    ownSignupOnChain: z.boolean().nullable(),
  }).strict(),
  reviewedAt: isoDate,
}).strict().superRefine((record, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  const { evidence } = record;
  if ((record.table === 'leagueChampion') !== (evidence.family === 'league')) invalid('Clearance table and title family disagree');
  if (record.table === 'leagueChampion' && record.competitionId !== record.leagueId) invalid('A league clearance must name its own league');
  // Re-derive the audit's verdict from the record itself, so an edited gap or label cannot pass.
  const anchor = evidence.accountNotBefore;
  if (anchor.anchorUserId > record.expectedPriorUserId) invalid('The account anchor must be at or below the credited user ID');
  if (days(anchor.signup, evidence.titleLatest) !== anchor.gapDays) invalid('Account anchor gap does not match its dates');
  if (anchor.gapDays < MARGIN_DAYS) invalid(`The credited account must postdate the title by at least ${MARGIN_DAYS} days`);
  const second = evidence.corroboratingAnchor;
  if (second && second.anchorUserId >= anchor.anchorUserId) invalid('The corroborating anchor must be a lower user ID');
  if (second && days(second.signup, evidence.titleLatest) !== second.gapDays) invalid('Corroborating anchor gap does not match its dates');
  const highMargin = evidence.globalSeason < FIRST_CALIBRATED_SEASON ? 2 * MARGIN_DAYS : MARGIN_DAYS;
  if (record.confidence === 'high' && !(second && second.gapDays >= highMargin)) invalid('High confidence needs a corroborating anchor beyond the margin');
  if (Date.parse(`${record.reviewedAt}T00:00:00Z`) > Date.now() + 86_400_000) invalid('Review date cannot be in the future');
});
export type AttributionClearance = z.infer<typeof AttributionClearanceSchema>;

export const AttributionClearanceManifestSchema = z.object({
  format: z.literal('reviewed-attribution-clearance-v1'),
  status: z.literal('reviewed'),
  generatedAt: z.string().datetime(),
  snapshot: z.object({ snapshotId: z.string().min(1), createdAt: z.string().datetime(), databaseSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  audit: z.object({ script: z.string().min(1), report: z.string().min(1), marginDays: z.literal(MARGIN_DAYS),
    firstCalibratedSeason: z.literal(FIRST_CALIBRATED_SEASON) }).strict(),
  effect: z.string().min(1),
  guard: z.string().min(1),
  records: z.array(AttributionClearanceSchema).min(1),
}).strict().superRefine((manifest, ctx) => {
  const keys = new Set<string>();
  for (const record of manifest.records) {
    const key = clearanceFactKey(record);
    if (keys.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate reviewed clearance ${key}` });
    keys.add(key);
  }
});
export type AttributionClearanceManifest = z.infer<typeof AttributionClearanceManifestSchema>;

export const ClearanceManifestDescriptorSchema = z.object({
  path: z.string().min(1),
  evidenceRef: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive(),
}).strict();
export type ClearanceManifestDescriptor = z.infer<typeof ClearanceManifestDescriptorSchema>;
export interface LoadedClearanceManifest { descriptor: ClearanceManifestDescriptor; manifest: AttributionClearanceManifest; body: Buffer }

/** Release fact key, as in the published league/cup rolls. */
export const clearanceFactKey = (record: Pick<AttributionClearance, 'table' | 'competitionId' | 'season'>) =>
  `${record.table === 'leagueChampion' ? 'league' : 'cup'}:${record.competitionId}:${record.season}`;
/** Primary-key identity used by archive preservation: [leagueId|cupId, season]. */
export const clearancePrimaryKey = (record: Pick<AttributionClearance, 'competitionId' | 'season'>) =>
  JSON.stringify([record.competitionId, record.season]);
const TABLES = {
  leagueChampion: { table: 'LeagueChampion', key: 'leagueId' },
  cupChampion: { table: 'CupChampion', key: 'cupId' },
} as const;

export function parseClearanceManifest(body: Buffer): AttributionClearanceManifest {
  try { return AttributionClearanceManifestSchema.parse(JSON.parse(body.toString('utf8').replace(/^﻿/, ''))); }
  catch (error) { throw new Error(`Invalid reviewed clearance manifest: ${error instanceof Error ? error.message : 'parse failed'}`); }
}

/** Only committed, reviewed manifests under server/src/data can be applied. */
export async function loadClearanceManifest(repositoryPath: string, requestedPath: string,
  expected?: ClearanceManifestDescriptor): Promise<LoadedClearanceManifest> {
  const repository = resolve(repositoryPath);
  const absolute = resolve(repository, requestedPath);
  const relativePath = relative(repository, absolute).replaceAll('\\', '/');
  if (posix.dirname(relativePath) !== CLEARANCE_DIRECTORY || !CLEARANCE_FILE.test(posix.basename(relativePath)))
    throw new Error(`Reviewed clearance manifests must be ${CLEARANCE_DIRECTORY}/reviewed-attribution-clearances-<name>.json`);
  const info = await lstat(absolute).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error('Reviewed clearance manifest must be a regular file, not a directory or symlink');
  const realDirectory = await realpath(resolve(repository, CLEARANCE_DIRECTORY));
  const fragment = relative(realDirectory, await realpath(absolute));
  if (!fragment || fragment.startsWith('..') || isAbsolute(fragment)) throw new Error('Reviewed clearance manifest escapes its directory');
  const body = await readFile(absolute);
  const manifest = parseClearanceManifest(body);
  const descriptor = ClearanceManifestDescriptorSchema.parse({
    path: relativePath, evidenceRef: importedEvidenceKey(relativePath, body), sha256: sha256(body), bytes: body.length,
  });
  if (expected && JSON.stringify(descriptor) !== JSON.stringify(expected))
    throw new Error(`Reviewed clearance manifest changed after it was applied: ${relativePath}`);
  return { descriptor, manifest, body };
}

type Row = Record<string, unknown>;
export interface ClearancePlan {
  record: AttributionClearance;
  status: 'wouldApply' | 'unchanged' | 'conflict';
  reason: string;
  before: Row | null;
}

function readRow(database: DatabaseSync, record: AttributionClearance): Row | null {
  const { table, key } = TABLES[record.table];
  return (database.prepare(`SELECT * FROM "${table}" WHERE "${key}" = ? AND season = ?`).get(record.competitionId, record.season) as Row | undefined) ?? null;
}

/** Every identity field of the reviewed prior row must still match exactly. */
export function planClearances(database: DatabaseSync, records: readonly AttributionClearance[]): ClearancePlan[] {
  return records.map(record => {
    const before = readRow(database, record);
    const conflict = (reason: string): ClearancePlan => ({ record, status: 'conflict', reason, before });
    if (!before) return conflict('missingExactRow');
    if (before.leagueId !== record.leagueId) return conflict('leagueIdMismatch');
    if (before.championTeamName !== record.teamName) return conflict('teamNameMismatch');
    if ((before.championTeamId ?? null) !== record.expectedPriorTeamId) return conflict('expectedPriorTeamIdMismatch');
    if (before.championUserId === CLEARED_USER_ID && before.championUserName === null)
      return { record, status: 'unchanged', reason: 'alreadyCleared', before };
    if (before.championUserId !== record.expectedPriorUserId) return conflict('expectedPriorUserIdMismatch');
    if ((before.championUserName ?? null) !== record.expectedPriorUserName) return conflict('expectedPriorUserNameMismatch');
    return { record, status: 'wouldApply', reason: 'reviewedClearance', before };
  });
}

/** One transaction; each update is guarded by the full prior identity. Callers check conflicts first. */
export function applyPlannedClearances(database: DatabaseSync, plans: readonly ClearancePlan[], now: number): number {
  if (plans.some(plan => plan.status === 'conflict')) throw new Error('A conflicting clearance blocks the whole batch');
  let applied = 0;
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const { record, status } of plans) {
      if (status !== 'wouldApply') continue;
      const { table, key } = TABLES[record.table];
      const changed = database.prepare(`UPDATE "${table}" SET championUserId = ?, championUserName = NULL, updatedAt = ?
        WHERE "${key}" = ? AND season = ? AND leagueId = ? AND championTeamName = ? AND championTeamId IS ?
          AND championUserId = ? AND championUserName IS ?`).run(CLEARED_USER_ID, now, record.competitionId, record.season,
        record.leagueId, record.teamName, record.expectedPriorTeamId, record.expectedPriorUserId, record.expectedPriorUserName);
      if (changed.changes !== 1) throw new Error(`Reviewed clearance changed concurrently: ${clearanceFactKey(record)}; transaction rolled back`);
      applied++;
    }
    database.exec('COMMIT');
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch { /* transaction may not have started */ }
    throw error;
  }
  return applied;
}

/** The exact cells an import may clear: listed rows that still hold the reviewed prior identity. */
export function clearanceCells(database: DatabaseSync, manifests: readonly AttributionClearanceManifest[]) {
  const records = manifests.flatMap(manifest => manifest.records);
  const keys = new Set<string>();
  for (const record of records) {
    const key = clearanceFactKey(record);
    if (keys.has(key)) throw new Error(`Two applied clearance manifests list ${key}`);
    keys.add(key);
  }
  const plans = planClearances(database, records);
  const conflict = plans.find(plan => plan.status === 'conflict');
  if (conflict) throw new Error(`Accepted archive no longer matches reviewed clearance ${clearanceFactKey(conflict.record)} (${conflict.reason})`);
  const pending = plans.filter(plan => plan.status === 'wouldApply');
  const allow = new Map<string, Set<string>>();
  for (const { record } of pending) {
    const { table } = TABLES[record.table];
    const rows = allow.get(table) ?? new Set<string>();
    rows.add(clearancePrimaryKey(record));
    allow.set(table, rows);
  }
  return { allow, pending };
}

/** A listed row may differ from the accepted row only in the cleared identity and updatedAt. */
export function assertClearancesApplied(database: DatabaseSync, pending: readonly ClearancePlan[]): void {
  for (const plan of pending) {
    const after = readRow(database, plan.record);
    const expected = { ...plan.before, championUserId: CLEARED_USER_ID, championUserName: null, updatedAt: after?.updatedAt };
    if (!after || JSON.stringify(after) !== JSON.stringify(expected))
      throw new Error(`Reviewed clearance was not applied exactly: ${clearanceFactKey(plan.record)}`);
  }
}

/** Fact key -> reviewed prior manager, from every committed reviewed manifest. Release
 * continuity accepts a lost manager only for these exact pairs. */
export async function committedClearanceAllowance(directory = COMMITTED_DIRECTORY): Promise<Map<string, number>> {
  const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
  const allowance = new Map<string, number>();
  for (const name of names.filter(name => CLEARANCE_FILE.test(name)).sort()) {
    for (const record of parseClearanceManifest(await readFile(join(directory, name))).records) {
      const key = clearanceFactKey(record);
      if (allowance.has(key)) throw new Error(`Two committed clearance manifests list ${key}`);
      allowance.set(key, record.expectedPriorUserId);
    }
  }
  return allowance;
}
