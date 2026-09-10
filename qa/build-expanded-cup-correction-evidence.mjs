// Freeze verified CHPP evidence and prepare only the newly discovered corrections. No DB writes.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { canonical, sha256, validateEvidence } from './correct-stored-cup-winners.mjs';

const sourceText = readFileSync(new URL('./expanded-cup-primary-results.json', import.meta.url), 'utf8');
const source = JSON.parse(sourceText);
const replay = JSON.parse(readFileSync(new URL('./expanded-cup-primary-replay.json', import.meta.url), 'utf8'));
assert.equal(source.completed, true); assert.equal(source.checks.length, 266);
assert.equal(replay.inputSha256, sha256(sourceText)); assert.equal(replay.passed, true);
assert.equal(replay.cases.length, source.checks.length); assert.equal(replay.duplicateMatchIds.length, 0);
const frozenURL = new URL('./expanded-cup-primary-evidence.json', import.meta.url);
if (existsSync(frozenURL)) assert.equal(sha256(readFileSync(frozenURL)), sha256(sourceText), 'Frozen capture cannot be replaced');
else writeFileSync(frozenURL, sourceText, { flag: 'wx' });
const originalReview = JSON.parse(readFileSync(new URL('./early-two-leg-winner-review.json', import.meta.url), 'utf8'));
const previousPlan = JSON.parse(readFileSync(new URL('./results/cup-stored-corrections-combined-plan.json', import.meta.url), 'utf8'));
const previousKeys = new Set(previousPlan.corrections.map(c => `${c.cupId}/${c.season}`));
const corrections = source.checks.filter(c => c.classification === 'wrong-stored-finalist').map(check => {
  assert.ok(!previousKeys.has(`${check.cupId}/${check.season}`), 'Already applied correction must not be replanned');
  assert.equal(check.beforeSha256, sha256(canonical(check.before)), 'Captured original row fingerprint differs');
  const record = { cupId: check.cupId, season: check.season, country: check.countryName,
    champion: check.champion, runnerUp: check.runnerUp, evidenceBasis: 'primary-brackets',
    sourceUrl: `https://chpp.hattrick.org/chppxml.ashx?file=cupmatches&version=1.2&cupId=${check.cupId}&season=${check.season}`,
    capturedInput: { path: 'qa/expanded-cup-primary-evidence.json', sha256: sha256(sourceText) },
    evidence: 'Exact requested cup/season and consecutive final brackets; independent aggregate arithmetic confirms the old champion is the losing finalist. Captured match IDs are distinct and were not already stored.',
    before: check.before, beforeSha256: check.beforeSha256,
    verifiedChampionTeamId: null, verifiedChampionUserId: null, verifiedChampionUserName: null };
  validateEvidence(record); return record;
});
const output = { checkedAt: new Date().toISOString(), database: originalReview.database, databaseSha256: originalReview.databaseSha256,
  scope: 'New-only corrections from the266 omitted early records; the32 previously applied corrections are excluded.',
  primarySource: { path: 'qa/expanded-cup-primary-evidence.json', sha256: sha256(sourceText) }, mismatches: corrections };
writeFileSync(new URL('./cup-stored-remaining-corrections.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ corrections: corrections.length, positiveOldManagersToClear: corrections.filter(c => c.before.championUserId !== null).length,
  cases: corrections.map(c => ({cupId:c.cupId,season:c.season,country:c.country,from:c.before.championTeamName,to:c.champion})) }, null, 2));
