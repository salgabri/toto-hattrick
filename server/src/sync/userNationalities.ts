import type { UpdateItem } from '@prisma/client';
import type { TokenPair } from '../chpp/auth.js';
import { prisma } from '../db/client.js';
import { resolveUserNationality, type UserNationality } from './enrichManagers.js';

export const USER_NATIONALITY_SOURCE_KEY = 'users:nationality';
const TASK = 'nationality';

const itemKey = (userId: number) => ({
  sourceKey_itemKey_task: {
    sourceKey: USER_NATIONALITY_SOURCE_KEY,
    itemKey: String(userId),
    task: TASK,
  },
});

export class UserNationalityEvidenceError extends Error {
  constructor(message = 'The exact Hattrick user no longer exists in the retained identity table') {
    super(message);
    this.name = 'UserNationalityEvidenceError';
  }
}

export interface UserNationalityReconciliation {
  complete: number;
  pending: number;
}

/**
 * Mirror every retained positive Hattrick user into one independently retryable task. A resolved
 * country (including the established `Unknown` terminal sentinel) completes the task. Clearing a
 * nationality reopens its task without erasing retry history or the source identity.
 */
export async function reconcileUserNationalityTasks(now: Date): Promise<UserNationalityReconciliation> {
  if (Number.isNaN(now.getTime())) throw new Error('Invalid nationality reconciliation time');
  await prisma.updateSource.upsert({
    where: { sourceKey: USER_NATIONALITY_SOURCE_KEY },
    create: {
      sourceKey: USER_NATIONALITY_SOURCE_KEY,
      kind: 'enrichment',
      numberingSystem: 'hattrick:user-id',
      metadataJson: JSON.stringify({ name: 'Manager and coach nationality' }),
    },
    update: {},
  });

  const users = await prisma.hattrickUser.findMany({
    where: { userId: { gt: 0 } },
    orderBy: { userId: 'asc' },
    select: { userId: true, nationality: true },
  });
  const tasks = await prisma.updateItem.findMany({
    where: { sourceKey: USER_NATIONALITY_SOURCE_KEY, task: TASK },
  });
  const byUserId = new Map(tasks.map(task => [task.itemKey, task]));
  const counts: UserNationalityReconciliation = { complete: 0, pending: 0 };
  const create: Array<{
    sourceKey: string; itemKey: string; task: string; edition: number; state: string;
    completedAt?: Date; nextAttemptAt?: Date;
  }> = [];

  for (const user of users) {
    const existing = byUserId.get(String(user.userId));
    if (typeof user.nationality === 'string' && user.nationality.trim()) {
      counts.complete++;
      if (!existing) {
        create.push({
          sourceKey: USER_NATIONALITY_SOURCE_KEY,
          itemKey: String(user.userId),
          task: TASK,
          edition: user.userId,
          state: 'complete',
          completedAt: now,
        });
      } else if (existing.state !== 'complete') {
        await prisma.updateItem.update({ where: { id: existing.id }, data: {
          state: 'complete',
          completedAt: existing.completedAt ?? now,
          nextAttemptAt: null,
          lastError: null,
          errorCategory: null,
        } });
      }
      continue;
    }

    counts.pending++;
    if (!existing) {
      create.push({
        sourceKey: USER_NATIONALITY_SOURCE_KEY,
        itemKey: String(user.userId),
        task: TASK,
        edition: user.userId,
        state: 'pending',
        nextAttemptAt: now,
      });
    } else if (!['pending', 'retry'].includes(existing.state)) {
      await prisma.updateItem.update({ where: { id: existing.id }, data: {
        state: 'pending',
        completedAt: null,
        nextAttemptAt: now,
        lastError: null,
        errorCategory: null,
      } });
    }
  }
  if (create.length) await prisma.updateItem.createMany({ data: create });
  return counts;
}

