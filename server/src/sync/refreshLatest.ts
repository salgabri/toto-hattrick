import { prisma } from '../db/client.js';
import type { TokenPair } from '../chpp/auth.js';
import { fetchWorldDetails } from '../chpp/endpoints.js';
import { parseWorldDetailsCups } from '../schemas/index.js';
import { syncNationalChampions } from './nationalChampions.js';
import { syncCupChampions, enrichCupTeamIds } from './cups.js';

/**
 * "Latest champions only" — the forward counterpart to the backfill.
 *
 * The backfill walks each competition BACKWARD from a seeded season down to season 1, which is
 * perfect for filling history but structurally cannot pick up NEWER seasons: it ceilings at the
 * static seed season and never looks above it (see sync/nationalChampions.ts). This module closes
 * that gap so the lists stay current over time:
 *
 *   1. refreshCurrentSeasons() — one worlddetails call per country updates NationalLeague (and its
 *      Cups) to Hattrick's LIVE current season. This is the step the backfill never did.
 *   2. A BOUNDED forward walk — for each league/cup, re-walk only from the (now current) season
 *      down to a recent floor, so a run costs a handful of leaguefixtures/cupmatches calls, not a
 *      full history sweep. Newly finished seasons get crowned; the in-progress one is refreshed.
 *
 * Resume-safe throughout (finished seasons are skipped with no API call). Manager attribution and
 * the static re-bake are driven by the caller (scripts/refresh-latest.ts) using the existing
 * incremental enrichers — they only touch the rows this pass added.
 */

const PACING_MS = 600;
const DEFAULT_LOOKBACK = 3; // how far back to fetch when a competition has no settled season yet
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SeasonAdvance {
  leagueId: number;
  country: string;
  from: number | null;
  to: number;
}

/**
 * Pull each country's live current season from worlddetails and store it on NationalLeague and its
 * Cup rows. Returns the countries whose season advanced since we last looked.
 */
export async function refreshCurrentSeasons(
  token: TokenPair,
  opts: { onlyLeagueIds?: number[] } = {},
): Promise<SeasonAdvance[]> {
  const leagues = await prisma.nationalLeague.findMany({
    // All tracked leagues, including the non-country ones (Hattrick International / Homegrown / Femme).
    where: opts.onlyLeagueIds ? { leagueId: { in: opts.onlyLeagueIds } } : {},
    orderBy: { leagueId: 'asc' },
  });

  const advanced: SeasonAdvance[] = [];
  let i = 0;
  for (const league of leagues) {
    i++;
    try {
      const wd = parseWorldDetailsCups(await fetchWorldDetails(token, league.leagueId));
      if (wd.currentSeason !== league.currentSeason) {
        advanced.push({ leagueId: league.leagueId, country: league.countryName, from: league.currentSeason, to: wd.currentSeason });
      }
      await prisma.nationalLeague.update({ where: { leagueId: league.leagueId }, data: { currentSeason: wd.currentSeason } });
      // A cup's season numbering matches its country's, so the same worlddetails season applies.
      await prisma.cup.updateMany({ where: { leagueId: league.leagueId }, data: { currentSeason: wd.currentSeason } });
    } catch (e) {
      console.log(`  refresh ${league.countryName}: ERROR ${(e as Error).message.slice(0, 100)}`);
    }
    await sleep(PACING_MS);
  }
  return advanced;
}

/** Highest already-settled league season → the walk floor (fetch it + everything above). */
async function leagueFloor(leagueId: number, currentSeason: number, lookback: number): Promise<number> {
  const lastComplete = await prisma.leagueChampion.findFirst({
    where: { leagueId, complete: true },
    orderBy: { season: 'desc' },
    select: { season: true },
  });
  return lastComplete?.season ?? Math.max(1, currentSeason - lookback);
}

