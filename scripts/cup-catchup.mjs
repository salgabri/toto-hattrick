// Glue for the nightly name-only cup catch-up (docs/CUP_CATCHUP_PLAYBOOK.md). No CHPP calls, no
// browser, no archive writes: it only reads reports, captures and a review checkout, and writes
// the small private files the round needs. Every output path must be new, except merge-state.
//
//   node scripts/cup-catchup.mjs round-state --canonical <state.json> --report <materialize.json>... --out <round-state.json>
//   node scripts/cup-catchup.mjs merge-state --canonical <state.json> --from <round-state.json>
//   node scripts/cup-catchup.mjs history-targets --database <checkout.db> --attribution <report.json>... [--captured <capture>...] --out <targets.json>
//   node scripts/cup-catchup.mjs captures --input <capture>... --out <merged.json>
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** Clubs a materialize (or carry) report identified, by numeric team id. */
export function reportClubs(reports) {
  const clubs = new Set();
  for (const report of reports) for (const row of report.filled ?? report.finals ?? []) {
    if (Number.isSafeInteger(row.championTeamId) && row.championTeamId > 0) clubs.add(row.championTeamId);
  }
  return clubs;
}

/** The --backfill state without this round's clubs, so update:attribute checks exactly them. */
export function roundState(canonical, clubs) {
  return { teams: Object.fromEntries(Object.entries(canonical.teams ?? {}).filter(([teamId]) => !clubs.has(Number(teamId)))) };
}

/** Fold a round's checks back into the canonical state; the newer check of a club wins. */
export function mergeState(canonical, round) {
  const teams = { ...(canonical.teams ?? {}) };
  let added = 0, updated = 0;
  for (const [teamId, check] of Object.entries(round.teams ?? {})) {
    const prior = teams[teamId];
    if (!prior) added++;
    else if (Date.parse(prior.checkedAt) < Date.parse(check.checkedAt)) updated++;
    else continue;
    teams[teamId] = check;
  }
  return { state: { teams }, added, updated };
}

/** Latest club decision per cup title from update:attribute reports (a later report wins). */
export function cupDecisions(reports) {
  const decisions = new Map();
  for (const report of reports) for (const club of report.clubs ?? []) {
    if (club.target?.table !== 'CupChampion') continue;
    decisions.set(`${club.target.competitionId}:${club.target.season}`, { decision: club.decision, snapshot: club.snapshot ?? null });
  }
  return decisions;
}

/**
 * Clubs whose Club History must be read: a domestic cup title with a team id and no manager whose
 * latest attribution decision is `unresolved` (a bot or ownerless club, or a later takeover).
 * Deleted clubs (`account_gone`) keep "—"; clubs with a complete capture are replayed, not read again.
 */
export function historyTargets(rows, decisions, captured = new Set()) {
  const byTeam = new Map();
  for (const row of rows) {
    const found = decisions.get(`${row.cupId}:${row.season}`);
    if (found?.decision?.status !== 'unresolved' || captured.has(row.championTeamId)) continue;
    const team = found.snapshot?.team;
    const target = byTeam.get(row.championTeamId) ?? {
      teamId: row.championTeamId, kind: team?.isBot ? 'bot' : 'ownerless',
      leagueId: team?.leagueId > 0 ? team.leagueId : row.leagueId, club: team?.name || row.championTeamName, titles: [],
    };
    target.titles.push({ family: 'cup', competitionId: row.cupId, season: row.season, storedName: row.championTeamName });
    byTeam.set(row.championTeamId, target);
  }
  return [...byTeam.values()].sort((a, b) => a.teamId - b.teamId);
}

/** Club History records from .json (array or { histories }) or .jsonl text. */
export function parseCaptures(text) {
  const trimmed = text.replace(/^﻿/, '').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') || trimmed.startsWith('{"histories"')) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : parsed.histories;
  }
  return trimmed.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
}

