// Bundle only the TypeScript test/product modules, keeping installed packages external.
// This avoids tsx's os.userInfo call, which fails in some Windows sandbox sessions.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'qa/results/frontend-statistics.test.mjs');
await build({ entryPoints: [path.join(root, 'qa/frontend-statistics.test.mts')], outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
const run = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), outfile], { cwd: root, stdio: 'inherit', windowsHide: true });
if (run.error) throw run.error;
process.exitCode = run.status ?? 1;
