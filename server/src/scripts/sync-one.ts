import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { syncNationalChampions } from '../sync/nationalChampions.js';
import type { TokenPair } from '../chpp/auth.js';

// Seed leagues (idempotent, adds any new ones e.g. Switzerland) then sync one league by id.
const access: TokenPair = JSON.parse(readFileSync(process.env.OAUTH_ACCESS_STASH!, 'utf8'));
const leagueId = Number(process.argv[2]);

interface Seed { leagueId: number; countryName: string; topSeriesId: number; currentSeason: number | null; isCountry: boolean }
const seed: Seed[] = JSON.parse(readFileSync('src/data/leagues.json', 'utf8'));
for (const s of seed) {
  await prisma.nationalLeague.upsert({
    where: { leagueId: s.leagueId },
    update: { countryName: s.countryName, topSeriesId: s.topSeriesId, currentSeason: s.currentSeason, isCountry: s.isCountry },
    create: { leagueId: s.leagueId, countryName: s.countryName, topSeriesId: s.topSeriesId, currentSeason: s.currentSeason ?? undefined, isCountry: s.isCountry },
  });
}

const r = await syncNationalChampions(access, leagueId);
console.log(`${r.countryName}: ${r.seasonsStored} seasons stored, back to S${r.earliestSeason}, current champ ${r.latestChampion}`);
await prisma.$disconnect();
