import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { enrichUserNationalities } from './enrichManagers.js';
import type { TokenPair } from '../chpp/auth.js';
import type { CoachTenure } from './worldCup.js';

/**
 * Regional national-team cups — Africa / America / Asia and Oceania / Europe / Nations Cup.
 *
 * Same nature as the World Cup (a champion NATION, credited to whoever was coaching it) but a
 * different source: each is a perpetual tournament with one champion per SEASON, read from
 * World/WorldCup/Cup.aspx?cupId=X&season=N. No CHPP path exists for national-team competitions —
 * cupmatches returns nothing — so the pages are scraped from the user's logged-in browser
 * (scrape/ntcups-scraper.js, SCRAPE_PHASE=ntcups) and ingested here as JSON.
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
  thirdFourth?: string[];
}

export interface NtCupIngestResult { seasons: number; skipped: number; withChampion: number }

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

  for (const r of rows) {
    const cup = byId.get(r.cupId);
    if (!cup || !Number.isFinite(r.season)) {
      skipped++;
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
      thirdFourth: (r.thirdFourth ?? []).join(', '),
    };
    await prisma.nationalCupChampion.upsert({
      where: { cupId_season: { cupId: r.cupId, season: r.season } },
      update: data,
      create: { cupId: r.cupId, season: r.season, ...data },
    });
    seasons++;
    if (r.champion) withChampion++;
  }
  return { seasons, skipped, withChampion };
}

/** "DD-MM-YYYY[ HH:MM]" (Cup.aspx) or "DD.MM.YYYY" (NTFormerCoaches) → epoch ms. */
function parseDate(d: string): number {
  const [dd, mm, yyyy] = d.trim().split(' ')[0]!.split(/[.\-/]/).map(Number);
  return new Date(yyyy!, mm! - 1, dd).getTime();
}

export interface NtCupAttributionResult { attributed: number; eligible: number }

/**
 * Credit each finished season to the manager coaching the champion nation when the final was
 * played — the tenure (NTFormerCoaches.aspx, already scraped for the World Cup) that started most
 * recently on/before `finalDate`. Same rule and same tenure data as attributeWorldCupCoaches, so a
 * coach's World Cup and regional titles are attributed consistently.
 *
 * The champion's team id normally comes straight off the podium link; national-team-ids.json is
 * only the fallback for rows scraped before that was captured (and the only path for youth cups,
 * whose podium points at the U21 entity anyway).
 */
export async function attributeNtCupCoaches(token: TokenPair, tenures: CoachTenure[]): Promise<NtCupAttributionResult> {
  const byTeam = new Map<number, CoachTenure[]>();
  for (const t of tenures) {
    if (!t.date) continue; // sentinel row for a team with no parseable tenure data
    const arr = byTeam.get(t.teamId) ?? [];
    arr.push(t);
    byTeam.set(t.teamId, arr);
  }
  for (const arr of byTeam.values()) arr.sort((a, b) => parseDate(a.date) - parseDate(b.date));

  const teamIds: Record<string, { nationalTeamId: number; u20TeamId: number }> = JSON.parse(
    readFileSync(new URL('../data/national-team-ids.json', import.meta.url), 'utf8'),
  );

  const rows = await prisma.nationalCupChampion.findMany();
  let attributed = 0;
  let eligible = 0;
  for (const r of rows) {
    if (!r.champion || !r.finalDate) continue;
    eligible++;
    const byName = teamIds[r.champion];
    const teamId = r.championTeamId ?? (r.isYouth ? byName?.u20TeamId : byName?.nationalTeamId);
    if (!teamId) continue;
    const teamTenures = byTeam.get(teamId);
    if (!teamTenures) continue;

    const finalMs = parseDate(r.finalDate);
    let coach: CoachTenure | null = null;
    for (const tn of teamTenures) {
      if (parseDate(tn.date) <= finalMs) coach = tn;
      else break;
    }
    if (!coach) continue;

    if (coach.userId) {
      await prisma.hattrickUser.upsert({
        where: { userId: coach.userId },
        update: { loginName: coach.name },
        create: { userId: coach.userId, loginName: coach.name },
      });
      attributed++;
    }
    await prisma.nationalCupChampion.update({
      where: { cupId_season: { cupId: r.cupId, season: r.season } },
      data: { championUserId: coach.userId, championUserName: coach.userId ? coach.name : null },
    });
  }

  await enrichUserNationalities(token);
  return { attributed, eligible };
}
