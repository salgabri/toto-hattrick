import { prisma } from '../db/client.js';

/**
 * Free cup attribution: a cup winner that also won its league that same season (a "double") has a
 * known owner — LeagueChampion.championUserId for that (team, season). Copy it onto CupChampion.
 * Unblocked (no scraping); the ownership-history scrape fills the rest onto the same column.
 * Resume-safe: only touches rows still missing championUserId.
 */
const lc = await prisma.leagueChampion.findMany({
  where: { championUserId: { gt: 0 } },
  select: { championTeamId: true, season: true, championUserId: true, championUserName: true },
});
const owner = new Map<string, { id: number; name: string | null }>();
for (const c of lc) owner.set(`${c.championTeamId}:${c.season}`, { id: c.championUserId!, name: c.championUserName });

const pending = await prisma.cupChampion.findMany({
  where: { championUserId: null, championTeamId: { not: null } },
  select: { cupId: true, season: true, championTeamId: true },
});

let attributed = 0;
for (const c of pending) {
  const o = owner.get(`${c.championTeamId}:${c.season}`);
  if (!o) continue;
  await prisma.cupChampion.update({
    where: { cupId_season: { cupId: c.cupId, season: c.season } },
    data: { championUserId: o.id, championUserName: o.name },
  });
  attributed++;
}
const total = await prisma.cupChampion.count();
const done = await prisma.cupChampion.count({ where: { championUserId: { gt: 0 } } });
console.log(`attributed ${attributed} cup finals via doubles; ${done}/${total} cup finals now have a manager`);
await prisma.$disconnect();
