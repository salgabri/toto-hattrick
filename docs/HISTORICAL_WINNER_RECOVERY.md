# Recovering historical winner identities

An abandoned club does not imply that its former manager retired. The recovery path reads saved,
logged-in Hattrick **Club → History** evidence and attributes the person who managed the club at
the win. It makes no API calls and does not bake or publish data.

From the repository root:

```sh
npm run annotate:club-histories -w server -- --input scrape/histories.json --output scrape/histories.annotated.json
npm run recover:historical-winners -w server -- --input scrape/histories.annotated.json --report scrape/recovery-dry-run.json
npm run recover:historical-winners -w server -- --input scrape/histories.annotated.json --report scrape/recovery-applied.json --apply
```

`annotate:club-histories` is the only step that calls Hattrick: one pinned `teamdetails` read per
club whose tenure credit names its last recorded owner (see the rules below). It writes a new file;
the capture itself is never modified.

Paths resolve from `server/`. Omit `--report` to create a timestamped report beside the input.
Reports never overwrite existing files. Review `plans`, `rejected`, and `counts` in the dry-run
report before applying. Re-running is safe: already attributed winners remain unchanged.

## Evidence format

Input is an array of records (or `{ "histories": [...] }`):

```json
[
  {
    "teamId": 1726060,
    "leagueId": 4,
    "club": "Re Picante",
    "complete": false,
    "pages": [
      {
        "page": 1,
        "sourceURL": "https://www.hattrick.org/en/Club/History/?teamId=1726060",
        "rows": [
          {
            "text": "27-08-2024 In season 88, Re Picante emerged victorious from Coppa Italia. They were managed by SebasM.",
            "links": [
              { "text": "Coppa Italia", "href": "/en/World/Cup/?CupID=7" },
              { "text": "SebasM", "href": "/en/Club/Manager/?userId=11687578" },
              { "text": "Re Picante", "href": "/en/Club/?TeamID=1726060" }
            ]
          }
        ]
      }
    ]
  }
]
```

Capture exact English row text and link destinations, including the leading `DD-MM-YYYY` date.
Preserve ownership changes, relinquishments, and unlinked/former-user entries. Set `complete:true`
only after capturing **all** history pages, numbered consecutively from 1. Keep source URLs;
pagination uses POST, so the report records the page number separately. `leagueId` is the winning
club's country/league, never the manager's nationality; omit it if unknown.

The annotate step adds `"current": { "checkedAt", "ownerUserId", "foundedDate" }` to the clubs it
reads: the CHPP owner (0 for none or a deleted club) and `Team/FoundedDate` as `YYYY-MM-DD` (null
for a deleted club). Captures read in the browser use `server/scrape/club-history-capture.js`.

## Attribution rules

- Direct cup-victory events name the winner through a manager link; these work on partial histories.
  Their visible local season is authoritative: an attached match-archive link can use a different
  global season and is not used for cup-season matching.
- The observed Hattrick Masters message names the club's owner at the win but contains no cup link.
  Its exact "became Hattrick Masters champions season" wording maps only to cup 183, and is
  accepted only with the matching linked team, matching linked manager name, and valid dated
  season. The checked-in [Wieselhausen capture](../server/src/data/verified-club-history-wieselhausen-2026-09-17.json)
  records the public 17 September 2026 season-95 entry; current ownership alone is not evidence.
- Reviewed [Ethiopia](../server/src/data/verified-club-history-ethiopia-2026-09.json),
  [Bhutan](../server/src/data/verified-club-history-bhutan-2026-09.json),
  [Gibraltar](../server/src/data/verified-club-history-gibraltar-2026-09.json), and
  [Haiti](../server/src/data/verified-club-history-haiti-2026-09.json) captures preserve
  dated, linked win-time manager statements for their latest cups. These records are partial club
  histories and prove only the specific direct cup events, not ownership across other titles.
  Hattrick displays these dates with dots; the same validated date parser handles dots and hyphens.
- A separate [HRO manager-profile capture](../server/src/data/verified-manager-profile-hro-2026-09.json)
  links manager 4178181's previous HRO tenure and Première Ligue Haïtienne season-19 trophy to
  HRO's dated club-history title. Its importer checks both pages' linked team, country, series,
  season, and the win date against the tenure; it does not claim the entire club history was captured.
- First-place league and registered tournament events, and league titles or cups won "under the
  leadership of a now retired manager", use the most recent earlier ownership event only with a
  complete history. Missing/deleted owner links, relinquishments, missing dates, and ownership
  changes on the same day as the win block inference.
