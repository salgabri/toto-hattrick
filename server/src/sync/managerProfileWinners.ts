import { z } from 'zod';

const LinkSchema = z.object({ text: z.string().trim().min(1), href: z.string().trim().min(1) }).strict();
const CaptureSchema = z.object({
  managerProfile: z.object({
    sourceURL: z.string().trim().min(1),
    heading: z.string().trim().min(1),
    previousTeam: z.object({
      team: LinkSchema,
      country: LinkSchema,
      tenure: z.string().trim().min(1),
      trophy: LinkSchema,
    }).strict(),
  }).strict(),
  clubHistory: z.object({
    sourceURL: z.string().trim().min(1),
    event: z.object({ text: z.string().trim().min(1), links: z.array(LinkSchema).min(2) }).strict(),
  }).strict(),
}).strict();

export type ManagerProfileCapture = z.infer<typeof CaptureSchema>;

export interface ManagerProfileWinnerEvidence {
  kind: 'league';
  leagueId: number;
  countryName: string;
  topSeriesId: number;
  seriesName: string;
  season: number;
  teamId: number;
  teamName: string;
  userId: number;
  userName: string;
  tenureStart: string;
  tenureEnd: string;
  winDate: string;
  profileURL: string;
  historyURL: string;
}

export interface StoredManagerProfileWinner {
  leagueId: number;
  season: number;
  topSeriesId: number;
  countryName: string;
  championTeamId: number;
  championTeamName: string;
  championUserId: number | null;
  championUserName: string | null;
  complete: boolean;
}

export interface ManagerProfileWinnerPlan {
  status: 'ready' | 'already-attributed' | 'conflict' | 'unmatched' | 'applied' | 'stale';
  reason: string;
  evidence: ManagerProfileWinnerEvidence;
  stored: StoredManagerProfileWinner | null;
  changes?: { championUserId: number; championUserName: string };
}

function fail(message: string): never { throw new Error(`Invalid manager-profile winner evidence: ${message}`); }

function positiveId(raw: string, label: string): number {
  if (!/^[1-9]\d*$/.test(raw)) return fail(`${label} is not a positive integer`);
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) return fail(`${label} exceeds the safe integer range`);
  return id;
}

function hattrickURL(raw: string): URL {
  let url: URL;
  try { url = new URL(raw.replace(/&amp;/gi, '&'), 'https://www.hattrick.org'); }
  catch { return fail('malformed Hattrick URL'); }
  if (url.protocol !== 'https:' || !/(^|\.)hattrick\.org$/i.test(url.hostname) || url.username || url.password) {
    return fail('link is not an HTTPS Hattrick URL');
  }
  return url;
}

function linkedId(raw: string, path: string, parameter: string): number {
  const url = hattrickURL(raw);
  if (url.pathname.toLowerCase() !== path.toLowerCase()) return fail(`expected ${path} link`);
  const values = [...url.searchParams].filter(([key]) => key.toLowerCase() === parameter.toLowerCase());
  if (values.length !== 1) return fail(`expected one ${parameter} parameter`);
  return positiveId(values[0]![1], parameter);
}

function seriesLink(raw: string): { topSeriesId: number; season: number } {
  return {
    topSeriesId: linkedId(raw, '/en/World/Series/SeriesHistory.aspx', 'LeagueLevelUnitID'),
    season: linkedId(raw, '/en/World/Series/SeriesHistory.aspx', 'RequestedSeason'),
  };
}

function isoDate(raw: string): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw);
  if (!match) return fail('date must be DD.MM.YYYY');
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== iso) return fail('invalid calendar date');
  return iso;
}

/**
 * Correlate the exact links in a manager's Previous teams trophy with one dated club-history win.
 * Neither a current owner nor a manager name found only in prose establishes a historical winner.
 */
