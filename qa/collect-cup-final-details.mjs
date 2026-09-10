// From server/: node ../qa/collect-cup-final-details.mjs [--limit=N]
// Sample only missing tied finals identified by the prior audit. No DB/product writes.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { env } from '../server/dist/config/env.js';
import { buildSignedUrl } from '../server/dist/chpp/auth.js';

const targets = JSON.parse(readFileSync(new URL('./live-cup-gap-results.json', import.meta.url))).checks.filter(c => c.levelScore && c.matchId > 0 && c.identityMatches);
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.slice(8)) : targets.length;
if (!Number.isInteger(limit) || limit < 0 || limit > 50) throw new Error('Limit must be an integer from 0 to 50');
const db = new DatabaseSync(fileURLToPath(new URL('../server/prisma/dev.db', import.meta.url)), { readOnly: true });
const token = JSON.parse(readFileSync(env.OAUTH_ACCESS_STASH, 'utf8'));
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: true });
const results = [];
try {
  for (const target of targets.slice(0, limit)) {
    const path = new URL(`../server/samples/matchdetails-3.0-${target.matchId}.local.xml`, import.meta.url);
    const storedCup = db.prepare('SELECT cupId, season FROM CupChampion WHERE (cupId = ? AND season = ?) OR finalMatchId = ? LIMIT 1').get(target.cupId, target.season, target.matchId);
    const storedMatch = db.prepare('SELECT matchId FROM Match WHERE matchId = ? UNION SELECT matchId FROM MatchDetail WHERE matchId = ?').get(target.matchId, target.matchId);
    if (storedCup || storedMatch) { results.push({ cupId: target.cupId, season: target.season, matchId: target.matchId, status: 'skipped-already-stored' }); continue; }
    let xml; let cached = false;
    if (existsSync(path)) { xml = readFileSync(path, 'utf8'); cached = true; }
    else {
      try {
        const url = new URL('https://chpp.hattrick.org/chppxml.ashx');
        url.searchParams.set('file', 'matchdetails'); url.searchParams.set('version', '3.0'); url.searchParams.set('matchID', String(target.matchId)); url.searchParams.set('matchEvents', 'true');
        const response = await fetch(buildSignedUrl(url.toString(), 'GET', token), { signal: AbortSignal.timeout(30000) });
        if (!response.ok) { results.push({ cupId: target.cupId, season: target.season, matchId: target.matchId, status: 'http-error', httpStatus: response.status }); continue; }
        xml = await response.text();
        const match = parser.parse(xml)?.HattrickData?.Match;
        if (Number(match?.MatchID) !== target.matchId) { results.push({ cupId: target.cupId, season: target.season, matchId: target.matchId, status: 'missing-or-mismatched-match' }); continue; }
        writeFileSync(path, xml);
      } catch (error) { results.push({ cupId: target.cupId, season: target.season, matchId: target.matchId, status: 'request-failed', errorType: error?.name ?? 'Error' }); continue; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const match = parser.parse(xml)?.HattrickData?.Match;
    results.push({ cupId: target.cupId, season: target.season, matchId: target.matchId, status: 'sampled', cached, fields: Object.keys(match ?? {}), homeFields: Object.keys(match?.HomeTeam ?? {}), awayFields: Object.keys(match?.AwayTeam ?? {}) });
  }
} finally { db.close(); }
writeFileSync(new URL('./cup-final-detail-capture-results.json', import.meta.url), JSON.stringify({ collectedAt: new Date().toISOString(), results }, null, 2));
console.log(JSON.stringify({ targetCount: limit, sampled: results.filter(r => r.status === 'sampled').length, reused: results.filter(r => r.cached).length, failures: results.filter(r => r.status !== 'sampled') }, null, 2));
