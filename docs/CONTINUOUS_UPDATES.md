# Keeping the Hattrick archive current

Implemented design, updated 13 September 2026. The coordinator runs against a persistent local
store, exports only validated public data to GitHub, and Vercel deploys the merged `main` commit.
Private S3 remains only a possible future way to move acquisition off the local computer.

## Decision

Keep the static website and SQLite. Run one update coordinator every Monday: restore the accepted
archive, fetch due official XML sources sequentially, save progress, validate a complete static
release, run the complete offline checks locally, commit its public data on an update branch, create
an auditable merge, and verify the exact Vercel Git deployment. GitHub repeats the checks after the
atomic push. The same coordinator can be started manually.

The active local configuration keeps database snapshots, retained evidence and release receipts in a
private persistent directory. A private, versioned S3 bucket is required only for ephemeral hosted
runners. SQLite remains local to the process while it works; it is never opened remotely on object
storage.

A local schedule requires the computer to be on and the user logged in. The optional hosted design
removes that requirement by restoring the same archive from private object storage. Moving to
Postgres or adding a public backend is unnecessary for this single-writer static product.

The important correction to the earlier recommendation is that an ephemeral runner is acceptable **when its authoritative state is durable elsewhere**. Rebuilding a partial database from the public JSON is not a substitute for restoring the actual archive.

## What is already available

- [refresh.ts](../server/src/update/refresh.ts) reconciles durable work for leagues, domestic cups,
  Masters and official tournament sources.
- [officialTournaments.ts](../server/src/sync/officialTournaments.ts) handles the modern senior and
  U21 World Cups, the registered senior/U21 regional cups, and registered recurring seasonal
  tournaments through pinned CHPP XML endpoints.
- [mastersCountries.ts](../server/src/sync/mastersCountries.ts) and
  [userNationalities.ts](../server/src/sync/userNationalities.ts) give missing international-club
  flags and manager/coach nationalities small, durable lanes that cannot be starved by result backfill.
- [bake.ts](../server/src/sync/bake.ts) produces seven public bundles. [Vercel](../vercel.json)
  builds only the merged `main` tree.
- The update coordinator, durable ledger, local/S3 state stores, release validator, Git exporter,
  production verifier, and an operator-only direct-host recovery adapter are implemented under
  `server/src/update/`.
- Historical manager, national coach, election and seasonal ingestion preserve stronger evidence
  and reject conflicting identities when reviewed captures are needed.
- Existing numerical tests provide useful validation rules, but their current command-line wrappers assume local paths and, in some cases, fixed historical audit scopes.

The original README and architecture describe an older team-match application. This design targets
the currently rendered aggregate honours site. The legacy `syncTeam()` route is not the update entry
point for that product.

## Coverage and operating targets

Wake the coordinator once weekly on Monday at 07:17 local time through the Windows task. GitHub
stores the validated merge and repeats offline CI after the push; it is not the CHPP scheduler. A
wake-up processes work that is due; it does not scan every historical
season. With this cadence, plan for roughly 7–14 days between a winner becoming available and normal
publication, including scheduling delays or one retry; use the manual command when a result is
time-sensitive. Weekly polling carries an explicit gap for restarted seasonal tournaments: their
XML feed exposes only the current edition, so a short-lived edition can roll over before the next
Monday run. Such a missed edition is queued for reviewed evidence rather than guessed.

| Data | Discovery and acquisition | Completion rule |
| --- | --- | --- |
| League winners | Weekly country metadata checks; fetch due or missing league seasons | Validate the complete fixture schedule and a uniquely supported champion before finalizing |
| Domestic cups | Reconcile the cup catalog from country metadata; inspect due finals | Resolve the actual final, including format, aggregate and retained match evidence |
| Hattrick Masters | Independent work items for cup 183 and its season numbering; resolve missing winner-country flags by exact team ID | Use the existing final resolver; country and result tasks retry independently without changing manager identity |
| Modern senior/U21 World Cups | Poll registered tournament metadata and the current edition's fixtures | Accept only one finished, decisive highest-round playoff final; retain podium attribution separately |
| Senior/U21 regional national cups | Poll all ten registered tournament IDs and their current editions | Apply the same final/podium proof; map national-team IDs without guessing identities |
| Supporter Week / Heroes tournaments | Poll every registered tournament's current metadata and fixtures on each Monday run; reconcile exact-team country flags across retained editions | Require a finished playoff bracket; save winner/final/score atomically, while an edition that rolls over between weekly runs becomes evidence review because XML history is unavailable |
| National-coach elections | Assisted retained history capture only | Preserve repeat elections and replacements; the current-coach endpoint has no election/vote history |
| Manager rankings and medals | Derive from all accepted trophy and podium facts; resolve missing user nationalities by exact user ID in a bounded lane | Credit only proven identities; publish club/nation results while attribution is pending |

