import '../config/env.js';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { prisma } from '../db/client.js';
import { ingestElections, type ElectionRecord } from '../sync/elections.js';

/**
 * Ingest National Coach election results scraped once from World/Elections/History.aspx (see
 * sync/elections.ts), committed as the seed elections.json — same pattern as the other scraped
 * datasets.
 *
 *   npm run sync:elections -w server
 *
 * Pass --input <path.jsonl> to merge a fresh scrape. Add --complete only for a verified complete
 * snapshot to allow insertion of previously absent rows. Existing rows are never deleted.
 */
const { values } = parseArgs({ options: { input: { type: 'string' }, complete: { type: 'boolean', default: false } } });
const records: ElectionRecord[] = values.input
  ? readFileSync(values.input, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  : JSON.parse(readFileSync(new URL('../sync/elections.json', import.meta.url), 'utf8'));

const n = await ingestElections(records, { complete: !values.input || values.complete });
console.log(`ingested ${n} election records`);

const total = await prisma.nationalCoachElection.count();
const attributed = await prisma.nationalCoachElection.count({ where: { winnerUserId: { not: null } } });
console.log(`total in DB: ${total}, attributed to a user: ${attributed}`);
await prisma.$disconnect();
