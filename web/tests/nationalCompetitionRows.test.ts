import assert from 'node:assert/strict';
import test from 'node:test';
import { hasNationalChampion } from '../src/aggregate/data.js';

test('ongoing national competitions stay out of the historical champions table', () => {
  assert.equal(hasNationalChampion({ champion: null }), false);
  assert.equal(hasNationalChampion({ champion: '' }), false);
  assert.equal(hasNationalChampion({ champion: '   ' }), false);

  const scheduledOngoingEdition = {
    champion: null,
    runnerUp: null,
    thirdFourth: [],
    finished: '09-10-2026 21:00',
  };
  assert.equal(hasNationalChampion(scheduledOngoingEdition), false);
});

test('a known champion makes a national competition row visible', () => {
  const incompleteHistoricalEdition = {
    champion: 'Angola',
    runnerUp: null,
    thirdFourth: [],
    finished: null,
  };
  assert.equal(hasNationalChampion(incompleteHistoricalEdition), true);
});
