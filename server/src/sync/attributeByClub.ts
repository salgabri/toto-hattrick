import { prisma } from '../db/client.js';

/**
 * Attribute reconstructed placeholder titles to a manager by bridging the winning CLUB NAME to any
 * already-attributed title that club holds in the same country.
 *
 * Why this exists: every other attribution path (enrichRecentCupManagers via current owner, and the
 * ownership-history scrape via export-cup-unresolved → ingest-cup-managers) keys off a real
 * championTeamId. But reconstruct-from-bake restores rows as name-only placeholders
 * (LeagueChampion.championTeamId 0, CupChampion.championTeamId null), so those paths cannot touch
 * them — they cannot even be exported as scrape targets. Name bridging is the only route that works
 * without a single CHPP call.
 *
 * Two things it does that the original cup-only version did not:
 *   - The donor pool includes attributed CUP champions, not just league champions. A club that never
 *     won its top division may still have an attributed cup win to bridge from.
 *   - It fills unattributed LEAGUE titles too, not only cup finals. The bridge is symmetric; only
 *     the cup direction was ever wired up.
 *
 * Guard — ambiguity is skipped, not guessed: all donors for a given (leagueId, club name) must agree
 * on ONE manager. If a club's titles are held by two different managers (team sold, or a name reused
 * by a different team in the same country) the mapping is dropped and those rows stay null rather
 * than risk a wrong credit. Merging the two donor pools can therefore REDUCE recoveries where league
 * and cup donors disagree — that is the intended behaviour, not a regression.
 *
 * Resume-safe: only rows with championUserId null are touched; existing attributions are untouched.
 * Note this cannot cascade — a newly attributed row shares its donor's (leagueId, club) key, so it
 * adds no new key to bridge from. Unlocking more requires a real attribution from CHPP first (a
 * resolved league title creates a donor key that no name match could invent).
 */

const SEP = String.fromCharCode(31); // unit separator: never occurs in a club name

export interface AttributeByClubResult {
  cupFinals: number;
  leagueTitles: number;
  ambiguousClubs: number;
  /** Rows skipped because their club's donors disagreed — left for the scrape/CHPP paths. */
  ambiguousRows: number;
}

export async function attributeByClub(): Promise<AttributeByClubResult> {
  // (leagueId, club name) -> the single agreed owner, or null once a second distinct owner is seen.
  const owners = new Map<string, { id: number; name: string | null } | null>();
  const addDonor = (leagueId: number, club: string, id: number, name: string | null) => {
    const k = `${leagueId}${SEP}${club}`;
    const cur = owners.get(k);
    if (cur === undefined) owners.set(k, { id, name });
    else if (cur && cur.id !== id) owners.set(k, null); // second distinct owner → ambiguous
  };

  for (const c of await prisma.leagueChampion.findMany({
    where: { championUserId: { gt: 0 } },
    select: { leagueId: true, championTeamName: true, championUserId: true, championUserName: true },
  }))
    addDonor(c.leagueId, c.championTeamName, c.championUserId!, c.championUserName);

  for (const c of await prisma.cupChampion.findMany({
    where: { championUserId: { gt: 0 } },
    select: { leagueId: true, championTeamName: true, championUserId: true, championUserName: true },
  }))
    addDonor(c.leagueId, c.championTeamName, c.championUserId!, c.championUserName);

  const ambiguousClubs = [...owners.values()].filter((v) => v === null).length;
  let ambiguousRows = 0;

  /** The agreed owner for a club, or undefined (no donor) / null (donors disagree). */
  const lookup = (leagueId: number, club: string) => owners.get(`${leagueId}${SEP}${club}`);

  let cupFinals = 0;
  for (const c of await prisma.cupChampion.findMany({
    where: { championUserId: null },
    select: { cupId: true, season: true, leagueId: true, championTeamName: true },
  })) {
    const o = lookup(c.leagueId, c.championTeamName);
    if (o === undefined) continue;
    if (o === null) { ambiguousRows++; continue; }
    await prisma.cupChampion.update({
      where: { cupId_season: { cupId: c.cupId, season: c.season } },
      data: { championUserId: o.id, championUserName: o.name },
    });
    cupFinals++;
  }

  let leagueTitles = 0;
  // `complete: true` only — a running season has no champion yet, so there is nothing to attribute.
  for (const c of await prisma.leagueChampion.findMany({
    where: { championUserId: null, complete: true },
    select: { leagueId: true, season: true, championTeamName: true },
  })) {
    const o = lookup(c.leagueId, c.championTeamName);
    if (o === undefined) continue;
    if (o === null) { ambiguousRows++; continue; }
    await prisma.leagueChampion.update({
      where: { leagueId_season: { leagueId: c.leagueId, season: c.season } },
      data: { championUserId: o.id, championUserName: o.name },
    });
    leagueTitles++;
  }

  return { cupFinals, leagueTitles, ambiguousClubs, ambiguousRows };
}
