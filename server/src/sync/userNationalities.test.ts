import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { prisma } from '../db/client.js';
import {
  dueUserNationalityTasks,
  orderUserNationalityTasks,
  reconcileUserNationalityTasks,
  resolveUserNationalityTask,
  USER_NATIONALITY_SOURCE_KEY,
  userNationalityQuota,
} from './userNationalities.js';

const token = { token: 'test-token', tokenSecret: 'test-secret' };
const now = new Date('2026-09-13T05:17:00.000Z');
type Row = Record<string, any>;

function stub(t: TestContext, target: object, method: string, implementation: (...args: any[]) => any) {
  const object = target as Record<string, any>;
  const original = object[method];
  object[method] = implementation;
  t.after(() => { object[method] = original; });
}

function fakeLedger(t: TestContext, users: Row[], initialTasks: Row[] = []) {
  const sources: Row[] = [];
  const tasks: Row[] = initialTasks.map((task, index) => ({
    id: index + 1,
    sourceKey: USER_NATIONALITY_SOURCE_KEY,
    itemKey: String(task.edition),
    task: 'nationality',
    state: 'pending',
    attempts: 0,
    nextAttemptAt: null,
    completedAt: null,
    lastError: null,
    errorCategory: null,
    createdAt: new Date(now.getTime() + index),
    ...task,
  }));
  let nextId = tasks.length + 1;
  const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'OR') return value.some((entry: Row) => matches(row, entry));
    if (key.includes('_')) return matches(row, value);
    const actual = row[key];
    if (value === null || typeof value !== 'object' || value instanceof Date) return actual === value;
    return Object.entries(value).every(([operator, expected]: [string, any]) => operator === 'in' ? expected.includes(actual)
      : operator === 'lte' ? actual !== null && actual <= expected
      : operator === 'gt' ? actual > expected : false);
  });
  const apply = (row: Row, data: Row) => {
    for (const [key, value] of Object.entries(data)) if (value !== undefined) row[key] = value;
    return row;
  };

  stub(t, prisma.updateSource, 'upsert', async (args: Row) => {
    const existing = sources.find(row => row.sourceKey === args.where.sourceKey);
    if (existing) return apply(existing, args.update);
    const created = { externalId: null, baseline: null, observedThrough: null, lastAttemptAt: null,
      lastSuccessAt: null, nextCheckAt: null, ...args.create };
    sources.push(created);
    return created;
  });
  stub(t, prisma.hattrickUser, 'findMany', async (args: Row = {}) => users.filter(row => matches(row, args.where)));
  stub(t, prisma.hattrickUser, 'findUnique', async (args: Row) => users.find(row => matches(row, args.where)) ?? null);
  stub(t, prisma.hattrickUser, 'updateMany', async (args: Row) => {
    const found = users.filter(row => matches(row, args.where));
    for (const row of found) apply(row, args.data);
    return { count: found.length };
  });
  stub(t, prisma.updateItem, 'findMany', async (args: Row = {}) => tasks.filter(row => matches(row, args.where)));
  const createTask = (data: Row) => {
    const created = { id: nextId++, attempts: 0, createdAt: now, nextAttemptAt: null,
      completedAt: null, lastError: null, errorCategory: null, ...data };
    tasks.push(created);
    return created;
  };
  stub(t, prisma.updateItem, 'create', async (args: Row) => createTask(args.data));
  stub(t, prisma.updateItem, 'createMany', async (args: Row) => {
    for (const data of args.data) createTask(data);
    return { count: args.data.length };
  });
  stub(t, prisma.updateItem, 'update', async (args: Row) => {
    const row = tasks.find(task => matches(task, args.where));
    assert.ok(row, 'nationality task update target');
    return apply(row, args.data);
  });
  return { sources, tasks, users };
}

test('reconciliation creates exact-id tasks, completes known countries, and preserves retry backoff', async t => {
  const future = new Date('2026-09-15T05:17:00.000Z');
  const db = fakeLedger(t, [
    { userId: 11, loginName: 'Retry', nationality: null, countryId: null },
    { userId: 12, loginName: 'Known', nationality: 'Italia', countryId: 4 },
    { userId: 13, loginName: 'Hidden', nationality: 'Unknown', countryId: null },
    { userId: 14, loginName: 'Reopened', nationality: null, countryId: null },
    { userId: 15, loginName: 'Blank', nationality: '   ', countryId: null },
  ], [
    { edition: 11, state: 'retry', attempts: 2, nextAttemptAt: future, lastError: 'temporary' },
    { edition: 13, state: 'needs_review', lastError: 'old warning', errorCategory: 'evidence' },
    { edition: 14, state: 'complete', completedAt: new Date('2026-09-01T00:00:00Z') },
  ]);

  assert.deepEqual(await reconcileUserNationalityTasks(now), { complete: 2, pending: 3 });
  assert.equal(db.sources[0]?.numberingSystem, 'hattrick:user-id');
  assert.equal(db.tasks.find(task => task.edition === 11)?.nextAttemptAt, future);
  assert.equal(db.tasks.find(task => task.edition === 11)?.attempts, 2);
  assert.equal(db.tasks.find(task => task.edition === 12)?.state, 'complete');
  assert.equal(db.tasks.find(task => task.edition === 13)?.state, 'complete');
  assert.equal(db.tasks.find(task => task.edition === 14)?.state, 'pending');
  assert.equal(db.tasks.find(task => task.edition === 14)?.nextAttemptAt, now);
  assert.equal(db.tasks.find(task => task.edition === 15)?.state, 'pending');
  assert.ok(db.tasks.every(task => task.itemKey === String(task.edition)));
});

