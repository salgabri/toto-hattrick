import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { env, childEnvironment, useUpdateDatabase } from '../config/env.js';
import { configureChppRuntime } from '../chpp/client.js';
import { bootstrapEvidence, captureEvidence, configureEvidenceStore, evidenceReferences, hasDedicatedEvidenceCapture } from './evidence.js';
import { BHUTAN_HISTORY_PATH, ETHIOPIA_HISTORY_PATH, GIBRALTAR_HISTORY_PATH, HAITI_HISTORY_PATH,
  replayRetainedBulkClubHistories, replayRetainedClubHistories, replayRetainedHroProfile,
  retainCheckedInBulkClubHistory, retainCheckedInClubHistory, retainCheckedInHroProfile } from './historicalReplay.js';
import { LocalObjectStore, S3ObjectStore, jsonBytes, type ObjectStore } from './storage.js';
import { readStatePointer, restoreSnapshot, saveSnapshot, snapshotDatabase, assertArchivePreserved } from './snapshots.js';
import { acquireLease } from './lease.js';
import { saveArtifact, restoreArtifact, readArtifactPointer, type ArtifactPointer } from './artifacts.js';
import { prepareRelease, validateRelease, type ReleaseManifest, type ReleaseSource } from './release.js';
import type { ScheduledRefreshResult } from './refresh.js';
import { newAttributionReviews } from './attributionReview.js';
import { revision as resolveRevision } from './revision.js';

export const repositoryPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const serverPath = join(repositoryPath, 'server');
const tokenSchema = z.object({ token: z.string().min(1), tokenSecret: z.string().min(1) });

async function authorizedToken() {
  try {
    if (Boolean(env.CHPP_ACCESS_TOKEN) !== Boolean(env.CHPP_ACCESS_TOKEN_SECRET)) throw new Error('incomplete token pair');
    return tokenSchema.parse(env.CHPP_ACCESS_TOKEN && env.CHPP_ACCESS_TOKEN_SECRET
      ? { token: env.CHPP_ACCESS_TOKEN, tokenSecret: env.CHPP_ACCESS_TOKEN_SECRET }
      : JSON.parse(await readFile(resolve(serverPath, env.OAUTH_ACCESS_STASH), 'utf8')));
  } catch {
    // JSON.parse error messages can quote the offending secret-containing stash content.
    throw new Error('Missing or invalid CHPP access credentials; configure the token pair or authorized OAuth stash');
  }
}

