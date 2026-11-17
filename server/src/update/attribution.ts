import { open, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { TokenPair } from '../chpp/auth.js';
import { chppGet, configureChppRuntime } from '../chpp/client.js';
import { fetchNationalTeamDetails } from '../chpp/endpoints.js';
import { parseCupFinalMatch } from '../schemas/cupFinal.js';
import { isDeletedTeamDetails } from '../schemas/index.js';
import { resolveUserNationality } from '../sync/enrichManagers.js';
import { nationalDateISO } from '../sync/nationalDates.js';
import { matchEvidenceKey, readEvidence } from './evidence.js';
import { readReviewSidecar } from './review.js';
import type { ObjectStore } from './storage.js';

/**
 * Guarded winner attribution on a review checkout (user rule, 2026-11-17: a published winner must
 * name its manager unless that account no longer exists). See docs/WEEKLY_UPDATE_PLAYBOOK.md.
 *
 * Clubs: Team/FoundedDate restarts whenever a manager takes a club over (1,543/1,543 checks,
 * docs/CURRENT_OWNER_ATTRIBUTION_2026-10-30.md). A current owner who took over at least
 * TAKEOVER_MARGIN_DAYS before the decisive match has run the club continuously since before it,
 * so they managed the title. National teams: a coach elected for the trophy's cycle who is still
 * the current coach coached the final; otherwise dated tenure (NTFormerCoaches) decides.
 *
 * Only empty manager slots of recent editions are filled. A positive identity is never changed;
 * update:import re-validates the checkout before adoption.
 */
const DAY = 86_400_000;
export const TAKEOVER_MARGIN_DAYS = 30;
const SEASON_DAYS = 16 * 7;
const LEAGUE_FINAL_ROUND = 14;
export const MASTERS_CUP_ID = 183;
const NATIONAL_TEAM_IDS = fileURLToPath(new URL('../../src/data/national-team-ids.json', import.meta.url));

export type ClubFamily = 'league' | 'cup' | 'masters' | 'seasonal';
export interface ClubTarget {
  family: ClubFamily;
  table: 'LeagueChampion' | 'CupChampion';
  competitionId: number;
  season: number;
  teamId: number;
  teamName: string;
  /** The competition's country; null for international competitions. */
  competitionLeagueId: number | null;
  /** The decisive match (league round 14 or the final); null when no retained date exists. */
  decisiveDate: string | null;
  dateSource: string;
  /** Uncertainty of an estimated decisive date, in days [earliest, latest] around it; exact = [0, 0]. */
  dateWindowDays?: [number, number];
}
export interface OwnerSnapshot {
  deleted: boolean;
  team: null | { teamId: number; name: string; leagueId: number; isBot: boolean; foundedDate: string | null };
  owner: null | { userId: number; loginName: string; activationDate: string | null };
}
export type Decision =
  | { status: 'attribute'; userId: number; loginName: string; basis: string; notes: string[] }
  | { status: 'account_gone'; reason: string }
  | { status: 'unresolved'; reason: string };

const isoDay = (value: string) => value.slice(0, 10);
const dayDiff = (later: string, earlier: string) => Math.floor((Date.parse(`${isoDay(later)}T00:00:00Z`) - Date.parse(`${isoDay(earlier)}T00:00:00Z`)) / DAY);

/** Pure guard for a club title. `otherCredits` are positive identities the archive already gives
 * this club for the same season in other competitions; `laterCredits` those it gives the club for
 * later seasons (same season numbering). Either naming someone else contradicts the ownership. */
export function decideClubOwner(target: ClubTarget, snapshot: OwnerSnapshot, otherCredits: number[] = [], laterCredits: number[] = []): Decision {
  if (snapshot.deleted) return { status: 'account_gone', reason: 'The winning club no longer exists' };
  if (!snapshot.team || snapshot.team.teamId !== target.teamId) return { status: 'unresolved', reason: 'teamdetails did not return the exact winning club' };
  if (snapshot.team.isBot) return { status: 'unresolved', reason: 'The club is a bot now; its current owner cannot be the winning manager' };
  if (!snapshot.owner || snapshot.owner.userId <= 0 || !snapshot.owner.loginName) return { status: 'unresolved', reason: 'The club has no current owner' };
  if (!target.decisiveDate) return { status: 'unresolved', reason: `No retained date for the decisive match (${target.dateSource})` };
  if (!snapshot.team.foundedDate) return { status: 'unresolved', reason: 'teamdetails has no takeover (FoundedDate)' };
  // An estimated date only bounds the decisive match; the takeover must precede its EARLIEST bound.
  const earliest = new Date(Date.parse(target.decisiveDate) + (target.dateWindowDays?.[0] ?? 0) * DAY).toISOString();
  const held = dayDiff(earliest, snapshot.team.foundedDate);
  if (held < TAKEOVER_MARGIN_DAYS)
    return { status: 'unresolved', reason: `Owner took over ${isoDay(snapshot.team.foundedDate)}, ${held} days before the decisive match's earliest date ${isoDay(earliest)}` };
  if (snapshot.owner.activationDate && dayDiff(earliest, snapshot.owner.activationDate) < 0)
    return { status: 'unresolved', reason: 'The owner account was activated after the decisive match' };
  const later = laterCredits.filter(userId => userId > 0 && userId !== snapshot.owner!.userId);
  if (later.length) return { status: 'unresolved', reason: `The archive credits a later title of this club to ${[...new Set(later)].join(', ')}` };
  if (target.competitionLeagueId !== null && snapshot.team.leagueId !== target.competitionLeagueId)
    return { status: 'unresolved', reason: `The club plays in league ${snapshot.team.leagueId}, not the competition's ${target.competitionLeagueId}` };
  const conflicting = otherCredits.filter(userId => userId > 0 && userId !== snapshot.owner!.userId);
  if (conflicting.length) return { status: 'unresolved', reason: `The archive credits this club to ${conflicting.join(', ')} in the same season` };
  const notes = snapshot.team.name === target.teamName ? [] : [`club renamed: stored "${target.teamName}", now "${snapshot.team.name}"`];
  return { status: 'attribute', userId: snapshot.owner.userId, loginName: snapshot.owner.loginName,
    basis: `owner since ${isoDay(snapshot.team.foundedDate)}, ${held} days before ${isoDay(earliest)}${earliest === target.decisiveDate ? '' : ` (earliest bound of ${target.dateSource})`}`, notes };
}

/** League round-14 date of `season` from a stored worlddetails observation (16-week seasons). */
export function leagueFinalRoundDate(world: { currentSeason: number; matchRound: number; seriesMatchDate: string }, season: number): string | null {
  const next = Date.parse(world.seriesMatchDate);
  if (!Number.isFinite(next) || !Number.isSafeInteger(world.matchRound) || !Number.isSafeInteger(world.currentSeason)) return null;
  return new Date(next + ((LEAGUE_FINAL_ROUND - world.matchRound) * 7 - (world.currentSeason - season) * SEASON_DAYS) * DAY).toISOString();
}

export type PodiumSlot = 'champion' | 'runnerUp' | 'thirdFourth';
export interface CoachTarget {
  table: 'WorldCupChampion' | 'NationalCupChampion';
  key: { isYouth: number; edition: number } | { cupId: number; season: number };
  isYouth: boolean;
  slot: PodiumSlot;
  index?: number;
  country: string;
  teamId: number | null;
  cycle: number;
  finalDate: string | null;
}
export interface CoachEvidence {
  current: null | { teamId: number; leagueId: number; coachId: number; coachLogin: string | null };
  /** That team's elections for the trophy's cycle, oldest first. */
  cycleElections: Array<{ winnerUserId: number | null }>;
  /** Dated NTFormerCoaches entries for the team, oldest first (optional). */
  tenure?: Array<{ date: string; userId: number; name: string }>;
}
export const tenureUrl = (teamId: number) => `https://www.hattrick.org/en/Club/NationalTeam/NTFormerCoaches.aspx?teamId=${teamId}`;

export function decideNationalCoach(target: CoachTarget, evidence: CoachEvidence): Decision {
  if (!target.teamId) return { status: 'unresolved', reason: 'No national-team id for this podium nation' };
  if (!target.finalDate) return { status: 'unresolved', reason: 'The final has no stored date' };
  if (evidence.tenure?.length) {
    const final = isoDay(target.finalDate);
    if (evidence.tenure.some(entry => isoDay(entry.date) === final))
      return { status: 'unresolved', reason: `A coach change shares the final's date ${final}; review it` };
    const atFinal = evidence.tenure.filter(entry => isoDay(entry.date) < final).at(-1);
    if (!atFinal) return { status: 'unresolved', reason: 'The coach history starts after the final' };
    if (atFinal.userId <= 0) return { status: 'account_gone', reason: `The coach at the final (${atFinal.name}) has no account any more` };
    return { status: 'attribute', userId: atFinal.userId, loginName: atFinal.name, basis: `coach since ${atFinal.date} per NTFormerCoaches`, notes: [] };
  }
  const elected = evidence.cycleElections.at(-1)?.winnerUserId ?? 0;
  const current = evidence.current;
  if (current && current.teamId === target.teamId && current.coachId > 0 && current.coachId === elected && current.coachLogin)
    return { status: 'attribute', userId: current.coachId, loginName: current.coachLogin, basis: `elected for cycle ${target.cycle} and still the current coach`, notes: [] };
  return { status: 'unresolved', reason: `needs_tenure: current coach ${current?.coachLogin ?? 'unknown'} is not the cycle-${target.cycle} election winner; read ${tenureUrl(target.teamId)}` };
}

// --- target collection (read-only) ----------------------------------------------------------

type Row = Record<string, unknown>;
const num = (value: unknown) => Number(value ?? 0);
const metadataOf = (db: DatabaseSync, sourceKey: string): Record<string, unknown> => {
  const row = db.prepare('SELECT metadataJson FROM UpdateSource WHERE sourceKey = ?').get(sourceKey) as { metadataJson?: string } | undefined;
  try { return row?.metadataJson ? JSON.parse(row.metadataJson) as Record<string, unknown> : {}; } catch { return {}; }
};
const WorldSchema = z.object({ currentSeason: z.number().int(), matchRound: z.number().int(), seriesMatchDate: z.string(),
  seasonOffset: z.number().int().optional() });
/** Observed spread of real decisive dates around the round-14 estimate for calibrated seasons
 * (qa/audit-pre-signup-attributions.mjs): league titles [-7, +14] days, cup finals [-75, +10]. */
export const LEAGUE_DATE_WINDOW: [number, number] = [-7, 14];
export const CUP_DATE_WINDOW: [number, number] = [-75, 10];
/** Before global season 15 the 16-week calendar is not calibrated: widen the early side by 2 seasons. */
export const FIRST_CALIBRATED_SEASON = 15;
const UNCALIBRATED_EXTRA_DAYS = 2 * SEASON_DAYS;
export function estimateWindow(base: [number, number], globalSeason: number): [number, number] {
  return globalSeason < FIRST_CALIBRATED_SEASON ? [base[0] - UNCALIBRATED_EXTRA_DAYS, base[1]] : base;
}

/** Empty-manager club titles with an exact team id. Recent editions only (current and previous
 * season) unless `backfill`, which covers every season with a retained or estimated decisive date. */
export async function collectClubTargets(db: DatabaseSync, store: ObjectStore | null, options: { backfill?: boolean } = {}): Promise<ClubTarget[]> {
  const targets: ClubTarget[] = [];
  const empty = '(championUserId IS NULL OR championUserId = 0) AND championTeamId > 0';
  const worlds = new Map<number, z.infer<typeof WorldSchema>>();
  for (const league of db.prepare('SELECT leagueId FROM NationalLeague').all() as Row[]) {
    const world = WorldSchema.safeParse(metadataOf(db, `worlddetails:${num(league.leagueId)}`).world);
    if (world.success) worlds.set(num(league.leagueId), world.data);
  }
  const globalWorld = [...worlds.values()].find(world => (world.seasonOffset ?? 0) === 0);
  const estimate = (world: z.infer<typeof WorldSchema> | undefined, season: number, base: [number, number]) => world
    ? { decisiveDate: leagueFinalRoundDate(world, season), dateWindowDays: estimateWindow(base, season - (world.seasonOffset ?? 0)) }
    : { decisiveDate: null, dateWindowDays: base };
  for (const league of db.prepare('SELECT leagueId, currentSeason FROM NationalLeague').all() as Row[]) {
    const leagueId = num(league.leagueId);
    const world = worlds.get(leagueId);
    const current = world?.currentSeason ?? num(league.currentSeason);
    for (const row of db.prepare(`SELECT season, championTeamId, championTeamName FROM LeagueChampion
      WHERE leagueId = ? AND complete = 1 AND season >= ? AND ${empty}`).all(leagueId, options.backfill ? 1 : current - 1) as Row[]) {
      targets.push({ family: 'league', table: 'LeagueChampion', competitionId: leagueId, season: num(row.season),
        teamId: num(row.championTeamId), teamName: String(row.championTeamName), competitionLeagueId: leagueId,
        ...estimate(world, num(row.season), LEAGUE_DATE_WINDOW), dateSource: `worlddetails:${leagueId} round ${LEAGUE_FINAL_ROUND} estimate` });
    }
  }
  for (const cup of db.prepare('SELECT cupId, leagueId, currentSeason FROM Cup').all() as Row[]) {
    const cupId = num(cup.cupId), leagueId = num(cup.leagueId);
    const family: ClubFamily = cupId === MASTERS_CUP_ID ? 'masters' : leagueId === 0 ? 'seasonal' : 'cup';
    const floor = options.backfill && family !== 'seasonal' ? 1 : num(cup.currentSeason) - (family === 'seasonal' ? 0 : 1);
    const meta = family === 'seasonal' ? metadataOf(db, `seasonal:${cupId}`) : {};
    for (const row of db.prepare(`SELECT season, finalMatchId, championTeamId, championTeamName FROM CupChampion
      WHERE cupId = ? AND finalMatchId > 0 AND season >= ? AND ${empty}`).all(cupId, floor) as Row[]) {
      let dated: { decisiveDate: string | null; dateWindowDays: [number, number] } = { decisiveDate: null, dateWindowDays: [0, 0] };
      let dateSource = `final ${num(row.finalMatchId)}`;
      const podium = meta.podium as { finalMatchId?: number; finalDate?: string } | undefined;
      if (family === 'seasonal' && podium?.finalMatchId === num(row.finalMatchId) && podium.finalDate) {
        dated = { decisiveDate: podium.finalDate, dateWindowDays: [0, 0] }; dateSource = 'tournament metadata';
      } else if (store) {
        try {
          const retained = await readEvidence(store, matchEvidenceKey(num(row.finalMatchId)));
          if (retained) {
            dated = { decisiveDate: new Date(`${parseCupFinalMatch(retained.capture.payload).matchDate.replace(' ', 'T')}Z`).toISOString(), dateWindowDays: [0, 0] };
            dateSource = 'retained matchdetails';
          }
        } catch { dateSource = 'retained matchdetails could not be read'; }
      }
      if (!dated.decisiveDate && family !== 'seasonal') {
        dated = estimate(family === 'masters' ? globalWorld : worlds.get(leagueId), num(row.season), CUP_DATE_WINDOW);
        dateSource = `${family === 'masters' ? 'global' : `league ${leagueId}`} season-end estimate`;
      }
      targets.push({ family, table: 'CupChampion', competitionId: cupId, season: num(row.season), teamId: num(row.championTeamId),
        teamName: String(row.championTeamName), competitionLeagueId: family === 'cup' ? leagueId : null, dateSource, ...dated });
    }
  }
  return targets;
}

export async function collectCoachTargets(db: DatabaseSync): Promise<CoachTarget[]> {
  const ids = JSON.parse(await readFile(NATIONAL_TEAM_IDS, 'utf8')) as Record<string, { nationalTeamId?: number; u20TeamId?: number }>;
  const nationTeam = (name: string, youth: boolean) => {
    const entry = ids[youth ? name.replace(/^U(?:20|21)\s+/i, '').trim() : name.trim()];
    return (youth ? entry?.u20TeamId : entry?.nationalTeamId) ?? null;
  };
  const split = (value: unknown) => (typeof value === 'string' && value ? value.split(',').map(part => part.trim()) : []);
  const targets: CoachTarget[] = [];
  const add = (base: Omit<CoachTarget, 'slot' | 'country' | 'teamId' | 'index'>, row: Row, teamIdOf: (slot: PodiumSlot, country: string, index?: number) => number | null) => {
    if (row.champion && num(row.championUserId) <= 0) targets.push({ ...base, slot: 'champion', country: String(row.champion), teamId: teamIdOf('champion', String(row.champion)) });
    if (row.runnerUp && num(row.runnerUpUserId) <= 0) targets.push({ ...base, slot: 'runnerUp', country: String(row.runnerUp), teamId: teamIdOf('runnerUp', String(row.runnerUp)) });
    const bronzeIds = split(row.thirdFourthUserIds);
    split(row.thirdFourth).forEach((country, index) => {
      if (!(Number(bronzeIds[index]) > 0)) targets.push({ ...base, slot: 'thirdFourth', index, country, teamId: teamIdOf('thirdFourth', country, index) });
    });
  };
  for (const youth of [0, 1]) {
    const row = db.prepare('SELECT * FROM WorldCupChampion WHERE isYouth = ? AND champion IS NOT NULL ORDER BY edition DESC LIMIT 1').get(youth) as Row | undefined;
    if (!row) continue;
    add({ table: 'WorldCupChampion', key: { isYouth: youth, edition: num(row.edition) }, isYouth: !!youth, cycle: num(row.edition),
      finalDate: nationalDateISO(row.finishedDate as string | null) }, row, (_slot, country) => nationTeam(country, !!youth));
  }
  for (const cup of db.prepare(`SELECT DISTINCT cupId FROM NationalCupChampion`).all() as Row[]) {
    const row = db.prepare(`SELECT * FROM NationalCupChampion WHERE cupId = ? AND status = 'Finished' ORDER BY season DESC LIMIT 1`).get(num(cup.cupId)) as Row | undefined;
    if (!row) continue;
    const bronzeTeams = split(row.thirdFourthTeamIds);
    add({ table: 'NationalCupChampion', key: { cupId: num(row.cupId), season: num(row.season) }, isYouth: !!row.isYouth, cycle: num(row.season),
      finalDate: nationalDateISO(row.finalDate as string | null) }, row, (slot, country, index) => {
      const stored = slot === 'champion' ? num(row.championTeamId) : slot === 'runnerUp' ? num(row.runnerUpTeamId) : Number(bronzeTeams[index ?? -1]);
      return stored > 0 ? stored : nationTeam(country, !!row.isYouth);
    });
  }
  return targets;
}

// --- CHPP evidence ---------------------------------------------------------------------------

const list = <T>(value: T | T[] | undefined | ''): T[] => (value === undefined || value === '' ? [] : Array.isArray(value) ? value : [value]);
const htIso = (value: unknown) => (typeof value === 'string' && value ? new Date(`${value.replace(' ', 'T')}Z`).toISOString() : null);

export function ownerSnapshot(raw: unknown, teamId: number): OwnerSnapshot {
  if (isDeletedTeamDetails(raw)) return { deleted: true, team: null, owner: null };
  const data = (raw as { HattrickData?: Record<string, any> } | undefined)?.HattrickData;
  if (!data) throw new Error('teamdetails returned no HattrickData');
  const team = list(data.Teams?.Team).find((candidate: any) => Number(candidate?.TeamID) === teamId) as Record<string, any> | undefined;
  const user = data.User as Record<string, any> | undefined;
  return {
    deleted: false,
    team: team ? { teamId, name: String(team.TeamName ?? ''), leagueId: Number(team.League?.LeagueID ?? 0), isBot: team.BotStatus?.IsBot === 'True', foundedDate: htIso(team.FoundedDate) } : null,
    owner: user && Number(user.UserID) > 0 ? { userId: Number(user.UserID), loginName: String(user.Loginname ?? ''), activationDate: htIso(user.ActivationDate) } : null,
  };
}

export function currentCoach(raw: unknown): CoachEvidence['current'] {
  const team = (raw as { HattrickData?: { Team?: Record<string, any> } } | undefined)?.HattrickData?.Team;
  if (!team) return null;
  return { teamId: Number(team.TeamID), leagueId: Number(team.League?.LeagueID ?? 0),
    coachId: Number(team.NationalCoach?.NationalCoachUserID ?? 0), coachLogin: team.NationalCoach?.NationalCoachLoginname ?? null };
}

// --- command ---------------------------------------------------------------------------------

const TenureSchema = z.record(z.string(), z.object({
  url: z.string().url(), capturedAt: z.string(),
  tail: z.array(z.object({ date: z.string(), userId: z.number().int().nonnegative(), name: z.string() }).passthrough()).min(1),
}).passthrough());

export interface AttributionSummary {
  dryRun: boolean;
  calls: number;
  clubs: { targets: number; attributed: number; accountGone: number; unresolved: number };
  coaches: { targets: number; attributed: number; accountGone: number; unresolved: number; needsTenure: number[] };
  newUsers: number;
  reportPath: string | null;
}

/** Private backfill progress (never part of the archive): when each club was last checked. */
const BackfillStateSchema = z.object({ teams: z.record(z.string().regex(/^\d+$/), z.object({ checkedAt: z.string(), outcome: z.string() })) });
type BackfillState = z.infer<typeof BackfillStateSchema>;
export const BACKFILL_RECHECK_DAYS = 90;

/** Recent titles first; clubs checked within the recheck window are skipped; at most maxTeams clubs. */
export function selectBackfillTeams(targets: ClubTarget[], state: BackfillState, now: number, maxTeams: number): Set<number> {
  const newest = new Map<number, number>();
  for (const target of targets) newest.set(target.teamId, Math.max(newest.get(target.teamId) ?? 0, Date.parse(target.decisiveDate ?? '') || 0));
  const fresh = (teamId: number) => { const at = Date.parse(state.teams[String(teamId)]?.checkedAt ?? ''); return Number.isFinite(at) && now - at < BACKFILL_RECHECK_DAYS * DAY; };
  return new Set([...newest].filter(([teamId]) => !fresh(teamId)).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, maxTeams).map(([teamId]) => teamId));
}

