import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { enrichUserNationalities } from '../sync/enrichManagers.js';
import { bakeStatic } from '../sync/bake.js';
import type { TokenPair } from '../chpp/auth.js';

/**
 * Resolve nationality for every manager whose row still has none, then re-bake. Standalone repair
 * for the gap where a cup/masters scrape upserted managers without ever running the nationality pass
 * (they bake as "Unknown"). Idempotent and self-healing: enrichUserNationalities only touches rows
 * still null and leaves a row null on a transient API error, so re-running converges to full
 * coverage. Chunk with LIMIT to stay under the daily CHPP quota — run again the next day to finish.
 *
 *   npm run backfill:nationalities -w server
 *
 * Env:
 *   OAUTH_ACCESS_STASH=...  token path (defaults to server/.oauth-access.json)
 *   LIMIT=2000              cap CHPP calls this run (omit = resolve all remaining)
 *   OUT=../web/public/data  bake target · SKIP_BAKE=1 to update the DB only
 */
const stashPath = process.env.OAUTH_ACCESS_STASH ?? '.oauth-access.json';
const access: TokenPair = JSON.parse(readFileSync(stashPath, 'utf8'));
const limit = process.env.LIMIT ? Number(process.env.LIMIT) : undefined;

const before = await prisma.hattrickUser.count({ where: { nationality: null } });
console.log(`backfill:nationalities @ ${new Date().toISOString()} — ${before} manager(s) with no nationality${limit ? `, cap ${limit} this run` : ''}`);

const n = await enrichUserNationalities(access, limit ? { limit } : {});
console.log(`attempted ${n.processed}: ${n.resolved} resolved, ${n.unknown} unknown (deleted/hidden), ${n.errors} errors (left null to retry)`);

const remaining = await prisma.hattrickUser.count({ where: { nationality: null } });
console.log(`remaining with no nationality: ${remaining}${remaining ? ' — re-run to continue' : ''}`);

if (!process.env.SKIP_BAKE) {
  const out = process.env.OUT ?? '../web/public/data';
  const b = await bakeStatic(out);
  console.log(`baked -> ${out}: ${b.managers} managers, ${b.cups} cup countries (${b.cupFinals} finals)`);
}
console.log(`done @ ${new Date().toISOString()}`);
await prisma.$disconnect();
