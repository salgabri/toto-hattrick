# Curated historical winner sources

These files are reviewed, per-title identity evidence. They are not a lookup from a club's current
name or owner to every trophy it ever won:

- `server/src/data/verified-historical-winners.json`: 106 exact league/main-cup titles for Stealer,
  SkyfireX, saheki, Aeglos and Askon, checked against country honours tables and linked public
  account IDs in Hattrick Wiki or Hattrick Press.
- `server/src/data/verified-masters-winners.json`: 5 exact Masters editions supported by public
  winner interviews/articles.
- `server/src/data/verified-club-history-winners.json`: 43 reviewed browser-history recoveries.
- `server/src/data/verified-recent-cup-winners.json`: 25 additional cup recoveries, discovered after
  a bounded CHPP pass restored the missing winning-club IDs.
- `server/src/data/historical-manager-wiki-evidence.json`: research notes, including name-only
  candidates and disagreements. **Do not pass this file to the applicator.** A null account ID is
  deliberately unresolved, not permission to guess an ID from a similar login.

Counts describe the reviewed source set on 2026-09-10: 179 formerly missing attributions in total.
All four `verified-*-winners.json` files above use the same applicator; repeat `--source` for each.
The browser-derived files retain the exact captured event and ownership evidence. Full machine-local
captures can also be replayed using [the history recovery workflow](HISTORICAL_WINNER_RECOVERY.md).

## Review and replay

Back up the database before applying repairs. Retain the source files and application output for
audit. Run from `server/`; the existing server `.env` must satisfy central config validation, but
this applicator makes no CHPP or other network calls and needs no fresh authorization/login.

```sh
node --import tsx src/scripts/apply-verified-winners.ts --source src/data/verified-historical-winners.json --source src/data/verified-masters-winners.json
```

The default is read-only and prints a JSON summary. Review every `conflict`, `missingRow` and
`duplicate`, not just the candidate count. A previously applied source can legitimately report
`unchanged`; never overwrite a positive, conflicting owner merely to reduce the missing count.

Only after that review, explicitly apply the same files:

```sh
node --import tsx src/scripts/apply-verified-winners.ts --source src/data/verified-historical-winners.json --source src/data/verified-masters-winners.json --apply
```

Input validation and exact competition/season/name checks run before each candidate can change.
Known team IDs must agree. Only supported missing-owner sentinels (`null` and `0`) can receive a
new manager. A proven source team ID also fills a null/zero club ID, including when that exact
title already belongs to the same verified manager; no club ID is inferred from a login name.
Existing manager login, nationality and bot metadata are preserved. Applications are
transactional and guarded against concurrent winner changes. Re-running does not duplicate titles
or create missing competition results.

Then, from the repository root, publish the repaired local identities to the static dataset with
the normal bake (this changes generated JSON; it does not deploy the site):

```sh
npm run bake -w server
```

Inspect that generated diff and retain the matching bake files together. The reconstruction script
preserves emitted `teamId`, `userId`, and international winning-club `leagueId`, with older
`managers.json` cabinet inversion as fallback. A rebuild from a **pre-repair** bake still needs
source replay. `reconstruct` clears/recreates winner and manager tables: it is not a routine repair
step or a complete database backup, and this workflow does not require running it.

## Evidence limits

- A club becoming abandoned/bot does not prove that its manager account retired. Conversely, a
  linked historical human ID does not establish that the account is active today. `isBot:false`
  on a new historical manager row is not an account-activity assertion.
- Hattrick may render old events with a generic retired-manager message, or return an empty history
  table for a closed club. Neither supplies an identity. A numeric link and exact dated ownership
  evidence, or independently reviewed per-title sources, are required.
- Current `teamdetails`, account activation dates, supporter status, club foundation dates, and a
  matching club name do not establish ownership on the date of an old win. A team ID can be reused;
  a name can change or be duplicated across countries.
- Country honours tables are community-maintained and can contain errors. Cross-check the exact
  competition and season against the stored winner; keep numeric account-ID proof separately.
  Do not spread one verified title into unverified seasons or secondary cups.
- Season numbers belong to their competition. A national cup's visible local season can differ
  from a match-archive link's global season; Masters uses its stored global-season key. Ukraine's
  historical restart also shifts the displayed local counter. Retain the source/DB numbering.
- Preserve disagreements as unresolved research. Examples: local Singapore cup 40/season 10 says
  Herron, while the country wiki says Team Singapore; cowabunga kickers appears under `thesun` in
  English and `manish` in Russian, without verified numeric identity/rename evidence. Neither case
  authorizes automatic correction. Unknown manager nationalities remain unknown.

Regression checks, from `server/` (no live API calls or database mutations):

```sh
node --import tsx --test src/scripts/reconstruct-from-bake.test.ts src/sync/verifiedWinners.test.ts src/sync/historicalWinners.test.ts
```

To build and run all winner-recovery regression tests from the repository root:

```sh
npm run test:winners -w server
```

## Reviewed corrections of an existing owner

Ordinary recovery still refuses to replace any positive manager ID. Four independently reviewed
Ghana Re Picante exceptions are recorded in `server/src/data/reviewed-winner-corrections.json`:
main cup 198/seasons 28 and 29, Ruby cup 758/season 34, and Sapphire cup 887/season 33. Their direct
trophy events link SebasM (11687578); the previously credited Chapeaux (1741737) acquired the club
after those wins. Each record retains the captured event, links, and the exact expected old ID.

From `server/`, preview only this committed manifest:

```sh
node --import tsx src/scripts/apply-reviewed-corrections.ts --report ../.scrape/winner-recovery/corrections-preview.json
```

After reviewing the four rows and backing up the database, use a new report filename to apply:

```sh
node --import tsx src/scripts/apply-reviewed-corrections.ts --apply --report ../.scrape/winner-recovery/corrections-applied.json
```

There is no arbitrary-source or broad-overwrite flag. Apply requires an exclusive, new audit file;
one unexpected prior owner, club ID, team name, season, or country blocks the complete batch.
Writes are atomic, retain existing manager metadata, and also restore the proven missing club ID.
An already corrected exact identity is a no-op. Keep the manifest and reports, then re-bake. A
fresh bake/reconstruction preserves the corrected IDs; rebuilding from an old bake requires
replaying the appropriate evidence against its reviewed prior state.
