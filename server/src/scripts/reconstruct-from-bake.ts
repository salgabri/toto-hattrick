import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { MASTERS_CUP_ID } from '../sync/masters.js';

/**
 * Rebuild the local database from the committed static bake (web/public/data/*.json) plus the
 * league seed (src/data/leagues.json). The DB is only ever an intermediate cache used to *produce*
 * those JSON files, so when dev.db is lost we can reconstruct it from them with ZERO CHPP calls and
 * no credentials — then top up new seasons with `refresh:latest`.
 *
 * Fidelity: country/league/cup names, seasons, champion + manager attribution, and nationalities
 * are restored exactly. Identity fields emitted by modern bakes are preserved; older bakes can
 * recover manager ids (and any available team ids) by inverting managers.json. Facts absent from
 * both files remain placeholders:
 *   - LeagueChampion.championTeamId = 0 only when unknown, points/played = 0
 *   - CupChampion.championTeamId = null only when unknown, finalMatchId/goals = 0, runnerUp = ''
 * The forward refresh then writes real data for genuinely new seasons.
 *
 * Idempotent: clears the reconstructed tables first, so it is safe to re-run.
 *
 *   npm run reconstruct -w server        (after: npm run db:generate + prisma migrate deploy)
 */

const DATA = process.env.DATA ?? '../web/public/data';
const MANAGER_NONE = '—'; // bake sentinel for an unattributed winner
const SEP = String.fromCharCode(31); // unit separator: never occurs in a country/cup name or season

interface SeedLeague { leagueId: number; countryName: string; topSeriesId: number; currentSeason: number | null; isCountry: boolean }
interface BakedWinner { season: number; club: string; manager: string; teamId?: number; userId?: number; leagueId?: number }
interface BakedLeague { leagueId: number; country: string; champions: BakedWinner[] }
interface BakedCups { leagueId: number; country: string; cups: Array<{ cupId: number; cupName: string; isMain: boolean; cupLevel: number; cupLevelIndex: number; winners: BakedWinner[] }> }
interface CabinetTitle { country: string; season: number; teamId?: number; leagueId?: number }
interface CabinetCup extends CabinetTitle { cup: string }
interface BakedManager { userId: number; userName: string; nationality: string; titles: CabinetTitle[]; cupsMain: CabinetCup[]; cupsSec: CabinetCup[]; masters?: CabinetCup[]; seasonal?: CabinetCup[] }
interface BakedSeasonalCup { cupId: number; cupName: string; winners: BakedWinner[] }
interface CabinetOwner { userId: number; userName: string; teamId?: number; leagueId?: number }

const positiveId = (id: number | undefined) => Number.isSafeInteger(id) && id! > 0 ? id : undefined;

const seed: SeedLeague[] = JSON.parse(readFileSync('src/data/leagues.json', 'utf8'));
const leagues: BakedLeague[] = JSON.parse(readFileSync(`${DATA}/leagues.json`, 'utf8'));
const cupCountries: BakedCups[] = JSON.parse(readFileSync(`${DATA}/cups.json`, 'utf8'));
const managers: BakedManager[] = JSON.parse(readFileSync(`${DATA}/managers.json`, 'utf8'));

const seedById = new Map(seed.map((s) => [s.leagueId, s]));
const managerById = new Map(managers.map((m) => [m.userId, m]));

// A roll's explicit identity is authoritative; cabinet inversion is a compatibility fallback for
// older bakes. Never pair an explicit userId with another manager's name or borrow that manager's
// club identity when the two sources disagree.
function restoreIdentity(winner: BakedWinner, owner: CabinetOwner | undefined) {
  const directUserId = positiveId(winner.userId);
  const compatibleOwner = !directUserId || directUserId === owner?.userId ? owner : undefined;
  const championUserId = directUserId ?? compatibleOwner?.userId ?? null;
  return {
    championTeamId: positiveId(winner.teamId) ?? positiveId(compatibleOwner?.teamId) ?? null,
    championUserId,
    championUserName: directUserId
      ? (winner.manager !== MANAGER_NONE ? winner.manager : managerById.get(directUserId)?.userName ?? compatibleOwner?.userName ?? null)
      : compatibleOwner?.userName ?? (winner.manager !== MANAGER_NONE ? winner.manager : null),
    championLeagueId: positiveId(winner.leagueId) ?? positiveId(compatibleOwner?.leagueId) ?? null,
  };
}

