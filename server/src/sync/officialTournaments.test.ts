import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { XMLParser } from 'fast-xml-parser';
import evidence from '../data/recovered-cup-final-evidence.json' with { type: 'json' };
import { parseTournamentFixtures } from '../schemas/index.js';
import { parseCupFinalMatch } from '../schemas/cupFinal.js';
import { matchEvidenceKey } from '../update/evidence.js';
import {
  deriveTournamentPodium,
  selectTournamentResult,
  tournamentMatchDetailsAgree,
  type TournamentTiebreakerEvidence,
} from './officialTournaments.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
});

function fixtures(name: string) {
  const xml = readFileSync(new URL(`../../samples/${name}`, import.meta.url), 'utf8');
  return parseTournamentFixtures(xmlParser.parse(xml)).matches;
}

test('derives the Supporter Week champion, runner-up, and semifinal losers from official fixtures', () => {
  assert.deepEqual(
    deriveTournamentPodium(fixtures('tournamentfixtures-1.1-supporter-current.xml')),
    {
      finalMatchId: 41_825_525,
      finalRound: 16,
      finalDate: new Date('2026-07-19T10:00:00.000Z'),
      champion: { teamId: 694_577, teamName: 'Craiova Champions' },
      runnerUp: { teamId: 2_062_555, teamName: 'Sabana Westpunt Iguanas' },
      thirdFourth: [
        { teamId: 74_054, teamName: 'Iso KyrPa' },
        { teamId: 2_065_842, teamName: 'Estudiantes Lusaka' },
      ],
    },
  );
});

test('derives an international final and both bronze teams from official Africa fixtures', () => {
  assert.deepEqual(
    deriveTournamentPodium(fixtures('tournamentfixtures-1.1-africa-s41.xml')),
    {
      finalMatchId: 41_231_363,
      finalRound: 13,
      finalDate: new Date('2026-06-19T21:00:00.000Z'),
      champion: { teamId: 3_198, teamName: 'Senegal' },
      runnerUp: { teamId: 3_208, teamName: "Côte d'Ivoire" },
      thirdFourth: [
        { teamId: 3_309, teamName: 'Zambia' },
        { teamId: 3_210, teamName: 'Cabo Verde' },
      ],
    },
  );
});

test('ignores higher-numbered group rounds when identifying the U21 World Cup knockout final', () => {
  const podium = deriveTournamentPodium(fixtures('tournamentfixtures-1.1-u21worldcup-s40.xml'));
  assert.deepEqual(podium, {
    finalMatchId: 41_695_383,
    finalRound: 27,
    finalDate: new Date('2026-07-17T20:00:00.000Z'),
    champion: { teamId: 3_064, teamName: 'U21 Suomi' },
    runnerUp: { teamId: 3_079, teamName: 'U21 Schweiz' },
    thirdFourth: [
      { teamId: 3_101, teamName: 'U21 Chinese Taipei' },
      { teamId: 3_061, teamName: 'U21 România' },
    ],
  });
});

test('does not invent a champion while the real tournament fixture set has no playoff final', () => {
  assert.equal(
    deriveTournamentPodium(fixtures('tournamentfixtures-1.1-u21europe-s41.xml')),
    null,
  );
});

test('rejects an unfinished, drawn, or ambiguous highest playoff round', () => {
  const base = {
    matchId: 1,
    homeTeamId: 10,
    homeTeamName: 'Home',
    awayTeamId: 20,
    awayTeamName: 'Away',
    matchDate: new Date('2026-09-13T12:00:00.000Z'),
    matchType: 51,
    round: 2,
    group: 0,
    status: 2,
    homeGoals: 2,
    awayGoals: 1,
  };

  assert.equal(deriveTournamentPodium([{ ...base, status: 0 }]), null);
  assert.equal(deriveTournamentPodium([{ ...base, homeGoals: 1, awayGoals: 1 }]), null);
  assert.equal(deriveTournamentPodium([base, { ...base, matchId: 2 }]), null);
});

test('accepts an explicit retained tiebreaker only when every fixture fact agrees', () => {
  const semifinalDate = new Date('2026-09-06T12:00:00.000Z');
  const finalDate = new Date('2026-09-13T12:00:00.000Z');
  const semifinalOne = {
    matchId: 1,
    homeTeamId: 10,
    homeTeamName: 'First finalist',
    awayTeamId: 30,
    awayTeamName: 'Bronze one',
    matchDate: semifinalDate,
    matchType: 51,
    round: 1,
    group: 0,
    status: 2,
    homeGoals: 2,
    awayGoals: 0,
  };
  const semifinalTwo = {
    ...semifinalOne,
    matchId: 2,
    homeTeamId: 40,
    homeTeamName: 'Bronze two',
    awayTeamId: 20,
    awayTeamName: 'Second finalist',
    homeGoals: 0,
    awayGoals: 1,
  };
  const final = {
    ...semifinalOne,
    matchId: 3,
    homeTeamId: 10,
    homeTeamName: 'First finalist',
    awayTeamId: 20,
    awayTeamName: 'Second finalist',
    matchDate: finalDate,
    round: 2,
    homeGoals: 2,
    awayGoals: 2,
  };
  const evidence: TournamentTiebreakerEvidence = {
    matchId: final.matchId,
    matchType: final.matchType,
    matchDate: final.matchDate,
    homeTeamId: final.homeTeamId,
    homeTeamName: final.homeTeamName,
    awayTeamId: final.awayTeamId,
    awayTeamName: final.awayTeamName,
    homeGoals: final.homeGoals,
    awayGoals: final.awayGoals,
    winnerTeamId: final.awayTeamId,
    evidenceRef: matchEvidenceKey(final.matchId),
  };

  assert.equal(deriveTournamentPodium([semifinalOne, semifinalTwo, final]), null,
    'a tied final remains unproven without explicit evidence');
  assert.deepEqual(deriveTournamentPodium([semifinalOne, semifinalTwo, final], [evidence]), {
    finalMatchId: 3,
    finalRound: 2,
    finalDate,
    champion: { teamId: 20, teamName: 'Second finalist' },
    runnerUp: { teamId: 10, teamName: 'First finalist' },
    thirdFourth: [
      { teamId: 30, teamName: 'Bronze one' },
      { teamId: 40, teamName: 'Bronze two' },
    ],
    tiebreakerEvidenceRefs: [matchEvidenceKey(3)],
  });
  assert.equal(deriveTournamentPodium([semifinalOne, semifinalTwo, final], [{ ...evidence, homeGoals: 3 }]), null,
    'score-mismatched evidence is inert');
  assert.equal(deriveTournamentPodium([semifinalOne, semifinalTwo, final], [evidence, evidence]), null,
    'duplicate evidence is ambiguous rather than silently preferred');
});

