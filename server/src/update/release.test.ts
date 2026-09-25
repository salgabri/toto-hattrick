import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_FILES, prepareRelease, validateRelease } from './release.js';

function fixture() {
  const title = { country: 'Italy', leagueId: 4, season: 94, club: 'Club', teamId: 7, last: true, ago: 0 };
  const worldCupEdition = {
    edition: 40,
    ageGroup: 'Senior' as string | undefined,
    host: 'Italy',
    finished: '01.01.2026' as string | null,
    champion: 'Italy' as string | null,
    runnerUp: 'France' as string | null,
    thirdFourth: ['Germany'],
    championLeagueId: 4,
    runnerUpLeagueId: 5,
    thirdFourthLeagueIds: [6],
    coachUserId: undefined as number | undefined,
    coach: 'Champion coach' as string | undefined,
    coachNationality: 'Italy' as string | undefined,
    runnerUpCoachUserId: undefined as number | undefined,
    runnerUpCoach: 'Runner-up coach' as string | undefined,
    runnerUpCoachNationality: 'France' as string | undefined,
    thirdFourthCoaches: [{
      userId: undefined as number | undefined,
      name: 'Semi-final coach' as string | undefined,
      nationality: 'Germany' as string | undefined,
    }],
  };
  const regionalSeason = {
    season: 95,
    host: 'Italy',
    finished: '01-01-2026 20:00' as string | null,
    status: 'Finished' as string | undefined,
    champion: 'Italy' as string | null,
    runnerUp: 'France' as string | null,
    thirdFourth: ['Germany'],
    championLeagueId: 4,
    runnerUpLeagueId: 5,
    thirdFourthLeagueIds: [6],
    coachUserId: undefined as number | undefined,
    coach: 'Regional champion coach' as string | undefined,
    coachNationality: 'Italy' as string | undefined,
    runnerUpCoachUserId: undefined as number | undefined,
    runnerUpCoach: 'Regional runner-up coach' as string | undefined,
    runnerUpCoachNationality: 'France' as string | undefined,
    thirdFourthCoaches: [{
      userId: undefined as number | undefined,
      name: 'Regional semi-final coach' as string | undefined,
      nationality: 'Germany' as string | undefined,
    }],
  };
  return {
    'managers.json': [{ userId: 1, userName: 'Manager', nationality: 'Italy', lg: 1, main: 0, sec: 0, hm: 0, sn: 0, wc: 0, wcSilver: 0, wcBronze: 0, lgLast: 1, mainLast: 0, secLast: 0, hmLast: 0, snLast: 0, wcLast: 0, titles: [title], cupsMain: [], cupsSec: [], masters: [] as Array<typeof title & { cup: string }>, seasonal: [], worldCup: [], medals: [] }],
    'leagues.json': [{ leagueId: 4, country: 'Italy', champions: [{ season: 94, club: 'Club', manager: 'Manager', teamId: 7, userId: 1 }] }],
    'cups.json': [{ leagueId: 4, country: 'Italy', cups: [{ cupId: 10, cupName: 'National Cup', isMain: true, cupLevel: 1, cupLevelIndex: 1, winners: [] }] }],
    'masters.json': [] as Array<{ season: number; club: string; manager: string; teamId?: number; userId?: number; leagueId?: number }>, 'seasonal.json': [],
    'worldcup.json': {
      senior: [worldCupEdition], youth: [],
      regional: [{ cupId: 20, cupName: 'Regional Cup', isYouth: false, seasons: [regionalSeason] }],
    },
    'elections.json': [
      { leagueId: 4, countryName: 'Italy', edition: 40, host: 'Italy', winnerUserId: 1, winner: 'Manager', winnerNationality: 'Italy' as string | undefined, votes: '50' },
      { leagueId: 4, countryName: 'Italy', edition: 40, host: 'Italy', winnerUserId: 1, winner: 'Manager', winnerNationality: 'Italy' as string | undefined, votes: '50' },
    ],
  };
}
async function save(dir: string, data: ReturnType<typeof fixture>) {
  await mkdir(dir, { recursive: true });
  for (const name of RELEASE_FILES) await writeFile(join(dir, name), JSON.stringify(data[name]));
}
async function temporary(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'hattrick-release-'));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('current public archive passes independent cross-file reconciliation (read only)', async () => {
  const current = fileURLToPath(new URL('../../../web/public/data', import.meta.url));
  const report = await validateRelease(current, current);
  assert.ok(report.historicalRecords > 1000);
});

