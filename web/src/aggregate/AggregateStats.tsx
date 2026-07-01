import { useMemo, useState } from 'react';
import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import {
  COUNTRIES,
  MANAGERS,
  buildWinners,
  countryName,
  trophiesFor,
  type CountryCode,
} from './data.js';
import { C, CHAMP_COLOR, MAIN_COLOR, rootStyle, type Density, type Theme } from './theme.js';
import './aggregate.css';

/**
 * Toto Hattrick — Aggregate records.
 *
 * Cross-universe aggregate stats over the Hattrick world. Two views today, built to grow:
 *   - Trophy leaders — managers ranked by silverware, category toggles, nationality + name
 *     filters, expandable trophy cabinets, gold/silver/bronze podium.
 *   - League winners — per-country top-division roll of honour with dynasty highlighting and a
 *     "most titles" tally.
 *
 * Data is design-time sample data (see ./data.ts) — this view sits ahead of the backend.
 */

export type View = 'trophies' | 'leagues';

export interface AggregateStatsProps {
  /** Initial theme; the sidebar toggle flips it thereafter. */
  defaultTheme?: Theme;
  /** Accent color (heritage ochre by default). */
  accent?: string;
  /** Row density. Reserved knob from the design system; visual defaults are comfortable. */
  density?: Density;
}

