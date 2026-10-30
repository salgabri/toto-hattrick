// Read-only audit: league/cup titles credited to a Hattrick account that did not exist yet when the
// title was won. Reads a restored copy of the accepted snapshot plus retained local evidence. No CHPP
// or HTML requests, no database writes, and no change to the private store or published data.
//
//   node qa/audit-pre-signup-attributions.mjs --db <restored archive.db> \
//     --out .scrape/pre-signup-audit/results.json --proposal qa/pre-signup-attribution-clearances.proposed.json
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const DAY = 86_400_000;
const SEASON_DAYS = 112;
/** A title is flagged only when the account's earliest possible creation is a full season later. */
const MARGIN_DAYS = SEASON_DAYS;
/** No retained dated evidence covers global seasons before this; require two seasons there. */
const FIRST_CALIBRATED_SEASON = 15;
/** Latest plausible title day relative to the modelled end of its global season (league round 14). */
const TITLE_WINDOW = {
  league: [-7, 14], 'main-cup': [-75, 10], 'secondary-cup': [-75, 10], masters: [-75, 10],
  seasonal: [1, 10], 'supporter-week': [8, 28],
};
const SUPPORTER_WEEK = 2108472;
const MASTERS = 183;

const { values: args } = parseArgs({ options: {
  db: { type: 'string' }, out: { type: 'string' }, proposal: { type: 'string' },
  store: { type: 'string', default: resolve(root, '.update-store') },
  scrape: { type: 'string', default: resolve(root, '.scrape') },
} });
if (!args.db || !args.out) throw new Error('Usage: --db <restored snapshot copy> --out <results.json> [--proposal <file>]');

const sha256 = body => createHash('sha256').update(body).digest('hex');
const day = value => value.slice(0, 10);
const toTime = value => Date.parse(`${day(value)}T00:00:00Z`);
const iso = time => new Date(time).toISOString().slice(0, 10);
const daysBetween = (later, earlier) => Math.round((toTime(later) - toTime(earlier)) / DAY);
const tag = (xml, name) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? null;
const rel = path => relative(root, path).replaceAll('\\', '/');
function files(dir, accept) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path, accept)); else if (accept(path)) out.push(path);
  }
  return out;
}

