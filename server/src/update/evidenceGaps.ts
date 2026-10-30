/**
 * Terminal evidence gaps. A valid official response proved that the source can no longer supply
 * the fact, so the task stays `needs_review` (visible until retained evidence closes it), is not
 * re-fetched, and is not reported as a failed source check. Each writer owns the narrow condition
 * that reopens its gap.
 */
export const TEAM_DELETED = 'team_deleted';
export const LEAGUE_INACTIVE = 'league_inactive';
export const EVIDENCE_GAP_CATEGORIES: ReadonlySet<string> = new Set([TEAM_DELETED, LEAGUE_INACTIVE]);

/** Keyed to the exact club, so a corrected winner id no longer matches and reopens its task. */
export function deletedTeamReason(teamId: number): string {
  return `Official teamdetails reports that champion club ${teamId} no longer exists; its country needs retained win-time evidence`;
}

export const LEAGUE_INACTIVE_REASON = 'Official worlddetails reports no active teams in this league and a probe found no result; checks resume when the league has active teams again';
