import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { applyHistoricalWinners, extractHistoricalWinnerEvidence, type HistoricalClubHistory } from '../sync/historicalWinners.js';
import { applyManagerProfileWinner, parseManagerProfileWinnerEvidence } from '../sync/managerProfileWinners.js';
import { captureEvidence, importedEvidenceKey, InvalidEvidenceError, readEvidence, type EvidenceReference } from './evidence.js';
import { sha256, type ObjectStore } from './storage.js';

const LEGACY_HISTORY_PATH = '.scrape/winner-recovery/histories.json';
export const CHECKED_IN_HISTORY_PATH = 'server/src/data/verified-club-history-wieselhausen-2026-09-17.json';
export const ETHIOPIA_HISTORY_PATH = 'server/src/data/verified-club-history-ethiopia-2026-09.json';
export const BHUTAN_HISTORY_PATH = 'server/src/data/verified-club-history-bhutan-2026-09.json';
export const GIBRALTAR_HISTORY_PATH = 'server/src/data/verified-club-history-gibraltar-2026-09.json';
export const HAITI_HISTORY_PATH = 'server/src/data/verified-club-history-haiti-2026-09.json';
export const HRO_PROFILE_PATH = 'server/src/data/verified-manager-profile-hro-2026-09.json';
const HISTORY_PATHS = [LEGACY_HISTORY_PATH, CHECKED_IN_HISTORY_PATH, ETHIOPIA_HISTORY_PATH, BHUTAN_HISTORY_PATH, GIBRALTAR_HISTORY_PATH, HAITI_HISTORY_PATH] as const;
const pathByHash = new Map(HISTORY_PATHS.map(path => [sha256(path), path]));
const ImportedHistorySchema = z.object({
  path: z.enum(HISTORY_PATHS), encoding: z.literal('base64'), contents: z.string().min(1),
}).strict();
const ImportedProfileSchema = z.object({
  path: z.literal(HRO_PROFILE_PATH), encoding: z.literal('base64'), contents: z.string().min(1),
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

/** Import one reviewed capture immutably; no directory scan or live Hattrick request is involved. */
export async function retainCheckedInClubHistory(store: ObjectStore, repositoryPath: string,
  path: typeof CHECKED_IN_HISTORY_PATH | typeof ETHIOPIA_HISTORY_PATH | typeof BHUTAN_HISTORY_PATH | typeof GIBRALTAR_HISTORY_PATH | typeof HAITI_HISTORY_PATH = CHECKED_IN_HISTORY_PATH): Promise<EvidenceReference> {
  // runner imports this module before it selects the isolated update database. Keep both
  // masters.ts and db/client.ts lazy so their Prisma client binds only after that selection.
  const { MASTERS_CUP_ID } = await import('../sync/masters.js');
  const body = await readFile(resolve(repositoryPath, path));
  const histories = parseHistoryFile(body);
  const extracted = extractHistoricalWinnerEvidence(histories);
  const proof = extracted.evidence;
  const required = path === CHECKED_IN_HISTORY_PATH
    ? [[MASTERS_CUP_ID, 95, 820764, 13557250]]
    : path === ETHIOPIA_HISTORY_PATH
      ? [[1468, 23, 2064714, 11419808], [1469, 23, 2064759, 4916963],
      [1470, 23, 2064846, 13148804], [1471, 23, 2064763, 13754231],
      [1472, 23, 2064747, 250791]]
      : path === BHUTAN_HISTORY_PATH
        ? [[1588, 3, 2787850, 10360171], [1589, 3, 2787812, 9524206],
          [1591, 3, 2785354, 13413709], [1592, 3, 2785355, 48200]]
        : path === GIBRALTAR_HISTORY_PATH
          ? [[1583, 3, 2790688, 13264188], [1584, 3, 2787922, 4540620],
          [1585, 3, 2788315, 4145756], [1586, 3, 2815169, 13257829],
          [1587, 3, 2788215, 13930589]]
          : [[1508, 20, 2066127, 13620442], [1509, 20, 2066072, 6205490],
            [1510, 20, 2066147, 13606541], [1511, 20, 2066044, 7568690],
            [1512, 20, 2066113, 5739966]];
  if (extracted.rejected.length || proof.length !== required.length || required.some(([cupId, season, teamId, userId]) =>
    !proof.some(row => row.kind === 'cup' && row.competitionId === cupId && row.season === season &&
      row.teamId === teamId && row.userId === userId && row.basis === 'direct-manager'))) throw new InvalidEvidenceError();
  return captureEvidence({ store, key: importedEvidenceKey(path, body), source: path,
    parserVersion: 'checked-in-history-v1', payload: { path, encoding: 'base64', contents: body.toString('base64') } });
}

/** Retain one linked manager-profile trophy and its corroborating dated club-history event. */
export async function retainCheckedInHroProfile(store: ObjectStore, repositoryPath: string): Promise<EvidenceReference> {
  const body = await readFile(resolve(repositoryPath, HRO_PROFILE_PATH));
  let raw: unknown;
  try { raw = JSON.parse(body.toString('utf8').replace(/^\uFEFF/, '')); }
  catch { throw new InvalidEvidenceError(); }
  let proof: ReturnType<typeof parseManagerProfileWinnerEvidence>;
  try { proof = parseManagerProfileWinnerEvidence(raw); }
  catch { throw new InvalidEvidenceError(); }
  if (proof.leagueId !== 164 || proof.topSeriesId !== 258666 || proof.season !== 19 ||
    proof.teamId !== 2066186 || proof.userId !== 4178181) throw new InvalidEvidenceError();
  return captureEvidence({ store, key: importedEvidenceKey(HRO_PROFILE_PATH, body), source: HRO_PROFILE_PATH,
    parserVersion: 'checked-in-manager-profile-v1', payload: { path: HRO_PROFILE_PATH, encoding: 'base64', contents: body.toString('base64') } });
}

/** Replay only a referenced immutable profile capture; the planner guards the exact stored row. */
export async function replayRetainedHroProfile(store: ObjectStore, references: readonly EvidenceReference[], now = new Date()) {
  const pathHash = sha256(HRO_PROFILE_PATH);
  const keys = references.map(ref => ref.key).filter(key =>
    /^evidence\/imports\/[a-f0-9]{64}\/[a-f0-9]{64}\.json$/.test(key) && key.split('/')[3]!.slice(0, -5) === pathHash).sort();
  let applied = 0; let alreadyAttributed = 0; let conflicts = 0; let unmatched = 0; let attributionTasksCompleted = 0;
  for (const key of keys) {
    const retained = await readEvidence(store, key);
    if (!retained || retained.capture.source !== HRO_PROFILE_PATH ||
      retained.capture.parserVersion !== 'checked-in-manager-profile-v1') throw new InvalidEvidenceError();
    const payload = ImportedProfileSchema.safeParse(retained.capture.payload);
    if (!payload.success) throw new InvalidEvidenceError();
    const body = Buffer.from(payload.data.contents, 'base64');
    if (body.toString('base64') !== payload.data.contents || sha256(body) !== key.split('/')[2]) throw new InvalidEvidenceError();
    let raw: unknown;
    try { raw = JSON.parse(body.toString('utf8').replace(/^\uFEFF/, '')); }
    catch { throw new InvalidEvidenceError(); }
    let proof: ReturnType<typeof parseManagerProfileWinnerEvidence>;
    try { proof = parseManagerProfileWinnerEvidence(raw); }
    catch { throw new InvalidEvidenceError(); }
    if (proof.leagueId !== 164 || proof.topSeriesId !== 258666 || proof.season !== 19 ||
      proof.teamId !== 2066186 || proof.userId !== 4178181) throw new InvalidEvidenceError();
    const result = await applyManagerProfileWinner(raw, { apply: true });
    if (result.status === 'applied') applied++;
    else if (result.status === 'already-attributed') alreadyAttributed++;
    else if (result.status === 'conflict') conflicts++;
    else if (result.status === 'unmatched') unmatched++;
    if (result.status === 'applied' || result.status === 'already-attributed') {
      const { prisma } = await import('../db/client.js');
      const updated = await prisma.updateItem.updateMany({ where: {
        sourceKey: 'league:164', itemKey: '19', task: 'attribution', state: { not: 'complete' },
      }, data: { state: 'complete', completedAt: now, nextAttemptAt: null, lastError: null, errorCategory: null } });
      attributionTasksCompleted += updated.count;
    }
  }
  return { captures: keys.length, applied, alreadyAttributed, conflicts, unmatched, attributionTasksCompleted };
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
  const { prisma } = await import('../db/client.js');
  const { MASTERS_CUP_ID } = await import('../sync/masters.js');
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
