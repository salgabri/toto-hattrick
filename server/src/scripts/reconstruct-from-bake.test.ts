import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

// Run the complete reconstruction script with in-memory files and a recording Prisma substitute.
// This exercises the legacy/modern wire formats without opening or clearing any real database.
async function reconstructFixture(directIds: boolean) {
  const winner = (season: number, teamId: number) => ({
    season, club: `Club ${teamId}`, manager: directIds ? 'Direct manager' : 'Cabinet manager',
    ...(directIds ? { teamId, userId: 99, leagueId: 7 } : {}),
  });
  const files: Record<string, unknown> = {
    'src/data/leagues.json': [{ leagueId: 7, countryName: 'Argentina', topSeriesId: 342, currentSeason: 90, isCountry: true }],
    '../web/public/data/leagues.json': [{ leagueId: 7, country: 'Argentina', champions: [winner(88, 100), { season: 87, club: 'Unknown club', manager: '—', teamId: 0, userId: 0 }] }],
    '../web/public/data/cups.json': [{ leagueId: 7, country: 'Argentina', cups: [{ cupId: 2, cupName: 'National cup', isMain: true, cupLevel: 1, cupLevelIndex: 1, winners: [winner(88, 200)] }] }],
    '../web/public/data/masters.json': [winner(87, 300)],
    '../web/public/data/seasonal.json': [{ cupId: 2108472, cupName: 'Supporter Week Trophy', winners: [winner(30, 400)] }],
    '../web/public/data/managers.json': [{
      userId: 42, userName: 'Cabinet manager', nationality: 'Argentina',
      titles: [{ country: 'Argentina', season: 88, teamId: 101, leagueId: 7 }],
      cupsMain: [{ country: 'Argentina', cup: 'National cup', season: 88, teamId: 201, leagueId: 7 }],
      cupsSec: [],
      masters: [{ country: 'Hattrick Masters', cup: 'Hattrick Masters', season: 87, teamId: 301, leagueId: 7 }],
      seasonal: [{ country: 'Supporter Week Trophy', cup: 'Supporter Week Trophy', season: 30, teamId: 401, leagueId: 7 }],
    }],
  };
  const captured: Record<string, Array<Record<string, unknown>>> = {};
  const tables = Object.fromEntries(['cupChampion', 'leagueChampion', 'cup', 'hattrickUser', 'nationalLeague'].map((table) => [table, {
    deleteMany: async () => { captured[table] = []; },
    upsert: async ({ create }: { create: Record<string, unknown> }) => { (captured[table] ??= []).push(create); },
    createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => { (captured[table] ??= []).push(...data); },
    count: async () => captured[table]?.length ?? 0,
  }]));
  const prisma = { ...tables, $disconnect: async () => {} };
  const requireFixture = (id: string) => {
    if (id === 'dotenv/config') return {};
    if (id === 'node:fs') return { readFileSync: (path: string) => JSON.stringify(files[path]), existsSync: (path: string) => path in files };
    if (id === '../db/client.js') return { prisma };
    if (id === '../sync/masters.js') return { MASTERS_CUP_ID: 1838 };
    throw new Error(`Unexpected dependency: ${id}`);
  };
  // Both src/scripts and compiled dist/scripts resolve back to the repository's TS source.
  const source = readFileSync(new URL('../../src/scripts/reconstruct-from-bake.ts', import.meta.url), 'utf8');
  const script = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction('require', 'exports', 'process', 'console', script)(requireFixture, {}, { env: {} }, { log: () => {} });
  return { leagueChampion: captured.leagueChampion ?? [], cupChampion: captured.cupChampion ?? [] };
}

test('reconstruction preserves explicit identities across league, national cup, Masters and seasonal bakes', async () => {
  const rows = await reconstructFixture(true);
  const champions = [...rows.leagueChampion.filter((r) => r.season === 88), ...rows.cupChampion];
  assert.deepEqual(champions.map((r) => r.championTeamId), [100, 200, 300, 400]);
  assert.ok(champions.every((r) => r.championUserId === 99 && r.championUserName === 'Direct manager'));
  assert.ok(rows.cupChampion.filter((r) => r.leagueId === 0).every((r) => r.championLeagueId === 7));
});

test('old bakes retain cabinet identity fallback and genuine unknowns stay unassigned', async () => {
  const rows = await reconstructFixture(false);
  const champions = [...rows.leagueChampion.filter((r) => r.season === 88), ...rows.cupChampion];
  assert.deepEqual(champions.map((r) => r.championTeamId), [101, 201, 301, 401]);
  assert.ok(champions.every((r) => r.championUserId === 42 && r.championUserName === 'Cabinet manager'));
  const unknown = rows.leagueChampion.find((r) => r.season === 87)!;
  assert.equal(unknown.championTeamId, 0);
  assert.equal(unknown.championUserId, null);
  assert.equal(unknown.championUserName, null);
});
