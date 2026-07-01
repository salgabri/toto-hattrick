import { prisma } from '../db/client.js';
import type { TokenPair } from '../chpp/auth.js';
import { fetchTeamDetails, fetchMatchesArchive, fetchMatchDetails } from '../chpp/endpoints.js';
import {
  parseTeamDetails,
  parseMatchesArchive,
  parseMatchDetails,
  type ArchiveMatchSummary,
} from '../schemas/index.js';
import { seasonWindows, deriveSeason } from './season.js';

/**
 * Archive sync. Plain async function so it runs from the manual HTTP trigger today
 * and a cron/scheduler tomorrow — keep all logic here, not in the route handler.
 *
 * Contract (spec): resume-safe. Re-running never duplicates and never re-fetches a
 * match already stored+enriched. Polite pacing between calls.
 */

const PACING_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SyncResult {
  teamId: number;
  matchesSeen: number;
  matchesInserted: number;
  detailsFetched: number;
}

export async function syncTeam(
  token: TokenPair,
  teamId: number,
  opts: { from?: Date; to?: Date; enrich?: boolean } = {},
): Promise<SyncResult> {
  const enrich = opts.enrich ?? true;
  const from = opts.from ?? new Date();

  // Resolve the team (name + founded date) and make sure the Team row exists before we
  // insert matches that FK to it. teamdetails returns every team on the account.
  const { teams } = parseTeamDetails(await fetchTeamDetails(token, teamId));
  const team = teams.find((t) => t.teamId === teamId);
  if (!team) {
    throw new Error(`team ${teamId} not found on this account (have: ${teams.map((t) => t.teamId).join(', ')})`);
  }
  await prisma.team.upsert({
    where: { teamId },
    update: { name: team.name, foundedDate: team.foundedDate, leagueId: team.leagueId },
    create: { teamId, name: team.name, foundedDate: team.foundedDate, leagueId: team.leagueId },
  });

  // Don't walk earlier than the club existed.
  const to = opts.to ?? team.foundedDate ?? new Date('2005-01-01T00:00:00Z');

  const result: SyncResult = { teamId, matchesSeen: 0, matchesInserted: 0, detailsFetched: 0 };

  for (const window of seasonWindows(from, to)) {
    const { matches } = parseMatchesArchive(
      await fetchMatchesArchive(token, {
        teamId,
        firstMatchDate: window.firstMatchDate,
        lastMatchDate: window.lastMatchDate,
      }),
    );

    for (const summary of matches) {
      result.matchesSeen++;

      const existing = await prisma.match.findUnique({ where: { matchId: summary.matchId } });
      if (existing?.detailsFetched) continue; // finished + enriched → nothing to do

      if (!existing) {
        await insertMatchSummary(teamId, summary);
        result.matchesInserted++;
      }

      if (enrich) {
        await upsertMatchDetail(summary.matchId, await fetchMatchDetails(token, summary.matchId, { matchEvents: true }));
        result.detailsFetched++;
        await sleep(PACING_MS);
      }
    }

    await sleep(PACING_MS);
  }

  return result;
}

// --- helpers ----------------------------------------------------------------

async function insertMatchSummary(teamId: number, m: ArchiveMatchSummary): Promise<void> {
  await prisma.match.create({
    data: {
      matchId: m.matchId,
      teamId,
      season: deriveSeason(m.matchDate), // derive once, store it (spec) — never compute at query time
      matchDate: m.matchDate,
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      homeTeamName: m.homeTeamName,
      awayTeamName: m.awayTeamName,
      homeGoals: m.homeGoals,
      awayGoals: m.awayGoals,
      matchType: m.matchType,
    },
  });
}

async function upsertMatchDetail(matchId: number, rawDetails: unknown): Promise<void> {
  const d = parseMatchDetails(rawDetails);
  const lineupJson = JSON.stringify(d.lineup);
  const scorersJson = JSON.stringify(d.scorers);
  const ratingsJson = JSON.stringify(d.ratings);

  // Detail + the detailsFetched flag flip in one transaction so a crash can't leave a
  // match marked done without its detail row.
  await prisma.$transaction([
    prisma.matchDetail.upsert({
      where: { matchId },
      update: { lineupJson, scorersJson, ratingsJson },
      create: { matchId, lineupJson, scorersJson, ratingsJson },
    }),
    prisma.match.update({ where: { matchId }, data: { detailsFetched: true } }),
  ]);
}
