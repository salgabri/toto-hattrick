# Frontend statistics audit — 10 September 2026

The static frontend does **not** receive live read-API responses: it consumes seven baked JSON files. This audit independently recounts those files, exercises all exported data loaders, and executes the actual statistical calculations inside the six frontend pages. It found reproducible errors in identity grouping, nation grouping, election timelines, election result attribution, streaks and edition labels. A browser check by the coordinating QA agent additionally confirmed stale cabinet counts after changing recency.

No product code, snapshots, database contents or external services were changed by this audit. The test suite deliberately remains red where current product behavior is wrong.

Run from the repository root:

```sh
node qa/run-frontend-statistics.mjs
```

Final run: **24 test groups, 18 passed, 6 failed**, approximately 19 seconds. No skipped tests. Complete machine-readable discrepancies are in [`qa/results/frontend-statistics.json`](../qa/results/frontend-statistics.json). The tests are in [`qa/frontend-statistics.test.mts`](../qa/frontend-statistics.test.mts). The runner uses the already-installed esbuild package to compile the TypeScript without changing application files; plain tsx encountered the Windows sandbox's `uv_os_get_passwd ENOMEM` failure.

## What was checked

| Page / subview | Coverage and independent checks | Result |
|---|---|---|
| Global manager count | All 10,307 manager identities; duplicate numeric-ID check | Pass |
| Trophy leaders — managers | All managers, eight count fields, six reigning fields; all time and windows 1/5/10/20 | 721,490 field comparisons pass |
| Trophy leaders — cabinet | Every manager, all five windows, all eight categories, individual row names/season values/reigning flags | 412,280 category comparisons pass when loaded afresh; browser state and edition-unit issues below |
| Trophy leaders — nationality filter | All 137 listed nationalities; exact selector counts, matching users, all five windows | 685 nationality/window combinations pass |
| Trophy leaders — manager/nation calculations | All 64 competition masks × all-time/reigning/last-5/10/20 modes × winner/medal choices; category sums, rank order, nation sums, number of contributing managers, top-12 list and pagination arithmetic | 640 configurations; 6,596,480 manager/configuration rows pass |
| League winners | All 160 countries / 9,913 historical rows; loader values, descending season ranges, manager panels | Arithmetic passes; identity collision affects Bangladesh |
| Cup winners — main/secondary | All 159 countries, 795 cup competitions, 31,516 winner rows; main/secondary classification, exact loader preservation, season ranges, all Top-10 panels, streaks | Identity collision and five gap-spanning streaks fail |
| Cup winners — Hattrick Masters | All 67 editions and manager panel | Pass relative to snapshot |
| Cup winners — Seasonal | All 24 competitions / 578 rows, including Supporter Week and every Heroes/Titans cohort; generation classification and panels | Pass relative to snapshot |
| All club competition panels | All 980 rolls; 9,209 displayed Top-manager entries; counts independently grouped from winner records | Login-based arithmetic passes; grouping by actual user identity finds two incorrect panels |
| National trophies | All 12 competitions / 175 rows; senior, youth, all ten regional cups; champion, runner-up, both bronze slots and corresponding coach IDs | Pass relative to snapshot |
| Medal tables — nation | Each competition separately, senior, youth and all scopes; each gold/silver/bronze count against individual expanded podium records | Raw-name counts pass; pooled country identities fail |
| Medal tables — coach | All 15 single/pooled scopes, all coaches, all three medal counts, ordering, expanded results; independently reconciled against attributed coach IDs in national podium source rows | Pass |
| Medal tables — coach nationality | Every nationality sum within all 15 scopes | Pass |
| Elections — managers | All 7,137 source rows, repeated elections retained; counts, senior/youth split, country counts, timeline length | Counts pass; youth dates/mandate attribution fail |
| Elections — nationalities | All 1,790 attributed manager leaders / 120 nationalities; unique manager count, totals, senior/youth split, top-ten contributors | Pass |
| Elections — countries | Every country loader and actual Top-10 calculation; senior and youth rows included | Pass |
| Shared views | 15 representative page/subview combinations across all six tabs; numeric filters, all 64 competition encodings, recency round trips, URL idempotence and removal of unrelated state | Pass |
| Languages | Numeric interpolation placeholders in all 185 English keys and all five supported dictionaries | Pass |
| Data requests | All seven expected local JSON files; loaded once each; unexpected network requests fail immediately | Pass |

The tests extract non-exported calculations from `Retro2000s.tsx` with the TypeScript AST and execute the original function bodies. They do not reimplement the product calculation and test that copy against itself. Expected numerical totals are recounted from individual records, independently of the manager totals and UI aggregation. Identity tests additionally reconcile numeric IDs and country ISO/league IDs rather than trusting display names.

## Confirmed discrepancies

### F1. Same country is split into multiple medal-table rows

