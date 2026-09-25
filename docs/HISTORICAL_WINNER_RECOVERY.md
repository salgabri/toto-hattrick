# Recovering historical winner identities

An abandoned club does not imply that its former manager retired. The recovery path reads saved,
logged-in Hattrick **Club → History** evidence and attributes the person who managed the club at
the win. It makes no API calls and does not bake or publish data.

From the repository root:

```sh
npm run recover:historical-winners -w server -- --input scrape/histories.json --report scrape/recovery-dry-run.json
npm run recover:historical-winners -w server -- --input scrape/histories.json --report scrape/recovery-applied.json --apply
```

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

## Attribution rules

- Direct cup-victory events name the winner through a manager link; these work on partial histories.
  Their visible local season is authoritative: an attached match-archive link can use a different
  global season and is not used for cup-season matching.
- The observed Hattrick Masters message names the club's owner at the win but contains no cup link.
  Its exact "became Hattrick Masters champions season" wording maps only to cup 183, and is
  accepted only with the matching linked team, matching linked manager name, and valid dated
  season. The checked-in [Wieselhausen capture](../server/src/data/verified-club-history-wieselhausen-2026-09-17.json)
  records the public 17 September 2026 season-95 entry; current ownership alone is not evidence.
- First-place league and registered tournament events use the most recent earlier ownership event
  only with a complete history. Missing/deleted owner links, relinquishments, missing dates, and
  ownership changes on the same day as the win block inference.
  The observed league message mentioning "a now retired manager" can also be matched through a
  prior linked ownership event; that generic message alone never supplies a manager identity.
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
current owner or another season's manager.

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
