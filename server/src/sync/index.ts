import { prisma } from '../db/client.js';
import type { TokenPair } from '../chpp/auth.js';
import { fetchMatchesArchive, fetchMatchDetails } from '../chpp/endpoints.js';
import { parseMatchesArchive, parseMatchDetails } from '../schemas/index.js';
import { seasonWindows } from './season.js';

/**
 * Archive sync. Plain async function so it runs from the manual HTTP trigger today
 * and a cron/scheduler tomorrow — keep all logic here, not in the route handler.
 *
 * Contract (spec): resume-safe. Re-running never duplicates and never re-fetches a
 * match already stored. Polite pacing between calls.
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
  opts: { from?: Date; to?: Date } = {},
): Promise<SyncResult> {
  const from = opts.from ?? new Date();
  // TODO: default `to` to the team's foundedDate (teamdetails) instead of a hard floor.
  const to = opts.to ?? new Date('2005-01-01T00:00:00Z');

  const result: SyncResult = { teamId, matchesSeen: 0, matchesInserted: 0, detailsFetched: 0 };

  for (const window of seasonWindows(from, to)) {
    const rawArchive = await fetchMatchesArchive(token, {
      teamId,
      firstMatchDate: window.firstMatchDate,
      lastMatchDate: window.lastMatchDate,
    });

    // Throws until schemas are modelled against /samples — that's intentional.
    const archive = parseMatchesArchive(rawArchive);

    // TODO: map `archive` -> list of match summaries once the schema is real.
    const summaries: Array<{ matchId: number; matchDate: Date /* ...spec fields... */ }> =
      extractSummaries(archive);

    for (const summary of summaries) {
      result.matchesSeen++;

      // Finished matches never change — skip anything already stored.
      const existing = await prisma.match.findUnique({ where: { matchId: summary.matchId } });
      if (existing?.detailsFetched) continue;

      if (!existing) {
        // TODO: write the full summary row (season derived from matchDate, etc.).
        await insertMatchSummary(teamId, summary);
        result.matchesInserted++;
      }

      // Enrich with matchdetails, then mark detailsFetched.
      const rawDetails = await fetchMatchDetails(token, summary.matchId, { matchEvents: true });
      const details = parseMatchDetails(rawDetails);
      await upsertMatchDetail(summary.matchId, details);
      result.detailsFetched++;

      await sleep(PACING_MS);
    }

    await sleep(PACING_MS);
  }

  return result;
}

// --- helpers to fill in once schemas are modelled ---------------------------

function extractSummaries(_archive: unknown): Array<{ matchId: number; matchDate: Date }> {
  // TODO: pull match rows out of the parsed matchesarchive object.
  throw new Error('extractSummaries not implemented — model matchesarchive schema first.');
}

async function insertMatchSummary(
  _teamId: number,
  _summary: { matchId: number; matchDate: Date },
): Promise<void> {
  // TODO: prisma.match.create({ data: { ...summary, season: deriveSeason(summary.matchDate) } })
  throw new Error('insertMatchSummary not implemented.');
}

async function upsertMatchDetail(_matchId: number, _details: unknown): Promise<void> {
  // TODO: prisma.matchDetail.upsert + flip match.detailsFetched = true in one transaction.
  throw new Error('upsertMatchDetail not implemented.');
}
