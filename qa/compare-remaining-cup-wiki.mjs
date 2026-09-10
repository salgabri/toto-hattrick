import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('server/prisma/dev.db', { readOnly: true });
const facts = JSON.parse(readFileSync('qa/wiki-stored-audit/remaining-national-trophy-rows.json', 'utf8'));
const norm = s => s.normalize('NFKC').toLowerCase().replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
const decode = s => s.replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n))).replace(/&amp;/g, '&');
const results = [];
for (const c of facts) for (const r of c.rows) {
  const before = db.prepare('SELECT * FROM CupChampion WHERE cupId=? AND season=?').get(c.cupId, r.season);
  if (!before) continue;
  const status = norm(before.championTeamName) === norm(r.winner) ? 'name-agreement' : norm(decode(before.championTeamName)) === norm(r.winner) ? 'html-entity-equivalent' : 'name-difference-needs-primary';
  results.push({ country: c.country, cupId: c.cupId, season: r.season, sourceUrl: c.sourceUrl, sourceLine: r.sourceLine, expectedWinner: r.winner, sourceManager: r.manager ?? null, status, before });
}
db.close();
const report = { checkedAt: new Date().toISOString(), countries: facts.length, rows: results.length, exactAgreements: results.filter(r => r.status === 'name-agreement').length, differences: results.filter(r => r.status !== 'name-agreement'), results };
writeFileSync('qa/cup-remaining-wiki-comparison.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ countries: report.countries, rows: report.rows, exactAgreements: report.exactAgreements, differences: report.differences.map(({before,...r}) => ({...r, storedWinner: before.championTeamName})) }, null, 2));
