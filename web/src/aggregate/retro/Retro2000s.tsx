import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, Dispatch, ReactNode, SetStateAction } from 'react';
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
  type Winner,
} from '../data.js';
import { leagueFlagUrl, nationalityFlagUrl } from '../flags.js';
import { R, MONO, rootStyle2000s, type Density2000s, type Skin } from './theme2000s.js';
import './retro2000s.css';

/**
 * Toto Hattrick — the "2000s" retro look (from `Toto Hattrick 2000s.dc.html`).
 *
 * A Windows-98/early-web reskin of the Aggregate records: a framed window with a gradient banner,
 * folder tabs, groove fieldsets, outset/inset buttons, a status bar and a hit-counter footer.
 * Wired to the SAME real baked data as the modern look (`../data.js`), and carries the newer
 * features the original mock never had — country flags and the full Cup winners view.
 *
 * Backend honesty (identical to the modern look): only top-division LEAGUE titles exist, so a
 * manager's `cup`/`oth` are 0 and their cabinet holds championships only. The Main/Secondary
 * toggles therefore stay inert for the total — kept for fidelity to the design.
 */

export type RetroView = 'trophies' | 'leagues' | 'cups';

export interface Retro2000sProps {
  defaultSkin?: Skin;
  defaultDensity?: Density2000s;
  /** Switch back to the modern look (rendered as a banner button when provided). */
  onExit?: () => void;
}

