import '../config/env.js';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { disconnectDb } from '../db/client.js';
import { applyReviewedCorrections } from '../sync/reviewedCorrections.js';

// Intentionally no --source or --overwrite: only this committed, reviewed exception manifest.
const manifestPath = fileURLToPath(new URL('../../src/data/reviewed-winner-corrections.json', import.meta.url));
try {
  const { values } = parseArgs({ options: {
    apply: { type: 'boolean', default: false }, report: { type: 'string' },
  } });
  if (values.apply && !values.report) throw new Error('--apply requires --report <new.json> to retain the correction audit');
  const records = JSON.parse((await readFile(manifestPath, 'utf8')).replace(/^\uFEFF/, ''));
  const reportPath = values.report ? resolve(values.report) : undefined;
  if (reportPath?.toLowerCase() === manifestPath.toLowerCase()) throw new Error('Report must not replace the manifest');
  if (reportPath) await mkdir(dirname(reportPath), { recursive: true });
  // Reserve the audit file before mutation, refusing to overwrite any existing report.
  const reportFile = reportPath ? await open(reportPath, 'wx') : undefined;
  const startedAt = new Date().toISOString();
  try {
    const summary = await applyReviewedCorrections(records, { apply: values.apply });
    await reportFile?.writeFile(`${JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), manifestPath, ...summary }, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
    if (summary.conflicts) process.exitCode = 1;
  } catch (error) {
    await reportFile?.writeFile(`${JSON.stringify({ startedAt, failedAt: new Date().toISOString(), manifestPath,
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