This is the full-site coverage contract: every one of the seven published bundles and every trophy
family has either a scheduled official collector or a durable evidence task. “Full coverage” does
not mean fabricating fields that CHPP does not publish. Historical owners/coaches, election history,
hosts, a seasonal edition missed after rollover, and a future tournament ID stay explicitly queued
until retained evidence or a registry update exists; all independently proven results continue to
publish.

Review pending evidence weekly and newly introduced competitions monthly. The regional-cup,
World-Cup and seasonal-tournament IDs are explicit registries, so new or replaced competitions are
not discovered automatically. Include a yearly registry review for the next Heroes cohort; the
current registry ends at 2026. Manual-source dates indicate the last actual capture, not the date a
committed seed was re-imported.

Country seasons, tournament seasons, and World Cup editions are distinct numbering systems. Track each source in its own system. Use live metadata and verified mappings for season advancement; do not compare arbitrary local season numbers globally.

Round/date hints from `worlddetails` reduce unnecessary domestic fixture/final requests. A hint such
as zero remaining rounds is not proof of a winner, so unresolved competitions retain a periodic
fallback probe. Tournament collectors independently require a decisive, completed playoff final.
A structurally tied tournament final or semifinal is captured once through `matchdetails` and then
held for explicit tiebreak review; localized event text is not treated as a penalty-winner schema.

## Source access and attribution

Confirm the registered CHPP application's approval covers unattended statistics collection before enabling automatic network runs. The published [CHPP manual](https://wiki.hattrick.org/wiki/CHPP_Manual) distinguishes automatic XML access by application type, requires sequential downloads and app/version identification, and prohibits automated HTML scanning. Account-specific approval needs to be checked; this design does not assume that an existing scraper grants permission.

Tournament results now use the official `tournamentdetails` and `tournamentfixtures` XML feeds.
These feeds cover the current modern World Cup, regional-cup and recurring-tournament editions, but
they do not expose election history or a recurring tournament's disappeared prior fixtures. For a
source or missed edition without a permitted automated feed, the updater produces an exact evidence
work item. An operator supplies a permitted capture and an existing parser validates it. Automated
HTML scanning is not a fallback.

New club winners immediately create attribution work. A contemporaneous current-owner snapshot can
help with a newly detected final, but today's owner does not prove who managed an older victory.
Likewise, `nationalteamdetails` exposes the current coach only: it neither proves that coach won the
election nor supplies election votes or replacement history. A verified result may appear with
“Manager pending”; it contributes to identity-based rankings only after evidence resolves the
identity. Known historical unknowns do not prevent trophy results from updating.

Existing scrape `done` files use lifetime team/country/cup IDs. They must not determine future freshness. New capture tasks need a source, capture cycle and evidence version; elections also need complete snapshot coverage because mid-cycle replacements can occur.

Reviewed assisted-source captures use one strict batch manifest before import. The manifest and
every artifact it names must live under `.scrape/review-captures/`; paths outside that directory are
never accepted as capture evidence. Its schema is deliberately small and closed:

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

The acknowledgement command records the immutable manifest, not loose source/item/path flags:

```powershell
npm run update:acknowledge -w server -- --database <db> --manifest <manifest.json>
```

