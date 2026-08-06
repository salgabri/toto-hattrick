import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, Dispatch, ReactNode, SetStateAction } from 'react';
import {
  getCabinet,
  getCupCountries,
  getCups,
  ELECTION_NATION_TOP_N,
  getElectionAggregates,
  getElectionCountries,
  getElections,
  getLeagues,
  getManagers,
  getCoachMedals,
  getMastersWinners,
  getNationalCompetitions,
  getNationalities,
  getSeasonalCups,
  getWinners,
  type CoachMedals,
  type Country,
  type CupRoll,
  type ElectionAggregates,
  type ElectionResult,
  type Manager,
  type NationalCompetition,
  type SeasonalCupRoll,
  type SeasonWindow,
  type TrophyCabinet,
  type TrophyItem,
  type Winner,
} from '../data.js';
import { leagueFlagUrl, nationFlagUrl, nationalityFlagUrl } from '../flags.js';
import { LANGS, useI18n, useT, type Lang, type TFn, type TranslationKey } from '../../i18n/index.js';
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

export type RetroView = 'trophies' | 'leagues' | 'cups' | 'worldcup' | 'medals' | 'elections';

export interface Retro2000sProps {
  /** Fixed at render time — there is no in-app skin picker, so a caller choosing 'blue' is the
   *  only way off the bottle-green default. */
  skin?: Skin;
}

export function Retro2000s({ skin = 'green' }: Retro2000sProps) {
  const { lang, setLang, t } = useI18n();
  const [view, setView] = useState<RetroView>('trophies');

  // View state lives on the parent so it survives tab switches.
  const [nation, setNation] = useState<string>('ALL');
  const [query, setQuery] = useState('');
  const [inc, setInc] = useState<IncState>({ champ: true, main: true, sec: false, hm: true, sn: true, wc: true });
  const [lastOnly, setLastOnly] = useState(false);
  // Independent of `lastOnly`: undefined = all time. Both live on the one Recency control.
  const [seasonWindow, setSeasonWindow] = useState<SeasonWindow | undefined>(undefined);
  const [medals, setMedals] = useState(false);
  const [groupBy, setGroupBy] = useState<TrophyGroupBy>('manager');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [league, setLeague] = useState<string>('');
  const [cupCountry, setCupCountry] = useState<string>('');
  const [electionCountry, setElectionCountry] = useState<string>('');
  const [electionTab, setElectionTab] = useState<ElectionTab>('managers');
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

  /** The one banner control: the language picker, in the 2000s inset-field look. */
  const langSelect: CSSProperties = {
    border: '2px inset var(--btn,#EBEFE2)',
    background: R.btn,
    color: '#222',
    padding: '3px 4px',
    cursor: 'pointer',
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
            <div style={{ fontSize: 10, marginTop: 5, letterSpacing: '.3px', opacity: 0.92 }}>{t('app.tagline')}</div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'flex-end' }}>
            <div style={{ fontSize: 10, opacity: 0.92 }}>
              {managersTracked == null ? t('app.loading') : t('app.managersTracked', { n: managersTracked.toLocaleString(lang) })}
            </div>
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
              title={t('app.language')}
              aria-label={t('app.language')}
              style={langSelect}
            >
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
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
            <Tab key={n.key} label={t(n.labelKey)} active={view === n.key} onClick={() => setView(n.key)} />
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
              seasonWindow={seasonWindow}
              setSeasonWindow={setSeasonWindow}
              medals={medals}
              setMedals={setMedals}
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
            <RetroNationalTrophies onStatus={setStatus} />
          ) : view === 'medals' ? (
            <RetroMedalTables onStatus={setStatus} />
          ) : (
            <RetroElections
              countries={electionCountries}
              country={electionCountry}
              setCountry={setElectionCountry}
              tab={electionTab}
              setTab={setElectionTab}
              onStatus={setStatus}
            />
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
          <span style={{ opacity: 0.92 }}>{t('app.footer')}</span>
        </div>
      </div>
    </div>
  );
}

/* ============================== NAV / TABS ============================== */

