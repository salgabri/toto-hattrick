import { z } from 'zod';

/** DOM evidence from the logged-in Club/History pages; never fetches Hattrick itself. */
export interface HistoricalLink { text: string; href: string }
export interface HistoricalRow { text: string; links: HistoricalLink[] }
export interface HistoricalClubHistory {
  teamId: number;
  leagueId?: number | null;
  club: string;
  complete: boolean;
  sourceURL?: string;
  pages: Array<{ page: number; sourceURL?: string; rows: HistoricalRow[] }>;
}
export interface HistoricalEvent extends HistoricalRow {
  date: string;
  page: number;
  sourceURL: string;
}
export interface HistoricalWinnerEvidence {
  kind: 'cup' | 'tournament' | 'league';
  competitionId: number;
  season: number;
  teamId: number;
  leagueId: number | null;
  club: string;
  userId: number;
  userName: string;
  basis: 'direct-manager' | 'ownership-tenure';
  sourceURL: string;
  event: HistoricalEvent;
  ownershipEvent?: HistoricalEvent;
}
export interface RejectedHistoricalEvent { teamId: number; reason: string; event: HistoricalEvent }

const HistorySchema = z.object({
  teamId: z.number().int().positive(),
  leagueId: z.number().int().nonnegative().nullish(),
  club: z.string().trim().min(1),
  complete: z.boolean(),
  sourceURL: z.string().optional(),
  pages: z.array(z.object({
    page: z.number().int().positive(),
    sourceURL: z.string().optional(),
    rows: z.array(z.object({ text: z.string(), links: z.array(z.object({ text: z.string(), href: z.string() })) })),
  })),
});
const clean = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim();
const positive = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};
function linkURL(href: string): URL | null {
  try {
    const url = new URL(href.replace(/&amp;/gi, '&'), 'https://www.hattrick.org');
    return url.protocol === 'https:' && /(^|\.)hattrick\.org$/i.test(url.hostname) ? url : null;
  } catch { return null; }
}
function param(url: URL, name: string): number | null {
  for (const [key, value] of url.searchParams) if (key.toLowerCase() === name.toLowerCase()) return positive(value);
  return null;
}
function linkedIds(row: HistoricalRow, parameter: string): number[] {
  return [...new Set(row.links.flatMap((link) => {
    const url = linkURL(link.href);
    const id = url && param(url, parameter);
    return id ? [id] : [];
  }))];
}
function manager(row: HistoricalRow): { userId: number; userName: string } | null {
  const users = new Map<number, string>();
  for (const link of row.links) {
    const url = linkURL(link.href);
    const userId = url && /\/Club\/Manager(?:\/|$)/i.test(url.pathname) ? param(url, 'userId') : null;
    const name = clean(link.text);
    if (userId && name && !/^(?:a )?(?:former|retired) user$/i.test(name)) users.set(userId, name);
  }
  if (users.size !== 1) return null;
  const [userId, userName] = [...users][0]!;
  return { userId, userName };
}
function eventDate(text: string): string | null {
  const match = clean(text).match(/^(\d{2})([-.])(\d{2})\2(\d{4})\b/);
  if (!match) return null;
  const iso = `${match[4]}-${match[3]}-${match[1]}`;
  const value = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(value.valueOf()) && value.toISOString().slice(0, 10) === iso ? iso : null;
}
const ownershipBoundary = /changed owner|took control|took over|has taken over|now managed by|left the club|abandoned|bought the club/i;
const relinquished = /left the club|abandoned/i;

/**
 * Pure extraction. Direct cup winner/manager links work even on partial histories. League and
 * tournament wins require complete pagination and a dated, linked ownership event before the win.
 * An intervening unlinked/deleted owner, relinquishment, or same-day ownership ambiguity blocks it.
 */
