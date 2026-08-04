import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { refreshLatestChampions } from '../sync/refreshLatest.js';
import { enrichChampionManagers, enrichRecentCupManagers, enrichUserNationalities } from '../sync/enrichManagers.js';
import { attributeByClub } from '../sync/attributeByClub.js';
import { syncMasters } from '../sync/masters.js';
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
  // Self-heal the global Hattrick Masters. It belongs to no country (leagueId 0), so neither the
  // national-cup pass above nor attributeByClub below can reach it — and an edition once pinned
  // to the UNKNOWN(0) sentinel is skipped forever by every null-only filter. syncMasters re-opens
  // those sentinels and re-attributes by current owner (Masters winners are elite, still-active
  // clubs, so the current owner == the actual winner even for old seasons). Runs before the
  // nationality pass so freshly-resolved owners get their country here too. Full runs only — a
  // league-scoped refresh leaves the global Masters alone.
  if (!onlyLeagueIds) {
    const globalSeason = (await prisma.nationalLeague.aggregate({ _max: { currentSeason: true } }))._max.currentSeason ?? 95;
    const mr = await syncMasters(access, { currentSeason: globalSeason });
    console.log(`masters self-heal: +${mr.seasonsStored} new edition(s); latest ${mr.latestChampion ?? '—'}`);
  }
  const n = await enrichUserNationalities(access, {});
  console.log(`managers: league ${m.resolved}/${m.processed}, cup ${c.resolved}/${c.processed} newly resolved; +${n.processed} nationalities`);
  // Bridge remaining unattributed cup finals (incl. older ones, and placeholders with no teamId that
  // the current-owner/scrape paths can't reach) via their winning club's league-title owner. No API.
  const cb = await attributeByClub();
  console.log(`by-club bridge: +${cb.cupFinals} cup finals, +${cb.leagueTitles} league titles (${cb.ambiguousRows} ambiguous left for the scrape)`);
}

if (!process.env.SKIP_BAKE) {
  const out = process.env.OUT ?? '../web/public/data';
  const b = await bakeStatic(out);
  console.log(`baked -> ${out}: ${b.managers} managers, ${b.leagues} leagues (${b.champions} titles), ${b.cups} cup countries (${b.cupFinals} finals)`);
}

console.log(`done @ ${new Date().toISOString()}`);
await prisma.$disconnect();
