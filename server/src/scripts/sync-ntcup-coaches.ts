import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { attributeNtCupCoaches } from '../sync/ntCups.js';
import type { CoachTenure } from '../sync/worldCup.js';
import type { TokenPair } from '../chpp/auth.js';

/**
 * Attribute each regional national-team cup season to the coach in charge when its final was
 * played, from the SAME coaching-tenure history the World Cup attribution uses (NTFormerCoaches,
 * committed as the seed worldcup-coaches.json) — so a coach's World Cup and regional titles are
 * credited on identical evidence.
 *
 *   OAUTH_ACCESS_STASH=.oauth-access.json npm run sync:ntcup-coaches -w server
 *
 * IN=<path> (a .jsonl) is MERGED on top of the seed rather than replacing it — the regional cups
 * are won by nations the World Cup seed never needed, so a top-up scrape of just those teams still
 * leaves the seed's teams attributable in the same run. Idempotent: every season's attribution is
 * recomputed from the combined tenure list on each run.
 */
const access: TokenPair = JSON.parse(readFileSync(process.env.OAUTH_ACCESS_STASH ?? '.oauth-access.json', 'utf8'));
const seed: CoachTenure[] = JSON.parse(readFileSync(new URL('../sync/worldcup-coaches.json', import.meta.url), 'utf8'));
const extra: CoachTenure[] = process.env.IN
  ? readFileSync(process.env.IN, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  : [];
// A team present in IN replaces its seed rows outright (a re-scrape is the newer truth), rather
// than interleaving two copies of the same tenure list.
const replaced = new Set(extra.map((t) => t.teamId));
const tenures: CoachTenure[] = [...seed.filter((t) => !replaced.has(t.teamId)), ...extra];
console.log(`tenures: ${seed.length} seed + ${extra.length} scraped -> ${tenures.length} (${replaced.size} team(s) refreshed)`);

const r = await attributeNtCupCoaches(access, tenures);
console.log(`attributed ${r.attributed}/${r.eligible} national-cup seasons to a coach`);
console.log(`medal places (silver + bronze): ${r.medals}/${r.medalSlots} attributed`);

const rows = await prisma.nationalCupChampion.findMany({ where: { champion: { not: null } }, orderBy: [{ cupName: 'asc' }, { season: 'desc' }] });
for (const row of rows) {
  console.log(`  ${row.cupName} S${row.season}: ${row.champion} — ${row.championUserName ?? (row.championUserId === 0 ? 'deleted/bot' : 'unresolved')}`);
}
await prisma.$disconnect();
