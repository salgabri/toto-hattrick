import { prisma } from '../db/client.js';
import type { TokenPair } from '../chpp/auth.js';
import { chppGet } from '../chpp/client.js';
import { z } from 'zod';

/**
 * Resolve the manager (and their nationality) behind every champion team.
 *
 * Pass 1 — teamdetails(championTeamId) → current owner userId + login + bot flag. Applied to all
 *   unresolved LeagueChampion rows sharing that team. A confirmed bot gets championUserId = 0
 *   (a sentinel); failed or incomplete responses stay pending for a later attempt.
 * Pass 2 — managercompendium(userId) → manager's Country = nationality.
 *
 * teamdetails gives the team's CURRENT owner, which may differ even for a recent title. Historical
 * attribution from it is disabled unless explicitly requested as an unverified approximation.
 * Use historicalWinners.ts for evidence-backed attribution after abandonment or ownership changes.
 */

const PACING_MS = 500;
export const UNKNOWN = 0; // championUserId sentinel for bot/abandoned/deleted teams
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Only fields observed in samples/teamdetails.xml (3.6). In particular, a missing User in an
// error/HTML/truncated response is NOT evidence that the winning manager retired. There is no
// captured deleted-team error shape yet, so such responses must stay retryable.
const OwnerTeamSchema = z.object({
  TeamID: z.coerce.number().int().positive(),
  BotStatus: z.object({ IsBot: z.enum(['True', 'False']) }),
});
const OwnerResponseSchema = z.object({
  HattrickData: z.object({
    FileName: z.literal('teamdetails.xml'),
    Version: z.literal('3.6'),
    Teams: z.object({
      Team: z.preprocess((value) => Array.isArray(value) ? value : [value], z.array(OwnerTeamSchema).min(1)),
    }),
    User: z.unknown().optional(),
  }),
});
const OwnerUserSchema = z.object({
  UserID: z.coerce.number().int().positive(),
  Loginname: z.string().trim().min(1),
});

export interface TeamOwner {
  userId: number;
  loginName: string;
  isBot: boolean;
}

/**
 * teamdetails(teamId) → the team's CURRENT owner, or null for a confirmed bot. Network, HTTP,
 * quota, unexpected-response and missing-owner failures throw so callers leave the winner pending.
 * A bot is a property of the club, not proof that its former manager's account is inactive.
 */
export async function resolveTeamOwner(token: TokenPair, teamId: number): Promise<TeamOwner | null> {
  const h = OwnerResponseSchema.parse(await chppGet(token, { file: 'teamdetails', version: '3.6', teamID: teamId })).HattrickData;
  const team = h.Teams.Team.find((candidate) => candidate.TeamID === teamId);
  if (!team) throw new Error(`CHPP teamdetails did not contain requested team ${teamId}`);
  if (team.BotStatus.IsBot === 'True') return null;
  const user = OwnerUserSchema.parse(h.User);
  return { userId: user.UserID, loginName: user.Loginname, isBot: false };
}

export async function enrichChampionManagers(token: TokenPair, opts: { limit?: number; allowUnverifiedCurrentOwner?: boolean } = {}): Promise<{ processed: number; resolved: number; errors: number }> {
  if (opts.allowUnverifiedCurrentOwner !== true) {
    console.log('League manager attribution awaits historical evidence; current-owner approximation is disabled.');
    return { processed: 0, resolved: 0, errors: 0 };
  }
  const teams = await prisma.leagueChampion.findMany({
    // championTeamId > 0 skips reconstructed champions (placeholder team id 0) — no real team to
    // resolve an owner from. New champions carry a real teamId from leaguefixtures/standings.
    where: { championUserId: null, championTeamId: { gt: 0 } },
    distinct: ['championTeamId'],
    select: { championTeamId: true },
  });
  let processed = 0;
  let resolved = 0;
  let errors = 0;
  for (const { championTeamId: teamId } of teams) {
    if (opts.limit && processed >= opts.limit) break;
    processed++;
    let owner: TeamOwner | null;
    try {
      owner = await resolveTeamOwner(token, teamId);
    } catch {
      // A failed attempt says nothing about the historical owner; preserve null for retries.
      errors++;
      await sleep(PACING_MS);
      continue;
    }
    if (owner) {
      await prisma.hattrickUser.upsert({ where: { userId: owner.userId }, update: { loginName: owner.loginName, isBot: owner.isBot }, create: { userId: owner.userId, loginName: owner.loginName, isBot: owner.isBot } });
      await prisma.leagueChampion.updateMany({ where: { championTeamId: teamId, championUserId: null }, data: { championUserId: owner.userId, championUserName: owner.loginName } });
      resolved++;
    } else {
      await prisma.leagueChampion.updateMany({ where: { championTeamId: teamId, championUserId: null }, data: { championUserId: UNKNOWN } });
    }
    if (processed % 100 === 0) console.log(`  managers: ${processed}/${teams.length} teams (${resolved} resolved, ${errors} errors)`);
    await sleep(PACING_MS);
  }
  return { processed, resolved, errors };
}

/**
 * Resolve nationality for every manager whose row still has `nationality = null` (never attempted)
 * via managercompendium(userId) → Country. Resume-safe and self-healing:
 *   - success WITH a country  → store the country (+ countryId).
 *   - success WITHOUT a country (valid response, deleted/hidden manager) → store the "Unknown"
 *     sentinel so we don't keep re-querying a user CHPP will never resolve.
 *   - THROWN error (rate-limit/outage/network) → leave the row `null` so a later run retries it.
 *     This is the key fix: a transient failure must NOT poison the row to "Unknown" permanently,
 *     otherwise the `WHERE nationality IS NULL` filter would never pick it up again.
 * Because only errors leave a row null, re-running converges to full coverage across runs — safe
 * to chunk with `limit` to stay under the daily CHPP quota.
 */
