import '../config/env.js';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { electionCaptureSchema, electionEvidenceSchema, recoverElectionCaptures, recoverElections } from '../sync/electionRecovery.js';

try {
  const { values } = parseArgs({ options: {
    input: { type: 'string', multiple: true }, report: { type: 'string' }, apply: { type: 'boolean', default: false },
  } });
  if (!values.input) throw new Error('Required: --input <observed-election-evidence.json> [--report <new.json>] [--apply]');
  const inputPaths = values.input.map((path) => resolve(path));
  const parsed: unknown[] = (await Promise.all(inputPaths.map(async (path) => {
    const value: unknown = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
    return Array.isArray(value) ? value : [value];
  }))).flat();
  const captures = parsed.every((value) => value && typeof value === 'object' && 'rows' in value)
    ? z.array(electionCaptureSchema).parse(parsed) : null;
  const evidence = captures ? null : z.array(electionEvidenceSchema).parse(parsed);
  const startedAt = new Date().toISOString();
  const reportPath = resolve(values.report ?? `${inputPaths[0]}.${values.apply ? 'apply' : 'dry-run'}.${startedAt.replace(/[:.]/g, '-')}.report.json`);
  if (inputPaths.some((path) => path.toLowerCase() === reportPath.toLowerCase())) throw new Error('Input and report paths must differ');
  await mkdir(dirname(reportPath), { recursive: true });
  const report = await open(reportPath, 'wx');
  try {
    const result = captures ? await recoverElectionCaptures(captures, { apply: values.apply })
      : await recoverElections(evidence!, { apply: values.apply });
    await report.writeFile(`${JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), inputPaths, ...result }, null, 2)}\n`);
    console.log(JSON.stringify({ ...result.counts, dryRun: result.dryRun, reportPath }, null, 2));
  } catch (error) {
    await report.writeFile(`${JSON.stringify({ startedAt, inputPaths, apply: values.apply, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
    throw error;
  } finally { await report.close(); }
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
