// Offline verification of every captured bracket against independent arithmetic and the final resolver.
// Run from server/: node ../qa/replay-expanded-cup-era.mjs. Never makes a network request.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { cupFinalScore } from '../server/dist/sync/cupFinals.js';
import { prisma } from '../server/dist/db/client.js';
import { sha256 } from './correct-stored-cup-winners.mjs';

const inputURL = new URL('./expanded-cup-primary-results.json', import.meta.url);
const text = readFileSync(inputURL, 'utf8');
const input = JSON.parse(text);
assert.equal(input.completed, true); assert.equal(input.checks.length, 266);
const clean = s => s.normalize('NFC').replace(/\s+/g, ' ').trim();
const matchOwners = new Map();
const output = { checkedAt: new Date().toISOString(), inputSha256: sha256(text), total: input.checks.length,
  cases: [], duplicateMatchIds: [], failures: [] };
globalThis.fetch = async () => { throw new Error('Offline replay forbids network'); };
try {
  for (const check of input.checks) {
    const key = `${check.cupId}/${check.season}`;
    const final = check.final?.response, previous = check.previous?.response;
    if (!final || final.matches.length !== 1) { output.failures.push({ key, reason: 'No complete final capture' }); continue; }
    for (const bracket of [final, previous].filter(Boolean)) for (const match of bracket.matches) {
      const owners = matchOwners.get(match.matchId) ?? []; owners.push({ key, round: bracket.round }); matchOwners.set(match.matchId, owners);
    }
    const match = final.matches[0];
    let reason, format = 'single', home = match.homeGoals, away = match.awayGoals;
    const finalPair = [clean(match.homeTeamName), clean(match.awayTeamName)];
    if (final.cupId !== check.cupId || final.season !== check.season || new Set(finalPair).size !== 2 ||
        ![home, away].every(n => Number.isSafeInteger(n) && n >= 0)) reason = 'Final identity or completed score invalid';
    else if (final.round > 1) {
      if (!previous || previous.cupId !== check.cupId || previous.season !== check.season || previous.round !== final.round - 1) reason = 'Prior round identity invalid';
      else if (previous.matches.length === 1) {
        const first = previous.matches[0];
        const pair = [clean(first.homeTeamName), clean(first.awayTeamName)];
        if ([...pair].sort().join('\0') !== [...finalPair].sort().join('\0')) reason = 'One preceding match has different finalists';
        else if (first.matchId === match.matchId || ![first.homeGoals, first.awayGoals].every(n => Number.isSafeInteger(n) && n >= 0)) reason = 'First leg missing/duplicated';
        else {
          format = 'two-leg';
          home += pair[0] === finalPair[0] ? first.homeGoals : first.awayGoals;
          away += pair[0] === finalPair[0] ? first.awayGoals : first.homeGoals;
        }
      } else if (previous.matches.length !== 2) reason = 'Exactly two semifinals required';
      else {
        const semis = previous.matches;
        const teams = semis.map(m => [clean(m.homeTeamName), clean(m.awayTeamName)]);
        const route = finalPair.map(name => teams.map((pair, index) => pair.includes(name) ? index : -1).filter(index => index >= 0));
        if (new Set([match.matchId, ...semis.map(m => m.matchId)]).size !== 3 || new Set(teams.flat()).size !== 4 ||
            !semis.every(m => [m.homeGoals, m.awayGoals].every(n => Number.isSafeInteger(n) && n >= 0)) ||
            route.some(r => r.length !== 1) || route[0][0] === route[1][0]) reason = 'Semifinal identities, completion or routes invalid';
      }
    }
    if (!reason && home === away) reason = 'Aggregate/final remains level';
    const production = cupFinalScore({ ...match, cupId: check.cupId, season: check.season, round: final.round }, previous);
    const independent = reason ? { reason } : { homeWon: home > away, format, homeTotal: home, awayTotal: away };
    const agrees = reason ? !('homeWon' in production) : 'homeWon' in production && production.homeWon === independent.homeWon && production.format === independent.format;
    if (!agrees) output.failures.push({ key, independent, production });
    output.cases.push({ cupId: check.cupId, season: check.season, classification: check.classification, independent, production, agrees });
  }
} finally { await prisma.$disconnect(); }
for (const [matchId, occurrences] of matchOwners) if (occurrences.length > 1) output.duplicateMatchIds.push({ matchId, occurrences });
output.passed = output.failures.length === 0 && output.duplicateMatchIds.length === 0;
writeFileSync(new URL('./expanded-cup-primary-replay.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ passed: output.passed, total: output.total, decisive: output.cases.filter(c => 'homeWon' in c.independent).length,
  unresolved: output.cases.filter(c => !('homeWon' in c.independent)), duplicateMatchIds: output.duplicateMatchIds, failures: output.failures }, null, 2));
if (!output.passed) process.exitCode = 1;
