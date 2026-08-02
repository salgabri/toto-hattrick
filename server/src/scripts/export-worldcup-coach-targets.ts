import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Export the national-team ids whose coaching history we need to scrape, to attribute World Cup
 * wins to a manager (see sync/worldCup.ts). One target per (champion nation, bracket): senior
 * champions use nationalTeamId, youth champions use u20TeamId (a DIFFERENT team entity — see
 * src/data/national-team-ids.json). Writes [{teamId, label}] to $OUT.
 *
 *   OUT="$SCRAPE_DIR/worldcup-coaches-unresolved.json" npm run export:worldcup-coach-targets -w server
 */
const OUT = process.env.OUT!;
const wc = JSON.parse(readFileSync('src/sync/worldcup-history.json', 'utf8'));
const teamIds: Record<string, { leagueId: number; nationalTeamId: number; u20TeamId: number }> = JSON.parse(
  readFileSync('src/data/national-team-ids.json', 'utf8'),
);

const targets = new Map<number, string>();
const missing: string[] = [];

const seniorChamps = [...new Set(wc.senior.map((e: any) => e.champion).filter(Boolean))] as string[];
for (const nation of seniorChamps) {
  const t = teamIds[nation];
  if (!t?.nationalTeamId) { missing.push(`senior:${nation}`); continue; }
  targets.set(t.nationalTeamId, `${nation} (senior)`);
}

const youthChamps = [...new Set(wc.youth.map((e: any) => e.champion).filter(Boolean))] as string[];
for (const nation of youthChamps) {
  const t = teamIds[nation];
  if (!t?.u20TeamId) { missing.push(`youth:${nation}`); continue; }
  targets.set(t.u20TeamId, `${nation} (youth)`);
}

const out = [...targets.entries()].map(([teamId, label]) => ({ teamId, label }));
writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${out.length} coach-history targets -> ${OUT}`);
if (missing.length) console.log(`unresolved (no team id found): ${missing.join(', ')}`);
