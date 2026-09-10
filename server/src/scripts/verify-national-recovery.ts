import { DatabaseSync } from 'node:sqlite';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Independent final-state verification. Both SQLite handles are explicitly read-only.
const beforePath = resolve('../.backup/national-winner-recovery-20260910/dev.db');
const afterPath = resolve('prisma/dev.db');
const reportPath = resolve('../.scrape/national-winner-recovery/final-db-verification.json');
const before = new DatabaseSync(beforePath, { readOnly: true });
const after = new DatabaseSync(afterPath, { readOnly: true });
type Row = Record<string, any>;
const readJson = async (path: string): Promise<any> => JSON.parse(await readFile(path, 'utf8'));
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
try {
  const coachAudit = await readJson('../.scrape/national-winner-recovery/final-coach-apply.json');
  const electionAudit = await readJson('../.scrape/national-winner-recovery/final-election-apply.json');
  const expectedCoaches = new Map<string, number>(coachAudit.plans.filter((plan: any) => plan.status === 'applied')
    .map((plan: any) => [plan.key, plan.selected.userId]));
  const expectedElections = new Map<number, number>(electionAudit.results.filter((result: any) => result.status === 'applied')
    .map((result: any) => [result.storedId, result.evidence[0].winnerUserId]));
  const expectedUsers = new Set([...expectedCoaches.values(), ...expectedElections.values()]);
  const tables = ['WorldCupChampion', 'NationalCupChampion', 'NationalCoachElection', 'LeagueChampion', 'CupChampion',
    'SeasonStanding', 'NationalLeague', 'Cup', 'Team', 'Match', 'MatchDetail', 'HattrickUser'];
  const counts: Record<string, { before: number; after: number }> = {};
  const changes: Record<string, Array<{ key: string; fields: Record<string, { before: unknown; after: unknown }> }>> = {};
  const added: Record<string, Row[]> = {};
  const removed: Record<string, Row[]> = {};
  const allBefore = new Map<string, Map<string, Row>>();
  const allAfter = new Map<string, Map<string, Row>>();
  for (const table of tables) {
    const fields = before.prepare(`PRAGMA table_info(${quote(table)})`).all() as Row[];
    const pk = fields.filter((field) => field.pk > 0).sort((a, b) => a.pk - b.pk).map((field) => field.name as string);
    if (!pk.length) throw new Error(`Missing stable row key for ${table}`);
    const key = (row: Row) => JSON.stringify(pk.map((field) => row[field]));
    const oldRows = before.prepare(`SELECT * FROM ${quote(table)}`).all() as Row[];
    const newRows = after.prepare(`SELECT * FROM ${quote(table)}`).all() as Row[];
    const oldMap = new Map(oldRows.map((row) => [key(row), row]));
    const newMap = new Map(newRows.map((row) => [key(row), row]));
    allBefore.set(table, oldMap); allAfter.set(table, newMap);
    counts[table] = { before: oldRows.length, after: newRows.length };
    added[table] = newRows.filter((row) => !oldMap.has(key(row)));
    removed[table] = oldRows.filter((row) => !newMap.has(key(row)));
    changes[table] = [];
    for (const [rowKey, old] of oldMap) {
      const current = newMap.get(rowKey); if (!current) continue;
      const changed = Object.keys(old).filter((field) => !same(old[field], current[field]));
      if (changed.length) changes[table]!.push({ key: rowKey,
        fields: Object.fromEntries(changed.map((field) => [field, { before: old[field], after: current[field] }])) });
    }
  }
  const coachChanges: Array<{ key: string; before: number | null; after: number | null; matchesApplyReport: boolean; missingOnly: boolean }> = [];
  const slotId = (row: Row, field: string, index?: number): number | null => {
    const raw = index === undefined ? row[field] : String(row[field] ?? '').split(',')[index];
    return Number(raw) > 0 ? Number(raw) : null;
  };
  for (const table of ['WorldCupChampion', 'NationalCupChampion']) {
    for (const [key, old] of allBefore.get(table)!) {
      const current = allAfter.get(table)!.get(key); if (!current) continue;
      const prefix = table === 'WorldCupChampion' ? `worldCupChampion:${!!old.isYouth}:${old.edition}`
        : `nationalCupChampion:${old.cupId}:${old.season}`;
      const slots: Array<{ slot: string; field: string; index?: number }> = [
        { slot: 'champion', field: 'championUserId' }, { slot: 'runnerUp', field: 'runnerUpUserId' },
      ];
      const bronzeCount = Math.max(String(old.thirdFourthUserIds ?? '').split(',').length, String(current.thirdFourthUserIds ?? '').split(',').length);
      for (let index = 0; index < bronzeCount; index++) slots.push({ slot: `thirdFourth:${index}`, field: 'thirdFourthUserIds', index });
      for (const slot of slots) {
        const was = slotId(old, slot.field, slot.index), now = slotId(current, slot.field, slot.index);
        if (was === now) continue;
        const slotKey = `${prefix}:${slot.slot}`;
        coachChanges.push({ key: slotKey, before: was, after: now,
          matchesApplyReport: expectedCoaches.get(slotKey) === now, missingOnly: was === null && now !== null });
      }
    }
  }
  const electionChanges = changes.NationalCoachElection!.map((change) => {
    const old = allBefore.get('NationalCoachElection')!.get(change.key)!;
    const current = allAfter.get('NationalCoachElection')!.get(change.key)!;
    return { id: old.id, leagueId: old.leagueId, isYouth: !!old.isYouth, edition: old.edition,
      before: old.winnerUserId, after: current.winnerUserId,
      matchesApplyReport: expectedElections.get(old.id) === current.winnerUserId,
      missingOnly: !old.winnerUserId && current.winnerUserId > 0 };
  });
  const factFields: Record<string, Set<string>> = {
    WorldCupChampion: new Set(['championUserId', 'championUserName', 'runnerUpUserId', 'thirdFourthUserIds', 'updatedAt']),
    NationalCupChampion: new Set(['championUserId', 'championUserName', 'runnerUpUserId', 'thirdFourthUserIds', 'updatedAt']),
    NationalCoachElection: new Set(['winnerUserId', 'winnerUserName', 'updatedAt']),
  };
  const unexpectedFacts = Object.entries(factFields).flatMap(([table, allowed]) => changes[table]!.flatMap((row) =>
    Object.keys(row.fields).filter((field) => !allowed.has(field)).map((field) => ({ table, key: row.key, field, ...row.fields[field]! }))));
  const clubTables = ['LeagueChampion', 'CupChampion', 'SeasonStanding', 'NationalLeague', 'Cup', 'Team', 'Match', 'MatchDetail'];
  const existingUserChanges = changes.HattrickUser!;
  const knownUserMetadataChanges = existingUserChanges.flatMap((row) => Object.keys(row.fields).filter((field) => field !== 'updatedAt')
    .map((field) => ({ key: row.key, field, ...row.fields[field]! })));
  const newUsers: Array<Row & { belongsToReviewedRecovery: boolean; nationalityResolved: boolean }> = added.HattrickUser!.map((row) => ({ ...row,
    belongsToReviewedRecovery: expectedUsers.has(row.userId), nationalityResolved: typeof row.nationality === 'string' && !!row.nationality && row.countryId > 0 }));
  const checks = {
    allCompetitionAndElectionRowCountsUnchanged: tables.filter((table) => table !== 'HattrickUser').every((table) => counts[table]!.before === counts[table]!.after),
    noCompetitionOrElectionRowsAddedOrRemoved: tables.filter((table) => table !== 'HattrickUser').every((table) => !added[table]!.length && !removed[table]!.length),
    eventFactsUnchanged: unexpectedFacts.length === 0,
    exactlyEightReviewedCoachSlotsFilled: coachChanges.length === 8 && expectedCoaches.size === 8 && coachChanges.every((row) => row.matchesApplyReport && row.missingOnly),
    exactlyNineReviewedElectionWinnersFilled: electionChanges.length === 9 && expectedElections.size === 9 && electionChanges.every((row) => row.matchesApplyReport && row.missingOnly),
    allClubRepairsAndFactsUnchanged: clubTables.every((table) => changes[table]!.length === 0 && !added[table]!.length && !removed[table]!.length),
    existingUserMetadataPreserved: knownUserMetadataChanges.length === 0 && removed.HattrickUser!.length === 0,
    exactlyThreeNewUsersWithResolvedNationality: newUsers.length === 3 && newUsers.every((row) => row.belongsToReviewedRecovery && row.nationalityResolved),
  };
  const report = { generatedAt: new Date().toISOString(), readOnly: true, beforePath, afterPath,
    passed: Object.values(checks).every(Boolean), checks, counts,
    changedRowCounts: Object.fromEntries(Object.entries(changes).map(([table, rows]) => [table, rows.length])),
    coachChanges, electionChanges, newUsers, existingUserChanges, unexpectedFacts, knownUserMetadataChanges,
    attributionRowChanges: { WorldCupChampion: changes.WorldCupChampion, NationalCupChampion: changes.NationalCupChampion,
      NationalCoachElection: changes.NationalCoachElection } };
  await mkdir(dirname(reportPath), { recursive: true });
  const file = await open(reportPath, 'wx');
  try { await file.writeFile(`${JSON.stringify(report, null, 2)}\n`); } finally { await file.close(); }
  console.log(JSON.stringify({ passed: report.passed, checks, changedRowCounts: report.changedRowCounts,
    newUsers: newUsers.map((row) => ({ userId: row.userId, loginName: row.loginName, nationality: row.nationality })), reportPath }, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally { before.close(); after.close(); }
