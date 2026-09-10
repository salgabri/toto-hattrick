# Abandoned-club winner recovery — 2026-09-10

Applied locally and baked into `web/public/data`; not deployed.

## Results

| Change | League titles | Cup titles |
| --- | ---: | ---: |
| Previously missing manager restored | 66 | 113 |
| Incorrect established manager corrected | 0 | 4 |
| Missing winning-club ID restored | 0 | 312 |

The database still contains exactly 9,913 league and 32,161 cup records. No winning club names
changed and no trophy records were added or removed. Seventeen recovered managers were added to
the baked manager index; all seventeen missing nationalities were resolved through CHPP.

Re Picante's Coppa Italia S88 and Heroes of 2019 Trophy edition 17 now belong to SebasM
(11687578). Four Ghana Re Picante wins were also corrected from later owner Chapeaux to SebasM:
Gold Coast Cup S28/S29, Ruby S34, and Sapphire S33. The live manager profile lists SebasM's two
current clubs and both former Re Picante tenures; the dated trophy events independently name him.

## Evidence and coverage

- Checked 597 club-history targets; 118 returned usable rows, comprising 551 saved pages. Only
  91 histories completed pagination, so the others were eligible for direct trophy-manager links
  only, not ownership inference.
- Recovered 111 exact titles from reviewed Hattrick Press/Wiki evidence and 68 from browser
  histories. All 179 missing-owner repairs have committed, per-title source manifests.
- Restored cached final facts before making new API calls. A bounded, facts-only recent main-cup
  pass used 72 CHPP calls to materialize 36 missing finals and club IDs; it attributed no managers.
- Reviewed the four positive-owner corrections separately, with exact expected old identities,
  direct manager-linked trophy evidence, an all-or-nothing transaction and a retained report.
- Unassigned club honours decreased from 9,097 to 8,918. Empty/closed histories, absent numeric
  manager identities and contradictory sources remain unresolved. This is not a claim that all
  historical winners are now identified. Name-only legacy target lists remain discovery hints.
- National-team/election history was inspected but not modified in this repair.

## Prevention and replay

Current-owner and club-name approximations are disabled by default. A bot/abandoned club is not
treated as proof that its former manager account is inactive. Network, quota and malformed-response
failures stay retryable. Known positive winner identities are protected; legacy overwrite importers
now stop with directions to the evidence-aware replacement. Cup season numbers are matched within
their competition, not confused with match-archive global season numbers. Reconstruction preserves
the IDs emitted by the bake.

See [source manifests and replay commands](WINNER_RECOVERY_SOURCES.md) and the
[browser-history workflow](HISTORICAL_WINNER_RECOVERY.md). Machine-local source captures and
application reports are under `.scrape/winner-recovery/`. The pre-change database and all seven
baked datasets are preserved under `.backup/winner-recovery-20260910/`.

Validation: 98 passing winner regression tests, both-workspace typecheck, web production build, database
before/after identity checks, replay idempotence, and a browser check of SebasM's generated cabinet.
