/**
 * Data layer for the Aggregate Stats views — wired to the real backend.
 *
 *   - Trophy leaders → /api/users/leaderboard, /api/users/nationalities, /api/users/:id
 *   - League winners → /api/national/leagues, /api/national/leagues/:id/champions
 *
 * Backend honesty: only top-division LEAGUE titles are tracked (no cup/other trophies yet),
 * so `cup`/`oth` are 0 and a manager's cabinet holds only championships. Manager attribution
 * is the champion team's owner at the title season (team-history), which is still being
 * completed for a tail of deep-history teams.
 */

/** A country/league: `code` is the numeric leagueId as a string; `name` is the display name. */
export interface Country {
  code: string;
  name: string;
}

export interface Manager {
  userId: number;
  login: string;
  /** nationality (full country name), shown in the Nation chip */
  c: string;
  team: string;
  lg: number;
  cup: number;
  oth: number;
}

export interface TrophyItem {
  main: string;
  sub: string;
  season: string;
}

export interface TrophyCabinet {
  champ: TrophyItem[];
  main: TrophyItem[];
  sec: TrophyItem[];
  other: TrophyItem[];
}

export interface Winner {
  season: number;
  club: string;
  manager: string;
}

async function j<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json() as Promise<T>;
}

/** Distinct manager nationalities (for the Trophy-leaders filter). */
export async function getNationalities(): Promise<Country[]> {
  const rows = await j<Array<{ nationality: string; managers: number }>>('/api/users/nationalities');
  return rows.map((r) => ({ code: r.nationality, name: `${r.nationality} (${r.managers})` }));
}

/** Countries with a top-division seeded (for the League-winners selector). */
export async function getLeagues(): Promise<Country[]> {
  const rows = await j<Array<{ leagueId: number; country: string; seasonsStored: number }>>('/api/national/leagues');
  return rows
    .filter((r) => r.seasonsStored > 0)
    .map((r) => ({ code: String(r.leagueId), name: r.country }));
}

/** Managers ranked by top-division titles; optional nationality filter. */
export async function getManagers(nationality?: string): Promise<Manager[]> {
  const qs = nationality && nationality !== 'ALL' ? `?nationality=${encodeURIComponent(nationality)}&limit=200` : '?limit=200';
  const rows = await j<Array<{ userId: number; userName: string; nationality: string | null; titles: number }>>(
    '/api/users/leaderboard' + qs,
  );
  return rows.map((r) => ({ userId: r.userId, login: r.userName, c: r.nationality ?? '—', team: '', lg: r.titles, cup: 0, oth: 0 }));
}

/** One manager's trophy cabinet (championships only — no cup data in the backend yet). */
export async function getCabinet(userId: number): Promise<TrophyCabinet> {
  const d = await j<{ titles: Array<{ country: string; season: number; club: string; complete: boolean }> }>(`/api/users/${userId}`);
  const champ = d.titles
    .filter((t) => t.complete)
    .sort((a, b) => b.season - a.season)
    .map((t) => ({ main: `${t.country} champions`, sub: t.club, season: 'S' + t.season }));
  return { champ, main: [], sec: [], other: [] };
}

/** A country's top-division roll of honour (finished seasons, newest first). */
export async function getWinners(leagueId: string): Promise<Winner[]> {
  const rows = await j<Array<{ season: number; champion: string; championUserName: string | null; complete: boolean }>>(
    `/api/national/leagues/${leagueId}/champions`,
  );
  return rows
    .filter((r) => r.complete)
    .map((r) => ({ season: r.season, club: r.champion, manager: r.championUserName ?? '—' }));
}
