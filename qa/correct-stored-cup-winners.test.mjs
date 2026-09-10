import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { applyPlan, canonical, createPlan, sha256, validateEvidence, validatePlan } from './correct-stored-cup-winners.mjs';

const records = JSON.parse(readFileSync(new URL('./early-two-leg-winner-review.json', import.meta.url))).mismatches;
const evidenceHash = 'fixed-test-evidence-hash';
function fixtures(fixtureRecords = records) {
  const db = new DatabaseSync(':memory:'), backup = new DatabaseSync(':memory:');
  const fields = Object.keys(records[0].before);
  const textFields = new Set(['countryName', 'cupName', 'championTeamName', 'runnerUpTeamName', 'championUserName']);
  for (const conn of [db, backup]) {
    conn.exec(`CREATE TABLE CupChampion (${fields.map(f => `${f} ${textFields.has(f) ? 'TEXT' : 'INTEGER'}`).join(',')}, PRIMARY KEY(cupId,season))`);
    const insert = conn.prepare(`INSERT INTO CupChampion (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`);
    for (const { before } of fixtureRecords) insert.run(...fields.map(f => before[f]));
  }
  const snapshot = () => canonical({ rows: db.prepare('SELECT * FROM CupChampion ORDER BY cupId,season').all() });
  return { db, backup, snapshot, close: () => { db.close(); backup.close(); } };
}

test('planning reads the whole five-row archive without mutation and preserves unavailable facts', () => {
  const f = fixtures(); try {
    const before = f.snapshot();
    const plan = createPlan(f.db, f.backup, records, evidenceHash, 1000);
    assert.equal(plan.corrections.length, 5);
    assert.equal(f.snapshot(), before);
    for (const c of plan.corrections) {
      assert.equal(c.after.championUserId, null); assert.equal(c.after.championUserName, null);
      assert.equal(c.after.championTeamId, null); assert.equal(c.after.penalties, 0);
      for (const key of ['homeGoals', 'awayGoals', 'finalMatchId', 'createdAt', 'countryName', 'leagueId']) assert.equal(c.after[key], c.before[key]);
    }
  } finally { f.close(); }
});

test('applying exactly five corrections is idempotent and matches all after-row fingerprints', () => {
  const f = fixtures(); try {
    const plan = createPlan(f.db, f.backup, records, evidenceHash, 1000);
    assert.equal(applyPlan(f.db, f.backup, plan, records, evidenceHash).applied, 5);
    const after = f.snapshot();
    const replay = applyPlan(f.db, f.backup, plan, records, evidenceHash);
    assert.equal(replay.applied, 0); assert.equal(replay.alreadyApplied, 5); assert.equal(f.snapshot(), after);
    for (const c of plan.corrections) assert.equal(canonical(f.db.prepare('SELECT * FROM CupChampion WHERE cupId=? AND season=?').get(c.cupId, c.season)), canonical(c.after));
  } finally { f.close(); }
});

test('a late current-row conflict rolls back the entire batch before any write', () => {
  const f = fixtures(); try {
    const plan = createPlan(f.db, f.backup, records, evidenceHash, 1000);
    f.db.prepare('UPDATE CupChampion SET homeGoals=8 WHERE cupId=41 AND season=4').run();
    const before = f.snapshot();
    assert.throws(() => applyPlan(f.db, f.backup, plan, records, evidenceHash), /Current fingerprint conflict/);
    assert.equal(f.snapshot(), before);
  } finally { f.close(); }
});

test('a changed backup aborts the whole correction batch', () => {
  const f = fixtures(); try {
    const plan = createPlan(f.db, f.backup, records, evidenceHash, 1000);
    f.backup.prepare('UPDATE CupChampion SET homeGoals=8 WHERE cupId=41 AND season=4').run();
    const before = f.snapshot();
    assert.throws(() => applyPlan(f.db, f.backup, plan, records, evidenceHash), /Backup fingerprint conflict/);
    assert.equal(f.snapshot(), before);
  } finally { f.close(); }
});