**Affected:** Medal tables → By nation → Youth / All competitions.

- Youth displays **137 rows for 105 countries**: 32 countries are split.
- All competitions displays **209 rows for 129 countries**: 80 countries are split.
- Senior scope has 108 rows for 108 countries and passes this identity check.
- Across both affected scopes there are **112 country/scope splits**. This is not 112 distinct countries.

For example, youth Germany appears as `Deutschland` with **8 gold / 2 silver / 6 bronze** and separately as `U21 Deutschland` with **1 / 0 / 1**. The correct combined youth record is **9 / 2 / 7**. Youth Italy similarly splits **6 / 3 / 5** and **1 / 1 / 2**, rather than **7 / 4 / 7**. Rankings therefore operate on incomplete country totals.

Reproduce: [`/?view=medals&medals.scope=u21`](http://127.0.0.1:5183/?view=medals&medals.scope=u21) or [`/?view=medals&medals.scope=all`](http://127.0.0.1:5183/?view=medals&medals.scope=all).

Cause: [`Retro2000s.tsx:2427`](../web/src/aggregate/retro/Retro2000s.tsx#L2427) uses the raw nation text as the tally key. World Cup youth rows have names such as `Deutschland`; regional youth rows have `U21 Deutschland`. The expanded-podium map repeats the same string-key distinction around line 2476. Both maps need the same stable country identity before ranking.

### F2. Cabinet retains counts from the previous recency filter

**Affected:** Trophy leaders → manager cabinet after a recency change. **Confirmed in the browser by the coordinating QA agent.** Fresh cabinet-loader tests pass, so this is a React state/cache error.

Reproduce:

1. Open [`/?view=trophies&trophies.q=maryusika`](http://127.0.0.1:5183/?view=trophies&trophies.q=maryusika).
2. Leave All time selected and expand maryusika.
3. Change recency to Last 5.

The manager row correctly changes from **43** to **8** selected trophies (**6 league + 2 main cup**). The open cabinet retains the all-time groups: **26 league + 14 main cup + 2 Masters + 1 seasonal**, with **7 secondary trophies** in the excluded group. A fresh Last-5 cabinet has only **6 league + 2 main + 1 excluded secondary**.

Cause: [`Retro2000s.tsx:938`](../web/src/aggregate/retro/Retro2000s.tsx#L938) clears cabinets only when language changes; line 960 reuses cabinets keyed solely by user ID. Recency is missing from the cache invalidation/reload dependencies.

### F3. Two accounts with the same login are combined into one manager

**Affected:** Bangladesh league and Bangladesh main-cup Top managers panels.

Both numeric accounts use the displayed login `siftekhar`:

| Panel | User 11087526 | User 5015911 | Displayed |
|---|---:|---:|---|
| Bangladesh league | 5 wins | 3 wins | One `siftekhar` with **8**, linked to 11087526 |
| Bangladesh Cup | 4 wins | 4 wins | One `siftekhar` with **8**, linked to 11087526 |

The trophy leaderboard separately preserves the two numeric manager records. The country panels therefore disagree with the user identity they link to.

Reproduce: [Bangladesh league](http://127.0.0.1:5183/?view=leagues&leagues.country=132) and [Bangladesh Cup](http://127.0.0.1:5183/?view=cups&cups.country=132).

Cause: [`Retro2000s.tsx:1662`](../web/src/aggregate/retro/Retro2000s.tsx#L1662) uses `tally[w.manager]` instead of the available `userId`. Two affected competition panels were found in the complete 980-roll scan. A separate scan of historical aliases found no additional known-nationality mismatch; aliases alone were not reported as numerical defects.

### F4. Youth election timelines show senior World Cup finish dates

**Affected:** Elections → By manager → expanded election timelines.

**2,666 timeline entries have the wrong date.** These are attributed youth-election rows with a completed youth edition. The election totals remain correct.

Example: `-arpe-`, Finland, youth WC40 displays **27.03.2026**, but the corresponding youth edition in `worldcup.json` finished **17.07.2026**. The displayed date belongs to senior WC40.

Reproduce: [`/?view=elections&elections.q=-arpe-`](http://127.0.0.1:5183/?view=elections&elections.q=-arpe-), expand the manager.

Cause: [`data.ts:783`](../web/src/aggregate/data.ts#L783) constructs `finishedByEdition` from `wc.senior` alone. [`data.ts:878`](../web/src/aggregate/data.ts#L878) uses it for both brackets. The mapping needs both bracket and edition.

### F5. Regional results are assigned to the wrong youth election mandate

**Affected:** Elections → By manager → mandate trophy/medal list and “outside these mandates” list.

The same senior-calendar assumption used in F4 produces **45 incorrect mandate result lists across 31 coaches**, against each bracket's own cycle windows. The affected result categories in this snapshot are U21 Nations Cup and U21 Africa Cup.

Example: `JohnSparta` was elected Ireland's youth coach for WC40. The national-trophy source records **U21 Nations Cup S40**, champion **U21 Ireland**, coach **JohnSparta**, final **17-07-2026**. It belongs inside the youth WC40 cycle, which finished that day. The current mandate list omits it because the senior WC40 end date is **27.03.2026**. The result instead appears outside the recorded mandate.

Reproduce: [`/?view=elections&elections.q=JohnSparta`](http://127.0.0.1:5183/?view=elections&elections.q=JohnSparta), expand and inspect Ireland youth WC40.

Cause: [`data.ts:787`](../web/src/aggregate/data.ts#L787) builds mandate windows only from senior editions; [`data.ts:829`](../web/src/aggregate/data.ts#L829) looks up by edition alone. The independent test uses the previous/current final of the election's actual bracket, with an open end for ongoing cycles. These “during the cycle” associations remain weaker than a direct World Cup edition match; the test does not claim election-day precision.

### F6. Streak badges span missing seasons

**Affected:** Five main-cup history rolls. Adjacent displayed rows are treated as consecutive even when a season is missing from the archive.

| Country / club | Missing-season boundary | Displayed joined run |
|---|---|---|
| Brazil / Alfabarra | S12 → S10 | ×2 |
| Greece / Shamrock Glory | S5 → S3 | ×2 |
| Japan / Shirayuri Sky | S8 → S6 | Included in ×12 starting S15 |
| Latvia / The Magnificent One | S7 → S4 | ×2 |
| Singapore / Hattrick all the time | S5 → S3 | Included in ×4 starting S7 |

Reproduce: [Brazil Cup](http://127.0.0.1:5183/?view=cups&cups.country=16), [Greece Cup](http://127.0.0.1:5183/?view=cups&cups.country=50), [Japan Cup](http://127.0.0.1:5183/?view=cups&cups.country=22), [Latvia Cup](http://127.0.0.1:5183/?view=cups&cups.country=53), [Singapore Cup](http://127.0.0.1:5183/?view=cups&cups.country=47).

Cause: [`Retro2000s.tsx:409`](../web/src/aggregate/retro/Retro2000s.tsx#L409) compares only adjacent club names; it does not require consecutive season values. The test establishes that the stored evidence cannot support these continuous streaks. It does not claim the missing historical season necessarily had a different champion.

### F7. World Cup editions are labeled as league seasons in trophy cabinets

**Affected:** Trophy leaders → expanded national trophy/medal cabinets.

**265 World Cup title/medal rows** display their edition number with an `S` prefix. For example, robbierodie's youth World Cup edition 23 is shown as **S23**, although this is not Hattrick league season 23. The national-trophy page and medal detail use edition/World Cup labels for the same records.

Reproduce: [`/?view=trophies&trophies.q=robbierodie`](http://127.0.0.1:5183/?view=trophies&trophies.q=robbierodie), expand the national trophy group. Enable medal winners to inspect the analogous silver/bronze rows.

Cause: [`data.ts:383`](../web/src/aggregate/data.ts#L383) and line 388 unconditionally format all national records as `'S' + season`, even though World Cup wire records store an edition in that field. Numerical totals are unaffected; the time unit is wrong.

## Reconciled snapshot totals

| Attributed record category | Count |
|---|---:|
| League titles | 8,989 |
| Main national cups | 7,676 |
| Secondary/consolation cups | 15,970 |
| Hattrick Masters | 57 |
| Seasonal cups | 464 |
| National-team titles | 160 |
| National-team silver medals | 149 |
| National-team bronze medals | 302 |

All manager totals equal their individual cabinet records. Medal coaches additionally reconcile with the attributed podium slots in `worldcup.json`. Elections reconcile as **2,718 senior + 2,822 youth attributed victories + 1,597 unattributed rows = 7,137**. No attributed election rows lack nationality in this snapshot. “Attributed” counts intentionally differ from complete competition winner-row counts because some historical winners have no resolved manager.

## Limits of this result

- This audit proves internal calculations and joins against the current baked snapshot. It cannot establish that every historical source row has been imported; the separate data/source audit addresses missing seasons and authoritative evidence.
- Browser interaction, rendering, asynchronous transitions, clipboard/native share behavior, responsive layouts, and navigation are owned by the coordinating browser audit. Only the stale-cabinet browser result above is incorporated here. The pure URL builder is automated; no clipboard content is sent anywhere.
- All numeric filters and all stored countries/competitions were exercised in code; this does not mean every country was manually selected in a browser.
- Translation checks validate placeholders, not translation quality. Rank ties retain current product tie rules; the independent tests validate totals, descending order and contributor lists without inventing a new sporting tie-break rule.
- No missing CHPP XML schema was inferred, no OAuth token was inspected, and no finished match was refetched.
