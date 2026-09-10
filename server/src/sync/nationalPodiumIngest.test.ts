import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeNationalPodiumFacts, validNationalBronzeInput } from './nationalPodiumIngest.js';

test('partial scrape preserves established podium facts and completion', () => {
  const stored = { champion: 'Italia', championTeamId: 5, runnerUp: 'Sverige', thirdFourth: 'Hong Kong, China, Malta', status: 'Finished' };
  assert.deepEqual(mergeNationalPodiumFacts(stored, { champion: null, championTeamId: null, runnerUp: '', thirdFourth: '', status: 'Ongoing' }), { data: {}, conflicts: [] });
});
test('conflicting nation or bronze order cannot retain a different nation coach', () => {
  assert.deepEqual(mergeNationalPodiumFacts({ champion: 'Italia', championUserId: 55 }, { champion: 'Sverige' }), { data: {}, conflicts: ['champion'] });
  assert.deepEqual(mergeNationalPodiumFacts({ thirdFourth: 'Italia, Sverige', thirdFourthUserIds: ',55' }, { thirdFourth: 'Sverige, Italia' }).conflicts, ['thirdFourth']);
});
test('fills aligned bronze ID holes without shifting or clearing existing slots', () => {
  assert.deepEqual(mergeNationalPodiumFacts({ thirdFourth: 'Hong Kong, China, Malta', thirdFourthTeamIds: ',20' }, { thirdFourth: 'Hong Kong, China, Malta', thirdFourthTeamIds: '10,' }), { data: { thirdFourthTeamIds: '10,20' }, conflicts: [] });
  assert.deepEqual(mergeNationalPodiumFacts({ thirdFourth: 'A, B', thirdFourthTeamIds: ',20' }, { thirdFourth: 'A, B', thirdFourthTeamIds: '10,30' }).conflicts, ['thirdFourthTeamIds']);
});
test('orphaned coach identity cannot be attached to a new nation', () => {
  assert.deepEqual(mergeNationalPodiumFacts({ champion: null, championUserId: 55 }, { champion: 'Italia' }).conflicts, ['champion']);
  assert.deepEqual(mergeNationalPodiumFacts({ thirdFourth: '', thirdFourthUserIds: ',55' }, { thirdFourth: 'A, B' }).conflicts, ['thirdFourth']);
});
test('completion advances and empty facts fill safely', () => {
  assert.deepEqual(mergeNationalPodiumFacts({ champion: null, status: 'Ongoing' }, { champion: 'Italia', status: 'Finished' }), { data: { champion: 'Italia', status: 'Finished' }, conflicts: [] });
});
test('bronze IDs require names, preserve holes, and reject overflow or invalid IDs', () => {
  assert.equal(validNationalBronzeInput(undefined, [1, 2]), false);
  assert.equal(validNationalBronzeInput(['A', 'B'], [null, 2]), true);
  assert.equal(validNationalBronzeInput(['A'], [1, 2]), false);
  assert.equal(validNationalBronzeInput(['A'], [-1]), false);
});
test('singular IDs require explicit matching nation and valid numeric IDs', () => {
  assert.deepEqual(mergeNationalPodiumFacts({ champion: 'Italia' }, { champion: null, championTeamId: 3000 }).conflicts, ['championTeamId']);
  assert.deepEqual(mergeNationalPodiumFacts({ runnerUp: 'Italia' }, { runnerUp: 'Italia', runnerUpLeagueId: -1 }).conflicts, ['runnerUpLeagueId']);
  assert.deepEqual(mergeNationalPodiumFacts({ champion: 'Italia' }, { champion: 'Italia', championTeamId: 3003 }), { data: { championTeamId: 3003 }, conflicts: [] });
  assert.deepEqual(mergeNationalPodiumFacts({ champion: null }, { champion: 'Italia', championTeamId: 3003 }), { data: { champion: 'Italia', championTeamId: 3003 }, conflicts: [] });
});
