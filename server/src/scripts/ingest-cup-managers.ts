import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { enrichUserNationalities } from '../sync/enrichManagers.js';
import type { TokenPair } from '../chpp/auth.js';

/**
 * Apply history-scraped owners to cup finals. Input is the scraper's JSONL — one
 * {teamId, season, userId, name} per line (cups.jsonl). Sets CupChampion.championUserId for the
 * matching (championTeamId, season), upserts the manager, then resolves nationalities for any new
 * managers so the leaderboard filter and cabinets pick them up. Resume-safe / idempotent.
 */
const recs: Array<{ teamId: number; season: number; userId: number; name: string }> = readFileSync(process.env.IN!, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));
console.log(`ingesting ${recs.length} scraped cup-owner records`);

let updated = 0;
for (const r of recs) {
  if (!r.userId || !r.name) continue;
  await prisma.hattrickUser.upsert({ where: { userId: r.userId }, update: { loginName: r.name }, create: { userId: r.userId, loginName: r.name } });
  const res = await prisma.cupChampion.updateMany({
    where: { championTeamId: r.teamId, season: r.season },
    data: { championUserId: r.userId, championUserName: r.name },
  });
  updated += res.count;
}
console.log(`updated ${updated} cup finals; resolving nationalities for new managers…`);

const access: TokenPair = JSON.parse(readFileSync(process.env.OAUTH_ACCESS_STASH!, 'utf8'));
const n = await enrichUserNationalities(access);
console.log(`nationalities: ${n.processed} users processed`);

const done = await prisma.cupChampion.count({ where: { championUserId: { gt: 0 } } });
const total = await prisma.cupChampion.count();
console.log(`DONE: ${done}/${total} cup finals attributed to a manager`);
await prisma.$disconnect();
