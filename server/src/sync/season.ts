/**
 * Hattrick has no single "season" field on every match — derive it from matchDate and store it.
 *
 * Season numbers are PER-COUNTRY but the cadence is shared: a season is exactly 16 weeks
 * (112 days). Anchor below is the Italia league (LeagueID 4), confirmed from real data:
 *   - worlddetails reported Season 94, MatchRound 14, SeriesMatchDate 2026-07-04.
 *   - Round 1 is therefore 2026-07-04 − 13·7d = 2026-04-04, which matches the league fixtures
 *     in samples/matchesarchive.xml (MatchType 1 on 2026-04-04, 2026-06-27, …).
 * The boundary is set ~7 days before round 1 so it falls inside the inter-season gap; that
 * keeps the early cup round (e.g. 2026-03-31) in the same season as its league campaign.
 *
 * Only valid for an Italia-league team. A team in another country needs a different anchor
 * (pull its current Season from worlddetails for that LeagueID).
 */
const SEASON_DAYS = 112;
const SEASON_MS = SEASON_DAYS * 24 * 60 * 60 * 1000;
const ANCHOR_SEASON = 94;
const ANCHOR_BOUNDARY_MS = Date.UTC(2026, 2, 28); // 2026-03-28, ~1 week before season-94 round 1

export function deriveSeason(matchDate: Date): number {
  return ANCHOR_SEASON + Math.floor((matchDate.getTime() - ANCHOR_BOUNDARY_MS) / SEASON_MS);
}

/**
 * Yield [firstMatchDate, lastMatchDate] windows walking backward from `from` to `to`,
 * sized to stay under the matchesarchive max range per call. Inclusive of bounds.
 */
export function* seasonWindows(
  from: Date,
  to: Date,
  windowDays = 90,
): Generator<{ firstMatchDate: string; lastMatchDate: string }> {
  // CHPP's matchesarchive date filter only honours date-only "YYYY-MM-DD". Passing a time
  // component makes it silently ignore the range and return the latest season — so emit dates.
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  let end = new Date(from);
  while (end > to) {
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - windowDays);
    const clampedStart = start < to ? to : start;
    yield { firstMatchDate: fmt(clampedStart), lastMatchDate: fmt(end) };
    end = new Date(clampedStart);
    end.setUTCSeconds(end.getUTCSeconds() - 1);
  }
}
