import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { enumParam, positiveIntParam, replaceUrlParam, stringParam, updateUrlParams } from '../src/aggregate/urlState.ts';

class BrowserWindow extends EventTarget {
  location = new URL('https://archive.example/retro/trophies?keep=first&keep=second#results');
  events = 0;
  operations: Array<{ mode: 'push' | 'replace'; state: unknown; url: string }> = [];
  history = {
    state: { position: 4 },
    pushState: (state: unknown, _title: string, url: string) => this.navigate('push', state, url),
    replaceState: (state: unknown, _title: string, url: string) => this.navigate('replace', state, url),
  };

  private navigate(mode: 'push' | 'replace', state: unknown, url: string) {
    this.operations.push({ mode, state, url });
    this.location = new URL(url, this.location);
  }

  override dispatchEvent(event: Event): boolean {
    this.events += 1;
    return super.dispatchEvent(event);
  }
}

let browser: BrowserWindow;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

beforeEach(() => {
  browser = new BrowserWindow();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
});

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

test('codecs preserve text, validate choices, and omit defaults', () => {
  const text = stringParam();
  assert.equal(text.parse(null), '');
  assert.equal(text.parse('Zürich & Barça'), 'Zürich & Barça');
  assert.equal(text.format(''), null);
  assert.equal(text.format('FC Toto'), 'FC Toto');

  const choice = enumParam(['all', 'league', 'cup'], 'all');
  assert.equal(choice.parse('league'), 'league');
  assert.equal(choice.parse('unknown'), 'all');
  assert.equal(choice.parse(null), 'all');
  assert.equal(choice.format('all'), null);
  assert.equal(choice.format('cup'), 'cup');
});

test('integer codec rejects malformed, nonpositive, and unsafe values', () => {
  const integer = positiveIntParam();
  for (const invalid of [null, '', '0', '-1', '1.5', '1e3', ' 12', '12 ', '+12', '01', '12x', '9007199254740992']) {
    assert.equal(integer.parse(invalid), null, `Unexpectedly accepted ${invalid}`);
  }
  assert.equal(integer.parse('12'), 12);
  assert.equal(integer.parse('9007199254740991'), Number.MAX_SAFE_INTEGER);
  assert.equal(integer.format(null), null);
  assert.equal(integer.format(-1), null);
  assert.equal(integer.format(12), '12');
  assert.equal(positiveIntParam(10).parse('bad'), 10);
  assert.equal(positiveIntParam(10).format(10), null);
});

test('related filters update atomically and preserve path, hash, unrelated params, and history state', () => {
  const state = browser.history.state;
  const query = '東京 + São Paulo & 50% #1?';
  updateUrlParams({ country: 'Zürich & Barça', season: '42', q: query });
  assert.equal(browser.location.pathname, '/retro/trophies');
  assert.equal(browser.location.hash, '#results');
  assert.deepEqual(browser.location.searchParams.getAll('keep'), ['first', 'second']);
  assert.equal(browser.location.searchParams.get('country'), 'Zürich & Barça');
  assert.equal(browser.location.searchParams.get('season'), '42');
  const sharedUrl = new URL(browser.location.href);
  assert.equal(stringParam().parse(sharedUrl.searchParams.get('q')), query);
  assert.equal(browser.operations.length, 1);
  assert.equal(browser.operations[0]?.mode, 'push');
  assert.equal(browser.operations[0]?.state, state);
  assert.equal(browser.events, 1);
});

test('multi-valued competition selection distinguishes an empty list from an omitted default', () => {
  const defaults = 'champ,main,hm,sn,wc';
  const competitions = stringParam(defaults);
  updateUrlParams({ competitions: competitions.format('champ,wc') });
  assert.equal(competitions.parse(new URL(browser.location.href).searchParams.get('competitions')), 'champ,wc');

  updateUrlParams({ competitions: competitions.format('') });
  const emptySelectionUrl = new URL(browser.location.href);
  assert.equal(emptySelectionUrl.searchParams.has('competitions'), true);
  assert.equal(competitions.parse(emptySelectionUrl.searchParams.get('competitions')), '');

  updateUrlParams({ competitions: competitions.format(defaults) });
  const defaultSelectionUrl = new URL(browser.location.href);
  assert.equal(defaultSelectionUrl.searchParams.has('competitions'), false);
  assert.equal(competitions.parse(defaultSelectionUrl.searchParams.get('competitions')), defaults);
});

test('reapplying selected values or absent defaults leaves URL and history untouched', () => {
  browser.location = new URL('https://archive.example/retro?search=hello%20world#results');
  updateUrlParams({ search: 'hello world', season: null });
  assert.equal(browser.location.search, '?search=hello%20world');
  assert.equal(browser.operations.length, 0);
  assert.equal(browser.events, 0);
});

test('resetting a filter removes it and replacement retains a single navigation operation', () => {
  browser.location.search = '?season=42&country=CH';
  updateUrlParams({ season: null, country: 'IT' }, 'replace');
  assert.equal(browser.location.search, '?country=IT');
  assert.equal(browser.operations.length, 1);
  assert.equal(browser.operations[0]?.mode, 'replace');
  assert.equal(browser.events, 1);
});

test('functional normalization reads the latest URL on every call', () => {
  const integer = positiveIntParam();
  browser.location.search = '?season=40';
  replaceUrlParam('season', integer, previous => (previous ?? 0) + 1);
  replaceUrlParam('season', integer, previous => (previous ?? 0) + 1);
  assert.equal(browser.location.searchParams.get('season'), '42');
  assert.deepEqual(browser.operations.map(operation => operation.mode), ['replace', 'replace']);
  assert.equal(browser.events, 2);
});
