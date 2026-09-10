// A single documented missing tournament winner. No network, OAuth, or inferred ownership.
// From root: node qa/repair-supporter-week-s11.mjs [--apply]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } } });
const backupPath = resolve(root, '.backup/qa-fixes-20260911/dev.db');
assert.equal(createHash('sha256').update(readFileSync(backupPath)).digest('hex'),
  '625cecd7fd9689abf52acdedcbe703bca9338d18a91bbf9a8c00c66aa28e9e0f', 'Original backup changed');
const backup = new DatabaseSync(backupPath, { readOnly: true });
const db = new DatabaseSync(resolve(root, 'server/prisma/dev.db'), { readOnly: !values.apply });
const planPath = resolve(root, 'qa/results/supporter-s11-plan.json');
const sources = [
  'https://wiki.hattrick.org/wiki/Supporter_Week',
  'https://wiki.hattrick.org/wiki/CPAM_FC_Supporter_Week_Trophy',
];
const data = {
  cupId: 2108472, season: 11, leagueId: 0, countryName: 'Supporter Week Trophy',
  cupName: 'Supporter Week Trophy', isMain: 0, finalMatchId: 0,
  championTeamId: null, championTeamName: 'Beta Broncos', championLeagueId: 2,
  runnerUpTeamName: 'SocceroS (-S-) Żory', homeGoals: 0, awayGoals: 0, penalties: 0,
  championUserId: null, championUserName: null,
};
let transaction = false;
try {
  assert.equal(backup.prepare('SELECT count(*) AS n FROM CupChampion WHERE cupId=2108472 AND season=11').get().n, 0);
  const cup = db.prepare('SELECT * FROM Cup WHERE cupId=2108472').get();
  assert.equal(cup.cupName, data.cupName); assert.equal(cup.leagueId, 0); assert.equal(cup.isMain, 0);
  if (!values.apply) {
    assert.equal(db.prepare('SELECT count(*) AS n FROM CupChampion WHERE cupId=2108472 AND season=11').get().n, 0);
    const plan = { sources, fact: 'Both historical records identify England Beta Broncos as winner of edition11/global season68. Numeric identities and scores are unknown.',
      data: { ...data, createdAt: Date.now(), updatedAt: Date.now() } };
    writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ mode: 'read-only-plan', ...plan }, null, 2));
  } else {
    const plan = JSON.parse(readFileSync(planPath, 'utf8'));
    assert.deepEqual(plan.sources, sources);
    assert.deepEqual(Object.keys(plan.data).sort(), [...Object.keys(data), 'createdAt', 'updatedAt'].sort());
    for (const [key, value] of Object.entries(data)) assert.equal(plan.data[key], value, `Unreviewed field: ${key}`);
    for (const key of ['createdAt', 'updatedAt']) assert.ok(Number.isSafeInteger(plan.data[key]) && plan.data[key] > 0);
    db.exec('BEGIN IMMEDIATE'); transaction = true;
    const existing = db.prepare('SELECT * FROM CupChampion WHERE cupId=2108472 AND season=11').get();
    if (existing) for (const [key, value] of Object.entries(plan.data)) assert.equal(existing[key], value, `Conflicting existing record: ${key}`);
    else {
      const columns = Object.keys(plan.data);
      db.prepare(`INSERT INTO CupChampion (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(plan.data));
    }
    db.exec('COMMIT'); transaction = false;
    const result = { appliedAt: new Date().toISOString(), inserted: existing ? 0 : 1, alreadyApplied: !!existing, ...plan };
    writeFileSync(resolve(root, 'qa/results/supporter-s11-applied.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ inserted: result.inserted, alreadyApplied: result.alreadyApplied }));
  }
} catch (error) { if (transaction) db.exec('ROLLBACK'); throw error; }
finally { db.close(); backup.close(); }
