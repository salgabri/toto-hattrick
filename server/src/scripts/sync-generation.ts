import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { ingestSeasonalWinners, GENERATION_TROPHY_IDS, type SeasonalWinner } from '../sync/seasonal.js';
import type { TokenPair } from '../chpp/auth.js';

/**
 * Ingest the "Heroes of YYYY Trophy" cohorts — 23 perpetual tournaments, one launched per real-world
 * year since 2004, each recurring on its own season counter forever (see sync/seasonal.ts). Winners
 * were scraped once from the logged-in ArenaHub TournamentHistory pages (server/scrape/
 * generation-trophy-scraper.js) into the committed seed sync/generation-trophy-winners.json — same
 * pattern as supporter-week-winners.json. Resume-safe/idempotent (ingestSeasonalWinners upserts).
 * Re-bake afterwards.
 *
 *   OAUTH_ACCESS_STASH=.oauth-access.json npm run sync:generation -w server
 *
 * Pass IN=<path> to ingest a fresh scrape (e.g. $SCRAPE_DIR/generation-owners.jsonl, one JSON record
 * per line) instead of the committed seed — e.g. after re-scraping newer seasons.
 */
const access: TokenPair = JSON.parse(readFileSync(process.env.OAUTH_ACCESS_STASH ?? '.oauth-access.json', 'utf8'));
type Winner = { cupId: number; name: string; season: number; teamId: number | null; team: string; userId: number | null; manager: string | null };
const recs: Winner[] = process.env.IN
  ? readFileSync(process.env.IN, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  : JSON.parse(readFileSync(new URL('../sync/generation-trophy-winners.json', import.meta.url), 'utf8'));

const knownIds = new Set(Object.values(GENERATION_TROPHY_IDS));
const byCupId = new Map<number, { name: string; winners: SeasonalWinner[] }>();
for (const r of recs) {
  if (!knownIds.has(r.cupId)) { console.log(`skipping unknown cupId ${r.cupId} (not in GENERATION_TROPHY_IDS)`); continue; }
  let e = byCupId.get(r.cupId);
  if (!e) { e = { name: r.name, winners: [] }; byCupId.set(r.cupId, e); }
  e.winners.push({ season: r.season, teamId: r.teamId, team: r.team, userId: r.userId, manager: r.manager });
}

console.log(`sync:generation @ ${new Date().toISOString()} — ${byCupId.size} cohorts, ${recs.length} records`);
for (const [cupId, { name, winners }] of byCupId) {
  const r = await ingestSeasonalWinners(access, { cupId, name, winners });
  console.log(`  ${name} (${cupId}): ingested ${r.seasons} editions; latest S${r.latestSeason} champion ${r.latestChampion ?? '—'}`);
}

const total = await prisma.cupChampion.count({ where: { cupId: { in: [...knownIds] } } });
console.log(`total Heroes-of-Generation editions in DB: ${total}`);
await prisma.$disconnect();
