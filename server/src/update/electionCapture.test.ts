import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { applyElectionCapture, explainOlder, olderFingerprint, planRecent, type PageRow, type StoredRow } from './electionCapture.js';

const page = (edition: number, host: string, userId: number | null, votes: string, name = userId ? `u${userId}` : null): PageRow =>
  ({ edition, host, winnerUserId: userId, winnerUserName: name, votes, isYouth: false });
const stored = (id: number, edition: number, host: string, userId: number | null, votes: string): StoredRow =>
  ({ id, edition, host, winnerUserId: userId, winnerUserName: userId ? `u${userId}` : null, votes });

test('the older-edition fingerprint matches the browser capture format', () => {
  // SHA-256 of the empty string: a country with no older elections (seen for new leagues).
  assert.equal(olderFingerprint([]), 'e3b0c44298fc1c14');
  const rows = [{ edition: 40, host: 'Ecuador', winnerUserId: null, votes: '1704 (42%)' }, { edition: 39, host: 'Ukraina', winnerUserId: 102034, votes: '2367 (51%)' }];
  assert.equal(olderFingerprint(rows), olderFingerprint([...rows].reverse()), 'order-independent');
});

test('recent rows: exact matches stay, an empty host is filled, a new cycle is inserted', () => {
  const actions = planRecent(
    [stored(1, 41, 'Angola', 8877414, '1945 (94%)'), stored(2, 41, '', 14075392, '1397 (58%)')],
    [page(41, 'Angola', 8877414, '1945 (94%)'), page(42, '', 8877414, '2524 (88%)'), page(41, 'Slovensko', 14075392, '1397 (58%)')]);
  assert.deepEqual(actions.map(action => action.kind), ['exact', 'insert', 'hostFill']);
});

test('recent rows: a deleted account keeps its name, a newly linked winner is filled, real conflicts are skipped', () => {
  const actions = planRecent(
    [stored(1, 41, 'Angola', 555, '10 (50%)'), stored(2, 41, 'Angola', null, '20 (60%)'), stored(3, 41, 'Angola', 777, '30 (70%)')],
    [page(41, 'Angola', null, '10 (50%)'), page(41, 'Angola', 999, '20 (60%)'), page(41, 'Angola', 888, '30 (70%)')]);
  assert.deepEqual(actions.map(action => action.kind), ['exact', 'exact', 'winnerFill', 'skip']);
  const twins = planRecent([], [page(41, 'Slovensko', 1, '5 (50%)'), page(41, 'Slovensko', 2, '5 (50%)')]);
  assert.deepEqual(twins.map(action => action.kind), ['skip', 'skip']);
});

test('older mismatches: deleted accounts are kept, newly linked winners filled, anything else is a conflict', () => {
  const archive = [stored(1, 40, 'Ecuador', 6635361, '1704 (42%)'), stored(2, 20, 'Italia', null, '192 (47%)'), stored(3, 30, 'Bénin', 5, '57 (41%)')];
  const actions = explainOlder(archive, [[40, 'Ecuador', null, null, '1704 (42%)'], [20, 'Italia', 12063147, 'Jana3', '192 (47%)'], [30, 'Bénin', 5, 'x', '57 (41%)']]);
  assert.deepEqual(actions, [{ kind: 'accountGone', id: 1 }, { kind: 'winnerFill', id: 2, userId: 12063147, name: 'Jana3' }]);
  const changed = explainOlder(archive, [[40, 'Ecuador', 42, 'other', '1704 (42%)'], [20, 'Italia', null, null, '192 (47%)'], [30, 'Bénin', 5, 'x', '57 (41%)'], [31, 'X', 1, 'y', '1 (1%)']]);
  assert.equal(changed.filter(action => action.kind === 'conflict').length, 2);
});

