import { chppGet } from './client.js';
import type { TokenPair } from './auth.js';

/**
 * Typed wrappers, one per `file=`. Versions are PINNED here — never omit them.
 *
 * Every version is explicit. The tournament and national-team versions are additionally covered
 * by retained real-response fixtures so a CHPP response-shape change fails closed in validation.
 */
const VERSION = {
  teamdetails: '3.6',
  matchesarchive: '1.4',
  matchdetails: '3.0',
  matches: '2.9',
  leaguefixtures: '1.2',
  worlddetails: '1.9',
  cupmatches: '1.2',
  tournamentdetails: '1.0',
  tournamentfixtures: '1.1',
  nationalteamdetails: '1.3',
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

/** Country metadata incl. its Cups catalog (CupID/CupLevel/CupLevelIndex/CupLeagueLevel). */
export function fetchWorldDetails(token: TokenPair, leagueId: number): Promise<unknown> {
  return chppGet(token, { file: 'worlddetails', version: VERSION.worlddetails, leagueID: leagueId });
}

/**
 * Matches of a cup in a given season. With no `cupRound`, CHPP returns the LAST played round —
 * for a completed cup that is the final (one match), so this reconstructs historical winners.
 * `season` accepts past seasons. Before the cup existed a season returns round 0 / no matches.
 */
export function fetchCupMatches(
  token: TokenPair,
  params: { cupId: number; season?: number; cupRound?: number },
): Promise<unknown> {
  return chppGet(token, {
    file: 'cupmatches',
    version: VERSION.cupmatches,
    cupId: params.cupId,
    season: params.season,
    cupRound: params.cupRound,
  });
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

/** Metadata for one Hattrick tournament, including its current season and final round. */
export function fetchTournamentDetails(token: TokenPair, tournamentId: number): Promise<unknown> {
  return chppGet(token, {
    file: 'tournamentdetails',
    version: VERSION.tournamentdetails,
    tournamentId,
  });
}

/** All tournament fixtures for the current season, or for an explicitly selected season. */
export function fetchTournamentFixtures(
  token: TokenPair,
  params: { tournamentId: number; season?: number },
): Promise<unknown> {
  return chppGet(token, {
    file: 'tournamentfixtures',
    version: VERSION.tournamentfixtures,
    tournamentId: params.tournamentId,
    season: params.season,
  });
}

/** Current metadata and elected coach for a senior or U20 national team. */
export function fetchNationalTeamDetails(token: TokenPair, teamId: number): Promise<unknown> {
  return chppGet(token, {
    file: 'nationalteamdetails',
    version: VERSION.nationalteamdetails,
    teamID: teamId,
  });
}
