import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseBulkHistoricalWinnerJsonl, processBulkHistoricalWinners, validateBulkCaptureBatch,
  validateBulkLinkedCapture, type BulkCaptureBatch, type BulkLinkedCapture } from './bulkHistoricalWinners.js';

const header = {
  format: 'hattrick-cup-history-v1' as const, capturedAt: '2026-09-26T12:00:00.000Z', page: 1 as const,
  sourceURLTemplate: 'https://www.hattrick.org/en/Club/History/?teamId={teamId}', hrefPrefix: '/en' as const,
};
const firstTuple = [7, 88, 1726060, '27-08-2024', 0, 'Re Picante', 'Coppa Italia', 'SebasM', 11687578, 88];
const secondTuple = [8, 88, 1726061, '27.08.2024', 1, 'Another Club', 'Another Cup', 'Other Manager', 123456, 88];
const thirdTuple = [9, 88, 1726062, '27.08.2024', 2, 'Third Club', 'Third Cup', 'Third Manager', 123457, 88];
const jsonl = (...rows: unknown[]) => [header, ...rows].map((row) => JSON.stringify(row)).join('\n');
const capture = () => parseBulkHistoricalWinnerJsonl(jsonl(firstTuple)).captures[0] as BulkLinkedCapture;

type Stored = {
  cupId: number; season: number; leagueId: number; championTeamId: number | null;
  championTeamName: string; championUserId: number | null; championUserName: string | null;
};

function fakeDb(initial: Stored[]) {
  const rows = initial.map((row) => ({ ...row }));
  const users = new Map<number, { userId: number; loginName: string; nationality?: string; isBot?: boolean }>();
  const reads: unknown[] = [];
  const writes: unknown[] = [];
  const db = {
    cupChampion: {
      findUnique: async (args: any) => {
        reads.push(args);
        const key = args.where.cupId_season;
        return rows.find((row) => row.cupId === key.cupId && row.season === key.season) ?? null;
      },
      updateMany: async (args: any) => {
        writes.push(args);
        const row = rows.find((item) => Object.entries(args.where).every(([key, value]) =>
          item[key as keyof Stored] === value));
        if (!row) return { count: 0 };
        Object.assign(row, args.data);
        return { count: 1 };
      },
    },
    hattrickUser: {
      upsert: async (args: any) => {
        const user = users.get(args.where.userId) ?? { ...args.create };
        users.set(args.where.userId, user);
        return user;
      },
    },
  } as unknown as Parameters<typeof processBulkHistoricalWinners>[0];
  return { db, rows, users, reads, writes };
}

const stored = (overrides: Partial<Stored> = {}): Stored => ({
  cupId: 7, season: 88, leagueId: 4, championTeamId: 1726060,
  championTeamName: 'Re Picante', championUserId: null, championUserName: null, ...overrides,
});

test('compact tuple expands to the exact dated direct statement and four canonical anchors', () => {
  const batch = parseBulkHistoricalWinnerJsonl(jsonl(firstTuple, secondTuple, thirdTuple));
  assert.equal(batch.captures.length, 3);
  const first = batch.captures[0] as BulkLinkedCapture;
  assert.equal(first.sourceURL, 'https://www.hattrick.org/en/Club/History/?teamId=1726060');
  assert.equal(first.winDate, '2024-08-27');
  assert.equal(first.row.text, '27-08-2024 In season 88, Re Picante emerged victorious from Coppa Italia. They were managed by SebasM.');
  assert.deepEqual(first.row.links.map((link) => link.text), ['88', 'Re Picante', 'Coppa Italia', 'SebasM']);
  assert.deepEqual(validateBulkLinkedCapture(first).userId, 11687578);
  assert.equal((batch.captures[1] as BulkLinkedCapture).row.text,
    '27.08.2024 Season 88 was memorable for Other Manager, who led Another Club to the title in Another Cup.');
  assert.equal((batch.captures[2] as BulkLinkedCapture).row.text,
    '27.08.2024 Third Club, under the leadership of Third Manager, won Third Cup season 88.');
  assert.deepEqual((batch.captures[2] as BulkLinkedCapture).row.links.map((link) => link.text),
    ['Third Club', 'Third Manager', 'Third Cup', '88']);
});

