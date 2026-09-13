import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { prisma } from '../db/client.js';
import { configureChppRuntime } from '../chpp/client.js';
import { loadCupFinalMatch, loadPreviousCupRound } from '../sync/cupFinals.js';
import { bootstrapEvidence, captureEvidence, configureEvidenceStore, discoverBootstrapEvidence, evidenceReferences, hasDedicatedEvidenceCapture, matchEvidenceKey, readEvidence, roundEvidenceKey } from './evidence.js';
import { LocalObjectStore, StorageUnavailableError, type ObjectStore } from './storage.js';

const token = { token: 'fixture', tokenSecret: 'fixture' };
function mock(t: TestContext, target: object, method: string, implementation: (...args: any[]) => any) {
  const object = target as Record<string, unknown>; const original = object[method]; object[method] = implementation;
  t.after(() => { object[method] = original; });
}
function absentDatabase(t: TestContext) {
  mock(t, prisma.match, 'findUnique', async () => null);
  mock(t, prisma.matchDetail, 'findUnique', async () => null);
  mock(t, prisma.cupChampion, 'findFirst', async () => null);
}
const sampleXml = () => readFile(new URL('../../samples/cup-final-771464494-3.0.xml', import.meta.url), 'utf8');

test('a crash after durable match capture replays in a fresh workspace without any database or network lookup', async t => {
  const root = await mkdtemp(join(tmpdir(), 'archive-evidence-replay-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new LocalObjectStore(join(root, 'private'));
  const raw = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false }).parse(await sampleXml());
  // Simulate process A receiving and saving the capture but dying before any DB snapshot.
  await captureEvidence({ store, key: matchEvidenceKey(771464494), source: 'matchdetails', apiVersion: '3.0', parserVersion: 'v1', payload: raw });
  const reset = configureEvidenceStore({ store, workspacePath: join(root, 'new-runner') });
  t.after(reset);
  mock(t, prisma.match, 'findUnique', async () => { throw new Error('Must replay before DB lookup'); });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Durable match must not be fetched'); });
  const loaded = await loadCupFinalMatch(token, 771464494);
  assert.equal(loaded.match?.matchId, 771464494);
  assert.equal(loaded.fetched, false);
  assert.equal(evidenceReferences()[0]?.key, matchEvidenceKey(771464494));
});

