import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { ingestSeasonalWinners, SUPPORTER_WEEK_CUP_ID, type SeasonalWinner } from '../sync/seasonal.js';
import type { TokenPair } from '../chpp/auth.js';

/**
 * Populate the "Seasonal Cups" category from the Supporter Week Trophy roll of honour. The winners
 * (season -> team + manager) were scraped once from the logged-in ArenaHub TournamentHistory pages
 * into sync/supporter-week-winners.json (CHPP does not expose them — see sync/seasonal.ts). This
 * seeds the cup, ingests every edition, and resolves nationalities. Resume-safe/idempotent.
 *
 *   OAUTH_ACCESS_STASH=.oauth-access.json npm run sync:seasonal -w server
 *
 * Then re-bake: npm run bake -w server
 */
const access: TokenPair = JSON.parse(readFileSync(process.env.OAUTH_ACCESS_STASH ?? '.oauth-access.json', 'utf8'));
const winners: SeasonalWinner[] = JSON.parse(
  readFileSync(new URL('../sync/supporter-week-winners.json', import.meta.url), 'utf8'),
);

console.log(`sync:seasonal @ ${new Date().toISOString()} — Supporter Week Trophy: ${winners.length} editions`);
const r = await ingestSeasonalWinners(access, { cupId: SUPPORTER_WEEK_CUP_ID, name: 'Supporter Week Trophy', winners });
console.log(`ingested ${r.seasons} editions; latest S${r.latestSeason} champion ${r.latestChampion ?? '—'}`);

const rows = await prisma.cupChampion.findMany({
  where: { cupId: SUPPORTER_WEEK_CUP_ID },
  orderBy: { season: 'desc' },
  select: { season: true, championTeamName: true, championUserName: true },
});
console.log(`total Supporter Week editions in DB: ${rows.length}`);
for (const w of rows.slice(0, 8)) console.log(`  S${w.season}: ${w.championTeamName} — ${w.championUserName ?? '—'}`);

await prisma.$disconnect();
