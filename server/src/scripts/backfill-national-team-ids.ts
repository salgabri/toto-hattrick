import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { fetchWorldDetails } from '../chpp/endpoints.js';
import type { TokenPair } from '../chpp/auth.js';

/**
 * Backfill NationalLeague.nationalTeamId/u20TeamId from worlddetails (one call per country).
 * worlddetails' LeagueName is the NATIVE name Hattrick uses for that country (e.g. "Sverige"),
 * which is exactly how World Cup champions are named on World/WorldCup/History.aspx — so this also
 * prints the native-name map, needed to cross-reference champion nations against their team id
 * (see sync/worldCup.ts). Resume-safe; only touches isCountry leagues (the specials have no real
 * national team).
 *
 *   OAUTH_ACCESS_STASH=.oauth-access.json npm run backfill:national-team-ids -w server
 */
const access: TokenPair = JSON.parse(readFileSync(process.env.OAUTH_ACCESS_STASH ?? '.oauth-access.json', 'utf8'));
const PACING_MS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const leagues = await prisma.nationalLeague.findMany({ where: { isCountry: true }, orderBy: { leagueId: 'asc' } });
const nativeNameMap: Record<string, { leagueId: number; nationalTeamId: number | null; u20TeamId: number | null }> = {};

let i = 0;
for (const league of leagues) {
  i++;
  try {
    const h = ((await fetchWorldDetails(access, league.leagueId)) as any).HattrickData.LeagueList.League;
    const nativeName: string = h.LeagueName;
    const nationalTeamId = Number(h.NationalTeamId) || null;
    const u20TeamId = Number(h.U20TeamId) || null;
    await prisma.nationalLeague.update({ where: { leagueId: league.leagueId }, data: { nationalTeamId, u20TeamId } });
    nativeNameMap[nativeName] = { leagueId: league.leagueId, nationalTeamId, u20TeamId };
    console.log(`[${i}/${leagues.length}] ${league.countryName} (${nativeName}): NT=${nationalTeamId} U20=${u20TeamId}`);
  } catch (e) {
    console.log(`[${i}/${leagues.length}] ${league.countryName}: ERROR ${(e as Error).message.slice(0, 100)}`);
  }
  await sleep(PACING_MS);
}

console.log('\nnative-name map (paste into worldCup.ts if useful):');
console.log(JSON.stringify(nativeNameMap));
await prisma.$disconnect();
