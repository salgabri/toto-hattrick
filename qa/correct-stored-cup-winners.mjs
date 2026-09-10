// Reviewable, narrow correction of documented historical cup winners. Default is read-only.
// This module never imports environment/auth code and never makes a network request.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const dbPath = resolve(root, 'server/prisma/dev.db');
const backupPath = resolve(root, '.backup/qa-fixes-20260911/dev.db');
const evidencePath = resolve(root, 'qa/early-two-leg-winner-review.json');
const mutable = ['championTeamName', 'runnerUpTeamName', 'championTeamId', 'championUserId', 'championUserName', 'penalties', 'updatedAt'];
export const canonical = row => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))));
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const clean = value => value.normalize('NFC').replace(/\s+/g, ' ').trim();
const hashRow = row => sha256(canonical(row));
const correctedFacts = record => ({
  championTeamName: record.champion,
  runnerUpTeamName: record.evidenceBasis === 'corroborated-winner-only' ? record.before.runnerUpTeamName : record.before.championTeamName,
  championTeamId: null, championUserId: null, championUserName: null, penalties: 0,
});

/** Independent validation of retained, unsigned CHPP bracket facts; no network or resolver reuse. */
function validatePrimaryBrackets(record) {
  const reference = record.capturedInput;
  assert.ok(reference && typeof reference.path === 'string' && !isAbsolute(reference.path), 'Missing relative primary capture path');
  const capturePath = resolve(root, reference.path);
  const withinQa = relative(resolve(root, 'qa'), capturePath);
  assert.ok(withinQa && !withinQa.startsWith('..') && !isAbsolute(withinQa) && capturePath.endsWith('.json'), 'Primary capture must be a QA JSON artifact');
  const text = readFileSync(capturePath, 'utf8');
  assert.equal(sha256(text), reference.sha256, 'Retained primary input fingerprint changed');
  const report = JSON.parse(text);
  assert.equal(report.completed, true, 'Primary collection must be complete before planning');
  assert.equal(report.source.file, 'cupmatches'); assert.equal(report.source.version, '1.2');
  const entries = report.checks.filter(c => c.cupId === record.cupId && c.season === record.season);
  assert.equal(entries.length, 1, 'Capture must contain one exact cup/season');
  const capture = entries[0];
  assert.equal(capture.beforeSha256, record.beforeSha256, 'Primary before-row evidence differs');
  assert.equal(capture.returnedMatchAlreadyStored, false, 'A stored match must not be fetched for correction');
  assert.equal(record.before.finalMatchId, 0, 'Primary correction requires an original placeholder');
  const last = capture.final;
  assert.equal(last.requested.cupId, record.cupId); assert.equal(last.requested.season, record.season);
  assert.equal(last.requested.cupRound, undefined, 'Expected exact last-round request');
  const final = last.response;
  assert.equal(final.cupId, record.cupId); assert.equal(final.season, record.season);
  assert.ok(Number.isSafeInteger(final.round) && final.round > 0);
  assert.equal(final.matches.length, 1, 'Final bracket must have one match');
  const match = final.matches[0];
  assert.ok(Number.isSafeInteger(match.matchId) && match.matchId > 0);
  assert.ok([match.homeGoals, match.awayGoals].every(n => Number.isSafeInteger(n) && n >= 0), 'Final score missing');
  const pair = [match.homeTeamName, match.awayTeamName].map(clean);
  assert.notEqual(pair[0], pair[1], 'Finalist names must differ');
  let home = match.homeGoals, away = match.awayGoals;
  if (final.round > 1) {
    const prior = capture.previous;
    assert.ok(prior, 'Missing preceding-round capture');
    assert.equal(prior.requested.cupId, record.cupId); assert.equal(prior.requested.season, record.season);
    assert.equal(prior.requested.cupRound, final.round - 1);
    const previous = prior.response;
    assert.equal(previous.cupId, record.cupId); assert.equal(previous.season, record.season);
    assert.equal(previous.round, final.round - 1, 'Rounds must be consecutive');
    if (previous.matches.length === 1) {
      const first = previous.matches[0];
      assert.ok(Number.isSafeInteger(first.matchId) && first.matchId > 0 && first.matchId !== match.matchId, 'First leg must be distinct');
      assert.deepEqual([first.homeTeamName, first.awayTeamName].map(clean).sort(), [...pair].sort(), 'First leg has different finalists');
      assert.ok([first.homeGoals, first.awayGoals].every(n => Number.isSafeInteger(n) && n >= 0), 'First-leg score missing');
      if (clean(first.homeTeamName) === pair[0]) { home += first.homeGoals; away += first.awayGoals; }
      else { home += first.awayGoals; away += first.homeGoals; }
    } else {
      assert.equal(previous.matches.length, 2, 'Single final requires two semifinals');
      const matches = previous.matches;
      assert.ok(new Set([match.matchId, ...matches.map(m => m.matchId)]).size === 3, 'Final/semifinal match IDs must differ');
      assert.ok(matches.every(m => Number.isSafeInteger(m.matchId) && m.matchId > 0 && [m.homeGoals, m.awayGoals].every(n => Number.isSafeInteger(n) && n >= 0)), 'Semifinal scores must be complete');
      const teams = matches.map(m => [clean(m.homeTeamName), clean(m.awayTeamName)]);
      assert.equal(new Set(teams.flat()).size, 4, 'Semifinal participants must be distinct');
      const routes = pair.map(name => teams.map((names, index) => names.includes(name) ? index : -1).filter(index => index !== -1));
      assert.ok(routes.every(indices => indices.length === 1) && routes[0][0] !== routes[1][0], 'Finalists must come from separate semifinals');
    }
  }
  assert.notEqual(home, away, 'A level aggregate/final does not establish a winner');
  const champion = home > away ? match.homeTeamName : match.awayTeamName;
  const runnerUp = home > away ? match.awayTeamName : match.homeTeamName;
  assert.equal(clean(record.champion), clean(champion), 'Reviewed champion loses the independently computed final');
  assert.equal(clean(record.runnerUp), clean(runnerUp), 'Reviewed runner-up differs from primary finalist');
  assert.equal(clean(record.before.championTeamName), clean(runnerUp), 'Old champion must be the primary losing finalist');
}

