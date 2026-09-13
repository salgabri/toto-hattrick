import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { XMLParser } from 'fast-xml-parser';
import {
  fetchNationalTeamDetails,
  fetchTournamentDetails,
  fetchTournamentFixtures,
} from './endpoints.js';
import {
  parseNationalTeamDetails,
  parseTournamentDetails,
  parseTournamentFixtures,
} from '../schemas/index.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
});

function sample(name: string): unknown {
  return xmlParser.parse(readFileSync(new URL(`../../samples/${name}`, import.meta.url), 'utf8'));
}

test('tournament and national-team wrappers pin versions and map request parameters', async () => {
  const previousFetch = globalThis.fetch;
  const urls: URL[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(new URL(href));
    return new Response('<HattrickData/>');
  }) as typeof fetch;

  try {
    const token = { token: 'test-token', tokenSecret: 'test-secret' };
    await fetchTournamentDetails(token, 2_108_472);
    await fetchTournamentFixtures(token, { tournamentId: 5_001_278, season: 41 });
    await fetchNationalTeamDetails(token, 3_000);
  } finally {
    globalThis.fetch = previousFetch;
  }

  assert.equal(urls.length, 3);
  assert.deepEqual(
    urls.map((url) => ({
      file: url.searchParams.get('file'),
      version: url.searchParams.get('version'),
      tournamentId: url.searchParams.get('tournamentId'),
      season: url.searchParams.get('season'),
      teamID: url.searchParams.get('teamID'),
    })),
    [
      {
        file: 'tournamentdetails',
        version: '1.0',
        tournamentId: '2108472',
        season: null,
        teamID: null,
      },
      {
        file: 'tournamentfixtures',
        version: '1.1',
        tournamentId: '5001278',
        season: '41',
        teamID: null,
      },
      {
        file: 'nationalteamdetails',
        version: '1.3',
        tournamentId: null,
        season: null,
        teamID: '3000',
      },
    ],
  );
});

test('parseTournamentDetails maps the authenticated 1.0 sample', () => {
  assert.deepEqual(parseTournamentDetails(sample('tournamentdetails-1.0-supporter-current.xml')), {
    tournamentId: 2_108_472,
    name: 'Supporter Week Trophy',
    season: 37,
    lastMatchRound: 16,
    firstMatchRoundDate: new Date('2026-07-13T18:00:00.000Z'),
    nextMatchRoundDate: new Date('2026-07-19T10:00:00.000Z'),
    isMatchesOngoing: false,
  });
});

test('parseTournamentFixtures handles seasonal and national-team tournament samples', () => {
  const supporter = parseTournamentFixtures(
    sample('tournamentfixtures-1.1-supporter-current.xml'),
  );
  assert.equal(supporter.matches.length, 63);
  assert.deepEqual(supporter.matches.at(-1), {
    matchId: 41_825_525,
    homeTeamId: 694_577,
    homeTeamName: 'Craiova Champions',
    awayTeamId: 2_062_555,
    awayTeamName: 'Sabana Westpunt Iguanas',
    matchDate: new Date('2026-07-19T10:00:00.000Z'),
    matchType: 51,
    round: 16,
    group: 0,
    status: 2,
    homeGoals: 2,
    awayGoals: 0,
  });

  const africa = parseTournamentFixtures(sample('tournamentfixtures-1.1-africa-s41.xml'));
  assert.equal(africa.matches.length, 127);
  assert.deepEqual(africa.matches.at(-1), {
    matchId: 41_231_363,
    homeTeamId: 3_198,
    homeTeamName: 'Senegal',
    awayTeamId: 3_208,
    awayTeamName: "Côte d'Ivoire",
    matchDate: new Date('2026-06-19T21:00:00.000Z'),
    matchType: 51,
    round: 13,
    group: 0,
    status: 2,
    homeGoals: 3,
    awayGoals: 1,
  });
});

test('parseTournamentFixtures normalizes a real empty Matches element', () => {
  assert.deepEqual(
    parseTournamentFixtures(sample('tournamentfixtures-1.1-supporter-s36.xml')),
    { matches: [] },
  );
});

test('parseNationalTeamDetails maps the response-advertised 1.3 shape', () => {
  assert.deepEqual(parseNationalTeamDetails(sample('nationalteamdetails-1.1-sweden.xml')), {
    teamId: 3_000,
    teamName: 'Sverige',
    leagueId: 1,
    leagueName: 'Sverige',
    coachUserId: 8_877_414,
    coachLoginName: 'ZorroMP',
  });
});
