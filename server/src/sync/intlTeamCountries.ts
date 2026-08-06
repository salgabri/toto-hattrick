import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prisma } from '../db/client.js';
import { chppGet } from '../chpp/client.js';
import type { TokenPair } from '../chpp/auth.js';
import { MASTERS_CUP_ID } from './masters.js';
import { GENERATION_TROPHY_IDS, SUPPORTER_WEEK_CUP_ID } from './seasonal.js';

/**
 * Which COUNTRY each winner of an international cup is from.
 *
 * The Hattrick Masters and the Seasonal Cups belong to no country — they store the sentinel
 * leagueId 0, which is what keeps them out of every per-country grouping. But their WINNERS do have
 * one: a club always lives in exactly one country's league, and it never moves. That country is what
 * `CupChampion.championLeagueId` holds, so the rolls of honour can fly a flag per team the way the
 * national ones already do.
 *
 * Sources, strongest first:
 *
 *   1. HOME TITLES — the club's own domestic record, already in this DB. A club that won the Copa
 *      Nacional de Cuba is Cuban, full stop: that row was recorded against Cuba's league, at the time,
 *      and no later change to the account can rewrite it. Free (no CHPP call) and historical rather
 *      than current, which is why it outranks everything below. A name that won in TWO countries is
 *      two different clubs sharing a name — ambiguous, so it counts as no evidence at all.
 *   2. teamdetails by teamID — the exact club, for every winner whose team id is known (the Seasonal
 *      Cup winners the ArenaHub scrape linked, see the ingest files below). A club cannot move
 *      country, so reading its league today is as good as reading it then.
 *   3. teamdetails by userID, matched BY NAME against the owner's clubs — for the Masters, which was
 *      reconstructed without team ids. The name match matters: an account can hold several clubs in
 *      several countries and the primary is often not the winner (S94's "Nigerian Black Panthers"
 *      sits behind a Hungarian primary club).
 *   4. …and if that account holds exactly ONE club, that club. The weakest link, and the reason
 *      source 1 exists: a manager who has since dropped the winning club and started elsewhere gets
 *      flagged for the wrong country. "Orda Balorda Cuba" won Masters S86 and three Cuban cups; the
 *      account's only club today is Italian, so this rule alone called it Italy. Domestic evidence
 *      overrules it wherever we have any — and it usually does, since a Masters entrant is by
 *      definition somebody's national champion.
 *
 * Resume-safe: the CHPP passes only touch rows with `championLeagueId = null`, and an unresolvable
 * one is sentinelled to 0 so re-runs skip it. The home-titles pass is a REPAIR pass — it also
 * corrects rows the weaker sources already filled in. Re-run after a new edition lands.
 */

const PACING_MS = 500;
/** championLeagueId sentinel: resolution was attempted and failed (deleted club, no name match). */
export const UNRESOLVED_LEAGUE = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const asArray = (x: unknown): any[] => (Array.isArray(x) ? x : x ? [x] : []);

/** Every cup that has no country of its own, and whose winners therefore need one resolved. */
export const INTERNATIONAL_CUP_IDS: number[] = [MASTERS_CUP_ID, SUPPORTER_WEEK_CUP_ID, ...Object.values(GENERATION_TROPHY_IDS)];

interface TeamCountry {
  teamId: number;
  leagueId: number;
}

const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));

/**
 * Team ids the ArenaHub scrape already captured, keyed by (cupId, season).
 *
 * The scrape read each winner's team link, but the first ingest ran before `championTeamId` was
 * stored, so the DB holds names only while the committed source files hold the ids. Replaying them
 * costs nothing and turns a name-match lookup into an exact one (and makes the club links work).
 */
export function seasonalTeamIdsFromIngest(): Map<string, number> {
  const out = new Map<string, number>();
  const supporter = JSON.parse(readFileSync(here('supporter-week-winners.json'), 'utf8')) as Array<{ season: number; teamId: number | null }>;
  for (const w of supporter) if (w.teamId) out.set(`${SUPPORTER_WEEK_CUP_ID}|${w.season}`, w.teamId);
  const generation = JSON.parse(readFileSync(here('generation-trophy-winners.json'), 'utf8')) as Array<{ cupId: number; season: number; teamId: number | null }>;
  for (const w of generation) if (w.teamId) out.set(`${w.cupId}|${w.season}`, w.teamId);
  return out;
}

