// Retired: this legacy script guessed historical owners, re-fetched stored match details, and
// could overwrite established Masters facts. Fail before importing credentials or the database.
throw new Error(
  'Legacy Masters recovery is retired. No records were changed and no Hattrick calls were made. ' +
  'Use restore-winner-cache.ts for stored match/team facts, ' +
  'npm run recover:historical-winners -w server -- --input <club-histories.json> for dated ownership evidence, ' +
  'or apply-verified-winners.ts --source <verified-winners.json> for reviewed direct winner evidence. ' +
  'Each replacement defaults to a dry run; review its report before adding --apply. ' +
  'See docs/HISTORICAL_WINNER_RECOVERY.md and docs/WINNER_RECOVERY_SOURCES.md.',
);

export {};
