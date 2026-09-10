import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/client.js';

export const electionIdentitySchema = z.object({
  leagueId: z.number().int().positive(), isYouth: z.boolean(), edition: z.number().int().positive(),
  host: z.string(), votes: z.string().nullable(),
});
export type ElectionIdentity = z.infer<typeof electionIdentitySchema>;
export const electionKey = (row: ElectionIdentity) => JSON.stringify([row.leagueId, row.isYouth, row.edition, row.host, row.votes]);
const query = (url: URL, key: string) => [...url.searchParams].find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1];
const isHattrick = (url: URL) => url.protocol === 'https:' && (url.hostname === 'hattrick.org' || url.hostname.endsWith('.hattrick.org'));

/** A saved election winner link, not an inferred national-coach tenure. */
export const electionEvidenceSchema = electionIdentitySchema.extend({
  winnerUserId: z.number().int().positive(), winnerUserName: z.string().min(1),
  sourceURL: z.string().url(), rowText: z.string().min(1), winnerHref: z.string().min(1),
  /** Counted over the complete source table, including former-user rows, before filtering. */
  sourceTupleOccurrences: z.literal(1),
}).strict().superRefine((row, ctx) => {
  const compact = (text: string) => text.replace(/\s+/g, ' ').trim();
  const text = compact(row.rowText);
  if (!new RegExp(`\\bWorld Cup\\s+${row.edition}\\b`, 'i').test(text)
    || !text.includes(compact(row.winnerUserName)) || (row.host && !text.includes(compact(row.host)))
    || (row.votes && !text.includes(compact(row.votes)))) {
    ctx.addIssue({ code: 'custom', message: 'Observed row text must contain this edition, host, winner, and votes', path: ['rowText'] });
  }
  try {
    const source = new URL(row.sourceURL);
    if (!isHattrick(source) || !/\/World\/Elections\/History\.aspx$/i.test(source.pathname)
      || Number(query(source, 'LeagueID')) !== row.leagueId) {
      ctx.addIssue({ code: 'custom', message: 'Source must be the exact Hattrick league election-history page', path: ['sourceURL'] });
    }
    const winner = new URL(row.winnerHref, source);
    if (!isHattrick(winner) || !/\/Club\/Manager\/?$/i.test(winner.pathname)
      || Number(query(winner, 'userId')) !== row.winnerUserId) {
      ctx.addIssue({ code: 'custom', message: 'Observed winner link must identify the supplied user', path: ['winnerHref'] });
    }
  } catch { ctx.addIssue({ code: 'custom', message: 'Invalid observed source or winner URL' }); }
});
export type ElectionEvidence = z.infer<typeof electionEvidenceSchema>;
type ElectionDb = Pick<Prisma.TransactionClient, 'nationalCoachElection' | 'hattrickUser'>;

const capturedRowSchema = electionIdentitySchema.extend({
  winnerUserId: z.number().int().nonnegative().nullable(), winnerUserName: z.string().nullable(),
  sourceURL: z.string().url(), rowText: z.string(), winnerHref: z.string().nullable(),
});
export const electionCaptureSchema = z.object({
  leagueId: z.number().int().positive(), sourceURL: z.string().url(), complete: z.boolean(),
  rows: z.array(capturedRowSchema),
});
export type ElectionCapture = z.infer<typeof electionCaptureSchema>;

/** Never filter former users before counting source occurrences: they can collide with a live
 * winner's exact edition/host/votes tuple, despite representing a different mid-cycle election. */
export function prepareElectionCaptures(input: readonly ElectionCapture[]) {
  const captures = z.array(electionCaptureSchema).parse(input);
  const evidence: ElectionEvidence[] = [];
  const ambiguities: Array<{ key: string; sourceURL: string; occurrences: number; rows: z.infer<typeof capturedRowSchema>[] }> = [];
  const incomplete: string[] = [];
  const blocked = new Set<string>();
  for (const capture of captures) {
    if (!capture.complete) { incomplete.push(capture.sourceURL); continue; }
    if (capture.rows.some((row) => row.leagueId !== capture.leagueId || row.sourceURL !== capture.sourceURL)) {
      throw new Error(`Election snapshot contains rows from a different source: ${capture.sourceURL}`);
    }
    const groups = new Map<string, typeof capture.rows>();
    for (const row of capture.rows) { const key = electionKey(row); groups.set(key, [...(groups.get(key) ?? []), row]); }
    for (const [key, rows] of groups) {
      if (rows.length !== 1) {
        blocked.add(key); ambiguities.push({ key, sourceURL: capture.sourceURL, occurrences: rows.length, rows }); continue;
      }
      const row = rows[0]!;
      if (!row.winnerUserId) continue;
      evidence.push(electionEvidenceSchema.parse({ ...row, sourceTupleOccurrences: 1 }));
    }
  }
  return { evidence: evidence.filter((row) => !blocked.has(electionKey(row))), ambiguities, incomplete };
}