export function Retro2000s({ defaultSkin = 'green', defaultDensity = 'comfortable', onExit }: Retro2000sProps) {
  const [skin, setSkin] = useState<Skin>(defaultSkin);
  const [density, setDensity] = useState<Density2000s>(defaultDensity);
  const [view, setView] = useState<RetroView>('trophies');

  // View state lives on the parent so it survives tab switches.
  const [nation, setNation] = useState<string>('ALL');
  const [query, setQuery] = useState('');
  const [inc, setInc] = useState<IncState>({ champ: true, main: true, sec: false });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [league, setLeague] = useState<string>('');
  const [cupCountry, setCupCountry] = useState<string>('');
  const [status, setStatus] = useState('Ready.');

  // Reference lists (loaded once).
  const [nationalities, setNationalities] = useState<Country[]>([]);
  const [leagues, setLeagues] = useState<Country[]>([]);
  const [cupCountries, setCupCountries] = useState<Country[]>([]);
  const [managersTracked, setManagersTracked] = useState<number | null>(null);

  useEffect(() => {
    getNationalities().then(setNationalities).catch(() => setNationalities([]));
    getManagers()
      .then((ms) => setManagersTracked(ms.length))
      .catch(() => setManagersTracked(null));
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

  const skinBtn: CSSProperties = {
    border: '2px outset var(--btn,#EBEFE2)',
    background: R.btn,
    color: '#222',
    padding: '3px 10px',
    cursor: 'pointer',
    fontWeight: 'bold',
    fontSize: 10,
    fontFamily: 'inherit',
  };

  return (
    <div className="th2000s" style={rootStyle2000s(skin, density)}>
      <div
        style={{
          maxWidth: 980,
          margin: '0 auto',
          border: '2px solid var(--frame,#617D54)',
          background: R.panel,
          boxShadow: 'inset 0 0 0 1px var(--framelt,#9DB491),0 5px 16px rgba(0,0,0,.18)',
        }}
      >
        {/* ===================== BANNER ===================== */}
        <div
          style={{
            background: 'linear-gradient(180deg,var(--bar1,#729A5F),var(--bar2,#4E7642))',
            color: R.barink,
            padding: '11px 15px',
            display: 'flex',
            alignItems: 'center',
            gap: 13,
            borderBottom: '2px solid var(--frame,#617D54)',
          }}
        >
          <div
            style={{
              width: 46,
              height: 46,
              border: '2px outset var(--btn,#EBEFE2)',
              background: R.mod,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
            }}
          >
            <span style={{ fontWeight: 'bold', fontSize: 20, fontStyle: 'italic', color: '#fff', textShadow: '1px 1px 0 rgba(0,0,0,.45)' }}>
              TH
            </span>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 'bold', fontStyle: 'italic', letterSpacing: '.4px', textShadow: '1px 1px 0 rgba(0,0,0,.45)', lineHeight: 1 }}>
              Toto&nbsp;Hattrick
            </div>
            <div style={{ fontSize: 10, marginTop: 5, letterSpacing: '.3px', opacity: 0.92 }}>
              The Hattrick Almanac &middot; aggregate records
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'flex-end' }}>
            <div style={{ fontSize: 10, opacity: 0.92 }}>
              {managersTracked == null ? 'loading…' : `${managersTracked.toLocaleString()} managers tracked`}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setSkin((s) => (s === 'green' ? 'blue' : 'green'))} style={skinBtn}>
                Skin: {skin === 'green' ? 'Green' : 'Blue'}
              </button>
              <button onClick={() => setDensity((d) => (d === 'comfortable' ? 'compact' : 'comfortable'))} style={skinBtn}>
                {density === 'comfortable' ? 'Compact' : 'Comfortable'}
              </button>
              {onExit && (
                <button onClick={onExit} style={skinBtn}>
                  Modern view »
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ===================== TABS ===================== */}
        <div
          style={{
            background: R.bar2,
            padding: '5px 8px 0',
            display: 'flex',
            gap: 3,
            borderBottom: '2px solid var(--frame,#617D54)',
          }}
        >
          {NAV.map((n) => (
            <Tab key={n.key} label={n.label} active={view === n.key} onClick={() => setView(n.key)} />
          ))}
        </div>

        {/* ===================== CONTENT ===================== */}
        <div style={{ padding: 14, background: R.panel }}>
          {view === 'trophies' ? (
            <RetroTrophyLeaders
              nationalities={nationalities}
              nation={nation}
              setNation={setNation}
              query={query}
              setQuery={setQuery}
              inc={inc}
              setInc={setInc}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
              onStatus={setStatus}
            />
          ) : view === 'leagues' ? (
            <RetroLeagueWinners leagues={leagues} league={league} setLeague={setLeague} onStatus={setStatus} />
          ) : (
            <RetroCupWinners countries={cupCountries} country={cupCountry} setCountry={setCupCountry} onStatus={setStatus} />
          )}
        </div>

        {/* ===================== STATUS BAR ===================== */}
        <div
          style={{
            borderTop: '1px solid var(--framelt,#9DB491)',
            background: R.panel2,
            padding: '3px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 10,
            color: R.soft,
          }}
        >
          <span style={statusChip}>{status}</span>
          <span style={{ flex: 1 }} />
          <span style={statusChip}>CHPP</span>
          <span style={statusChip}>Aggregate archive</span>
        </div>

        {/* ===================== FOOTER ===================== */}
        <div
          style={{
            background: 'linear-gradient(180deg,var(--bar1,#729A5F),var(--bar2,#4E7642))',
            color: R.barink,
            borderTop: '2px solid var(--frame,#617D54)',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            fontSize: 10,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ opacity: 0.92 }}>
            &copy; Toto Hattrick. Fan project, not affiliated with Hattrick / Extralives AB. Data via CHPP.
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: 0.95 }}>
            Visitors:
            <span style={counterStyle}>137492</span>
          </span>
          <span style={{ opacity: 0.85 }}>Best viewed at 1024&times;768</span>
        </div>
      </div>
    </div>
  );
}

/* ============================== NAV / TABS ============================== */

