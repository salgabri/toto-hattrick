import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cupDecisions, historyTargets, mergeCaptures, mergeState, parseCaptures, reportClubs, roundState } from './cup-catchup.mjs';

test('a round state drops exactly the clubs the round identified, and merging back keeps the newer check', () => {
  const canonical = { teams: { 1: { checkedAt: '2026-11-18T10:00:00Z', outcome: 'account_gone' }, 2: { checkedAt: '2026-11-18T10:00:00Z', outcome: 'unresolved' } } };
  const clubs = reportClubs([{ filled: [{ championTeamId: 2 }, { championTeamId: 3 }] }, { finals: [{ championTeamId: 3 }, { championTeamId: 0 }] }]);
  assert.deepEqual([...clubs].sort(), [2, 3]);
  assert.deepEqual(roundState(canonical, clubs), { teams: { 1: canonical.teams[1] } });
  const round = { teams: { 1: { checkedAt: '2026-11-17T00:00:00Z', outcome: 'stale' }, 2: { checkedAt: '2026-11-19T01:00:00Z', outcome: 'unresolved' }, 3: { checkedAt: '2026-11-19T01:00:00Z', outcome: 'account_gone' } } };
  const merged = mergeState(canonical, round);
  assert.equal(merged.added, 1);
  assert.equal(merged.updated, 1);
  assert.equal(merged.state.teams[1].outcome, 'account_gone');
  assert.equal(merged.state.teams[2].checkedAt, '2026-11-19T01:00:00Z');
});

test('Club History targets are the unresolved, uncaptured clubs of materialized titles', () => {
  const reports = [
    { clubs: [
      { target: { table: 'CupChampion', competitionId: 7, season: 1 }, decision: { status: 'account_gone' } },
      { target: { table: 'CupChampion', competitionId: 7, season: 2 }, decision: { status: 'unresolved', reason: 'The club is a bot now' },
        snapshot: { team: { teamId: 20, name: 'Bot FC Now', leagueId: 4, isBot: true } } },
      { target: { table: 'LeagueChampion', competitionId: 4, season: 2 }, decision: { status: 'unresolved' } },
    ] },
    // A later report wins: club 30 was unresolved, then credited.
    { clubs: [{ target: { table: 'CupChampion', competitionId: 8, season: 5 }, decision: { status: 'unresolved' } }] },
    { clubs: [{ target: { table: 'CupChampion', competitionId: 8, season: 5 }, decision: { status: 'attribute' } }] },
  ];
  const rows = [
    { cupId: 7, season: 1, championTeamId: 10, championTeamName: 'Gone FC', leagueId: 4 },
    { cupId: 7, season: 2, championTeamId: 20, championTeamName: 'Old Name', leagueId: 4 },
    { cupId: 9, season: 3, championTeamId: 20, championTeamName: 'Old Name', leagueId: 4 },
    { cupId: 8, season: 5, championTeamId: 30, championTeamName: 'Credited', leagueId: 5 },
    { cupId: 7, season: 6, championTeamId: 40, championTeamName: 'Unchecked', leagueId: 4 },
  ];
  const decisions = cupDecisions(reports);
  assert.deepEqual(historyTargets(rows, decisions), [{ teamId: 20, kind: 'bot', leagueId: 4, club: 'Bot FC Now',
    titles: [{ family: 'cup', competitionId: 7, season: 2, storedName: 'Old Name' }] }]);
  assert.deepEqual(historyTargets(rows, decisions, new Set([20])), []);
});

test('captures parse from JSON arrays, { histories } and JSONL, and the latest capture of a club wins', () => {
  const a = { teamId: 5, pages: [{ page: 1, rows: [] }], capturedAt: '2026-11-18T10:00:00Z', complete: true };
  const b = { teamId: 5, pages: [], capturedAt: '2026-11-19T10:00:00Z', complete: false };
  const c = { teamId: 3, pages: [], receivedAt: '2026-11-19T11:00:00Z' };
  assert.deepEqual(parseCaptures(`﻿${JSON.stringify([a])}`), [a]);
  assert.deepEqual(parseCaptures(JSON.stringify({ histories: [b] })), [b]);
  assert.deepEqual(parseCaptures(`${JSON.stringify(a)}\n${JSON.stringify(c)}\n`), [a, c]);
  assert.deepEqual(parseCaptures('  '), []);
  assert.deepEqual(mergeCaptures([a, c, b]), [c, b]);
  assert.deepEqual(mergeCaptures([b, a]), [b]);
  assert.throws(() => mergeCaptures([{ teamId: 0, pages: [] }]), /lacks a team id/);
});
