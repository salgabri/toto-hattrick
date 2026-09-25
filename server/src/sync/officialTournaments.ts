import type { UpdateItem, UpdateSource } from '@prisma/client';
import { prisma } from '../db/client.js';
import type { TokenPair } from '../chpp/auth.js';
import {
  fetchTeamDetails,
  fetchTournamentDetails,
  fetchTournamentFixtures,
} from '../chpp/endpoints.js';
import {
  parseTeamDetails,
  parseTournamentDetails,
  parseTournamentFixtures,
  type TournamentFixtureResult,
} from '../schemas/index.js';
import type { CupFinalMatch } from '../schemas/cupFinal.js';
import { matchEvidenceKey } from '../update/evidence.js';
import { loadCupFinalMatch } from './cupFinals.js';
import { ingestNtCupSeasons, NT_CUPS } from './ntCups.js';
import { ingestSeasonalWinners } from './seasonal.js';
import { ingestWorldCupHistory } from './worldCup.js';

const DAY = 86_400_000;
const LEGACY_UNPROVEN_PODIUM = 'The official fixture set did not prove one complete decisive final and both semifinals';
const UNPROVEN_PODIUM = 'The official fixture set did not prove one complete decisive final and both semifinals, including any explicit retained tiebreaker evidence';
const RETAINED_TIE_REVIEW = 'Tied knockout matchdetails were retained, but no matched Tournament sample yet proves a penalty-winner interpretation; explicit review is required';

/** The post-2021 World Cups use Hattrick's Tournament system. */
export const MODERN_WORLD_CUP_TOURNAMENTS = [
  { sourceKey: 'worldcup:senior', tournamentId: 5001315, name: 'World Cup', isYouth: false },
  { sourceKey: 'worldcup:youth', tournamentId: 4892549, name: 'U21 World Cup', isYouth: true },
] as const;

type TournamentKind = 'worldcup' | 'national-cup' | 'seasonal';
interface TournamentSourceSpec {
  sourceKey: string;
  tournamentId: number;
  name: string;
  kind: TournamentKind;
  isYouth: boolean;
  /** Only national-team tournaments accept an explicit historical season. */
  supportsHistoricalSeason: boolean;
}

export interface TournamentPodiumTeam {
  teamId: number;
  teamName: string;
}
export interface TournamentPodium {
  finalMatchId: number;
  finalRound: number;
  finalDate: Date;
  champion: TournamentPodiumTeam;
  runnerUp: TournamentPodiumTeam;
  thirdFourth: TournamentPodiumTeam[];
  /** Immutable matchdetails captures used only when a tied knockout match needed a tiebreaker. */
  tiebreakerEvidenceRefs?: string[];
}

/** Explicit, retained evidence for one tied tournament match. The live coordinator deliberately
 * does not synthesize this from localized EventText or the unpaired legacy penalty samples;
 * `deriveTournamentPodium` still compares every copied fact so stale evidence remains inert. */
export interface TournamentTiebreakerEvidence {
  matchId: number;
  matchType: number;
  matchDate: Date;
  homeTeamId: number;
  homeTeamName: string;
  awayTeamId: number;
  awayTeamName: string;
  homeGoals: number;
  awayGoals: number;
  winnerTeamId: number;
  evidenceRef: string;
}

const cleanTeamName = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim();

function chppMatchDate(value: string): number {
  return new Date(`${value.replace(' ', 'T')}Z`).getTime();
}

/** Identity gate shared by the capture path and tests. Passing it does not identify a winner. */
export function tournamentMatchDetailsAgree(
  fixture: TournamentFixtureResult,
  match: CupFinalMatch,
  tournamentId: number,
): boolean {
  const fixtureDate = fixture.matchDate.getTime();
  const finishedDate = match.finishedDate ? chppMatchDate(match.finishedDate) : Number.NaN;
  return fixture.status === 2 && fixture.group === 0 && fixture.homeGoals === fixture.awayGoals &&
    match.matchId === fixture.matchId && match.cupId === tournamentId && match.matchType === fixture.matchType &&
    match.homeTeamId === fixture.homeTeamId && match.awayTeamId === fixture.awayTeamId &&
    cleanTeamName(match.homeTeamName) === cleanTeamName(fixture.homeTeamName) &&
    cleanTeamName(match.awayTeamName) === cleanTeamName(fixture.awayTeamName) &&
    match.homeGoals === fixture.homeGoals && match.awayGoals === fixture.awayGoals &&
    Number.isFinite(fixtureDate) && chppMatchDate(match.matchDate) === fixtureDate &&
    Number.isFinite(finishedDate) && finishedDate >= fixtureDate && match.homeTeamId !== match.awayTeamId;
}

interface TournamentPodiumBracket {
  final: TournamentFixtureResult;
  semifinals: [TournamentFixtureResult, TournamentFixtureResult];
}

