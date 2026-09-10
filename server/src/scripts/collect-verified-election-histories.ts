import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { electionCaptureSchema, electionEvidenceSchema, electionKey, prepareElectionCaptures } from '../sync/electionRecovery.js';

// Mechanical provenance export only. Uses a reviewed dry-run report and never reads/writes DB.
const { values } = parseArgs({ options: {
  report: { type: 'string' }, output: { type: 'string' },
  captures: { type: 'string', default: '../.scrape/national-winner-recovery/elections' },
} });
if (!values.report || !values.output) throw new Error('Required: --report <dry-run.json> --output <new-manifest.json> [--captures <directory>]');
const readJson = async (path: string): Promise<unknown> => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const report = z.object({ dryRun: z.literal(true), results: z.array(z.object({
  status: z.string(), evidence: z.array(electionEvidenceSchema),
})) }).parse(await readJson(resolve(values.report)));
const ready = report.results.filter((row) => row.status === 'ready').flatMap((row) => row.evidence);
const leagues = [...new Set(ready.map((row) => row.leagueId))].sort((a, b) => a - b);
const captures = await Promise.all(leagues.map(async (leagueId) => {
  const raw = await readJson(resolve(values.captures, `${leagueId}.json`));
  const capture = electionCaptureSchema.parse(raw);
  if (capture.leagueId !== leagueId || !capture.complete) throw new Error(`Invalid/incomplete supporting snapshot for league ${leagueId}`);
  return { raw, capture };
}));
const prepared = prepareElectionCaptures(captures.map((row) => row.capture));
for (const winner of ready) {
  if (!prepared.evidence.some((row) => electionKey(row) === electionKey(winner) && row.winnerUserId === winner.winnerUserId
    && row.sourceURL === winner.sourceURL && row.winnerHref === winner.winnerHref && row.rowText === winner.rowText)) {
    throw new Error(`Reviewed winner no longer has unique matching source evidence: ${electionKey(winner)}`);
  }
}
const path = resolve(values.output);
await mkdir(dirname(path), { recursive: true });
const file = await open(path, 'wx');
try { await file.writeFile(`${JSON.stringify(captures.map((row) => row.raw), null, 2)}\n`); }
finally { await file.close(); }
console.log(JSON.stringify({ output: path, readyWinners: ready.length, completeCaptures: captures.length, leagueIds: leagues,
  preservedSourceRows: captures.reduce((total, row) => total + row.capture.rows.length, 0) }, null, 2));
