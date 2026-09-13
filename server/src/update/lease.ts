import { randomUUID } from 'node:crypto';
import { jsonBytes, StorageConflictError, type ObjectStore } from './storage.js';

/** Shared lease covers acquisition AND publication, including local/cloud/manual runners.
 * A crashed runner blocks for two hours; it never permits overlapping publishers. */
export async function acquireLease(store: ObjectStore, now = Date.now, durationMs = 2 * 60 * 60_000) {
  const key = 'locks/update.json';
  const old = await store.get(key);
  if (old) {
    const value = JSON.parse(old.body.toString()) as { owner: string; expiresAt: number };
    if (!Number.isFinite(value.expiresAt) || value.expiresAt > now()) throw new Error('Another updater holds the archive lease; retry after its expiry');
  }
  const owner = randomUUID();
  const expiresAt = now() + durationMs;
  const lease = await store.compareAndSwap(key, jsonBytes({ owner, expiresAt }), old?.etag ?? null);
  return {
    async assertHeld(reserveMs = 60_000) {
      const current = await store.get(key);
      if (!current || current.etag !== lease.etag || now() + reserveMs >= expiresAt) throw new StorageConflictError();
    },
    async release() {
      await store.compareAndSwap(key, jsonBytes({ owner, expiresAt: 0 }), lease.etag);
    },
  };
}
