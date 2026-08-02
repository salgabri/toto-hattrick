import { writeFileSync } from 'node:fs';
import { prisma } from '../db/client.js';

/**
 * Export every tracked country's leagueId as a scrape target for the National Coach elections
 * (see sync/elections.ts). Real countries only — the non-country specials (International/
 * Homegrown/Femme/Anniversary) don't hold National Coach elections tied to World Cup cycles.
 *
 *   OUT="$SCRAPE_DIR/elections-unresolved.json" npm run export:election-targets -w server
 */
const OUT = process.env.OUT!;
const leagues = await prisma.nationalLeague.findMany({ where: { isCountry: true }, orderBy: { leagueId: 'asc' } });
const targets = leagues.map((l) => ({ teamId: l.leagueId, label: l.countryName }));
writeFileSync(OUT, JSON.stringify(targets));
console.log(`wrote ${targets.length} election-history targets -> ${OUT}`);
await prisma.$disconnect();
