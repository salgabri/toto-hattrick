import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { syncAllNationalChampions } from '../sync/nationalChampions.js';
import { enrichUserNationalities } from '../sync/enrichManagers.js';
import type { TokenPair } from '../chpp/auth.js';

/**
 * One-time full backfill of the non-country leagues — Hattrick International (1000), Homegrown
 * League (1003), Hattrick Femme International (3000). They're seeded like countries (validated
 * topSeriesId in data/topSeries.ts) but excluded from the default country backfill by isCountry.
 * After this, refresh:latest keeps their champion-club facts current alongside the countries.
 * Missing historical managers require the separate dated-history recovery.
 *
 *   OAUTH_ACCESS_STASH=... npm run backfill:special -w server   (then: npm run bake)
 */
const access: TokenPair = JSON.parse(readFileSync(process.env.OAUTH_ACCESS_STASH!, 'utf8'));
const SPECIAL = [1000, 1003, 3000];

console.log(`backfill-special @ ${new Date().toISOString()} — leagues ${SPECIAL.join(', ')}`);
await syncAllNationalChampions(access, { includeNonCountry: true, onlyLeagueIds: SPECIAL });

console.warn('Historical manager attribution is deferred: current-owner inference is disabled. Use recover:historical-winners with the clubs\' saved history evidence.');
const n = await enrichUserNationalities(access, {});
console.log(`Known-manager nationalities: ${n.resolved} resolved, ${n.unknown} unknown, ${n.errors} errors (${n.processed} attempted)`);

const rows = await prisma.leagueChampion.findMany({ where: { leagueId: { in: SPECIAL } }, orderBy: [{ leagueId: 'asc' }, { season: 'desc' }] });
for (const id of SPECIAL) {
  const c = rows.filter((r) => r.leagueId === id);
  console.log(`  league ${id}: ${c.length} champions (newest S${c[0]?.season} ${c[0]?.championTeamName ?? '—'})`);
}
console.log(`done @ ${new Date().toISOString()}`);
await prisma.$disconnect();
