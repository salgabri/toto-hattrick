import { writeFileSync } from 'node:fs';
import { prisma } from '../db/client.js';

/**
 * Export the cup finals still missing an owner (championUserId null) as scrape targets for the
 * in-browser Club/History scraper. One entry per team with its unattributed cup-winning seasons:
 *   [{ teamId, seasons: [..] }]
 * Ranked by number of unattributed finals (desc) so scraping the highest-value teams first covers
 * the most finals per request — important because the site rate-limits hard. Same shape as the
 * league targets, so the existing scraper consumes it unchanged (run the server with
 * SCRAPE_PHASE=cup so /api/scrape/targets serves this file). Writes to $OUT.
 */
const OUT = process.env.OUT!;
const MAIN_ONLY = process.env.MAIN_ONLY === '1'; // optionally restrict to the main national cup

const rows = await prisma.cupChampion.findMany({
  where: { championUserId: null, championTeamId: { not: null }, ...(MAIN_ONLY ? { isMain: true } : {}) },
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
console.log(`wrote ${targets.length} teams (${rows.length} unattributed finals${MAIN_ONLY ? ', main cups only' : ''}) -> ${OUT}`);
console.log(`top teams by finals: ${targets.slice(0, 5).map((t) => `${t.teamId}:${t.seasons.length}`).join(' ')}`);
await prisma.$disconnect();
