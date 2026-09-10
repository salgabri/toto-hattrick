// Read-only primary comparison of the exact 266 omitted early cup records. No matchdetails.
// Run from server/: node ../qa/verify-expanded-cup-era.mjs [--limit 1]
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { env } from '../server/dist/config/env.js';
import { prisma } from '../server/dist/db/client.js';
import { fetchCupMatches } from '../server/dist/chpp/endpoints.js';
import { parseCupMatches } from '../server/dist/schemas/index.js';
import { cupFinalScore } from '../server/dist/sync/cupFinals.js';
import { canonical, sha256 } from './correct-stored-cup-winners.mjs';

const { values } = parseArgs({ options: { limit: { type: 'string' } } });
const limit = values.limit === undefined ? 266 : Number(values.limit);
assert.ok(Number.isSafeInteger(limit) && limit > 0 && limit <= 266, 'Invalid bounded limit');
const coverage = JSON.parse(readFileSync(new URL('./cup-two-leg-coverage-gaps.json', import.meta.url), 'utf8'));
const targets = coverage.unreviewedCountries.flatMap(country => country.unreviewedRows.map(row => ({
  cupId: row.cupId, season: row.season, countryName: country.country, globalSeason: row.globalSeason,
})));
assert.equal(targets.length, 266, 'The reviewed expansion must contain exactly 266 rows');
assert.equal(new Set(targets.map(t => `${t.cupId}/${t.season}`)).size, 266, 'Duplicate targets');
const output = new URL('./expanded-cup-primary-results.json', import.meta.url);
const previous = existsSync(output) ? JSON.parse(readFileSync(output, 'utf8')) : { checks: [] };
const cached = new Map(previous.checks.map(c => [`${c.cupId}/${c.season}`, c]));
const token = JSON.parse(readFileSync(env.OAUTH_ACCESS_STASH, 'utf8'));
const db = new DatabaseSync(fileURLToPath(new URL('../server/prisma/dev.db', import.meta.url)), { readOnly: true });
const backup = new DatabaseSync(fileURLToPath(new URL('../.backup/qa-fixes-20260911/dev.db', import.meta.url)), { readOnly: true });
const report = { checkedAt: new Date().toISOString(), expected: targets.length,
  scope: 'All266 previously omitted main-cup records through global24 in50countries; the216 rows throughglobal23 are included.',
  source: { file: 'cupmatches', version: '1.2' }, requests: 0, reused: 0, checks: [...previous.checks] };
const clean = value => value.normalize('NFC').replace(/\s+/g, ' ').trim();
const persist = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const pause = () => new Promise(resolve => setTimeout(resolve, 550));
const counts = () => report.checks.reduce((result, check) => ({ ...result, [check.classification ?? 'pending']: (result[check.classification ?? 'pending'] ?? 0) + 1 }), {});

async function loadRound(requested, reuse) {
  let capture;
  if (reuse) { report.reused++; capture = reuse; }
  else {
    assert.ok(report.requests < 532, 'Two requests per target maximum');
    report.requests++;
    capture = { requested, fetchedAt: new Date().toISOString(), response: parseCupMatches(await fetchCupMatches(token, requested)) };
  }
  const response = capture.response;
  assert.equal(response.cupId, requested.cupId); assert.equal(response.season, requested.season);
  if (requested.cupRound !== undefined) assert.equal(response.round, requested.cupRound);
  return capture;
}

// Independent arithmetic oracle: do not use the production resolver to calculate totals.
function independentlyResolve(final, previous) {
  const match = final.matches[0];
  const pair = [match.homeTeamName, match.awayTeamName].map(clean);
  assert.notEqual(pair[0], pair[1], 'Finalists must differ');
  let home = match.homeGoals, away = match.awayGoals, format = 'single';
  if (final.round > 1) {
    if (!previous?.matches.length) return { reason: 'Preceding round is missing/empty' };
    if (previous.matches.length === 1) {
      const first = previous.matches[0];
      if ([first.homeTeamName, first.awayTeamName].map(clean).sort().join('\0') !== [...pair].sort().join('\0')) return { reason: 'One preceding match has different finalists' };
      if (first.matchId === match.matchId || first.homeGoals === null || first.awayGoals === null) return { reason: 'First leg lacks a distinct completed score' };
      format = 'two-leg';
      if (clean(first.homeTeamName) === pair[0]) { home += first.homeGoals; away += first.awayGoals; }
      else { home += first.awayGoals; away += first.homeGoals; }
    } else {
      if (previous.matches.length !== 2 || previous.matches[0].matchId === previous.matches[1].matchId || previous.matches.some(m => m.matchId === match.matchId)) return { reason: 'Single final lacks two distinct semifinal matches' };
      const semifinalTeams = previous.matches.map(m => [clean(m.homeTeamName), clean(m.awayTeamName)]);
      if (new Set(semifinalTeams.flat()).size !== 4) return { reason: 'Semifinal team identities repeat' };
      const routes = pair.map(name => semifinalTeams.map((teams, index) => teams.includes(name) ? index : -1).filter(index => index !== -1));
      if (routes.some(indices => indices.length !== 1) || routes[0][0] === routes[1][0]) return { reason: 'Finalists must come from separate semifinals' };
    }
  }
  if (home === away) return { reason: 'Aggregate/final remains level', format, homeTotal: home, awayTotal: away };
  return { homeWon: home > away, format, homeTotal: home, awayTotal: away };
}

