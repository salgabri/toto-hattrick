// Read-only comparison of captured public Wiki National Trophies facts.
// No CHPP requests, stored match refetches, or database writes.
import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const inputs = JSON.parse(readFileSync('qa/wiki-stored-audit/extracted-national-trophy-rows.json', 'utf8'));
const db = new DatabaseSync('server/prisma/dev.db', { readOnly: true });
const report = { checkedAt: new Date().toISOString(), scope: 'Stored main-cup rows in 33 other gap countries; local seasons <=14, or <=24 for Sweden/France/Germany. England/Italy/Poland/Belgium/Brazil assigned separately. No stored finals fetched. Exact winner differences are candidates pending rename/club-identity review; exact archived runner-up matches are confirmed mismatches.', reviewed: [], missingTables: [], candidates: [], mismatches: [] };
for (const {country, url, cap, rows: sourceRows} of inputs) {
  const wikiRows = sourceRows.filter(w => w.cells.length === 5).map(w => ({ ...w, winnerName: w.cells[3], managerName: w.cells[4] }));
  const rows = db.prepare('SELECT * FROM CupChampion WHERE countryName = ? AND isMain = 1 AND season <= ? ORDER BY season').all(country, cap);
  if (!wikiRows.length) { report.missingTables.push({ country, url, reason: sourceRows.length ? 'Extract requires manual table-cell separation' : 'Wiki page unavailable or no early trophy rows in extract', storedRows: rows.length }); continue; }
  let matched = 0, agreed = 0;
  for (const row of rows) {
    const wiki = wikiRows.find(w => w.season === row.season); if (!wiki || !wiki.winnerName) continue; matched++;
    if (wiki.winnerName === row.championTeamName) { agreed++; continue; }
    const candidate = { countryName: country, cupId: row.cupId, season: row.season, winnerName: wiki.winnerName, managerName: wiki.managerName, url, actualCurrentRow: row, sourceCells: wiki.cells, winnerExactlyCurrentRunnerUp: wiki.winnerName === row.runnerUpTeamName };
    report.candidates.push(candidate);
    if (candidate.winnerExactlyCurrentRunnerUp) report.mismatches.push(candidate);
  }
  report.reviewed.push({ country, url, seasonCap: cap, storedRows: rows.length, wikiRows: wikiRows.length, matched, agreed, unverifiedStoredSeasons: rows.filter(row => !wikiRows.some(w => w.season === row.season && w.winnerName)).map(row => row.season) });
}
db.close();
for (const key of ['reviewed', 'missingTables', 'candidates', 'mismatches']) report[key].sort((a, b) => (a.country ?? a.countryName).localeCompare(b.country ?? b.countryName) || (a.season ?? 0) - (b.season ?? 0));
writeFileSync('qa/cup-stored-winner-mismatches-other.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ reviewedCountries: report.reviewed.length, reviewedRows: report.reviewed.reduce((n,r)=>n+r.matched,0), missing: report.missingTables, mismatches: report.mismatches.map(({countryName,cupId,season,winnerName,actualCurrentRow}) => ({countryName,cupId,season,winnerName,currentChampion:actualCurrentRow.championTeamName})), otherCandidates: report.candidates.filter(c => !c.winnerExactlyCurrentRunnerUp).map(({countryName,cupId,season,winnerName,managerName,actualCurrentRow}) => ({countryName,cupId,season,winnerName,managerName,currentChampion:actualCurrentRow.championTeamName,currentManager:actualCurrentRow.championUserName})) }, null, 2));
