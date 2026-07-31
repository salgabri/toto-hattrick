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
 * are restored exactly (manager ids are re-derived by inverting managers.json). Internal ids the
 * bake never emitted are placeholders and never appear on the static site:
 *   - LeagueChampion.championTeamId = 0, points/played = 0
 *   - CupChampion.championTeamId = null, finalMatchId/goals = 0, runnerUp = ''
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
interface BakedLeague { leagueId: number; country: string; champions: Array<{ season: number; club: string; manager: string }> }
interface BakedCups { leagueId: number; country: string; cups: Array<{ cupId: number; cupName: string; isMain: boolean; cupLevel: number; cupLevelIndex: number; winners: Array<{ season: number; club: string; manager: string }> }> }
interface BakedManager { userId: number; userName: string; nationality: string; titles: Array<{ country: string; season: number }>; cupsMain: Array<{ country: string; season: number; cup: string }>; cupsSec: Array<{ country: string; season: number; cup: string }>; masters?: Array<{ season: number }>; seasonal?: Array<{ cup: string; season: number }> }
interface BakedSeasonalCup { cupId: number; cupName: string; winners: Array<{ season: number; club: string; manager: string }> }

const seed: SeedLeague[] = JSON.parse(readFileSync('src/data/leagues.json', 'utf8'));
const leagues: BakedLeague[] = JSON.parse(readFileSync(`${DATA}/leagues.json`, 'utf8'));
const cupCountries: BakedCups[] = JSON.parse(readFileSync(`${DATA}/cups.json`, 'utf8'));
const managers: BakedManager[] = JSON.parse(readFileSync(`${DATA}/managers.json`, 'utf8'));

const seedById = new Map(seed.map((s) => [s.leagueId, s]));

// Invert managers.json → owner keyed by (country, season) for leagues and (country, season, cup)
// for cups. This restores championUserId/Name exactly, since the bake produced managers.json from
// those same columns.
const leagueOwner = new Map<string, { userId: number; userName: string }>();
const cupOwner = new Map<string, { userId: number; userName: string }>();
for (const m of managers) {
  for (const t of m.titles) leagueOwner.set(`${t.country}${SEP}${t.season}`, { userId: m.userId, userName: m.userName });
  for (const c of [...m.cupsMain, ...m.cupsSec]) cupOwner.set(`${c.country}${SEP}${c.season}${SEP}${c.cup}`, { userId: m.userId, userName: m.userName });
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
    champRows.push({
      leagueId: lg.leagueId,
      season: c.season,
      topSeriesId: s.topSeriesId,
      countryName: lg.country,
      championTeamId: 0, // placeholder — the bake never emitted team ids
      championTeamName: c.club,
      championUserId: owner?.userId ?? null,
      championUserName: owner?.userName ?? (c.manager !== MANAGER_NONE ? c.manager : null),
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
      finalRows.push({
        cupId: cup.cupId, season: w.season, leagueId: country.leagueId, countryName: country.country,
        cupName: cup.cupName, isMain: cup.isMain, finalMatchId: 0,
        championTeamId: null, championTeamName: w.club, runnerUpTeamName: '',
        homeGoals: 0, awayGoals: 0, penalties: false,
        championUserId: owner?.userId ?? null,
        championUserName: owner?.userName ?? (w.manager !== MANAGER_NONE ? w.manager : null),
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
//    season (one global cup), each Seasonal cup by (cupName, tournament season). teamId/finalMatchId
//    stay placeholders; the forward refresh (refresh:latest → syncMasters self-heal) re-fetches the
//    real finals and fills any still-unattributed edition by current owner.
const globalSeason = seed.reduce((mx, s) => Math.max(mx, s.currentSeason ?? 0), 0) || undefined;
const globalCupRows: Prisma.CupCreateManyInput[] = [];
const globalFinalRows: Prisma.CupChampionCreateManyInput[] = [];

const mastersOwner = new Map<number, { userId: number; userName: string }>();
for (const m of managers) for (const c of m.masters ?? []) mastersOwner.set(c.season, { userId: m.userId, userName: m.userName });
const mastersWinners: Array<{ season: number; club: string; manager: string }> = existsSync(`${DATA}/masters.json`)
  ? JSON.parse(readFileSync(`${DATA}/masters.json`, 'utf8'))
  : [];
if (mastersWinners.length) {
  globalCupRows.push({ cupId: MASTERS_CUP_ID, leagueId: 0, countryName: 'Hattrick Masters', cupName: 'Hattrick Masters', cupLevel: 1, cupLevelIndex: 1, isMain: false, currentSeason: globalSeason });
  for (const w of mastersWinners) {
    const owner = mastersOwner.get(w.season);
    globalFinalRows.push({
      cupId: MASTERS_CUP_ID, season: w.season, leagueId: 0, countryName: 'Hattrick Masters',
      cupName: 'Hattrick Masters', isMain: false, finalMatchId: 0,
      championTeamId: null, championTeamName: w.club, runnerUpTeamName: '', homeGoals: 0, awayGoals: 0, penalties: false,
      championUserId: owner?.userId ?? null,
      championUserName: owner?.userName ?? (w.manager !== MANAGER_NONE ? w.manager : null),
    });
  }
}

const seasonalOwner = new Map<string, { userId: number; userName: string }>();
for (const m of managers) for (const c of m.seasonal ?? []) seasonalOwner.set(`${c.cup}${SEP}${c.season}`, { userId: m.userId, userName: m.userName });
const seasonalCups: BakedSeasonalCup[] = existsSync(`${DATA}/seasonal.json`)
  ? JSON.parse(readFileSync(`${DATA}/seasonal.json`, 'utf8'))
  : [];
for (const sc of seasonalCups) {
  const latest = sc.winners.reduce((mx, w) => Math.max(mx, w.season), 0) || undefined;
  globalCupRows.push({ cupId: sc.cupId, leagueId: 0, countryName: sc.cupName, cupName: sc.cupName, cupLevel: 1, cupLevelIndex: 1, isMain: false, currentSeason: latest });
  for (const w of sc.winners) {
    const owner = seasonalOwner.get(`${sc.cupName}${SEP}${w.season}`);
    globalFinalRows.push({
      cupId: sc.cupId, season: w.season, leagueId: 0, countryName: sc.cupName,
      cupName: sc.cupName, isMain: false, finalMatchId: 0,
      championTeamId: null, championTeamName: w.club, runnerUpTeamName: '', homeGoals: 0, awayGoals: 0, penalties: false,
      championUserId: owner?.userId ?? null,
      championUserName: owner?.userName ?? (w.manager !== MANAGER_NONE ? w.manager : null),
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
