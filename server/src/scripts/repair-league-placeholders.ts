import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import type { TokenPair } from '../chpp/auth.js';
import { fetchLeagueFixtures } from '../chpp/endpoints.js';
import { parseLeagueFixtures } from '../schemas/index.js';
import { computeStandings } from '../sync/standings.js';

/**
 * Upgrade reconstructed LEAGUE placeholders to real rows, so they can be attributed at all.
 *
 * reconstruct-from-bake restores league champions with championTeamId 0 (the bake never emitted
 * internal ids). Without a team id nothing can resolve their manager: enrichChampionManagers keys
 * teamdetails off championTeamId, and the name bridge only reaches clubs that already have an
 * attributed title somewhere in the same country. So these rows are stuck out of every cabinet.
 *
 * Why a separate script rather than re-running the league sync: nationalChampions.ts skips any
 * season where `existing?.complete` — correctly, it is a resume guard — and every placeholder is
 * complete. That guard makes the normal path unable to repair them, by design.
 *
 * leaguefixtures serves historical seasons (verified across S1-S66), so one call per (topSeriesId,
 * season) rebuilds the real table and yields the champion's team id.
 *
 * Safety: the recomputed champion's NAME must match the name already stored. The stored name came
 * from the bake and is trusted; a mismatch means the live table disagrees with it, so the row is
 * left alone and reported rather than overwritten. Nothing else about the row is touched, and
 * championUserId is deliberately NOT set here — run `backfill:managers` afterwards for that.
 *
 * Resume-safe: only rows with championTeamId 0 are considered, and each is committed on its own, so
 * an interrupted run resumes exactly where it stopped.
 *
 *   OAUTH_ACCESS_STASH=.oauth-access.json npm run repair:leagues -w server
 *
 * Env: MAX_CALLS (per-run budget, default 1200) · PACING_MS (default 900).
 */
const token: TokenPair = JSON.parse(readFileSync(process.env.OAUTH_ACCESS_STASH ?? '.oauth-access.json', 'utf8'));
const MAX_CALLS = Number(process.env.MAX_CALLS ?? 1200);
const PACING_MS = Number(process.env.PACING_MS ?? 900);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * By default only rows that also lack a manager — those are the ones the gap is about, 990 calls
 * rather than 9,913. reconstruct-from-bake zeroed championTeamId on EVERY league row, so the wider
 * set is real work too (team links, period-accurate ownership scraping) but it buys no attribution.
 * ALL=1 to sweep every placeholder.
 */
const pending = await prisma.leagueChampion.findMany({
  where: process.env.ALL ? { complete: true, championTeamId: 0 } : { complete: true, championTeamId: 0, championUserId: null },
  select: { leagueId: true, topSeriesId: true, season: true, championTeamName: true, countryName: true },
  orderBy: [{ season: 'desc' }, { leagueId: 'asc' }], // newest first: the most-visible cabinets fill first
});
console.log(`${pending.length} league placeholders to repair (budget ${MAX_CALLS} calls) @ ${new Date().toISOString()}`);

let calls = 0, fixed = 0, mismatched = 0, empty = 0, failed = 0, consecutiveFailures = 0;
const mismatches: string[] = [];

for (const p of pending) {
  if (calls >= MAX_CALLS) { console.log(`budget reached after ${calls} calls — re-run to continue`); break; }
  // A run of failures means the token or the API is the problem, not this row: stop cleanly and keep
  // everything already committed. Isolated failures reset the counter and never abort.
  if (consecutiveFailures >= 8) { console.log('8 consecutive failures — aborting cleanly'); break; }

  let table;
  try {
    calls++;
    table = computeStandings(parseLeagueFixtures(await fetchLeagueFixtures(token, { leagueLevelUnitId: p.topSeriesId, season: p.season })).matches);
    consecutiveFailures = 0;
  } catch (e) {
    failed++; consecutiveFailures++;
    console.warn(`  ! ${p.countryName} S${p.season}: ${(e as Error).message.slice(0, 90)}`);
    await sleep(PACING_MS);
    continue;
  }
  await sleep(PACING_MS);

  const champ = table.champion;
  if (!table.rows.length || !champ) { empty++; continue; }

  if (champ.teamName !== p.championTeamName) {
    mismatched++;
    if (mismatches.length < 20) mismatches.push(`${p.countryName} S${p.season}: bake="${p.championTeamName}" live="${champ.teamName}"`);
    continue;
  }

  await prisma.leagueChampion.update({
    where: { leagueId_season: { leagueId: p.leagueId, season: p.season } },
    data: { championTeamId: champ.teamId, played: champ.played, points: champ.points },
  });
  fixed++;
  if (fixed % 50 === 0) console.log(`  ${fixed} repaired (${calls} calls)`);
}

console.log(`\ndone: ${fixed} repaired, ${mismatched} name mismatches, ${empty} empty tables, ${failed} errors, ${calls} calls`);
if (mismatches.length) {
  console.log('name mismatches (left untouched, for review):');
  for (const m of mismatches) console.log('  ' + m);
}
const left = await prisma.leagueChampion.count({ where: { complete: true, championTeamId: 0 } });
console.log(`league placeholders remaining: ${left}`);
console.log('next: npm run backfill:managers -w server   (resolves owners for the new team ids)');
await prisma.$disconnect();
