import { writeFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { MASTERS_CUP_ID } from '../sync/masters.js';
import { UNKNOWN } from '../sync/enrichManagers.js';

/**
 * Export the Hattrick Masters editions still lacking a resolved owner as targets for the in-browser
 * Club/History scraper — the SAME pipeline national cups use (export-cup-unresolved -> scrape ->
 * ingest-cup-managers), so we resolve the TRUE owner-at-season, not just the current owner.
 *
 * Why the cup scraper works on Masters unchanged: a Masters win is a cup victory, so it appears in
 * the winning team's Club/History as a victory event that names the manager inline (with a
 * /Club/Manager/?userId= link). server/scrape/cup-history-scraper.js reads exactly those events and
 * is cup-name-agnostic, so pointing it at a Masters winner's teamId yields {season, userId, name};
 * ingest-cup-managers then applies it to CupChampion by (teamId, season), Masters included.
 *
 * Included: editions whose championUserId is null OR the UNKNOWN(0) sentinel. Unlike a national cup
 * (where 0 means a genuinely deleted team not worth scraping), a Masters 0 is usually just a club the
 * current-owner pass couldn't read — its Club/History still names the season-winner if the club
 * lives. Pass ALL=1 to also re-export ALREADY-attributed editions, to override an unreliable
 * current-owner credit (team sold after winning) with the true owner-at-season.
 *
 * A teamId is required (it is the history URL). Editions still without one need their final resolved
 * first (npm run sync:masters, or recover-masters for the CHPP penalty-final cases).
 *
 * Writes [{teamId, seasons}] to $OUT, ranked by unresolved-season count so the highest-value teams
 * scrape first. Point $OUT at the masters-phase server's targets file:
 *
 *   OUT="$SCRAPE_DIR/masters-unresolved.json" npm run export:masters-unresolved -w server
 *
 * then run the server with SCRAPE_PHASE=masters and paste cup-history-scraper.js into a logged-in
 * hattrick.org tab. Its done-set (masters-owners.jsonl) is isolated from the league/cup scrapes, so a
 * team already scraped for its national cups is still scraped here for its Masters season.
 */
const OUT = process.env.OUT!;
const ALL = process.env.ALL === '1';

const rows = await prisma.cupChampion.findMany({
  where: {
    cupId: MASTERS_CUP_ID,
    championTeamId: { not: null },
    ...(ALL ? {} : { OR: [{ championUserId: null }, { championUserId: UNKNOWN }] }),
  },
  select: { championTeamId: true, season: true },
});

const byTeam = new Map<number, number[]>();
for (const r of rows) {
  const a = byTeam.get(r.championTeamId!) ?? [];
  a.push(r.season);
  byTeam.set(r.championTeamId!, a);
}

const targets = [...byTeam.entries()]
  .map(([teamId, seasons]) => ({ teamId, seasons: seasons.sort((a, b) => b - a) }))
  .sort((a, b) => b.seasons.length - a.seasons.length || a.teamId - b.teamId);

writeFileSync(OUT, JSON.stringify(targets));
console.log(`wrote ${targets.length} Masters teams (${rows.length} ${ALL ? 'total' : 'unresolved'} editions) -> ${OUT}`);
if (targets.length) console.log(`teams: ${targets.slice(0, 12).map((t) => `${t.teamId}:S${t.seasons.join('/')}`).join('  ')}`);
await prisma.$disconnect();
