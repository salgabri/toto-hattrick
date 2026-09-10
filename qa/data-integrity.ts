/**
 * Independent, read-only numeric audit. Run from the repository root with Node >= 22.18:
 *   node qa/data-integrity.ts
 * Uses SQLite's enforced readOnly mode and SELECT statements only. Never reads tokens,
 * calls CHPP, imports the production baker, or changes the DB/public data.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

type Row = Record<string, any>;
type Check = { checked: number; failed: number; examples: unknown[] };
const root = resolve(import.meta.dirname, '..');
const db = new DatabaseSync(resolve(root, 'server/prisma/dev.db'), { readOnly: true });
const load = (file: string): any => JSON.parse(readFileSync(resolve(root, file), 'utf8'));
const tables = ['Team', 'Match', 'MatchDetail', 'SeasonStanding', 'NationalLeague', 'LeagueChampion', 'Cup', 'CupChampion', 'WorldCupChampion', 'NationalCupChampion', 'NationalCoachElection', 'HattrickUser'];
const data: Record<string, Row[]> = Object.fromEntries(tables.map(t => [t, db.prepare(`SELECT * FROM "${t}"`).all()]));
db.close();
const baked = Object.fromEntries(['managers', 'leagues', 'cups', 'masters', 'seasonal', 'worldcup', 'elections'].map(f => [f, load(`web/public/data/${f}.json`)]));
const checks: Record<string, Check> = {};
function check(name: string, pass: boolean, detail?: unknown) {
  const c = checks[name] ??= { checked: 0, failed: 0, examples: [] };
  c.checked++;
  if (!pass) { c.failed++; if (c.examples.length < 8) c.examples.push(detail); }
}
const canonical = (v: any): string => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
function equal(name: string, actual: any, expected: any, key: any) { check(name, canonical(actual) === canonical(expected), { key, actual, expected }); }
const positive = (v: any) => typeof v === 'number' && v > 0 ? v : undefined;
const bool = (v: any) => Boolean(v);
const ids = (v: string) => (v || '').split(',').map(Number);
const nations = (v: string) => v ? v.split(', ') : [];
const names = new Map(data.HattrickUser.map(u => [u.userId, u.loginName]));
const nationality = new Map(data.HattrickUser.map(u => [u.userId, u.nationality]));
const winners = data.LeagueChampion.filter(c => c.complete);
const cupById = new Map(data.Cup.map(c => [c.cupId, c]));
const mastersId = 183;
// Sentinel 0 is for international club competitions; Masters has its fixed separate identity.
// Read the registry from SQLite, so a missing entire seasonal bundle cannot evade the oracle.
const seasonalIds = new Set(data.Cup.filter(c => c.leagueId === 0 && c.cupId !== mastersId).map(c => c.cupId));
const defunct = new Set([1002]);
const gaps: Row[] = [];
const coverage: Row = {};
const keyLeague = (c: Row) => `${c.leagueId}/${c.season}`;
const keyCup = (c: Row) => `${c.cupId}/${c.season}`;
const keyWorld = (c: Row) => `${bool(c.isYouth)}/${c.edition}`;
const keyElection = (c: Row) => `${c.leagueId}/${bool(c.isYouth)}/${c.edition}/${c.winnerUserId ?? 0}/${c.votes ?? ''}`;
function unique(name: string, rows: Row[], key: (r: Row) => string) {
  const seen = new Set<string>();
  for (const r of rows) { const k = key(r); check(name, !seen.has(k), k); seen.add(k); }
}
function reconcile(name: string, actual: Row[], expected: Row[], key: (r: Row) => string) {
  const groups = new Map<string, Row[]>();
  for (const r of expected) { const k = key(r); groups.set(k, [...groups.get(k) ?? [], r]); }
  for (const r of actual) {
    const k = key(r); const group = groups.get(k) ?? []; const i = group.findIndex(e => canonical(e) === canonical(r));
    check(name, i >= 0, { key: k, actual: r, expected: group[0] });
    if (i >= 0) group.splice(i, 1);
  }
  for (const [k, rows] of groups) for (const row of rows) check(name, false, { key: k, missingFromBake: row });
}
function inspectSequence(label: string, competition: any, rows: Row[], field: string, expectedStart?: number) {
  const values = [...new Set(rows.map(r => r[field]))].sort((a, b) => a - b);
  if (!values.length) return;
  const missing = [];
  for (let i = expectedStart ?? values[0]; i <= values.at(-1)!; i++) if (!values.includes(i)) missing.push(i);
  if (missing.length) gaps.push({ label, competition, first: values[0], last: values.at(-1), missing });
}
function latest(rows: Row[], group: string, field: string) {
  const out = new Map<any, number>();
  for (const r of rows) out.set(r[group], Math.max(out.get(r[group]) ?? -Infinity, r[field]));
  return out;
}
const latestLeague = latest(winners, 'leagueId', 'season');
const latestCup = latest(data.CupChampion, 'cupId', 'season');
const latestWorld = latest(data.WorldCupChampion.filter(c => c.champion), 'isYouth', 'edition');
const latestNational = latest(data.NationalCupChampion.filter(c => c.champion), 'cupId', 'season');

// The static rolls preserve every stored competition and row, including unknown winners.
const leagueExpected = winners.map(c => ({ leagueId: c.leagueId, season: c.season, club: c.championTeamName, manager: c.championUserName ?? '—', teamId: positive(c.championTeamId), userId: positive(c.championUserId) }));
const leagueActual = baked.leagues.flatMap((l: Row) => l.champions.map((c: Row) => ({ leagueId: l.leagueId, ...c })));
reconcile('DB → league roll: complete row equality', leagueActual, leagueExpected, keyLeague);
unique('League roll: unique competition/season', leagueActual, keyLeague);
const cupExpected = data.CupChampion.map(c => ({ cupId: c.cupId, season: c.season, club: c.championTeamName, manager: c.championUserName ?? '—', teamId: positive(c.championTeamId), userId: positive(c.championUserId), leagueId: (c.cupId === mastersId || seasonalIds.has(c.cupId)) ? positive(c.championLeagueId) : undefined }));
const cupActual = [
  ...baked.cups.flatMap((l: Row) => l.cups.flatMap((c: Row) => c.winners.map((w: Row) => ({ cupId: c.cupId, ...w })))),
  ...baked.masters.map((w: Row) => ({ cupId: mastersId, ...w })),
  ...baked.seasonal.flatMap((c: Row) => c.winners.map((w: Row) => ({ cupId: c.cupId, ...w }))),
];
reconcile('DB → all club-cup rolls: complete row equality', cupActual, cupExpected, keyCup);
unique('Club-cup rolls: unique competition/season', cupActual, keyCup);
for (const l of baked.leagues) {
  equal('League country metadata', l.country, data.NationalLeague.find(r => r.leagueId === l.leagueId)?.countryName, l.leagueId);
  inspectSequence('league', l.leagueId, l.champions, 'season', 1);
  equal('League order: newest first', l.champions.map((r: Row) => r.season), l.champions.map((r: Row) => r.season).sort((a: number, b: number) => b - a), l.leagueId);
}
for (const l of baked.cups) for (const c of l.cups) {
  const stored = cupById.get(c.cupId)!;
  equal('Cup metadata', [l.leagueId, l.country, c.cupName, c.isMain, c.cupLevel, c.cupLevelIndex], [stored.leagueId, stored.countryName, stored.cupName, bool(stored.isMain), stored.cupLevel, stored.cupLevelIndex], c.cupId);
  inspectSequence('national club cup', c.cupId, c.winners, 'season');
}
for (const c of baked.seasonal) inspectSequence(c.cupName, c.cupId, c.winners, 'season', 1);
inspectSequence('Masters', mastersId, baked.masters, 'season', 28);
for (const c of baked.seasonal) equal('Seasonal competition metadata', c.cupName, cupById.get(c.cupId)?.cupName, c.cupId);
for (const c of winners) {
  const registry = data.NationalLeague.find(l => l.leagueId === c.leagueId);
  equal('League rows agree with competition country', c.countryName, registry?.countryName, keyLeague(c));
  check('League champion does not exceed registry current season', !registry?.currentSeason || c.season <= registry.currentSeason, keyLeague(c));
  check('Known league owner exists in user registry', !(c.championUserId > 0) || names.has(c.championUserId), keyLeague(c));
}
for (const c of data.CupChampion) {
  const registry = cupById.get(c.cupId);
  equal('Cup rows agree with competition registry', [c.leagueId, c.countryName, c.cupName, bool(c.isMain)], [registry?.leagueId, registry?.countryName, registry?.cupName, bool(registry?.isMain)], keyCup(c));
  check('Cup champion does not exceed registry current season', !registry?.currentSeason || c.season <= registry.currentSeason, keyCup(c));
  check('Known cup owner exists in user registry', !(c.championUserId > 0) || names.has(c.championUserId), keyCup(c));
  if (c.championLeagueId > 0) check('International winner country exists in registry', data.NationalLeague.some(l => l.leagueId === c.championLeagueId), keyCup(c));
}

// National rolls: each podium nation and each identified coach must match storage, index by index.
function coach(uid: number) { return positive(uid) ? { userId: uid, name: names.get(uid) ?? undefined, nationality: nationality.get(uid) ?? undefined } : {}; }
function podium(c: Row) {
  const thirdFourth = nations(c.thirdFourth); const bronzeIds = ids(c.thirdFourthUserIds); const ru = coach(c.runnerUpUserId);
  return { host: c.host, finished: c.finishedDate ?? c.finalDate ?? null, champion: c.champion, runnerUp: c.runnerUp, thirdFourth,
    coachUserId: positive(c.championUserId), coach: c.championUserName ?? undefined, coachNationality: c.championUserId ? nationality.get(c.championUserId) ?? undefined : undefined,
    runnerUpCoachUserId: ru.userId, runnerUpCoach: ru.name, runnerUpCoachNationality: ru.nationality, thirdFourthCoaches: thirdFourth.map((_, i) => coach(bronzeIds[i])) };
}
const worldExpected = data.WorldCupChampion.map(c => ({ isYouth: bool(c.isYouth), edition: c.edition, ageGroup: c.ageGroup ?? undefined, ...podium(c) }));
const worldActual = ['senior', 'youth'].flatMap(bracket => baked.worldcup[bracket].map((c: Row) => ({ isYouth: bracket === 'youth', ...c })));
reconcile('DB → World Cup roll: complete podium equality', worldActual, worldExpected, keyWorld);
unique('World Cup roll: unique bracket/edition', worldActual, keyWorld);
const nationalExpected = data.NationalCupChampion.map(c => ({ cupId: c.cupId, season: c.season, ...podium(c), status: c.status ?? undefined, championLeagueId: c.championLeagueId ?? undefined, runnerUpLeagueId: c.runnerUpLeagueId ?? undefined, thirdFourthLeagueIds: ids(c.thirdFourthLeagueIds) }));
const nationalActual = baked.worldcup.regional.flatMap((c: Row) => c.seasons.map((r: Row) => ({ cupId: c.cupId, ...r })));
reconcile('DB → regional rolls: complete podium equality', nationalActual, nationalExpected, keyCup);
unique('Regional roll: unique competition/season', nationalActual, keyCup);
for (const bracket of ['senior', 'youth']) inspectSequence(`World Cup ${bracket}`, bracket, baked.worldcup[bracket], 'edition', 1);
for (const cup of baked.worldcup.regional) inspectSequence(cup.cupName, cup.cupId, cup.seasons, 'season');
for (const cup of baked.worldcup.regional) {
  const r = data.NationalCupChampion.find(c => c.cupId === cup.cupId);
  equal('Regional competition metadata', [cup.cupName, cup.isYouth], [r?.cupName, bool(r?.isYouth)], cup.cupId);
}
for (const row of [...worldActual, ...nationalActual]) {
  const key = row.cupId ? keyCup(row) : keyWorld(row);
  equal('Podium nation/coach index alignment', row.thirdFourth.length, row.thirdFourthCoaches.length, key);
  if (row.champion) {
    const ns = [row.champion, row.runnerUp, ...row.thirdFourth].filter(Boolean);
    equal('Podium nations are distinct', new Set(ns).size, ns.length, key);
    check('Finished podium never predates an unplayed final', Boolean(row.finished), key);
    const parts = row.finished?.match(/(\d{2})[.-](\d{2})[.-](\d{4})/);
    if (parts) check('Completed national final is not in the future', Date.UTC(+parts[3], +parts[2] - 1, +parts[1]) <= Date.now(), { key, finished: row.finished });
  } else {
    check('Ongoing competition has no champion coach', !row.coachUserId, key);
  }
}

// Elections are a multiset: re-elections in the same country/bracket/cycle are legitimate.
const electionsExpected = data.NationalCoachElection.map(c => ({ leagueId: c.leagueId, countryName: c.countryName, edition: c.edition, host: c.host, isYouth: c.isYouth ? true : undefined, winnerUserId: c.winnerUserId ?? undefined, winner: c.winnerUserName ?? undefined, winnerNationality: c.winnerUserId ? nationality.get(c.winnerUserId) ?? undefined : undefined, votes: c.votes ?? undefined }));
reconcile('DB → elections: multiset equality', baked.elections, electionsExpected, keyElection);
for (const e of baked.elections) {
  if (e.votes) {
    const match = e.votes.match(/^(\d+)\s*\((\d+)%\)$/);
    check('Election votes have a valid count and percentage', Boolean(match && +match[1] >= 0 && +match[2] >= 0 && +match[2] <= 100), { key: keyElection(e), votes: e.votes });
  }
  check('Election winner name/id are paired', Boolean(e.winner) === Boolean(positive(e.winnerUserId)), { key: keyElection(e), winner: e.winner, id: e.winnerUserId });
}

// Independently reconstruct title/medal attribution from DB rows, then reconcile every cabinet.
const expectedTitles: Row[] = [];
const expectedMedals: Row[] = [];
function title(uid: number, bucket: string, item: Row, latestValue: number | undefined, closed = false) {
  if (uid > 0) expectedTitles.push({ uid, bucket, ...item, last: !closed && latestValue === item.season, ago: closed || latestValue === undefined ? undefined : latestValue - item.season });
}
for (const c of winners) title(c.championUserId, 'titles', { country: c.countryName, leagueId: c.leagueId, season: c.season, club: c.championTeamName, teamId: positive(c.championTeamId) }, latestLeague.get(c.leagueId), defunct.has(c.leagueId));
for (const c of data.CupChampion) {
  const intl = c.cupId === mastersId || seasonalIds.has(c.cupId);
  const bucket = c.cupId === mastersId ? 'masters' : seasonalIds.has(c.cupId) ? 'seasonal' : c.isMain ? 'cupsMain' : 'cupsSec';
  title(c.championUserId, bucket, { country: c.countryName, leagueId: intl ? c.championLeagueId ?? 0 : c.leagueId, season: c.season, club: c.championTeamName, teamId: positive(c.championTeamId), cup: c.cupName }, latestCup.get(c.cupId), defunct.has(c.leagueId));
}
for (const c of [...data.WorldCupChampion, ...data.NationalCupChampion]) {
  const world = c.edition !== undefined; const season = world ? c.edition : c.season;
  const cup = world ? c.isYouth ? 'World Cup (Youth)' : 'World Cup' : c.cupName;
  const anchor = world ? latestWorld.get(c.isYouth) : latestNational.get(c.cupId);
  title(c.championUserId, 'worldCup', { country: world ? 'World Cup' : c.cupName, leagueId: world ? 0 : c.championLeagueId ?? 0, season, club: c.champion, cup }, anchor);
  if (!c.champion) continue;
  const ago = anchor === undefined ? undefined : anchor - season;
  if (c.runnerUpUserId > 0) expectedMedals.push({ uid: c.runnerUpUserId, cup, season, nation: c.runnerUp ?? '', leagueId: world ? undefined : c.runnerUpLeagueId ?? undefined, place: 2, ago });
  const thirdNames = nations(c.thirdFourth); const thirdLeagueIds = ids(c.thirdFourthLeagueIds);
  ids(c.thirdFourthUserIds).forEach((uid, i) => { if (uid > 0) expectedMedals.push({ uid, cup, season, nation: thirdNames[i] ?? '', leagueId: world ? undefined : positive(thirdLeagueIds[i]), place: 3, ago }); });
}
const actualTitles: Row[] = []; const actualMedals: Row[] = [];
const buckets = { titles: 'lg', cupsMain: 'main', cupsSec: 'sec', masters: 'hm', seasonal: 'sn', worldCup: 'wc' };
unique('Managers: unique numeric ID', baked.managers, c => String(c.userId));
for (const m of baked.managers) {
  equal('Manager nationality matches user table', m.nationality, nationality.get(m.userId) ?? 'Unknown', m.userId);
  for (const [bucket, count] of Object.entries(buckets)) {
    const rows = m[bucket] ?? [];
    equal('Manager category count equals cabinet length', m[count], rows.length, `${m.userId}/${bucket}`);
    equal('Manager reigning count equals cabinet flags', m[count + 'Last'], rows.filter((t: Row) => t.last).length, `${m.userId}/${bucket}`);
    for (const item of rows) {
      actualTitles.push({ uid: m.userId, bucket, ...item });
      check('Cabinet title has nonnegative recency', item.ago === undefined || Number.isInteger(item.ago) && item.ago >= 0, { uid: m.userId, bucket, item });
      equal('Reigning equals recent-one window', item.last, item.ago === 0, { uid: m.userId, bucket, season: item.season });
    }
  }
  equal('Silver tally equals medal entries', m.wcSilver, m.medals.filter((x: Row) => x.place === 2).length, m.userId);
  equal('Bronze tally equals medal entries', m.wcBronze, m.medals.filter((x: Row) => x.place === 3).length, m.userId);
  for (const item of m.medals) actualMedals.push({ uid: m.userId, ...item });
}
const titleKey = (r: Row) => `${r.uid}/${r.bucket}/${r.leagueId}/${r.cup ?? ''}/${r.season}`;
const medalKey = (r: Row) => `${r.uid}/${r.cup}/${r.season}/${r.place}/${r.nation}`;
reconcile('DB → manager cabinets: every title and recency', actualTitles, expectedTitles, titleKey);
reconcile('DB → manager cabinets: every silver/bronze', actualMedals, expectedMedals, medalKey);
unique('Cabinet contains each trophy once', actualTitles, titleKey);
unique('Cabinet contains each medal once', actualMedals, medalKey);
equal('Manager population equals title-or-medal owners', [...baked.managers.map((m: Row) => m.userId)].sort((a, b) => a - b), [...new Set([...expectedTitles, ...expectedMedals].map(r => r.uid))].sort((a, b) => a - b), 'all managers');

// Explicit source evidence is independent of the DB/bake pipeline. Compare identities, allowing
// historical display aliases; do not count a rename as ownership changing.
const sourceStats: Row = {};
for (const file of ['verified-historical-winners.json', 'verified-club-history-winners.json', 'verified-masters-winners.json', 'verified-recent-cup-winners.json', 'reviewed-winner-corrections.json']) {
  const rows = load(`server/src/data/${file}`); sourceStats[file] = rows.length;
  for (const r of rows) {
    const candidates = r.table === 'leagueChampion' ? data.LeagueChampion : data.CupChampion;
    const c = candidates.find(c => (r.table === 'leagueChampion' ? c.leagueId : c.cupId) === r.competitionId && c.season === r.season);
    check('Verified club evidence: numeric historical manager', c?.championUserId === r.userId, { file, competition: r.competitionId, season: r.season, actual: c?.championUserId, expected: r.userId });
    if (r.teamId) check('Verified club evidence: numeric historical club', c?.championTeamId === r.teamId, { file, competition: r.competitionId, season: r.season, actual: c?.championTeamId, expected: r.teamId });
  }
}
for (const r of load('server/src/data/verified-national-trophy-winners.json')) {
  const c = data.WorldCupChampion.find(c => bool(c.isYouth) === r.isYouth && c.edition === r.edition);
  const uid = r.slot === 'champion' ? c?.championUserId : r.slot === 'runnerUp' ? c?.runnerUpUserId : ids(c?.thirdFourthUserIds)[r.podiumIndex];
  equal('Verified national trophy evidence: numeric coach', uid, r.userId, { edition: r.edition, youth: r.isYouth, slot: r.slot });
}
for (const history of load('server/src/data/verified-national-election-histories.json')) {
  for (const row of history.rows) {
    // A retired/unknown name may subsequently be recovered by stronger evidence. A positive
    // source user ID must still match exactly; do not mistake a recovery for a contradiction.
    check('Verified election source row survives ingestion', data.NationalCoachElection.some(r => r.leagueId === row.leagueId && bool(r.isYouth) === row.isYouth && r.edition === row.edition && r.votes === row.votes && (!(row.winnerUserId > 0) || r.winnerUserId === row.winnerUserId)), { leagueId: row.leagueId, isYouth: row.isYouth, edition: row.edition, winnerUserId: row.winnerUserId });
  }
}

// Coverage is reported separately from corruption: unknown historical owners and missing initial
// editions may be honest source limitations. These are not fabricated test failures.
for (const [label, rows] of Object.entries({ leagues: winners, nationalMain: data.CupChampion.filter(c => c.isMain && c.cupId !== mastersId && !seasonalIds.has(c.cupId)), nationalSecondary: data.CupChampion.filter(c => !c.isMain && c.cupId !== mastersId && !seasonalIds.has(c.cupId)), masters: data.CupChampion.filter(c => c.cupId === mastersId), seasonal: data.CupChampion.filter(c => seasonalIds.has(c.cupId)), worldCup: data.WorldCupChampion.filter(c => c.champion), regional: data.NationalCupChampion.filter(c => c.champion) })) {
  coverage[label] = { stored: rows.length, attributed: rows.filter(c => c.championUserId > 0).length, unattributed: rows.filter(c => !(c.championUserId > 0)).length };
}
coverage.elections = { stored: baked.elections.length, named: baked.elections.filter((r: Row) => r.winner).length, unattributed: baked.elections.filter((r: Row) => !r.winner).length, withoutNationality: baked.elections.filter((r: Row) => r.winner && !r.winnerNationality).length };
coverage.managers = { stored: baked.managers.length, unknownNationality: baked.managers.filter((r: Row) => r.nationality === 'Unknown').length, titles: actualTitles.length, silver: actualMedals.filter(r => r.place === 2).length, bronze: actualMedals.filter(r => r.place === 3).length };
coverage.medals = Object.fromEntries(['WorldCupChampion', 'NationalCupChampion'].map(table => {
  const rows = data[table].filter(c => c.champion);
  return [table, { completedFinals: rows.length, runnerUpNations: rows.filter(c => c.runnerUp).length, silverAttributed: rows.filter(c => c.runnerUpUserId > 0).length, bronzeNations: rows.reduce((n, c) => n + nations(c.thirdFourth).length, 0), bronzeAttributed: rows.reduce((n, c) => n + ids(c.thirdFourthUserIds).filter(id => id > 0).length, 0) }];
}));
const usersByName = new Map<string, Row[]>();
for (const u of data.HattrickUser) usersByName.set(u.loginName, [...usersByName.get(u.loginName) ?? [], { userId: u.userId, nationality: u.nationality }]);
const duplicateUserNames = [...usersByName].filter(([, rows]) => rows.length > 1).map(([name, users]) => ({ name, users }));
const aliases = [...winners.map(r => ({ ...r, table: 'LeagueChampion' })), ...data.CupChampion.map(r => ({ ...r, table: 'CupChampion' })), ...data.NationalCoachElection.map(r => ({ ...r, table: 'NationalCoachElection', championUserId: r.winnerUserId, championUserName: r.winnerUserName }))].filter(r => r.championUserId > 0 && names.get(r.championUserId) !== r.championUserName).map(r => ({ table: r.table, competition: r.leagueId ?? r.cupId, cupId: r.cupId, season: r.season ?? r.edition, userId: r.championUserId, historicalName: r.championUserName, currentName: names.get(r.championUserId) }));
const nonAwards: Row[] = load('server/src/data/cup-final-non-awards.json');
for (const diagnostic of nonAwards) {
  const retained = load('server/src/data/recovered-cup-final-evidence.json').entries.find((entry: Row) => entry.summary.cupId === diagnostic.cupId && entry.summary.season === diagnostic.season && entry.summary.matchId === diagnostic.matchId);
  const events = [retained?.rawMatch.HattrickData.Match.EventList?.Event ?? []].flat();
  check('Unassigned mutual walkover has retained source evidence', events.some((event: Row) => +event.EventTypeID === diagnostic.eventTypeId && +event.SubjectTeamID === diagnostic.subjectTeamId && +event.Minute === diagnostic.minute && +event.MatchPart === diagnostic.matchPart && /mutual walkover/i.test(event.EventText)), diagnostic);
  check('Unassigned mutual walkover never creates an inferred champion', !data.CupChampion.some(row => row.cupId === diagnostic.cupId && row.season === diagnostic.season), diagnostic);
}
const explainedSequenceGaps = gaps.flatMap(gap => gap.label === 'national club cup' ? gap.missing.flatMap((season: number) => nonAwards.filter(row => row.cupId === gap.competition && row.season === season)) : []);
const unexplainedInternalCupGaps = gaps.filter(gap => gap.label === 'national club cup').flatMap(gap => gap.missing.filter((season: number) => !nonAwards.some(row => row.cupId === gap.competition && row.season === season)).map((season: number) => ({ cupId: gap.competition, season })));
check('Domestic cup rolls have no unexplained internal gaps', unexplainedInternalCupGaps.length === 0, unexplainedInternalCupGaps);
const otherUnexpectedGaps = gaps.filter(gap => gap.label !== 'national club cup').flatMap(gap =>
  gap.missing.filter((season: number) => gap.label !== 'league' || season >= gap.first)
    .map((season: number) => ({ label: gap.label, competition: gap.competition, season })));
check('Other competition rolls have no unexplained sequence gaps', otherUnexpectedGaps.length === 0, otherUnexpectedGaps);
const report = { generatedAt: new Date().toISOString(), dbAccess: 'DatabaseSync readOnly=true; SELECT only; no secret table; no network', totalAssertions: Object.values(checks).reduce((n, c) => n + c.checked, 0), failedAssertions: Object.values(checks).reduce((n, c) => n + c.failed, 0), tableCounts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])), coverage, checks, sequenceGaps: gaps, explainedSequenceGaps, unexplainedInternalCupGaps, sourceEvidenceRows: sourceStats, historicalAliases: aliases, duplicateUserNames };
mkdirSync(resolve(root, 'qa/results'), { recursive: true });
writeFileSync(resolve(root, 'qa/results/data-integrity.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ totalAssertions: report.totalAssertions, failedAssertions: report.failedAssertions, checkGroups: Object.keys(checks).length, coverage, failedChecks: Object.fromEntries(Object.entries(checks).filter(([, c]) => c.failed)), sequenceGapGroups: gaps.length, historicalAliasRows: aliases.length, resultFile: 'qa/results/data-integrity.json' }, null, 2));
process.exitCode = report.failedAssertions ? 1 : 0;
