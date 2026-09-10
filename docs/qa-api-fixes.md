# Read API fixes — 11 September 2026

The two invalid-input defects and the legacy zero-as-unknown representation issue are fixed in `server/src/routes/read.ts`. This change performs no database migration, data repair, bake, or CHPP request. The current aggregate frontend is unchanged; only the legacy client interfaces in `web/src/api.ts` were updated to describe nullable facts.

## Corrected request contracts

All seven numeric path families accept positive, canonical decimal integers up to `Number.MAX_SAFE_INTEGER`. Malformed strings, fractions, nonpositive numbers, unsafe integers, scientific/hexadecimal notation, surrounding whitespace, leading zeroes, and signed spellings receive HTTP 400 before any Prisma query. The response contains a controlled validation message rather than Prisma query/model details. Valid missing resources retain their existing empty-list or HTTP 404 behavior.

The leaderboard applies the same validation to `limit`. An omitted limit remains 50; valid values above 200 are capped at 200. Negative limits can no longer ask Prisma for the bottom of the ranking. Empty or repeated limit values and repeated nationality values receive HTTP 400. A single nationality remains a literal string, including Unicode names.

## Explicit unknown facts

Champion projections return `null` instead of a zero club-ID sentinel and identify the unavailable field in `missingData`:

```json
{
  "championTeamId": null,
  "points": null,
  "played": null,
  "missingData": ["championTeamId", "points", "played"]
}
```

Points and played become null only for a **completed** league row with both values zero, the convention used by winner-only reconstruction. A genuine zero points total after games were played remains zero. An incomplete, not-yet-started league's 0/0 remains numeric. Known winner names, manager identities, title counts and other retained facts are preserved.

The country-history route exposes all three nullable fields. The national-season and archive-champion routes expose nullable `championTeamId`; manager title rows expose nullable `clubId`. Every projection supplies its own `missingData` array, empty when all returned facts are known. This changes the legacy JSON contract without rewriting the stored archive. Missing historical facts still require source evidence; null is not a recovered score or identity.

## Validation

- **16 route regression tests passed**, including seven numeric-route subtests covering 98 malformed paths, 17 malformed/repeated query cases, exact safe-ID boundaries, default/max limits, nationality filtering, unknown-data projections, genuine zeroes, missing-resource responses, and home/away W/D/L orientation. These use the real Fastify routes with explicitly stubbed Prisma delegates and blocked network access.
- **11,421 read-only injected requests and 76,819 assertions passed** against the current database. This includes all 10,892 profiles, 9,913 league winners, country/season/count conservation, 98 rejected paths, 18 rejected queries and all 8,908 nullable-statistics/club-ID rows. The audit now fails if an invalid request stops returning a controlled 400, leaks query details, or a nullable fact regresses.
- **154 existing server winner tests and 15 existing web tests passed.** Both-workspace typecheck passed.
- The database SHA-256 remained `625cecd7fd9689abf52acdedcbe703bca9338d18a91bbf9a8c00c66aa28e9e0f` during the initial API-only verification. Subsequent cup repairs and the final rerun are recorded in the [combined repair report](QA_FIXES_2026-09-11.md).

The current machine results are in `qa/api-audit-results.json`. The original pre-fix results are retained in `qa/api-audit-results-before-fixes.json`; the historical audit documents have not been rewritten to hide their original findings.

## Reproduce

From the repository root:

```powershell
npm run build -w server
node --test server/dist/routes/read.test.js
npm run test:winners -w server
node qa/run-web-tests.mjs
npm run typecheck
```

From `server/`:

```powershell
node --experimental-strip-types ../qa/api-audit.ts
```

The route regression file is outside the historical winner-only test glob. The new root `npm test` command includes it automatically, along with sync, script, web and correction regressions; `npm run qa` runs the complete numerical audit.
