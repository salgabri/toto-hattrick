import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { ingestNtCupSeasons, type NtCupSeason } from '../sync/ntCups.js';

/**
 * Ingest regional national-team cup seasons scraped from World/WorldCup/Cup.aspx (see
 * sync/ntCups.ts + scrape/ntcups-scraper.js).
 *
 *   IN="$SCRAPE_DIR/ntcups.jsonl" npm run sync:ntcups -w server
 *
 * Upserts per (cupId, season), so re-running after a partial scrape adds what's new and refreshes
 * seasons that have since finished. Attribution is a separate step (sync:ntcup-coaches).
 */
const IN = process.env.IN;
if (!IN) {
  console.error('IN=<ntcups.jsonl> is required');
  process.exit(1);
}
const rows: NtCupSeason[] = readFileSync(IN, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

const res = await ingestNtCupSeasons(rows);
console.log(`ingested ${res.seasons} cup-season(s), ${res.withChampion} with a champion, ${res.skipped} skipped (unregistered cup)`);

const total = await prisma.nationalCupChampion.count();
const decided = await prisma.nationalCupChampion.count({ where: { champion: { not: null } } });
console.log(`total in DB: ${total}, with a champion: ${decided}`);
await prisma.$disconnect();
