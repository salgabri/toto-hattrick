import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PendingEvidence } from './refresh.js';
import { newAttributionReviews } from './attributionReview.js';

const review = (sourceKey: string, itemKey: string, task = 'attribution'): PendingEvidence => ({
  sourceKey, itemKey, task, edition: Number(itemKey), reason: 'Win-time manager needs proof',
  sourceUrl: 'https://www.hattrick.org/en/Club/History/?teamId=42',
});

test('reports only newly unresolved manager identities after replay', () => {
  const old = review('cup:7', '90');
  const justResolved = review('cup:8', '90');
  const fresh = review('cup:183', '96');
  assert.deepEqual(newAttributionReviews([old, justResolved], [old, fresh, review('cup:7', '91', 'capture')]), [fresh]);
  assert.deepEqual(newAttributionReviews([old], []), []);
});
