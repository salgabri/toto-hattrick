import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chppGet, configureChppRuntime, ChppBudgetError, ChppRequestError, retryDelay } from './client.js';

const token = { token: 'test', tokenSecret: 'secret' };
const params = { file: 'worlddetails', version: '1.9' };
test('bounded retry honors Retry-After and consumes the request budget', async () => {
  const previous = globalThis.fetch; const waits: number[] = []; let calls = 0;
  const runtime = configureChppRuntime({ maxCalls: 2, maxRetries: 2, pacingMs: 0, wait: async (ms) => { waits.push(ms); } });
  globalThis.fetch = async () => ++calls === 1 ? new Response('busy', { status: 429, headers: { 'Retry-After': '2' } }) : new Response('<HattrickData/>');
  try {
    await chppGet(token, params);
    assert.deepEqual(waits, [2000]); assert.deepEqual(runtime.stats(), { calls: 2, retries: 1 });
    await assert.rejects(chppGet(token, params), ChppBudgetError); assert.equal(calls, 2);
  } finally { runtime.dispose(); globalThis.fetch = previous; }
});
test('authentication failure stops queued acquisition without leaking the body', async () => {
  const previous = globalThis.fetch; let calls = 0;
  const runtime = configureChppRuntime({ maxCalls: 10, pacingMs: 0 });
  globalThis.fetch = async () => { calls++; return new Response('oauth_secret=do-not-log', { status: 401 }); };
  try {
    const results = await Promise.allSettled([chppGet(token, params), chppGet(token, params)]);
    assert.equal(calls, 1);
    for (const result of results) { assert.equal(result.status, 'rejected'); if (result.status === 'rejected') { assert.ok(result.reason instanceof ChppRequestError); assert.ok(!String(result.reason).includes('do-not-log')); } }
  } finally { runtime.dispose(); globalThis.fetch = previous; }
});
test('Retry-After beyond deadline checkpoints instead of waiting', async () => {
  const previous = globalThis.fetch;
  const runtime = configureChppRuntime({ maxCalls: 10, maxRetries: 2, deadline: 1000, now: () => 0, wait: async () => { assert.fail('must not wait'); } });
  globalThis.fetch = async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } });
  try { await assert.rejects(chppGet(token, params), ChppBudgetError); assert.equal(runtime.stats().calls, 1); }
  finally { runtime.dispose(); globalThis.fetch = previous; }
});
test('rejects HTML and malformed XML even with HTTP 200', async () => {
  const previous = globalThis.fetch;
  try { for (const body of ['<!doctype html><html></html>', '<HattrickData><Broken>']) { globalThis.fetch = async () => new Response(body); await assert.rejects(chppGet(token, params), ChppRequestError); } }
  finally { globalThis.fetch = previous; }
});
test('Retry-After supports seconds, dates and backoff', () => {
  assert.equal(retryDelay('2', 0, 0), 2000);
  assert.equal(retryDelay('Thu, 01 Jan 1970 00:00:02 GMT', 0, 0), 2000);
  assert.equal(retryDelay(null, 1, 0, 0), 2000);
});
