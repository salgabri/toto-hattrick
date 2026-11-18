import { extractHistoricalWinnerEvidence, type HistoricalClubHistory, type HistoricalClubState } from '../sync/historicalWinners.js';
import type { OwnerSnapshot } from './attribution.js';

/**
 * CHPP state for Club History captures. Club History never records an owner leaving, so a tenure
 * credit to a club's LAST recorded owner is only written once teamdetails shows whether that owner
 * still held the club at the win (see HistoricalClubState). Only those clubs are read.
 */
export function clubsNeedingState(histories: readonly HistoricalClubHistory[]): number[] {
  const bare = histories.map(({ current: _current, ...history }) => history);
  const { evidence } = extractHistoricalWinnerEvidence(bare);
  return [...new Set(evidence.filter((item) => item.lastOwner === 'unchecked').map((item) => item.teamId))];
}

export function clubState(snapshot: OwnerSnapshot, teamId: number, checkedAt: string): HistoricalClubState {
  if (snapshot.deleted) return { checkedAt, ownerUserId: 0, foundedDate: null };
  if (!snapshot.team || snapshot.team.teamId !== teamId) throw new Error(`teamdetails did not return club ${teamId}`);
  return { checkedAt, ownerUserId: snapshot.owner?.userId ?? 0, foundedDate: snapshot.team.foundedDate?.slice(0, 10) ?? null };
}

export interface AnnotationSummary { histories: number; needed: number; read: number; ownerless: number }

/** Returns new history records; `read(teamId)` is called once per club that needs CHPP state. */
export async function annotateClubHistories(histories: readonly HistoricalClubHistory[],
  read: (teamId: number) => Promise<OwnerSnapshot>, now: () => Date = () => new Date()) {
  const needed = new Set(clubsNeedingState(histories));
  const annotated: HistoricalClubHistory[] = [];
  const summary: AnnotationSummary = { histories: histories.length, needed: needed.size, read: 0, ownerless: 0 };
  for (const history of histories) {
    if (!needed.has(history.teamId)) { annotated.push(history); continue; }
    const state = clubState(await read(history.teamId), history.teamId, now().toISOString());
    summary.read++;
    if (state.ownerUserId === 0) summary.ownerless++;
    annotated.push({ ...history, current: state });
  }
  return { histories: annotated, summary };
}
