import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { extractHistoricalWinnerEvidence, type HistoricalLink, type HistoricalRow } from './historicalWinners.js';

/**
 * One JSONL header followed by one outcome per cup/season/team target. A compact tuple is valid
 * only when the capture program compared the observed row and all four observed anchors with its
 * exact expansion. Anything with different text, links, or order must use a verbatim linked row.
 */
const id = z.number().int().safe().positive();
const nonempty = z.string().min(1).refine((value) => value.trim().length > 0);
const linkSchema = z.object({ text: z.string(), href: z.string() }).strict();
const rowSchema = z.object({ text: nonempty, links: z.array(linkSchema).min(1) }).strict();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const observedDate = z.string().regex(/^\d{2}[-.]\d{2}[-.]\d{4}$/);
const statusReason = z.enum(['retired-unlinked', 'page1-no-row', 'page-unavailable', 'ambiguous']);

export const bulkCaptureHeaderSchema = z.object({
  format: z.literal('hattrick-cup-history-v1'),
  capturedAt: z.string().datetime({ offset: true }),
  page: z.literal(1),
  /** Expanded URL must equal the URL actually observed by the capture program. */
  sourceURLTemplate: nonempty,
  /** Only use tuples when these literal hrefs and their order were observed. */
  hrefPrefix: z.enum(['', '/en']),
}).strict();

const targetSchema = z.object({ cupId: id, season: id, teamId: id, teamName: nonempty });
export const bulkLinkedCaptureSchema = targetSchema.extend({
  status: z.literal('linked'), sourceURL: nonempty, page: z.literal(1),
  winDate: isoDate, row: rowSchema,
}).strict();
export const bulkUnresolvedCaptureSchema = targetSchema.extend({
  status: z.literal('unresolved'), sourceURL: nonempty, page: z.literal(1),
  reason: statusReason, row: rowSchema.optional(), note: nonempty.optional(),
}).strict().superRefine((capture, ctx) => {
  if (capture.reason === 'retired-unlinked' && !capture.row) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Retired-manager outcome needs the observed row' });
  }
});
export const bulkCaptureSchema = z.union([bulkLinkedCaptureSchema, bulkUnresolvedCaptureSchema]);

/** [cupId, local season, teamId, visible date, wording index, club, cup, manager, userId, archive global season]. */
export const bulkLinkedTupleSchema = z.tuple([
  id, id, id, observedDate, z.union([z.literal(0), z.literal(1), z.literal(2)]),
  nonempty, nonempty, nonempty, id, id,
]);
const bulkUnresolvedTupleSchema = z.tuple([
  z.literal('unresolved'), id, id, id, nonempty, statusReason, rowSchema.nullable(),
]);

export type BulkCaptureHeader = z.infer<typeof bulkCaptureHeaderSchema>;
export type BulkCapture = z.infer<typeof bulkCaptureSchema>;
export type BulkLinkedCapture = z.infer<typeof bulkLinkedCaptureSchema>;
export type BulkLinkedTuple = z.infer<typeof bulkLinkedTupleSchema>;
export interface BulkCaptureBatch { header: BulkCaptureHeader; captures: BulkCapture[] }

const clean = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim();
const targetKey = (capture: Pick<BulkCapture, 'cupId' | 'season' | 'teamId'>) =>
  `${capture.cupId}:${capture.season}:${capture.teamId}`;

function officialURL(value: string, base?: string): URL | null {
  try {
    const url = new URL(value.replace(/&amp;/gi, '&'), base);
    return url.protocol === 'https:' && /(^|\.)hattrick\.org$/i.test(url.hostname) ? url : null;
  } catch { return null; }
}

function singleId(url: URL, key: string): number | null {
  const values = [...url.searchParams].filter(([name]) => name.toLowerCase() === key.toLowerCase()).map(([, value]) => value);
  return values.length === 1 && /^[1-9]\d*$/.test(values[0]!) && Number.isSafeInteger(Number(values[0]))
    ? Number(values[0]) : null;
}

function sourceURLFor(header: BulkCaptureHeader, teamId: number): string {
  if (header.sourceURLTemplate.split('{teamId}').length !== 2) throw new Error('Source URL template needs exactly one {teamId} placeholder');
  const sourceURL = header.sourceURLTemplate.replace('{teamId}', String(teamId));
  const url = officialURL(sourceURL);
  if (!url || !/^\/(?:en\/)?Club\/History\/?$/i.test(url.pathname) || singleId(url, 'teamId') !== teamId ||
      [...url.searchParams].length !== 1 || url.hash) {
    throw new Error(`Invalid Club History source URL for team ${teamId}`);
  }
  return sourceURL;
}

