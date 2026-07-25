import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { refreshLatestChampions } from '../sync/refreshLatest.js';
import { enrichChampionManagers, enrichRecentCupManagers, enrichUserNationalities } from '../sync/enrichManagers.js';
import { bakeStatic } from '../sync/bake.js';
import type { TokenPair } from '../chpp/auth.js';

/**
 * Keep the champion lists current. Pulls only the LATEST seasons (not a full backfill), attributes
 * the new league champions to their manager, then re-bakes the static JSON the site reads. Cheap
 * and resume-safe — run it whenever Hattrick seasons roll over.
 *
 *   OAUTH_ACCESS_STASH=... npm run refresh:latest -w server
 *
 * Env knobs:
 *   LOOKBACK=3        seasons to fetch for a competition with no settled season yet (default 3)
 *   LEAGUES=4,2       restrict to these leagueIds (default: all seeded countries)
 *   OUT=../web/public/data   bake target (default: the web's public/data dir)
 *   SKIP_MANAGERS=1   skip the manager/nationality attribution pass
 *   SKIP_BAKE=1       skip the static re-bake (DB is still updated)
 *
 * Prereq: leagues and cups must already be seeded/backfilled once (backfill-all, sync-cups seed).
 * This script advances them; it does not bootstrap an empty DB.
 */
const access: TokenPair = JSON.parse(readFileSync(process.env.OAUTH_ACCESS_STASH!, 'utf8'));
const lookback = Number(process.env.LOOKBACK) || 3;
const onlyLeagueIds = process.env.LEAGUES
  ? process.env.LEAGUES.split(',').map(Number).filter((n) => !Number.isNaN(n))
  : undefined;

console.log(`refresh-latest @ ${new Date().toISOString()} (lookback=${lookback}${onlyLeagueIds ? `, leagues=${onlyLeagueIds.join(',')}` : ''})`);

const r = await refreshLatestChampions(access, { lookback, onlyLeagueIds });
console.log(`champions added: +${r.leagueChampionsAdded} league, +${r.cupChampionsAdded} cup (${r.leaguesAdvanced} countries advanced)`);

if (!process.env.SKIP_MANAGERS) {
  const m = await enrichChampionManagers(access, {});
  // Attribute the recent cup winners we just added (current owner == the actual winner for a
  // recent season). Older unattributed finals stay queued for the ownership-history scrape.
  const c = await enrichRecentCupManagers(access, { lookback });
  const n = await enrichUserNationalities(access, {});
  console.log(`managers: league ${m.resolved}/${m.processed}, cup ${c.resolved}/${c.processed} newly resolved; +${n.processed} nationalities`);
}

if (!process.env.SKIP_BAKE) {
  const out = process.env.OUT ?? '../web/public/data';
  const b = await bakeStatic(out);
  console.log(`baked -> ${out}: ${b.managers} managers, ${b.leagues} leagues (${b.champions} titles), ${b.cups} cup countries (${b.cupFinals} finals)`);
}

console.log(`done @ ${new Date().toISOString()}`);
await prisma.$disconnect();
