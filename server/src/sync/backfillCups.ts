import { prisma } from '../db/client.js';
import type { TokenPair } from '../chpp/auth.js';
import { fetchCupMatches, fetchMatchDetails } from '../chpp/endpoints.js';
import { parseCupMatches, parseMatchDetails } from '../schemas/index.js';
import { resolveTeamOwner, UNKNOWN, type TeamOwner } from './enrichManagers.js';

/**
 * Full cup materialisation, batched and resume-safe, for the reconstructed placeholder finals that
 * no other path can attribute (finalMatchId 0 / championTeamId null — see attributeCupsByClub.ts
 * for why the current-owner and scrape paths can't touch them). For each still-unattributed final
 * it runs the three CHPP steps IN SEQUENCE, committing after each:
 *
 *   1. cupmatches(cupId, season) → the real final → finalMatchId + match facts   (upgrades the placeholder)
 *   2. matchdetails(finalMatchId) → the winner's championTeamId                  (positional)
 *   3. teamdetails(championTeamId) → the team's CURRENT owner → championUserId    (Phase C; OWNERS=0 to skip)
 *
 * Resume-safety is structural, not bolted on: every step is its own committed write, and each step
 * is GATED on the field it fills (finalMatchId 0? / championTeamId null? / championUserId null?), so
 * a half-finished final is picked up exactly where it stopped on the next run. Nothing is ever
 * re-fetched once stored. Quota/outage is survived two ways: a per-run `maxCalls` budget, and a
 * consecutive-failure detector that aborts the run cleanly (isolated failures — a deleted match or
 * team — reset on the next success and never abort). Whatever was committed before the stop stays.
 *
 * Cups are walked main-first so the most-visible cabinets fill first; within a cup, newest seasons
 * first. Phase C uses the team's CURRENT owner — the same approximation the league leaderboard
 * already accepts; for old finals where ownership changed, run with OWNERS=0 and use the ownership
 * scrape (now unblocked, since the finals finally have a championTeamId) for the authoritative owner.
 */

export interface BackfillCupsOpts {
  maxCalls?: number; // CHPP call budget for THIS run (default 1200)
  pacingMs?: number; // delay between calls (default 500)
  consecFailLimit?: number; // abort after this many failures in a row (default 8)
  attributeOwners?: boolean; // Phase C: resolve current owner (default true)
  onlyLeagueIds?: number[];
}

export interface BackfillCupsResult {
  calls: number;
  materialized: number; // finalMatchId filled (Phase 1)
  teamIdsResolved: number; // championTeamId filled (Phase 2)
  attributed: number; // championUserId set to a real owner (Phase 3)
  unresolvedOwners: number; // championUserId set to the UNKNOWN sentinel (deleted/bot)
  aborted: boolean; // stopped on a run of failures (quota/token/outage)
  budgetHit: boolean; // stopped because maxCalls was reached
  remaining: number; // cup finals still with championUserId null after this run
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function backfillCups(token: TokenPair, opts: BackfillCupsOpts = {}): Promise<BackfillCupsResult> {
  const maxCalls = opts.maxCalls ?? 1200;
  const pacingMs = opts.pacingMs ?? 500;
  const consecFailLimit = opts.consecFailLimit ?? 8;
  const attributeOwners = opts.attributeOwners ?? true;

  const res: BackfillCupsResult = {
    calls: 0, materialized: 0, teamIdsResolved: 0, attributed: 0, unresolvedOwners: 0,
    aborted: false, budgetHit: false, remaining: 0,
  };
  let consec = 0;
  const ownerCache = new Map<number, TeamOwner | null>(); // teamdetails is dear; resolve each team once

  /**
   * One budgeted, quota-aware CHPP call. A failure gets a couple of backoff retries first, so a
   * transient blip (e.g. the network not being ready right after the machine wakes from sleep)
   * recovers instead of counting toward the abort. Only when every retry fails does it count as a
   * consecutive failure — a sustained outage/quota wall still aborts, the retries just fail too.
   * Returns undefined on final failure (caller skips the final). Each attempt spends budget.
   */
  const RETRIES = 2;
  const call = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    for (let attempt = 0; ; attempt++) {
      res.calls++;
      try {
        const out = await fn();
        consec = 0;
        await sleep(pacingMs);
        return out;
      } catch {
        if (attempt < RETRIES && res.calls < maxCalls) {
          await sleep(pacingMs * (attempt + 2)); // linear backoff before retrying
          continue;
        }
        if (++consec >= consecFailLimit) res.aborted = true;
        await sleep(pacingMs);
        return undefined;
      }
    }
  };
  const stop = () => res.aborted || res.calls >= maxCalls;