export function validateEvidence(record) {
  assert.ok(Number.isSafeInteger(record.cupId) && record.cupId > 0 && Number.isSafeInteger(record.season) && record.season > 0, 'Invalid cup/season');
  assert.equal(record.before.cupId, record.cupId, 'Before cup differs');
  assert.equal(record.before.season, record.season, 'Before season differs');
  assert.equal(record.before.isMain, 1, 'Only reviewed main cups are in scope');
  assert.equal(hashRow(record.before), record.beforeSha256, 'Before-row fingerprint differs');
  const url = new URL(record.sourceUrl);
  if (record.evidenceBasis === 'primary-brackets') {
    assert.equal(url.origin + url.pathname, 'https://chpp.hattrick.org/chppxml.ashx', 'Official CHPP endpoint required');
    assert.deepEqual([...url.searchParams.keys()].sort(), ['cupId', 'file', 'season', 'version'], 'Only unsigned cupmatches request fields are allowed');
    assert.equal(url.searchParams.get('file'), 'cupmatches'); assert.equal(url.searchParams.get('version'), '1.2');
    assert.equal(url.searchParams.get('cupId'), String(record.cupId)); assert.equal(url.searchParams.get('season'), String(record.season));
  } else assert.ok(url.protocol === 'https:' && url.hostname === 'wiki.hattrick.org', 'Historical Wiki evidence required');
  assert.ok(typeof record.champion === 'string' && clean(record.champion), 'Missing reviewed champion');
  assert.notEqual(clean(record.champion), clean(record.before.championTeamName), 'Reviewed winner must differ from old champion');
  if (record.evidenceBasis === 'primary-brackets') {
    validatePrimaryBrackets(record);
  } else if (record.evidenceBasis === 'corroborated-winner-only') {
    assert.equal(record.before.finalMatchId, 0, 'Winner-only correction is restricted to reconstructed placeholders');
    assert.ok(Array.isArray(record.supportingSources) && record.supportingSources.length >= 2, 'Winner-only correction needs at least two precise sources');
    const urls = new Set();
    for (const source of record.supportingSources) {
      const supportingUrl = new URL(source.url);
      assert.ok(supportingUrl.protocol === 'https:' && supportingUrl.hostname === 'wiki.hattrick.org', 'Historical Wiki corroboration required');
      assert.equal(source.cupId, record.cupId, 'Source cup differs');
      assert.equal(source.season, record.season, 'Source season differs');
      assert.equal(clean(source.champion), clean(record.champion), 'Sources disagree about the winner');
      assert.ok(typeof source.evidence === 'string' && source.evidence.length >= 20, 'Missing precise supporting evidence');
      urls.add(source.url);
    }
    assert.ok(urls.size >= 2, 'Corroboration requires distinct source pages');
  } else if (record.firstLeg && record.secondLeg && record.aggregate) {
    assert.equal(clean(record.before.championTeamName), clean(record.runnerUp), 'Old champion must equal documented runner-up');
    assert.notEqual(clean(record.champion), clean(record.runnerUp), 'Winner and runner-up must differ');
    for (const pair of [record.firstLeg, record.secondLeg, record.aggregate]) assert.ok(pair.length === 2 && pair.every(n => Number.isSafeInteger(n) && n >= 0), 'Invalid leg facts');
    assert.equal(record.firstLeg[0] + record.secondLeg[0], record.aggregate[0], 'Winner aggregate differs');
    assert.equal(record.firstLeg[1] + record.secondLeg[1], record.aggregate[1], 'Runner-up aggregate differs');
    assert.ok(record.aggregate[0] > record.aggregate[1], 'Reviewed winner must win the aggregate');
  } else {
    assert.equal(clean(record.before.championTeamName), clean(record.runnerUp), 'Old champion must equal documented runner-up');
    assert.equal(clean(record.before.runnerUpTeamName), clean(record.champion), 'Without both legs, reviewed winner must be the retained other finalist');
    assert.ok(typeof record.evidence === 'string' && record.evidence.length >= 20, 'Missing exact historical winner evidence');
  }
  // This reviewed set has no independently proven numeric winning club/manager identities.
  for (const key of ['verifiedChampionTeamId', 'verifiedChampionUserId', 'verifiedChampionUserName']) assert.equal(record[key] ?? null, null, `Unreviewed numeric/name identity: ${key}`);
}

