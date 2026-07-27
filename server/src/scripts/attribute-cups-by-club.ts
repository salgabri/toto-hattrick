import 'dotenv/config';
import { prisma } from '../db/client.js';
import { attributeCupsByClub } from '../sync/attributeCupsByClub.js';
import { bakeStatic } from '../sync/bake.js';

/**
 * Credit unattributed cup finals to a manager by bridging the winning club name to that country's
 * league champions (see sync/attributeCupsByClub.ts), then re-bake the static JSON. Zero CHPP calls
 * — safe to run any time; resume-safe. This is what pulls placeholder cup finals (which have no
 * teamId and so can't go through the current-owner or scrape paths) into manager cabinets.
 *
 *   npm run attribute:cups -w server
 *
 * Env: OUT=../web/public/data (bake target) · SKIP_BAKE=1 (update the DB only).
 */
const r = await attributeCupsByClub();
console.log(`cup-by-club: +${r.attributed} finals attributed (${r.ambiguousClubs} ambiguous clubs, ${r.ambiguousFinals} finals left for the scrape)`);

const done = await prisma.cupChampion.count({ where: { championUserId: { gt: 0 } } });
const total = await prisma.cupChampion.count();
console.log(`cup finals attributed: ${done}/${total}`);

if (!process.env.SKIP_BAKE) {
  const out = process.env.OUT ?? '../web/public/data';
  const b = await bakeStatic(out);
  console.log(`baked -> ${out}: ${b.managers} managers, ${b.cups} cup countries (${b.cupFinals} finals)`);
}

await prisma.$disconnect();
