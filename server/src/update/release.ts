import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';

export const RELEASE_FILES = ['managers.json', 'leagues.json', 'cups.json', 'masters.json', 'seasonal.json', 'worldcup.json', 'elections.json'] as const;
export type ReleaseFile = typeof RELEASE_FILES[number];
const id = z.number().int().positive();
const count = z.number().int().nonnegative();
const period = z.number().int().positive();
const winner = z.object({
  season: period, club: z.string(), manager: z.string(),
  teamId: id.optional(), userId: id.optional(), leagueId: id.optional(),
}).strict();
const trophy = z.object({
  country: z.string(), leagueId: count, season: period, club: z.string(), teamId: id.optional(),
  cup: z.string().optional(), last: z.boolean(), ago: count.optional(),
}).strict();
const medal = z.object({
  cup: z.string(), season: period, nation: z.string(), leagueId: count.optional(),
  place: z.union([z.literal(2), z.literal(3)]), ago: count.optional(),
}).strict();
const manager = z.object({
  userId: id, userName: z.string(), nationality: z.string(),
  lg: count, main: count, sec: count, hm: count, sn: count, wc: count, wcSilver: count, wcBronze: count,
  lgLast: count, mainLast: count, secLast: count, hmLast: count, snLast: count, wcLast: count,
  titles: z.array(trophy), cupsMain: z.array(trophy), cupsSec: z.array(trophy), masters: z.array(trophy), seasonal: z.array(trophy), worldCup: z.array(trophy), medals: z.array(medal),
}).strict();
const podiumCoach = z.object({
  userId: id.optional(), name: z.string().optional(), nationality: z.string().optional(),
}).strict();
const podium = z.object({
  host: z.string(), finished: z.string().nullable(),
  champion: z.string().nullable(), runnerUp: z.string().nullable(), thirdFourth: z.array(z.string()),
  coachUserId: id.optional(), coach: z.string().optional(), coachNationality: z.string().optional(),
  runnerUpCoachUserId: id.optional(), runnerUpCoach: z.string().optional(), runnerUpCoachNationality: z.string().optional(),
  thirdFourthCoaches: z.array(podiumCoach),
  championLeagueId: count.optional(), runnerUpLeagueId: count.optional(), thirdFourthLeagueIds: z.array(count).optional(),
}).strict();
const worldCupEdition = podium.extend({ edition: period, ageGroup: z.string().optional() }).strict();
const regionalCupSeason = podium.extend({ season: period, status: z.string().optional() }).strict();
const schemas = {
  'managers.json': z.array(manager),
  'leagues.json': z.array(z.object({ leagueId: id, country: z.string(), champions: z.array(winner) }).strict()),
  'cups.json': z.array(z.object({
    leagueId: id, country: z.string(),
    cups: z.array(z.object({
      cupId: id, cupName: z.string(), isMain: z.boolean(),
      cupLevel: id, cupLevelIndex: id, winners: z.array(winner),
    }).strict()),
  }).strict()),
  'masters.json': z.array(winner),
  'seasonal.json': z.array(z.object({ cupId: id, cupName: z.string(), winners: z.array(winner) }).strict()),
  'worldcup.json': z.object({
    senior: z.array(worldCupEdition), youth: z.array(worldCupEdition),
    regional: z.array(z.object({
      cupId: id, cupName: z.string(), isYouth: z.boolean(), seasons: z.array(regionalCupSeason),
    }).strict()),
  }).strict(),
  'elections.json': z.array(z.object({
    leagueId: id, countryName: z.string(), edition: period, host: z.string(), isYouth: z.boolean().optional(),
    winnerUserId: id.optional(), winner: z.string().optional(), winnerNationality: z.string().optional(), votes: z.string().optional(),
  }).strict()),
};
type Bundles = { [K in ReleaseFile]: z.infer<typeof schemas[K]> };
export interface ReleaseSource {
  key: string;
  label: string;
  lastSuccessfulCheck: string | null;
  pending: number;
  status: 'ok' | 'pending' | 'failed';
}
export interface ReleaseManifest {
  schemaVersion: 1;
  dataVersion: string;
  codeRevision: string;
  generatedAt: string;
  lastChangedAt: string;
  sources: ReleaseSource[];
  files: Record<ReleaseFile, { path: string; sha256: string; bytes: number }>;
}
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
function fail(message: string): never { throw new Error(`Release validation: ${message}`); }