export function createPlan(db, backup, records, evidenceSha256, now = Date.now()) {
  assert.ok(Number.isSafeInteger(now) && now > 0, 'Invalid plan time');
  const ids = new Set();
  const corrections = records.map(record => {
    validateEvidence(record);
    const key = `${record.cupId}/${record.season}`;
    assert.ok(!ids.has(key), `Duplicate correction ${key}`); ids.add(key);
    const saved = backup.prepare('SELECT * FROM CupChampion WHERE cupId=? AND season=?').get(record.cupId, record.season);
    assert.ok(saved && hashRow(saved) === record.beforeSha256, `Backup row changed: ${key}`);
    const before = record.before;
    const after = { ...before, ...correctedFacts(record), updatedAt: now };
    const current = db.prepare('SELECT * FROM CupChampion WHERE cupId=? AND season=?').get(record.cupId, record.season);
    assert.ok(current && hashRow(current) === record.beforeSha256, `Current row no longer matches the reviewed before row: ${key}`);
    const patch = Object.fromEntries(mutable.filter(field => before[field] !== after[field]).map(field => [field, { before: before[field], after: after[field] }]));
    return { cupId: record.cupId, season: record.season, sourceUrl: record.sourceUrl, revisionUrl: record.revisionUrl ?? null,
      beforeSha256: record.beforeSha256, afterSha256: hashRow(after), before, after, patch };
  });
  assert.ok(corrections.length > 0, 'No reviewed corrections');
  return { format: 'reviewed-cup-correction-v1', createdAt: new Date(now).toISOString(), evidenceSha256,
    database: 'server/prisma/dev.db', backup: '.backup/qa-fixes-20260911/dev.db', corrections };
}

export function validatePlan(plan, records, evidenceSha256) {
  assert.equal(plan.format, 'reviewed-cup-correction-v1', 'Unknown plan format');
  assert.equal(plan.evidenceSha256, evidenceSha256, 'Reviewed evidence changed since plan');
  assert.equal(plan.corrections.length, records.length, 'Correction count differs from reviewed evidence');
  assert.ok(Number.isSafeInteger(Date.parse(plan.createdAt)) && Date.parse(plan.createdAt) > 0, 'Invalid planned update time');
  const ids = new Set();
  for (const correction of plan.corrections) {
    const key = `${correction.cupId}/${correction.season}`;
    assert.ok(!ids.has(key), `Duplicate planned correction: ${key}`); ids.add(key);
    const record = records.find(r => r.cupId === correction.cupId && r.season === correction.season);
    assert.ok(record, `Unreviewed correction: ${key}`); validateEvidence(record);
    assert.equal(correction.beforeSha256, record.beforeSha256, 'Plan before hash differs');
    assert.equal(hashRow(correction.before), record.beforeSha256, 'Plan before row differs');
    assert.equal(correction.sourceUrl, record.sourceUrl, 'Plan source differs');
    const expected = { ...record.before, ...correctedFacts(record), updatedAt: Date.parse(plan.createdAt) };
    assert.equal(canonical(correction.after), canonical(expected), `Unreviewed patch: ${key}`);
    assert.equal(correction.afterSha256, hashRow(expected), 'Plan after-row fingerprint differs');
    const patch = Object.fromEntries(mutable.filter(field => record.before[field] !== expected[field]).map(field => [field, { before: record.before[field], after: expected[field] }]));
    assert.equal(canonical(correction.patch), canonical(patch), 'Displayed patch differs from actual changes');
  }
}

