import assert from 'node:assert/strict';
import test from 'node:test';
import { createManagerNationalityResolver } from '../src/aggregate/data.js';

const nationalityOf = createManagerNationalityResolver([
  { userId: 101, userName: 'current-login', nationality: 'Sverige' },
  { userId: 202, userName: 'legacy-login', nationality: 'Italia' },
  { userId: 303, userName: 'reused-login', nationality: 'Deutschland' },
]);

test('winner nationality uses userId before a conflicting login name', () => {
  assert.equal(nationalityOf({ userId: 101, manager: 'reused-login' }), 'Sverige');
});

test('a positive but unknown userId does not fall back to login name', () => {
  assert.equal(nationalityOf({ userId: 999, manager: 'legacy-login' }), undefined);
});

test('legacy winners without a positive userId still resolve by login name', () => {
  assert.equal(nationalityOf({ manager: 'legacy-login' }), 'Italia');
  assert.equal(nationalityOf({ userId: 0, manager: 'legacy-login' }), 'Italia');
});
