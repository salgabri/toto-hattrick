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
 * CHPP exposes a tournament's metadata and current bracket, but not past editions after the
 * tournament restarts. officialTournaments.ts therefore captures each new current final daily;
 * the retained roll of honour still supplies older editions and the manager identity printed on
 * TournamentHistory. Current ownership is never substituted for the manager at a past final.
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
  /** Exact official final facts. These are optional for retained legacy history, but when supplied
   * all three fields are validated and persisted in the same transaction as the winner. */
  finalMatchId?: number;
  homeGoals?: number;
  awayGoals?: number;
}

const WinnerSchema = z.object({
  season: z.number().int().positive(), teamId: z.number().int().positive().nullable(), team: z.string().trim().min(1),
  userId: z.number().int().positive().nullable(), manager: z.string().nullable(),
  teamLeagueId: z.number().int().positive().nullish(), runnerUp: z.string().min(1).optional(),
  sourceURLs: z.array(z.string().url().refine(value => {
    const url = new URL(value); return url.protocol === 'https:' && /(^|\.)hattrick\.org$/i.test(url.hostname);
  })).optional(), evidence: z.string().min(20).optional(),
  finalMatchId: z.number().int().positive().optional(),
  homeGoals: z.number().int().nonnegative().optional(),
  awayGoals: z.number().int().nonnegative().optional(),
}).refine(w => {
  const finalFields = [w.finalMatchId, w.homeGoals, w.awayGoals];
  return finalFields.every(value => value === undefined) || finalFields.every(value => value !== undefined);
}, 'Official seasonal final evidence requires match id and both scores')
  .refine(w => !(w.teamLeagueId || w.runnerUp || w.finalMatchId) || Boolean(w.sourceURLs?.length && w.evidence),
    'Supplemental historical facts require retained source URLs and evidence');
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
  opts: { cupId: number; name: string; winners: SeasonalWinner[]; enrichNationalities?: boolean },
): Promise<SeasonalIngestResult> {
  const valid = z.array(WinnerSchema).parse(opts.winners);
  if (new Set(valid.map(w => w.season)).size !== valid.length) throw new Error('Duplicate seasonal winner editions');
  const latestSeason = valid.reduce((m, w) => Math.max(m, w.season), 0);
  await prisma.$transaction(async tx => {
    await seedSeasonalCupIn(tx, opts.cupId, opts.name, latestSeason);
    for (const w of valid) {
      const existing = await tx.cupChampion.findUnique({ where: { cupId_season: { cupId: opts.cupId, season: w.season } } });
      if (w.finalMatchId) {
        const duplicate = await tx.cupChampion.findFirst({ where: { finalMatchId: w.finalMatchId,
          OR: [{ cupId: { not: opts.cupId } }, { season: { not: w.season } }] }, select: { cupId: true, season: true } });
        if (duplicate) throw new Error(`Official final conflicts with a different retained tournament result (${duplicate.cupId}/${duplicate.season})`);
      }
      if (existing) {
        const sameClub = existing.championTeamId && w.teamId ? existing.championTeamId === w.teamId : clean(existing.championTeamName) === clean(w.team);
        if (!sameClub || (existing.championUserId && w.userId && existing.championUserId !== w.userId) ||
            (existing.championLeagueId && w.teamLeagueId && existing.championLeagueId !== w.teamLeagueId) ||
            (existing.runnerUpTeamName && w.runnerUp && clean(existing.runnerUpTeamName) !== clean(w.runnerUp)) ||
            (existing.finalMatchId > 0 && w.finalMatchId && existing.finalMatchId !== w.finalMatchId) ||
            (existing.finalMatchId > 0 && existing.finalMatchId === w.finalMatchId &&
              (existing.homeGoals !== w.homeGoals || existing.awayGoals !== w.awayGoals)))
          throw new Error(`Conflicting seasonal winner ${opts.cupId}/${w.season}; existing evidence was preserved`);
      }
      const winner = {
        championTeamId: w.teamId ?? existing?.championTeamId ?? null,
        championTeamName: w.team,
        championUserId: w.userId ?? existing?.championUserId ?? null,
        championUserName: w.userId ? w.manager ?? existing?.championUserName ?? null : existing?.championUserName ?? w.manager,
        championLeagueId: w.teamLeagueId ?? existing?.championLeagueId ?? null,
        runnerUpTeamName: w.runnerUp ?? existing?.runnerUpTeamName ?? '',
        ...(w.finalMatchId ? { finalMatchId: w.finalMatchId, homeGoals: w.homeGoals!, awayGoals: w.awayGoals! } : {}),
      };
      if (existing && Object.entries(winner).every(([field, value]) => existing[field as keyof typeof existing] === value)) continue;
      if (w.userId) {
        await tx.hattrickUser.upsert({
          where: { userId: w.userId },
          update: { loginName: w.manager ?? undefined },
          create: { userId: w.userId, loginName: w.manager ?? `user ${w.userId}` },
        });
      }
      const retained = await tx.cupChampion.upsert({
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
      if (w.finalMatchId && (retained.finalMatchId !== w.finalMatchId || retained.homeGoals !== w.homeGoals || retained.awayGoals !== w.awayGoals))
        throw new Error(`Official seasonal final ${opts.cupId}/${w.season} was not retained exactly`);
    }
  });

  // Unknown numeric identities trigger no CHPP calls, including current-owner lookups.
  if (opts.enrichNationalities !== false && valid.some(w => w.userId)) await enrichUserNationalities(token);
  const latest = valid.find((w) => w.season === latestSeason) ?? null;
  return { seasons: valid.length, latestSeason, latestChampion: latest ? (latest.manager ?? latest.team) : null };
}