export function applyPlan(db, backup, plan, records, evidenceSha256) {
  validatePlan(plan, records, evidenceSha256);
  db.exec('BEGIN IMMEDIATE');
  try {
    const pending = [], unchanged = [];
    // Check EVERY row before the first update. A conflict makes the whole batch a no-op.
    for (const correction of plan.corrections) {
      const { cupId, season, beforeSha256, afterSha256 } = correction;
      const saved = backup.prepare('SELECT * FROM CupChampion WHERE cupId=? AND season=?').get(cupId, season);
      assert.ok(saved && hashRow(saved) === beforeSha256, `Backup fingerprint conflict: ${cupId}/${season}`);
      const row = db.prepare('SELECT * FROM CupChampion WHERE cupId=? AND season=?').get(cupId, season);
      assert.ok(row, `Missing current row: ${cupId}/${season}`);
      if (hashRow(row) === afterSha256) { unchanged.push({ cupId, season }); continue; }
      assert.equal(hashRow(row), beforeSha256, `Current fingerprint conflict: ${cupId}/${season}`);
      pending.push(correction);
    }
    const update = db.prepare(`UPDATE CupChampion SET ${mutable.map(field => `${field}=?`).join(',')} WHERE cupId=? AND season=?`);
    for (const correction of pending) {
      const changed = update.run(...mutable.map(field => correction.after[field]), correction.cupId, correction.season);
      assert.equal(changed.changes, 1, 'Unexpected update count');
      const current = db.prepare('SELECT * FROM CupChampion WHERE cupId=? AND season=?').get(correction.cupId, correction.season);
      assert.equal(hashRow(current), correction.afterSha256, 'Post-write row differs from reviewed plan');
    }
    db.exec('COMMIT');
    return { applied: pending.length, alreadyApplied: unchanged.length, corrections: plan.corrections };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

async function main() {
  const { values } = parseArgs({ options: {
    apply: { type: 'boolean', default: false }, plan: { type: 'string' }, report: { type: 'string' },
    additional: { type: 'string' },
    evidence: { type: 'string' },
  } });
  assert.ok(values.report, '--report <new.json> is required');
  assert.equal(Boolean(values.plan), values.apply, '--apply requires --plan; planning does not accept --plan');
  const selectedEvidencePath = values.evidence ? resolve(values.evidence) : evidencePath;
  const evidenceRelative = relative(resolve(root, 'qa'), selectedEvidencePath);
  assert.ok(evidenceRelative && !evidenceRelative.startsWith('..') && !isAbsolute(evidenceRelative), 'Evidence must be inside repo qa');
  const primaryText = readFileSync(selectedEvidencePath, 'utf8');
  const primary = JSON.parse(primaryText);
  const additionalText = values.additional ? readFileSync(resolve(values.additional), 'utf8') : '';
  const additional = additionalText ? JSON.parse(additionalText) : [];
  assert.ok(Array.isArray(additional), 'Additional explicitly reviewed evidence must be an array');
  const records = [...primary.mismatches, ...additional];
  const evidenceSha256 = sha256(primaryText + '\n' + additionalText);
  assert.equal(sha256(readFileSync(backupPath)), primary.databaseSha256, 'Pre-fix database backup fingerprint differs');
  const reportPath = resolve(values.report);
  assert.ok(reportPath.startsWith(resolve(root, 'qa') + '\\'), 'Report must be inside the repo qa directory');
  const reportFile = openSync(reportPath, 'wx'); // Reserve a new audit output before any mutation.
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  const db = new DatabaseSync(dbPath, { readOnly: !values.apply });
  try {
    if (!values.apply) {
      const plan = createPlan(db, backup, records, evidenceSha256);
      writeFileSync(reportFile, JSON.stringify(plan, null, 2) + '\n');
      console.log(JSON.stringify({ mode: 'read-only-plan', corrections: plan.corrections.length,
        diffs: plan.corrections.map(c => ({ cupId: c.cupId, season: c.season, patch: c.patch })) }, null, 2));
    } else {
      const plan = JSON.parse(readFileSync(resolve(values.plan), 'utf8'));
      const result = applyPlan(db, backup, plan, records, evidenceSha256);
      writeFileSync(reportFile, JSON.stringify({ appliedAt: new Date().toISOString(), ...result }, null, 2) + '\n');
      console.log(JSON.stringify({ mode: 'applied', applied: result.applied, alreadyApplied: result.alreadyApplied }, null, 2));
    }
  } catch (error) {
    writeFileSync(reportFile, JSON.stringify({ failedAt: new Date().toISOString(), error: error.message }, null, 2) + '\n');
    throw error;
  } finally { db.close(); backup.close(); closeSync(reportFile); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ error: error.message })); process.exitCode = 1; });
}
