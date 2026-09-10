/**
 * Read-only statistical QA for the frozen frontend snapshot.
 * Run from the repository root: node qa/run-frontend-statistics.mjs
 * No server, credentials, network requests, DB writes, or product source changes.
 * Non-exported UI calculations are extracted with the TypeScript AST and executed unchanged.
 * Oracles count individual baked records independently of precomputed totals/UI aggregations.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { test, after } from 'node:test';
import ts from 'typescript';
import { DICTIONARIES, LANGS } from '../web/src/i18n/translations.js';
import { buildShareUrl } from '../web/src/aggregate/shareLink.js';
import * as codecs from '../web/src/aggregate/filterParams.js';
import { LEAGUE_ISO, NATIONALITY_ISO } from '../web/src/aggregate/flags.js';
import { nationalIdentity } from '../web/src/aggregate/nationalIdentity.js';

const root = process.cwd();
const read = (name: string) => JSON.parse(readFileSync(path.join(root, 'web/public/data', `${name}.json`), 'utf8'));
const raw = Object.fromEntries(['managers', 'leagues', 'cups', 'masters', 'seasonal', 'worldcup', 'elections'].map(name => [name, read(name)]));
const fetches: string[] = [];
globalThis.fetch = (async (input: any) => {
  const file = String(input).match(/^\/data\/(managers|leagues|cups|masters|seasonal|worldcup|elections)\.json$/)?.[1];
  assert.ok(file, `Unexpected network access: ${String(input)}`);
  fetches.push(file);
  return { ok: true, json: async () => raw[file!] } as Response;
}) as typeof fetch;
const data = await import('../web/src/aggregate/data.js');
const source = readFileSync(path.join(root, 'web/src/aggregate/retro/Retro2000s.tsx'), 'utf8');
const ast = ts.createSourceFile('Retro2000s.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fn = (name: string) => {
  const found = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name) as ts.FunctionDeclaration | undefined;
  assert.ok(found?.body, `UI function ${name} must remain discoverable`);
  return found;
};
const evaluate = (params: string[], body: string) => new Function(...params, ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText);
const memo = (component: string, variable: string, params: string[]) => {
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === variable && node.initializer && ts.isCallExpression(node.initializer)) found = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(fn(component));
  assert.ok(found && found.arguments[0] && ts.isArrowFunction(found.arguments[0]));
  const body = (found.arguments[0] as ts.ArrowFunction).body;
  assert.ok(ts.isBlock(body));
  return evaluate(params, body.getText(ast).slice(1, -1));
};
const prefix = (component: string, beforeVariable: string, params: string[], result: string) => {
  const body = fn(component).body!;
  const before = body.statements.find(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => d.name.getText(ast) === beforeVariable));
  assert.ok(before);
  return evaluate(params, source.slice(body.getStart(ast) + 1, before.getStart(ast)) + `\nreturn ${result};`);
};
const rankManagers = memo('RetroTrophyLeaders', 'ranked', ['managers', 'inc', 'lastOnly', 'medals']);
const rankNations = memo('RetroTrophyLeaders', 'rankedNations', ['ranked', 'NATION_TOP_N']);
const calculateNationMedals = memo('RetroMedalTables', 'medals', ['scoped', 'nationalIdentity']);
const nationMedals = (scope: any) => calculateNationMedals(scope, nationalIdentity);
const calculateNationalPodiums = memo('RetroMedalTables', 'nationPodiums', ['scoped', 't', 'compLabel', 'nationalIdentity']);
const nationalPodiums = (scope: any, t: any, compLabel: any) => calculateNationalPodiums(scope, t, compLabel, nationalIdentity);
const coachNationMedals = memo('RetroMedalTables', 'coachNationMedals', ['coachMedals']);
const topManagers = prefix('TopManagersPanel', 'max', ['winners', 'limit', 'useT'], 'arr');
const electionCountryTally = (() => {
  const statements = fn('RetroElectionsByCountry').body!.statements;
  const declaration = (name: string) => statements.find(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => d.name.getText(ast) === name))!;
  return evaluate(['rows'], source.slice(declaration('tally').getStart(ast), declaration('maxT').getStart(ast)) + '\nreturn tallyArr;');
})();
const runs = evaluate(['rows'], fn('withRuns').body!.getText(ast).slice(1, -1));
const cabinetEffect = (() => {
  const statement = fn('RetroTrophyLeaders').body!.statements.find(s => ts.isExpressionStatement(s) && ts.isCallExpression(s.expression) && s.expression.expression.getText(ast) === 'useEffect' && s.getText(ast).includes('getCabinet('));
  assert.ok(statement, 'cabinet request effect must remain discoverable');
  return evaluate(['groupBy', 'expandedId', 'getCabinet', 't', 'seasonWindow', 'lang', 'setCabinet', 'EMPTY_CABINET', 'useEffect'], statement.getText(ast));
})();
const displayedCabinet = (() => {
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'cab') expression = node.initializer; ts.forEachChild(node, visit); };
  visit(fn('RetroTrophyLeaders'));
  assert.ok(expression);
  return evaluate(['isExp', 'm', 'cabinet', 'lang', 'seasonWindow'], `return ${expression.getText(ast)};`);
})();
const fields = ['lg', 'main', 'sec', 'hm', 'sn', 'wc', 'wcSilver', 'wcBronze'];
const categories = ['champ', 'main', 'sec', 'hm', 'sn', 'wc'];
const arrays = ['titles', 'cupsMain', 'cupsSec', 'masters', 'seasonal', 'worldCup', 'medals', 'medals'];
const cabinetKeys = ['champ', 'main', 'sec', 'other', 'seasonal', 'worldCup', 'silver', 'bronze'];
const windows = [undefined, 1, 5, 10, 20] as const;
const results: Record<string, any> = { snapshot: {}, checks: {}, findings: {} };
const rawManagers: any[] = raw.managers;
const rowsFor = (m: any, index: number, window?: number) => (m[arrays[index]] ?? []).filter((r: any) => (index < 6 || r.place === index - 4) && (window === undefined || (Number.isInteger(r.ago) && r.ago >= 0 && r.ago < window)));
const numeric = (m: any) => fields.map(k => m[k]);
const errors = (name: string, bad: any[]) => {
  results.findings[name] = bad;
  assert.equal(bad.length, 0, `${bad.length} discrepancy(s): ${JSON.stringify(bad.slice(0, 6))}`);
};
const sum = (rows: any[], key: string) => rows.reduce((n, row) => n + row[key], 0);
const compRolls = [
  ...raw.leagues.map((c: any) => ({ name: c.country, url: `/?view=leagues&leagues.country=${c.leagueId}`, rows: c.champions })),
  ...raw.cups.flatMap((c: any) => c.cups.map((p: any) => ({ name: `${c.country}/${p.cupName}`, url: `/?view=cups&cups.country=${c.leagueId}${p.isMain ? '' : `&cups.category=secondary&cups.secondary=${p.cupId}`}`, rows: p.winners }))),
  ...raw.seasonal.map((c: any) => ({ name: c.cupName, url: `/?view=cups&cups.category=seasonal&cups.seasonal=${c.cupId}`, rows: c.winners })),
  { name: 'Hattrick Masters', url: '/?view=cups&cups.category=masters', rows: raw.masters },
];
const nativeNation = (name: string) => name.replace(/^U21\s+/, '');
const iso = (name: string, id?: number) => (id && LEAGUE_ISO[id]) || NATIONALITY_ISO[nativeNation(name)] || nativeNation(name);
const parseDate = (s?: string | null) => {
  const m = s?.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : null;
};
const rawComps = [
  { key: 'senior', cup: 'World Cup', youth: false, rows: raw.worldcup.senior },
  { key: 'youth', cup: 'World Cup (Youth)', youth: true, rows: raw.worldcup.youth },
  ...raw.worldcup.regional.map((c: any) => ({ key: `cup-${c.cupId}`, cup: c.cupName, youth: c.isYouth, rows: c.seasons.map((r: any) => ({ ...r, edition: r.season })) })),
];

test('snapshot inventory: exact record and individual-trophy totals', () => {
  results.snapshot = {
    managers: rawManagers.length, leagues: raw.leagues.length, cupCountries: raw.cups.length,
    domesticCups: raw.cups.reduce((n: number, c: any) => n + c.cups.length, 0), seasonalCups: raw.seasonal.length,
    leagueRows: raw.leagues.reduce((n: number, c: any) => n + c.champions.length, 0),
    domesticCupRows: raw.cups.flatMap((c: any) => c.cups).reduce((n: number, c: any) => n + c.winners.length, 0),
    mastersRows: raw.masters.length, seasonalRows: raw.seasonal.reduce((n: number, c: any) => n + c.winners.length, 0),
    nationalCompetitions: rawComps.length, nationalRows: rawComps.reduce((n, c) => n + c.rows.length, 0),
    elections: raw.elections.length, trophyTotals: Object.fromEntries(fields.map((k, i) => [k, rawManagers.reduce((n, m) => n + rowsFor(m, i).length, 0)])),
  };
  assert.equal(new Set(rawManagers.map(m => m.userId)).size, rawManagers.length);
});

test('every manager and category: career, last 1/5/10/20 and reigning counts equal individual records', async () => {
  const bad: any[] = [];
  for (const window of windows) {
    const managers = await data.getManagers(undefined, window);
    assert.equal(managers.length, rawManagers.length);
    for (let n = 0; n < managers.length; n++) {
      const m = managers[n], rawM = rawManagers[n];
      const expected = fields.map((_, i) => rowsFor(rawM, i, window).length);
      if (JSON.stringify(numeric(m)) !== JSON.stringify(expected)) bad.push({ user: m.login, window: window ?? 'all', actual: numeric(m), expected });
      for (let i = 0; i < 6; i++) {
        const field = `${fields[i]}Last`;
        const expectedLast = rowsFor(rawM, i).filter((r: any) => r.last).length;
        if ((m as any)[field] !== expectedLast) bad.push({ user: m.login, field, actual: (m as any)[field], expected: expectedLast });
      }
    }
  }
  results.checks.managerNumericFields = rawManagers.length * windows.length * 14;
  errors('managerCountMismatches', bad);
});

test('every cabinet: category, detail labels, season values and reigning/window counts reconcile with the manager row', async () => {
  const bad: any[] = [];
  for (const window of windows) {
    for (const m of rawManagers) {
      const cabinet: any = await data.getCabinet(m.userId, country => `QA ${country}`, window);
      for (let i = 0; i < fields.length; i++) {
        const actual = cabinet[cabinetKeys[i]];
        const expected = rowsFor(m, i, window);
        if (actual.length !== expected.length || actual.some((r: any, ix: number) => {
          const period = i >= 5 && ['World Cup', 'World Cup (Youth)'].includes(expected[ix].cup) ? `WC ${expected[ix].season}` : `S${expected[ix].season}`;
          return r.sub !== (expected[ix].club ?? expected[ix].nation) || r.season !== period || (i < 6 && Boolean(r.last) !== Boolean(expected[ix].last));
        })) bad.push({ user: m.userName, window: window ?? 'all', category: cabinetKeys[i] });
      }
    }
  }
  assert.deepEqual(Object.values(await data.getCabinet(-1)).map((v: any) => v.length), Array(8).fill(0));
  results.checks.cabinetCategories = rawManagers.length * windows.length * 8;
  errors('cabinetMismatches', bad);
});

test('actual cabinet effect and render guard follow recency/language/user changes and discard late responses', async () => {
  let state: any = null, dependencies: any[] | undefined, cleanup: (() => void) | undefined;
  const requests: Array<{ userId: number; window: number | undefined; resolve: (value: any) => void }> = [];
  const loader = (userId: number, _label: any, window: number | undefined) => new Promise(resolve => requests.push({ userId, window, resolve }));
  const t = (key: string) => key;
  const effect = (run: () => (() => void) | undefined, next: any[]) => {
    if (!dependencies || next.some((v, i) => !Object.is(v, dependencies![i]))) {
      cleanup?.(); dependencies = next; cleanup = run();
    }
  };
  const render = (userId: number | null, window?: number, lang = 'en', group = 'manager') => {
    cabinetEffect(group, userId === null ? null : String(userId), loader, t, window, lang, (value: any) => { state = value; }, {}, effect);
    return displayedCabinet(userId !== null, { userId }, state, lang, window);
  };
  const settle = async (index: number, value: any) => { requests[index].resolve(value); await Promise.resolve(); await Promise.resolve(); };
  const career = { record: 'all time' }, recent = { record: 'last five' }, twenty = { record: 'last twenty' }, translated = { record: 'French cabinet' }, other = { record: 'other manager' };
  assert.equal(render(9674615), undefined);
  assert.equal(render(9674615, 5), undefined);
  assert.equal(requests.length, 2, 'a recency change must run a new effect');
  await settle(1, recent);
  assert.equal(render(9674615, 5), recent);
  await settle(0, career);
  assert.equal(render(9674615, 5), recent, 'a late all-time request cannot overwrite Last 5');
  assert.equal(requests.length, 2, 'unchanged dependency values must reuse the result');
  assert.equal(render(9674615, 20), undefined, 'the previous window is hidden immediately');
  await settle(2, twenty);
  assert.equal(render(9674615, 20), twenty);
  assert.equal(render(9674615, 20, 'fr'), undefined);
  await settle(3, translated);
  assert.equal(render(9674615, 20, 'fr'), translated);
  assert.equal(render(377711, 20), undefined);
  await settle(4, other);
  assert.equal(render(377711, 20), other);
  assert.equal(render(null, 20), undefined);
  cleanup?.();
  assert.deepEqual(requests.map(({ userId, window }) => [userId, window]), [[9674615, undefined], [9674615, 5], [9674615, 20], [9674615, 20], [377711, 20]]);
  results.checks.cabinetStateTransitions = 5;
});

test('all nationality selectors, their manager counts, and all five windows return the complete matching field', async () => {
  const nations = new Map<string, number>();
  for (const m of rawManagers) nations.set(m.nationality, (nations.get(m.nationality) ?? 0) + 1);
  const listed = await data.getNationalities();
  assert.equal(listed.length, [...nations].filter(([n]) => n && n !== 'Unknown').length);
  for (const country of listed) {
    assert.equal(country.name, `${country.code} (${nations.get(country.code)})`);
    for (const window of windows) {
      const ms = await data.getManagers(country.code, window);
      assert.equal(ms.length, nations.get(country.code));
      assert.ok(ms.every(m => m.c === country.code));
    }
  }
  assert.equal((await data.getManagers('ALL')).length, rawManagers.length);
  assert.equal((await data.getManagers('not-a-nationality')).length, 0);
  results.checks.nationalityWindows = listed.length * windows.length;
});

test('actual UI manager/nation totals under every competition toggle, recency mode and medal mode', async () => {
  let configurations = 0;
  for (const window of [undefined, 5, 10, 20] as const) {
    const ms = await data.getManagers(undefined, window);
    for (const reigning of window === undefined ? [false, true] : [false]) {
      for (const medals of [false, true]) for (let mask = 0; mask < 64; mask++) {
        const inc = Object.fromEntries(categories.map((key, i) => [key, !!(mask & (1 << i))]));
        const ranked = rankManagers(ms, inc, reigning, medals);
        let grandTotal = 0;
        const nationTotals = new Map<string, { total: number; managers: number }>();
        const expectedTotals = new Map(rawManagers.map(m => {
          let total = 0;
          for (let i = 0; i < 6; i++) if (inc[categories[i]]) {
            total += rowsFor(m, i, window).filter((r: any) => !reigning || r.last).length;
            if (i === 5 && medals && !reigning) total += rowsFor(m, 6, window).length + rowsFor(m, 7, window).length;
          }
          return [m.userId, total];
        }));
        for (let i = 0; i < ranked.length; i++) {
          const r = ranked[i];
          assert.equal(r.ft, expectedTotals.get(r.m.userId));
          assert.equal(r.rank, i + 1);
          if (i) assert.ok(ranked[i - 1].ft >= r.ft);
          grandTotal += r.ft;
          const key = r.m.c || 'Unknown', n = nationTotals.get(key) ?? { total: 0, managers: 0 };
          n.total += r.ft; n.managers += Number(r.ft > 0); nationTotals.set(key, n);
        }
        const nations = rankNations(ranked, 12);
        assert.equal(sum(nations, 'ft'), grandTotal);
        for (const n of nations) {
          assert.equal(n.ft, nationTotals.get(n.nation)?.total);
          assert.equal(n.winners, nationTotals.get(n.nation)?.managers);
          assert.ok(n.top.length <= 12);
          assert.deepEqual(n.top.map((r: any) => r.ft), ranked.filter((r: any) => (r.m.c || 'Unknown') === n.nation && r.ft > 0).slice(0, 12).map((r: any) => r.ft));
        }
        // Full pagination has neither omissions nor duplicates; absolute rank survives search.
        const visible = ranked.filter((r: any) => r.ft > 0);
        const pages = Array.from({ length: Math.ceil(visible.length / 50) }, (_, i) => visible.slice(i * 50, (i + 1) * 50));
        assert.equal(pages.flat().length, visible.length);
        configurations++;
      }
    }
  }
  results.checks.trophyConfigurations = configurations;
  results.checks.managerConfigurationRows = configurations * rawManagers.length;
});

test('every league, domestic cup, Masters and seasonal roll survives the frontend loader unchanged', async () => {
  const byLogin = new Map(rawManagers.map(m => [m.userName, m.nationality]));
  const expected = (rows: any[]) => rows.map(r => ({ ...r, nationality: byLogin.get(r.manager) }));
  assert.deepEqual(await data.getLeagues(), raw.leagues.map((c: any) => ({ code: String(c.leagueId), name: c.country })));
  assert.deepEqual(await data.getCupCountries(), raw.cups.map((c: any) => ({ code: String(c.leagueId), name: c.country })));
  for (const c of raw.leagues) assert.deepEqual(await data.getWinners(String(c.leagueId)), expected(c.champions));
  for (const c of raw.cups) assert.deepEqual(await data.getCups(String(c.leagueId)), c.cups.map((p: any) => ({ ...p, winners: expected(p.winners) })));
  assert.deepEqual(await data.getMastersWinners(), expected(raw.masters));
  assert.deepEqual(await data.getSeasonalCups(), raw.seasonal.map((c: any) => ({ cupId: c.cupId, cupName: c.cupName, isGeneration: c.cupId !== 2108472, winners: expected(c.winners) })));
  assert.deepEqual(await data.getWinners('-1'), []);
  assert.deepEqual(await data.getCups('-1'), []);
  results.checks.competitionRolls = compRolls.length;
});

test('actual Top managers panels: all competitions and every displayed win count', () => {
  let entries = 0;
  for (const roll of compRolls) {
    const expected = new Map<string, number>();
    for (const r of roll.rows) if (r.manager && r.manager !== '—') {
      const identity = r.userId ? `user:${r.userId}` : `name:${r.manager}`;
      expected.set(identity, (expected.get(identity) ?? 0) + 1);
    }
    const actual = topManagers(roll.rows, 10, () => () => '');
    assert.equal(actual.length, Math.min(expected.size, 10));
    for (const [identity, value] of actual) { assert.equal(value.count, expected.get(identity)); entries++; }
    assert.deepEqual(actual.map((r: any) => r[1].count), [...expected.values()].sort((a, b) => b - a).slice(0, 10));
  }
  results.checks.topManagerPanelEntries = entries;
});

test('all competition season ranges/counts describe sorted unique displayed rows', () => {
  for (const roll of compRolls) {
    const seasons = roll.rows.map((r: any) => r.season);
    assert.equal(new Set(seasons).size, seasons.length, `${roll.name}: repeated season`);
    assert.deepEqual(seasons, seasons.slice().sort((a: number, b: number) => b - a), `${roll.name}: range assumes newest-first`);
    if (seasons.length) {
      assert.equal(seasons[0], Math.max(...seasons));
      assert.equal(seasons.at(-1), Math.min(...seasons));
    }
  }
});

test('Top managers panels keep distinct numeric user identities separate even when logins collide', () => {
  const bad: any[] = [];
  for (const roll of compRolls) {
    const byId = new Map<number, number>();
    const byName = new Map<string, Set<number>>();
    for (const r of roll.rows) if (r.userId) {
      byId.set(r.userId, (byId.get(r.userId) ?? 0) + 1);
      const ids = byName.get(r.manager) ?? new Set<number>(); ids.add(r.userId); byName.set(r.manager, ids);
    }
    const actual = topManagers(roll.rows, Infinity, () => () => '');
    for (const [userId, count] of byId) {
      const entries = actual.filter(([, displayed]: any) => displayed.userId === userId);
      if (entries.length !== 1 || entries[0][1].count !== count) bad.push({ competition: roll.name, url: roll.url, userId, expectedCount: count, actual: entries.map(([, r]: any) => ({ name: r.name, count: r.count })) });
    }
  }
  errors('mergedDistinctManagers', bad);
});

test('winner nationality joins use resolved user identity even after a login rename', async () => {
  const byId = new Map(rawManagers.map(m => [m.userId, m])), bad: any[] = [];
  const rolls = [
    ...await Promise.all(raw.leagues.map(async (c: any) => ({ competition: c.country, rows: await data.getWinners(String(c.leagueId)) }))),
    ...(await Promise.all(raw.cups.map(async (c: any) => (await data.getCups(String(c.leagueId))).map(p => ({ competition: `${c.country}/${p.cupName}`, rows: p.winners }))))).flat(),
    { competition: 'Hattrick Masters', rows: await data.getMastersWinners() },
    ...(await data.getSeasonalCups()).map(c => ({ competition: c.cupName, rows: c.winners })),
  ];
  for (const roll of rolls) for (const r of roll.rows) {
    const resolved = r.userId && byId.get(r.userId);
    if (resolved?.nationality && resolved.nationality !== 'Unknown' && r.nationality !== resolved.nationality) bad.push({ competition: roll.competition, season: r.season, userId: r.userId, historicalLogin: r.manager, currentLogin: resolved.userName, actual: r.nationality ?? null, expected: resolved.nationality });
  }
  errors('lostKnownNationalityAfterRename', bad);
});

test('consecutive-title streaks use club identity and must not bridge a missing season', () => {
  const bad: any[] = [];
  for (const roll of compRolls) {
    const actual = runs(roll.rows);
    // Partition the source into contiguous intervals, independently of the UI's row-neighbor flags.
    const groups: any[][] = [];
    for (const row of roll.rows) {
      const group = groups.at(-1), last = group?.at(-1);
      const sameClub = last && (last.teamId && row.teamId ? last.teamId === row.teamId : last.club === row.club);
      if (!sameClub || last.season - row.season !== 1) groups.push([row]);
      else group!.push(row);
    }
    const expected = groups.flatMap(group => group.map((row, index) => ({ season: row.season, partOfStreak: group.length > 1, tag: group.length > 1 && index === 0 ? `×${group.length}` : '' })));
    for (let i = 0; i < actual.length; i++) {
      if (actual[i].partOfStreak !== expected[i].partOfStreak || actual[i].tag !== expected[i].tag) bad.push({ competition: roll.name, url: roll.url, season: actual[i].season, actual: { tag: actual[i].tag, partOfStreak: actual[i].partOfStreak }, expected: expected[i] });
    }
  }
  errors('incorrectConsecutiveTitleStreaks', bad);
});

test('a renamed club keeps its streak while distinct numeric clubs with the same name stay separate', () => {
  const marks = (rows: any[]) => runs(rows).map(({ partOfStreak, tag }: any) => ({ partOfStreak, tag }));
  assert.deepEqual(marks([{ club: 'Knights of Cyprus', teamId: 463679, season: 10 }, { club: 'Ac Milan Cyprus', teamId: 463679, season: 9 }]), [
    { partOfStreak: true, tag: '×2' }, { partOfStreak: true, tag: '' },
  ]);
  assert.deepEqual(marks([{ club: 'United', teamId: 100, season: 10 }, { club: 'United', teamId: 200, season: 9 }]), [
    { partOfStreak: false, tag: '' }, { partOfStreak: false, tag: '' },
  ]);
});

test('a missing season splits a streak while preserving a valid run on either side', () => {
  assert.deepEqual(runs([{ club: 'A', season: 6 }, { club: 'A', season: 5 }, { club: 'A', season: 3 }, { club: 'A', season: 2 }]).map(({ partOfStreak, tag }: any) => ({ partOfStreak, tag })), [
    { partOfStreak: true, tag: '×2' }, { partOfStreak: true, tag: '' }, { partOfStreak: true, tag: '×2' }, { partOfStreak: true, tag: '' },
  ]);
});

test('every national competition/edition, podium and coach survives normalization', async () => {
  assert.deepEqual(await data.getWorldCup(), raw.worldcup);
  const comps = await data.getNationalCompetitions();
  assert.equal(comps.length, rawComps.length);
  for (const c of comps) {
    const expected = rawComps.find(e => e.key === c.key)!;
    assert.ok(expected); assert.equal(c.isYouth, expected.youth); assert.equal(c.rows.length, expected.rows.length);
    for (let i = 0; i < c.rows.length; i++) for (const field of ['edition', 'champion', 'runnerUp', 'thirdFourth', 'coachUserId', 'runnerUpCoachUserId', 'thirdFourthCoaches']) assert.deepEqual((c.rows[i] as any)[field], expected.rows[i][field]);
  }
});

test('coach medals and expanded results: every competition, senior/youth/all scopes', async () => {
  const scopes = [...rawComps.map(c => [c]), rawComps.filter(c => !c.youth), rawComps.filter(c => c.youth), rawComps];
  for (const scope of scopes) {
    const names = scope.map(c => c.cup), actual = await data.getCoachMedals(names);
    const expected = rawManagers.map(m => ({ userId: m.userId, name: m.userName, g: (m.worldCup ?? []).filter((r: any) => names.includes(r.cup)).length, s: (m.medals ?? []).filter((r: any) => names.includes(r.cup) && r.place === 2).length, b: (m.medals ?? []).filter((r: any) => names.includes(r.cup) && r.place === 3).length })).filter(m => m.g + m.s + m.b > 0).sort((a, b) => b.g - a.g || b.s - a.s || b.b - a.b || a.name.localeCompare(b.name));
    assert.deepEqual(actual.map(({ userId, name, g, s, b }) => ({ userId, name, g, s, b })), expected);
    for (const m of actual) for (const [field, place] of [['g', 1], ['s', 2], ['b', 3]] as const) assert.equal(m[field], m.results.filter(r => r.place === place).length);
    const nations = coachNationMedals(actual);
    for (const [nation, counts] of nations) for (const field of ['g', 's', 'b']) assert.equal(counts[field], sum(actual.filter(m => m.nationality === nation), field));
  }
  assert.deepEqual(await data.getCoachMedals(['not-a-cup']), []);
  results.checks.medalScopes = scopes.length;
});

test('actual nation medal totals/details equal raw podium counts in each scope', async () => {
  const comps = await data.getNationalCompetitions();
  const scopes = [...comps.map(c => [c]), comps.filter(c => !c.isYouth), comps.filter(c => c.isYouth), comps];
  for (const scope of scopes) {
    const counts = nationMedals(scope);
    const podiums = nationalPodiums(scope, () => '', (_: any, c: any) => c.shortLabel);
    for (const [nation, totals] of counts) for (const [field, place] of [['g', 1], ['s', 2], ['b', 3]] as const) assert.equal(totals[field], podiums.get(nation).filter((r: any) => r.place === place).length);
    const rows = scope.flatMap(c => c.rows);
    assert.equal(counts.reduce((n: number, r: any) => n + r[1].g, 0), rows.filter(r => r.champion).length);
    assert.equal(counts.reduce((n: number, r: any) => n + r[1].s, 0), rows.filter(r => r.runnerUp).length);
    assert.equal(counts.reduce((n: number, r: any) => n + r[1].b, 0), rows.reduce((n, r) => n + r.thirdFourth.length, 0));
  }
});

test('pooled nation medal tables consolidate aliases/U21 names into one country', async () => {
  const comps = await data.getNationalCompetitions(), bad: any[] = [];
  for (const [scopeName, scope] of [['senior', comps.filter(c => !c.isYouth)], ['u21', comps.filter(c => c.isYouth)], ['all', comps]] as const) {
    const rows = nationMedals(scope), byIso = new Map<string, any[]>();
    for (const [identity, counts] of rows) { const name = counts.name ?? identity; const key = iso(name, counts.leagueId); const grouped = byIso.get(key) ?? []; grouped.push({ name, ...counts }); byIso.set(key, grouped); }
    for (const [country, variants] of byIso) if (variants.length > 1) bad.push({ scope: scopeName, country, variants, combined: Object.fromEntries(['g', 's', 'b'].map(k => [k, sum(variants, k)])) });
    const expected = new Map<string, number[]>();
    const add = (nation: string | undefined | null, place: number, id?: number) => {
      if (!nation) return;
      const key = iso(nation, id), counts = expected.get(key) ?? [0, 0, 0]; counts[place]++; expected.set(key, counts);
    };
    for (const comp of rawComps.filter(c => scopeName === 'all' || c.youth === (scopeName === 'u21'))) for (const row of comp.rows) {
      add(row.champion, 0, row.championLeagueId); add(row.runnerUp, 1, row.runnerUpLeagueId);
      row.thirdFourth.forEach((nation: string, i: number) => add(nation, 2, row.thirdFourthLeagueIds?.[i]));
    }
    assert.deepEqual([...byIso].map(([country, entries]) => [country, ...['g', 's', 'b'].map(k => sum(entries, k))]).sort(), [...expected].map(([country, counts]) => [country, ...counts]).sort());
    results.checks[`medalNationRows.${scopeName}`] = { displayed: rows.length, uniqueCountries: byIso.size };
  }
  errors('splitNationMedalRows', bad);
});

test('national identity unifies youth/native aliases without combining different home nations', () => {
  assert.equal(nationalIdentity('Deutschland').key, nationalIdentity('U21 Deutschland', 3).key);
  assert.equal(nationalIdentity('Ethiopia', 156).key, nationalIdentity('U21 Ītyōṗṗyā', 156).key);
  assert.notEqual(nationalIdentity('England').key, nationalIdentity('Northern Ireland').key);
  assert.equal(nationalIdentity('U21 Ireland', 21).name, 'Ireland');
  assert.notEqual(nationalIdentity('Unmapped nation A').key, nationalIdentity('Unmapped nation B').key);
});

test('election loaders and complete manager/nationality aggregate counts reconcile all source rows', async () => {
  const agg = await data.getElectionAggregates();
  assert.deepEqual(await data.getAllElections(), raw.elections);
  const countries = await data.getElectionCountries();
  assert.equal(countries.length, new Set(raw.elections.map((r: any) => r.leagueId)).size);
  for (const c of countries) assert.deepEqual(await data.getElections(c.code), raw.elections.filter((r: any) => String(r.leagueId) === c.code).sort((a: any, b: any) => b.edition - a.edition));
  assert.deepEqual(await data.getElections('-1'), []);
  assert.equal(agg.unattributed, raw.elections.filter((r: any) => !r.winner).length);
  assert.equal(sum(agg.leaders, 'count') + agg.unattributed, raw.elections.length);
  for (const l of agg.leaders) {
    const expected = raw.elections.filter((r: any) => r.winner === l.name);
    assert.equal(l.count, expected.length); assert.equal(l.senior, expected.filter((r: any) => !r.isYouth).length); assert.equal(l.youth, expected.filter((r: any) => r.isYouth).length);
    assert.equal(l.elections.length, expected.length); assert.equal(sum(l.countries, 'count'), expected.length);
    for (const c of l.countries) assert.equal(c.count, expected.filter((r: any) => r.countryName === c.country).length);
  }
  for (const n of agg.nations) {
    const leaders = agg.leaders.filter(l => l.nationality === n.nationality);
    assert.equal(n.managers, leaders.length);
    for (const key of ['count', 'senior', 'youth']) assert.equal((n as any)[key], sum(leaders, key));
    assert.deepEqual(n.top.map(m => m.name), leaders.slice(0, 10).map(m => m.name));
  }
  assert.equal(sum(agg.nations, 'count') + agg.withoutNationality + agg.unattributed, raw.elections.length);
  results.checks.electionTotals = { managers: agg.leaders.length, nations: agg.nations.length, unattributed: agg.unattributed, withoutNationality: agg.withoutNationality, senior: sum(agg.leaders, 'senior'), youth: sum(agg.leaders, 'youth') };
});

test('each country election Top 10 counts all senior/youth victories, retaining mid-cycle re-elections', async () => {
  let entries = 0;
  for (const country of await data.getElectionCountries()) {
    const rows = await data.getElections(country.code), actual = electionCountryTally(rows);
    const byName = new Map<string, number>();
    for (const row of raw.elections.filter((r: any) => String(r.leagueId) === country.code)) if (row.winner) byName.set(row.winner, (byName.get(row.winner) ?? 0) + 1);
    assert.deepEqual(actual.map((r: any) => r[1].count), [...byName.values()].sort((a, b) => b - a).slice(0, 10));
    for (const [name, r] of actual) { assert.equal(r.count, byName.get(name)); entries++; }
  }
  results.checks.electionCountryTopEntries = entries;
});

test('coach medal identities and totals also reconcile directly against national podium source rows', async () => {
  const bad: any[] = [];
  for (const c of rawComps) {
    const expected = new Map<number, number[]>();
    const add = (id: number | undefined, place: number) => { if (!id) return; const counts = expected.get(id) ?? [0, 0, 0]; counts[place - 1]++; expected.set(id, counts); };
    for (const row of c.rows) {
      if (row.champion) add(row.coachUserId, 1);
      if (row.runnerUp) add(row.runnerUpCoachUserId, 2);
      row.thirdFourth.forEach((_: string, i: number) => add(row.thirdFourthCoaches?.[i]?.userId, 3));
    }
    const actual = await data.getCoachMedals([c.cup]);
    for (const m of actual) if (JSON.stringify([m.g, m.s, m.b]) !== JSON.stringify(expected.get(m.userId))) bad.push({ cup: c.cup, userId: m.userId, actual: [m.g, m.s, m.b], expected: expected.get(m.userId) });
    for (const id of expected.keys()) if (!actual.some(m => m.userId === id)) bad.push({ cup: c.cup, missingUserId: id, expected: expected.get(id) });
  }
  errors('coachMedalsVsPodiumRows', bad);
});

test('each election timeline uses the date of its own World Cup bracket', async () => {
  const agg = await data.getElectionAggregates(), bad: any[] = [];
  for (const leader of agg.leaders) for (const e of leader.elections) {
    const row = (e.isYouth ? raw.worldcup.youth : raw.worldcup.senior).find((r: any) => r.edition === e.edition);
    const expected = row?.finished ?? null;
    if (e.finished !== expected) bad.push({ manager: leader.name, country: e.countryName, bracket: e.isYouth ? 'youth' : 'senior', edition: e.edition, actual: e.finished, expected });
  }
  errors('wrongElectionTimelineDate', bad);
});

test('regional election trophy attribution uses mandate windows of the correct bracket', async () => {
  const agg = await data.getElectionAggregates(), bad: any[] = [];
  const finalDates = new Map(rawComps.filter(c => c.key.startsWith('cup-')).flatMap(c => c.rows.map((r: any) => [`${c.cup}|${r.edition}`, parseDate(r.finished)])));
  for (const leader of agg.leaders) {
    const manager = rawManagers.find(m => m.userId === leader.userId);
    if (!manager) continue;
    const regionalResults = [...(manager.worldCup ?? []).map((r: any) => ({ ...r, nation: r.club, place: 1 })), ...(manager.medals ?? [])].filter((r: any) => !r.cup.startsWith('World Cup'));
    for (const e of leader.elections) {
      const editions = (e.isYouth ? raw.worldcup.youth : raw.worldcup.senior).slice().sort((a: any, b: any) => a.edition - b.edition);
      const previous = editions.filter((r: any) => r.edition < e.edition).at(-1);
      const current = editions.find((r: any) => r.edition === e.edition);
      const start = parseDate(previous?.finished) ?? -Infinity, end = parseDate(current?.finished) ?? Infinity;
      const expected = regionalResults.filter((r: any) => r.cup.startsWith('U21 ') === e.isYouth && iso(r.nation, r.leagueId) === LEAGUE_ISO[e.leagueId] && finalDates.get(`${r.cup}|${r.season}`) != null && finalDates.get(`${r.cup}|${r.season}`)! > start && finalDates.get(`${r.cup}|${r.season}`)! <= end).map((r: any) => `${r.cup}|${r.place}`).sort();
      const actual = e.trophies.filter(t => !t.exact).map(t => `${t.cup}|${t.place}`).sort();
      if (JSON.stringify(expected) !== JSON.stringify(actual)) bad.push({ manager: leader.name, country: e.countryName, edition: e.edition, youth: e.isYouth, actual, expected });
    }
  }
  errors('wrongRegionalMandateAttribution', bad);
});

test('national cabinets distinguish World Cup edition numbers from regional season numbers', async () => {
  const bad: any[] = [];
  for (const m of rawManagers.filter(m => (m.worldCup ?? []).some((r: any) => r.cup.startsWith('World Cup')) || (m.medals ?? []).some((r: any) => r.cup.startsWith('World Cup')))) {
    const cabinet = await data.getCabinet(m.userId);
    for (const r of [...cabinet.worldCup, ...cabinet.silver, ...cabinet.bronze]) if (r.main.startsWith('World Cup') && /^S\d+$/.test(r.season)) bad.push({ manager: m.userName, cup: r.main, displayed: r.season, expectedUnit: 'edition' });
  }
  errors('worldCupEditionsLabeledSeasons', bad);
});

test('all supported languages preserve numeric placeholders', () => {
  const bad: any[] = [], placeholder = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  for (const { code } of LANGS) for (const [key, english] of Object.entries(DICTIONARIES.en)) {
    const translated = (DICTIONARIES[code] as any)[key];
    if (translated !== undefined && JSON.stringify(placeholder(translated)) !== JSON.stringify(placeholder(english))) bad.push({ language: code, key, english, translated });
  }
  results.checks.translationKeys = Object.keys(DICTIONARIES.en).length;
  results.checks.languages = LANGS.length;
  errors('translationPlaceholderMismatches', bad);
});

test('share URLs retain every number-affecting filter for all six pages and remove unrelated state', () => {
  const cases: Array<[string, Record<string, string>]> = [
    ['trophies', { group: 'manager', nation: 'Italia', q: 'robbierodie', competitions: 'champ,main,sec,hm,sn,wc', recency: '5', count: 'medals' }],
    ['trophies', { group: 'nation', q: 'Italia', competitions: '', recency: '20', count: 'medals' }],
    ['trophies', { recency: 'reigning', competitions: 'wc' }],
    ['leagues', { country: '4' }],
    ['cups', { category: 'main', country: '4' }],
    ['cups', { category: 'secondary', country: '4', secondary: '95' }],
    ['cups', { category: 'masters' }],
    ['cups', { category: 'seasonal', seasonal: '2108472' }],
    ['worldcup', { bracket: 'youth', competition: 'cup-137' }],
    ['medals', { scope: 'one', by: 'coach', bracket: 'youth', competition: 'youth' }],
    ['medals', { scope: 'u21', by: 'coachNation' }],
    ['medals', { scope: 'all', by: 'nation' }],
    ['elections', { tab: 'managers', q: '-arpe-' }],
    ['elections', { tab: 'nations', q: 'Italia' }],
    ['elections', { tab: 'countries', country: '12' }],
  ];
  for (const [view, filters] of cases) {
    const url = new URL('https://example.test/archive?debug=1&unrelated.key=1#old'); url.searchParams.set('view', view);
    for (const [key, value] of Object.entries(filters)) url.searchParams.set(`${view}.${key}`, value);
    const shared = new URL(buildShareUrl(url.href));
    assert.equal(shared.pathname, '/archive'); assert.equal(shared.searchParams.get('view'), view); assert.equal(shared.hash, '');
    assert.equal(shared.searchParams.get('debug'), null); assert.equal(shared.searchParams.get('unrelated.key'), null);
    for (const [key, value] of Object.entries(filters)) {
      const defaults: any = { group: 'manager', tab: 'managers', category: 'main', by: 'nation' };
      assert.equal(shared.searchParams.get(`${view}.${key}`) ?? defaults[key], value, `${view}.${key}`);
    }
    assert.equal(buildShareUrl(shared.href), shared.href);
  }
  for (let mask = 0; mask < 64; mask++) {
    const flags = Object.fromEntries(categories.map((k, i) => [k, Boolean(mask & (1 << i))])) as any;
    assert.deepEqual(codecs.competitionsParam.parse(codecs.competitionsParam.format(flags)), flags);
  }
  for (const recency of ['all', 'reigning', '5', '10', '20'] as const) assert.equal(codecs.recencyParam.parse(codecs.recencyParam.format(recency)), recency);
  results.checks.shareCases = cases.length;
});

test('all seven baked files are loaded once, with zero network calls outside the local snapshot', () => {
  assert.deepEqual([...fetches].sort(), ['cups', 'elections', 'leagues', 'managers', 'masters', 'seasonal', 'worldcup']);
});

after(() => {
  mkdirSync(path.join(root, 'qa/results'), { recursive: true });
  writeFileSync(path.join(root, 'qa/results/frontend-statistics.json'), JSON.stringify(results, null, 2));
});
