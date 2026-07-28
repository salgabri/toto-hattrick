import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import {
  getCabinet,
  getCupCountries,
  getCups,
  getLeagues,
  getManagers,
  getNationalities,
  getWinners,
  type Country,
  type CupRoll,
  type Manager,
  type TrophyCabinet,
  type TrophyItem,
  type Winner,
} from './data.js';
import { C, CHAMP_COLOR, MAIN_COLOR, MASTERS_COLOR, rootStyle, type Density, type Theme } from './theme.js';
import { leagueFlagUrl, nationalityFlagUrl } from './flags.js';
import './aggregate.css';

/**
 * Toto Hattrick — Aggregate records.
 *
 * Cross-universe aggregate stats over the Hattrick world, wired to the real backend:
 *   - Trophy leaders — managers ranked by top-division titles, nationality + name filters,
 *     expandable trophy cabinets, gold/silver/bronze podium.
 *   - League winners — per-country top-division roll of honour with dynasty highlighting.
 *
 * Backend has league titles only (no cup/other trophies yet), so the cup toggles are inert.
 */

export type View = 'trophies' | 'leagues' | 'cups';

export interface AggregateStatsProps {
  defaultTheme?: Theme;
  accent?: string;
  density?: Density;
  /** Switch to the retro "2000s" look (rendered as a sidebar button when provided). */
  onRetro?: () => void;
}

