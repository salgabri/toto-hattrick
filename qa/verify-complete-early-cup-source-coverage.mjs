import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const read = p => JSON.parse(readFileSync(p, 'utf8'));
// Preserve case, punctuation and accents: only representation-level entities and
// whitespace are normalized. A rename needs explicit evidence, not fuzzy matching.
const normalize = s => s.replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n)))
  .replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_, n) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' })[n])
  .replace(/\s+/g, ' ').trim();
const db = new DatabaseSync('server/prisma/dev.db', { readOnly: true });
const sources = new Map();
const put = (cupId, season, winner, url, provenance) => {
  const key = `${cupId}:${season}`;
  const list = sources.get(key) ?? [];
  list.push({ winner, url, provenance }); sources.set(key, list);
};
for (const c of read('qa/wiki-stored-audit/extracted-national-trophy-rows.json')) {
  const cup = db.prepare('SELECT cupId FROM Cup WHERE countryName=? AND isMain=1').get(c.country);
  assert(cup, c.country);
  for (const r of c.rows) if (r.cells.length === 5) put(cup.cupId, r.season, r.cells[3], c.url, 'original33-country-table');
}
for (const c of read('qa/early-two-leg-winner-review.json').reviewed)
  for (const r of c.comparisons) put(c.cupId, r.season, r.verifiedChampion, c.sourceUrl, 'original-five-country-table');
for (const p of ['qa/cup-winner-web-evidence-a-j.json', 'qa/cup-winner-web-evidence-k-z.json'])
  for (const r of read(p).evidence) put(r.cupId, r.season, r.winnerName, r.url, p);
