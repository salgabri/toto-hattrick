import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { enrichUserNationalities } from './enrichManagers.js';
import type { TokenPair } from '../chpp/auth.js';

/**
 * World Cup (senior + youth) — a champion NATION per edition, not a manager/club, so it lives
 * outside the CupChampion model entirely. No CHPP path exists: cupmatches(137, season) returns
 * CupRound 0 for every season tried, same dead end as a club cup that was never played — Hattrick
 * simply doesn't index national-team competitions in that table. The full roll of honour is a
 * single page (World/WorldCup/History.aspx), scraped once into the committed seed
 * worldcup-history.json and ingested here — no OAuth/CHPP call needed for this one, it's a pure
 * static seed. The youth bracket was "U20" through edition 31 and "U21" from edition 32 on.
 */
export interface WorldCupEdition {
  edition: number;
  ageGroup?: string;
  host: string;
  finished: string | null;
  champion: string | null;
  runnerUp: string | null;
  thirdFourth: string[];
}

export interface WorldCupIngestResult { senior: number; youth: number }

export async function ingestWorldCupHistory(data: { senior: WorldCupEdition[]; youth: WorldCupEdition[] }): Promise<WorldCupIngestResult> {
  for (const e of data.senior) {
    await prisma.worldCupChampion.upsert({
      where: { isYouth_edition: { isYouth: false, edition: e.edition } },
      update: { host: e.host, finishedDate: e.finished, champion: e.champion, runnerUp: e.runnerUp, thirdFourth: e.thirdFourth.join(', ') },
      create: { isYouth: false, edition: e.edition, host: e.host, finishedDate: e.finished, champion: e.champion, runnerUp: e.runnerUp, thirdFourth: e.thirdFourth.join(', ') },
    });
  }
  for (const e of data.youth) {
    await prisma.worldCupChampion.upsert({
      where: { isYouth_edition: { isYouth: true, edition: e.edition } },
      update: { ageGroup: e.ageGroup, host: e.host, finishedDate: e.finished, champion: e.champion, runnerUp: e.runnerUp, thirdFourth: e.thirdFourth.join(', ') },
      create: { isYouth: true, edition: e.edition, ageGroup: e.ageGroup, host: e.host, finishedDate: e.finished, champion: e.champion, runnerUp: e.runnerUp, thirdFourth: e.thirdFourth.join(', ') },
    });
  }
  return { senior: data.senior.length, youth: data.youth.length };
}

export interface CoachTenure {
  teamId: number;
  date: string; // "DD.MM.YYYY", the date this coach TOOK OVER
  userId: number; // 0 = "Retired user" (UNKNOWN sentinel, same convention as everywhere else)
  name: string;
}

/** "DD.MM.YYYY" — but tolerate "-" and "/" too: Hattrick renders dates in the account's chosen
 *  format, so a scrape from a different login can arrive hyphenated. */
function parseDMY(d: string): number {
  const [dd, mm, yyyy] = d.trim().split(' ')[0]!.split(/[.\-/]/).map(Number);
  return new Date(yyyy!, mm! - 1, dd).getTime();
}

export interface CoachAttributionResult { attributed: number; eligible: number; medals: number; medalSlots: number }

/**
 * Attribute each World Cup edition's champion to whichever manager was coaching that nation's team
 * when the edition finished — the coach whose tenure (from NTFormerCoaches.aspx, scraped) started
 * most recently on/before the edition's finish date. Requires src/data/national-team-ids.json
 * (senior champions use nationalTeamId, youth champions use u20TeamId — a different team entity).
 * Idempotent: re-running recomputes every edition's attribution from the tenure list.
 */
export async function attributeWorldCupCoaches(token: TokenPair, tenures: CoachTenure[]): Promise<CoachAttributionResult> {
  const byTeam = new Map<number, CoachTenure[]>();
  for (const t of tenures) {
    if (!t.date) continue; // sentinel row for a team with no parseable tenure data
    const arr = byTeam.get(t.teamId) ?? [];
    arr.push(t);
    byTeam.set(t.teamId, arr);
  }
  for (const arr of byTeam.values()) arr.sort((a, b) => parseDMY(a.date) - parseDMY(b.date));

  const teamIds: Record<string, { nationalTeamId: number; u20TeamId: number }> = JSON.parse(
    readFileSync(new URL('../data/national-team-ids.json', import.meta.url), 'utf8'),
  );

  /** The nation's team for this bracket — these rolls name nations only, never link a team. */
  const teamOf = (nation: string | null | undefined, isYouth: boolean) => {
    if (!nation) return undefined;
    const t = teamIds[nation];
    return isYouth ? t?.u20TeamId : t?.nationalTeamId;
  };
  /** Whoever's tenure started most recently on/before the final. */
  const coachAt = (teamId: number | undefined, finishedMs: number): CoachTenure | null => {
    if (!teamId) return null;
    const teamTenures = byTeam.get(teamId);
    if (!teamTenures) return null;
    let coach: CoachTenure | null = null;
    for (const tn of teamTenures) {
      if (parseDMY(tn.date) <= finishedMs) coach = tn;
      else break;
    }
    return coach;
  };
  const remember = async (coach: CoachTenure | null) => {
    if (!coach?.userId) return;
    await prisma.hattrickUser.upsert({
      where: { userId: coach.userId },
      update: { loginName: coach.name },
      create: { userId: coach.userId, loginName: coach.name },
    });
  };

  const editions = await prisma.worldCupChampion.findMany();
  let attributed = 0;
  let eligible = 0;
  let medals = 0;
  let medalSlots = 0;
  for (const e of editions) {
    if (!e.champion || !e.finishedDate) continue;
    eligible++;
    const finishedMs = parseDMY(e.finishedDate);

    const coach = coachAt(teamOf(e.champion, e.isYouth), finishedMs);
    if (coach?.userId) attributed++;
    await remember(coach);

    // Silver and bronze, on identical evidence — the same tenure list, the same date rule. Without
    // this the by-coach medal table for the World Cup could only ever show golds.
    const second = coachAt(teamOf(e.runnerUp, e.isYouth), finishedMs);
    const thirdNames = e.thirdFourth ? e.thirdFourth.split(', ').filter(Boolean) : [];
    const thirds = thirdNames.map((n) => coachAt(teamOf(n, e.isYouth), finishedMs));
    await remember(second);
    for (const t of thirds) await remember(t);
    medalSlots += (e.runnerUp ? 1 : 0) + thirdNames.length;
    medals += (second?.userId ? 1 : 0) + thirds.filter((t) => t?.userId).length;

    await prisma.worldCupChampion.update({
      where: { isYouth_edition: { isYouth: e.isYouth, edition: e.edition } },
      data: {
        ...(coach ? { championUserId: coach.userId, championUserName: coach.userId ? coach.name : null } : {}),
        runnerUpUserId: second?.userId || null,
        thirdFourthUserIds: thirds.map((t) => t?.userId || '').join(','),
      },
    });
  }

  await enrichUserNationalities(token);
  return { attributed, eligible, medals, medalSlots };
}
