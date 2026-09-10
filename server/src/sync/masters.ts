import { prisma } from '../db/client.js';
import type { TokenPair } from '../chpp/auth.js';
import { syncCupChampions, enrichCupTeamIds, type CupSyncResult } from './cups.js';
import { enrichRecentCupManagers } from './enrichManagers.js';

/**
 * The Hattrick Masters — the global champions-of-champions cup ("the world title for clubs"),
 * contested each season since global season 28 by every country's league + cup champions. Unlike
 * national cups it belongs to no country, so it never appears in any worlddetails; it is a single
 * cup with a fixed global id, reachable by cupmatches(183, season) exactly like a national final.
 *
 * We model it as one Cup row carrying that id and a sentinel leagueId (it maps to no NationalLeague),
 * so the whole existing cup pipeline applies: syncCupChampions reconstructs each edition's winner,
 * enrichCupTeamIds resolves the team, and historical evidence identifies the manager. The bake and
 * frontend key off MASTERS_CUP_ID to present it as its own category rather than a national cup.
 */
export const MASTERS_CUP_ID = 183;
const MASTERS_LEAGUE_SENTINEL = 0; // no real NationalLeague; keeps it out of per-country groupings
const MASTERS_NAME = 'Hattrick Masters';

/** Upsert the single Masters cup row. `currentSeason` should be the live global season. */
export async function seedMasters(currentSeason: number): Promise<void> {
  await prisma.cup.upsert({
    where: { cupId: MASTERS_CUP_ID },
    update: { currentSeason, cupName: MASTERS_NAME },
    create: {
      cupId: MASTERS_CUP_ID,
      leagueId: MASTERS_LEAGUE_SENTINEL,
      countryName: MASTERS_NAME,
      cupName: MASTERS_NAME,
      cupLevel: 1,
      cupLevelIndex: 1,
      isMain: false, // routed to its own category by cupId, not by isMain
      currentSeason,
    },
  });
}

export interface MastersSyncResult {
  seasonsStored: number;
  earliestSeason: number | null;
  latestChampion: string | null;
  issues: CupSyncResult['issues'];
}

/**
 * Reconstruct every Hattrick Masters edition and resolve its winning team. Stored finals are
 * skipped, so re-runs only add missing facts. The historical manager is recovered separately with
 * historicalWinners.ts: a current club owner does not prove who won an earlier Masters edition.
 * That recovery accepts both null and UNKNOWN(0), so sync no longer reopens sentinels or assigns
 * all old titles to whoever owns a recycled club today. The former approximation is retained only
 * behind the explicit allowUnverifiedCurrentOwner option.
 */
export async function syncMasters(token: TokenPair, opts: { currentSeason: number; allowUnverifiedCurrentOwner?: boolean }): Promise<MastersSyncResult> {
  await seedMasters(opts.currentSeason);
  const r = await syncCupChampions(token, MASTERS_CUP_ID); // walks currentSeason → 1, stops before S28 (round 0)
  for (const issue of r.issues) {
    console.warn(`  ${MASTERS_NAME} (cup ${MASTERS_CUP_ID}) S${issue.season}${issue.matchId ? ` match ${issue.matchId}` : ''}: unresolved — ${issue.reason}`);
  }
  await enrichCupTeamIds(token, { cupIds: [MASTERS_CUP_ID] }); // resolve teamIds for the new Masters finals (only pending ones)
  if (opts.allowUnverifiedCurrentOwner === true) {
    await enrichRecentCupManagers(token, { lookback: 1000, onlyCupIds: [MASTERS_CUP_ID], allowUnverifiedCurrentOwner: true });
  }
  return { seasonsStored: r.seasonsStored, earliestSeason: r.earliestSeason, latestChampion: r.latestChampion, issues: r.issues };
}
