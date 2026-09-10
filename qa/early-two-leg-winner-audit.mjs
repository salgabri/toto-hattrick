// Frozen source observations, compared with the pre-repair archive using read-only SQLite.
// No CHPP requests, stored-final re-fetches, database writes, or inferred manager identities.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = (title, oldid) => ({
  url: `https://wiki.hattrick.org/wiki/${title}`,
  revisionUrl: `https://wiki.hattrick.org/index.php?title=${title}&oldid=${oldid}`,
  kind: 'HattrickWiki historical season/final table (community maintained)',
});
const scopes = [
  { country: 'England', cupId: 3, first: 15, last: 24, ...source('England', 421313),
    winners: { 15: 'Kline United', 16: 'Kester County', 17: 'Kester County', 18: 'The Knights who say Ni!', 19: 'The Knights who say Ni!', 20: 'Durham City FC', 21: 'Durham City FC', 22: 'Durham City FC', 23: 'Durham City FC', 24: 'Apollo' } },
  { country: 'Italy', cupId: 7, first: 15, last: 24, ...source('Coppa_Italia', 442523),
    winners: { 15: 'Branzolino A.C.', 16: 'Branzolino A.C.', 17: 'A.S. Roma Calcio', 18: 'Plastic Red', 19: 'Plastic Red', 20: 'Plastic Red', 21: 'Sgainator F.C.', 22: 'Para Para', 23: 'Arezzo', 24: 'Arezzo' } },
  { country: 'Poland', cupId: 25, first: 3, last: 12, ...source('Puchar_Polski', 352459),
    winners: { 3: 'Twisters', 4: 'Legia Warszawa', 5: 'Dziobaki', 6: 'Ullandia', 7: 'Rude Boyz', 8: 'MKS Narew Ostroleka', 9: 'MKS Narew Ostroleka', 10: 'High Speed Chase', 11: '-Tornado-', 12: 'Dziobaki' } },
  { country: 'Belgium', cupId: 41, first: 2, last: 11, ...source('Belgium_Cup', 201541),
    winners: { 2: 'FC Lubbeek', 3: 'huuubs', 4: 'Lokomotiv Veltem', 5: 'Malinois', 6: 'FC Drummer', 7: 'Koninklijke Heusden-Zolder', 8: 'Poets and Madmen', 9: 'Berzerk Oostende', 10: 'Deuzeld Sport', 11: 'advoce1' } },
  { country: 'Brazil', cupId: 15, first: 3, last: 12, ...source('Copa_do_Brasil', 508737),
    winners: { 3: 'Distrito Federal', 4: 'Inter RS', 5: 'Inter RS', 6: 'Petropolitano', 7: 'Alfabarra', 8: 'Fim de Carreira F.C.', 9: 'Inter RS', 10: 'Alfabarra', 11: 'Alfabarra', 12: 'Alfabarra' } },
];
const facts = [
  { cupId: 7, season: 17, champion: 'A.S. Roma Calcio', runnerUp: "Kender's F.C.", firstLeg: [7, 3], secondLeg: [0, 1], aggregate: [7, 4] },
  { cupId: 25, season: 3, champion: 'Twisters', runnerUp: 'Legia Gdansk', firstLeg: [4, 1], secondLeg: [1, 3], aggregate: [5, 4] },
  { cupId: 25, season: 7, champion: 'Rude Boyz', runnerUp: 'ZKS Masarnia Miesiw Pcin Dolny', firstLeg: [5, 0], secondLeg: [1, 2], aggregate: [6, 2] },
  { cupId: 25, season: 11, champion: '-Tornado-', runnerUp: 'Dziobaki', firstLeg: [5, 0], secondLeg: [0, 3], aggregate: [5, 3] },
  { cupId: 41, season: 4, champion: 'Lokomotiv Veltem', runnerUp: 'FC Drummer', firstLeg: [4, 1], secondLeg: [1, 2], aggregate: [5, 3], sourceMatchIds: [3545479, 3545480] },
];
const clean = value => value.normalize('NFC').replace(/\s+/g, ' ').trim();
const canonical = row => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const backupPath = fileURLToPath(new URL('../.backup/qa-fixes-20260911/dev.db', import.meta.url));
const db = new DatabaseSync(backupPath, { readOnly: true });
const report = {
  checkedAt: new Date().toISOString(), sourceCheckedOn: '2026-09-11',
  database: '.backup/qa-fixes-20260911/dev.db', databaseSha256: sha256(readFileSync(backupPath)),
  scope: 'Existing early main-cup winners through global season 24, for five countries. Missing rows are excluded from mismatch and comparison counts.',
  scorePerspective: 'Each source leg/aggregate pair is [cup champion, runner-up], not asserted home/away order.',
  sourceLimitations: [
    'Wiki tables supply historical cup-winner evidence, not new CHPP winner responses.',
    'No numeric winning club or historical manager identity is inferred from a team name.',
    'Poland comparison uses the explicit season Finals table; its separate overall-victories list is not a season-by-season oracle.',
    'England uses the national-trophies table cup column because the English_Cup page could not be opened.',
  ],
  reviewed: [], mismatches: [], knownGapsExcluded: [], totals: {},
};
try {
  for (const scope of scopes) {
    const rows = db.prepare('SELECT * FROM CupChampion WHERE cupId=? AND isMain=1 AND season BETWEEN ? AND ? ORDER BY season').all(scope.cupId, scope.first, scope.last);
    const comparisons = rows.map(row => ({ season: row.season, storedChampion: row.championTeamName,
      verifiedChampion: scope.winners[row.season], matches: clean(row.championTeamName) === clean(scope.winners[row.season]) }));
    report.reviewed.push({ country: scope.country, cupId: scope.cupId, localSeasonRange: [scope.first, scope.last],
      sourceUrl: scope.url, revisionUrl: scope.revisionUrl, sourceKind: scope.kind,
      compared: comparisons.length, agreed: comparisons.filter(c => c.matches).length, comparisons });
    for (let season = scope.first; season <= scope.last; season++) {
      if (!rows.some(row => row.season === season)) report.knownGapsExcluded.push({ cupId: scope.cupId, season, country: scope.country });
    }
    for (const row of rows) {
      if (clean(row.championTeamName) === clean(scope.winners[row.season])) continue;
      const fact = facts.find(f => f.cupId === row.cupId && f.season === row.season);
      if (!fact || fact.runnerUp !== row.championTeamName || fact.champion !== scope.winners[row.season]) throw new Error(`Unreviewed mismatch ${row.cupId}/${row.season}`);
      report.mismatches.push({ ...fact, country: scope.country, sourceUrl: scope.url, revisionUrl: scope.revisionUrl,
        sourceKind: scope.kind, before: row, beforeSha256: sha256(canonical(row)),
        verifiedChampionTeamId: null, verifiedChampionUserId: null, verifiedChampionUserName: null,
        correction: { championTeamName: fact.champion, runnerUpTeamName: row.championTeamName,
          championTeamId: null, championUserId: null, championUserName: null, penalties: 0 },
        scoreHandling: row.finalMatchId === 0 ? 'Retain unavailable stored 0/0 score placeholders; Wiki scores are winner-perspective only.' : 'Preserve stored actual final-leg home/away scores.',
      });
    }
  }
} finally { db.close(); }
report.totals = { compared: report.reviewed.reduce((sum, c) => sum + c.compared, 0),
  agreed: report.reviewed.reduce((sum, c) => sum + c.agreed, 0), mismatches: report.mismatches.length,
  knownGapsExcluded: report.knownGapsExcluded.length,
  incorrectManagerAttributionsToClear: report.mismatches.filter(r => r.before.championUserId !== null).length };
writeFileSync(new URL('./early-two-leg-winner-review.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.totals, null, 2));
