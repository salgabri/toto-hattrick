import type { UpdateItem, UpdateSource } from '@prisma/client';
import { prisma } from '../db/client.js';
import type { TokenPair } from '../chpp/auth.js';
import { fetchWorldDetails } from '../chpp/endpoints.js';
import { parseWorldDetailsCups } from '../schemas/index.js';
import { syncNationalChampions } from '../sync/nationalChampions.js';
import { syncCupChampions } from '../sync/cups.js';
import { seedMasters, MASTERS_CUP_ID } from '../sync/masters.js';
import { NT_CUPS } from '../sync/ntCups.js';
import { GENERATION_TROPHY_IDS } from '../sync/seasonal.js';
import { refreshOfficialTournaments } from '../sync/officialTournaments.js';
import { dueMastersCountryTasks, mastersCountryQuota, reconcileMastersCountryTasks,
  resolveMastersCountryTask } from '../sync/mastersCountries.js';
import { dueUserNationalityTasks, reconcileUserNationalityTasks, resolveUserNationalityTask,
  userNationalityQuota } from '../sync/userNationalities.js';

const DAY = 86_400_000;
const AUTOMATED_KINDS = ['league', 'cup', 'masters'];
const AUTOMATED_TASKS = new Set(['result', 'country', 'nationality']);
type WorldDetails = ReturnType<typeof parseWorldDetailsCups>;
export interface SourceIssue { sourceKey: string; edition?: number; category: string; message: string }
export interface PendingEvidence {
  sourceKey: string; itemKey: string; task: string; edition: number | null;
  reason: string; sourceUrl: string | null;
}
export interface ScheduledSource {
  sourceKey: string; label: string; kind: string; externalId: number | null; baseline: number | null;
  observedThrough: number | null; lastAttemptAt: string | null; lastSuccessAt: string | null;
  nextCheckAt: string | null; pending: number; needsReview: number; totalOpen: number;
}
export interface ScheduledRefreshResult {
  status: 'success' | 'degraded';
  sources: ScheduledSource[];
  issues: SourceIssue[];
  counts: { metadataChecked: number; itemsAttempted: number; leagueChampionsAdded: number; cupChampionsAdded: number; nationalTrophiesAdded: number; seasonalChampionsAdded: number; pendingItems: number; pendingEvidence: number };
  pendingEvidence: PendingEvidence[];
}
export interface ScheduledRefreshOptions {
  now?: Date;
  maxItems?: number;
  /** Cap metadata attempts separately so discovery cannot consume every result request. */
  maxMetadataChecks?: number;
  onlyLeagueIds?: number[];
  pacingMs?: number;
}

/** No error text from fetch is persisted: it can contain an OAuth-signed URL. */
export function sourceError(error: unknown): { category: string; message: string; stop: boolean } {
  const name = error instanceof Error ? error.name : '';
  if (name === 'ChppBudgetError') return { category: 'budget', message: 'CHPP request allowance exhausted; remaining work stays queued', stop: true };
  if (['ChppStorageError', 'StorageUnavailableError', 'StorageConflictError'].includes(name)) return { category: 'storage', message: 'Evidence could not be persisted; acquisition stopped', stop: true };
  if (name === 'ZodError') return { category: 'schema', message: 'Source response needs a sample-backed parser review', stop: false };
  if (name === 'InvalidEvidenceError') return { category: 'evidence', message: 'Retained evidence needs review; it will not be silently re-fetched', stop: false };
  if (name === 'MastersCountryEvidenceError') return { category: 'evidence', message: 'The exact Masters champion country could not be proved by official teamdetails', stop: false };
  if (name === 'UserNationalityEvidenceError') return { category: 'evidence', message: 'The exact Hattrick user nationality could not be proved by official manager data', stop: false };
  if (name === 'ChppRequestError' && error && typeof error === 'object' && 'category' in error) {
    const category = String(error.category);
    if (category === 'authentication' || category === 'forbidden') return { category, message: 'CHPP authorization requires attention; acquisition stopped', stop: true };
    return { category, message: 'CHPP source check failed; retained facts and unresolved tasks are preserved', stop: false };
  }
  return { category: 'source', message: 'Source could not be fetched or validated; retained facts are unchanged', stop: false };
}

/** Prefer the earliest retained edition, rather than a highest-season cursor that loses holes. */
export function trackedBaseline(seasons: readonly number[], current: number): number {
  return seasons.length ? Math.min(...seasons) : Math.max(1, current - 3);
}

