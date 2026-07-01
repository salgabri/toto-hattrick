import { writeFileSync } from 'node:fs';
import { prisma } from '../db/client.js';

// EVERY champion team + its title seasons → history-scrape all to attribute each title to the
// owner at that season (teamdetails' current owner is wrong for sold/abandoned teams).
const OUT = process.env.OUT!;
const rows = await prisma.leagueChampion.findMany({
  where: { complete: true },
  select: { championTeamId: true, season: true },
});
const byTeam = new Map<number, number[]>();
for (const r of rows) {
  const a = byTeam.get(r.championTeamId) ?? [];
  a.push(r.season);
  byTeam.set(r.championTeamId, a);
}
const out = [...byTeam.entries()].map(([teamId, seasons]) => ({ teamId, seasons }));
writeFileSync(OUT, JSON.stringify(out));
console.log(`unresolved teams: ${out.length}, titles: ${rows.length} -> ${OUT}`);
await prisma.$disconnect();
