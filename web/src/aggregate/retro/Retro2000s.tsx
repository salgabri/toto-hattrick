import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, Dispatch, ReactNode, SetStateAction } from 'react';
import {
  getAllElections,
  getCabinet,
  getCupCountries,
  getCups,
  getElectionCountries,
  getElections,
  getLeagues,
  getManagers,
  getMastersWinners,
  getNationalCompetitions,
  getNationalities,
  getSeasonalCups,
  getWinners,
  type Country,
  type CupRoll,
  type ElectionResult,
  type Manager,
  type NationalCompetition,
  type SeasonalCupRoll,
  type TrophyCabinet,
  type TrophyItem,
  type Winner,
} from '../data.js';
import { leagueFlagUrl, nationalityFlagUrl } from '../flags.js';
import { R, MONO, rootStyle2000s, type Skin } from './theme2000s.js';
import './retro2000s.css';

/**
 * Toto Hattrick — the "2000s" retro look (from `Toto Hattrick 2000s.dc.html`).
 *
 * A Windows-98/early-web reskin of the Aggregate records: a framed window with a gradient banner,
 * folder tabs, groove fieldsets, outset/inset buttons, and a disclaimer footer.
 * Wired to the real baked data (`../data.js`), and carries the newer features the original mock
 * never had — country flags and the full Cup winners view.
 *
 * Backend honesty: only top-division LEAGUE titles exist, so a
 * manager's `cup`/`oth` are 0 and their cabinet holds championships only. The Main/Secondary
 * toggles therefore stay inert for the total — kept for fidelity to the design.
 */

export type RetroView = 'trophies' | 'leagues' | 'cups' | 'worldcup' | 'elections';

export interface Retro2000sProps {
  defaultSkin?: Skin;
}

export function Retro2000s({ defaultSkin = 'green' }: Retro2000sProps) {
  const [skin, setSkin] = useState<Skin>(defaultSkin);
  const [view, setView] = useState<RetroView>('trophies');

  // View state lives on the parent so it survives tab switches.
  const [nation, setNation] = useState<string>('ALL');
  const [query, setQuery] = useState('');
  const [inc, setInc] = useState<IncState>({ champ: true, main: true, sec: false, hm: true, sn: true, wc: true });
  const [lastOnly, setLastOnly] = useState(false);
  const [groupBy, setGroupBy] = useState<TrophyGroupBy>('manager');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [league, setLeague] = useState<string>('');
  const [cupCountry, setCupCountry] = useState<string>('');
  const [electionCountry, setElectionCountry] = useState<string>('');
  const [, setStatus] = useState('Ready.');

  // Reference lists (loaded once).
  const [nationalities, setNationalities] = useState<Country[]>([]);
  const [leagues, setLeagues] = useState<Country[]>([]);
  const [cupCountries, setCupCountries] = useState<Country[]>([]);
  const [electionCountries, setElectionCountries] = useState<Country[]>([]);
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
    getElectionCountries()
      .then((cs) => {
        setElectionCountries(cs);
        setElectionCountry((cur) => cur || cs[0]?.code || '');
      })
      .catch(() => setElectionCountries([]));
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
    <div className="th2000s" style={rootStyle2000s(skin)}>
      <div
        style={{
          maxWidth: 1280,
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
              lastOnly={lastOnly}
              setLastOnly={setLastOnly}
              groupBy={groupBy}
              setGroupBy={setGroupBy}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
              onStatus={setStatus}
            />
          ) : view === 'leagues' ? (
            <RetroLeagueWinners leagues={leagues} league={league} setLeague={setLeague} onStatus={setStatus} />
          ) : view === 'cups' ? (
            <RetroCupWinners countries={cupCountries} country={cupCountry} setCountry={setCupCountry} onStatus={setStatus} />
          ) : view === 'worldcup' ? (
            <RetroWorldCup onStatus={setStatus} />
          ) : (
            <RetroElections countries={electionCountries} country={electionCountry} setCountry={setElectionCountry} onStatus={setStatus} />
          )}
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
  { key: 'worldcup', label: 'National trophies' },
  { key: 'elections', label: 'Elections' },
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

const hattrickTeamUrl = (teamId: number) => `https://www.hattrick.org/en/Club/?TeamID=${teamId}`;
const hattrickManagerUrl = (userId: number) => `https://www.hattrick.org/en/Club/Manager/?userId=${userId}`;

/** Wraps children in a hattrick.org link when an id is available, otherwise renders them plain —
 *  team/manager id coverage varies a lot by competition (see Winner.teamId/userId in data.ts). */
function HtLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: 'inherit', textDecoration: 'none' }}>
      {children}
    </a>
  );
}

/** Small country flag (self-hosted SVG). Renders nothing for unknown/missing codes. */
function Flag({ url, label, size = 20 }: { url: string | null; label?: string; size?: number }) {
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

const RETRO_TROPHY_GRID = '46px minmax(0,1fr) 160px minmax(110px,200px) 56px 22px';
const PAGE_SIZE = 50;
/** How many of a nation's top managers the expanded nation row lists. */
const NATION_TOP_N = 12;

interface IncState {
  champ: boolean;
  main: boolean;
  sec: boolean;
  hm: boolean;
  sn: boolean;
  wc: boolean;
}

/** The leaderboard's unit of aggregation: one row per manager, or one row per manager NATIONALITY
 *  (every trophy its citizens ever won, pooled). */
export type TrophyGroupBy = 'manager' | 'nation';

/** A nationality's pooled haul. Counts are whatever the current filters resolved per manager
 *  (career totals, or reigning-only), so the toggles apply identically in both modes. */
interface NationAgg {
  nation: string;
  winners: number; // managers of that nationality with at least one counted trophy
  lg: number;
  main: number;
  sec: number;
  hm: number;
  sn: number;
  wc: number;
  ft: number;
  top: Array<{ userId: number; login: string; ft: number }>;
}

/**
 * One meaning-group inside the Filters box. The rows stack — what gets counted (which
 * competitions, over what stretch of history), then how the counted field is shown — so each can
 * grow its own controls without reflowing the other.
 */
function FilterRow({ divider, children }: { divider?: boolean; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '14px 20px',
        alignItems: 'flex-end',
        ...(divider ? { borderTop: '1px solid var(--line,#CDD7C3)', marginTop: 11, paddingTop: 11 } : null),
      }}
    >
      {children}
    </div>
  );
}

/**
 * How much of a manager's history counts. Only the two states the baked data can answer today —
 * career totals, or reigning-only (the last winner of each competition). Season windows ("last 5
 * seasons") need a per-title season filter, so they'd become their own state, not another flag.
 */
