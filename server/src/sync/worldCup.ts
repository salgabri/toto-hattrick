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

export interface CoachAttributionResult { attributed: number; eligible: number }

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

  const editions = await prisma.worldCupChampion.findMany();
  let attributed = 0;
  let eligible = 0;
  for (const e of editions) {
    if (!e.champion || !e.finishedDate) continue;
    eligible++;
    const t = teamIds[e.champion];
    const teamId = e.isYouth ? t?.u20TeamId : t?.nationalTeamId;
    if (!teamId) continue;
    const teamTenures = byTeam.get(teamId);
    if (!teamTenures) continue;

    const finishedMs = parseDMY(e.finishedDate);
    let coach: CoachTenure | null = null;
    for (const tn of teamTenures) {
      if (parseDMY(tn.date) <= finishedMs) coach = tn;
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
    await prisma.worldCupChampion.update({
      where: { isYouth_edition: { isYouth: e.isYouth, edition: e.edition } },
      data: { championUserId: coach.userId, championUserName: coach.userId ? coach.name : null },
    });
  }

  await enrichUserNationalities(token);
  return { attributed, eligible };
}
