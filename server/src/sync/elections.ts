import { prisma } from '../db/client.js';

/**
 * National Coach elections — per-country roll of who the community voted to lead their national
 * team for each World Cup cycle, independent of whether that country ever won anything. No CHPP
 * path exists (same story as sync/worldCup.ts); scraped once per country from World/Elections/
 * History.aspx?LeagueID=X (server/scrape/elections-scraper.js), which links the winner's userId
 * directly — unlike the coach-tenure page, no date-matching is needed here.
 */
export interface ElectionRecord {
  leagueId: number;
  countryName: string;
  edition: number;
  host: string;
  /** The U20/U21 election rather than the senior one. Absent in payloads scraped before the page's
   *  second table was read — those are all senior, so it defaults false. */
  isYouth?: boolean;
  winnerUserId: number | null; // null = "A former user" (unattributed sentinel)
  winnerUserName: string | null;
  votes: string | null;
}

/**
 * Ingest one country's full election roll. Re-syncs by leagueId (clear then reinsert) rather than
 * upserting per (leagueId, edition), since a repeated edition (a mid-cycle re-election) is a
 * genuinely separate row, not a duplicate to collapse.
 */
export async function ingestElections(records: ElectionRecord[]): Promise<number> {
  // edition 0 is the scraper's "this country had no rows" sentinel (keeps a team out of future
  // re-scrapes without inventing a fake election) — never a real record, so it's never stored.
  const valid = records.filter((r) => r.edition > 0);
  const byLeague = new Map<number, ElectionRecord[]>();
  for (const r of valid) {
    const a = byLeague.get(r.leagueId) ?? [];
    a.push(r);
    byLeague.set(r.leagueId, a);
  }

  for (const [leagueId, rows] of byLeague) {
    for (const r of rows) {
      if (r.winnerUserId) {
        await prisma.hattrickUser.upsert({
          where: { userId: r.winnerUserId },
          update: { loginName: r.winnerUserName! },
          create: { userId: r.winnerUserId, loginName: r.winnerUserName! },
        });
      }
    }
    await prisma.nationalCoachElection.deleteMany({ where: { leagueId } });
    await prisma.nationalCoachElection.createMany({
      data: rows.map((r) => ({
        leagueId: r.leagueId, countryName: r.countryName, edition: r.edition, host: r.host,
        isYouth: r.isYouth ?? false,
        winnerUserId: r.winnerUserId, winnerUserName: r.winnerUserName, votes: r.votes,
      })),
    });
  }
  return valid.length;
}
