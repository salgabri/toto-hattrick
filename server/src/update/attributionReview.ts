import type { PendingEvidence } from './refresh.js';

/** Newly unresolved identities after acquisition and retained-evidence replay. */
export function newAttributionReviews(before: readonly PendingEvidence[], after: readonly PendingEvidence[]): PendingEvidence[] {
  const seen = new Set(before.filter(item => item.task === 'attribution').map(item => `${item.sourceKey}\0${item.itemKey}`));
  return after.filter(item => item.task === 'attribution' && !seen.has(`${item.sourceKey}\0${item.itemKey}`));
}
