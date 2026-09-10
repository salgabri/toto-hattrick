# Read API QA audit — 10 September 2026

The stored numbers and identities agree with the JSON read API for every populated route. The audit made **11,339 injected GET requests** and passed **75,833 assertions**, with no normal-data mismatches. This does **not** establish that every historical source record is correct: it independently reconciles the current SQLite snapshot with the API, while documenting source-data gaps and invalid-input defects separately.

The audit uses Fastify's real route handlers, independent SQLite `SELECT` queries with `readOnly: true`, and the application Prisma singleton. Outbound `fetch` is disabled. No sync/auth action, scraper POST, migration, bake, or database write was performed. SHA-256 of the database was unchanged before and after the run: `625cecd7fd9689abf52acdedcbe703bca9338d18a91bbf9a8c00c66aa28e9e0f`.

## Confirmed defects

1. **P2 — Negative leaderboard limits return the least successful managers.** `GET /api/users/leaderboard?limit=-1` returns one manager with **1 title**, whereas `limit=1` returns the leader with **33 titles**. `limit=-50` returns 50 managers all with one title. `read.ts:157` caps only the maximum before forwarding a negative `take` to Prisma. Fractional `1.5` becomes 1; `0` and `abc` silently become 50. A positive integer query schema would prevent the unintended reverse selection.
2. **P2 — Invalid path parameters cause 500 responses containing Prisma query details.** Both `abc` and `Infinity` produce HTTP 500 on all seven numeric route families: season matches, match detail, team summary, season standings, national league champions, national season, and user profile. Thus **14 of 28** malformed-path probes caused server errors. Numeric conversion occurs without request validation, e.g. `read.ts:21`, `read.ts:30`, `read.ts:41`, `read.ts:90`, `read.ts:119`, `read.ts:135`, and `read.ts:183`. Fractional and unsafe integers are also accepted rather than rejected. Returned error bodies identify internal Prisma models, queries, and argument requirements. No credential values were present in the tested responses.

## Data gaps and scope distinctions

- **8,908 of 9,913 completed league records expose `played: 0`, `points: 0`, and `championTeamId: 0`.** These are unknown-fact placeholders created during recovery from the static archive, explicitly documented by `server/src/scripts/reconstruct-from-bake.ts:17` and written at lines 120–125. They do not mean the champions won a league without playing. The legacy champions API serializes these zeroes without a missing-data marker. Example: Albania / season 71 / KF Drinus. This is a completeness and representation issue, not a newly demonstrated arithmetic error in trophy totals.
- **924 league titles have no resolved positive manager identity.** The leaderboard correctly omits them. Its 8,989 attributed titles belong to 3,561 distinct managers, and every positive manager ID resolves to a stored profile.
- **The archive match tables are empty:** `Team`, `Match`, `MatchDetail`, and `SeasonStanding` each contain zero rows. Empty results and 404s pass, but there are no real match scores, W/D/L, scorers, lineups, ratings, or reconstructed team-season standings to compare. The script automatically checks those values when such data exists; this run must not be described as real-data validation of those statistics.
- `/api/national/leagues` intentionally lists **156 country leagues**, totaling **9,867** title rows. The other four seeded leagues contain **46** titles: Hattrick International 31, Hattrick Anniversary League 7, Homegrown League 7, Hattrick Femme International 1. Those titles remain accessible by league ID and are included by the national-season and manager routes. This explains the 9,867 versus 9,913 cross-endpoint difference.
- `/api/users/nationalities` groups all **10,892** stored managers, excluding 22 with missing/Unknown nationality, rather than only the 3,561 managers with league titles. **7,331** profiles have no league title; they can have other achievements in the broader archive. These population counts should not be equated.
- These 12 legacy read routes return team-archive and top-division league facts. They provide **no equivalent APIs for the current site's national cups, Masters, seasonal cups, World Cups, regional cups, medals, elections, or combined trophy totals**. The current aggregate site's static JSON requires a separate audit. A manager's legacy `/api/users/:id` title count is deliberately league-only.

## Exhaustive route coverage

| GET route family | Coverage and independent comparison |
| --- | --- |
| `/api/seasons` | All season counts/order; total reconciles to Match table (currently zero). |
| `/api/seasons/:season/matches` | Missing-season response; populated-data checks are ready but no stored matches exist. |
| `/api/matches/:matchId` | Missing match 404; populated scores/detail checks unavailable in this snapshot. |
| `/api/teams/:teamId/summary` | Unknown-team empty summary; populated SQL W/D/L and goal comparisons unavailable. |
| `/api/champions` | Exact empty SeasonStanding projection. |
| `/api/seasons/:season/standings` | Missing-season 404; table arithmetic unavailable with zero records. |
| `/api/national/leagues` | All 156 rows: identity, country, series, currentSeason, seasonsStored, ordering. |
| `/api/national/leagues/:leagueId/champions` | All 160 seeded IDs, all 9,913 rows and fields, season order, plus nonexistent ID. |
| `/api/national/seasons/:season` | All 94 stored seasons, every winner/country/ID/completion flag, total conservation, missing season. |
| `/api/users/nationalities` | All 137 nationality counts, ordering, excluded-value policy, total conservation. |
| `/api/users/leaderboard` | All 137 nationality filters, default/all-country ranking, limits 1/2/50/200/201/1000, unknown nationality, uniqueness, exact title counts and cutoff ties, profile metadata, invalid limits. |
| `/api/users/:userId` | Every one of 10,892 profiles, every attached title, identity, nationality, complete/season ordering, profile-title conservation, missing-user 404. |
| `/api/health` | Exact `{ok:true}` state. |
| `/api/scrape/targets`, `/api/scrape/done` | Current read states only, arrays and unique numeric resume keys; no results submitted. |

