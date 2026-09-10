import { mkdir, open, readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { applyHistoricalWinners, type HistoricalClubHistory } from '../sync/historicalWinners.js';

const usage = `Recover missing winner identities from saved Hattrick club-history evidence.

  npm run recover:historical-winners -w server -- --input scrape/histories.json [--report scrape/report.json] [--apply]

Without --apply, only reads the database and writes the evidence report.
Paths are relative to server/ when run through the workspace command.
Input: an array of HistoricalClubHistory records, or { "histories": [...] }.
Reports are created exclusively: an existing report is never overwritten.
No Hattrick calls, nationality lookup, or baking is performed.`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' }, report: { type: 'string' },
      apply: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });
  if (values.help) { console.log(usage); return; }
  if (!values.input) throw new Error(`--input is required.\n\n${usage}`);
  const inputPath = resolve(values.input);
  const raw = JSON.parse((await readFile(inputPath, 'utf8')).replace(/^\uFEFF/, '')) as unknown;
  const histories = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' && 'histories' in raw ? raw.histories : undefined);
  if (!Array.isArray(histories)) throw new Error('Input must be a history array or an object containing a histories array.');
  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[:.]/g, '-');
  const reportPath = values.report ? resolve(values.report) : resolve(dirname(inputPath), `${basename(inputPath)}.${values.apply ? 'apply' : 'dry-run'}.${stamp}.report.json`);
  if (inputPath.toLowerCase() === reportPath.toLowerCase()) throw new Error('Input and report paths must differ.');
  await mkdir(dirname(reportPath), { recursive: true });
  // Reserve the report before any database mutation, so a bad output path cannot lose the audit.
  const reportFile = await open(reportPath, 'wx');
  try {
    const result = await applyHistoricalWinners(histories as HistoricalClubHistory[], { apply: values.apply });
    await reportFile.writeFile(`${JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), inputPath, histories: histories.length, ...result }, null, 2)}\n`);
    console.log(`${values.apply ? 'Apply' : 'Dry run'}: ${JSON.stringify(result.counts)}`);
    console.log(`Evidence report: ${reportPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await reportFile.writeFile(`${JSON.stringify({ startedAt, failedAt: new Date().toISOString(), inputPath, apply: values.apply, error: message }, null, 2)}\n`);
    throw error;
  } finally {
    await reportFile.close();
    const { prisma } = await import('../db/client.js');
    await prisma.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