export function AggregateStats({
  defaultTheme = 'paper',
  accent = '#B0742A',
  density = 'comfortable',
  onRetro,
}: AggregateStatsProps) {
  const [theme, setTheme] = useState<Theme>(defaultTheme);
  const [view, setView] = useState<View>('trophies');
  const toggleTheme = () => setTheme((t) => (t === 'paper' ? 'floodlit' : 'paper'));

  // View state lives on the parent so it survives nav switches.
  const [nation, setNation] = useState<string>('ALL');
  const [query, setQuery] = useState('');
  const [inc, setInc] = useState<IncState>({ champ: true, main: true, sec: false, hm: true });
  const [lastOnly, setLastOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [league, setLeague] = useState<string>('');
  const [cupCountry, setCupCountry] = useState<string>('');

  // Reference lists (loaded once).
  const [nationalities, setNationalities] = useState<Country[]>([]);
  const [leagues, setLeagues] = useState<Country[]>([]);
  const [cupCountries, setCupCountries] = useState<Country[]>([]);

  useEffect(() => {
    getNationalities().then(setNationalities).catch(() => setNationalities([]));
    getLeagues()
      .then((ls) => {
        setLeagues(ls);
        setLeague((cur) => cur || ls.find((x) => x.code === '4')?.code || ls[0]?.code || '');
      })
      .catch(() => setLeagues([]));
    getCupCountries()
      .then((cs) => {
        setCupCountries(cs);
        setCupCountry((cur) => cur || cs.find((x) => x.code === '4')?.code || cs[0]?.code || '');
      })
      .catch(() => setCupCountries([]));
  }, []);

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
        <Sidebar view={view} setView={setView} theme={theme} toggleTheme={toggleTheme} onRetro={onRetro} />
        <main style={{ flex: 1, minWidth: 0, padding: '34px 40px 64px' }}>
          <div style={{ maxWidth: 1080, margin: '0 auto' }}>
            {view === 'trophies' ? (
              <TrophyLeaders
                nationalities={nationalities}
                nation={nation}
                setNation={setNation}
                query={query}
                setQuery={setQuery}
                inc={inc}
                setInc={setInc}
                lastOnly={lastOnly}
                setLastOnly={setLastOnly}
                expandedId={expandedId}
                setExpandedId={setExpandedId}
              />
            ) : view === 'leagues' ? (
              <LeagueWinners leagues={leagues} league={league} setLeague={setLeague} />
            ) : (
              <CupWinners countries={cupCountries} country={cupCountry} setCountry={setCupCountry} />
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
  { key: 'cups', label: 'Cup winners', sub: 'national cups by season' },
];

function Sidebar({
  view,
  setView,
  theme,
  toggleTheme,
  onRetro,
}: {
  view: View;
  setView: (v: View) => void;
  theme: Theme;
  toggleTheme: () => void;
  onRetro?: () => void;
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
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 13, background: 'var(--accent,#B0742A)' }} />
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
          <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 16, lineHeight: 1 }}>
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
            <span style={{ width: 8, height: 8, borderRadius: '50%', flex: 'none', background: active ? C.accent : C.line2 }} />
            <div style={{ textAlign: 'left', minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{n.label}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-faint,#A99E86)', fontWeight: 500 }}>{n.sub}</div>
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
      {onRetro && (
        <button
          onClick={onRetro}
          title="Switch to the 2000s retro look"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            width: '100%',
            marginTop: 8,
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
          <span style={{ fontSize: 15 }}>🖥️</span>
          2000s look
        </button>
      )}
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

const monoFaint: CSSProperties = { fontFamily: "'JetBrains Mono',monospace" };

/** Small country flag (flagcdn SVG). Renders nothing when the country has no flag/unknown code. */
function Flag({ url, label, size = 15 }: { url: string | null; label?: string; size?: number }) {
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      title={label}
      loading="lazy"
      style={{
        width: size,
        height: 'auto',
        borderRadius: 2,
        boxShadow: '0 0 0 1px rgba(0,0,0,.14)',
        flex: 'none',
        display: 'block',
      }}
    />
  );
}

/* ========================== TROPHY LEADERS ========================== */

const TROPHY_GRID = '48px minmax(0,1fr) 96px minmax(120px,196px) 56px 22px';

interface IncState {
  champ: boolean;
  main: boolean;
  sec: boolean;
  hm: boolean;
}

function rankBg(r: number): string {
  return r === 1 ? '#D8A93B' : r === 2 ? '#C7C3B8' : r === 3 ? '#C08A52' : 'transparent';
}

function cabinetCats(tr: TrophyCabinet, inc: IncState, lastOnly: boolean) {
  const pick = (items: TrophyItem[]) => (lastOnly ? items.filter((it) => it.last) : items);
  return [
    { label: 'Championships', dot: CHAMP_COLOR, items: pick(tr.champ), excluded: !inc.champ },
    { label: 'Main cups', dot: MAIN_COLOR, items: pick(tr.main), excluded: !inc.main },
    { label: 'Secondary cups', dot: C.line2, items: pick(tr.sec), excluded: !inc.sec },
    { label: 'Hattrick Masters', dot: MASTERS_COLOR, items: pick(tr.other), excluded: !inc.hm },
  ].filter((c) => c.items.length);
}

function TrophyLeaders({
  nationalities,
  nation,
  setNation,
  query,
  setQuery,
  inc,
  setInc,
  lastOnly,
  setLastOnly,
  expandedId,
  setExpandedId,
}: {
  nationalities: Country[];
  nation: string;
  setNation: Dispatch<SetStateAction<string>>;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  inc: IncState;
  setInc: Dispatch<SetStateAction<IncState>>;
  lastOnly: boolean;
  setLastOnly: Dispatch<SetStateAction<boolean>>;
  expandedId: string | null;
  setExpandedId: Dispatch<SetStateAction<string | null>>;
}) {
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(true);
  const [cabinets, setCabinets] = useState<Record<number, TrophyCabinet | null>>({});

  useEffect(() => {
    setLoading(true);
    getManagers(nation === 'ALL' ? undefined : nation)
      .then(setManagers)
      .catch(() => setManagers([]))
      .finally(() => setLoading(false));
  }, [nation]);

  const toggleInc = (k: keyof IncState) => setInc((s) => ({ ...s, [k]: !s[k] }));
  const toggleExpand = (m: Manager) => {
    setExpandedId((cur) => (cur === String(m.userId) ? null : String(m.userId)));
    if (!(m.userId in cabinets)) {
      setCabinets((c) => ({ ...c, [m.userId]: null }));
      getCabinet(m.userId)
        .then((cab) => setCabinets((c) => ({ ...c, [m.userId]: cab })))
        .catch(() => setCabinets((c) => ({ ...c, [m.userId]: { champ: [], main: [], sec: [], other: [] } })));
    }
  };

  // Ranks are absolute over the fetched field; category flags change the total. "Reigning only"
  // swaps career totals for the last-winner counts, then charts that aggregation the same way.
  const ranked = useMemo(() => {
    const l = managers.map((m) => {
      const lg = lastOnly ? m.lgLast : m.lg;
      const main = lastOnly ? m.mainLast : m.main;
      const sec = lastOnly ? m.secLast : m.sec + m.oth;
      const hm = lastOnly ? m.hmLast : m.hm;
      const ft = (inc.champ ? lg : 0) + (inc.main ? main : 0) + (inc.sec ? sec : 0) + (inc.hm ? hm : 0);
      return { m, ft, lg, main, sec, hm };
    });
    l.sort((a, b) => b.ft - a.ft || b.lg - a.lg);
    return l.map((e, i) => ({ ...e, rank: i + 1 }));
  }, [managers, inc, lastOnly]);

  const q = query.trim().toLowerCase();
  const visible = ranked.filter(
    (e) =>
      (!q || e.m.login.toLowerCase().includes(q)) &&
      (!lastOnly || e.m.lgLast + e.m.mainLast + e.m.secLast + e.m.hmLast > 0),
  );

  const chips: Array<{ k: keyof IncState; label: string }> = [
    { k: 'champ', label: 'Championships' },
    { k: 'main', label: 'Main cups' },
    { k: 'sec', label: 'Secondary' },
    { k: 'hm', label: 'Masters' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 6 }}>
        <div>
          <h1 style={h1Style}>Trophy leaders</h1>
          <p style={{ fontSize: 14, color: 'var(--ink-soft,#776F5D)', margin: '10px 0 0' }}>
            Managers ranked by silverware — league titles, national cups, and the Hattrick Masters.
            Choose which trophies count toward the total below.
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', margin: '22px 0 16px' }}>
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
                    border: on ? '1px solid var(--accent,#B0742A)' : '1px solid var(--line-2,#D8CDB4)',
                    background: on ? 'color-mix(in srgb, var(--accent,#B0742A) 12%, transparent)' : 'transparent',
                    color: on ? C.ink : C.faint,
                  }}
                >
                  {on && <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>✓</span>}
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={filterLabel}>Nationality</label>
          <select value={nation} onChange={(e) => setNation(e.target.value)} style={selectStyle}>
            <option value="ALL">All nationalities</option>
            {nationalities.map((o) => (
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
            placeholder="Manager…"
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={filterLabel}>Recency</label>
          <button
            onClick={() => setLastOnly((v) => !v)}
            title="Count only the last trophy won in each competition — the current champion of every league and holder of every cup"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 12.5,
              fontWeight: 600,
              padding: '9px 13px',
              borderRadius: 10,
              border: lastOnly ? '1px solid var(--accent,#B0742A)' : '1px solid var(--line-2,#D8CDB4)',
              background: lastOnly ? 'color-mix(in srgb, var(--accent,#B0742A) 12%, transparent)' : 'var(--card,#FCFAF4)',
              color: lastOnly ? C.ink : C.soft,
            }}
          >
            {lastOnly && <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>✓</span>}
            Reigning only
          </button>
        </div>

        <div style={{ flex: 1 }} />
        <div style={{ ...monoFaint, fontSize: 12.5, color: 'var(--ink-soft,#776F5D)' }}>{visible.length} managers</div>
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
          const isExp = expandedId === String(m.userId);
          const cab = isExp ? cabinets[m.userId] : undefined;

          const segRaw: Array<{ n: number; color: string }> = [];
          if (inc.champ && e.lg) segRaw.push({ n: e.lg, color: CHAMP_COLOR });
          if (inc.main && e.main) segRaw.push({ n: e.main, color: MAIN_COLOR });
          if (inc.sec && e.sec) segRaw.push({ n: e.sec, color: C.line2 });
          if (inc.hm && e.hm) segRaw.push({ n: e.hm, color: MASTERS_COLOR });
          const tot = e.ft || 1;
          const breakdown = segRaw.map((s) => s.n).join(' · ') || '0';

          return (
            <div key={m.userId} style={{ borderBottom: '1px solid var(--line,#E6DECB)' }}>
              <div
                className="mgr-row"
                onClick={() => toggleExpand(m)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: TROPHY_GRID,
                  gap: 14,
                  padding: '13px 22px',
                  alignItems: 'center',
                  ...(isExp ? { background: 'color-mix(in srgb, var(--accent,#B0742A) 7%, transparent)' } : null),
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
                  <div style={{ fontSize: 14.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a
                      href={`https://www.hattrick.org/en/Club/Manager/?userId=${m.userId}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(ev) => ev.stopPropagation()}
                      style={{ color: 'inherit', textDecoration: 'none' }}
                    >
                      {m.login}
                    </a>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-soft,#776F5D)', ...monoFaint }}>#{m.userId}</div>
                </div>
                <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
                  <Flag url={nationalityFlagUrl(m.c)} label={m.c} />
                  <span
                    title={m.c}
                    style={{
                      display: 'inline-block',
                      minWidth: 0,
                      maxWidth: '100%',
                      fontFamily: "'JetBrains Mono',monospace",
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: '.03em',
                      padding: '3px 7px',
                      borderRadius: 6,
                      background: 'var(--card-2,#EFE7D6)',
                      color: 'var(--ink-soft,#776F5D)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      boxSizing: 'border-box',
                    }}
                  >
                    {m.c}
                  </span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ height: 9, borderRadius: 5, overflow: 'hidden', display: 'flex', background: 'var(--card-2,#EFE7D6)' }}>
                    {segRaw.map((sg, i) => (
                      <span key={i} style={{ width: (sg.n / tot) * 100 + '%', background: sg.color }} />
                    ))}
                  </div>
                  <div style={{ ...monoFaint, fontSize: 10.5, color: 'var(--ink-faint,#A99E86)', marginTop: 5 }}>{breakdown}</div>
                </div>
                <div style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontSize: 20, fontWeight: 700 }}>{e.ft}</div>
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
                <div style={{ padding: '10px 22px 22px 84px', background: 'color-mix(in srgb, var(--accent,#B0742A) 4%, transparent)' }}>
                  {cab == null ? (
                    <div style={{ color: 'var(--ink-faint,#A99E86)', fontSize: 12.5 }}>Loading cabinet…</div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px 34px' }}>
                      {cabinetCats(cab, inc, lastOnly).map((g) => (
                        <div key={g.label} style={{ flex: 1, minWidth: 186, opacity: g.excluded ? 0.45 : 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 11 }}>
                            <span style={{ width: 9, height: 9, borderRadius: 3, flex: 'none', background: g.dot }} />
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
                            <span style={{ ...monoFaint, fontSize: 11, color: 'var(--ink-faint,#A99E86)' }}>{g.items.length}</span>
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
                              <div key={i} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {it.main}
                                  </div>
                                  <div style={{ fontSize: 11, color: 'var(--ink-faint,#A99E86)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {it.sub}
                                  </div>
                                </div>
                                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color: 'var(--ink-soft,#776F5D)', flex: 'none' }}>
                                  {it.season}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {loading && (
          <div style={{ padding: '28px 22px', textAlign: 'center', color: 'var(--ink-faint,#A99E86)', fontSize: 13 }}>Loading managers…</div>
        )}
        {!loading && visible.length === 0 && (
          <div style={{ padding: '28px 22px', textAlign: 'center', color: 'var(--ink-faint,#A99E86)', fontSize: 13 }}>
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
        <LegendSwatch color="#7A5EA6" label="Masters" />
        <span style={{ flex: 1 }} />
        <span style={{ ...monoFaint, color: 'var(--ink-soft,#776F5D)', fontWeight: 400 }}>source: leaguefixtures · team history</span>
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

/** Mark each winner that's part of a back-to-back run, and tag a run's first row with ×N. */
function withRuns<T extends { club: string; season: number }>(rows: T[]): Array<T & { partOfStreak: boolean; tag: string }> {
  return rows.map((w, i) => {
    const below = rows[i + 1];
    const above = rows[i - 1];
    const partOfStreak = (!!below && below.club === w.club) || (!!above && above.club === w.club);
    let tag = '';
    if (!(above && above.club === w.club)) {
      let n = 1;
      let j = i;
      while (rows[j + 1] && rows[j + 1]!.club === w.club) {
        n++;
        j++;
      }
      if (n > 1) tag = '×' + n;
    }
    return { ...w, partOfStreak, tag };
  });
}

function LeagueWinners({
  leagues,
  league,
  setLeague,
}: {
  leagues: Country[];
  league: string;
  setLeague: Dispatch<SetStateAction<string>>;
}) {
  const [winnersRaw, setWinnersRaw] = useState<Winner[]>([]);
  const [loading, setLoading] = useState(true);
  const leagueName = leagues.find((l) => l.code === league)?.name ?? '';

  useEffect(() => {
    if (!league) return;
    setLoading(true);
    getWinners(league)
      .then(setWinnersRaw)
      .catch(() => setWinnersRaw([]))
      .finally(() => setLoading(false));
  }, [league]);

  const winners = winnersRaw.map((w, i) => {
    const below = winnersRaw[i + 1];
    const above = winnersRaw[i - 1];
    const partOfStreak = (!!below && below.club === w.club) || (!!above && above.club === w.club);
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
  const seasonRange = winnersRaw.length ? `S${winnersRaw[winnersRaw.length - 1]!.season}–S${winnersRaw[0]!.season}` : '—';

  return (
    <div>
      <div style={{ marginBottom: 6 }}>
        <h1 style={h1Style}>League winners</h1>
        <p style={{ fontSize: 14, color: 'var(--ink-soft,#776F5D)', margin: '10px 0 0' }}>
          Top-division champions, season by season — a roll of honour per country.
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', margin: '22px 0 18px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={filterLabel}>League</label>
          <select value={league} onChange={(e) => setLeague(e.target.value)} style={selectStyle}>
            {leagues.map((o) => (
              <option key={o.code} value={o.code}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 20, alignItems: 'start' }}>
        {/* Roll of honour */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 22px', borderBottom: '1px solid var(--line,#E6DECB)' }}>
            <Flag url={leagueFlagUrl(league)} label={leagueName} size={22} />
            <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 16 }}>{leagueName}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-faint,#A99E86)' }}>Division I · roll of honour</div>
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
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, fontSize: 16 }}>{w.season}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.club}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-soft,#776F5D)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

          {loading && (
            <div style={{ padding: '24px 22px', color: 'var(--ink-faint,#A99E86)', fontSize: 13 }}>Loading…</div>
          )}
          {!loading && winnersRaw.length === 0 && (
            <div style={{ padding: '24px 22px', color: 'var(--ink-faint,#A99E86)', fontSize: 13 }}>No champions stored for this country yet.</div>
          )}

          <div style={{ padding: '12px 22px', fontSize: 11.5, color: 'var(--ink-faint,#A99E86)', fontFamily: "'JetBrains Mono',monospace" }}>
            source: leaguefixtures · team history
          </div>
        </div>

        {/* Most titles tally */}
        <aside style={{ ...cardStyle, overflow: 'visible', padding: 20 }}>
          <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Most titles</div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-faint,#A99E86)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Flag url={leagueFlagUrl(league)} label={leagueName} size={13} />
            {seasonRange} · {leagueName}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {tallyArr.map(([club, count], i) => (
              <div key={club}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5, gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{club}</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 700, flex: 'none' }}>{count}</span>
                </div>
                <div style={{ height: 7, borderRadius: 4, background: 'var(--card-2,#EFE7D6)', overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: (count / maxT) * 100 + '%', background: i === 0 ? C.accent : C.line2 }} />
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* =========================== CUP WINNERS =========================== */

function CupWinners({
  countries,
  country,
  setCountry,
}: {
  countries: Country[];
  country: string;
  setCountry: Dispatch<SetStateAction<string>>;
}) {
  const [cups, setCups] = useState<CupRoll[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!country) return;
    setLoading(true);
    getCups(country)
      .then(setCups)
      .catch(() => setCups([]))
      .finally(() => setLoading(false));
  }, [country]);

  const main = cups.find((c) => c.isMain) ?? null;
  const secondary = cups.filter((c) => !c.isMain);

  return (
    <div>
      <div style={{ marginBottom: 6 }}>
        <h1 style={h1Style}>Cup winners</h1>
        <p style={{ fontSize: 14, color: 'var(--ink-soft,#776F5D)', margin: '10px 0 0' }}>
          National cup honours, season by season — the main cup plus its secondary and consolation cups.
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', margin: '22px 0 18px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label style={filterLabel}>Country</label>
          <select value={country} onChange={(e) => setCountry(e.target.value)} style={selectStyle}>
            {countries.map((o) => (
              <option key={o.code} value={o.code}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }} />
      </div>

      {loading && <div style={{ padding: '24px 2px', color: 'var(--ink-faint,#A99E86)', fontSize: 13 }}>Loading…</div>}
      {!loading && cups.length === 0 && (
        <div style={{ padding: '24px 2px', color: 'var(--ink-faint,#A99E86)', fontSize: 13 }}>No cup winners stored for this country yet.</div>
      )}

      {!loading && main && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 20, marginBottom: 20 }}>
          <CupCard cup={main} accent={MAIN_COLOR} tall />
        </div>
      )}

      {!loading && secondary.length > 0 && (
        <>
          <div style={{ ...filterLabel, margin: '4px 0 12px' }}>Secondary &amp; consolation cups</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 20, alignItems: 'start' }}>
            {secondary.map((c) => (
              <CupCard key={c.cupId} cup={c} accent={C.line2} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CupCard({ cup, accent, tall = false }: { cup: CupRoll; accent: string; tall?: boolean }) {
  const winners = withRuns(cup.winners);
  const range = cup.winners.length ? `S${cup.winners[cup.winners.length - 1]!.season}–S${cup.winners[0]!.season}` : '—';
  const showManager = cup.isMain && cup.winners.some((w) => w.manager && w.manager !== '—');

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '16px 22px', borderBottom: '1px solid var(--line,#E6DECB)' }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, flex: 'none', background: accent }} />
        <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: tall ? 17 : 15, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {cup.cupName}
        </div>
        <div style={{ ...monoFaint, fontSize: 11.5, color: 'var(--ink-faint,#A99E86)', flex: 'none' }}>{range}</div>
      </div>
      <div style={{ maxHeight: tall ? 'none' : 340, overflowY: tall ? 'visible' : 'auto' }}>
        {winners.map((w) => (
          <div
            key={w.season}
            style={{
              display: 'grid',
              gridTemplateColumns: WINNER_GRID,
              gap: 12,
              padding: '10px 22px',
              borderBottom: '1px solid var(--line,#E6DECB)',
              alignItems: 'center',
              borderLeft: '3px solid ' + (w.partOfStreak ? accent : 'transparent'),
            }}
          >
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, fontSize: 15 }}>{w.season}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.club}</div>
              {showManager && w.manager !== '—' && (
                <div style={{ fontSize: 11.5, color: 'var(--ink-soft,#776F5D)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.manager}</div>
              )}
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
      </div>
      <div style={{ padding: '10px 22px', fontSize: 11.5, color: 'var(--ink-faint,#A99E86)', fontFamily: "'JetBrains Mono',monospace" }}>
        {cup.winners.length} finals · source: cupmatches
      </div>
    </div>
  );
}