/** Alternate fresh finals and old gaps so neither can starve under a small daily allowance. */
export function orderDueItems<T extends { edition: number | null; nextAttemptAt: Date | null; createdAt: Date; source: { observedThrough: number | null } }>(items: readonly T[]): T[] {
  const recent: T[] = [], older: T[] = [];
  for (const item of items) ((item.edition ?? 0) >= (item.source.observedThrough ?? 0) - 1 ? recent : older).push(item);
  const due = (a: T, b: T) => (a.nextAttemptAt?.getTime() ?? 0) - (b.nextAttemptAt?.getTime() ?? 0) || a.createdAt.getTime() - b.createdAt.getTime();
  recent.sort(due); older.sort(due);
  const ordered: T[] = [];
  for (let i = 0; i < Math.max(recent.length, older.length); i++) {
    if (recent[i]) ordered.push(recent[i]!);
    if (older[i]) ordered.push(older[i]!);
  }
  return ordered;
}

function metadata(source: Pick<UpdateSource, 'metadataJson'>): Record<string, unknown> {
  try { return JSON.parse(source.metadataJson) as Record<string, unknown>; } catch { return {}; }
}
function sourceLabel(source: Pick<UpdateSource, 'kind' | 'externalId' | 'metadataJson'>): string {
  const name = metadata(source).name;
  const descriptions: Record<string, string> = {
    worlddetails: 'competition calendar', league: 'league results', cup: 'cup results',
    masters: 'results', tournament: 'official tournament', manual: 'evidence review',
  };
  const description = descriptions[source.kind] ?? 'archive source';
  if (typeof name === 'string' && name.trim()) return `${name.trim()} ${description}`;
  return `${description.charAt(0).toUpperCase()}${description.slice(1)}${source.externalId === null ? '' : ` (${source.externalId})`}`;
}
function dueAt(at: Date | null, now: Date): boolean { return at === null || at <= now; }
function later(now: Date, days = 1): Date { return new Date(now.getTime() + days * DAY); }
function keyOf(sourceKey: string, itemKey: string, task = 'result') { return { sourceKey_itemKey_task: { sourceKey, itemKey, task } }; }

/** New national cups enter automatically; catalog omissions never delete retained competitions. */
export async function reconcileCupCatalog(league: { leagueId: number; countryName: string }, world: WorldDetails): Promise<void> {
  if (world.leagueId !== league.leagueId) throw new Error('Worlddetails returned a different league');
  for (const cup of world.cups.filter(cup => cup.cupLeagueLevel === 0)) {
    const data = { leagueId: league.leagueId, countryName: league.countryName, cupName: cup.cupName,
      cupLevel: cup.cupLevel, cupLevelIndex: cup.cupLevelIndex, isMain: cup.cupLevel === 1, currentSeason: world.currentSeason };
    const existing = await prisma.cup.findUnique({ where: { cupId: cup.cupId } });
    if (existing && existing.leagueId !== league.leagueId) throw new Error('Observed cup has conflicting league identity');
    await prisma.cup.upsert({ where: { cupId: cup.cupId }, create: { cupId: cup.cupId, ...data }, update: data });
  }
}

async function ensureSource(source: { sourceKey: string; kind: string; externalId?: number; numberingSystem: string; baseline?: number; observedThrough?: number; metadataJson?: string }): Promise<UpdateSource> {
  const existing = await prisma.updateSource.findUnique({ where: { sourceKey: source.sourceKey } });
  return prisma.updateSource.upsert({
    where: { sourceKey: source.sourceKey }, create: source,
    update: { observedThrough: source.observedThrough === undefined ? undefined : Math.max(existing?.observedThrough ?? 0, source.observedThrough),
      metadataJson: source.metadataJson === undefined ? undefined : JSON.stringify({ ...(existing ? metadata(existing) : {}), ...JSON.parse(source.metadataJson) }) },
  });
}

async function reconcileEditions(source: UpdateSource, rows: { season: number; complete: boolean; attributed: boolean }[], now: Date): Promise<void> {
  const existing = await prisma.updateItem.findMany({ where: { sourceKey: source.sourceKey }, select: { itemKey: true, task: true } });
  const keys = new Set(existing.map(row => `${row.task}:${row.itemKey}`));
  const bySeason = new Map(rows.map(row => [row.season, row]));
  const create: Array<{ sourceKey: string; itemKey: string; task: string; edition: number; state: string; nextAttemptAt: Date | null; completedAt: Date | null; lastError?: string }> = [];
  for (let edition = source.baseline ?? 1; edition <= (source.observedThrough ?? 0); edition++) {
    const row = bySeason.get(edition);
    const itemKey = String(edition);
    if (!keys.has(`result:${itemKey}`)) create.push({ sourceKey: source.sourceKey, itemKey, task: 'result', edition,
      state: row?.complete ? 'complete' : 'pending', nextAttemptAt: row?.complete ? null : now, completedAt: row?.complete ? now : null });
  }
  // Attribution remains separate even when an archive placeholder already proves a winner.
  for (const row of rows) if (row.complete && !row.attributed && !keys.has(`attribution:${row.season}`)) create.push({
    sourceKey: source.sourceKey, itemKey: String(row.season), task: 'attribution', edition: row.season,
    state: 'needs_review', nextAttemptAt: null, completedAt: null, lastError: 'Historical winner identity needs retained ownership or trophy evidence',
  });
  if (create.length) await prisma.updateItem.createMany({ data: create });
  const complete = rows.filter(row => row.complete).map(row => String(row.season));
  const attributed = rows.filter(row => row.attributed).map(row => String(row.season));
  for (const [task, itemKeys] of [['result', complete], ['attribution', attributed]] as const) if (itemKeys.length) {
    await prisma.updateItem.updateMany({ where: { sourceKey: source.sourceKey, task, itemKey: { in: [...itemKeys] }, state: { not: 'complete' } },
      data: { state: 'complete', completedAt: now, nextAttemptAt: null, lastError: null, errorCategory: null } });
  }
}

