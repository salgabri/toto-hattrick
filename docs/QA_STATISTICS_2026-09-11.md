# Overall statistics QA — 10–11 September 2026

**Historical audit:** repairs and their final verification are recorded in [QA_FIXES_2026-09-11.md](QA_FIXES_2026-09-11.md). The findings here preserve the original pre-fix evidence.

**The numbers are internally consistent in many places, but the site is not error-free.** The audit found 50 omitted cup finals confirmed by live CHPP, incorrect medal-country aggregation, merged manager identities, stale filtered cabinets, wrong youth-election dates and mandate associations, unsupported streaks, misleading World Cup units, and invalid-input API defects. Ten findings are listed below; some share a root cause.

This was an audit of the local repository, SQLite database, local website at `http://127.0.0.1:5183`, static JSON, and bounded external sources. No product code, database rows, static data, or deployment was changed. The database's SHA-256 remained `625cecd7fd9689abf52acdedcbe703bca9338d18a91bbf9a8c00c66aa28e9e0f` through the audit. Existing unrelated working-tree changes were preserved.

## Confirmed findings, in repair order

| # | Priority | Problem and measured impact | Evidence / cause |
|---|---|---|---|
| 1 | High | **50 historical cup finals are missing across 38 cups:** 49 main-cup finals and one secondary-cup final. Each requested season exists in live CHPP and returns one final with a level score. These finals cannot appear in cup histories or contribute to winner totals. | `server/src/sync/cups.ts:132` skips level scores. All 50 safe source responses are in [live-cup-gap-results.json](../qa/live-cup-gap-results.json). The scores alone do not prove the winning team or manager; resolve decisive-match or historical winner evidence before inserting winners. |
| 2 | High | **Country medal totals and rankings are split.** Youth shows 137 rows for 105 countries; Everything shows 209 for 129. That is 32 affected country groups in youth and 80 in Everything, not 112 different countries. | `Retro2000s.tsx:2427` and the expanded-podium map key on display names. `Ireland` and `U21 Ireland` remain separate. Youth Germany should combine 8/2/6 and 1/0/1 into **9 gold / 2 silver / 7 bronze**. |
| 3 | High | **Two Bangladesh Top managers panels combine different people.** League panel displays `siftekhar` with 8 wins, linked to user 11087526, who has 5; user 5015911 has the other 3. The main-cup panel merges their 4 + 4 wins similarly. | `Retro2000s.tsx:1662` groups by login instead of numeric user ID. The global manager records correctly remain separate. Browser confirmed the league panel. |
| 4 | Medium | **Changing recency leaves an expanded cabinet stale.** maryusika's row changes from 43 to 8 after All time → Last 5, but the cabinet still lists 26 league + 14 main + 2 Masters + 1 seasonal trophy. | `Retro2000s.tsx:938–960` caches cabinets by user ID without invalidating on the selected window. Browser reproduced; freshly loaded Last-5 data correctly contains 6 league + 2 main trophies. |
| 5 | Medium | **2,666 youth election timeline entries show the senior World Cup end date.** Youth WC40 displays 27.03.2026 instead of 17.07.2026. | `web/src/aggregate/data.ts:783` builds the date lookup from `wc.senior` only. The UI labels it “Cycle ended” beside a U21 badge. Counts of election victories are still correct. |
| 6 | Medium | **45 youth mandate result lists across 31 coaches contain the wrong regional-result association.** JohnSparta's U21 Nations Cup S40 gold for Ireland appears outside his recorded Ireland youth WC40 mandate. | The same senior-only calendar bounds the joins at `data.ts:787,829`. Browser reproduced the misplaced result. This is a timeline classification error, not evidence of 45 wrong winning coaches or altered medal totals. |
| 7 | Medium | **Five streaks bridge missing seasons.** Brazil S12→S10, Greece S5→S3, Japan S8→S6, Latvia S7→S4, Singapore S5→S3. | `Retro2000s.tsx:409` compares adjacent stored club names without checking consecutive seasons. The archive cannot substantiate those continuous streaks; this does not establish that the missing season had a different champion. |
| 8 | Low | **265 World Cup trophy/medal entries use `Sxx` instead of edition units.** An edition such as youth World Cup 23 becomes “S23” in the cabinet. | `data.ts:383,388` prefixes every national result with `S`, although World Cup records store editions. Other pages correctly distinguish editions and seasons. Counts are unaffected. |
| 9 | Medium | **Negative API leaderboard limits return the bottom of the ranking.** `limit=-1` gives a manager with 1 title; `limit=1` gives the leader with 33. | `server/src/routes/read.ts:157` bounds only the maximum before passing a negative `take` to Prisma. Fractional limits are also accepted. |
| 10 | Medium | **Invalid numeric paths yield internal errors or silently select a different ID.** Fourteen `abc`/`Infinity` probes across seven route families returned 500 with Prisma query details. Country `1.5` returns Sweden's 84 seasons. | Numeric conversions in `read.ts` lack request schemas. The tested responses contain internal query/model information, but no credential values. |

