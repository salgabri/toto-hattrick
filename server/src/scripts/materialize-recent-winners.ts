import { readFile, open, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { env } from '../config/env.js';
import { disconnectDb } from '../db/client.js';
import { backfillCups } from '../sync/backfillCups.js';

// Facts-only bounded CHPP job. It does not infer owners, resolve nationalities, or bake data.
try {
  const { values } = parseArgs({ options: {
    'max-calls': { type: 'string', default: '100' }, lookback: { type: 'string', default: '6' },
    'only-finals': { type: 'string' }, report: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Facts-only recent main-cup materialization: --max-calls 100 --lookback 6 [--only-finals exact-finals.json] [--report new-report.json]. Input list: [{"cupId":7,"season":90}]. Paths resolve from server/. Uses per-cup local current seasons; current plus lookback predecessors. Performs bounded CHPP calls and writes match/team facts only.');
  } else {
    const maxCalls = z.coerce.number().int().min(0).max(100).parse(values['max-calls']);
    const lookbackSeasons = z.coerce.number().int().min(0).parse(values.lookback);
    const onlyFinals = values['only-finals'] ? z.array(z.object({ cupId: z.number().int().positive(), season: z.number().int().positive() })).parse(
      JSON.parse((await readFile(resolve(values['only-finals']), 'utf8')).replace(/^\uFEFF/, '')),
    ) : undefined;
    const reportPath = values.report ? resolve(values.report) : undefined;
    if (reportPath && (reportPath.toLowerCase() === resolve(env.OAUTH_ACCESS_STASH).toLowerCase() || (values['only-finals'] && reportPath.toLowerCase() === resolve(values['only-finals']).toLowerCase()))) throw new Error('Report must differ from credential and input paths');
    if (reportPath) await mkdir(dirname(reportPath), { recursive: true });
    const reportFile = reportPath ? await open(reportPath, 'wx') : undefined;
    const startedAt = new Date().toISOString();
    try {
      const access = z.object({ token: z.string().min(1), tokenSecret: z.string().min(1) }).parse(JSON.parse(await readFile(env.OAUTH_ACCESS_STASH, 'utf8')));
      const options = { maxCalls, lookbackSeasons, onlyMain: true, attributeOwners: false, ...(onlyFinals ? { onlyFinals } : {}) };
      console.log(`Materializing recent main-cup facts only: max ${maxCalls} calls, lookback ${lookbackSeasons}${onlyFinals ? `, ${onlyFinals.length} exact finals` : ''}`);
      const result = await backfillCups(access, options);
      await reportFile?.writeFile(`${JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), options, ...result }, null, 2)}\n`);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      await reportFile?.writeFile(`${JSON.stringify({ startedAt, failedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
      throw error;
    } finally { await reportFile?.close(); }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally { await disconnectDb(); }
