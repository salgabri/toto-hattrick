import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import type { ChppCallParams } from '../chpp/client.js';
import { jsonBytes, sha256, validateObjectKey, type ObjectStore } from './storage.js';

export const EvidenceReferenceSchema = z.object({ key: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative() });
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;
const CaptureSchema = z.object({
  schemaVersion: z.literal(1), requestKey: z.string().min(1), source: z.string().min(1),
  apiVersion: z.string().nullable(), capturedAt: z.string().datetime(), parserVersion: z.string().min(1),
  payloadSha256: z.string().regex(/^[a-f0-9]{64}$/), payload: z.unknown(),
});
export type SourceCapture = z.infer<typeof CaptureSchema>;
export interface EvidenceConfiguration { store: ObjectStore; workspacePath: string; references?: readonly EvidenceReference[] }
let configured: (EvidenceConfiguration & { referencesByKey: Map<string, EvidenceReference> }) | undefined;
export class InvalidEvidenceError extends Error {
  constructor() { super('Retained evidence cannot be validated; operator review required, no re-fetch'); this.name = 'InvalidEvidenceError'; }
}
export function configureEvidenceStore(configuration: EvidenceConfiguration): () => void {
  if (configured) throw new Error('An evidence store is already configured for this process');
  configured = { ...configuration, workspacePath: resolve(configuration.workspacePath), referencesByKey: new Map(configuration.references?.map(ref => [ref.key, ref])) };
  return () => { configured = undefined; };
}
export function evidenceConfiguration() { return configured; }
export function evidenceReferences(): EvidenceReference[] { return [...(configured?.referencesByKey.values() ?? [])].sort((a, b) => a.key.localeCompare(b.key)); }
export const matchEvidenceKey = (matchId: number) => `evidence/chpp/matchdetails/3.0/${positive(matchId)}/events.json`;
export const roundEvidenceKey = (cupId: number, season: number, round: number) => `evidence/chpp/cupmatches/1.2/${positive(cupId)}/${positive(season)}/${positive(round)}.json`;
export const observationEvidenceKey = (requestKey: string) => `${validateObjectKey(requestKey).replace(/^evidence\/chpp\//, 'evidence/observations/').replace(/\.json$/, '')}/${randomUUID()}.json`;
export const importedEvidenceKey = (relativePath: string, body: Buffer) =>
  `evidence/imports/${sha256(body)}/${sha256(relativePath)}.json`;
/** cupFinals owns the first durable write for these requests. Its immutable request key must
 * exist before a generic per-run log records the response, otherwise a restart could find the
 * audit log only by listing old runs and inadvertently fetch an already retained match again. */
export function hasDedicatedEvidenceCapture(params: ChppCallParams): boolean {
  return params.file === 'matchdetails' || (params.file === 'cupmatches' && params.cupRound !== undefined);
}
function positive(value: number) { if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid evidence request identity'); return value; }

export async function readEvidence(store: ObjectStore, key: string): Promise<{ capture: SourceCapture; reference: EvidenceReference } | null> {
  const object = await store.get(validateObjectKey(key));
  if (!object) {
    if (configured?.store === store && configured.referencesByKey.has(key)) throw new InvalidEvidenceError();
    return null;
  }
  try {
    const expected = configured?.store === store ? configured.referencesByKey.get(key) : undefined;
    if (expected && (sha256(object.body) !== expected.sha256 || object.body.length !== expected.bytes)) throw new InvalidEvidenceError();
    const capture = CaptureSchema.parse(JSON.parse(object.body.toString('utf8')));
    if (capture.requestKey !== key || sha256(jsonBytes(capture.payload)) !== capture.payloadSha256) throw new InvalidEvidenceError();
    const reference = { key, sha256: sha256(object.body), bytes: object.body.length };
    if (configured?.store === store) configured.referencesByKey.set(key, reference);
    return { capture, reference };
  } catch { throw new InvalidEvidenceError(); }
}
export async function captureEvidence(options: {
  store: ObjectStore; key: string; source: string; apiVersion?: string; parserVersion: string; payload: unknown; capturedAt?: string;
}): Promise<EvidenceReference> {
  const retained = await readEvidence(options.store, options.key);
  if (retained) {
    if (retained.capture.payloadSha256 !== sha256(jsonBytes(options.payload))) throw new InvalidEvidenceError();
    return retained.reference;
  }
  const capture: SourceCapture = {
    schemaVersion: 1, requestKey: validateObjectKey(options.key), source: options.source, apiVersion: options.apiVersion ?? null,
    capturedAt: options.capturedAt ?? new Date().toISOString(), parserVersion: options.parserVersion,
    payloadSha256: sha256(jsonBytes(options.payload)), payload: options.payload,
  };
  const body = jsonBytes(capture);
  await options.store.putImmutable(options.key, body);
  const reference = { key: options.key, sha256: sha256(body), bytes: body.length };
  if (configured?.store === options.store) configured.referencesByKey.set(options.key, reference);
  return reference;
}

/** Enumerated source directories only. Never import a checkout, .env, credentials, scripts,
 * browser profiles, or a whole .scrape tree into state by accident. Symlinks are excluded. */
const evidenceRoots = [
  '.scrape/cup-final-details', '.scrape/cup-final-rounds', '.scrape/cup-final-recovery',
  '.scrape/winner-recovery', '.scrape/national-winner-recovery', '.scrape/review-captures',
  'server/src/data', 'server/samples',
] as const;
const evidenceFiles = ['.scrape/elections.jsonl', '.scrape/elections-unresolved.json'] as const;
export async function discoverBootstrapEvidence(repositoryPath: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(relative: string): Promise<void> {
    const path = resolve(repositoryPath, relative);
    const info = await lstat(path).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; });
    if (!info || info.isSymbolicLink()) return;
    if (info.isDirectory()) { for (const entry of await readdir(path)) await walk(`${relative}/${entry}`); }
    else if (info.isFile() && /\.(json|jsonl|xml|html|txt)$/i.test(relative)) files.push(relative);
  }
  for (const root of [...evidenceRoots, ...evidenceFiles]) await walk(root);
  return files.sort();
}
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: true });
/** Bootstrap originals as content-addressed captures, plus deterministic request captures for
 * legacy match/round caches. This is read-only with respect to the source checkout. */