function tournamentPodiumBracket(matches: readonly TournamentFixtureResult[]): TournamentPodiumBracket | null {
  const playoffs = matches.filter(match => match.group === 0);
  if (!playoffs.length) return null;
  const finalRound = Math.max(...playoffs.map(match => match.round));
  const finals = playoffs.filter(match => match.round === finalRound);
  if (finals.length !== 1 || finals[0]!.status !== 2) return null;
  const final = finals[0]!;
  const earlierRounds = playoffs.map(match => match.round).filter(round => round < finalRound);
  const semifinalRound = earlierRounds.length ? Math.max(...earlierRounds) : null;
  const semifinals = semifinalRound === null ? [] : playoffs.filter(match => match.round === semifinalRound);
  if (semifinals.length !== 2 || semifinals.some(match => match.status !== 2 ||
      match.matchDate.getTime() > final.matchDate.getTime() || match.matchType !== final.matchType)) return null;
  return { final, semifinals: [semifinals[0]!, semifinals[1]!] };
}

interface RetainedTiebreakerCaptures {
  attempted: boolean;
  evidenceRefs: string[];
  reason: string | null;
}

/** Capture each tied final/semifinal once. There is intentionally no winner inference here: the
 * retained penalty files are legacy cup matches, not a matched Tournament fixture/detail sample. */
async function retainTiedTournamentMatches(
  token: TokenPair,
  spec: TournamentSourceSpec,
  matches: readonly TournamentFixtureResult[],
): Promise<RetainedTiebreakerCaptures> {
  const bracket = tournamentPodiumBracket(matches);
  if (!bracket) return { attempted: false, evidenceRefs: [], reason: null };
  const tied = [bracket.final, ...bracket.semifinals].filter(match => match.homeGoals === match.awayGoals);
  if (!tied.length) return { attempted: false, evidenceRefs: [], reason: null };
  const evidenceRefs: string[] = [];
  const reasons: string[] = [];
  for (const fixture of tied) {
    const loaded = await loadCupFinalMatch(token, fixture.matchId);
    if (!loaded.match) {
      reasons.push(loaded.reason ?? `Match ${fixture.matchId} has no retained finished event evidence`);
      continue;
    }
    if (!tournamentMatchDetailsAgree(fixture, loaded.match, spec.tournamentId)) {
      reasons.push(`Match ${fixture.matchId} details disagree with the official Tournament fixture identity`);
      continue;
    }
    evidenceRefs.push(matchEvidenceKey(fixture.matchId));
  }
  return {
    attempted: true,
    evidenceRefs: [...new Set(evidenceRefs)].sort(),
    reason: reasons.length ? reasons.join('; ') : null,
  };
}

function tiebreakerWinner(match: TournamentFixtureResult, evidence: readonly TournamentTiebreakerEvidence[]): number | null {
  if (match.homeGoals !== match.awayGoals) return match.homeGoals > match.awayGoals ? match.homeTeamId : match.awayTeamId;
  const candidates = evidence.filter(entry => entry.matchId === match.matchId);
  if (candidates.length !== 1) return null;
  const entry = candidates[0]!;
  if (entry.matchType !== match.matchType || entry.matchDate.getTime() !== match.matchDate.getTime() ||
      entry.homeTeamId !== match.homeTeamId || entry.awayTeamId !== match.awayTeamId ||
      cleanTeamName(entry.homeTeamName) !== cleanTeamName(match.homeTeamName) ||
      cleanTeamName(entry.awayTeamName) !== cleanTeamName(match.awayTeamName) ||
      entry.homeGoals !== match.homeGoals || entry.awayGoals !== match.awayGoals ||
      ![match.homeTeamId, match.awayTeamId].includes(entry.winnerTeamId) ||
      entry.evidenceRef !== matchEvidenceKey(match.matchId)) return null;
  return entry.winnerTeamId;
}

/**
 * A final is accepted only when the highest playoff round is one finished, decisive match.
 * The preceding two-match playoff round supplies the joint bronze teams. Group-stage leaders and
 * an unfinished/scheduled final can therefore never be mistaken for a champion.
 */
export function deriveTournamentPodium(
  matches: readonly TournamentFixtureResult[],
  tiebreakers: readonly TournamentTiebreakerEvidence[] = [],
): TournamentPodium | null {
  const bracket = tournamentPodiumBracket(matches);
  if (!bracket) return null;
  const { final, semifinals } = bracket;
  const finalWinner = tiebreakerWinner(final, tiebreakers);
  const semifinalWinners = semifinals.map(match => tiebreakerWinner(match, tiebreakers));
  if (finalWinner === null || semifinalWinners.some(teamId => teamId === null)) return null;
  const finalists = [final.homeTeamId, final.awayTeamId];
  if (new Set(semifinalWinners).size !== 2 || finalists.some(teamId => !semifinalWinners.includes(teamId))) return null;
  const thirdFourth = semifinals.map((match, index) => semifinalWinners[index] === match.homeTeamId
    ? { teamId: match.awayTeamId, teamName: match.awayTeamName }
    : { teamId: match.homeTeamId, teamName: match.homeTeamName });
  if (new Set([...finalists, ...thirdFourth.map(team => team.teamId)]).size !== 4) return null;

  const relevantMatchIds = new Set([final.matchId, ...semifinals.map(match => match.matchId)]);
  const tiebreakerEvidenceRefs = tiebreakers
    .filter(entry => relevantMatchIds.has(entry.matchId))
    .map(entry => entry.evidenceRef)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();

  return {
    finalMatchId: final.matchId,
    finalRound: final.round,
    finalDate: final.matchDate,
    champion: finalWinner === final.homeTeamId
      ? { teamId: final.homeTeamId, teamName: final.homeTeamName }
      : { teamId: final.awayTeamId, teamName: final.awayTeamName },
    runnerUp: finalWinner === final.homeTeamId
      ? { teamId: final.awayTeamId, teamName: final.awayTeamName }
      : { teamId: final.homeTeamId, teamName: final.homeTeamName },
    thirdFourth,
    ...(tiebreakerEvidenceRefs.length ? { tiebreakerEvidenceRefs } : {}),
  };
}

