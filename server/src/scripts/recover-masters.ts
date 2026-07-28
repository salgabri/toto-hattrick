import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { chppGet } from '../chpp/client.js';
import { seedMasters, MASTERS_CUP_ID } from '../sync/masters.js';
import { resolveTeamOwner, UNKNOWN } from '../sync/enrichManagers.js';
import type { TokenPair } from '../chpp/auth.js';

/**
 * Recover the 11 Hattrick Masters editions whose cupmatches call errors server-side (CHPP's
 * penalty-final serialization bug). Final match ids + champions were scraped from the wiki UI
 * (wiki.hattrick.org), which the API blocks but a browser can read. The consolidated year pages
 * carry copy-paste errors, so NOTHING is trusted on its face — each is resolved in priority order:
 *   1. final match id  → matchdetails must be MatchType 7 / context 183 AND winner == wiki champion
 *      (matchdetails folds the shootout into the score, so the winner is decided, not level).
 *   2. champion is a known league champion (unique name → resolved teamId).
 *   3. a known manager login (the wiki names EL BONCHE's manager; eGomez already owns it in our data).
 * Then attribute the current owner via teamdetails, exactly like every other cup. Idempotent.
 */
const access: TokenPair = JSON.parse(readFileSync('.oauth-access.json', 'utf8'));
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

interface Cand { season: number; champion: string; finalId: number | null; managerLogin?: string }
const CANDIDATES: Cand[] = [
  { season: 30, champion: 'Alberto Garcia', finalId: 96146622 },
  { season: 35, champion: 'Zeta', finalId: 172452151 },
  { season: 36, champion: 'Super_Stars', finalId: 188219794 },
  { season: 38, champion: 'Hackers United', finalId: 220199706 },
  { season: 40, champion: 'Craiova Champions', finalId: 252082619 },
  { season: 49, champion: 'Big Battle Axe', finalId: 393747626 },
  { season: 50, champion: 'Mishima Zaibatsu', finalId: 408971049 },
  { season: 62, champion: 'Be Champions FC', finalId: 582927099 },
  { season: 63, champion: 'Ancient Wolves', finalId: 596898644 },
  { season: 65, champion: 'EL BONCHE', finalId: null, managerLogin: 'eGomez' }, // wiki final link is a copy-paste error
  { season: 81, champion: 'DarthFenuz', finalId: 695918444 },
];

await seedMasters(95);
let stored = 0, unresolved = 0;

for (const c of CANDIDATES) {
  let teamId: number | null = null, teamName = c.champion, finalMatchId = 0, hg = 0, ag = 0, runnerUp = '', src = '';

  if (c.finalId) {
    try {
      const m = ((await chppGet(access, { file: 'matchdetails', version: '3.0', matchID: c.finalId })) as any).HattrickData?.Match;
      const type = Number(m?.MatchType), ctx = Number(m?.MatchContextId);
      const h = Number(m.HomeTeam.HomeGoals), a = Number(m.AwayTeam.AwayGoals), homeWon = h > a;
      const winName = homeWon ? m.HomeTeam.HomeTeamName : m.AwayTeam.AwayTeamName;
      if (type === 7 && ctx === 183 && norm(winName) === norm(c.champion)) {
        teamId = Number(homeWon ? m.HomeTeam.HomeTeamID : m.AwayTeam.AwayTeamID);
        teamName = winName; finalMatchId = c.finalId; hg = h; ag = a;
        runnerUp = homeWon ? m.AwayTeam.AwayTeamName : m.HomeTeam.HomeTeamName; src = 'final match';
      } else {
        console.log(`  S${c.season}: id ${c.finalId} REJECTED — type=${type} ctx=${ctx} winner="${winName}" ≠ "${c.champion}"`);
      }
    } catch (e) { console.log(`  S${c.season}: matchdetails ${c.finalId} ERROR ${(e as Error).message.slice(0, 50)}`); }
  }

  let mgrUserId: number | null = null, mgrUserName: string | null = null;
  if (teamId == null) {
    const lc = await prisma.leagueChampion.findMany({ where: { championTeamName: c.champion, championTeamId: { gt: 0 } }, select: { championTeamId: true }, distinct: ['championTeamId'] });
    const only = lc.length === 1 ? lc[0] : undefined;
    if (only) { teamId = only.championTeamId; src = 'league-name'; }
  }
  if (teamId == null && c.managerLogin) {
    const u = await prisma.hattrickUser.findFirst({ where: { loginName: c.managerLogin }, select: { userId: true, loginName: true } });
    if (u) { mgrUserId = u.userId; mgrUserName = u.loginName; src = 'known manager'; }
  }
  if (teamId == null && mgrUserId == null) { console.log(`  S${c.season}: UNRESOLVED "${c.champion}"`); unresolved++; continue; }

  await prisma.cupChampion.upsert({
    where: { cupId_season: { cupId: MASTERS_CUP_ID, season: c.season } },
    update: { finalMatchId, championTeamId: teamId, championTeamName: teamName, runnerUpTeamName: runnerUp, homeGoals: hg, awayGoals: ag },
    create: { cupId: MASTERS_CUP_ID, season: c.season, leagueId: 0, countryName: 'Hattrick Masters', cupName: 'Hattrick Masters', isMain: false, finalMatchId, championTeamId: teamId, championTeamName: teamName, runnerUpTeamName: runnerUp, homeGoals: hg, awayGoals: ag },
  });

  let label: string;
  if (teamId != null) {
    const owner = await resolveTeamOwner(access, teamId);
    if (owner) {
      await prisma.hattrickUser.upsert({ where: { userId: owner.userId }, update: { loginName: owner.loginName, isBot: owner.isBot }, create: { userId: owner.userId, loginName: owner.loginName, isBot: owner.isBot } });
      await prisma.cupChampion.update({ where: { cupId_season: { cupId: MASTERS_CUP_ID, season: c.season } }, data: { championUserId: owner.userId, championUserName: owner.loginName } });
      label = owner.loginName;
    } else {
      await prisma.cupChampion.update({ where: { cupId_season: { cupId: MASTERS_CUP_ID, season: c.season } }, data: { championUserId: UNKNOWN } });
      label = 'no live owner';
    }
  } else {
    await prisma.cupChampion.update({ where: { cupId_season: { cupId: MASTERS_CUP_ID, season: c.season } }, data: { championUserId: mgrUserId!, championUserName: mgrUserName } });
    label = `${mgrUserName} (known owner)`;
  }
  stored++;
  console.log(`  S${c.season}: ${teamName} (${teamId ? 'team ' + teamId : 'no teamId'}, via ${src}) -> ${label}`);
}

console.log(`\nrecovered ${stored}/${CANDIDATES.length}; unresolved ${unresolved}`);
console.log(`Masters editions in DB: ${await prisma.cupChampion.count({ where: { cupId: MASTERS_CUP_ID } })}/67`);
await prisma.$disconnect();
