// Bounded, cached primary verification of the 30 reviewed winner-only cup candidates.
// Run from server/: node ../qa/corroborate-stored-cup-candidates.mjs
// No matchdetails calls, DB mutations, sync, or baking. Never prints auth values or signed URLs.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { env } from '../server/dist/config/env.js';
import { prisma } from '../server/dist/db/client.js';
import { fetchCupMatches } from '../server/dist/chpp/endpoints.js';
import { parseCupMatches } from '../server/dist/schemas/index.js';
import { cupFinalScore } from '../server/dist/sync/cupFinals.js';

const input = JSON.parse(readFileSync(new URL('./cup-stored-winner-mismatches-other.json', import.meta.url), 'utf8'));
const candidates = input.candidates;
if (candidates.length > 30) throw new Error('Scope exceeds the 30 reviewed candidates');
const resultURL = new URL('./cup-stored-primary-results.json', import.meta.url);
const previous = existsSync(resultURL) ? JSON.parse(readFileSync(resultURL, 'utf8')) : { checks: [] };
const saved = new Map(previous.checks.map(c => [`${c.cupId}/${c.season}`, c]));
const token = JSON.parse(readFileSync(env.OAUTH_ACCESS_STASH, 'utf8'));
const db = new DatabaseSync(fileURLToPath(new URL('../server/prisma/dev.db', import.meta.url)), { readOnly: true });
const clean = s => s.normalize('NFC').replace(/\s+/g, ' ').trim();
const out = { checkedAt: new Date().toISOString(), source: { file: 'cupmatches', version: '1.2' },
  scope: 'The 30 explicit stored winner-only name-difference candidates; last and preceding cup rounds only.',
  requests: 0, reused: 0, checks: [] };
const persist = () => writeFileSync(resultURL, JSON.stringify(out, null, 2) + '\n');
async function round(params, cached) {
  if (cached) { out.reused++; return cached; }
  if (out.requests >= 60) throw new Error('Request budget exceeded');
  out.requests++;
  const response = parseCupMatches(await fetchCupMatches(token, params));
  if (response.cupId !== params.cupId || response.season !== params.season ||
      (params.cupRound !== undefined && response.round !== params.cupRound)) throw new Error('UnexpectedResponseIdentity');
  return { requested: params, fetchedAt: new Date().toISOString(), response };
}
try {
  for (const candidate of candidates) {
    const { cupId, season } = candidate;
    const cached = saved.get(`${cupId}/${season}`);
    const check = { cupId, season, countryName: candidate.countryName, storedChampion: candidate.actualCurrentRow.championTeamName,
      wikiChampion: candidate.winnerName, wikiUrl: candidate.url };
    out.checks.push(check);
    const current = db.prepare('SELECT * FROM CupChampion WHERE cupId=? AND season=?').get(cupId, season);
    if (!current || current.finalMatchId !== 0 || current.championTeamName !== candidate.actualCurrentRow.championTeamName) {
      check.classification = 'current-row-changed-or-not-placeholder'; persist(); continue;
    }
    try {
      check.final = await round({ cupId, season }, cached?.final); persist();
      const final = check.final.response;
      if (final.matches.length !== 1 || !final.round || final.matches[0].homeGoals === null || final.matches[0].awayGoals === null) {
        check.classification = 'final-not-single-completed-match'; persist(); continue;
      }
      const match = final.matches[0];
      check.finalMatchIdAlreadyStored = Boolean(db.prepare('SELECT matchId FROM Match WHERE matchId=?').get(match.matchId) ||
        db.prepare('SELECT matchId FROM MatchDetail WHERE matchId=?').get(match.matchId) ||
        db.prepare('SELECT cupId FROM CupChampion WHERE finalMatchId=?').get(match.matchId));
      // A stored match ID is recorded, never sent to matchdetails. This script has no such call.
      await new Promise(resolve => setTimeout(resolve, 550));
      if (final.round > 1) check.previous = await round({ cupId, season, cupRound: final.round - 1 }, cached?.previous);
      const summary = { ...match, cupId, season, round: final.round };
      const resolution = cupFinalScore(summary, check.previous?.response);
      check.resolution = resolution;
      if (!('homeWon' in resolution)) check.classification = 'primary-winner-unresolved';
      else {
        check.primaryChampion = resolution.homeWon ? match.homeTeamName : match.awayTeamName;
        check.primaryRunnerUp = resolution.homeWon ? match.awayTeamName : match.homeTeamName;
        check.wikiMatchesPrimary = clean(check.primaryChampion) === clean(check.wikiChampion);
        check.currentMatchesPrimary = clean(check.primaryChampion) === clean(check.storedChampion);
        check.currentEqualsPrimaryRunnerUp = clean(check.primaryRunnerUp) === clean(check.storedChampion);
        check.classification = check.currentMatchesPrimary ? 'stored-winner-agrees-with-primary' :
          check.wikiMatchesPrimary && check.currentEqualsPrimaryRunnerUp ? 'confirmed-wrong-finalist' :
          check.wikiMatchesPrimary ? 'wiki-primary-agree-but-old-name-not-finalist' : 'wiki-primary-name-conflict';
      }
    } catch (error) { check.errorType = error?.name ?? 'Error'; check.classification = 'primary-request-or-parse-failed'; }
    persist();
    await new Promise(resolve => setTimeout(resolve, 550));
  }
} finally { db.close(); await prisma.$disconnect(); }
persist();
console.log(JSON.stringify({ candidates: out.checks.length, requests: out.requests, reused: out.reused,
  counts: out.checks.reduce((acc, c) => ({ ...acc, [c.classification]: (acc[c.classification] ?? 0) + 1 }), {}),
  cases: out.checks.map(c => ({ cupId: c.cupId, season: c.season, classification: c.classification,
    current: c.storedChampion, wiki: c.wikiChampion, primary: c.primaryChampion, basis: c.resolution?.basis })) }, null, 2));
