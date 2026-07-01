import { XMLParser } from 'fast-xml-parser';
import { buildSignedUrl, type TokenPair } from './auth.js';

/**
 * Signed CHPP data calls. Every endpoint is the same base URL with a `file` selector
 * and a pinned `version`. The browser never reaches this — backend only.
 */

const BASE_URL = 'https://chpp.hattrick.org/chppxml.ashx';

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
export async function chppGet(token: TokenPair, params: ChppCallParams): Promise<unknown> {
  const url = buildUrl(params);
  const res = await fetch(buildSignedUrl(url, 'GET', token), { method: 'GET' });
  const xml = await res.text();

  if (!res.ok) {
    throw new Error(`CHPP ${params.file} failed (${res.status}): ${xml.slice(0, 300)}`);
  }
  return parser.parse(xml);
}