test('applyElectionCapture refuses unexplained history, then applies a guarded update and writes the manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'election-capture-'));
  try {
    const databasePath = join(root, 'review.db');
    const db = new DatabaseSync(databasePath);
    db.exec(`CREATE TABLE HattrickUser (userId INTEGER PRIMARY KEY, loginName TEXT, countryId INTEGER, nationality TEXT, isBot INTEGER, updatedAt INTEGER);
      CREATE TABLE NationalCoachElection (id INTEGER PRIMARY KEY AUTOINCREMENT, leagueId INTEGER, countryName TEXT, edition INTEGER, host TEXT, isYouth INTEGER,
        winnerUserId INTEGER, winnerUserName TEXT, votes TEXT, createdAt INTEGER, updatedAt INTEGER);
      CREATE TABLE UpdateSource (sourceKey TEXT PRIMARY KEY, metadataJson TEXT);
      CREATE TABLE UpdateItem (sourceKey TEXT, itemKey TEXT, task TEXT, state TEXT);
      INSERT INTO HattrickUser VALUES (8877414, 'ZorroMP', 1, 'Sverige', 0, 0);
      INSERT INTO NationalCoachElection (leagueId, countryName, edition, host, isYouth, winnerUserId, winnerUserName, votes) VALUES
        (1, 'Sweden', 40, 'Angola', 0, 8877414, 'ZorroMP', '1000 (90%)'),
        (1, 'Sweden', 41, 'Angola', 0, 8877414, 'ZorroMP', '1945 (94%)'),
        (1, 'Sweden', 41, '', 1, NULL, NULL, '1397 (58%)');
      INSERT INTO UpdateSource VALUES ('elections:1', '{"sourceUrl":"https://www.hattrick.org/World/Elections/History.aspx?LeagueID=1"}');
      INSERT INTO UpdateItem VALUES ('elections:1', 'capture:2026-09-07', 'capture', 'needs_review');`);
    const seniorOlder = olderFingerprint([{ edition: 40, host: 'Angola', winnerUserId: 8877414, votes: '1000 (90%)' }]);
    db.close();
    await writeFile(`${databasePath}.review.json`, JSON.stringify({ schemaVersion: 1, databasePath, snapshotId: 's', etag: 'e',
      checkedOutAt: '2026-11-17T00:00:00.000Z', evidenceRefs: [] }));
    const captureDir = join(root, 'capture');
    await (await import('node:fs/promises')).mkdir(captureDir);
    const country = (seniorSha: string) => ({ '1': { t: '2026-11-17T22:26:04.091Z', c: 41, n: 4, o: [1, seniorSha, 0, olderFingerprint([])],
      r: [[41, 'Angola', 8877414, 'ZorroMP', '1945 (94%)', 0], [42, '', 8877414, 'ZorroMP', '2524 (88%)', 0], [41, 'Slovensko', 14075392, 'oskarogge', '1397 (58%)', 1]] } });
    await writeFile(join(captureDir, 'chunk-1.json'), JSON.stringify(country('0000000000000000')));
    const options = { databasePath, captureDir, repositoryPath: root, stamp: 'test' };
    const blocked = await applyElectionCapture(options);
    assert.deepEqual(blocked.needsOlderDetails, [[1, false]]);
    await assert.rejects(applyElectionCapture({ ...options, apply: true, reportPath: join(root, 'blocked.json') }), /Older election editions differ/);
    await writeFile(join(captureDir, 'chunk-1.json'), JSON.stringify(country(seniorOlder)));
    const summary = await applyElectionCapture({ ...options, apply: true, reportPath: join(root, 'report.json') });
    assert.deepEqual([summary.hostFilled, summary.winnersFilled, summary.inserted, summary.newUsers], [1, 1, 1, 1]);
    assert.equal(summary.manifestPath, '.scrape/review-captures/elections-test.manifest.json');
    const after = new DatabaseSync(databasePath, { readOnly: true });
    assert.deepEqual(after.prepare('SELECT edition, host, isYouth, winnerUserId, winnerUserName FROM NationalCoachElection ORDER BY id').all().map(row => ({ ...row })), [
      { edition: 40, host: 'Angola', isYouth: 0, winnerUserId: 8877414, winnerUserName: 'ZorroMP' },
      { edition: 41, host: 'Angola', isYouth: 0, winnerUserId: 8877414, winnerUserName: 'ZorroMP' },
      { edition: 41, host: 'Slovensko', isYouth: 1, winnerUserId: 14075392, winnerUserName: 'oskarogge' },
      { edition: 42, host: '', isYouth: 0, winnerUserId: 8877414, winnerUserName: 'ZorroMP' },
    ]);
    after.close();
    const manifest = JSON.parse(await readFile(join(root, summary.manifestPath!), 'utf8'));
    assert.deepEqual(manifest.assertions.map((a: { sourceKey: string; itemKey: string }) => `${a.sourceKey}/${a.itemKey}`), ['elections:1/capture:2026-09-07']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
