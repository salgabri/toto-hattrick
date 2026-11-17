import { createHash } from 'node:crypto';
import { mkdir, open, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { TokenPair } from '../chpp/auth.js';
import { configureChppRuntime } from '../chpp/client.js';
import { resolveUserNationality } from '../sync/enrichManagers.js';
import { readReviewSidecar } from './review.js';

/**
 * Applies a browser read of World/Elections/History.aspx (server/scrape/elections-capture.js) to a
 * review checkout. Election identity is [leagueId, isYouth, edition, host, votes]; a running cycle
 * is stored with host '' until its World Cup host is announced, so a later read FILLS that host
 * instead of inserting a twin. Positive winners are never changed and rows are never deleted.
 * Editions before the capture cutoff are compared by fingerprint; any mismatch must be explained
 * row by row (deleted account kept, newly linked winner filled) before --apply is allowed.
 */
const CAPTURE_DIRECTORY = '.scrape/review-captures';
type Row = Record<string, unknown>;

export const CompactRowSchema = z.tuple([z.number().int().positive(), z.string(), z.number().int().positive().nullable(),
  z.string().nullable(), z.string().nullable(), z.union([z.literal(0), z.literal(1)])]);
export const CompactCountrySchema = z.object({
  t: z.string().datetime(), c: z.number().int().positive(), n: z.number().int().nonnegative(),
  o: z.tuple([z.number().int().nonnegative(), z.string().regex(/^[0-9a-f]{16}$/), z.number().int().nonnegative(), z.string().regex(/^[0-9a-f]{16}$/)]),
  r: z.array(CompactRowSchema),
});
const ChunkSchema = z.record(z.string().regex(/^\d+$/), CompactCountrySchema);
/** Full older rows for mismatched pairs: key "<leagueId>S" or "<leagueId>Y". */
const OlderSchema = z.record(z.string().regex(/^\d+[SY]$/), z.array(z.tuple([z.number().int().positive(), z.string(),
  z.number().int().positive().nullable(), z.string().nullable(), z.string().nullable()])));

export interface PageRow { edition: number; host: string; winnerUserId: number | null; winnerUserName: string | null; votes: string | null; isYouth: boolean }
export interface StoredRow { id: number; edition: number; host: string; winnerUserId: number | null; winnerUserName: string | null; votes: string | null }

export const olderFingerprint = (rows: Array<{ edition: number; host: string; winnerUserId: number | null; votes: string | null }>) =>
  createHash('sha256').update(rows.map(row => `${row.edition}|${row.host}|${row.winnerUserId ?? ''}|${row.votes ?? ''}`).sort().join('\n')).digest('hex').slice(0, 16);

export type RecentAction =
  | { kind: 'exact'; id: number }
  | { kind: 'hostFill'; id: number; host: string }
  | { kind: 'winnerFill'; id: number; userId: number; name: string }
  | { kind: 'insert'; row: PageRow }
  | { kind: 'skip'; reason: string; row: PageRow };

/** Pure plan for one country/age group's recent (>= cutoff) rows. */
export function planRecent(stored: StoredRow[], page: PageRow[]): RecentAction[] {
  const used = new Set<number>();
  const actions: RecentAction[] = [];
  for (const row of page) {
    if (page.filter(other => other.edition === row.edition && other.host === row.host && other.votes === row.votes).length > 1) {
      actions.push({ kind: 'skip', reason: 'indistinguishable twin elections on the page', row }); continue;
    }
    const exact = stored.find(s => !used.has(s.id) && s.edition === row.edition && s.host === row.host && s.votes === row.votes);
    const fill = exact ? undefined : stored.find(s => !used.has(s.id) && s.edition === row.edition && s.host === '' && row.host !== '' && s.votes === row.votes);
    const match = exact ?? fill;
    if (!match) { actions.push({ kind: 'insert', row }); continue; }
    used.add(match.id);
    const storedWinner = match.winnerUserId ?? 0;
    // A stored winner whose account was later deleted shows as "A former user": keep the name.
    if (storedWinner > 0 && (row.winnerUserId ?? 0) > 0 && storedWinner !== row.winnerUserId) {
      actions.push({ kind: 'skip', reason: `stored winner ${storedWinner} differs from the page`, row }); continue;
    }
    actions.push(fill ? { kind: 'hostFill', id: match.id, host: row.host } : { kind: 'exact', id: match.id });
    if (storedWinner === 0 && (row.winnerUserId ?? 0) > 0 && row.winnerUserName) actions.push({ kind: 'winnerFill', id: match.id, userId: row.winnerUserId!, name: row.winnerUserName });
  }
  return actions;
}

export type OlderAction = { kind: 'accountGone'; id: number } | { kind: 'winnerFill'; id: number; userId: number; name: string } | { kind: 'conflict'; detail: string };

/** Pure explanation of an older-edition fingerprint mismatch, row by row. */
export function explainOlder(stored: StoredRow[], page: Array<[number, string, number | null, string | null, string | null]>): OlderAction[] {
  const key = (edition: number, host: string, votes: string | null) => `${edition}|${host}|${votes ?? ''}`;
  const pageRows = page.map(([edition, host, winnerUserId, winnerUserName, votes]) => ({ edition, host, winnerUserId, winnerUserName, votes }));
  const actions: OlderAction[] = [];
  const usedPage = new Set<number>();
  for (const row of stored) {
    const index = pageRows.findIndex((p, i) => !usedPage.has(i) && key(p.edition, p.host, p.votes) === key(row.edition, row.host, row.votes) &&
      ((p.winnerUserId ?? 0) === (row.winnerUserId ?? 0)));
    if (index >= 0) { usedPage.add(index); continue; }
    const loose = pageRows.findIndex((p, i) => !usedPage.has(i) && key(p.edition, p.host, p.votes) === key(row.edition, row.host, row.votes));
    if (loose < 0) { actions.push({ kind: 'conflict', detail: `archive row ${key(row.edition, row.host, row.votes)} is not on the page` }); continue; }
    usedPage.add(loose);
    const p = pageRows[loose]!;
    if ((row.winnerUserId ?? 0) > 0 && !p.winnerUserId) actions.push({ kind: 'accountGone', id: row.id });
    else if (!(row.winnerUserId ?? 0) && p.winnerUserId && p.winnerUserName) actions.push({ kind: 'winnerFill', id: row.id, userId: p.winnerUserId, name: p.winnerUserName });
    else actions.push({ kind: 'conflict', detail: `winner differs for ${key(row.edition, row.host, row.votes)}` });
  }
  pageRows.forEach((p, i) => { if (!usedPage.has(i)) actions.push({ kind: 'conflict', detail: `page row ${key(p.edition, p.host, p.votes)} is not in the archive` }); });
  return actions;
}

export interface ElectionCaptureSummary {
  dryRun: boolean; countries: number; olderMatched: number; olderExplained: number;
  needsOlderDetails: Array<[number, boolean]>; conflicts: string[];
  hostFilled: number; winnersFilled: number; inserted: number; insertedByEdition: Record<string, number>; skipped: number;
  newUsers: number; manifestPath: string | null; reportPath: string | null;
}

export async function applyElectionCapture(options: {
  databasePath: string; captureDir: string; repositoryPath: string; apply?: boolean; reportPath?: string; token?: TokenPair; stamp?: string;
}): Promise<ElectionCaptureSummary> {
  const databasePath = resolve(options.databasePath);
  const sidecar = await readReviewSidecar(databasePath);
  if (resolve(sidecar.databasePath) !== databasePath) throw new Error('Review sidecar belongs to a different database path');
  if (options.apply && !options.reportPath) throw new Error('elections --apply requires --report <new.json>');
  const captureDir = resolve(options.captureDir);
  const files = (await readdir(captureDir)).filter(name => /^chunk-\d+\.json$/.test(name)).sort();
  if (!files.length) throw new Error('The capture directory has no chunk-N.json files');
  const capture: Record<string, z.infer<typeof CompactCountrySchema>> = {};
  for (const file of files) for (const [leagueId, country] of Object.entries(ChunkSchema.parse(JSON.parse(await readFile(join(captureDir, file), 'utf8'))))) {
    if (capture[leagueId]) throw new Error(`League ${leagueId} appears in two chunks`);
    capture[leagueId] = country;
  }
  const older = await readFile(join(captureDir, 'older.json'), 'utf8').then(text => OlderSchema.parse(JSON.parse(text)), () => ({} as z.infer<typeof OlderSchema>));
  const reportFile = options.reportPath ? await open(resolve(options.reportPath), 'wx') : undefined;
  try {
    const db = new DatabaseSync(databasePath);
    try {
      const olderRows = db.prepare('SELECT id, edition, host, winnerUserId, winnerUserName, votes FROM NationalCoachElection WHERE leagueId = ? AND isYouth = ? AND edition < ? ORDER BY id');
      const recentRows = db.prepare('SELECT id, edition, host, winnerUserId, winnerUserName, votes FROM NationalCoachElection WHERE leagueId = ? AND isYouth = ? AND edition >= ? ORDER BY edition, id');
      const countryOf = db.prepare('SELECT countryName FROM NationalCoachElection WHERE leagueId = ? ORDER BY edition DESC, id DESC LIMIT 1');
      const summary: ElectionCaptureSummary = { dryRun: !options.apply, countries: Object.keys(capture).length, olderMatched: 0, olderExplained: 0,
        needsOlderDetails: [], conflicts: [], hostFilled: 0, winnersFilled: 0, inserted: 0, insertedByEdition: {}, skipped: 0, newUsers: 0, manifestPath: null,
        reportPath: options.reportPath ? resolve(options.reportPath) : null };
      const recentPlans: Array<{ leagueId: number; country: string; youth: boolean; actions: RecentAction[] }> = [];
      const olderPlans: OlderAction[] = [];
      const skipped: unknown[] = [];
      for (const [leagueIdText, country] of Object.entries(capture)) {
        const leagueId = Number(leagueIdText);
        const name = (countryOf.get(leagueId) as Row | undefined)?.countryName;
        if (typeof name !== 'string') throw new Error(`League ${leagueId} has no stored election history`);
        for (const youth of [false, true]) {
          const stored = olderRows.all(leagueId, youth ? 1 : 0, country.c) as unknown as StoredRow[];
          const [n, sha] = youth ? [country.o[2], country.o[3]] : [country.o[0], country.o[1]];
          if (stored.length === n && olderFingerprint(stored) === sha) summary.olderMatched++;
          else {
            const details = older[`${leagueId}${youth ? 'Y' : 'S'}`];
            if (!details) summary.needsOlderDetails.push([leagueId, youth]);
            else {
              const actions = explainOlder(stored, details);
              for (const action of actions) if (action.kind === 'conflict') summary.conflicts.push(`${leagueId}${youth ? 'Y' : 'S'}: ${action.detail}`);
              if (!actions.some(action => action.kind === 'conflict')) { olderPlans.push(...actions); summary.olderExplained++; }
            }
          }
          const page = country.r.filter(row => row[5] === (youth ? 1 : 0)).map(([edition, host, winnerUserId, winnerUserName, votes]) =>
            ({ edition, host, winnerUserId, winnerUserName, votes, isYouth: youth }));
          const actions = planRecent(recentRows.all(leagueId, youth ? 1 : 0, country.c) as unknown as StoredRow[], page);
          recentPlans.push({ leagueId, country: name, youth, actions });
          for (const action of actions) if (action.kind === 'skip') skipped.push({ leagueId, youth, ...action });
        }
      }
      summary.skipped = skipped.length;
      const recent = recentPlans.flatMap(plan => plan.actions.map(action => ({ plan, action })));
      summary.hostFilled = recent.filter(({ action }) => action.kind === 'hostFill').length;
      summary.winnersFilled = recent.filter(({ action }) => action.kind === 'winnerFill').length + olderPlans.filter(action => action.kind === 'winnerFill').length;
      for (const { plan, action } of recent) if (action.kind === 'insert') {
        summary.inserted++;
        const label = `${plan.youth ? 'U21' : 'senior'} ${action.row.edition}`;
        summary.insertedByEdition[label] = (summary.insertedByEdition[label] ?? 0) + 1;
      }
      // New winner accounts, with nationality from the pinned managercompendium lookup.
      const userIds = new Map<number, string>();
      for (const { action } of recent) {
        if (action.kind === 'winnerFill') userIds.set(action.userId, action.name);
        if (action.kind === 'insert' && action.row.winnerUserId && action.row.winnerUserName) userIds.set(action.row.winnerUserId, action.row.winnerUserName);
      }
      for (const action of olderPlans) if (action.kind === 'winnerFill') userIds.set(action.userId, action.name);
      const knownUser = db.prepare('SELECT loginName FROM HattrickUser WHERE userId = ?');
      const newUsers = [...userIds].filter(([userId]) => !knownUser.get(userId));
      summary.newUsers = newUsers.length;
      if (options.apply && (summary.needsOlderDetails.length || summary.conflicts.length))
        throw new Error('Older election editions differ from the archive; capture older.json for the listed pairs and resolve conflicts first');
      if (options.apply) {
        const nationality = new Map<number, { countryId: number | null; nationality: string | null }>();
        if (options.token && newUsers.length) {
          const runtime = configureChppRuntime({ maxCalls: newUsers.length + 5, pacingMs: 1000, maxRetries: 1 });
          try { for (const [userId] of newUsers) { try { nationality.set(userId, await resolveUserNationality(options.token, userId)); } catch { /* nationality lane retries */ } } }
          finally { runtime.dispose(); }
        }
        const now = Date.now();
        db.exec('BEGIN IMMEDIATE');
        try {
          const insertUser = db.prepare('INSERT INTO HattrickUser (userId, loginName, countryId, nationality, isBot, updatedAt) VALUES (?, ?, ?, ?, 0, ?)');
          for (const [userId, name] of newUsers) insertUser.run(userId, name, nationality.get(userId)?.countryId ?? null, nationality.get(userId)?.nationality ?? null, now);
          const login = (userId: number) => String((knownUser.get(userId) as Row).loginName);
          const fillHost = db.prepare(`UPDATE NationalCoachElection SET host = ?, updatedAt = ? WHERE id = ? AND host = ''`);
          const fillWinner = db.prepare('UPDATE NationalCoachElection SET winnerUserId = ?, winnerUserName = ?, updatedAt = ? WHERE id = ? AND (winnerUserId IS NULL OR winnerUserId = 0)');
          const insert = db.prepare(`INSERT INTO NationalCoachElection (leagueId, countryName, edition, host, isYouth, winnerUserId, winnerUserName, votes, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
          const once = (result: { changes: number | bigint }, what: string) => { if (Number(result.changes) !== 1) throw new Error(`Guard rejected ${what}`); };
          for (const { plan, action } of recent) {
            if (action.kind === 'hostFill') once(fillHost.run(action.host, now, action.id), `host fill ${action.id}`);
            if (action.kind === 'winnerFill') once(fillWinner.run(action.userId, login(action.userId), now, action.id), `winner fill ${action.id}`);
            if (action.kind === 'insert') {
              const userId = action.row.winnerUserId && action.row.winnerUserName ? action.row.winnerUserId : null;
              insert.run(plan.leagueId, plan.country, action.row.edition, action.row.host, plan.youth ? 1 : 0, userId, userId ? login(userId) : null, action.row.votes, now, now);
            }
          }
          for (const action of olderPlans) if (action.kind === 'winnerFill') once(fillWinner.run(action.userId, login(action.userId), now, action.id), `older winner fill ${action.id}`);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        summary.manifestPath = await writeCaptureManifest(db, capture, options.repositoryPath, options.stamp ?? new Date().toISOString().slice(0, 10));
      }
      if (reportFile) await reportFile.writeFile(`${JSON.stringify({ ...summary, generatedAt: new Date().toISOString(), skipped,
        inserted: recent.flatMap(({ plan, action }) => action.kind === 'insert' ? [{ leagueId: plan.leagueId, youth: plan.youth, ...action.row }] : []) }, null, 1)}\n`);
      return summary;
    } finally { db.close(); }
  } finally { await reportFile?.close(); }
}

/** Artifact + strict manifest for update:acknowledge, covering only sources with an open capture task. */
async function writeCaptureManifest(db: DatabaseSync, capture: Record<string, z.infer<typeof CompactCountrySchema>>, repositoryPath: string, stamp: string): Promise<string | null> {
  const tasks = db.prepare(`SELECT i.sourceKey, i.itemKey, s.metadataJson FROM UpdateItem i JOIN UpdateSource s ON s.sourceKey = i.sourceKey
    WHERE i.sourceKey LIKE 'elections:%' AND i.task = 'capture' AND i.state = 'needs_review'`).all() as Row[];
  const byLeague = new Map(tasks.map(task => [Number(String(task.sourceKey).split(':')[1]), task]));
  const covered = Object.entries(capture).filter(([leagueId]) => byLeague.has(Number(leagueId)));
  if (!covered.length) return null;
  await mkdir(join(repositoryPath, CAPTURE_DIRECTORY), { recursive: true });
  const artifactPath = `${CAPTURE_DIRECTORY}/elections-${stamp}.jsonl`;
  const body = covered.map(([leagueId, country]) => JSON.stringify({ leagueId: Number(leagueId),
    sourceURL: JSON.parse(String(byLeague.get(Number(leagueId))!.metadataJson)).sourceUrl, ...country })).join('\n') + '\n';
  await writeFile(join(repositoryPath, artifactPath), body, { flag: 'wx' });
  const artifact = { path: artifactPath, sha256: createHash('sha256').update(body).digest('hex'), bytes: Buffer.byteLength(body) };
  const assertions = covered.map(([leagueId, country]) => {
    const task = byLeague.get(Number(leagueId))!;
    return { sourceKey: String(task.sourceKey), itemKey: String(task.itemKey), sourceUrl: JSON.parse(String(task.metadataJson)).sourceUrl,
      capturedAt: new Date(country.t).toISOString(), complete: true as const, artifactPaths: [artifactPath] };
  });
  const latest = assertions.reduce((max, assertion) => (assertion.capturedAt > max ? assertion.capturedAt : max), '');
  const manifest = { schemaVersion: 1, kind: 'assisted-source-capture', generatedAt: new Date(Math.max(Date.now(), Date.parse(latest))).toISOString(),
    tool: { name: 'elections-capture', version: '1.0.0' }, artifacts: [artifact], assertions };
  const manifestPath = `${CAPTURE_DIRECTORY}/elections-${stamp}.manifest.json`;
  await writeFile(join(repositoryPath, manifestPath), `${JSON.stringify(manifest, null, 1)}\n`, { flag: 'wx' });
  return manifestPath;
}