export async function attributeCheckout(options: {
  databasePath: string; token: TokenPair; store: ObjectStore | null; apply?: boolean; reportPath?: string; tenurePath?: string;
  maxCalls?: number; pacingMs?: number; backfill?: boolean; maxTeams?: number; statePath?: string;
}): Promise<AttributionSummary & { backfill?: { candidateTeams: number; checkedTeams: number; notSelected: number } }> {
  const databasePath = resolve(options.databasePath);
  const sidecar = await readReviewSidecar(databasePath);
  if (resolve(sidecar.databasePath) !== databasePath) throw new Error('Review sidecar belongs to a different database path');
  if (options.apply && !options.reportPath) throw new Error('attribute --apply requires --report <new.json>');
  if (options.backfill && !options.statePath) throw new Error('attribute --backfill requires --state <progress.json>');
  const state: BackfillState = options.statePath
    ? await readFile(resolve(options.statePath), 'utf8').then(text => BackfillStateSchema.parse(JSON.parse(text)), () => ({ teams: {} }))
    : { teams: {} };
  const reportFile = options.reportPath ? await open(resolve(options.reportPath), 'wx') : undefined;
  const tenure = options.tenurePath ? TenureSchema.parse(JSON.parse(await readFile(resolve(options.tenurePath), 'utf8'))) : {};
  const maxTeams = options.maxTeams ?? 500;
  const runtime = configureChppRuntime({ maxCalls: options.maxCalls ?? Math.max(400, 2 * maxTeams + 50), pacingMs: options.pacingMs ?? 1000, maxRetries: 1 });
  let calls = 0;
  try {
    const db = new DatabaseSync(databasePath);
    try {
      const candidates = await collectClubTargets(db, options.store, { backfill: options.backfill });
      const selected = options.backfill ? selectBackfillTeams(candidates, state, Date.now(), maxTeams) : null;
      const clubTargets = selected ? candidates.filter(target => selected.has(target.teamId)) : candidates;
      const coachTargets = await collectCoachTargets(db);
      const snapshots = new Map<number, OwnerSnapshot>();
      const clubResults: Array<{ target: ClubTarget; decision: Decision; snapshot?: OwnerSnapshot }> = [];
      const laterQuery = {
        league: db.prepare(`SELECT championUserId AS u FROM LeagueChampion WHERE championTeamId = ? AND leagueId = ? AND season > ? AND championUserId > 0`),
        cup: db.prepare(`SELECT championUserId AS u FROM CupChampion WHERE championTeamId = ? AND leagueId = ? AND season > ? AND championUserId > 0`),
        masters: db.prepare(`SELECT championUserId AS u FROM CupChampion WHERE championTeamId = ? AND cupId = ${MASTERS_CUP_ID} AND season > ? AND championUserId > 0`),
      };
      for (const target of clubTargets) {
        let snapshot = snapshots.get(target.teamId);
        try {
          if (!snapshot) { calls++; snapshot = ownerSnapshot(await chppGet(options.token, { file: 'teamdetails', version: '3.6', teamID: target.teamId }), target.teamId); snapshots.set(target.teamId, snapshot); }
        } catch (error) {
          clubResults.push({ target, decision: { status: 'unresolved', reason: `teamdetails failed: ${error instanceof Error ? error.name : 'error'}` } });
          continue;
        }
        // Same-season credits are comparable only within one country's season numbering.
        const others = (target.family === 'league' || target.family === 'cup' ? [
          ...db.prepare(`SELECT championUserId AS u FROM CupChampion WHERE championTeamId = ? AND season = ? AND leagueId = ? AND championUserId > 0
            AND NOT (cupId = ? AND ? = 'cup')`).all(target.teamId, target.season, target.competitionLeagueId, target.competitionId, target.family),
          ...db.prepare(`SELECT championUserId AS u FROM LeagueChampion WHERE championTeamId = ? AND season = ? AND leagueId = ? AND championUserId > 0
            AND ? = 'cup'`).all(target.teamId, target.season, target.competitionLeagueId, target.family),
        ] : []) as Row[];
        // Later titles of the same club (same season numbering) credited to someone else contradict
        // continuous ownership since this title.
        const later = (target.family === 'league' || target.family === 'cup'
          ? [...laterQuery.league.all(target.teamId, target.competitionLeagueId, target.season), ...laterQuery.cup.all(target.teamId, target.competitionLeagueId, target.season)]
          : target.family === 'masters' ? laterQuery.masters.all(target.teamId, target.season) : []) as Row[];
        clubResults.push({ target, snapshot, decision: decideClubOwner(target, snapshot, others.map(row => num(row.u)), later.map(row => num(row.u))) });
      }
      const coaches = new Map<number, CoachEvidence['current']>();
      const coachResults: Array<{ target: CoachTarget; decision: Decision }> = [];
      for (const target of coachTargets) {
        if (!target.teamId) { coachResults.push({ target, decision: decideNationalCoach(target, { current: null, cycleElections: [] }) }); continue; }
        const captured = tenure[String(target.teamId)];
        let current = coaches.get(target.teamId) ?? null;
        if (!captured && !coaches.has(target.teamId)) {
          try { calls++; current = currentCoach(await fetchNationalTeamDetails(options.token, target.teamId)); } catch { current = null; }
          coaches.set(target.teamId, current);
        }
        const leagueId = current?.leagueId ?? 0;
        const cycleElections = leagueId > 0 ? db.prepare(`SELECT winnerUserId FROM NationalCoachElection WHERE leagueId = ? AND isYouth = ? AND edition = ? ORDER BY id`)
          .all(leagueId, target.isYouth ? 1 : 0, target.cycle) as Array<{ winnerUserId: number | null }> : [];
        const dated = captured?.tail.map(entry => ({ date: nationalDateISO(entry.date) ?? entry.date, userId: entry.userId, name: entry.name }));
        coachResults.push({ target, decision: decideNationalCoach(target, { current, cycleElections, ...(dated ? { tenure: dated } : {}) }) });
      }
      // Nationality for managers new to the archive (same pinned managercompendium lookup).
      const accepted = [...clubResults, ...coachResults].flatMap(result => result.decision.status === 'attribute' ? [result.decision] : []);
      const known = db.prepare('SELECT userId, loginName, nationality FROM HattrickUser WHERE userId = ?');
      const newUsers = new Map<number, { loginName: string; countryId: number | null; nationality: string | null }>();
      for (const decision of accepted) {
        if (known.get(decision.userId) || newUsers.has(decision.userId)) continue;
        let nationality: { countryId: number | null; nationality: string | null } = { countryId: null, nationality: null };
        try { calls++; nationality = await resolveUserNationality(options.token, decision.userId); } catch { /* the nationality lane retries later */ }
        newUsers.set(decision.userId, { loginName: decision.loginName, ...nationality });
      }
      let applied = 0;
      if (options.apply) applied = applyDecisions(db, clubResults, coachResults, newUsers);
      const summary: AttributionSummary = {
        dryRun: !options.apply, calls,
        clubs: { targets: clubTargets.length, attributed: clubResults.filter(r => r.decision.status === 'attribute').length,
          accountGone: clubResults.filter(r => r.decision.status === 'account_gone').length, unresolved: clubResults.filter(r => r.decision.status === 'unresolved').length },
        coaches: { targets: coachTargets.length, attributed: coachResults.filter(r => r.decision.status === 'attribute').length,
          accountGone: coachResults.filter(r => r.decision.status === 'account_gone').length, unresolved: coachResults.filter(r => r.decision.status === 'unresolved').length,
          needsTenure: [...new Set(coachResults.filter(r => r.decision.status === 'unresolved' && r.decision.reason.startsWith('needs_tenure')).map(r => r.target.teamId!))] },
        newUsers: newUsers.size, reportPath: options.reportPath ? resolve(options.reportPath) : null,
      };
      if (options.apply && applied !== summary.clubs.attributed + summary.coaches.attributed) throw new Error('Applied attribution count does not match the plan');
      const result = selected ? { ...summary, backfill: { candidateTeams: new Set(candidates.map(target => target.teamId)).size,
        checkedTeams: snapshots.size, notSelected: new Set(candidates.map(target => target.teamId)).size - selected.size } } : summary;
      if (reportFile) await reportFile.writeFile(`${JSON.stringify({ ...result, generatedAt: new Date().toISOString(),
        clubs: clubResults, coaches: coachResults, newUsers: Object.fromEntries(newUsers) }, null, 1)}\n`);
      // Record checked clubs only once their outcome is applied; a failed call is not a check.
      if (options.apply && options.statePath) {
        const checkedAt = new Date().toISOString();
        for (const { target, decision, snapshot } of clubResults) if (snapshot) {
          const prior = state.teams[String(target.teamId)];
          state.teams[String(target.teamId)] = { checkedAt, outcome: prior?.checkedAt === checkedAt && prior.outcome !== decision.status ? 'mixed' : decision.status };
        }
        await writeFile(resolve(options.statePath), `${JSON.stringify(state, null, 1)}\n`);
      }
      return result;
    } finally { db.close(); }
  } finally { runtime.dispose(); await reportFile?.close(); }
}

