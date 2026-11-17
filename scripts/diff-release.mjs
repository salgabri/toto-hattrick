// Compare a run's packaged public data with the release it would replace (read-only).
//   node scripts/diff-release.mjs <run workspace, e.g. .update-work/run-XXXX>
// Prints which bundles changed and every added / changed / removed title, coach and election count.
// Exit code 3 when a title disappears or a named manager/coach changes or vanishes: stop, don't publish.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUNDLES = ['leagues', 'cups', 'masters', 'seasonal', 'managers', 'worldcup', 'elections'];

export function titleRows(dir) {
  const load = name => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
  const rows = new Map();
  const add = (key, value) => rows.set(key, value);
  const who = (name, id) => (id ? `${name ?? '?'}#${id}` : '—');
  for (const l of load('leagues')) for (const c of l.champions) add(`league|${l.country}|S${c.season}`, { club: c.club, manager: who(c.manager, c.userId) });
  for (const l of load('cups')) for (const cup of l.cups) for (const w of cup.winners) add(`cup|${l.country}|${cup.cupName} (${cup.cupId})|S${w.season}`, { club: w.club, manager: who(w.manager, w.userId) });
  for (const m of load('masters')) add(`masters|S${m.season}`, { club: m.club, manager: who(m.manager, m.userId) });
  for (const s of load('seasonal')) for (const w of s.winners) add(`seasonal|${s.cupName} (${s.cupId})|S${w.season}`, { club: w.club, manager: who(w.manager, w.userId) });
  const podium = e => ({ club: `${e.champion ?? '—'} / ${e.runnerUp ?? '—'}`, manager: [who(e.coach, e.coachUserId), who(e.runnerUpCoach, e.runnerUpCoachUserId),
    ...(e.thirdFourthCoaches ?? []).map(c => who(c.name, c.userId))].join(' / ') });
  const wc = load('worldcup');
  for (const k of ['senior', 'youth']) for (const e of wc[k]) add(`worldcup-${k}|E${e.edition}`, podium(e));
  for (const r of wc.regional) for (const s of r.seasons) add(`regional|${r.cupName}${r.isYouth ? ' U21' : ''} (${r.cupId})|S${s.season}`, podium(s));
  return { rows, elections: load('elections').length, managers: load('managers').length };
}

export function diffReleases(oldDir, newDir) {
  const before = titleRows(oldDir), after = titleRows(newDir);
  const out = { added: [], changed: [], removed: [], blocking: [], elections: [before.elections, after.elections], managers: [before.managers, after.managers] };
  for (const [key, value] of after.rows) {
    const old = before.rows.get(key);
    if (!old) { out.added.push(`${key}: ${value.club} | ${value.manager}`); continue; }
    if (old.club === value.club && old.manager === value.manager) continue;
    out.changed.push(`${key}: ${old.club} | ${old.manager}  →  ${value.club} | ${value.manager}`);
    const oldNames = old.manager.split(' / '), newNames = value.manager.split(' / ');
    if (old.club !== value.club && !old.club.includes('—')) out.blocking.push(`winner changed ${key}`);
    oldNames.forEach((name, i) => { if (name !== '—' && newNames[i] !== name && !(newNames[i] ?? '').endsWith(`#${name.split('#')[1]}`)) out.blocking.push(`manager changed or lost ${key}`); });
  }
  for (const key of before.rows.keys()) if (!after.rows.has(key)) { out.removed.push(key); out.blocking.push(`title removed ${key}`); }
  if (after.elections < before.elections) out.blocking.push('elections shrank');
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const run = process.argv[2];
  if (!run) { console.error('usage: node scripts/diff-release.mjs <run workspace>'); process.exit(1); }
  const version = dir => JSON.parse(readFileSync(join(run, dir, 'manifest.json'), 'utf8')).dataVersion;
  const oldDir = join(run, 'previous-release', 'data', 'versions', version(join('previous-release', 'data')));
  const newDir = join(run, 'packaged-data', 'versions', version('packaged-data'));
  const bundles = Object.fromEntries(BUNDLES.map(name => [name, readFileSync(join(oldDir, `${name}.json`)).equals(readFileSync(join(newDir, `${name}.json`))) ? 'identical' : 'differs']));
  const diff = diffReleases(oldDir, newDir);
  console.log(JSON.stringify({ bundles, counts: { added: diff.added.length, changed: diff.changed.length, removed: diff.removed.length },
    elections: diff.elections, managers: diff.managers, blocking: diff.blocking }, null, 1));
  for (const label of ['added', 'changed', 'removed']) if (diff[label].length) console.log(`\n--- ${label}\n${diff[label].join('\n')}`);
  if (diff.blocking.length) process.exitCode = 3;
}