Acknowledgement and import both validate the exact manual source and open capture task, the source
URL, the capture cycle and timestamp, the `complete: true` assertion, artifact sizes and SHA-256
hashes, and the unchanged database schema and ledger. Import reloads the manifest and artifacts,
then atomically completes every acknowledged capture task and advances the corresponding source
freshness dates. Ordinary reviewed fact edits remain valid review work but never claim a fresh
source check. A successfully reviewed election batch therefore cannot wedge the weekly queue.

## Durable update state

The implemented ledger sits alongside the existing Prisma domain tables:

| Record | Essential information |
| --- | --- |
| `UpdateSource` | Stable source key, type, external ID, numbering system, tracked baseline, latest observed season/edition, last attempt, last successful source check, next due check |
| `UpdateItem` | Unique source/item/task key, state, attempts, next attempt, error category, evidence reference; result collection and attribution are separate tasks |
| `SourceCapture` | Immutable object key/hash, sanitized source identity and parameters, pinned version, capture time, parser version, coverage information |
| `UpdateRun` | Run ID, code revision, start/end, outcomes and counts, state snapshot ID, candidate release ID and publication outcome |

Useful item states are `pending`, `retry`, `complete`, `no_award` and `needs_review`. An ongoing event remains pending with a later check time. `no_award` requires evidence. Empty/error responses do not prove that an edition never existed.

Initialize the ledger from the retained archive with an explicitly recorded baseline. Previously stored winners can seed result-complete items, while missing detail or attribution remains separate work. Do not label historical coverage complete merely because its highest season is present.

On metadata discovery, create all absent items between the baseline and the newly observed season, retaining earlier unresolved items. Prioritize due recent finals to capture disappearing detail, then spend the remaining budget on older gaps without starving them. Any call-budget or time limit leaves unprocessed items queued.

For example, if S95 succeeds and S94 fails, S94 stays queued even after S96 arrives. After a five-season outage, all five editions remain eligible. The current cup lookback of three and league floor based on the largest stored season cannot guarantee this.

When the source has removed uncaptured history, record the unresolved gap and request evidence. Catch-up cannot recover information the source no longer supplies.

## State storage and crash recovery

Keep two independent durable references:

- `state/current.json`: latest accepted ingestion progress, including pending work.
- `releases/current.json`: last verified published release and its state/code versions.

Store immutable database snapshots under `state/snapshots/<id>/` and source captures under `evidence/<stable-key>/`. Private state includes all domain tables, the new ledger, and references to every required capture. Credentials stay in the local server environment and secure OAuth stash. Existing token rows, if present in an imported DB, also make that snapshot private; never publish the DB or raw captures as website files or public workflow artifacts.

The bootstrap must import the real current database and retained evidence. In particular, [cupFinals.ts](../server/src/sync/cupFinals.ts) depends on ignored `.scrape/cup-final-details`, `.scrape/cup-final-rounds` and local match XML. DB-only restoration can lose evidence that the no-refetch rule prevents retrieving again. Preserve relevant history captures and reviewed source manifests as well. Move these dependencies behind a configured evidence store instead of hard-coded checkout paths.

For newly fetched finished-match evidence, write a durable capture before committing its derived facts and completed work item. Make the capture discoverable by a deterministic source/item/request key, with provenance and payload in the same object; do not depend on a separately written index to find it. A restart can then find and replay captures saved after its last database snapshot. Mutable metadata observations use dated captures and do not suppress future source checks. Corrupt retained evidence goes to review; it does not trigger a silent match re-fetch.

There is an unavoidable failure window if a process receives a response but dies before any durable write. Do not promise exactly-once network requests. The enforceable rule is to reuse every durably retained match and never re-fetch a match already represented in the database.

Use SQLite's [backup facilities](https://www.sqlite.org/backup.html), or a fully closed database, to create a consistent snapshot. Before advancing authoritative state, check database integrity, required evidence references, retained record identities and protected facts against the previous accepted snapshot. Upload under a new immutable key, then replace the state reference only if its previously read version still matches. S3 supports [conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html); a failed precondition means the run must reconcile rather than overwrite newer progress. A failed validation may retain a private diagnostic snapshot but must leave the accepted-state reference unchanged.