async function readManifest(dir: string): Promise<ReleaseManifest | undefined> {
  let text: string;
  try { text = await readFile(join(dir, 'manifest.json'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  const m = JSON.parse(text) as ReleaseManifest;
  if (m.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(m.dataVersion) || !m.files || !Number.isFinite(Date.parse(m.lastChangedAt))) fail('invalid previous manifest');
  for (const name of RELEASE_FILES) {
    const f = m.files[name];
    if (!f || f.path !== `/data/versions/${m.dataVersion}/${name}` || !/^[a-f0-9]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.bytes) || f.bytes < 1) fail(`invalid manifest entry ${name}`);
  }
  return m;
}

async function readBundles(dir: string): Promise<{ bundles: Bundles; bytes: Record<ReleaseFile, Buffer>; manifest?: ReleaseManifest }> {
  const manifest = await readManifest(dir);
  const bytes = {} as Record<ReleaseFile, Buffer>;
  const bundles = {} as Bundles;
  for (const name of RELEASE_FILES) {
    const path = manifest ? join(dir, 'versions', manifest.dataVersion, name) : join(dir, name);
    const contents = await readFile(path);
    if (manifest && (hash(contents) !== manifest.files[name].sha256 || contents.length !== manifest.files[name].bytes)) fail(`previous file checksum mismatch: ${name}`);
    bytes[name] = contents;
    const parsed = schemas[name].safeParse(JSON.parse(contents.toString('utf8')));
    if (!parsed.success) fail(`${name}: ${parsed.error.message}`);
    Object.assign(bundles, { [name]: parsed.data });
  }
  if (manifest && manifest.dataVersion !== hash(RELEASE_FILES.map((name) => `${name}:${hash(bytes[name])}`).join('\n'))) fail('previous content version mismatch');
  return { bundles, bytes, manifest };
}

type Category = 'titles' | 'cupsMain' | 'cupsSec' | 'masters' | 'seasonal' | 'worldCup';
interface Fact { key: string; userId?: number; teamId?: number; club: string | null }
interface ExpectedTrophy { userId: number; category: Category; item: z.infer<typeof trophy> }

function indexBundles(data: Bundles) {
  const facts = new Map<string, Fact>();
  const trophies: ExpectedTrophy[] = [];
  const medals: Array<{ userId: number; item: z.infer<typeof medal> }> = [];
  const unique = (fact: Fact) => {
    if (facts.has(fact.key)) fail(`duplicate historical key ${fact.key}`);
    facts.set(fact.key, fact);
  };
  const clubRoll = (key: string, rows: z.infer<typeof winner>[], category: Category, country: string, leagueId: number, cup?: string, international = false) => {
    const latest = Math.max(...rows.map((r) => r.season));
    for (const row of rows) {
      unique({ key: `${key}:${row.season}`, userId: row.userId, teamId: row.teamId, club: row.club });
      if (!row.userId) continue;
      trophies.push({ userId: row.userId, category, item: {
        country, leagueId: international ? row.leagueId ?? 0 : leagueId, season: row.season,
        club: row.club, teamId: row.teamId, cup, last: leagueId !== 1002 && latest === row.season,
        ago: leagueId === 1002 ? undefined : latest - row.season,
      } });
    }
  };
  for (const l of data['leagues.json']) clubRoll(`league:${l.leagueId}`, l.champions, 'titles', l.country, l.leagueId);
  for (const l of data['cups.json']) for (const c of l.cups) clubRoll(`cup:${c.cupId}`, c.winners, c.isMain ? 'cupsMain' : 'cupsSec', l.country, l.leagueId, c.cupName);
  clubRoll('cup:183', data['masters.json'], 'masters', 'International', 0, 'Hattrick Masters', true);
  for (const c of data['seasonal.json']) clubRoll(`cup:${c.cupId}`, c.winners, 'seasonal', 'International', 0, c.cupName, true);
  const nationalRoll = (key: string, cup: string, rows: Array<z.infer<typeof podium> & { period: number }>, worldCup = false) => {
    const latest = Math.max(...rows.filter((r) => r.champion).map((r) => r.period));
    for (const r of rows) {
      const prefix = `${key}:${r.period}`;
      unique({ key: `${prefix}:gold`, club: r.champion, userId: r.coachUserId });
      unique({ key: `${prefix}:silver`, club: r.runnerUp, userId: r.runnerUpCoachUserId });
      if (r.thirdFourth.length !== r.thirdFourthCoaches.length) fail(`unaligned podium coaches ${prefix}`);
      r.thirdFourth.forEach((nation, i) => unique({ key: `${prefix}:bronze:${i}`, club: nation, userId: r.thirdFourthCoaches[i]?.userId }));
      if (!r.champion) {
        if (r.coachUserId || r.runnerUpCoachUserId || r.thirdFourthCoaches.some((c) => c.userId)) fail(`attributed unfinished podium ${prefix}`);
        continue;
      }
      const ago = latest - r.period;
      if (r.coachUserId) trophies.push({ userId: r.coachUserId, category: 'worldCup', item: { country: worldCup ? 'World Cup' : cup, leagueId: worldCup ? 0 : r.championLeagueId ?? 0, season: r.period, club: r.champion, cup, last: ago === 0, ago } });
      if (r.runnerUpCoachUserId) medals.push({ userId: r.runnerUpCoachUserId, item: { cup, season: r.period, nation: r.runnerUp ?? '', leagueId: worldCup ? undefined : r.runnerUpLeagueId, place: 2, ago } });
      r.thirdFourth.forEach((nation, i) => {
        const userId = r.thirdFourthCoaches[i]?.userId;
        if (userId) medals.push({ userId, item: { cup, season: r.period, nation, leagueId: worldCup ? undefined : r.thirdFourthLeagueIds?.[i] || undefined, place: 3, ago } });
      });
    }
  };
  const wc = data['worldcup.json'];
  nationalRoll('worldcup:senior', 'World Cup', wc.senior.map((r) => ({ ...r, period: r.edition })), true);
  nationalRoll('worldcup:youth', 'World Cup (Youth)', wc.youth.map((r) => ({ ...r, period: r.edition })), true);
  for (const c of wc.regional) nationalRoll(`national:${c.cupId}`, c.cupName, c.seasons.map((r) => ({ ...r, period: r.season })));
  return { facts, trophies, medals };
}

// Property ordering and omitted undefined properties do not affect semantic comparison.
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
function multiset(values: unknown[]) {
  const result = new Map<string, number>();
  for (const value of values) { const key = stable(value); result.set(key, (result.get(key) ?? 0) + 1); }
  return result;
}
function reconcile(actual: unknown[], expected: unknown[], label: string) {
  const a = multiset(actual), b = multiset(expected);
  if (a.size !== b.size || [...a].some(([k, v]) => b.get(k) !== v)) fail(`inconsistent ${label}`);
}

function validate(data: Bundles, previous?: Bundles) {
  const indexed = indexBundles(data);
  const managers = new Map(data['managers.json'].map((m) => [m.userId, m]));
  if (managers.size !== data['managers.json'].length) fail('duplicate manager identity');
  for (const row of [...indexed.trophies, ...indexed.medals]) if (!managers.has(row.userId)) fail(`missing manager ${row.userId}`);
  const trophyByManager = new Map<string, Array<z.infer<typeof trophy>>>();
  for (const t of indexed.trophies) {
    const key = `${t.userId}:${t.category}`;
    const rows = trophyByManager.get(key) ?? [];
    rows.push(t.item);
    trophyByManager.set(key, rows);
  }
  const medalsByManager = new Map<number, Array<z.infer<typeof medal>>>();
  for (const m of indexed.medals) {
    const rows = medalsByManager.get(m.userId) ?? [];
    rows.push(m.item);
    medalsByManager.set(m.userId, rows);
  }
  const categories = { titles: 'lg', cupsMain: 'main', cupsSec: 'sec', masters: 'hm', seasonal: 'sn', worldCup: 'wc' } as const;
  for (const m of managers.values()) {
    for (const [category, total] of Object.entries(categories) as Array<[Category, typeof categories[Category]]>) {
      // International country labels are display metadata, absent from the public competition
      // rolls. All other values, including club identity and reigning/recency, are reconciled.
      const comparable = (r: z.infer<typeof trophy>) => category === 'masters' || category === 'seasonal' ? { ...r, country: undefined } : r;
      reconcile(m[category].map(comparable), (trophyByManager.get(`${m.userId}:${category}`) ?? []).map(comparable), `${category} for manager ${m.userId}`);
      if (m[total] !== m[category].length || m[`${total}Last`] !== m[category].filter((r) => r.last).length) fail(`incorrect ${total} totals for manager ${m.userId}`);
    }
    reconcile(m.medals, medalsByManager.get(m.userId) ?? [], `medals for manager ${m.userId}`);
    if (m.wcSilver !== m.medals.filter((r) => r.place === 2).length || m.wcBronze !== m.medals.filter((r) => r.place === 3).length) fail(`incorrect medal totals for manager ${m.userId}`);
  }
  if (previous) {
    for (const old of indexBundles(previous).facts.values()) {
      const next = indexed.facts.get(old.key);
      if (!next) fail(`lost historical record ${old.key}`);
      if (old.userId && old.userId !== next.userId) fail(`changed verified manager ${old.key}`);
      if (old.teamId && old.teamId !== next.teamId) fail(`changed verified team ${old.key}`);
      // With no stable team ID a known name is the only retained winner evidence.
      if (old.club && !old.teamId && old.club !== next.club) fail(`changed recorded winner ${old.key}`);
    }
    // Multiple elections in a cycle are real. Preserve a multiset, permitting only unresolved
    // identity enrichment and login changes for already known IDs.
    const remaining = [...data['elections.json']];
    for (const old of [...previous['elections.json']].sort((a, b) => Number(!!b.winnerUserId) - Number(!!a.winnerUserId))) {
      const ix = remaining.findIndex((r) => r.leagueId === old.leagueId && r.edition === old.edition && !!r.isYouth === !!old.isYouth && r.host === old.host && r.votes === old.votes && (old.winnerUserId ? r.winnerUserId === old.winnerUserId : !old.winner || r.winner === old.winner));
      if (ix < 0) fail(`lost or changed election ${old.leagueId}:${old.edition}:${old.isYouth ? 'youth' : 'senior'}`);
      remaining.splice(ix, 1);
    }
  }
  return { managers: managers.size, historicalRecords: indexed.facts.size, trophies: indexed.trophies.length, medals: indexed.medals.length, elections: data['elections.json'].length };
}

export async function validateRelease(candidateDir: string, previousDataDir?: string) {
  const candidate = await readBundles(candidateDir);
  const previous = previousDataDir ? await readBundles(previousDataDir) : undefined;
  return validate(candidate.bundles, previous?.bundles);
}

export interface PrepareReleaseOptions {
  candidateDir: string;
  outputDataDir: string;
  previousDataDir?: string;
  codeRevision: string;
  generatedAt?: string;
  sources?: ReleaseSource[];
}

/** Package only a complete, validated snapshot. The caller builds/deploys this exact directory. */
export async function prepareRelease(options: PrepareReleaseOptions) {
  if (resolve(options.candidateDir) === resolve(options.outputDataDir)) throw new Error('Release output must be separate from the candidate');
  const candidate = await readBundles(options.candidateDir);
  const previous = options.previousDataDir ? await readBundles(options.previousDataDir) : undefined;
  const validation = validate(candidate.bundles, previous?.bundles);
  const dataVersion = hash(RELEASE_FILES.map((name) => `${name}:${hash(candidate.bytes[name])}`).join('\n'));
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('Invalid release generation date');
  const sources = z.array(z.object({ key: z.string().min(1), label: z.string().min(1), lastSuccessfulCheck: z.string().datetime().nullable(), pending: count, status: z.enum(['ok', 'pending', 'failed']) })).parse(options.sources ?? []);
  if (new Set(sources.map((s) => s.key)).size !== sources.length) throw new Error('Duplicate release source keys');
  const manifest: ReleaseManifest = {
    schemaVersion: 1, dataVersion, codeRevision: options.codeRevision, generatedAt,
    lastChangedAt: previous?.manifest?.dataVersion === dataVersion ? previous.manifest.lastChangedAt : generatedAt,
    sources, files: {} as ReleaseManifest['files'],
  };
  const versionDir = join(options.outputDataDir, 'versions', dataVersion);
  await mkdir(versionDir, { recursive: true });
  for (const name of RELEASE_FILES) {
    manifest.files[name] = { path: `/data/versions/${dataVersion}/${name}`, sha256: hash(candidate.bytes[name]), bytes: candidate.bytes[name].length };
    await writeFile(join(versionDir, name), candidate.bytes[name]);
  }
  const manifestPath = join(options.outputDataDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return { manifest, manifestPath, dataVersion, validation };
}