// Invert managers.json → owner keyed by (country, season) for leagues and (country, season, cup)
// for cups. This restores championUserId/Name exactly, since the bake produced managers.json from
// those same columns.
const leagueOwner = new Map<string, CabinetOwner>();
const cupOwner = new Map<string, CabinetOwner>();
for (const m of managers) {
  for (const t of m.titles) leagueOwner.set(`${t.country}${SEP}${t.season}`, { userId: m.userId, userName: m.userName, teamId: t.teamId, leagueId: t.leagueId });
  for (const c of [...m.cupsMain, ...m.cupsSec]) cupOwner.set(`${c.country}${SEP}${c.season}${SEP}${c.cup}`, { userId: m.userId, userName: m.userName, teamId: c.teamId, leagueId: c.leagueId });
}

async function createInChunks<T>(rows: T[], run: (batch: T[]) => Promise<unknown>, size = 50): Promise<void> {
  for (let i = 0; i < rows.length; i += size) await run(rows.slice(i, i + size));
}

console.log(`reconstruct @ ${new Date().toISOString()} from ${DATA}`);

// Reset the reconstructed tables (children first) so re-runs are clean. NationalLeague is upserted.
await prisma.cupChampion.deleteMany();
await prisma.leagueChampion.deleteMany();
await prisma.cup.deleteMany();
await prisma.hattrickUser.deleteMany();

// 1) NationalLeague (FK target for champions + cups).
for (const s of seed) {
  await prisma.nationalLeague.upsert({
    where: { leagueId: s.leagueId },
    update: { countryName: s.countryName, topSeriesId: s.topSeriesId, currentSeason: s.currentSeason ?? undefined, isCountry: s.isCountry },
    create: { leagueId: s.leagueId, countryName: s.countryName, topSeriesId: s.topSeriesId, currentSeason: s.currentSeason ?? undefined, isCountry: s.isCountry },
  });
}
console.log(`leagues seeded: ${seed.length}`);

// 2) HattrickUser (managers + nationalities).
const userRows: Prisma.HattrickUserCreateManyInput[] = managers.map((m) => ({
  userId: m.userId, loginName: m.userName, nationality: m.nationality ?? 'Unknown', isBot: false,
}));
await createInChunks(userRows, (b) => prisma.hattrickUser.createMany({ data: b }));
console.log(`managers restored: ${userRows.length}`);

// 3) LeagueChampion.
const champRows: Prisma.LeagueChampionCreateManyInput[] = [];
let skippedLeague = 0;
for (const lg of leagues) {
  const s = seedById.get(lg.leagueId);
  if (!s) { skippedLeague += lg.champions.length; continue; } // no seed → no FK target
  for (const c of lg.champions) {
    const owner = leagueOwner.get(`${lg.country}${SEP}${c.season}`);
    const identity = restoreIdentity(c, owner);
    champRows.push({
      leagueId: lg.leagueId,
      season: c.season,
      topSeriesId: s.topSeriesId,
      countryName: lg.country,
      championTeamId: identity.championTeamId ?? 0,
      championTeamName: c.club,
      championUserId: identity.championUserId,
      championUserName: identity.championUserName,
      played: 0,
      points: 0,
      complete: true,
    });
  }
}
await createInChunks(champRows, (b) => prisma.leagueChampion.createMany({ data: b }));
console.log(`league champions restored: ${champRows.length}${skippedLeague ? ` (skipped ${skippedLeague} without a seeded league)` : ''}`);

// 4) Cup + CupChampion.
const cupRows: Prisma.CupCreateManyInput[] = [];
const finalRows: Prisma.CupChampionCreateManyInput[] = [];
let skippedCups = 0;
for (const country of cupCountries) {
  const s = seedById.get(country.leagueId);
  if (!s) { skippedCups += country.cups.length; continue; } // no seed → no FK target
  for (const cup of country.cups) {
    cupRows.push({
      cupId: cup.cupId, leagueId: country.leagueId, countryName: country.country,
      cupName: cup.cupName, cupLevel: cup.cupLevel, cupLevelIndex: cup.cupLevelIndex,
      isMain: cup.isMain, currentSeason: s.currentSeason ?? undefined,
    });
    for (const w of cup.winners) {
      const owner = cupOwner.get(`${country.country}${SEP}${w.season}${SEP}${cup.cupName}`);
      const identity = restoreIdentity(w, owner);
      finalRows.push({
        cupId: cup.cupId, season: w.season, leagueId: country.leagueId, countryName: country.country,
        cupName: cup.cupName, isMain: cup.isMain, finalMatchId: 0,
        championTeamId: identity.championTeamId, championTeamName: w.club, runnerUpTeamName: '',
        homeGoals: 0, awayGoals: 0, penalties: false,
        championUserId: identity.championUserId,
        championUserName: identity.championUserName,
      });
    }
  }
}
await createInChunks(cupRows, (b) => prisma.cup.createMany({ data: b }));
await createInChunks(finalRows, (b) => prisma.cupChampion.createMany({ data: b }));
console.log(`cups restored: ${cupRows.length}; cup finals restored: ${finalRows.length}${skippedCups ? ` (skipped ${skippedCups} cups without a seeded league)` : ''}`);