const NAV: Array<{ key: RetroView; labelKey: TranslationKey }> = [
  { key: 'trophies', labelKey: 'nav.trophies' },
  { key: 'leagues', labelKey: 'nav.leagues' },
  { key: 'cups', labelKey: 'nav.cups' },
  { key: 'worldcup', labelKey: 'nav.worldcup' },
  { key: 'medals', labelKey: 'nav.medals' },
  { key: 'elections', labelKey: 'nav.elections' },
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

/**
 * The bar is the column that earns extra width, so it takes the slack.
 *
 * The manager column used to be the `1fr` one and swallowed every spare pixel — on a wide screen
 * that meant ~700px of white space beside a login name while the mix bar stayed pinned at its 200px
 * cap. A name and a nation need what they need and no more; the bar gets longer the more room there
 * is, which is exactly where extra length is worth something.
 */
const RETRO_TROPHY_GRID = '46px minmax(150px,290px) 160px minmax(200px,1fr) 56px 22px';
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
/**
 * The recency choices, one row of mutually exclusive buttons.
 *
 * "Reigning only" IS the one-instalment window — it keeps each competition's current holder, which
 * is exactly what `ago === 0` means (see data.ts `inWindow`). So there is no separate "Last season"
 * button: it would be a second control producing byte-identical results. Reigning keeps the name
 * because "the current champion" says more than "a window of one".
 *
 * Windows count a competition's own instalments, so for the World Cup "Last 5" is the last five
 * World Cups rather than five Hattrick seasons — see `agoOf` in server/sync/bake.ts for why that
 * trade buys the exact agreement with Reigning above.
 */
const RECENCY_OPTS: Array<{ labelKey: TranslationKey; reigning: boolean; window?: SeasonWindow; titleKey: TranslationKey }> = [
  { labelKey: 'recency.allTime', reigning: false, titleKey: 'recency.allTime.title' },
  { labelKey: 'recency.reigning', reigning: true, titleKey: 'recency.reigning.title' },
  { labelKey: 'recency.last5', reigning: false, window: 5, titleKey: 'recency.last5.title' },
  { labelKey: 'recency.last10', reigning: false, window: 10, titleKey: 'recency.last10.title' },
  { labelKey: 'recency.last20', reigning: false, window: 20, titleKey: 'recency.last20.title' },
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

/**
 * Category → colour → the count field holding it, in legend order. The single source for the trophy
 * mix bar, the per-nation breakdown panel and anything else that has to name these six.
 *
 * `ink` is the colour the category's NUMBER is printed in, which is the swatch colour everywhere it
 * reads as text. Secondary cups are the exception: their pale grey-green swatch is meant to recede
 * inside a bar and would be barely legible as 10px type, so their figure borrows the body colour.
 */
const TROPHY_CATS: Array<{ labelKey: TranslationKey; dot: string; ink: string; k: keyof IncState; f: keyof TrophyCounts }> = [
  { labelKey: 'cat.champ', dot: R.champ, ink: R.champ, k: 'champ', f: 'lg' },
  { labelKey: 'cat.main', dot: R.main, ink: R.main, k: 'main', f: 'main' },
  { labelKey: 'cat.masters', dot: R.masters, ink: R.masters, k: 'hm', f: 'hm' },
  { labelKey: 'cat.national', dot: R.worldCup, ink: R.worldCup, k: 'wc', f: 'wc' },
  { labelKey: 'cat.seasonal', dot: R.seasonal, ink: R.seasonal, k: 'sn', f: 'sn' },
  { labelKey: 'cat.sec', dot: R.sec, ink: R.soft, k: 'sec', f: 'sec' },
];

interface MixSegment { n: number; color: string; ink: string; labelKey: TranslationKey }

/** The counted categories in legend order — excluded ones contribute no segment. */
function mixSegments(c: TrophyCounts, inc: IncState): MixSegment[] {
  return TROPHY_CATS.filter((cat) => inc[cat.k] && c[cat.f]).map((cat) => ({ n: c[cat.f], color: cat.dot, ink: cat.ink, labelKey: cat.labelKey }));
}

/** Smallest slice of the track a single trophy may render as, so a lone one is never invisible. */
const MIX_MIN_SEGMENT_PX = 3;

/**
 * A row's trophies: bar LENGTH is the total, segments are the mix.
 *
 * `max` is the biggest total on the page, so the leader fills the track and everyone else reads
 * against them — the descending skyline a ranked table wants. It used to be a 100%-stacked bar,
 * which made every row exactly as long as every other and left the eye no way to tell 55 trophies
 * from 29 (the figure in the TOTAL column was doing all the work). Re-normalising per PAGE rather
 * than across all 4,879 managers is what keeps page 40 legible instead of a column of slivers;
 * TOTAL remains the absolute number, and it sits right there for the comparison across pages.
 */
function MixBar({ segs, total, max }: { segs: MixSegment[]; total: number; max: number }) {
  const t = useT();
  // Never let a real total round away to nothing.
  const width = max > 0 ? Math.max((total / max) * 100, 1.5) : 0;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ height: 11, border: '1px solid var(--frame,#617D54)', background: R.panel2, overflow: 'hidden' }}>
        <div style={{ display: 'flex', height: '100%', width: width + '%' }}>
          {segs.map((sg, ix) => (
            <span
              key={ix}
              title={`${t(sg.labelKey)}: ${sg.n}`}
              style={{
                // Weighted by count, so the slices inside the bar still read as the mix.
                flex: `${sg.n} 1 0`,
                minWidth: MIX_MIN_SEGMENT_PX,
                background: sg.color,
                borderRight: ix < segs.length - 1 ? '1px solid rgba(0,0,0,.25)' : undefined,
              }}
            />
          ))}
        </div>
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 'bold', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
        {segs.length === 0 && <span style={{ color: R.faint }}>0</span>}
        {segs.map((sg, ix) => (
          <span key={ix} title={t(sg.labelKey)} style={{ color: sg.ink }}>
            {ix > 0 && <span style={{ color: R.faint, fontWeight: 'normal' }}>+ </span>}
            {sg.n}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A gold/silver/bronze table — one row per nation or per coach, same shape either way. */
interface MedalRow { key: string; label: string; flag: string | null; href?: string | null; g: number; s: number; b: number }

/**
 * A gold/silver/bronze table, laid out like every other full-width table in the app: rank badge,
 * flag, name, then the three podium columns. It used to be a compact side panel squeezed beside
 * the champions list — that constraint is gone now that the medal view is its own tab showing one
 * table at a time, so it no longer needs the tiny type or the internal scroller.
 *
 * Rows are ordered like an Olympic table (gold, then silver, then bronze), which puts every
 * medallist without a gold below every champion. Nothing is capped: a 12-row cut once hid 8 silvers
 * and 17 bronzes in the Europe Cup, making the medal columns look empty.
 */
const MEDAL_GRID = '46px minmax(0,1fr) 70px 70px 70px 22px';

/**
 * `detail` turns a row into an expandable one: it renders what sits behind that row's totals, and
 * each of the three groupings supplies a different panel (the podiums themselves, or the coaches
 * pooled into a nationality). Returning null for a row leaves it inert.
 *
 * Expansion state is local, so switch the grouping or the scope with a `key` on this component —
 * an open row id means something different in each mode.
 */
function MedalTable({
  title,
  rows,
  empty,
  headerKey,
  detail,
}: {
  title: string;
  rows: MedalRow[];
  empty: string;
  headerKey: TranslationKey;
  detail?: (row: MedalRow) => ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const goldsOnly = rows.length > 0 && rows.every((r) => r.s + r.b === 0);
  return (
    <div style={{ border: '1px solid var(--frame,#617D54)' }}>
      <SectionBar>
        {title}
        <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 10, opacity: 0.85 }}>{rows.length}</span>
      </SectionBar>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: MEDAL_GRID,
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
        <div>{t('col.rank')}</div>
        <div>{t(headerKey)}</div>
        <div style={{ textAlign: 'center' }} title={t('place.champion')}>{t('place.1')}</div>
        <div style={{ textAlign: 'center' }} title={t('place.runnerUp')}>{t('place.2')}</div>
        <div style={{ textAlign: 'center' }} title={t('place.thirdTitle')}>{t('place.3')}</div>
        <div />
      </div>

      {goldsOnly && (
        <div style={{ fontSize: 9, color: R.faint, padding: '6px 10px', lineHeight: 1.4, background: R.panel, borderBottom: '1px solid var(--line,#CDD7C3)' }}>
          {t('medal.goldsOnly')}
        </div>
      )}

      {rows.map((r, i) => {
        const body = detail?.(r);
        const isExp = open === r.key && !!body;
        const toggle = () => body && setOpen((cur) => (cur === r.key ? null : r.key));
        return (
          <div key={r.key}>
            <div
              className={body ? 'retro-row' : undefined}
              role={body ? 'button' : undefined}
              tabIndex={body ? 0 : undefined}
              aria-expanded={body ? isExp : undefined}
              onClick={toggle}
              onKeyDown={(ev) => {
                if (body && (ev.key === 'Enter' || ev.key === ' ')) {
                  ev.preventDefault();
                  toggle();
                }
              }}
              style={{
                display: 'grid',
                gridTemplateColumns: MEDAL_GRID,
                gap: 10,
                alignItems: 'center',
                padding: 'var(--rp,7px) 10px',
                borderBottom: '1px solid var(--line,#CDD7C3)',
                cursor: body ? 'pointer' : 'default',
                background: isExp ? R.selrow : i % 2 ? R.alt : R.panel,
              }}
            >
              <div>
                <RankBadge rank={i + 1} />
              </div>
              <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
                <Flag url={r.flag} label={r.label} size={24} />
                <span style={{ fontSize: 12, fontWeight: 'bold', color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <HtLink href={r.href ?? null}>{r.label}</HtLink>
                </span>
              </div>
              {([['g', MEDAL_GOLD], ['s', MEDAL_SILVER], ['b', MEDAL_BRONZE]] as const).map(([k, bg]) => (
                <span
                  key={k}
                  style={{
                    textAlign: 'center',
                    fontFamily: MONO,
                    fontSize: 13,
                    fontWeight: 'bold',
                    padding: '2px 0',
                    color: r[k] ? '#241c08' : R.faint,
                    background: r[k] ? bg : 'transparent',
                    border: '1px solid ' + (r[k] ? 'rgba(0,0,0,.35)' : 'transparent'),
                  }}
                >
                  {r[k] || '·'}
                </span>
              ))}
              <div style={{ textAlign: 'center' }}>{body ? <ExpandGlyph open={isExp} /> : null}</div>
            </div>

            {isExp && (
              <div style={{ padding: '10px 12px 12px 56px', background: R.panel2, borderBottom: '1px solid var(--line,#CDD7C3)' }}>
                <div style={{ border: '2px inset var(--btn,#EBEFE2)', background: R.panel, padding: '8px 10px 10px' }}>{body}</div>
              </div>
            )}
          </div>
        );
      })}

      {rows.length === 0 && <div style={{ padding: '20px 10px', color: R.faint, fontSize: 11 }}>{empty}</div>}
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

/** Medal-plate colours, shared with the National trophies medal table so gold/silver/bronze read
 *  the same everywhere. */
const MEDAL_GOLD = '#D8A93B';
const MEDAL_SILVER = '#C7C3B8';
const MEDAL_BRONZE = '#C08A52';

/** A cabinet row, plus which podium place it was — 0 for anything that isn't a national trophy. */
type CabinetItem = TrophyItem & { medal?: number };

/** What a failed cabinet fetch renders as: empty, rather than a row stuck on "Loading…". */
const EMPTY_CABINET: TrophyCabinet = { champ: [], main: [], sec: [], other: [], seasonal: [], worldCup: [], silver: [], bronze: [] };

function cabinetCats(t: TFn, tr: TrophyCabinet, inc: IncState, lastOnly: boolean, medals = false) {
  const pick = (items: TrophyItem[]): CabinetItem[] => (lastOnly ? items.filter((it) => it.last) : items);
  // One National box, ordered by place: every 1st, then every 2nd, then every 3rd (each already
  // newest-first). The place badge rides on the row, so one group stays unambiguous.
  const national: CabinetItem[] = medals
    ? [
        ...pick(tr.worldCup).map((it) => ({ ...it, medal: 1 })),
        ...tr.silver.map((it) => ({ ...it, medal: 2 })),
        ...tr.bronze.map((it) => ({ ...it, medal: 3 })),
      ]
    : pick(tr.worldCup);
  return [
    { label: t('cat.champ'), dot: R.champ, items: pick(tr.champ), excluded: !inc.champ },
    { label: t('cat.main'), dot: R.main, items: pick(tr.main), excluded: !inc.main },
    { label: t('cat.masters'), dot: R.masters, items: pick(tr.other), excluded: !inc.hm },
    { label: t(medals ? 'cat.nationalMedals' : 'cat.national'), dot: R.worldCup, items: national, excluded: !inc.wc },
    { label: t('cat.seasonal'), dot: R.seasonal, items: pick(tr.seasonal), excluded: !inc.sn },
    { label: t('cat.sec'), dot: R.sec, items: pick(tr.sec), excluded: !inc.sec },
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
  seasonWindow,
  setSeasonWindow,
  medals,
  setMedals,
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
  seasonWindow: SeasonWindow | undefined;
  setSeasonWindow: Dispatch<SetStateAction<SeasonWindow | undefined>>;
  medals: boolean;
  setMedals: Dispatch<SetStateAction<boolean>>;
  groupBy: TrophyGroupBy;
  setGroupBy: Dispatch<SetStateAction<TrophyGroupBy>>;
  expandedId: string | null;
  setExpandedId: Dispatch<SetStateAction<string | null>>;
  onStatus: (s: string) => void;
}) {
  const { lang, t } = useI18n();
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(true);
  const [cabinets, setCabinets] = useState<Record<number, TrophyCabinet | null>>({});
  const [page, setPage] = useState(1);

  // Nationality is the grouping dimension in nation mode, so it can't also be a filter there —
  // always pull the whole field.
  useEffect(() => {
    setLoading(true);
    getManagers(groupBy === 'nation' || nation === 'ALL' ? undefined : nation, seasonWindow)
      .then(setManagers)
      .catch(() => setManagers([]))
      .finally(() => setLoading(false));
  }, [nation, groupBy, seasonWindow]);

  // Any filter change reshuffles the ranked list, so drop back to the first page.
  useEffect(() => {
    setPage(1);
  }, [nation, query, inc, lastOnly, seasonWindow, groupBy, medals]);

  // Row ids mean different things per mode (userId vs nation name) — never carry one over.
  useEffect(() => {
    setExpandedId(null);
  }, [groupBy, setExpandedId]);

  const loadCabinet = (userId: number) =>
    getCabinet(userId, (country) => t('cabinet.champTitle', { country }), seasonWindow);

  // A cached cabinet holds a translated "<country> champions" heading, so a language switch has to
  // drop the cache — and re-fetch whichever row is open, which would otherwise sit on "Loading…"
  // with nothing left to fill it.
  useEffect(() => {
    setCabinets({});
    if (groupBy !== 'manager' || !expandedId) return;
    const userId = Number(expandedId);
    let cancelled = false;
    loadCabinet(userId)
      .then((cab) => !cancelled && setCabinets((c) => ({ ...c, [userId]: cab })))
      .catch(() => !cancelled && setCabinets((c) => ({ ...c, [userId]: EMPTY_CABINET })));
    return () => {
      cancelled = true;
    };
    // Language only — opening a row is handled by toggleExpand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const toggleInc = (k: keyof IncState) => setInc((s) => ({ ...s, [k]: !s[k] }));
  const toggleNation = (name: string) => setExpandedId((cur) => (cur === name ? null : name));
  const toggleExpand = (m: Manager) => {
    setExpandedId((cur) => (cur === String(m.userId) ? null : String(m.userId)));
    if (!(m.userId in cabinets)) {
      setCabinets((c) => ({ ...c, [m.userId]: null }));
      loadCabinet(m.userId)
        .then((cab) => setCabinets((c) => ({ ...c, [m.userId]: cab })))
        .catch(() => setCabinets((c) => ({ ...c, [m.userId]: EMPTY_CABINET })));
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
      // "Medal winners" widens ONLY the national-trophy component — it's the one category with
      // podium data at all (no league or cup runner-up is recorded anywhere in the bake), so a
      // silver never inflates a championship count. Reigning-only stays titles-only: there is no
      // such thing as a reigning runner-up.
      const podium = medals && !lastOnly ? m.wcSilver + m.wcBronze : 0;
      const wc = (lastOnly ? m.wcLast : m.wc) + podium;
      const ft = (inc.champ ? lg : 0) + (inc.main ? main : 0) + (inc.sec ? sec : 0) + (inc.hm ? hm : 0) + (inc.sn ? sn : 0) + (inc.wc ? wc : 0);
      return { m, ft, lg, main, sec, hm, sn, wc };
    });
    // Golds still outrank silver: ties break on titles won, so a medal never leapfrogs a champion.
    l.sort((a, b) => b.ft - a.ft || b.m.wc - a.m.wc || b.lg - a.lg);
    return l.map((e, i) => ({ ...e, rank: i + 1 }));
  }, [managers, inc, lastOnly, medals]);

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
  // What the mix bars are drawn against (see MixBar): the page's own leader. Rows are already
  // sorted by total, so that's the first one — but take the max rather than assume it, since the
  // filters can leave a page where it isn't.
  const pageMax = (byNation ? pageNations : pageRows).reduce((m, r) => Math.max(m, r.ft), 0);

  useEffect(() => {
    if (!loading) onStatus(`Done. ${rowCount} record(s).`);
  }, [loading, rowCount, onStatus]);

  const chips: Array<{ k: keyof IncState; label: string }> = [
    { k: 'champ', label: t('cat.champ') },
    { k: 'main', label: t('cat.main') },
    { k: 'hm', label: t('chip.masters') },
    { k: 'wc', label: t('chip.national') },
    { k: 'sn', label: t('chip.seasonal') },
    { k: 'sec', label: t('chip.sec') },
  ];

  return (
    <div>
      {/* Filters — two meaning-groups: what gets counted, then how the counted field is shown. */}
      <fieldset style={fieldset}>
        <legend style={legend}>{t('filters.title')}</legend>

        <FilterRow>
          <div>
            <div style={filterLabel}>{t('filters.competitions')}</div>
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
            <div style={filterLabel}>{t('filters.recency')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {RECENCY_OPTS.map((o) => {
                const on = lastOnly === o.reigning && seasonWindow === o.window;
                return (
                  <button
                    key={o.labelKey}
                    onClick={() => {
                      setLastOnly(o.reigning);
                      setSeasonWindow(o.window);
                      // Reigning-only and medals are mutually exclusive (see below) — rather than
                      // leaving a dead button, each switch just turns the other one off.
                      if (o.reigning) setMedals(false);
                    }}
                    style={toggleBtn(on)}
                    title={t(o.titleKey)}
                  >
                    {on && <span>✓&nbsp;</span>}
                    {t(o.labelKey)}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div style={filterLabel}>{t('filters.nationalCount')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button onClick={() => setMedals(false)} style={toggleBtn(!medals)} title={t('count.winners.title')}>
                {!medals && <span>✓&nbsp;</span>}
                {t('count.winners')}
              </button>
              <button
                onClick={() => {
                  setMedals(true);
                  // There is no such thing as a reigning runner-up, so asking for medals means
                  // asking for all-time. Switch it rather than refusing the click.
                  setLastOnly(false);
                }}
                style={toggleBtn(medals)}
                title={t('count.medals.title')}
              >
                {medals && <span>✓&nbsp;</span>}
                {t('count.medals')}
              </button>
            </div>
          </div>
        </FilterRow>

        <FilterRow divider>
          <div>
            <div style={filterLabel}>{t('filters.groupBy')}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setGroupBy('manager')} style={toggleBtn(!byNation)} title={t('group.managers.title')}>
                {!byNation && <span>✓&nbsp;</span>}
                {t('group.managers')}
              </button>
              <button onClick={() => setGroupBy('nation')} style={toggleBtn(byNation)} title={t('group.nation.title')}>
                {byNation && <span>✓&nbsp;</span>}
                {t('group.nation')}
              </button>
            </div>
          </div>
          {!byNation && (
            <div>
              <div style={filterLabel}>{t('filters.nationality')}</div>
              <select value={nation} onChange={(e) => setNation(e.target.value)} style={selectStyle}>
                <option value="ALL">{t('filters.allNationalities')}</option>
                {nationalities.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <div style={filterLabel}>{t('filters.search')}</div>
            <input
              className="retro-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={byNation ? t('search.nation') : t('search.manager')}
              style={{ width: 190, border: '2px inset var(--btn,#EBEFE2)', background: '#fff', color: R.ink, fontSize: 11, padding: '3px 6px', outline: 'none', fontFamily: 'inherit' }}
            />
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 10, color: R.soft, paddingBottom: 4 }}>
            {rowCount > PAGE_SIZE
              ? t('paging.range', {
                  from: pageStart + 1,
                  to: pageStart + (byNation ? pageNations.length : pageRows.length),
                  total: rowCount,
                })
              : t('paging.shown', { n: rowCount })}
          </div>
        </FilterRow>
      </fieldset>

      {/* Leaderboard */}
      <div style={{ border: '1px solid var(--frame,#617D54)' }}>
        <SectionBar>{t(byNation ? 'board.trophyLeadersByNation' : 'board.trophyLeaders')}</SectionBar>
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
          <div>{t('col.rank')}</div>
          <div>{t(byNation ? 'col.managerNation' : 'col.manager')}</div>
          <div>{t(byNation ? 'col.winners' : 'col.nationality')}</div>
          <div>{t('col.trophyMix')}</div>
          <div style={{ textAlign: 'right' }}>{t('col.total')}</div>
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
                    {n.winners.toLocaleString(lang)}
                    <span style={{ fontSize: 10, color: R.faint }}> {t(n.winners === 1 ? 'unit.manager' : 'unit.managers')}</span>
                  </div>
                  <MixBar segs={segs} total={n.ft} max={pageMax} />
                  <div style={{ textAlign: 'right', fontFamily: MONO, fontSize: 17, fontWeight: 'bold', color: R.ink }}>{n.ft}</div>
                  <div style={{ textAlign: 'center' }}>
                    <ExpandGlyph open={isExp} />
                  </div>
                </div>

                {isExp && (
                  <div style={{ padding: '10px 12px 12px 66px', background: R.panel2, borderBottom: '1px solid var(--line,#CDD7C3)' }}>
                    <div style={{ border: '2px inset var(--btn,#EBEFE2)', background: R.panel, padding: 10, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 190, border: '1px solid var(--line,#CDD7C3)', background: R.panel, padding: '8px 10px' }}>
                        <div style={{ ...cabinetHead, marginBottom: 9 }}>{t('panel.byCompetition')}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                          {TROPHY_CATS.map((c) => (
                            <div key={c.labelKey} style={{ display: 'flex', alignItems: 'center', gap: 7, opacity: inc[c.k] ? 1 : 0.5 }}>
                              <span style={{ width: 9, height: 9, flex: 'none', border: '1px solid rgba(0,0,0,.3)', background: c.dot }} />
                              <span style={{ fontSize: 11, color: R.ink, flex: 1 }}>{t(c.labelKey)}</span>
                              {!inc[c.k] && (
                                <span style={{ fontSize: 9, fontWeight: 'bold', letterSpacing: '.03em', textTransform: 'uppercase', color: R.faint }}>
                                  {t('label.excluded')}
                                </span>
                              )}
                              <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 'bold', color: R.soft }}>{n[c.f]}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={{ flex: 2, minWidth: 240, border: '1px solid var(--line,#CDD7C3)', background: R.panel, padding: '8px 10px' }}>
                        <div style={{ ...cabinetHead, marginBottom: 9 }}>
                          {t('panel.topManagers')}{' '}
                          {n.winners > NATION_TOP_N ? t('panel.topManagersOf', { shown: NATION_TOP_N, total: n.winners }) : ''}
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
                <MixBar segs={segRaw} total={e.ft} max={pageMax} />
                <div style={{ textAlign: 'right', fontFamily: MONO, fontSize: 17, fontWeight: 'bold', color: R.ink }}>{e.ft}</div>
                <div style={{ textAlign: 'center' }}>
                  <ExpandGlyph open={isExp} />
                </div>
              </div>

              {isExp && (
                <div style={{ padding: '10px 12px 12px 66px', background: R.panel2, borderBottom: '1px solid var(--line,#CDD7C3)' }}>
                  <div style={{ border: '2px inset var(--btn,#EBEFE2)', background: R.panel, padding: 10, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {cab == null ? (
                      <div style={{ color: R.faint, fontSize: 11 }}>{t('cabinet.loading')}</div>
                    ) : cabinetCats(t, cab, inc, lastOnly, medals).length === 0 ? (
                      <div style={{ color: R.faint, fontSize: 11 }}>{t('cabinet.empty')}</div>
                    ) : (
                      cabinetCats(t, cab, inc, lastOnly, medals).map((g) => (
                        <div key={g.label} style={{ flex: 1, minWidth: 190, border: '1px solid var(--line,#CDD7C3)', background: R.panel, padding: '8px 10px', opacity: g.excluded ? 0.5 : 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 9, borderBottom: '1px solid var(--line,#CDD7C3)', paddingBottom: 5 }}>
                            <span style={{ width: 9, height: 9, flex: 'none', border: '1px solid rgba(0,0,0,.3)', background: g.dot }} />
                            <span style={{ fontSize: 10, letterSpacing: '.05em', textTransform: 'uppercase', fontWeight: 'bold', color: R.soft }}>{g.label}</span>
                            <span style={{ fontFamily: MONO, fontSize: 11, color: R.faint }}>×{g.items.length}</span>
                            {g.excluded && (
                              <span style={{ fontSize: 9, fontWeight: 'bold', letterSpacing: '.03em', textTransform: 'uppercase', color: R.faint }}>
                                {t('label.excluded')}
                              </span>
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
                                <span style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 'none' }}>
                                  {/* The place travels with the row, so a medal is never mistaken for
                                      a title when a cabinet is read at a glance. */}
                                  {!!it.medal && (
                                    <span
                                      title={t(it.medal === 1 ? 'place.champion' : it.medal === 2 ? 'place.runnerUp' : 'place.thirdShort')}
                                      style={{
                                        fontFamily: MONO,
                                        fontSize: 9,
                                        fontWeight: 'bold',
                                        color: '#241c08',
                                        background: it.medal === 1 ? MEDAL_GOLD : it.medal === 2 ? MEDAL_SILVER : MEDAL_BRONZE,
                                        border: '1px solid rgba(0,0,0,.35)',
                                        padding: '0 4px',
                                      }}
                                    >
                                      {t(it.medal === 1 ? 'place.1' : it.medal === 2 ? 'place.2' : 'place.3')}
                                    </span>
                                  )}
                                  <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 'bold', color: R.soft }}>{it.season}</span>
                                </span>
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

        {loading && <div style={{ padding: '22px 12px', textAlign: 'center', color: R.faint, fontSize: 11 }}>{t('list.loadingManagers')}</div>}
        {!loading && rowCount === 0 && (
          <div style={{ padding: '22px 12px', textAlign: 'center', color: R.faint, fontSize: 11 }}>
            {t(byNation ? 'list.noNations' : 'list.noManagers')}
          </div>
        )}
      </div>

      {!loading && pageCount > 1 && <RetroPager page={curPage} pageCount={pageCount} setPage={setPage} />}

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 9, fontSize: 10, color: R.ink, flexWrap: 'wrap' }}>
        <b style={{ color: R.soft, textTransform: 'uppercase', letterSpacing: '.04em' }}>{t('legend.title')}</b>
        <LegendSwatch color={R.champ} label={t('cat.champ')} />
        <LegendSwatch color={R.main} label={t('cat.main')} />
        <LegendSwatch color={R.masters} label={t('chip.masters')} />
        <LegendSwatch color={R.worldCup} label={t('cat.national')} />
        <LegendSwatch color={R.seasonal} label={t('chip.seasonal')} />
        <LegendSwatch color={R.sec} label={t('chip.sec')} />
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: MONO, color: R.faint }}>{t('src.league')}</span>
      </div>

      {/* A window counts each competition's own instalments, which for the World Cup and the regional
          cups is not the same span of time as five league seasons. Worth saying once, in place. */}
      {seasonWindow !== undefined && (
        <div style={{ fontSize: 9, color: R.faint, marginTop: 7, lineHeight: 1.5 }}>{t('recency.windowNote')}</div>
      )}
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
  const t = useT();
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
      <button style={btn(first)} disabled={first} onClick={() => setPage(1)} title={t('pager.first')}>
        |«
      </button>
      <button style={btn(first)} disabled={first} onClick={() => setPage((p) => Math.max(1, p - 1))} title={t('pager.prev')}>
        «
      </button>
      <span style={{ fontFamily: MONO, fontSize: 11, color: R.soft, padding: '0 6px', fontWeight: 'bold' }}>
        {t('pager.page', { page, count: pageCount })}
      </span>
      <button style={btn(last)} disabled={last} onClick={() => setPage((p) => Math.min(pageCount, p + 1))} title={t('pager.next')}>
        »
      </button>
      <button style={btn(last)} disabled={last} onClick={() => setPage(pageCount)} title={t('pager.last')}>
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
  const t = useT();
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
  const span = winnersRaw.length
    ? t('leagues.span', { from: winnersRaw[winnersRaw.length - 1]!.season, to: winnersRaw[0]!.season, name: leagueName })
    : leagueName;

  return (
    <div>
      <fieldset style={fieldset}>
        <legend style={legend}>{t('leagues.select')}</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 20px', alignItems: 'flex-end' }}>
          <div>
            <div style={filterLabel}>{t('common.country')}</div>
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
            {t('leagues.rollOfHonour', { country: leagueName })}
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
            <div>{t('col.season')}</div>
            <div>{t('col.champion')}</div>
            <div style={{ textAlign: 'right' }}>{t('col.run')}</div>
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

          {loading && <div style={{ padding: '20px 10px', color: R.faint, fontSize: 11 }}>{t('common.loading')}</div>}
          {!loading && winnersRaw.length === 0 && (
            <div style={{ padding: '20px 10px', color: R.faint, fontSize: 11 }}>{t('leagues.empty')}</div>
          )}

          <div style={{ padding: '6px 10px', fontSize: 10, color: R.faint, fontFamily: MONO, background: R.panel2 }}>{t('src.league')}</div>
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
  const t = useT();
  const tally: Record<string, { count: number; teams: Array<{ name: string; teamId?: number; leagueId?: number }>; nationality?: string; userId?: number }> = {};
  winners.forEach((w) => {
    if (!w.manager || w.manager === '—') return;
    const e = (tally[w.manager] ??= { count: 0, teams: [], nationality: w.nationality, userId: w.userId });
    e.count++;
    if (!e.teams.some((t) => t.name === w.club)) e.teams.push({ name: w.club, teamId: w.teamId, leagueId: w.leagueId });
  });
  const arr = Object.entries(tally)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit);
  const max = arr.length ? arr[0]![1].count : 1;

  return (
    <div style={{ border: '1px solid var(--frame,#617D54)' }}>
      <SectionBar>{t('panel.topManagersTop', { n: limit })}</SectionBar>
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
            {/* Club flags appear only for the international competitions, the only ones whose winners
                come from different countries (see Winner.leagueId). */}
            <div style={{ fontSize: 10, color: R.soft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>
              {teams.map((t, ti) => (
                <span key={t.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, verticalAlign: 'middle' }}>
                  {ti > 0 && <span style={{ marginRight: 3 }}>,</span>}
                  <Flag url={leagueFlagUrl(t.leagueId)} size={13} />
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

const CUP_CATEGORIES: Array<{ k: CupCategory; labelKey: TranslationKey }> = [
  { k: 'main', labelKey: 'cupcat.main' },
  { k: 'secondary', labelKey: 'cupcat.secondary' },
  { k: 'masters', labelKey: 'cupcat.masters' },
  { k: 'seasonal', labelKey: 'cupcat.seasonal' },
];

/** Outset/inset toggle button matching the retro Windows-98 chip look used for the trophy filters. */
function CategoryChip({ label, active, onClick, title }: { label: string; active: boolean; onClick: () => void; title?: string }) {
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
    <span onClick={onClick} style={style} title={title}>
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
  const t = useT();
  const [category, setCategory] = useState<CupCategory>('main');

  // National cups (main + secondary) — nation-based, keyed by the selected country.
  const [cups, setCups] = useState<CupRoll[]>([]);
  const [cupsLoading, setCupsLoading] = useState(true);
  const [secondaryCupId, setSecondaryCupId] = useState<number | null>(null);
  const countryName = countries.find((c) => c.code === country)?.name ?? '';
  // Names the club flags in the international rolls, where the winners come from everywhere. The
  // picker's own list doubles as the leagueId→country lookup; a country it doesn't carry simply
  // shows a flag with no tooltip.
  const countryNames = useMemo(() => new Map(countries.map((c) => [c.code, c.name])), [countries]);

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
      <fieldset style={fieldset}>
        <legend style={legend}>{t('cups.select')}</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 20px', alignItems: 'flex-end' }}>
          <div>
            <div style={filterLabel}>{t('cups.competition')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {CUP_CATEGORIES.map((c) => (
                <CategoryChip key={c.k} label={t(c.labelKey)} active={category === c.k} onClick={() => setCategory(c.k)} />
              ))}
            </div>
          </div>

          {showCountryPicker && (
            <div>
              <div style={filterLabel}>{t('common.country')}</div>
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
              <div style={filterLabel}>{t('cups.secondaryCup')}</div>
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
              <div style={filterLabel}>{t('cups.seasonalCup')}</div>
              <select
                value={seasonalCupId ?? ''}
                onChange={(e) => setSeasonalCupId(Number(e.target.value))}
                style={selectStyle}
                disabled={seasonalCups.length === 0}
              >
                {supporterWeek && <option value={supporterWeek.cupId}>{supporterWeek.cupName}</option>}
                {generationCohorts.length > 0 && (
                  <optgroup label={t('cups.generationGroup')}>
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

      {loading && <div style={{ padding: '20px 2px', color: R.faint, fontSize: 11 }}>{t('common.loading')}</div>}

      {!loading && category === 'main' && !main && (
        <div style={{ padding: '20px 2px', color: R.faint, fontSize: 11 }}>{t('cups.emptyMain')}</div>
      )}
      {!loading && category === 'main' && main && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 14, alignItems: 'start' }}>
          <RetroCupCard name={main.cupName} winners={main.winners} accent={R.main} tall />
          <TopManagersPanel winners={main.winners} />
        </div>
      )}

      {!loading && category === 'secondary' && !selectedSecondary && (
        <div style={{ padding: '20px 2px', color: R.faint, fontSize: 11 }}>{t('cups.emptySecondary')}</div>
      )}
      {!loading && category === 'secondary' && selectedSecondary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 14, alignItems: 'start' }}>
          <RetroCupCard name={selectedSecondary.cupName} winners={selectedSecondary.winners} accent={R.sec} tall />
          <TopManagersPanel winners={selectedSecondary.winners} />
        </div>
      )}

      {!loading && category === 'masters' && (!masters || masters.length === 0) && (
        <div style={{ padding: '20px 2px', color: R.faint, fontSize: 11 }}>{t('cups.emptyMasters')}</div>
      )}
      {!loading && category === 'masters' && masters && masters.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 14, alignItems: 'start' }}>
          <RetroCupCard name="Hattrick Masters" winners={masters} accent={R.main} tall sourceLabel="cupmatches (global)" countryNames={countryNames} />
          <TopManagersPanel winners={masters} />
        </div>
      )}

      {!loading && category === 'seasonal' && !selectedSeasonal && (
        <div style={{ padding: '20px 2px', color: R.faint, fontSize: 11 }}>{t('cups.emptySeasonal')}</div>
      )}
      {!loading && category === 'seasonal' && selectedSeasonal && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 280px', gap: 14, alignItems: 'start' }}>
          <RetroCupCard
            name={selectedSeasonal.cupName}
            winners={selectedSeasonal.winners}
            accent={R.main}
            tall
            sourceLabel="ArenaHub tournament history"
            countryNames={countryNames}
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
  countryNames,
}: {
  name: string;
  winners: Winner[];
  accent: string;
  tall?: boolean;
  sourceLabel?: string;
  /** leagueId (as a string, the Country.code form) → country name, for the club-flag tooltips. */
  countryNames?: Map<string, string>;
}) {
  const t = useT();
  const winners = withRuns(winnersIn);
  const range = winnersIn.length ? `S${winnersIn[winnersIn.length - 1]!.season}–S${winnersIn[0]!.season}` : '—';
  const showManager = winnersIn.some((w) => w.manager && w.manager !== '—');
  // Only the international cups draw from more than one country, and only they bake a per-winner
  // leagueId. Where they do, every row reserves the flag's width — including the handful whose club
  // never resolved — so the club names still line up as a column.
  const showClubFlags = winnersIn.some((w) => w.leagueId);

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
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 'bold', color: R.ink, minWidth: 0 }}>
                {showClubFlags &&
                  (leagueFlagUrl(w.leagueId) ? (
                    <Flag url={leagueFlagUrl(w.leagueId)} label={countryNames?.get(String(w.leagueId))} size={16} />
                  ) : (
                    <span style={{ width: 16, flex: 'none' }} />
                  ))}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <HtLink href={w.teamId ? hattrickTeamUrl(w.teamId) : null}>{w.club}</HtLink>
                </span>
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
        {t('cups.finals', { n: winnersIn.length, src: sourceLabel })}
      </div>
    </div>
  );
}

/* =========================== WORLD CUP =========================== */

// No Host column: the three panels sit side by side, and the podium columns earn the space more
// than the host nation does (it's still on hattrick.org for anyone who wants it).
// All three podium columns carry a nation plus its coach now, so they get near-equal width rather
// than the champion-heavy split that suited a champion-only roll. 3rd/4th keeps a shade more: it
// stacks two of those pairs.
const WORLD_CUP_GRID = '56px minmax(0,1.1fr) minmax(0,1.1fr) minmax(0,1.15fr) 86px';

/**
 * This table's own row padding, instead of the shared `--rp` (7px).
 *
 * Every other table in the app puts one line in a row. A podium row now holds up to four — two
 * joint-third nations, each with a coach beneath — so the shared value that reads as comfortable
 * elsewhere reads as cramped here.
 */
const WORLD_CUP_ROW_PAD = '11px';

/**
 * The two World Cup brackets are synthesized in the data layer with English labels (the regional
 * cups' names come from Hattrick itself and stay untranslated, like every other proper name here).
 * Translate just those two, and the unit column header that goes with them.
 */
/** World Cup rows number by EDITION, the regional cups by season — decides "Ed. 36" vs "S36". */
const isWorldCupName = (cup: string) => cup === 'World Cup' || cup === 'World Cup (Youth)';

function compLabel(t: TFn, c: NationalCompetition | undefined, short = false): string {
  if (!c) return t('cat.national');
  if (c.key === 'senior') return t('wc.worldCup');
  if (c.key === 'youth') return short ? t('wc.worldCup') : t('wc.worldCupYouth');
  return short ? c.shortLabel : c.label;
}

/** What the medal table counts by. The nation that won, the coach who led it, or that coach's own
 *  nationality — the last being to the second what "Manager nation" is to Trophy leaders. */
type MedalBy = 'nation' | 'coach' | 'coachNation';

const MEDAL_BY: Array<{ k: MedalBy; chip: TranslationKey; title: TranslationKey; header: TranslationKey }> = [
  { k: 'nation', chip: 'medal.nation', title: 'medal.byNation', header: 'medal.nation' },
  { k: 'coach', chip: 'medal.coach', title: 'medal.byCoach', header: 'medal.coach' },
  { k: 'coachNation', chip: 'medal.coachNation', title: 'medal.byCoachNation', header: 'col.nationality' },
];

/** Which age bracket's competitions to show. Single-select everywhere: both views render one
 *  bracket's list at a time, and the medal tables express "pool them" as a SCOPE instead. */
type Bracket = 'senior' | 'youth';

/**
 * Senior/U21 picker.
 *
 * Deliberately not a multi-select. It used to be one, which read as if it widened what you were
 * looking at — but the champions table renders exactly one competition, so ticking both only ever
 * doubled the chip list. Pooling is a real question, and it now lives where it belongs, as
 * `MEDAL_SCOPES` on the medal tables.
 */
function BracketSwitch({ value, onChange }: { value: Bracket; onChange: (b: Bracket) => void }) {
  const t = useT();
  return (
    <div>
      <div style={filterLabel}>{t('wc.nationalTeam')}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button onClick={() => onChange('senior')} style={toggleBtn(value === 'senior')} title={t('wc.senior.title')}>
          {t('wc.senior')}
        </button>
        <button onClick={() => onChange('youth')} style={toggleBtn(value === 'youth')} title={t('wc.u21.title')}>
          {t('wc.u21')}
        </button>
      </div>
    </div>
  );
}

/** Competition chips for one bracket. The bracket is already chosen, so the short label is
 *  unambiguous here — no "U21 " prefix needed to tell a cup from its twin. */
function CompetitionChips({
  comps,
  activeKey,
  onPick,
  loading,
}: {
  comps: NationalCompetition[];
  activeKey?: string;
  onPick: (key: string) => void;
  loading: boolean;
}) {
  const t = useT();
  return (
    <div style={{ minWidth: 0 }}>
      <div style={filterLabel}>{t('cups.competition')}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {comps.length === 0 && <span style={{ fontSize: 11, color: R.faint }}>{loading ? t('common.loading') : t('wc.noComps')}</span>}
        {comps.map((c) => (
          <CategoryChip key={c.key} label={compLabel(t, c, true)} active={c.key === activeKey} onClick={() => onPick(c.key)} />
        ))}
      </div>
    </div>
  );
}

/** Loads the national-team competitions. Both views need the identical list out of one baked file,
 *  so neither owns it. */
function useNationalCompetitions() {
  const [comps, setComps] = useState<NationalCompetition[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    getNationalCompetitions()
      .then(setComps)
      .catch(() => setComps([]))
      .finally(() => setLoading(false));
  }, []);
  return { comps, loading };
}

/** Picks one bracket's competitions, and keeps a selection that survives a bracket switch. */
function useBracketedComp(comps: NationalCompetition[]) {
  const [bracket, setBracket] = useState<Bracket>('senior');
  const [compKey, setCompKey] = useState('senior');
  const inBracket = comps.filter((c) => c.isYouth === (bracket === 'youth'));
  // Falling back to the first on offer means a bracket switch repairs a now-invalid `compKey` during
  // render — no effect, no flash of an empty table, and a bake missing a competition still shows.
  const comp = inBracket.find((c) => c.key === compKey) ?? inBracket[0];
  return { bracket, setBracket, compKey, setCompKey, inBracket, comp };
}

/**
 * One podium slot: the nation, with its coach and the coach's OWN nationality underneath.
 *
 * The coach is often unattributed, and more often for the losing places than for the champion —
 * attribution is a tenure cross-reference (NTFormerCoaches.aspx, see server/sync/worldCup.ts) that
 * can't reach deleted accounts or the earliest editions. Those show an em dash rather than nothing,
 * so the line is always present: a nation with no manager reads as unattributed instead of looking
 * like a rendering gap, and the three podium columns stay on the same baselines.
 */
function PodiumSlot({
  nation,
  leagueId,
  coach,
  coachUserId,
  coachNationality,
  emphasis = false,
}: {
  nation: string | null | undefined;
  leagueId?: number;
  coach?: string;
  coachUserId?: number;
  coachNationality?: string;
  /** The champion's slot, which carries the row — bigger and in full ink. */
  emphasis?: boolean;
}) {
  if (!nation) return <span style={{ fontSize: 11, color: R.faint }}>—</span>;
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <Flag url={nationFlagUrl(nation, leagueId)} label={nation} size={emphasis ? 18 : 16} />
        <span
          style={{
            fontSize: emphasis ? 13 : 12,
            fontWeight: emphasis ? 'bold' : 'normal',
            color: emphasis ? R.ink : R.soft,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {nation}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: R.soft, overflow: 'hidden', marginTop: 3 }}>
        {coach ? (
          <>
            <Flag url={nationalityFlagUrl(coachNationality)} label={coachNationality} size={14} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <HtLink href={coachUserId ? hattrickManagerUrl(coachUserId) : null}>{coach}</HtLink>
            </span>
          </>
        ) : (
          <span style={{ color: R.faint }}>—</span>
        )}
      </div>
    </div>
  );
}

/* ---- National trophies: one competition, edition by edition ---- */

function RetroNationalTrophies({ onStatus }: { onStatus: (s: string) => void }) {
  const t = useT();
  const { comps, loading } = useNationalCompetitions();
  const { bracket, setBracket, setCompKey, inBracket, comp } = useBracketedComp(comps);

  const editions = (comp?.rows ?? []).slice().sort((a, b) => b.edition - a.edition);

  useEffect(() => {
    if (!loading) onStatus(`Done. ${editions.length} ${comp?.unitLabel === 'Season' ? 'season' : 'edition'}(s) loaded.`);
  }, [loading, editions.length, comp?.unitLabel, onStatus]);

  return (
    <div>
      <fieldset style={fieldset}>
        <legend style={legend}>{t('cups.select')}</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 20px', alignItems: 'flex-end' }}>
          <BracketSwitch value={bracket} onChange={setBracket} />
          <CompetitionChips comps={inBracket} activeKey={comp?.key} onPick={setCompKey} loading={loading} />
        </div>
      </fieldset>

      {loading && <div style={{ padding: '20px 2px', color: R.faint, fontSize: 11 }}>{t('common.loading')}</div>}

      {!loading && (
        <div>
          <div style={{ border: '1px solid var(--frame,#617D54)' }}>
            {/* Named in full here even though the chips are short — the heading is the one place that
                has to state which bracket you are looking at. */}
            <SectionBar>{t('wc.champions', { name: compLabel(t, comp) })}</SectionBar>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: WORLD_CUP_GRID,
                gap: 14,
                padding: '8px 12px',
                background: R.panel2,
                borderBottom: '2px solid var(--frame,#617D54)',
                fontSize: 11,
                fontWeight: 'bold',
                textTransform: 'uppercase',
                letterSpacing: '.03em',
                color: R.soft,
              }}
            >
              <div>{t(comp?.unitLabel === 'Season' ? 'col.season' : 'col.edition')}</div>
              <div>{t('col.champion')}</div>
              <div>{t('col.runnerUp')}</div>
              <div>{t('col.thirdFourth')}</div>
              <div style={{ textAlign: 'right' }}>{t('col.finished')}</div>
            </div>
            {editions.map((e, i) => (
              <div
                key={e.edition}
                style={{
                  display: 'grid',
                  gridTemplateColumns: WORLD_CUP_GRID,
                  gap: 14,
                  padding: `${WORLD_CUP_ROW_PAD} 12px`,
                  borderBottom: '1px solid var(--line,#CDD7C3)',
                  // Top-aligned: a 3rd/4th cell with two coached nations is twice the height of the
                  // runner-up beside it, and centring would leave the columns visibly out of step.
                  alignItems: 'start',
                  background: i % 2 ? R.alt : R.panel,
                }}
              >
                <div style={{ fontFamily: MONO, fontWeight: 'bold', fontSize: 14, color: R.ink }}>
                  {e.edition}
                  {e.ageGroup ? <span style={{ fontSize: 10, color: R.faint }}> {e.ageGroup}</span> : null}
                </div>
                <div style={{ minWidth: 0 }}>
                  {e.champion ? (
                    <PodiumSlot
                      nation={e.champion}
                      leagueId={e.championLeagueId}
                      coach={e.coach}
                      coachUserId={e.coachUserId}
                      coachNationality={e.coachNationality}
                      emphasis
                    />
                  ) : (
                    <span style={{ fontSize: 12, color: R.faint, fontStyle: 'italic' }}>{t('wc.ongoing')}</span>
                  )}
                </div>
                <PodiumSlot
                  nation={e.runnerUp}
                  leagueId={e.runnerUpLeagueId}
                  coach={e.runnerUpCoach}
                  coachUserId={e.runnerUpCoachUserId}
                  coachNationality={e.runnerUpCoachNationality}
                />
                {/* Stacked, not side by side: both joint-third nations now carry a coach line of their
                    own, which wrapping would interleave into an unreadable block. */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
                  {e.thirdFourth.length === 0 && <span style={{ fontSize: 11, color: R.faint }}>—</span>}
                  {e.thirdFourth.map((n, ix) => (
                    <PodiumSlot
                      key={n + ix}
                      nation={n}
                      leagueId={e.thirdFourthLeagueIds?.[ix]}
                      coach={e.thirdFourthCoaches?.[ix]?.name}
                      coachUserId={e.thirdFourthCoaches?.[ix]?.userId}
                      coachNationality={e.thirdFourthCoaches?.[ix]?.nationality}
                    />
                  ))}
                </div>
                <div style={{ textAlign: 'right', fontSize: 11, color: R.faint, fontFamily: MONO }}>{e.finished ?? '—'}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- Medal tables: the same podiums, counted up ---- */

/**
 * What a medal table counts over.
 *
 * This replaces a bracket multi-select crossed with a This cup/All toggle whose third button
 * relabelled itself from the checkboxes above it. Same four reachable scopes, but you read them off
 * one control instead of inferring them from two.
 */
type MedalScope = 'one' | 'senior' | 'u21' | 'all';

const MEDAL_SCOPES: Array<{ k: MedalScope; chip: TranslationKey; title: TranslationKey }> = [
  { k: 'one', chip: 'medal.scope.one', title: 'medal.scope.one.title' },
  { k: 'senior', chip: 'medal.scope.senior', title: 'medal.scope.senior.title' },
  { k: 'u21', chip: 'medal.scope.u21', title: 'medal.scope.u21.title' },
  { k: 'all', chip: 'medal.scope.all', title: 'medal.scope.all.title' },
];

function RetroMedalTables({ onStatus }: { onStatus: (s: string) => void }) {
  const t = useT();
  const { comps, loading } = useNationalCompetitions();
  const { bracket, setBracket, setCompKey, inBracket, comp } = useBracketedComp(comps);
  const [scope, setScope] = useState<MedalScope>('senior');
  const [medalBy, setMedalBy] = useState<MedalBy>('nation');
  const [coachMedals, setCoachMedals] = useState<CoachMedals[]>([]);

  /** The competitions the active scope covers. */
  const scoped: NationalCompetition[] =
    scope === 'all'
      ? comps
      : scope === 'senior'
        ? comps.filter((c) => !c.isYouth)
        : scope === 'u21'
          ? comps.filter((c) => c.isYouth)
          : comp
            ? [comp]
            : [];

  /**
   * Whether this scope pools the two brackets.
   *
   * It matters because a short label stops identifying a competition once it does: the youth World
   * Cup shortens to "World Cup" exactly like the senior one, and "U21 Europe Cup" shortens to
   * "Europe Cup". Pooled podium rows would then read as duplicates of each other — Sverige really
   * did win World Cup 1 in both brackets — so they carry a bracket badge instead.
   */
  const mixesBrackets = scoped.some((c) => c.isYouth) && scoped.some((c) => !c.isYouth);

  const scopedCups = scoped.flatMap((c) => c.matchCups).join('|');
  useEffect(() => {
    if (!scopedCups) {
      setCoachMedals([]);
      return;
    }
    getCoachMedals(scopedCups.split('|'))
      .then(setCoachMedals)
      .catch(() => setCoachMedals([]));
  }, [scopedCups]);

  /**
   * Medal table. Podium places are a National-trophies-only idea: a runner-up is not a trophy, so
   * these never reach Trophy leaders' totals — that stays titles-only.
   *
   * Both nations in `thirdFourth` count as bronze: Hattrick's podium places the losing semi-finalists
   * jointly third and plays no third-place match, so there is no 4th to separate out.
   */
  const medals = useMemo(() => {
    const tally: Record<string, { g: number; s: number; b: number; leagueId?: number }> = {};
    // The nation's leagueId rides along so the flag resolves by ID — names alone leave the likes of
    // Curaçao and São Tomé e Príncipe unflagged (see flags.ts nationFlagUrl).
    const add = (nation: string | null | undefined, k: 'g' | 's' | 'b', leagueId?: number) => {
      if (!nation) return;
      const row = (tally[nation] ??= { g: 0, s: 0, b: 0 });
      row[k]++;
      if (leagueId) row.leagueId ??= leagueId;
    };
    for (const c of scoped)
      for (const e of c.rows) {
        add(e.champion, 'g', e.championLeagueId);
        add(e.runnerUp, 's', e.runnerUpLeagueId);
        e.thirdFourth.forEach((n, ix) => add(n, 'b', e.thirdFourthLeagueIds?.[ix]));
      }
    // Not capped — the table scrolls instead, so nations holding only silver or bronze (which sort
    // below every champion) stay reachable.
    return Object.entries(tally).sort((a, b) => b[1].g - a[1].g || b[1].s - a[1].s || b[1].b - a[1].b || a[0].localeCompare(b[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedCups]);

  /**
   * The individual podiums behind the by-nation totals, so a row can show WHERE its medals came
   * from. Same source and same scope as `medals` above — kept separate rather than folded in, so
   * the count and the detail can't drift apart in only one of the two.
   */
  const nationPodiums = useMemo(() => {
    const by = new Map<
      string,
      Array<{
        label: string;
        isYouth: boolean;
        unit: string;
        edition: number;
        place: number;
        coach?: string;
        coachUserId?: number;
        coachNationality?: string;
      }>
    >();
    for (const c of scoped)
      for (const e of c.rows) {
        // The row IS the nation, so each podium carries the manager who led THAT nation to THAT
        // placing — not the edition's winner. Silver and bronze slots used to carry nothing here,
        // back when only the champion's coach was baked.
        const push = (
          nation: string | null | undefined,
          place: number,
          coach: { userId?: number; name?: string; nationality?: string },
        ) => {
          if (!nation) return;
          const arr = by.get(nation) ?? [];
          arr.push({
            label: compLabel(t, c, true),
            isYouth: c.isYouth,
            unit: c.unitLabel,
            edition: e.edition,
            place,
            coach: coach.name,
            coachUserId: coach.userId,
            coachNationality: coach.nationality,
          });
          by.set(nation, arr);
        };
        push(e.champion, 1, { userId: e.coachUserId, name: e.coach, nationality: e.coachNationality });
        push(e.runnerUp, 2, { userId: e.runnerUpCoachUserId, name: e.runnerUpCoach, nationality: e.runnerUpCoachNationality });
        // Index-aligned with `thirdFourth`; an empty slot is a nation whose coach never resolved.
        e.thirdFourth.forEach((n, i) => push(n, 3, e.thirdFourthCoaches?.[i] ?? {}));
      }
    // Youth after senior at equal placing, so a pooled row groups the twins next to each other
    // instead of interleaving them by edition.
    for (const arr of by.values())
      arr.sort((a, b) => a.place - b.place || Number(a.isYouth) - Number(b.isYouth) || b.edition - a.edition);
    return by;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedCups, t]);

  /** Coach medals pooled by the coach's OWN nationality — every podium their citizens took. */
  const coachNationMedals = useMemo(() => {
    const tally: Record<string, { g: number; s: number; b: number }> = {};
    for (const c of coachMedals) {
      if (!c.nationality) continue;
      const row = (tally[c.nationality] ??= { g: 0, s: 0, b: 0 });
      row.g += c.g;
      row.s += c.s;
      row.b += c.b;
    }
    return Object.entries(tally).sort((a, b) => b[1].g - a[1].g || b[1].s - a[1].s || b[1].b - a[1].b || a[0].localeCompare(b[0]));
  }, [coachMedals]);

  const medalCfg = MEDAL_BY.find((m) => m.k === medalBy) ?? MEDAL_BY[0]!;
  const medalRows: MedalRow[] =
    medalBy === 'nation'
      ? medals.map(([nation, m]) => ({ key: nation, label: nation, flag: nationFlagUrl(nation, m.leagueId), g: m.g, s: m.s, b: m.b }))
      : medalBy === 'coach'
        ? coachMedals.map((c) => ({
            key: String(c.userId),
            label: c.name,
            flag: nationalityFlagUrl(c.nationality),
            href: hattrickManagerUrl(c.userId),
            g: c.g,
            s: c.s,
            b: c.b,
          }))
        : coachNationMedals.map(([nat, m]) => ({ key: nat, label: nat, flag: nationalityFlagUrl(nat), g: m.g, s: m.s, b: m.b }));

  useEffect(() => {
    if (!loading) onStatus(`Done. ${medalRows.length} row(s) loaded.`);
  }, [loading, medalRows.length, onStatus]);

  /** Small place plate — 1st/2nd/3rd, gold/silver/bronze, as everywhere else. */
  const placePlate = (place: number) => (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 9,
        fontWeight: 'bold',
        color: '#241c08',
        background: place === 1 ? MEDAL_GOLD : place === 2 ? MEDAL_SILVER : MEDAL_BRONZE,
        border: '1px solid rgba(0,0,0,.35)',
        padding: '0 4px',
        flex: 'none',
      }}
    >
      {t(place === 1 ? 'place.1' : place === 2 ? 'place.2' : 'place.3')}
    </span>
  );

  /** Bracket marker for pooled lists — deliberately the same faint monospace treatment as the
   *  ageGroup marker in the champions table, so it reads as a qualifier and not as part of the name. */
  const bracketBadge = <span style={{ fontFamily: MONO, fontSize: 9, color: R.faint, fontWeight: 'normal' }}> {t('wc.u21')}</span>;

  /** One line per podium, shared by the by-nation and by-coach expansions. */
  const podiumList = (items: Array<{ place: number; left: ReactNode; right?: ReactNode }>) => (
    <>
      <div style={{ ...cabinetHead, marginBottom: 8 }}>
        {t('medal.podiums')} <span style={{ fontFamily: MONO, color: R.faint }}>×{items.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((it, ix) => (
          <div key={ix} style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            {placePlate(it.place)}
            <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {it.left}
            </span>
            {it.right}
          </div>
        ))}
      </div>
    </>
  );

  const medalDetail = (row: MedalRow): ReactNode => {
    if (medalBy === 'nation') {
      const items = nationPodiums.get(row.key) ?? [];
      if (!items.length) return null;
      return podiumList(
        items.map((p) => ({
          place: p.place,
          left: (
            <>
              <b>{p.label}</b>
              {mixesBrackets && p.isYouth ? bracketBadge : null}{' '}
              <span style={{ color: R.soft }}>{p.unit === 'Season' ? `S${p.edition}` : `${t('col.edition')} ${p.edition}`}</span>
            </>
          ),
          // The manager who led this nation to this placing, with their own nationality — an em dash
          // where attribution failed, so a blank never reads as "no manager was involved".
          right: (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 'none', fontSize: 10, color: R.soft }}>
              {p.coach ? (
                <>
                  <Flag url={nationalityFlagUrl(p.coachNationality)} label={p.coachNationality} size={12} />
                  <HtLink href={p.coachUserId ? hattrickManagerUrl(p.coachUserId) : null}>{p.coach}</HtLink>
                </>
              ) : (
                <span style={{ color: R.faint }}>—</span>
              )}
            </span>
          ),
        })),
      );
    }

    if (medalBy === 'coach') {
      const c = coachMedals.find((x) => String(x.userId) === row.key);
      if (!c?.results.length) return null;
      // No badge needed: these names come straight off the bake, which already spells out
      // "World Cup (Youth)" and "U21 Europe Cup".
      return podiumList(
        c.results.map((r) => ({
          place: r.place,
          left: (
            <>
              <b>{r.cup}</b> <span style={{ color: R.soft }}>{isWorldCupName(r.cup) ? `${t('col.wc')} ${r.season}` : `S${r.season}`}</span>
            </>
          ),
          right: (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 'none' }}>
              <Flag url={nationFlagUrl(r.nation)} label={r.nation} size={14} />
              <span style={{ fontSize: 10, color: R.soft }}>{r.nation}</span>
            </span>
          ),
        })),
      );
    }

    // Coach nationality → the citizens who actually won those medals.
    const mates = coachMedals.filter((c) => c.nationality === row.key);
    if (!mates.length) return null;
    return (
      <>
        <div style={{ ...cabinetHead, marginBottom: 8 }}>
          {t('medal.coaches')} <span style={{ fontFamily: MONO, color: R.faint }}>×{mates.length}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {mates.map((c, ix) => (
            <div key={c.userId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: MONO, fontSize: 10, color: R.faint, width: 18, flex: 'none', textAlign: 'right' }}>{ix + 1}.</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 'bold', color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <HtLink href={hattrickManagerUrl(c.userId)}>{c.name}</HtLink>
              </span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: R.soft, flex: 'none' }}>
                {c.g}/{c.s}/{c.b}
              </span>
            </div>
          ))}
        </div>
      </>
    );
  };

  return (
    <div>
      <fieldset style={fieldset}>
        <legend style={legend}>{t('medal.scope')}</legend>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {MEDAL_SCOPES.map((s) => (
            <CategoryChip key={s.k} label={t(s.chip)} title={t(s.title)} active={scope === s.k} onClick={() => setScope(s.k)} />
          ))}
        </div>
        {/* Only "One competition" needs to know WHICH one, so the pickers stay out of the way for
            the three pooled scopes. */}
        {scope === 'one' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 20px', alignItems: 'flex-end', marginTop: 12 }}>
            <BracketSwitch value={bracket} onChange={setBracket} />
            <CompetitionChips comps={inBracket} activeKey={comp?.key} onPick={setCompKey} loading={loading} />
          </div>
        )}
      </fieldset>

      <fieldset style={fieldset}>
        <legend style={legend}>{t('medal.by')}</legend>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {MEDAL_BY.map((m) => (
            <CategoryChip key={m.k} label={t(m.chip)} active={medalBy === m.k} onClick={() => setMedalBy(m.k)} />
          ))}
        </div>
      </fieldset>

      {loading && <div style={{ padding: '20px 2px', color: R.faint, fontSize: 11 }}>{t('common.loading')}</div>}

      {!loading && (
        <div>
          {/* Remount on any change of what the table means, so an open row can't survive into a
              mode where its id addresses something else. */}
          <MedalTable
            key={`${medalBy}|${scope}|${scopedCups}`}
            title={t(medalCfg.title)}
            headerKey={medalCfg.header}
            empty={medalBy === 'nation' ? '—' : loading ? t('common.loading') : t('medal.noCoach')}
            rows={medalRows}
            detail={medalDetail}
          />

          <div style={{ fontSize: 9, color: R.faint, marginTop: 9, lineHeight: 1.5 }}>{t('wc.footnote')}</div>
        </div>
      )}
    </div>
  );
}

/* =========================== ELECTIONS =========================== */

const ELECTION_GRID = '60px minmax(0,1fr) minmax(0,1fr) 100px';

/** The three ways to read the election record. Aggregations first — the per-country roll is the
 *  raw material they're built from, and the least interesting on its own. */
export type ElectionTab = 'managers' | 'nations' | 'countries';

const ELECTION_TABS: Array<{ k: ElectionTab; labelKey: TranslationKey }> = [
  { k: 'managers', labelKey: 'elections.tab.managers' },
  { k: 'nations', labelKey: 'elections.tab.nations' },
  { k: 'countries', labelKey: 'elections.tab.countries' },
];

function RetroElections({
  countries,
  country,
  setCountry,
  tab,
  setTab,
  onStatus,
}: {
  countries: Country[];
  country: string;
  setCountry: Dispatch<SetStateAction<string>>;
  tab: ElectionTab;
  setTab: Dispatch<SetStateAction<ElectionTab>>;
  onStatus: (s: string) => void;
}) {
  const t = useT();
  return (
    <div>
      <fieldset style={fieldset}>
        <legend style={legend}>{t('common.view')}</legend>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ELECTION_TABS.map((x) => (
            <CategoryChip key={x.k} label={t(x.labelKey)} active={tab === x.k} onClick={() => setTab(x.k)} />
          ))}
        </div>
      </fieldset>

      {tab === 'countries' ? (
        <RetroElectionsByCountry countries={countries} country={country} setCountry={setCountry} onStatus={onStatus} />
      ) : (
        <RetroElectionAggregates byNation={tab === 'nations'} onStatus={onStatus} />
      )}
    </div>
  );
}

/* ---- aggregations: by manager, and by manager nationality ---- */

// The manager column is capped rather than proportional: logins run 8 characters at the median and
// 12 at p90, so a fraction of the row was mostly empty space. Capping it hands the slack to
// "Elected for", the one column that genuinely runs long (up to seven countries). minmax lets it
// still shrink on a narrow window instead of forcing a horizontal scroll.
const ELECTION_LEADER_GRID = '46px minmax(0,130px) 150px minmax(0,1fr) 66px 22px';
const ELECTION_NATION_GRID = '46px minmax(0,1fr) 90px minmax(110px,200px) 56px 22px';
// Host dropped in favour of what the mandate actually produced — the host nation is a property of
// the World Cup, not of this manager's tenure, and it's still on the National trophies tab.
const ELECTION_TIMELINE_GRID = '52px 42px minmax(0,1fr) minmax(0,1.5fr) 84px 88px';

/** "Italy ×3", or plain "Italy" for a single election — used for the hover title, which can't
 *  carry the markup the cell itself uses. */
const countryTally = (c: { country: string; count: number }) => (c.count > 1 ? `${c.country} ×${c.count}` : c.country);

/** Senior/U21 marker, in the same plate style the medal places use. */
function BracketBadge({ youth, label }: { youth: boolean; label: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: MONO,
        fontSize: 9,
        fontWeight: 'bold',
        letterSpacing: '.02em',
        padding: '0 4px',
        color: youth ? '#241c08' : R.soft,
        background: youth ? R.selrow : 'transparent',
        border: '1px solid ' + (youth ? 'var(--main,#B07E2A)' : 'var(--line,#CDD7C3)'),
      }}
    >
      {label}
    </span>
  );
}

function RetroElectionAggregates({ byNation, onStatus }: { byNation: boolean; onStatus: (s: string) => void }) {
  const { lang, t } = useI18n();
  const [agg, setAgg] = useState<ElectionAggregates | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    getElectionAggregates()
      .then(setAgg)
      .catch(() => setAgg({ leaders: [], nations: [], unattributed: 0, withoutNationality: 0 }));
  }, []);

  // Switching mode or narrowing the search reshuffles the ranking — back to page one, and let go
  // of a row that is about to sit somewhere else (or nowhere).
  useEffect(() => {
    setPage(1);
    setExpanded(null);
  }, [byNation, query]);

  const q = query.trim().toLowerCase();
  const leaders = (agg?.leaders ?? []).filter(
    (l) => !q || l.name.toLowerCase().includes(q) || l.countries.some((c) => c.country.toLowerCase().includes(q)),
  );
  const nations = (agg?.nations ?? []).filter((n) => !q || n.nationality.toLowerCase().includes(q));

  const rowCount = byNation ? nations.length : leaders.length;
  const pageCount = Math.max(1, Math.ceil(rowCount / PAGE_SIZE));
  const curPage = Math.min(page, pageCount);
  const pageStart = (curPage - 1) * PAGE_SIZE;
  // Ranks stay absolute over the whole filtered list, so page 2 continues from 51.
  const pageLeaders = leaders.slice(pageStart, pageStart + PAGE_SIZE);
  const pageNations = nations.slice(pageStart, pageStart + PAGE_SIZE);

  // The bar is scaled to the leader of the WHOLE list, not of the page, so page 2's bars stay
  // short instead of restarting at full width.
  const max = byNation ? nations[0]?.count ?? 1 : leaders[0]?.count ?? 1;

  // Whether this bake carries any U21 election at all — decides between showing the split and
  // saying plainly that the data is senior-only.
  const hasYouth = !!agg?.leaders.some((l) => l.youth > 0);

  useEffect(() => {
    if (agg) onStatus(`Done. ${rowCount} record(s).`);
  }, [agg, rowCount, onStatus]);

  return (
    <div>
      <fieldset style={fieldset}>
        <legend style={legend}>{t('filters.title')}</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 20px', alignItems: 'flex-end' }}>
          <div>
            <div style={filterLabel}>{t('filters.search')}</div>
            <input
              className="retro-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={byNation ? t('search.nation') : t('elections.searchManager')}
              style={{ width: 190, border: '2px inset var(--btn,#EBEFE2)', background: '#fff', color: R.ink, fontSize: 11, padding: '3px 6px', outline: 'none', fontFamily: 'inherit' }}
            />
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 10, color: R.soft, paddingBottom: 4 }}>
            {rowCount > PAGE_SIZE
              ? t('paging.range', {
                  from: pageStart + 1,
                  to: pageStart + (byNation ? pageNations.length : pageLeaders.length),
                  total: rowCount,
                })
              : t('paging.shown', { n: rowCount })}
          </div>
        </div>
      </fieldset>

      <div style={{ border: '1px solid var(--frame,#617D54)' }}>
        <SectionBar>{t(byNation ? 'elections.nationsTitle' : 'elections.leadersTitle')}</SectionBar>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: byNation ? ELECTION_NATION_GRID : ELECTION_LEADER_GRID,
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
          <div>{t('col.rank')}</div>
          <div>{t(byNation ? 'col.nationality' : 'col.manager')}</div>
          <div>{t(byNation ? 'col.managersElected' : 'col.nationality')}</div>
          {/* The nation row's bar needs no header — it's the share of the column beside it. */}
          <div>{byNation ? '' : t('col.electedFor')}</div>
          <div style={{ textAlign: 'right' }}>{t('col.elections')}</div>
          <div />
        </div>

        {byNation &&
          pageNations.map((n, i) => {
            const isExp = expanded === n.nationality;
            const toggle = () => setExpanded((cur) => (cur === n.nationality ? null : n.nationality));
            return (
              <div key={n.nationality}>
                <div
                  className="retro-row"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExp}
                  onClick={toggle}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      toggle();
                    }
                  }}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: ELECTION_NATION_GRID,
                    gap: 10,
                    padding: 'var(--rp,7px) 10px',
                    borderBottom: '1px solid var(--line,#CDD7C3)',
                    alignItems: 'center',
                    cursor: 'pointer',
                    background: isExp ? R.selrow : i % 2 ? R.alt : R.panel,
                  }}
                >
                  <div>
                    <RankBadge rank={pageStart + i + 1} />
                  </div>
                  <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
                    <Flag url={nationalityFlagUrl(n.nationality)} label={n.nationality} size={24} />
                    <span style={{ fontSize: 12, fontWeight: 'bold', color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {n.nationality}
                    </span>
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 12, color: R.soft }}>{n.managers.toLocaleString(lang)}</div>
                  <div style={{ height: 12, border: '1px solid var(--frame,#617D54)', background: R.panel2, overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: '100%', width: (n.count / max) * 100 + '%', background: i === 0 && curPage === 1 ? R.main : R.sec }} />
                  </div>
                  <div style={{ textAlign: 'right', fontFamily: MONO, fontSize: 17, fontWeight: 'bold', color: R.ink }}>{n.count}</div>
                  <div style={{ textAlign: 'center' }}>
                    <ExpandGlyph open={isExp} />
                  </div>
                </div>

                {isExp && (
                  <div style={{ padding: '10px 12px 12px 56px', background: R.panel2, borderBottom: '1px solid var(--line,#CDD7C3)' }}>
                    <div style={{ border: '2px inset var(--btn,#EBEFE2)', background: R.panel, padding: '8px 10px 10px' }}>
                      <div style={{ ...cabinetHead, marginBottom: 8 }}>
                        {t('panel.topManagers')}{' '}
                        {n.managers > ELECTION_NATION_TOP_N ? t('panel.topManagersOf', { shown: ELECTION_NATION_TOP_N, total: n.managers }) : ''}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {n.top.map((m, ix) => (
                          <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontFamily: MONO, fontSize: 10, color: R.faint, width: 18, flex: 'none', textAlign: 'right' }}>{ix + 1}.</span>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 'bold', color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <HtLink href={m.userId ? hattrickManagerUrl(m.userId) : null}>{m.name}</HtLink>
                            </span>
                            {/* Same rule as the leaderboard: name the U21 share only, the rest is senior. */}
                            {m.youth > 0 && (
                              <span
                                title={`${m.count - m.youth} ${t('wc.senior')} · ${m.youth} ${t('wc.u21')}`}
                                style={{ fontFamily: MONO, fontSize: 9, fontWeight: 'bold', color: R.main, flex: 'none' }}
                              >
                                {m.youth} {t('wc.u21')}
                              </span>
                            )}
                            <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 'bold', color: R.ink, flex: 'none', width: 26, textAlign: 'right' }}>
                              {m.count}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

        {!byNation &&
          pageLeaders.map((l, i) => {
          const isExp = expanded === l.name;
          const toggle = () => setExpanded((cur) => (cur === l.name ? null : l.name));
          return (
            <div key={l.name}>
            <div
              className="retro-row"
              role="button"
              tabIndex={0}
              aria-expanded={isExp}
              onClick={toggle}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  toggle();
                }
              }}
              style={{
                display: 'grid',
                gridTemplateColumns: ELECTION_LEADER_GRID,
                gap: 10,
                padding: 'var(--rp,7px) 10px',
                borderBottom: '1px solid var(--line,#CDD7C3)',
                alignItems: 'center',
                cursor: 'pointer',
                background: isExp ? R.selrow : i % 2 ? R.alt : R.panel,
              }}
            >
              <div>
                <RankBadge rank={pageStart + i + 1} />
              </div>
              {/* Titled, because the 25 logins longer than 16 characters now ellipsise. */}
              <div
                title={l.name}
                style={{ minWidth: 0, fontSize: 12, fontWeight: 'bold', color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                <HtLink href={l.userId ? hattrickManagerUrl(l.userId) : null}>{l.name}</HtLink>
              </div>
              <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Flag url={nationalityFlagUrl(l.nationality)} label={l.nationality} />
                <span
                  title={l.nationality}
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
                  {l.nationality ?? '—'}
                </span>
              </div>
              {/* The countries that elected them, most-elected first. A coach can serve several
                  national teams over a career, and it's rarely their own. */}
              <div
                title={l.countries.map(countryTally).join(', ')}
                style={{ fontSize: 10, color: R.soft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {l.countries.map((c, ci) => (
                  <span key={c.country}>
                    {ci > 0 && ', '}
                    {c.country}
                    {/* ×N only when it means something — a lone election reads as just the country,
                        the same rule the roll-of-honour streak tags use. */}
                    {c.count > 1 && <span style={{ color: R.main, fontWeight: 'bold' }}>&nbsp;×{c.count}</span>}
                  </span>
                ))}
              </div>
              {/* Total, with how many of them were U21 underneath. Only the youth figure is
                  spelled out — the senior count is the remainder, and the full breakdown is on
                  hover. Naming both ('13 Senior · 5 U21') overflowed the 56px column and ran
                  under the expand glyph, and it grows further in German. Shown only once a bake
                  actually carries a U21 election, so it never reads as '0 U21' on senior data. */}
              <div style={{ textAlign: 'right', minWidth: 0, overflow: 'hidden' }}>
                <div style={{ fontFamily: MONO, fontSize: 17, fontWeight: 'bold', color: R.ink, lineHeight: 1.1 }}>{l.count}</div>
                {l.youth > 0 && (
                  <div
                    title={`${l.senior} ${t('wc.senior')} · ${l.youth} ${t('wc.u21')}`}
                    style={{ fontFamily: MONO, fontSize: 9, fontWeight: 'bold', color: R.main, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {l.youth} {t('wc.u21')}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'center' }}>
                <ExpandGlyph open={isExp} />
              </div>
            </div>

            {isExp && (
              <div style={{ padding: '10px 12px 12px 56px', background: R.panel2, borderBottom: '1px solid var(--line,#CDD7C3)' }}>
                <div style={{ border: '2px inset var(--btn,#EBEFE2)', background: R.panel, padding: '8px 10px 10px' }}>
                  <div style={{ ...cabinetHead, marginBottom: 7 }}>{t('elections.timeline')}</div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: ELECTION_TIMELINE_GRID,
                      gap: 8,
                      fontSize: 9,
                      fontWeight: 'bold',
                      textTransform: 'uppercase',
                      letterSpacing: '.03em',
                      color: R.soft,
                      paddingBottom: 4,
                      borderBottom: '1px solid var(--line,#CDD7C3)',
                    }}
                  >
                    <div>{t('col.wc')}</div>
                    <div>{t('wc.nationalTeam')}</div>
                    <div>{t('common.country')}</div>
                    <div>{t('col.result')}</div>
                    <div style={{ textAlign: 'right' }}>{t('col.votes')}</div>
                    <div style={{ textAlign: 'right' }}>{t('col.wcFinished')}</div>
                  </div>
                  {l.elections.map((e, ix) => (
                    <div
                      key={`${e.edition}-${e.leagueId}-${ix}`}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: ELECTION_TIMELINE_GRID,
                        gap: 8,
                        alignItems: 'center',
                        padding: '4px 0',
                        borderBottom: '1px solid var(--line,#CDD7C3)',
                        background: ix % 2 ? R.alt : 'transparent',
                      }}
                    >
                      <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 'bold', color: R.ink }}>{e.edition}</div>
                      <div>
                        <BracketBadge youth={e.isYouth} label={e.isYouth ? t('wc.u21') : t('wc.senior')} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                        <Flag url={leagueFlagUrl(e.leagueId)} label={e.countryName} size={15} />
                        <span style={{ fontSize: 11, fontWeight: 'bold', color: R.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {e.countryName}
                        </span>
                      </div>
                      {/* What the mandate produced. Empty for most — being elected is not winning. */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden' }}>
                        {e.trophies.length === 0 && <span style={{ fontSize: 10, color: R.faint }}>—</span>}
                        {e.trophies.map((tr, ti) => (
                          <span
                            key={ti}
                            title={tr.exact ? undefined : t('elections.duringCycle')}
                            style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}
                          >
                            <span
                              style={{
                                fontFamily: MONO,
                                fontSize: 9,
                                fontWeight: 'bold',
                                color: '#241c08',
                                background: tr.place === 1 ? MEDAL_GOLD : tr.place === 2 ? MEDAL_SILVER : MEDAL_BRONZE,
                                border: '1px solid rgba(0,0,0,.35)',
                                padding: '0 4px',
                                flex: 'none',
                              }}
                            >
                              {t(tr.place === 1 ? 'place.1' : tr.place === 2 ? 'place.2' : 'place.3')}
                            </span>
                            {/* Italic marks the weaker join: won inside the cycle, not the cup voted for. */}
                            <span
                              style={{
                                fontSize: 10,
                                color: R.ink,
                                fontWeight: tr.exact ? 'bold' : 'normal',
                                fontStyle: tr.exact ? 'normal' : 'italic',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {tr.cup}
                            </span>
                          </span>
                        ))}
                      </div>
                      <div style={{ textAlign: 'right', fontFamily: MONO, fontSize: 10, color: R.soft }}>{e.votes ?? '—'}</div>
                      <div style={{ textAlign: 'right', fontFamily: MONO, fontSize: 10, color: R.faint }}>
                        {e.finished ?? t('wc.ongoing')}
                      </div>
                    </div>
                  ))}

                  {/* Anything their record holds that no mandate above can explain — almost always
                      a title from before World Cup 16, where the election history begins. Without
                      this the timeline silently denies real trophies. */}
                  {l.otherResults.length > 0 && (
                    <div style={{ marginTop: 9, paddingTop: 7, borderTop: '1px solid var(--line,#CDD7C3)' }}>
                      <div style={{ fontSize: 9, color: R.faint, lineHeight: 1.45, marginBottom: 6 }}>{t('elections.otherResults')}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 12px' }}>
                        {l.otherResults.map((o, oi) => (
                          <span key={oi} style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                            <span
                              style={{
                                fontFamily: MONO,
                                fontSize: 9,
                                fontWeight: 'bold',
                                color: '#241c08',
                                background: o.place === 1 ? MEDAL_GOLD : o.place === 2 ? MEDAL_SILVER : MEDAL_BRONZE,
                                border: '1px solid rgba(0,0,0,.35)',
                                padding: '0 4px',
                                flex: 'none',
                              }}
                            >
                              {t(o.place === 1 ? 'place.1' : o.place === 2 ? 'place.2' : 'place.3')}
                            </span>
                            <span style={{ fontSize: 10, color: R.ink, fontWeight: o.place === 1 ? 'bold' : 'normal' }}>{o.cup}</span>
                            <span style={{ fontSize: 10, color: R.soft }}>{o.nation}</span>
                            <span style={{ fontFamily: MONO, fontSize: 9, color: R.faint }}>
                              {o.isWorldCupResult ? `${t('col.wc')} ${o.season}` : `S${o.season}`}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            </div>
          );
        })}

        {!agg && <div style={{ padding: '22px 12px', textAlign: 'center', color: R.faint, fontSize: 11 }}>{t('common.loading')}</div>}
        {agg && rowCount === 0 && (
          <div style={{ padding: '22px 12px', textAlign: 'center', color: R.faint, fontSize: 11 }}>
            {t(byNation ? 'list.noNations' : 'list.noManagers')}
          </div>
        )}
      </div>

      {agg && pageCount > 1 && <RetroPager page={curPage} pageCount={pageCount} setPage={setPage} />}

      {/* What these totals can't cover, said out loud rather than quietly rolled into an
          "Unknown" row that would top the nationality ranking. */}
      {agg && (
        <div style={{ fontSize: 9, color: R.faint, marginTop: 9, lineHeight: 1.5 }}>
          {/* Drops itself the moment a bake actually carries U21 elections. */}
          {!hasYouth && t('elections.seniorOnly') + ' '}
          {t('elections.unattributedNote', { n: agg.unattributed })}
          {byNation && agg.withoutNationality > 0 && ' ' + t('elections.noNationalityNote', { n: agg.withoutNationality })}
        </div>
      )}
    </div>
  );
}

/* ---- the per-country election roll ---- */

function RetroElectionsByCountry({
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
  const t = useT();
  const [rows, setRows] = useState<ElectionResult[]>([]);
  const [loading, setLoading] = useState(true);
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
    if (!loading) onStatus(`Done. ${rows.length} election(s) loaded.`);
  }, [loading, rows.length, onStatus]);

  // Scoped to the country on screen — the global ranking is the "By manager" tab's job now.
  const tally: Record<string, { count: number; userId?: number; nationality?: string }> = {};
  for (const r of rows) {
    if (!r.winner) continue;
    const e = (tally[r.winner] ??= { count: 0, userId: r.winnerUserId, nationality: r.winnerNationality });
    e.count++;
  }
  const tallyArr = Object.entries(tally).sort((a, b) => b[1].count - a[1].count).slice(0, 10);
  const maxT = tallyArr.length ? tallyArr[0]![1].count : 1;

  return (
    <div>
      <fieldset style={fieldset}>
        <legend style={legend}>{t('elections.select')}</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 20px', alignItems: 'flex-end' }}>
          <div>
            <div style={filterLabel}>{t('common.country')}</div>
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
          <SectionBar>{t('elections.title', { country: countryName })}</SectionBar>
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
            <div>{t('col.wc')}</div>
            <div>{t('col.host')}</div>
            <div>{t('col.winner')}</div>
            <div style={{ textAlign: 'right' }}>{t('col.votes')}</div>
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

          {loading && <div style={{ padding: '20px 10px', color: R.faint, fontSize: 11 }}>{t('common.loading')}</div>}
          {!loading && rows.length === 0 && (
            <div style={{ padding: '20px 10px', color: R.faint, fontSize: 11 }}>{t('elections.empty')}</div>
          )}

          <div style={{ padding: '6px 10px', fontSize: 10, color: R.faint, fontFamily: MONO, background: R.panel2 }}>
            {t('elections.src')}
          </div>
        </div>

        <div style={{ border: '1px solid var(--frame,#617D54)' }}>
          <SectionBar>{t('elections.mostElected')}</SectionBar>
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
