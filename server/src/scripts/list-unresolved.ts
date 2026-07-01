import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { prisma } from '../db/client.js';

/**
 * List the champion teams whose manager was NOT history-verified (the scrape never got a clean
 * pass — they kept the unreliable current-owner attribution), with a Club/History URL so they
 * can be checked manually. One row per team; a team's seasons are listed together (the ownership
 * timeline on the history page covers them all).
 */
const OUT = process.env.OUT!;
const RESULTS = process.env.RESULTS; // managers.jsonl — teamIds already scraped (any POST)

// Teams already scraped (resolved OR legit-empty) — everything else is unresolved.
const done = new Set<number>();
if (RESULTS && existsSync(RESULTS)) {
  for (const line of readFileSync(RESULTS, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { done.add(JSON.parse(line).teamId); } catch { /* skip */ }
  }
}

const champs = await prisma.leagueChampion.findMany({
  where: { complete: true },
  select: { championTeamId: true, season: true, countryName: true, championTeamName: true, championUserId: true, championUserName: true },
  orderBy: [{ championTeamId: 'asc' }, { season: 'desc' }],
});

interface Row { teamId: number; country: string; club: string; seasons: number[]; currentManager: string }
const byTeam = new Map<number, Row>();
for (const c of champs) {
  if (done.has(c.championTeamId)) continue; // already history-verified/attempted
  let r = byTeam.get(c.championTeamId);
  if (!r) { r = { teamId: c.championTeamId, country: c.countryName, club: c.championTeamName, seasons: [], currentManager: '' }; byTeam.set(c.championTeamId, r); }
  r.seasons.push(c.season);
  if (c.championUserId && c.championUserId > 0 && !r.currentManager) r.currentManager = `${c.championUserName ?? ''} (${c.championUserId})`;
}

const rows = [...byTeam.values()].sort((a, b) => a.country.localeCompare(b.country) || b.seasons.length - a.seasons.length);
const esc = (s: string) => `"${(s ?? '').replace(/"/g, '""')}"`;
// currentInDb = read-only (what's stored now). FILL_winnerUserId = the column YOU fill.
const lines = ['teamId,country,club,titleSeasons,titlesCount,currentInDb_readonly,historyUrl,FILL_winnerUserId'];
for (const r of rows) {
  lines.push(
    [
      r.teamId,
      esc(r.country),
      esc(r.club),
      esc(r.seasons.sort((a, b) => b - a).join(' ')),
      r.seasons.length,
      esc(r.currentManager || '—'),
      `https://www.hattrick.org/en/Club/History/?teamId=${r.teamId}`,
      '', // <- put the userId you find here
    ].join(','),
  );
}
writeFileSync(OUT, lines.join('\r\n'), 'utf8');
console.log(`wrote ${rows.length} unresolved teams (${rows.reduce((n, r) => n + r.seasons.length, 0)} titles) -> ${OUT}`);
await prisma.$disconnect();
