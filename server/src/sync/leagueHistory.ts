import { prisma } from '../db/client.js';
import type { TokenPair } from '../chpp/auth.js';
import { fetchMatchesArchiveBySeason, fetchLeagueFixtures } from '../chpp/endpoints.js';
import { parseMatchesArchive, parseLeagueFixtures } from '../schemas/index.js';
import { computeStandings } from './standings.js';

/**
 * For every season a team has played, reconstruct its league division's final table and store
 * the champion. Runs after syncTeam() (it reads the seasons already in the DB).
 *
 * Per season: matchesarchive(season) tells us which division (LeagueLevelUnitID) the team was
 * in; leaguefixtures(unit, season) gives every result in that division; computeStandings()
 * crowns the champion. Resume-safe: a finished (complete) season is never recomputed.
 */

const PACING_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LEAGUE_MATCH = 1; // MatchType for a league fixture

export interface ChampionResult {
  season: number;
  league: string;
  champion: string;
  complete: boolean;
}

export async function syncLeagueHistory(token: TokenPair, teamId: number): Promise<ChampionResult[]> {
  const seasons = (
    await prisma.match.findMany({
      where: { teamId },
      distinct: ['season'],
      select: { season: true },
      orderBy: { season: 'desc' },
    })
  ).map((s) => s.season);

  const out: ChampionResult[] = [];

  for (const season of seasons) {
    const existing = await prisma.seasonStanding.findUnique({ where: { teamId_season: { teamId, season } } });
    if (existing?.complete) {
      out.push({ season, league: existing.leagueLevelUnitName, champion: existing.championTeamName, complete: true });
      continue; // finished season — settled, never changes
    }

    // Which division was the team in this season?
    const { matches } = parseMatchesArchive(await fetchMatchesArchiveBySeason(token, { teamId, season }));
    const unit = matches.find((m) => m.matchType === LEAGUE_MATCH && m.matchContextId)?.matchContextId;
    if (!unit) {
      await sleep(PACING_MS);
      continue; // no league matches that season (shouldn't happen, but skip safely)
    }
    await sleep(PACING_MS);

    const fixtures = parseLeagueFixtures(await fetchLeagueFixtures(token, { leagueLevelUnitId: unit, season }));
    const table = computeStandings(fixtures.matches);
    await sleep(PACING_MS);
    if (!table.champion) continue;

    await prisma.seasonStanding.upsert({
      where: { teamId_season: { teamId, season } },
      update: {
        leagueLevelUnitId: fixtures.leagueLevelUnitId,
        leagueLevelUnitName: fixtures.leagueLevelUnitName,
        championTeamId: table.champion.teamId,
        championTeamName: table.champion.teamName,
        complete: table.complete,
        standingsJson: JSON.stringify(table.rows),
      },
      create: {
        teamId,
        season,
        leagueLevelUnitId: fixtures.leagueLevelUnitId,
        leagueLevelUnitName: fixtures.leagueLevelUnitName,
        championTeamId: table.champion.teamId,
        championTeamName: table.champion.teamName,
        complete: table.complete,
        standingsJson: JSON.stringify(table.rows),
      },
    });

    out.push({ season, league: fixtures.leagueLevelUnitName, champion: table.champion.teamName, complete: table.complete });
  }

  return out;
}
