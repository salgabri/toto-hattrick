import { chppGet } from './client.js';
import type { TokenPair } from './auth.js';

/**
 * Typed wrappers, one per `file=`. Versions are PINNED here — never omit them.
 *
 * TODO: confirm each version string against the current CHPP docs before going live;
 * these are sensible defaults, not verified against your registered app.
 */
const VERSION = {
  teamdetails: '3.6',
  matchesarchive: '1.4',
  matchdetails: '3.0',
  matches: '2.9',
} as const;

/** Team metadata + founded date. The step-2 smoke test: prove ONE signed call parses. */
export function fetchTeamDetails(token: TokenPair, teamId?: number): Promise<unknown> {
  return chppGet(token, { file: 'teamdetails', version: VERSION.teamdetails, teamID: teamId });
}

/** Historical matches in a date range. Paginate by season window (max range per call). */
export function fetchMatchesArchive(
  token: TokenPair,
  params: { teamId: number; firstMatchDate: string; lastMatchDate: string },
): Promise<unknown> {
  return chppGet(token, {
    file: 'matchesarchive',
    version: VERSION.matchesarchive,
    teamID: params.teamId,
    // CHPP expects 'YYYY-MM-DD HH:MM:SS'
    FirstMatchDate: params.firstMatchDate,
    LastMatchDate: params.lastMatchDate,
  });
}

/** Per-match goals, ratings, lineup. matchEvents optional. */
export function fetchMatchDetails(
  token: TokenPair,
  matchId: number,
  opts: { matchEvents?: boolean } = {},
): Promise<unknown> {
  return chppGet(token, {
    file: 'matchdetails',
    version: VERSION.matchdetails,
    matchID: matchId,
    matchEvents: opts.matchEvents ? 'true' : undefined,
  });
}

/** Recent/upcoming matches in a short window. Keeps the archive current. */
export function fetchMatches(token: TokenPair, teamId?: number): Promise<unknown> {
  return chppGet(token, { file: 'matches', version: VERSION.matches, teamID: teamId });
}