Checkpoint accepted progress periodically and at a clean end, including after a recoverable source failure. Apply the integrity, preservation and evidence checks before every checkpoint advances the state reference. Leave enough execution time to save state. If storage becomes unavailable, stop acquiring further source data. A failed upload cannot advance the state reference or authorize publication.

Enable private storage encryption, access restrictions, versioning and an explicit retention policy. Suggested initial retention: daily state snapshots for 30 days and monthly snapshots for a year; evidence referenced by retained archive facts is retained indefinitely. Periodically test restoration into an isolated directory and reproduce the public facts without CHPP calls. Object [versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html) protects against accidental replacement; referenced evidence must also be protected from cleanup.

## One update and publication coordinator

One callable coordinator is implemented under `server/src/update/`, with a thin CLI under
`server/src/scripts/`. Environment settings go through `config/env.ts`; orchestration is not locked
inside an HTTP route.

1. Acquire the single production writer slot. Scheduled updates, manual ingestion and production code deploys must share it. Run trusted, tested code at a recorded Git revision with Node 24 and locked dependencies.
2. Read and retain both the starting state reference and last published receipt. Restore and validate the current state snapshot and required captures. Refuse a missing or corrupt archive; never silently start from an empty database.
3. Apply necessary migrations with `prisma migrate deploy`, preserving a pre-migration snapshot. Record code and schema versions together.
4. Replay saved captures, discover metadata, reconcile the catalog, and process due items sequentially. Validate each response before a short transaction applies related facts and task status.
5. Validate archive preservation, database integrity and evidence references before promoting a new state snapshot. Save accepted state and evidence even when another source is unavailable. Classify the run as successful, degraded, or failed independently of whether it has publishable additions.
6. Bake all seven datasets from a consistent accepted DB snapshot into a candidate directory. Validate output against that DB and the last published release, compute a deterministic content version, and build the web with the same code revision.
7. Save the candidate artifact and its manifest. Export only its public data subtree into a clean
   Git worktree, commit it on a one-commit update branch, validate that no path lies outside
   `web/public/data/**`, create a no-fast-forward merge, and atomically push the branch plus `main`.
   Any concurrent `main` change rejects the whole push; GitHub CI repeats the offline checks.
8. Let Vercel build the merged `main` commit. Confirm through Vercel that the exact merge SHA is
   the ready production deployment, then verify the manifest and all seven immutable bundle hashes.
   Advance the private published receipt only after both checks succeed.

Use the private local lease for acquisition and a clean, exact-main precondition for Git delivery.
Do not run CHPP work on pull requests. Conditional pointer updates and the atomic non-force Git push
provide additional stale-write checks; they are not substitutes for preventing overlapping API and
publication jobs.

Both normal code deploys and data deploys use Vercel's Git integration. `vercel.json` enables only
`main` and overrides the former dashboard skip command, so an update branch cannot deploy and an
old checkout cannot independently replace production. Every merged tree contains its matching
manifest plus current and immediately prior immutable data generations.

The private database, captures and saved site artifact remain in versioned local storage. Git
stores only the validated public release bytes needed for a reproducible Vercel build. One weekly
commit is an intentional audit trail; acquisition does not happen in Vercel or an untrusted pull
request.

## Publication rules

A temporary failure in one country should not freeze verified additions elsewhere. Failed source checks leave their previous records and last-success date intact. The candidate remains one internally consistent snapshot, with explicit coverage and unresolved items.

Block a candidate for database corruption, invalid output, missing retained records, unreviewed changes to protected winners/identities, inconsistent derived totals, or missing release files. Quarantine conflicting source input before it reaches the accepted DB. Already known unknown managers or absent old facts are coverage limits, not newly introduced corruption.

Validate record identities and protected values against the previous accepted snapshot, not just counts: one lost season and one added season can leave the count unchanged. Preserve election multiplicity. Confirm trophies, medals, reigning flags and manager totals reconcile to the same snapshot. A newer verified winner with pending attribution must end the previous manager's reigning status without inventing a new attributed manager.

The existing `npm run qa` needs adaptation before serving as this gate: several auditors hard-code `server/prisma/dev.db` and `web/public/data`, and the historical source audit checks a particular retained population. Extract/configure a focused release validator accepting explicit DB, candidate-data and previous-release inputs. Keep the full code regression and historical-source suites in code/evidence-change CI. Run release validation for each new data candidate, rather than repeating every historical investigation on every scheduled run.

