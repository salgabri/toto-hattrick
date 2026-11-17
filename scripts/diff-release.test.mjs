import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { diffReleases } from './diff-release.mjs';

function bundle(root, name, overrides = {}) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const data = {
    leagues: [{ country: 'Italy', champions: [{ season: 95, club: 'A', manager: null, userId: null }] }],
    cups: [], masters: [], seasonal: [],
    worldcup: { senior: [{ edition: 41, champion: 'Belgium', runnerUp: 'Sverige', coach: null, coachUserId: null, thirdFourthCoaches: [{}, {}] }], youth: [], regional: [] },
    managers: [], elections: [{}, {}],
    ...overrides,
  };
  for (const [file, value] of Object.entries(data)) writeFileSync(join(dir, `${file}.json`), JSON.stringify(value));
  return dir;
}

test('filling managers and coaches is a change, not a block; losing one blocks', () => {
  const root = mkdtempSync(join(tmpdir(), 'diff-release-'));
  try {
    const before = bundle(root, 'before');
    const filled = bundle(root, 'filled', {
      leagues: [{ country: 'Italy', champions: [{ season: 95, club: 'A', manager: 'TotoNovanta', userId: 9491504 }, { season: 96, club: 'B', manager: null, userId: null }] }],
      worldcup: { senior: [{ edition: 41, champion: 'Belgium', runnerUp: 'Sverige', coach: 'Balthazar-Boma', coachUserId: 12748823, thirdFourthCoaches: [{}, {}] }], youth: [], regional: [] },
      elections: [{}, {}, {}],
    });
    const forward = diffReleases(before, filled);
    assert.deepEqual([forward.added.length, forward.changed.length, forward.removed.length, forward.blocking], [1, 2, 0, []]);
    const backward = diffReleases(filled, before);
    assert.ok(backward.blocking.some(reason => reason.startsWith('title removed')));
    assert.ok(backward.blocking.some(reason => reason.startsWith('manager changed or lost league|Italy|S95')));
    assert.ok(backward.blocking.includes('elections shrank'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