interface StoredEdition { edition: number; complete: boolean }
interface RefreshIssue { sourceKey: string; edition?: number; category: string; message: string }
export interface OfficialTournamentRefreshResult {
  metadataChecked: number;
  itemsAttempted: number;
  nationalTrophiesAdded: number;
  seasonalChampionsAdded: number;
  issues: RefreshIssue[];
}

function later(now: Date, days = 1) { return new Date(now.getTime() + days * DAY); }
function due(at: Date | null, now: Date) { return at === null || at <= now; }
function itemKey(sourceKey: string, edition: number, task = 'result') {
  return { sourceKey_itemKey_task: { sourceKey, itemKey: String(edition), task } };
}
function sourceMetadata(source: Pick<UpdateSource, 'metadataJson'>): Record<string, unknown> {
  try { return JSON.parse(source.metadataJson) as Record<string, unknown>; } catch { return {}; }
}
function successfulMetadata(source: Pick<UpdateSource, 'metadataJson'>): Record<string, unknown> {
  const { failure: _failure, ...metadata } = sourceMetadata(source);
  return metadata;
}
function safeIssue(error: unknown): { category: string; message: string; stop: boolean } {
  const name = error instanceof Error ? error.name : '';
  if (name === 'ChppBudgetError') return { category: 'budget', message: 'CHPP request allowance exhausted; tournament work stays queued', stop: true };
  if (['ChppStorageError', 'StorageUnavailableError', 'StorageConflictError'].includes(name) || name.startsWith('Prisma'))
    return { category: 'storage', message: 'Tournament evidence or archive state could not be persisted', stop: true };
  if (name === 'InvalidEvidenceError' || name === 'ZodError') return { category: 'schema', message: 'Official tournament response needs retained sample review', stop: false };
  if (name === 'ChppRequestError' && error && typeof error === 'object' && 'category' in error) {
    const category = String(error.category);
    return { category, message: 'Official tournament source check failed; retained facts are unchanged', stop: ['authentication', 'forbidden'].includes(category) };
  }
  if (error instanceof Error && /conflict|not retained|different tournament|regressed/i.test(error.message))
    return { category: 'evidence', message: 'Official tournament facts conflict with retained evidence; review is required', stop: false };
  return { category: 'source', message: 'Official tournament source could not be fetched or validated', stop: false };
}
function dotDate(date: Date) {
  return `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${date.getUTCFullYear()}`;
}
function dashDate(date: Date) { return dotDate(date).replaceAll('.', '-'); }
function dashDateTime(date: Date) {
  return `${dashDate(date)} ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}
function nationName(name: string, isYouth: boolean) { return isYouth ? name.replace(/^U(?:20|21)\s+/i, '').trim() : name.trim(); }

type ResultItem = { edition: number | null; attempts: number; nextAttemptAt: Date | null };

/**
 * Give a running edition the first and at least every-other daily probe, while spending the
 * intervening probes on the least-attempted historical gap. A perpetually unfinished current
 * bracket can therefore delay an old edition by at most one run, never forever.
 */
export function selectTournamentResult<T extends ResultItem>(items: readonly T[], currentEdition: number, now: Date): T | undefined {
  const current = items.find(item => item.edition === currentEdition);
  const historical = items.filter(item => item.edition !== null && item.edition !== currentEdition)
    .sort((a, b) => a.attempts - b.attempts ||
      (a.nextAttemptAt?.getTime() ?? 0) - (b.nextAttemptAt?.getTime() ?? 0) ||
      (b.edition ?? 0) - (a.edition ?? 0));
  if (!current) return historical[0];
  if (!historical.length || current.attempts === 0 || current.nextAttemptAt === null ||
      current.nextAttemptAt.getTime() <= now.getTime() - DAY) return current;
  return historical[0];
}

async function specs(): Promise<TournamentSourceSpec[]> {
  const seasonal = await prisma.cup.findMany({
    where: { leagueId: 0, cupId: { not: 183 } },
    select: { cupId: true, cupName: true },
    orderBy: { cupId: 'asc' },
  });
  return [
    ...MODERN_WORLD_CUP_TOURNAMENTS.map(cup => ({ ...cup, kind: 'worldcup' as const, supportsHistoricalSeason: true })),
    ...NT_CUPS.map(cup => ({ sourceKey: `national-cup:${cup.cupId}`, tournamentId: cup.cupId, name: cup.name,
      isYouth: cup.isYouth, kind: 'national-cup' as const, supportsHistoricalSeason: true })),
    ...seasonal.map(cup => ({ sourceKey: `seasonal:${cup.cupId}`, tournamentId: cup.cupId, name: cup.cupName,
      isYouth: false, kind: 'seasonal' as const, supportsHistoricalSeason: false })),
  ];
}

async function storedEditions(spec: TournamentSourceSpec): Promise<StoredEdition[]> {
  if (spec.kind === 'worldcup') {
    const rows = await prisma.worldCupChampion.findMany({ where: { isYouth: spec.isYouth }, select: { edition: true, champion: true, finishedDate: true } });
    return rows.map(row => ({ edition: row.edition, complete: Boolean(row.champion && row.finishedDate) }));
  }
  if (spec.kind === 'national-cup') {
    const rows = await prisma.nationalCupChampion.findMany({ where: { cupId: spec.tournamentId }, select: { season: true, champion: true, finalDate: true } });
    return rows.map(row => ({ edition: row.season, complete: Boolean(row.champion && row.finalDate) }));
  }
  const rows = await prisma.cupChampion.findMany({ where: { cupId: spec.tournamentId }, select: { season: true, championTeamName: true } });
  return rows.map(row => ({ edition: row.season, complete: Boolean(row.championTeamName.trim()) }));
}

async function migrateSource(spec: TournamentSourceSpec, now: Date): Promise<UpdateSource> {
  const previous = await prisma.updateSource.findUnique({ where: { sourceKey: spec.sourceKey } });
  return prisma.updateSource.upsert({
    where: { sourceKey: spec.sourceKey },
    create: { sourceKey: spec.sourceKey, kind: 'tournament', externalId: spec.tournamentId,
      numberingSystem: spec.kind === 'seasonal' ? `tournament:${spec.tournamentId}:season` : 'national-team:cycle',
      metadataJson: JSON.stringify({ name: spec.name, tournamentKind: spec.kind }) },
    update: { kind: 'tournament', externalId: spec.tournamentId,
      numberingSystem: spec.kind === 'seasonal' ? `tournament:${spec.tournamentId}:season` : 'national-team:cycle',
      metadataJson: JSON.stringify({ ...sourceMetadata(previous ?? { metadataJson: '{}' }), name: spec.name, tournamentKind: spec.kind }),
      nextCheckAt: previous?.kind === 'manual' ? now : undefined },
  });
}

async function reconcileItems(spec: TournamentSourceSpec, source: UpdateSource,
  details: ReturnType<typeof parseTournamentDetails>, rows: StoredEdition[], now: Date) {
  const current = details.season;
  const byEdition = new Map(rows.map(row => [row.edition, row]));
  const baseline = source.baseline ?? (rows.length ? Math.min(...rows.map(row => row.edition)) : current);
  await prisma.updateSource.update({ where: { sourceKey: spec.sourceKey }, data: {
    baseline, observedThrough: Math.max(source.observedThrough ?? 0, current),
  } });
  for (let edition = baseline; edition <= current; edition++) {
    const stored = byEdition.get(edition);
    const inaccessibleSeasonalGap = spec.kind === 'seasonal' && edition < current && !stored?.complete;
    const state = stored?.complete ? 'complete' : inaccessibleSeasonalGap ? 'needs_review' : 'pending';
    const error = inaccessibleSeasonalGap
      ? 'This restarted tournament exposes only its current fixtures; retained historical evidence is required for the missed edition'
      : null;
    await prisma.updateItem.upsert({
      where: itemKey(spec.sourceKey, edition),
      create: { sourceKey: spec.sourceKey, itemKey: String(edition), task: 'result', edition, state,
        nextAttemptAt: state === 'pending' ? now : null, completedAt: state === 'complete' ? now : null, lastError: error },
      update: stored?.complete
        ? { state: 'complete', nextAttemptAt: null, completedAt: now, lastError: null, errorCategory: null }
        : inaccessibleSeasonalGap
          ? { state: 'needs_review', nextAttemptAt: null, completedAt: null, lastError: error, errorCategory: 'evidence' }
          : {},
    });
  }
  // One-time migration for items parked before deterministic matchdetails capture existed. A new
  // unresolved result receives UNPROVEN_PODIUM/RETAINED_TIE_REVIEW and is not reopened each day.
  await prisma.updateItem.updateMany({
    where: { sourceKey: spec.sourceKey, task: 'result', state: 'needs_review', lastError: LEGACY_UNPROVEN_PODIUM },
    data: { state: 'pending', nextAttemptAt: now, completedAt: null, lastError: null, errorCategory: null },
  });
  // A finished match in an in-progress multi-match round is not a final. Earlier runs could
  // park such a current edition for review; a future official match round proves it is retryable.
  if (details.nextMatchRoundDate > now) await prisma.updateItem.updateMany({
    where: { sourceKey: spec.sourceKey, itemKey: String(current), task: 'result',
      state: 'needs_review', lastError: UNPROVEN_PODIUM },
    data: { state: 'pending', nextAttemptAt: now, completedAt: null, lastError: null, errorCategory: null },
  });
}

async function retainReviewTask(sourceKey: string, edition: number, task: string, reason: string): Promise<void> {
  const where = itemKey(sourceKey, edition, task);
  const existing = await prisma.updateItem.findUnique({ where });
  if (existing?.state === 'complete') return;
  await prisma.updateItem.upsert({ where,
    create: { sourceKey, itemKey: String(edition), task, edition, state: 'needs_review', lastError: reason, errorCategory: 'evidence' },
    update: { state: 'needs_review', completedAt: null, nextAttemptAt: null, lastError: reason, errorCategory: 'evidence' },
  });
}

async function ensureCurrentPlaceholder(spec: TournamentSourceSpec, details: ReturnType<typeof parseTournamentDetails>): Promise<void> {
  if (spec.kind === 'worldcup') {
    const existing = await prisma.worldCupChampion.findUnique({ where: { isYouth_edition: { isYouth: spec.isYouth, edition: details.season } } });
    if (!existing) await ingestWorldCupHistory(spec.isYouth
      ? { senior: [], youth: [{ edition: details.season, ageGroup: 'U21', host: '', finished: null, champion: null, runnerUp: null, thirdFourth: [] }] }
      : { senior: [{ edition: details.season, host: '', finished: null, champion: null, runnerUp: null, thirdFourth: [] }], youth: [] });
  } else if (spec.kind === 'national-cup') {
    const existing = await prisma.nationalCupChampion.findUnique({ where: { cupId_season: { cupId: spec.tournamentId, season: details.season } } });
    if (!existing) await ingestNtCupSeasons([{ cupId: spec.tournamentId, season: details.season, cupName: spec.name,
      startedDate: dashDateTime(details.firstMatchRoundDate), finalDate: null, status: null, champion: null, runnerUp: null, thirdFourth: [] }]);
  }
}

async function retainHostReview(spec: TournamentSourceSpec, edition: number, now: Date): Promise<void> {
  if (spec.kind === 'seasonal') return;
  const host = spec.kind === 'worldcup'
    ? (await prisma.worldCupChampion.findUnique({ where: { isYouth_edition: { isYouth: spec.isYouth, edition } }, select: { host: true } }))?.host
    : (await prisma.nationalCupChampion.findUnique({ where: { cupId_season: { cupId: spec.tournamentId, season: edition } }, select: { host: true } }))?.host;
  if (!host?.trim()) {
    await retainReviewTask(spec.sourceKey, edition, 'host',
      'The official tournament XML identifies the competition and results but does not expose the host; retain reviewed host evidence');
    return;
  }
  await prisma.updateItem.updateMany({
    where: { sourceKey: spec.sourceKey, itemKey: String(edition), task: 'host', state: { not: 'complete' } },
    data: { state: 'complete', completedAt: now, nextAttemptAt: null, lastError: null, errorCategory: null },
  });
}

async function nationalLeagueIds(teamIds: number[]) {
  const leagues = await prisma.nationalLeague.findMany({
    where: { OR: [{ nationalTeamId: { in: teamIds } }, { u20TeamId: { in: teamIds } }] },
    select: { leagueId: true, nationalTeamId: true, u20TeamId: true },
  });
  return new Map(leagues.flatMap(league => [
    ...(league.nationalTeamId ? [[league.nationalTeamId, league.leagueId] as const] : []),
    ...(league.u20TeamId ? [[league.u20TeamId, league.leagueId] as const] : []),
  ]));
}

async function storePodium(token: TokenPair, spec: TournamentSourceSpec, edition: number, podium: TournamentPodium,
  details: ReturnType<typeof parseTournamentDetails>, fixtures: readonly TournamentFixtureResult[]): Promise<{ added: boolean; seasonal: boolean }> {
  const before = (await storedEditions(spec)).find(row => row.edition === edition)?.complete ?? false;
  if (spec.kind === 'worldcup') {
    const stored = await prisma.worldCupChampion.findUnique({ where: { isYouth_edition: { isYouth: spec.isYouth, edition } } });
    const row = { edition, ...(spec.isYouth ? { ageGroup: 'U21' } : {}), host: stored?.host ?? '', finished: dotDate(podium.finalDate),
      champion: nationName(podium.champion.teamName, spec.isYouth), runnerUp: nationName(podium.runnerUp.teamName, spec.isYouth),
      thirdFourth: podium.thirdFourth.map(team => nationName(team.teamName, spec.isYouth)) };
    const ingested = await ingestWorldCupHistory(spec.isYouth ? { senior: [], youth: [row] } : { senior: [row], youth: [] });
    if (ingested.conflicts || (spec.isYouth ? ingested.youth : ingested.senior) !== 1)
      throw new Error('Official World Cup podium conflicts with retained tournament facts');
    await retainReviewTask(spec.sourceKey, edition, 'attribution',
      'The result XML proves the national-team podium but not who coached each team on the final date; retain complete tenure or direct trophy evidence');
  } else if (spec.kind === 'national-cup') {
    const teams = [podium.champion, podium.runnerUp, ...podium.thirdFourth];
    const leagues = await nationalLeagueIds(teams.map(team => team.teamId));
    const firstMatch = fixtures.reduce((earliest, match) => match.matchDate < earliest ? match.matchDate : earliest, podium.finalDate);
    const ingested = await ingestNtCupSeasons([{ cupId: spec.tournamentId, season: edition, cupName: spec.name,
      startedDate: dashDateTime(firstMatch), finalDate: dashDateTime(podium.finalDate), status: 'Finished',
      champion: podium.champion.teamName, championTeamId: podium.champion.teamId, championLeagueId: leagues.get(podium.champion.teamId) ?? null,
      runnerUp: podium.runnerUp.teamName, runnerUpTeamId: podium.runnerUp.teamId, runnerUpLeagueId: leagues.get(podium.runnerUp.teamId) ?? null,
      thirdFourth: podium.thirdFourth.map(team => team.teamName),
      thirdFourthTeamIds: podium.thirdFourth.map(team => team.teamId),
      thirdFourthLeagueIds: podium.thirdFourth.map(team => leagues.get(team.teamId) ?? null) }]);
    if (ingested.conflicts || ingested.skipped || ingested.seasons !== 1)
      throw new Error('Official national-cup podium conflicts with retained tournament facts');
    await retainReviewTask(spec.sourceKey, edition, 'attribution',
      'The result XML proves the national-team podium but not who coached each team on the final date; retain complete tenure or direct trophy evidence');
  } else {
    const final = fixtures.find(match => match.matchId === podium.finalMatchId);
    if (!final) throw new Error('Official seasonal final was not retained in its validated fixture set');
    await ingestSeasonalWinners(token, { cupId: spec.tournamentId, name: details.name, enrichNationalities: false, winners: [{
      season: edition, teamId: podium.champion.teamId, team: podium.champion.teamName,
      userId: null, manager: null, runnerUp: podium.runnerUp.teamName,
      finalMatchId: podium.finalMatchId, homeGoals: final.homeGoals, awayGoals: final.awayGoals,
      sourceURLs: [`https://chpp.hattrick.org/chppxml.ashx?file=tournamentfixtures&version=1.1&tournamentId=${spec.tournamentId}`],
      evidence: `Official CHPP final match ${podium.finalMatchId}, round ${podium.finalRound}, retained by the automated source ledger`,
    }] });
    await retainReviewTask(spec.sourceKey, edition, 'attribution',
      'The result XML proves the winning club but not its manager on the final date; retain direct trophy or complete ownership-history evidence');
  }
  const after = (await storedEditions(spec)).find(row => row.edition === edition)?.complete ?? false;
  if (!after) throw new Error('Tournament final was not retained');
  return { added: !before && after, seasonal: spec.kind === 'seasonal' };
}

