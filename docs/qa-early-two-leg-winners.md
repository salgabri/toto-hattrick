# Early two-leg cup-winner review — 11 September 2026

This document preserves the initial five-country review and first 32 corrections. The completed 88-country review and final totals—52 corrected winners and 20 cleared positive manager attributions—are documented in `docs/qa-remaining-early-cup-verification.md`.

The saved pre-repair archive contains **five incorrect existing cup champions** among 43 reviewed rows. Each incorrect club won the second leg but lost the aggregate; the historical final table explicitly names the other club as champion. These are separate from the missing-final recovery.

| Cup / local season | Stored champion | Verified cup champion | First leg; second leg | Aggregate |
| --- | --- | --- | --- | --- |
| Italy 7 / 17 | Kender's F.C. | A.S. Roma Calcio | 7–3; 0–1 | 7–4 |
| Poland 25 / 3 | Legia Gdansk | Twisters | 4–1; 1–3 | 5–4 |
| Poland 25 / 7 | ZKS Masarnia Miesiw Pcin Dolny | Rude Boyz | 5–0; 1–2 | 6–2 |
| Poland 25 / 11 | Dziobaki | -Tornado- | 5–0; 0–3 | 5–3 |
| Belgium 41 / 4 | FC Drummer | Lokomotiv Veltem | 4–1; 1–2 | 5–3 |

All displayed scores use **cup champion / runner-up order**, not asserted home/away order. Sources: [Coppa Italia final matches](https://wiki.hattrick.org/wiki/Coppa_Italia), [Puchar Polski finals](https://wiki.hattrick.org/wiki/Puchar_Polski), and [Belgium Cup champions and finals](https://wiki.hattrick.org/wiki/Belgium_Cup). Belgium's table also links matches 3545479 and 3545480. No stored final was re-fetched.

The bounded comparison covered the earliest stored seasons through global season 24: England local 15–24 (nine existing rows), Italy 15–24 (nine), Poland 3–12 (nine), Belgium 2–11 (eight), and Brazil 3–12 (eight). **38 rows agree** after conservative whitespace normalization. Seven missing rows within these ranges are excluded from both the 43 comparisons and five mismatches; they belong to the independent gap-recovery work. The additional sources are [England's national trophy table](https://wiki.hattrick.org/wiki/England) and [Copa do Brasil's local/global season table](https://wiki.hattrick.org/wiki/Copa_do_Brasil).

`qa/early-two-leg-winner-review.json` retains every comparison, exact five before-rows, per-row SHA-256 fingerprints, source URLs and observed revision URLs. It compares the immutable `.backup/qa-fixes-20260911/dev.db`, so later repairs do not erase the original evidence. HattrickWiki is community maintained; this evidence comes from exact season/final rows, not new CHPP winner responses. Poland's separate overall-victories table was not used as a season oracle. England's country table was used because the standalone cup page could not be opened.

## Reviewable corrections

All five current rows were reconstructed winner-only records: `finalMatchId=0`, unknown club IDs, an empty runner-up and unavailable 0/0 score placeholders. The correction plan changes the champion to the documented aggregate winner and records the old champion as runner-up. It preserves the unavailable scores and final ID, leaves numeric club IDs null, and clears the four old positive manager attributions plus their names. A former loser's manager must not inherit the corrected club's trophy. No new winning club or historical manager ID is inferred.

`qa/correct-stored-cup-winners.mjs` defaults to read-only planning and contains no environment/auth imports or network access. Its plan contains complete before/after rows, a displayed field diff and fixed update time. It verifies the pre-fix backup, exact original row fingerprints, source evidence and finalist relationship. Applying rechecks every row before a single update, runs one transaction and rejects any concurrent conflict. Replaying the same successful plan is a no-op. An edited plan cannot add guessed IDs, change score fields or hide a different patch.

```powershell
node qa/early-two-leg-winner-audit.mjs
node --test qa/correct-stored-cup-winners.test.mjs
node qa/correct-stored-cup-winners.mjs --report qa/results/cup-stored-corrections-plan.json
```

The five-row plan is saved at `qa/results/cup-stored-corrections-plan.json`. Report paths must be new files. The root task is the sole operator for applying reviewed data repairs:

```powershell
node qa/correct-stored-cup-winners.mjs --apply --plan qa/results/cup-stored-corrections-plan.json --report qa/results/cup-stored-corrections-applied.json
```

An explicitly reviewed additional JSON evidence array can be merged using `--additional <file>` during both planning and applying. Spelling or rename candidates remain outside this plan until their finalist identities are corroborated. No production database row was changed by this audit subtask.

**Validation:** nine in-memory correction tests pass. They verify read-only planning, exact after-rows, idempotence, whole-batch rollback on a later-row conflict, changed-backup rejection, tampered plan/source rejection, winner/runner-up agreement, aggregate arithmetic and isolation of all 32 final corrections from the three correct source-difference cases.

## Wider primary-source corroboration and final combined plan

The separate 33-country Wiki review found 30 name differences among 366 compared existing cup rows. All 30 candidates were checked with **60 successful CHPP `cupmatches` version 1.2 requests**, one last bracket and one exact preceding round per candidate. The calls were authorized specifically for reconstructed rows with no retained final match ID. No matchdetails request was made, and none of the observed final match IDs was already stored. Parsed responses, exact cup/season/round request parameters and capture times are retained in `qa/cup-stored-primary-results.json`.

**27 additional stored champions were confirmed to be losing finalists on aggregate.** For every one, the independently calculated aggregate winner exactly matches the Wiki season winner and the other finalist exactly matches the previously stored champion. Together with the original five, the combined plan corrects **32 existing champions and clears nine old positive manager attributions**. The builder `qa/build-cup-primary-correction-evidence.mjs` independently recomputes each aggregate from captured home/away scores before emitting `qa/cup-stored-primary-corrections.json`.

Three apparent differences were correctly excluded: Egypt cup 19/S6 retains `Alexandria Pharaons` (the Wiki spelling differs); Iceland cup 36/S10 retains `Starkers`, and S12 retains `Valkyries` (the compared Wiki cells contained manager names). Their stored champions agree with the primary results. No rename or spelling substitution was applied.

The initial five-row plan remains as an intermediate audit artifact. The complete reviewable plan is **`qa/results/cup-stored-corrections-combined-plan.json`**, containing every exact before/after row. Its root-only application command is:

```powershell
node qa/correct-stored-cup-winners.mjs --additional qa/cup-stored-primary-corrections.json --apply --plan qa/results/cup-stored-corrections-combined-plan.json --report qa/results/cup-stored-corrections-combined-applied.json
```

The script also supports independently corroborated winner-only evidence with two precise source pages and no asserted runner-up; this fallback was tested but was unnecessary for the final combined plan because every included case has both-leg evidence. Existing score placeholders and final IDs remain unchanged in this narrowly scoped correction; actual primary bracket scores are retained in the evidence rather than substituted into fields with previously unknown orientation.

The first unprivileged network attempt failed with sanitized TypeErrors. The authorized network retry succeeded; it used the pinned endpoint wrapper throughout. A mistaken version label in the failed-attempt report was corrected to describe the actual requested version. The network failure did not change archive data.