test('same facts reuse content version and last-change date across checks', async () => temporary(async (dir) => {
  const candidateDir = join(dir, 'candidate');
  await save(candidateDir, fixture());
  const first = await prepareRelease({ candidateDir, outputDataDir: join(dir, 'first'), codeRevision: 'abc', generatedAt: '2026-09-12T05:17:00Z' });
  const next = await prepareRelease({ candidateDir, outputDataDir: join(dir, 'next'), previousDataDir: join(dir, 'first'), codeRevision: 'def', generatedAt: '2026-09-13T05:17:00Z' });
  assert.equal(first.dataVersion, next.dataVersion);
  assert.equal(first.manifest.lastChangedAt, next.manifest.lastChangedAt);
  assert.notEqual(first.manifest.generatedAt, next.manifest.generatedAt);
  assert.equal(Object.keys(next.manifest.files).length, 7);
  const payload = await readFile(join(dir, 'next', 'versions', next.dataVersion, 'leagues.json'), 'utf8');
  assert.deepEqual(JSON.parse(payload), fixture()['leagues.json']);
}));

test('lost historical rows block a release even if replaced by a newer row', async () => temporary(async (dir) => {
  await save(join(dir, 'before'), fixture());
  const data = fixture();
  data['leagues.json'][0]!.champions[0]!.season = 95;
  data['managers.json'][0]!.titles[0]!.season = 95;
  await save(join(dir, 'after'), data);
  await assert.rejects(validateRelease(join(dir, 'after'), join(dir, 'before')), /lost historical record/);
}));

test('new unattributed champion ends the old managers reigning status', async () => temporary(async (dir) => {
  const data = fixture();
  data['leagues.json'][0]!.champions.push({ season: 95, club: 'New club', manager: '—', teamId: 9, userId: undefined as unknown as number });
  data['managers.json'][0]!.titles[0]!.last = false;
  data['managers.json'][0]!.titles[0]!.ago = 1;
  data['managers.json'][0]!.lgLast = 0;
  await save(dir, data);
  await validateRelease(dir);
  data['managers.json'][0]!.titles[0]!.last = true;
  data['managers.json'][0]!.lgLast = 1;
  await save(dir, data);
  await assert.rejects(validateRelease(dir), /inconsistent titles/);
}));

test('release audit reports an unattributed reigning Masters winner without blocking valid publication', async () => temporary(async (dir) => {
  const data = fixture();
  data['masters.json'].push({ season: 95, club: 'FC Wieselhausen', manager: '—', teamId: 820764, leagueId: 3 });
  await save(join(dir, 'candidate'), data);
  const report = await validateRelease(join(dir, 'candidate'));
  assert.equal(report.recentManagerCoverage.complete, false);
  assert.equal(report.recentManagerCoverage.byFamily.masters.checked, 1);
  assert.equal(report.recentManagerCoverage.byFamily.masters.missing, 1);
  assert.deepEqual(report.recentManagerCoverage.examples[0], {
    family: 'masters', competitionKey: 'cup:183', edition: 95, winner: 'FC Wieselhausen',
  });
  const release = await prepareRelease({ candidateDir: join(dir, 'candidate'), outputDataDir: join(dir, 'packaged'), codeRevision: 'test' });
  assert.equal(release.validation.recentManagerCoverage.complete, false);
  assert.match(release.dataVersion, /^[a-f0-9]{64}$/);
}));

test('recent manager audit checks only the latest completed winner in each competition', async () => temporary(async (dir) => {
  const data = fixture();
  data['worldcup.json'].senior = [];
  data['worldcup.json'].regional = [];
  data['masters.json'].push(
    { season: 94, club: 'Former winner', manager: '—' },
    { season: 95, club: 'FC Wieselhausen', manager: 'Manager', teamId: 820764, userId: 1, leagueId: 3 },
  );
  const manager = data['managers.json'][0]!;
  manager.hm = 1;
  manager.hmLast = 1;
  manager.masters.push({ country: 'International', leagueId: 3, season: 95, club: 'FC Wieselhausen',
    teamId: 820764, cup: 'Hattrick Masters', last: true, ago: 0 });
  await save(dir, data);
  const report = await validateRelease(dir);
  assert.equal(report.recentManagerCoverage.complete, true);
  assert.equal(report.recentManagerCoverage.byFamily.masters.checked, 1);
  assert.equal(report.recentManagerCoverage.byFamily.masters.missing, 0);
  assert.equal(report.recentManagerCoverage.missing, 0);
}));