test('verbatim fallback accepts observed variant hrefs and leadership wording', () => {
  const observed: BulkLinkedCapture = {
    status: 'linked', cupId: 7, season: 88, teamId: 1726060, teamName: 'Re Picante',
    sourceURL: 'https://www.hattrick.org/en/Club/History/?teamId=1726060', page: 1,
    winDate: '2024-08-27', row: {
      text: '27-08-2024 Re Picante, under the leadership of SebasM, won Coppa Italia season 88.',
      links: [
        { text: 'Re Picante', href: '/Club/?TeamID=1726060' },
        { text: 'SebasM', href: '/Club/Manager/?userId=11687578' },
        { text: 'Coppa Italia', href: '/World/Cup/?CupID=7' },
      ],
    },
  };
  const batch = parseBulkHistoricalWinnerJsonl(jsonl(observed));
  assert.equal(validateBulkLinkedCapture(batch.captures[0] as BulkLinkedCapture).userId, 11687578);
});

test('rejects missing explicit anchors, contradictory IDs, labels, source URLs, and invalid dates', () => {
  const original = capture();
  const links = original.row.links;
  const variants: BulkLinkedCapture[] = [
    { ...original, row: { ...original.row, links: links.filter((link) => !link.href.includes('/Club/?')) } },
    { ...original, row: { ...original.row, links: links.filter((link) => !link.href.includes('/Manager/')) } },
    { ...original, row: { ...original.row, links: links.map((link) => link.text === 'Coppa Italia'
      ? { ...link, href: link.href.replace('CupID=7', 'CupID=8') } : link) } },
    { ...original, row: { ...original.row, links: links.map((link) => link.text === 'SebasM'
      ? { ...link, text: 'Different' } : link) } },
    { ...original, sourceURL: 'https://www.hattrick.org/en/Club/History/?teamId=999' },
    { ...original, winDate: '2024-08-28' },
    { ...original, row: { ...original.row, text: original.row.text.replace('27-08-2024', '31-02-2024') } },
  ];
  for (const variant of variants) assert.throws(() => validateBulkLinkedCapture(variant));
  assert.throws(() => parseBulkHistoricalWinnerJsonl(jsonl([7, 88, 1726060, '31-02-2024', 0,
    'Re Picante', 'Coppa Italia', 'SebasM', 11687578, 88])));
});

test('one unresolved outcome per target is retained but never attributed', async () => {
  const batch = parseBulkHistoricalWinnerJsonl(jsonl(firstTuple,
    ['unresolved', 8, 88, 1726061, 'Another Club', 'retired-unlinked', {
      text: '27-08-2024 In season 88, Another Club emerged victorious from Another Cup. They were managed by a now retired manager.',
      links: [{ text: 'Another Club', href: '/en/Club/?TeamID=1726061' },
        { text: 'Another Cup', href: '/en/World/Cup/Cup.aspx?CupID=8' }],
    }]));
  const fake = fakeDb([stored()]);
  const result = await processBulkHistoricalWinners(fake.db, batch, true);
  assert.equal(result.counts.unresolved, 1);
  assert.equal(result.counts.applied, 1);
  assert.equal(fake.reads.length, 1);
  assert.equal(fake.writes.length, 1);
  assert.equal(fake.users.has(123456), false);
});