test('malformed retained match and preceding-round captures are review items, never re-fetches', async t => {
  const root = await mkdtemp(join(tmpdir(), 'archive-evidence-invalid-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new LocalObjectStore(join(root, 'private'));
  await store.putImmutable(matchEvidenceKey(771464494), Buffer.from('corrupted envelope'));
  await captureEvidence({ store, key: roundEvidenceKey(183, 95, 2), source: 'cupmatches', apiVersion: '1.2', parserVersion: 'v1', payload: { unexpected: 'schema' } });
  const reset = configureEvidenceStore({ store, workspacePath: join(root, 'runner') }); t.after(reset);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Retained request must not be repeated'); });
  assert.match((await loadCupFinalMatch(token, 771464494)).reason!, /no re-fetch/);
  const round = await loadPreviousCupRound(token, { cupId: 183, season: 95, round: 3, matchId: 771464494, homeTeamName: 'a', awayTeamName: 'b', homeGoals: 1, awayGoals: 0 });
  assert.equal(round.fetched, false);
  assert.match(round.reason!, /no re-fetch/);
});

test('new final is saved remotely before returned facts; failed durable writes stop acquisition', async t => {
  const root = await mkdtemp(join(tmpdir(), 'archive-evidence-fetch-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  absentDatabase(t);
  const xml = await sampleXml();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(xml); });
  const store = new LocalObjectStore(join(root, 'private'));
  const runtime = configureChppRuntime({ maxCalls: 10, pacingMs: 0, onResponse: async (params, xml, call) => {
    if (hasDedicatedEvidenceCapture(params)) return;
    await captureEvidence({ store, key: `evidence/runs/test/${call}.json`, source: params.file, parserVersion: 'raw-test', payload: { params, xml } });
  } });
  t.after(runtime.dispose);
  let reset = configureEvidenceStore({ store, workspacePath: join(root, 'first-runner') });
  try {
    const first = await loadCupFinalMatch(token, 771464494);
    assert.equal(first.match?.matchId, 771464494);
    assert.equal(first.fetched, true);
    assert.ok(await readEvidence(store, matchEvidenceKey(771464494)));
    assert.deepEqual(evidenceReferences().map(reference => reference.key), [matchEvidenceKey(771464494)], 'First durable match capture is discoverable without a prior snapshot or run-log scan');
  } finally { reset(); }
  reset = configureEvidenceStore({ store, workspacePath: join(root, 'second-runner') });
  try { assert.equal((await loadCupFinalMatch(token, 771464494)).fetched, false); } finally { reset(); }
  assert.equal(calls, 1);
  const unavailable: ObjectStore = { get: async () => null, putImmutable: async () => { throw new StorageUnavailableError(); }, compareAndSwap: async () => { throw new Error('unused'); } };
  reset = configureEvidenceStore({ store: unavailable, workspacePath: join(root, 'third-runner') });
  try { await assert.rejects(loadCupFinalMatch(token, 771464494), StorageUnavailableError); } finally { reset(); }
});

test('bootstrap imports only allowlisted evidence and makes legacy match requests discoverable', async t => {
  const root = await mkdtemp(join(tmpdir(), 'archive-evidence-bootstrap-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repositoryPath = join(root, 'repo');
  await mkdir(join(repositoryPath, 'server', 'samples'), { recursive: true });
  await mkdir(join(repositoryPath, '.scrape', 'cup-final-rounds'), { recursive: true });
  await writeFile(join(repositoryPath, 'server', '.oauth-access.json'), 'not imported');
  await writeFile(join(repositoryPath, 'server', 'samples', 'matchdetails-3.0-771464494.local.xml'), await sampleXml());
  await writeFile(join(repositoryPath, '.scrape', 'cup-final-rounds', '183-95-1.json'), JSON.stringify({ cupId: 183, season: 95, round: 1, matches: [] }));
  const files = await discoverBootstrapEvidence(repositoryPath);
  assert.equal(files.length, 2);
  assert.ok(files.every(path => !path.includes('oauth')));
  const store = new LocalObjectStore(join(root, 'private'));
  const refs = await bootstrapEvidence({ store, repositoryPath });
  assert.equal(refs.length, 4);
  assert.ok(await readEvidence(store, matchEvidenceKey(771464494)));
  assert.ok(await readEvidence(store, roundEvidenceKey(183, 95, 1)));
  assert.deepEqual(await bootstrapEvidence({ store, repositoryPath }), refs, 'Repeated bootstrap preserves original capture timestamps and hashes');
});

test('unfinished match observations remain eligible for a later completed capture', async t => {
  const root = await mkdtemp(join(tmpdir(), 'archive-evidence-pending-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  absentDatabase(t);
  const completed = await sampleXml();
  const raw = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false }).parse(completed);
  raw.HattrickData.Match.FinishedDate = '';
  const pending = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_' }).build(raw);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => new Response(++calls === 1 ? pending : completed));
  const store = new LocalObjectStore(join(root, 'private'));
  const reset = configureEvidenceStore({ store, workspacePath: join(root, 'runner') }); t.after(reset);
  assert.equal((await loadCupFinalMatch(token, 771464494)).pending, true);
  assert.equal(await store.get(matchEvidenceKey(771464494)), null, 'Only completed or invalid evidence reserves the permanent request key');
  assert.equal((await loadCupFinalMatch(token, 771464494)).match?.matchId, 771464494);
  assert.equal(calls, 2);
  assert.equal(evidenceReferences().length, 2, 'The interim observation remains retained alongside the finished match');
});
