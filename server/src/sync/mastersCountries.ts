import type { UpdateItem } from '@prisma/client';
import type { TokenPair } from '../chpp/auth.js';
import { fetchTeamDetails } from '../chpp/endpoints.js';
import { prisma } from '../db/client.js';
import { parseTeamDetails } from '../schemas/index.js';
import { MASTERS_CUP_ID } from './masters.js';

const SOURCE_KEY = `cup:${MASTERS_CUP_ID}`;
const TASK = 'country';

const itemKey = (season: number) => ({
  sourceKey_itemKey_task: { sourceKey: SOURCE_KEY, itemKey: String(season), task: TASK },
});

/**
 * A valid teamdetails response that omits the requested club cannot prove a country. This is an
 * evidence gap rather than permission to guess from the manager or to persist an "unresolvable"
 * country sentinel.
 */
export class MastersCountryEvidenceError extends Error {
  constructor() {
    super('Official teamdetails did not contain the exact Hattrick Masters champion club and country');
    this.name = 'MastersCountryEvidenceError';
  }
}

export interface MastersCountryReconciliation {
  complete: number;
  pending: number;
  needsReview: number;
}

/**
 * Mirror retained Masters winners into independently retryable country tasks. Positive country
 * facts complete their task, a newly available exact team id reopens an old evidence gap, and a
 * retry's existing backoff is preserved. Legacy championLeagueId=0 rows are deliberately retried
 * when an exact team id exists; the scheduler never writes that sentinel itself.
 */
export async function reconcileMastersCountryTasks(now: Date): Promise<MastersCountryReconciliation> {
  if (Number.isNaN(now.getTime())) throw new Error('Invalid Masters country reconciliation time');
  const source = await prisma.updateSource.findUnique({ where: { sourceKey: SOURCE_KEY }, select: { sourceKey: true } });
  if (!source) return { complete: 0, pending: 0, needsReview: 0 };

  const rows = await prisma.cupChampion.findMany({
    where: { cupId: MASTERS_CUP_ID },
    orderBy: { season: 'desc' },
    select: { season: true, championTeamId: true, championLeagueId: true },
  });
  const counts: MastersCountryReconciliation = { complete: 0, pending: 0, needsReview: 0 };
  for (const row of rows) {
    const existing = await prisma.updateItem.findUnique({ where: itemKey(row.season) });
    if ((row.championLeagueId ?? 0) > 0) {
      counts.complete++;
      await prisma.updateItem.upsert({
        where: itemKey(row.season),
        create: { sourceKey: SOURCE_KEY, itemKey: String(row.season), task: TASK, edition: row.season,
          state: 'complete', completedAt: now },
        update: { state: 'complete', completedAt: existing?.completedAt ?? now, nextAttemptAt: null,
          lastError: null, errorCategory: null },
      });
      continue;
    }

    if ((row.championTeamId ?? 0) > 0) {
      counts.pending++;
      if (!existing) {
        await prisma.updateItem.create({ data: { sourceKey: SOURCE_KEY, itemKey: String(row.season), task: TASK,
          edition: row.season, state: 'pending', nextAttemptAt: now } });
      } else if (!['pending', 'retry'].includes(existing.state)) {
        await prisma.updateItem.update({ where: { id: existing.id }, data: { state: 'pending', completedAt: null,
          nextAttemptAt: now, lastError: null, errorCategory: null } });
      }
      continue;
    }

    counts.needsReview++;
    const reason = 'An exact champion team id is required before the Hattrick Masters winner country can be resolved';
    await prisma.updateItem.upsert({
      where: itemKey(row.season),
      create: { sourceKey: SOURCE_KEY, itemKey: String(row.season), task: TASK, edition: row.season,
        state: 'needs_review', lastError: reason },
      update: { state: 'needs_review', completedAt: null, nextAttemptAt: null, lastError: reason,
        errorCategory: 'evidence' },
    });
  }
  return counts;
}

/** Newest missing Masters countries receive a small lane before the general result backlog. */
export async function dueMastersCountryTasks(now: Date, limit: number): Promise<UpdateItem[]> {
  if (Number.isNaN(now.getTime()) || !Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid Masters country work limit');
  if (limit === 0) return [];
  return prisma.updateItem.findMany({
    where: { sourceKey: SOURCE_KEY, task: TASK, state: { in: ['pending', 'retry'] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    orderBy: [{ edition: 'desc' }, { nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: limit,
  });
}

/**
 * Resolve one task from the exact championTeamId and the pinned teamdetails endpoint. This never
 * reads or writes manager identity. The guarded update prevents a concurrent winner correction
 * from attaching the fetched country to a different club.
 */
export async function resolveMastersCountryTask(token: TokenPair, task: Pick<UpdateItem, 'id' | 'sourceKey' | 'task' | 'edition'>, now: Date): Promise<boolean> {
  if (task.sourceKey !== SOURCE_KEY || task.task !== TASK || task.edition === null || !Number.isSafeInteger(task.edition) || Number.isNaN(now.getTime()))
    throw new Error('Invalid Hattrick Masters country task');
  const season = task.edition;
  const row = await prisma.cupChampion.findUnique({
    where: { cupId_season: { cupId: MASTERS_CUP_ID, season } },
    select: { championTeamId: true, championLeagueId: true },
  });
  if (!row) throw new MastersCountryEvidenceError();
  if ((row.championLeagueId ?? 0) > 0) {
    await prisma.updateItem.update({ where: { id: task.id }, data: { state: 'complete', completedAt: now,
      nextAttemptAt: null, lastError: null, errorCategory: null } });
    return false;
  }
  if (!row.championTeamId || row.championTeamId <= 0) throw new MastersCountryEvidenceError();

  const response = parseTeamDetails(await fetchTeamDetails(token, row.championTeamId));
  const exact = response.teams.find(team => team.teamId === row.championTeamId);
  if (!exact || !Number.isSafeInteger(exact.leagueId) || exact.leagueId <= 0) throw new MastersCountryEvidenceError();

  const updated = await prisma.cupChampion.updateMany({
    where: { cupId: MASTERS_CUP_ID, season, championTeamId: row.championTeamId,
      championLeagueId: row.championLeagueId },
    data: { championLeagueId: exact.leagueId },
  });
  if (updated.count !== 1) {
    const latest = await prisma.cupChampion.findUnique({ where: { cupId_season: { cupId: MASTERS_CUP_ID, season } },
      select: { championTeamId: true, championLeagueId: true } });
    if (latest?.championTeamId !== row.championTeamId || (latest.championLeagueId ?? 0) <= 0)
      throw new Error('Hattrick Masters champion changed while resolving its country');
  }
  await prisma.updateItem.update({ where: { id: task.id }, data: { state: 'complete', completedAt: now,
    nextAttemptAt: null, lastError: null, errorCategory: null } });
  return updated.count === 1;
}

/** Reserve a bounded ~5% lane (at least one item) whenever the run has acquisition capacity. */
export function mastersCountryQuota(maxItems: number): number {
  if (!Number.isSafeInteger(maxItems) || maxItems < 0) throw new Error('Invalid scheduled item limit');
  return maxItems === 0 ? 0 : Math.min(4, Math.max(1, Math.floor(maxItems / 20)));
}