- That wording names nobody and says nothing reliable about the account: it covers wins after the
  owner had left (COLLA AFRICA, Guinea Ruby Challenger Cup season 7, won 19 days after deivit left)
  and wins by managers who are still active (ercanto, HI-Dandy de Tazmania, HI league season 7,
  named directly by rows 17 days before and 95 days after). Never credit anyone from it alone, and
  don't treat a manager's current activity as evidence either way.
- Club History never records an owner leaving; it only shows the next takeover. Two dated proofs
  bound a tenure instead:
  - "The team was demoted during bot cleanup" means the club had no owner by then. A cleanup
    after the last takeover blocks every later win until the next takeover.
  - When no takeover follows the win, the credit names the club's last recorded owner, and only
    CHPP shows whether they were still there. For an ownerless club, a `FoundedDate` later than the
    last takeover is the day that owner left. On 2026-11-18 this held for all 391 such clubs: no
    anniversary or named-manager row of the last owner, and no bot cleanup, contradicts it. A
    departure on or before the win blocks the credit. A different current owner, or a
    `FoundedDate` before the takeover, means the capture is stale and also blocks it.
  Without `current`, such a credit is planned as `unverified` and never written; the weekly
  replay therefore leaves them alone until an annotated capture is recovered.
- Competition ID, season, and the stored winner's team ID must agree. If the stored team ID is
  missing, the historical club name must match exactly after normalizing whitespace.
- Only `championUserId:null` or `0` is filled. Every disagreement with an existing positive manager
  ID is reported as a conflict, with no automatic overwrite. Equally strong contradictory evidence
  also conflicts. Full source events and ownership evidence remain in the report.
- Updates and manager creation use transactions guarded by the original winner values. A concurrent
  change is reported as `stale`. Existing manager login, bot flag, and nationality are preserved;
  new manager rows use the linked historical name. A new row's `isBot:false` describes a human
  historical winner and does **not** assert that the account remains active today.
- A known club league fills missing international-winner country IDs only. Existing country IDs
  and established historical owners are preserved.

For independent use, `extractHistoricalWinnerEvidence` and `planHistoricalWinners` in
`server/src/sync/historicalWinners.ts` are pure functions. `applyHistoricalWinners` is dry-run by
default. After reviewing and applying a repair, run the normal bake/build workflow separately.

The normal updater also replays the immutable Club History captures already in its accepted
evidence snapshot after new result rows are ingested. This closes a timing gap where proof was
captured before a champion row existed: only exact, guarded matches fill missing IDs, and
contradictory evidence remains unresolved. It does not fetch or scan Club History pages.

## Unverified legacy approximations

Automatic current-owner and all-season club-name attribution are disabled by default, including
normal refresh, cup backfill, and Masters sync. Those jobs still collect winning clubs and match
facts; missing historical managers wait for evidence. Even a recent win can predate a club's latest
owner. CHPP account activation, supporter tier, and club foundation dates do not establish the
manager's tenure at a win.

The legacy library behavior is available only through explicit options:

- `enrichChampionManagers` / `enrichRecentCupManagers`: `allowUnverifiedCurrentOwner:true`.
- `syncMasters`: `allowUnverifiedCurrentOwner:true` (applies the approximation across its history).
- `backfillCups`: `attributeOwners:true`; its CLI requires the existing `OWNERS=1` setting.
- `attributeByClub`: `allowUnverifiedNameMatch:true`.

These options are approximations, not substitutes for historical evidence. They remain off in
normal callers so a later refresh cannot silently fill a recycled club's old titles from its
current owner or another season's manager. Credits they left behind can still be wrong: the
[2026-10-30 pre-signup audit](PRE_SIGNUP_ATTRIBUTION_AUDIT_2026-10-30.md) found 940 titles won
before the credited account existed, and proposes clearing them after review.

## Missing final/team facts

For recent main-cup winners with placeholders, a bounded facts-only job can fill match and team IDs:

```sh
npm run materialize:recent-winners -w server -- --max-calls 100 --lookback 6 --only-finals ../.scrape/exact-finals.json --report ../.scrape/materialization-report.json
```

The optional exact-final file is `[{"cupId":7,"season":90}]`. Its keys intersect the main-cup and
per-cup local-season filters; an empty array selects nothing. The default window includes each
cup's current season plus six predecessors. Unknown current seasons are skipped. The command
performs CHPP calls and writes facts only, with at most 100 calls and no owner attribution or bake.
OAuth stash location comes from validated `OAUTH_ACCESS_STASH` (default `.oauth-access.json`).

