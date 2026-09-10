// Fixed, bounded inspection of an earlier round for a missing historically two-leg cup final.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { env } from '../server/dist/config/env.js';
import { fetchCupMatches } from '../server/dist/chpp/endpoints.js';
import { parseCupMatches } from '../server/dist/schemas/index.js';
const token = JSON.parse(readFileSync(env.OAUTH_ACCESS_STASH, 'utf8'));
const finals = JSON.parse(readFileSync(new URL('./live-cup-gap-results.json', import.meta.url))).checks;
if (finals.length > 50) throw new Error('Scope exceeds the 50 identified gaps');
const resultURL = new URL('./cup-final-earlier-rounds.json', import.meta.url);
const prior = existsSync(resultURL) ? JSON.parse(readFileSync(resultURL)) : { checks: [JSON.parse(readFileSync(new URL('./cup-final-earlier-round.json', import.meta.url)))] };
const cached = new Map(prior.checks.filter(c => c.response).map(c => [`${c.requested.cupId}/${c.requested.season}`, c]));
const out = { checkedAt: new Date().toISOString(), requests: 0, reused: 0, checks: [] };
const db = new DatabaseSync(fileURLToPath(new URL('../server/prisma/dev.db', import.meta.url)), { readOnly: true });
try {
  for (const final of finals) {
    const saved = cached.get(`${final.cupId}/${final.season}`);
    if (saved) { out.checks.push(saved); out.reused++; continue; }
    if (db.prepare('SELECT cupId FROM CupChampion WHERE cupId=? AND season=?').get(final.cupId, final.season)) { out.checks.push({ requested: { cupId: final.cupId, season: final.season, cupRound: final.round - 1 }, skipped: 'already-stored-final' }); continue; }
    const requested = { cupId: final.cupId, season: final.season, cupRound: final.round - 1 };
    try {
      out.requests++;
      const response = parseCupMatches(await fetchCupMatches(token, requested));
      out.checks.push({ requested, response });
    } catch (error) { out.checks.push({ requested, errorType: error?.name ?? 'Error' }); }
    writeFileSync(resultURL, JSON.stringify(out, null, 2));
    await new Promise(resolve => setTimeout(resolve, 500));
  }
} finally { db.close(); }
writeFileSync(resultURL, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ targets: finals.length, requests: out.requests, reused: out.reused, responses: out.checks.filter(c => c.response).length, singleMatchRounds: out.checks.filter(c => c.response?.matches.length === 1).length, errors: out.checks.filter(c => c.errorType).length }, null, 2));
