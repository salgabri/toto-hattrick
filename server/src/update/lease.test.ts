import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acquireLease } from './lease.js';
import { LocalObjectStore, StorageConflictError } from './storage.js';

test('shared lease rejects overlapping runners and recovers only after expiry', async t => {
  const root = await mkdtemp(join(tmpdir(), 'archive-lease-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new LocalObjectStore(root); let now = 0;
  const first = await acquireLease(store, () => now, 120_000);
  await first.assertHeld();
  await assert.rejects(acquireLease(store, () => now), /Another updater/);
  now = 70_000;
  await assert.rejects(first.assertHeld(), StorageConflictError, 'reserve stops publication before lease expiry');
  now = 120_001;
  const second = await acquireLease(store, () => now);
  await assert.rejects(first.assertHeld(), StorageConflictError);
  await assert.rejects(first.release(), StorageConflictError, 'expired owner cannot release newer owner');
  await second.release();
  const third = await acquireLease(store, () => now); await third.release();
});
