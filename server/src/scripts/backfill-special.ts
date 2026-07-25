import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { syncAllNationalChampions } from '../sync/nationalChampions.js';
import { enrichChampionManagers, enrichUserNationalities } from '../sync/enrichManagers.js';
import type { TokenPair } from '../chpp/auth.js';

/**
 * One-time full backfill of the non-country leagues — Hattrick International (1000), Homegrown
 * League (1003), Hattrick Femme International (3000). They're seeded like countries (validated
 * topSeriesId in data/topSeries.ts) but excluded from the default country backfill by isCountry.
 * After this, refresh:latest keeps them current alongside the countries.
 *
 *   OAUTH_ACCESS_STASH=... npm run backfill:special -w server   (then: npm run bake)
 */
const access: TokenPair = JSON.parse(readFileSync(process.env.OAUTH_ACCESS_STASH!, 'utf8'));
const SPECIAL = [1000, 1003, 3000];

console.log(`backfill-special @ ${new Date().toISOString()} — leagues ${SPECIAL.join(', ')}`);
await syncAllNationalChampions(access, { includeNonCountry: true, onlyLeagueIds: SPECIAL });

const m = await enrichChampionManagers(access, {});
const n = await enrichUserNationalities(access, {});
console.log(`managers: ${m.resolved}/${m.processed} resolved; +${n.processed} nationalities`);

const rows = await prisma.leagueChampion.findMany({ where: { leagueId: { in: SPECIAL } }, orderBy: [{ leagueId: 'asc' }, { season: 'desc' }] });
for (const id of SPECIAL) {
  const c = rows.filter((r) => r.leagueId === id);
  console.log(`  league ${id}: ${c.length} champions (newest S${c[0]?.season} ${c[0]?.championTeamName ?? '—'})`);
}
console.log(`done @ ${new Date().toISOString()}`);
await prisma.$disconnect();