const RECENCY_OPTS: Array<{ label: string; reigning: boolean; title: string }> = [
  { label: 'All time', reigning: false, title: 'Every trophy ever won' },
  {
    label: 'Reigning only',
    reigning: true,
    title: 'Count only the last trophy won in each competition — the current champion of every league and holder of every cup',
  },
];

/** The 2000s pressed/unpressed toggle button — inset when on, outset when off. */
function toggleBtn(on: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 11,
    padding: '4px 10px',
    border: on ? '2px inset var(--btn,#EBEFE2)' : '2px outset var(--btn,#EBEFE2)',
    background: on ? R.btn2 : 'linear-gradient(180deg,#fff,var(--btn,#EBEFE2))',
    color: on ? R.ink : R.soft,
    fontWeight: on ? 'bold' : 'normal',
  };
}

function rankBg(r: number): string {
  return r === 1 ? '#D8A93B' : r === 2 ? '#C7C3B8' : r === 3 ? '#C08A52' : 'transparent';
}

/** Medal-plated for the podium, plain otherwise. */
function RankBadge({ rank }: { rank: number }) {
  const top = rank <= 3;
  return (
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
              background: rankBg(rank),
              color: '#241c08',
              fontWeight: 'bold',
              fontSize: 12,
              fontFamily: MONO,
            }
          : { display: 'inline-block', textAlign: 'center', width: 26, color: R.soft, fontWeight: 'bold', fontSize: 13, fontFamily: MONO }
      }
    >
      {rank}
    </span>
  );
}

type TrophyCounts = { lg: number; main: number; sec: number; hm: number; sn: number; wc: number };

/** The counted categories in legend order — excluded ones contribute no segment. */
function mixSegments(c: TrophyCounts, inc: IncState): Array<{ n: number; color: string }> {
  const segs: Array<{ n: number; color: string }> = [];
  if (inc.champ && c.lg) segs.push({ n: c.lg, color: R.champ });
  if (inc.main && c.main) segs.push({ n: c.main, color: R.main });
  if (inc.hm && c.hm) segs.push({ n: c.hm, color: R.masters });
  if (inc.wc && c.wc) segs.push({ n: c.wc, color: R.worldCup });
  if (inc.sn && c.sn) segs.push({ n: c.sn, color: R.seasonal });
  if (inc.sec && c.sec) segs.push({ n: c.sec, color: R.sec });
  return segs;
}

/** Stacked proportion bar + the `a + b + c` breakdown underneath it. */
function MixBar({ segs, total }: { segs: Array<{ n: number; color: string }>; total: number }) {
  const tot = total || 1;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ height: 11, border: '1px solid var(--frame,#617D54)', background: R.panel2, display: 'flex', overflow: 'hidden' }}>
        {segs.map((sg, ix) => (
          <span key={ix} style={{ width: (sg.n / tot) * 100 + '%', background: sg.color, borderRight: '1px solid rgba(0,0,0,.2)' }} />
        ))}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: R.faint, marginTop: 4 }}>{segs.map((s) => s.n).join(' + ') || '0'}</div>
    </div>
  );
}

/** The +/− affordance on an expandable leaderboard row. */
function ExpandGlyph({ open }: { open: boolean }) {
  return (
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
      {open ? '−' : '+'}
    </span>
  );
}

/** Category → colour → the `NationAgg` field holding its count. Legend order, as everywhere else. */
const NATION_CATS: Array<{ label: string; dot: string; k: keyof IncState; f: keyof TrophyCounts }> = [
  { label: 'Championships', dot: R.champ, k: 'champ', f: 'lg' },
  { label: 'Main cups', dot: R.main, k: 'main', f: 'main' },
  { label: 'Hattrick Masters', dot: R.masters, k: 'hm', f: 'hm' },
  { label: 'National trophies', dot: R.worldCup, k: 'wc', f: 'wc' },
  { label: 'Seasonal cups', dot: R.seasonal, k: 'sn', f: 'sn' },
  { label: 'Secondary cups', dot: R.sec, k: 'sec', f: 'sec' },
];

/** Shared header style for the panels inside an expanded row. */
const cabinetHead: CSSProperties = {
  fontSize: 10,
  letterSpacing: '.05em',
  textTransform: 'uppercase',
  fontWeight: 'bold',
  color: R.soft,
  borderBottom: '1px solid var(--line,#CDD7C3)',
  paddingBottom: 5,
};

