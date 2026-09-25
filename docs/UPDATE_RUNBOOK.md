# Automated archive updates

The updater is implemented as a server-side coordinator with durable local SQLite snapshots,
evidence, an edition queue, validated static candidates, and a Git delivery step. Hattrick is read
only by this computer. GitHub receives only the seven public JSON bundles and their manifest;
Vercel builds the merged `main` commit. No S3 bucket is required for this setup.

## When updates run

The Windows task **Toto Hattrick archive update** checks every **Monday at 07:17 local time**.
Results are published only when a completed competition has supplied validated winner evidence. An
ongoing competition remains queued. Round hints can postpone unnecessary domestic probes, with a
periodic fallback. Registered international and recurring tournaments receive a bounded share of
every full weekly run so domestic backfill cannot starve a newly played final. Plan for roughly
7–14 days from result availability to normal publication when scheduling delays or a retry are
included; use a manual refresh for time-sensitive results.
The latest due Hattrick Masters result is checked first, and cups still missing the previous
season's result receive a bounded priority before older domestic gaps. This is a queue priority,
not an assertion that a final was played: unresolved or inactive cups remain pending for evidence.

The private updater lease prevents overlapping acquisitions. The publisher refuses to start unless
the checkout is clean `main` at the exact `origin/main` revision:

| Trigger | Behavior |
| --- | --- |
| Monday Windows schedule | Fetch due results, save progress, export public data, validate a release commit, merge and push it to GitHub, then verify Vercel |
| `npm run update:publish` | Run the same full acquisition-to-production flow immediately |
| `npm run update:publish -- --no-fetch` | Rebuild accepted private state and deliver it without any CHPP call |
| `npm run update:all` | Fetch, validate and retain a candidate without changing GitHub or Vercel |
| Merge/push to `main` | Vercel builds the exact committed code and versioned public data |

### Coverage contract

The weekly run updates every trophy-result category rendered by the site, but result discovery and
historical person attribution are separate guarantees:

| Site data | Weekly automatic source | Operational limit |
| --- | --- | --- |
| League champions | `worlddetails` discovery plus validated league fixtures | Registered country/top-division catalog; finished stored seasons are not fetched again |
| Domestic cup champions | Country cup catalog plus validated final resolver | New catalog cups are retained automatically; ambiguous formats go to evidence review |
| Hattrick Masters | Dedicated cup 183 tasks using the global season mapping, plus exact-team country resolution | Result and country tasks are independent; neither assigns an unproved historical manager |
| Modern senior and U21 World Cups | Registered `tournamentdetails` and `tournamentfixtures` XML | Current modern tournament era; retained legacy history remains in the archive |
| Senior/U21 regional cups | The ten registered Africa, America, Asia/Oceania, Europe and Nations tournament IDs | A new/replaced tournament ID requires a registry change |
| Supporter Week and Heroes trophies | Every registered seasonal tournament's current metadata and fixtures, plus exact-team country resolution across retained rows | XML exposes the current recurring edition only; an edition can roll over between weekly runs and then requires reviewed evidence |
| Manager/coach medals and rankings | Derived from accepted trophy facts; missing user nationalities have an exact-ID scheduled lane | Current owner/coach is not proof of an older winner; unresolved identity remains pending |
| National-team elections | No complete official XML history feed | Assisted evidence capture only; current coach does not expose winner votes or replacement history |

The full-site coverage contract means that every one of the seven published bundles and every
trophy family visible on the site has either a scheduled official collector or a durable evidence
task. It does not mean that election history, every historical manager identity, tournament hosts,
a tied playoff whose winner is absent from structured XML, or a seasonal edition missed while the
scheduler was offline can be inferred. Future or replaced tournament IDs also require a registry
change. Those boundaries remain explicit instead of being filled with guesses; independently proven
results continue to publish while attribution or other evidence is pending.

The unattended publisher stages only `web/public/data/**`, creates a release commit and a
no-fast-forward merge commit, then atomically pushes both the audit branch and `main`. A concurrent
main change rejects the whole push. GitHub `Code checks` revalidates pushes and pull requests
without calling CHPP.

## Local commands

Use Node 24. Run from the repository root; environment configuration comes from `server/.env`.
`DATABASE_URL` identifies the source database for initial bootstrap. The coordinator restores
private state into its own workspace for later runs.

The `update:*` npm scripts compile the server before invoking `node dist/scripts/update.js`.
Run them through npm so the command and its child workers use the same compiled revision; a
successful server build is required even for plan mode. For example, the server-workspace
implementation of `update:run` is `npm run build && node dist/scripts/update.js run`.

```powershell
npm ci
npm run update:plan -w server
npm run update:bootstrap -w server
npm run update:run -w server -- --no-fetch
```

