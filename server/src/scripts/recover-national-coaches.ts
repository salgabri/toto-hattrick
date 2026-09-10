import { mkdir, open, readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { applyNationalCoachRecovery, type NationalCoachRecoveryInput, type VerifiedNationalTrophyWinner } from '../sync/nationalCoachRecovery.js';
import defaultHistories from '../data/verified-national-coach-histories.json' with { type: 'json' };
import defaultWinners from '../data/verified-national-trophy-winners.json' with { type: 'json' };

async function main() {
  const { values } = parseArgs({ options: {
    histories: { type: 'string' }, verified: { type: 'string' }, report: { type: 'string' },
    apply: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Recover missing national trophy coaches: [--histories complete-histories.json] [--verified verified-winners.json] [--report new-report.json] [--apply]. Defaults to the committed verified-national-coach-histories.json and verified-national-trophy-winners.json. Read-only by default. No API, nationality lookup, election inference, or baking. Files contain an array or {histories:[...]} / {verifiedWinners:[...]}.');
    return;
  }
  const input: NationalCoachRecoveryInput = {};
  const read = async (path: string, field: string) => {
    const value = JSON.parse((await readFile(resolve(path), 'utf8')).replace(/^\uFEFF/, ''));
    const array = Array.isArray(value) ? value : value?.[field];
    if (!Array.isArray(array)) throw new Error(`${field} input must be an array or an object containing that array`);
    return array;
  };
  input.histories = values.histories ? await read(values.histories, 'histories') : defaultHistories;
  input.verifiedWinners = values.verified ? await read(values.verified, 'verifiedWinners') : defaultWinners as VerifiedNationalTrophyWinner[];
  const inputPaths = [values.histories ? resolve(values.histories) : fileURLToPath(new URL('../data/verified-national-coach-histories.json', import.meta.url)), values.verified ? resolve(values.verified) : fileURLToPath(new URL('../data/verified-national-trophy-winners.json', import.meta.url))];
  const startedAt = new Date().toISOString();
  const reportPath = resolve(values.report ?? resolve('../.scrape/national-winner-recovery', `${basename(inputPaths[0]!)}.${values.apply ? 'apply' : 'dry-run'}.${startedAt.replace(/[:.]/g, '-')}.report.json`));
  if (inputPaths.some((path) => path.toLowerCase() === reportPath.toLowerCase())) throw new Error('Report path must differ from input paths');
  await mkdir(dirname(reportPath), { recursive: true });
  const file = await open(reportPath, 'wx');
  try {
    const result = await applyNationalCoachRecovery(input, { apply: values.apply });
    await file.writeFile(`${JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), inputPaths, ...result }, null, 2)}\n`);
    console.log(`${values.apply ? 'Apply' : 'Dry run'}: ${JSON.stringify(result.counts)}`);
    console.log(`Evidence report: ${reportPath}`);
  } catch (error) {
    await file.writeFile(`${JSON.stringify({ startedAt, failedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
    throw error;
  } finally {
    await file.close();
    const { prisma } = await import('../db/client.js');
    await prisma.$disconnect();
  }
}
try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
