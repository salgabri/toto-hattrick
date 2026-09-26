import test from 'node:test';
import assert from 'node:assert/strict';
import { countryDisplayName, nationalityDisplayName, nationDisplayName } from '../src/aggregate/hattrickCountryNames.js';

test('country labels switch between Hattrick and English without changing league IDs', () => {
  assert.equal(countryDisplayName(156, 'Federal Democratic Republic of Ethiopia', 'hattrick'), 'Ītyōṗṗyā');
  assert.equal(countryDisplayName(156, 'Federal Democratic Republic of Ethiopia', 'english'), 'Federal Democratic Republic of Ethiopia');
  assert.equal(countryDisplayName(1, 'Sweden', 'hattrick'), 'Sverige');
  assert.equal(countryDisplayName(1000, 'Hattrick International', 'hattrick'), 'Hattrick International');
  assert.equal(countryDisplayName(undefined, 'Unknown', 'hattrick'), 'Unknown');
});

test('manager nationality labels use the matching English league country', () => {
  const englishCountries = [
    { code: '2', name: 'England' },
    { code: '3', name: 'Germany' },
    { code: '26', name: 'Scotland' },
    { code: '126', name: 'Ivory Coast' },
    { code: '139', name: 'Benin' },
    { code: '155', name: 'Democratic Republic of the Congo' },
    { code: '156', name: 'Federal Democratic Republic of Ethiopia' },
  ];

  assert.equal(nationalityDisplayName('Deutschland', 'english', englishCountries), 'Germany');
  assert.equal(nationalityDisplayName('Ītyōṗṗyā', 'english', englishCountries), 'Federal Democratic Republic of Ethiopia');
  assert.equal(nationalityDisplayName('Ethiopia', 'english', englishCountries), 'Federal Democratic Republic of Ethiopia');
  assert.equal(nationalityDisplayName('Bénin', 'english', englishCountries), 'Benin');
  assert.equal(nationalityDisplayName('Benin', 'english', englishCountries), 'Benin');
  assert.equal(nationalityDisplayName('RD Congo', 'english', englishCountries), 'Democratic Republic of the Congo');
  assert.equal(nationalityDisplayName('DR Congo', 'english', englishCountries), 'Democratic Republic of the Congo');
  assert.equal(nationalityDisplayName("Côte d'Ivoire", 'english', englishCountries), 'Ivory Coast');
  assert.equal(nationalityDisplayName('Côte d’Ivoire', 'english', englishCountries), 'Ivory Coast');
  assert.equal(nationalityDisplayName('England', 'english', englishCountries), 'England');
  assert.equal(nationalityDisplayName('Scotland', 'english', englishCountries), 'Scotland');
});

test('Hattrick and unresolved nationality labels preserve the original string', () => {
  const countries = [{ code: '156', name: 'Federal Democratic Republic of Ethiopia' }];
  assert.equal(nationalityDisplayName('Ethiopia', 'hattrick', countries), 'Ethiopia');
  assert.equal(nationalityDisplayName('Sverige', 'english', countries), 'Sverige');
  assert.equal(nationalityDisplayName('Unknown nationality', 'english', countries), 'Unknown nationality');
});

test('national team labels retain the U21 bracket and prefer stable league IDs', () => {
  const countries = [
    { code: '1', name: 'Sweden' },
    { code: '156', name: 'Federal Democratic Republic of Ethiopia' },
  ];
  assert.equal(nationDisplayName('U21 Sverige', 'english', countries), 'U21 Sweden');
  assert.equal(nationDisplayName('U21 Sweden', 'hattrick', countries, 1), 'U21 Sverige');
  assert.equal(nationDisplayName('Ethiopia', 'hattrick', countries, 156), 'Ītyōṗṗyā');
  assert.equal(nationDisplayName('U21 Unknown', 'english', countries, 156), 'U21 Federal Democratic Republic of Ethiopia');
  assert.equal(nationDisplayName('Sverige', 'english', [{ code: '1', name: 'Sweden' }], 156), 'Sverige');
  assert.equal(nationDisplayName('U21 Unknown', 'hattrick', countries), 'U21 Unknown');
  assert.equal(nationDisplayName('Unknown', 'english', countries), 'Unknown');
});
