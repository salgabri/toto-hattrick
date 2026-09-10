// From server/: node ../qa/live-cup-gap-audit.mjs
// All 50 identified internal cup gaps only; reuse saved responses, enforce read-only DB.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env } from '../server/dist/config/env.js';
import { fetchCupMatches } from '../server/dist/chpp/endpoints.js';
import { parseCupMatches } from '../server/dist/schemas/index.js';

const integrity = JSON.parse(readFileSync(new URL('./results/data-integrity.json', import.meta.url)));
const targets = integrity.sequenceGaps.filter(g => g.label === 'national club cup').flatMap(g => g.missing.map(season => ({ cupId: g.competition, season })));
if (targets.length > 50) throw new Error('Audit scope exceeded: more than 50 identified cup gaps; revise the explicit call budget first');
const resultURL = new URL('./live-cup-gap-results.json', import.meta.url);
const previous = existsSync(resultURL) ? JSON.parse(readFileSync(resultURL, 'utf8')) : { checks: [] };
const saved = new Map(previous.checks.filter(c => c.status === 'received').map(c => [`${c.cupId}/${c.season}`, c]));
const db = new DatabaseSync(fileURLToPath(new URL('../server/prisma/dev.db', import.meta.url)), { readOnly: true });
const token = JSON.parse(readFileSync(env.OAUTH_ACCESS_STASH, 'utf8'));
const report = { checkedAt: new Date().toISOString(), scope: 'All 50 identified internal CupChampion gaps; CHPP cupmatches version 1.2 only; reuse successful cached responses; no matchdetails, no stored-final refetch, no product or DB writes', successfulResponsesReused: 0, requestsThisRun: 0, checks: [] };
const persist = () => writeFileSync(resultURL, JSON.stringify(report, null, 2) + '\n');
try {
  for (const target of targets) {
    const existing = db.prepare('SELECT finalMatchId FROM CupChampion WHERE cupId = ? AND season = ?').get(target.cupId, target.season);
    if (existing) { report.checks.push({ ...target, status: 'skipped-stored-final' }); persist(); continue; }
    const cached = saved.get(`${target.cupId}/${target.season}`);
    if (cached) { report.checks.push(cached); report.successfulResponsesReused++; persist(); continue; }
    const cup = db.prepare('SELECT countryName, cupName FROM Cup WHERE cupId = ?').get(target.cupId);
    try {
      report.requestsThisRun++;
      const response = parseCupMatches(await fetchCupMatches(token, target));
      const final = response.matches.length === 1 ? response.matches[0] : undefined;
      const identityMatches = response.cupId === target.cupId && response.season === target.season;
      const isDecided = final && final.homeGoals !== null && final.awayGoals !== null && final.homeGoals !== final.awayGoals;
      report.checks.push({ ...target, ...cup, status: 'received', responseCupId: response.cupId, responseSeason: response.season, identityMatches, round: response.round, matches: response.matches.length,
        ...(final ? { matchId: final.matchId, homeTeamName: final.homeTeamName, awayTeamName: final.awayTeamName, homeGoals: final.homeGoals, awayGoals: final.awayGoals,
          levelScore: final.homeGoals !== null && final.awayGoals !== null && final.homeGoals === final.awayGoals,
          winner: isDecided ? final.homeGoals > final.awayGoals ? final.homeTeamName : final.awayTeamName : null } : {}),
      });
    } catch (error) {
      // Neither raw XML, signed URLs, authentication values, nor arbitrary exception text are kept.
      report.checks.push({ ...target, ...cup, status: 'request-or-validation-failed', errorType: error?.name ?? 'Error', httpStatus: String(error?.message).match(/failed \((\d+)\)/)?.[1] ?? null });
    }
    persist();
    await new Promise(resolve => setTimeout(resolve, 500));
  }
} finally { db.close(); }
console.log(JSON.stringify({ checkedAt: report.checkedAt, targets: targets.length, successfulResponsesReused: report.successfulResponsesReused, requestsThisRun: report.requestsThisRun, received: report.checks.filter(c => c.status === 'received').length, errors: report.checks.filter(c => c.status === 'request-or-validation-failed').length, identityMismatches: report.checks.filter(c => c.status === 'received' && !c.identityMatches).length, singleFinals: report.checks.filter(c => c.matches === 1).length, levelFinals: report.checks.filter(c => c.levelScore).length, decidedFinals: report.checks.filter(c => c.winner).length, emptyResponses: report.checks.filter(c => c.matches === 0).length, resultFile: 'qa/live-cup-gap-results.json' }, null, 2));
process.exitCode = report.checks.some(c => c.status === 'request-or-validation-failed') ? 1 : 0;
