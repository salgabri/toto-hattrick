import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { applyHistoricalWinners, extractHistoricalWinnerEvidence, type HistoricalClubHistory } from '../sync/historicalWinners.js';
import { MASTERS_CUP_ID } from '../sync/masters.js';
import { captureEvidence, importedEvidenceKey, InvalidEvidenceError, readEvidence, type EvidenceReference } from './evidence.js';
import { sha256, type ObjectStore } from './storage.js';

const LEGACY_HISTORY_PATH = '.scrape/winner-recovery/histories.json';
export const CHECKED_IN_HISTORY_PATH = 'server/src/data/verified-club-history-wieselhausen-2026-09-17.json';
const HISTORY_PATHS = [LEGACY_HISTORY_PATH, CHECKED_IN_HISTORY_PATH] as const;
const pathByHash = new Map(HISTORY_PATHS.map(path => [sha256(path), path]));
const ImportedHistorySchema = z.object({
  path: z.enum(HISTORY_PATHS), encoding: z.literal('base64'), contents: z.string().min(1),
}).strict();

function parseHistoryFile(body: Buffer): HistoricalClubHistory[] {
  let parsed: unknown;
  try { parsed = JSON.parse(body.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { throw new InvalidEvidenceError(); }
  const entries = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && 'histories' in parsed ? parsed.histories : undefined;
  if (!Array.isArray(entries)) throw new InvalidEvidenceError();
  // The existing extractor validates each capture's shape, links and dates before it can affect
  // a winner. A malformed checked-in record must fail before entering private storage.
  try { extractHistoricalWinnerEvidence(entries as HistoricalClubHistory[]); }
  catch { throw new InvalidEvidenceError(); }
  return entries as HistoricalClubHistory[];
}

/** One reviewed, checked-in history capture may be added after the original archive bootstrap.
 * Import this exact file immutably; no directory scan or live Hattrick request is involved. */
export async function retainCheckedInClubHistory(store: ObjectStore, repositoryPath: string): Promise<EvidenceReference> {
  const body = await readFile(resolve(repositoryPath, CHECKED_IN_HISTORY_PATH));
  const histories = parseHistoryFile(body);
  const proof = extractHistoricalWinnerEvidence(histories).evidence;
  if (!proof.some(row => row.kind === 'cup' && row.competitionId === MASTERS_CUP_ID && row.season === 95 &&
    row.teamId === 820764 && row.userId === 13557250 && row.basis === 'direct-manager')) throw new InvalidEvidenceError();
  return captureEvidence({ store, key: importedEvidenceKey(CHECKED_IN_HISTORY_PATH, body), source: CHECKED_IN_HISTORY_PATH,
    parserVersion: 'checked-in-history-v1', payload: { path: CHECKED_IN_HISTORY_PATH, encoding: 'base64', contents: body.toString('base64') } });
}

/** Read only captures already named by the accepted snapshot. Never reopen the checkout's
 * mutable .scrape files or discover private-store objects outside that snapshot. */
export async function retainedClubHistories(store: ObjectStore, references: readonly EvidenceReference[]): Promise<{
  captures: number; histories: HistoricalClubHistory[];
}> {
  const keys = references.map(ref => ref.key).filter(key =>
    /^evidence\/imports\/[a-f0-9]{64}\/[a-f0-9]{64}\.json$/.test(key) && pathByHash.has(key.split('/')[3]!.slice(0, -5))).sort();
  const histories: HistoricalClubHistory[] = [];
  for (const key of keys) {
    const retained = await readEvidence(store, key);
    const path = pathByHash.get(key.split('/')[3]!.slice(0, -5));
    if (!retained || !path || retained.capture.source !== path ||
      !['legacy-import-v1', 'checked-in-history-v1'].includes(retained.capture.parserVersion))
      throw new InvalidEvidenceError();
    const payload = ImportedHistorySchema.safeParse(retained.capture.payload);
    if (!payload.success || payload.data.path !== path) throw new InvalidEvidenceError();
    const body = Buffer.from(payload.data.contents, 'base64');
    if (body.toString('base64') !== payload.data.contents || sha256(body) !== key.split('/')[2])
      throw new InvalidEvidenceError();
    histories.push(...parseHistoryFile(body));
  }
  return { captures: keys.length, histories };
}

/** Historical identity can arrive before the result row it proves. Replay already-retained
 * linked events after each result run; the shared resolver guards every database update. */
export async function replayRetainedClubHistories(store: ObjectStore, references: readonly EvidenceReference[], now = new Date()) {
  const retained = await retainedClubHistories(store, references);
  if (!retained.captures) return { captures: 0, histories: 0, applied: 0, conflicts: 0, unmatched: 0, attributionTasksCompleted: 0 };
  const result = await applyHistoricalWinners(retained.histories, { apply: true });
  let attributionTasksCompleted = 0;
  for (const plan of result.plans) {
    if (!['applied', 'already-attributed'].includes(plan.status) || !plan.stored) continue;
    const sourceKey = plan.table === 'leagueChampion' ? `league:${plan.stored.leagueId}`
      : plan.stored.leagueId === 0 && plan.stored.cupId !== MASTERS_CUP_ID
        ? `seasonal:${plan.stored.cupId}` : `cup:${plan.stored.cupId}`;
    const updated = await prisma.updateItem.updateMany({ where: {
      sourceKey, itemKey: String(plan.stored.season), task: 'attribution', state: { not: 'complete' },
    }, data: { state: 'complete', completedAt: now, nextAttemptAt: null, lastError: null, errorCategory: null } });
    attributionTasksCompleted += updated.count;
  }
  return { captures: retained.captures, histories: retained.histories.length, applied: result.counts.applied,
    conflicts: result.counts.conflicts, unmatched: result.counts.unmatched, attributionTasksCompleted };
}
