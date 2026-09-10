// Retired: legacy teamId+season JSONL cannot verify the competition or ownership at a win.
// Use the dated, evidence-aware replacement; never silently overwrite known winners.
throw new Error(
  'Legacy manager JSONL is no longer accepted. No records were changed. ' +
  'Use npm run recover:historical-winners -w server -- --input <club-histories.json> ' +
  'to review dated, competition-specific evidence, then add --apply. ' +
  'See docs/HISTORICAL_WINNER_RECOVERY.md.',
);

export {};
