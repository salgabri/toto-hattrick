import '../config/env.js';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { prisma } from '../db/client.js';

const legacySchema = z.array(z.object({
  teamId: z.number().int().positive(), seasons: z.array(z.number().int().positive()),
}));

/** Discovery hints only: these old season numbers mix local competition calendars. */
export function rankLegacyWinnerTargets(
  input: unknown,
  excludedTeamIds: ReadonlySet<number>,
  limit = 200,
) {
  z.number().int().positive().parse(limit);
  const grouped = new Map<number, Set<number>>();
  for (const row of legacySchema.parse(input)) {
    if (excludedTeamIds.has(row.teamId)) continue;
    const seasons = grouped.get(row.teamId) ?? new Set<number>();
    for (const season of row.seasons) seasons.add(season);
    grouped.set(row.teamId, seasons);
  }
  const targets = [...grouped.entries()].map(([teamId, seasons]) => ({
    teamId, leagueId: 0, club: 'Unknown historical club',
    legacySeasonHints: [...seasons].sort((a, b) => b - a),
    legacySeasonCount: seasons.size,
    seasonHintsOnly: true as const,
    source: 'server/scrape/cup-targets.json',
  })).sort((a, b) => b.legacySeasonCount - a.legacySeasonCount || a.teamId - b.teamId);
  return { candidates: targets.length, targets: targets.slice(0, limit) };
}

async function main() {
  const { values } = parseArgs({ options: {
    source: { type: 'string', default: 'scrape/cup-targets.json' },
    histories: { type: 'string', default: '../.scrape/winner-recovery/histories.json' },
    output: { type: 'string' }, limit: { type: 'string', default: '200' },
  } });
  if (!values.output) throw new Error('Required: --output <new-discovery-targets.json> [--limit 200]');
  const sourcePath = resolve(values.source);
  const historyPath = resolve(values.histories);
  const outputPath = resolve(values.output);
  if ([sourcePath, historyPath].some((path) => path.toLowerCase() === outputPath.toLowerCase())) {
    throw new Error('Output must differ from input paths.');
  }
  const parseFile = async (path: string): Promise<unknown> => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
  const [input, historyInput, leagues, cups] = await Promise.all([
    parseFile(sourcePath), parseFile(historyPath),
    prisma.leagueChampion.findMany({ select: { championTeamId: true } }),
    prisma.cupChampion.findMany({ select: { championTeamId: true } }),
  ]);
  const histories = z.array(z.object({ teamId: z.number().int().positive() })).parse(historyInput);
  const storedIds = new Set([...leagues, ...cups].flatMap((row) => row.championTeamId && row.championTeamId > 0 ? [row.championTeamId] : []));
  const excludedIds = new Set([...storedIds, ...histories.map((history) => history.teamId)]);
  const result = rankLegacyWinnerTargets(input, excludedIds, Number(values.limit));
  // Do not infer any country, manager, title, or calendar conversion from this old worklist.
  // The browser must collect actual club identity plus complete, competition-specific events.
  await mkdir(dirname(outputPath), { recursive: true });
  const file = await open(outputPath, 'wx');
  try { await file.writeFile(`${JSON.stringify(result.targets, null, 2)}\n`); }
  finally { await file.close(); }
  console.log(JSON.stringify({ outputPath, storedTeamIds: storedIds.size, historyTeamIds: histories.length,
    remainingDiscoveryCandidates: result.candidates, written: result.targets.length, seasonHintsOnly: true }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
  finally { await prisma.$disconnect(); }
}