/** Fill in `championTeamId` for seasonal winners the ingest files already identify. */
export async function backfillSeasonalTeamIds(): Promise<number> {
  const ids = seasonalTeamIdsFromIngest();
  const pending = await prisma.cupChampion.findMany({
    where: { cupId: { in: INTERNATIONAL_CUP_IDS }, championTeamId: null },
    select: { cupId: true, season: true },
  });
  let filled = 0;
  for (const c of pending) {
    const teamId = ids.get(`${c.cupId}|${c.season}`);
    if (!teamId) continue;
    await prisma.cupChampion.update({ where: { cupId_season: { cupId: c.cupId, season: c.season } }, data: { championTeamId: teamId } });
    filled++;
  }
  return filled;
}

/** Compare club names the way a human would: case, spacing and surrounding punctuation aside. */
const normalizeClub = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[\s'’".,\-_]+/g, ' ')
    .trim();

/**
 * Club name → the country it won its domestic titles in, for every club on record.
 *
 * Names that won in more than one country are left OUT, not merged: one club cannot have two
 * countries, so those are two clubs sharing a name and neither can be told apart by name alone.
 */
export async function countriesFromHomeTitles(): Promise<Map<string, number>> {
  const seen = new Map<string, Set<number>>();
  const add = (name: string, leagueId: number) => {
    if (!name || !leagueId) return;
    const k = normalizeClub(name);
    const s = seen.get(k) ?? new Set<number>();
    s.add(leagueId);
    seen.set(k, s);
  };
  for (const c of await prisma.leagueChampion.findMany({ select: { championTeamName: true, leagueId: true } })) add(c.championTeamName, c.leagueId);
  // leagueId > 0 excludes the international cups themselves — they're what we're resolving.
  for (const c of await prisma.cupChampion.findMany({ where: { leagueId: { gt: 0 } }, select: { championTeamName: true, leagueId: true } }))
    add(c.championTeamName, c.leagueId);

  const out = new Map<string, number>();
  for (const [name, ids] of seen) if (ids.size === 1) out.set(name, [...ids][0]!);
  return out;
}

export interface HomeTitleResult {
  filled: number; // rows that had no country
  corrected: number; // rows a weaker source had got WRONG
}

/**
 * Apply the domestic record to every international champion it can identify — filling the blanks and
 * correcting whatever a weaker source got wrong (see the module note, source 1).
 */
export async function applyHomeTitleCountries(opts: { verbose?: boolean } = {}): Promise<HomeTitleResult> {
  const home = await countriesFromHomeTitles();
  const rows = await prisma.cupChampion.findMany({
    where: { cupId: { in: INTERNATIONAL_CUP_IDS } },
    select: { cupId: true, cupName: true, season: true, championTeamName: true, championLeagueId: true },
  });
  let filled = 0;
  let corrected = 0;
  for (const r of rows) {
    const leagueId = home.get(normalizeClub(r.championTeamName));
    if (!leagueId || leagueId === r.championLeagueId) continue;
    const had = (r.championLeagueId ?? 0) > 0;
    if (opts.verbose && had) console.log(`  corrected ${r.cupName} S${r.season} ${r.championTeamName}: league ${r.championLeagueId} -> ${leagueId}`);
    await prisma.cupChampion.update({ where: { cupId_season: { cupId: r.cupId, season: r.season } }, data: { championLeagueId: leagueId } });
    if (had) corrected++;
    else filled++;
  }
  return { filled, corrected };
}

/** teamdetails(teamID) → that club's own league, or null when the club is gone. */
async function countryByTeamId(token: TokenPair, teamId: number): Promise<TeamCountry | null> {
  try {
    const h = ((await chppGet(token, { file: 'teamdetails', version: '3.6', teamID: teamId })) as any).HattrickData;
    // teamdetails returns the OWNER's whole club list, so pick the one actually asked for.
    const team = asArray(h?.Teams?.Team).find((t) => Number(t.TeamID) === teamId);
    const leagueId = Number(team?.League?.LeagueID) || null;
    return leagueId ? { teamId, leagueId } : null;
  } catch {
    return null;
  }
}

/**
 * teamdetails(userID) → the club of theirs that carries `teamName`, and its league.
 *
 * Falls back to their only club when they have exactly one — the weakest source there is, and one
 * the domestic record overrules wherever it has anything to say (module note, source 4).
 */
async function countryByUserId(token: TokenPair, userId: number, teamName: string): Promise<TeamCountry | null> {
  try {
    const h = ((await chppGet(token, { file: 'teamdetails', version: '3.6', userID: userId })) as any).HattrickData;
    const teams = asArray(h?.Teams?.Team);
    const want = normalizeClub(teamName);
    const match =
      teams.find((t) => normalizeClub(String(t.TeamName ?? '')) === want) ??
      teams.find((t) => normalizeClub(String(t.ShortTeamName ?? '')) === want) ??
      (teams.length === 1 ? teams[0] : undefined);
    const leagueId = Number(match?.League?.LeagueID) || null;
    const teamId = Number(match?.TeamID) || null;
    return leagueId && teamId ? { teamId, leagueId } : null;
  } catch {
    return null;
  }
}

export interface IntlCountriesResult {
  teamIdsFromIngest: number;
  homeFilled: number;
  homeCorrected: number;
  processed: number;
  resolved: number;
  unresolved: number;
  calls: number;
}

/**
 * Resolve the home country of every international-cup winner still missing one.
 *
 * The domestic-record pass runs first — it costs nothing, it is the strongest source, and doing it
 * up front means the CHPP calls below are only ever spent on winners nothing else can identify.
 *
 * `limit` caps CHPP calls for a chunked run (the pass converges across runs — only null rows are
 * ever picked up).
 */
export async function backfillIntlTeamCountries(token: TokenPair, opts: { limit?: number } = {}): Promise<IntlCountriesResult> {
  const teamIdsFromIngest = await backfillSeasonalTeamIds();
  const homeTitles = await applyHomeTitleCountries({ verbose: true });

  const pending = await prisma.cupChampion.findMany({
    where: { cupId: { in: INTERNATIONAL_CUP_IDS }, championLeagueId: null },
    orderBy: [{ cupId: 'asc' }, { season: 'desc' }],
    select: { cupId: true, season: true, championTeamId: true, championTeamName: true, championUserId: true },
  });

  // One CHPP call per distinct club/owner, however many editions they won.
  const byTeam = new Map<number, TeamCountry | null>();
  const byUser = new Map<string, TeamCountry | null>(); // keyed userId|club — one account, several clubs
  let processed = 0;
  let resolved = 0;
  let unresolved = 0;
  let calls = 0;

  for (const c of pending) {
    if (opts.limit && calls >= opts.limit) break;
    processed++;
    let found: TeamCountry | null = null;

    if (c.championTeamId && c.championTeamId > 0) {
      if (!byTeam.has(c.championTeamId)) {
        byTeam.set(c.championTeamId, await countryByTeamId(token, c.championTeamId));
        calls++;
        await sleep(PACING_MS);
      }
      found = byTeam.get(c.championTeamId)!;
    }
    // No team id, or the club is gone — try the owner's club list, matched by name.
    if (!found && c.championUserId && c.championUserId > 0) {
      const key = `${c.championUserId}|${c.championTeamName}`;
      if (!byUser.has(key)) {
        byUser.set(key, await countryByUserId(token, c.championUserId, c.championTeamName));
        calls++;
        await sleep(PACING_MS);
      }
      found = byUser.get(key)!;
    }

    await prisma.cupChampion.update({
      where: { cupId_season: { cupId: c.cupId, season: c.season } },
      data: found
        ? { championLeagueId: found.leagueId, championTeamId: c.championTeamId ?? found.teamId }
        : { championLeagueId: UNRESOLVED_LEAGUE },
    });
    if (found) resolved++;
    else unresolved++;

    if (processed % 50 === 0) console.log(`  countries: ${processed}/${pending.length} rows (${resolved} resolved, ${calls} calls)`);
  }

  return { teamIdsFromIngest, homeFilled: homeTitles.filled, homeCorrected: homeTitles.corrected, processed, resolved, unresolved, calls };
}