export function configuredStore(): ObjectStore {
  if (env.UPDATE_STATE_BUCKET && env.UPDATE_STORE_DIR) throw new Error('Choose one archive store: local directory OR S3 bucket');
  if (env.UPDATE_STATE_BUCKET) return new S3ObjectStore({
    bucket: env.UPDATE_STATE_BUCKET, region: env.AWS_REGION, prefix: env.UPDATE_STATE_PREFIX,
    credentials: env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, sessionToken: env.AWS_SESSION_TOKEN } : undefined,
  });
  return new LocalObjectStore(resolve(serverPath, env.UPDATE_STORE_DIR ?? '../.update-store'));
}
function databasePath() {
  if (!env.DATABASE_URL.startsWith('file:') || env.DATABASE_URL.includes('?')) throw new Error('Archive bootstrap requires a local SQLite DATABASE_URL');
  return resolve(serverPath, 'prisma', env.DATABASE_URL.slice(5));
}
function revision() { return resolveRevision(repositoryPath, env.GITHUB_SHA); }
function assertRevision(expected: string, operation: string) {
  if (revision() !== expected) throw new Error(`Working tree changed during ${operation}`);
}
async function workspace() {
  const root = resolve(serverPath, env.UPDATE_WORK_DIR);
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, 'run-'));
}
async function runNode(script: string, args: string[], cwd: string, overrides: Record<string, string> = {}) {
  await new Promise<void>((done, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, env: childEnvironment(overrides), stdio: 'inherit', windowsHide: true, timeout: 180_000 });
    child.on('error', () => reject(new Error('Could not start update build/migration subprocess')));
    child.on('exit', (code) => code === 0 ? done() : reject(new Error('Update build/migration subprocess failed')));
  });
}
function sources(report: ScheduledRefreshResult): ReleaseSource[] {
  const failed = new Set(report.issues.map(issue => issue.sourceKey));
  return report.sources.map(source => ({ key: source.sourceKey, label: source.label,
    lastSuccessfulCheck: source.lastSuccessAt, pending: source.totalOpen,
    status: failed.has(source.sourceKey) ? 'failed' : source.totalOpen > 0 ? 'pending' : 'ok' }));
}
/** Do not serialize arbitrary network errors, which can include signed query strings. */
export function safeFailure(error: unknown): string {
  let message = error instanceof Error ? error.message : 'Update failed';
  for (const secret of [env.CHPP_CONSUMER_KEY, env.CHPP_CONSUMER_SECRET, env.CHPP_ACCESS_TOKEN, env.CHPP_ACCESS_TOKEN_SECRET, env.NETLIFY_AUTH_TOKEN, env.VERCEL_TOKEN, env.VERCEL_PROTECTION_BYPASS, env.AWS_SECRET_ACCESS_KEY, env.AWS_SESSION_TOKEN, env.UPDATE_HEARTBEAT_URL]) {
    if (secret) message = message.split(secret).join('[redacted]');
  }
  return message.replace(/https?:\/\/\S*oauth_\S*/gi, '[redacted signed URL]').slice(0, 1000);
}
async function summary(value: Record<string, unknown>) {
  const output = JSON.stringify(value, null, 2);
  console.log(output);
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `### Archive update\n\n\`\`\`json\n${output}\n\`\`\`\n`);
}

export async function planUpdate() {
  const store = configuredStore();
  const state = await readStatePointer(store);
  const published = await readArtifactPointer(store, 'releases/current.json');
  const pending = await readArtifactPointer(store, 'releases/pending.json');
  const required = env.UPDATE_DEPLOY_PROVIDER === 'vercel' ? ['VERCEL_PROJECT_ID', 'VERCEL_TOKEN', 'UPDATE_PUBLIC_URL'] as const
    : env.UPDATE_DEPLOY_PROVIDER === 'netlify' ? ['NETLIFY_SITE_ID', 'NETLIFY_AUTH_TOKEN', 'UPDATE_PUBLIC_URL'] as const : ['UPDATE_DEPLOY_PROVIDER'] as const;
  const missingDeploymentSettings = required.filter(key => key === 'UPDATE_DEPLOY_PROVIDER' || !env[key]);
  await summary({ storage: env.UPDATE_STATE_BUCKET ? 'private S3' : 'local disk', initialized: !!state,
    acceptedSnapshot: state?.pointer.snapshotId ?? null, publishedRelease: published?.pointer.releaseId ?? null,
    pendingRelease: pending?.pointer.releaseId ?? null, deploymentProvider: env.UPDATE_DEPLOY_PROVIDER,
    productionDeploymentConfigured: missingDeploymentSettings.length === 0, missingDeploymentSettings,
    automationApproved: env.UPDATE_CHPP_AUTOMATION_APPROVED === 'true',
    schedule: 'Weekly on Monday at 07:17 local time; local scheduling is opt-in',
    requestBudget: env.UPDATE_MAX_CALLS, minutes: env.UPDATE_MAX_MINUTES });
}

