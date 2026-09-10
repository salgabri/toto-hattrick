import '../config/env.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';

/**
 * Recover cup IDs/final facts that a baked-data reconstruction discarded, using a local SQLite
 * cache explicitly supplied by the caller. The source is opened read-only. No CHPP calls, manager
 * attribution, country changes, new champions, or overwrite of existing facts are involved.
 *
 * Run from server/ (Node 22.13+):
 *   npx tsx src/scripts/restore-winner-cache.ts --source /absolute/path/to/cache.db
 * Add --details to inspect every proposed patch; add --apply to commit one transaction.
 * Without --apply the shared target database is only read.
 */

const sqliteBoolean = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform(Boolean);
const winnerSchema = z.object({
  cupId: z.number().int().positive(),
  season: z.number().int().positive(),
  leagueId: z.number().int().nonnegative(),
  countryName: z.string(),
  cupName: z.string(),
  isMain: sqliteBoolean,
  championTeamName: z.string().min(1),
  championTeamId: z.number().int().nonnegative().nullable(),
  finalMatchId: z.number().int().nonnegative(),
  runnerUpTeamName: z.string(),
  homeGoals: z.number().int().nonnegative(),
  awayGoals: z.number().int().nonnegative(),
  penalties: sqliteBoolean,
});

type WinnerFacts = z.infer<typeof winnerSchema>;
type Patch = Partial<Pick<WinnerFacts,
  'championTeamId' | 'finalMatchId' | 'runnerUpTeamName' | 'homeGoals' | 'awayGoals' | 'penalties'
>>;
type Decision = { patch: Patch } | { skip: string };