test('score changes, inferred IDs and false displayed patches cannot enter an edited plan', () => {
  const f = fixtures(); try {
    for (const mutate of [p => { p.corrections[0].after.homeGoals = 7; }, p => { p.corrections[0].after.championTeamId = 123; }, p => { p.corrections[0].patch = {}; }]) {
      const plan = createPlan(f.db, f.backup, records, evidenceHash, 1000); mutate(plan);
      assert.throws(() => validatePlan(plan, records, evidenceHash), /Unreviewed patch|Displayed patch/);
    }
  } finally { f.close(); }
});

test('changed source evidence, duplicate corrections and invalid update times are rejected', () => {
  const f = fixtures(); try {
    const plan = createPlan(f.db, f.backup, records, evidenceHash, 1000);
    assert.throws(() => validatePlan(plan, records, 'different'), /evidence changed/);
    const duplicate = structuredClone(plan); duplicate.corrections[4] = duplicate.corrections[0];
    assert.throws(() => validatePlan(duplicate, records, evidenceHash), /Duplicate/);
    const invalidTime = structuredClone(plan); invalidTime.createdAt = 'yesterday';
    assert.throws(() => validatePlan(invalidTime, records, evidenceHash), /Invalid planned/);
  } finally { f.close(); }
});

test('the documented runner-up must match the old champion; aggregate and numeric identities must be supported', () => {
  const differentRunner = structuredClone(records[0]); differentRunner.runnerUp = 'Different team';
  assert.throws(() => validateEvidence(differentRunner), /Old champion/);
  const wrongTotal = structuredClone(records[0]); wrongTotal.aggregate[0] = 1;
  assert.throws(() => validateEvidence(wrongTotal), /aggregate differs/);
  const inferredManager = structuredClone(records[0]); inferredManager.verifiedChampionUserId = 50104;
  assert.throws(() => validateEvidence(inferredManager), /Unreviewed numeric/);
  const spaces = structuredClone(records[0]); spaces.runnerUp = `  ${spaces.runnerUp}  `;
  assert.doesNotThrow(() => validateEvidence(spaces));
});

test('corroborated winner-only corrections preserve an unknown runner-up and require two exact sources', () => {
  const f = fixtures(); try {
    const record = structuredClone(records[0]);
    record.evidenceBasis = 'corroborated-winner-only';
    delete record.firstLeg; delete record.secondLeg; delete record.aggregate; delete record.runnerUp;
    record.supportingSources = ['https://wiki.hattrick.org/wiki/Italia', 'https://wiki.hattrick.org/wiki/Coppa_Italia'].map(url => ({ url,
      cupId: record.cupId, season: record.season, champion: record.champion, evidence: 'Exact season row lists the reviewed team as the national cup winner.' }));
    const plan = createPlan(f.db, f.backup, [record], evidenceHash, 1000);
    assert.equal(plan.corrections[0].after.runnerUpTeamName, '');
    assert.equal(applyPlan(f.db, f.backup, plan, [record], evidenceHash).applied, 1);
    const single = structuredClone(record); single.supportingSources.pop();
    assert.throws(() => validateEvidence(single), /at least two/);
    const duplicate = structuredClone(record); duplicate.supportingSources[1] = duplicate.supportingSources[0];
    assert.throws(() => validateEvidence(duplicate), /distinct source/);
    const wrongSeason = structuredClone(record); wrongSeason.supportingSources[1].season++;
    assert.throws(() => validateEvidence(wrongSeason), /Source season/);
    const wrongWinner = structuredClone(record); wrongWinner.supportingSources[1].champion = 'Some other club';
    assert.throws(() => validateEvidence(wrongWinner), /Sources disagree/);
  } finally { f.close(); }
});

test('the complete32-case plan leaves all three primary-corroborated correct winners untouched', () => {
  const additional = JSON.parse(readFileSync(new URL('./cup-stored-primary-corrections.json', import.meta.url)));
  const originalCandidates = JSON.parse(readFileSync(new URL('./cup-stored-winner-mismatches-other-before-fixes.json', import.meta.url))).candidates;
  const correctKeys = new Set(['19/6', '36/10', '36/12']);
  const untouched = originalCandidates.filter(c => correctKeys.has(`${c.cupId}/${c.season}`)).map(c => ({ before: c.actualCurrentRow }));
  assert.equal(untouched.length, 3);
  const combined = [...records, ...additional];
  const f = fixtures([...combined, ...untouched]);
  try {
    const plan = createPlan(f.db, f.backup, combined, evidenceHash, 1000);
    assert.equal(plan.corrections.length, 32);
    assert.equal(applyPlan(f.db, f.backup, plan, combined, evidenceHash).applied, 32);
    assert.equal(applyPlan(f.db, f.backup, plan, combined, evidenceHash).alreadyApplied, 32);
    for (const { before } of untouched) assert.equal(canonical(f.db.prepare('SELECT * FROM CupChampion WHERE cupId=? AND season=?').get(before.cupId, before.season)), canonical(before));
  } finally { f.close(); }
});

