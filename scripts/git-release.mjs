import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryPath = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataPrefix = 'web/public/data/';
const shaPattern = /^[a-f0-9]{40}$/;
const versionPattern = /^[a-f0-9]{64}$/;

function run(command, args, options = {}) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryPath,
      env: options.env ?? process.env,
      windowsHide: true,
      stdio: options.capture === false ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout?.on('data', chunk => stdout.push(chunk));
    child.stderr?.on('data', chunk => stderr.push(chunk));
    child.once('error', () => reject(new Error(`Could not start ${command}`)));
    child.once('close', code => {
      const out = Buffer.concat(stdout);
      const err = Buffer.concat(stderr).toString('utf8').trim();
      if (code === 0) done(out);
      else reject(new Error(err || `${command} failed with exit code ${code ?? 'unknown'}`));
    });
  });
}

const git = (args, cwd = repositoryPath, options = {}) => run('git', args, { cwd, ...options });
const text = bytes => bytes.toString('utf8').trim();

export function nullSeparated(bytes) {
  if (!bytes.length) return [];
  if (bytes.at(-1) !== 0) throw new Error('Git returned an invalid path list');
  return bytes.subarray(0, -1).toString('utf8').split('\0');
}

export function assertReleasePaths(paths) {
  if (!paths.length) throw new Error('The pending release did not change any tracked public data');
  for (const path of paths) {
    if (!path.startsWith(dataPrefix) || path === dataPrefix.slice(0, -1) || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error(`Git release contains a path outside ${dataPrefix}`);
    }
  }
  return paths;
}

export function assertReleaseAuthor(configured, trusted) {
  const validName = value => typeof value === 'string' && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
  const validEmail = value => typeof value === 'string' && /^[^\s@]+@[^\s@]+$/.test(value);
  if (!validName(configured.name) || !validEmail(configured.email))
    throw new Error('Automated Git publication requires an explicit valid user.name and user.email');
  if (configured.name !== trusted.name || configured.email.toLowerCase() !== trusted.email.toLowerCase())
    throw new Error('Git release identity differs from the trusted main author; verify Vercel membership before changing it');
}

async function validateReleaseAuthor() {
  const configured = {
    name: text(await git(['config', '--get', 'user.name'])),
    email: text(await git(['config', '--get', 'user.email'])),
  };
  const trusted = {
    name: text(await git(['config', '--get', 'hattrick.releaseAuthorName'])),
    email: text(await git(['config', '--get', 'hattrick.releaseAuthorEmail'])),
  };
  assertReleaseAuthor(configured, trusted);
  return trusted;
}

async function verifyCommitIdentity(cwd, commit, trusted) {
  for (const [nameFormat, emailFormat] of [['%an', '%ae'], ['%cn', '%ce']]) {
    assertReleaseAuthor({
      name: text(await git(['show', '-s', `--format=${nameFormat}`, commit], cwd)),
      email: text(await git(['show', '-s', `--format=${emailFormat}`, commit], cwd)),
    }, trusted);
  }
}

async function checkoutState() {
  const branch = text(await git(['branch', '--show-current']));
  if (branch !== 'main') throw new Error('Automated Git publication requires the clean local main branch');
  if ((await git(['status', '--porcelain=v1', '-z', '--untracked-files=all'])).length) {
    throw new Error('Automated Git publication stopped because the main checkout has local changes');
  }
  await git(['fetch', '--no-tags', 'origin', 'main']);
  const head = text(await git(['rev-parse', 'HEAD']));
  const upstream = text(await git(['rev-parse', 'origin/main']));
  if (!shaPattern.test(head) || !shaPattern.test(upstream)) throw new Error('Git returned an invalid main revision');
  const releaseAuthor = await validateReleaseAuthor();
  return { head, upstream, releaseAuthor };
}

async function strictGitPreflight() {
  const { head, upstream, releaseAuthor } = await checkoutState();
  if (head !== upstream) throw new Error('Local main must exactly match origin/main before publishing');
  return { head, releaseAuthor };
}