export function applyDecisions(db: DatabaseSync, clubs: Array<{ target: ClubTarget; decision: Decision }>,
  coaches: Array<{ target: CoachTarget; decision: Decision }>, newUsers: Map<number, { loginName: string; countryId: number | null; nationality: string | null }>): number {
  const now = Date.now();
  let applied = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    const insertUser = db.prepare('INSERT INTO HattrickUser (userId, loginName, countryId, nationality, isBot, updatedAt) VALUES (?, ?, ?, ?, 0, ?)');
    for (const [userId, user] of newUsers) insertUser.run(userId, user.loginName, user.countryId, user.nationality, now);
    const login = (userId: number) => String((db.prepare('SELECT loginName FROM HattrickUser WHERE userId = ?').get(userId) as Row).loginName);
    for (const { target, decision } of clubs) {
      if (decision.status !== 'attribute') continue;
      const keyColumn = target.table === 'LeagueChampion' ? 'leagueId' : 'cupId';
      const result = db.prepare(`UPDATE ${target.table} SET championUserId = ?, championUserName = ?, updatedAt = ?
        WHERE ${keyColumn} = ? AND season = ? AND championTeamId = ? AND (championUserId IS NULL OR championUserId = 0)`)
        .run(decision.userId, login(decision.userId), now, target.competitionId, target.season, target.teamId);
      if (result.changes !== 1) throw new Error(`Guard rejected ${target.table} ${target.competitionId}/${target.season}`);
      applied++;
    }
    const grouped = new Map<string, Array<{ target: CoachTarget; decision: Extract<Decision, { status: 'attribute' }> }>>();
    for (const { target, decision } of coaches) if (decision.status === 'attribute') {
      const key = JSON.stringify([target.table, target.key]);
      grouped.set(key, [...(grouped.get(key) ?? []), { target, decision }]);
    }
    for (const entries of grouped.values()) {
      const { table, key } = entries[0]!.target;
      const where = table === 'WorldCupChampion' ? 'isYouth = ? AND edition = ?' : 'cupId = ? AND season = ?';
      const args = 'edition' in key ? [key.isYouth, key.edition] : [key.cupId, key.season];
      const row = db.prepare(`SELECT * FROM ${table} WHERE ${where}`).get(...args) as Row;
      const next = { championUserId: row.championUserId as number | null, championUserName: row.championUserName as string | null, runnerUpUserId: row.runnerUpUserId as number | null };
      const countries = String(row.thirdFourth ?? '').split(',').map(part => part.trim()).filter(Boolean);
      const bronze = countries.map((_, index) => String(row.thirdFourthUserIds ?? '').split(',')[index] ?? '');
      for (const { target, decision } of entries) {
        if (target.slot === 'champion') {
          if (row.champion !== target.country || num(row.championUserId) > 0) throw new Error(`Champion slot changed for ${table}`);
          next.championUserId = decision.userId; next.championUserName = login(decision.userId);
        } else if (target.slot === 'runnerUp') {
          if (row.runnerUp !== target.country || num(row.runnerUpUserId) > 0) throw new Error(`Runner-up slot changed for ${table}`);
          next.runnerUpUserId = decision.userId;
        } else {
          if (countries[target.index!] !== target.country || Number(bronze[target.index!]) > 0) throw new Error(`Bronze slot changed for ${table}`);
          bronze[target.index!] = String(decision.userId);
        }
        applied++;
      }
      const thirdFourthUserIds = bronze.some(Boolean) ? bronze.join(',') : String(row.thirdFourthUserIds ?? '');
      const result = db.prepare(`UPDATE ${table} SET championUserId = ?, championUserName = ?, runnerUpUserId = ?, thirdFourthUserIds = ?, updatedAt = ?
        WHERE ${where} AND championUserId IS ? AND runnerUpUserId IS ? AND thirdFourthUserIds IS ?`)
        .run(next.championUserId, next.championUserName, next.runnerUpUserId, thirdFourthUserIds, now, ...args,
          row.championUserId as number | null, row.runnerUpUserId as number | null, row.thirdFourthUserIds as string | null);
      if (result.changes !== 1) throw new Error(`Guard rejected ${table} ${JSON.stringify(key)}`);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return applied;
}
