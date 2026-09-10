// One offline entry point for the complete numerical regression audit.
// Requires Node 24 and an existing local database; never syncs or bakes data.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const suites = [
  { name: 'Database and static-data integrity', file: 'qa/data-integrity.ts', cwd: root },
  { name: 'Frontend statistics', file: 'qa/run-frontend-statistics.mjs', cwd: root },
  { name: 'JSON read API', file: 'qa/api-audit.ts', cwd: path.join(root, 'server') },
  { name: 'Historical cup winners versus retained sources', file: 'qa/verify-complete-early-cup-source-coverage.mjs', cwd: root },
];
const results = [];
for (const suite of suites) {
  console.log(`\n${suite.name}`);
  const started = Date.now();
  const run = spawnSync(process.execPath, [path.join(root, suite.file)], {
    cwd: suite.cwd, stdio: 'inherit', windowsHide: true,
  });
  results.push({ suite: suite.name, exitCode: run.status ?? 1, elapsedMs: Date.now() - started,
    ...(run.error ? { error: run.error.message } : {}) });
}
const passed = results.every(result => result.exitCode === 0);
mkdirSync(path.join(root, 'qa/results'), { recursive: true });
writeFileSync(path.join(root, 'qa/results/audit-summary.json'), JSON.stringify({
  generatedAt: new Date().toISOString(), passed, results,
}, null, 2) + '\n');
console.log(`\nNumerical audit: ${passed ? 'PASS' : 'FAIL'}`);
process.exitCode = passed ? 0 : 1;
