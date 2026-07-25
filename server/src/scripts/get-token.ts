import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { getRequestToken, getAccessToken } from '../chpp/auth.js';

/**
 * Acquire and PERSIST a CHPP OAuth access token, in two non-interactive steps (the smoke flow, but
 * it saves the token and takes the PIN as an env var so it runs without a readline prompt). The
 * browser authorization is done by a human — this never handles a Hattrick password.
 *
 *   Step 1:  TOKEN_MODE=request npm run token -w server
 *            → prints the authorize URL and saves the request token to REQUEST_STASH.
 *              Open the URL, log in to Hattrick, approve the app, copy the PIN it shows.
 *   Step 2:  TOKEN_MODE=access PIN=1234567 npm run token -w server
 *            → exchanges the PIN for the access token and writes it to OAUTH_ACCESS_STASH.
 *
 * Stash paths default beside the server workspace and are gitignored (.oauth-*.json) — never
 * commit them. The access stash is the file refresh:latest reads via OAUTH_ACCESS_STASH.
 *
 * (auth.ts imports config/env, so a missing/blank CHPP_CONSUMER_KEY/SECRET fails loudly here.)
 */

const MODE = process.env.TOKEN_MODE ?? 'request';
const REQUEST_STASH = process.env.REQUEST_STASH ?? '.oauth-request.json';
const ACCESS_STASH = process.env.OAUTH_ACCESS_STASH ?? '.oauth-access.json';

if (MODE === 'request') {
  const { requestToken, authorizeUrl } = await getRequestToken();
  writeFileSync(REQUEST_STASH, JSON.stringify(requestToken));
  console.log(`\nrequest token saved to ${REQUEST_STASH}`);
  console.log('\nOpen this URL, log in to Hattrick, approve the app, then copy the PIN it shows:\n');
  console.log(`  ${authorizeUrl}\n`);
  console.log('Then run:  TOKEN_MODE=access PIN=<pin> npm run token -w server');
} else if (MODE === 'access') {
  const pin = process.env.PIN?.trim();
  if (!pin) throw new Error('set PIN=<verifier> for TOKEN_MODE=access');
  if (!existsSync(REQUEST_STASH)) throw new Error(`missing ${REQUEST_STASH} — run TOKEN_MODE=request first`);
  const requestToken = JSON.parse(readFileSync(REQUEST_STASH, 'utf8'));
  const access = await getAccessToken(requestToken, pin);
  writeFileSync(ACCESS_STASH, JSON.stringify(access));
  console.log(`\n✓ access token written to ${ACCESS_STASH} — pass this path as OAUTH_ACCESS_STASH.`);
} else {
  console.log(`unknown TOKEN_MODE=${MODE} (use request | access)`);
}
