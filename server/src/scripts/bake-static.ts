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

// Managers: complete titles grouped by championUserId (>0), with nationality attached.
const champs = await prisma.leagueChampion.findMany({
  where: { complete: true, championUserId: { gt: 0 } },
  select: { championUserId: true, championUserName: true, countryName: true, season: true, championTeamName: true },
});
const users = await prisma.hattrickUser.findMany({ select: { userId: true, nationality: true } });
const natById = new Map(users.map((u) => [u.userId, u.nationality]));

interface Mgr { userId: number; userName: string; nationality: string; lg: number; titles: Array<{ country: string; season: number; club: string }> }
const mgr = new Map<number, Mgr>();
for (const c of champs) {
  const uid = c.championUserId!;
  let e = mgr.get(uid);
  if (!e) { e = { userId: uid, userName: c.championUserName ?? `user ${uid}`, nationality: natById.get(uid) ?? 'Unknown', lg: 0, titles: [] }; mgr.set(uid, e); }
  e.titles.push({ country: c.countryName, season: c.season, club: c.championTeamName });
}
const managers = [...mgr.values()].map((m) => ({ ...m, lg: m.titles.length, titles: m.titles.sort((a, b) => b.season - a.season) })).sort((a, b) => b.lg - a.lg);
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
// Manager is only known for "doubles" — a team that also won its league that same season, which
// carries a resolved championUserName. Cup-specific ownership scraping is a later pass.
const doubleMgr = new Map<string, string>(); // `${teamId}:${season}` -> manager name
for (const c of await prisma.leagueChampion.findMany({
  where: { championUserId: { gt: 0 } },
  select: { championTeamId: true, season: true, championUserName: true },
})) {
  doubleMgr.set(`${c.championTeamId}:${c.season}`, c.championUserName ?? '—');
}

const cupRows = await prisma.cup.findMany({ orderBy: [{ leagueId: 'asc' }, { cupLevel: 'asc' }, { cupLevelIndex: 'asc' }] });
const cupWins = await prisma.cupChampion.findMany({ orderBy: { season: 'desc' }, select: { cupId: true, season: true, championTeamName: true, championTeamId: true } });
const winsByCup = new Map<number, Array<{ season: number; club: string; manager: string }>>();
for (const w of cupWins) {
  const a = winsByCup.get(w.cupId) ?? [];
  a.push({ season: w.season, club: w.championTeamName, manager: w.championTeamId != null ? (doubleMgr.get(`${w.championTeamId}:${w.season}`) ?? '—') : '—' });
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