async function seedCompetitionItems(onlyLeagueIds: number[] | undefined, observations: Map<number, WorldDetails>, now: Date): Promise<void> {
  const leagues = await prisma.nationalLeague.findMany({ where: onlyLeagueIds ? { leagueId: { in: onlyLeagueIds } } : {} });
  for (const league of leagues) {
    const rows = await prisma.leagueChampion.findMany({ where: { leagueId: league.leagueId }, select: { season: true, complete: true, championUserId: true } });
    const current = league.currentSeason ?? Math.max(1, ...rows.map(row => row.season));
    const world = observations.get(league.leagueId);
    const source = await ensureSource({ sourceKey: `league:${league.leagueId}`, kind: 'league', externalId: league.leagueId,
      numberingSystem: `league:${league.leagueId}:season`, baseline: trackedBaseline(rows.map(row => row.season), current), observedThrough: current,
      metadataJson: JSON.stringify({ name: league.countryName, ...(world ? { matchRound: world.matchRound, seriesMatchDate: world.seriesMatchDate } : {}) }) });
    await reconcileEditions(source, rows.map(row => ({ ...row, attributed: (row.championUserId ?? 0) > 0 })), now);
  }
  const cups = await prisma.cup.findMany({ where: onlyLeagueIds ? { leagueId: { in: onlyLeagueIds } } : { OR: [{ leagueId: { not: 0 } }, { cupId: MASTERS_CUP_ID }] } });
  for (const cup of cups) {
    const rows = await prisma.cupChampion.findMany({ where: { cupId: cup.cupId }, select: { season: true, finalMatchId: true, championUserId: true } });
    const current = cup.currentSeason ?? Math.max(1, ...rows.map(row => row.season));
    const hint = observations.get(cup.leagueId)?.cups.find(row => row.cupId === cup.cupId);
    const source = await ensureSource({ sourceKey: `cup:${cup.cupId}`, kind: cup.cupId === MASTERS_CUP_ID ? 'masters' : 'cup', externalId: cup.cupId,
      numberingSystem: cup.cupId === MASTERS_CUP_ID ? 'global:season' : `league:${cup.leagueId}:season`, baseline: trackedBaseline(rows.map(row => row.season), current), observedThrough: current,
      metadataJson: JSON.stringify({ name: cup.cupName, leagueId: cup.leagueId, matchRoundsLeft: hint?.matchRoundsLeft, matchRound: hint?.matchRound }) });
    await reconcileEditions(source, rows.map(row => ({ season: row.season, complete: row.finalMatchId > 0 || row.championUserId !== null, attributed: (row.championUserId ?? 0) > 0 })), now);
  }
}