The plan is read-only. Bootstrap imports the existing database and retained evidence; it must not
be substituted with a partial reconstruction from public JSON. The first no-fetch run verifies
restoration, migrations, archive preservation and release construction without using CHPP or
publishing the site. `UPDATE_STORE_DIR` selects a persistent local directory (default
`../.update-store`, relative to the server workspace); keep it private and backed up. A local store
on an ephemeral GitHub runner would be lost, so hosted runs require the S3 settings below.

After the application is approved for unattended collection and OAuth credentials are configured:

```powershell
npm run update:all
npm run update:publish
npm run update:publish -- --no-fetch
```

The first command acquires due results and saves a candidate without delivery. The second is the
single end-to-end command: it checks the clean checkout, acquires due results, restores the exact
saved candidate into a temporary Git worktree, commits only `web/public/data/**`, makes an auditable
merge commit, atomically pushes the branch and `main`, waits for Vercel, verifies all seven hashes, and
only then records the release as published. The third makes zero CHPP calls and is the safe retry
after a delivery failure.
Setting `UPDATE_CHPP_AUTOMATION_APPROVED=true` records that the application's approval has been
checked; it does not itself grant CHPP approval.

To schedule locally without S3, after a successful authorized manual run:

```powershell
# Review what will be registered, then remove -WhatIf to register it.
./scripts/register-update-task.ps1 -Frequency Weekly -DayOfWeek Monday -At '07:17' -WhatIf
# Add -Publish after the first GitHub/Vercel release has been verified.
```

This creates **Toto Hattrick archive update** in Windows Task Scheduler. It runs every Monday as your
logged-in account with no password saved, skips overlapping starts, and catches up missed starts
when available. It requests a wake timer for a sleeping computer and retries one failed run after
two hours and five minutes, long enough for an interrupted updater lease to expire. It is allowed
to start and finish on battery power so an unplugged laptop does not silently skip or interrupt an
archive checkpoint. A powered-off computer or a signed-out account still prevents the task from
running. Its first start is the next occurrence of the selected local time, never an
immediate catch-up for a time before registration. Logs are private local files
under `.update-work/logs`; Task Scheduler exposes the last exit status. It does not automatically
send notifications. Every scheduled publishing run first proves that the checkout is clean `main`
and equals `origin/main`, then executes both workspace typechecks and the offline test suite before
the updater calls CHPP. A failing code edit, moved branch, unrelated file, Vercel
build, or public hash verification stops publication without advancing the private release receipt.
The wrapper preserves the task environment and prepends its selected Node directory to `PATH`, so
npm's child processes use the same Node installation. Back up `.update-store` to
another disk or trusted private backup service;
a second directory on the same disk does not protect against disk failure. The task has a two-hour
execution limit so validation, the bounded acquisition, Vercel build and cleanup are not cut off
mid-release.

Refresh mode requires the consumer key and secret plus an authorized access token and secret.
The hosted workflow checks that all four CHPP secrets exist before starting acquisition and
fails with a configuration message if any are missing. It never treats placeholder credentials
used by offline code/retry runs as a working CHPP configuration.

## GitHub and Vercel delivery (no S3 required)

The site remains connected to `salgabri/toto-hattrick` in Vercel, with `main` as its production
branch. The checked-in `vercel.json` enables deployments only for `main` and sets
`ignoreCommand: "exit 1"`; that repository setting overrides the former project-level “do not
build” command. Vercel therefore builds after the validated release is merged, not when its
temporary branch is first pushed.

The Git tree contains only publishable material:

- `web/public/data/manifest.json`
- seven immutable bundles below `web/public/data/versions/<dataVersion>/`
- the immediately previous generation, so a browser tab opened during deployment can finish
  loading one consistent snapshot

The SQLite database, OAuth stash, `.env`, update store, workspaces, raw evidence, and review files
never enter Git. The publisher stages with an explicit `web/public/data/**` pathspec and then checks
the complete diff; it never uses `git add -A` on the repository.

Set the production address and server-side Vercel confirmation credentials in `server/.env`:

```dotenv
UPDATE_PUBLIC_URL=https://toto-hattrick.vercel.app
UPDATE_DEPLOY_PROVIDER=vercel
VERCEL_PROJECT_ID=prj_...
VERCEL_TEAM_ID=team_...
VERCEL_TOKEN=<private project-read token>
```

Normal Git delivery uses the existing Windows Git Credential Manager login and Vercel's GitHub
connection for the push, and needs no deployment bypass or AWS credential. The Vercel token is used
only to read the production deployment metadata and prove that its Git SHA is the exact merge just
pushed; it does not create or promote a deployment. The older direct Vercel/Netlify adapter remains
an operator-only recovery tool under the server workspace; it is not called by the weekly task and
must not run concurrently with Git delivery.

