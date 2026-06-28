import { useEffect, useState } from 'react';
import { api, type SeasonRow, type Match } from './api.js';

/**
 * Minimal shell: season selector -> results table. Match detail view and per-season
 * summary stats are the next features (read endpoints already exist).
 */
export function App() {
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .seasons()
      .then((rows) => {
        setSeasons(rows);
        if (rows.length > 0) setSelected(rows[0]!.season);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (selected == null) return;
    api.seasonMatches(selected).then(setMatches).catch((e) => setError(String(e)));
  }, [selected]);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 900, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Hattrick Season Archive</h1>

      {error && <p style={{ color: 'crimson' }}>Error: {error}</p>}

      {seasons.length === 0 ? (
        <p>No seasons yet. Run a sync to populate the archive.</p>
      ) : (
        <label>
          Season:{' '}
          <select value={selected ?? ''} onChange={(e) => setSelected(Number(e.target.value))}>
            {seasons.map((s) => (
              <option key={s.season} value={s.season}>
                {s.season} ({s.matches} matches)
              </option>
            ))}
          </select>
        </label>
      )}

      <table style={{ width: '100%', marginTop: '1rem', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>Date</th>
            <th style={th}>Home</th>
            <th style={th}>Score</th>
            <th style={th}>Away</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m) => (
            <tr key={m.matchId}>
              <td style={td}>{new Date(m.matchDate).toLocaleDateString()}</td>
              <td style={td}>{m.homeTeamName}</td>
              <td style={{ ...td, textAlign: 'center' }}>
                {m.homeGoals ?? '–'} : {m.awayGoals ?? '–'}
              </td>
              <td style={td}>{m.awayTeamName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

const th: React.CSSProperties = { textAlign: 'left', borderBottom: '2px solid #ccc', padding: '0.4rem' };
const td: React.CSSProperties = { borderBottom: '1px solid #eee', padding: '0.4rem' };
