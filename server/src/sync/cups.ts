import { prisma } from '../db/client.js';
import type { TokenPair } from '../chpp/auth.js';
import { fetchWorldDetails, fetchCupMatches } from '../chpp/endpoints.js';
import { parseWorldDetailsCups, parseCupMatches } from '../schemas/index.js';
import { loadCupFinalMatch, loadPreviousCupRound, readCachedCupFinalMatch, resolveCupFinal, resolveStoredCupFinal, type VerifiedCupFinalWinner } from './cupFinals.js';

/**
 * Cup honours, reconstructed entirely from CHPP (no website scraping).
 *
 *   seedCups()          worlddetails(leagueId) → the five NATIONAL-level cups per country
 *                       (CupLeagueLevel 0): one MAIN (CupLevel 1) + four SECONDARY (CupLevel 2/3).
 *   syncCupChampions()  cupmatches(cupId, season) with no round → the LAST played round; for a
 *                       finished cup that is the final's last leg. Earlier cups had two legs,
 *                       so inspect the preceding round and use the aggregate, not the last score.
 *                       Walk seasons back until the cup predates its own existence (round 0).
 *   enrichCupTeamIds()  retained match facts → the archived winner's teamId by exact name.
 *                       It never derives a cup winner from a second-leg score or re-fetches it.
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
  issues: Array<{ season: number; matchId?: number; reason: string }>;
}

/** Harvest winners with format/aggregate validation and numeric club identity before insertion. */
export async function syncCupChampions(
  token: TokenPair,
  cupId: number,
  opts: { minSeason?: number; seasons?: readonly number[]; pacingMs?: number; throwOnFetchError?: boolean; verifiedWinners?: readonly VerifiedCupFinalWinner[] } = {},
): Promise<CupSyncResult> {
  const cup = await prisma.cup.findUnique({ where: { cupId } });
  if (!cup) throw new Error(`cup ${cupId} not seeded`);
  const start = cup.currentSeason ?? 100;
  // Floor for the backward walk (see syncNationalChampions): the "latest" refresh passes a recent
  // floor so it fetches only new finals instead of re-walking every season to S1.
  const floor = Math.max(1, opts.minSeason ?? 1);

  const pacingMs = opts.pacingMs ?? PACING_MS;
  const result: CupSyncResult = { cupId, cupName: cup.cupName, seasonsStored: 0, earliestSeason: null, latestChampion: null, issues: [] };
  // ArenaHub seasonal tournaments use TournamentHistory ingestion (seasonal.ts), not cupmatches.
  if (cup.leagueId === 0 && cupId !== 183) {
    result.issues.push({ season: start, reason: 'Seasonal tournaments require seasonal history ingestion; cupmatches is not their source' });
    return result;
  }

  const seasons = opts.seasons ? [...new Set(opts.seasons)].sort((a, b) => b - a)
    : Array.from({ length: Math.max(0, start - floor + 1) }, (_, i) => start - i);
  if (seasons.some(season => !Number.isSafeInteger(season) || season < 1)) throw new Error('Invalid cup season selection');
  for (const season of seasons) {
    const existing = await prisma.cupChampion.findUnique({ where: { cupId_season: { cupId, season } } });
    // Skip only finals we already have USABLE data for. A real fetched final (finalMatchId > 0)
    // never changes, and a final that already has a manager needs nothing more. What must NOT be
    // skipped is a reconstructed placeholder that is still unattributed (finalMatchId 0 AND
    // championUserId null — see scripts/reconstruct-from-bake.ts): those fall through so we fetch
    // the real final, which unlocks historical club evidence. Current ownership is never proof of
    // who won an old trophy. Resume-safe: once upgraded, later runs skip it.
    if (existing && (existing.finalMatchId > 0 || existing.championUserId !== null)) {
      result.earliestSeason = season;
      continue;
    }

    let cm;
    try {
      cm = parseCupMatches(await fetchCupMatches(token, { cupId, season }));
    } catch (error) {
      if (opts.throwOnFetchError) throw error;
      result.issues.push({ season, reason: 'Cup round could not be fetched or validated' });
      await sleep(pacingMs);
      continue;
    }
    await sleep(pacingMs);
    if (cm.cupId !== cupId || cm.season !== season) {
      result.issues.push({ season, reason: 'Cup response differs from the requested competition/season' });
      continue;
    }

    // An empty / round-0 bracket normally means the cup didn't exist this season → stop walking
    // further back. EXCEPTION: at the current (in-progress) season it just means the cup hasn't
    // started yet — skip it and keep walking down, so older in-window placeholders still get
    // materialized rather than the whole walk aborting before it reaches them.
    if (cm.round === 0 || cm.matches.length === 0) {
      if (opts.seasons || season === start) continue;
      break;
    }

    // The last round is one played match, possibly the second leg of an older final. More/fewer,
    // or an unplayed result, means this season's final is not available yet.
    if (cm.matches.length !== 1) continue;
    const f = cm.matches[0];
    if (!f || f.homeGoals === null || f.awayGoals === null) continue;

    const summary = { ...f, cupId, season, round: cm.round, homeGoals: f.homeGoals, awayGoals: f.awayGoals };
    const prior = await loadPreviousCupRound(token, summary);
    if (prior.fetched) await sleep(pacingMs);
    if (prior.pending) continue;
    // Capture details while the final is NEW. Subsequent sync/enrichment reuses that capture and
    // cannot refetch an archived final. Numeric team IDs and match context are validated together.
    const detail = await loadCupFinalMatch(token, f.matchId);
    if (detail.fetched) await sleep(pacingMs);
    if (detail.pending) continue;
    const resolution = detail.match ? resolveCupFinal(summary, detail.match, opts.verifiedWinners, prior.previous)
      : detail.storedMatch ? resolveStoredCupFinal(summary, detail.storedMatch, prior.previous)
      : { reason: detail.reason ?? 'No retained final evidence', winner: undefined };
    if (!resolution.winner) { result.issues.push({ season, matchId: f.matchId, reason: resolution.reason }); continue; }
    const assigned = await prisma.cupChampion.findFirst({ where: { finalMatchId: f.matchId, NOT: { cupId, season } }, select: { cupId: true, season: true } });
    if (assigned) { result.issues.push({ season, matchId: f.matchId, reason: `Final match is already assigned to cup ${assigned.cupId} season ${assigned.season}; no duplicate assignment` }); continue; }
    const winner = resolution.winner;
    const facts = { finalMatchId: f.matchId, championTeamId: winner.teamId, championTeamName: winner.teamName,
      runnerUpTeamName: winner.runnerUpTeamName, homeGoals: winner.homeGoals, awayGoals: winner.awayGoals, penalties: winner.penalties };
    if (existing) {
      const clean = (name: string) => name.normalize('NFC').replace(/\s+/g, ' ').trim();
      const sameClub = existing.championTeamId && existing.championTeamId > 0
        ? existing.championTeamId === winner.teamId
        : clean(existing.championTeamName) === clean(winner.teamName);
      const updated = await prisma.cupChampion.updateMany({
        where: { cupId, season, finalMatchId: 0, championUserId: null, championUserName: existing.championUserName, championLeagueId: existing.championLeagueId, championTeamName: existing.championTeamName, championTeamId: existing.championTeamId },
        data: { ...facts, ...(!sameClub ? { championUserName: null, championLeagueId: null } : {}) },
      });
      if (updated.count !== 1) { result.issues.push({ season, matchId: f.matchId, reason: 'Archived winner changed during recovery; no overwrite' }); continue; }
    } else {
      // Create-only is intentional: a concurrent writer must never have its winner overwritten.
      await prisma.cupChampion.create({ data: { cupId, season, leagueId: cup.leagueId, countryName: cup.countryName, cupName: cup.cupName, isMain: cup.isMain, ...facts } });
    }

    result.seasonsStored++;
    result.earliestSeason = season;
    if (!result.latestChampion) result.latestChampion = winner.teamName;
  }

  return result;
}