const NAV: Array<{ key: RetroView; label: string }> = [
  { key: 'trophies', label: 'Trophy leaders' },
  { key: 'leagues', label: 'League winners' },
  { key: 'cups', label: 'Cup winners' },
];

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  const base: CSSProperties = {
    padding: '7px 18px',
    border: '1px solid var(--frame,#617D54)',
    borderBottom: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: -2,
  };
  const style: CSSProperties = active
    ? { ...base, background: R.panel, color: R.mod, borderTop: '3px solid var(--main,#B07E2A)', position: 'relative', zIndex: 2 }
    : {
        ...base,
        background: 'transparent',
        color: 'rgba(255,255,255,.82)',
        borderColor: 'transparent',
        borderTop: '3px solid transparent',
        textShadow: '1px 1px 0 rgba(0,0,0,.35)',
      };
  return (
    <button className="retro-tab" onClick={onClick} style={style}>
      {label}
    </button>
  );
}

/* ============================== SHARED ============================== */

const statusChip: CSSProperties = {
  border: '1px inset var(--btn,#EBEFE2)',
  background: R.panel,
  padding: '1px 8px',
};

const counterStyle: CSSProperties = {
  fontFamily: MONO,
  background: '#0b0b0b',
  color: '#63f06a',
  border: '2px inset #3a3a3a',
  padding: '1px 6px',
  letterSpacing: '3px',
  fontWeight: 'bold',
};

const fieldset: CSSProperties = {
  border: '2px groove var(--btn,#EBEFE2)',
  margin: '0 0 14px',
  padding: '9px 12px 12px',
};

const legend: CSSProperties = { fontWeight: 'bold', fontSize: 11, color: R.mod, padding: '0 6px' };

const filterLabel: CSSProperties = {
  fontSize: 10,
  fontWeight: 'bold',
  color: R.soft,
  marginBottom: 5,
  textTransform: 'uppercase',
  letterSpacing: '.04em',
};

const selectStyle: CSSProperties = {
  border: '2px inset var(--btn,#EBEFE2)',
  background: '#fff',
  color: R.ink,
  fontSize: 11,
  padding: '3px 4px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const intro: CSSProperties = { fontSize: 11, color: R.soft, margin: '0 0 12px', lineHeight: 1.55 };

/** Section title bar — the ◆ gradient header used on every framed panel. */
function SectionBar({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: 'linear-gradient(180deg,var(--mod2,#6F975C),var(--mod,#567E47))',
        color: R.modink,
        fontWeight: 'bold',
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: '.05em',
        padding: '5px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        borderBottom: '1px solid var(--frame,#617D54)',
      }}
    >
      <span style={{ color: R.main, fontSize: 12 }}>◆</span>
      {children}
    </div>
  );
}

/** Small country flag (self-hosted SVG). Renders nothing for unknown/missing codes. */
function Flag({ url, label, size = 14 }: { url: string | null; label?: string; size?: number }) {
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      title={label}
      loading="lazy"
      style={{ width: size, height: 'auto', border: '1px solid rgba(0,0,0,.28)', flex: 'none', display: 'block' }}
    />
  );
}

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

const runTag: CSSProperties = {
  display: 'inline-block',
  fontSize: 9,
  fontWeight: 'bold',
  letterSpacing: '.02em',
  color: R.main,
  background: R.selrow,
  border: '1px solid var(--main,#B07E2A)',
  padding: '1px 5px',
};

/* ========================== TROPHY LEADERS ========================== */

const RETRO_TROPHY_GRID = '46px minmax(0,1fr) 92px minmax(110px,200px) 56px 22px';

interface IncState {
  champ: boolean;
  main: boolean;
  sec: boolean;
}

function rankBg(r: number): string {
  return r === 1 ? '#D8A93B' : r === 2 ? '#C7C3B8' : r === 3 ? '#C08A52' : 'transparent';
}

function cabinetCats(tr: TrophyCabinet, inc: IncState) {
  return [
    { label: 'Championships', dot: R.champ, items: tr.champ, excluded: !inc.champ },
    { label: 'Main cups', dot: R.main, items: tr.main, excluded: !inc.main },
    { label: 'Secondary cups', dot: R.sec, items: tr.sec, excluded: !inc.sec },
    { label: 'Other honours', dot: R.sec, items: tr.other, excluded: !inc.sec },
  ].filter((c) => c.items.length);
}

