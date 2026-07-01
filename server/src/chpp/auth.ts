import crypto from 'node:crypto';
import OAuth from 'oauth-1.0a';
import { env } from '../config/env.js';

/**
 * Three-legged OAuth 1.0a for Hattrick CHPP.
 *   1. getRequestToken()  -> temporary token + secret + an authorize URL
 *   2. user authorizes on hattrick.org, gets a verifier (PIN or callback param)
 *   3. getAccessToken()   -> long-lived access token + secret (store per user)
 *
 * The consumer secret and all token secrets live here, server-side only.
 */

const REQUEST_TOKEN_URL = 'https://chpp.hattrick.org/oauth/request_token.ashx';
const AUTHORIZE_URL = 'https://chpp.hattrick.org/oauth/authorize.aspx';
const ACCESS_TOKEN_URL = 'https://chpp.hattrick.org/oauth/access_token.ashx';

export interface TokenPair {
  token: string;
  tokenSecret: string;
}

const oauth = new OAuth({
  consumer: { key: env.CHPP_CONSUMER_KEY, secret: env.CHPP_CONSUMER_SECRET },
  signature_method: 'HMAC-SHA1',
  hash_function(baseString, key) {
    return crypto.createHmac('sha1', key).update(baseString).digest('base64');
  },
});

/**
 * Sign a request and return a URL with the OAuth params in the QUERY STRING.
 *
 * Hattrick's CHPP front-end (IIS) rejects the `Authorization: OAuth ...` header at the
 * web-server layer with an IIS 401.2 ("invalid credentials") — the request never reaches
 * the OAuth module. Delivering the signed oauth_* params as query parameters works.
 * The signature base string still includes every existing query param (oauth-1.0a's
 * deParamUrl handles that), so `url` may already carry file/version/oauth_callback.
 */
export function buildSignedUrl(url: string, method: 'GET' | 'POST', token?: TokenPair): string {
  const signed = oauth.authorize(
    { url, method },
    token ? { key: token.token, secret: token.tokenSecret } : undefined,
  ) as unknown as Record<string, string | number>;
  const u = new URL(url);
  for (const [key, value] of Object.entries(signed)) {
    u.searchParams.set(key, String(value));
  }
  return u.toString();
}

/** CHPP OAuth endpoints answer with a query-string body: oauth_token=...&oauth_token_secret=... */
function parseTokenResponse(body: string): TokenPair & Record<string, string> {
  const params = new URLSearchParams(body);
  const token = params.get('oauth_token');
  const tokenSecret = params.get('oauth_token_secret');
  if (!token || !tokenSecret) {
    throw new Error(`Unexpected OAuth response body: ${body.slice(0, 200)}`);
  }
  const extra: Record<string, string> = {};
  for (const [k, v] of params) extra[k] = v;
  return { token, tokenSecret, ...extra };
}

/** Step 1. Returns the request token plus the URL to send the user to. */
export async function getRequestToken(): Promise<{ requestToken: TokenPair; authorizeUrl: string }> {
  const url = `${REQUEST_TOKEN_URL}?oauth_callback=${encodeURIComponent(env.CHPP_CALLBACK_URL)}`;
  const res = await fetch(buildSignedUrl(url, 'GET'), { method: 'GET' });
  const body = await res.text();
  if (!res.ok) throw new Error(`request_token failed (${res.status}): ${body.slice(0, 200)}`);

  const parsed = parseTokenResponse(body);
  const authorizeUrl = `${AUTHORIZE_URL}?oauth_token=${encodeURIComponent(parsed.token)}`;
  return { requestToken: { token: parsed.token, tokenSecret: parsed.tokenSecret }, authorizeUrl };
}

/**
 * Step 3. Exchange an authorized request token + verifier for an access token.
 * Persist the returned access token/secret (see ChppToken model) — re-use it for all data calls.
 */
export async function getAccessToken(
  requestToken: TokenPair,
  verifier: string,
): Promise<TokenPair> {
  const url = `${ACCESS_TOKEN_URL}?oauth_verifier=${encodeURIComponent(verifier)}`;
  const res = await fetch(buildSignedUrl(url, 'GET', requestToken), { method: 'GET' });
  const body = await res.text();
  if (!res.ok) throw new Error(`access_token failed (${res.status}): ${body.slice(0, 200)}`);

  const parsed = parseTokenResponse(body);
  return { token: parsed.token, tokenSecret: parsed.tokenSecret };
}