test('the same explicit evidence seam resolves a tied semifinal and preserves its losing bronze team', () => {
  const tiedSemi = {
    matchId: 11,
    homeTeamId: 10,
    homeTeamName: 'First finalist',
    awayTeamId: 30,
    awayTeamName: 'Bronze one',
    matchDate: new Date('2026-09-06T12:00:00.000Z'),
    matchType: 51,
    round: 1,
    group: 0,
    status: 2,
    homeGoals: 1,
    awayGoals: 1,
  };
  const otherSemi = { ...tiedSemi, matchId: 12, homeTeamId: 40, homeTeamName: 'Bronze two',
    awayTeamId: 20, awayTeamName: 'Second finalist', homeGoals: 0, awayGoals: 2 };
  const final = { ...tiedSemi, matchId: 13, awayTeamId: 20, awayTeamName: 'Second finalist',
    matchDate: new Date('2026-09-13T12:00:00.000Z'), round: 2, homeGoals: 3, awayGoals: 1 };
  const evidence: TournamentTiebreakerEvidence = {
    matchId: tiedSemi.matchId,
    matchType: tiedSemi.matchType,
    matchDate: tiedSemi.matchDate,
    homeTeamId: tiedSemi.homeTeamId,
    homeTeamName: tiedSemi.homeTeamName,
    awayTeamId: tiedSemi.awayTeamId,
    awayTeamName: tiedSemi.awayTeamName,
    homeGoals: tiedSemi.homeGoals,
    awayGoals: tiedSemi.awayGoals,
    winnerTeamId: tiedSemi.homeTeamId,
    evidenceRef: matchEvidenceKey(tiedSemi.matchId),
  };

  assert.deepEqual(deriveTournamentPodium([tiedSemi, otherSemi, final], [evidence])?.thirdFourth, [
    { teamId: 30, teamName: 'Bronze one' },
    { teamId: 40, teamName: 'Bronze two' },
  ]);
});

test('real legacy penalty matchdetails can pass the identity gate but never implies a Tournament winner', () => {
  const retained = evidence.entries.find(entry => entry.summary.matchId === 23_440_755)!;
  const match = parseCupFinalMatch(retained.rawMatch);
  assert.notEqual(match.homeGoals, null);
  assert.notEqual(match.awayGoals, null);
  const fixture = {
    matchId: match.matchId,
    homeTeamId: match.homeTeamId,
    homeTeamName: match.homeTeamName,
    awayTeamId: match.awayTeamId,
    awayTeamName: match.awayTeamName,
    matchDate: new Date(`${match.matchDate.replace(' ', 'T')}Z`),
    matchType: match.matchType,
    round: 2,
    group: 0,
    status: 2,
    homeGoals: match.homeGoals!,
    awayGoals: match.awayGoals!,
  };

  assert.equal(tournamentMatchDetailsAgree(fixture, match, match.cupId), true);
  assert.equal(tournamentMatchDetailsAgree(fixture, match, match.cupId + 1), false,
    'context identity is mandatory');
  assert.equal(tournamentMatchDetailsAgree({ ...fixture, matchType: fixture.matchType + 1 }, match, match.cupId), false,
    'match type identity is mandatory');
});

test('alternates an ongoing current edition with fairly ordered historical work', () => {
  const now = new Date('2026-09-15T05:17:00.000Z');
  const current = { edition: 41, attempts: 1, nextAttemptAt: new Date('2026-09-15T05:17:00.000Z') };
  const olderLeastTried = { edition: 39, attempts: 0, nextAttemptAt: new Date('2026-09-14T05:17:00.000Z') };
  const olderRetried = { edition: 40, attempts: 2, nextAttemptAt: new Date('2026-09-13T05:17:00.000Z') };

  assert.equal(selectTournamentResult([current, olderRetried, olderLeastTried], 41, now), olderLeastTried,
    'a just-due running bracket yields one probe to historical backfill');
  assert.equal(selectTournamentResult([{ ...current, nextAttemptAt: new Date('2026-09-14T05:17:00.000Z') }, olderLeastTried], 41, now)?.edition, 41,
    'the current bracket regains priority after one skipped daily probe');
  assert.equal(selectTournamentResult([{ ...current, attempts: 0 }, olderLeastTried], 41, now)?.edition, 41,
    'a newly observed current edition is checked immediately');
});
