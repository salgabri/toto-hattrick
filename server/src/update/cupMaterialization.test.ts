import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { carryMaterializedFinals, materializeCheckoutCupFinals, planCupMaterialization } from './cupMaterialization.js';

test('retained update-store evidence keeps a cup season with the updater and blocks match re-fetches', () => {
  const evidence = [
    'evidence/chpp/cupmatches/1.2/25/10/14.json',
    'evidence/observations/cupmatches/1.2/26/3/5/0b1c.json',
    'evidence/chpp/matchdetails/3.0/123/events.json',
    'evidence/observations/matchdetails/3.0/456/events/9f2e.json',
    'evidence/imports/abc/def.json',
  ];
  const candidates = [{ cupId: 7, season: 90 }, { cupId: 7, season: 89 }, { cupId: 25, season: 10 }, { cupId: 26, season: 3 }];
  const plan = planCupMaterialization(candidates, evidence);
  assert.deepEqual(plan.finals, [{ cupId: 7, season: 90 }, { cupId: 7, season: 89 }]);
  assert.deepEqual(plan.leftToUpdater, [{ cupId: 25, season: 10 }, { cupId: 26, season: 3 }]);
  assert.deepEqual([...plan.retainedMatchIds].sort((a, b) => a - b), [123, 456]);
  // An exact list only narrows the name-only candidates; it can never add a final.
  const narrowed = planCupMaterialization(candidates, evidence, [{ cupId: 7, season: 89 }, { cupId: 25, season: 10 }, { cupId: 8, season: 1 }]);
  assert.deepEqual(narrowed.finals, [{ cupId: 7, season: 89 }]);
  assert.deepEqual(narrowed.leftToUpdater, [{ cupId: 25, season: 10 }]);
  assert.deepEqual(planCupMaterialization(candidates, evidence, []).finals, []);
});

const SCHEMA = `
  CREATE TABLE Cup (cupId INTEGER PRIMARY KEY, leagueId INTEGER NOT NULL, isMain BOOLEAN NOT NULL, cupLevelIndex INTEGER NOT NULL);
  CREATE TABLE CupChampion (cupId INTEGER NOT NULL, season INTEGER NOT NULL, finalMatchId INTEGER NOT NULL, championTeamId INTEGER,
    championTeamName TEXT NOT NULL, runnerUpTeamName TEXT NOT NULL, homeGoals INTEGER NOT NULL, awayGoals INTEGER NOT NULL,
    championUserId INTEGER, updatedAt DATETIME NOT NULL, PRIMARY KEY (cupId, season));
  INSERT INTO Cup VALUES (7, 4, 1, 1), (900, 0, 0, 1);`;
type Row = [number, number, number, number | null, string, string, number, number, number | null];
async function checkoutDb(dir: string, name: string, rows: Row[], evidence: string[] = []) {
  const path = join(dir, name);
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const insert = db.prepare('INSERT INTO CupChampion VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1700000000000)');
  for (const row of rows) insert.run(...row);
  db.close();
  await writeFile(`${path}.review.json`, JSON.stringify({ schemaVersion: 1, databasePath: path, snapshotId: name, etag: 'e',
    checkedOutAt: '2026-11-18T22:00:00.000Z', evidenceRefs: evidence.map(key => ({ key, sha256: 'a'.repeat(64), bytes: 1 })) }));
  return path;
}
const read = (path: string) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare('SELECT cupId, season, finalMatchId, championTeamId, runnerUpTeamName, homeGoals, awayGoals, championUserId FROM CupChampion ORDER BY cupId, season').all().map(row => ({ ...row })); }
  finally { db.close(); }
};

