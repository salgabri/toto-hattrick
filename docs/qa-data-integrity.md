# Data integrity audit — 10–11 September 2026

**The repaired snapshot passes 534,492 assertions across 47 check groups, with zero failures.** It contains 42,293 completed titles: 33,307 attributed to managers and 8,986 without a verified manager. All 149 silver and 302 bronze medals still reconcile. There are no unexplained internal national-cup gaps; the one remaining gap is an evidenced mutual walkover. `qa/results/data-integrity.json` contains the reproducible current totals.

The original snapshot passed 534,275 internal assertions across 45 groups, but live CHPP exposed omitted and incorrect historical cup winners. Follow-up checks proved that 49 omitted results were two-leg finals; their exact aggregate winners have now been recovered. The initial tables below describe the pre-repair snapshot and remain available for comparison.

At the baseline, every row of all seven local static JSON bundles agreed with SQLite. All 33,316 attributed trophies and 451 attributed silver/bronze medals reconciled to their owners' cabinets, and every category counter and reigning/recency flag agreed with the underlying rows. Internal agreement alone did not reveal the historical source errors.

This establishes consistency of the stored snapshot, **not the historical truth or completeness of every Hattrick result**. A shared incorrect source attribution can pass DB-to-JSON reconciliation. Independent source checks are bounded to the saved evidence listed below; live Hattrick checks are reported separately by the overall QA audit.

## Reproduce

From the repository root, using Node 22.18+ (run used Node 24.18.1):

```powershell
node qa/data-integrity.ts
```

The script exits nonzero on a violated invariant and writes `qa/results/data-integrity.json`, including counts, each check group, sequence gaps, and concrete historical aliases. It opens `server/prisma/dev.db` with SQLite `readOnly: true`, performs SELECT statements only, excludes `ChppToken`, and never reads environment secrets, calls CHPP, imports the production baker, or modifies the public bundles. The only output writes are QA result files.

## Original snapshot totals and attribution coverage

| Competition | Stored finished wins | Attributed to a manager | Without a known manager |
|---|---:|---:|---:|
| Top-division leagues | 9,913 | 8,989 | 924 |
| Main national club cups | 9,754 | 7,676 | 2,078 |
| Secondary national club cups | 21,762 | 15,970 | 5,792 |
| Hattrick Masters | 67 | 57 | 10 |
| Seasonal tournaments | 578 | 464 | 114 |
| Senior/youth World Cups | 80 | 72 | 8 |
| Regional national-team cups | 89 | 88 | 1 |
| **Total** | **42,243** | **33,316** | **8,927** |

There are 160 league rolls, 159 national club-cup country groups, 24 seasonal competitions, 10 regional national-team competitions, and 10,307 managers. The World Cup bundle also contains one ongoing edition; regional data contains five ongoing rows. There are **175 national-competition rows but only 169 completed national titles**. Ongoing rows do not become trophies.

There are 7,137 election records: 5,540 named winners and 1,597 unattributed winners. Every named election winner has a nationality; none of the 10,307 cabinet managers has an unknown nationality. Re-elections in the same edition are preserved as distinct rows and are not incorrectly treated as duplicates.

National medal coverage is separate from trophy totals:

| Competition | Named runner-up nations | Attributed silver coaches | Named bronze nations | Attributed bronze coaches |
|---|---:|---:|---:|---:|
| World Cup | 72 | 64 | 144 | 129 |
| Regional cups | 89 | 85 | 178 | 173 |
| **Total** | **161** | **149** | **322** | **302** |

Some early World Cups omit runner-up/semifinal nations entirely. These omissions cannot be repaired by arithmetic. The 8,927 unattributed trophies are present in competition rolls but excluded from manager totals; that is a coverage limitation, not an internal summation error.

## What was checked

- Complete row equality of league, national cup, Masters, seasonal, World Cup, regional cup, and election exports, including every numerical ID, season/edition, podium coach, flag-country ID, and stored name.
- Competition metadata, unique competition/season and manager identities, cup routing, league order, registry season bounds, and the existence of positively identified users and countries.
- Every title and every silver/bronze entry independently reconstructed from DB records, then matched against manager cabinets as multisets. No trophy is duplicated, omitted, or assigned to an extra manager by the bake.
- All six per-manager trophy counters, all six reigning counters, silver/bronze counters, nonnegative recency values, and the equivalence of `last` with `ago === 0`. Anchors include unassigned competition winners, and the defunct Anniversary League remains excluded from reigning/recent counts.
- Podium nation/coach index alignment, distinct podium nations, completed-final dates, absence of champion coaches on ongoing competitions, valid election vote formats and percentage ranges, and paired election winner names/IDs.
- Numeric historical owners and clubs against **183 saved verified club-winner/correction records**, **three verified national podium records**, and **262 source election rows**. Historical display-name aliases are allowed. An unlinked retired winner in an old election source may have been subsequently recovered; the oracle does not incorrectly flag that as a contradiction.

