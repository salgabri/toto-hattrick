import 'dotenv/config';
import { prisma } from '../db/client.js';
import { bakeStatic } from '../sync/bake.js';

/**
 * Legacy command retained for coverage reporting and an optional re-bake of existing data.
 * It no longer credits managers by club-name similarity: a recycled name or team ID does not
 * prove the owner at an earlier win. Use recover:historical-winners for dated evidence instead.
 *
 *   npm run attribute:cups -w server
 *
 * Env: OUT=../web/public/data (bake target) · SKIP_BAKE=1 (update the DB only).
 */
console.warn('No manager attribution performed: the legacy club-name bridge is disabled. This command only reports coverage and optionally rebakes existing data. Use recover:historical-winners for missing owners.');

const done = await prisma.cupChampion.count({ where: { championUserId: { gt: 0 } } });
const total = await prisma.cupChampion.count();
console.log(`cup finals attributed: ${done}/${total}`);

if (!process.env.SKIP_BAKE) {
  const out = process.env.OUT ?? '../web/public/data';
  const b = await bakeStatic(out);
  console.log(`baked -> ${out}: ${b.managers} managers, ${b.cups} cup countries (${b.cupFinals} finals)`);
}

await prisma.$disconnect();
