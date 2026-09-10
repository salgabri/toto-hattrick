# Completed early cup verification — 11 September 2026

The final coverage audit identified **619 existing main-cup records through global season 24 across 88 countries**. The original review covered 38 countries; the expansion checked the remaining **266 records in 50 countries**, including 216 records before the transition to single-match finals.

The expansion found **20 additional incorrect champions**. Together with the previous 32, **52 existing winners were corrected and 20 old positive manager attributions were cleared**. Every corrected club was the losing finalist on aggregate. The root task applied the corrections; its full comparison with the pre-fix backup confirmed exactly 50 added finals and 52 corrected rows, with no other public-table changes. The static data was subsequently rebuilt by the root task.

## Evidence and independent checks

All 266 additional rows were reconstructed placeholders without a retained final match ID. The primary audit made **532 successful CHPP `cupmatches` version 1.2 requests**: two during the successful one-row probe, then 530 further requests while reusing the probe. Each record has the exact requested cup, season and preceding round. No matchdetails request was made; returned final IDs were checked against stored matches, details and cup finals before proceeding. No returned final was already stored.

The primary results were **245 correct stored winners, 20 wrong finalists and one unresolved final format**. All 20 new winning names independently agree with HattrickWiki's season tables. The final production resolver was replayed offline against every capture, with a separate arithmetic calculation and stricter semifinal checks: **266 agreement checks passed, 265 results were decisive, and no source match ID was repeated**.

Two source limitations remain explicit:

- South Korea cup 23/S6 retains `Busan power`. Its final and preceding one-match round name different opposing clubs, so the primary format cannot be inferred safely. The [Korean national trophy table](https://wiki.hattrick.org/wiki/Hanguk) independently supports the stored champion.
- Czechia cup 50/S1 retains `hasek`, the independently verified 17–2 aggregate winner against FC Mike. The [Czech national trophy table](https://wiki.hattrick.org/wiki/Czechia) uses `Ničivá Síla`; no identity or rename was inferred from that discrepancy.

## Immutable artifacts

`qa/expanded-cup-primary-evidence.json` retains the complete pre-repair rows and parsed CHPP brackets. Its SHA-256 is:

```text
735ac6d3d542af28abf5608d350cbecfe3303e101000a2d4ee34505d357abb7b
```

`qa/expanded-cup-primary-replay.json` records the offline independent comparisons. `qa/cup-stored-remaining-corrections.json` references the frozen capture fingerprint and contains only the 20 newly discovered corrections. The earlier 32-row evidence and plans remain unchanged.

The new plan and root application receipt are `qa/results/cup-stored-corrections-remaining-plan.json` and `qa/results/cup-stored-corrections-remaining-applied.json`. Every plan retains complete before/after rows and field changes. Unknown scores, final IDs and numeric club identities are preserved; an old losing club's manager is never assigned to the corrected winner.

The correction tool's `primary-brackets` mode checks the retained input hash, exact request/response identities, consecutive rounds, distinct matches and finalists, complete scores, independent aggregate arithmetic, and original-row fingerprints. Single-match finals require two separate completed semifinals. No Wiki-only exception bypasses those checks. Applying a plan uses one transaction, rejects any changed original row, and reapplying the same plan makes no changes.

**All 11 correction tests pass**, including the full 32-row and 20-row plans, idempotence, conflict rollback, capture tampering, wrong seasons, reversed winners, duplicate legs, and preservation of the other 246 records in the expanded scope. The reporting change also passed its three real-orchestrator regressions and related server tests; see `docs/qa-cup-refresh-reporting.md`.

```powershell
node --test qa/correct-stored-cup-winners.test.mjs
```

The progress collector preserves previously cached records when a later `--limit` selects fewer targets or the current database has changed. The frozen evidence file is separate from progress output and cannot be overwritten by the evidence builder. No further source requests are needed to review the completed corrections.
