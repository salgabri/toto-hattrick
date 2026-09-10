// Run from server/: node ../qa/live-source-audit.mjs
// Read-only, bounded metadata checks. Never fetches match histories or match details.
import { readFileSync, writeFileSync } from 'node:fs';
import { env } from '../server/dist/config/env.js';
import { fetchWorldDetails } from '../server/dist/chpp/endpoints.js';
import { parseWorldDetailsCups } from '../server/dist/schemas/index.js';

const token = JSON.parse(readFileSync(env.OAUTH_ACCESS_STASH, 'utf8'));
const leagues = JSON.parse(readFileSync(new URL('../web/public/data/leagues.json', import.meta.url)));
const cups = JSON.parse(readFileSync(new URL('../web/public/data/cups.json', import.meta.url)));
const report = { checkedAt: new Date().toISOString(), scope: 'Live CHPP worlddetails v1.9 metadata only; five countries; no stored match re-fetch', checks: [] };
for (const id of [4, 1, 21, 25, 156]) {
  try {
    const actual = parseWorldDetailsCups(await fetchWorldDetails(token, id));
    const bakedLeague = leagues.find(l => l.leagueId === id);
    const bakedCups = cups.find(l => l.leagueId === id)?.cups ?? [];
    const nationalCups = actual.cups.filter(c => c.cupLeagueLevel === 0);
    report.checks.push({ leagueId: id, country: actual.englishName, currentSeason: actual.currentSeason,
      latestBakedLeagueSeason: Math.max(0, ...(bakedLeague?.champions ?? []).map(c => c.season)),
      apiCupCount: nationalCups.length, bakedCupCount: bakedCups.length,
      missingCupIds: nationalCups.filter(c => !bakedCups.some(b => b.cupId === c.cupId)).map(c => c.cupId),
      classificationMismatches: nationalCups.flatMap(c => {
        const b = bakedCups.find(b => b.cupId === c.cupId);
        return b && (b.isMain !== (c.cupLevel === 1) || b.cupLevel !== c.cupLevel || b.cupLevelIndex !== c.cupLevelIndex)
          ? [{ cupId: c.cupId, api: c, baked: { isMain: b.isMain, cupLevel: b.cupLevel, cupLevelIndex: b.cupLevelIndex } }] : [];
      }) });
  } catch (error) {
    // Do not persist raw upstream error bodies, signed URLs, or authentication values.
    report.checks.push({ leagueId: id, errorType: error?.name ?? 'Error', status: String(error?.message).match(/failed \((\d+)\)/)?.[1] ?? 'request-or-validation-failed' });
  }
}
writeFileSync(new URL('./live-source-results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
