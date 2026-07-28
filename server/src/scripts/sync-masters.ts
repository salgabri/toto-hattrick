import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { syncMasters, MASTERS_CUP_ID } from '../sync/masters.js';
import type { TokenPair } from '../chpp/auth.js';

/**
 * Reconstruct + attribute the Hattrick Masters (see sync/masters.ts). Resume-safe; run any time.
 *   npm run sync:masters -w server
 * Env: OAUTH_ACCESS_STASH (default .oauth-access.json). Bake separately (npm run bake).
 */
const access: TokenPair = JSON.parse(readFileSync(process.env.OAUTH_ACCESS_STASH ?? '.oauth-access.json', 'utf8'));

// Live global season = the highest currentSeason across tracked leagues (the Masters shares it).
const agg = await prisma.nationalLeague.aggregate({ _max: { currentSeason: true } });
const currentSeason = agg._max.currentSeason ?? 95;
console.log(`sync:masters @ ${new Date().toISOString()} — currentSeason ${currentSeason}`);

const r = await syncMasters(access, { currentSeason });
console.log(`stored ${r.seasonsStored} new editions (back to S${r.earliestSeason}); latest champion ${r.latestChampion ?? '—'}`);

const wins = await prisma.cupChampion.findMany({
  where: { cupId: MASTERS_CUP_ID },
  orderBy: { season: 'desc' },
  select: { season: true, championTeamName: true, championUserName: true, championUserId: true },
});
console.log(`total Masters editions in DB: ${wins.length}`);
const attributed = wins.filter((w) => (w.championUserId ?? 0) > 0).length;
console.log(`attributed to a live owner: ${attributed}/${wins.length}`);
console.log('recent editions:');
for (const w of wins.slice(0, 8)) console.log(`  S${w.season}: ${w.championTeamName} — ${w.championUserName ?? (w.championUserId === 0 ? 'deleted/bot' : 'unresolved')}`);

await prisma.$disconnect();