// 5) Global cups the national bake writes to their OWN files (leagueId-0 sentinel, routed to their
//    own categories by cupId): the Hattrick Masters (masters.json) and the Seasonal Cups
//    (seasonal.json). Without this they'd be silently dropped on every rebuild — the whole category
//    gone. Attribution is inverted from managers.json exactly like the national cups: Masters by
//    season (one global cup), each Seasonal cup by (cupName, tournament season). Preserve the winning
//    club's leagueId too: for these global competitions that field is the club country, not 0.
//    finalMatchId remains a placeholder because it is not present in the bake.
const globalSeason = seed.reduce((mx, s) => Math.max(mx, s.currentSeason ?? 0), 0) || undefined;
const globalCupRows: Prisma.CupCreateManyInput[] = [];
const globalFinalRows: Prisma.CupChampionCreateManyInput[] = [];

const mastersOwner = new Map<number, CabinetOwner>();
for (const m of managers) for (const c of m.masters ?? []) mastersOwner.set(c.season, { userId: m.userId, userName: m.userName, teamId: c.teamId, leagueId: c.leagueId });
const mastersWinners: BakedWinner[] = existsSync(`${DATA}/masters.json`)
  ? JSON.parse(readFileSync(`${DATA}/masters.json`, 'utf8'))
  : [];
if (mastersWinners.length) {
  globalCupRows.push({ cupId: MASTERS_CUP_ID, leagueId: 0, countryName: 'Hattrick Masters', cupName: 'Hattrick Masters', cupLevel: 1, cupLevelIndex: 1, isMain: false, currentSeason: globalSeason });
  for (const w of mastersWinners) {
    const owner = mastersOwner.get(w.season);
    const identity = restoreIdentity(w, owner);
    globalFinalRows.push({
      cupId: MASTERS_CUP_ID, season: w.season, leagueId: 0, countryName: 'Hattrick Masters',
      cupName: 'Hattrick Masters', isMain: false, finalMatchId: 0,
      ...identity,
      championTeamName: w.club, runnerUpTeamName: '', homeGoals: 0, awayGoals: 0, penalties: false,
    });
  }
}

const seasonalOwner = new Map<string, CabinetOwner>();
for (const m of managers) for (const c of m.seasonal ?? []) seasonalOwner.set(`${c.cup}${SEP}${c.season}`, { userId: m.userId, userName: m.userName, teamId: c.teamId, leagueId: c.leagueId });
const seasonalCups: BakedSeasonalCup[] = existsSync(`${DATA}/seasonal.json`)
  ? JSON.parse(readFileSync(`${DATA}/seasonal.json`, 'utf8'))
  : [];
for (const sc of seasonalCups) {
  const latest = sc.winners.reduce((mx, w) => Math.max(mx, w.season), 0) || undefined;
  globalCupRows.push({ cupId: sc.cupId, leagueId: 0, countryName: sc.cupName, cupName: sc.cupName, cupLevel: 1, cupLevelIndex: 1, isMain: false, currentSeason: latest });
  for (const w of sc.winners) {
    const owner = seasonalOwner.get(`${sc.cupName}${SEP}${w.season}`);
    const identity = restoreIdentity(w, owner);
    globalFinalRows.push({
      cupId: sc.cupId, season: w.season, leagueId: 0, countryName: sc.cupName,
      cupName: sc.cupName, isMain: false, finalMatchId: 0,
      ...identity,
      championTeamName: w.club, runnerUpTeamName: '', homeGoals: 0, awayGoals: 0, penalties: false,
    });
  }
}

await createInChunks(globalCupRows, (b) => prisma.cup.createMany({ data: b }));
await createInChunks(globalFinalRows, (b) => prisma.cupChampion.createMany({ data: b }));
console.log(`global cups restored: ${globalCupRows.length} cups, ${globalFinalRows.length} editions (Masters ${mastersWinners.length}, Seasonal ${seasonalCups.reduce((n, c) => n + c.winners.length, 0)})`);

const [nl, hu, lc, cp, cc] = await Promise.all([
  prisma.nationalLeague.count(), prisma.hattrickUser.count(),
  prisma.leagueChampion.count(), prisma.cup.count(), prisma.cupChampion.count(),
]);
console.log(`DB now: ${nl} leagues, ${hu} users, ${lc} league champions, ${cp} cups, ${cc} cup finals`);
console.log(`done @ ${new Date().toISOString()}`);
await prisma.$disconnect();