The repository's `user.name` and `user.email` must identify the GitHub/Vercel project member whose
commits deploy successfully. Pin that reviewed identity once in local Git configuration:

```powershell
git config --local hattrick.releaseAuthorName "<the verified member's Git author name>"
git config --local hattrick.releaseAuthorEmail "<the verified member's Git author email>"
```

Preflight requires `user.*` to match those fixed `hattrick.releaseAuthor*` values; a machine-level
identity change stops publication before it creates a commit. This trust anchor does not change
when another contributor authors the latest `main` commit. Change it only after verifying the new
author has deployment access in Vercel.

The release sequence is fail-closed:

1. The local updater retains an exact pending site artifact in private storage.
2. Its public data subtree replaces the data subtree in a clean temporary worktree.
3. A single data-only commit is created on `codex/archive-update-*`, independently checked against
   its exact `main` parent, and merged with `--no-ff`.
4. The release ref and merge commit are pushed atomically to GitHub; either both refs advance or
   neither does. GitHub's offline CI reruns the repository checks on `main`.
5. Vercel builds `main` and switches production only after that build succeeds.
6. The local coordinator requires Vercel's structured Git source to match the project-linked GitHub
   repository, `main`, and the exact merge SHA; rejects dirty/CLI provenance and rolling releases;
   and proves `UPDATE_PUBLIC_URL` is an alias of that same production deployment.
7. It then polls the public manifest and all seven immutable files. It advances
   `releases/current.json` only when their bytes match the pending artifact, recording the merge SHA.

If a step fails before the Git push, the exact pending release remains retryable with
`npm run update:publish -- --no-fetch`. If GitHub accepted a data merge but its exact Vercel SHA was
not confirmed, the checkout deliberately remains behind `origin/main` and the next run will not
acquire newer data. Repair or redeploy that exact commit in Vercel, then rerun the command: its
preflight confirms the pending release, advances the private receipt, and fast-forwards local
`main` before any later acquisition. This preserves the immediately prior live generation for
browser tabs opened before the deployment.

For weekly updates, use
`scripts/register-update-task.ps1 -Frequency Weekly -DayOfWeek Monday -At '07:17' -Publish`.
The computer must be on and the user logged in; Vercel hosting does not replace the private local
archive or its scheduler.

## Future hosted acquisition

The checked-in GitHub workflow validates code and committed public data; it does not call CHPP and
does not contain archive credentials. Moving acquisition off this computer
is a separate future change. It requires a private, encrypted, versioned object store, a narrowly
scoped GitHub OIDC role, a bootstrap of the **real** current database and retained evidence, and a
reviewed hosted scheduler. Do not point an ephemeral runner at a local store or reconstruct private
state from the public JSON. Until that infrastructure exists, keep hosted acquisition disabled and
use the Windows task above.

## What is automatic and what requires evidence

The ledger tracks every season between each competition's recorded baseline and its latest
observed season. A failed S94 remains queued after S95 succeeds, and a five-season outage creates
five work items. Finished stored league results and cup finals are skipped without a match request.
Each newly observed national-level cup enters the catalog; a cup missing from one metadata response
is retained. Entirely new country leagues/top-division IDs require a registry review and supported
source evidence. Masters advances from consistent offset-zero world metadata and uses its own cup
tasks, without an additional full-history pass.

On every unrestricted scheduled weekly refresh, the updater also checks the registered modern senior/U21 World
Cups, all ten registered senior/U21 regional cups, Supporter Week, and every registered Heroes
trophy. Tournament metadata advances each source's own edition counter. A winner is accepted only
from one finished, decisive match in the highest playoff round; the preceding two-match playoff
round supplies joint-third nations where applicable. Group-stage leaders, metadata alone and
scheduled finals cannot award a trophy. A tied final or semifinal triggers one retained
`matchdetails` capture and then evidence review; localized penalty text or an unrelated legacy
sample is never used to guess the winner.

Modern World Cups and regional cups accept an explicit tournament season, so official XML can
complete their active edition and retained history remains stable. Restarted seasonal tournaments
do not expose a historical roll of honour through XML. A weekly run can miss a short-lived current
edition if its completed final rolls out of the feed before the following Monday. In that case the
missing edition becomes `needs_review`; later metadata must not silently mark it complete or
no-award. Run a manual refresh around a known seasonal final when prompt automatic capture matters.

The report separates result collection, historical manager attribution and fresh evidence captures.
For a newly detected national final, `nationalteamdetails` can snapshot the current coach; for a
seasonal club final, current team ownership can provide a prompt attribution candidate. Neither
snapshot proves who held the role at an older final. The official current-coach response also has no
election result, vote total or replacement history, so senior and U21 election histories remain an
assisted evidence source. Election snapshots must preserve repeated elections and replacements
within one edition.