Detailed reproductions, source locations, and every affected row are in the [frontend report](qa-frontend-statistics.md), [API report](qa-api-audit.md), and [data/source report](qa-data-integrity.md). The core product findings should be addressed before treating this snapshot as a definitive historical ranking.

## Every current page and statistic family

The actual app is the six-tab aggregate product. The older match archive described in README/architecture is not a currently rendered page.

| Page | What was exercised | Outcome |
|---|---|---|
| Trophy leaders | All 10,307 manager records; every counter and cabinet category; all 64 competition masks × five recency modes × winners/medals; nationality filters, manager/nation grouping, rankings, contributors, and pagination calculations. Browser traversed **all 204 pages** with all categories enabled. | **10,186 unique trophy-winning managers** rendered exactly once, last page 36 rows, Next disabled. The 121 remaining tracked managers have medals but no titles. Fresh-load totals pass; stale cabinets and World Cup units fail. |
| League winners | **All 160 league selections / 9,913 rendered season rows**; season ranges, winner IDs, Top-10 counts, runs, and country options. | Browser row counts match DB and JSON. Bangladesh identity grouping fails. |
| Cup winners | **All 159 main cups, all 636 secondary cups, Masters, and all 24 seasonal tournaments** selected in the browser. Counts: **9,754 main / 21,762 secondary / 67 Masters / 578 seasonal**. Every cup footer agrees with rendered rows. All manager panels checked in code. | Rendering and stored arithmetic pass. Source gaps, identity grouping, and streaks fail as listed above. |
| National trophies | **All 12 senior/youth competitions / 175 rendered rows**, including ongoing editions; champion, silver, both bronze nations and coach identities independently checked. | All rows reconcile with the snapshot. Only **169** are finished titles: 80 World Cups and 89 regional editions. |
| Medal tables | All 12 individual competitions plus senior/youth/Everything scopes. Every nation/coach/coach-nationality count and expanded podium list checked in code. Browser checked 12 individual nation tables and all nine pooled scope/group combinations. | Coach and coach-nationality counts pass. Country grouping fails in youth and Everything. |
| Elections | **All 156 country pages / 7,137 rendered elections and 7,137 vote values**; manager and nationality rankings, repeats, totals, age splits, country counts, Top-10 panels and expanded mandates. | **1,790 attributed managers / 120 nationalities**. Counts pass; youth cycle dates and mandate associations fail. |
| Shared controls | Header manager count; URL codecs, all competition selections, 15 shared-view scenarios, filter round trips and irrelevant parameter removal; placeholder consistency across all 185 translation keys in five languages. Browser checked Bangladesh's share preview. | Numerical/URL checks pass. Native share submission and clipboard actions were not required or invoked. |

Across the club pages, the browser selected **980 competition rolls and observed 42,074 historical result rows**. All current country/competition options were covered. The audit did not click every possible cross-product of language, search text, expanded row, and filter; the exhaustive numerical configurations were executed directly against the real data/UI calculations instead.

Browser evidence, including measured totals and concrete state reproductions, is summarized in [browser-results.json](../qa/browser-results.json). React logged conflicting `border`/`borderBottom`/`borderColor` style warnings during some tab changes; no additional numerical failure was established from those warnings. Responsive/mobile layout and pixel-level visual correctness were outside this statistics audit.

## What passed and why that is not a historical completeness guarantee

