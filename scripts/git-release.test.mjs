import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { assertReleaseAuthor, assertReleasePaths, nullSeparated, validateReleaseDiff } from './git-release.mjs';

const exec = promisify(execFile);
const git = (root, ...args) => exec('git', args, { cwd: root, windowsHide: true });

test('parses Git NUL path lists without accepting truncated output', () => {
  assert.deepEqual(nullSeparated(Buffer.from('web/public/data/manifest.json\0web/public/data/versions/a/file.json\0')), [
    'web/public/data/manifest.json', 'web/public/data/versions/a/file.json',
  ]);
  assert.throws(() => nullSeparated(Buffer.from('web/public/data/manifest.json')), /invalid path list/);
});

test('allows only explicit public data paths', () => {
  assert.deepEqual(assertReleasePaths(['web/public/data/manifest.json']), ['web/public/data/manifest.json']);
  for (const path of ['server/.env', '.update-store/state/current.json', 'web/public/data', 'web/public/data/../private.db', 'web\\public\\data\\manifest.json']) {
    assert.throws(() => assertReleasePaths([path]), /outside web\/public\/data/);
  }
  assert.throws(() => assertReleasePaths([]), /did not change/);
});

test('requires the unattended Git author to match the trusted main identity', () => {
  const trusted = { name: 'Archive Owner', email: 'owner@example.test' };
  assert.doesNotThrow(() => assertReleaseAuthor({ name: 'Archive Owner', email: 'OWNER@example.test' }, trusted));
  assert.throws(() => assertReleaseAuthor({ name: 'Build Bot', email: 'bot@example.test' }, trusted), /differs from the trusted main author/);
  assert.throws(() => assertReleaseAuthor({ name: '', email: 'not-an-email' }, trusted), /explicit valid/);
});

test('validates one data-only commit and permits an auditable detached merge commit', async t => {
  const root = await mkdtemp(join(tmpdir(), 'git-release-script-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, 'init', '--initial-branch=main');
  await git(root, 'config', 'user.name', 'Release Test');
  await git(root, 'config', 'user.email', 'release-test@example.invalid');
  await writeFile(join(root, 'README.md'), 'base\n');
  await git(root, 'add', 'README.md');
  await git(root, 'commit', '-m', 'base');
  const base = (await git(root, 'rev-parse', 'HEAD')).stdout.trim();
  await mkdir(join(root, 'web', 'public', 'data'), { recursive: true });
  await writeFile(join(root, 'web', 'public', 'data', 'manifest.json'), '{}\n');
  await git(root, 'add', '--all', '--', 'web/public/data');
  await git(root, 'commit', '-m', 'data release');
  const release = (await git(root, 'rev-parse', 'HEAD')).stdout.trim();
  const validated = await validateReleaseDiff(base, release, root);
  assert.deepEqual(validated.paths, ['web/public/data/manifest.json']);
  await git(root, 'switch', '--detach', base);
  await git(root, 'merge', '--no-ff', '--no-edit', release);
  const parents = (await git(root, 'show', '-s', '--format=%P', 'HEAD')).stdout.trim().split(' ');
  assert.deepEqual(parents, [base, release]);
});