/** Backfill winners for every seeded cup (or a subset). Resume-safe; logs per cup. */
export async function syncAllCupChampions(token: TokenPair, opts: { onlyCupIds?: number[] } = {}): Promise<void> {
  const cups = await prisma.cup.findMany({
    where: { ...(opts.onlyCupIds ? { cupId: { in: opts.onlyCupIds } } : {}), OR: [{ leagueId: { not: 0 } }, { cupId: 183 }] },
    orderBy: [{ leagueId: 'asc' }, { cupLevel: 'asc' }, { cupLevelIndex: 'asc' }],
  });

  let i = 0;
  for (const cup of cups) {
    i++;
    try {
      const r = await syncCupChampions(token, cup.cupId);
      console.log(`[${i}/${cups.length}] ${cup.countryName} ${cup.cupName}: +${r.seasonsStored} (back to S${r.earliestSeason}), latest ${r.latestChampion ?? '—'}`);
      for (const issue of r.issues) console.warn(`  ${cup.cupName} S${issue.season}${issue.matchId ? ` match ${issue.matchId}` : ''}: ${issue.reason}`);
    } catch (e) {
      console.log(`[${i}/${cups.length}] ${cup.cupName}: ERROR ${(e as Error).message.slice(0, 120)}`);
    }
  }
  console.log('cup backfill pass complete');
}

