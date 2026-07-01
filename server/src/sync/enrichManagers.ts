import { prisma } from '../db/client.js';
import type { TokenPair } from '../chpp/auth.js';
import { chppGet } from '../chpp/client.js';

/**
 * Resolve the manager (and their nationality) behind every champion team.
 *
 * Pass 1 — teamdetails(championTeamId) → current owner userId + login + bot flag. Applied to all
 *   LeagueChampion rows sharing that team. Unresolvable teams (deleted/bot/no owner) get
 *   championUserId = 0 (a sentinel) so resume passes skip them; the leaderboard ignores 0.
 * Pass 2 — managercompendium(userId) → manager's Country = nationality.
 *
 * Caveat: teamdetails gives the team's CURRENT owner; for old titles that may differ from who
 * actually won. CHPP exposes no historical ownership.
 */

const PACING_MS = 500;
const UNKNOWN = 0; // championUserId sentinel for bot/abandoned/deleted teams
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const asArray = (x: unknown): any[] => (Array.isArray(x) ? x : x ? [x] : []);

export async function enrichChampionManagers(token: TokenPair, opts: { limit?: number } = {}): Promise<{ processed: number; resolved: number }> {
  const teams = await prisma.leagueChampion.findMany({
    where: { championUserId: null },
    distinct: ['championTeamId'],
    select: { championTeamId: true },
  });
  let processed = 0;
  let resolved = 0;
  for (const { championTeamId: teamId } of teams) {
    if (opts.limit && processed >= opts.limit) break;
    processed++;
    let userId: number | null = null;
    let loginName: string | null = null;
    let isBot = false;
    try {
      const h = ((await chppGet(token, { file: 'teamdetails', version: '3.6', teamID: teamId })) as any).HattrickData;
      userId = Number(h?.User?.UserID) || null;
      loginName = h?.User?.Loginname ?? null;
      const teamNode = asArray(h?.Teams?.Team).find((t) => Number(t.TeamID) === teamId) ?? asArray(h?.Teams?.Team)[0];
      isBot = teamNode?.BotStatus?.IsBot === 'True';
    } catch {
      // team likely deleted — fall through to sentinel
    }

    if (userId && loginName) {
      await prisma.hattrickUser.upsert({ where: { userId }, update: { loginName, isBot }, create: { userId, loginName, isBot } });
      await prisma.leagueChampion.updateMany({ where: { championTeamId: teamId }, data: { championUserId: userId, championUserName: loginName } });
      resolved++;
    } else {
      await prisma.leagueChampion.updateMany({ where: { championTeamId: teamId }, data: { championUserId: UNKNOWN } });
    }
    if (processed % 100 === 0) console.log(`  managers: ${processed}/${teams.length} teams (${resolved} resolved)`);
    await sleep(PACING_MS);
  }
  return { processed, resolved };
}

export async function enrichUserNationalities(token: TokenPair, opts: { limit?: number } = {}): Promise<{ processed: number }> {
  const users = await prisma.hattrickUser.findMany({ where: { nationality: null }, select: { userId: true } });
  let processed = 0;
  for (const { userId } of users) {
    if (opts.limit && processed >= opts.limit) break;
    processed++;
    try {
      const m = ((await chppGet(token, { file: 'managercompendium', version: '1.5', userId })) as any).HattrickData?.Manager;
      const countryId = Number(m?.Country?.CountryId) || null;
      const nationality = m?.Country?.CountryName ?? 'Unknown';
      await prisma.hattrickUser.update({ where: { userId }, data: { countryId, nationality } });
    } catch {
      await prisma.hattrickUser.update({ where: { userId }, data: { nationality: 'Unknown' } });
    }
    if (processed % 100 === 0) console.log(`  nationalities: ${processed}/${users.length} users`);
    await sleep(PACING_MS);
  }
  return { processed };
}
