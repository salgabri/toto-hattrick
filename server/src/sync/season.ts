/**
 * Hattrick has no single "season" field on every match — derive it from matchDate and
 * store it so season queries stay cheap.
 *
 * TODO: implement against Hattrick's real season boundaries (a season is ~16 weeks;
 * the league schedule defines the exact cutover). Confirm the anchor date/length from
 * teamdetails or the CHPP docs, then replace this stub.
 */
export function deriveSeason(_matchDate: Date): number {
  throw new Error(
    'deriveSeason not implemented — set Hattrick season boundaries from real data first.',
  );
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
  const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');
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
