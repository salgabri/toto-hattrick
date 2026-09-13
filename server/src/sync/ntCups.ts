import { prisma } from '../db/client.js';
import type { TokenPair } from '../chpp/auth.js';
import type { CoachTenure } from './worldCup.js';
import { mergeNationalPodiumFacts, validNationalBronzeInput } from './nationalPodiumIngest.js';
import { validSuppliedNationalDates } from './nationalDates.js';

/**
 * Regional national-team cups — Africa / America / Asia and Oceania / Europe / Nations Cup.
 *
 * Same nature as the World Cup (a champion NATION, credited to whoever was coaching it) but a
 * different source: each is a perpetual tournament with one champion per SEASON. The retained
 * history originated on World/WorldCup/Cup.aspx; new seasons are now monitored through the
 * official `tournamentdetails` and `tournamentfixtures` XML files by officialTournaments.ts.
 * Reviewed browser captures remain useful for fields the XML does not expose, such as host and
 * historical coach identity.
 *
 * The World Cup's own cupId (5001315) and the Contender League (6244933) appear in the same
 * dropdown but are NOT in the registry: the World Cup keeps its History.aspx roll of honour in
 * WorldCupChampion (registering it here would double-count every senior title), and the Contender
 * League is out of scope.
 */
export interface NtCup {
  cupId: number;
  name: string;
  isYouth: boolean;
}

/**
 * The cups to scrape. Names are the registry's, not the page's — Cup.aspx ships its <h1> as the
 * placeholder "Loading...", so the scraped title is unreliable (see ingestNtCupSeasons).
 *
 * The U21 brackets are separate perpetual cups with their own ids, and their champions are the U21
 * TEAM entities (e.g. "U21 Sverige", teamId 3041) — a different team from the senior side, with its
 * own coaching history. `isYouth` only matters as the fallback when a row carries no championTeamId.
 */
export const NT_CUPS: NtCup[] = [
  { cupId: 5001278, name: 'Africa Cup', isYouth: false },
  { cupId: 5001277, name: 'America Cup', isYouth: false },
  { cupId: 5001279, name: 'Asia and Oceania Cup', isYouth: false },
  { cupId: 5001273, name: 'Europe Cup', isYouth: false },
  { cupId: 5001319, name: 'Nations Cup', isYouth: false },
  { cupId: 4878492, name: 'U21 Africa Cup', isYouth: true },
  { cupId: 4878490, name: 'U21 America Cup', isYouth: true },
  { cupId: 4878493, name: 'U21 Asia and Oceania Cup', isYouth: true },
  { cupId: 4878483, name: 'U21 Europe Cup', isYouth: true },
  { cupId: 4892615, name: 'U21 Nations Cup', isYouth: true },
];

/** Ids that share the Cup.aspx dropdown but must never be ingested here — see the note above. */
export const WORLD_CUP_TOURNAMENT_ID = 5001315;
export const CONTENDER_LEAGUE_CUP_ID = 6244933;

export function isRegisteredNtCup(cupId: number): boolean {
  return NT_CUPS.some((c) => c.cupId === cupId);
}

/** One scraped season of one cup — the shape scrape/ntcups-scraper.js POSTs back. */
export interface NtCupSeason {
  cupId: number;
  season: number;
  cupName: string;
  host?: string | null;
  status?: string | null;
  startedDate?: string | null;
  finalDate?: string | null;
  champion?: string | null;
  championTeamId?: number | null;
  championLeagueId?: number | null;
  runnerUp?: string | null;
  /** Podium ids beyond the champion — present only from the medal-capable scrape onwards, so they
   *  are all optional and an older scrape still ingests cleanly. */
  runnerUpTeamId?: number | null;
  runnerUpLeagueId?: number | null;
  thirdFourth?: string[];
  /** Index-aligned with `thirdFourth` (0-2 joint-third nations). */
  thirdFourthTeamIds?: Array<number | null>;
  thirdFourthLeagueIds?: Array<number | null>;
}

export interface NtCupIngestResult { seasons: number; skipped: number; withChampion: number; conflicts: number }

