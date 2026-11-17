# Weekly assisted update playbook

The weekly update is run by a scheduled Claude task in the Claude desktop app. It follows this
playbook step by step. It updates every competition, fills every new winner's manager and every
national-trophy coach, and keeps national-team elections current. Then it publishes and verifies.

Two standing rules from the site owner (2026-11-17) shape it:

- **A published winner always names its manager or coach.** The only exception is a winning
  account that no longer exists. Managers come from CHPP with guards (`update:attribute`), never
  from guesses or hand-fed lists.
- **Every update includes elections and national trophies.** Elections and dated coach tenure
  exist only on Hattrick web pages. The owner approved Claude reading them in the built-in browser
  with their login, at the pace below (one page every 1.2–2 s), only when this playbook calls for it.

Work from the main checkout `C:/dev/toto-hattrick`, and invoke its scripts by absolute path.
In the commands below, `$W` is `C:/dev/toto-hattrick/.update-work` and `<D>` is today's date
(`YYYY-MM-DD`). Write browser output files with the Write tool into this session's **scratchpad**
directory, not into the main checkout. The `update:*` commands write their own reports.

## 1. Preflight

```bash
cd C:/dev/toto-hattrick && git fetch -q origin && git status -sb | head -1 && git rev-parse main origin/main && cat .update-store/locks/update.json
```

Continue only if the checkout is clean `main`, `main` equals `origin/main`, and the lock shows
`"expiresAt":0`. Otherwise stop and report what you found.

## 2. Acquire

Run `node C:/dev/toto-hattrick/scripts/run-local-update.mjs` in the background. It runs the
typecheck, the tests and the updater, and takes 7 to 15 minutes. Then:

```bash
node C:/dev/toto-hattrick/scripts/weekly-status.mjs "$(ls -td C:/dev/toto-hattrick/.update-work/run-* | head -1)/working.db"
```

If `acquisition.runAnotherRound` is true (season end), run the updater again, at most 3 rounds in
total. If a run fails, read its log under `.update-work/logs/`, report it, and stop.

## 3. Managers and coaches (CHPP)

```bash
cd C:/dev/toto-hattrick && npm run update:checkout -w server -- --database ../.update-work/weekly-<D>.db
cd C:/dev/toto-hattrick && npm run update:attribute -w server -- --database ../.update-work/weekly-<D>.db --apply --report ../.update-work/weekly-<D>-attribution.json
```

The report lists each target with its decision. `account_gone` is acceptable. Each `unresolved`
item carries its reason; report them all. If `coaches.needsTenure` lists national-team ids, run the
tenure capture (step 4) and then:

```bash
cd C:/dev/toto-hattrick && npm run update:attribute -w server -- --database ../.update-work/weekly-<D>.db --tenure <scratchpad>/tenure-<D>.json --apply --report ../.update-work/weekly-<D>-attribution-tenure.json
```

## 4. Browser steps (only when needed)

Open `https://www.hattrick.org/en/World/Elections/History.aspx?LeagueID=1` with the built-in
browser and check that the tab is signed in: no password field, title "History » Elections".
If it is not signed in, skip the browser steps and finish without them. Report that the owner must
sign in to Hattrick in the browser pane. Never type credentials.

Load each script by reading the file and passing its full text to `javascript_tool`. Keep every call
under 40 s: start a loop, then poll it.

**Coach tenure** (`server/scrape/nt-former-coaches.js`): call `window.__htTenure([<needsTenure ids>])`.
Write the returned `json` verbatim to `<scratchpad>/tenure-<D>.json`. Check that its SHA-256 equals
the returned `sha256` (`node -e` with `crypto`). Then rerun step 3 with `--tenure`.

**Elections** run only when `elections.due` from `weekly-status.mjs` is true, or step 3 reported
`needsTenure` (a coach change means new elections). Use `server/scrape/elections-capture.js`:

1. `window.__htElections.start(<elections.leagueIds>, <elections.cutoff>)`. Poll
   `window.__htElections.status()` every ~30 s until `finished`, which takes about 7 minutes for
   156 leagues. If `signedOut`, stop the browser steps and report.
2. For each block of 26 results, call `window.__htElections.chunk(from, from + 26)`. Write the `json`
   verbatim to `<scratchpad>/elections-<D>/chunk-<N>.json` (N = 1, 2, …). Verify the bytes and
   SHA-256 against the returned values; rewrite any chunk that does not match.
3. Dry run:
   `cd C:/dev/toto-hattrick && npm run update:elections -w server -- --database ../.update-work/weekly-<D>.db --capture <scratchpad>/elections-<D>`
   If `needsOlderDetails` lists pairs, call `window.__htElections.older(<those pairs>)`. Write its
   `json` (verified the same way) to `<scratchpad>/elections-<D>/older.json`, then rerun the dry run.
   If `conflicts` is not empty, do not apply. Report the conflicts and finish without elections.
4. Apply, add `--apply --report ../.update-work/weekly-<D>-elections.json` to the same command.
   If the result has a `manifestPath`, acknowledge it. The path is repo-relative:
   `cd C:/dev/toto-hattrick && npm run update:acknowledge -w server -- --database ../.update-work/weekly-<D>.db --manifest <manifestPath>`

## 5. Import, package, review, publish

```bash
cd C:/dev/toto-hattrick && npm run update:import -w server -- --database ../.update-work/weekly-<D>.db
```

Then run `node C:/dev/toto-hattrick/scripts/run-local-update.mjs --no-fetch` in the background,
followed by:

```bash
node C:/dev/toto-hattrick/scripts/diff-release.mjs "$(ls -td C:/dev/toto-hattrick/.update-work/run-* | head -1)"
```

Exit code 3, or anything under `blocking`, means a title vanished or a named manager changed.
Do **not** publish then; report it. Otherwise publish and verify:

```bash
cd C:/dev/toto-hattrick && git fetch -q origin && git status -sb | head -1 && node scripts/git-release.mjs publish
curl -s https://toto-hattrick.vercel.app/data/manifest.json
```

The live `dataVersion` must equal the packaged one. If nothing changed at all (every bundle
`identical`), skip publishing and say so.

## 6. Report

Finish with a short report:

- what was added (titles, managers, coaches, elections);
- what stayed empty and why: `account_gone`, or each `unresolved` reason;
- whether the browser steps ran;
- the release id and the live `dataVersion`.

## Never

- Edit `.update-store`, a run's `working.db` or published JSON by hand, or commit code.
- Use current-owner attribution without the guards, scrape Club History, or fill a manager from a
  name match.
- Retry a failing publish more than once; report it.
