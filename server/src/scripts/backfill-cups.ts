import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { backfillCups } from '../sync/backfillCups.js';
import { attributeByClub } from '../sync/attributeByClub.js';
import { enrichUserNationalities } from '../sync/enrichManagers.js';
import { bakeStatic } from '../sync/bake.js';
import type { TokenPair } from '../chpp/auth.js';

/**
 * ONE batch of the full cup materialisation. Spends up to MAX_CALLS CHPP calls turning placeholder
 * finals into real, attributed ones, then re-bakes so the new cabinet entries go live. Everything is
 * committed as it goes — hitting the quota (or Ctrl-C) loses nothing; just run it again to continue.
 * Re-run until it reports `remaining` stops falling (what's left then needs the ownership scrape).
 *
 *   MAX_CALLS=1200 npm run backfill:cups -w server
 *
 * Env:
 *   MAX_CALLS=1200          CHPP call budget for this run (keep under your remaining daily quota)
 *   OWNERS=0                materialise + resolve teamIds only; leave owners for the scrape
 *   LEAGUES=4,11            restrict to these leagueIds
 *   OAUTH_ACCESS_STASH=...  token path (defaults to server/.oauth-access.json)
 *   OUT=../web/public/data  bake target · SKIP_BAKE=1 to update the DB only
 */
const stashPath = process.env.OAUTH_ACCESS_STASH ?? '.oauth-access.json';
const access: TokenPair = JSON.parse(readFileSync(stashPath, 'utf8'));
const maxCalls = Number(process.env.MAX_CALLS) || 1200;
const attributeOwners = process.env.OWNERS !== '0';
const onlyLeagueIds = process.env.LEAGUES
  ? process.env.LEAGUES.split(',').map(Number).filter((n) => !Number.isNaN(n))
  : undefined;

const before = await prisma.cupChampion.count({ where: { championUserId: { gt: 0 } } });
const total = await prisma.cupChampion.count();
console.log(`backfill:cups @ ${new Date().toISOString()} — budget ${maxCalls} calls, owners ${attributeOwners ? 'on' : 'off'}${onlyLeagueIds ? `, leagues ${onlyLeagueIds.join(',')}` : ''}`);
console.log(`start: ${before}/${total} finals attributed`);

const r = await backfillCups(access, { maxCalls, attributeOwners, onlyLeagueIds });

const stopReason = r.aborted ? 'ABORTED (quota/outage — a run of failures)' : r.budgetHit ? 'budget reached' : 'no more work in scope';
console.log(`\nstopped: ${stopReason}`);
console.log(`  calls: ${r.calls}`);
console.log(`  materialised finals (finalMatchId): ${r.materialized}`);
console.log(`  teamIds resolved:                   ${r.teamIdsResolved}`);
console.log(`  attributed to owner:                ${r.attributed}`);
console.log(`  owner unresolvable (deleted/bot):   ${r.unresolvedOwners}`);
console.log(`  cup finals still without a manager: ${r.remaining}`);

// Cheap wins that need no API: bridge any freshly-materialised final whose club won a league.
const cb = await attributeByClub();
if (cb.cupFinals || cb.leagueTitles) console.log(`by-club bridge: +${cb.cupFinals} cup finals, +${cb.leagueTitles} league titles`);

const after = await prisma.cupChampion.count({ where: { championUserId: { gt: 0 } } });
console.log(`end: ${after}/${total} finals attributed (+${after - before} this run)`);

// Resolve nationality for any managers this run just upserted, so they don't bake as "Unknown".
// Self-healing and quota-friendly: only touches rows still null, so a partial run finishes next time.
const nat = await enrichUserNationalities(access);
if (nat.processed) console.log(`nationalities: ${nat.resolved} resolved, ${nat.unknown} unknown, ${nat.errors} errors (${nat.processed} attempted)`);

if (!process.env.SKIP_BAKE) {
  const out = process.env.OUT ?? '../web/public/data';
  const b = await bakeStatic(out);
  console.log(`baked -> ${out}: ${b.managers} managers, ${b.cups} cup countries (${b.cupFinals} finals)`);
}
console.log(`done @ ${new Date().toISOString()}${r.aborted || r.budgetHit ? ' — re-run to continue' : ''}`);
await prisma.$disconnect();