/**
 * Ingest scraped seasons. Upsert per (cupId, season) — a season already stored is refreshed, not
 * duplicated, so a re-run after a partial scrape is safe. Rows for unregistered cups are skipped
 * rather than trusted: the scraper reads the cup id off the page, so a stray tab on the World Cup
 * or Contender League would otherwise leak titles into this table.
 */
export async function ingestNtCupSeasons(rows: NtCupSeason[]): Promise<NtCupIngestResult> {
  const byId = new Map(NT_CUPS.map((c) => [c.cupId, c]));
  let seasons = 0;
  let skipped = 0;
  let withChampion = 0;
  let conflicts = 0;

  for (const r of rows) {
    const cup = byId.get(r.cupId);
    if (!cup || !Number.isSafeInteger(r.season) || r.season <= 0) {
      skipped++;
      continue;
    }
    if ((r.thirdFourth?.length ?? 0) > 2 || r.thirdFourth?.some((n) => !n.trim()) || !validNationalBronzeInput(r.thirdFourth, r.thirdFourthTeamIds, r.thirdFourthLeagueIds) || !validSuppliedNationalDates(r.startedDate, r.finalDate)) {
      conflicts++;
      continue;
    }
    if ([r.championTeamId, r.championLeagueId, r.runnerUpTeamId, r.runnerUpLeagueId].some((id) => id !== null && id !== undefined && (!Number.isSafeInteger(id) || id <= 0))) {
      conflicts++;
      continue;
    }
    const data = {
      // The registry name wins over the scraped one: Cup.aspx ships its <h1> as the placeholder
      // "Loading..." and fills it in client-side, so a fetched copy of the page never carries the
      // real title. Scrapes that predate that discovery still ingest with correct names.
      cupName: cup.name,
      isYouth: cup.isYouth,
      host: r.host ?? '',
      status: r.status ?? null,
      startedDate: r.startedDate ?? null,
      finalDate: r.finalDate ?? null,
      champion: r.champion ?? null,
      championTeamId: r.championTeamId ?? null,
      championLeagueId: r.championLeagueId ?? null,
      runnerUp: r.runnerUp ?? null,
    };
    // Podium ids are only written when the scrape actually carried them, so re-ingesting a
    // pre-medal file refreshes the season without blanking ids a later scrape already stored.
    const ids = r.runnerUpTeamId !== undefined || r.thirdFourthTeamIds !== undefined
      ? {
          runnerUpTeamId: r.runnerUpTeamId ?? null,
          runnerUpLeagueId: r.runnerUpLeagueId ?? null,
          thirdFourthTeamIds: (r.thirdFourthTeamIds ?? []).map((n) => n ?? '').join(','),
          thirdFourthLeagueIds: (r.thirdFourthLeagueIds ?? []).map((n) => n ?? '').join(','),
        }
      : {};
    const thirdFourth = { thirdFourth: (r.thirdFourth ?? []).join(', ') };
    const accepted = await prisma.$transaction(async (tx) => {
      const where = { cupId_season: { cupId: r.cupId, season: r.season } };
      const facts = { ...data, ...thirdFourth, ...ids };
      const stored = await tx.nationalCupChampion.findUnique({ where });
      const merged = mergeNationalPodiumFacts(stored ?? {}, facts);
      if (merged.conflicts.length) return false;
      if (!stored) await tx.nationalCupChampion.create({ data: { cupId: r.cupId, season: r.season, ...facts } });
      else {
        if (Object.keys(merged.data).length) await tx.nationalCupChampion.update({ where, data: merged.data });
      }
      return true;
    });
    if (!accepted) { conflicts++; continue; }
    seasons++;
    if (r.champion) withChampion++;
  }
  return { seasons, skipped, withChampion, conflicts };
}

export interface NtCupAttributionResult { attributed: number; eligible: number; medals: number; medalSlots: number }

/** Flat legacy tenure rows cannot establish coverage or safely reconstruct index-aligned medals. */
export async function attributeNtCupCoaches(_token: TokenPair, _tenures: CoachTenure[]): Promise<NtCupAttributionResult> {
  throw new Error('Unverified flat coach-tenure attribution is disabled. Use recover:national-coaches with complete captured histories or verified trophy evidence; existing regional-cup attributions are preserved.');
}
