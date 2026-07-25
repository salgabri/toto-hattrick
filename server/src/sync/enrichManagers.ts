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

export interface TeamOwner {
  userId: number;
  loginName: string;
  isBot: boolean;
}

/** teamdetails(teamId) → the team's CURRENT owner, or null if deleted/bot/no owner. */
async function resolveTeamOwner(token: TokenPair, teamId: number): Promise<TeamOwner | null> {
  try {
    const h = ((await chppGet(token, { file: 'teamdetails', version: '3.6', teamID: teamId })) as any).HattrickData;
    const userId = Number(h?.User?.UserID) || null;
    const loginName = h?.User?.Loginname ?? null;
    if (!userId || !loginName) return null;
    const teamNode = asArray(h?.Teams?.Team).find((t) => Number(t.TeamID) === teamId) ?? asArray(h?.Teams?.Team)[0];
    return { userId, loginName, isBot: teamNode?.BotStatus?.IsBot === 'True' };
  } catch {
    return null; // team likely deleted — caller falls through to the sentinel
  }
}

export async function enrichChampionManagers(token: TokenPair, opts: { limit?: number } = {}): Promise<{ processed: number; resolved: number }> {
  const teams = await prisma.leagueChampion.findMany({
    // championTeamId > 0 skips reconstructed champions (placeholder team id 0) — no real team to
    // resolve an owner from. New champions carry a real teamId from leaguefixtures/standings.
    where: { championUserId: null, championTeamId: { gt: 0 } },
    distinct: ['championTeamId'],
    select: { championTeamId: true },
  });
  let processed = 0;
  let resolved = 0;
  for (const { championTeamId: teamId } of teams) {
    if (opts.limit && processed >= opts.limit) break;
    processed++;
    const owner = await resolveTeamOwner(token, teamId);
    if (owner) {
      await prisma.hattrickUser.upsert({ where: { userId: owner.userId }, update: { loginName: owner.loginName, isBot: owner.isBot }, create: { userId: owner.userId, loginName: owner.loginName, isBot: owner.isBot } });
      await prisma.leagueChampion.updateMany({ where: { championTeamId: teamId }, data: { championUserId: owner.userId, championUserName: owner.loginName } });
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

/**
 * Attribute the manager behind RECENT cup finals via the winning team's CURRENT owner.
 *
 * Bounded on purpose: for a final won within the last `lookback` seasons the current owner IS the
 * team that won it, so teamdetails is exact — the same model the league enricher uses. OLDER
 * unattributed finals are left null deliberately: there the current owner can differ from who won
 * back then, so they stay queued for the ownership-history scrape (export-cup-unresolved →
 * ingest-cup-managers). Requires championTeamId (run enrichCupTeamIds first). Resume-safe: only
 * touches recent rows still missing a manager, scoped to the exact (cupId, season) so it never
 * overwrites an older final resolved by the scrape.
 */
export async function enrichRecentCupManagers(
  token: TokenPair,
  opts: { lookback?: number } = {},
): Promise<{ processed: number; resolved: number }> {
  const lookback = opts.lookback ?? 3;
  const cups = await prisma.cup.findMany({ select: { cupId: true, currentSeason: true } });
  // Per-cup floor (season numbering is per-country). A cup with no known currentSeason is skipped
  // (Infinity) rather than risk mis-attributing everything.
  const floorByCup = new Map(cups.map((c) => [c.cupId, c.currentSeason == null ? Number.POSITIVE_INFINITY : c.currentSeason - lookback]));

  const pending = await prisma.cupChampion.findMany({
    where: { championUserId: null, championTeamId: { not: null } },
    select: { cupId: true, season: true, championTeamId: true },
    orderBy: { season: 'desc' },
  });
  const recent = pending.filter((c) => c.season >= (floorByCup.get(c.cupId) ?? Number.POSITIVE_INFINITY));

  const owners = new Map<number, TeamOwner | null>(); // resolve each team once
  let processed = 0;
  let resolved = 0;
  for (const c of recent) {
    const teamId = c.championTeamId!;
    if (!owners.has(teamId)) {
      owners.set(teamId, await resolveTeamOwner(token, teamId));
      processed++;
      await sleep(PACING_MS);
    }
    const owner = owners.get(teamId)!;
    if (owner) {
      await prisma.hattrickUser.upsert({ where: { userId: owner.userId }, update: { loginName: owner.loginName, isBot: owner.isBot }, create: { userId: owner.userId, loginName: owner.loginName, isBot: owner.isBot } });
      await prisma.cupChampion.update({ where: { cupId_season: { cupId: c.cupId, season: c.season } }, data: { championUserId: owner.userId, championUserName: owner.loginName } });
      resolved++;
    } else {
      await prisma.cupChampion.update({ where: { cupId_season: { cupId: c.cupId, season: c.season } }, data: { championUserId: UNKNOWN } });
    }
  }
  return { processed, resolved };
}
