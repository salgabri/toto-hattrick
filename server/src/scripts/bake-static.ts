import { writeFileSync, mkdirSync } from 'node:fs';
import { prisma } from '../db/client.js';

/**
 * Bake the read-only aggregate data into static JSON for a pure-static deploy (Vercel).
 * Two files under web/public/data:
 *   managers.json — every manager with a top-division title + their embedded title cabinet.
 *   leagues.json  — each country's champions (season, club, manager), newest first.
 * The static frontend loads these once and filters client-side; no backend/DB in production.
 */
const OUT = process.env.OUT!;
mkdirSync(OUT, { recursive: true });

// Managers: league titles + attributed cup wins (main/secondary), grouped by championUserId (>0).
const users = await prisma.hattrickUser.findMany({ select: { userId: true, nationality: true } });
const natById = new Map(users.map((u) => [u.userId, u.nationality]));

// Reigning champion = the winner of each competition's most recent recorded season. Computed
// over ALL champions (including unattributed/unknown owners) so a manager's older title isn't
// mis-tagged "current" when a later season was won by someone we can't attribute yet.
const leagueReignSeason = new Map<number, number>();
for (const c of await prisma.leagueChampion.findMany({ where: { complete: true }, select: { leagueId: true, season: true } })) {
  const cur = leagueReignSeason.get(c.leagueId);
  if (cur === undefined || c.season > cur) leagueReignSeason.set(c.leagueId, c.season);
}
const cupReignSeason = new Map<number, number>();
for (const c of await prisma.cupChampion.findMany({ select: { cupId: true, season: true } })) {
  const cur = cupReignSeason.get(c.cupId);
  if (cur === undefined || c.season > cur) cupReignSeason.set(c.cupId, c.season);
}

interface CupItem { country: string; season: number; club: string; cup: string; last: boolean }
interface Mgr {
  userId: number; userName: string; nationality: string; lg: number;
  titles: Array<{ country: string; season: number; club: string; last: boolean }>;
  cupsMain: CupItem[]; cupsSec: CupItem[];
}
const mgr = new Map<number, Mgr>();
const get = (uid: number, name: string | null) => {
  let e = mgr.get(uid);
  if (!e) { e = { userId: uid, userName: name ?? `user ${uid}`, nationality: natById.get(uid) ?? 'Unknown', lg: 0, titles: [], cupsMain: [], cupsSec: [] }; mgr.set(uid, e); }
  return e;
};

for (const c of await prisma.leagueChampion.findMany({
  where: { complete: true, championUserId: { gt: 0 } },
  select: { championUserId: true, championUserName: true, countryName: true, season: true, championTeamName: true, leagueId: true },
})) {
  get(c.championUserId!, c.championUserName).titles.push({
    country: c.countryName, season: c.season, club: c.championTeamName,
    last: leagueReignSeason.get(c.leagueId) === c.season,
  });
}

for (const c of await prisma.cupChampion.findMany({
  where: { championUserId: { gt: 0 } },
  select: { championUserId: true, championUserName: true, countryName: true, season: true, championTeamName: true, cupName: true, isMain: true, cupId: true },
})) {
  const e = get(c.championUserId!, c.championUserName);
  const item = { country: c.countryName, season: c.season, club: c.championTeamName, cup: c.cupName, last: cupReignSeason.get(c.cupId) === c.season };
  (c.isMain ? e.cupsMain : e.cupsSec).push(item);
}

const bySeasonDesc = <T extends { season: number }>(a: T, b: T) => b.season - a.season;
const managers = [...mgr.values()]
  .map((m) => ({
    userId: m.userId,
    userName: m.userName,
    nationality: m.nationality,
    lg: m.titles.length,
    main: m.cupsMain.length,
    sec: m.cupsSec.length,
    lgLast: m.titles.filter((t) => t.last).length,
    mainLast: m.cupsMain.filter((c) => c.last).length,
    secLast: m.cupsSec.filter((c) => c.last).length,
    titles: m.titles.sort(bySeasonDesc),
    cupsMain: m.cupsMain.sort(bySeasonDesc),
    cupsSec: m.cupsSec.sort(bySeasonDesc),
  }))
  .sort((a, b) => b.lg + b.main + b.sec - (a.lg + a.main + a.sec) || b.lg - a.lg);