/** Recover a prior run that merged/deployed but stopped before updating its local receipt/checkout. */
export async function preflightGitRelease() {
  let { head, upstream } = await checkoutState();
  if (head !== upstream) {
    try { await git(['merge-base', '--is-ancestor', head, upstream]); }
    catch { throw new Error('Local and GitHub main have diverged; publication requires manual reconciliation'); }
    const dataChanges = await git(['diff', '--name-only', '-z', head, upstream, '--', 'web/public/data']);
    if (dataChanges.length) {
      const updateCli = join(repositoryPath, 'server', 'dist', 'scripts', 'update.js');
      try {
        await run(process.execPath, [updateCli, 'confirm-git', '--commit', upstream, '--timeout-ms', '600000'], {
          cwd: join(repositoryPath, 'server'), capture: false,
        });
      } catch {
        // Never overwrite this pending release with a new acquisition: it may already be serving
        // open clients even though its private publication receipt was not advanced. Once Vercel
        // serves this exact SHA, the next preflight confirms it and safely fast-forwards main.
        throw new Error('GitHub main contains an unconfirmed data release; fix or redeploy that exact Vercel commit, then retry');
      }
    }
    await git(['merge', '--ff-only', 'origin/main'], repositoryPath, { capture: false });
    ({ head, upstream } = await checkoutState());
  }
  if (head !== upstream) throw new Error('Local main must exactly match origin/main before publishing');
  return head;
}

async function changedPaths(worktree) {
  const tracked = nullSeparated(await git(['diff', '--name-only', '-z', '--'], worktree));
  const untracked = nullSeparated(await git(['ls-files', '--others', '--exclude-standard', '-z'], worktree));
  return [...new Set([...tracked, ...untracked])].sort();
}

export async function validateReleaseDiff(base, head = 'HEAD', cwd = repositoryPath) {
  for (const value of [base, head]) {
    await git(['rev-parse', '--verify', `${value}^{commit}`], cwd);
  }
  const commits = Number(text(await git(['rev-list', '--count', `${base}..${head}`], cwd)));
  if (commits !== 1) throw new Error('An automated archive branch must contain exactly one commit above main');
  const parent = text(await git(['rev-parse', `${head}^`], cwd));
  const baseSha = text(await git(['rev-parse', base], cwd));
  if (parent !== baseSha) throw new Error('The archive commit is not based on the current main branch');
  const paths = nullSeparated(await git(['diff', '--name-only', '-z', base, head, '--'], cwd));
  assertReleasePaths(paths);
  return { base: baseSha, head: text(await git(['rev-parse', head], cwd)), paths };
}