The verified club evidence comprises 106 historical winner records, 43 club-history records, five Masters records, 25 recent-cup records, and four reviewed corrections under `server/src/data/`. These records can overlap the same result, so they are not claimed as 183 unique independently verified competitions.

## Initial coverage gaps and live-source investigation

The audit found **50 internal missing season numbers across 38 national club cups**, plus **Supporter Week Trophy season 11**. All are absent from both the database and JSON; therefore they cannot show in a manager cabinet. **All 50 national-cup gaps were confirmed against live CHPP as actual finals that the importer skips because the returned score is level.** These comprise 49 main national-cup finals and one secondary-cup final (Iran's Alborz Cup S 38).

Examples are Coppa Italia cup 7 / S 21; English Cup cup 3 / S 20; Coupe de France cup 6 / S 19 and S 20; Deutschland-Pokal cup 4 / S 19; Alborz Cup cup 714 / S 38. The complete initial list is in the saved gap-source report. At baseline, the saved Supporter Week source `server/src/sync/supporter-week-winners.json` also omitted S 11.

Live `cupmatches` version **1.2** calls on 10 September 2026 UTC returned exact requested competition/season IDs and exactly one last-round match for **all 50** targets. All 50 had level scores; there were zero empty responses, identity mismatches, request failures, or non-tied finals. Six examples:

| Competition | Season | Match ID | Returned final | Score |
|---|---:|---:|---|---|
| Coppa Italia (7) | 21 | 13913642 | Sgainator F.C. – Sporting Firenze | 2–2 |
| English Cup (3) | 20 | 9871105 | Kester County – Durham City FC | 1–1 |
| Coupe de France (6) | 19 | 7160871 | Sollet FK – Nappes Xcutors | 0–0 |
| Coupe de France (6) | 20 | 9778089 | Nappes Xcutors – AJ Auxerre | 1–1 |
| Deutschland-Pokal (4) | 19 | 7223754 | Exil Schwaben – FC Phoenix Mühlburg | 3–3 |
| Alborz Cup (714) | 38 | 541334258 | mahan – Irane Sabz | 0–0 |

**Original cause:** the old `syncCupChampions()` skipped every level final. Further primary checks established that all 49 old main-cup cases were tied **second legs**, not proof of penalties. Each preceding round contains exactly one distinct match between the same two finalists, and all 49 aggregates identify one winner. The raw matchdetails captures identify the finalists numerically. This includes Poland cup 25/S 9: MKS Narew Ostroleka won the first leg 5–1 and drew the second 0–0.

The Iranian secondary final is different: actual match 541334258 contains event 500 reporting a mutual walkover because neither team could field nine players. Its preceding round contains two semifinals. No club is assigned the trophy without winner evidence; `server/src/data/cup-final-non-awards.json` records the diagnostic and its retained source. The audit now distinguishes that explained gap from recoverable omissions.

Supporter Week S 11 was independently identified as Beta Broncos, England, by the public Supporter Week and CPAM FC Supporter Week Trophy histories. Its separate guarded repair intentionally leaves unknown numeric club/manager identities unassigned.

The normal saved-source importer now reproduces that repair: all 37 Supporter Week editions are present in the committed source, including S11's proven country and runner-up with both source URLs. Weak source rows preserve subsequently verified club/manager IDs, and conflicting winner/country facts abort transactionally. A partial replay cannot lower the registry season. Static JSON imports ensure both Supporter Week and generation-trophy source files are emitted in a clean server build. Eight additional seasonal tests pass, including unknown-ID ingestion with zero HTTP calls.

The live script is `qa/live-cup-gap-audit.mjs`, run from `server/` with `node ../qa/live-cup-gap-audit.mjs`. It reads the 50 gap targets from the integrity report, rechecks database absence before each read-only request, skips a target if it has become stored, and reuses previously successful responses. The first six successful responses were reused when checking the remaining 44, so no successful final response was requested twice. Safe summarized results are in `qa/live-cup-gap-results.json`. The script never fetches matchdetails or re-fetches a stored final; no credentials or raw XML are written. Initial sandbox network attempts failed; authorized network execution completed all 50 checks.

There are also 117 initial season numbers preceding the first recorded season across 23 league rolls. These are reported separately and must not be represented as 117 missing titles: early leagues share legacy numbering, so a league may not have existed at S 1. There are no internal league-roll gaps, no internal Masters gaps, and no internal World Cup/regional gaps.

## Repairs and regression coverage

`server/src/sync/cupFinals.ts` now validates the preceding round before deciding a cup winner, sums two-leg aggregates, and refuses level aggregates without explicit cup-winner evidence. An extra-time event 72 describes the winner of that match and cannot override a two-leg aggregate. A tied second-leg score is never automatically labeled as penalties. Enrichment matches the archived winning club to retained numeric finalists, preserving aggregate winners that lost their second leg.

The 49 create-only recovery records contain sanitized actual match fields, source URLs, and capture hashes in `server/src/data/recovered-cup-final-evidence.json`. All new clubs have directly proven numeric team IDs; no historical manager was inferred from current ownership. `server/src/scripts/recover-cup-finals.ts` is dry-run by default and rechecks absence, competition metadata, and unique final IDs in a transaction on apply. A repeat dry-run after the coordinated repair reported 49 already-stored, one no-winner, zero unresolved, and zero conflicts. The separate stored-winner audit also led to 32 guarded corrections coordinated by the overall QA task.

An additional bounded compatibility probe sampled the current, unarchived Masters match 771464494. The actual XML proves MatchType 7 with MatchContextId 183; domestic final samples use MatchType 3. No stored match was fetched. ArenaHub seasonal histories retain their dedicated ingestion route, since `cupmatches` does not provide those tournament histories.

The 36 targeted tests in `cupFinals.test.ts` and `recoverCupFinals.test.ts` cover all 49 real recovered winners, mutual walkovers, extra-time/aggregate conflicts, missing format evidence, guarded recovery/idempotence, Masters typing, and stored-match reuse. Already archived Match rows can supply finalist IDs for decisive single/aggregate scores without any matchdetails request. Unresolved ties remain unresolved when the retained archive has no winner event. Placeholder upgrades preserve a known club's country through renames and clear stale country/manager text when the winning identity changes. Cup fetch/validation issues are surfaced without signed URLs.

Additional final review tightened single-final recognition: the preceding round must contain two distinct completed semifinals with each finalist in a different match. An unmatched one-match preceding round remains unresolved instead of falling back to a potentially misleading second-leg score. A retained final ID already assigned to another competition/season cannot create or upgrade a duplicate winner row. Four orchestration tests also verify issue reporting and seasonal exclusion from domestic/Masters refreshes, bringing the focused suite to 40 passing tests.

```powershell
npm run build -w server
node --test server/dist/sync/cupFinals.test.js server/dist/sync/recoverCupFinals.test.js
# Inspect a repeatable recovery plan without writing the database:
cd server
node dist/scripts/recover-cup-finals.js
```

## Identity hazards for frontend aggregation

Seven league rows and 20 cup rows retain a historical manager alias differing from the current `HattrickUser.loginName`. Examples are user 2820109 (`Carlos-Tevez` / `Carlos_Tevez`), user 1177705 (`Makoto` / `Frano_Battousai`), and user 1091931 (`Khroulev` / `SpectRe`). Conversely, the current user registry has two numeric IDs named `siftekhar`. Numeric-ID cabinet joins remain correct; any name-keyed frontend aggregation must be checked for splitting aliases or merging different accounts.

The baker picks a cabinet display name from the first encountered historical title at `server/src/sync/bake.ts:121`, while roll rows preserve each title's historical manager at `server/src/sync/bake.ts:334` and `server/src/sync/bake.ts:365`. This explains why name equality is not a sound ownership key. The frontend audit owns the user-visible impact and reproductions.

## Remaining limits

`Team`, `Match`, `MatchDetail`, and `SeasonStanding` are empty. There are no populated local match scores, team W/D/L totals, goals, match scorers/ratings, or reconstructed league tables to compare against Hattrick. API empty-state checks are reported separately; this snapshot cannot establish those features' correctness on real populated data.

These checks do not establish that all latest competitions have been synced, that each historical manager attribution has independent ownership evidence, or that country flags/name mappings are correct on every rendered screen. Browser, frontend aggregation, and live read-only API checks belong to the companion overall report.
