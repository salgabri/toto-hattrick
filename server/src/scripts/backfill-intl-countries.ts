import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { backfillIntlTeamCountries, INTERNATIONAL_CUP_IDS, UNRESOLVED_LEAGUE } from '../sync/intlTeamCountries.js';
import type { TokenPair } from '../chpp/auth.js';

/**
 * Resolve the home country of every Hattrick Masters / Seasonal Cup winner (see
 * sync/intlTeamCountries.ts). Resume-safe; run any time, and again after a new edition lands.
 *   npm run backfill:intl-countries -w server
 * Env: OAUTH_ACCESS_STASH (default .oauth-access.json), LIMIT to cap CHPP calls. Bake separately.
 */
const access: TokenPair = JSON.parse(readFileSync(process.env.OAUTH_ACCESS_STASH ?? '.oauth-access.json', 'utf8'));
const limit = Number(process.env.LIMIT) || undefined;

console.log(`backfill:intl-countries @ ${new Date().toISOString()}${limit ? ` (limit ${limit} calls)` : ''}`);
const r = await backfillIntlTeamCountries(access, { limit });
console.log(`team ids replayed from the ingest files: ${r.teamIdsFromIngest}`);
console.log(`domestic record: ${r.homeFilled} filled, ${r.homeCorrected} corrected`);
console.log(`rows processed ${r.processed} — ${r.resolved} resolved, ${r.unresolved} unresolvable (${r.calls} CHPP calls)`);

const rows = await prisma.cupChampion.findMany({
  where: { cupId: { in: INTERNATIONAL_CUP_IDS } },
  select: { championLeagueId: true },
});
const known = rows.filter((c) => (c.championLeagueId ?? 0) > UNRESOLVED_LEAGUE).length;
const pending = rows.filter((c) => c.championLeagueId == null).length;
console.log(`coverage: ${known}/${rows.length} international champions have a country (${pending} still untried)`);

await prisma.$disconnect();
