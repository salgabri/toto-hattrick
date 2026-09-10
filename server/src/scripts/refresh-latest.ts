import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { refreshLatestChampions } from '../sync/refreshLatest.js';
import { enrichUserNationalities } from '../sync/enrichManagers.js';
import { syncMasters } from '../sync/masters.js';
import { bakeStatic } from '../sync/bake.js';
import type { TokenPair } from '../chpp/auth.js';

/**
 * Keep the champion-club lists current. Pulls the LATEST seasons and re-bakes the static JSON.
 * Historical manager attribution is a separate evidence-based recovery step; this refresh never
 * infers an old winner from the current owner or another title held by the same club name.
 *
 *   OAUTH_ACCESS_STASH=... npm run refresh:latest -w server
 *
 * Env knobs:
 *   LOOKBACK=3        seasons to fetch for a competition with no settled season yet (default 3)
 *   LEAGUES=4,2       restrict to these leagueIds (default: all seeded countries)
 *   OUT=../web/public/data   bake target (default: the web's public/data dir)
 *   SKIP_MANAGERS=1   skip known-manager nationality enrichment and the additional Masters fact sync
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
  console.warn('Historical manager attribution is deferred: current-owner and club-name approximations are disabled. Use recover:historical-winners with saved history evidence.');
  // The global Masters fact sync adds missing finals/team IDs and preserves owner sentinels.
  // Its missing historical managers are recovered separately, like domestic title holders.
  // Full runs only — a league-scoped refresh leaves the global Masters alone.
  if (!onlyLeagueIds) {
    const globalSeason = (await prisma.nationalLeague.aggregate({ _max: { currentSeason: true } }))._max.currentSeason ?? 95;
    const mr = await syncMasters(access, { currentSeason: globalSeason });
    console.log(`Masters facts: +${mr.seasonsStored} new edition(s); latest club ${mr.latestChampion ?? '—'}`);
  }
  const n = await enrichUserNationalities(access, {});
  console.log(`Known-manager nationalities: ${n.resolved} resolved, ${n.unknown} unknown, ${n.errors} errors (${n.processed} attempted)`);
}

if (!process.env.SKIP_BAKE) {
  const out = process.env.OUT ?? '../web/public/data';
  const b = await bakeStatic(out);
  console.log(`baked -> ${out}: ${b.managers} managers, ${b.leagues} leagues (${b.champions} titles), ${b.cups} cup countries (${b.cupFinals} finals)`);
}

console.log(`done @ ${new Date().toISOString()}`);
await prisma.$disconnect();