export function parseManagerProfileWinnerEvidence(input: unknown): ManagerProfileWinnerEvidence {
  const capture = CaptureSchema.parse(input);
  const { managerProfile, clubHistory } = capture;
  const team = managerProfile.previousTeam;
  const profileUserId = linkedId(managerProfile.sourceURL, '/en/Club/Manager/', 'userId');
  const heading = /^(.+?)\s+Germany Manager Licence Supporter Diamond \(([1-9]\d*)\)$/.exec(managerProfile.heading);
  if (!heading) return fail('manager heading does not contain the observed account identity');
  const userName = heading[1]!.trim();
  const headingUserId = positiveId(heading[2]!, 'heading user ID');
  if (headingUserId !== profileUserId || !userName) return fail('manager heading disagrees with profile link');

  const teamId = linkedId(team.team.href, '/en/Club/History/', 'teamId');
  const historyTeamId = linkedId(clubHistory.sourceURL, '/en/Club/History/', 'teamId');
  if (teamId !== historyTeamId) return fail('profile team and club history disagree');
  const leagueId = linkedId(team.country.href, '/en/World/Leagues/League.aspx', 'LeagueID');
  const countryName = team.country.text.trim();
  const teamName = team.team.text.trim();

  const tenure = /^(\d{2}\.\d{2}\.\d{4})\s*[–-]\s*(\d{2}\.\d{2}\.\d{4})$/.exec(team.tenure);
  if (!tenure) return fail('previous-team tenure is not a bounded date interval');
  const tenureStart = isoDate(tenure[1]!);
  const tenureEnd = isoDate(tenure[2]!);
  if (tenureStart > tenureEnd) return fail('previous-team tenure ends before it starts');

  const trophy = /^Series Champions (.+) Season ([1-9]\d*)$/.exec(team.trophy.text);
  if (!trophy) return fail('previous-team trophy is not an exact league-season title');
  const trophySeason = positiveId(trophy[2]!, 'profile trophy season');
  const profileSeries = seriesLink(team.trophy.href);
  if (profileSeries.season !== trophySeason) return fail('profile trophy season disagrees with its link');

  const event = /^(\d{2}\.\d{2}\.\d{4}) (.+?), under the leadership of a now retired manager, became league champions season ([1-9]\d*)\.$/.exec(clubHistory.event.text);
  if (!event) return fail('club history does not explicitly report the retired-manager league win');
  const winDate = isoDate(event[1]!);
  const eventSeason = positiveId(event[3]!, 'club-history season');
  if (winDate < tenureStart || winDate > tenureEnd) return fail('club-history win falls outside the manager tenure');
  if (event[2]!.trim() !== teamName || eventSeason !== trophySeason) return fail('club-history team or season disagrees with the profile trophy');

  const teamLinks = clubHistory.event.links.filter(({ href }) => hattrickURL(href).pathname.toLowerCase() === '/en/club/');
  const seriesLinks = clubHistory.event.links.filter(({ href }) => hattrickURL(href).pathname.toLowerCase() === '/en/world/series/serieshistory.aspx');
  if (clubHistory.event.links.length !== 2 || teamLinks.length !== 1 || seriesLinks.length !== 1) {
    return fail('club-history event requires one linked team and one linked series season');
  }
  if (teamLinks[0]!.text.trim() !== teamName || linkedId(teamLinks[0]!.href, '/en/Club/', 'TeamID') !== teamId) {
    return fail('club-history team link disagrees with profile team');
  }
  const historySeries = seriesLink(seriesLinks[0]!.href);
  if (historySeries.topSeriesId !== profileSeries.topSeriesId || historySeries.season !== trophySeason) {
    return fail('club-history series or season link disagrees with profile trophy');
  }

  return {
    kind: 'league', leagueId, countryName, topSeriesId: profileSeries.topSeriesId,
    seriesName: trophy[1]!.trim(), season: trophySeason, teamId, teamName,
    userId: profileUserId, userName, tenureStart, tenureEnd, winDate,
    profileURL: managerProfile.sourceURL, historyURL: clubHistory.sourceURL,
  };
}

function planEvidence(evidence: ManagerProfileWinnerEvidence, stored: StoredManagerProfileWinner | null): ManagerProfileWinnerPlan {
  const base = { evidence, stored };
  if (!stored || !stored.complete || stored.leagueId !== evidence.leagueId ||
      stored.season !== evidence.season || stored.topSeriesId !== evidence.topSeriesId ||
      stored.countryName !== evidence.countryName || stored.championTeamId !== evidence.teamId ||
      stored.championTeamName !== evidence.teamName) {
    return { ...base, status: 'unmatched', reason: 'No completed stored league winner matches the linked league, series, season, and team' };
  }
  if (stored.championUserId === evidence.userId) {
    return { ...base, status: 'already-attributed', reason: 'The verified manager is already attributed' };
  }
  if (stored.championUserId !== null && stored.championUserId !== 0) {
    return { ...base, status: 'conflict', reason: 'Existing manager identity is preserved' };
  }
  return { ...base, status: 'ready', reason: 'Linked profile trophy and dated club-history win agree',
    changes: { championUserId: evidence.userId, championUserName: evidence.userName } };
}

/** Pure review against a stored winner snapshot. Invalid or contradictory captures throw. */
export function planManagerProfileWinner(input: unknown, stored: StoredManagerProfileWinner | null): ManagerProfileWinnerPlan {
  return planEvidence(parseManagerProfileWinnerEvidence(input), stored);
}

/** Dry-run by default; application rechecks every stored identity in one transaction. No network calls. */
export async function applyManagerProfileWinner(input: unknown, opts: { apply?: boolean } = {}) {
  const evidence = parseManagerProfileWinnerEvidence(input);
  // The update runner can select an isolated database after importing this module.
  const { prisma } = await import('../db/client.js');
  const stored = await prisma.leagueChampion.findUnique({
    where: { leagueId_season: { leagueId: evidence.leagueId, season: evidence.season } },
    select: { leagueId: true, season: true, topSeriesId: true, countryName: true,
      championTeamId: true, championTeamName: true, championUserId: true,
      championUserName: true, complete: true },
  });
  const plan = planEvidence(evidence, stored);
  if (!opts.apply || plan.status !== 'ready' || !stored || !plan.changes) {
    return { apply: opts.apply === true, ...plan };
  }
  const changes = plan.changes;
  const changed = await prisma.$transaction(async (tx) => {
    const result = await tx.leagueChampion.updateMany({
      where: { leagueId: stored.leagueId, season: stored.season, topSeriesId: stored.topSeriesId,
        countryName: stored.countryName, championTeamId: stored.championTeamId,
        championTeamName: stored.championTeamName, championUserId: stored.championUserId,
        championUserName: stored.championUserName, complete: true },
      data: changes,
    });
    if (result.count !== 1) return false;
    await tx.hattrickUser.upsert({
      where: { userId: evidence.userId },
      // Preserve any current login, nationality, and bot state for this numeric account.
      update: {}, create: { userId: evidence.userId, loginName: evidence.userName, isBot: false },
    });
    return true;
  });
  return { apply: true, ...plan, status: changed ? 'applied' as const : 'stale' as const,
    reason: changed ? 'Verified manager attributed' : 'Stored winner changed after planning; no write applied' };
}