/**
 * Resolve missing numeric IDs from retained facts. The archived winning NAME selects the club;
 * the last-leg score does not. New finals already capture these facts in syncCupChampions.
 */
export async function enrichCupTeamIds(token: TokenPair, opts: { limit?: number; cupIds?: number[] } = {}): Promise<void> {
  const pending = await prisma.cupChampion.findMany({
    // finalMatchId > 0 skips reconstructed finals (placeholder id 0) — they have no real match to
    // resolve a teamId from. Genuinely new finals carry a real finalMatchId from cupmatches.
    // cupIds scopes the pass to specific cups (e.g. the Masters self-heal); default is every cup.
    where: { championTeamId: null, finalMatchId: { gt: 0 }, ...(opts.cupIds ? { cupId: { in: opts.cupIds } } : {}) },
    orderBy: [{ season: 'desc' }],
    take: opts.limit,
  });
  console.log(`resolving teamIds for ${pending.length} cup finals`);

  let i = 0;
  for (const c of pending) {
    i++;
    try {
      const cached = readCachedCupFinalMatch(c.finalMatchId);
      const md = cached.match ?? await prisma.match.findUnique({ where: { matchId: c.finalMatchId } });
      if (!md || md.matchId !== c.finalMatchId || md.homeGoals !== c.homeGoals || md.awayGoals !== c.awayGoals) continue;
      // An archived champion may have LOST the second leg. Its verified name selects the team;
      // comparing the leg score here used to silently reverse historical aggregate winners.
      const clean = (name: string) => name.normalize('NFC').replace(/\s+/g, ' ').trim();
      const homeWon = clean(c.championTeamName) === clean(md.homeTeamName);
      const awayWon = clean(c.championTeamName) === clean(md.awayTeamName);
      if (homeWon === awayWon) continue;
      const teamId = homeWon ? md.homeTeamId : md.awayTeamId;
      await prisma.cupChampion.updateMany({
        where: { cupId: c.cupId, season: c.season, finalMatchId: c.finalMatchId, championTeamId: null, championTeamName: c.championTeamName },
        data: { championTeamId: teamId },
      });
      if (i % 200 === 0) console.log(`  [${i}/${pending.length}] ${c.cupName} S${c.season} -> ${c.championTeamName} (${teamId})`);
    } catch (e) {
      console.log(`  ${c.cupName} S${c.season} (${c.finalMatchId}): ERROR ${(e as Error).message.slice(0, 100)}`);
    }
    await sleep(PACING_MS);
  }
  console.log('enrichCupTeamIds done');
}