- **534,275 assertions in 45 data-integrity groups passed.** Every exported row in the seven local static datasets matches SQLite, including IDs, dates, names, podium slots and attribution. The independent oracle reconstructs **33,316 attributed trophies and 451 attributed silver/bronze medals** and checks cabinet counts, reigning flags and recency anchors.
- **11,339 real Fastify-injected GET requests / 75,833 normal-data assertions passed.** Every populated read route, all 10,892 stored manager profiles, all 160 league IDs, all 94 stored league seasons and all 137 nationality groups were compared with independent read-only SQL. Invalid-input defects are recorded separately.
- The new frontend suite ran **24 groups: 18 passed, 6 failed on confirmed defects**. Passing work includes **721,490 manager-field comparisons**, **412,280 cabinet-category comparisons**, and **6,596,480 manager/configuration rows** across 640 configurations. These are assertion/comparison counts, not millions of independent historical source verifications.
- Existing checks passed: **154 server tests, 15 web tests, both-workspace typecheck, and the web production build**. The new tests expose gaps that those existing tests did not cover.

The UI consumes static `/data/*.json`, rather than the legacy `/api/*` endpoints. Cup, national, medal, election and combined trophy statistics therefore needed the separate static-data audit. The legacy user API intentionally returns only league titles. Its 10,892 stored profiles, the UI's 10,307 tracked trophy/medal managers, and the 10,186 title-winning leaderboard rows are different populations.

## Independent source checks

Live source checks used server-side credentials through the existing versioned CHPP client; credentials and signed URLs were never included in browser URLs or QA output.

1. **All 50 identified internal domestic cup gaps:** `cupmatches` **v1.2**, exact requested cup/season, exactly one returned final, level scores in every case. No unavailable, identity-mismatched or non-level responses. Six initial successful responses were reused when extending the audit to all 50. No stored final or match detail was refetched. See [safe source results](../qa/live-cup-gap-results.json).
2. **Five current country catalogues:** `worlddetails` **v1.9** for Italy, Sweden, Ireland, Portugal and Ethiopia. All **25 national-cup identities and classifications** match the snapshot. Each latest stored league season is one behind the API's current season, consistent with storing the previous completed season; this alone does not prove that every recently completed event is present. See [metadata results](../qa/live-source-results.json).
3. **Primary website cross-checks:** Masters S81 / DarthFenuz / numeric manager 11898902 agrees with the [dated Hattrick Press winner interview](https://www.hattrick.org/es-ar/Community/Press/?ArticleID=22809). Masters S60 / Wild Oscar / manager 3725093 agrees with [Hattrick Press's winner interview](https://www.hattrick.org/en-us/Community/Press/?ArticleID=19491). Both club results were also present in the rendered Masters table. Historical usernames can differ from current aliases; numeric identity is the relevant check.
4. **Retained evidence manifests:** 183 saved verified club-winner/correction records, three national-podium records, and 262 election-source rows were checked against stored identities. Records can overlap; these are not claimed as that many unique, newly browsed pages. Their provenance is documented in the data report.

This is comprehensive internal coverage plus targeted independent source verification. It does **not** independently re-prove every historical winner against live Hattrick. Login-gated history was not mass-scraped, and finished stored matches were not re-fetched.

## Remaining coverage limitations

- **8,927 stored trophies lack an attributable manager**, and **1,597 elections lack a named winner**. Those rows are present in competition/history views and intentionally excluded from manager rankings. This creates incomplete historical leaderboards even after arithmetic defects are fixed.
- **32 known silver/bronze podiums lack coaches**, and some early World Cups omit podium nations altogether. Unavailable identities must remain unknown until evidence supports recovery.
- **Supporter Week Trophy S11 is absent from the retained source and snapshot**; this audit did not establish its winner or why it is missing.
- The legacy API exposes **8,908 completed league rows with unknown points/played/club IDs encoded as zero**. These should carry explicit missing-data semantics if that API is used, but the current six-page UI does not display those match/points fields.
- `Team`, `Match`, `MatchDetail` and `SeasonStanding` are empty. Their API empty states were checked; real W/D/L, goals, ratings, scorers and standings cannot be validated from this database. They are outside today's rendered app.
- No deployed production URL was supplied or verified. Results describe the local code/data snapshot examined on 10–11 September 2026.

## Repeat the checks

Commands and expected outcomes are in [qa/README.md](../qa/README.md). The frontend command is intentionally red until the six automated defects are corrected. The API audit's successful-data checks can pass while its invalid-input findings remain listed. All reusable scripts and machine-readable results are under `qa/`; only QA artifacts were added.