// --- Snapshot -----------------------------------------------------------------------------------
const dbPath = resolve(args.db);
const dbSha256 = sha256(readFileSync(dbPath));
const pointer = JSON.parse(readFileSync(join(args.store, 'state/current.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(args.store, pointer.manifestKey), 'utf8'));
if (manifest.database.sha256 !== dbSha256) throw new Error('Database is not the accepted snapshot named by state/current.json');
const db = new DatabaseSync(dbPath, { readOnly: true });

// --- Global season dates and per-country offsets (retained worlddetails) ------------------------
const runEvidence = files(join(args.store, 'evidence/runs'), path => path.endsWith('.json'));
const world = new Map();
for (const path of runEvidence) {
  const raw = readFileSync(path, 'utf8');
  if (!raw.includes('"source":"worlddetails"')) continue;
  const capture = JSON.parse(raw);
  for (const block of capture.payload.xml.split('<League>').slice(1)) {
    const body = block.replace(/<Cups>[\s\S]*?<\/Cups>/, '');
    const league = {
      leagueId: Number(tag(body, 'LeagueID')), season: Number(tag(body, 'Season')),
      seasonOffset: Number(tag(body, 'SeasonOffset')), matchRound: Number(tag(body, 'MatchRound')),
      seriesMatchDate: tag(body, 'SeriesMatchDate'), activeTeams: Number(tag(body, 'ActiveTeams')),
      capturedAt: capture.capturedAt, key: rel(path),
    };
    const previous = world.get(league.leagueId);
    if (!previous || previous.capturedAt < league.capturedAt) world.set(league.leagueId, league);
  }
}
// Sweden is the global calendar (offset 0). Round 14 of the current season ends the league season.
const sweden = world.get(1);
if (!sweden || sweden.seasonOffset !== 0) throw new Error('No retained Sweden worlddetails');
const CURRENT = sweden.season;
const currentEnd = Date.parse(`${sweden.seriesMatchDate.replace(' ', 'T')}Z`) - (sweden.matchRound - 14) * 7 * DAY;
const seasonEnd = g => currentEnd - (CURRENT - g) * SEASON_DAYS * DAY;
const offsets = new Map();
const offsetNotes = [];
for (const league of world.values()) {
  let offset = league.seasonOffset;
  // A frozen league keeps reporting a SeasonOffset relative to today's global season. Its real
  // offset follows from the date of its last scheduled round instead.
  if (league.activeTeams === 0) {
    const last = Date.parse(`${league.seriesMatchDate.replace(' ', 'T')}Z`);
    const global = CURRENT - Math.round((currentEnd - last) / DAY / SEASON_DAYS);
    offset = league.season - global;
    offsetNotes.push({ leagueId: league.leagueId, reported: league.seasonOffset, used: offset,
      reason: `ActiveTeams 0; last round ${day(league.seriesMatchDate)} is global season ${global}` });
  }
  offsets.set(league.leagueId, offset);
}

// --- Account creation anchors (retained teamdetails SignupDate) ---------------------------------
const anchorFiles = [
  ...files(join(args.scrape, 'owner-snapshots-2026-10-30'), path => /teamdetails-3\.6-\d+\.xml$/.test(path)),
  ...runEvidence, ...files(resolve(root, 'server/samples'), path => /teamdetails.*\.xml$/.test(path)),
];
const anchorsById = new Map();
const anchorConflicts = [];
for (const path of anchorFiles) {
  const raw = readFileSync(path, 'utf8');
  if (!raw.includes('SignupDate')) continue;
  const xml = path.endsWith('.json') ? JSON.parse(raw).payload?.xml ?? '' : raw;
  const user = xml.match(/<User>([\s\S]*?)<\/User>/)?.[1];
  if (!user) continue;
  const anchor = { userId: Number(tag(user, 'UserID')), login: tag(user, 'Loginname'),
    signup: tag(user, 'SignupDate'), activation: tag(user, 'ActivationDate'), source: rel(path) };
  if (!(anchor.userId > 0) || !anchor.signup || anchor.signup.startsWith('0001')) continue;
  const previous = anchorsById.get(anchor.userId);
  if (previous && previous.signup !== anchor.signup) anchorConflicts.push([previous, anchor]);
  if (!previous) anchorsById.set(anchor.userId, anchor);
}
if (anchorConflicts.length) throw new Error(`Conflicting SignupDate captures for ${anchorConflicts.length} users`);
const anchors = [...anchorsById.values()].sort((a, b) => a.userId - b.userId);
// User IDs are issued in increasing order, but some low IDs carry a much later SignupDate (a
// re-registration or re-issued ID). Only anchors no later than every higher anchor form the
// fresh-issue chain; their SignupDate is a lower bound for the creation of any higher ID.
let suffixMin = '9999';
for (let i = anchors.length - 1; i >= 0; i--) {
  anchors[i].chain = anchors[i].signup <= suffixMin;
  if (anchors[i].chain) suffixMin = anchors[i].signup;
  anchors[i].issuedBy = suffixMin;
}
const chain = anchors.filter(anchor => anchor.chain);
const chainBelow = userId => {
  let lo = 0, hi = chain.length - 1, found = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (chain[mid].userId <= userId) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  return [chain[found], chain[found - 1]].filter(Boolean);
};
const firstAnchorAbove = userId => anchors.find(anchor => anchor.userId > userId) ?? null;

// --- Independent check: a dated Club History manager link proves that ID existed on that day ---
const historyDate = text => text.match(/^(\d{2})[-.](\d{2})[-.](\d{4})\b/)?.slice(1).reverse().join('-') ?? null;
const historyEvents = [];
const historySources = [join(args.scrape, 'winner-recovery/histories.json'),
  ...files(resolve(root, 'server/src/data'), path => /verified-(club-history|manager-profile)-.*\.json$/.test(path))];
for (const path of historySources) {
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.text === 'string' && Array.isArray(node.links)) {
      const date = historyDate(node.text);
      for (const link of node.links) {
        const userId = Number(/[?&]userId=(\d+)/i.exec(link.href ?? '')?.[1]);
        if (date && userId > 0) historyEvents.push({ userId, date, source: rel(path) });
      }
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')));
}
const contradictions = historyEvents.filter(event => {
  const [lower] = chainBelow(event.userId);
  return lower && day(lower.signup) > event.date;
});

// --- Calibration evidence for the date model ----------------------------------------------------
const cupLeague = new Map(db.prepare('SELECT cupId, leagueId FROM Cup').all().map(row => [row.cupId, row.leagueId]));
const calibration = { cupFinals: { n: 0, min: Infinity, max: -Infinity }, leagueFinishes: { n: 0, min: Infinity, max: -Infinity },
  seasonalEditions: { n: 0, min: Infinity, max: -Infinity } };
const observe = (bucket, residual) => { bucket.n++; bucket.min = Math.min(bucket.min, residual); bucket.max = Math.max(bucket.max, residual); };
for (const path of files(join(args.store, 'evidence/chpp/cupmatches'), path => path.endsWith('.json'))) {
  const cup = JSON.parse(readFileSync(path, 'utf8')).payload?.HattrickData?.Cup;
  const matches = [].concat(cup?.Match ?? []);
  if (!cup || !matches.length) continue;
  const cupId = Number(cup.CupID), leagueId = cupLeague.get(cupId);
  const global = cupId === MASTERS ? Number(cup.CupSeason) : offsets.has(leagueId) ? Number(cup.CupSeason) - offsets.get(leagueId) : null;
  if (global === null) continue;
  const last = matches.map(match => match.MatchDate).sort().at(-1);
  observe(calibration.cupFinals, Math.round((Date.parse(`${last.replace(' ', 'T')}Z`) - seasonEnd(global)) / DAY));
}
const histories = JSON.parse(readFileSync(join(args.scrape, 'winner-recovery/histories.json'), 'utf8'));
const seasonalCurrent = new Map(db.prepare('SELECT cupName, currentSeason FROM Cup WHERE leagueId = 0 AND cupId <> ?').all(MASTERS)
  .map(row => [row.cupName, row.currentSeason]));
for (const club of histories) for (const page of club.pages ?? []) for (const row of page.rows ?? []) {
  const date = historyDate(row.text);
  if (!date) continue;
  const finish = row.text.match(/finished as number \d+ in \S+ season (\d+)/);
  if (finish && offsets.has(club.leagueId)) {
    observe(calibration.leagueFinishes, Math.round((Date.parse(`${date}T00:00:00Z`) - seasonEnd(Number(finish[1]) - offsets.get(club.leagueId))) / DAY));
  }
  const seasonal = row.text.match(/Participated in season (\d+) of (.+?) and finished/);
  if (seasonal && seasonalCurrent.has(seasonal[2])) {
    const global = CURRENT - (seasonalCurrent.get(seasonal[2]) - Number(seasonal[1]));
    observe(calibration.seasonalEditions, Math.round((Date.parse(`${date}T00:00:00Z`) - seasonEnd(global)) / DAY));
  }
}

// --- Provenance: checked-in reviewed evidence that names a manager for an exact title ---------
const provenance = new Map();
const addProvenance = (table, competitionId, season, userId, source) => {
  const key = `${table}:${competitionId}:${season}`;
  if (!provenance.has(key)) provenance.set(key, []);
  provenance.get(key).push({ userId, source });
};
const dataDir = resolve(root, 'server/src/data');
for (const name of ['verified-historical-winners.json', 'verified-masters-winners.json', 'verified-club-history-winners.json',
  'verified-recent-cup-winners.json', 'reviewed-winner-corrections.json']) {
  for (const record of JSON.parse(readFileSync(join(dataDir, name), 'utf8'))) {
    addProvenance(record.table, record.competitionId, record.season, record.userId, name);
  }
}
for (const line of readFileSync(join(dataDir, 'verified-club-history-bulk-2026-09.jsonl'), 'utf8').split(/\r?\n/).slice(1).filter(Boolean)) {
  const entry = JSON.parse(line);
  if (Array.isArray(entry) && entry[0] !== 'unresolved') addProvenance('cupChampion', entry[0], entry[1], entry[8], 'verified-club-history-bulk-2026-09.jsonl');
  else if (entry.status === 'linked') {
    const userId = Number(/userId=(\d+)/i.exec(JSON.stringify(entry.row))?.[1]);
    addProvenance('cupChampion', entry.cupId, entry.season, userId, 'verified-club-history-bulk-2026-09.jsonl');
  }
}

// --- Titles -------------------------------------------------------------------------------------
const users = new Map(db.prepare('SELECT userId, loginName, isBot FROM HattrickUser').all().map(row => [row.userId, row]));
const leagueNames = new Map(db.prepare('SELECT leagueId, countryName FROM NationalLeague').all().map(row => [row.leagueId, row.countryName]));
const titles = [];
for (const row of db.prepare('SELECT * FROM LeagueChampion WHERE championUserId > 0').all()) {
  titles.push({ family: 'league', table: 'leagueChampion', competitionId: row.leagueId, leagueId: row.leagueId,
    competition: `${row.countryName} league`, country: row.countryName, season: row.season,
    globalSeason: row.season - offsets.get(row.leagueId), row });
}
for (const row of db.prepare(`SELECT c.*, cu.leagueId AS cupLeagueId, cu.currentSeason AS cupCurrentSeason
    FROM CupChampion c JOIN Cup cu ON cu.cupId = c.cupId WHERE c.championUserId > 0`).all()) {
  const family = row.cupId === MASTERS ? 'masters' : row.cupLeagueId === 0 ? 'seasonal' : row.isMain ? 'main-cup' : 'secondary-cup';
  const globalSeason = family === 'masters' ? row.season
    : family === 'seasonal' ? CURRENT - (row.cupCurrentSeason - row.season)
    : row.season - offsets.get(row.cupLeagueId);
  titles.push({ family, table: 'cupChampion', competitionId: row.cupId, leagueId: row.leagueId,
    competition: row.cupName, country: family === 'seasonal' || family === 'masters' ? null : row.countryName,
    season: row.season, globalSeason, row });
}

const results = [];
for (const title of titles) {
  if (!Number.isInteger(title.globalSeason)) throw new Error(`No season mapping for ${title.table} ${title.competitionId}`);
  const windowKey = title.competitionId === SUPPORTER_WEEK ? 'supporter-week' : title.family;
  const [early, late] = TITLE_WINDOW[windowKey];
  const end = seasonEnd(title.globalSeason);
  const titleDate = { earliest: iso(end + early * DAY), latest: iso(end + late * DAY), seasonEnd: iso(end) };
  const userId = title.row.championUserId;
  const [lower, second] = chainBelow(userId);
  const own = anchorsById.get(userId) ?? null;
  const gap = anchor => anchor ? daysBetween(anchor.signup, titleDate.latest) : null;
  const result = {
    family: title.family, table: title.table, competitionId: title.competitionId, leagueId: title.leagueId,
    country: title.country, competition: title.competition, season: title.season, globalSeason: title.globalSeason,
    titleDate, teamId: title.row.championTeamId, teamName: title.row.championTeamName,
    userId, userName: title.row.championUserName, currentLogin: users.get(userId)?.loginName ?? null,
    issuedNotBefore: lower ? { userId: lower.userId, signup: day(lower.signup), gapDays: gap(lower) } : null,
    secondAnchor: second ? { userId: second.userId, signup: day(second.signup), gapDays: gap(second) } : null,
    ownSignup: own ? { signup: day(own.signup), onChain: own.chain, gapDays: gap(own) } : null,
    nextAnchorAbove: (anchor => anchor ? { userId: anchor.userId, signup: day(anchor.signup) } : null)(firstAnchorAbove(userId)),
    provenance: provenance.get(`${title.table}:${title.competitionId}:${title.season}`) ?? [],
  };
  const gap1 = result.issuedNotBefore?.gapDays ?? -Infinity;
  const gap2 = result.secondAnchor?.gapDays ?? -Infinity;
  // High: a second, lower chain anchor independently clears the margin, so no single anchor decides.
  const highMargin = title.globalSeason < FIRST_CALIBRATED_SEASON ? 2 * MARGIN_DAYS : MARGIN_DAYS;
  if (gap1 >= MARGIN_DAYS) result.verdict = gap2 >= highMargin ? 'flag-high' : 'flag-medium';
  else if (result.ownSignup && result.ownSignup.gapDays >= MARGIN_DAYS) result.verdict = 'review-account-reissued';
  else if (gap1 > 0) result.verdict = 'borderline';
  else result.verdict = 'consistent';
  results.push(result);
}

// --- Summary ------------------------------------------------------------------------------------
const families = ['league', 'main-cup', 'secondary-cup', 'masters', 'seasonal'];
const verdicts = ['flag-high', 'flag-medium', 'review-account-reissued', 'borderline', 'consistent'];
const counts = Object.fromEntries(families.map(family => [family, Object.fromEntries([['credited', 0], ...verdicts.map(v => [v, 0])])]));
for (const result of results) { counts[result.family].credited++; counts[result.family][result.verdict]++; }
const order = (a, b) => a.userId - b.userId || a.table.localeCompare(b.table) || a.competitionId - b.competitionId || a.season - b.season;
const flagged = results.filter(result => result.verdict.startsWith('flag')).sort(order);
const review = results.filter(result => result.verdict === 'review-account-reissued').sort(order);
const borderline = results.filter(result => result.verdict === 'borderline').sort(order);
const output = {
  format: 'pre-signup-attribution-audit-v1', generatedAt: new Date().toISOString(),
  snapshot: { snapshotId: pointer.snapshotId, createdAt: manifest.createdAt, databaseSha256: dbSha256 },
  parameters: { seasonDays: SEASON_DAYS, marginDays: MARGIN_DAYS, firstCalibratedSeason: FIRST_CALIBRATED_SEASON,
    currentGlobalSeason: CURRENT, currentSeasonEnd: iso(currentEnd), titleWindowDaysFromSeasonEnd: TITLE_WINDOW },
  inputs: {
    worlddetails: { leagues: world.size, frozenLeagueOffsets: offsetNotes },
    anchors: { files: anchorFiles.length, users: anchors.length, chain: chain.length, offChain: anchors.length - chain.length,
      lowest: chain[0] && { userId: chain[0].userId, signup: day(chain[0].signup) },
      highest: chain.at(-1) && { userId: chain.at(-1).userId, signup: day(chain.at(-1).signup) } },
    historyEvents: { events: historyEvents.length, users: new Set(historyEvents.map(event => event.userId)).size,
      contradictions: contradictions.length, examples: contradictions.slice(0, 10) },
    calibration,
  },
  counts, flagged, review, borderline,
  chain: chain.map(anchor => ({ userId: anchor.userId, signup: day(anchor.signup) })),
};
mkdirSync(dirname(resolve(args.out)), { recursive: true });
writeFileSync(resolve(args.out), `${JSON.stringify(output, null, 1)}\n`);

if (args.proposal) {
  const anchorRef = anchor => anchor && { anchorUserId: anchor.userId, signup: anchor.signup, gapDays: anchor.gapDays };
  const proposal = {
    format: 'proposed-attribution-clearance-v1', status: 'proposed-not-reviewed',
    generatedAt: output.generatedAt, snapshot: output.snapshot,
    audit: { script: 'qa/audit-pre-signup-attributions.mjs', report: 'docs/PRE_SIGNUP_ATTRIBUTION_AUDIT_2026-10-30.md',
      marginDays: MARGIN_DAYS, firstCalibratedSeason: FIRST_CALIBRATED_SEASON },
    effect: 'Each record sets championUserId to 0 (the archive\'s manager-pending sentinel) and championUserName to null. ' +
      'Nothing else changes: not the winning club, the result, the HattrickUser row or any other title.',
    guard: 'Apply all-or-nothing. Every expectedPrior field, the team name and the competition/season key must match ' +
      'the accepted snapshot exactly; one mismatch blocks the whole batch.',
    records: flagged.map(result => ({
      kind: 'clear-attribution', table: result.table, competitionId: result.competitionId, season: result.season,
      leagueId: result.leagueId, teamName: result.teamName, expectedPriorTeamId: result.teamId,
      expectedPriorUserId: result.userId, expectedPriorUserName: result.userName,
      confidence: result.verdict === 'flag-high' ? 'high' : 'medium',
      reason: `Won by ${result.titleDate.latest} (global season ${result.globalSeason}); account ${result.userId} ` +
        `was created no earlier than ${result.issuedNotBefore.signup}.`,
      evidence: {
        family: result.family, titleLatest: result.titleDate.latest, globalSeason: result.globalSeason,
        accountNotBefore: anchorRef(result.issuedNotBefore), corroboratingAnchor: anchorRef(result.secondAnchor),
        ownSignupOnChain: result.ownSignup?.onChain ?? null,
      },
      reviewedAt: null,
    })),
  };
  mkdirSync(dirname(resolve(args.proposal)), { recursive: true });
  // One record per line keeps the reviewed diff readable.
  const { records, ...header } = proposal;
  const head = JSON.stringify(header, null, 1).replace(/\n}$/, '');
  writeFileSync(resolve(args.proposal), `${head},\n "records": [\n${records.map(record => `  ${JSON.stringify(record)}`).join(',\n')}\n ]\n}\n`);
}
console.log(JSON.stringify({ snapshot: output.snapshot.snapshotId, anchors: output.inputs.anchors,
  historyEvents: { events: historyEvents.length, contradictions: contradictions.length }, calibration, counts,
  flagged: flagged.length, review: review.length, borderline: borderline.length }, null, 1));
