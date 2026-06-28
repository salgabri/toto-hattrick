import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { getRequestToken, getAccessToken } from '../chpp/auth.js';
import { fetchTeamDetails } from '../chpp/endpoints.js';

/**
 * Build step 2: prove the OAuth 1.0a flow works end to end and ONE signed teamdetails
 * call returns parsed data. Run with:  npm run smoke -w server
 *
 * Uses the out-of-band (PIN) flow, so CHPP_CALLBACK_URL must be "oob" (the default).
 * This does NOT persist the token or validate the XML shape — it just proves signing works.
 */
async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    console.log('1) Requesting a CHPP request token…');
    const { requestToken, authorizeUrl } = await getRequestToken();

    console.log('\n2) Open this URL, log in to Hattrick, approve the app:\n');
    console.log(`   ${authorizeUrl}\n`);
    const verifier = (await rl.question('3) Paste the verification code (PIN) shown: ')).trim();

    console.log('\n4) Exchanging for an access token…');
    const access = await getAccessToken(requestToken, verifier);
    console.log('   ✓ access token acquired.');

    console.log('\n5) Signed teamdetails call…');
    const raw = await fetchTeamDetails(access);
    console.log('   ✓ parsed response (top-level keys):', Object.keys(raw as object));
    console.log('\n--- raw parsed object (first 2000 chars) ---');
    console.log(JSON.stringify(raw, null, 2).slice(0, 2000));

    console.log(
      '\n✅ OAuth + signed call succeeded. Save this teamdetails XML into server/samples/' +
        ' so the zod schema can be modelled against it.',
    );
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error('\n❌ Smoke test failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
