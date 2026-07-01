import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { seedCups, syncAllCupChampions, enrichCupTeamIds } from '../sync/cups.js';
import type { TokenPair } from '../chpp/auth.js';

/**
 * Cup honours runner. Resume-safe — re-run any phase to continue after an interruption.
 *   MODE=seed     tsx src/scripts/sync-cups.ts   → seed the Cup catalog from worlddetails
 *   MODE=harvest  ...                            → walk cupmatches for every cup's winners
 *   MODE=teamids  ...                            → resolve winner teamIds via matchdetails
 * Optional: LEAGUES=4,2  (seed) · CUPS=7,515 (harvest) · LIMIT=500 (teamids).
 */
const access: TokenPair = JSON.parse(readFileSync(process.env.OAUTH_ACCESS_STASH!, 'utf8'));
const mode = process.env.MODE ?? 'seed';
const ids = (v?: string) => (v ? v.split(',').map(Number).filter((n) => !Number.isNaN(n)) : undefined);

console.log(`cups ${mode} @ ${new Date().toISOString()}`);
if (mode === 'seed') {
  await seedCups(access, { onlyLeagueIds: ids(process.env.LEAGUES) });
  console.log(`cup catalog: ${await prisma.cup.count()} cups`);
} else if (mode === 'harvest') {
  await syncAllCupChampions(access, { onlyCupIds: ids(process.env.CUPS) });
  const total = await prisma.cupChampion.count();
  const cups = (await prisma.cupChampion.groupBy({ by: ['cupId'] })).length;
  console.log(`winners: ${total} finals across ${cups} cups`);
} else if (mode === 'teamids') {
  await enrichCupTeamIds(access, { limit: Number(process.env.LIMIT) || undefined });
  const resolved = await prisma.cupChampion.count({ where: { championTeamId: { not: null } } });
  const total = await prisma.cupChampion.count();
  console.log(`teamIds resolved: ${resolved}/${total}`);
} else {
  console.log(`unknown MODE=${mode}`);
}
console.log(`done @ ${new Date().toISOString()}`);
await prisma.$disconnect();
