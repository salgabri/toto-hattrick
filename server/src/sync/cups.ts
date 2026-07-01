import { prisma } from '../db/client.js';
import type { TokenPair } from '../chpp/auth.js';
import { fetchWorldDetails, fetchCupMatches, fetchMatchDetails } from '../chpp/endpoints.js';
import { parseWorldDetailsCups, parseCupMatches, parseMatchDetails } from '../schemas/index.js';

/**
 * Cup honours, reconstructed entirely from CHPP (no website scraping).
 *
 *   seedCups()          worlddetails(leagueId) → the five NATIONAL-level cups per country
 *                       (CupLeagueLevel 0): one MAIN (CupLevel 1) + four SECONDARY (CupLevel 2/3).
 *   syncCupChampions()  cupmatches(cupId, season) with no round → the LAST played round; for a
 *                       finished cup that is the single-match final, so the higher score wins.
 *                       Walk seasons back until the cup predates its own existence (round 0).
 *   enrichCupTeamIds()  matchdetails(finalMatchId) → the winner's teamId (positional: home in the
 *                       cupmatches final is home in matchdetails), a cheaper second pass.
 *
 * Resume-safe throughout: a stored final never changes, so re-runs skip it with no API call.
 */

const PACING_MS = 600;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Populate the Cup catalog from every seeded country. National-level cups only. */
export async function seedCups(token: TokenPair, opts: { onlyLeagueIds?: number[] } = {}): Promise<void> {
  const leagues = await prisma.nationalLeague.findMany({
    where: opts.onlyLeagueIds ? { leagueId: { in: opts.onlyLeagueIds } } : { isCountry: true },
    orderBy: { leagueId: 'asc' },
  });

  let i = 0;
  let cups = 0;
  for (const league of leagues) {
    i++;
    try {
      const wd = parseWorldDetailsCups(await fetchWorldDetails(token, league.leagueId));
      const national = wd.cups.filter((c) => c.cupLeagueLevel === 0);
      for (const c of national) {
        await prisma.cup.upsert({
          where: { cupId: c.cupId },
          update: {
            leagueId: league.leagueId,
            countryName: league.countryName,
            cupName: c.cupName,
            cupLevel: c.cupLevel,
            cupLevelIndex: c.cupLevelIndex,
            isMain: c.cupLevel === 1,
            currentSeason: wd.currentSeason,
          },
          create: {
            cupId: c.cupId,
            leagueId: league.leagueId,
            countryName: league.countryName,
            cupName: c.cupName,
            cupLevel: c.cupLevel,
            cupLevelIndex: c.cupLevelIndex,
            isMain: c.cupLevel === 1,
            currentSeason: wd.currentSeason,
          },
        });
        cups++;
      }
      console.log(`[${i}/${leagues.length}] ${league.countryName}: ${national.length} national cups`);
    } catch (e) {
      console.log(`[${i}/${leagues.length}] ${league.countryName}: ERROR ${(e as Error).message.slice(0, 120)}`);
    }
    await sleep(PACING_MS);
  }
  console.log(`seedCups done: ${cups} cup rows across ${leagues.length} countries`);
}

export interface CupSyncResult {
  cupId: number;
  cupName: string;
  seasonsStored: number;
  earliestSeason: number | null;
  latestChampion: string | null;
}

