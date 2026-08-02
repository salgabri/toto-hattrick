import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { attributeWorldCupCoaches, type CoachTenure } from '../sync/worldCup.js';
import type { TokenPair } from '../chpp/auth.js';

/**
 * Attribute World Cup champions to the coach in charge when each edition finished, from the
 * coaching-tenure history scraped once from NTFormerCoaches.aspx (see sync/worldCup.ts) and
 * committed as the seed worldcup-coaches.json — same pattern as the other scraped datasets.
 *
 *   OAUTH_ACCESS_STASH=.oauth-access.json npm run sync:worldcup-coaches -w server
 *
 * Pass IN=<path> (a .jsonl, one record per line) to ingest a fresh scrape instead — e.g. after
 * re-running server/scrape/worldcup-coaches-scraper.js for newer editions.
 */
const access: TokenPair = JSON.parse(readFileSync(process.env.OAUTH_ACCESS_STASH ?? '.oauth-access.json', 'utf8'));
// IN is MERGED on top of the seed, never a replacement: the seed holds the World Cup nations'
// tenures, while a top-up scrape holds whichever other teams were needed (e.g. the regional cups'
// medallists). Replacing would silently drop every champion attribution the seed alone can make.
const seed: CoachTenure[] = JSON.parse(readFileSync(new URL('../sync/worldcup-coaches.json', import.meta.url), 'utf8'));
const extra: CoachTenure[] = process.env.IN
  ? readFileSync(process.env.IN, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  : [];
const replaced = new Set(extra.map((t) => t.teamId));
const tenures: CoachTenure[] = [...seed.filter((t) => !replaced.has(t.teamId)), ...extra];
console.log(`tenures: ${seed.length} seed + ${extra.length} scraped -> ${tenures.length} (${replaced.size} team(s) refreshed)`);

const r = await attributeWorldCupCoaches(access, tenures);
console.log(`attributed ${r.attributed}/${r.eligible} World Cup editions to a coach`);
console.log(`medal places (silver + bronze): ${r.medals}/${r.medalSlots} attributed`);

const rows = await prisma.worldCupChampion.findMany({ where: { champion: { not: null } }, orderBy: [{ isYouth: 'asc' }, { edition: 'desc' }] });
for (const row of rows) {
  console.log(`  ${row.isYouth ? 'Youth' : 'Senior'} ${row.edition}: ${row.champion} — ${row.championUserName ?? (row.championUserId === 0 ? 'deleted/bot' : 'unresolved')}`);
}
await prisma.$disconnect();