/** One-time import of the real archive, never a JSON reconstruction. Source DB remains untouched. */
export async function bootstrapArchive() {
  const store = configuredStore();
  const lease = await acquireLease(store);
  try {
    const codeRevision = revision();
    if (await readStatePointer(store)) throw new Error('Archive already initialized; bootstrap will not overwrite it');
    const dir = await workspace();
    const copy = join(dir, 'bootstrap.db');
    await snapshotDatabase(databasePath(), copy);
    const evidence = await bootstrapEvidence({ store, repositoryPath });
    // Capture the shipped baseline ONCE. Later code checkouts must never lower the data floor.
    const baselineDir = join(dir, 'baseline');
    await validateRelease(join(repositoryPath, 'web/public/data'));
    await cp(join(repositoryPath, 'web/public/data'), join(baselineDir, 'data'), { recursive: true });
    await lease.assertHeld();
    assertRevision(codeRevision, 'archive bootstrap');
    const baseline = await saveArtifact(store, baselineDir, { releaseId: `baseline-${randomUUID()}`, snapshotId: 'bootstrap', dataVersion: 'legacy', codeRevision });
    const previousBaseline = await readArtifactPointer(store, 'releases/baseline.json');
    await lease.assertHeld();
    assertRevision(codeRevision, 'archive bootstrap');
    await store.compareAndSwap('releases/baseline.json', jsonBytes(baseline), previousBaseline?.etag ?? null);
    await lease.assertHeld();
    assertRevision(codeRevision, 'archive bootstrap');
    const state = await saveSnapshot({ store, databasePath: copy, evidenceRefs: evidence, runId: randomUUID(), codeRevision, expectedStateEtag: null });
    await summary({ status: 'initialized', snapshotId: state.pointer.snapshotId, evidenceFiles: evidence.length, sourceDatabaseUnchanged: true, published: false });
  } finally { await lease.release(); }
}

async function previousRelease(store: ObjectStore, directory: string) {
  const published = await readArtifactPointer(store, 'releases/current.json');
  const pointer = published ?? await readArtifactPointer(store, 'releases/baseline.json');
  if (!pointer) throw new Error('Published baseline is missing; repair private storage before continuing');
  await restoreArtifact(store, pointer.pointer, directory);
  return { published, dataDir: join(directory, 'data') };
}

async function publishArtifact(store: ObjectStore, pointer: ArtifactPointer, artifactDir: string, publish: boolean, assertLease: () => Promise<void>) {
  if (env.UPDATE_DEPLOY_PROVIDER === 'none') throw new Error('Set UPDATE_DEPLOY_PROVIDER and site credentials before deploying');
  const manifest = JSON.parse(await readFile(join(artifactDir, 'data/manifest.json'), 'utf8')) as ReleaseManifest;
  await validateRelease(join(artifactDir, 'data'));
  const { deployRelease } = await import('./deploy.js');
  const receiptKey = `releases/deployments/${pointer.releaseId}.json`;
  const existing = await store.get(receiptKey);
  const deployment = existing ? z.object({ deployId: z.string(), provider: z.string() }).parse(JSON.parse(existing.body.toString())) : null;
  if (deployment && deployment.provider !== env.UPDATE_DEPLOY_PROVIDER) throw new Error('Pending deployment belongs to a different provider');
  const current = await readArtifactPointer(store, 'releases/current.json');
  await assertLease();
  const result = await deployRelease({
    provider: env.UPDATE_DEPLOY_PROVIDER, artifactDir, manifest, netlifySiteId: env.NETLIFY_SITE_ID,
    netlifyAuthToken: env.NETLIFY_AUTH_TOKEN, publicUrl: env.UPDATE_PUBLIC_URL, publish,
    vercelProjectId: env.VERCEL_PROJECT_ID, vercelTeamId: env.VERCEL_TEAM_ID,
    vercelToken: env.VERCEL_TOKEN, vercelProtectionBypass: env.VERCEL_PROTECTION_BYPASS,
    existingDeployId: deployment?.deployId,
    onBeforePublish: assertLease,
    onDraftCreated: async (deployId) => { await store.compareAndSwap(receiptKey, jsonBytes({ deployId, provider: env.UPDATE_DEPLOY_PROVIDER }), existing?.etag ?? null); },
  });
  if (result.published) {
    await assertLease();
    await store.compareAndSwap('releases/current.json', jsonBytes({ ...pointer, publishedAt: result.verifiedAt, deploymentId: result.deployId, url: result.url }), current?.etag ?? null);
  }
  return result;
}

