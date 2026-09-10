/** Compare the repaired DB with the saved pre-fix copy without reading credential tables.
 * Run from root: node qa/verify-repair-data.ts
 * Existing rows must match their exact reviewed after-row or remain identical. Additions are permitted only for the independently
 * observed cup gaps (and Supporter Week 11 if separately verified by the recovery).
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const before = new DatabaseSync(resolve(root, '.backup/qa-fixes-20260911/dev.db'), { readOnly: true });
const after = new DatabaseSync(resolve(root, 'server/prisma/dev.db'), { readOnly: true });
const observed = JSON.parse(readFileSync(resolve(root, 'qa/live-cup-gap-results.json'), 'utf8'));
const observedGaps = new Map(observed.checks.filter((c: any) => c.status === 'received')
  .map((c: any) => [`${c.cupId}/${c.season}`, c]));
const correctionPaths = ['qa/results/cup-stored-corrections-combined-plan.json', 'qa/results/cup-stored-corrections-remaining-plan.json'];
const reviewedChanges = new Map<string, any>();
for (const path of correctionPaths) {
  const file = resolve(root, path);
  if (!existsSync(file)) continue;
  for (const correction of JSON.parse(readFileSync(file, 'utf8')).corrections) {
    const key = `${correction.cupId}/${correction.season}`;
    assert.ok(!reviewedChanges.has(key), `Duplicate reviewed correction: ${key}`);
    reviewedChanges.set(key, correction);
  }
}
const aggregates = JSON.parse(readFileSync(resolve(root, 'qa/cup-final-aggregate-results.json'), 'utf8'));
const aggregateWinners = new Map<string, any>(aggregates.filter((a: any) => a.winner).map((a: any) => [a.key, a]));
const capturedMatches = new Map<string, any>(JSON.parse(readFileSync(resolve(root, 'server/src/data/recovered-cup-final-evidence.json'), 'utf8')).entries
  .map((e: any) => [`${e.summary.cupId}/${e.summary.season}`, e.rawMatch.HattrickData.Match]));
const tables = ['Team', 'Match', 'MatchDetail', 'SeasonStanding', 'NationalLeague', 'LeagueChampion',
  'Cup', 'CupChampion', 'WorldCupChampion', 'NationalCupChampion', 'NationalCoachElection', 'HattrickUser'];
const report: any = { generatedAt: new Date().toISOString(), checks: {}, addedFinals: [], correctedFinals: [], unexpectedChanges: [], missingRepairs: [] };
type Row = Record<string, any>;
try {
  for (const table of tables) {
    const fields = before.prepare(`PRAGMA table_info("${table}")`).all() as Row[];
    const pk = fields.filter(f => f.pk > 0).sort((a,b) => a.pk-b.pk).map(f => f.name);
    assert.ok(pk.length, `Missing primary key: ${table}`);
    const key = (r: Row) => JSON.stringify(pk.map(f => r[f]));
    const oldRows = before.prepare(`SELECT * FROM "${table}"`).all() as Row[];
    const newRows = after.prepare(`SELECT * FROM "${table}"`).all() as Row[];
    const old = new Map(oldRows.map(r => [key(r), r]));
    const current = new Map(newRows.map(r => [key(r), r]));
    let changed = 0, removed = 0, added = 0;
    for (const [k, row] of old) {
      const next = current.get(k);
      if (!next) { removed++; report.unexpectedChanges.push({ table, key: k, change: 'removed' }); }
      else if (JSON.stringify(row) !== JSON.stringify(next)) {
        changed++;
        const reviewed = table === 'CupChampion' ? reviewedChanges.get(`${row.cupId}/${row.season}`) : undefined;
        const same = (a: Row, b: Row) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(f => a[f] === b[f]);
        if (reviewed && same(row, reviewed.before) && same(next, reviewed.after)) {
          report.correctedFinals.push({ cupId: row.cupId, season: row.season, before: row.championTeamName,
            after: next.championTeamName, sourceUrl: reviewed.sourceUrl });
        } else report.unexpectedChanges.push({ table, key: k, change: 'modified', fields: Object.keys(row).filter(f => row[f] !== next[f]) });
      }
    }
    for (const [k, row] of current) {
      if (old.has(k)) continue;
      added++;
      const source: any = observedGaps.get(`${row.cupId}/${row.season}`);
      const seasonalGap = row.cupId === 2108472 && row.season === 11;
      if (table !== 'CupChampion' || (!source && !seasonalGap)) {
        report.unexpectedChanges.push({ table, key: k, change: 'unexpected addition' }); continue;
      }
      if (source && row.finalMatchId !== source.matchId) {
        report.unexpectedChanges.push({ table, key: k, change: 'wrong final identity' });
      }
      if (source) {
        const expected = aggregateWinners.get(`${row.cupId}/${row.season}`);
        const match = capturedMatches.get(`${row.cupId}/${row.season}`);
        const expectedTeam = expected?.winner === match?.HomeTeam.HomeTeamName ? match?.HomeTeam.HomeTeamID : match?.AwayTeam.AwayTeamID;
        if (!expected || row.championTeamName !== expected.winner || row.championTeamId !== Number(expectedTeam)
          || row.homeGoals !== source.homeGoals || row.awayGoals !== source.awayGoals || row.penalties !== 0
          || row.championUserId !== null || row.championUserName !== null) {
          report.unexpectedChanges.push({ table, key: k, change: 'insert differs from independent captured winner facts' });
        }
      }
      if (seasonalGap) {
        const plan = JSON.parse(readFileSync(resolve(root, 'qa/results/supporter-s11-plan.json'), 'utf8'));
        if (Object.keys(plan.data).some(f => row[f] !== plan.data[f])) report.unexpectedChanges.push({ table, key: k, change: 'seasonal insert differs from reviewed source facts' });
      }
      report.addedFinals.push({ cupId: row.cupId, season: row.season, finalMatchId: row.finalMatchId,
        championTeamId: row.championTeamId, champion: row.championTeamName, championUserId: row.championUserId,
        penalties: !!row.penalties });
    }
    report.checks[table] = { before: old.size, after: current.size, added, changed, removed };
  }
  for (const key of [...aggregateWinners.keys(), '2108472/11']) {
    const [cupId, season] = key.split('/').map(Number);
    if (!after.prepare('SELECT 1 FROM CupChampion WHERE cupId=? AND season=?').get(cupId!, season!)) report.missingRepairs.push(key);
  }
  for (const [key, correction] of reviewedChanges) {
    const row = after.prepare('SELECT * FROM CupChampion WHERE cupId=? AND season=?').get(correction.cupId, correction.season) as Row | undefined;
    if (!row || Object.keys(correction.after).some(f => row[f] !== correction.after[f])) report.missingRepairs.push(key);
  }
  report.passed = report.unexpectedChanges.length === 0 && report.missingRepairs.length === 0;
  writeFileSync(resolve(root, 'qa/results/repair-data-verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks, addedFinals: report.addedFinals.length,
    correctedFinals: report.correctedFinals.length, unexpectedChanges: report.unexpectedChanges, missingRepairs: report.missingRepairs }, null, 2));
  process.exitCode = report.passed ? 0 : 1;
} finally { before.close(); after.close(); }