export function AggregateStats({
  defaultTheme = 'paper',
  accent = '#B0742A',
  density = 'comfortable',
}: AggregateStatsProps) {
  const [theme, setTheme] = useState<Theme>(defaultTheme);
  const [view, setView] = useState<View>('trophies');
  const toggleTheme = () => setTheme((t) => (t === 'paper' ? 'floodlit' : 'paper'));

  // All view state lives on the parent so it survives nav switches — the prototype keeps a
  // single always-mounted component, so filters/search/expansion/league selection persist.
  const [nation, setNation] = useState<CountryCode | 'ALL'>('ALL');
  const [query, setQuery] = useState('');
  const [inc, setInc] = useState<IncState>({ champ: true, main: true, sec: false });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [league, setLeague] = useState<CountryCode>('SWE');

  return (
    <div className="ts-aggregate" style={rootStyle(theme, density, accent)}>
      <div
        style={{
          display: 'flex',
          minHeight: '100vh',
          background: 'var(--paper,#F4EFE4)',
          color: 'var(--ink,#1C201B)',
          fontFamily: "'Archivo',system-ui,sans-serif",
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        <Sidebar view={view} setView={setView} theme={theme} toggleTheme={toggleTheme} />
        <main style={{ flex: 1, minWidth: 0, padding: '34px 40px 64px' }}>
          <div style={{ maxWidth: 1080, margin: '0 auto' }}>
            {view === 'trophies' ? (
              <TrophyLeaders
                nation={nation}
                setNation={setNation}
                query={query}
                setQuery={setQuery}
                inc={inc}
                setInc={setInc}
                expandedId={expandedId}
                setExpandedId={setExpandedId}
              />
            ) : (
              <LeagueWinners league={league} setLeague={setLeague} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/* ============================== SIDEBAR ============================== */

const NAV: Array<{ key: View; label: string; sub: string }> = [
  { key: 'trophies', label: 'Trophy leaders', sub: 'managers by silverware' },
  { key: 'leagues', label: 'League winners', sub: 'champions by season' },
];

function Sidebar({
  view,
  setView,
  theme,
  toggleTheme,
}: {
  view: View;
  setView: (v: View) => void;
  theme: Theme;
  toggleTheme: () => void;
}) {
  return (
    <aside
      style={{
        width: 238,
        flex: 'none',
        borderRight: '1px solid var(--line,#E6DECB)',
        background: 'var(--card,#FCFAF4)',
        position: 'sticky',
        top: 0,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '4px 6px 20px' }}>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 11,
            background: 'var(--pitch,#25523C)',
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            flex: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 13,
              background: 'var(--accent,#B0742A)',
            }}
          />
          <span
            style={{
              fontFamily: "'Bricolage Grotesque',sans-serif",
              fontWeight: 800,
              color: '#fff',
              fontSize: 15,
              paddingBottom: 6,
            }}
          >
            TH
          </span>
        </div>
        <div>
          <div
            style={{
              fontFamily: "'Bricolage Grotesque',sans-serif",
              fontWeight: 800,
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            Toto Hattrick
          </div>
          <div
            style={{
              fontSize: 10.5,
              letterSpacing: '.13em',
              textTransform: 'uppercase',
              color: 'var(--ink-faint,#A99E86)',
              fontWeight: 600,
              marginTop: 4,
            }}
          >
            Aggregate records
          </div>
        </div>
      </div>

      <div
        style={{
          fontSize: 10,
          letterSpacing: '.15em',
          textTransform: 'uppercase',
          color: 'var(--ink-faint,#A99E86)',
          fontWeight: 700,
          padding: '0 8px 9px',
        }}
      >
        Statistics
      </div>

      {NAV.map((n) => {
        const active = view === n.key;
        return (
          <button
            key={n.key}
            onClick={() => setView(n.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              width: '100%',
              padding: '11px 10px',
              marginBottom: 4,
              borderRadius: 10,
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              color: C.ink,
              background: active ? C.card2 : 'transparent',
              boxShadow: active ? 'inset 3px 0 0 ' + C.accent : 'none',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                flex: 'none',
                background: active ? C.accent : C.line2,
              }}
            />
            <div style={{ textAlign: 'left', minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{n.label}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-faint,#A99E86)', fontWeight: 500 }}>
                {n.sub}
              </div>
            </div>
          </button>
        );
      })}

      <div style={{ flex: 1 }} />
      <div
        style={{
          fontSize: 11,
          lineHeight: 1.5,
          color: 'var(--ink-faint,#A99E86)',
          padding: '12px 8px',
          borderTop: '1px solid var(--line,#E6DECB)',
        }}
      >
        More metrics land here as the aggregation layer grows.
      </div>
      <button
        onClick={toggleTheme}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          width: '100%',
          padding: '9px 10px',
          borderRadius: 9,
          border: '1px solid var(--line-2,#D8CDB4)',
          background: 'var(--paper,#F4EFE4)',
          color: 'var(--ink-soft,#776F5D)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 12.5,
          fontWeight: 600,
        }}
      >
        <span style={{ fontSize: 15 }}>{theme === 'paper' ? '☾' : '☀'}</span>
        {theme === 'paper' ? 'Floodlit theme' : 'Paper theme'}
      </button>
    </aside>
  );
}

/* ============================== SHARED ============================== */

const h1Style: CSSProperties = {
  fontFamily: "'Bricolage Grotesque',sans-serif",
  fontWeight: 800,
  fontSize: 34,
  letterSpacing: '-.02em',
  margin: 0,
  lineHeight: 1,
};

const filterLabel: CSSProperties = {
  fontSize: 10,
  letterSpacing: '.13em',
  textTransform: 'uppercase',
  color: 'var(--ink-faint,#A99E86)',
  fontWeight: 700,
};

const selectStyle: CSSProperties = {
  appearance: 'none',
  padding: '9px 34px 9px 13px',
  borderRadius: 10,
  border: '1px solid var(--line-2,#D8CDB4)',
  background: 'var(--card,#FCFAF4)',
  color: 'var(--ink,#1C201B)',
  fontSize: 13.5,
  fontWeight: 600,
  cursor: 'pointer',
  backgroundImage:
    'linear-gradient(45deg,transparent 50%,var(--ink-soft,#776F5D) 50%),linear-gradient(135deg,var(--ink-soft,#776F5D) 50%,transparent 50%)',
  backgroundPosition: 'calc(100% - 17px) 51%,calc(100% - 12px) 51%',
  backgroundSize: '5px 5px,5px 5px',
  backgroundRepeat: 'no-repeat',
};

const cardStyle: CSSProperties = {
  background: 'var(--card,#FCFAF4)',
  border: '1px solid var(--line,#E6DECB)',
  borderRadius: 16,
  overflow: 'hidden',
  boxShadow: '0 1px 2px rgba(0,0,0,.03)',
};

const monoFaint: CSSProperties = {
  fontFamily: "'JetBrains Mono',monospace",
};

/* ========================== TROPHY LEADERS ========================== */

const TROPHY_GRID = '48px minmax(0,1fr) 76px minmax(120px,196px) 56px 22px';

interface IncState {
  champ: boolean;
  main: boolean;
  sec: boolean;
}

function rankBg(r: number): string {
  return r === 1 ? '#D8A93B' : r === 2 ? '#C7C3B8' : r === 3 ? '#C08A52' : 'transparent';
}

function TrophyLeaders({
  nation,
  setNation,
  query,
  setQuery,
  inc,
  setInc,
  expandedId,
  setExpandedId,
}: {
  nation: CountryCode | 'ALL';
  setNation: Dispatch<SetStateAction<CountryCode | 'ALL'>>;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  inc: IncState;
  setInc: Dispatch<SetStateAction<IncState>>;
  expandedId: string | null;
  setExpandedId: Dispatch<SetStateAction<string | null>>;
}) {

  const toggleInc = (k: keyof IncState) => setInc((s) => ({ ...s, [k]: !s[k] }));
  const toggleExpand = (login: string) =>
    setExpandedId((cur) => (cur === login ? null : login));

  // Ranks are ABSOLUTE: computed over the full field (only the category flags change them),
  // so filtering by nationality/name narrows the view without renumbering or moving medals.
  const ranked = useMemo(() => {
    const l = MANAGERS.map((m) => {
      const mc = Math.ceil(m.cup / 2);
      const ft =
        (inc.champ ? m.lg : 0) + (inc.main ? mc : 0) + (inc.sec ? m.cup - mc + m.oth : 0);
      return { m, ft };
    });
    l.sort((a, b) => b.ft - a.ft || b.m.lg - a.m.lg);
    return l.map((e, i) => ({ ...e, rank: i + 1 }));
  }, [inc]);

  const q = query.trim().toLowerCase();
  const visible = ranked
    .filter((e) => nation === 'ALL' || e.m.c === nation)
    .filter(
      (e) => !q || e.m.login.toLowerCase().includes(q) || e.m.team.toLowerCase().includes(q),
    );

  const chips: Array<{ k: keyof IncState; label: string }> = [
    { k: 'champ', label: 'Championships' },
    { k: 'main', label: 'Main cups' },
    { k: 'sec', label: 'Secondary' },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 20,
          flexWrap: 'wrap',
          marginBottom: 6,
        }}
      >
        <div>
          <h1 style={h1Style}>Trophy leaders</h1>
          <p style={{ fontSize: 14, color: 'var(--ink-soft,#776F5D)', margin: '10px 0 0' }}>
            Managers ranked by trophies won. Secondary cups &amp; minor honours are excluded by
            default — toggle what counts below.
          </p>
        </div>
      </div>

      {/* Filter bar: category flags (primary) → nationality → search (secondary) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
          margin: '22px 0 16px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={filterLabel}>Counting toward total</label>
          <div style={{ display: 'flex', gap: 7 }}>
            {chips.map((c) => {
              const on = inc[c.k];
              return (
                <button
                  key={c.k}
                  onClick={() => toggleInc(c.k)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 12.5,
                    fontWeight: 600,
                    padding: '8px 12px',
                    borderRadius: 9,
                    border: on
                      ? '1px solid var(--accent,#B0742A)'
                      : '1px solid var(--line-2,#D8CDB4)',
                    background: on
                      ? 'color-mix(in srgb, var(--accent,#B0742A) 12%, transparent)'
                      : 'transparent',
                    color: on ? C.ink : C.faint,
                  }}
                >
                  {on && (
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>✓</span>
                  )}
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={filterLabel}>Nationality</label>
          <select
            value={nation}
            onChange={(e) => setNation(e.target.value as CountryCode | 'ALL')}
            style={selectStyle}
          >
            <option value="ALL">All nationalities</option>
            {COUNTRIES.map((o) => (
              <option key={o.code} value={o.code}>
                {o.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={filterLabel}>Search</label>
          <input
            className="search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Manager or club…"
            style={{
              width: 214,
              padding: '9px 13px',
              borderRadius: 10,
              border: '1px solid var(--line-2,#D8CDB4)',
              background: 'var(--card,#FCFAF4)',
              color: 'var(--ink,#1C201B)',
              fontFamily: 'inherit',
              fontSize: 13.5,
              fontWeight: 500,
              outline: 'none',
            }}
          />
        </div>

        <div style={{ flex: 1 }} />
        <div style={{ ...monoFaint, fontSize: 12.5, color: 'var(--ink-soft,#776F5D)' }}>
          {visible.length} managers
        </div>
      </div>

      {/* Leaderboard */}
      <div style={cardStyle}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: TROPHY_GRID,
            gap: 14,
            padding: '12px 22px',
            fontSize: 10,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color: 'var(--ink-faint,#A99E86)',
            fontWeight: 700,
            borderBottom: '1px solid var(--line,#E6DECB)',
            alignItems: 'center',
          }}
        >
          <div>Rank</div>
          <div>Manager</div>
          <div>Nation</div>
          <div>Trophy mix</div>
          <div style={{ textAlign: 'right' }}>Total</div>
          <div />
        </div>

        {visible.map((e) => {
          const m = e.m;
          const r = e.rank;
          const top = r <= 3;
          const isExp = expandedId === m.login;
          const mc = Math.ceil(m.cup / 2);
          const sc = m.cup - mc;
          const tr = trophiesFor(m);

          const cats = [
            { label: 'Championships', dot: CHAMP_COLOR, items: tr.champ, excluded: !inc.champ },
            { label: 'Main cups', dot: MAIN_COLOR, items: tr.main, excluded: !inc.main },
            { label: 'Secondary cups', dot: C.line2, items: tr.sec, excluded: !inc.sec },
            { label: 'Other honours', dot: C.line2, items: tr.other, excluded: !inc.sec },
          ].filter((c) => c.items.length);

          const segRaw: Array<{ n: number; color: string }> = [];
          if (inc.champ && m.lg) segRaw.push({ n: m.lg, color: CHAMP_COLOR });
          if (inc.main && mc) segRaw.push({ n: mc, color: MAIN_COLOR });
          if (inc.sec && sc + m.oth) segRaw.push({ n: sc + m.oth, color: C.line2 });
          const tot = e.ft || 1;
          const breakdown = segRaw.map((s) => s.n).join(' · ') || '0';

          return (
            <div key={m.login} style={{ borderBottom: '1px solid var(--line,#E6DECB)' }}>
              <div
                className="mgr-row"
                onClick={() => toggleExpand(m.login)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: TROPHY_GRID,
                  gap: 14,
                  padding: '13px 22px',
                  alignItems: 'center',
                  ...(isExp
                    ? { background: 'color-mix(in srgb, var(--accent,#B0742A) 7%, transparent)' }
                    : null),
                }}
              >
                <div>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      fontFamily: "'JetBrains Mono',monospace",
                      fontWeight: 700,
                      fontSize: 14,
                      background: top ? rankBg(r) : 'transparent',
                      color: top ? '#2A211A' : C.soft,
                      border: top ? '1px solid rgba(0,0,0,.10)' : '1px solid ' + C.line2,
                    }}
                  >
                    {r}
                  </span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14.5,
                      fontWeight: 700,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {m.login}
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: 'var(--ink-soft,#776F5D)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {m.team}
                  </div>
                </div>
                <div>
                  <span
                    style={{
                      display: 'inline-block',
                      fontFamily: "'JetBrains Mono',monospace",
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: '.03em',
                      padding: '3px 7px',
                      borderRadius: 6,
                      background: 'var(--card-2,#EFE7D6)',
                      color: 'var(--ink-soft,#776F5D)',
                    }}
                  >
                    {m.c}
                  </span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      height: 9,
                      borderRadius: 5,
                      overflow: 'hidden',
                      display: 'flex',
                      background: 'var(--card-2,#EFE7D6)',
                    }}
                  >
                    {segRaw.map((sg, i) => (
                      <span
                        key={i}
                        style={{ width: (sg.n / tot) * 100 + '%', background: sg.color }}
                      />
                    ))}
                  </div>
                  <div
                    style={{
                      ...monoFaint,
                      fontSize: 10.5,
                      color: 'var(--ink-faint,#A99E86)',
                      marginTop: 5,
                    }}
                  >
                    {breakdown}
                  </div>
                </div>
                <div
                  style={{
                    textAlign: 'right',
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 20,
                    fontWeight: 700,
                  }}
                >
                  {e.ft}
                </div>
                <div
                  style={{
                    textAlign: 'center',
                    color: 'var(--ink-faint,#A99E86)',
                    fontSize: 10,
                    transition: 'transform .18s ease',
                    transform: isExp ? 'rotate(90deg)' : 'rotate(0deg)',
                  }}
                >
                  ▶
                </div>
              </div>

              {isExp && (
                <div
                  style={{
                    padding: '10px 22px 22px 84px',
                    background: 'color-mix(in srgb, var(--accent,#B0742A) 4%, transparent)',
                  }}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px 34px' }}>
                    {cats.map((g) => (
                      <div
                        key={g.label}
                        style={{ flex: 1, minWidth: 186, opacity: g.excluded ? 0.45 : 1 }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 7,
                            marginBottom: 11,
                          }}
                        >
                          <span
                            style={{
                              width: 9,
                              height: 9,
                              borderRadius: 3,
                              flex: 'none',
                              background: g.dot,
                            }}
                          />
                          <span
                            style={{
                              fontSize: 10.5,
                              letterSpacing: '.09em',
                              textTransform: 'uppercase',
                              fontWeight: 700,
                              color: 'var(--ink-soft,#776F5D)',
                            }}
                          >
                            {g.label}
                          </span>
                          <span
                            style={{
                              ...monoFaint,
                              fontSize: 11,
                              color: 'var(--ink-faint,#A99E86)',
                            }}
                          >
                            {g.items.length}
                          </span>
                          {g.excluded && (
                            <span
                              style={{
                                fontSize: 9,
                                fontWeight: 700,
                                letterSpacing: '.06em',
                                textTransform: 'uppercase',
                                color: C.faint,
                                border: '1px solid ' + C.line2,
                                padding: '1px 6px',
                                borderRadius: 999,
                              }}
                            >
                              excluded
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {g.items.map((it, i) => (
                            <div
                              key={i}
                              style={{
                                display: 'flex',
                                alignItems: 'baseline',
                                justifyContent: 'space-between',
                                gap: 10,
                              }}
                            >
                              <div style={{ minWidth: 0 }}>
                                <div
                                  style={{
                                    fontSize: 12.5,
                                    fontWeight: 600,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {it.main}
                                </div>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: 'var(--ink-faint,#A99E86)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {it.sub}
                                </div>
                              </div>
                              <span
                                style={{
                                  fontFamily: "'JetBrains Mono',monospace",
                                  fontSize: 11.5,
                                  color: 'var(--ink-soft,#776F5D)',
                                  flex: 'none',
                                }}
                              >
                                {it.season}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {visible.length === 0 && (
          <div
            style={{
              padding: '28px 22px',
              textAlign: 'center',
              color: 'var(--ink-faint,#A99E86)',
              fontSize: 13,
            }}
          >
            No managers match your search.
          </div>
        )}
      </div>

      {/* Legend */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          marginTop: 14,
          fontSize: 12,
          color: 'var(--ink,#1C201B)',
          fontWeight: 600,
          flexWrap: 'wrap',
        }}
      >
        <LegendSwatch color="#2A5140" label="Championships" />
        <LegendSwatch color="#B0742A" label="Main cups" />
        <LegendSwatch color="var(--line-2,#D8CDB4)" label="Secondary" />
        <span style={{ flex: 1 }} />
        <span style={{ ...monoFaint, color: 'var(--ink-soft,#776F5D)', fontWeight: 400 }}>
          source: managercompendium · team trophy lists
        </span>
      </div>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 11, height: 11, borderRadius: 3, background: color }} />
      {label}
    </span>
  );
}

/* ========================== LEAGUE WINNERS ========================== */

const WINNER_GRID = '64px minmax(0,1fr) auto';

function LeagueWinners({
  league,
  setLeague,
}: {
  league: CountryCode;
  setLeague: Dispatch<SetStateAction<CountryCode>>;
}) {
  const winnersRaw = useMemo(() => buildWinners(league), [league]);
  const leagueName = countryName(league);

  const winners = winnersRaw.map((w, i) => {
    const below = winnersRaw[i + 1];
    const above = winnersRaw[i - 1];
    const partOfStreak =
      (!!below && below.club === w.club) || (!!above && above.club === w.club);
    // Label a run only on its newest row (no same-club row above it); count forward run length.
    let tag = '';
    if (!(above && above.club === w.club)) {
      let n = 1;
      let j = i;
      while (winnersRaw[j + 1] && winnersRaw[j + 1]!.club === w.club) {
        n++;
        j++;
      }
      if (n > 1) tag = '×' + n;
    }
    return { ...w, partOfStreak, tag };
  });

  const tally: Record<string, number> = {};
  winnersRaw.forEach((w) => {
    tally[w.club] = (tally[w.club] || 0) + 1;
  });
  const tallyArr = Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxT = tallyArr.length ? tallyArr[0]![1] : 1;

  return (
    <div>
      <div style={{ marginBottom: 6 }}>
        <h1 style={h1Style}>League winners</h1>
        <p style={{ fontSize: 14, color: 'var(--ink-soft,#776F5D)', margin: '10px 0 0' }}>
          Top-division champions, season by season — a roll of honour per country.
        </p>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 14,
          flexWrap: 'wrap',
          margin: '22px 0 18px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={filterLabel}>League</label>
          <select
            value={league}
            onChange={(e) => setLeague(e.target.value as CountryCode)}
            style={selectStyle}
          >
            {COUNTRIES.map((o) => (
              <option key={o.code} value={o.code}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }} />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) 300px',
          gap: 20,
          alignItems: 'start',
        }}
      >
        {/* Roll of honour */}
        <div style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              padding: '16px 22px',
              borderBottom: '1px solid var(--line,#E6DECB)',
            }}
          >
            <div
              style={{
                fontFamily: "'Bricolage Grotesque',sans-serif",
                fontWeight: 700,
                fontSize: 16,
              }}
            >
              {leagueName}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-faint,#A99E86)' }}>
              Division I · roll of honour
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: WINNER_GRID,
              gap: 12,
              padding: '10px 22px',
              fontSize: 10,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              color: 'var(--ink-faint,#A99E86)',
              fontWeight: 700,
              borderBottom: '1px solid var(--line,#E6DECB)',
            }}
          >
            <div>Season</div>
            <div>Champion</div>
            <div style={{ textAlign: 'right' }}>Run</div>
          </div>

          {winners.map((w) => (
            <div
              key={w.season}
              style={{
                display: 'grid',
                gridTemplateColumns: WINNER_GRID,
                gap: 12,
                padding: '12px 22px',
                borderBottom: '1px solid var(--line,#E6DECB)',
                alignItems: 'center',
                borderLeft: '3px solid ' + (w.partOfStreak ? C.accent : 'transparent'),
              }}
            >
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, fontSize: 16 }}>
                {w.season}
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {w.club}
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    color: 'var(--ink-soft,#776F5D)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {w.manager}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {w.tag && (
                  <span
                    style={{
                      flex: 'none',
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '.03em',
                      color: C.accent,
                      background: 'color-mix(in srgb, var(--accent,#B0742A) 14%, transparent)',
                      padding: '2px 7px',
                      borderRadius: 999,
                    }}
                  >
                    {w.tag}
                  </span>
                )}
              </div>
            </div>
          ))}

          <div
            style={{
              padding: '12px 22px',
              fontSize: 11.5,
              color: 'var(--ink-faint,#A99E86)',
              fontFamily: "'JetBrains Mono',monospace",
            }}
          >
            source: leaguedetails · worlddetails
          </div>
        </div>

        {/* Most titles tally */}
        <aside style={{ ...cardStyle, overflow: 'visible', padding: 20 }}>
          <div
            style={{
              fontFamily: "'Bricolage Grotesque',sans-serif",
              fontWeight: 700,
              fontSize: 15,
              marginBottom: 4,
            }}
          >
            Most titles
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-faint,#A99E86)', marginBottom: 16 }}>
            Seasons 66–89 · {leagueName}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {tallyArr.map(([club, count], i) => (
              <div key={club}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: 5,
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {club}
                  </span>
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono',monospace",
                      fontSize: 13,
                      fontWeight: 700,
                      flex: 'none',
                    }}
                  >
                    {count}
                  </span>
                </div>
                <div
                  style={{
                    height: 7,
                    borderRadius: 4,
                    background: 'var(--card-2,#EFE7D6)',
                    overflow: 'hidden',
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      height: '100%',
                      width: (count / maxT) * 100 + '%',
                      background: i === 0 ? C.accent : C.line2,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
