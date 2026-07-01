/**
 * Sample data + deterministic generators for the Aggregate Stats views.
 *
 * This is design-time sample data: it sits AHEAD of the backend. There is currently no
 * schema, endpoint, or sync for managers, trophies, or league winners. When those land, the
 * two features map to CHPP sources:
 *   - Trophy leaders  → `managercompendium` + each team's trophy list (`teamdetails`)
 *   - League winners  → `leaguedetails` / `worlddetails`
 *
 * The generators are seeded so the same manager/league always produces the same cabinet/roll,
 * matching the exported Claude Design prototype exactly.
 */

export type CountryCode =
  | 'SWE'
  | 'NOR'
  | 'GER'
  | 'ITA'
  | 'ARG'
  | 'ESP'
  | 'ENG'
  | 'BRA'
  | 'FRA'
  | 'USA';

export interface Country {
  code: CountryCode;
  name: string;
}

/** A manager's all-time silverware totals: league titles, cups, other honours. */
export interface Manager {
  login: string;
  c: CountryCode;
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

export const COUNTRIES: Country[] = [
  { code: 'SWE', name: 'Sweden' },
  { code: 'NOR', name: 'Norway' },
  { code: 'GER', name: 'Germany' },
  { code: 'ITA', name: 'Italy' },
  { code: 'ARG', name: 'Argentina' },
  { code: 'ESP', name: 'Spain' },
  { code: 'ENG', name: 'England' },
  { code: 'BRA', name: 'Brazil' },
  { code: 'FRA', name: 'France' },
  { code: 'USA', name: 'United States' },
];

export const MANAGERS: Manager[] = [
  { login: 'Nyström', c: 'SWE', team: 'Djurgården Ultras', lg: 12, cup: 3, oth: 1 },
  { login: 'il_Capitano', c: 'ITA', team: 'Squadra Azzurra', lg: 10, cup: 5, oth: 2 },
  { login: 'DerKaiser', c: 'GER', team: 'Rheinland FC', lg: 11, cup: 4, oth: 1 },
  { login: 'PatagoniaFC', c: 'ARG', team: 'Club Atlético Sur', lg: 9, cup: 6, oth: 0 },
  { login: 'FjordFan', c: 'NOR', team: 'FC Nordlys', lg: 9, cup: 3, oth: 2 },
  { login: 'ElMatador', c: 'ESP', team: 'Real Costa', lg: 8, cup: 4, oth: 2 },
  { login: 'Samba10', c: 'BRA', team: 'Verde-Amarelo EC', lg: 7, cup: 5, oth: 1 },
  { login: 'BraveHeart', c: 'ENG', team: 'Northgate Town', lg: 8, cup: 3, oth: 1 },
  { login: 'LeGénéral', c: 'FRA', team: 'Olympique Vallée', lg: 7, cup: 3, oth: 1 },
  { login: 'VikingLars', c: 'NOR', team: 'Bergen Boys', lg: 6, cup: 2, oth: 1 },
  { login: 'CalcioNonno', c: 'ITA', team: 'AC Vesuvio', lg: 5, cup: 4, oth: 0 },
  { login: 'TripleCrown', c: 'SWE', team: 'Malmö Maskiner', lg: 5, cup: 3, oth: 1 },
  { login: 'MidwestMagic', c: 'USA', team: 'Prairie United', lg: 6, cup: 2, oth: 0 },
  { login: 'Kaiserslau', c: 'GER', team: 'Schwarzwald SV', lg: 4, cup: 3, oth: 1 },
  { login: 'DesertEagle', c: 'ESP', team: 'Atlético Arena', lg: 5, cup: 2, oth: 0 },
  { login: 'PampasKid', c: 'ARG', team: 'Deportivo Llanura', lg: 4, cup: 2, oth: 0 },
];

/** Per-country club pool as [club, manager] pairs, newest-first roll drawn from these. */
export const CLUBS: Record<CountryCode, Array<[string, string]>> = {
  SWE: [
    ['Djurgården Ultras', 'Nyström'],
    ['Malmö Maskiner', 'TripleCrown'],
    ['Norrland IK', 'iceman'],
    ['Göteborg GK', 'blagult'],
    ['Stockholm City', 'kungen'],
    ['Uppsala BK', 'vasa'],
  ],
  NOR: [
    ['FC Nordlys', 'FjordFan'],
    ['Bergen Boys', 'VikingLars'],
    ['Oslo Løver', 'holmenkollen'],
    ['Trondheim FK', 'nidaros'],
    ['Stavanger Oil', 'nordsjo'],
    ['Tromsø IL', 'polar'],
  ],
  GER: [
    ['Rheinland FC', 'DerKaiser'],
    ['Schwarzwald SV', 'Kaiserslau'],
    ['Hansa Nord', 'nordsee'],
    ['Bayern Süd', 'weissblau'],
    ['Sachsen 04', 'elbe'],
    ['Ruhrpott BV', 'kohle'],
  ],
  ITA: [
    ['Squadra Azzurra', 'il_Capitano'],
    ['AC Vesuvio', 'CalcioNonno'],
    ['Roma Nord', 'lupacchiotto'],
    ['Milano FC', 'rossoblu'],
    ['Torino Granata', 'mole'],
    ['Sicilia SC', 'etna'],
  ],
  ARG: [
    ['Club Atlético Sur', 'PatagoniaFC'],
    ['Deportivo Llanura', 'PampasKid'],
    ['River Norte', 'elrio'],
    ['Boca Vieja', 'xeneize'],
    ['Córdoba FC', 'mediterraneo'],
    ['Rosario CA', 'canalla'],
  ],
  ESP: [
    ['Real Costa', 'ElMatador'],
    ['Atlético Arena', 'DesertEagle'],
    ['Bilbao Norte', 'athletic'],
    ['Sevilla Sur', 'betico'],
    ['Valencia CF', 'che'],
    ['Galicia SD', 'celtico'],
  ],
  ENG: [
    ['Northgate Town', 'BraveHeart'],
    ['Wembley Rovers', 'lion'],
    ['Mersey AFC', 'kopite'],
    ['Tyne United', 'geordie'],
    ['London Pride', 'hammer'],
    ['Midlands FC', 'villan'],
  ],
  BRA: [
    ['Verde-Amarelo EC', 'Samba10'],
    ['Palmas FC', 'verdao'],
    ['Rio Azul', 'carioca'],
    ['Minas EC', 'galo'],
    ['Bahia Norte', 'tricolor'],
    ['Sul FC', 'gaucho'],
  ],
  FRA: [
    ['Olympique Vallée', 'LeGénéral'],
    ['Paris Nord', 'parisien'],
    ['Lyon Est', 'gone'],
    ['Marseille Sud', 'phoceen'],
    ['Bordeaux FC', 'girondin'],
    ['Lille Nord', 'dogue'],
  ],
  USA: [
    ['Prairie United', 'MidwestMagic'],
    ['Coastal SC', 'pacific'],
    ['Empire FC', 'gotham'],
    ['Lone Star', 'texan'],
    ['Rockies FC', 'milehigh'],
    ['Bay City', 'golden'],
  ],
};

export function countryName(code: string): string {
  const c = COUNTRIES.find((x) => x.code === code);
  return c ? c.name : code;
}

/** Seeded PRNG (mulberry32) — same sequence as the prototype for identical sample output. */
export function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash → 32-bit seed for the PRNG. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Build a manager's full trophy cabinet, grouped and grounded in real Hattrick trophy tiers.
 * Cups split into main (National Cup) vs secondary (consolation) as `ceil`/remainder of `cup`.
 */
export function trophiesFor(m: Manager): TrophyCabinet {
  const rnd = rng(hash('T' + m.login));
  const seasons = (k: number): number[] => {
    const pool: number[] = [];
    for (let s = 61; s <= 89; s++) pool.push(s);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = pool[i]!;
      pool[i] = pool[j]!;
      pool[j] = t;
    }
    return pool.slice(0, k).sort((a, b) => b - a);
  };
  const LEVELS = ['III', 'IV', 'V', 'VI', 'VII'];
  const SECCUPS = [
    'Emerald Cup',
    'Ruby Cup',
    'Sapphire Cup',
    'Gold Cup',
    'Silver Cup',
    'Bronze Cup',
    'Consolation Cup',
  ];
  const OTHERS = ['Hattrick Masters', 'Manager of the Season', 'Continental Cup', 'Youth League'];
  const mc = Math.ceil(m.cup / 2);
  const sc = m.cup - mc;
  const champ = seasons(m.lg).map((s) => {
    const lvl = LEVELS[1 + Math.floor(rnd() * 3)]!;
    const num = 100 + Math.floor(rnd() * 899);
    return { main: 'Division ' + lvl + ' champions', sub: 'Series ' + lvl + '.' + num, season: 'S' + s };
  });
  const main = seasons(mc).map((s) => ({ main: 'National Cup', sub: countryName(m.c), season: 'S' + s }));
  const sec = seasons(sc).map((s) => ({
    main: SECCUPS[Math.floor(rnd() * SECCUPS.length)]!,
    sub: countryName(m.c),
    season: 'S' + s,
  }));
  const other = seasons(m.oth).map((s) => ({
    main: OTHERS[Math.floor(rnd() * OTHERS.length)]!,
    sub: '',
    season: 'S' + s,
  }));
  return { champ, main, sec, other };
}

/** Build a country's top-division roll of honour (seasons 66–89), newest first. */
export function buildWinners(country: CountryCode): Winner[] {
  const pool = CLUBS[country] || CLUBS.SWE;
  const rnd = rng(hash('L' + country));
  const arr: Winner[] = [];
  let cur = Math.floor(rnd() * pool.length);
  let streak = 1;
  for (let s = 66; s <= 89; s++) {
    if (s > 66) {
      if (streak < 3 && rnd() < 0.42) {
        streak++;
      } else {
        let n = cur;
        while (n === cur) {
          n = Math.floor(rnd() * pool.length);
        }
        cur = n;
        streak = 1;
      }
    }
    arr.push({ season: s, club: pool[cur]![0], manager: pool[cur]![1] });
  }
  return arr.reverse(); // newest first
}
