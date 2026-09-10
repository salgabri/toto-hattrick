import { prisma } from '../db/client.js';
import type { TokenPair } from '../chpp/auth.js';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { enrichUserNationalities } from './enrichManagers.js';

/**
 * "Seasonal Cups" — global, recurring ArenaHub tournaments that crown a champion each of their OWN
 * seasons (a per-tournament counter, not the national/global HT season). The first is the Supporter
 * Week Trophy (id 2108472): a ~24k-team Swiss-with-playoffs knockout run every Supporter Week, one
 * winner per season.
 *
 * Why the data is ingested, not synced live: CHPP exposes a tournament's metadata (tournamentdetails)
 * and its current bracket, but NOT the winners of past editions (tournamentleaguetables comes back
 * empty for a knockout, and there is no tournament-winner-history file). The roll of honour is read
 * once from the logged-in Club/ArenaHub/Tournaments/TournamentHistory pages — each season page names
 * the winning team AND its manager inline (…/Club/?TeamID=… + …/Club/Manager/?userId=…) — and applied
 * here. Because the manager is named on the page we set championUserId directly; no teamdetails
 * current-owner resolution is needed (nor would it be right, these clubs live on).
 *
 * Modelled exactly like the Hattrick Masters (see sync/masters.ts): one Cup row per tournament with a
 * sentinel leagueId, its winners stored as CupChampion rows keyed by (cupId, tournament season). The
 * bake and frontend route these cupIds to their own "Seasonal Cups" category by id — never a national
 * cup. Add more seasonal tournaments by extending SEASONAL_CUP_IDS and ingesting their winners.
 *
 * "Heroes of YYYY Trophy" (the "Generation" trophies) are a SEPARATE perpetual tournament launched
 * every real-world year since 2004 — each one keeps recurring on its own season counter forever
 * (e.g. "Heroes of 2013 Trophy" was at S26+ while "Heroes of 2023 Trophy" had only reached S12), so
 * unlike Supporter Week Trophy this is 23 distinct cupIds, not one. Same ingestion story: no CHPP
 * history, read once from TournamentHistory.aspx?tournamentId=X&season=N per cohort/season — the
 * winner sits in a `.tournamentBoxBody p` block (team link + "Managed by" manager link).
 */
export const SUPPORTER_WEEK_CUP_ID = 2108472;
/** tournamentId of each "Heroes of YYYY Trophy" cohort, keyed by its launch year. */
export const GENERATION_TROPHY_IDS: Readonly<Record<number, number>> = {
  2004: 3116034, 2005: 3116057, 2006: 3116058, 2007: 3116059, 2008: 3116060,
  2009: 3116061, 2010: 3116062, 2011: 3116063, 2012: 3116064, 2013: 3116065,
  2014: 3116067, 2015: 3116068, 2016: 3116070, 2017: 3116071, 2018: 3195190,
  2019: 3427550, 2020: 3704867, 2021: 4945473, 2022: 5255320, 2023: 5555820,
  2024: 5873608, 2025: 6320224, 2026: 6758706,
};
export const SEASONAL_CUP_IDS: ReadonlySet<number> = new Set([
  SUPPORTER_WEEK_CUP_ID,
  ...Object.values(GENERATION_TROPHY_IDS),
]);
export const isSeasonalCup = (cupId: number): boolean => SEASONAL_CUP_IDS.has(cupId);

const SEASONAL_LEAGUE_SENTINEL = 0; // no real NationalLeague; keeps it out of per-country groupings

export interface SeasonalWinner {
  /** The tournament's own season counter (1..N), NOT the HT national/global season. */
  season: number;
  /** Null when the retained historical source does not identify the numeric club/manager.
   * Names and country evidence do not authorize guessing these IDs. */
  teamId: number | null;
  team: string;
  userId: number | null;
  manager: string | null;
  /** Optional direct historical facts; source URLs/evidence are retained in the ingestion file. */
  teamLeagueId?: number | null;
  runnerUp?: string;
  sourceURLs?: string[];
  evidence?: string;
}

const WinnerSchema = z.object({
  season: z.number().int().positive(), teamId: z.number().int().positive().nullable(), team: z.string().trim().min(1),
  userId: z.number().int().positive().nullable(), manager: z.string().nullable(),
  teamLeagueId: z.number().int().positive().nullish(), runnerUp: z.string().min(1).optional(),
  sourceURLs: z.array(z.string().url().refine(value => {
    const url = new URL(value); return url.protocol === 'https:' && /(^|\.)hattrick\.org$/i.test(url.hostname);
  })).optional(), evidence: z.string().min(20).optional(),
}).refine(w => !(w.teamLeagueId || w.runnerUp) || Boolean(w.sourceURLs?.length && w.evidence), 'Supplemental historical facts require retained source URLs and evidence');
const clean = (name: string) => name.normalize('NFC').replace(/\s+/g, ' ').trim();

