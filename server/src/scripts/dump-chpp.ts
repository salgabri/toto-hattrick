import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildSignedUrl, type TokenPair } from '../chpp/auth.js';

/**
 * Generic CHPP sampler — fetch one `file=` and save the RAW XML to server/samples, so a schema can be
 * modelled against real data instead of guessed (CLAUDE.md guardrail #4). Saves XML (not parsed JSON)
 * to match the other server/samples/*.xml and preserve attributes + exact tag names.
 *
 *   FILE=tournamentdetails VERSION=1.1 PARAMS='{"tournamentId":2108472}' npm run dump:chpp -w server
 *
 * If VERSION is wrong, CHPP's response lists the valid versions — read the printed body and retry.
 * Prints the first part of the response so it can be pasted straight back into chat.
 *
 * Env: OAUTH_ACCESS_STASH (default .oauth-access.json), FILE, VERSION, PARAMS (JSON object, optional).
 */
const BASE_URL = 'https://chpp.hattrick.org/chppxml.ashx';

const access: TokenPair = JSON.parse(readFileSync(process.env.OAUTH_ACCESS_STASH ?? '.oauth-access.json', 'utf8'));
const file = process.env.FILE;
const version = process.env.VERSION;
if (!file || !version) throw new Error('set FILE and VERSION (and optional PARAMS as a JSON object)');
const params: Record<string, string | number> = process.env.PARAMS ? JSON.parse(process.env.PARAMS) : {};

const url = new URL(BASE_URL);
url.searchParams.set('file', file);
url.searchParams.set('version', version);
for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

const res = await fetch(buildSignedUrl(url.toString(), 'GET', access));
const xml = await res.text();

const out = `samples/${file}-${version}.xml`;
writeFileSync(out, xml);
console.log(`HTTP ${res.status} -> wrote ${out} (${xml.length} bytes)\n`);
console.log(xml.slice(0, 4000));