writeFileSync(`${OUT}/managers.json`, JSON.stringify(managers));

// Leagues: per-country champions (complete), newest first.
const leaguesRows = await prisma.nationalLeague.findMany({ where: { isCountry: true }, select: { leagueId: true, countryName: true } });
const allChamps = await prisma.leagueChampion.findMany({ where: { complete: true }, orderBy: { season: 'desc' }, select: { leagueId: true, season: true, championTeamName: true, championUserName: true } });
const byLeague = new Map<number, Array<{ season: number; club: string; manager: string }>>();
for (const c of allChamps) {
  const a = byLeague.get(c.leagueId) ?? [];
  a.push({ season: c.season, club: c.championTeamName, manager: c.championUserName ?? '—' });
  byLeague.set(c.leagueId, a);
}
const leagues = leaguesRows
  .map((l) => ({ leagueId: l.leagueId, country: l.countryName, champions: byLeague.get(l.leagueId) ?? [] }))
  .filter((l) => l.champions.length > 0)
  .sort((a, b) => a.country.localeCompare(b.country));
writeFileSync(`${OUT}/leagues.json`, JSON.stringify(leagues));

const titleTotal = leagues.reduce((n, l) => n + l.champions.length, 0);
console.log(`baked ${managers.length} managers, ${leagues.length} leagues, ${titleTotal} champion rows -> ${OUT}`);

// Cups: per-country roll of honour for the five national-level cups (one main + four secondary).
// Manager comes from CupChampion.championUserId — set for league+cup doubles now, and filled by
// the ownership-history scrape for the rest.
const cupRows = await prisma.cup.findMany({ orderBy: [{ leagueId: 'asc' }, { cupLevel: 'asc' }, { cupLevelIndex: 'asc' }] });
const cupWins = await prisma.cupChampion.findMany({ orderBy: { season: 'desc' }, select: { cupId: true, season: true, championTeamName: true, championUserName: true } });
const winsByCup = new Map<number, Array<{ season: number; club: string; manager: string }>>();
for (const w of cupWins) {
  const a = winsByCup.get(w.cupId) ?? [];
  a.push({ season: w.season, club: w.championTeamName, manager: w.championUserName ?? '—' });
  winsByCup.set(w.cupId, a);
}

interface CupOut { cupId: number; cupName: string; isMain: boolean; cupLevel: number; cupLevelIndex: number; winners: Array<{ season: number; club: string; manager: string }> }
const cupsByLeague = new Map<number, { leagueId: number; country: string; cups: CupOut[] }>();
for (const c of cupRows) {
  const winners = winsByCup.get(c.cupId) ?? [];
  if (winners.length === 0) continue;
  let e = cupsByLeague.get(c.leagueId);
  if (!e) { e = { leagueId: c.leagueId, country: c.countryName, cups: [] }; cupsByLeague.set(c.leagueId, e); }
  e.cups.push({ cupId: c.cupId, cupName: c.cupName, isMain: c.isMain, cupLevel: c.cupLevel, cupLevelIndex: c.cupLevelIndex, winners });
}
const cups = [...cupsByLeague.values()].sort((a, b) => a.country.localeCompare(b.country));
writeFileSync(`${OUT}/cups.json`, JSON.stringify(cups));
const cupTitleTotal = cups.reduce((n, l) => n + l.cups.reduce((m, c) => m + c.winners.length, 0), 0);
console.log(`baked ${cups.length} countries' cups, ${cupTitleTotal} cup finals -> ${OUT}/cups.json`);

await prisma.$disconnect();
