# Statistics QA

Read the original [10–11 September 2026 report](../docs/QA_STATISTICS_2026-09-11.md) and the [repair report](../docs/QA_FIXES_2026-09-11.md). The offline audits do not repair the product or rebake data. Regression assertions now require the corrected behavior and fail on discrepancies.

Use the installed dependencies and Node 24 (native TypeScript stripping and `node:sqlite`). Run from the repository root:

```powershell
npm run typecheck
npm test
npm run qa
npm run build -w web
```

`npm test` builds and runs the server sync, script and route tests, followed by the web and guarded data-repair tests. `npm run qa` builds the server and runs the database, frontend, API and retained historical-source audits, even if an earlier audit fails. Its combined result is saved to `results/audit-summary.json`. Individual suites can also run separately:

```powershell
node qa/data-integrity.ts
node qa/run-frontend-statistics.mjs
node qa/verify-complete-early-cup-source-coverage.mjs
Push-Location server
node ../qa/api-audit.ts
Pop-Location
```

The frontend suite covers every stored manager cabinet, club roll, national podium, and election association, plus adversarial identity, season-gap and asynchronous cabinet scenarios. The API audit exercises every available league, season and user, and asserts malformed inputs return 400. Unknown historical fields must be null with `missingData`, while genuine zeroes remain numeric. Original failing evidence is retained in the `*-before-fixes.json` files.

Optional bounded external checks, from `server/`, require the existing server-side CHPP configuration and network access:

```powershell
node ../qa/live-source-audit.mjs
node ../qa/live-cup-gap-audit.mjs
```

The first makes five `worlddetails` v1.9 calls. The second reads the internal gap list, checks each final is absent in the database, and reuses saved successful results; the initial audit used 50 `cupmatches` v1.2 calls. Neither calls `matchdetails`. No tokens or signed URLs are stored in QA outputs.

Browser results are in `browser-results.json`. The browser run used Codex's supported browser controls against `http://127.0.0.1:5183`, selecting actual UI options and reading the rendered DOM. It covered every club roll, every national competition, every election country, the combined and individual medal scopes, and all 204 trophy-leaderboard pages. Browser state reproductions and their exact sequences are in the combined report; the statistical runner alone does not exercise React state transitions.

Focused post-fix browser reproductions are in `browser-fixes-results.json`. `verify-repair-data.ts` compares the repaired database with the local backup and checks that only reviewed changes were applied. Run it after recovery and rebaking, with the saved `.backup/qa-fixes-20260911/dev.db` available. Historical source captures are local; scripts reuse them and check database presence before any new match request.

Results are snapshot-specific. A clean database-to-JSON comparison does not establish that the snapshot contains every source result or that every historical owner has been independently proved.
