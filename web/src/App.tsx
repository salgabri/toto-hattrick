import { useEffect, useState } from 'react';
import {
  api,
  type NationalLeagueRow,
  type NationalChampion,
  type NationalityRow,
  type LeaderboardRow,
  type UserDetail,
} from './api.js';

export function App() {
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'countries' | 'managers'>('countries');

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 960, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Hattrick League Champions</h1>
      <nav style={{ display: 'flex', gap: '0.5rem', borderBottom: '2px solid #e3e3e3', marginBottom: '1.25rem' }}>
        {(['countries', 'managers'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={tabBtn(tab === t)}>
            {t === 'countries' ? 'Champions by Country' : 'Top Managers'}
          </button>
        ))}
      </nav>
      {error && <p style={{ color: 'crimson' }}>Error: {error}</p>}
      {tab === 'countries' ? <NationalChampions onError={setError} /> : <TopManagers onError={setError} />}
    </main>
  );
}

function tabBtn(active: boolean): React.CSSProperties {
  return {
    border: 'none',
    borderBottom: active ? '2px solid #1f6feb' : '2px solid transparent',
    background: 'transparent',
    color: active ? '#1f6feb' : '#555',
    fontWeight: active ? 700 : 400,
    fontSize: '1rem',
    padding: '0.5rem 0.75rem',
    marginBottom: -2,
    cursor: 'pointer',
  };
}

/** Most title-winning managers, filterable by nationality; expand a row for the titles won. */
function TopManagers({ onError }: { onError: (e: string) => void }) {
  const [nationalities, setNationalities] = useState<NationalityRow[]>([]);
  const [nationality, setNationality] = useState<string>('');
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([api.nationalities(), api.leaderboard(nationality || undefined, 100)])
      .then(([nats, board]) => {
        setNationalities(nats);
        setRows(board);
      })
      .catch((e) => onError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, [nationality]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(userId: number) {
    if (open === userId) {
      setOpen(null);
      return;
    }
    setOpen(userId);
    setDetail(null);
    api.user(userId).then(setDetail).catch((e) => onError(String(e)));
  }

  return (
    <section>
      <p style={{ color: '#666', marginTop: 0 }}>
        Managers ranked by top-division titles won (finished seasons). Title attributed to the champion team's current owner.
      </p>

      <label>
        Nationality:{' '}
        <select value={nationality} onChange={(e) => setNationality(e.target.value)} style={{ minWidth: 200 }}>
          <option value="">All nationalities</option>
          {nationalities.map((n) => (
            <option key={n.nationality} value={n.nationality}>
              {n.nationality} ({n.managers})
            </option>
          ))}
        </select>{' '}
        <button onClick={load} style={refreshBtn} title="Reload (enrichment may still be running)">
          ↻
        </button>
        {loading && <span style={{ color: '#888', marginLeft: 8 }}>loading…</span>}
      </label>

      <table style={{ width: '100%', marginTop: '1rem', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 40 }}>#</th>
            <th style={th}>Manager</th>
            <th style={th}>Nationality</th>
            <th style={{ ...th, textAlign: 'right' }}>Titles</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <FragmentManager key={r.userId} rank={i + 1} row={r} open={open === r.userId} detail={open === r.userId ? detail : null} onToggle={() => toggle(r.userId)} />
          ))}
        </tbody>
      </table>
      {rows.length === 0 && !loading && <p style={{ color: '#888' }}>No managers resolved yet — enrichment may still be running.</p>}
    </section>
  );
}