/** Alternate newly created identities with the oldest backlog so neither can starve. */
export function orderUserNationalityTasks<T extends { id: number; createdAt: Date }>(tasks: readonly T[]): T[] {
  const sorted = [...tasks].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
  const ordered: T[] = [];
  let oldest = 0;
  let newest = sorted.length - 1;
  while (oldest <= newest) {
    ordered.push(sorted[newest--]!);
    if (oldest <= newest) ordered.push(sorted[oldest++]!);
  }
  return ordered;
}

export async function dueUserNationalityTasks(now: Date, limit: number): Promise<UpdateItem[]> {
  if (Number.isNaN(now.getTime()) || !Number.isSafeInteger(limit) || limit < 0) throw new Error('Invalid nationality work limit');
  if (limit === 0) return [];
  const due = await prisma.updateItem.findMany({
    where: {
      sourceKey: USER_NATIONALITY_SOURCE_KEY,
      task: TASK,
      state: { in: ['pending', 'retry'] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
  });
  return orderUserNationalityTasks(due).slice(0, limit);
}

type NationalityLookup = (token: TokenPair, userId: number) => Promise<UserNationality>;

/**
 * Resolve one exact-id task and commit it with an optimistic nationality-null guard. The injected
 * lookup exists for unit testing; production always uses the established pinned CHPP resolver.
 */
export async function resolveUserNationalityTask(
  token: TokenPair,
  task: Pick<UpdateItem, 'id' | 'sourceKey' | 'itemKey' | 'task' | 'edition'>,
  now: Date,
  lookup: NationalityLookup = resolveUserNationality,
): Promise<boolean> {
  const userId = task.edition;
  if (task.sourceKey !== USER_NATIONALITY_SOURCE_KEY || task.task !== TASK ||
      userId === null || !Number.isSafeInteger(userId) || userId <= 0 ||
      task.itemKey !== String(userId) || Number.isNaN(now.getTime())) {
    throw new Error('Invalid Hattrick user nationality task');
  }

  const retained = await prisma.hattrickUser.findUnique({
    where: { userId },
    select: { nationality: true },
  });
  if (!retained) throw new UserNationalityEvidenceError();
  if (typeof retained.nationality === 'string' && retained.nationality.trim()) {
    await prisma.updateItem.update({ where: { id: task.id }, data: {
      state: 'complete', completedAt: now, nextAttemptAt: null, lastError: null, errorCategory: null,
    } });
    return false;
  }

  const resolved = await lookup(token, userId);
  if (typeof resolved.nationality !== 'string' || !resolved.nationality.trim() ||
      (resolved.countryId !== null && (!Number.isSafeInteger(resolved.countryId) || resolved.countryId <= 0)) ||
      (resolved.nationality.trim() === 'Unknown' && resolved.countryId !== null)) {
    throw new UserNationalityEvidenceError('The official nationality response did not contain a valid country identity');
  }
  const nationality = resolved.nationality.trim();
  const updated = await prisma.hattrickUser.updateMany({
    where: { userId, nationality: retained.nationality },
    data: { countryId: resolved.countryId, nationality },
  });
  if (updated.count !== 1) {
    const latest = await prisma.hattrickUser.findUnique({ where: { userId }, select: { nationality: true } });
    if (!latest || !latest.nationality?.trim()) throw new UserNationalityEvidenceError('The retained user changed while resolving nationality');
  }
  await prisma.updateItem.update({ where: { id: task.id }, data: {
    state: 'complete', completedAt: now, nextAttemptAt: null, lastError: null, errorCategory: null,
  } });
  return updated.count === 1;
}

/** Reserve a bounded five-percent lane, capped at twenty user lookups per run. */
export function userNationalityQuota(maxItems: number): number {
  if (!Number.isSafeInteger(maxItems) || maxItems < 0) throw new Error('Invalid scheduled item limit');
  return maxItems === 0 ? 0 : Math.min(20, Math.max(1, Math.floor(maxItems / 20)));
}
