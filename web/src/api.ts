/**
 * Typed client for our backend's JSON read API. The browser talks ONLY to these endpoints —
 * never to Hattrick, never to XML, never to secrets.
 */

export interface NationalLeagueRow {
  leagueId: number;
  country: string;
  topSeriesId: number;
  currentSeason: number | null;
  seasonsStored: number;
}

export interface NationalChampion {
  season: number;
  championTeamId: number | null;
  champion: string;
  points: number | null;
  played: number | null;
  complete: boolean; // false → season in progress (current leader)
  /** Facts unavailable in the retained historical source; never interpret null as zero. */
  missingData: Array<'championTeamId' | 'points' | 'played'>;
}

export interface NationalityRow {
  nationality: string;
  managers: number;
}

export interface LeaderboardRow {
  userId: number;
  userName: string;
  nationality: string | null;
  titles: number;
}

export interface UserTitle {
  country: string;
  season: number;
  club: string;
  clubId: number | null;
  complete: boolean;
  missingData: Array<'clubId'>;
}

export interface UserDetail {
  userId: number;
  userName: string;
  nationality: string | null;
  titles: UserTitle[];
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  nationalLeagues: () => getJson<NationalLeagueRow[]>('/api/national/leagues'),
  nationalChampions: (leagueId: number) => getJson<NationalChampion[]>(`/api/national/leagues/${leagueId}/champions`),
  nationalities: () => getJson<NationalityRow[]>('/api/users/nationalities'),
  leaderboard: (nationality?: string, limit = 50) =>
    getJson<LeaderboardRow[]>(`/api/users/leaderboard?limit=${limit}${nationality ? `&nationality=${encodeURIComponent(nationality)}` : ''}`),
  user: (userId: number) => getJson<UserDetail>(`/api/users/${userId}`),
};