async function reconcileSeasonalCountryTasks(spec: TournamentSourceSpec, now: Date): Promise<void> {
  if (spec.kind !== 'seasonal') return;
  const rows = await prisma.cupChampion.findMany({
    where: { cupId: spec.tournamentId },
    select: { season: true, championTeamId: true, championLeagueId: true },
  });
  for (const row of rows) {
    if (!Number.isSafeInteger(row.championTeamId) || (row.championTeamId ?? 0) <= 0) continue;
    const where = itemKey(spec.sourceKey, row.season, 'country');
    if ((row.championLeagueId ?? 0) > 0) {
      await prisma.updateItem.updateMany({ where: { ...where.sourceKey_itemKey_task, state: { not: 'complete' } },
        data: { state: 'complete', completedAt: now, nextAttemptAt: null, lastError: null, errorCategory: null } });
      continue;
    }
    const existing = await prisma.updateItem.findUnique({ where });
    const identityNowKnown = existing?.state === 'needs_review' &&
      existing.lastError === 'The winning club needs an exact team id before its country can be resolved';
    await prisma.updateItem.upsert({ where,
      create: { sourceKey: spec.sourceKey, itemKey: String(row.season), task: 'country', edition: row.season,
        state: 'pending', nextAttemptAt: now },
      update: existing?.state === 'complete' || identityNowKnown
        ? { state: 'pending', completedAt: null, nextAttemptAt: now, lastError: null, errorCategory: null }
        : {},
    });
  }
}

