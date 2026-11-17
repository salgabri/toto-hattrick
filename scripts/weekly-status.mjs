// Read-only status for the weekly assisted update (docs/WEEKLY_UPDATE_PLAYBOOK.md).
//   node scripts/weekly-status.mjs <archive .db>   (a run's working.db or a review checkout)
// Prints JSON: whether more acquisition rounds are worthwhile, whether an elections read is due,
// and the league ids + cutoff edition the browser elections capture needs.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const DAY = 86_400_000;
export const ELECTIONS_MAX_AGE_DAYS = 28;

const dmy = value => {
  const match = typeof value === 'string' && value.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})/);
  return match ? Date.parse(`${match[3]}-${match[2]}-${match[1]}T00:00:00Z`) : NaN;
};

export function weeklyStatus(db, now = Date.now()) {
  const openRecent = db.prepare(`SELECT count(*) AS n FROM UpdateItem i JOIN UpdateSource s ON s.sourceKey = i.sourceKey
    WHERE i.task = 'result' AND i.state IN ('pending', 'retry') AND i.edition >= s.observedThrough - 1 AND i.edition < s.observedThrough
      AND (i.nextAttemptAt IS NULL OR i.nextAttemptAt <= ?) AND s.kind IN ('league', 'cup', 'masters')`).get(now).n;
  const electionSources = db.prepare(`SELECT externalId, lastSuccessAt FROM UpdateSource WHERE sourceKey LIKE 'elections:%' ORDER BY externalId`).all();
  const lastRead = Math.max(0, ...electionSources.map(source => Number(source.lastSuccessAt ?? 0)));
  const finals = [
    ...db.prepare(`SELECT 'worldcup-' || CASE isYouth WHEN 1 THEN 'youth' ELSE 'senior' END || ' ' || edition AS label, finishedDate AS d FROM WorldCupChampion WHERE champion IS NOT NULL`).all(),
    ...db.prepare(`SELECT cupName || ' ' || season AS label, finalDate AS d FROM NationalCupChampion WHERE status = 'Finished'`).all(),
  ].map(row => ({ label: row.label, at: dmy(row.d) })).filter(row => Number.isFinite(row.at) && row.at > lastRead).map(row => row.label);
  const ageDays = lastRead ? Math.floor((now - lastRead) / DAY) : null;
  const maxEdition = db.prepare('SELECT max(edition) AS e FROM NationalCoachElection').get().e ?? 1;
  const reasons = [];
  if (ageDays === null || ageDays >= ELECTIONS_MAX_AGE_DAYS) reasons.push(`last read ${ageDays === null ? 'never' : `${ageDays} days ago`}`);
  if (finals.length) reasons.push(`national finals since the last read: ${finals.join(', ')}`);
  return {
    acquisition: { openPreviousSeasonResults: openRecent, runAnotherRound: openRecent > 0 },
    elections: { due: reasons.length > 0, reasons, lastRead: lastRead ? new Date(lastRead).toISOString() : null,
      cutoff: Math.max(1, maxEdition - 1), leagueIds: electionSources.map(source => Number(source.externalId)) },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.argv[2]) { console.error('usage: node scripts/weekly-status.mjs <archive .db>'); process.exit(1); }
  const db = new DatabaseSync(process.argv[2], { readOnly: true });
  try { console.log(JSON.stringify(weeklyStatus(db), null, 1)); } finally { db.close(); }
}
