import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { enrichUserNationalities } from '../sync/enrichManagers.js';
import type { TokenPair } from '../chpp/auth.js';

// Apply history-scraped champion managers from a JSONL file: {teamId, season, userId, name} per line.
interface Rec { teamId: number; season: number; userId: number; name: string }
const recs: Rec[] = readFileSync(process.env.IN!, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));
console.log(`ingesting ${recs.length} scraped manager records`);

let updated = 0;
for (const r of recs) {
  if (!r.userId || !r.name) continue;
  await prisma.hattrickUser.upsert({ where: { userId: r.userId }, update: { loginName: r.name }, create: { userId: r.userId, loginName: r.name } });
  const res = await prisma.leagueChampion.updateMany({
    where: { championTeamId: r.teamId, season: r.season },
    data: { championUserId: r.userId, championUserName: r.name },
  });
  updated += res.count;
}
console.log(`updated ${updated} champion rows; resolving nationalities for new managers…`);

const access: TokenPair = JSON.parse(readFileSync(process.env.OAUTH_ACCESS_STASH!, 'utf8'));
const n = await enrichUserNationalities(access);
console.log(`nationalities: ${n.processed} users processed`);

const titled = await prisma.leagueChampion.count({ where: { championUserId: { gt: 0 } } });
console.log(`DONE: ${titled} titles now attributed to a manager`);
await prisma.$disconnect();