async function nextSeasonalCountryTask(spec: TournamentSourceSpec, now: Date): Promise<UpdateItem | undefined> {
  if (spec.kind !== 'seasonal') return undefined;
  const items = await prisma.updateItem.findMany({ where: { sourceKey: spec.sourceKey, task: 'country',
    state: { in: ['pending', 'retry'] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] } });
  return items.sort((a, b) => a.attempts - b.attempts ||
    (a.nextAttemptAt?.getTime() ?? 0) - (b.nextAttemptAt?.getTime() ?? 0) ||
    (a.edition ?? Number.MAX_SAFE_INTEGER) - (b.edition ?? Number.MAX_SAFE_INTEGER) || a.id - b.id)[0];
}

async function resolveSeasonalCountry(token: TokenPair, spec: TournamentSourceSpec, item: UpdateItem, now: Date): Promise<void> {
  if (spec.kind !== 'seasonal') return;
  const edition = item.edition;
  if (!edition || !['pending', 'retry'].includes(item.state) || !due(item.nextAttemptAt, now)) return;
  const row = await prisma.cupChampion.findUnique({ where: { cupId_season: { cupId: spec.tournamentId, season: edition } },
    select: { championTeamId: true, championLeagueId: true } });
  if (!row?.championTeamId) {
    await retainReviewTask(spec.sourceKey, edition, 'country', 'The winning club needs an exact team id before its country can be resolved');
    return;
  }
  if ((row.championLeagueId ?? 0) > 0) {
    await prisma.updateItem.update({ where: { id: item.id }, data: { state: 'complete', completedAt: now,
      nextAttemptAt: null, lastError: null, errorCategory: null } });
    return;
  }
  await prisma.updateItem.update({ where: { id: item.id }, data: { attempts: { increment: 1 } } });
  const response = parseTeamDetails(await fetchTeamDetails(token, row.championTeamId));
  const team = response.teams.find(candidate => candidate.teamId === row.championTeamId);
  if (!team || team.leagueId <= 0) throw new Error('teamdetails did not retain the exact seasonal champion identity');
  const updated = await prisma.cupChampion.updateMany({ where: { cupId: spec.tournamentId, season: edition,
    championTeamId: row.championTeamId, championLeagueId: row.championLeagueId }, data: { championLeagueId: team.leagueId } });
  if (updated.count !== 1) throw new Error('Seasonal champion changed while resolving its country');
  await prisma.updateItem.update({ where: { id: item.id }, data: { state: 'complete', completedAt: now,
    nextAttemptAt: null, lastError: null, errorCategory: null } });
}