test('duplicates and malformed outcomes fail validation before any database read', async () => {
  const duplicate = parseBulkHistoricalWinnerJsonl(jsonl(firstTuple));
  duplicate.captures.push(duplicate.captures[0]!);
  const fake = fakeDb([stored()]);
  await assert.rejects(processBulkHistoricalWinners(fake.db, duplicate, true), /Duplicate target/);
  assert.equal(fake.reads.length, 0);
  assert.throws(() => parseBulkHistoricalWinnerJsonl(jsonl(['unresolved', 7, 88, 1726060,
    'Re Picante', 'retired-unlinked', null])));
});

test('a protected owner conflict blocks all writes in the batch', async () => {
  const batch = parseBulkHistoricalWinnerJsonl(jsonl(firstTuple, secondTuple));
  const fake = fakeDb([stored(), stored({ cupId: 8, championTeamId: 1726061,
    championTeamName: 'Another Club', championUserId: 999, championUserName: 'Prior Owner' })]);
  const result = await processBulkHistoricalWinners(fake.db, batch, true);
  assert.equal(result.blocked, true);
  assert.equal(result.counts.conflicts, 1);
  assert.equal(result.counts.wouldApply, 1);
  assert.equal(fake.writes.length, 0);
  assert.equal(fake.users.size, 0);
});

test('exact positive team ID is mandatory even when club names agree', async () => {
  const fake = fakeDb([stored({ championTeamId: 999 })]);
  const result = await processBulkHistoricalWinners(fake.db, parseBulkHistoricalWinnerJsonl(jsonl(firstTuple)), true);
  assert.equal(result.blocked, true);
  assert.equal(result.plans[0]?.reason, 'storedWinnerTeamMismatch');
  assert.equal(fake.writes.length, 0);
});

test('apply uses a guarded attribution and same-source replay is idempotent', async () => {
  const fake = fakeDb([stored({ championUserId: 0 })]);
  fake.users.set(11687578, { userId: 11687578, loginName: 'Current login', nationality: 'Italy', isBot: true });
  const batch = parseBulkHistoricalWinnerJsonl(jsonl(firstTuple));
  const first = await processBulkHistoricalWinners(fake.db, batch, true);
  assert.equal(first.counts.applied, 1);
  assert.deepEqual(fake.writes[0], { where: { cupId: 7, season: 88, leagueId: 4,
    championTeamId: 1726060, championTeamName: 'Re Picante', championUserId: 0, championUserName: null },
  data: { championUserId: 11687578, championUserName: 'Current login' } });
  assert.equal(fake.rows[0]?.championUserId, 11687578);
  assert.equal(fake.users.get(11687578)?.nationality, 'Italy');
  assert.equal(fake.users.get(11687578)?.isBot, true);
  const replay = await processBulkHistoricalWinners(fake.db, batch, true);
  assert.equal(replay.counts.unchanged, 1);
  assert.equal(fake.writes.length, 1);
});

test('missing rows remain pending while present exact rows can apply', async () => {
  const batch = parseBulkHistoricalWinnerJsonl(jsonl(firstTuple, secondTuple));
  const fake = fakeDb([stored()]);
  const result = await processBulkHistoricalWinners(fake.db, batch, true);
  assert.equal(result.counts.applied, 1);
  assert.equal(result.counts.missingRows, 1);
  assert.equal(result.blocked, false);
});

test('a stale compare-and-swap fails so the enclosing transaction must roll back', async () => {
  const fake = fakeDb([stored()]);
  const delegate = fake.db.cupChampion as unknown as { updateMany: (args: unknown) => Promise<{ count: number }> };
  delegate.updateMany = async () => ({ count: 0 });
  await assert.rejects(processBulkHistoricalWinners(fake.db,
    parseBulkHistoricalWinnerJsonl(jsonl(firstTuple)), true), /transaction must roll back/);
});

test('batch validator rejects a source URL template that did not name the observed club page', () => {
  const batch: BulkCaptureBatch = { header: { ...header,
    sourceURLTemplate: 'https://www.hattrick.org/en/Club/?teamId={teamId}' }, captures: [capture()] };
  assert.throws(() => validateBulkCaptureBatch(batch));
});
