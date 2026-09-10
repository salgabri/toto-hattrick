import '../config/env.js';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { disconnectDb } from '../db/client.js';
import { applyVerifiedWinners, verifiedWinnerSchema } from '../sync/verifiedWinners.js';

// From server/: node --import tsx src/scripts/apply-verified-winners.ts --source src/data/verified-masters-winners.json
// Repeat --source to combine independently reviewed sources. Only --apply authorizes writes.
try {
  const { values } = parseArgs({ options: {
    source: { type: 'string', multiple: true }, apply: { type: 'boolean', default: false },
    report: { type: 'string' },
  } });
  if (!values.source?.length) throw new Error('Required: --source <verified-winners.json> [--source <more.json>] [--report <new.json>] [--apply]');
  const records = (await Promise.all(values.source.map(async (path) => {
    const parsed: unknown = JSON.parse((await readFile(resolve(path), 'utf8')).replace(/^\uFEFF/, ''));
    return z.array(verifiedWinnerSchema).parse(parsed);
  }))).flat();
  const sourcePaths = values.source.map((path) => resolve(path));
  const reportPath = values.report ? resolve(values.report) : undefined;
  if (reportPath && sourcePaths.some((path) => path.toLowerCase() === reportPath.toLowerCase())) {
    throw new Error('Source and report paths must differ.');
  }
  if (reportPath) await mkdir(dirname(reportPath), { recursive: true });
  // Reserve exclusively before mutation; never overwrite source data or a prior audit report.
  const reportFile = reportPath ? await open(reportPath, 'wx') : undefined;
  const startedAt = new Date().toISOString();
  try {
    const summary = await applyVerifiedWinners(records, { apply: values.apply });
    await reportFile?.writeFile(`${JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), sourcePaths, evidence: records, ...summary }, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    await reportFile?.writeFile(`${JSON.stringify({ startedAt, failedAt: new Date().toISOString(), sourcePaths,
      apply: values.apply, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
    throw error;
  } finally {
    await reportFile?.close();
  }
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