export async function enrichUserNationalities(
  token: TokenPair,
  opts: { limit?: number } = {},
): Promise<{ processed: number; resolved: number; unknown: number; errors: number }> {
  const users = await prisma.hattrickUser.findMany({ where: { nationality: null }, select: { userId: true } });
  let processed = 0;
  let resolved = 0;
  let unknown = 0;
  let errors = 0;
  for (const { userId } of users) {
    if (opts.limit && processed >= opts.limit) break;
    processed++;
    try {
      const m = ((await chppGet(token, { file: 'managercompendium', version: '1.5', userId })) as any).HattrickData?.Manager;
      const countryName = m?.Country?.CountryName;
      if (countryName) {
        await prisma.hattrickUser.update({ where: { userId }, data: { countryId: Number(m?.Country?.CountryId) || null, nationality: countryName } });
        resolved++;
      } else {
        // Valid response, no country → genuinely unresolvable (deleted/hidden). Sentinel it.
        await prisma.hattrickUser.update({ where: { userId }, data: { nationality: 'Unknown' } });
        unknown++;
      }
    } catch {
      // Transient failure — leave the row null so the next run retries it (do not poison to "Unknown").
      errors++;
    }
    if (processed % 100 === 0) console.log(`  nationalities: ${processed}/${users.length} users (${resolved} resolved, ${unknown} unknown, ${errors} errors)`);
    await sleep(PACING_MS);
  }
  return { processed, resolved, unknown, errors };
}

/**
 * Attribute the manager behind RECENT cup finals via the winning team's CURRENT owner.
 *
 * Explicit opt-in only: a final won within the last `lookback` seasons uses the current owner as
 * an unverified approximation — even a recent club can have been abandoned or changed hands. OLDER
 * unattributed finals are left null deliberately: there the current owner can differ from who won
 * back then, so they stay queued for the ownership-history scrape (export-cup-unresolved →
 * ingest-cup-managers). Requires championTeamId (run enrichCupTeamIds first). Resume-safe: only
 * touches recent rows still missing a manager, scoped to the exact (cupId, season) so it never
 * overwrites an older final resolved by the scrape.
 */
export async function enrichRecentCupManagers(
  token: TokenPair,
  opts: { lookback?: number; onlyCupIds?: number[]; allowUnverifiedCurrentOwner?: boolean } = {},
): Promise<{ processed: number; resolved: number; errors: number }> {
  if (opts.allowUnverifiedCurrentOwner !== true) {
    console.log('Cup manager attribution awaits historical evidence; current-owner approximation is disabled.');
    return { processed: 0, resolved: 0, errors: 0 };
  }
  const lookback = opts.lookback ?? 3;
  // onlyCupIds scopes the whole pass to specific cups. The Masters self-heal uses it with a wide
  // lookback so its wide window can't spill onto national cups (whose old finals must stay queued for
  // the ownership-history scrape, not be current-owner attributed).
  const cupFilter = opts.onlyCupIds ? { cupId: { in: opts.onlyCupIds } } : {};
  const cups = await prisma.cup.findMany({ where: cupFilter, select: { cupId: true, currentSeason: true } });
  // Per-cup floor (season numbering is per-country). A cup with no known currentSeason is skipped
  // (Infinity) rather than risk mis-attributing everything.
  const floorByCup = new Map(cups.map((c) => [c.cupId, c.currentSeason == null ? Number.POSITIVE_INFINITY : c.currentSeason - lookback]));

  const pending = await prisma.cupChampion.findMany({
    where: { championUserId: null, championTeamId: { gt: 0 }, ...cupFilter },
    select: { cupId: true, season: true, championTeamId: true },
    orderBy: { season: 'desc' },
  });
  const recent = pending.filter((c) => c.season >= (floorByCup.get(c.cupId) ?? Number.POSITIVE_INFINITY));

  const owners = new Map<number, TeamOwner | null>(); // resolve each team once
  const failedTeams = new Set<number>(); // retry next run, not once per trophy in the same run
  let processed = 0;
  let resolved = 0;
  let errors = 0;
  for (const c of recent) {
    const teamId = c.championTeamId!;
    if (failedTeams.has(teamId)) continue;
    if (!owners.has(teamId)) {
      processed++;
      try {
        owners.set(teamId, await resolveTeamOwner(token, teamId));
      } catch {
        failedTeams.add(teamId);
        errors++;
        await sleep(PACING_MS);
        continue;
      }
      await sleep(PACING_MS);
    }
    const owner = owners.get(teamId)!;
    if (owner) {
      await prisma.hattrickUser.upsert({ where: { userId: owner.userId }, update: { loginName: owner.loginName, isBot: owner.isBot }, create: { userId: owner.userId, loginName: owner.loginName, isBot: owner.isBot } });
      const updated = await prisma.cupChampion.updateMany({ where: { cupId: c.cupId, season: c.season, championUserId: null }, data: { championUserId: owner.userId, championUserName: owner.loginName } });
      resolved += updated.count;
    } else {
      await prisma.cupChampion.updateMany({ where: { cupId: c.cupId, season: c.season, championUserId: null }, data: { championUserId: UNKNOWN } });
    }
  }
  return { processed, resolved, errors };
}
