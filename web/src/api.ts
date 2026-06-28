/**
 * Typed client for our backend's JSON read API. The browser talks ONLY to these endpoints —
 * never to Hattrick, never to XML, never to secrets.
 */

export interface SeasonRow {
  season: number;
  matches: number;
}

export interface Match {
  matchId: number;
  teamId: number;
  season: number;
  matchDate: string;
  homeTeamId: number;
  awayTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
  homeGoals: number | null;
  awayGoals: number | null;
  matchType: number | null;
  detailsFetched: boolean;
}

export interface SeasonSummary {
  season: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  seasons: () => getJson<SeasonRow[]>('/api/seasons'),
  seasonMatches: (season: number) => getJson<Match[]>(`/api/seasons/${season}/matches`),
  match: (matchId: number) => getJson<Match>(`/api/matches/${matchId}`),
  teamSummary: (teamId: number) => getJson<SeasonSummary[]>(`/api/teams/${teamId}/summary`),
};
