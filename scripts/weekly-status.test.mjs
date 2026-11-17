import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { weeklyStatus } from './weekly-status.mjs';

function archive(lastRead) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE UpdateSource (sourceKey TEXT, kind TEXT, externalId INTEGER, observedThrough INTEGER, lastSuccessAt INTEGER);
    CREATE TABLE UpdateItem (sourceKey TEXT, task TEXT, state TEXT, edition INTEGER, nextAttemptAt INTEGER);
    CREATE TABLE WorldCupChampion (isYouth INTEGER, edition INTEGER, champion TEXT, finishedDate TEXT);
    CREATE TABLE NationalCupChampion (cupName TEXT, season INTEGER, status TEXT, finalDate TEXT);
    CREATE TABLE NationalCoachElection (edition INTEGER);
    INSERT INTO NationalCoachElection VALUES (41), (42);
    INSERT INTO WorldCupChampion VALUES (0, 41, 'Belgium', '06.11.2026');
    INSERT INTO UpdateSource VALUES ('cup:62', 'cup', 62, 96, NULL);
    INSERT INTO UpdateItem VALUES ('cup:62', 'result', 'pending', 95, NULL), ('cup:62', 'result', 'pending', 96, NULL);`);
  db.prepare('INSERT INTO UpdateSource VALUES (?, ?, ?, ?, ?)').run('elections:1', 'manual', 1, 42, lastRead);
  return db;
}

test('a World Cup final after the last read makes elections due; a fresh read does not', () => {
  const now = Date.parse('2026-11-18T08:00:00Z');
  const stale = weeklyStatus(archive(Date.parse('2026-11-01T00:00:00Z')), now);
  assert.equal(stale.elections.due, true);
  assert.match(stale.elections.reasons.join(), /worldcup-senior 41/);
  assert.deepEqual([stale.elections.cutoff, stale.elections.leagueIds], [41, [1]]);
  assert.deepEqual(stale.acquisition, { openPreviousSeasonResults: 1, runAnotherRound: true });
  const fresh = weeklyStatus(archive(Date.parse('2026-11-17T22:32:54Z')), now);
  assert.equal(fresh.elections.due, false);
  assert.equal(weeklyStatus(archive(null), now).elections.due, true);
});