/**
 * Floor for a cup's bounded forward walk. Always cover the recent window (currentSeason - lookback):
 * a real final in that window is skipped cheaply by syncCupChampions (DB read, no API call), but a
 * reconstructed placeholder there is re-walked and upgraded to a real final so it becomes
 * attributable (see syncCupChampions' skip rule). NB: this must not ceiling at the highest STORED
 * season — reconstruct-from-bake fills every season with a placeholder, so that would freeze the
 * walk above the placeholders and they'd never materialize. Older placeholders (below the window)
 * stay for the ownership-history scrape. Mirrors enrichRecentCupManagers' own lookback window.
 */
function cupFloor(currentSeason: number, lookback: number): number {
  return Math.max(1, currentSeason - lookback);
}

export interface RefreshLatestResult {
  leaguesAdvanced: number;
  leagueChampionsAdded: number;
  cupChampionsAdded: number;
}

/**
 * Refresh the latest champions across every seeded country (or a subset). Cheap and repeatable —
 * run it whenever seasons roll over. `lookback` only matters for competitions with no settled
 * season yet; established ones re-walk just down to their last stored season.
 */
export async function refreshLatestChampions(
  token: TokenPair,
  opts: { lookback?: number; onlyLeagueIds?: number[] } = {},
): Promise<RefreshLatestResult> {
  const lookback = opts.lookback ?? DEFAULT_LOOKBACK;
  const onlyLeagueIds = opts.onlyLeagueIds;
  const leagueFilter = onlyLeagueIds ? { leagueId: { in: onlyLeagueIds } } : {};

  // 1) Discover the live current season for every country (and its cups).
  const advanced = await refreshCurrentSeasons(token, { onlyLeagueIds });
  console.log(`currentSeason refreshed — ${advanced.length} countries advanced`);
  for (const a of advanced) console.log(`  ${a.country}: S${a.from ?? '—'} -> S${a.to}`);

  // 2) League champions — bounded forward walk per league (re-reads the just-refreshed season).
  const leagues = await prisma.nationalLeague.findMany({
    where: leagueFilter,
    orderBy: { leagueId: 'asc' },
  });
  let leagueChampionsAdded = 0;
  let i = 0;
  for (const league of leagues) {
    i++;
    const current = league.currentSeason ?? 1;
    const floor = await leagueFloor(league.leagueId, current, lookback);
    try {
      const r = await syncNationalChampions(token, league.leagueId, { minSeason: floor });
      leagueChampionsAdded += r.seasonsStored;
      if (r.seasonsStored) {
        console.log(`  [${i}/${leagues.length}] ${league.countryName}: +${r.seasonsStored} (S${floor}..S${current}), latest ${r.latestChampion ?? '—'}`);
      }
    } catch (e) {
      console.log(`  ${league.countryName}: ERROR ${(e as Error).message.slice(0, 100)}`);
    }
  }

  // 3) Cup finals — same bounded walk. Cups must already be seeded (sync-cups MODE=seed); this
  //    only harvests new finals, it does not create the catalog.
  const cups = await prisma.cup.findMany({ where: leagueFilter, orderBy: [{ leagueId: 'asc' }, { cupLevel: 'asc' }, { cupLevelIndex: 'asc' }] });
  let cupChampionsAdded = 0;
  let j = 0;
  for (const cup of cups) {
    j++;
    const current = cup.currentSeason ?? 1;
    const floor = cupFloor(current, lookback);
    try {
      const r = await syncCupChampions(token, cup.cupId, { minSeason: floor });
      cupChampionsAdded += r.seasonsStored;
      if (r.seasonsStored) {
        console.log(`  [${j}/${cups.length}] ${cup.countryName} ${cup.cupName}: +${r.seasonsStored}, latest ${r.latestChampion ?? '—'}`);
      }
    } catch (e) {
      console.log(`  cup ${cup.cupName}: ERROR ${(e as Error).message.slice(0, 100)}`);
    }
  }

  // 4) Resolve the winning teamId for the new finals (newest-first, so the fresh ones go first).
  if (cupChampionsAdded > 0) await enrichCupTeamIds(token, {});

  return { leaguesAdvanced: advanced.length, leagueChampionsAdded, cupChampionsAdded };
}