/** One record per club: the latest capture wins, so a re-read replaces an older one. */
export function mergeCaptures(records) {
  const at = record => Date.parse(record.capturedAt ?? record.receivedAt ?? '') || 0;
  const latest = new Map();
  for (const record of records) {
    if (!Number.isSafeInteger(record?.teamId) || record.teamId <= 0 || !Array.isArray(record.pages)) throw new Error('A capture record lacks a team id or pages');
    const prior = latest.get(record.teamId);
    if (!prior || at(record) >= at(prior)) latest.set(record.teamId, record);
  }
  return [...latest.values()].sort((a, b) => a.teamId - b.teamId);
}

const readJson = path => JSON.parse(readFileSync(resolve(path), 'utf8').replace(/^﻿/, ''));
const writeNew = (path, value) => writeFileSync(resolve(path), `${JSON.stringify(value, null, 1)}\n`, { flag: 'wx' });

function main(argv) {
  const [command, ...rest] = argv;
  const { values } = parseArgs({ args: rest, options: {
    canonical: { type: 'string' }, report: { type: 'string', multiple: true }, out: { type: 'string' }, from: { type: 'string' },
    database: { type: 'string' }, attribution: { type: 'string', multiple: true }, captured: { type: 'string', multiple: true },
    input: { type: 'string', multiple: true },
  } });
  const need = (...names) => { for (const name of names) if (!values[name]) throw new Error(`${command} requires --${name}`); };
  switch (command) {
    case 'round-state': {
      need('canonical', 'report', 'out');
      const clubs = reportClubs(values.report.map(readJson));
      const state = roundState(readJson(values.canonical), clubs);
      writeNew(values.out, state);
      return { newClubs: clubs.size, kept: Object.keys(state.teams).length, out: resolve(values.out) };
    }
    case 'merge-state': {
      need('canonical', 'from');
      const canonical = resolve(values.canonical);
      const merged = mergeState(readJson(canonical), readJson(values.from));
      const backup = `${canonical}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      copyFileSync(canonical, backup);
      writeFileSync(canonical, `${JSON.stringify(merged.state, null, 1)}\n`);
      return { added: merged.added, updated: merged.updated, total: Object.keys(merged.state.teams).length, backup };
    }
    case 'history-targets': {
      need('database', 'attribution', 'out');
      const db = new DatabaseSync(resolve(values.database), { readOnly: true });
      let rows;
      try {
        rows = db.prepare(`SELECT cupId, season, championTeamId, championTeamName, leagueId FROM CupChampion
          WHERE championTeamId > 0 AND (championUserId IS NULL OR championUserId = 0) AND finalMatchId > 0 AND leagueId <> 0`).all();
      } finally { db.close(); }
      const missing = (values.captured ?? []).filter(path => !existsSync(resolve(path)));
      const captured = new Set((values.captured ?? []).filter(path => existsSync(resolve(path)))
        .flatMap(path => parseCaptures(readFileSync(resolve(path), 'utf8'))).filter(record => record.complete === true).map(record => Number(record.teamId)));
      const targets = historyTargets(rows, cupDecisions(values.attribution.map(readJson)), captured);
      writeNew(values.out, targets);
      return { clubs: targets.length, titles: targets.reduce((sum, target) => sum + target.titles.length, 0), alreadyCaptured: captured.size, missing, out: resolve(values.out) };
    }
    case 'captures': {
      need('input', 'out');
      const missing = values.input.filter(path => !existsSync(resolve(path)));
      const merged = mergeCaptures(values.input.filter(path => existsSync(resolve(path))).flatMap(path => parseCaptures(readFileSync(resolve(path), 'utf8'))));
      writeNew(values.out, merged);
      return { clubs: merged.length, complete: merged.filter(record => record.complete).length, missing, out: resolve(values.out) };
    }
    default: throw new Error('usage: cup-catchup.mjs round-state|merge-state|history-targets|captures [options]');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(main(process.argv.slice(2)), null, 1)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
