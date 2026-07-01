import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { syncAllNationalChampions } from '../sync/nationalChampions.js';
import type { TokenPair } from '../chpp/auth.js';

// Self-contained backfill: seed leagues, then reconstruct champions for every country.
// Resume-safe — re-run to continue after an interruption (finished seasons are skipped).
const access: TokenPair = JSON.parse(readFileSync(process.env.OAUTH_ACCESS_STASH!, 'utf8'));

interface Seed { leagueId: number; countryName: string; topSeriesId: number; currentSeason: number | null; isCountry: boolean }
const seed: Seed[] = JSON.parse(readFileSync('src/data/leagues.json', 'utf8'));
for (const s of seed) {
  await prisma.nationalLeague.upsert({
    where: { leagueId: s.leagueId },
    update: { countryName: s.countryName, topSeriesId: s.topSeriesId, currentSeason: s.currentSeason, isCountry: s.isCountry },
    create: { leagueId: s.leagueId, countryName: s.countryName, topSeriesId: s.topSeriesId, currentSeason: s.currentSeason ?? undefined, isCountry: s.isCountry },
  });
}
console.log(`seeded ${seed.length} leagues; starting backfill at ${new Date().toISOString()}`);

await syncAllNationalChampions(access, {});

const total = await prisma.leagueChampion.count();
const countries = (await prisma.leagueChampion.groupBy({ by: ['leagueId'] })).length;
console.log(`DONE: ${total} champion rows across ${countries} leagues at ${new Date().toISOString()}`);
await prisma.$disconnect();