function expandTuple(tuple: BulkLinkedTuple, header: BulkCaptureHeader): BulkLinkedCapture {
  const [cupId, season, teamId, date, wording, teamName, cupName, userName, userId, archiveSeason] = tuple;
  const prefix = header.hrefPrefix;
  const archive = { text: String(season), href: `${prefix}/Club/Matches/Archive.aspx?season=${archiveSeason}&TeamID=${teamId}&actiontype=viewcup` };
  const team = { text: teamName, href: `${prefix}/Club/?TeamID=${teamId}` };
  const cup = { text: cupName, href: `${prefix}/World/Cup/Cup.aspx?CupID=${cupId}` };
  const manager = { text: userName, href: `${prefix}/Club/Manager/?userId=${userId}` };
  const variants = {
    0: { text: `${date} In season ${season}, ${teamName} emerged victorious from ${cupName}. They were managed by ${userName}.`,
      links: [archive, team, cup, manager] },
    1: { text: `${date} Season ${season} was memorable for ${userName}, who led ${teamName} to the title in ${cupName}.`,
      links: [archive, manager, team, cup] },
    2: { text: `${date} ${teamName}, under the leadership of ${userName}, won ${cupName} season ${season}.`,
      links: [team, manager, cup, archive] },
  } satisfies Record<typeof wording, HistoricalRow>;
  const [day, month, year] = date.split(/[-.]/);
  return { status: 'linked', cupId, season, teamId, teamName, sourceURL: sourceURLFor(header, teamId), page: 1,
    winDate: `${year}-${month}-${day}`, row: variants[wording] };
}

