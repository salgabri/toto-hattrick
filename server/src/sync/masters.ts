import { prisma } from '../db/client.js';
import type { TokenPair } from '../chpp/auth.js';
import { syncCupChampions, enrichCupTeamIds } from './cups.js';
import { enrichRecentCupManagers, UNKNOWN } from './enrichManagers.js';

/**
 * The Hattrick Masters — the global champions-of-champions cup ("the world title for clubs"),
 * contested each season since global season 28 by every country's league + cup champions. Unlike
 * national cups it belongs to no country, so it never appears in any worlddetails; it is a single
 * cup with a fixed global id, reachable by cupmatches(183, season) exactly like a national final.
 *
 * We model it as one Cup row carrying that id and a sentinel leagueId (it maps to no NationalLeague),
 * so the whole existing cup pipeline applies: syncCupChampions reconstructs each edition's winner,
 * enrichCupTeamIds resolves the team, and current-owner attribution fills the manager. The bake and
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

export interface MastersSyncResult { seasonsStored: number; earliestSeason: number | null; latestChampion: string | null; }

/**
 * Reconstruct + attribute every Hattrick Masters edition. Cheap (one cup, ~one call per season plus
 * a teamdetails per winner). Attribution is by CURRENT owner across ALL seasons — the same
 * approximation the league leaderboard accepts; for the Masters the winners are elite, still-active
 * clubs, so it resolves well. Resume-safe: stored finals are skipped, so re-runs only add new ones.
 *
 * Self-healing (why we keep no hand-maintained list of Masters owners): a club survives its own
 * renames, so resolving the winning club's CURRENT owner still lands on the manager who won it. What
 * it does NOT survive is the manager moving on: an account can hold several clubs, or drop the
 * winning one and start again elsewhere, in which case "their club today" is a different club in a
 * different country — "Orda Balorda Cuba" won Masters S86 and three Cuban cups while that account's
 * only club today is Italian. Attribution can live with that (it's the same manager either way);
 * anything that needs the CLUB, not the manager, cannot — see sync/intlTeamCountries.ts, which
 * prefers the club's own domestic record for exactly this reason. An edition shows an unresolved
 * winner ("—") only because a PAST attribution attempt hit a team that
 * was momentarily unreadable (rate-limited, or briefly bot/abandoned) and got pinned to the UNKNOWN
 * sentinel, which the enrichment passes then skip forever. So before re-attributing we RE-OPEN those
 * sentinel rows (below): the same automatic teamId + current-owner passes then fill them in with no
 * manual owner list. A genuinely dead club simply returns to the sentinel next time.
 */
export async function syncMasters(token: TokenPair, opts: { currentSeason: number }): Promise<MastersSyncResult> {
  await seedMasters(opts.currentSeason);
  // Re-open editions stuck on the UNKNOWN sentinel so the passes below retry them (see the note above).
  const reopened = await prisma.cupChampion.updateMany({
    where: { cupId: MASTERS_CUP_ID, championUserId: UNKNOWN },
    data: { championUserId: null },
  });
  if (reopened.count) console.log(`re-opened ${reopened.count} previously-unresolved Masters edition(s) for another attribution attempt`);
  const r = await syncCupChampions(token, MASTERS_CUP_ID); // walks currentSeason → 1, stops before S28 (round 0)
  await enrichCupTeamIds(token, { cupIds: [MASTERS_CUP_ID] }); // resolve teamIds for the new Masters finals (only pending ones)
  // Attribute every Masters season via current owner — lookback wide enough to cover the whole
  // history. Scoped to the Masters cup so the wide window never spills onto national cups (their old
  // finals belong to the ownership-history scrape, not current-owner attribution).
  await enrichRecentCupManagers(token, { lookback: 1000, onlyCupIds: [MASTERS_CUP_ID] });
  return { seasonsStored: r.seasonsStored, earliestSeason: r.earliestSeason, latestChampion: r.latestChampion };
}