export interface SeasonalIngestResult { seasons: number; latestSeason: number; latestChampion: string | null }

/** Upsert the single Cup row for a seasonal tournament. `currentSeason` = its latest edition. */
export async function seedSeasonalCup(cupId: number, name: string, currentSeason: number): Promise<void> {
  await seedSeasonalCupIn(prisma, cupId, name, currentSeason);
}
async function seedSeasonalCupIn(db: Pick<Prisma.TransactionClient, 'cup'>, cupId: number, name: string, currentSeason: number): Promise<void> {
  const existing = await db.cup.findUnique({ where: { cupId }, select: { currentSeason: true } });
  await db.cup.upsert({
    where: { cupId },
    update: { currentSeason: Math.max(currentSeason, existing?.currentSeason ?? 0), cupName: name, countryName: name },
    create: {
      cupId,
      leagueId: SEASONAL_LEAGUE_SENTINEL,
      countryName: name,
      cupName: name,
      cupLevel: 1,
      cupLevelIndex: 1,
      isMain: false, // routed to its own category by cupId, not by isMain
      currentSeason,
    },
  });
}

/**
 * Ingest a seasonal tournament's roll of honour. Sets championUserId/Name straight from the scrape,
 * then resolves nationality for any new managers so they don't bake as "Unknown". Idempotent:
 * re-running preserves stronger stored identities and rejects conflicting winners. Re-bake
 * afterwards to refresh the static JSON.
 *
 * A winner with userId/teamId null (the "(A former user)" case — see SeasonalWinner) is still
 * stored, by team name only, so the edition isn't silently dropped from the roll of honour; it just
 * has no attributable manager, the same way an unattributed national-cup final does.
 */
export async function ingestSeasonalWinners(
  token: TokenPair,
  opts: { cupId: number; name: string; winners: SeasonalWinner[] },
): Promise<SeasonalIngestResult> {
  const valid = z.array(WinnerSchema).parse(opts.winners);
  if (new Set(valid.map(w => w.season)).size !== valid.length) throw new Error('Duplicate seasonal winner editions');
  const latestSeason = valid.reduce((m, w) => Math.max(m, w.season), 0);
  await prisma.$transaction(async tx => {
    await seedSeasonalCupIn(tx, opts.cupId, opts.name, latestSeason);
    for (const w of valid) {
      const existing = await tx.cupChampion.findUnique({ where: { cupId_season: { cupId: opts.cupId, season: w.season } } });
      if (existing) {
        const sameClub = existing.championTeamId && w.teamId ? existing.championTeamId === w.teamId : clean(existing.championTeamName) === clean(w.team);
        if (!sameClub || (existing.championUserId && w.userId && existing.championUserId !== w.userId) ||
            (existing.championLeagueId && w.teamLeagueId && existing.championLeagueId !== w.teamLeagueId) ||
            (existing.runnerUpTeamName && w.runnerUp && clean(existing.runnerUpTeamName) !== clean(w.runnerUp)))
          throw new Error(`Conflicting seasonal winner ${opts.cupId}/${w.season}; existing evidence was preserved`);
      }
      const winner = {
        championTeamId: w.teamId ?? existing?.championTeamId ?? null,
        championTeamName: w.team,
        championUserId: w.userId ?? existing?.championUserId ?? null,
        championUserName: w.userId ? w.manager ?? existing?.championUserName ?? null : existing?.championUserName ?? w.manager,
        championLeagueId: w.teamLeagueId ?? existing?.championLeagueId ?? null,
        runnerUpTeamName: w.runnerUp ?? existing?.runnerUpTeamName ?? '',
      };
      if (existing && Object.entries(winner).every(([field, value]) => existing[field as keyof typeof existing] === value)) continue;
      if (w.userId) {
        await tx.hattrickUser.upsert({
          where: { userId: w.userId },
          update: { loginName: w.manager ?? undefined },
          create: { userId: w.userId, loginName: w.manager ?? `user ${w.userId}` },
        });
      }
      await tx.cupChampion.upsert({
        where: { cupId_season: { cupId: opts.cupId, season: w.season } },
        update: winner,
        create: {
          cupId: opts.cupId,
          season: w.season,
          leagueId: SEASONAL_LEAGUE_SENTINEL,
          countryName: opts.name,
          cupName: opts.name,
          isMain: false,
          finalMatchId: 0, // no per-final match id from the scrape (placeholder, like reconstructed finals)
          ...winner,
          homeGoals: 0,
          awayGoals: 0,
        },
      });
    }
  });

  // Unknown numeric identities trigger no CHPP calls, including current-owner lookups.
  if (valid.some(w => w.userId)) await enrichUserNationalities(token);
  const latest = valid.find((w) => w.season === latestSeason) ?? null;
  return { seasons: valid.length, latestSeason, latestChampion: latest ? (latest.manager ?? latest.team) : null };
}
