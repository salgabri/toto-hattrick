import { open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ChppRequestError, configureChppRuntime, isChppBudgetError } from '../chpp/client.js';
import { fetchTeamDetails } from '../chpp/endpoints.js';
import type { HistoricalClubHistory } from '../sync/historicalWinners.js';
import { ownerSnapshot } from '../update/attribution.js';
import { annotateClubHistories, clubsNeedingState } from '../update/clubHistoryState.js';
import { authorizedToken } from '../update/runner.js';

const usage = `Add CHPP club state (teamdetails 3.6: current owner and FoundedDate) to a Club History capture.

  npm run annotate:club-histories -w server -- --input <histories.json> --output <new.json> [--max-calls N]

Reads only the clubs whose tenure credit names their last recorded owner: Club History never records
an owner leaving, and recover:historical-winners holds those credits as unverified until the capture
carries this state. Paths resolve from server/. The output is created exclusively.`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { input: { type: 'string' }, output: { type: 'string' }, 'max-calls': { type: 'string' }, help: { type: 'boolean', short: 'h', default: false } },
    allowPositionals: false,
  });
  if (values.help) { console.log(usage); return; }
  if (!values.input || !values.output) throw new Error(`--input and --output are required.\n\n${usage}`);
  const raw = JSON.parse((await readFile(resolve(values.input), 'utf8')).replace(/^﻿/, '')) as unknown;
  const histories = (Array.isArray(raw) ? raw : raw && typeof raw === 'object' && 'histories' in raw ? raw.histories : undefined) as HistoricalClubHistory[] | undefined;
  if (!Array.isArray(histories)) throw new Error('Input must be a history array or an object containing a histories array.');
  const needed = clubsNeedingState(histories).length;
  const maxCalls = values['max-calls'] === undefined ? needed + 10 : Number(values['max-calls']);
  if (!Number.isSafeInteger(maxCalls) || maxCalls < needed) throw new Error(`--max-calls must cover the ${needed} clubs that need CHPP state`);
  // Reserve the output first so a bad path never wastes CHPP calls.
  const output = await open(resolve(values.output), 'wx');
  const runtime = configureChppRuntime({ maxCalls, pacingMs: 1000, maxRetries: 1 });
  try {
    const token = await authorizedToken();
    // A failed club keeps no state (its credits stay unverified); credentials or budget stop the run.
    const result = await annotateClubHistories(histories, async (teamId) => {
      try { return ownerSnapshot(await fetchTeamDetails(token, teamId), teamId); } catch (error) {
        if (isChppBudgetError(error) || (error instanceof ChppRequestError && ['authentication', 'forbidden', 'rate_limit'].includes(error.category))) throw error;
        return null;
      }
    });
    await output.writeFile(`${JSON.stringify(result.histories)}\n`);
    console.log(JSON.stringify({ ...result.summary, calls: runtime.stats().calls, output: resolve(values.output) }));
  } finally {
    runtime.dispose();
    await output.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