/** Harvest every season's winner of one cup. Stores the winner NAME; teamId is a later pass. */
export async function syncCupChampions(token: TokenPair, cupId: number): Promise<CupSyncResult> {
  const cup = await prisma.cup.findUnique({ where: { cupId } });
  if (!cup) throw new Error(`cup ${cupId} not seeded`);
  const start = cup.currentSeason ?? 100;

  const result: CupSyncResult = { cupId, cupName: cup.cupName, seasonsStored: 0, earliestSeason: null, latestChampion: null };

  for (let season = start; season >= 1; season--) {
    const existing = await prisma.cupChampion.findUnique({ where: { cupId_season: { cupId, season } } });
    if (existing) {
      result.earliestSeason = season;
      continue; // finals never change
    }

    let cm;
    try {
      cm = parseCupMatches(await fetchCupMatches(token, { cupId, season }));
    } catch {
      await sleep(PACING_MS);
      continue;
    }
    await sleep(PACING_MS);

    // round 0 / no matches → the cup didn't exist this season → stop walking further back.
    if (cm.round === 0 || cm.matches.length === 0) break;

    // The final is a single played match. More/fewer, or an unplayed result, means this season's
    // cup isn't finished (the current in-progress season) — skip it without breaking.
    if (cm.matches.length !== 1) continue;
    const f = cm.matches[0];
    if (!f || f.homeGoals === null || f.awayGoals === null) continue;

    // Winner is the higher score. HT cup finals are always decided, so a tie is not expected;
    // if one ever appears, skip rather than crown the wrong team.
    if (f.homeGoals === f.awayGoals) {
      console.log(`  ${cup.cupName} S${season}: level final ${f.homeGoals}-${f.awayGoals} (${f.matchId}) — skipped`);
      continue;
    }
    const homeWon = f.homeGoals > f.awayGoals;

    await prisma.cupChampion.create({
      data: {
        cupId,
        season,
        leagueId: cup.leagueId,
        countryName: cup.countryName,
        cupName: cup.cupName,
        isMain: cup.isMain,
        finalMatchId: f.matchId,
        championTeamName: homeWon ? f.homeTeamName : f.awayTeamName,
        runnerUpTeamName: homeWon ? f.awayTeamName : f.homeTeamName,
        homeGoals: f.homeGoals,
        awayGoals: f.awayGoals,
      },
    });

    result.seasonsStored++;
    result.earliestSeason = season;
    if (!result.latestChampion) result.latestChampion = homeWon ? f.homeTeamName : f.awayTeamName;
  }

  return result;
}

/** Backfill winners for every seeded cup (or a subset). Resume-safe; logs per cup. */
export async function syncAllCupChampions(token: TokenPair, opts: { onlyCupIds?: number[] } = {}): Promise<void> {
  const cups = await prisma.cup.findMany({
    where: opts.onlyCupIds ? { cupId: { in: opts.onlyCupIds } } : {},
    orderBy: [{ leagueId: 'asc' }, { cupLevel: 'asc' }, { cupLevelIndex: 'asc' }],
  });

  let i = 0;
  for (const cup of cups) {
    i++;
    try {
      const r = await syncCupChampions(token, cup.cupId);
      console.log(`[${i}/${cups.length}] ${cup.countryName} ${cup.cupName}: +${r.seasonsStored} (back to S${r.earliestSeason}), latest ${r.latestChampion ?? '—'}`);
    } catch (e) {
      console.log(`[${i}/${cups.length}] ${cup.cupName}: ERROR ${(e as Error).message.slice(0, 120)}`);
    }
  }
  console.log('cup backfill pass complete');
}

/**
 * Resolve the winning teamId for stored cup finals (winner is positional: home team in the
 * cupmatches final is the home team in matchdetails). Second pass so the winners land fast first.
 */
export async function enrichCupTeamIds(token: TokenPair, opts: { limit?: number } = {}): Promise<void> {
  const pending = await prisma.cupChampion.findMany({
    where: { championTeamId: null },
    orderBy: [{ season: 'desc' }],
    take: opts.limit,
  });
  console.log(`resolving teamIds for ${pending.length} cup finals`);

  let i = 0;
  for (const c of pending) {
    i++;
    try {
      const md = parseMatchDetails(await fetchMatchDetails(token, c.finalMatchId));
      const homeWon = c.homeGoals > c.awayGoals;
      const teamId = homeWon ? md.homeTeamId : md.awayTeamId;
      const teamName = homeWon ? md.homeTeamName : md.awayTeamName;
      await prisma.cupChampion.update({
        where: { cupId_season: { cupId: c.cupId, season: c.season } },
        data: { championTeamId: teamId, championTeamName: teamName },
      });
      if (i % 200 === 0) console.log(`  [${i}/${pending.length}] ${c.cupName} S${c.season} -> ${teamName} (${teamId})`);
    } catch (e) {
      console.log(`  ${c.cupName} S${c.season} (${c.finalMatchId}): ERROR ${(e as Error).message.slice(0, 100)}`);
    }
    await sleep(PACING_MS);
  }
  console.log('enrichCupTeamIds done');
}