All expected-status calls additionally verify JSON content type and absence of credential-shaped fields. Invalid-input findings are reported separately from successful-data assertions; “zero numeric mismatches” does not mean no API defects.

## Existing automated checks

| Check | Outcome |
| --- | --- |
| `npm run typecheck` | Server and web both pass. |
| `npm run test:winners -w server` | **154 tests pass**, including isolated SQLite ingestion tests; none failed or skipped. |
| Existing `web/tests/*.test.ts` | **15 tests pass**, none failed or skipped. |

The usual `node --import tsx --test web/tests/*.test.ts` entry point failed before test execution because this Windows sandbox returned `uv_os_get_passwd ENOMEM` from `tsx`'s `os.userInfo` call. Native Node type stripping ran the URL-state tests but cannot resolve the source's `.js`-to-`.ts` imports. `qa/run-web-tests.mjs` works around only the test runner: it uses the installed TypeScript transpiler to compile the five existing source/test files into a fresh temporary directory, executes the unchanged tests, and removes that exact directory. No product source was changed.

## Reproduce

From the repository root:

```powershell
npm run typecheck
npm run test:winners -w server
node qa/run-web-tests.mjs
```

From `server/` (the existing server build above supplies the imported route modules):

```powershell
node --experimental-strip-types ../qa/api-audit.ts
```

The full machine-readable route counts, 28 malformed-path probes, seven malformed-limit probes, findings, and database fingerprint are saved in `qa/api-audit-results.json`. The script itself is `qa/api-audit.ts`.

## Independent review of frontend findings

The API auditor separately reviewed `qa/results/frontend-statistics.json`, the production calculations, UI labels, and the relevant raw rows without rerunning or changing the frontend audit.

- **Youth election dates are confirmed incorrect.** All 2,666 date mismatches concern youth rows. The UI shows a U21 bracket badge and a column labelled “Cycle ended”, but `data.ts:783` looks up every row in `wc.senior`. Example: youth World Cup 40 (Guatemala) ended 17 July 2026; the timeline uses senior World Cup 40's 27 March 2026 finish instead.
- **The 45 regional-result discrepancies are election-timeline placement errors across 31 managers, all on the youth side.** `data.ts:787` also builds all mandate windows from senior finals. For example, oslicek's U21 Nations Cup season 36 bronze was decided on 2 February 2024, the youth World Cup 36 finish; it is attached to cycle 37 under the senior-date window. The existing ownership and overall medal totals are unaffected. Do not describe this as 45 distinct trophies awarded to the wrong coaches: the report counts differing timeline rows, including a result missing from one row and added to another. Bracket-specific windows satisfy the app's documented cycle model; they are not independent proof of actual election/tenure start dates.
- **Pooled nation medal splits are confirmed.** “Medal table — by nation”, “Every U21 competition combined”, and “Every senior and U21 competition combined” establish the intended pooling. The findings contain 32 affected country groups in U21 scope and 80 in Everything scope; every split is a plain name versus the same `U21 `-prefixed name. Germany's U21 medals are divided between Deutschland (8 gold, 2 silver, 6 bronze) and U21 Deutschland (1 gold, 0 silver, 1 bronze); the combined country record is 9/2/7. These are ranking/row-count errors even though global medal totals are conserved.
- **World Cup cabinet `Sxx` labels are a confirmed unit error.** `data.ts:384` and `data.ts:388` prepend `S` to World Cup edition numbers, which the cabinet displays unchanged at `Retro2000s.tsx:1424`. The national-competition and medal-detail screens already distinguish editions from regional seasons. The 265 findings count cabinet entries, not numerical trophy-total mistakes.
- **API placeholder zeroes have lower current-product priority than the visible ranking/date defects.** `web/src/App.tsx` renders only the static aggregate site and explicitly excludes the single-team archive. `points` and `played` occur only in the unused legacy `web/src/api.ts` interface; the current six-page UI does not render these zeroes. Treat the 8,908 zero-valued league facts as a legacy API representation/data-completeness gap, not as 8,908 erroneous displayed trophy totals. Similarly, empty match tables are a legacy-scope limitation, not an untested page in today's six-page product.
