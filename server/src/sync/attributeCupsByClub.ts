import { prisma } from '../db/client.js';

/**
 * Attribute cup finals to a manager by bridging the winning CLUB NAME to that country's league
 * champions — the only attribution that works on reconstructed placeholder finals.
 *
 * Why this exists: every other cup-attribution path (enrichRecentCupManagers via current owner, and
 * the ownership-history scrape via export-cup-unresolved → ingest-cup-managers) keys off
 * CupChampion.championTeamId. But reconstruct-from-bake restores finals as name-only placeholders
 * (finalMatchId 0, championTeamId null), so those paths can't touch them — they can't even be
 * exported as scrape targets. That leaves ~69% of finals with no manager and therefore absent from
 * every cabinet, however old or recent.
 *
 * The bridge: a club that won its country's TOP division has a resolved owner (LeagueChampion
 * .championUserId, itself from teamdetails' current owner). If exactly ONE manager is tied to a
 * given (leagueId, club name) across all league champions, any still-unattributed cup final won
 * under that same (leagueId, club name) is credited to them. No CHPP calls; matches on the name the
 * placeholder already carries.
 *
 * Guard — ambiguity is skipped, not guessed: if a club name won league titles under two different
 * managers (team sold, or a name reused by a different team in the same country), the mapping is
 * dropped and those finals are left null rather than risk a wrong credit. This is the same
 * current-owner approximation the league leaderboard already accepts, bounded by uniqueness.
 * Resume-safe: only rows with championUserId null are touched; existing attributions are untouched.
 */

const SEP = String.fromCharCode(31); // unit separator: never occurs in a club name

export interface AttributeByClubResult {
  attributed: number;
  ambiguousClubs: number;
  ambiguousFinals: number;
}

export async function attributeCupsByClub(): Promise<AttributeByClubResult> {
  // (leagueId, club name) -> single owner, or null once a second distinct owner is seen (ambiguous).
  const owners = new Map<string, { id: number; name: string | null } | null>();
  for (const c of await prisma.leagueChampion.findMany({
    where: { championUserId: { gt: 0 } },
    select: { leagueId: true, championTeamName: true, championUserId: true, championUserName: true },
  })) {
    const k = `${c.leagueId}${SEP}${c.championTeamName}`;
    const cur = owners.get(k);
    if (cur === undefined) owners.set(k, { id: c.championUserId!, name: c.championUserName });
    else if (cur && cur.id !== c.championUserId) owners.set(k, null); // second distinct owner → ambiguous
  }
  const ambiguousClubs = [...owners.values()].filter((v) => v === null).length;

  const pending = await prisma.cupChampion.findMany({
    where: { championUserId: null },
    select: { cupId: true, season: true, leagueId: true, championTeamName: true },
  });

  let attributed = 0;
  let ambiguousFinals = 0;
  for (const c of pending) {
    const o = owners.get(`${c.leagueId}${SEP}${c.championTeamName}`);
    if (o === undefined) continue; // club never won a league here → nothing to bridge from
    if (o === null) { ambiguousFinals++; continue; } // club's league owner isn't unique → skip
    await prisma.cupChampion.update({
      where: { cupId_season: { cupId: c.cupId, season: c.season } },
      data: { championUserId: o.id, championUserName: o.name },
    });
    attributed++;
  }
  return { attributed, ambiguousClubs, ambiguousFinals };
}