/** Exact identity gates precede any recovery. Team names are never used as a join key. */
export function planWinnerCacheRestore(target: WinnerFacts, source: WinnerFacts): Decision {
  if (target.cupId !== source.cupId || target.season !== source.season) return { skip: 'different-key' };
  if (target.championTeamName !== source.championTeamName) return { skip: 'different-champion-name' };
  if (target.leagueId !== source.leagueId || target.countryName !== source.countryName) {
    return { skip: 'different-country' };
  }
  if (target.cupName !== source.cupName || target.isMain !== source.isMain) {
    return { skip: 'different-competition' };
  }
  if ((target.championTeamId ?? 0) > 0 && (source.championTeamId ?? 0) > 0
    && target.championTeamId !== source.championTeamId) return { skip: 'conflicting-team-id' };
  if (target.finalMatchId > 0 && source.finalMatchId > 0 && target.finalMatchId !== source.finalMatchId) {
    return { skip: 'conflicting-final-id' };
  }
  if (target.runnerUpTeamName && source.runnerUpTeamName && target.runnerUpTeamName !== source.runnerUpTeamName) {
    return { skip: 'conflicting-runner-up' };
  }

  const emptyFinal = target.finalMatchId === 0 && target.runnerUpTeamName === ''
    && target.homeGoals === 0 && target.awayGoals === 0 && !target.penalties;
  // A 0 goal tally is legitimate, not individually a missing value. Restore final facts only as
  // one bundle when the *entire* target final is the reconstruction placeholder.
  const sourceHasFinal = source.finalMatchId > 0 && source.runnerUpTeamName !== '';
  if (!emptyFinal && sourceHasFinal
    && (target.homeGoals !== source.homeGoals || target.awayGoals !== source.awayGoals
      || target.penalties !== source.penalties)) return { skip: 'conflicting-final-score' };

  const patch: Patch = {};
  if (!(target.championTeamId && target.championTeamId > 0) && source.championTeamId && source.championTeamId > 0) {
    patch.championTeamId = source.championTeamId;
  }
  if (emptyFinal && sourceHasFinal) {
    patch.finalMatchId = source.finalMatchId;
    patch.runnerUpTeamName = source.runnerUpTeamName;
    patch.homeGoals = source.homeGoals;
    patch.awayGoals = source.awayGoals;
    patch.penalties = source.penalties;
  }
  return Object.keys(patch).length ? { patch } : { skip: 'nothing-missing' };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      apply: { type: 'boolean', default: false },
      details: { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (!values.source) throw new Error('Required: --source /path/to/existing-cache.db (dry run unless --apply).');
  const sourcePath = resolve(values.source);
  const sourceDb = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    // Enumerate only known, nonsensitive CupChampion fields. Older caches need no newer optional
    // columns, and neither credentials nor user metadata are ever read from the source.
    const rawRows = sourceDb.prepare(`
      SELECT cupId, season, leagueId, countryName, cupName, isMain,
        championTeamName, championTeamId, finalMatchId, runnerUpTeamName,
        homeGoals, awayGoals, penalties
      FROM CupChampion WHERE championTeamId > 0 OR finalMatchId > 0
      ORDER BY cupId, season
    `).all();
    const sourceRows = rawRows.map((row) => winnerSchema.parse(row));
    const sourceCount = sourceDb.prepare('SELECT COUNT(*) AS count FROM CupChampion').get()?.count;

    const run = async (db: Prisma.TransactionClient) => {
      const targets = await db.cupChampion.findMany();
      const byKey = new Map(targets.map((row) => [`${row.cupId}:${row.season}`, row]));
      const skipped: Record<string, number> = {};
      const changes: Array<{ cupId: number; season: number; championTeamName: string; before: Patch; after: Patch }> = [];
      let teamIds = 0;
      let finalFacts = 0;
      let unresolvedWinners = 0;
      for (const source of sourceRows) {
        const target = byKey.get(`${source.cupId}:${source.season}`);
        if (!target) { skipped['absent-target'] = (skipped['absent-target'] ?? 0) + 1; continue; }
        const decision = planWinnerCacheRestore(target, source);
        if ('skip' in decision) {
          skipped[decision.skip] = (skipped[decision.skip] ?? 0) + 1;
          continue;
        }
        const patch = decision.patch;
        const before: Patch = Object.fromEntries(Object.keys(patch).map((field) => [field, target[field as keyof Patch]]));
        changes.push({ cupId: target.cupId, season: target.season, championTeamName: target.championTeamName, before, after: patch });
        if (patch.championTeamId !== undefined) teamIds++;
        if (patch.finalMatchId !== undefined) finalFacts++;
        if (!target.championUserId) unresolvedWinners++;
        if (values.apply) {
          // Optimistic factual preconditions also prevent a concurrent repair from being overwritten.
          const changed = await db.cupChampion.updateMany({
            where: {
              cupId: target.cupId, season: target.season, championTeamName: target.championTeamName,
              leagueId: target.leagueId, countryName: target.countryName, cupName: target.cupName, isMain: target.isMain,
              championTeamId: target.championTeamId, finalMatchId: target.finalMatchId,
              runnerUpTeamName: target.runnerUpTeamName, homeGoals: target.homeGoals,
              awayGoals: target.awayGoals, penalties: target.penalties,
            },
            data: patch,
          });
          if (changed.count !== 1) throw new Error(`Concurrent factual change at cup ${target.cupId}, season ${target.season}; transaction rolled back.`);
        }
      }
      return {
        mode: values.apply ? 'applied' : 'dry-run', source: sourcePath,
        sourceCupRows: sourceCount, sourceRowsWithFacts: sourceRows.length,
        targetCupRows: targets.length, changedRows: changes.length, restoredTeamIds: teamIds,
        restoredFinalFacts: finalFacts, changedRowsMissingManager: unresolvedWinners,
        managerAttributionsChanged: 0, skipped,
        ...(values.details ? { changes } : {}),
      };
    };
    const summary = values.apply
      ? await prisma.$transaction(run, { maxWait: 10_000, timeout: 60_000 })
      : await run(prisma);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    sourceDb.close();
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
