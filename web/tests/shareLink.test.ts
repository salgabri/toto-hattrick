import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildShareUrl } from '../src/aggregate/shareLink.ts';

const base = 'https://archive.example:8443/retro/records';

function filters(search: string): Record<string, string> {
  return Object.fromEntries(new URL(buildShareUrl(`${base}?${search}`)).searchParams);
}

test('share URLs preserve origin and path, explicitly identify the page, and omit unrelated state', () => {
  const href = `${base}?leagues.country=4&trophies.q=FC+Toto&unknown=secret#results`;
  const result = new URL(buildShareUrl(href));
  assert.equal(result.origin, 'https://archive.example:8443');
  assert.equal(result.pathname, '/retro/records');
  assert.equal(result.hash, '');
  assert.deepEqual(Object.fromEntries(result.searchParams), { view: 'trophies', 'trophies.q': 'FC Toto' });
  assert.equal(href, `${base}?leagues.country=4&trophies.q=FC+Toto&unknown=secret#results`);
  assert.equal(buildShareUrl(base), `${base}?view=trophies`);
  assert.equal(buildShareUrl('https://archive.example//records?view=leagues'), 'https://archive.example//records?view=leagues');
});

test('trophy links retain visible filters and canonicalize competition order', () => {
  assert.deepEqual(filters('view=trophies&trophies.group=manager&trophies.nation=CH&trophies.recency=5&trophies.count=medals&trophies.competitions=wc,champ,wc'), {
    view: 'trophies', 'trophies.nation': 'CH', 'trophies.competitions': 'champ,wc',
    'trophies.recency': '5', 'trophies.count': 'medals',
  });
  assert.deepEqual(filters('trophies.group=nation&trophies.nation=CH&trophies.recency=reigning&trophies.count=medals&trophies.q=Swiss'), {
    view: 'trophies', 'trophies.group': 'nation', 'trophies.q': 'Swiss', 'trophies.recency': 'reigning',
  });
});

test('explicit empty competition lists survive sharing while defaults and invalid choices are omitted', () => {
  assert.equal(new URL(buildShareUrl(`${base}?trophies.competitions=`)).searchParams.get('trophies.competitions'), '');
  assert.deepEqual(filters('view=invalid&trophies.group=other&trophies.nation=ALL&trophies.recency=99&trophies.count=invalid&trophies.competitions=champ,unknown'), {
    view: 'trophies',
  });
  assert.deepEqual(filters('trophies.competitions=champ,main,hm,sn,wc'), { view: 'trophies' });
});

test('league and world cup links include only their own selections and preserve text exactly', () => {
  assert.deepEqual(filters('view=leagues&leagues.country=4&cups.country=5&trophies.q=Toto'), {
    view: 'leagues', 'leagues.country': '4',
  });
  const competition = '東京 + São Paulo & 50% #1?';
  assert.deepEqual(filters(`view=worldcup&worldcup.bracket=youth&worldcup.competition=${encodeURIComponent(competition)}&medals.by=coach`), {
    view: 'worldcup', 'worldcup.bracket': 'youth', 'worldcup.competition': competition,
  });
});

test('cup links retain only filters that apply to the selected category', () => {
  const remembered = 'cups.country=4&cups.secondary=12&cups.seasonal=34';
  assert.deepEqual(filters(`view=cups&${remembered}`), { view: 'cups', 'cups.country': '4' });
  assert.deepEqual(filters(`view=cups&cups.category=secondary&${remembered}`), {
    view: 'cups', 'cups.category': 'secondary', 'cups.country': '4', 'cups.secondary': '12',
  });
  assert.deepEqual(filters(`view=cups&cups.category=masters&${remembered}`), {
    view: 'cups', 'cups.category': 'masters',
  });
  assert.deepEqual(filters(`view=cups&cups.category=seasonal&${remembered}`), {
    view: 'cups', 'cups.category': 'seasonal', 'cups.seasonal': '34',
  });
  for (const invalid of ['0', '-1', '01', '1e3', '2.5', '9007199254740992']) {
    assert.deepEqual(filters(`view=cups&cups.category=secondary&cups.secondary=${invalid}`), {
      view: 'cups', 'cups.category': 'secondary',
    });
  }
});

test('medal links include a competition only for the one-competition scope', () => {
  const remembered = 'medals.by=coachNation&medals.bracket=youth&medals.competition=world-cup';
  assert.deepEqual(filters(`view=medals&medals.scope=one&${remembered}`), {
    view: 'medals', 'medals.scope': 'one', 'medals.by': 'coachNation',
    'medals.bracket': 'youth', 'medals.competition': 'world-cup',
  });
  assert.deepEqual(filters(`view=medals&medals.scope=all&${remembered}`), {
    view: 'medals', 'medals.scope': 'all', 'medals.by': 'coachNation',
  });
  assert.deepEqual(filters(`view=medals&${remembered}`), { view: 'medals', 'medals.by': 'coachNation' });
});

test('election links share country selections or search text according to the selected tab', () => {
  const remembered = 'elections.country=4&elections.q=Z%C3%BCrich+%26+Bar%C3%A7a';
  assert.deepEqual(filters(`view=elections&${remembered}`), { view: 'elections', 'elections.q': 'Zürich & Barça' });
  assert.deepEqual(filters(`view=elections&elections.tab=nations&${remembered}`), {
    view: 'elections', 'elections.tab': 'nations', 'elections.q': 'Zürich & Barça',
  });
  assert.deepEqual(filters(`view=elections&elections.tab=countries&${remembered}`), {
    view: 'elections', 'elections.tab': 'countries', 'elections.country': '4',
  });
});

test('a canonical share link is stable when shared again and needs no browser globals', () => {
  const href = `${base}?view=cups&cups.category=secondary&cups.country=4&cups.secondary=12&cups.secondary=13&leagues.country=5#results`;
  const shared = buildShareUrl(href);
  assert.equal(buildShareUrl(shared), shared);
  assert.equal(new URL(shared).searchParams.getAll('cups.secondary').length, 1);
});
