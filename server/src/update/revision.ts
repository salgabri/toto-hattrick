import { execFileSync } from 'node:child_process';
import { createHash, type Hash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const commandBufferLimit = 64 * 1024 * 1024;

function git(repositoryPath: string, args: string[]) {
  return execFileSync('git', args, {
    cwd: repositoryPath,
    windowsHide: true,
    maxBuffer: commandBufferLimit,
  });
}

function splitNull(bytes: Buffer) {
  if (bytes.length === 0) return [];
  if (bytes[bytes.length - 1] !== 0) throw new Error('invalid NUL-delimited Git output');
  const entries: Buffer[] = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0) continue;
    if (index > start) entries.push(bytes.subarray(start, index));
    start = index + 1;
  }
  return entries;
}

function frame(hash: Hash, label: string, value: Buffer) {
  const labelBytes = Buffer.from(label, 'utf8');
  const lengths = Buffer.allocUnsafe(8);
  lengths.writeUInt32BE(labelBytes.length, 0);
  lengths.writeUInt32BE(value.length, 4);
  hash.update(lengths);
  hash.update(labelBytes);
  hash.update(value);
}

/** A deterministic revision for a local checkout, including tracked and untracked work. */
export function localRevision(repositoryPath: string) {
  try {
    const root = resolve(repositoryPath);
    const head = git(root, ['rev-parse', '--verify', 'HEAD']).toString('utf8').trim();
    if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('invalid revision');

    const diff = git(root, [
      'diff', '--binary', '--full-index', '--no-color', '--no-ext-diff', '--no-textconv',
      '--no-renames', '--diff-algorithm=myers', 'HEAD', '--',
    ]);
    const untracked = splitNull(git(root, ['ls-files', '--others', '--exclude-standard', '-z']))
      .sort(Buffer.compare);
    if (diff.length === 0 && untracked.length === 0) return head;

    const fingerprint = createHash('sha256');
    frame(fingerprint, 'tracked-diff', diff);
    for (const pathBytes of untracked) {
      const pathText = pathBytes.toString('utf8');
      if (!Buffer.from(pathText, 'utf8').equals(pathBytes)) throw new Error('invalid UTF-8 path');
      const absolute = resolve(root, pathText);
      const fromRoot = relative(root, absolute);
      if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
        throw new Error('invalid untracked path');
      }
      const stat = lstatSync(absolute);
      frame(fingerprint, 'untracked-path', pathBytes);
      if (stat.isSymbolicLink()) {
        const targetDigest = createHash('sha256').update(readlinkSync(absolute), 'utf8').digest();
        frame(fingerprint, 'untracked-link', targetDigest);
      } else if (stat.isFile()) {
        const contentDigest = createHash('sha256').update(readFileSync(absolute)).digest();
        frame(fingerprint, 'untracked-file', contentDigest);
      } else {
        throw new Error('unsupported untracked entry');
      }
    }
    return `${head}-local-${fingerprint.digest('hex')}`;
  } catch {
    throw new Error('Could not fingerprint the update code revision');
  }
}

export function revision(repositoryPath: string, githubSha?: string) {
  return githubSha || localRevision(repositoryPath);
}