## Browser consistency and freshness

Publish a small manifest describing the seven files, their hashes, schema version, data version, code revision, generated time, last factual change and per-source coverage. The browser selects one data manifest for a session and loads all seven bundles using immutable versioned paths.

Retain those paths for older sessions, or require a coordinated reload if a retired version is unavailable. Never fall back one file at a time to the newest generation: the current independent lazy loads from stable `/data/*.json` paths can otherwise combine old managers with newer cups during a deployment. Atomic upload alone does not solve long-open tabs spanning deployments.

Show concise product information such as “League results checked 12 Sep” and “2 manager identities pending”. Per-competition detail can expose the latest known edition and missing coverage. “Generated today” must not imply that World Cup, elections and every league were checked today. If source coverage is overdue, describe its winner as the latest recorded winner rather than claiming verified current status.

Use deterministic content hashes so unchanged facts do not create a new data generation. A successful no-change check still records fresh observation times. Surface those via a small status asset, or a metadata-only static release that reuses the same data version. Failed checks do not move successful-check timestamps.

## Failures and operator workload

- Retry transient timeouts, rate limits and server errors with bounded backoff and jitter; honor a supplied `Retry-After`. Keep requests sequential and count all attempts against the configured allowance.
- Distinguish a proven OAuth rejection from an IIS/header failure, permission error or parser failure. Stop the affected source and report what needs attention; request reauthorization only when indicated. Never log signed URLs or OAuth values.
- An unknown response shape becomes a retained diagnostic and review item. A new parser requires real samples under the repository guardrail.
- Give the run separate acquisition, validation, persistence and publication outcomes. A source error must not be hidden behind an overall “success” message.
- Track successful checks even when there are no new results. A site with no new trophy for weeks can still be healthy.
- Use an independent missed-run check, initially alerting after eight days without a weekly coordinator check-in. It must run outside the same GitHub schedule. GitHub documents that [scheduled runs can be delayed or dropped, and public-repository schedules can be disabled after inactivity](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
- Keep urgent failure notifications separate from the weekly pending-evidence list. Consolidate repeated issues and notify when action is needed.

The normal operator workload becomes reviewing a short queue of unsupported sources or ambiguous identities. If no permitted automated source exists for a category, complete unattended coverage cannot be promised for it.

## Activation and acceptance criteria

The local coordinator, release packaging, durable ledger, tournament XML collectors and Vercel
publication path are implemented. The optional hosted path still requires private S3 state and its
GitHub OIDC configuration. Election history and unresolved historical identity work remain in the
assisted evidence queue by design.

Required behavioral checks before activation:

- A replay makes no stored-match request and adds no duplicate winner or election.
- A failed S94 is still queued after S95 succeeds; a five-season outage schedules every missed edition.
- An empty new-season response does not suppress processing the preceding season.
- A newly observed cup enters discovery without deleting a temporarily missing catalog item.
- Restart after saving a capture but before applying its facts reuses that capture.
- Failed or conflicting state uploads cannot publish a release or overwrite newer state.
- A failed country check preserves its freshness while valid additions elsewhere can publish.
- A lost historical row, changed verified owner or mixed data generation blocks the candidate.
- Pending manager attribution preserves the new club result and correct reigning semantics.
- Exact-team country tasks backfill retained Masters and seasonal flags without changing owners.
- Newly accepted manager/coach identities receive bounded exact-ID nationality work.
- A reviewed, hash-pinned capture completes only its named task and allows the next weekly cycle.
- Failed deployment retries the saved artifact without fetching more data.
- A subsequent code deploy preserves the newest accepted data.
- Restore from private state reproduces the archive, including all seven bundles and necessary source evidence.

Local activation requires persistent private state, the actual hosting project, CHPP unattended-
access approval and credentials through their secure configuration paths. Moving the schedule to an
ephemeral hosted runner additionally requires private object storage. Neither deployment mode turns
current-coach or current-owner snapshots into historical identity evidence.