export async function bootstrapEvidence(options: { store: ObjectStore; repositoryPath: string }): Promise<EvidenceReference[]> {
  const references = new Map<string, EvidenceReference>();
  async function retain(key: string, payload: unknown, source: string, apiVersion?: string) {
    const ref = await captureEvidence({ store: options.store, key, payload, source, apiVersion, parserVersion: 'legacy-import-v1' });
    references.set(ref.key, ref);
  }
  for (const relative of await discoverBootstrapEvidence(options.repositoryPath)) {
    const body = await readFile(resolve(options.repositoryPath, relative));
    await retain(importedEvidenceKey(relative, body), { path: relative, encoding: 'base64', contents: body.toString('base64') }, relative);
    const match = /^\.scrape\/cup-final-details\/(\d+)\.json$/.exec(relative);
    const round = /^\.scrape\/cup-final-rounds\/(\d+)-(\d+)-(\d+)\.json$/.exec(relative);
    const sample = /^server\/samples\/matchdetails-3\.0-(\d+)\.local\.xml$/.exec(relative);
    // Even malformed retained cache content must occupy its deterministic request key. The
    // next source check will report review rather than fetch that match again.
    if (match) {
      let payload: unknown; try { payload = JSON.parse(body.toString('utf8')); } catch { payload = body.toString('utf8'); }
      await retain(matchEvidenceKey(Number(match[1])), payload, 'matchdetails', '3.0');
    } else if (round) {
      let payload: unknown; try { payload = JSON.parse(body.toString('utf8')); } catch { payload = body.toString('utf8'); }
      await retain(roundEvidenceKey(Number(round[1]), Number(round[2]), Number(round[3])), payload, 'cupmatches', '1.2');
    } else if (sample) {
      const key = matchEvidenceKey(Number(sample[1]));
      const existing = await readEvidence(options.store, key);
      if (existing) references.set(key, existing.reference);
      else {
        let payload: unknown; try { payload = xml.parse(body.toString('utf8')); } catch { payload = body.toString('utf8'); }
        await retain(key, payload, 'matchdetails', '3.0');
      }
    }
  }
  const recovered = resolve(options.repositoryPath, 'server/src/data/recovered-cup-final-evidence.json');
  if (existsSync(recovered)) {
    const data = JSON.parse(readFileSync(recovered, 'utf8')) as { entries: Array<{ summary: { matchId: number }; rawMatch: unknown; previous?: { cupId: number; season: number; round: number } }> };
    for (const entry of data.entries) {
      const key = matchEvidenceKey(entry.summary.matchId);
      const existing = await readEvidence(options.store, key);
      if (existing) references.set(key, existing.reference); else await retain(key, entry.rawMatch, 'matchdetails', '3.0');
      if (entry.previous) {
        const roundKey = roundEvidenceKey(entry.previous.cupId, entry.previous.season, entry.previous.round);
        const previous = await readEvidence(options.store, roundKey);
        if (previous) references.set(roundKey, previous.reference); else await retain(roundKey, entry.previous, 'cupmatches', '1.2');
      }
    }
  }
  return [...references.values()].sort((a, b) => a.key.localeCompare(b.key));
}
