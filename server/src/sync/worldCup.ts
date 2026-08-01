import { prisma } from '../db/client.js';

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