function FragmentManager({
  rank,
  row,
  open,
  detail,
  onToggle,
}: {
  rank: number;
  row: LeaderboardRow;
  open: boolean;
  detail: UserDetail | null;
  onToggle: () => void;
}) {
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer', background: open ? '#f3f6ff' : undefined }}>
        <td style={{ ...td, textAlign: 'right', color: '#888' }}>{rank}</td>
        <td style={td}>
          <a href={`https://www.hattrick.org/en/Club/Manager/?userId=${row.userId}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            {row.userName}
          </a>
        </td>
        <td style={td}>{row.nationality ?? '—'}</td>
        <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{row.titles}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4} style={{ padding: '0 0 0.75rem 2rem', background: '#fafbff' }}>
            {!detail ? (
              <span style={{ color: '#888' }}>Loading titles…</span>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <tbody>
                  {detail.titles.filter((t) => t.complete).map((t, i) => (
                    <tr key={i}>
                      <td style={{ ...td, width: 70 }}>S{t.season}</td>
                      <td style={td}>{t.country}</td>
                      <td style={td}>
                        {t.complete ? '🏆' : '◷'}{' '}
                        <a href={`https://www.hattrick.org/en/Club/?TeamID=${t.clubId}`} target="_blank" rel="noreferrer">
                          {t.club}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/** Top-division (first league) champion of each country, every season — the main view. */
function NationalChampions({ onError }: { onError: (e: string) => void }) {
  const [leagues, setLeagues] = useState<NationalLeagueRow[]>([]);
  const [leagueId, setLeagueId] = useState<number | null>(null);
  const [champions, setChampions] = useState<NationalChampion[]>([]);
  const [query, setQuery] = useState('');
  const [loadingChamps, setLoadingChamps] = useState(false);

  function loadLeagues(keepSelection = false) {
    return api
      .nationalLeagues()
      .then((rows) => {
        setLeagues(rows);
        if (!keepSelection) {
          const pick = rows.find((r) => r.leagueId === 4) ?? rows.find((r) => r.seasonsStored > 0) ?? rows[0];
          if (pick) setLeagueId(pick.leagueId);
        }
      })
      .catch((e) => onError(String(e)));
  }

  useEffect(() => {
    loadLeagues();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (leagueId == null) return;
    setLoadingChamps(true);
    api
      .nationalChampions(leagueId)
      // Drop the in-progress current season — only show decided champions.
      .then((rows) => setChampions(rows.filter((r) => r.complete)))
      .catch((e) => onError(String(e)))
      .finally(() => setLoadingChamps(false));
  }, [leagueId, onError]);

  const selected = leagues.find((l) => l.leagueId === leagueId);
  const totalSeasons = leagues.reduce((n, l) => n + l.seasonsStored, 0);
  const countriesWithData = leagues.filter((l) => l.seasonsStored > 0).length;

  const q = query.trim().toLowerCase();
  const filtered = q ? leagues.filter((l) => l.country.toLowerCase().includes(q)) : leagues;

  // Most-decorated clubs in the selected country (completed titles only).
  const titleCounts = (() => {
    const m = new Map<number, { name: string; count: number }>();
    for (const c of champions) {
      if (!c.complete) continue;
      const e = m.get(c.championTeamId) ?? { name: c.champion, count: 0 };
      e.count++;
      e.name = c.champion;
      m.set(c.championTeamId, e);
    }
    return [...m.entries()]
      .map(([teamId, v]) => ({ teamId, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  })();

  const seasonRange =
    champions.length > 0 ? `S${champions[champions.length - 1]!.season}–S${champions[0]!.season}` : '—';

  return (
    <section>
      <p style={{ color: '#666', marginTop: 0 }}>
        Champion of every country's top division, every season — reconstructed from full division results.{' '}
        <strong>{countriesWithData}</strong>/<strong>{leagues.length}</strong> countries populated,{' '}
        <strong>{totalSeasons.toLocaleString()}</strong> season titles stored.{' '}
        <button onClick={() => loadLeagues(true)} style={refreshBtn} title="Reload counts (backfill may still be running)">
          ↻ refresh
        </button>
      </p>

      <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Country filter panel */}
        <div style={{ flex: '0 0 240px', minWidth: 220 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Filter ${leagues.length} countries…`}
            style={{ width: '100%', padding: '0.45rem 0.6rem', boxSizing: 'border-box', marginBottom: '0.5rem' }}
          />
          <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid #e3e3e3', borderRadius: 6 }}>
            {filtered.map((l) => {
              const active = l.leagueId === leagueId;
              return (
                <button
                  key={l.leagueId}
                  onClick={() => setLeagueId(l.leagueId)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    width: '100%',
                    border: 'none',
                    borderBottom: '1px solid #f0f0f0',
                    background: active ? '#1f6feb' : 'transparent',
                    color: active ? '#fff' : l.seasonsStored ? '#111' : '#aaa',
                    padding: '0.4rem 0.6rem',
                    cursor: 'pointer',
                    textAlign: 'left',
                    font: 'inherit',
                  }}
                >
                  <span>{l.country}</span>
                  <span style={{ opacity: 0.7 }}>{l.seasonsStored}</span>
                </button>
              );
            })}
            {filtered.length === 0 && <p style={{ padding: '0.6rem', color: '#888', margin: 0 }}>No match.</p>}
          </div>
        </div>

        {/* Champions panel */}
        <div style={{ flex: '1 1 380px', minWidth: 320 }}>
          {selected && (
            <>
              <h2 style={{ margin: '0 0 0.25rem' }}>
                {selected.country}{' '}
                <span style={{ fontSize: '0.9rem', fontWeight: 400, color: '#777' }}>
                  · {champions.length} titles · {seasonRange}
                </span>
              </h2>

              {titleCounts.length > 0 && (
                <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: '#555' }}>
                  Most titles:{' '}
                  {titleCounts.map((t, i) => (
                    <span key={t.teamId}>
                      {i > 0 && ' · '}
                      <a href={`https://www.hattrick.org/en/Club/?TeamID=${t.teamId}`} target="_blank" rel="noreferrer">
                        {t.name}
                      </a>{' '}
                      ({t.count})
                    </span>
                  ))}
                </p>
              )}

              {loadingChamps && champions.length === 0 ? (
                <p style={{ color: '#888' }}>Loading…</p>
              ) : champions.length === 0 ? (
                <p style={{ color: '#888' }}>No champions stored yet for {selected.country} — backfill may still be running.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>Season</th>
                      <th style={th}>Champion</th>
                      <th style={{ ...th, textAlign: 'right' }}>Team ID</th>
                      <th style={{ ...th, textAlign: 'right' }}>Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {champions.map((c) => (
                      <tr key={c.season} style={{ background: c.complete ? undefined : '#fff3c4' }}>
                        <td style={td}>{c.season}</td>
                        <td style={td}>
                          {c.complete ? '🏆' : '◷'}{' '}
                          <a href={`https://www.hattrick.org/en/Club/?TeamID=${c.championTeamId}`} target="_blank" rel="noreferrer">
                            {c.champion}
                          </a>
                        </td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.championTeamId}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{c.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

const refreshBtn: React.CSSProperties = {
  border: '1px solid #ccc',
  background: '#f6f6f6',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: '0.8rem',
  padding: '0.1rem 0.4rem',
};

const th: React.CSSProperties = { textAlign: 'left', borderBottom: '2px solid #ccc', padding: '0.4rem' };
const td: React.CSSProperties = { borderBottom: '1px solid #eee', padding: '0.4rem' };
