import { z } from 'zod';
import { prisma } from '../db/client.js';
import { electionIdentitySchema, electionKey } from './electionRecovery.js';

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

const recordSchema = electionIdentitySchema.extend({
  edition: z.number().int().nonnegative(), isYouth: z.boolean().default(false), countryName: z.string().min(1),
  winnerUserId: z.number().int().nonnegative().nullable(), winnerUserName: z.string().nullable(),
});

/**
 * Merge without deleting country history. Only an explicitly complete snapshot may fill or
 * append rows: a partial page cannot establish that a tuple has just one occurrence. Distinct
 * re-election tuples stay separate. Indistinguishable tuples remain unresolved.
 */
export async function ingestElections(records: ElectionRecord[], options: { complete?: boolean } = {}): Promise<number> {
  // Edition zero is the scraper's empty-country sentinel, never a stored election.
  const valid = z.array(recordSchema).parse(records).filter((row) => row.edition > 0);
  const grouped = new Map<string, typeof valid>();
  for (const row of valid) { const key = electionKey(row); grouped.set(key, [...(grouped.get(key) ?? []), row]); }
  return prisma.$transaction(async (tx) => {
    let processed = 0;
    for (const group of grouped.values()) {
      if (group.length !== 1) continue;
      const source = group[0]!;
      const identity = electionIdentitySchema.parse(source);
      const matches = await tx.nationalCoachElection.findMany({ where: identity });
      if (matches.length > 1) continue;
      const stored = matches[0];
      if (stored?.winnerUserId && stored.winnerUserId > 0) { processed++; continue; }
      if (!options.complete) continue;
      const positive = !!source.winnerUserId && source.winnerUserId > 0 && !!source.winnerUserName?.trim();
      if (stored && !positive) { processed++; continue; }
      if (stored && stored.winnerUserId !== null && stored.winnerUserId !== 0) continue;
      const user = positive ? await tx.hattrickUser.upsert({ where: { userId: source.winnerUserId! }, update: {},
        create: { userId: source.winnerUserId!, loginName: source.winnerUserName! } }) : null;
      if (stored) {
        const changed = await tx.nationalCoachElection.updateMany({ where: { id: stored.id, ...identity, winnerUserId: stored.winnerUserId },
          data: { winnerUserId: source.winnerUserId!, winnerUserName: user!.loginName } });
        if (changed.count !== 1) throw new Error(`Election changed concurrently: ${electionKey(source)}`);
      } else {
        await tx.nationalCoachElection.create({ data: { ...identity, countryName: source.countryName,
          winnerUserId: positive ? source.winnerUserId : null, winnerUserName: user?.loginName ?? null } });
      }
      processed++;
    }
    return processed;
  }, { timeout: 30_000 });
}