  const cups = await prisma.cup.findMany({
    where: opts.onlyLeagueIds ? { leagueId: { in: opts.onlyLeagueIds } } : {},
    orderBy: [{ isMain: 'desc' }, { leagueId: 'asc' }, { cupLevelIndex: 'asc' }],
    select: { cupId: true },
  });

  outer: for (const { cupId } of cups) {
    if (stop()) break;
    // Every final of this cup that still lacks a manager — whatever step it's stuck at. Fetched once
    // per run, so a final that can't be resolved this run is retried next run, not looped on now.
    const finals = await prisma.cupChampion.findMany({
      where: { cupId, championUserId: null },
      orderBy: { season: 'desc' },
      select: { cupId: true, season: true, finalMatchId: true, championTeamId: true, homeGoals: true, awayGoals: true },
    });

    for (const c of finals) {
      if (stop()) break outer;
      let finalMatchId = c.finalMatchId;
      let teamId = c.championTeamId;
      let homeGoals = c.homeGoals;
      let awayGoals = c.awayGoals;

      // Phase 1 — materialise the placeholder into a real final.
      if (finalMatchId === 0) {
        const cm = await call(async () => parseCupMatches(await fetchCupMatches(token, { cupId: c.cupId, season: c.season })));
        if (!cm) continue;
        // Not a single decided final → this season's cup isn't a clean finished final; leave it.
        if (cm.round === 0 || cm.matches.length !== 1) continue;
        const f = cm.matches[0];
        if (!f || f.homeGoals === null || f.awayGoals === null || f.homeGoals === f.awayGoals) continue;
        const homeWon = f.homeGoals > f.awayGoals;
        await prisma.cupChampion.update({
          where: { cupId_season: { cupId: c.cupId, season: c.season } },
          data: {
            finalMatchId: f.matchId,
            championTeamName: homeWon ? f.homeTeamName : f.awayTeamName,
            runnerUpTeamName: homeWon ? f.awayTeamName : f.homeTeamName,
            homeGoals: f.homeGoals,
            awayGoals: f.awayGoals,
          },
        });
        finalMatchId = f.matchId;
        homeGoals = f.homeGoals;
        awayGoals = f.awayGoals;
        res.materialized++;
      }

      // Phase 2 — resolve the winning team id from the final (winner is positional).
      if (teamId == null) {
        if (stop()) break outer;
        const md = await call(async () => parseMatchDetails(await fetchMatchDetails(token, finalMatchId)));
        if (!md) continue;
        const homeWon = homeGoals > awayGoals; // goals reflect the real final (refreshed in Phase 1)
        teamId = homeWon ? md.homeTeamId : md.awayTeamId;
        await prisma.cupChampion.update({
          where: { cupId_season: { cupId: c.cupId, season: c.season } },
          data: { championTeamId: teamId, championTeamName: homeWon ? md.homeTeamName : md.awayTeamName },
        });
        res.teamIdsResolved++;
      }

      // Phase 3 — attribute the current owner (cached per team). OWNERS=0 leaves this for the scrape.
      if (attributeOwners && teamId != null) {
        if (stop()) break outer;
        let owner = ownerCache.get(teamId);
        if (owner === undefined) {
          owner = await call(() => resolveTeamOwner(token, teamId!)) ?? null;
          // Only cache a definitive result; a failure from an aborting run must not poison the cache.
          if (!res.aborted) ownerCache.set(teamId, owner);
          else continue;
        }
        if (owner) {
          await prisma.hattrickUser.upsert({ where: { userId: owner.userId }, update: { loginName: owner.loginName, isBot: owner.isBot }, create: { userId: owner.userId, loginName: owner.loginName, isBot: owner.isBot } });
          await prisma.cupChampion.update({ where: { cupId_season: { cupId: c.cupId, season: c.season } }, data: { championUserId: owner.userId, championUserName: owner.loginName } });
          res.attributed++;
        } else {
          await prisma.cupChampion.update({ where: { cupId_season: { cupId: c.cupId, season: c.season } }, data: { championUserId: UNKNOWN } });
          res.unresolvedOwners++;
        }
      }
    }
  }

  res.budgetHit = res.calls >= maxCalls && !res.aborted;
  res.remaining = await prisma.cupChampion.count({ where: { championUserId: null } });
  return res;
}
