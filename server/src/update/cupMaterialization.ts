import { open, readFile, type FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { TokenPair } from '../chpp/auth.js';
import { useUpdateDatabase } from '../config/env.js';
import type { BackfillCupsResult } from '../sync/backfillCups.js';
import { readReviewSidecar } from './review.js';

/**
 * Name-only domestic cup winners → real finals with numeric club identities, in a REVIEW CHECKOUT.
 *
 * Rebuilding the archive from published bundles kept only the winning club's NAME for thousands of
 * older cup finals (finalMatchId 0, championTeamId null, no manager). Without a numeric club
 * identity neither the guarded current-owner attribution (`update attribute --backfill`) nor Club
 * History recovery can reach such a title. CHPP `cupmatches` still serves those seasons, so this
 * runs backfillCups' two facts-only steps for each final, both checked against the stored winner:
 *
 *   1. cupmatches(cupId, season) → the final's match ID, score and runner-up (winner name must match)
 *   2. matchdetails(final)        → the winner's team ID (positional winner, name must match again)
 *
 * It never names a manager, bridges club names, resolves nationalities or bakes. The checkout
 * sidecar's retained evidence is honoured: a cup season the updater has already started fetching
 * is left to the updater, and a final whose matchdetails are retained is never fetched again.
 * Dry run unless `apply`; an applied run spends at most `maxCalls` and commits final by final.
 *
 * `carryMaterializedFinals` replays finals an older (stale) checkout already materialized into a
 * fresh checkout, with no CHPP call, so a refused import never forces a fetch to be repeated.
 */

export interface FinalKey { cupId: number; season: number }
export interface MaterializedFinal extends FinalKey {
  finalMatchId: number; championTeamId: number; championTeamName: string;
  runnerUpTeamName: string; homeGoals: number; awayGoals: number;
}

const FinalKeysSchema = z.array(z.object({ cupId: z.number().int().positive(), season: z.number().int().positive() }).strict());
const RETAINED_CUP_SEASON = /^evidence\/(?:chpp|observations)\/cupmatches\/1\.2\/(\d+)\/(\d+)\//;
const RETAINED_MATCH = /^evidence\/(?:chpp|observations)\/matchdetails\/3\.0\/(\d+)\//;
export const MAX_MATERIALIZE_CALLS = 2000;

/** Domestic cup winners with no club identity and no manager; newest seasons first within each cup.
 * Mostly name-only placeholders (finalMatchId 0). A final whose matchdetails step failed after its
 * cupmatches step keeps its match ID and is selected again for the second step only. */
const NAME_ONLY_FINALS = `SELECT c.cupId AS cupId, c.season AS season FROM CupChampion c JOIN Cup cu ON cu.cupId = c.cupId
  WHERE c.championTeamId IS NULL AND c.championUserId IS NULL AND cu.leagueId <> 0
    AND TRIM(c.championTeamName) <> ''
  ORDER BY cu.isMain DESC, cu.leagueId, cu.cupLevelIndex, c.cupId, c.season DESC`;
const MATERIALIZED = `SELECT cupId, season, finalMatchId, championTeamId, championTeamName, runnerUpTeamName, homeGoals, awayGoals
  FROM CupChampion WHERE finalMatchId > 0 AND championTeamId > 0 AND championUserId IS NULL`;
/** Every real final with a club identity in an older checkout, whatever its manager since. */
const CARRY_SOURCE = `SELECT cupId, season, finalMatchId, championTeamId, championTeamName, runnerUpTeamName, homeGoals, awayGoals, updatedAt
  FROM CupChampion WHERE finalMatchId > 0 AND championTeamId > 0 ORDER BY cupId, season DESC`;
const keyOf = (final: FinalKey) => `${final.cupId}:${final.season}`;

/** Pure selection: which name-only finals may be fetched, given the checkout's retained evidence. */
export function planCupMaterialization(candidates: readonly FinalKey[], evidenceKeys: readonly string[], only?: readonly FinalKey[]) {
  const retainedSeasons = new Set<string>();
  const retainedMatchIds = new Set<number>();
  for (const key of evidenceKeys) {
    const season = RETAINED_CUP_SEASON.exec(key);
    if (season) retainedSeasons.add(`${Number(season[1])}:${Number(season[2])}`);
    const match = RETAINED_MATCH.exec(key);
    if (match) retainedMatchIds.add(Number(match[1]));
  }
  const wanted = only ? new Set(only.map(keyOf)) : null;
  const finals: FinalKey[] = [];
  const leftToUpdater: FinalKey[] = [];
  for (const candidate of candidates) {
    const final = { cupId: Number(candidate.cupId), season: Number(candidate.season) };
    if (wanted && !wanted.has(keyOf(final))) continue;
    (retainedSeasons.has(keyOf(final)) ? leftToUpdater : finals).push(final);
  }
  return { finals, leftToUpdater, retainedMatchIds };
}

async function checkout(databasePath: string) {
  const sidecar = await readReviewSidecar(databasePath);
  if (resolve(sidecar.databasePath) !== databasePath) throw new Error('Review sidecar belongs to a different database path');
  return sidecar;
}
const readRows = <T>(databasePath: string, sql: string): T[] => {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try { return db.prepare(sql).all() as T[]; } finally { db.close(); }
};
async function writeReport(file: FileHandle | undefined, body: unknown) {
  if (file) await file.writeFile(`${JSON.stringify(body, null, 1)}\n`);
}

export interface MaterializeSummary {
  dryRun: boolean; databasePath: string; snapshotId: string;
  nameOnlyFinals: number; selected: number; leftToUpdater: FinalKey[];
  result?: Omit<BackfillCupsResult, 'remaining'>; filled?: number; nameOnlyRemaining?: number; reportPath: string | null;
}

export async function materializeCheckoutCupFinals(options: {
  databasePath: string; token?: TokenPair; apply?: boolean; maxCalls?: number; pacingMs?: number;
  reportPath?: string; onlyFinalsPath?: string;
}): Promise<MaterializeSummary> {
  const databasePath = resolve(options.databasePath);
  const sidecar = await checkout(databasePath);
  if (options.apply) {
    if (!options.reportPath) throw new Error('materialize --apply requires --report <new.json>');
    if (!options.token) throw new Error('materialize --apply requires CHPP credentials');
    if (!Number.isSafeInteger(options.maxCalls) || options.maxCalls! < 1 || options.maxCalls! > MAX_MATERIALIZE_CALLS)
      throw new Error(`materialize --apply requires --max-calls between 1 and ${MAX_MATERIALIZE_CALLS}`);
  }
  const pacingMs = options.pacingMs ?? 600;
  if (!Number.isSafeInteger(pacingMs) || pacingMs < 300) throw new Error('Pacing must be at least 300 ms between CHPP calls');
  const only = options.onlyFinalsPath
    ? FinalKeysSchema.parse(JSON.parse((await readFile(resolve(options.onlyFinalsPath), 'utf8')).replace(/^﻿/, '')))
    : undefined;
  const reportFile = options.reportPath ? await open(resolve(options.reportPath), 'wx') : undefined;
  const startedAt = new Date().toISOString();
  try {
    const candidates = readRows<FinalKey>(databasePath, NAME_ONLY_FINALS);
    const plan = planCupMaterialization(candidates, sidecar.evidenceRefs.map(ref => ref.key), only);
    const summary: MaterializeSummary = {
      dryRun: !options.apply, databasePath, snapshotId: sidecar.snapshotId,
      nameOnlyFinals: candidates.length, selected: plan.finals.length, leftToUpdater: plan.leftToUpdater,
      reportPath: options.reportPath ? resolve(options.reportPath) : null,
    };
    if (!options.apply) {
      await writeReport(reportFile, { ...summary, startedAt, finals: plan.finals });
      return summary;
    }
    // The shared Prisma client must point at the checkout before anything loads it.
    useUpdateDatabase(`file:${databasePath.replaceAll('\\', '/')}`);
    const { prisma } = await import('../db/client.js');
    const { backfillCups } = await import('../sync/backfillCups.js');
    try {
      const { remaining: _allUnattributed, ...result } = await backfillCups(options.token!, {
        maxCalls: options.maxCalls, pacingMs, attributeOwners: false, onlyFinals: plan.finals, retainedMatchIds: plan.retainedMatchIds,
      });
      const planned = new Set(plan.finals.map(keyOf));
      const filled = readRows<MaterializedFinal>(databasePath, MATERIALIZED).filter(row => planned.has(keyOf(row)));
      const nameOnlyRemaining = readRows<FinalKey>(databasePath, NAME_ONLY_FINALS).length;
      Object.assign(summary, { result, filled: filled.length, nameOnlyRemaining });
      await writeReport(reportFile, { ...summary, startedAt, finishedAt: new Date().toISOString(), pacingMs, maxCalls: options.maxCalls, filled });
      return summary;
    } finally { await prisma.$disconnect(); }
  } finally { await reportFile?.close(); }
}

export interface CarrySummary { dryRun: boolean; databasePath: string; fromPath: string; carried: number; conflicts: Array<FinalKey & { reason: string }>; reportPath: string | null }

/**
 * Replays finals that an older checkout materialized into this (fresh) checkout. A row is carried
 * only while it is still a name-only placeholder here with the identical winner name, and only if
 * its final match is not already assigned to another final. No CHPP call is made.
 */
export async function carryMaterializedFinals(options: { databasePath: string; fromPath: string; apply?: boolean; reportPath?: string }): Promise<CarrySummary> {
  const databasePath = resolve(options.databasePath);
  const fromPath = resolve(options.fromPath);
  if (fromPath === databasePath) throw new Error('Carry needs a different, older checkout as its source');
  await checkout(databasePath);
  await checkout(fromPath);
  if (options.apply && !options.reportPath) throw new Error('materialize --carry-from --apply requires --report <new.json>');
  const reportFile = options.reportPath ? await open(resolve(options.reportPath), 'wx') : undefined;
  try {
    const source = readRows<MaterializedFinal & { updatedAt: number }>(fromPath, CARRY_SOURCE);
    const db = new DatabaseSync(databasePath);
    const carried: MaterializedFinal[] = [];
    const conflicts: CarrySummary['conflicts'] = [];
    try {
      const current = db.prepare('SELECT finalMatchId, championTeamId, championTeamName, championUserId FROM CupChampion WHERE cupId = ? AND season = ?');
      const assigned = db.prepare('SELECT cupId, season FROM CupChampion WHERE finalMatchId = ? AND NOT (cupId = ? AND season = ?)');
      const update = db.prepare(`UPDATE CupChampion SET finalMatchId = ?, championTeamId = ?, runnerUpTeamName = ?, homeGoals = ?, awayGoals = ?, updatedAt = ?
        WHERE cupId = ? AND season = ? AND finalMatchId = 0 AND championTeamId IS NULL AND championUserId IS NULL AND championTeamName = ?`);
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const row of source) {
          const here = current.get(row.cupId, row.season) as { finalMatchId: number; championTeamId: number | null; championTeamName: string; championUserId: number | null } | undefined;
          if (!here || here.finalMatchId !== 0 || here.championTeamId !== null || here.championUserId !== null) continue;
          if (here.championTeamName !== row.championTeamName) { conflicts.push({ cupId: row.cupId, season: row.season, reason: 'Winner name differs from the older checkout' }); continue; }
          const other = assigned.get(row.finalMatchId, row.cupId, row.season) as FinalKey | undefined;
          if (other) { conflicts.push({ cupId: row.cupId, season: row.season, reason: `Final match is already assigned to cup ${other.cupId} season ${other.season}` }); continue; }
          if (options.apply) {
            const changed = update.run(row.finalMatchId, row.championTeamId, row.runnerUpTeamName, row.homeGoals, row.awayGoals, row.updatedAt,
              row.cupId, row.season, row.championTeamName);
            if (changed.changes !== 1) throw new Error(`Guard rejected CupChampion ${row.cupId}/${row.season}`);
          }
          const { updatedAt: _at, ...facts } = row;
          carried.push(facts);
        }
        db.exec(options.apply ? 'COMMIT' : 'ROLLBACK');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } finally { db.close(); }
    const summary: CarrySummary = { dryRun: !options.apply, databasePath, fromPath, carried: carried.length, conflicts,
      reportPath: options.reportPath ? resolve(options.reportPath) : null };
    await writeReport(reportFile, { ...summary, generatedAt: new Date().toISOString(), finals: carried });
    return summary;
  } finally { await reportFile?.close(); }
}
