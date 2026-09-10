import '../config/env.js';
import { mkdir, open, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { prisma } from '../db/client.js';

// Read-only DB audit. Generated files are exclusively created; no attribution is applied.
type NationIds = { leagueId: number; nationalTeamId: number; u20TeamId: number };
type Tenure = { teamId: number; date: string; userId: number; name: string };
const json = async (path: string) => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const stamp = (value: string) => {
  const parts = value.trim().split(' ')[0]?.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (!parts) return NaN;
  const date = Date.UTC(Number(parts[3]), Number(parts[2]) - 1, Number(parts[1]));
  const parsed = new Date(date);
  return parsed.getUTCDate() === Number(parts[1]) && parsed.getUTCMonth() === Number(parts[2]) - 1 ? date : NaN;
};
const names = (value: string) => value ? value.split(', ') : [];
const ids = (value: string) => value.split(',').map((part) => Number(part) || 0);

try {
  const nations: Record<string, NationIds> = await json('src/data/national-team-ids.json');
  const tenures: Tenure[] = await json('src/sync/worldcup-coaches.json');
  const [world, regional, elections] = await Promise.all([
    prisma.worldCupChampion.findMany(), prisma.nationalCupChampion.findMany(), prisma.nationalCoachElection.findMany(),
  ]);
  const byTeam = new Map<number, Tenure[]>();
  for (const tenure of tenures) {
    if (!Number.isFinite(stamp(tenure.date))) continue;
    const list = byTeam.get(tenure.teamId) ?? [];
    list.push(tenure); byTeam.set(tenure.teamId, list);
  }
  for (const list of byTeam.values()) list.sort((a, b) => stamp(a.date) - stamp(b.date));
  const teamLeague = new Map(Object.values(nations).flatMap((nation) => [[nation.nationalTeamId, nation.leagueId], [nation.u20TeamId, nation.leagueId]] as [number, number][]));
  const slots: any[] = [];
  const add = (table: string, key: string, bracket: boolean, date: string, slot: string, nation: string,
    userId: number | null, explicitTeam?: number | null, explicitLeague?: number | null) => {
    if (!nation || (userId ?? 0) > 0) return;
    const known = nations[nation];
    const teamId = explicitTeam || (bracket ? known?.u20TeamId : known?.nationalTeamId) || null;
    const leagueId = explicitLeague || known?.leagueId || (teamId ? teamLeague.get(teamId) : null) || null;
    const before = teamId ? (byTeam.get(teamId) ?? []).filter((tenure) => stamp(tenure.date) <= stamp(date)) : [];
    const latestDate = before.at(-1)?.date;
    const latest = latestDate ? before.filter((tenure) => stamp(tenure.date) === stamp(latestDate)) : [];
    const distinct = new Set(latest.map((tenure) => tenure.userId));
    const cached = distinct.size === 1 ? latest[0] : undefined;
    slots.push({ table, key, slot, isYouth: bracket, nation, finalDate: date, teamId, leagueId,
      cachedStatus: !teamId ? 'missingTeamId' : !Number.isFinite(stamp(date)) ? 'invalidFinalDate'
        : distinct.size > 1 ? 'conflictingCachedTenures' : !cached ? 'noCachedTenureBeforeFinal'
        : cached.userId > 0 ? 'positiveCachedTenureNeedsVerification' : 'cachedRetiredUser',
      cachedTenure: cached ?? null,
      ...(teamId ? { historyURL: `https://www.hattrick.org/en/Club/NationalTeam/NTFormerCoaches.aspx?teamId=${teamId}` } : {}),
    });
  };
  let ongoing = 0;
  for (const row of world) {
    if (!row.champion || !row.finishedDate) { ongoing++; continue; }
    const key = `worldCupChampion:${row.isYouth ? 'youth' : 'senior'}:${row.edition}`;
    add('worldCupChampion', key, row.isYouth, row.finishedDate, 'champion', row.champion, row.championUserId);
    add('worldCupChampion', key, row.isYouth, row.finishedDate, 'runnerUp', row.runnerUp ?? '', row.runnerUpUserId);
    names(row.thirdFourth).forEach((nation, index) => add('worldCupChampion', key, row.isYouth, row.finishedDate!,
      `thirdFourth:${index}`, nation, ids(row.thirdFourthUserIds)[index] ?? 0));
  }
  for (const row of regional) {
    if (!row.champion || !row.finalDate || (row.status && row.status !== 'Finished')) { ongoing++; continue; }
    const key = `nationalCupChampion:${row.cupId}:${row.season}`;
    add('nationalCupChampion', key, row.isYouth, row.finalDate, 'champion', row.champion, row.championUserId, row.championTeamId, row.championLeagueId);
    add('nationalCupChampion', key, row.isYouth, row.finalDate, 'runnerUp', row.runnerUp ?? '', row.runnerUpUserId, row.runnerUpTeamId, row.runnerUpLeagueId);
    names(row.thirdFourth).forEach((nation, index) => add('nationalCupChampion', key, row.isYouth, row.finalDate!, `thirdFourth:${index}`,
      nation, ids(row.thirdFourthUserIds)[index] ?? 0, ids(row.thirdFourthTeamIds)[index], ids(row.thirdFourthLeagueIds)[index]));
  }
  const cachedBakeCandidates: any[] = [];
  for (const path of ['../.backup/winner-recovery-20260910/data/worldcup.json', '../.backup/data.20260804-004804/worldcup.json',
    '../.backup/data.20260804-012511/worldcup.json', '../.backup/data.20260805-000803/worldcup.json',
    '../.claude/worktrees/hattrick-masters-missing-winners-486748/web/public/data/worldcup.json']) {
    const bake = await json(path);
    const check = (key: string, row: any) => {
      for (const missing of slots.filter((slot) => slot.key === key && slot.finalDate === row.finished)) {
        const index = missing.slot.startsWith('thirdFourth:') ? Number(missing.slot.split(':')[1]) : -1;
        const nation = missing.slot === 'champion' ? row.champion : missing.slot === 'runnerUp' ? row.runnerUp : row.thirdFourth?.[index];
        const userId = missing.slot === 'champion' ? row.coachUserId : missing.slot === 'runnerUp' ? row.runnerUpCoachUserId : row.thirdFourthCoaches?.[index]?.userId;
        if (nation === missing.nation && userId > 0) cachedBakeCandidates.push({ key, slot: missing.slot, nation, userId, sourceFile: path });
      }
    };
    for (const bracket of ['senior', 'youth']) for (const row of bake[bracket] ?? []) check(`worldCupChampion:${bracket}:${row.edition}`, row);
    for (const cup of bake.regional ?? []) for (const row of cup.seasons) check(`nationalCupChampion:${cup.cupId}:${row.season}`, row);
  }
  const rawElections = (await readFile('../.scrape/elections.jsonl', 'utf8')).trim().split(/\r?\n/).map((line) => JSON.parse(line));
  const electionHints: any[] = [];
  for (const stored of elections.filter((row) => !row.winnerUserId)) {
    const matches = rawElections.filter((row) => row.leagueId === stored.leagueId && Boolean(row.isYouth) === stored.isYouth
      && row.edition === stored.edition && row.host === stored.host && row.votes === stored.votes && row.winnerUserId > 0);
    const uniqueIds = new Set(matches.map((row) => row.winnerUserId));
    const sameStored = elections.filter((row) => row.leagueId === stored.leagueId && row.isYouth === stored.isYouth
      && row.edition === stored.edition && row.host === stored.host && row.votes === stored.votes);
    if (matches.length) electionHints.push({ storedId: stored.id, leagueId: stored.leagueId, isYouth: stored.isYouth,
      edition: stored.edition, host: stored.host, votes: stored.votes, candidate: matches[0],
      ambiguous: uniqueIds.size !== 1 || sameStored.length !== 1,
      sourceFile: '.scrape/elections.jsonl', needsObservedWinnerLink: true,
      historyURL: `https://www.hattrick.org/en/World/Elections/History.aspx?LeagueID=${stored.leagueId}` });
  }
  const targets = [...new Set(slots.flatMap((slot) => slot.teamId ? [slot.teamId as number] : []))].map((teamId) => {
    const missing = slots.filter((slot) => slot.teamId === teamId);
    return { teamId, leagueId: missing[0].leagueId, nation: missing[0].nation, isYouth: missing[0].isYouth,
      historyURL: missing[0].historyURL, championSlots: missing.filter((slot) => slot.slot === 'champion').length,
      missingSlots: missing.length, slots: missing };
  }).sort((a, b) => b.championSlots - a.championSlots || b.missingSlots - a.missingSlots || a.teamId - b.teamId);
  const audit = { generatedAt: new Date().toISOString(), readOnly: true,
    counts: { missingSlots: slots.length, champions: slots.filter((slot) => slot.slot === 'champion').length,
      medals: slots.filter((slot) => slot.slot !== 'champion').length, teams: targets.length, ongoingSkipped: ongoing,
      positiveCachedTenures: slots.filter((slot) => slot.cachedStatus === 'positiveCachedTenureNeedsVerification').length,
      exactCachedBakeCandidates: cachedBakeCandidates.length, electionHints: electionHints.length },
    caveat: 'Cached tenure candidates require source verification; election results are not coaching-tenure proof.',
    slots, cachedBakeCandidates, electionHints };
  for (const [name, data] of [['audit.json', audit], ['browser-targets.json', targets]] as const) {
    const path = resolve('../.scrape/national-winner-recovery', name);
    await mkdir(dirname(path), { recursive: true });
    const file = await open(path, 'wx');
    try { await file.writeFile(`${JSON.stringify(data, null, 2)}\n`); } finally { await file.close(); }
  }
  console.log(JSON.stringify(audit.counts));
} finally { await prisma.$disconnect(); }