const additional = read('qa/wiki-stored-audit/remaining-national-trophy-rows.json');
const additionalKeys = new Set();
for (const c of additional) for (const r of c.rows) {
  const key = `${c.cupId}:${r.season}`;
  assert(!additionalKeys.has(key), `Duplicate independent source ${key}`); additionalKeys.add(key);
  assert(r.winner?.length && r.sourceLine > 0, `Missing winner source ${key}`);
  put(c.cupId, r.season, r.winner, c.sourceUrl, 'additional50-country-table');
}
const originalManifest = read('qa/cup-two-leg-coverage-gaps.json');
const expectedKeys = new Set(originalManifest.unreviewedCountries.flatMap(c => c.unreviewedRows.map(r => `${c.cupId}:${r.season}`)));
assert.deepEqual(additionalKeys, expectedKeys, 'Additional source scope differs from omitted-row manifest');
const seed = read('server/src/data/leagues.json');
const globalReference = Math.max(...seed.filter(r => r.isCountry).map(r => r.currentSeason ?? 0));
const rows = [];
for (const c of db.prepare('SELECT * FROM Cup WHERE isMain=1').all()) {
  const country = seed.find(r => r.leagueId === c.leagueId && r.isCountry);
  if (!country) continue;
  const offset = globalReference - country.currentSeason;
  for (const row of db.prepare('SELECT * FROM CupChampion WHERE cupId=? AND season<=? ORDER BY season').all(c.cupId, 24 - offset))
    rows.push({ cupId: c.cupId, country: c.countryName, season: row.season, globalSeason: row.season + offset, storedWinner: row.championTeamName, sources: sources.get(`${c.cupId}:${row.season}`) ?? [] });
}
db.close();
const missingSources = rows.filter(r => !r.sources.length);
// These public table discrepancies were independently checked against CHPP. The
// permitted stored winner is derived again from the captured scores; keys alone
// never exempt a row from winner correctness.
const exceptionDefinitions = new Map([
  ['19:6', { publishedWinner: 'Alexandria Pharaohs', primaryWinner: 'Alexandria Pharaons', explanation: 'Wiki spelling differs from the primary final participant.' }],
  ['36:10', { publishedWinner: 'sir_mb', primaryWinner: 'Starkers', explanation: 'Wiki puts the manager in the team column.' }],
  ['36:12', { publishedWinner: 'Mummi', primaryWinner: 'Valkyries', explanation: 'Wiki puts the manager in the team column.' }],
  ['50:1', { publishedWinner: 'Ničivá Síla', primaryWinner: 'hasek', explanation: 'The primary final names hasek in both legs and proves a 17–2 aggregate; the Wiki names another club. No rename or ownership inference is made.', evidenceFile: 'qa/expanded-cup-primary-evidence.json', evidenceSha256: '735ac6d3d542af28abf5608d350cbecfe3303e101000a2d4ee34505d357abb7b' }],
]);
const exceptions = new Map();
for (const [key, def] of exceptionDefinitions) {
  const [cupId, season] = key.split(':').map(Number);
  const evidenceFile = def.evidenceFile ?? 'qa/cup-stored-primary-results.json';
  const evidenceBytes = readFileSync(evidenceFile);
  if (def.evidenceSha256) assert.equal(createHash('sha256').update(evidenceBytes).digest('hex'), def.evidenceSha256, `Frozen primary evidence changed for ${key}`);
  const primaryEvidence = JSON.parse(evidenceBytes.toString('utf8')).checks;
  const matches = primaryEvidence.filter(r => r.cupId === cupId && r.season === season);
  assert.equal(matches.length, 1, `Missing/duplicate primary exception evidence: ${key}`);
  const e = matches[0], final = e.final.response, previous = e.previous.response;
  assert.equal(final.cupId, cupId); assert.equal(final.season, season);
  assert.equal(previous.cupId, cupId); assert.equal(previous.season, season);
  assert.equal(previous.round, final.round - 1);
  assert.equal(final.matches.length, 1);
  const f = final.matches[0];
  assert.notEqual(normalize(f.homeTeamName), normalize(f.awayTeamName));
  let homeTotal = f.homeGoals, awayTotal = f.awayGoals;
  assert(Number.isInteger(homeTotal) && homeTotal >= 0 && Number.isInteger(awayTotal) && awayTotal >= 0);
  if (previous.matches.length === 1) {
    const p = previous.matches[0];
    assert.equal(normalize(p.homeTeamName), normalize(f.awayTeamName));
    assert.equal(normalize(p.awayTeamName), normalize(f.homeTeamName));
    assert(Number.isInteger(p.homeGoals) && p.homeGoals >= 0 && Number.isInteger(p.awayGoals) && p.awayGoals >= 0);
    homeTotal += p.awayGoals; awayTotal += p.homeGoals;
  } else {
    assert.equal(previous.matches.length, 2, `Unproven single final for ${key}`);
    for (const name of [f.homeTeamName, f.awayTeamName])
      assert.equal(previous.matches.filter(p => [p.homeTeamName, p.awayTeamName].some(n => normalize(n) === normalize(name))).length, 1);
  }
  assert.notEqual(homeTotal, awayTotal, `Tied primary exception evidence ${key}`);
  const derivedWinner = homeTotal > awayTotal ? f.homeTeamName : f.awayTeamName;
  assert.equal(normalize(derivedWinner), normalize(def.primaryWinner));
  assert.equal(normalize(e.primaryChampion ?? e.champion), normalize(derivedWinner));
  if (e.wikiChampion) assert.equal(normalize(e.wikiChampion), normalize(def.publishedWinner));
  assert(sources.get(key)?.some(s => normalize(s.winner) === normalize(def.publishedWinner)), `Missing exact published discrepancy for ${key}`);
  exceptions.set(key, { ...def, derivedWinner, homeTotal, awayTotal, evidenceFile, finalMatchId: f.matchId, previousMatchIds: previous.matches.map(m => m.matchId) });
}
const winnerMismatches = [], acceptedSourceExceptions = [];
for (const row of rows) {
  const matchingSource = row.sources.find(s => normalize(s.winner) === normalize(row.storedWinner));
  const exception = exceptions.get(`${row.cupId}:${row.season}`);
  if (matchingSource && !exception) { row.status = 'published-winner-agreement'; continue; }
  if (exception && normalize(row.storedWinner) === normalize(exception.derivedWinner)
    && row.sources.some(s => normalize(s.winner) === normalize(exception.publishedWinner))) {
    row.status = 'primary-verified-public-source-error';
    acceptedSourceExceptions.push({ ...row, ...exception });
  } else {
    row.status = 'winner-mismatch';
    winnerMismatches.push(row);
  }
}
const report = { checkedAt: new Date().toISOString(), rows: rows.length, countries: new Set(rows.map(r => r.country)).size, sourcedRows: rows.length - missingSources.length, missingSources, winnerMismatches, acceptedSourceExceptions, additionalRows: additionalKeys.size, additionalCountries: additional.length, comparisons: rows };
writeFileSync('qa/cup-complete-early-source-coverage.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ rows: report.rows, countries: report.countries, sourcedRows: report.sourcedRows, missingSources, acceptedSourceExceptions: acceptedSourceExceptions.map(r => ({ cupId: r.cupId, season: r.season, winner: r.derivedWinner })), winnerMismatches: winnerMismatches.map(r => ({ country: r.country, cupId: r.cupId, season: r.season, storedWinner: r.storedWinner, publishedWinners: r.sources.map(s => s.winner) })) }, null, 2));
assert.equal(rows.length, 619, 'Early stored population changed; review scope explicitly');
assert.equal(report.countries, 88);
assert.equal(missingSources.length, 0, 'Unsourced early stored winner');
const inScopeExceptions = new Set(rows.map(r => `${r.cupId}:${r.season}`).filter(key => exceptions.has(key)));
assert.deepEqual(new Set(acceptedSourceExceptions.map(r => `${r.cupId}:${r.season}`)), inScopeExceptions, 'Every in-scope source exception must retain its primary-verified winner');
assert.equal(winnerMismatches.length, 0, 'Stored early cup winner differs from its independently published winner');