/** Parse JSONL without network access. The header fixes the exact page URL/href convention. */
export function parseBulkHistoricalWinnerJsonl(input: string): BulkCaptureBatch {
  const lines = input.split(/\r?\n/).map((text, index) => ({ text, line: index + 1 })).filter(({ text }) => text.trim());
  if (lines.length < 2) throw new Error('Bulk capture JSONL needs a header and at least one target');
  const parseLine = ({ text, line }: typeof lines[number]): unknown => {
    try { return JSON.parse(text) as unknown; }
    catch { throw new Error(`Invalid JSON on line ${line}`); }
  };
  const header = bulkCaptureHeaderSchema.parse(parseLine(lines[0]!));
  // Validate even if the input contains only verbatim rows: callers must not smuggle a non-history URL.
  sourceURLFor(header, 1);
  const captures = lines.slice(1).map((line) => {
    const raw = parseLine(line);
    try {
      if (Array.isArray(raw)) {
        if (typeof raw[0] === 'number') return expandTuple(bulkLinkedTupleSchema.parse(raw), header);
        const [, cupId, season, teamId, teamName, reason, row] = bulkUnresolvedTupleSchema.parse(raw);
        return bulkUnresolvedCaptureSchema.parse({ status: 'unresolved', cupId, season, teamId, teamName, reason,
          sourceURL: sourceURLFor(header, teamId), page: 1, ...(row ? { row } : {}) });
      }
      const capture = bulkCaptureSchema.parse(raw);
      if (capture.sourceURL !== sourceURLFor(header, capture.teamId)) throw new Error('Source URL differs from the observed batch template');
      return capture;
    } catch (error) {
      throw new Error(`Invalid capture on line ${line.line}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return validateBulkCaptureBatch({ header, captures });
}

function parseWinText(text: string): { winDate: string; season: number; teamName: string; cupName: string; userName: string } | null {
  const normalized = clean(text);
  const date = normalized.match(/^(\d{2})([-.])(\d{2})\2(\d{4})\s+/);
  if (!date) return null;
  const winDate = `${date[4]}-${date[3]}-${date[1]}`;
  const parsed = new Date(`${winDate}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== winDate) return null;
  const body = normalized.slice(date[0].length);
  const victory = body.match(/^In season (\d+), (.+?) emerged victorious from (.+?)\. They were managed by (.+)\.$/i);
  if (victory) return { winDate, season: Number(victory[1]), teamName: victory[2]!, cupName: victory[3]!, userName: victory[4]! };
  const memorable = body.match(/^Season (\d+) was memorable for (.+?), who led (.+?) to the title in (.+)\.$/i);
  if (memorable) return { winDate, season: Number(memorable[1]), teamName: memorable[3]!, cupName: memorable[4]!, userName: memorable[2]! };
  const leadership = body.match(/^(.+?), under the leadership of (.+?), won (.+?) season (\d+)\.$/i);
  return leadership ? { winDate, season: Number(leadership[4]), teamName: leadership[1]!, cupName: leadership[3]!, userName: leadership[2]! } : null;
}

function anchor(row: HistoricalRow, sourceURL: string, path: RegExp, parameter: string): { id: number; text: string } | null {
  const matches = row.links.flatMap((link) => {
    const url = officialURL(link.href, sourceURL);
    if (!url) throw new Error('Evidence contains an unofficial or malformed link');
    if (!path.test(url.pathname)) return [];
    const id = singleId(url, parameter);
    if (!id) throw new Error(`Evidence has an invalid ${parameter} anchor`);
    return [{ id, text: clean(link.text) }];
  });
  return matches.length === 1 && matches[0]!.text ? matches[0]! : null;
}

export interface BulkDirectProof {
  cupId: number; season: number; teamId: number; teamName: string; userId: number; userName: string;
  winDate: string; sourceURL: string; row: HistoricalRow;
}

/** Stronger than the general history extractor: the actual club, cup, and manager anchors are mandatory. */
export function validateBulkLinkedCapture(input: BulkLinkedCapture): BulkDirectProof {
  const capture = bulkLinkedCaptureSchema.parse(input);
  const historyURL = officialURL(capture.sourceURL);
  if (!historyURL || !/^\/(?:en\/)?Club\/History\/?$/i.test(historyURL.pathname) ||
      singleId(historyURL, 'teamId') !== capture.teamId || [...historyURL.searchParams].length !== 1 || historyURL.hash) {
    throw new Error(`Invalid Club History URL for ${targetKey(capture)}`);
  }
  const statement = parseWinText(capture.row.text);
  if (!statement || statement.winDate !== capture.winDate || statement.season !== capture.season ||
      clean(statement.teamName) !== clean(capture.teamName)) {
    throw new Error(`Win statement/date/team does not match ${targetKey(capture)}`);
  }
  const team = anchor(capture.row, capture.sourceURL, /^\/(?:en\/)?Club\/?$/i, 'TeamID');
  const cup = anchor(capture.row, capture.sourceURL, /^\/(?:en\/)?World\/Cup\/(?:Cup\.aspx)?$/i, 'CupID');
  const manager = anchor(capture.row, capture.sourceURL, /^\/(?:en\/)?Club\/Manager\/?$/i, 'userId');
  if (!team || !cup || !manager || team.id !== capture.teamId || cup.id !== capture.cupId ||
      team.text !== clean(statement.teamName) || cup.text !== clean(statement.cupName) ||
      manager.text !== clean(statement.userName)) {
    throw new Error(`Direct TeamID/CupID/userId links or labels disagree for ${targetKey(capture)}`);
  }
  // An archive anchor can contain a global season, but any linked identity elsewhere in the row
  // must still agree. Never turn that global archive season into the cup's local season.
  for (const link of capture.row.links) {
    const url = officialURL(link.href, capture.sourceURL)!;
    for (const [parameter, expected] of [['TeamID', capture.teamId], ['CupID', capture.cupId], ['userId', manager.id]] as const) {
      for (const [name, value] of url.searchParams) if (name.toLowerCase() === parameter.toLowerCase() && Number(value) !== expected) {
        throw new Error(`Contradictory ${parameter} link for ${targetKey(capture)}`);
      }
    }
  }
  const extracted = extractHistoricalWinnerEvidence([{ teamId: capture.teamId, club: capture.teamName, complete: false,
    sourceURL: capture.sourceURL, pages: [{ page: capture.page, sourceURL: capture.sourceURL, rows: [capture.row] }] }]);
  const proof = extracted.evidence[0];
  if (extracted.rejected.length || extracted.evidence.length !== 1 || !proof || proof.kind !== 'cup' ||
      proof.basis !== 'direct-manager' || proof.competitionId !== capture.cupId || proof.season !== capture.season ||
      proof.teamId !== capture.teamId || proof.userId !== manager.id || proof.userName !== manager.text ||
      proof.event.date !== capture.winDate) {
    throw new Error(`History extractor rejected direct proof for ${targetKey(capture)}`);
  }
  return { cupId: capture.cupId, season: capture.season, teamId: capture.teamId,
    teamName: capture.teamName, userId: proof.userId, userName: proof.userName,
    winDate: capture.winDate, sourceURL: capture.sourceURL, row: capture.row };
}

/** Validate all rows before any database lookup. An unresolved row is evidence of a check, not a manager. */
export function validateBulkCaptureBatch(input: BulkCaptureBatch): BulkCaptureBatch {
  const header = bulkCaptureHeaderSchema.parse(input.header);
  sourceURLFor(header, 1);
  if (!Array.isArray(input.captures) || !input.captures.length) throw new Error('Batch has no targets');
  const seen = new Set<string>();
  const captures = input.captures.map((raw) => {
    const capture = bulkCaptureSchema.parse(raw);
    const key = targetKey(capture);
    if (seen.has(key)) throw new Error(`Duplicate target ${key}`);
    seen.add(key);
    if (capture.sourceURL !== sourceURLFor(header, capture.teamId)) throw new Error(`Source URL mismatch for ${key}`);
    if (capture.status === 'linked') validateBulkLinkedCapture(capture);
    return capture;
  });
  return { header, captures };
}

type WinnerDb = Pick<Prisma.TransactionClient, 'cupChampion' | 'hattrickUser'>;
type StoredCupWinner = {
  cupId: number; season: number; leagueId: number; championTeamId: number | null;
  championTeamName: string; championUserId: number | null; championUserName: string | null;
};
export interface BulkPlanItem {
  key: string; capture: BulkCapture; status: 'unresolved' | 'wouldApply' | 'applied' | 'unchanged' | 'conflict' | 'missingRow';
  reason: string; proof?: BulkDirectProof; stored?: StoredCupWinner;
}

/** Internal runner: apply=true requires a transaction client supplied by the caller. */
export async function processBulkHistoricalWinners(db: WinnerDb, input: BulkCaptureBatch, apply = false) {
  const batch = validateBulkCaptureBatch(input);
  const plans: BulkPlanItem[] = [];
  // Preflight the whole batch, including duplicates and existing protected owners, before writes.
  for (const capture of batch.captures) {
    const key = targetKey(capture);
    if (capture.status === 'unresolved') {
      plans.push({ key, capture, status: 'unresolved', reason: capture.reason });
      continue;
    }
    const proof = validateBulkLinkedCapture(capture);
    const stored = await db.cupChampion.findUnique({ where: { cupId_season: { cupId: capture.cupId, season: capture.season } },
      select: { cupId: true, season: true, leagueId: true, championTeamId: true, championTeamName: true,
        championUserId: true, championUserName: true } });
    if (!stored) { plans.push({ key, capture, proof, status: 'missingRow', reason: 'noExactCupSeason' }); continue; }
    if (stored.cupId !== capture.cupId || stored.season !== capture.season ||
        stored.championTeamId !== capture.teamId || clean(stored.championTeamName) !== clean(capture.teamName)) {
      plans.push({ key, capture, proof, stored, status: 'conflict', reason: 'storedWinnerTeamMismatch' }); continue;
    }
    if (stored.championUserId === proof.userId) {
      plans.push({ key, capture, proof, stored, status: 'unchanged', reason: 'alreadyAttributed' }); continue;
    }
    if (stored.championUserId !== null && stored.championUserId !== 0) {
      plans.push({ key, capture, proof, stored, status: 'conflict', reason: 'existingHistoricalOwner' }); continue;
    }
    plans.push({ key, capture, proof, stored, status: 'wouldApply', reason: 'directLinkedHistory' });
  }
  // A missing result row can arrive in a later update and is safe to replay then. An existing
  // contradictory identity blocks *all* writes from this batch until it is reviewed.
  const blocked = plans.some((plan) => plan.status === 'conflict');
  if (apply && !blocked) for (const plan of plans) {
    if (plan.status !== 'wouldApply') continue;
    const { proof, stored } = plan;
    if (!proof || !stored) throw new Error(`Missing preflight evidence for ${plan.key}`);
    const manager = await db.hattrickUser.upsert({ where: { userId: proof.userId },
      create: { userId: proof.userId, loginName: proof.userName, isBot: false }, update: {} });
    const changed = await db.cupChampion.updateMany({ where: {
      cupId: stored.cupId, season: stored.season, leagueId: stored.leagueId,
      championTeamId: stored.championTeamId, championTeamName: stored.championTeamName,
      championUserId: stored.championUserId, championUserName: stored.championUserName,
    }, data: { championUserId: proof.userId, championUserName: manager.loginName } });
    if (changed.count !== 1) throw new Error(`Cup winner changed concurrently: ${plan.key}; transaction must roll back`);
    plan.status = 'applied';
  }
  const counts = {
    unresolved: plans.filter((plan) => plan.status === 'unresolved').length,
    wouldApply: plans.filter((plan) => plan.status === 'wouldApply').length,
    applied: plans.filter((plan) => plan.status === 'applied').length,
    unchanged: plans.filter((plan) => plan.status === 'unchanged').length,
    conflicts: plans.filter((plan) => plan.status === 'conflict').length,
    missingRows: plans.filter((plan) => plan.status === 'missingRow').length,
  };
  return { dryRun: !apply, blocked, records: plans.length, counts, plans };
}

/** Read-only by default; explicit apply is all-or-nothing for the whole accepted batch. */
export async function applyBulkHistoricalWinners(input: BulkCaptureBatch, opts: { apply?: boolean } = {}) {
  if (!opts.apply) return processBulkHistoricalWinners(prisma, input);
  return prisma.$transaction((tx) => processBulkHistoricalWinners(tx, input, true), { timeout: 120_000 });
}
