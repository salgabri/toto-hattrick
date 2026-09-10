import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { extractHistoricalWinnerEvidence } from './historicalWinners.js';

const id = z.number().int().safe().positive();
const text = z.string().trim().min(1);
const sourceURL = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && /(^|\.)hattrick\.org$/i.test(url.hostname);
});

/** A reviewed exception, not an overwrite policy for general recovery. */
export const reviewedCorrectionSchema = z.object({
  table: z.literal('cupChampion'), competitionId: id, season: id, leagueId: id,
  teamId: id, teamName: text,
  expectedPriorTeamId: z.number().int().safe().nonnegative().nullable(),
  expectedPriorUserId: id, userId: id, name: text,
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: text,
  sources: z.array(sourceURL).min(1),
  event: z.object({
    text, page: id, sourceURL,
    links: z.array(z.object({ text: z.string(), href: z.string() }).strict()).min(1),
  }).strict(),
}).strict().superRefine((record, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (record.expectedPriorUserId === record.userId) invalid('Correction must change the reviewed prior owner');
  if (record.expectedPriorTeamId && record.expectedPriorTeamId !== record.teamId) {
    invalid('A reviewed correction cannot replace a different positive club ID');
  }
  const historyURL = new URL(record.event.sourceURL);
  const sourceTeamId = [...historyURL.searchParams].find(([key]) => key.toLowerCase() === 'teamid')?.[1];
  if (!/\/Club\/History(?:\/|$)/i.test(historyURL.pathname) || Number(sourceTeamId) !== record.teamId) {
    invalid('Source history URL must identify the reviewed club');
  }
  if (!record.sources.includes(record.event.sourceURL)) invalid('Direct history URL must be retained in sources');
  const { evidence } = extractHistoricalWinnerEvidence([{
    teamId: record.teamId, leagueId: record.leagueId, club: record.teamName, complete: false,
    pages: [{ page: record.event.page, sourceURL: record.event.sourceURL,
      rows: [{ text: record.event.text, links: record.event.links }] }],
  }]);
  const direct = evidence[0];
  if (evidence.length !== 1 || !direct || direct.basis !== 'direct-manager' || direct.kind !== 'cup' ||
      direct.competitionId !== record.competitionId || direct.season !== record.season ||
      direct.teamId !== record.teamId || direct.club !== record.teamName ||
      direct.userId !== record.userId || direct.userName !== record.name) {
    invalid('Direct manager-linked trophy evidence must match every corrected identity field');
  }
});

export type ReviewedCorrection = z.infer<typeof reviewedCorrectionSchema>;
export interface CorrectionTarget {
  cupId: number; season: number; leagueId: number;
  championTeamId: number | null; championTeamName: string;
  championUserId: number | null; championUserName: string | null;
}
export function planReviewedCorrection(source: ReviewedCorrection, target: CorrectionTarget | null) {
  const conflict = (reason: string) => ({ status: 'conflict' as const, reason });
  if (!target) return conflict('missingExactRow');
  if (target.cupId !== source.competitionId || target.season !== source.season || target.leagueId !== source.leagueId) {
    return conflict('competitionSeasonOrCountryMismatch');
  }
  if (target.championTeamName !== source.teamName) return conflict('teamNameMismatch');
  if (target.championUserId === source.userId && target.championTeamId === source.teamId) {
    return { status: 'unchanged' as const, reason: 'alreadyCorrected' };
  }
  if (target.championTeamId !== source.expectedPriorTeamId) return conflict('expectedPriorTeamIdMismatch');
  if (target.championUserId !== source.expectedPriorUserId) return conflict('expectedPriorUserIdMismatch');
  return { status: 'wouldApply' as const, reason: 'reviewedDirectHistoricalCorrection' };
}

type CorrectionDb = Pick<Prisma.TransactionClient, 'cupChampion' | 'hattrickUser'>;
interface CorrectionResult {
  correction: ReviewedCorrection;
  before: CorrectionTarget | null;
  status: 'wouldApply' | 'unchanged' | 'conflict' | 'applied';
  reason: string;
}

/** Internal runner. Apply callers must provide an interactive transaction client. */
export async function processReviewedCorrections(db: CorrectionDb, records: readonly ReviewedCorrection[], apply = false) {
  const sources = z.array(reviewedCorrectionSchema).min(1).parse(records);
  const keys = new Set<string>();
  for (const source of sources) {
    const key = `${source.competitionId}:${source.season}`;
    if (keys.has(key)) throw new Error(`Duplicate reviewed correction: ${key}`);
    keys.add(key);
  }
  const results: CorrectionResult[] = [];
  // Preflight the entire manifest before any writes; one unexpected row blocks the whole batch.
  for (const source of sources) {
    const before = await db.cupChampion.findUnique({
      where: { cupId_season: { cupId: source.competitionId, season: source.season } },
      select: { cupId: true, season: true, leagueId: true, championTeamId: true,
        championTeamName: true, championUserId: true, championUserName: true },
    });
    results.push({ correction: source, before, ...planReviewedCorrection(source, before) });
  }
  const conflicts = results.filter((result) => result.status === 'conflict').length;
  if (apply && !conflicts) for (const result of results) {
    if (result.status !== 'wouldApply') continue;
    const source = result.correction;
    const manager = await db.hattrickUser.upsert({
      where: { userId: source.userId },
      create: { userId: source.userId, loginName: source.name }, update: {},
    });
    const changed = await db.cupChampion.updateMany({
      where: { cupId: source.competitionId, season: source.season, leagueId: source.leagueId,
        championTeamName: source.teamName, championTeamId: source.expectedPriorTeamId,
        championUserId: source.expectedPriorUserId, championUserName: result.before!.championUserName },
      data: { championTeamId: source.teamId, championUserId: source.userId, championUserName: manager.loginName },
    });
    if (changed.count !== 1) throw new Error(`Reviewed correction changed concurrently: ${source.competitionId}:${source.season}; transaction rolled back`);
    result.status = 'applied';
  }
  return { dryRun: !apply, records: sources.length, blocked: apply && conflicts > 0,
    wouldApply: results.filter((result) => result.status === 'wouldApply').length,
    applied: results.filter((result) => result.status === 'applied').length,
    unchanged: results.filter((result) => result.status === 'unchanged').length,
    conflicts, results };
}

/** No broad overwrite option: every change needs an explicit reviewed old/new identity pair. */
export async function applyReviewedCorrections(records: readonly ReviewedCorrection[], opts: { apply?: boolean } = {}) {
  if (!opts.apply) return processReviewedCorrections(prisma, records);
  return prisma.$transaction((tx) => processReviewedCorrections(tx, records, true), { timeout: 30_000 });
}
