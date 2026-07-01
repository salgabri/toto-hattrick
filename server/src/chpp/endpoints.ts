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
  leaguefixtures: '1.2',
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
    // CHPP expects date-only 'YYYY-MM-DD' here — a time component makes it ignore the
    // range and return the latest season instead. seasonWindows() emits date-only strings.
    FirstMatchDate: params.firstMatchDate,
    LastMatchDate: params.lastMatchDate,
  });
}

/** Archive for a whole season (CHPP's `season` selector), used to find a team's division. */
export function fetchMatchesArchiveBySeason(
  token: TokenPair,
  params: { teamId: number; season: number },
): Promise<unknown> {
  return chppGet(token, {
    file: 'matchesarchive',
    version: VERSION.matchesarchive,
    teamID: params.teamId,
    season: params.season,
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

/**
 * All fixtures+results for one division in a given season. `season` accepts past seasons,
 * so this reconstructs historical league tables. Champion = top of the computed standings.
 */
export function fetchLeagueFixtures(
  token: TokenPair,
  params: { leagueLevelUnitId: number; season: number },
): Promise<unknown> {
  return chppGet(token, {
    file: 'leaguefixtures',
    version: VERSION.leaguefixtures,
    leagueLevelUnitID: params.leagueLevelUnitId,
    season: params.season,
  });
}
