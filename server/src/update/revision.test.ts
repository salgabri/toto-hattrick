import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { localRevision, revision } from './revision.js';

function git(repositoryPath: string, args: string[]) {
  return execFileSync('git', args, { cwd: repositoryPath, windowsHide: true, stdio: 'pipe' });
}

async function repository() {
  const root = await mkdtemp(join(tmpdir(), 'hattrick-revision-'));
  git(root, ['init']);
  await writeFile(join(root, '.gitignore'), 'ignored.bin\n');
  await writeFile(join(root, 'tracked.txt'), 'initial\n');
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=Archive Test', '-c', 'user.email=archive@example.invalid', 'commit', '-m', 'initial']);
  return root;
}

test('localRevision fingerprints every relevant working-tree state deterministically', async () => {
  const root = await repository();
  try {
    const head = git(root, ['rev-parse', '--verify', 'HEAD']).toString('utf8').trim();
    assert.equal(localRevision(root), head);
    assert.equal(localRevision(root), head);

    await writeFile(join(root, 'tracked.txt'), 'edited\n');
    const trackedEdit = localRevision(root);
    assert.match(trackedEdit, new RegExp(`^${head}-local-[a-f0-9]{64}$`));
    assert.equal(localRevision(root), trackedEdit);

    await writeFile(join(root, 'tracked.txt'), 'initial\n');
    assert.equal(localRevision(root), head);
    await unlink(join(root, 'tracked.txt'));
    assert.notEqual(localRevision(root), head);
    await writeFile(join(root, 'tracked.txt'), 'initial\n');
    assert.equal(localRevision(root), head);

    await writeFile(join(root, 'staged.txt'), 'staged\n');
    git(root, ['add', 'staged.txt']);
    const staged = localRevision(root);
    assert.notEqual(staged, head);
    git(root, ['reset', '--', 'staged.txt']);
    await unlink(join(root, 'staged.txt'));
    assert.equal(localRevision(root), head);

    await writeFile(join(root, 'ignored.bin'), Buffer.from([0, 1, 2, 3]));
    assert.equal(localRevision(root), head);

    await writeFile(join(root, 'untracked.bin'), Buffer.from([0, 255, 1, 0, 2]));
    const binaryA = localRevision(root);
    assert.notEqual(binaryA, head);
    assert.equal(localRevision(root), binaryA);
    await writeFile(join(root, 'untracked.bin'), Buffer.from([0, 255, 1, 0, 3]));
    const binaryB = localRevision(root);
    assert.notEqual(binaryB, binaryA);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('revision preserves a hosted SHA without reading the local checkout', () => {
  assert.equal(revision('missing-repository', 'hosted-sha'), 'hosted-sha');
});

test('localRevision fails closed outside a Git repository', () => {
  assert.throws(() => localRevision(tmpdir()), /Could not fingerprint the update code revision/);
});