/** Daily official-XML acquisition for every international/seasonal trophy visible on the site. */
export async function refreshOfficialTournaments(token: TokenPair, options: {
  now?: Date; maxItems?: number; maxMetadataChecks?: number;
} = {}): Promise<OfficialTournamentRefreshResult> {
  const now = options.now ?? new Date();
  const maxItems = options.maxItems ?? 60;
  const maxMetadataChecks = options.maxMetadataChecks ?? 60;
  if (Number.isNaN(now.getTime()) || !Number.isSafeInteger(maxItems) || maxItems < 0 ||
      !Number.isSafeInteger(maxMetadataChecks) || maxMetadataChecks < 0) throw new Error('Invalid tournament refresh options');
  const result: OfficialTournamentRefreshResult = { metadataChecked: 0, itemsAttempted: 0, nationalTrophiesAdded: 0, seasonalChampionsAdded: 0, issues: [] };
  let stopped = false;
  const work: Array<{ spec: TournamentSourceSpec; source: UpdateSource }> = [];
  for (const spec of await specs()) {
    const source = await migrateSource(spec, now);
    if (due(source.nextCheckAt, now)) work.push({ spec, source });
  }
  work.sort((a, b) => Number(a.source.lastAttemptAt !== null) - Number(b.source.lastAttemptAt !== null) ||
    (a.source.nextCheckAt?.getTime() ?? 0) - (b.source.nextCheckAt?.getTime() ?? 0) ||
    (a.source.lastAttemptAt?.getTime() ?? 0) - (b.source.lastAttemptAt?.getTime() ?? 0) || a.spec.sourceKey.localeCompare(b.spec.sourceKey));

  for (const { spec, source } of work.slice(0, maxMetadataChecks)) {
    if (stopped) break;
    await prisma.updateSource.update({ where: { sourceKey: spec.sourceKey }, data: { lastAttemptAt: now } });
    let activeItemId: number | undefined;
    try {
      const details = parseTournamentDetails(await fetchTournamentDetails(token, spec.tournamentId));
      if (details.tournamentId !== spec.tournamentId || details.season < (source.observedThrough ?? 1)) throw new Error('Tournament identity or season regressed');
      result.metadataChecked++;
      if (spec.kind === 'seasonal') await prisma.cup.update({ where: { cupId: spec.tournamentId }, data: { currentSeason: details.season } });
      else await ensureCurrentPlaceholder(spec, details);
      const rows = await storedEditions(spec);
      await reconcileItems(spec, source, details, rows, now);
      await retainHostReview(spec, details.season, now);
      await prisma.updateItem.updateMany({ where: { sourceKey: spec.sourceKey, task: 'capture', state: { not: 'complete' } },
        data: { state: 'complete', completedAt: now, nextAttemptAt: null, lastError: 'Superseded by the official CHPP tournament source', errorCategory: null } });

      let metadata: Record<string, unknown> = { ...successfulMetadata(source), name: details.name, tournamentKind: spec.kind, details };
      const dueResults = await prisma.updateItem.findMany({ where: { sourceKey: spec.sourceKey, task: 'result',
        state: { in: ['pending', 'retry'] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] } });
      const selected = selectTournamentResult(dueResults, details.season, now);
      if (selected?.edition && result.itemsAttempted < maxItems && (spec.supportsHistoricalSeason || selected.edition === details.season)) {
        result.itemsAttempted++;
        activeItemId = selected.id;
        await prisma.updateItem.update({ where: { id: selected.id }, data: { attempts: { increment: 1 } } });
        const fixtures = parseTournamentFixtures(await fetchTournamentFixtures(token, {
          tournamentId: spec.tournamentId,
          season: spec.supportsHistoricalSeason ? selected.edition : undefined,
        }));
        const podium = deriveTournamentPodium(fixtures.matches);
        const retainedTies = podium
          ? { attempted: false, evidenceRefs: [], reason: null }
          : await retainTiedTournamentMatches(token, spec, fixtures.matches);
        if (selected.edition === details.season) metadata = { ...metadata, fixtureCount: fixtures.matches.length,
          highestRound: fixtures.matches.length ? Math.max(...fixtures.matches.map(match => match.round)) : null,
          ...(retainedTies.evidenceRefs.length ? { tiebreakerEvidenceRefs: retainedTies.evidenceRefs } : {}),
          ...(podium ? { podium } : {}) };
        const finalRoundMatches = fixtures.matches.filter(match => match.group === 0 && match.round === details.lastMatchRound);
        const currentRoundValid = selected.edition !== details.season || podium?.finalRound === details.lastMatchRound;
        if (podium && currentRoundValid) {
          const stored = await storePodium(token, spec, selected.edition, podium, details, fixtures.matches);
          if (stored.added) stored.seasonal ? result.seasonalChampionsAdded++ : result.nationalTrophiesAdded++;
          await prisma.updateItem.update({ where: { id: selected.id }, data: {
            state: 'complete', completedAt: now, nextAttemptAt: null, lastError: null, errorCategory: null,
            evidenceRef: podium.tiebreakerEvidenceRefs?.length ? JSON.stringify(podium.tiebreakerEvidenceRefs) : null,
          } });
        } else {
          const terminalEvidenceProblem = selected.edition < details.season ||
            (finalRoundMatches.length === 1 && finalRoundMatches[0]?.status === 2) ||
            (podium !== null && !currentRoundValid);
          await prisma.updateItem.update({ where: { id: selected.id }, data: {
            state: terminalEvidenceProblem ? 'needs_review' : 'pending', completedAt: null,
            nextAttemptAt: terminalEvidenceProblem ? null : later(now),
            lastError: terminalEvidenceProblem
              ? retainedTies.attempted
                ? `${RETAINED_TIE_REVIEW}${retainedTies.reason ? ` (${retainedTies.reason})` : ''}`
                : UNPROVEN_PODIUM
              : null,
            errorCategory: terminalEvidenceProblem ? 'evidence' : null,
            evidenceRef: retainedTies.evidenceRefs.length ? JSON.stringify(retainedTies.evidenceRefs) : undefined,
          } });
        }
        activeItemId = undefined;
      }
      await prisma.updateSource.update({ where: { sourceKey: spec.sourceKey }, data: {
        observedThrough: Math.max(source.observedThrough ?? 0, details.season), lastSuccessAt: now,
        nextCheckAt: later(now), metadataJson: JSON.stringify(metadata),
      } });
      await reconcileSeasonalCountryTasks(spec, now);
      const countryTask = result.itemsAttempted < maxItems ? await nextSeasonalCountryTask(spec, now) : undefined;
      if (countryTask) {
        result.itemsAttempted++;
        activeItemId = countryTask.id;
        await resolveSeasonalCountry(token, spec, countryTask, now);
        activeItemId = undefined;
      }
    } catch (error) {
      const failure = safeIssue(error);
      if (failure.category === 'storage') throw error;
      result.issues.push({ sourceKey: spec.sourceKey, category: failure.category, message: failure.message });
      if (activeItemId) await prisma.updateItem.update({ where: { id: activeItemId }, data: {
        state: ['schema', 'evidence', 'invalid_response'].includes(failure.category) ? 'needs_review' : 'retry',
        nextAttemptAt: ['schema', 'evidence'].includes(failure.category) ? null : later(now),
        lastError: failure.message, errorCategory: failure.category,
      } });
      const latest = await prisma.updateSource.findUnique({ where: { sourceKey: spec.sourceKey } });
      await prisma.updateSource.update({ where: { sourceKey: spec.sourceKey }, data: { nextCheckAt: later(now),
        metadataJson: JSON.stringify({ ...sourceMetadata(latest ?? source), failure: { category: failure.category, message: failure.message } }) } });
      if (failure.stop) stopped = true;
    }
  }
  return result;
}
