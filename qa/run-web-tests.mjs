/** Execute the existing browser-independent TS tests without tsx's Windows os.userInfo probe. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const qaRoot = resolve(root, 'qa');
const work = mkdtempSync(join(qaRoot, '.web-tests-'));
const files = ['tests/urlState.test.ts', 'tests/shareLink.test.ts', 'tests/snapshot.test.ts', 'tests/flags.test.ts', 'tests/nationalityJoin.test.ts', 'tests/nationalCompetitionRows.test.ts', 'src/aggregate/urlState.ts', 'src/aggregate/shareLink.ts', 'src/aggregate/filterParams.ts', 'src/aggregate/snapshot.ts', 'src/aggregate/flags.ts', 'src/aggregate/data.ts'];
try {
  writeFileSync(join(work, 'package.json'), '{"type":"module"}\n');
  for (const relative of files) {
    const target = join(work, relative.replace(/\.ts$/, '.js'));
    mkdirSync(dirname(target), { recursive: true });
    const source = readFileSync(join(root, 'web', relative), 'utf8');
    const output = ts.transpileModule(source, { fileName: relative, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    writeFileSync(target, output.replace(/(from\s+['"][^'"]+)\.ts(['"])/g, '$1.js$2'));
  }
  execFileSync(process.execPath, ['--test', ...files.filter((f) => f.startsWith('tests/')).map((f) => join(work, f.replace(/\.ts$/, '.js')))], { stdio: 'inherit' });
} finally {
  const exact = resolve(work);
  assert.equal(dirname(exact), qaRoot);
  assert.ok(basename(exact).startsWith('.web-tests-'));
  rmSync(exact, { recursive: true });
}
