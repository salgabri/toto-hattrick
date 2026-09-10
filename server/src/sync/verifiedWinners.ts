import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/client.js';

/** Curated, per-title evidence, never a team-name-to-current-manager lookup. */
export const verifiedWinnerSchema = z.object({
  table: z.enum(['cupChampion', 'leagueChampion']),
  competitionId: z.number().int().positive(),
  season: z.number().int().positive(),
  teamId: z.number().int().positive().optional(),
  /** The club's country/league, not the competition's country or manager nationality. */
  teamLeagueId: z.number().int().positive().optional(),
  teamName: z.string().min(1).refine((value) => value.trim().length > 0),
  userId: z.number().int().positive(),
  name: z.string().min(1).refine((value) => value.trim().length > 0),
  sources: z.array(z.string().url().refine((value) => /^https?:\/\//.test(value))).min(1),
  evidence: z.string().min(1).refine((value) => value.trim().length > 0),
}).strict();

export type VerifiedWinner = z.infer<typeof verifiedWinnerSchema>;
export interface WinnerIdentity {
  table: VerifiedWinner['table'];
  competitionId: number;
  season: number;
  championTeamId: number | null;
  championTeamName: string;
  championUserId: number | null;
  leagueId?: number;
  championLeagueId?: number | null;
  /** An unfinished league table is not a historical title. */
  complete?: boolean;
}

type Decision = { action: 'fill' | 'unchanged' | 'conflict'; reason: string };

/** Exact historical row identity is mandatory, even when the club ID was lost from a bake. */
export function planVerifiedWinner(source: VerifiedWinner, target: WinnerIdentity): Decision {
  if (source.table !== target.table || source.competitionId !== target.competitionId || source.season !== target.season) {
    return { action: 'conflict', reason: 'competitionOrSeasonMismatch' };
  }
  if (source.teamName !== target.championTeamName) return { action: 'conflict', reason: 'teamNameMismatch' };
  if (target.championTeamId !== null && target.championTeamId < 0) return { action: 'conflict', reason: 'invalidExistingTeamId' };
  if (source.teamId !== undefined && (target.championTeamId ?? 0) > 0 && source.teamId !== target.championTeamId) {
    return { action: 'conflict', reason: 'teamIdMismatch' };
  }
  const verifiesIntlCountry = target.table === 'cupChampion' && target.leagueId === 0 && source.teamLeagueId !== undefined;
  if (verifiesIntlCountry && target.championLeagueId !== undefined && target.championLeagueId !== null) {
    if (target.championLeagueId < 0) return { action: 'conflict', reason: 'invalidExistingTeamCountry' };
    if (target.championLeagueId > 0 && target.championLeagueId !== source.teamLeagueId) {
      return { action: 'conflict', reason: 'teamCountryMismatch' };
    }
  }
  const missingIntlCountry = verifiesIntlCountry && (target.championLeagueId === null || target.championLeagueId === 0);
  if (target.table === 'leagueChampion' && target.complete !== true) return { action: 'conflict', reason: 'unfinishedLeague' };
  if ((target.championUserId ?? 0) > 0) {
    return target.championUserId === source.userId
      ? source.teamId !== undefined && !target.championTeamId
        ? { action: 'fill', reason: 'verifiedExactTitleTeamId' }
        : missingIntlCountry ? { action: 'fill', reason: 'verifiedExactTitleCountry' }
        : { action: 'unchanged', reason: 'alreadyAttributed' }
      : { action: 'conflict', reason: 'existingHistoricalOwner' };
  }
  if (target.championUserId !== null && target.championUserId !== 0) return { action: 'conflict', reason: 'invalidExistingOwner' };
  return { action: 'fill', reason: 'verifiedExactTitle' };
}

export interface VerifiedWinnerResult {
  table: VerifiedWinner['table'];
  competitionId: number;
  season: number;
  teamName: string;
  userId: number;
  status: 'wouldApply' | 'applied' | 'unchanged' | 'conflict' | 'missingRow' | 'duplicate';
  reason: string;
  /** Present only when this exact source also restores a null/zero cached club ID. */
  restoredTeamId?: number;
  restoredTeamLeagueId?: number;
}

export interface VerifiedWinnerSummary {
  dryRun: boolean;
  records: number;
  wouldApply: number;
  applied: number;
  unchanged: number;
  conflicts: number;
  missingRows: number;
  duplicates: number;
  teamIdsToRestore: number;
  teamIdsRestored: number;
  teamCountriesToRestore: number;
  teamCountriesRestored: number;
  results: VerifiedWinnerResult[];
}

type WinnerDb = Pick<Prisma.TransactionClient, 'cupChampion' | 'leagueChampion' | 'hattrickUser'>;
const rowKey = (row: VerifiedWinner) => `${row.table}:${row.competitionId}:${row.season}`;

/** Internal runner: callers applying changes must supply an interactive transaction client. */
export async function processVerifiedWinners(
  db: WinnerDb,
  records: readonly VerifiedWinner[],
  apply = false,
): Promise<VerifiedWinnerSummary> {
  // Validate the complete input before any reads or writes, including callers not using the CLI.
  const sources = z.array(verifiedWinnerSchema).parse(records);
  const groups = new Map<string, VerifiedWinner[]>();
  for (const source of sources) {
    const key = rowKey(source);
    const group = groups.get(key) ?? [];
    group.push(source);
    groups.set(key, group);
  }
  const summary: VerifiedWinnerSummary = {
    dryRun: !apply, records: sources.length, wouldApply: 0, applied: 0, unchanged: 0,
    conflicts: 0, missingRows: 0, duplicates: 0, teamIdsToRestore: 0, teamIdsRestored: 0,
    teamCountriesToRestore: 0, teamCountriesRestored: 0, results: [],
  };
  for (const group of groups.values()) {
    const source = group[0]!;
    const result = (status: VerifiedWinnerResult['status'], reason: string, record = source,
      restoredTeamId?: number, restoredTeamLeagueId?: number) => {
      summary.results.push({ table: record.table, competitionId: record.competitionId, season: record.season,
        teamName: record.teamName, userId: record.userId, status, reason,
        ...(restoredTeamId === undefined ? {} : { restoredTeamId }),
        ...(restoredTeamLeagueId === undefined ? {} : { restoredTeamLeagueId }) });
      if (restoredTeamId !== undefined) {
        if (status === 'wouldApply') summary.teamIdsToRestore++;
        if (status === 'applied') summary.teamIdsRestored++;
      }
      if (restoredTeamLeagueId !== undefined) {
        if (status === 'wouldApply') summary.teamCountriesToRestore++;
        if (status === 'applied') summary.teamCountriesRestored++;
      }
      if (status === 'conflict') summary.conflicts++;
      else if (status === 'missingRow') summary.missingRows++;
      else if (status === 'duplicate') summary.duplicates++;
      else summary[status]++;
    };
    const knownTeamIds = new Set(group.flatMap((item) => item.teamId === undefined ? [] : [item.teamId]));
    const knownTeamCountries = new Set(group.flatMap((item) => item.teamLeagueId === undefined ? [] : [item.teamLeagueId]));
    if (knownTeamIds.size > 1 || knownTeamCountries.size > 1 || group.some((item) => item.teamName !== source.teamName || item.userId !== source.userId)) {
      for (const item of group) result('conflict', 'conflictingEvidenceForSameTitle', item);
      continue;
    }
    // Retain the strongest identity if a duplicate has a numeric team ID and the first does not.
    const candidate = { ...source, teamId: [...knownTeamIds][0], teamLeagueId: [...knownTeamCountries][0] };
    for (const duplicate of group.slice(1)) result('duplicate', 'sameTitleAndUser', duplicate);
    const row = source.table === 'cupChampion'
      ? await db.cupChampion.findUnique({ where: { cupId_season: { cupId: source.competitionId, season: source.season } } })
      : await db.leagueChampion.findUnique({ where: { leagueId_season: { leagueId: source.competitionId, season: source.season } } });
    if (!row) { result('missingRow', 'noExactCompetitionSeason'); continue; }
    const decision = planVerifiedWinner(candidate, {
      table: source.table, competitionId: 'cupId' in row ? row.cupId : row.leagueId,
      season: row.season, championTeamId: row.championTeamId, championTeamName: row.championTeamName,
      championUserId: row.championUserId, complete: 'complete' in row ? row.complete : undefined,
      leagueId: row.leagueId, championLeagueId: 'championLeagueId' in row ? row.championLeagueId : undefined,
    });
    if (decision.action !== 'fill') { result(decision.action, decision.reason); continue; }
    const restoredTeamId = !row.championTeamId ? candidate.teamId : undefined;
    const verifiesIntlCountry = source.table === 'cupChampion' && row.leagueId === 0 && candidate.teamLeagueId !== undefined;
    const restoredTeamLeagueId = verifiesIntlCountry && 'championLeagueId' in row
      && (row.championLeagueId === null || row.championLeagueId === 0) ? candidate.teamLeagueId : undefined;
    if (!apply) { result('wouldApply', decision.reason, source, restoredTeamId, restoredTeamLeagueId); continue; }

    // Historical aliases must not replace today's login, nationality, or bot flag. Empty update
    // also protects metadata when the same user appears in several independent source records.
    const data: { championTeamId?: number; championUserId?: number; championUserName?: string; championLeagueId?: number } = {};
    if (!row.championUserId) {
      const manager = await db.hattrickUser.upsert({
        where: { userId: source.userId },
        create: { userId: source.userId, loginName: source.name },
        update: {},
      });
      data.championUserId = source.userId;
      data.championUserName = manager.loginName;
    }
    if (restoredTeamId !== undefined) data.championTeamId = restoredTeamId;
    if (restoredTeamLeagueId !== undefined) data.championLeagueId = restoredTeamLeagueId;
    const identity = {
      season: source.season, championTeamId: row.championTeamId,
      championTeamName: source.teamName, championUserId: row.championUserId,
    };
    const changed = source.table === 'cupChampion'
      ? await db.cupChampion.updateMany({ where: { ...identity, cupId: source.competitionId,
        ...(verifiesIntlCountry && 'championLeagueId' in row ? { leagueId: 0, championLeagueId: row.championLeagueId } : {}),
      }, data })
      : await db.leagueChampion.updateMany({
        where: { ...identity, championTeamId: row.championTeamId ?? 0, leagueId: source.competitionId, complete: true }, data,
      });
    if (changed.count !== 1) {
      // Fail the enclosing transaction: do not keep an orphan manager or partially applied batch.
      throw new Error(`Verified winner changed concurrently: ${rowKey(source)}; transaction must be rolled back`);
    }
    result('applied', decision.reason, source, restoredTeamId, restoredTeamLeagueId);
  }
  return summary;
}

/** Default is read-only. Explicit apply is atomic and never expands evidence to other seasons. */
export async function applyVerifiedWinners(records: readonly VerifiedWinner[], options: { apply?: boolean } = {}) {
  if (!options.apply) return processVerifiedWinners(prisma, records);
  return prisma.$transaction((tx) => processVerifiedWinners(tx, records, true), { timeout: 30_000 });
}
