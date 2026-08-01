import { readFileSync } from 'node:fs';
import { prisma } from '../db/client.js';
import { ingestWorldCupHistory, type WorldCupEdition } from '../sync/worldCup.js';

/**
 * Ingest the World Cup roll of honour from the committed seed (see sync/worldCup.ts) — a pure
 * static seed, no OAuth/CHPP call needed.
 *
 *   npm run sync:worldcup -w server
 */
const data: { senior: WorldCupEdition[]; youth: WorldCupEdition[] } = JSON.parse(
  readFileSync(new URL('../sync/worldcup-history.json', import.meta.url), 'utf8'),
);
const r = await ingestWorldCupHistory(data);
console.log(`ingested ${r.senior} senior + ${r.youth} youth World Cup editions`);
await prisma.$disconnect();
