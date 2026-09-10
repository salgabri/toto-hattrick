// Bounded schema compatibility probe: the CURRENT, unstored Masters bracket + one unstored match.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { env } from '../server/dist/config/env.js';
import { buildSignedUrl } from '../server/dist/chpp/auth.js';
import { fetchCupMatches } from '../server/dist/chpp/endpoints.js';
import { parseCupMatches } from '../server/dist/schemas/index.js';
const db = new DatabaseSync(fileURLToPath(new URL('../server/prisma/dev.db', import.meta.url)), { readOnly: true });
const token = JSON.parse(readFileSync(env.OAUTH_ACCESS_STASH, 'utf8'));
const parser = new XMLParser({ parseTagValue: false, ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });
try {
  const live = JSON.parse(readFileSync(new URL('./live-source-results.json', import.meta.url), 'utf8'));
  const currentSeason = live.checks.find(check => check.leagueId === 1)?.currentSeason;
  if (!Number.isInteger(currentSeason) || db.prepare('SELECT cupId FROM CupChampion WHERE cupId=183 AND season=?').get(currentSeason)) throw new Error('No current unstored Masters edition; no probe made');
  const response = parseCupMatches(await fetchCupMatches(token, { cupId: 183, season: currentSeason }));
  const candidate = response.matches.find(m => !db.prepare('SELECT matchId FROM Match WHERE matchId=? UNION SELECT matchId FROM MatchDetail WHERE matchId=? UNION SELECT finalMatchId FROM CupChampion WHERE finalMatchId=?').get(m.matchId, m.matchId, m.matchId));
  if (!candidate) throw new Error('No unstored match in current Masters round');
  const file = new URL(`../server/samples/matchdetails-3.0-${candidate.matchId}.local.xml`, import.meta.url);
  let xml;
  if (existsSync(file)) xml = readFileSync(file, 'utf8');
  else {
    const url = new URL('https://chpp.hattrick.org/chppxml.ashx');
    url.searchParams.set('file', 'matchdetails'); url.searchParams.set('version', '3.0'); url.searchParams.set('matchID', String(candidate.matchId));
    const result = await fetch(buildSignedUrl(url.toString(), 'GET', token), { signal: AbortSignal.timeout(30000) });
    if (!result.ok) throw new Error(`CHPP response status ${result.status}`);
    xml = await result.text();
    writeFileSync(file, xml);
  }
  const match = parser.parse(xml)?.HattrickData?.Match;
  const facts = { checkedAt: new Date().toISOString(), seasonProvenance: { source: 'CHPP worlddetails 1.9 Sweden', checkedAt: live.checkedAt }, requestedCupId: 183, requestedSeason: currentSeason, round: response.round, matchId: candidate.matchId, returnedMatchId: match?.MatchID, matchType: match?.MatchType, matchContextId: match?.MatchContextId, matchDate: match?.MatchDate, finishedDate: match?.FinishedDate, homeTeam: match?.HomeTeam?.HomeTeamName, awayTeam: match?.AwayTeam?.AwayTeamName, homeGoals: match?.HomeTeam?.HomeGoals, awayGoals: match?.AwayTeam?.AwayGoals };
  writeFileSync(new URL('./masters-format-evidence.json', import.meta.url), JSON.stringify(facts, null, 2));
  console.log(JSON.stringify(facts, null, 2));
} finally { db.close(); }
