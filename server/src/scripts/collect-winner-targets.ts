import 'dotenv/config';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prisma } from '../db/client.js';

/** Read-only browser worklist. Run from server: node --import tsx src/scripts/collect-winner-targets.ts. */
export interface WinnerTarget {
  teamId: number;
  leagueId: number;
  club: string;
  clubs: string[];
  leagueTitles: number;
  cupTitles: number;
  seasons: number[];
}

interface TargetGroup {
  teamId: number;
  leagueId: number;
  names: Map<string, number>;
  leagueTitles: Set<string>;
  cupTitles: Set<string>;
  seasons: Set<number>;
}

const separator = '\u001f';

/**
 * Historical club-name matches are scrape candidates, never ownership evidence. A missing cup
 * team id can contribute to a worklist only when its exact name and country identify a single
 * known team. The browser still has to prove the winner's identity for that exact competition.
 * International cups use the winning club's country when available, not competition sentinel 0.
 */
export async function collectWinnerTargets(opts: { limit?: number; offset?: number } = {}): Promise<WinnerTarget[]> {
  const [leagues, cups] = await Promise.all([
    prisma.leagueChampion.findMany({
      where: { complete: true },
      select: { leagueId: true, season: true, championTeamId: true, championTeamName: true, championUserId: true },
    }),
    prisma.cupChampion.findMany({
      select: { cupId: true, leagueId: true, championLeagueId: true, season: true, championTeamId: true, championTeamName: true, championUserId: true },
    }),
  ]);

  const groups = new Map<string, TargetGroup>();
  const teamsByClub = new Map<string, Set<number>>();
  const ensureGroup = (teamId: number, leagueId: number) => {
    const key = `${leagueId}:${teamId}`;
    let group = groups.get(key);
    if (!group) {
      group = { teamId, leagueId, names: new Map(), leagueTitles: new Set(), cupTitles: new Set(), seasons: new Set() };
      groups.set(key, group);
    }
    return group;
  };
  const recordIdentity = (teamId: number | null, leagueId: number, club: string, season: number) => {
    if (!teamId || teamId <= 0) return;
    const group = ensureGroup(teamId, leagueId);
    group.names.set(club, Math.max(group.names.get(club) ?? 0, season));
    // Unknown club country cannot support a same-country inference.
    if (leagueId <= 0) return;
    const key = `${leagueId}${separator}${club}`;
    const teams = teamsByClub.get(key) ?? new Set<number>();
    teams.add(teamId);
    teamsByClub.set(key, teams);
  };
  const cupCountry = (cup: (typeof cups)[number]) => cup.leagueId > 0 ? cup.leagueId : cup.championLeagueId ?? 0;

  for (const row of leagues) recordIdentity(row.championTeamId, row.leagueId, row.championTeamName, row.season);
  for (const row of cups) recordIdentity(row.championTeamId, cupCountry(row), row.championTeamName, row.season);

  for (const row of leagues) {
    if (row.championUserId != null && row.championUserId > 0 || row.championTeamId <= 0) continue;
    const group = ensureGroup(row.championTeamId, row.leagueId);
    group.leagueTitles.add(`${row.leagueId}:${row.season}`);
    group.seasons.add(row.season);
  }
  for (const row of cups) {
    if (row.championUserId != null && row.championUserId > 0) continue;
    const leagueId = cupCountry(row);
    let teamId = row.championTeamId;
    if (!teamId || teamId <= 0) {
      const candidates = teamsByClub.get(`${leagueId}${separator}${row.championTeamName}`);
      if (candidates?.size !== 1) continue;
      teamId = [...candidates][0]!;
    }
    const group = ensureGroup(teamId, leagueId);
    group.names.set(row.championTeamName, Math.max(group.names.get(row.championTeamName) ?? 0, row.season));
    group.cupTitles.add(`${row.cupId}:${row.season}`);
    group.seasons.add(row.season);
  }

  const targets = [...groups.values()]
    .filter((group) => group.leagueTitles.size + group.cupTitles.size > 0)
    .map((group): WinnerTarget => {
      const clubs = [...group.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
      return {
        teamId: group.teamId, leagueId: group.leagueId, club: clubs[0] ?? '', clubs,
        leagueTitles: group.leagueTitles.size, cupTitles: group.cupTitles.size,
        seasons: [...group.seasons].sort((a, b) => b - a),
      };
    })
    .sort((a, b) => b.leagueTitles - a.leagueTitles || b.cupTitles - a.cupTitles || a.leagueId - b.leagueId || a.teamId - b.teamId);
  const start = opts.offset ?? 0;
  return targets.slice(start, opts.limit == null ? undefined : start + opts.limit);
}

function parseArgs(args: string[]): { limit?: number; offset?: number } {
  const opts: { limit?: number; offset?: number } = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag !== '--limit' && flag !== '--offset') throw new Error(`Unknown option ${flag}; use --limit N and --offset N.`);
    const value = args[++index];
    if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${flag} requires a non-negative integer.`);
    opts[flag === '--limit' ? 'limit' : 'offset'] = Number(value);
  }
  return opts;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    console.log(JSON.stringify(await collectWinnerTargets(parseArgs(process.argv.slice(2)))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