let consecutiveErrors = 0;
try {
  for (const target of targets.slice(0, limit)) {
    const { cupId, season } = target;
    const saved = cached.get(`${cupId}/${season}`);
    const before = backup.prepare('SELECT * FROM CupChampion WHERE cupId=? AND season=?').get(cupId, season);
    const current = db.prepare('SELECT * FROM CupChampion WHERE cupId=? AND season=?').get(cupId, season);
    const check = { ...saved, ...target, before: saved?.before ?? before, beforeSha256: saved?.beforeSha256 ?? (before ? sha256(canonical(before)) : null) };
    const index = report.checks.findIndex(c => c.cupId === cupId && c.season === season);
    if (index === -1) report.checks.push(check); else report.checks[index] = check;
    if (!before || !current || before.finalMatchId !== 0 || canonical(before) !== canonical(current)) {
      check.currentRowStatus = 'positive-final-id-or-current-row-changed';
      if (!check.classification) check.classification = check.currentRowStatus;
      persist(); continue;
    }
    try {
      check.final = await loadRound({ cupId, season }, saved?.final); persist();
      const final = check.final.response;
      if (final.matches.length !== 1 || !final.round || final.matches[0].homeGoals === null || final.matches[0].awayGoals === null) {
        check.classification = 'final-not-one-completed-match'; persist(); continue;
      }
      const match = final.matches[0];
      check.returnedMatchAlreadyStored = Boolean(db.prepare('SELECT matchId FROM Match WHERE matchId=?').get(match.matchId) ||
        db.prepare('SELECT matchId FROM MatchDetail WHERE matchId=?').get(match.matchId) ||
        db.prepare('SELECT cupId FROM CupChampion WHERE finalMatchId=?').get(match.matchId));
      if (check.returnedMatchAlreadyStored) { check.classification = 'returned-final-already-stored-no-more-requests'; persist(); continue; }
      await pause();
      if (final.round > 1) check.previous = await loadRound({ cupId, season, cupRound: final.round - 1 }, saved?.previous);
      const independent = independentlyResolve(final, check.previous?.response);
      const production = cupFinalScore({ ...match, cupId, season, round: final.round }, check.previous?.response);
      check.independent = independent; check.production = production;
      if (!('homeWon' in independent)) check.classification = 'primary-winner-unresolved';
      else {
        assert.ok('homeWon' in production, 'Production resolver failed independent decisive result');
        assert.equal(production.homeWon, independent.homeWon, 'Production resolver disagrees with independent arithmetic');
        assert.equal(production.format, independent.format, 'Production final format differs');
        check.champion = independent.homeWon ? match.homeTeamName : match.awayTeamName;
        check.runnerUp = independent.homeWon ? match.awayTeamName : match.homeTeamName;
        check.classification = clean(check.champion) === clean(before.championTeamName) ? 'stored-winner-correct' :
          clean(check.runnerUp) === clean(before.championTeamName) ? 'wrong-stored-finalist' : 'old-name-not-a-finalist';
      }
      consecutiveErrors = 0;
    } catch (error) {
      check.classification = 'request-parse-or-invariant-failed'; check.errorType = error?.name ?? 'Error';
      const causeCode = error?.cause?.code;
      if (typeof causeCode === 'string' && /^[A-Z0-9_]+$/.test(causeCode)) check.networkCode = causeCode;
      consecutiveErrors++;
    }
    persist();
    if (consecutiveErrors >= 3 || (limit === 1 && consecutiveErrors)) break;
    if (report.checks.length % 10 === 0) console.log(JSON.stringify({ checked: report.checks.length, expected: 266, requests: report.requests, reused: report.reused, counts: counts() }));
    await pause();
  }
} finally { db.close(); backup.close(); await prisma.$disconnect(); }
report.counts = counts(); report.completed = report.checks.length === 266;
persist();
console.log(JSON.stringify({ completed: report.completed, checked: report.checks.length, requests: report.requests, reused: report.reused, counts: report.counts }));
if (consecutiveErrors) process.exitCode = 1;