test('the dry run selects only name-only domestic finals of a review checkout and fetches nothing', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'materialize-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = await checkoutDb(dir, 'review.db', [
    [7, 90, 0, null, 'Real Pignola', '', 0, 0, null], // name-only: selected
    [7, 89, 0, null, 'Retained', '', 0, 0, null], // the updater already fetched this season
    [7, 88, 0, null, 'Pending', '', 0, 0, 0], // cleared to manager pending: not this job's
    [7, 87, 5, 11, 'Real', 'Other', 1, 0, null], // already a real final
    [7, 86, 6, null, 'Half Done', 'Other', 2, 1, null], // its matchdetails step failed earlier: selected again
    [900, 3, 0, null, 'Seasonal', '', 0, 0, null], // international: cupmatches is not its source
  ], ['evidence/chpp/cupmatches/1.2/7/89/7.json']);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('a dry run must not call CHPP'); });
  const summary = await materializeCheckoutCupFinals({ databasePath: path, reportPath: join(dir, 'plan.json') });
  assert.equal(summary.dryRun, true);
  assert.equal(summary.nameOnlyFinals, 3);
  assert.equal(summary.selected, 2);
  assert.deepEqual(summary.leftToUpdater, [{ cupId: 7, season: 89 }]);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'plan.json'), 'utf8')).finals, [{ cupId: 7, season: 90 }, { cupId: 7, season: 86 }]);
  await assert.rejects(materializeCheckoutCupFinals({ databasePath: path, apply: true, maxCalls: 10 }), /requires --report/);
  await assert.rejects(materializeCheckoutCupFinals({ databasePath: path, apply: true, maxCalls: 0, reportPath: join(dir, 'x.json'),
    token: { token: 't', tokenSecret: 's' } }), /--max-calls between 1 and/);
  await assert.rejects(materializeCheckoutCupFinals({ databasePath: join(dir, 'missing.db') }), /review checkout sidecar/);
});

test('carry-over replays an older checkout\'s materialized finals without CHPP calls, under the same guards', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'carry-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const older = await checkoutDb(dir, 'older.db', [
    [7, 90, 747054745, 2241372, 'Real Pignola', 'milantriste', 2, 1, null], // materialized in the older checkout
    [7, 89, 600, 31, 'Renamed Since', 'X', 1, 0, null], // the fresh checkout stores another winner name
    [7, 88, 700, 41, 'Taken', 'Y', 3, 0, 9], // its match is assigned elsewhere in the fresh checkout
    [7, 87, 800, 51, 'Done', 'Z', 2, 0, null], // already real in the fresh checkout
  ]);
  const fresh = await checkoutDb(dir, 'fresh.db', [
    [7, 90, 0, null, 'Real Pignola', '', 0, 0, null],
    [7, 89, 0, null, 'Stored Winner', '', 0, 0, null],
    [7, 88, 0, null, 'Taken', '', 0, 0, null],
    [7, 86, 700, 61, 'Other Final', 'W', 1, 0, null],
    [7, 87, 800, 51, 'Done', 'Z', 2, 0, null],
  ]);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('carry-over must not call CHPP'); });
  const dry = await carryMaterializedFinals({ databasePath: fresh, fromPath: older });
  assert.equal(dry.carried, 1);
  assert.deepEqual(dry.conflicts.map(conflict => [conflict.season, conflict.reason]), [
    [89, 'Winner name differs from the older checkout'], [88, 'Final match is already assigned to cup 7 season 86']]);
  assert.equal((read(fresh) as Array<{ season: number; finalMatchId: number }>).find(row => row.season === 90)!.finalMatchId, 0);
  await assert.rejects(carryMaterializedFinals({ databasePath: fresh, fromPath: older, apply: true }), /requires --report/);
  await assert.rejects(carryMaterializedFinals({ databasePath: fresh, fromPath: fresh }), /different, older checkout/);
  const applied = await carryMaterializedFinals({ databasePath: fresh, fromPath: older, apply: true, reportPath: join(dir, 'carry.json') });
  assert.equal(applied.carried, 1);
  assert.deepEqual(read(fresh).find(row => (row as { season: number }).season === 90), {
    cupId: 7, season: 90, finalMatchId: 747054745, championTeamId: 2241372, runnerUpTeamName: 'milantriste', homeGoals: 2, awayGoals: 1, championUserId: null });
  // Replaying again finds nothing left to carry.
  assert.equal((await carryMaterializedFinals({ databasePath: fresh, fromPath: older })).carried, 0);
});