test('primary-bracket evidence validates the captured bytes, exact season and independently computed winner', () => {
  const observed = JSON.parse(readFileSync(new URL('./cup-stored-primary-results.json', import.meta.url)));
  const check = observed.checks.find(c => c.cupId === 37 && c.season === 10);
  const base = JSON.parse(readFileSync(new URL('./cup-stored-primary-corrections.json', import.meta.url))).find(c => c.cupId === 37 && c.season === 10);
  const fileName = `.test-primary-cup-${randomUUID()}.json`;
  const path = new URL(fileName, import.meta.url);
  const source = { completed: true, source: { file: 'cupmatches', version: '1.2' }, checks: [{ ...check, beforeSha256: base.beforeSha256, returnedMatchAlreadyStored: false }] };
  const record = { ...base, evidenceBasis: 'primary-brackets', sourceUrl: 'https://chpp.hattrick.org/chppxml.ashx?file=cupmatches&version=1.2&cupId=37&season=10',
    capturedInput: { path: `qa/${fileName}`, sha256: '' } };
  const save = value => { const text = JSON.stringify(value); writeFileSync(path, text); record.capturedInput.sha256 = sha256(text); };
  try {
    save(source); assert.doesNotThrow(() => validateEvidence(record));
    writeFileSync(path, JSON.stringify({ ...source, altered: true }));
    assert.throws(() => validateEvidence(record), /input fingerprint changed/);
    const wrongSeason = structuredClone(source); wrongSeason.checks[0].previous.response.season++;
    save(wrongSeason); assert.throws(() => validateEvidence(record));
    const losingWinner = structuredClone(source); losingWinner.checks[0].previous.response.matches[0].homeGoals = 99;
    save(losingWinner); assert.throws(() => validateEvidence(record), /loses the independently/);
    const duplicateLeg = structuredClone(source); duplicateLeg.checks[0].previous.response.matches[0].matchId = duplicateLeg.checks[0].final.response.matches[0].matchId;
    save(duplicateLeg); assert.throws(() => validateEvidence(record), /First leg must be distinct/);
    save(source);
    const f = fixtures([record]);
    try {
      const plan = createPlan(f.db, f.backup, [record], evidenceHash, 1000);
      assert.equal(applyPlan(f.db, f.backup, plan, [record], evidenceHash).applied, 1);
      assert.equal(applyPlan(f.db, f.backup, plan, [record], evidenceHash).alreadyApplied, 1);
    } finally { f.close(); }
  } finally { unlinkSync(fileURLToPath(path)); }
});

test('new-only20-case primary correction preserves the other246 early records and replays without writes', () => {
  const remaining = JSON.parse(readFileSync(new URL('./cup-stored-remaining-corrections.json', import.meta.url))).mismatches;
  const source = JSON.parse(readFileSync(new URL('./expanded-cup-primary-evidence.json', import.meta.url)));
  const all = source.checks.map(c => ({ before: c.before }));
  const keys = new Set(remaining.map(c => `${c.cupId}/${c.season}`));
  const f = fixtures(all);
  try {
    const plan = createPlan(f.db, f.backup, remaining, evidenceHash, 1000);
    assert.equal(plan.corrections.length, 20);
    assert.equal(applyPlan(f.db, f.backup, plan, remaining, evidenceHash).applied, 20);
    assert.equal(applyPlan(f.db, f.backup, plan, remaining, evidenceHash).alreadyApplied, 20);
    const untouched = all.filter(c => !keys.has(`${c.before.cupId}/${c.before.season}`));
    assert.equal(untouched.length, 246);
    for (const { before } of untouched) assert.equal(canonical(f.db.prepare('SELECT * FROM CupChampion WHERE cupId=? AND season=?').get(before.cupId, before.season)), canonical(before));
  } finally { f.close(); }
});
