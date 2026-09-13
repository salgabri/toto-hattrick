import test from 'node:test';
import assert from 'node:assert/strict';
import { nationalityFlagUrl } from '../src/aggregate/flags.js';

test('Madagascar manager nationality uses the bundled flag', () => {
  assert.equal(nationalityFlagUrl('Madagascar'), '/flags/mg.svg');
});
