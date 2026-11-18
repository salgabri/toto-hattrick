import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { XMLParser } from 'fast-xml-parser';
import type { HistoricalClubHistory, HistoricalRow } from '../sync/historicalWinners.js';
import { ownerSnapshot, type OwnerSnapshot } from './attribution.js';
import { annotateClubHistories, clubsNeedingState, clubState } from './clubHistoryState.js';

const xml = (name: string) => new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: true })
  .parse(readFileSync(new URL(`../../samples/${name}`, import.meta.url), 'utf8'));

const takeover = (date: string, userId: number, name: string): HistoricalRow => ({
  text: `${date} The club changed owner as ${name} took control and renamed it Club.`, links: [{ text: name, href: `/en/Club/Manager/?userId=${userId}` }] });
const retiredCup = (date: string, teamId: number): HistoricalRow => ({
  text: `${date} Club, under the leadership of a now retired manager, won Cup season 29.`,
  links: [{ text: 'Club', href: `/en/Club/?TeamID=${teamId}` }, { text: 'Cup', href: '/en/World/Cup/Cup.aspx?CupID=3' }] });
const club = (teamId: number, rows: HistoricalRow[]): HistoricalClubHistory => ({ teamId, club: 'Club', complete: true, pages: [{ page: 1, rows }] });

const lastOwner = club(1, [retiredCup('02.08.2006', 1), takeover('01.01.2002', 11, 'A')]);
const bounded = club(2, [takeover('01.01.2010', 22, 'B'), retiredCup('02.08.2006', 2), takeover('01.01.2002', 21, 'C')]);
const direct = club(3, [{ text: '27-08-2024 In season 88, Club emerged victorious from Cup. They were managed by D.', links: [
  { text: 'Cup', href: '/en/World/Cup/?CupID=7' }, { text: 'D', href: '/en/Club/Manager/?userId=33' }, { text: 'Club', href: '/en/Club/?TeamID=3' }] }]);

test('only clubs whose tenure credit names their last recorded owner need CHPP state', () => {
  assert.deepEqual(clubsNeedingState([lastOwner, bounded, direct]), [1]);
  // Existing state never hides the need: a re-run reads the club again.
  assert.deepEqual(clubsNeedingState([{ ...lastOwner, current: { checkedAt: 'T', ownerUserId: 0, foundedDate: null } }]), [1]);
});

test('real teamdetails samples become club state; a deleted club has no owner and no date', () => {
  assert.deepEqual(clubState(ownerSnapshot(xml('teamdetails.xml'), 2241372), 2241372, 'T'), { checkedAt: 'T', ownerUserId: 9491504, foundedDate: '2024-09-24' });
  assert.deepEqual(clubState(ownerSnapshot(xml('teamdetails-3.6-deleted-team.xml'), 54696), 54696, 'T'), { checkedAt: 'T', ownerUserId: 0, foundedDate: null });
  assert.throws(() => clubState(ownerSnapshot(xml('teamdetails.xml'), 1), 1, 'T'), /did not return club 1/);
});

test('annotation reads each needed club once and leaves the others untouched', async () => {
  const reads: number[] = [];
  const ownerless = (teamId: number): OwnerSnapshot => ({ deleted: false, owner: null,
    team: { teamId, name: 'Club', leagueId: 2, isBot: true, foundedDate: '2012-05-01T10:00:00.000Z' } });
  const { histories, summary } = await annotateClubHistories([lastOwner, bounded, direct],
    async (teamId) => { reads.push(teamId); return ownerless(teamId); }, () => new Date('2026-11-18T12:00:00.000Z'));
  assert.deepEqual(reads, [1]);
  assert.deepEqual(histories[0]!.current, { checkedAt: '2026-11-18T12:00:00.000Z', ownerUserId: 0, foundedDate: '2012-05-01' });
  assert.equal(histories[1], bounded);
  assert.equal(histories[2], direct);
  assert.deepEqual(summary, { histories: 3, needed: 1, read: 1, ownerless: 1 });
});