export function extractHistoricalWinnerEvidence(histories: readonly HistoricalClubHistory[]): {
  evidence: HistoricalWinnerEvidence[]; rejected: RejectedHistoricalEvent[];
} {
  const evidence: HistoricalWinnerEvidence[] = [];
  const rejected: RejectedHistoricalEvent[] = [];
  for (const input of histories) {
    const history = HistorySchema.parse(input);
    const sourceURL = history.sourceURL ?? `https://www.hattrick.org/en/Club/History/?teamId=${history.teamId}`;
    const seen = new Set<string>();
    const events: HistoricalEvent[] = [];
    for (const page of history.pages) for (const row of page.rows) {
      const text = clean(row.text);
      const key = JSON.stringify([text, row.links]);
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ ...row, text, date: eventDate(text) ?? '', page: page.page, sourceURL: page.sourceURL ?? sourceURL });
    }
    const pages = history.pages.map((page) => page.page).sort((a, b) => a - b);
    const complete = history.complete && pages.length > 0 && pages.every((page, index) => page === index + 1);
    const boundaries = events.filter((event) => ownershipBoundary.test(event.text));
    const undatedBoundary = boundaries.some((event) => !event.date);
    for (const event of events) {
      if (ownershipBoundary.test(event.text)) continue;
      const cupVictory = event.text.match(/^\d{2}[.-]\d{2}[.-]\d{4} In season (\d+), (.+?) emerged victorious from (.+?)\. They were managed by (.+)\.$/i);
      const cupMemorable = event.text.match(/^\d{2}[.-]\d{2}[.-]\d{4} Season (\d+) was memorable for (.+?), who led (.+?) to the title in (.+)\.$/i);
      const cupLeadership = event.text.match(/^\d{2}[.-]\d{2}[.-]\d{4} (.+?), under the leadership of (.+?), won (.+?) season (\d+)\.$/i);
      // The observed Masters history entry names and links the owner at the win, but unlike
      // domestic cup entries it has no CupID link. Its exact title names cup 183; require a
      // matching linked team and manager before using that fixed competition identity.
      const mastersChampion = event.text.match(/^\d{2}[.-]\d{2}[.-]\d{4} (.+?) under the ownership of (.+?) became Hattrick Masters champions season (\d+)\.$/i);
      const cupWin = cupVictory !== null || cupMemorable !== null || cupLeadership !== null || mastersChampion !== null;
      const cupSeason = cupVictory?.[1] ?? cupMemorable?.[1] ?? cupLeadership?.[4] ?? mastersChampion?.[3];
      const cupClub = cupVictory?.[2] ?? cupMemorable?.[3] ?? cupLeadership?.[1] ?? mastersChampion?.[1];
      const cupManagerName = cupVictory?.[4] ?? cupMemorable?.[2] ?? cupLeadership?.[2] ?? mastersChampion?.[2];
      const tournamentWin = event.text.match(/\bParticipated in season (\d+) of (.+?) and finished as number 1\./i);
      const leagueWin = event.text.match(/\bfinished as number 1 in (.+?) season (\d+)\./i);
      // Real HI/HTAL captures use this boilerplate after a club is abandoned even when its
      // historical owner still has a linked account. It supplies a win, not an owner identity.
      const leagueChampion = event.text.match(/^\d{2}-\d{2}-\d{4} (.+?), under the leadership of (.+?), became league champions season (\d+)\.$/i);
      if (!cupWin && !tournamentWin && !leagueWin && !leagueChampion) continue;
      const reject = (reason: string) => rejected.push({ teamId: history.teamId, reason, event });
      if (!event.date) { reject('Winner event has no valid DD-MM-YYYY date'); continue; }
      const kind = cupWin ? 'cup' : tournamentWin ? 'tournament' : 'league';
      const linkedCompetitionIds = linkedIds(event, kind === 'cup' ? 'CupID' : kind === 'tournament' ? 'tournamentId' : 'LeagueLevelUnitID');
      const ids = mastersChampion && linkedCompetitionIds.length === 0 ? [183] : linkedCompetitionIds;
      const season = Number(cupSeason ?? tournamentWin?.[1] ?? leagueWin?.[2] ?? leagueChampion?.[3]);
      if (ids.length !== 1 || !positive(season)) { reject('Winner event has no unique linked competition and season'); continue; }
      if (mastersChampion && ids[0] !== 183) { reject('Masters winner event links to a different competition'); continue; }
      // A cup event's Archive.aspx link uses the GLOBAL season, while its visible text uses
      // the cup's LOCAL season (e.g. HI season 1 -> archive season 64). Compare only the
      // selected competition's own season parameter, never unrelated archive links.
      const linkedSeasons = kind === 'cup' ? [] : event.links.flatMap((link) => {
        const url = linkURL(link.href);
        if (!url || param(url, kind === 'league' ? 'LeagueLevelUnitID' : 'tournamentId') !== ids[0]) return [];
        const linkedSeason = param(url, kind === 'league' ? 'RequestedSeason' : 'season');
        return linkedSeason ? [linkedSeason] : [];
      });
      if (linkedSeasons.some((linked) => linked !== season)) { reject('Linked season disagrees with winner event'); continue; }
      const teamIds = linkedIds(event, 'TeamID');
      if (teamIds.some((id) => id !== history.teamId)) { reject('Linked winner team disagrees with history team'); continue; }
      if (mastersChampion && (teamIds.length !== 1 || clean(cupClub ?? '') !== clean(history.club))) {
        reject('Masters winner event lacks the exact linked history team'); continue;
      }
      let owner: { userId: number; userName: string } | null = null;
      let ownershipEvent: HistoricalEvent | undefined;
      const directLeagueManager = leagueChampion ? manager(event) : null;
      const direct = cupWin || directLeagueManager !== null;
      if (direct) {
        owner = manager(event);
        if (!owner) { reject('Winner event has no unique linked manager'); continue; }
        const statedName = cupManagerName ?? leagueChampion?.[2];
        if (!statedName || clean(statedName) !== owner.userName) { reject('Linked manager disagrees with the manager named in the winner event'); continue; }
      } else {
        if (!complete || undatedBoundary) { reject('Ownership inference requires a complete, dated history'); continue; }
        if (boundaries.some((boundary) => boundary.date === event.date)) { reject('Ownership changed on the same date as the win'); continue; }
        const prior = boundaries.filter((boundary) => boundary.date < event.date).sort((a, b) => b.date.localeCompare(a.date));
        ownershipEvent = prior[0];
        if (!ownershipEvent) { reject('No ownership event predates the win'); continue; }
        const latest = prior.filter((boundary) => boundary.date === ownershipEvent!.date);
        const owners = latest.map((boundary) => relinquished.test(boundary.text) ? null : manager(boundary));
        if (owners.some((value) => value === null) || new Set(owners.map((value) => value?.userId)).size !== 1) {
          reject('Most recent ownership boundary is unlinked, relinquished, or ambiguous'); continue;
        }
        owner = owners[0]!;
      }
      const historicalRename = ownershipEvent?.text.match(/\band renamed it (.+?)\.$/i)?.[1];
      evidence.push({
        kind, competitionId: ids[0]!, season, teamId: history.teamId,
        leagueId: positive(history.leagueId), club: clean(cupClub ?? leagueChampion?.[1] ?? historicalRename ?? history.club),
        ...owner, basis: direct ? 'direct-manager' : 'ownership-tenure',
        sourceURL: event.sourceURL, event, ...(ownershipEvent ? { ownershipEvent } : {}),
      });
    }
  }
  return { evidence, rejected };
}