For **every** domestic cup winner the archive knows only by its club name (finalMatchId 0, no
team id, no manager), use the review-checkout command instead. Rebuilding the archive from the
published bundles in August 2026 dropped the match and team ids that the July materialization had
found, so about 6,300 such finals (seasons 1–92, main and secondary cups) wait for this step. A
40-call trial on 2026-11-18 materialized 20 of 20 sampled finals across seasons 4–91.

```sh
npm run update:checkout -w server -- --database ../.update-work/<name>.db
npm run update:materialize -w server -- --database ../.update-work/<name>.db
npm run update:materialize -w server -- --database ../.update-work/<name>.db --apply --max-calls 1000 --report ../.update-work/<name>-materialize.json
npm run update:attribute -w server -- --database ../.update-work/<name>.db --backfill --state <fresh-state.json> --max-teams <n> --apply --report ../.update-work/<name>-attribution.json
```

It spends two calls per final (`cupmatches`, then `matchdetails`), commits final by final and
stops at `--max-calls` (at most 2,000 per run). Spread the backlog over several days. The plan
leaves a cup season with retained `cupmatches` evidence to the updater's own result queue, and a
final whose matchdetails are retained is never fetched again. A finished final then needs a
manager from `update:attribute --backfill`. Give that run a state file without the newly
identified clubs: a club checked in the last 90 days is skipped, so its newly identified title
would otherwise wait. Clubs that are bots or ownerless now need Club History. If another import
makes the checkout stale, check out again and replay with `--carry-from <old checkout>`, then
continue. Nothing is fetched twice.

**Daily catch-up** (one round per day until `nameOnlyRemaining` reaches 0). Work from the main
checkout. Start only when it is clean `main` = `origin/main` and the update lock shows
`"expiresAt":0`. `<D>` is today's date and `<P>` is the previous round's checkout.

1. `update:checkout --database ../.update-work/cup-teamids-<D>.db`. If `<P>` was never imported,
   replay it first: `update:materialize --database …<D>.db --carry-from …<P>.db --apply --report …`.
2. `update:materialize --database …<D>.db --apply --max-calls 2000 --report ../.update-work/cup-teamids-<D>-materialize.json`.
3. Write a state file without the clubs this round identified. Copy
   `.update-work/attribution-backfill-state.json` and drop the `filled[].championTeamId` entries from
   the materialize report. Then run `update:attribute --database …<D>.db --backfill --state <that file>
   --max-teams <clubs> --apply --report ../.update-work/cup-teamids-<D>-attribution.json`.
4. `update:import`, then `node scripts/run-local-update.mjs --no-fetch`, then
   `node scripts/diff-release.mjs <run dir>`. Publish only with nothing under `blocking`.
   Then check the live `manifest.json`.

Reading Club History pages for clubs that stay `unresolved` needs the owner's go-ahead. The
annotated 2026-11-18 capture (`.scrape/club-history-2026-11-18/`) covers the 768 clubs that were
ownerless then; the newly identified clubs are mostly not among them.

Fetched cup ID, local season, and winner name must match the stored winner before any update.
Names that changed are conservatively reported for review. Phase 2 reuses existing `Match` facts;
incomplete/conflicting stored matches or existing detail markers are reported without fetching the
match again. Exclude any match already fetched outside the DB until its verified facts are stored.
Updates are guarded against concurrent changes. The report includes skipped/conflicting facts and
the number of stored matches reused.

Focused regressions (from `server/`):

```sh
node --import tsx --test src/sync/historicalWinners.test.ts
```

## National election recovery

Election results identify who won an election, not who coached a later national-team trophy.
Use complete saved election-history pages, including former-user rows. Filtering to live winners
first can hide two different elections with the same edition, host, and votes.

From `server/`, review the persisted supporting snapshots without changing the database:

```sh
node --import tsx src/scripts/recover-elections.ts --input src/data/verified-national-election-histories.json --report ../.scrape/national-winner-recovery/elections-review.json
```

Add `--apply` only after reviewing the report, and choose a new report filename. Reports are
created exclusively. Repeat `--input` to combine more complete captures. Recovery fills only a
missing winner in a uniquely matching stored/source tuple `(leagueId, isYouth, edition, host,
votes)`. It never inserts or deletes elections, overwrites known winners, or changes existing
manager login/nationality/bot metadata. Ambiguous re-elections remain unresolved.

The general `sync-elections.ts --input <file.jsonl> --complete` importer can append absent rows,
but completeness must be explicitly verified. Without `--complete`, an external partial input
cannot fill or append any election; no ingestion path deletes existing country history.