test('verified identities, election multiplicity, and medal totals are protected', async () => temporary(async (dir) => {
  await save(join(dir, 'before'), fixture());
  const data = fixture();
  data['leagues.json'][0]!.champions[0]!.userId = 2;
  data['managers.json'][0]!.userId = 2;
  await save(join(dir, 'after'), data);
  await assert.rejects(validateRelease(join(dir, 'after'), join(dir, 'before')), /changed verified manager/);
  const elections = fixture();
  elections['elections.json'].pop();
  await save(join(dir, 'after'), elections);
  await assert.rejects(validateRelease(join(dir, 'after'), join(dir, 'before')), /lost or changed election/);
  const medals = fixture();
  medals['managers.json'][0]!.wcSilver = 1;
  await save(join(dir, 'after'), medals);
  await assert.rejects(validateRelease(join(dir, 'after')), /incorrect medal totals/);
}));

test('missing files and tampered previous releases block packaging', async () => temporary(async (dir) => {
  const candidateDir = join(dir, 'candidate');
  await save(candidateDir, fixture());
  const first = await prepareRelease({ candidateDir, outputDataDir: join(dir, 'first'), codeRevision: 'abc' });
  await writeFile(join(dir, 'first', 'versions', first.dataVersion, 'elections.json'), '[]');
  await assert.rejects(prepareRelease({ candidateDir, outputDataDir: join(dir, 'next'), previousDataDir: join(dir, 'first'), codeRevision: 'def' }), /checksum mismatch/);
  await rm(join(candidateDir, 'cups.json'));
  await assert.rejects(validateRelease(candidateDir), /ENOENT/);
}));

test('newly covered frontend fields reject malformed release data', async () => temporary(async (dir) => {
  type Data = ReturnType<typeof fixture>;
  const cases: Array<{ name: string; file: string; mutate: (data: Data) => void }> = [
    { name: 'cup-level', file: 'cups.json', mutate: (data) => { data['cups.json'][0]!.cups[0]!.cupLevel = 0; } },
    { name: 'cup-level-index', file: 'cups.json', mutate: (data) => { data['cups.json'][0]!.cups[0]!.cupLevelIndex = 1.5; } },
    { name: 'election-winner-nationality', file: 'elections.json', mutate: (data) => { data['elections.json'][0]!.winnerNationality = 4 as never; } },
    { name: 'world-cup-host', file: 'worldcup.json', mutate: (data) => { data['worldcup.json'].senior[0]!.host = 4 as never; } },
    { name: 'world-cup-finished', file: 'worldcup.json', mutate: (data) => { data['worldcup.json'].senior[0]!.finished = 4 as never; } },
    { name: 'world-cup-age-group', file: 'worldcup.json', mutate: (data) => { data['worldcup.json'].senior[0]!.ageGroup = 4 as never; } },
    { name: 'champion-coach-id', file: 'worldcup.json', mutate: (data) => { data['worldcup.json'].senior[0]!.coachUserId = 0; } },
    { name: 'champion-coach-name', file: 'worldcup.json', mutate: (data) => { data['worldcup.json'].senior[0]!.coach = 4 as never; } },
    { name: 'champion-coach-nationality', file: 'worldcup.json', mutate: (data) => { data['worldcup.json'].senior[0]!.coachNationality = 4 as never; } },
    { name: 'runner-up-coach-id', file: 'worldcup.json', mutate: (data) => { data['worldcup.json'].senior[0]!.runnerUpCoachUserId = -1; } },
    { name: 'runner-up-coach-name', file: 'worldcup.json', mutate: (data) => { data['worldcup.json'].senior[0]!.runnerUpCoach = 4 as never; } },
    { name: 'runner-up-coach-nationality', file: 'worldcup.json', mutate: (data) => { data['worldcup.json'].senior[0]!.runnerUpCoachNationality = 4 as never; } },
    { name: 'third-fourth-coach-id', file: 'worldcup.json', mutate: (data) => { data['worldcup.json'].senior[0]!.thirdFourthCoaches[0]!.userId = 1.5; } },
    { name: 'third-fourth-coach-name', file: 'worldcup.json', mutate: (data) => { data['worldcup.json'].senior[0]!.thirdFourthCoaches[0]!.name = 4 as never; } },
    { name: 'third-fourth-coach-nationality', file: 'worldcup.json', mutate: (data) => { data['worldcup.json'].senior[0]!.thirdFourthCoaches[0]!.nationality = 4 as never; } },
    { name: 'regional-status', file: 'worldcup.json', mutate: (data) => { data['worldcup.json'].regional[0]!.seasons[0]!.status = 4 as never; } },
    {
      name: 'unexpected-world-cup-field', file: 'worldcup.json',
      mutate: (data) => { (data['worldcup.json'].senior[0]! as typeof data['worldcup.json']['senior'][number] & { typo?: boolean }).typo = true; },
    },
  ];

  for (const item of cases) {
    const candidate = join(dir, item.name);
    const data = fixture();
    item.mutate(data);
    await save(candidate, data);
    await assert.rejects(validateRelease(candidate), new RegExp(item.file.replace('.', '\\.')));
  }
}));
