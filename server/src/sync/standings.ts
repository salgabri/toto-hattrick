import type { FixtureResult } from '../schemas/index.js';

/**
 * Reconstruct a Hattrick league table from a division's fixtures and crown the champion.
 *
 * Hattrick points: win 3, draw 1, loss 0. Ranking tiebreakers, in order:
 *   1. points, 2. goal difference, 3. goals scored.
 * (Hattrick's deeper tiebreakers — head-to-head, then a playoff — almost never decide the
 * title; points/GD/GF resolve it in practice. We note `complete` so callers can flag a
 * still-running season where the "champion" is only the current leader.)
 */

export interface StandingRow {
  position: number;
  teamId: number;
  teamName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
}

export interface LeagueTable {
  rows: StandingRow[];
  champion: StandingRow | null;
  /** true once every fixture has a result (a finished season). */
  complete: boolean;
}

export function computeStandings(matches: FixtureResult[]): LeagueTable {
  const table = new Map<number, StandingRow>();
  const row = (teamId: number, teamName: string): StandingRow => {
    let r = table.get(teamId);
    if (!r) {
      r = { position: 0, teamId, teamName, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0 };
      table.set(teamId, r);
    }
    return r;
  };

  let played = 0;
  for (const m of matches) {
    // Register every team even if a fixture is unplayed, so the table lists all of them.
    const home = row(m.homeTeamId, m.homeTeamName);
    const away = row(m.awayTeamId, m.awayTeamName);
    if (m.homeGoals === null || m.awayGoals === null) continue;
    played++;

    home.played++; away.played++;
    home.goalsFor += m.homeGoals; home.goalsAgainst += m.awayGoals;
    away.goalsFor += m.awayGoals; away.goalsAgainst += m.homeGoals;

    if (m.homeGoals > m.awayGoals) { home.won++; home.points += 3; away.lost++; }
    else if (m.homeGoals < m.awayGoals) { away.won++; away.points += 3; home.lost++; }
    else { home.drawn++; away.drawn++; home.points++; away.points++; }
  }

  const rows = [...table.values()];
  for (const r of rows) r.goalDiff = r.goalsFor - r.goalsAgainst;
  rows.sort((a, b) =>
    b.points - a.points ||
    b.goalDiff - a.goalDiff ||
    b.goalsFor - a.goalsFor ||
    a.teamName.localeCompare(b.teamName),
  );
  rows.forEach((r, i) => (r.position = i + 1));

  const complete = matches.length > 0 && played === matches.length;
  return { rows, champion: rows[0] ?? null, complete };
}