export async function processElectionRecovery(db: ElectionDb, input: readonly ElectionEvidence[], apply = false) {
  const evidence = z.array(electionEvidenceSchema).parse(input);
  const groups = new Map<string, ElectionEvidence[]>();
  for (const row of evidence) { const key = electionKey(row); groups.set(key, [...(groups.get(key) ?? []), row]); }
  const counts = { ready: 0, applied: 0, alreadyAttributed: 0, conflicts: 0, ambiguous: 0, missingRows: 0, duplicates: 0 };
  const results: Array<{ key: string; status: string; reason: string; storedId?: number; evidence: ElectionEvidence[] }> = [];
  for (const [key, group] of groups) {
    const source = group[0]!;
    const record = (status: keyof typeof counts, reason: string, storedId?: number) => {
      counts[status]++; results.push({ key, status, reason, storedId, evidence: group });
    };
    if (new Set(group.map((row) => row.winnerUserId)).size !== 1) { record('conflicts', 'Conflicting source winners for the same exact tuple'); continue; }
    counts.duplicates += group.length - 1;
    const identity = electionIdentitySchema.parse(source);
    const matches = await db.nationalCoachElection.findMany({ where: identity });
    if (!matches.length) { record('missingRows', 'No exact stored election; recovery never creates elections'); continue; }
    if (matches.length !== 1) { record('ambiguous', 'Repeated elections share this tuple; no unique row identity'); continue; }
    const stored = matches[0]!;
    if (stored.winnerUserId && stored.winnerUserId > 0) {
      record(stored.winnerUserId === source.winnerUserId ? 'alreadyAttributed' : 'conflicts',
        stored.winnerUserId === source.winnerUserId ? 'Known identity preserved' : 'Existing winner differs from verified evidence', stored.id);
      continue;
    }
    if (stored.winnerUserId !== null && stored.winnerUserId !== 0) { record('conflicts', 'Invalid stored winner sentinel', stored.id); continue; }
    if (!apply) { record('ready', 'Observed link identifies the unique missing election winner', stored.id); continue; }
    const user = await db.hattrickUser.upsert({ where: { userId: source.winnerUserId },
      update: {}, create: { userId: source.winnerUserId, loginName: source.winnerUserName } });
    const changed = await db.nationalCoachElection.updateMany({
      where: { id: stored.id, ...identity, winnerUserId: stored.winnerUserId },
      data: { winnerUserId: source.winnerUserId, winnerUserName: user.loginName },
    });
    if (changed.count !== 1) throw new Error(`Election changed concurrently: ${key}; transaction must roll back`);
    record('applied', 'Recovered from observed winner link', stored.id);
  }
  return { dryRun: !apply, records: evidence.length, counts, results };
}

/** Missing-only recovery, dry-run by default; applies atomically without deleting any election. */
export async function recoverElections(input: readonly ElectionEvidence[], options: { apply?: boolean } = {}) {
  if (!options.apply) return processElectionRecovery(prisma, input);
  return prisma.$transaction((tx) => processElectionRecovery(tx, input, true), { timeout: 30_000 });
}

/** Preferred entry point for browser captures; retains full-source ambiguity diagnostics. */
export async function recoverElectionCaptures(input: readonly ElectionCapture[], options: { apply?: boolean } = {}) {
  const prepared = prepareElectionCaptures(input);
  const result = await recoverElections(prepared.evidence, options);
  return { ...result, counts: { ...result.counts, sourceAmbiguous: prepared.ambiguities.length, incompleteCaptures: prepared.incomplete.length },
    sourceAmbiguities: prepared.ambiguities, incompleteCaptures: prepared.incomplete };
}
