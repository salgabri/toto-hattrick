import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { buildSignedUrl, type TokenPair } from './auth.js';
import { env } from '../config/env.js';

/**
 * Signed CHPP data calls. Every endpoint is the same base URL with a `file` selector
 * and a pinned `version`. The browser never reaches this — backend only.
 */

const BASE_URL = 'https://chpp.hattrick.org/chppxml.ashx';

// Hard ceiling per request so a stalled connection can't hang an unattended multi-hour sync. On
// timeout fetch rejects, which callers treat as a normal call failure (and which trips the
// backfill's consecutive-failure abort) — a slow-but-alive throttled call still completes well
// under this.
const REQUEST_TIMEOUT_MS = 30_000;

export class ChppBudgetError extends Error {
  constructor() { super('CHPP request or time budget exhausted; remaining work stays queued'); this.name = 'ChppBudgetError'; }
}
export function isChppBudgetError(error: unknown): boolean {
  return error instanceof Error && error.name === 'ChppBudgetError';
}
export class ChppRequestError extends Error {
  constructor(public readonly category: 'authentication' | 'forbidden' | 'rate_limit' | 'server' | 'network' | 'invalid_response' | 'request', public readonly status?: number) {
    super(`CHPP request failed: ${category}${status === undefined ? '' : ` (${status})`}`);
    this.name = 'ChppRequestError';
  }
}
export interface ChppRuntimeOptions {
  maxCalls: number; pacingMs?: number; maxRetries?: number; deadline?: number; timeoutMs?: number;
  wait?: (ms: number) => Promise<void>; now?: () => number; random?: () => number;
  onResponse?: (params: ChppCallParams, xml: string, call: number) => Promise<void>;
}
type Runtime = ChppRuntimeOptions & { calls: number; retries: number; lastRequestAt?: number; stopped?: ChppRequestError };
let runtime: Runtime | undefined;
let queue: Promise<void> = Promise.resolve();
export function configureChppRuntime(options: ChppRuntimeOptions) {
  if (runtime) throw new Error('CHPP runtime is already configured');
  if (!Number.isSafeInteger(options.maxCalls) || options.maxCalls < 0) throw new Error('Invalid CHPP request budget');
  const active: Runtime = { ...options, calls: 0, retries: 0 };
  runtime = active;
  return { stats: () => ({ calls: active.calls, retries: active.retries }), dispose: () => { if (runtime === active) runtime = undefined; } };
}
export function retryDelay(value: string | null, attempt: number, now: number, random = Math.random()): number {
  if (value !== null) {
    const seconds = Number(value);
    if (value.trim() && Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  return Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(random * 500);
}
function checkBudget(active: Runtime | undefined, delay = 0) {
  if (active?.stopped) throw active.stopped;
  if (active && (active.calls >= active.maxCalls || (active.deadline !== undefined && (active.now ?? Date.now)() + delay >= active.deadline))) throw new ChppBudgetError();
}
async function pause(active: Runtime | undefined, ms: number) {
  checkBudget(active, ms);
  if (ms > 0) await (active?.wait ?? ((delay: number) => new Promise<void>((resolve) => setTimeout(resolve, delay))))(ms);
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Numbers/dates are parsed from real samples downstream (zod), keep raw strings here.
  parseTagValue: false,
  trimValues: true,
});

export interface ChppCallParams {
  file: string;
  /** PIN explicit versions per endpoint — never omit. */
  version: string;
  [param: string]: string | number | undefined;
}

function buildUrl(params: ChppCallParams): string {
  if (!/^[a-z]+$/.test(params.file) || !/^\d+\.\d+$/.test(params.version)) throw new Error('CHPP file and explicit version are required');
  const url = new URL(BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * Make a signed GET and return the parsed XML as a plain object.
 * Caller is responsible for validating the shape with a zod schema (see ../schemas).
 */
async function performGet(token: TokenPair, params: ChppCallParams): Promise<unknown> {
  const url = buildUrl(params);
  const active = runtime;
  const now = active?.now ?? Date.now;
  for (let attempt = 0; ; attempt++) {
    checkBudget(active);
    if (active?.lastRequestAt !== undefined) await pause(active, Math.max(0, (active.pacingMs ?? 600) - (now() - active.lastRequestAt)));
    if (active) { active.calls++; active.lastRequestAt = now(); }
    let res: Response;
    let xml: string;
    try {
      res = await fetch(buildSignedUrl(url, 'GET', token), {
        method: 'GET', headers: { 'User-Agent': env.CHPP_USER_AGENT },
        signal: AbortSignal.timeout(active?.timeoutMs ?? REQUEST_TIMEOUT_MS),
      });
      xml = await res.text();
    } catch {
      if (attempt < (active?.maxRetries ?? 0)) {
        await pause(active, retryDelay(null, attempt, now(), active?.random?.()));
        if (active) active.retries++;
        continue;
      }
      throw new ChppRequestError('network');
    }
    if (!res.ok) {
      const category = res.status === 401 ? 'authentication' : res.status === 403 ? 'forbidden' : res.status === 429 ? 'rate_limit' : res.status >= 500 ? 'server' : 'request';
      const error = new ChppRequestError(category, res.status);
      if (active && (res.status === 401 || res.status === 403)) active.stopped = error;
      if ((res.status === 429 || res.status >= 500) && attempt < (active?.maxRetries ?? 0)) {
        await pause(active, retryDelay(res.headers.get('retry-after'), attempt, now(), active?.random?.()));
        if (active) active.retries++;
        continue;
      }
      throw error;
    }
    if (/<(?:!doctype\s+html|html)\b/i.test(xml) || XMLValidator.validate(xml) !== true) throw new ChppRequestError('invalid_response');
    await active?.onResponse?.(params, xml, active.calls);
    return parser.parse(xml);
  }
}

/** Serialize every request, including retries; OAuth URLs and response bodies never enter errors. */
export function chppGet(token: TokenPair, params: ChppCallParams): Promise<unknown> {
  const result = queue.then(() => performGet(token, params));
  queue = result.then(() => undefined, () => undefined);
  return result;
}
