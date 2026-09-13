import { prisma } from '../db/client.js';
import type { TokenPair } from '../chpp/auth.js';
import { fetchLeagueFixtures } from '../chpp/endpoints.js';
import { parseLeagueFixtures } from '../schemas/index.js';
import { computeStandings } from './standings.js';

/**
 * Reconstruct the champion of a country's TOP division for every season it has existed.
 *
 * leaguefixtures(topSeriesId, season) returns all results in the top division for that season
 * (history included) → computeStandings() → champion. Walk from the current season backwards
 * until a season returns no fixtures (before the country existed; seasons 1–2 are also empty).
 *
 * Resume-safe: a finished (complete) season is never refetched.
 */

const PACING_MS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface LeagueSyncResult {
  leagueId: number;
  countryName: string;
  seasonsStored: number;
  earliestSeason: number | null;
  latestChampion: string | null;
  issues: Array<{ season: number; reason: string }>;
}

export async function syncNationalChampions(
  token: TokenPair,
  leagueId: number,
  opts: { minSeason?: number; seasons?: readonly number[]; pacingMs?: number; throwOnFetchError?: boolean } = {},
): Promise<LeagueSyncResult> {
  const league = await prisma.nationalLeague.findUnique({ where: { leagueId } });
  if (!league) throw new Error(`league ${leagueId} not seeded`);
  const start = league.currentSeason ?? 100;
  // Floor for the backward walk. Backfill leaves it at 1 (whole history); the "latest" refresh
  // passes a recent floor so it fetches only new/unsettled seasons instead of re-walking to S1.
  const floor = Math.max(1, opts.minSeason ?? 1);

  const pacingMs = opts.pacingMs ?? PACING_MS;
  const result: LeagueSyncResult = { leagueId, countryName: league.countryName, seasonsStored: 0, earliestSeason: null, latestChampion: null, issues: [] };
  const seasons = opts.seasons ? [...new Set(opts.seasons)].sort((a, b) => b - a)
    : Array.from({ length: Math.max(0, start - floor + 1) }, (_, i) => start - i);
  if (seasons.some(season => !Number.isSafeInteger(season) || season < 1)) throw new Error('Invalid league season selection');

  for (const season of seasons) {
    const existing = await prisma.leagueChampion.findUnique({ where: { leagueId_season: { leagueId, season } } });
    if (existing?.complete) {
      result.earliestSeason = season;
      continue; // settled
    }

    let table;
    try {
      const fx = parseLeagueFixtures(await fetchLeagueFixtures(token, { leagueLevelUnitId: league.topSeriesId, season }));
      if (fx.season !== season || fx.leagueLevelUnitId !== league.topSeriesId) {
        result.issues.push({ season, reason: 'League response differs from the requested division/season' });
        continue;
      }
      table = computeStandings(fx.matches);
    } catch (error) {
      if (opts.throwOnFetchError) throw error;
      result.issues.push({ season, reason: 'League fixtures could not be fetched or validated' });
      await sleep(pacingMs);
      continue;
    }
    await sleep(pacingMs);

    // Empty current seasons are normal. Explicit work lists retain every older unresolved item;
    // an empty response cannot prove that another edition never existed.
    if (table.rows.length === 0) {
      if (opts.seasons || season === start) continue;
      break;
    }
    const champ = table.champion;
    if (!champ) continue;

    await prisma.leagueChampion.upsert({
      where: { leagueId_season: { leagueId, season } },
      update: {
        topSeriesId: league.topSeriesId,
        countryName: league.countryName,
        championTeamId: champ.teamId,
        championTeamName: champ.teamName,
        played: champ.played,
        points: champ.points,
        complete: table.complete,
      },
      create: {
        leagueId,
        season,
        topSeriesId: league.topSeriesId,
        countryName: league.countryName,
        championTeamId: champ.teamId,
        championTeamName: champ.teamName,
        played: champ.played,
        points: champ.points,
        complete: table.complete,
      },
    });

    result.seasonsStored++;
    result.earliestSeason = season;
    if (season === start) result.latestChampion = champ.teamName;
  }

  return result;
}

/** Backfill every seeded country. Resume-safe; logs progress. Skips non-country leagues. */
export async function syncAllNationalChampions(
  token: TokenPair,
  opts: { includeNonCountry?: boolean; onlyLeagueIds?: number[] } = {},
): Promise<void> {
  const leagues = await prisma.nationalLeague.findMany({
    where: opts.includeNonCountry ? {} : { isCountry: true },
    orderBy: { leagueId: 'asc' },
  });
  const targets = opts.onlyLeagueIds ? leagues.filter((l) => opts.onlyLeagueIds!.includes(l.leagueId)) : leagues;

  let i = 0;
  for (const league of targets) {
    i++;
    try {
      const r = await syncNationalChampions(token, league.leagueId);
      console.log(`[${i}/${targets.length}] ${r.countryName}: +${r.seasonsStored} seasons (back to S${r.earliestSeason}), current champ ${r.latestChampion ?? '—'}`);
    } catch (e) {
      console.log(`[${i}/${targets.length}] ${league.countryName}: ERROR ${(e as Error).message.slice(0, 120)}`);
    }
  }
  console.log('backfill pass complete');
}
