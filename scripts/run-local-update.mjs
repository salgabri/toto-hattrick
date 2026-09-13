import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Task Scheduler entry point. No shell interpolation or credentials in arguments/task XML.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(arg => !['--publish', '--no-fetch'].includes(arg))) throw new Error('Supported options: --publish, --no-fetch');
const publishThroughGit = args.includes('--publish');
const updateArgs = args.filter(arg => arg !== '--publish');
const gitRelease = join(root, 'scripts', 'git-release.mjs');
const npmCli = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
const inheritedPath = process.env[pathKey];
const childEnv = {
  ...process.env,
  [pathKey]: inheritedPath
    ? `${dirname(process.execPath)}${delimiter}${inheritedPath}`
    : dirname(process.execPath),
};
const logs = join(root, '.update-work/logs');
await mkdir(logs, { recursive: true, mode: 0o700 });
const file = join(logs, `${new Date().toISOString().replaceAll(':', '-')}.log`);
const output = await open(file, 'wx', 0o600); await output.close();
const log = createWriteStream(file, { flags: 'a' });
const run = (label, script, options, cwd) => new Promise((done, reject) => {
  log.write(`[scheduler] ${label}: started\n`);
  let spawnFailed = false;
  let child;
  try {
    child = spawn(process.execPath, [script, ...options], {
      cwd,
      env: childEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    log.write(`[scheduler] ${label}: failed to start\n`);
    reject(new Error(`${label} failed`));
    return;
  }
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  child.once('error', () => {
    spawnFailed = true;
    log.write(`[scheduler] ${label}: failed to start\n`);
  });
  child.once('close', code => {
    if (spawnFailed) {
      reject(new Error(`${label} failed`));
    } else if (code === 0) {
      log.write(`[scheduler] ${label}: completed\n`);
      done();
    } else {
      const safeCode = Number.isInteger(code) ? String(code) : 'unavailable';
      log.write(`[scheduler] ${label}: failed with exit code ${safeCode}\n`);
      reject(new Error(`${label} failed`));
    }
  });
});
try {
  // Publication is deliberately fail-closed before CHPP is called: the unattended job may
  // only start from a clean local main that exactly matches GitHub.
  if (publishThroughGit) await run('Git release preflight', gitRelease, ['preflight'], root);
  // A scheduled data refresh must not silently deploy a broken incidental code edit.
  // Keep this preflight offline and complete before the updater calls CHPP.
  await run('typecheck preflight', npmCli, ['run', 'typecheck'], root);
  await run('test preflight', npmCli, ['test'], root);
  await run('archive updater', join(root, 'server/dist/scripts/update.js'), ['run', ...updateArgs], join(root, 'server'));
  if (publishThroughGit) await run('GitHub merge and Vercel verification', gitRelease, ['publish'], root);
} catch { process.exitCode = 1; }
finally { await new Promise(resolve => log.end(resolve)); console.log(`Archive update ${process.exitCode ? 'failed' : 'finished'}; log: ${file}`); }
