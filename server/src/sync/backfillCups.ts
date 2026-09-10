import { prisma } from '../db/client.js';
import type { TokenPair } from '../chpp/auth.js';
import { fetchCupMatches, fetchMatchDetails } from '../chpp/endpoints.js';
import { parseCupMatches, parseMatchDetails } from '../schemas/index.js';
import { resolveTeamOwner, UNKNOWN, type TeamOwner } from './enrichManagers.js';

/**
 * Full cup materialisation, batched and resume-safe, for the reconstructed placeholder finals that
 * no other path can attribute (finalMatchId 0 / championTeamId null — see attributeByClub.ts
 * for why the current-owner and scrape paths can't touch them). For each still-unattributed final
 * it runs the three CHPP steps IN SEQUENCE, committing after each:
 *
 *   1. cupmatches(cupId, season) → the real final → finalMatchId + match facts   (upgrades the placeholder)
 *   2. matchdetails(finalMatchId) → the winner's championTeamId                  (positional)
 *   3. Optional unverified current-owner approximation (Phase C; explicit OWNERS=1 to enable).
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
 * used to accept. It is now OFF by default: materialized team IDs enable the ownership-history
 * recovery without crediting a recycled club's old trophies to its new manager.
 */

export interface BackfillCupsOpts {
  maxCalls?: number; // CHPP call budget for THIS run (default 1200)
  pacingMs?: number; // delay between calls (default 500)
  consecFailLimit?: number; // abort after this many failures in a row (default 8)
  attributeOwners?: boolean; // Explicit unverified Phase C current-owner approximation (default false)
  onlyLeagueIds?: number[];
  /** Current season plus this many predecessors, measured in each cup's own season numbering. */
  lookbackSeasons?: number;
  onlyMain?: boolean;
  /** Exact intersection with the other filters. An empty list deliberately selects no finals. */
  onlyFinals?: Array<{ cupId: number; season: number }>;
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
  storedMatchesReused: number;
  issues: Array<{ cupId: number; season: number | null; reason: string; matchId?: number }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sameName = (a: string, b: string) => a.normalize('NFC').replace(/\s+/g, ' ').trim() === b.normalize('NFC').replace(/\s+/g, ' ').trim();

export async function backfillCups(token: TokenPair, opts: BackfillCupsOpts = {}): Promise<BackfillCupsResult> {
  const maxCalls = opts.maxCalls ?? 1200;
  const pacingMs = opts.pacingMs ?? 500;
  const consecFailLimit = opts.consecFailLimit ?? 8;
  const attributeOwners = opts.attributeOwners === true;
  if (opts.lookbackSeasons !== undefined && (!Number.isSafeInteger(opts.lookbackSeasons) || opts.lookbackSeasons < 0)) throw new Error('lookbackSeasons must be a non-negative integer');
  if (opts.onlyFinals?.some((final) => !Number.isSafeInteger(final.cupId) || final.cupId <= 0 || !Number.isSafeInteger(final.season) || final.season <= 0)) throw new Error('onlyFinals requires positive cupId and season integers');

  const res: BackfillCupsResult = {
    calls: 0, materialized: 0, teamIdsResolved: 0, attributed: 0, unresolvedOwners: 0,
    aborted: false, budgetHit: false, remaining: 0,
    storedMatchesReused: 0, issues: [],
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
    where: {
      ...(opts.onlyLeagueIds ? { leagueId: { in: opts.onlyLeagueIds } } : {}),
      ...(opts.onlyMain ? { isMain: true } : {}),
      ...(opts.onlyFinals ? { cupId: { in: [...new Set(opts.onlyFinals.map((final) => final.cupId))] } } : {}),
    },
    orderBy: [{ isMain: 'desc' }, { leagueId: 'asc' }, { cupLevelIndex: 'asc' }],
    select: { cupId: true, currentSeason: true },
  });