async function queueManualSource(sourceKey: string, externalId: number | undefined, name: string, sourceUrl: string, observedThrough: number | undefined, now: Date): Promise<void> {
  const retained = await prisma.updateSource.findUnique({ where: { sourceKey } });
  // Once an official XML adapter owns a source, the assisted lane must never recreate its old
  // weekly browser-capture task.
  if (retained && retained.kind !== 'manual') return;
  const source = await ensureSource({ sourceKey, kind: 'manual', externalId, numberingSystem: sourceKey.startsWith('elections:') ? 'worldcup:cycle' : `${sourceKey}:edition`,
    observedThrough, metadataJson: JSON.stringify({ name, sourceUrl }) });
  // A weekly capture cycle is independent of lifetime team/cup IDs and does not assert a new edition.
  if (source.lastSuccessAt && now.getTime() - source.lastSuccessAt.getTime() < 7 * DAY) return;
  const pending = await prisma.updateItem.findFirst({ where: { sourceKey, task: 'capture', state: { not: 'complete' } } });
  if (pending) return;
  const week = new Date(now.getTime() - ((now.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
  await prisma.updateItem.upsert({ where: keyOf(sourceKey, `capture:${week}`, 'capture'), update: {}, create: {
    sourceKey, itemKey: `capture:${week}`, task: 'capture', edition: observedThrough ?? null, state: 'needs_review',
    lastError: 'Fresh complete source capture required; verify the latest edition and any replacements',
  } });
}

async function queueAssistedWork(onlyLeagueIds: number[] | undefined, now: Date): Promise<void> {
  const leagues = await prisma.nationalLeague.findMany({ where: { isCountry: true, ...(onlyLeagueIds ? { leagueId: { in: onlyLeagueIds } } : {}) } });
  for (const league of leagues) {
    const last = await prisma.nationalCoachElection.aggregate({ where: { leagueId: league.leagueId }, _max: { edition: true } });
    await queueManualSource(`elections:${league.leagueId}`, league.leagueId, `${league.countryName} senior and youth elections`,
      `https://www.hattrick.org/World/Elections/History.aspx?LeagueID=${league.leagueId}`, last._max.edition ?? undefined, now);
  }
  if (onlyLeagueIds) return;
  for (const isYouth of [false, true]) {
    const last = await prisma.worldCupChampion.aggregate({ where: { isYouth }, _max: { edition: true } });
    await queueManualSource(`worldcup:${isYouth ? 'youth' : 'senior'}`, undefined, `${isYouth ? 'Youth' : 'Senior'} World Cup`,
      'https://www.hattrick.org/World/WorldCup/History.aspx', last._max.edition ?? undefined, now);
    const rows = await prisma.worldCupChampion.findMany({ where: { isYouth } });
    for (const row of rows) await reconcilePodiumAttribution(`worldcup:${isYouth ? 'youth' : 'senior'}`, row.edition, row, now);
  }
  for (const cup of NT_CUPS) {
    const last = await prisma.nationalCupChampion.aggregate({ where: { cupId: cup.cupId }, _max: { season: true } });
    await queueManualSource(`national-cup:${cup.cupId}`, cup.cupId, cup.name,
      `https://www.hattrick.org/World/WorldCup/Cup.aspx?cupId=${cup.cupId}`, last._max.season ?? undefined, now);
    const rows = await prisma.nationalCupChampion.findMany({ where: { cupId: cup.cupId } });
    for (const row of rows) await reconcilePodiumAttribution(`national-cup:${cup.cupId}`, row.season, row, now);
  }
  const seasonal = await prisma.cup.findMany({ where: { leagueId: 0, cupId: { not: MASTERS_CUP_ID } } });
  for (const cup of seasonal) {
    const sourceKey = `seasonal:${cup.cupId}`;
    await queueManualSource(sourceKey, cup.cupId, cup.cupName,
      `https://www.hattrick.org/Club/ArenaHub/Tournaments/TournamentHistory.aspx?tournamentId=${cup.cupId}`, cup.currentSeason ?? undefined, now);
    const rows = await prisma.cupChampion.findMany({ where: { cupId: cup.cupId },
      select: { season: true, championTeamName: true, championUserId: true } });
    for (const row of rows) await reconcileSeasonalAttribution(sourceKey, row.season, row, now);
  }
  if (now.getUTCFullYear() > Math.max(...Object.keys(GENERATION_TROPHY_IDS).map(Number))) {
    await queueManualSource('seasonal:registry', undefined, 'New Heroes trophy cohorts',
      'https://www.hattrick.org/Club/ArenaHub/', undefined, now);
  }
}

export async function reconcilePodiumAttribution(sourceKey: string, edition: number, row: {
  champion: string | null; championUserId: number | null; runnerUp: string | null; runnerUpUserId: number | null;
  thirdFourth: string; thirdFourthUserIds: string;
}, now: Date): Promise<void> {
  const unresolved: string[] = [];
  if (row.champion && (row.championUserId ?? 0) <= 0) unresolved.push(`winner ${row.champion}`);
  if (row.runnerUp && (row.runnerUpUserId ?? 0) <= 0) unresolved.push(`runner-up ${row.runnerUp}`);
  const bronzeIds = row.thirdFourthUserIds.split(',');
  row.thirdFourth.split(',').map(nation => nation.trim()).filter(Boolean).forEach((nation, index) => {
    if (!(Number(bronzeIds[index]) > 0)) unresolved.push(`joint-third ${nation}`);
  });
  if (!unresolved.length) {
    await prisma.updateItem.updateMany({ where: { sourceKey, itemKey: String(edition), task: 'attribution', state: { not: 'complete' } },
      data: { state: 'complete', completedAt: now, nextAttemptAt: null, lastError: null, errorCategory: null } });
    return;
  }
  const lastError = `Complete coaching-tenure or direct podium evidence required for ${unresolved.join(', ')}`;
  await prisma.updateItem.upsert({ where: keyOf(sourceKey, String(edition), 'attribution'),
    update: { state: 'needs_review', completedAt: null, lastError },
    create: { sourceKey, itemKey: String(edition), edition, task: 'attribution', state: 'needs_review', lastError } });
}

export async function reconcileSeasonalAttribution(sourceKey: string, edition: number, row: {
  championTeamName: string; championUserId: number | null;
}, now: Date): Promise<void> {
  if ((row.championUserId ?? 0) > 0) {
    await prisma.updateItem.updateMany({ where: { sourceKey, itemKey: String(edition), task: 'attribution', state: { not: 'complete' } },
      data: { state: 'complete', completedAt: now, nextAttemptAt: null, lastError: null, errorCategory: null } });
    return;
  }
  if (!row.championTeamName.trim()) return;
  const lastError = `Direct trophy or complete ownership-history evidence required for winner ${row.championTeamName}`;
  await prisma.updateItem.upsert({ where: keyOf(sourceKey, String(edition), 'attribution'),
    update: { state: 'needs_review', completedAt: null, nextAttemptAt: null, lastError, errorCategory: 'evidence' },
    create: { sourceKey, itemKey: String(edition), edition, task: 'attribution', state: 'needs_review', lastError, errorCategory: 'evidence' } });
}

function nextResultCheck(item: UpdateItem & { source: UpdateSource }, now: Date): Date {
  const hints = metadata(item.source);
  const farFromFinal = item.edition === item.source.observedThrough &&
    (typeof hints.matchRoundsLeft === 'number' ? hints.matchRoundsLeft > 1 : typeof hints.matchRound === 'number' && hints.matchRound < 14);
  // Weekly fallback avoids trusting schedule hints indefinitely. Old unavailable gaps back off too.
  return later(now, farFromFinal || item.attempts >= 3 ? 7 : 1);
}

/** Read-only report: no CHPP calls, ledger writes, or artificial freshness changes. */
export async function reportScheduled(): Promise<ScheduledRefreshResult> {
  const sources = await prisma.updateSource.findMany({ orderBy: { sourceKey: 'asc' } });
  const items = await prisma.updateItem.findMany({ where: { state: { notIn: ['complete', 'no_award'] } }, orderBy: [{ sourceKey: 'asc' }, { edition: 'desc' }] });
  const byKey = new Map(sources.map(source => [source.sourceKey, source]));
  const automatedBacklog = items.filter(item => AUTOMATED_TASKS.has(item.task) && item.state !== 'needs_review');
  const pendingEvidence = items.filter(item => !AUTOMATED_TASKS.has(item.task) || item.state === 'needs_review').map(item => {
    const source = byKey.get(item.sourceKey)!;
    const info = metadata(source);
    const sourceUrl = typeof info.sourceUrl === 'string' ? info.sourceUrl : null;
    return { sourceKey: item.sourceKey, itemKey: item.itemKey, task: item.task, edition: item.edition,
      reason: item.lastError ?? 'Retained historical evidence required', sourceUrl };
  });
  const issues = items.filter(item => AUTOMATED_TASKS.has(item.task) && item.errorCategory).map(item => ({
    sourceKey: item.sourceKey, edition: item.edition ?? undefined, category: item.errorCategory!, message: item.lastError ?? 'Source check requires attention',
  }));
  for (const source of sources) {
    const failure = metadata(source).failure;
    if (failure && typeof failure === 'object' && 'category' in failure && 'message' in failure)
      issues.push({ sourceKey: source.sourceKey, edition: undefined, category: String(failure.category), message: String(failure.message) });
  }
  return {
    status: issues.length ? 'degraded' : 'success', issues, pendingEvidence,
    counts: { metadataChecked: 0, itemsAttempted: 0, leagueChampionsAdded: 0, cupChampionsAdded: 0, nationalTrophiesAdded: 0, seasonalChampionsAdded: 0, pendingItems: automatedBacklog.length, pendingEvidence: pendingEvidence.length },
    sources: sources.map(source => ({ sourceKey: source.sourceKey, label: sourceLabel(source), kind: source.kind, externalId: source.externalId, baseline: source.baseline, observedThrough: source.observedThrough,
      lastAttemptAt: source.lastAttemptAt?.toISOString() ?? null, lastSuccessAt: source.lastSuccessAt?.toISOString() ?? null, nextCheckAt: source.nextCheckAt?.toISOString() ?? null,
      pending: automatedBacklog.filter(item => item.sourceKey === source.sourceKey).length,
      needsReview: items.filter(item => item.sourceKey === source.sourceKey && item.state === 'needs_review').length,
      totalOpen: items.filter(item => item.sourceKey === source.sourceKey).length })),
  };
}

/** Sequential acquisition with durable edition tasks; the caller persists/validates the archive. */
export async function refreshScheduled(token: TokenPair, options: ScheduledRefreshOptions = {}): Promise<ScheduledRefreshResult> {
  const now = options.now ?? new Date();
  const maxItems = options.maxItems ?? 400;
  const maxMetadataChecks = options.maxMetadataChecks ?? 200;
  if (!Number.isSafeInteger(maxItems) || maxItems < 0 || !Number.isSafeInteger(maxMetadataChecks) || maxMetadataChecks < 0 || Number.isNaN(now.getTime())) throw new Error('Invalid scheduled refresh options');
  const issues: SourceIssue[] = [];
  const counts = { metadataChecked: 0, itemsAttempted: 0, leagueChampionsAdded: 0, cupChampionsAdded: 0, nationalTrophiesAdded: 0, seasonalChampionsAdded: 0 };
  const observations = new Map<number, WorldDetails>();
  let stopped = false;
  const leagues = await prisma.nationalLeague.findMany({ where: options.onlyLeagueIds ? { leagueId: { in: options.onlyLeagueIds } } : {}, orderBy: { leagueId: 'asc' } });
  const metadataWork: Array<{ league: (typeof leagues)[number]; source: UpdateSource }> = [];
  for (const league of leagues) {
    const sourceKey = `worlddetails:${league.leagueId}`;
    const source = await ensureSource({ sourceKey, kind: 'worlddetails', externalId: league.leagueId, numberingSystem: `league:${league.leagueId}:season`, metadataJson: JSON.stringify({ name: league.countryName }) });
    // Load every available observation before applying the acquisition cap. Skipped countries can
    // still provide schedule hints and offset-zero numbering without claiming a fresh check.
    const stored = metadata(source);
    if (stored.world && typeof stored.world === 'object') observations.set(league.leagueId, stored.world as WorldDetails);
    if (dueAt(source.nextCheckAt, now)) metadataWork.push({ league, source });
  }
  metadataWork.sort((a, b) =>
    Number(a.source.lastAttemptAt !== null) - Number(b.source.lastAttemptAt !== null) ||
    (a.source.nextCheckAt?.getTime() ?? 0) - (b.source.nextCheckAt?.getTime() ?? 0) ||
    (a.source.lastAttemptAt?.getTime() ?? 0) - (b.source.lastAttemptAt?.getTime() ?? 0) || a.league.leagueId - b.league.leagueId);
  for (const { league, source } of metadataWork.slice(0, maxMetadataChecks)) {
    const sourceKey = source.sourceKey;
    await prisma.updateSource.update({ where: { sourceKey }, data: { lastAttemptAt: now } });
    try {
      const world = parseWorldDetailsCups(await fetchWorldDetails(token, league.leagueId));
      if (!Number.isSafeInteger(world.currentSeason) || world.currentSeason < (league.currentSeason ?? 1)) throw new Error('Worlddetails season regressed');
      await reconcileCupCatalog(league, world);
      await prisma.nationalLeague.update({ where: { leagueId: league.leagueId }, data: { currentSeason: world.currentSeason } });
      // Temporarily missing catalog cups retain their rows and stay eligible for later probes.
      await prisma.cup.updateMany({ where: { leagueId: league.leagueId }, data: { currentSeason: world.currentSeason } });
      await prisma.updateSource.update({ where: { sourceKey }, data: { observedThrough: world.currentSeason, lastSuccessAt: now, nextCheckAt: later(now), metadataJson: JSON.stringify({ name: league.countryName, world }) } });
      observations.set(league.leagueId, world);
      counts.metadataChecked++;
    } catch (error) {
      const failure = sourceError(error);
      issues.push({ sourceKey, category: failure.category, message: failure.message });
      await prisma.updateSource.update({ where: { sourceKey }, data: { nextCheckAt: later(now), metadataJson: JSON.stringify({ ...metadata(source), failure: { category: failure.category, message: failure.message } }) } });
      if (failure.category === 'storage') throw error;
      if (failure.stop) { stopped = true; break; }
    }
  }
  // Use actual offset-zero world metadata, never the maximum of unrelated local counters.
  if (!options.onlyLeagueIds) {
    const globalSeasons = [...new Set([...observations.values()].filter(world => world.seasonOffset === 0).map(world => world.currentSeason))];
    if (globalSeasons.length === 1) await seedMasters(globalSeasons[0]!);
    else if (globalSeasons.length > 1) issues.push({ sourceKey: 'cup:183', category: 'metadata', message: 'Masters season needs a consistent offset-zero worlddetails observation; retained season is preserved' });
  }
  await seedCompetitionItems(options.onlyLeagueIds, observations, now);
  // Country attribution is a separate, independently retryable fact. Run its bounded lane before
  // the large domestic result backlog so a newly retained Masters winner cannot be starved by old
  // league/cup gaps. It uses only exact team IDs and never substitutes current manager identity.
  let countryAllowance = options.onlyLeagueIds ? 0 : mastersCountryQuota(maxItems);
  const runMastersCountryLane = async (): Promise<void> => {
    if (stopped || countryAllowance <= 0 || counts.itemsAttempted >= maxItems) return;
    const tasks = await dueMastersCountryTasks(now, Math.min(countryAllowance, maxItems - counts.itemsAttempted));
    for (const item of tasks) {
      counts.itemsAttempted++;
      countryAllowance--;
      await prisma.updateItem.update({ where: { id: item.id }, data: { attempts: { increment: 1 } } });
      try {
        await resolveMastersCountryTask(token, item, now);
      } catch (error) {
        const failure = sourceError(error);
        issues.push({ sourceKey: item.sourceKey, edition: item.edition ?? undefined, category: failure.category, message: failure.message });
        await prisma.updateItem.update({ where: { id: item.id }, data: {
          state: ['schema', 'evidence', 'invalid_response'].includes(failure.category) ? 'needs_review' : 'retry',
          completedAt: null,
          nextAttemptAt: ['schema', 'evidence'].includes(failure.category) ? null : later(now, Math.min(7, 2 ** Math.min(item.attempts, 3))),
          lastError: failure.message, errorCategory: failure.category,
        } });
        if (failure.category === 'storage') throw error;
        if (failure.stop) { stopped = true; break; }
      }
    }
  };
  if (!options.onlyLeagueIds) {
    await reconcileMastersCountryTasks(now);
    await runMastersCountryLane();
  }
  // A separate bounded lane fills nationality-dependent manager, coach and election views. Tasks
  // are keyed only by exact retained Hattrick user IDs; transient CHPP failures keep exponential
  // backoff and cannot turn into a permanent "Unknown" result.
  let nationalityAllowance = options.onlyLeagueIds ? 0 : userNationalityQuota(maxItems);
  const runUserNationalityLane = async (): Promise<void> => {
    if (stopped || nationalityAllowance <= 0 || counts.itemsAttempted >= maxItems) return;
    const tasks = await dueUserNationalityTasks(now, Math.min(nationalityAllowance, maxItems - counts.itemsAttempted));
    for (const item of tasks) {
      counts.itemsAttempted++;
      nationalityAllowance--;
      const priorAttempts = item.attempts;
      await prisma.updateItem.update({ where: { id: item.id }, data: { attempts: { increment: 1 } } });
      await prisma.updateSource.update({ where: { sourceKey: item.sourceKey }, data: { lastAttemptAt: now } });
      try {
        await resolveUserNationalityTask(token, item, now);
        await prisma.updateSource.update({ where: { sourceKey: item.sourceKey }, data: { lastSuccessAt: now } });
      } catch (error) {
        const failure = sourceError(error);
        issues.push({ sourceKey: item.sourceKey, edition: item.edition ?? undefined, category: failure.category, message: failure.message });
        const needsReview = ['schema', 'evidence', 'invalid_response'].includes(failure.category);
        await prisma.updateItem.update({ where: { id: item.id }, data: {
          state: needsReview ? 'needs_review' : 'retry',
          completedAt: null,
          nextAttemptAt: needsReview ? null : later(now, Math.min(7, 2 ** Math.min(priorAttempts, 3))),
          lastError: failure.message,
          errorCategory: failure.category,
        } });
        if (failure.category === 'storage') throw error;
        if (failure.stop) { stopped = true; break; }
      }
    }
  };
  if (!options.onlyLeagueIds) {
    await reconcileUserNationalityTasks(now);
    await runUserNationalityLane();
  }
  // International and ArenaHub trophies are independent of any one domestic league. Give them a
  // bounded share of every full run so a large domestic backfill cannot starve a newly played final.
  if (!options.onlyLeagueIds && !stopped) {
    const tournaments = await refreshOfficialTournaments(token, {
      now,
      maxItems: Math.min(60, Math.max(0, maxItems - counts.itemsAttempted)),
      maxMetadataChecks: Math.max(0, maxMetadataChecks - counts.metadataChecked),
    });
    counts.metadataChecked += tournaments.metadataChecked;
    counts.itemsAttempted += tournaments.itemsAttempted;
    counts.nationalTrophiesAdded += tournaments.nationalTrophiesAdded;
    counts.seasonalChampionsAdded += tournaments.seasonalChampionsAdded;
    issues.push(...tournaments.issues);
    if (tournaments.issues.some(issue => ['budget', 'authentication', 'forbidden'].includes(issue.category))) stopped = true;
  }
  const due = await prisma.updateItem.findMany({ where: {
    task: 'result', state: { in: ['pending', 'retry'] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    source: { kind: { in: AUTOMATED_KINDS }, ...(options.onlyLeagueIds ? { OR: [{ kind: 'league', externalId: { in: options.onlyLeagueIds } }, { kind: 'cup', numberingSystem: { in: options.onlyLeagueIds.map(id => `league:${id}:season`) } }] } : {}) },
  }, include: { source: true } });
  const succeeded = new Set<string>(), failed = new Set<string>();
  const remaining = new Map<string, number>();
  for (const item of due) remaining.set(item.sourceKey, (remaining.get(item.sourceKey) ?? 0) + 1);
  for (const item of stopped ? [] : orderDueItems(due).slice(0, Math.max(0, maxItems - counts.itemsAttempted))) {
    if (item.edition === null || item.source.externalId === null) continue;
    counts.itemsAttempted++;
    remaining.set(item.sourceKey, (remaining.get(item.sourceKey) ?? 1) - 1);
    await prisma.updateItem.update({ where: { id: item.id }, data: { attempts: { increment: 1 } } });
    await prisma.updateSource.update({ where: { sourceKey: item.sourceKey }, data: { lastAttemptAt: now } });
    try {
      const syncOptions = { seasons: [item.edition], pacingMs: options.pacingMs ?? 0, throwOnFetchError: true };
      const result = item.source.kind === 'league'
        ? await syncNationalChampions(token, item.source.externalId, syncOptions)
        : await syncCupChampions(token, item.source.externalId, syncOptions);
      if (result.issues.length) {
        const message = result.issues.map(issue => issue.reason).join('; ');
        issues.push({ sourceKey: item.sourceKey, edition: item.edition, category: 'evidence', message });
        failed.add(item.sourceKey);
        await prisma.updateItem.update({ where: { id: item.id }, data: { state: 'needs_review', errorCategory: 'evidence', lastError: message, nextAttemptAt: null } });
        continue;
      }
      if (item.source.kind === 'league') counts.leagueChampionsAdded += result.seasonsStored;
      else counts.cupChampionsAdded += result.seasonsStored;
      const row = item.source.kind === 'league'
        ? await prisma.leagueChampion.findUnique({ where: { leagueId_season: { leagueId: item.source.externalId, season: item.edition } } })
        : await prisma.cupChampion.findUnique({ where: { cupId_season: { cupId: item.source.externalId, season: item.edition } } });
      const complete = row && ('complete' in row ? row.complete : row.finalMatchId > 0 || row.championUserId !== null);
      await prisma.updateItem.update({ where: { id: item.id }, data: { state: complete ? 'complete' : 'pending', completedAt: complete ? now : null,
        errorCategory: null, lastError: null, nextAttemptAt: complete ? null : nextResultCheck(item, now) } });
      succeeded.add(item.sourceKey);
      if (row && complete && (row.championUserId ?? 0) <= 0) await prisma.updateItem.upsert({ where: keyOf(item.sourceKey, item.itemKey, 'attribution'), update: {}, create: {
        sourceKey: item.sourceKey, itemKey: item.itemKey, edition: item.edition, task: 'attribution', state: 'needs_review',
        lastError: 'Historical winner identity needs retained ownership or trophy evidence',
      } });
    } catch (error) {
      const failure = sourceError(error);
      issues.push({ sourceKey: item.sourceKey, edition: item.edition, category: failure.category, message: failure.message });
      failed.add(item.sourceKey);
      await prisma.updateItem.update({ where: { id: item.id }, data: { state: ['schema', 'evidence', 'invalid_response'].includes(failure.category) ? 'needs_review' : 'retry',
        lastError: failure.message, errorCategory: failure.category, nextAttemptAt: later(now, Math.min(7, 2 ** Math.min(item.attempts, 3))) } });
      if (failure.category === 'storage') throw error;
      if (failure.stop) break;
    }
  }
  // A Masters result first discovered above did not exist during the initial reconciliation. Queue
  // it now, and use any still-free country-lane allowance when the run retained spare capacity.
  if (!options.onlyLeagueIds) {
    await reconcileMastersCountryTasks(now);
    await runMastersCountryLane();
    await reconcileUserNationalityTasks(now);
    await runUserNationalityLane();
  }
  for (const sourceKey of succeeded) if (!failed.has(sourceKey) && !remaining.get(sourceKey)) await prisma.updateSource.update({ where: { sourceKey }, data: { lastSuccessAt: now, nextCheckAt: later(now) } });
  await queueAssistedWork(options.onlyLeagueIds, now);
  const report = await reportScheduled();
  const merged = new Map([...report.issues, ...issues].map(issue => [`${issue.sourceKey}/${issue.edition ?? ''}/${issue.category}`, issue]));
  return { ...report, status: merged.size ? 'degraded' : 'success', issues: [...merged.values()], counts: { ...report.counts, ...counts } };
}
