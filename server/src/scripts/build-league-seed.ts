import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chppGet } from '../chpp/client.js';
import { TOP_SERIES_BY_LEAGUE, NON_COUNTRY_LEAGUES } from '../data/topSeries.js';
import type { TokenPair } from '../chpp/auth.js';

const access: TokenPair = JSON.parse(readFileSync(process.env.OAUTH_ACCESS_STASH!, 'utf8'));

// 1) worlddetails (no leagueID) → name + current season for every league.
const wd = (await chppGet(access, { file: 'worlddetails', version: '1.9' })) as any;
const leagues = (Array.isArray(wd.HattrickData.LeagueList.League) ? wd.HattrickData.LeagueList.League : [wd.HattrickData.LeagueList.League]) as any[];
const info = new Map<number, { name: string; currentSeason: number }>();
for (const l of leagues) {
  info.set(Number(l.LeagueID), { name: l.EnglishName ?? l.LeagueName, currentSeason: Number(l.Season) });
}

// 2) Merge with the top-series map.
const seed = Object.entries(TOP_SERIES_BY_LEAGUE).map(([id, topSeriesId]) => {
  const leagueId = Number(id);
  const meta = info.get(leagueId);
  return {
    leagueId,
    countryName: meta?.name ?? `league ${leagueId}`,
    topSeriesId,
    currentSeason: meta?.currentSeason ?? null,
    isCountry: !NON_COUNTRY_LEAGUES.has(leagueId),
  };
}).sort((a, b) => a.leagueId - b.leagueId);

console.log(`seed entries: ${seed.length} (countries: ${seed.filter((s) => s.isCountry).length})`);
const missing = seed.filter((s) => s.currentSeason == null);
if (missing.length) console.log('⚠ no worlddetails season for:', missing.map((m) => m.leagueId).join(', '));

// 3) Validate a sample: leaguedetails(topSeriesId) must report that leagueID at level 1.
const sample = [1, 2, 3, 4, 7, 146, 36, 11, 46];
for (const leagueId of sample) {
  const topSeriesId = TOP_SERIES_BY_LEAGUE[leagueId];
  const h = ((await chppGet(access, { file: 'leaguedetails', version: '1.6', leagueLevelUnitID: topSeriesId })) as any).HattrickData;
  const ok = Number(h.LeagueID) === leagueId && Number(h.LeagueLevel) === 1;
  console.log(`${ok ? '✓' : '✗'} league ${leagueId} ${info.get(leagueId)?.name}: unit ${topSeriesId} -> leagueID ${h.LeagueID} level ${h.LeagueLevel} (${h.LeagueLevelUnitName})`);
}

mkdirSync('src/data', { recursive: true });
writeFileSync('src/data/leagues.json', JSON.stringify(seed, null, 2), 'utf8');
console.log('wrote src/data/leagues.json');
