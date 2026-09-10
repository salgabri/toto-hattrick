// Turn cached CHPP brackets into a narrowly reviewed correction manifest. No HTTP or DB writes.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { canonical, sha256, validateEvidence } from './correct-stored-cup-winners.mjs';
import { fileURLToPath } from 'node:url';

const reportText = readFileSync(new URL('./cup-stored-primary-results.json', import.meta.url), 'utf8');
const primary = JSON.parse(reportText);
const candidates = JSON.parse(readFileSync(new URL('./cup-stored-winner-mismatches-other-before-fixes.json', import.meta.url), 'utf8')).candidates;
const backup = new DatabaseSync(fileURLToPath(new URL('../.backup/qa-fixes-20260911/dev.db', import.meta.url)), { readOnly: true });
const clean = s => s.normalize('NFC').replace(/\s+/g, ' ').trim();
const records = [];
try {
  for (const check of primary.checks.filter(c => c.classification === 'confirmed-wrong-finalist')) {
    const { cupId, season } = check;
    const candidate = candidates.find(c => c.cupId === cupId && c.season === season);
    assert.ok(candidate, 'Unreviewed candidate');
    const before = candidate.actualCurrentRow;
    const saved = backup.prepare('SELECT * FROM CupChampion WHERE cupId=? AND season=?').get(cupId, season);
    assert.equal(canonical(saved), canonical(before), 'Frozen candidate differs from backup');
    const final = check.final.response, prior = check.previous.response;
    for (const bracket of [final, prior]) {
      assert.equal(bracket.cupId, cupId); assert.equal(bracket.season, season); assert.equal(bracket.matches.length, 1);
    }
    assert.equal(prior.round, final.round - 1);
    const last = final.matches[0], first = prior.matches[0];
    assert.notEqual(last.matchId, first.matchId);
    assert.deepEqual([first.homeTeamName, first.awayTeamName].map(clean).sort(), [last.homeTeamName, last.awayTeamName].map(clean).sort());
    const champion = check.wikiChampion, runnerUp = before.championTeamName;
    assert.deepEqual([champion, runnerUp].map(clean).sort(), [last.homeTeamName, last.awayTeamName].map(clean).sort());
    const legScore = match => clean(match.homeTeamName) === clean(champion) ? [match.homeGoals, match.awayGoals] : [match.awayGoals, match.homeGoals];
    const firstLeg = legScore(first), secondLeg = legScore(last);
    const aggregate = [firstLeg[0] + secondLeg[0], firstLeg[1] + secondLeg[1]];
    // Independently compute the aggregate from the actual captured home/away orientation.
    assert.ok(aggregate[0] > aggregate[1], 'Wiki winner does not win the independently computed aggregate');
    assert.equal(clean(check.primaryChampion), clean(champion));
    assert.equal(clean(check.primaryRunnerUp), clean(runnerUp));
    const record = { cupId, season, country: before.countryName, champion, runnerUp, firstLeg, secondLeg, aggregate,
      sourceUrl: check.wikiUrl, sourceKind: 'CHPP cupmatches 1.2 two-leg aggregate corroborated by the exact HattrickWiki season winner',
      primaryEvidence: { file: 'qa/cup-stored-primary-results.json', sha256: sha256(reportText), apiFile: 'cupmatches', apiVersion: '1.2',
        final: check.final, previous: check.previous, noMatchDetailsRequested: true, finalMatchIdAlreadyStored: check.finalMatchIdAlreadyStored },
      evidence: 'Both captured brackets contain exactly the same finalists, distinct match IDs and consecutive rounds. Independently summed goals make the Wiki champion the aggregate winner and the stored champion its runner-up.',
      before, beforeSha256: sha256(canonical(before)), verifiedChampionTeamId: null,
      verifiedChampionUserId: null, verifiedChampionUserName: null };
    validateEvidence(record); records.push(record);
  }
} finally { backup.close(); }
assert.equal(primary.checks.length, 30); assert.equal(records.length, 27);
writeFileSync(new URL('./cup-stored-primary-corrections.json', import.meta.url), JSON.stringify(records, null, 2) + '\n');
console.log(JSON.stringify({ corrections: records.length, positiveOldManagersToClear: records.filter(r => r.before.championUserId !== null).length,
  preservedCorrectRows: primary.checks.filter(c => c.classification === 'stored-winner-agrees-with-primary').map(c => ({cupId:c.cupId,season:c.season,champion:c.storedChampion})) }, null, 2));