The static registries require deliberate maintenance. Review regional and World Cup tournament IDs
monthly, and add the next Heroes cohort each year; the checked-in Heroes registry currently ends at
2026. Also review newly introduced country/top-division IDs. Re-importing an old seed is never
recorded as a fresh source check.

Review `pendingEvidence` weekly, after a missed Monday run near a seasonal final, and after major
finals. Capture ingestion remains an operator step for elections, rolled-over seasonal gaps and
historical identity gaps:

```powershell
npm run update:checkout -w server -- --database ../.update-work/review.db
# Run the appropriate existing validated ingestor against the returned absolute database path.
# Put the strict manifest and all artifacts it names under .scrape/review-captures/.
# A single manifest may acknowledge a complete batch of open manual-source capture tasks.
npm run update:acknowledge -w server -- --database <db> --manifest <manifest.json>
npm run update:import -w server -- --database ../.update-work/review.db
npm run update:run -w server -- --no-fetch
```

The manifest is strict JSON with this shape; additional fields are rejected:

```json
{
  "schemaVersion": 1,
  "kind": "assisted-source-capture",
  "generatedAt": "2026-09-09T18:35:00.000Z",
  "tool": { "name": "reviewed-capture", "version": "1.0.0" },
  "artifacts": [
    {
      "path": ".scrape/review-captures/elections-4-2026-09-07.jsonl",
      "sha256": "<64 lowercase hexadecimal characters>",
      "bytes": 1234
    }
  ],
  "assertions": [
    {
      "sourceKey": "elections:4",
      "itemKey": "capture:2026-09-07",
      "sourceUrl": "https://example.invalid/source-used-for-this-capture",
      "capturedAt": "2026-09-09T18:30:00.000Z",
      "complete": true,
      "artifactPaths": [
        ".scrape/review-captures/elections-4-2026-09-07.jsonl"
      ]
    }
  ]
}
```

Use the exact source URL recorded for the manual source. `capturedAt` is the real capture time and
must fall within or after the queued `capture:YYYY-MM-DD` cycle; `generatedAt` cannot precede the
batch's captures. Every declared artifact must be referenced, and its declared byte length and
SHA-256 hash must match the retained file. Paths, including the manifest itself, are restricted to
`.scrape/review-captures/`.

Checkout creates a new database and sidecar recording its accepted baseline. Acknowledgement checks
that each assertion maps to the exact manual source URL and an open `needs_review` capture task; it
stores only the immutable manifest reference in the sidecar. Import refuses a stale checkout if
another update has advanced state, protects previous facts and ledger rows, and retains evidence
before adoption. It reloads and revalidates the manifest, artifacts, timestamps, completeness
assertions, exact database schema and unchanged ledger. The capture-task completions and source
freshness advances for the whole acknowledged batch are applied atomically. Import does not
publish. Ordinary reviewed fact edits neither complete capture tasks nor advance source freshness;
only a validated batch acknowledgement does. Reconciliation of newly evidenced identities happens
on the next refresh. Edits to
already verified winners require the separate reviewed-correction workflow, not this importer. Do
not manually edit `state/current.json`, the DB under an active run, or production JSON. Capture
tasks must only be resolved once the retained capture proves the required coverage and its actual
capture date; the scheduler deliberately leaves unsupported-source freshness unknown until then.
Automated HTML scanning is not an allowed recovery mechanism.

## Failures and recovery

- Source failures preserve earlier facts and successful-check timestamps. Other validated additions
  can still produce a candidate. Schema conflicts and unresolved final evidence go to review.
- The call/time budget stops acquisition while unprocessed editions remain queued. Stored partial
  progress is resumed by the next run; source retry dates prevent tight retry loops.
- Missing/corrupt archive state or unavailable evidence storage stops the run. Never fall back to
  creating an empty database or reconstructing from the seven public bundles.
- A stale conditional state write cannot replace a newer snapshot. Resolve the competing writer
  before retrying. Keep local operators out of the hosted production state while Actions is active.
- A failed publication leaves the saved candidate available for `retry`. The published receipt
  advances only after the expected public release is verified. Check the live manifest first if a
  deployment's outcome was uncertain.

Configure an independent missed-run monitor to alert after eight days without a coordinator check-in.
The heartbeat destination runs outside this GitHub schedule; adding a secret alone does not create
that monitor. Enable GitHub failure notifications for urgent job failures and review repeated
source/evidence issues in one weekly pass. GitHub notes that scheduled jobs can be delayed/dropped
and inactive public repositories can have schedules disabled; see its
[schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

Periodically restore the private archive into a clean directory and build all seven bundles without
CHPP. This is the practical check that SQLite plus retained evidence is a usable backup.