test('due work alternates newest identities with the oldest backlog and honors retry dates', async t => {
  const tasks = Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    edition: 100 + index,
    createdAt: new Date(now.getTime() + index),
  }));
  assert.deepEqual(orderUserNationalityTasks(tasks).map(task => task.edition), [105, 100, 104, 101, 103, 102]);

  const db = fakeLedger(t, [], [
    { edition: 100, createdAt: new Date(now.getTime() - 10), state: 'pending' },
    { edition: 101, createdAt: new Date(now.getTime() - 5), state: 'retry', nextAttemptAt: now },
    { edition: 102, createdAt: now, state: 'retry', nextAttemptAt: new Date(now.getTime() + 1) },
  ]);
  assert.deepEqual((await dueUserNationalityTasks(now, 2)).map(task => task.edition), [101, 100]);
  assert.equal(db.tasks.find(task => task.edition === 102)?.state, 'retry');
});

test('one task resolves only its exact retained user and completes atomically', async t => {
  const db = fakeLedger(t, [
    { userId: 42, loginName: 'Target', nationality: null, countryId: null },
    { userId: 43, loginName: 'Other', nationality: null, countryId: null },
  ], [{ edition: 42 }]);
  const requested: number[] = [];
  const changed = await resolveUserNationalityTask(token, db.tasks[0] as any, now, async (_token, userId) => {
    requested.push(userId);
    return { countryId: 4, nationality: 'Italia' };
  });
  assert.equal(changed, true);
  assert.deepEqual(requested, [42]);
  assert.deepEqual(db.users.map(user => [user.userId, user.countryId, user.nationality]), [
    [42, 4, 'Italia'], [43, null, null],
  ]);
  assert.equal(db.tasks[0]?.state, 'complete');
  assert.equal(db.tasks[0]?.completedAt, now);
});

test('a blank retained nationality is unresolved and can be replaced by exact-id evidence', async t => {
  const db = fakeLedger(t, [
    { userId: 44, loginName: 'Blank', nationality: '', countryId: null },
  ], [{ edition: 44 }]);
  assert.equal(await resolveUserNationalityTask(token, db.tasks[0] as any, now, async () => ({
    countryId: 159, nationality: 'Madagascar',
  })), true);
  assert.equal(db.users[0]?.nationality, 'Madagascar');
  assert.equal(db.users[0]?.countryId, 159);
  assert.equal(db.tasks[0]?.state, 'complete');
});

test('pre-resolved users use no lookup, valid unknown is terminal, and transient errors write nothing', async t => {
  const db = fakeLedger(t, [
    { userId: 50, loginName: 'Known', nationality: 'Sverige', countryId: 1 },
    { userId: 51, loginName: 'Hidden', nationality: null, countryId: null },
    { userId: 52, loginName: 'Retry', nationality: null, countryId: null },
  ], [{ edition: 50 }, { edition: 51 }, { edition: 52 }]);
  let calls = 0;
  assert.equal(await resolveUserNationalityTask(token, db.tasks[0] as any, now, async () => {
    calls++;
    throw new Error('must not fetch');
  }), false);
  await resolveUserNationalityTask(token, db.tasks[1] as any, now, async (_token, userId) => {
    calls++;
    assert.equal(userId, 51);
    return { countryId: null, nationality: 'Unknown' };
  });
  await assert.rejects(resolveUserNationalityTask(token, db.tasks[2] as any, now, async () => {
    calls++;
    throw Object.assign(new Error('temporary'), { name: 'ChppRequestError', category: 'network' });
  }), { name: 'ChppRequestError' });
  assert.equal(calls, 2);
  assert.equal(db.users.find(user => user.userId === 51)?.nationality, 'Unknown');
  assert.equal(db.users.find(user => user.userId === 52)?.nationality, null);
  assert.equal(db.tasks[2]?.state, 'pending');
});

test('the nationality lane stays within its five-percent cap', () => {
  assert.equal(userNationalityQuota(0), 0);
  assert.equal(userNationalityQuota(1), 1);
  assert.equal(userNationalityQuota(40), 2);
  assert.equal(userNationalityQuota(400), 20);
  assert.equal(userNationalityQuota(10_000), 20);
  assert.throws(() => userNationalityQuota(-1), /Invalid scheduled item limit/);
});
