import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import savedWinners from './supporter-week-winners.json' with { type: 'json' };
import { prisma } from '../db/client.js';
import { ingestSeasonalWinners, SUPPORTER_WEEK_CUP_ID } from './seasonal.js';
import { seasonalTeamIdsFromIngest } from './intlTeamCountries.js';

const token = { token: 'test-token', tokenSecret: 'test-secret' };
const recovered = savedWinners.find(w => w.season === 11)!;
const options = { cupId: SUPPORTER_WEEK_CUP_ID, name: 'Supporter Week Trophy', winners: [recovered] };
function stub(t: TestContext, target: object, method: string, fn: (...args: any[]) => any) {
  const object = target as Record<string, unknown>;
  const original = object[method]; object[method] = fn;
  t.after(() => { object[method] = original; });
}
function database(t: TestContext, initial?: Record<string, any>) {
  let rows = new Map<number, Record<string, any>>(initial ? [[11, initial]] : []);
  let cup: Record<string, any> = { currentSeason: 37 };
  let writes = 0;
  let userWrites = 0;
  const db = {
    cup: {
      findUnique: async () => cup,
      upsert: async (args: any) => { cup = { ...cup, ...args.update }; return cup; },
    },
    cupChampion: {
      findUnique: async (args: any) => rows.get(args.where.cupId_season.season) ?? null,
      upsert: async (args: any) => {
        const season = args.where.cupId_season.season;
        const value = rows.has(season) ? { ...rows.get(season), ...args.update } : args.create;
        rows.set(season, value); writes++; return value;
      },
    },
    hattrickUser: { upsert: async () => { userWrites++; return {}; } },
  };
  stub(t, prisma, '$transaction', async fn => {
    const before = structuredClone(rows); const beforeCup = structuredClone(cup);
    try { return await fn(db); } catch (error) { rows = before; cup = beforeCup; throw error; }
  });
  stub(t, prisma.hattrickUser, 'findMany', async () => []);
  const http = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Retained seasonal facts cannot trigger current-owner lookup'); });
  return { row: (season = 11) => rows.get(season), cup: () => cup, size: () => rows.size, writes: () => writes, userWrites: () => userWrites, http };
}

test('saved Supporter Week source contains every edition1–37 and the independently evidenced S11 winner', () => {
  assert.deepEqual(savedWinners.map(w => w.season), Array.from({ length: 37 }, (_, i) => i + 1));
  assert.equal(recovered.team, 'Beta Broncos');
  assert.equal(recovered.teamLeagueId, 2);
  assert.equal(recovered.runnerUp, 'SocceroS (-S-) Żory');
  assert.equal(recovered.teamId, null);
  assert.equal(recovered.userId, null);
  assert.equal(recovered.manager, null);
  assert.deepEqual(recovered.sourceURLs, ['https://wiki.hattrick.org/wiki/Supporter_Week', 'https://wiki.hattrick.org/wiki/CPAM_FC_Supporter_Week_Trophy']);
  assert.equal(seasonalTeamIdsFromIngest().has(`${SUPPORTER_WEEK_CUP_ID}|11`), false, 'The country/club name must not become a guessed team ID');
});

test('normal full seasonal ingestion reproduces S11 country/runner-up and preserves null numeric identities', async t => {
  const db = database(t);
  const result = await ingestSeasonalWinners(token, { ...options, winners: savedWinners });
  assert.equal(result.seasons, 37);
  assert.equal(db.size(), 37);
  const winner = db.row()!;
  assert.equal(winner.championTeamName, 'Beta Broncos');
  assert.equal(winner.championLeagueId, 2);
  assert.equal(winner.runnerUpTeamName, 'SocceroS (-S-) Żory');
  assert.equal(winner.championTeamId, null);
  assert.equal(winner.championUserId, null);
  assert.equal(winner.championUserName, null);
  assert.equal(winner.finalMatchId, 0);
  assert.equal(db.userWrites(), 36);
  assert.equal(db.http.mock.callCount(), 0);
  await ingestSeasonalWinners(token, { ...options, winners: savedWinners });
  assert.equal(db.writes(), 37, 'Idempotent replay must not rewrite unchanged winners');
});

test('a partial unknown-ID replay preserves the newest registry season and uses zero HTTP calls', async t => {
  const db = database(t);
  await ingestSeasonalWinners(token, options);
  await ingestSeasonalWinners(token, options);
  assert.equal(db.cup().currentSeason, 37);
  assert.equal(db.writes(), 1);
  assert.equal(db.userWrites(), 0);
  assert.equal(db.http.mock.callCount(), 0);
});

test('replaying weaker S11 source preserves subsequently verified club and manager identities', async t => {
  const original = { championTeamId: 1234, championTeamName: 'Beta Broncos', championUserId: 5678, championUserName: 'Verified historical manager', championLeagueId: 2, runnerUpTeamName: 'SocceroS (-S-) Żory', finalMatchId: 9999, homeGoals: 4, awayGoals: 2 };
  const db = database(t, original);
  await ingestSeasonalWinners(token, options);
  assert.deepEqual(db.row(), original);
  assert.equal(db.writes(), 0);
  assert.equal(db.userWrites(), 0);
  assert.equal(db.http.mock.callCount(), 0);
});

test('conflicting verified seasonal winners or country evidence abort without overwriting', async t => {
  for (const mismatch of [{ championTeamName: 'A different winner' }, { championLeagueId: 4 }]) await t.test(JSON.stringify(mismatch), async child => {
    const original = { championTeamId: 1234, championTeamName: 'Beta Broncos', championUserId: 5678, championUserName: 'Verified manager', championLeagueId: 2, runnerUpTeamName: 'SocceroS (-S-) Żory', ...mismatch };
    const db = database(child, original);
    await assert.rejects(ingestSeasonalWinners(token, options), /Conflicting seasonal winner/);
    assert.deepEqual(db.row(), original);
    assert.equal(db.writes(), 0);
    assert.equal(db.http.mock.callCount(), 0);
  });
});

test('duplicate editions and unsourced country facts fail validation before database work', async t => {
  let transactions = 0;
  stub(t, prisma, '$transaction', async () => { transactions++; throw new Error('Invalid source cannot write'); });
  await assert.rejects(ingestSeasonalWinners(token, { ...options, winners: [recovered, recovered] }), /Duplicate seasonal/);
  await assert.rejects(ingestSeasonalWinners(token, { ...options, winners: [{ ...recovered, sourceURLs: [] }] }), /require retained source/);
  assert.equal(transactions, 0);
});