  outer: for (const { cupId, currentSeason } of cups) {
    if (stop()) break;
    if (opts.lookbackSeasons !== undefined && currentSeason == null) {
      res.issues.push({ cupId, season: null, reason: 'Unknown current season; recent window cannot be verified' });
      continue;
    }
    const requestedSeasons = opts.onlyFinals?.filter((final) => final.cupId === cupId).map((final) => final.season);
    if (requestedSeasons?.length === 0) continue;
    // Every final of this cup that still lacks a manager — whatever step it's stuck at. Fetched once
    // per run, so a final that can't be resolved this run is retried next run, not looped on now.
    const finals = await prisma.cupChampion.findMany({
      where: {
        cupId, championUserId: null,
        ...(opts.lookbackSeasons !== undefined || requestedSeasons ? { season: {
          ...(opts.lookbackSeasons !== undefined ? { gte: Math.max(1, currentSeason! - opts.lookbackSeasons), lte: currentSeason! } : {}),
          ...(requestedSeasons ? { in: requestedSeasons } : {}),
        } } : {}),
      },
      orderBy: { season: 'desc' },
      select: { cupId: true, season: true, finalMatchId: true, championTeamId: true, championTeamName: true, homeGoals: true, awayGoals: true },
    });

    for (const c of finals) {
      if (stop()) break outer;
      let finalMatchId = c.finalMatchId;
      let teamId = c.championTeamId;
      let homeGoals = c.homeGoals;
      let awayGoals = c.awayGoals;
      const issue = (reason: string) => res.issues.push({ cupId: c.cupId, season: c.season, ...(finalMatchId > 0 ? { matchId: finalMatchId } : {}), reason });

      // Phase 1 — materialise the placeholder into a real final.
      if (finalMatchId === 0) {
        const cm = await call(async () => parseCupMatches(await fetchCupMatches(token, { cupId: c.cupId, season: c.season })));
        if (!cm) continue;
        if (cm.cupId !== c.cupId || cm.season !== c.season) { issue('Cup response identity does not match the requested cup and local season'); continue; }
        // Not a single decided final → this season's cup isn't a clean finished final; leave it.
        if (cm.round === 0 || cm.matches.length !== 1) continue;
        const f = cm.matches[0];
        if (!f || f.homeGoals === null || f.awayGoals === null || f.homeGoals === f.awayGoals) continue;
        const homeWon = f.homeGoals > f.awayGoals;
        const fetchedWinner = homeWon ? f.homeTeamName : f.awayTeamName;
        if (!sameName(fetchedWinner, c.championTeamName)) { issue(`Stored winner ${JSON.stringify(c.championTeamName)} differs from fetched winner ${JSON.stringify(fetchedWinner)}`); continue; }
        const changed = await prisma.cupChampion.updateMany({
          where: { cupId: c.cupId, season: c.season, finalMatchId: 0, championTeamId: c.championTeamId, championTeamName: c.championTeamName, championUserId: null },
          data: {
            finalMatchId: f.matchId,
            championTeamName: c.championTeamName,
            runnerUpTeamName: homeWon ? f.awayTeamName : f.homeTeamName,
            homeGoals: f.homeGoals,
            awayGoals: f.awayGoals,
          },
        });
        if (changed.count !== 1) { issue('Winner changed during materialization; no facts overwritten'); continue; }
        finalMatchId = f.matchId;
        homeGoals = f.homeGoals;
        awayGoals = f.awayGoals;
        res.materialized++;
      }

      // Phase 2 — resolve the winning team id from the final (winner is positional).
      if (teamId == null) {
        // A stored Match already contains identity/result facts, even if its optional ratings
        // enrichment was never run. Reuse it rather than downloading that match again.
        const stored = await prisma.match.findUnique({
          where: { matchId: finalMatchId },
          select: { matchId: true, homeTeamId: true, homeTeamName: true, awayTeamId: true, awayTeamName: true, homeGoals: true, awayGoals: true },
        });
        let md = stored;
        if (!md) {
          const storedDetail = await prisma.matchDetail.findUnique({ where: { matchId: finalMatchId }, select: { matchId: true } });
          if (storedDetail) { issue('Match details were already stored but usable identity/result facts are missing; no re-fetch'); continue; }
          if (stop()) break outer;
          md = await call(async () => parseMatchDetails(await fetchMatchDetails(token, finalMatchId))) ?? null;
        }
        if (!md) continue;
        if (md.matchId !== finalMatchId || md.homeGoals !== homeGoals || md.awayGoals !== awayGoals || homeGoals === awayGoals) {
          issue(`${stored ? 'Stored' : 'Fetched'} match identity/result disagrees with the cup final; no re-fetch or overwrite`);
          continue;
        }
        const homeWon = homeGoals > awayGoals; // goals reflect the real final (refreshed in Phase 1)
        const fetchedWinner = homeWon ? md.homeTeamName : md.awayTeamName;
        const resolvedTeamId = homeWon ? md.homeTeamId : md.awayTeamId;
        if (!sameName(fetchedWinner, c.championTeamName) || !Number.isSafeInteger(resolvedTeamId) || resolvedTeamId <= 0) {
          issue('Match winner identity differs from the stored cup winner'); continue;
        }
        const changed = await prisma.cupChampion.updateMany({
          where: { cupId: c.cupId, season: c.season, finalMatchId, championTeamId: null, championTeamName: c.championTeamName, championUserId: null },
          data: { championTeamId: resolvedTeamId },
        });
        if (changed.count !== 1) { issue('Winner changed during team identity materialization; no overwrite'); continue; }
        teamId = resolvedTeamId;
        if (stored) res.storedMatchesReused++;
        res.teamIdsResolved++;
      }

      // Phase 3 — optional current-owner approximation. By default, await historical evidence.
      if (attributeOwners && teamId != null) {
        if (stop()) break outer;
        let owner = ownerCache.get(teamId);
        if (owner === undefined) {
          owner = await call(() => resolveTeamOwner(token, teamId!));
          // A failed lookup is retryable, not evidence that the club has no owner.
          if (owner === undefined) continue;
          ownerCache.set(teamId, owner);
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