function cabinetCats(tr: TrophyCabinet, inc: IncState, lastOnly: boolean) {
  const pick = (items: TrophyItem[]) => (lastOnly ? items.filter((it) => it.last) : items);
  return [
    { label: 'Championships', dot: R.champ, items: pick(tr.champ), excluded: !inc.champ },
    { label: 'Main cups', dot: R.main, items: pick(tr.main), excluded: !inc.main },
    { label: 'Hattrick Masters', dot: R.masters, items: pick(tr.other), excluded: !inc.hm },
    { label: 'National trophies', dot: R.worldCup, items: pick(tr.worldCup), excluded: !inc.wc },
    { label: 'Seasonal cups', dot: R.seasonal, items: pick(tr.seasonal), excluded: !inc.sn },
    { label: 'Secondary cups', dot: R.sec, items: pick(tr.sec), excluded: !inc.sec },
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
  lastOnly,
  setLastOnly,
  groupBy,
  setGroupBy,
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
  lastOnly: boolean;
  setLastOnly: Dispatch<SetStateAction<boolean>>;
  groupBy: TrophyGroupBy;
  setGroupBy: Dispatch<SetStateAction<TrophyGroupBy>>;
  expandedId: string | null;
  setExpandedId: Dispatch<SetStateAction<string | null>>;
  onStatus: (s: string) => void;
}) {
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(true);
  const [cabinets, setCabinets] = useState<Record<number, TrophyCabinet | null>>({});
  const [page, setPage] = useState(1);

  // Nationality is the grouping dimension in nation mode, so it can't also be a filter there —
  // always pull the whole field.
  useEffect(() => {
    setLoading(true);
    getManagers(groupBy === 'nation' || nation === 'ALL' ? undefined : nation)
      .then(setManagers)
      .catch(() => setManagers([]))
      .finally(() => setLoading(false));
  }, [nation, groupBy]);

  // Any filter change reshuffles the ranked list, so drop back to the first page.
  useEffect(() => {
    setPage(1);
  }, [nation, query, inc, lastOnly, groupBy]);

  // Row ids mean different things per mode (userId vs nation name) — never carry one over.
  useEffect(() => {
    setExpandedId(null);
  }, [groupBy, setExpandedId]);

  const toggleInc = (k: keyof IncState) => setInc((s) => ({ ...s, [k]: !s[k] }));
  const toggleNation = (name: string) => setExpandedId((cur) => (cur === name ? null : name));
  const toggleExpand = (m: Manager) => {
    setExpandedId((cur) => (cur === String(m.userId) ? null : String(m.userId)));
    if (!(m.userId in cabinets)) {
      setCabinets((c) => ({ ...c, [m.userId]: null }));
      getCabinet(m.userId)
        .then((cab) => setCabinets((c) => ({ ...c, [m.userId]: cab })))
        .catch(() => setCabinets((c) => ({ ...c, [m.userId]: { champ: [], main: [], sec: [], other: [], seasonal: [], worldCup: [] } })));
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
      const sn = lastOnly ? m.snLast : m.sn;
      const wc = lastOnly ? m.wcLast : m.wc;
      const ft = (inc.champ ? lg : 0) + (inc.main ? main : 0) + (inc.sec ? sec : 0) + (inc.hm ? hm : 0) + (inc.sn ? sn : 0) + (inc.wc ? wc : 0);
      return { m, ft, lg, main, sec, hm, sn, wc };
    });
    l.sort((a, b) => b.ft - a.ft || b.lg - a.lg);
    return l.map((e, i) => ({ ...e, rank: i + 1 }));
  }, [managers, inc, lastOnly]);

  // Pool the very same per-manager numbers by nationality, so both modes always agree: a nation's
  // total is exactly the sum of its managers' totals under the current toggles.
  const rankedNations = useMemo(() => {
    const by = new Map<string, NationAgg>();
    for (const e of ranked) {
      const key = e.m.c || 'Unknown';
      let a = by.get(key);
      if (!a) {
        a = { nation: key, winners: 0, lg: 0, main: 0, sec: 0, hm: 0, sn: 0, wc: 0, ft: 0, top: [] };
        by.set(key, a);
      }
      a.lg += e.lg;
      a.main += e.main;
      a.sec += e.sec;
      a.hm += e.hm;
      a.sn += e.sn;
      a.wc += e.wc;
      a.ft += e.ft;
      if (e.ft > 0) {
        a.winners++;
        a.top.push({ userId: e.m.userId, login: e.m.login, ft: e.ft });
      }
    }
    const list = [...by.values()];
    // `ranked` is already sorted by total, so each nation's contributors come out in order —
    // just cap the list we render in the expanded panel.
    for (const a of list) a.top = a.top.slice(0, NATION_TOP_N);
    list.sort((a, b) => b.ft - a.ft || b.lg - a.lg || a.nation.localeCompare(b.nation));
    return list.map((a, i) => ({ ...a, rank: i + 1 }));
  }, [ranked]);

  const q = query.trim().toLowerCase();
  const visible = ranked.filter(
    (e) =>
      (!q || e.m.login.toLowerCase().includes(q) || (e.m.team && e.m.team.toLowerCase().includes(q))) &&
      e.ft > 0 &&
      (!lastOnly || e.m.lgLast + e.m.mainLast + e.m.secLast + e.m.hmLast + e.m.snLast + e.m.wcLast > 0),
  );
  const visibleNations = rankedNations.filter((n) => n.ft > 0 && (!q || n.nation.toLowerCase().includes(q)));

  const byNation = groupBy === 'nation';
  const rowCount = byNation ? visibleNations.length : visible.length;

  // Show at most PAGE_SIZE rows at a time. Ranks stay absolute over the whole
  // filtered list, so page 2 continues from rank 51, not from 1.
  const pageCount = Math.max(1, Math.ceil(rowCount / PAGE_SIZE));
  const curPage = Math.min(page, pageCount);
  const pageStart = (curPage - 1) * PAGE_SIZE;
  const pageRows = visible.slice(pageStart, pageStart + PAGE_SIZE);
  const pageNations = visibleNations.slice(pageStart, pageStart + PAGE_SIZE);

  useEffect(() => {
    if (!loading) onStatus(`Done. ${rowCount} record(s).`);
  }, [loading, rowCount, onStatus]);

  const chips: Array<{ k: keyof IncState; label: string }> = [
    { k: 'champ', label: 'Championships' },
    { k: 'main', label: 'Main cups' },
    { k: 'hm', label: 'Masters' },
    { k: 'wc', label: 'National' },
    { k: 'sn', label: 'Seasonal' },
    { k: 'sec', label: 'Secondary' },
  ];

  return (
    <div>
      <div style={intro}>
        {byNation ? (
          <>
            Nations ranked by the silverware their managers won &mdash; every trophy pooled by the manager&apos;s
            nationality, not by where the club plays. Toggle which trophies count toward the total below.
          </>
        ) : (
          <>
            Managers ranked by silverware across all of their clubs &mdash; league titles, national cups, the Hattrick
            Masters, and Seasonal Cups. Toggle which trophies count toward the total below.
          </>
        )}
      </div>

      {/* Filters — two meaning-groups: what gets counted, then how the counted field is shown. */}
      <fieldset style={fieldset}>
        <legend style={legend}>Filters</legend>

        <FilterRow>
          <div>
            <div style={filterLabel}>Competitions</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {chips.map((c) => {
                const on = inc[c.k];
                return (
                  <button key={c.k} onClick={() => toggleInc(c.k)} style={toggleBtn(on)}>
                    {on && <span>✓&nbsp;</span>}
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div style={filterLabel}>Recency</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {RECENCY_OPTS.map((o) => (
                <button key={o.label} onClick={() => setLastOnly(o.reigning)} style={toggleBtn(lastOnly === o.reigning)} title={o.title}>
                  {lastOnly === o.reigning && <span>✓&nbsp;</span>}
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </FilterRow>

        <FilterRow divider>
          <div>
            <div style={filterLabel}>Group by</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setGroupBy('manager')} style={toggleBtn(!byNation)} title="One row per manager">
                {!byNation && <span>✓&nbsp;</span>}
                Managers
              </button>
              <button
                onClick={() => setGroupBy('nation')}
                style={toggleBtn(byNation)}
                title="Pool every manager's trophies by their nationality"
              >
                {byNation && <span>✓&nbsp;</span>}
                Nations
              </button>
            </div>
          </div>
          {!byNation && (
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
          )}
          <div>
            <div style={filterLabel}>Search</div>
            <input
              className="retro-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={byNation ? 'Nation…' : 'Manager or club…'}
              style={{ width: 190, border: '2px inset var(--btn,#EBEFE2)', background: '#fff', color: R.ink, fontSize: 11, padding: '3px 6px', outline: 'none', fontFamily: 'inherit' }}
            />
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 10, color: R.soft, paddingBottom: 4 }}>
            {rowCount > PAGE_SIZE
              ? `${pageStart + 1}–${pageStart + (byNation ? pageNations.length : pageRows.length)} of ${rowCount}`
              : `${rowCount} shown`}
          </div>
        </FilterRow>
      </fieldset>

      {/* Leaderboard */}
      <div style={{ border: '1px solid var(--frame,#617D54)' }}>
        <SectionBar>{byNation ? 'Trophy leaders — by nation' : 'Trophy leaders'}</SectionBar>
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
          <div>{byNation ? 'Nation' : 'Manager'}</div>
          <div>{byNation ? 'Winners' : 'Nationality'}</div>
          <div>Trophy mix</div>
          <div style={{ textAlign: 'right' }}>Total</div>
          <div />
        </div>

        {byNation &&
          pageNations.map((n, i) => {
            const isExp = expandedId === n.nation;
            const segs = mixSegments(n, inc);
            return (
              <div key={n.nation}>
                <div
                  className="retro-row"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExp}
                  onClick={() => toggleNation(n.nation)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      toggleNation(n.nation);
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
                    background: isExp ? R.selrow : i % 2 ? R.alt : R.panel,
                  }}
                >
                  <div>
                    <RankBadge rank={n.rank} />
                  </div>
                  <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
                    <Flag url={nationalityFlagUrl(n.nation)} label={n.nation} size={24} />
                    <div style={{ minWidth: 0, fontSize: 12, fontWeight: 'bold', color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {n.nation}
                    </div>
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 12, color: R.soft }}>
                    {n.winners.toLocaleString()}
                    <span style={{ fontSize: 10, color: R.faint }}> manager{n.winners === 1 ? '' : 's'}</span>
                  </div>
                  <MixBar segs={segs} total={n.ft} />
                  <div style={{ textAlign: 'right', fontFamily: MONO, fontSize: 17, fontWeight: 'bold', color: R.ink }}>{n.ft}</div>
                  <div style={{ textAlign: 'center' }}>
                    <ExpandGlyph open={isExp} />
                  </div>
                </div>

                {isExp && (
                  <div style={{ padding: '10px 12px 12px 66px', background: R.panel2, borderBottom: '1px solid var(--line,#CDD7C3)' }}>
                    <div style={{ border: '2px inset var(--btn,#EBEFE2)', background: R.panel, padding: 10, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 190, border: '1px solid var(--line,#CDD7C3)', background: R.panel, padding: '8px 10px' }}>
                        <div style={{ ...cabinetHead, marginBottom: 9 }}>By competition</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                          {NATION_CATS.map((c) => (
                            <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 7, opacity: inc[c.k] ? 1 : 0.5 }}>
                              <span style={{ width: 9, height: 9, flex: 'none', border: '1px solid rgba(0,0,0,.3)', background: c.dot }} />
                              <span style={{ fontSize: 11, color: R.ink, flex: 1 }}>{c.label}</span>
                              {!inc[c.k] && (
                                <span style={{ fontSize: 9, fontWeight: 'bold', letterSpacing: '.03em', textTransform: 'uppercase', color: R.faint }}>
                                  [excluded]
                                </span>
                              )}
                              <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 'bold', color: R.soft }}>{n[c.f]}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={{ flex: 2, minWidth: 240, border: '1px solid var(--line,#CDD7C3)', background: R.panel, padding: '8px 10px' }}>
                        <div style={{ ...cabinetHead, marginBottom: 9 }}>
                          Top managers {n.winners > NATION_TOP_N ? `(${NATION_TOP_N} of ${n.winners})` : ''}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                          {n.top.map((t, ix) => (
                            <div key={t.userId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontFamily: MONO, fontSize: 10, color: R.faint, width: 18, flex: 'none', textAlign: 'right' }}>{ix + 1}.</span>
                              <a
                                href={hattrickManagerUrl(t.userId)}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(ev) => ev.stopPropagation()}
                                style={{ fontSize: 11, fontWeight: 'bold', color: R.ink, textDecoration: 'none', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              >
                                {t.login}
                              </a>
                              <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 'bold', color: R.soft, flex: 'none' }}>{t.ft}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

        {!byNation &&
          pageRows.map((e, i) => {
          const m = e.m;
          const r = e.rank;
          const isExp = expandedId === String(m.userId);
          const cab = isExp ? cabinets[m.userId] : undefined;

          const segRaw = mixSegments(e, inc);
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
                  <RankBadge rank={r} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 'bold', color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a
                      href={hattrickManagerUrl(m.userId)}
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
                <MixBar segs={segRaw} total={e.ft} />
                <div style={{ textAlign: 'right', fontFamily: MONO, fontSize: 17, fontWeight: 'bold', color: R.ink }}>{e.ft}</div>
                <div style={{ textAlign: 'center' }}>
                  <ExpandGlyph open={isExp} />
                </div>
              </div>

              {isExp && (
                <div style={{ padding: '10px 12px 12px 66px', background: R.panel2, borderBottom: '1px solid var(--line,#CDD7C3)' }}>
                  <div style={{ border: '2px inset var(--btn,#EBEFE2)', background: R.panel, padding: 10, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {cab == null ? (
                      <div style={{ color: R.faint, fontSize: 11 }}>Loading cabinet…</div>
                    ) : cabinetCats(cab, inc, lastOnly).length === 0 ? (
                      <div style={{ color: R.faint, fontSize: 11 }}>No trophies on record.</div>
                    ) : (
                      cabinetCats(cab, inc, lastOnly).map((g) => (
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
                              <div key={ix} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                  {it.flag && <img src={it.flag} alt="" width={17} style={{ height: 'auto', flex: 'none', border: '1px solid ' + R.line }} />}
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: 11, fontWeight: 'bold', color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.main}</div>
                                    <div style={{ fontSize: 10, color: R.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      <HtLink href={it.teamId ? hattrickTeamUrl(it.teamId) : null}>{it.sub}</HtLink>
                                    </div>
                                  </div>
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
        {!loading && rowCount === 0 && (
          <div style={{ padding: '22px 12px', textAlign: 'center', color: R.faint, fontSize: 11 }}>
            No {byNation ? 'nations' : 'managers'} match your search.
          </div>
        )}
      </div>

      {!loading && pageCount > 1 && <RetroPager page={curPage} pageCount={pageCount} setPage={setPage} />}

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 9, fontSize: 10, color: R.ink, flexWrap: 'wrap' }}>
        <b style={{ color: R.soft, textTransform: 'uppercase', letterSpacing: '.04em' }}>Legend:</b>
        <LegendSwatch color={R.champ} label="Championships" />
        <LegendSwatch color={R.main} label="Main cups" />
        <LegendSwatch color={R.masters} label="Masters" />
        <LegendSwatch color={R.worldCup} label="National trophies" />
        <LegendSwatch color={R.seasonal} label="Seasonal" />
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

/** Numbered pager for the trophy leaderboard — 50 managers per page, in the 2000s outset-button style. */
function RetroPager({ page, pageCount, setPage }: { page: number; pageCount: number; setPage: Dispatch<SetStateAction<number>> }) {
  const btn = (disabled: boolean): CSSProperties => ({
    minWidth: 26,
    padding: '3px 9px',
    border: disabled ? '2px inset var(--btn,#EBEFE2)' : '2px outset var(--btn,#EBEFE2)',
    background: disabled ? R.panel2 : R.btn,
    color: disabled ? R.faint : '#222',
    cursor: disabled ? 'default' : 'pointer',
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: 'bold',
  });
  const first = page <= 1;
  const last = page >= pageCount;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 }}>
      <button style={btn(first)} disabled={first} onClick={() => setPage(1)} title="First page">
        |«
      </button>
      <button style={btn(first)} disabled={first} onClick={() => setPage((p) => Math.max(1, p - 1))} title="Previous page">
        «
      </button>
      <span style={{ fontFamily: MONO, fontSize: 11, color: R.soft, padding: '0 6px', fontWeight: 'bold' }}>
        Page {page} / {pageCount}
      </span>
      <button style={btn(last)} disabled={last} onClick={() => setPage((p) => Math.min(pageCount, p + 1))} title="Next page">
        »
      </button>
      <button style={btn(last)} disabled={last} onClick={() => setPage(pageCount)} title="Last page">
        »|
      </button>
    </div>
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
            <Flag url={leagueFlagUrl(league)} label={leagueName} size={24} />
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
                <div style={{ fontSize: 12, fontWeight: 'bold', color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <HtLink href={w.teamId ? hattrickTeamUrl(w.teamId) : null}>{w.club}</HtLink>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: R.soft, overflow: 'hidden' }}>
                  <Flag url={nationalityFlagUrl(w.nationality)} label={w.nationality} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <HtLink href={w.userId ? hattrickManagerUrl(w.userId) : null}>{w.manager}</HtLink>
                  </span>
                </div>
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

        <TopManagersPanel winners={winnersRaw} />
      </div>
    </div>
  );
}

/* ===================== TOP MANAGERS (shared) ===================== */

/**
 * Manager win-count leaderboard for any single roll of honour (a league, one cup, Masters, or one
 * Seasonal Cup). Tracks the distinct club(s) each manager won with — a manager can appear under more
 * than one club across seasons (a rename, or a genuinely different team they later took over) — and
 * shows their nationality flag. Excludes the '—' sentinel (unattributed champion — see
 * hattrick-owner-attribution-model).
 */
function TopManagersPanel({ winners, limit = 10 }: { winners: Winner[]; limit?: number }) {
  const tally: Record<string, { count: number; teams: Array<{ name: string; teamId?: number }>; nationality?: string; userId?: number }> = {};
  winners.forEach((w) => {
    if (!w.manager || w.manager === '—') return;
    const e = (tally[w.manager] ??= { count: 0, teams: [], nationality: w.nationality, userId: w.userId });
    e.count++;
    if (!e.teams.some((t) => t.name === w.club)) e.teams.push({ name: w.club, teamId: w.teamId });
  });
  const arr = Object.entries(tally)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit);
  const max = arr.length ? arr[0]![1].count : 1;

  return (
    <div style={{ border: '1px solid var(--frame,#617D54)' }}>
      <SectionBar>Top managers (top {limit})</SectionBar>
      <div style={{ padding: 11, background: R.panel, display: 'flex', flexDirection: 'column', gap: 11 }}>
        {arr.length === 0 && <div style={{ fontSize: 11, color: R.faint }}>—</div>}
        {arr.map(([manager, { count, teams, nationality, userId }], i) => (
          <div key={manager}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2, gap: 8 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                <Flag url={nationalityFlagUrl(nationality)} label={nationality} />
                <span style={{ fontSize: 11, fontWeight: 'bold', color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <HtLink href={userId ? hattrickManagerUrl(userId) : null}>{manager}</HtLink>
                </span>
              </span>
              <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 'bold', flex: 'none', color: R.ink }}>{count}</span>
            </div>
            <div style={{ fontSize: 10, color: R.soft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>
              {teams.map((t, ti) => (
                <span key={t.name}>
                  {ti > 0 && ', '}
                  <HtLink href={t.teamId ? hattrickTeamUrl(t.teamId) : null}>{t.name}</HtLink>
                </span>
              ))}
            </div>
            <div style={{ height: 12, border: '1px solid var(--frame,#617D54)', background: R.panel2, overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: (count / max) * 100 + '%', background: i === 0 ? R.main : R.sec }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* =========================== CUP WINNERS =========================== */

type CupCategory = 'main' | 'secondary' | 'masters' | 'seasonal';

const CUP_CATEGORIES: Array<{ k: CupCategory; label: string }> = [
  { k: 'main', label: 'National cup' },
  { k: 'secondary', label: 'National secondary cup' },
  { k: 'masters', label: 'Hattrick Masters' },
  { k: 'seasonal', label: 'Seasonal Cups' },
];

/** Outset/inset toggle button matching the retro Windows-98 chip look used for the trophy filters. */
function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  const style: CSSProperties = active
    ? {
        display: 'inline-flex', alignItems: 'center', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11,
        padding: '4px 10px', border: '2px inset var(--btn,#EBEFE2)', background: R.btn2, color: R.ink, fontWeight: 'bold',
      }
    : {
        display: 'inline-flex', alignItems: 'center', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11,
        padding: '4px 10px', border: '2px outset var(--btn,#EBEFE2)', background: 'linear-gradient(180deg,#fff,var(--btn,#EBEFE2))',
        color: R.soft, fontWeight: 'normal',
      };
  return (
    <span onClick={onClick} style={style}>
      {label}
    </span>
  );
}

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
  const [category, setCategory] = useState<CupCategory>('main');

  // National cups (main + secondary) — nation-based, keyed by the selected country.
  const [cups, setCups] = useState<CupRoll[]>([]);
  const [cupsLoading, setCupsLoading] = useState(true);
  const [secondaryCupId, setSecondaryCupId] = useState<number | null>(null);
  const countryName = countries.find((c) => c.code === country)?.name ?? '';

  // Hattrick Masters — international, no country. Loaded once, lazily.
  const [masters, setMasters] = useState<Winner[] | null>(null);
  const [mastersLoading, setMastersLoading] = useState(false);

  // Seasonal Cups — international: Supporter Week Trophy (one recurring cup) plus every
  // "Heroes/Titans of YYYY Trophy" (Generation) cohort, each its own perpetual tournament. Loaded
  // once, lazily.
  const [seasonalCups, setSeasonalCups] = useState<SeasonalCupRoll[]>([]);
  const [seasonalLoading, setSeasonalLoading] = useState(false);
  const [seasonalCupId, setSeasonalCupId] = useState<number | null>(null);

  useEffect(() => {
    if (!country) return;
    setCupsLoading(true);
    getCups(country)
      .then(setCups)
      .catch(() => setCups([]))
      .finally(() => setCupsLoading(false));
  }, [country]);

  useEffect(() => {
    if (category !== 'masters' || masters !== null) return;
    setMastersLoading(true);
    getMastersWinners()
      .then(setMasters)
      .catch(() => setMasters([]))
      .finally(() => setMastersLoading(false));
  }, [category, masters]);

  useEffect(() => {
    if (category !== 'seasonal' || seasonalCups.length > 0) return;
    setSeasonalLoading(true);
    getSeasonalCups()
      .then((cs) => {
        setSeasonalCups(cs);
        setSeasonalCupId((cur) => cur ?? cs.find((c) => !c.isGeneration)?.cupId ?? cs[0]?.cupId ?? null);
      })
      .catch(() => setSeasonalCups([]))
      .finally(() => setSeasonalLoading(false));
  }, [category, seasonalCups.length]);

  const main = cups.find((c) => c.isMain) ?? null;
  const secondaryCups = cups.filter((c) => !c.isMain);

  // Keep the secondary-cup selection valid whenever the country (and thus its secondary cups) changes.
  useEffect(() => {
    if (!secondaryCups.some((c) => c.cupId === secondaryCupId)) {
      setSecondaryCupId(secondaryCups[0]?.cupId ?? null);
    }
  }, [secondaryCups]);

  const selectedSecondary = secondaryCups.find((c) => c.cupId === secondaryCupId) ?? null;
  const supporterWeek = seasonalCups.find((c) => !c.isGeneration) ?? null;
  const generationCohorts = seasonalCups.filter((c) => c.isGeneration).sort((a, b) => a.cupId - b.cupId);
  const selectedSeasonal = seasonalCups.find((c) => c.cupId === seasonalCupId) ?? null;

  const loading = category === 'main' || category === 'secondary' ? cupsLoading : category === 'masters' ? mastersLoading : seasonalLoading;

  useEffect(() => {
    if (loading) return;
    const n =
      category === 'main' ? (main ? 1 : 0)
      : category === 'secondary' ? (selectedSecondary ? 1 : 0)
      : category === 'masters' ? (masters ? 1 : 0)
      : selectedSeasonal ? 1 : 0;
    onStatus(n ? 'Done.' : 'No data stored yet.');
  }, [loading, category, main, selectedSecondary, masters, selectedSeasonal]);

  const showCountryPicker = category === 'main' || category === 'secondary';

  return (
    <div>
      <div style={intro}>
        National and international cup honours, season by season. The national cup and its secondary/consolation cups
        are per country; the Hattrick Masters and Seasonal Cups are global &mdash; every manager competes in the same one.
      </div>

      <fieldset style={fieldset}>
        <legend style={legend}>Select competition</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 20px', alignItems: 'flex-end' }}>
          <div>
            <div style={filterLabel}>Competition</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {CUP_CATEGORIES.map((c) => (
                <CategoryChip key={c.k} label={c.label} active={category === c.k} onClick={() => setCategory(c.k)} />
              ))}
            </div>
          </div>

          {showCountryPicker && (
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
          )}

          {category === 'secondary' && (
            <div>
              <div style={filterLabel}>Secondary cup</div>
              <select
                value={secondaryCupId ?? ''}
                onChange={(e) => setSecondaryCupId(Number(e.target.value))}
                style={selectStyle}
                disabled={secondaryCups.length === 0}
              >
                {secondaryCups.map((c) => (
                  <option key={c.cupId} value={c.cupId}>
                    {c.cupName}
                  </option>
                ))}
              </select>
            </div>
          )}

          {category === 'seasonal' && (
            <div>
              <div style={filterLabel}>Seasonal cup</div>
              <select
                value={seasonalCupId ?? ''}
                onChange={(e) => setSeasonalCupId(Number(e.target.value))}
                style={selectStyle}
                disabled={seasonalCups.length === 0}
              >
                {supporterWeek && <option value={supporterWeek.cupId}>{supporterWeek.cupName}</option>}
                {generationCohorts.length > 0 && (
                  <optgroup label="Heroes / Titans of YYYY (Generation)">
                    {generationCohorts.map((c) => (
                      <option key={c.cupId} value={c.cupId}>
                        {c.cupName}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          )}

          <div style={{ flex: 1 }} />
          {showCountryPicker && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: R.soft }}>
              <Flag url={leagueFlagUrl(country)} label={countryName} size={20} />
              {countryName}
            </div>
          )}
        </div>
      </fieldset>

      {loading && <div style={{ padding: '20px 2px', color: R.faint, fontSize: 11 }}>Loading…</div>}

      {!loading && category === 'main' && !main && (
        <div style={{ padding: '20px 2px', color: R.faint, fontSize: 11 }}>No cup winners stored for this country yet.</div>
      )}
      {!loading && category === 'main' && main && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 14, alignItems: 'start' }}>
          <RetroCupCard name={main.cupName} winners={main.winners} accent={R.main} tall />
          <TopManagersPanel winners={main.winners} />
        </div>
      )}

      {!loading && category === 'secondary' && !selectedSecondary && (
        <div style={{ padding: '20px 2px', color: R.faint, fontSize: 11 }}>No secondary cup winners stored for this country yet.</div>
      )}
      {!loading && category === 'secondary' && selectedSecondary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 14, alignItems: 'start' }}>
          <RetroCupCard name={selectedSecondary.cupName} winners={selectedSecondary.winners} accent={R.sec} tall />
          <TopManagersPanel winners={selectedSecondary.winners} />
        </div>
      )}

      {!loading && category === 'masters' && (!masters || masters.length === 0) && (
        <div style={{ padding: '20px 2px', color: R.faint, fontSize: 11 }}>No Masters winners stored yet.</div>
      )}
      {!loading && category === 'masters' && masters && masters.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 14, alignItems: 'start' }}>
          <RetroCupCard name="Hattrick Masters" winners={masters} accent={R.main} tall sourceLabel="cupmatches (global)" />
          <TopManagersPanel winners={masters} />
        </div>
      )}

      {!loading && category === 'seasonal' && !selectedSeasonal && (
        <div style={{ padding: '20px 2px', color: R.faint, fontSize: 11 }}>No Seasonal Cup winners stored yet.</div>
      )}
      {!loading && category === 'seasonal' && selectedSeasonal && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 14, alignItems: 'start' }}>
          <RetroCupCard
            name={selectedSeasonal.cupName}
            winners={selectedSeasonal.winners}
            accent={R.main}
            tall
            sourceLabel="ArenaHub tournament history"
          />
          <TopManagersPanel winners={selectedSeasonal.winners} />
        </div>
      )}
    </div>
  );
}

/** A roll-of-honour card for any single competition (a cup, Masters, or one Seasonal Cup) — not
 *  tied to CupRoll, so the same card serves national cups, the country-less international ones,
 *  and (paired with TopManagersPanel) a single-competition drill-down. */
function RetroCupCard({
  name,
  winners: winnersIn,
  accent,
  tall = false,
  sourceLabel = 'cupmatches',
}: {
  name: string;
  winners: Winner[];
  accent: string;
  tall?: boolean;
  sourceLabel?: string;
}) {
  const winners = withRuns(winnersIn);
  const range = winnersIn.length ? `S${winnersIn[winnersIn.length - 1]!.season}–S${winnersIn[0]!.season}` : '—';
  const showManager = winnersIn.some((w) => w.manager && w.manager !== '—');

  return (
    <div style={{ border: '1px solid var(--frame,#617D54)' }}>
      <SectionBar>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
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
              <div style={{ fontSize: 12, fontWeight: 'bold', color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <HtLink href={w.teamId ? hattrickTeamUrl(w.teamId) : null}>{w.club}</HtLink>
              </div>
              {showManager && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: R.soft, overflow: 'hidden' }}>
                  <Flag url={nationalityFlagUrl(w.nationality)} label={w.nationality} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <HtLink href={w.userId ? hattrickManagerUrl(w.userId) : null}>{w.manager}</HtLink>
                  </span>
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>{w.tag && <span style={runTag}>{w.tag}</span>}</div>
          </div>
        ))}
      </div>
      <div style={{ padding: '6px 10px', fontSize: 10, color: R.faint, fontFamily: MONO, background: R.panel2 }}>
        {winnersIn.length} finals &middot; src: {sourceLabel}
      </div>
    </div>
  );
}

/* =========================== WORLD CUP =========================== */

const WORLD_CUP_GRID = '70px minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.3fr) 90px';

function RetroWorldCup({ onStatus }: { onStatus: (s: string) => void }) {
  const [comps, setComps] = useState<NationalCompetition[]>([]);
  const [compKey, setCompKey] = useState('senior');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getNationalCompetitions()
      .then(setComps)
      .catch(() => setComps([]))
      .finally(() => setLoading(false));
  }, []);

  // Fall back to the first competition on offer, so a bake without World Cup data still shows.
  const comp = comps.find((c) => c.key === compKey) ?? comps[0];
  const editions = (comp?.rows ?? []).slice().sort((a, b) => b.edition - a.edition);

  useEffect(() => {
    if (!loading) onStatus(`Done. ${editions.length} ${comp?.unitLabel === 'Season' ? 'season' : 'edition'}(s) loaded.`);
  }, [loading, editions.length, comp?.unitLabel, onStatus]);

  const tally: Record<string, number> = {};
  for (const e of editions) if (e.champion) tally[e.champion] = (tally[e.champion] || 0) + 1;
  const tallyArr = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxT = tallyArr.length ? tallyArr[0]![1] : 1;

  const coachTally: Record<string, { count: number; nationality?: string; userId?: number }> = {};
  for (const e of editions) {
    if (!e.coach) continue;
    const c = (coachTally[e.coach] ??= { count: 0, nationality: e.coachNationality, userId: e.coachUserId });
    c.count++;
  }
  const coachTallyArr = Object.entries(coachTally).sort((a, b) => b[1].count - a[1].count).slice(0, 10);
  const maxCoachT = coachTallyArr.length ? coachTallyArr[0]![1].count : 1;

  return (
    <div>
      <div style={intro}>
        Trophies won by NATIONS, not by managers &mdash; one champion nation per edition, credited to the coach in
        charge at the time. No CHPP history exists for national-team competitions, so these rolls of honour are read
        from hattrick.org directly. The World Cup (senior and youth) is covered today; the regional and alternate
        cups are still to come.
      </div>

      <fieldset style={fieldset}>
        <legend style={legend}>Select competition</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {comps.length === 0 && <span style={{ fontSize: 11, color: R.faint }}>{loading ? 'Loading…' : 'No competitions on record.'}</span>}
          {comps.map((c) => (
            <CategoryChip key={c.key} label={c.label} active={c.key === comp?.key} onClick={() => setCompKey(c.key)} />
          ))}
        </div>
      </fieldset>

      {loading && <div style={{ padding: '20px 2px', color: R.faint, fontSize: 11 }}>Loading…</div>}

      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 14, alignItems: 'start' }}>
          <div style={{ border: '1px solid var(--frame,#617D54)' }}>
            <SectionBar>{comp?.label ?? 'National trophies'} &mdash; roll of honour</SectionBar>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: WORLD_CUP_GRID,
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
              <div>{comp?.unitLabel ?? 'Ed.'}</div>
              <div>Host</div>
              <div>Champion</div>
              <div>Runner-up</div>
              <div>3rd/4th</div>
              <div style={{ textAlign: 'right' }}>Finished</div>
            </div>
            {editions.map((e, i) => (
              <div
                key={e.edition}
                style={{
                  display: 'grid',
                  gridTemplateColumns: WORLD_CUP_GRID,
                  gap: 10,
                  padding: 'var(--rp,7px) 10px',
                  borderBottom: '1px solid var(--line,#CDD7C3)',
                  alignItems: 'center',
                  background: i % 2 ? R.alt : R.panel,
                }}
              >
                <div style={{ fontFamily: MONO, fontWeight: 'bold', fontSize: 13, color: R.ink }}>
                  {e.edition}
                  {e.ageGroup ? <span style={{ fontSize: 9, color: R.faint }}> {e.ageGroup}</span> : null}
                </div>
                <div style={{ fontSize: 11, color: R.soft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.host}</div>
                <div style={{ minWidth: 0 }}>
                  {e.champion ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                        <Flag url={nationalityFlagUrl(e.champion)} label={e.champion} size={16} />
                        <span style={{ fontSize: 12, fontWeight: 'bold', color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {e.champion}
                        </span>
                      </div>
                      {e.coach && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: R.soft, overflow: 'hidden' }}>
                          <Flag url={nationalityFlagUrl(e.coachNationality)} label={e.coachNationality} size={12} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <HtLink href={e.coachUserId ? hattrickManagerUrl(e.coachUserId) : null}>{e.coach}</HtLink>
                          </span>
                        </div>
                      )}
                    </>
                  ) : (
                    <span style={{ fontSize: 11, color: R.faint, fontStyle: 'italic' }}>Ongoing</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: R.soft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.runnerUp ?? '—'}</div>
                <div style={{ fontSize: 10, color: R.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.thirdFourth.length ? e.thirdFourth.join(', ') : '—'}
                </div>
                <div style={{ textAlign: 'right', fontSize: 10, color: R.faint, fontFamily: MONO }}>{e.finished ?? '—'}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ border: '1px solid var(--frame,#617D54)' }}>
              <SectionBar>Most titles (top 10)</SectionBar>
              <div style={{ padding: 11, background: R.panel, display: 'flex', flexDirection: 'column', gap: 11 }}>
                {tallyArr.length === 0 && <div style={{ fontSize: 11, color: R.faint }}>—</div>}
                {tallyArr.map(([nation, count], i) => (
                  <div key={nation}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, gap: 8 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                        <Flag url={nationalityFlagUrl(nation)} label={nation} />
                        <span style={{ fontSize: 11, fontWeight: 'bold', color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {nation}
                        </span>
                      </span>
                      <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 'bold', flex: 'none', color: R.ink }}>{count}</span>
                    </div>
                    <div style={{ height: 12, border: '1px solid var(--frame,#617D54)', background: R.panel2, overflow: 'hidden' }}>
                      <span style={{ display: 'block', height: '100%', width: (count / maxT) * 100 + '%', background: i === 0 ? R.main : R.sec }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ border: '1px solid var(--frame,#617D54)' }}>
              <SectionBar>Top coaches (top 10)</SectionBar>
              <div style={{ padding: 11, background: R.panel, display: 'flex', flexDirection: 'column', gap: 11 }}>
                {coachTallyArr.length === 0 && <div style={{ fontSize: 11, color: R.faint }}>—</div>}
                {coachTallyArr.map(([coach, { count, nationality, userId }], i) => (
                  <div key={coach}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, gap: 8 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                        <Flag url={nationalityFlagUrl(nationality)} label={nationality} />
                        <span style={{ fontSize: 11, fontWeight: 'bold', color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <HtLink href={userId ? hattrickManagerUrl(userId) : null}>{coach}</HtLink>
                        </span>
                      </span>
                      <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 'bold', flex: 'none', color: R.ink }}>{count}</span>
                    </div>
                    <div style={{ height: 12, border: '1px solid var(--frame,#617D54)', background: R.panel2, overflow: 'hidden' }}>
                      <span style={{ display: 'block', height: '100%', width: (count / maxCoachT) * 100 + '%', background: i === 0 ? R.main : R.sec }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================== ELECTIONS =========================== */

const ELECTION_GRID = '60px minmax(0,1fr) minmax(0,1fr) 100px';

function RetroElections({
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
  const [rows, setRows] = useState<ElectionResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [allRows, setAllRows] = useState<ElectionResult[]>([]);
  const countryName = countries.find((c) => c.code === country)?.name ?? '';

  useEffect(() => {
    if (!country) return;
    setLoading(true);
    getElections(country)
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [country]);

  useEffect(() => {
    getAllElections().then(setAllRows).catch(() => setAllRows([]));
  }, []);

  useEffect(() => {
    if (!loading) onStatus(`Done. ${rows.length} election(s) loaded.`);
  }, [loading, rows.length, onStatus]);

  const tally: Record<string, { count: number; userId?: number; nationality?: string }> = {};
  for (const r of allRows) {
    if (!r.winner) continue;
    const e = (tally[r.winner] ??= { count: 0, userId: r.winnerUserId, nationality: r.winnerNationality });
    e.count++;
  }
  const tallyArr = Object.entries(tally).sort((a, b) => b[1].count - a[1].count).slice(0, 10);
  const maxT = tallyArr.length ? tallyArr[0]![1].count : 1;

  return (
    <div>
      <div style={intro}>
        National Coach elections &mdash; who each country's community voted to lead their national team for a
        given World Cup cycle, independent of whether that country ever won anything.
      </div>

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
            <Flag url={leagueFlagUrl(country)} label={countryName} size={20} />
            {countryName}
          </div>
        </div>
      </fieldset>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 14, alignItems: 'start' }}>
        <div style={{ border: '1px solid var(--frame,#617D54)' }}>
          <SectionBar>{countryName} &mdash; National Coach elections</SectionBar>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: ELECTION_GRID,
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
            <div>WC</div>
            <div>Host</div>
            <div>Winner</div>
            <div style={{ textAlign: 'right' }}>Votes</div>
          </div>

          {rows.map((r, i) => (
            <div
              key={`${r.edition}-${i}`}
              style={{
                display: 'grid',
                gridTemplateColumns: ELECTION_GRID,
                gap: 10,
                padding: 'var(--rp,7px) 10px',
                borderBottom: '1px solid var(--line,#CDD7C3)',
                alignItems: 'center',
                background: i % 2 ? R.alt : R.panel,
              }}
            >
              <div style={{ fontFamily: MONO, fontWeight: 'bold', fontSize: 13, color: R.ink }}>{r.edition}</div>
              <div style={{ fontSize: 11, color: R.soft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.host}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                {r.winner ? (
                  <>
                    <Flag url={nationalityFlagUrl(r.winnerNationality)} label={r.winnerNationality} size={14} />
                    <span style={{ fontSize: 12, fontWeight: 'bold', color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <HtLink href={r.winnerUserId ? hattrickManagerUrl(r.winnerUserId) : null}>{r.winner}</HtLink>
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: 12, color: R.faint }}>—</span>
                )}
              </div>
              <div style={{ textAlign: 'right', fontSize: 10, color: R.faint, fontFamily: MONO }}>{r.votes ?? '—'}</div>
            </div>
          ))}

          {loading && <div style={{ padding: '20px 10px', color: R.faint, fontSize: 11 }}>Loading…</div>}
          {!loading && rows.length === 0 && (
            <div style={{ padding: '20px 10px', color: R.faint, fontSize: 11 }}>No elections stored for this country yet.</div>
          )}

          <div style={{ padding: '6px 10px', fontSize: 10, color: R.faint, fontFamily: MONO, background: R.panel2 }}>
            src: World/Elections/History.aspx
          </div>
        </div>

        <div style={{ border: '1px solid var(--frame,#617D54)' }}>
          <SectionBar>Most elected (top 10)</SectionBar>
          <div style={{ padding: 11, background: R.panel, display: 'flex', flexDirection: 'column', gap: 11 }}>
            {tallyArr.length === 0 && <div style={{ fontSize: 11, color: R.faint }}>—</div>}
            {tallyArr.map(([name, { count, userId, nationality }], i) => (
              <div key={name}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, gap: 8 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                    <Flag url={nationalityFlagUrl(nationality)} label={nationality} />
                    <span style={{ fontSize: 11, fontWeight: 'bold', color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <HtLink href={userId ? hattrickManagerUrl(userId) : null}>{name}</HtLink>
                    </span>
                  </span>
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
