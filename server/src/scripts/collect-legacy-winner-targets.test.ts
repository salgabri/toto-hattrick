import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rankLegacyWinnerTargets } from './collect-legacy-winner-targets.js';

test('legacy discovery deduplicates clubs/seasons, excludes known clubs, and prioritizes distinct hints', () => {
  const result = rankLegacyWinnerTargets([
    { teamId: 10, seasons: [1, 1, 2] }, { teamId: 10, seasons: [2, 3] },
    { teamId: 20, seasons: [90] }, { teamId: 30, seasons: [1, 2, 3, 4] },
  ], new Set([30]), 1);
  assert.equal(result.candidates, 2);
  assert.equal(result.targets.length, 1);
  assert.deepEqual(result.targets[0], {
    teamId: 10, leagueId: 0, club: 'Unknown historical club',
    legacySeasonHints: [3, 2, 1], legacySeasonCount: 3, seasonHintsOnly: true,
    source: 'server/scrape/cup-targets.json',
  });
});

test('local season numbers are never used as a recency filter or attributed titles', () => {
  const result = rankLegacyWinnerTargets([{ teamId: 1, seasons: [1] }, { teamId: 2, seasons: [95] }], new Set());
  assert.equal(result.targets.length, 2);
  for (const target of result.targets) {
    assert.equal(target.leagueId, 0);
    assert.equal('seasons' in target, false);
    assert.equal('userId' in target, false);
  }
});