function RetroTrophyLeaders({
  nationalities,
  nation,
  setNation,
  query,
  setQuery,
  inc,
  setInc,
  expandedId,
  setExpandedId,
  onStatus,
}: {
  nationalities: Country[];
  nation: string;
  setNation: Dispatch<SetStateAction<string>>;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  inc: IncState;
  setInc: Dispatch<SetStateAction<IncState>>;
  expandedId: string | null;
  setExpandedId: Dispatch<SetStateAction<string | null>>;
  onStatus: (s: string) => void;
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

  // Ranks are absolute over the fetched field; category flags change the total.
  const ranked = useMemo(() => {
    const l = managers.map((m) => {
      const mc = Math.ceil(m.cup / 2);
      const ft = (inc.champ ? m.lg : 0) + (inc.main ? mc : 0) + (inc.sec ? m.cup - mc + m.oth : 0);
      return { m, ft };
    });
    l.sort((a, b) => b.ft - a.ft || b.m.lg - a.m.lg);
    return l.map((e, i) => ({ ...e, rank: i + 1 }));
  }, [managers, inc]);

  const q = query.trim().toLowerCase();
  const visible = ranked.filter((e) => !q || e.m.login.toLowerCase().includes(q) || (e.m.team && e.m.team.toLowerCase().includes(q)));

  useEffect(() => {
    if (!loading) onStatus(`Done. ${visible.length} record(s).`);
  }, [loading, visible.length, onStatus]);

  const chips: Array<{ k: keyof IncState; label: string }> = [
    { k: 'champ', label: 'Championships' },
    { k: 'main', label: 'Main cups' },
    { k: 'sec', label: 'Secondary' },
  ];

  return (
    <div>
      <div style={intro}>
        Managers ranked by top-division titles won across all of their clubs. Cup attribution is still landing, so the Main
        &amp; Secondary toggles stay inert for now &mdash; set what counts below.
      </div>

      {/* Filters */}
      <fieldset style={fieldset}>
        <legend style={legend}>Filters</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 20px', alignItems: 'flex-end' }}>
          <div>
            <div style={filterLabel}>Counting toward total</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {chips.map((c) => {
                const on = inc[c.k];
                const style: CSSProperties = on
                  ? {
                      display: 'inline-flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: 11,
                      padding: '4px 10px',
                      border: '2px inset var(--btn,#EBEFE2)',
                      background: R.btn2,
                      color: R.ink,
                      fontWeight: 'bold',
                    }
                  : {
                      display: 'inline-flex',
                      alignItems: 'center',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontSize: 11,
                      padding: '4px 10px',
                      border: '2px outset var(--btn,#EBEFE2)',
                      background: 'linear-gradient(180deg,#fff,var(--btn,#EBEFE2))',
                      color: R.soft,
                      fontWeight: 'normal',
                    };
                return (
                  <button key={c.k} onClick={() => toggleInc(c.k)} style={style}>
                    {on && <span>✓&nbsp;</span>}
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div style={filterLabel}>Nationality</div>
            <select value={nation} onChange={(e) => setNation(e.target.value)} style={selectStyle}>
              <option value="ALL">All nationalities</option>
              {nationalities.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div style={filterLabel}>Search</div>
            <input
              className="retro-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Manager or club…"
              style={{ width: 190, border: '2px inset var(--btn,#EBEFE2)', background: '#fff', color: R.ink, fontSize: 11, padding: '3px 6px', outline: 'none', fontFamily: 'inherit' }}
            />
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 10, color: R.soft }}>{visible.length} shown</div>
        </div>
      </fieldset>

      {/* Leaderboard */}
      <div style={{ border: '1px solid var(--frame,#617D54)' }}>
        <SectionBar>Trophy leaders</SectionBar>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: RETRO_TROPHY_GRID,
            gap: 10,
            padding: '6px 10px',
            background: R.panel2,
            borderBottom: '2px solid var(--frame,#617D54)',
            fontSize: 10,
            fontWeight: 'bold',
            textTransform: 'uppercase',
            letterSpacing: '.03em',
            color: R.soft,
            alignItems: 'center',
          }}
        >
          <div>Rank</div>
          <div>Manager</div>
          <div>Nat.</div>
          <div>Trophy mix</div>
          <div style={{ textAlign: 'right' }}>Total</div>
          <div />
        </div>

        {visible.map((e, i) => {
          const m = e.m;
          const r = e.rank;
          const top = r <= 3;
          const isExp = expandedId === String(m.userId);
          const mc = Math.ceil(m.cup / 2);
          const sc = m.cup - mc;
          const cab = isExp ? cabinets[m.userId] : undefined;

          const segRaw: Array<{ n: number; color: string }> = [];
          if (inc.champ && m.lg) segRaw.push({ n: m.lg, color: R.champ });
          if (inc.main && mc) segRaw.push({ n: mc, color: R.main });
          if (inc.sec && sc + m.oth) segRaw.push({ n: sc + m.oth, color: R.sec });
          const tot = e.ft || 1;
          const breakdown = segRaw.map((s) => s.n).join(' + ') || '0';
          const baseBg = i % 2 ? R.alt : R.panel;

          return (
            <div key={m.userId}>
              <div
                className="retro-row"
                role="button"
                tabIndex={0}
                aria-expanded={isExp}
                onClick={() => toggleExpand(m)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    toggleExpand(m);
                  }
                }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: RETRO_TROPHY_GRID,
                  gap: 10,
                  padding: 'var(--rp,7px) 10px',
                  borderBottom: '1px solid var(--line,#CDD7C3)',
                  alignItems: 'center',
                  cursor: 'pointer',
                  background: isExp ? R.selrow : baseBg,
                }}
              >
                <div>
                  <span
                    style={
                      top
                        ? {
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 26,
                            height: 18,
                            border: '1px solid rgba(0,0,0,.4)',
                            background: rankBg(r),
                            color: '#241c08',
                            fontWeight: 'bold',
                            fontSize: 12,
                            fontFamily: MONO,
                          }
                        : { display: 'inline-block', textAlign: 'center', width: 26, color: R.soft, fontWeight: 'bold', fontSize: 13, fontFamily: MONO }
                    }
                  >
                    {r}
                  </span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 'bold', color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                  <div style={{ fontSize: 10, color: R.soft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.team || `#${m.userId}`}
                  </div>
                </div>
                <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Flag url={nationalityFlagUrl(m.c)} label={m.c} />
                  <span
                    title={m.c}
                    style={{
                      display: 'inline-block',
                      minWidth: 0,
                      fontWeight: 'bold',
                      fontSize: 10,
                      padding: '1px 5px',
                      border: '1px solid var(--line,#CDD7C3)',
                      background: R.panel2,
                      color: R.soft,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {m.c}
                  </span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ height: 11, border: '1px solid var(--frame,#617D54)', background: R.panel2, display: 'flex', overflow: 'hidden' }}>
                    {segRaw.map((sg, ix) => (
                      <span key={ix} style={{ width: (sg.n / tot) * 100 + '%', background: sg.color, borderRight: '1px solid rgba(0,0,0,.2)' }} />
                    ))}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 10, color: R.faint, marginTop: 4 }}>{breakdown}</div>
                </div>
                <div style={{ textAlign: 'right', fontFamily: MONO, fontSize: 17, fontWeight: 'bold', color: R.ink }}>{e.ft}</div>
                <div style={{ textAlign: 'center' }}>
                  <span
                    aria-hidden
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 15,
                      height: 15,
                      border: '1px solid var(--line,#CDD7C3)',
                      background: R.panel2,
                      color: R.soft,
                      fontWeight: 'bold',
                      fontSize: 12,
                      lineHeight: 1,
                      fontFamily: MONO,
                    }}
                  >
                    {isExp ? '−' : '+'}
                  </span>
                </div>
              </div>

              {isExp && (
                <div style={{ padding: '10px 12px 12px 66px', background: R.panel2, borderBottom: '1px solid var(--line,#CDD7C3)' }}>
                  <div style={{ border: '2px inset var(--btn,#EBEFE2)', background: R.panel, padding: 10, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {cab == null ? (
                      <div style={{ color: R.faint, fontSize: 11 }}>Loading cabinet…</div>
                    ) : cabinetCats(cab, inc).length === 0 ? (
                      <div style={{ color: R.faint, fontSize: 11 }}>No trophies on record.</div>
                    ) : (
                      cabinetCats(cab, inc).map((g) => (
                        <div key={g.label} style={{ flex: 1, minWidth: 190, border: '1px solid var(--line,#CDD7C3)', background: R.panel, padding: '8px 10px', opacity: g.excluded ? 0.5 : 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 9, borderBottom: '1px solid var(--line,#CDD7C3)', paddingBottom: 5 }}>
                            <span style={{ width: 9, height: 9, flex: 'none', border: '1px solid rgba(0,0,0,.3)', background: g.dot }} />
                            <span style={{ fontSize: 10, letterSpacing: '.05em', textTransform: 'uppercase', fontWeight: 'bold', color: R.soft }}>{g.label}</span>
                            <span style={{ fontFamily: MONO, fontSize: 11, color: R.faint }}>×{g.items.length}</span>
                            {g.excluded && (
                              <span style={{ fontSize: 9, fontWeight: 'bold', letterSpacing: '.03em', textTransform: 'uppercase', color: R.faint }}>[excluded]</span>
                            )}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                            {g.items.map((it, ix) => (
                              <div key={ix} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: 11, fontWeight: 'bold', color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.main}</div>
                                  <div style={{ fontSize: 10, color: R.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.sub}</div>
                                </div>
                                <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 'bold', color: R.soft, flex: 'none' }}>{it.season}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {loading && <div style={{ padding: '22px 12px', textAlign: 'center', color: R.faint, fontSize: 11 }}>Loading managers…</div>}
        {!loading && visible.length === 0 && (
          <div style={{ padding: '22px 12px', textAlign: 'center', color: R.faint, fontSize: 11 }}>No managers match your search.</div>
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 9, fontSize: 10, color: R.ink, flexWrap: 'wrap' }}>
        <b style={{ color: R.soft, textTransform: 'uppercase', letterSpacing: '.04em' }}>Legend:</b>
        <LegendSwatch color={R.champ} label="Championships" />
        <LegendSwatch color={R.main} label="Main cups" />
        <LegendSwatch color={R.sec} label="Secondary" />
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: MONO, color: R.faint }}>src: leaguefixtures &middot; team history</span>
      </div>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 10, height: 10, border: '1px solid rgba(0,0,0,.3)', background: color }} />
      {label}
    </span>
  );
}

/* ========================== LEAGUE WINNERS ========================== */

const RETRO_WINNER_GRID = '64px minmax(0,1fr) 66px';

function RetroLeagueWinners({
  leagues,
  league,
  setLeague,
  onStatus,
}: {
  leagues: Country[];
  league: string;
  setLeague: Dispatch<SetStateAction<string>>;
  onStatus: (s: string) => void;
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

  useEffect(() => {
    if (!loading) onStatus(`Done. ${winnersRaw.length} season(s) loaded.`);
  }, [loading, winnersRaw.length, onStatus]);

  const winners = withRuns(winnersRaw);
  const tally: Record<string, number> = {};
  winnersRaw.forEach((w) => {
    tally[w.club] = (tally[w.club] || 0) + 1;
  });
  const tallyArr = Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxT = tallyArr.length ? tallyArr[0]![1] : 1;
  const span = winnersRaw.length ? `Seasons ${winnersRaw[winnersRaw.length - 1]!.season}–${winnersRaw[0]!.season} · ${leagueName}` : leagueName;

  return (
    <div>
      <div style={intro}>Top-division champions, season by season &mdash; a roll of honour per country.</div>

      <fieldset style={fieldset}>
        <legend style={legend}>Select league</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 20px', alignItems: 'flex-end' }}>
          <div>
            <div style={filterLabel}>Country</div>
            <select value={league} onChange={(e) => setLeague(e.target.value)} style={selectStyle}>
              {leagues.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 10, color: R.soft }}>{span}</div>
        </div>
      </fieldset>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 14, alignItems: 'start' }}>
        {/* Roll of honour */}
        <div style={{ border: '1px solid var(--frame,#617D54)' }}>
          <SectionBar>
            <Flag url={leagueFlagUrl(league)} label={leagueName} size={16} />
            {leagueName} &mdash; Division I roll of honour
          </SectionBar>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: RETRO_WINNER_GRID,
              gap: 10,
              padding: '6px 10px',
              background: R.panel2,
              borderBottom: '2px solid var(--frame,#617D54)',
              fontSize: 10,
              fontWeight: 'bold',
              textTransform: 'uppercase',
              letterSpacing: '.03em',
              color: R.soft,
            }}
          >
            <div>Season</div>
            <div>Champion</div>
            <div style={{ textAlign: 'right' }}>Run</div>
          </div>

          {winners.map((w, i) => (
            <div
              key={w.season}
              style={{
                display: 'grid',
                gridTemplateColumns: RETRO_WINNER_GRID,
                gap: 10,
                padding: 'var(--rp,7px) 10px',
                borderBottom: '1px solid var(--line,#CDD7C3)',
                alignItems: 'center',
                borderLeft: '3px solid ' + (w.partOfStreak ? R.main : 'transparent'),
                background: i % 2 ? R.alt : R.panel,
              }}
            >
              <div style={{ fontFamily: MONO, fontWeight: 'bold', fontSize: 14, color: R.ink }}>S{w.season}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 'bold', color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.club}</div>
                <div style={{ fontSize: 10, color: R.soft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.manager}</div>
              </div>
              <div style={{ textAlign: 'right' }}>{w.tag && <span style={runTag}>{w.tag}</span>}</div>
            </div>
          ))}

          {loading && <div style={{ padding: '20px 10px', color: R.faint, fontSize: 11 }}>Loading…</div>}
          {!loading && winnersRaw.length === 0 && (
            <div style={{ padding: '20px 10px', color: R.faint, fontSize: 11 }}>No champions stored for this country yet.</div>
          )}

          <div style={{ padding: '6px 10px', fontSize: 10, color: R.faint, fontFamily: MONO, background: R.panel2 }}>
            src: leaguefixtures &middot; team history
          </div>
        </div>

        {/* Most titles */}
        <div style={{ border: '1px solid var(--frame,#617D54)' }}>
          <SectionBar>Most titles</SectionBar>
          <div style={{ padding: 11, background: R.panel, display: 'flex', flexDirection: 'column', gap: 11 }}>
            {tallyArr.length === 0 && <div style={{ fontSize: 11, color: R.faint }}>—</div>}
            {tallyArr.map(([club, count], i) => (
              <div key={club}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 'bold', color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{club}</span>
                  <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 'bold', flex: 'none', color: R.ink }}>{count}</span>
                </div>
                <div style={{ height: 12, border: '1px solid var(--frame,#617D54)', background: R.panel2, overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: (count / maxT) * 100 + '%', background: i === 0 ? R.main : R.sec }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================== CUP WINNERS =========================== */

function RetroCupWinners({
  countries,
  country,
  setCountry,
  onStatus,
}: {
  countries: Country[];
  country: string;
  setCountry: Dispatch<SetStateAction<string>>;
  onStatus: (s: string) => void;
}) {
  const [cups, setCups] = useState<CupRoll[]>([]);
  const [loading, setLoading] = useState(true);
  const countryName = countries.find((c) => c.code === country)?.name ?? '';

  useEffect(() => {
    if (!country) return;
    setLoading(true);
    getCups(country)
      .then(setCups)
      .catch(() => setCups([]))
      .finally(() => setLoading(false));
  }, [country]);

  useEffect(() => {
    if (!loading) onStatus(`Done. ${cups.length} cup(s) loaded.`);
  }, [loading, cups.length, onStatus]);

  const main = cups.find((c) => c.isMain) ?? null;
  const secondary = cups.filter((c) => !c.isMain);

  return (
    <div>
      <div style={intro}>National cup honours, season by season &mdash; the main cup plus its secondary and consolation cups.</div>

      <fieldset style={fieldset}>
        <legend style={legend}>Select country</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 20px', alignItems: 'flex-end' }}>
          <div>
            <div style={filterLabel}>Country</div>
            <select value={country} onChange={(e) => setCountry(e.target.value)} style={selectStyle}>
              {countries.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: R.soft }}>
            <Flag url={leagueFlagUrl(country)} label={countryName} size={14} />
            {countryName}
          </div>
        </div>
      </fieldset>

      {loading && <div style={{ padding: '20px 2px', color: R.faint, fontSize: 11 }}>Loading…</div>}
      {!loading && cups.length === 0 && (
        <div style={{ padding: '20px 2px', color: R.faint, fontSize: 11 }}>No cup winners stored for this country yet.</div>
      )}

      {!loading && main && (
        <div style={{ marginBottom: 14 }}>
          <RetroCupCard cup={main} accent={R.main} tall />
        </div>
      )}

      {!loading && secondary.length > 0 && (
        <>
          <div style={{ ...filterLabel, margin: '4px 0 10px' }}>Secondary &amp; consolation cups</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14, alignItems: 'start' }}>
            {secondary.map((c) => (
              <RetroCupCard key={c.cupId} cup={c} accent={R.sec} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RetroCupCard({ cup, accent, tall = false }: { cup: CupRoll; accent: string; tall?: boolean }) {
  const winners = withRuns(cup.winners);
  const range = cup.winners.length ? `S${cup.winners[cup.winners.length - 1]!.season}–S${cup.winners[0]!.season}` : '—';
  const showManager = cup.isMain && cup.winners.some((w) => w.manager && w.manager !== '—');

  return (
    <div style={{ border: '1px solid var(--frame,#617D54)' }}>
      <SectionBar>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cup.cupName}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: MONO, fontWeight: 'normal', fontSize: 10, opacity: 0.9 }}>{range}</span>
      </SectionBar>
      <div style={{ maxHeight: tall ? 'none' : 320, overflowY: tall ? 'visible' : 'auto' }}>
        {winners.map((w, i) => (
          <div
            key={w.season}
            style={{
              display: 'grid',
              gridTemplateColumns: RETRO_WINNER_GRID,
              gap: 10,
              padding: 'var(--rp,7px) 10px',
              borderBottom: '1px solid var(--line,#CDD7C3)',
              alignItems: 'center',
              borderLeft: '3px solid ' + (w.partOfStreak ? accent : 'transparent'),
              background: i % 2 ? R.alt : R.panel,
            }}
          >
            <div style={{ fontFamily: MONO, fontWeight: 'bold', fontSize: 14, color: R.ink }}>S{w.season}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 'bold', color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.club}</div>
              {showManager && w.manager !== '—' && (
                <div style={{ fontSize: 10, color: R.soft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.manager}</div>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>{w.tag && <span style={runTag}>{w.tag}</span>}</div>
          </div>
        ))}
      </div>
      <div style={{ padding: '6px 10px', fontSize: 10, color: R.faint, fontFamily: MONO, background: R.panel2 }}>
        {cup.winners.length} finals &middot; src: cupmatches
      </div>
    </div>
  );
}