export async function runUpdate(options: { noFetch?: boolean; publish?: boolean; draft?: boolean } = {}) {
  if (options.publish || options.draft) {
    const configured = env.UPDATE_DEPLOY_PROVIDER === 'netlify' ? env.NETLIFY_SITE_ID && env.NETLIFY_AUTH_TOKEN
      : env.UPDATE_DEPLOY_PROVIDER === 'vercel' ? env.VERCEL_PROJECT_ID && env.VERCEL_TOKEN : false;
    if (!configured || (options.publish && !env.UPDATE_PUBLIC_URL))
      throw new Error('Configure the selected deployment provider, its project/site ID and token, and UPDATE_PUBLIC_URL for production; omit --publish/--draft for local preparation');
  }
  if (!options.noFetch && env.UPDATE_CHPP_AUTOMATION_APPROVED !== 'true') throw new Error('Confirm your CHPP application permits unattended XML calls, then set UPDATE_CHPP_AUTOMATION_APPROVED=true');
  const codeRevision = revision();
  const token = options.noFetch ? undefined : await authorizedToken();
  const store = configuredStore();
  const lease = await acquireLease(store);
  const runId = randomUUID();
  let disconnect: (() => Promise<void>) | undefined;
  let disposeEvidence: (() => void) | undefined;
  let runtime: ReturnType<typeof configureChppRuntime> | undefined;
  try {
    const dir = await workspace();
    const state = await readStatePointer(store);
    if (!state) throw new Error('Archive not initialized. Run update:bootstrap once against your real database');
    const beforePath = join(dir, 'before.db');
    const snapshot = await restoreSnapshot(store, state.pointer, beforePath);
    const workingPath = join(dir, 'working.db');
    await snapshotDatabase(beforePath, workingPath);
    const databaseUrl = `file:${workingPath.replaceAll('\\', '/')}`;
    useUpdateDatabase(databaseUrl);
    await runNode(join(repositoryPath, 'node_modules/prisma/build/index.js'), ['migrate', 'deploy'], serverPath, { DATABASE_URL: databaseUrl });
    const { prisma } = await import('../db/client.js');
    disconnect = () => prisma.$disconnect();
    const { bakeStatic } = await import('../sync/bake.js');
    const { reportScheduled, refreshScheduled } = await import('./refresh.js');
    const acceptedData = join(dir, 'accepted-data');
    await bakeStatic(acceptedData);
    const previous = await previousRelease(store, join(dir, 'previous-release'));
    disposeEvidence = configureEvidenceStore({ store, workspacePath: dir, references: snapshot.evidence });
    await retainCheckedInClubHistory(store, repositoryPath);
    await retainCheckedInClubHistory(store, repositoryPath, ETHIOPIA_HISTORY_PATH);
    await retainCheckedInClubHistory(store, repositoryPath, BHUTAN_HISTORY_PATH);
    await retainCheckedInClubHistory(store, repositoryPath, GIBRALTAR_HISTORY_PATH);
    await retainCheckedInClubHistory(store, repositoryPath, HAITI_HISTORY_PATH);
    await retainCheckedInBulkClubHistory(store, repositoryPath);
    await retainCheckedInHroProfile(store, repositoryPath);
    const beforeRefresh = await reportScheduled();
    runtime = configureChppRuntime({ maxCalls: env.UPDATE_MAX_CALLS, maxRetries: 2, pacingMs: 600,
      deadline: Date.now() + env.UPDATE_MAX_MINUTES * 60_000,
      onResponse: async (params, xml, call) => {
        await lease.assertHeld();
        if (hasDedicatedEvidenceCapture(params)) return;
        await captureEvidence({ store, key: `evidence/runs/${runId}/${call}.json`, source: params.file, apiVersion: params.version, parserVersion: 'raw-xml-v1', payload: { params, xml } });
      },
    });
    const acquisition = token ? await refreshScheduled(token, { maxItems: env.UPDATE_MAX_ITEMS,
      maxMetadataChecks: env.UPDATE_MAX_CALLS === 0 ? 0 : Math.max(1, Math.floor(env.UPDATE_MAX_CALLS / 3)),
    }) : await reportScheduled();
    const clubHistoryReplay = await replayRetainedClubHistories(store, evidenceReferences());
    const bulkClubHistoryReplay = await replayRetainedBulkClubHistories(store, evidenceReferences());
    const managerProfileReplay = await replayRetainedHroProfile(store, evidenceReferences());
    const historicalEvidenceReplay = { ...clubHistoryReplay, bulkClubHistoryReplay, managerProfileReplay };
    // A linked history can predate the winner row first discovered above. Re-read the ledger
    // after replay so completed attribution tasks do not appear as unresolved in this release.
    const afterReplay = await reportScheduled();
    const newManagerReviews = newAttributionReviews(beforeRefresh.pendingEvidence, afterReplay.pendingEvidence);
    const issues = [...new Map([...acquisition.issues, ...afterReplay.issues].map(issue =>
      [`${issue.sourceKey}/${issue.edition ?? ''}/${issue.category}`, issue])).values()];
    const report: ScheduledRefreshResult = { ...afterReplay, issues,
      status: issues.length ? 'degraded' : 'success',
      counts: { ...acquisition.counts, pendingItems: afterReplay.counts.pendingItems,
        pendingEvidence: afterReplay.counts.pendingEvidence } };
    assertArchivePreserved(beforePath, workingPath);
    await lease.assertHeld();
    assertRevision(codeRevision, 'update; accepted progress was not saved');
    // Checkpoint valid ingestion independently of the frontend build/deployment. Publication
    // failure must not lose edition tasks or make the next run re-acquire accepted results.
    const accepted = await saveSnapshot({ store, databasePath: workingPath, previousDatabasePath: beforePath, evidenceRefs: evidenceReferences(), runId, codeRevision, expectedStateEtag: state.etag });
    const candidateDir = join(dir, 'candidate-data');
    await bakeStatic(candidateDir);
    await validateRelease(candidateDir, acceptedData);
    const packagedData = join(dir, 'packaged-data');
    const release = await prepareRelease({ candidateDir, outputDataDir: packagedData, previousDataDir: previous.dataDir, codeRevision, sources: sources(report) });
    const recentManagerAttribution = release.validation.recentManagerCoverage;
    const reasons: string[] = [];
    if (!recentManagerAttribution.complete) reasons.push('recent champion manager attribution is incomplete');
    if (report.counts.pendingItems > 0) reasons.push('result checks remain queued');
    if (report.counts.pendingEvidence > 0) reasons.push('evidence reviews remain queued');
    if (report.issues.length > 0) reasons.push('source checks reported issues');
    if (report.sources.length === 0) reasons.push('no competition sources have been registered');
    const coverage = { complete: reasons.length === 0, reasons, recentManagerAttribution };
    const status = coverage.complete ? 'success' : 'degraded';
    await store.putImmutable(`runs/${runId}/report.json`, jsonBytes({ ...report, acquisitionStatus: report.status,
      status, coverage, newManagerReviews, historicalEvidenceReplay, calls: runtime.stats(), snapshotId: accepted.pointer.snapshotId }));
    await writeFile(join(dir, 'pending-evidence.json'), JSON.stringify(report.pendingEvidence, null, 2));
    await writeFile(join(dir, 'new-manager-reviews.json'), JSON.stringify(newManagerReviews, null, 2));
    // Build in a new directory with Vite public copying DISABLED. Only the validated data goes in.
    const artifactDir = join(dir, 'site');
    await runNode(join(repositoryPath, 'node_modules/vite/bin/vite.js'), ['build', '--config', 'vite.update.config.ts', '--outDir', artifactDir, '--emptyOutDir'], join(repositoryPath, 'web'));
    for (const entry of await readdir(join(repositoryPath, 'web/public'), { withFileTypes: true })) {
      if (entry.name === 'data') continue;
      if (entry.isSymbolicLink()) throw new Error('Public assets must not be symbolic links');
      await cp(join(repositoryPath, 'web/public', entry.name), join(artifactDir, entry.name), { recursive: true });
    }
    await cp(packagedData, join(artifactDir, 'data'), { recursive: true });
    // Keep the prior generation available to already-open browser sessions.
    try {
      const prior = JSON.parse(await readFile(join(previous.dataDir, 'manifest.json'), 'utf8')) as ReleaseManifest;
      if (prior.dataVersion !== release.dataVersion) await cp(join(previous.dataDir, 'versions', prior.dataVersion), join(artifactDir, 'data/versions', prior.dataVersion), { recursive: true });
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    assertRevision(codeRevision, 'update; release preparation stopped');
    const pointer = await saveArtifact(store, artifactDir, { releaseId: runId, snapshotId: accepted.pointer.snapshotId, dataVersion: release.dataVersion, codeRevision });
    const pending = await readArtifactPointer(store, 'releases/pending.json');
    await lease.assertHeld();
    assertRevision(codeRevision, 'update; pending release was not advanced');
    await store.compareAndSwap('releases/pending.json', jsonBytes(pointer), pending?.etag ?? null);
    const authenticationFailed = report.issues.some(issue => ['authentication', 'forbidden'].includes(issue.category));
    const deployment = (options.publish || options.draft) && !authenticationFailed
      ? await publishArtifact(store, pointer, artifactDir, !!options.publish, lease.assertHeld) : undefined;
    const result = { status, acquisitionStatus: report.status, coverage, releaseId: runId, dataVersion: release.dataVersion,
      published: deployment?.published ?? false, artifactDir, counts: report.counts,
      newManagerReviews: newManagerReviews.length,
      historicalEvidenceReplay, requests: runtime.stats(),
      pendingEvidenceFile: join(dir, 'pending-evidence.json'), newManagerReviewsFile: join(dir, 'new-manager-reviews.json'),
      ...(deployment ? { deploymentUrl: deployment.url } : {}) };
    await store.putImmutable(`runs/${runId}/result.json`, jsonBytes(result));
    await summary(result);
    if (authenticationFailed) throw new Error('CHPP authorization failed; valid progress retained, publication stopped');
    if (env.UPDATE_HEARTBEAT_URL) {
      const heartbeat = await fetch(env.UPDATE_HEARTBEAT_URL, { method: 'GET', signal: AbortSignal.timeout(10_000) });
      if (!heartbeat.ok) throw new Error('Update completed but external heartbeat failed');
    }
    return result;
  } catch (error) {
    await store.putImmutable(`runs/${runId}/failure.json`, jsonBytes({ runId, failedAt: new Date().toISOString(), message: safeFailure(error) })).catch(() => undefined);
    throw error;
  } finally {
    runtime?.dispose(); disposeEvidence?.(); await disconnect?.(); await lease.release();
  }
}

/** Retry the identical stored build, without querying CHPP or rebuilding from a new checkout. */
export async function publishPending(publish = false) {
  const store = configuredStore();
  const lease = await acquireLease(store);
  try {
    const pending = await readArtifactPointer(store, 'releases/pending.json');
    if (!pending) throw new Error('There is no prepared release to deploy');
    const dir = await workspace();
    const artifactDir = join(dir, 'site');
    await restoreArtifact(store, pending.pointer, artifactDir);
    const previous = await previousRelease(store, join(dir, 'previous-release'));
    await validateRelease(join(artifactDir, 'data'), previous.dataDir);
    const result = await publishArtifact(store, pending.pointer, artifactDir, publish, lease.assertHeld);
    await summary({ ...result, refetched: 0, rebuilt: false });
    return result;
  } finally { await lease.release(); }
}