export interface StoredHistoricalWinner {
  season: number;
  leagueId: number;
  championTeamId: number | null;
  championTeamName: string;
  championUserId: number | null;
  championUserName: string | null;
  cupId?: number;
  topSeriesId?: number;
  championLeagueId?: number | null;
  complete?: boolean;
}
export interface HistoricalWinnerSnapshot {
  cups: Array<{ cupId: number; leagueId: number }>;
  tournamentIds: readonly number[];
  cupChampions: StoredHistoricalWinner[];
  leagueChampions: StoredHistoricalWinner[];
}
export interface HistoricalWinnerPlanItem {
  key: string;
  table: 'cupChampion' | 'leagueChampion';
  status: 'ready' | 'already-attributed' | 'conflict' | 'unmatched' | 'applied' | 'stale';
  reason?: string;
  evidence: HistoricalWinnerEvidence[];
  selected?: HistoricalWinnerEvidence;
  stored?: StoredHistoricalWinner;
  changes?: { championUserId: number; championUserName: string; championTeamId: number; championLeagueId?: number };
}

/** Pure matching and conflict review against a database snapshot. Never guesses by manager name. */
export function planHistoricalWinners(histories: readonly HistoricalClubHistory[], snapshot: HistoricalWinnerSnapshot) {
  const extracted = extractHistoricalWinnerEvidence(histories);
  const plans: HistoricalWinnerPlanItem[] = [];
  const grouped = new Map<string, HistoricalWinnerPlanItem>();
  const cups = new Map(snapshot.cups.map((cup) => [cup.cupId, cup]));
  const tournaments = new Set(snapshot.tournamentIds);
  for (const item of extracted.evidence) {
    const isLeague = item.kind === 'league';
    const table = isLeague ? 'leagueChampion' : 'cupChampion';
    const prefix = `${table}:${item.competitionId}:${item.season}`;
    const registered = isLeague || (cups.has(item.competitionId) && (item.kind !== 'tournament' || tournaments.has(item.competitionId)));
    const candidates = (isLeague ? snapshot.leagueChampions : snapshot.cupChampions).filter((row) =>
      row.season === item.season && (isLeague ? row.topSeriesId === item.competitionId && row.complete === true : row.cupId === item.competitionId),
    );
    const matching = candidates.filter((row) =>
      (!item.leagueId || row.leagueId === 0 || row.leagueId === item.leagueId) &&
      (positive(row.championTeamId) ? row.championTeamId === item.teamId : clean(row.championTeamName) === clean(item.club)),
    );
    if (!registered || matching.length !== 1) {
      plans.push({ key: prefix, table, status: 'unmatched', evidence: [item], reason: !registered ? 'Competition is not registered' : matching.length > 1 ? 'Multiple matching stored winners' : 'No matching completed winner with the same team identity' });
      continue;
    }
    const row = matching[0]!;
    const key = `${table}:${isLeague ? row.leagueId : row.cupId}:${row.season}`;
    const group = grouped.get(key);
    if (group) group.evidence.push(item);
    else grouped.set(key, { key, table, status: 'ready', evidence: [item], stored: row });
  }
  for (const plan of grouped.values()) {
    const direct = plan.evidence.filter((item) => item.basis === 'direct-manager');
    const best = direct.length ? direct : plan.evidence;
    if (new Set(best.map((item) => item.userId)).size !== 1 || new Set(best.map((item) => item.teamId)).size !== 1 || new Set(best.flatMap((item) => item.leagueId ? [item.leagueId] : [])).size > 1) {
      plan.status = 'conflict';
      plan.reason = 'Equally strong history evidence disagrees on the winner identity';
    } else {
      const selected = best[0]!;
      const row = plan.stored!;
      plan.selected = selected;
      if (positive(row.championUserId)) {
        const disagrees = row.championUserId !== selected.userId;
        plan.status = disagrees ? 'conflict' : 'already-attributed';
        plan.reason = disagrees ? 'Established positive attribution preserved; historical evidence disagrees' : 'Winner already attributed to the verified manager';
      } else if (row.championUserId !== null && row.championUserId !== 0) {
        plan.status = 'conflict';
        plan.reason = 'Stored attribution is neither a positive manager ID nor a supported missing-value sentinel';
      } else {
        plan.changes = { championUserId: selected.userId, championUserName: selected.userName, championTeamId: selected.teamId };
        if (plan.table === 'cupChampion' && row.leagueId === 0 && selected.leagueId && !positive(row.championLeagueId)) {
          plan.changes.championLeagueId = selected.leagueId;
        }
      }
    }
    plans.push(plan);
  }
  return { plans, rejected: extracted.rejected };
}