function releaseBranch(dataVersion) {
  const timestamp = new Date().toISOString().replaceAll(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `codex/archive-update-${timestamp}-${dataVersion.slice(0, 12)}`;
}

async function removeWorktree(path) {
  const fromRepository = relative(repositoryPath, path);
  if (!fromRepository.startsWith(`.update-work${sep}`)) throw new Error('Refusing to remove an unexpected worktree path');
  try { await git(['worktree', 'remove', '--force', path]); }
  finally { await rm(path, { recursive: true, force: true }); }
}

export async function publishGitRelease() {
  const { head: originalMain, releaseAuthor } = await strictGitPreflight();
  process.env.DOTENV_CONFIG_PATH ||= join(repositoryPath, 'server', '.env');
  const [{ configuredStore }, { acquireLease }, { exportGitRelease, confirmGitRelease }, { env }] = await Promise.all([
    import('../server/dist/update/runner.js'), import('../server/dist/update/lease.js'),
    import('../server/dist/update/gitRelease.js'), import('../server/dist/config/env.js'),
  ]);
  if (!env.UPDATE_PUBLIC_URL) throw new Error('Git/Vercel publication requires UPDATE_PUBLIC_URL');
  if (env.UPDATE_DEPLOY_PROVIDER !== 'vercel')
    throw new Error('Git publication requires UPDATE_DEPLOY_PROVIDER=vercel');
  if (!env.VERCEL_PROJECT_ID || !env.VERCEL_TOKEN)
    throw new Error('Exact Vercel Git confirmation requires VERCEL_PROJECT_ID and VERCEL_TOKEN');
  const store = configuredStore();
  const lease = await acquireLease(store);
  let branch;
  let releaseCommit;
  let mergeCommit;
  try {
    const worktreeRoot = join(repositoryPath, '.update-work', `git-release-${randomUUID()}`);
    await mkdir(dirname(worktreeRoot), { recursive: true });
    await git(['worktree', 'add', '--detach', worktreeRoot, originalMain]);
    let exported;
    try {
      exported = await exportGitRelease({ store, repositoryPath: worktreeRoot,
        outputDataDir: join(worktreeRoot, 'web', 'public', 'data'), lease });
      assertReleasePaths(await changedPaths(worktreeRoot));
      const manifest = JSON.parse(await readFile(join(worktreeRoot, 'web', 'public', 'data', 'manifest.json'), 'utf8'));
      if (!versionPattern.test(manifest.dataVersion) || manifest.dataVersion !== exported.dataVersion)
        throw new Error('Exported release has an invalid data version');
      branch = releaseBranch(manifest.dataVersion);
      await git(['add', '--all', '--', 'web/public/data'], worktreeRoot);
      const staged = nullSeparated(await git(['diff', '--cached', '--name-only', '-z', '--'], worktreeRoot));
      assertReleasePaths(staged);
      const commitEnvironment = { ...process.env,
        GIT_AUTHOR_NAME: releaseAuthor.name, GIT_AUTHOR_EMAIL: releaseAuthor.email,
        GIT_COMMITTER_NAME: releaseAuthor.name, GIT_COMMITTER_EMAIL: releaseAuthor.email };
      await git(['commit', '-m', `data: refresh archive ${new Date().toISOString().slice(0, 10)}`], worktreeRoot,
        { capture: false, env: commitEnvironment });
      releaseCommit = text(await git(['rev-parse', 'HEAD'], worktreeRoot));
      await verifyCommitIdentity(worktreeRoot, releaseCommit, releaseAuthor);
      await validateReleaseDiff(originalMain, releaseCommit, worktreeRoot);
      // Create an auditable no-fast-forward merge, then update the release branch and main in one
      // atomic remote transaction. A concurrent main change rejects both refs; force is never used.
      await git(['switch', '--detach', originalMain], worktreeRoot);
      await git(['merge', '--no-ff', '--no-edit', releaseCommit], worktreeRoot,
        { capture: false, env: commitEnvironment });
      mergeCommit = text(await git(['rev-parse', 'HEAD'], worktreeRoot));
      await verifyCommitIdentity(worktreeRoot, mergeCommit, releaseAuthor);
      await git(['diff', '--quiet', releaseCommit, mergeCommit, '--'], worktreeRoot);
      await lease.assertHeld();
      await git(['push', '--atomic', 'origin', `${releaseCommit}:refs/heads/${branch}`, `${mergeCommit}:refs/heads/main`], worktreeRoot, { capture: false });
    } finally {
      await removeWorktree(worktreeRoot);
    }
    if (!branch || !releaseCommit || !mergeCommit || !exported) throw new Error('The archive release and merge commits were not created');
    await git(['fetch', '--no-tags', 'origin', 'main']);
    if (text(await git(['rev-parse', 'origin/main'])) !== mergeCommit) throw new Error('GitHub main does not match the pushed merge commit');
    let confirmationError;
    try {
      await confirmGitRelease({ store, publicUrl: env.UPDATE_PUBLIC_URL, commit: mergeCommit,
        releaseId: exported.releaseId, lease, timeoutMs: 600_000,
        vercelProjectId: env.VERCEL_PROJECT_ID, vercelTeamId: env.VERCEL_TEAM_ID, vercelToken: env.VERCEL_TOKEN,
      });
    } catch (error) { confirmationError = error; }
    // Only a verified deployment may advance this checkout. On failure, leave it behind so the
    // next preflight must confirm the same pending release before any new acquisition can replace it.
    if (confirmationError) throw confirmationError;
    if ((await git(['status', '--porcelain=v1', '-z', '--untracked-files=all'])).length || text(await git(['branch', '--show-current'])) !== 'main') {
      throw new Error('GitHub was updated, but the local checkout changed during deployment; reconcile main before retrying');
    }
    await git(['merge', '--ff-only', 'origin/main'], repositoryPath, { capture: false });
    await git(['push', 'origin', '--delete', branch], repositoryPath, { capture: false }).catch(() => undefined);
    return { branch, releaseCommit, mergeCommit };
  } finally {
    await lease.release();
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'validate-diff') {
    if (args.length !== 2) throw new Error('Usage: git-release.mjs validate-diff <base> <head>');
    console.log(JSON.stringify(await validateReleaseDiff(args[0], args[1]), null, 2));
    return;
  }
  if (command === 'preflight' && args.length === 0) {
    console.log(JSON.stringify({ main: await preflightGitRelease(), ready: true }, null, 2));
    return;
  }
  if (command === 'publish' && args.length === 0) {
    console.log(JSON.stringify(await publishGitRelease(), null, 2));
    return;
  }
  throw new Error('Usage: git-release.mjs preflight | publish | validate-diff <base> <head>');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`[git-release] ${error instanceof Error ? error.message : 'Git publication failed'}`);
    process.exitCode = 1;
  });
}