/** Dry-run by default. Writes only reviewed pending winners, in guarded per-winner transactions. */
export async function applyHistoricalWinners(histories: readonly HistoricalClubHistory[], opts: { apply?: boolean } = {}) {
  const { prisma } = await import('../db/client.js');
  const { SEASONAL_CUP_IDS } = await import('./seasonal.js');
  const [cups, cupChampions, leagueChampions] = await Promise.all([
    prisma.cup.findMany({ select: { cupId: true, leagueId: true } }),
    prisma.cupChampion.findMany({ select: { cupId: true, season: true, leagueId: true, championTeamId: true, championTeamName: true, championUserId: true, championUserName: true, championLeagueId: true } }),
    prisma.leagueChampion.findMany({ select: { leagueId: true, season: true, topSeriesId: true, championTeamId: true, championTeamName: true, championUserId: true, championUserName: true, complete: true } }),
  ]);
  const report = planHistoricalWinners(histories, { cups, cupChampions, leagueChampions, tournamentIds: [...SEASONAL_CUP_IDS] });
  if (opts.apply) for (const plan of report.plans) {
    if (plan.status !== 'ready' || !plan.changes || !plan.stored || !plan.selected) continue;
    const { stored, changes, selected } = plan;
    const updated = await prisma.$transaction(async (tx) => {
      const guard = { season: stored.season, championTeamId: stored.championTeamId, championTeamName: stored.championTeamName, championUserId: stored.championUserId };
      const result = plan.table === 'cupChampion'
        ? await tx.cupChampion.updateMany({ where: { ...guard, cupId: stored.cupId!, championLeagueId: stored.championLeagueId }, data: changes })
        : await tx.leagueChampion.updateMany({ where: { ...guard, leagueId: stored.leagueId, championTeamId: stored.championTeamId!, complete: true }, data: { championUserId: changes.championUserId, championUserName: changes.championUserName, championTeamId: changes.championTeamId } });
      if (result.count === 0) return false;
      await tx.hattrickUser.upsert({
        where: { userId: selected.userId },
        // A history event can contain an old alias. Keep any current login, nationality and bot
        // flag already known for this ID. New rows describe a human winner; isBot:false does not
        // assert that their account is still active today.
        update: {},
        create: { userId: selected.userId, loginName: selected.userName, isBot: false },
      });
      return true;
    });
    plan.status = updated ? 'applied' : 'stale';
    if (!updated) plan.reason = 'Winner changed after planning; no write applied';
  }
  const counts = { ready: 0, applied: 0, conflicts: 0, unmatched: 0, alreadyAttributed: 0, stale: 0, rejected: report.rejected.length };
  for (const plan of report.plans) {
    if (plan.status === 'conflict') counts.conflicts++;
    else if (plan.status === 'already-attributed') counts.alreadyAttributed++;
    else counts[plan.status]++;
  }
  return { apply: opts.apply === true, counts, ...report };
}
