# Titles credited before the manager's account existed — audit 2026-10-30

A read-only audit of the accepted archive. It finds league and cup titles whose credited manager's
Hattrick account was created after the title was won. Nothing was applied: the private store,
the published JSON and the accepted snapshot are unchanged, and no CHPP or HTML request was made.
The [proposed corrections](../qa/pre-signup-attribution-clearances.proposed.json) are a draft for
review.

This is separate from the operator-approved
[season-95 current-owner attribution](CURRENT_OWNER_ATTRIBUTION_2026-10-30.md). None of the
season-95 rows is flagged.

## Result

| Family | Credited titles | Flagged, high | Flagged, medium | Flagged total | Review only | Borderline (not flagged) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| League champions | 9,146 | 367 | 17 | 384 | 8 | 25 |
| Main domestic cups | 7,815 | 326 | 3 | 329 | 4 | 8 |
| Secondary domestic cups | 16,658 | 223 | 4 | 227 | 3 | 13 |
| Hattrick Masters | 58 | 0 | 0 | 0 | 0 | 0 |
| Seasonal trophies | 464 | 0 | 0 | 0 | 0 | 0 |
| **Total** | **34,141** | **916** | **24** | **940** | **15** | **46** |

- **940 titles credited to 520 managers** are dated clearly before the credited account existed.
  For 428 of those managers, these are all of their credited titles.
- **916 are high confidence and 24 medium** (marked † in [Appendix A](#appendix-a-flagged-titles-by-credited-manager)).
  The confidence rules are under [Method](#4-flag-rule-and-confidence).
- **No Masters or seasonal trophy is affected.** Their credited managers all predate their titles.
- **Every flagged row is a placeholder without a stored winning-club ID.** League rows have
  `championTeamId` 0, cup rows `null`, and none has a final match ID.
- **No flagged row is backed by checked-in evidence.** None appears in the `verified-*` files, the
  bulk Club History capture or `reviewed-winner-corrections.json`. None is the latest stored edition
  of its competition, so the release attribution audit is not affected.
- **All three known examples reproduce:**
  - Tampe (10520814): Trinidad & Tobago league S3–S7 and The Pro Bowl S5, S6, S13 and S14.
  - Garojh (13356038): Armenia league S13 and Hayastani gavat S11.
  - Natan4Fun (13671649): Nicaragua's Copa Nacional Rubén Darío S14 and S16.
- **Tampe's The Pro Bowl S19 and S22 are not flagged.** They were won after the account existed.
  This audit cannot tell whether those credits are right.

The flagged titles span 124 countries. The largest counts are Ghana 33, Nigeria 30, Andorra 26,
Mexico 24, the Dominican Republic 22 and Germany 21. One manager, Veneik13 (13726329), accounts for
29 Nigerian titles from 2006–2014. That account was created no earlier than 2021-03-06.

| Gap between latest title date and earliest account creation | Titles |
| --- | ---: |
| 1 season to 1 year | 107 |
| 1 to 5 years | 415 |
| 5 to 10 years | 232 |
| more than 10 years | 186 |

| Title won in | Titles |
| --- | ---: |
| 2001–2004 | 164 |
| 2005–2009 | 365 |
| 2010–2014 | 156 |
| 2015–2019 | 205 |
| 2020–2026 | 50 |

### Likely origin

These rows were most likely filled by the legacy approximations described in
[Unverified legacy approximations](HISTORICAL_WINNER_RECOVERY.md#unverified-legacy-approximations):

- The club-name bridge credited placeholder titles without a club ID to a manager who won
  something else in the same country with a club of the same name. It was added as
  `attributeCupsByClub` in `1010a9d` (2026-07-27) and widened to league titles as `attributeByClub`
  in `a0f2bd2` (2026-08-05).
- Current-owner enrichment credited a club's titles to its owner at the time.

Both were disabled by default in `7d07f6b` (2026-09-10). Per-row provenance was not recorded, so
this is an inference from the pattern, not proof for each row.

## Method

The audit script is [`qa/audit-pre-signup-attributions.mjs`](../qa/audit-pre-signup-attributions.mjs).
It reads only local files, opens the database read-only and refuses any database whose SHA-256
differs from the snapshot named by `.update-store/state/current.json`.

### 1. Snapshot

| Item | Value |
| --- | --- |
| Snapshot | `c32714f1-edfe-42ba-8932-6b45fd4c8188`, created 2026-10-30T13:44:58Z at code revision `5f5bd27` |
| `archive.db` SHA-256 | `08d2c88c9ba31cb2443d40c45c0e67f506c520b6555715adce33abcc6d9d3d45` (verified on the copy) |
| Credited titles audited | 34,141: every `LeagueChampion` and `CupChampion` row with `championUserId` > 0 |

The database was copied to a private scratch directory and opened read-only.

### 2. Title dates

**Global season.** Each country numbers its own seasons. The latest retained `worlddetails` 1.9
response for each of the 160 leagues gives `SeasonOffset`, so local season = global season +
`SeasonOffset`. For example, Trinidad & Tobago is −25, so its S3 is global S28.

- The frozen Hattrick Anniversary League (1002, `ActiveTeams` 0) still reports an offset relative
  to today. Its last round on 2024-09-21 makes its real offset −80, not the reported −87.
- Masters seasons are stored as global seasons.
- Seasonal trophies run one edition per season, in the first or second week after league round 14.
  Edition *e* of a trophy whose current edition is *c* belongs to global season 95 − (*c* − *e*).
- The stored maximum season of every league and cup agrees with its current season in
  `worlddetails`. So the archive uses each competition's current numbering.

**Date.** Seasons are 16 weeks (112 days) long. Sweden's response from 2026-10-29 puts round 15 on
2026-11-01, so global S95's league round 14 was on 2026-10-25. Global season *g* therefore ends
112 × (95 − *g*) days earlier. Retained evidence confirms the model across the archive:

| Retained evidence | Rows | Actual date minus modelled season end |
| --- | ---: | --- |
| Cup finals in `cupmatches` 1.2 captures, global S15–S95 | 2,014 | −61 to +4 days |
| Dated Club History "finished as number N … season S" rows, 28 leagues (2002–2026) | 2,294 | −2 to +10 days |
| Dated Club History seasonal-trophy rows, Supporter Week 1–37 and Legends/Titans/Heroes 1–29 | 1,769 | +7 to +26 days |

Retained `leaguefixtures` for S95 agree within one day in all 159 active leagues.

**Latest possible title date.** Each title gets a window around its modelled season end. Only the
latest end is used for flagging:

| Family | Window around the modelled season end |
| --- | --- |
| League | −7 to +14 days |
| Domestic cups and Masters | −75 to +10 days |
| Legends, Titans and Heroes trophies | +1 to +10 days |
| Supporter Week | +8 to +28 days |

No retained dated evidence covers global seasons before S15 (before 2002). The model assumes those
seasons were also 16 weeks. The confidence rule below demands a larger gap there.

### 3. Earliest possible account creation

**Anchors.** Retained `teamdetails` 3.6 responses give the owner's `SignupDate`. They cover 395
accounts: 399 owner snapshots from 2026-10-30 that name an owner, one updater capture and one
committed sample.

**IDs rise over time, but not every SignupDate follows.** 87 of the 395 accounts have a
`SignupDate` later than a higher ID's. Examples:

- ID 263189 signed up 2014-08-12.
- GM-Merfis (8997364) signed up 2026-09-14, although nearby IDs date from 2009.

These are re-registrations or re-issued IDs, so their `SignupDate` says nothing about when the ID
was first issued. The remaining 308 accounts form a strictly ordered chain. Each signed up no later
than every higher ID. The chain runs from ID 17546 (2000-12-08) to ID 14501938 (2025-12-28).

**Lower bound.** For a credited ID, the account was created no earlier than the `SignupDate` of the
highest chain account at or below that ID. When the credited account is itself on the chain, that
is its own `SignupDate`. The bound is conservative: the true creation date lies between this anchor
and the next one above.

**Validation.** 854 dated Club History rows link a manager ID. Each proves that ID existed on that
day. None falls before the chain's lower bound for its ID. The bound is also tight: 89 events land
within 30 days of it, the closest one day after. For example, ID 12193988 took over a club on
2012-06-23, the day after ID 12188748 signed up.

### 4. Flag rule and confidence

The gap is the earliest possible account creation minus the latest possible title date.

| Verdict | Rule | Rows |
| --- | --- | ---: |
| **Flagged, high** | Gap ≥ 112 days (one season) from the nearest chain anchor, and also from the next lower anchor. Before global S15 the second anchor must clear 224 days. | 916 |
| **Flagged, medium** | Gap ≥ 112 days from the nearest anchor only. | 24 |
| **Review only** | The credited account's own `SignupDate` is after the title, but the ID is older ([Appendix B](#appendix-b-review-only-id-older-than-the-account)). | 15 |
| **Borderline** | Gap of 1–111 days, inside the margin ([Appendix C](#appendix-c-borderline-inside-the-safety-margin)). | 46 |

High confidence never rests on a single anchor. The medium rows include nine league titles from
global S13 (2001). There, anchors 50832 (2001-12-19) and 55874 (2002-01-17) put IDs 78207–205194
94 and 123 days after the title. No anchor exists between ID 55874 and ID 230281 (2003-01-14), so
the real gap for those IDs is probably much larger.

Review-only rows are not proposed for correction. The account behind the ID today is newer than
the title. Whether the same person held the ID then cannot be told from IDs:

- A returning manager whose `SignupDate` was reset would be a correct credit.
- A re-issued ID would be a wrong one.

### Limitations

- **Only accounts created after the title are detected.** A title credited to an older account
  that took the club over later is just as wrong, and probably far more common. This audit cannot
  see those.
- **The bound covers when an ID was first issued.** A credited ID that was later re-issued to a
  new account is caught only when that account is an anchor.
- **Anchors are sparse in places, notably 2002.** There the bound stays conservative, which
  produces medium or borderline verdicts rather than false flags.
- **Pre-2002 dates are uncalibrated.** They rest on the 16-week assumption, mitigated by the
  two-season rule.

## Proposed corrections

[`qa/pre-signup-attribution-clearances.proposed.json`](../qa/pre-signup-attribution-clearances.proposed.json)
holds one `clear-attribution` record per flagged title (940). Each sets `championUserId` and
`championUserName` to null (manager pending). Nothing else changes: not the winning club, the
result, the `HattrickUser` row or any other title.

Each record carries:

- The competition/season key, `leagueId` and `teamName`.
- The exact expected prior values: `expectedPriorTeamId`, `expectedPriorUserId` and
  `expectedPriorUserName`.
- The confidence and a one-line reason.
- The evidence: latest title date, global season, the anchor or anchors and the gaps.

`reviewedAt` is `null` until a reviewer signs off. The file sits in `qa/` on purpose:
`server/src/data/` and `.scrape/winner-recovery/` are evidence roots, and an unreviewed draft must
not be retained as evidence.

**Dry run on a scratch copy.** The draft was applied in one transaction to a throwaway copy of the
snapshot, never the store:

- Every guarded update matched exactly one row.
- A cell-by-cell diff against the accepted snapshot shows only `championUserId` and
  `championUserName` changed, in 384 league rows and 556 cup rows.
- Managers with at least one credited title would drop from 10,425 to 9,997.

A separate brute-force recomputation agreed with the script on every flagged row's anchors,
global season and title date.

### Why the current workflow cannot apply it yet

1. **The manifest schema does not allow a clearance.** The reviewed-correction manifest
   (`server/src/data/reviewed-winner-corrections.json`, schema in
   `server/src/sync/reviewedCorrections.ts`) only replaces one positive cup manager with another.
   Each change needs a direct, manager-linked Club History event. A clearance has no new manager and
   no event, and 384 of the rows are league titles.
2. **The import guard rejects the change.** `update:import` runs `assertArchivePreserved`
   (`server/src/update/snapshots.ts`), which refuses any change to a positive `championUserId`.
   Now that accepted state lives in the update store, that guard would also refuse the existing
   positive-to-positive corrections. So no supported path can currently change a published manager
   credit.

### Proposed extension (not implemented; needs your approval)

1. **Schema.** Add a `clear-attribution` record kind for `leagueChampion` and `cupChampion`, with
   the fields in the draft. Require a reviewer-set `reviewedAt`. Re-check from the record that the
   anchor date minus the latest title date is at least 112 days.
2. **Applicator.** Reuse the `processReviewedCorrections` pattern:
   - Dry run by default.
   - Preflight every record, and let one mismatch block the batch.
   - Make each update a single guarded `updateMany` on every expected prior value.
   - With `--apply`, require a new, exclusive report file.
3. **Import.** Add `update:import --corrections <manifest>`. It allows exactly the listed
   `championUserId` → null changes, and checks that the candidate differs from the accepted
   snapshot only in those rows' `championUserId`, `championUserName` and `updatedAt`. Every other
   row still goes through `assertArchivePreserved` unchanged. The manifest is retained by hash as
   evidence in the new snapshot.
4. **Release.** Publish with `npm run update:publish -- --no-fetch` through `scripts/git-release.mjs`,
   as for any data release.

The weekly replay of retained Club History evidence fills only `null`/`0` managers from exact,
manager-linked evidence. So a cleared title can later regain a manager only through that evidence.
No disabled approximation is re-enabled.

### Suggested order

1. Review the 24 medium rows (marked †) and Appendix B. Medium rows can stay in the batch or wait
   for a second pass.
2. Approve the extension above. It is a code change with tests, landed on `main` like any other
   code.
3. Set `reviewedAt` and commit the reviewed manifest next to `reviewed-winner-corrections.json`.
4. Run, in order:
   1. `update:checkout`.
   2. The applicator, first as a dry run, then with `--apply`.
   3. `update:import --corrections …`.
   4. `npm run update:publish -- --no-fetch`.

## Reproduce

From the repository root, against a restored copy of the accepted snapshot (never the live store
file):

```powershell
node qa/audit-pre-signup-attributions.mjs --db <copy of archive.db> `
  --out .scrape/pre-signup-audit/results-c32714f1.json `
  --proposal qa/pre-signup-attribution-clearances.proposed.json
```

`--store` and `--scrape` default to `.update-store` and `.scrape` in the checkout. The full results,
including the anchor chain and per-row gaps, are kept privately at
`.scrape/pre-signup-audit/results-c32714f1.json`.

## Appendix A: flagged titles by credited manager

520 managers, 940 titles, ordered by user ID. "Account created no earlier than" names the chain
anchor. "Second anchor" is the next lower chain account; it backs the high-confidence verdict.
Medium-confidence titles are marked †. Dates are the latest possible title date.

| Credited manager | Account created no earlier than | Second anchor | Flagged titles (latest possible title date) |
| --- | --- | --- | --- |
| clown1977 (78207) | 2002-01-17 (ID 55874) | 2001-12-19 (ID 50832) | Chile league S1 ≤2001-09-16 † |
| Mod-Niero (115305) | 2002-01-17 (ID 55874) | 2001-12-19 (ID 50832) | Norway league S1 ≤2001-05-27 † |
| asdfg (115325) | 2002-01-17 (ID 55874) | 2001-12-19 (ID 50832) | Russia league S1 ≤2001-09-16 † |
| Siu\_Ming (115654) | 2002-01-17 (ID 55874) | 2001-12-19 (ID 50832) | People's Republic of China league S1 ≤2001-09-16 † |
| Hardcore4ever (116215) | 2002-01-17 (ID 55874) | 2001-12-19 (ID 50832) | Netherlands league S2 ≤2001-09-16 † |
| Z\_ollfranck (119996) | 2002-01-17 (ID 55874) | 2001-12-19 (ID 50832) | Denmark league S13 ≤2001-09-16 † |
| MECHON (170203) | 2002-01-17 (ID 55874) | 2001-12-19 (ID 50832) | Argentina league S12 ≤2001-05-27 †; Argentina league S13 ≤2001-09-16 † |
| Enontek (191452) | 2002-01-17 (ID 55874) | 2001-12-19 (ID 50832) | Finland league S13 ≤2001-09-16 † |
| Alanlpps (192591) | 2002-01-17 (ID 55874) | 2001-12-19 (ID 50832) | England league S11 ≤2001-02-04; England league S12 ≤2001-05-27 † |
| rjspencer (192861) | 2002-01-17 (ID 55874) | 2001-12-19 (ID 50832) | England league S13 ≤2001-09-16 † |
| maverickous (194664) | 2002-01-17 (ID 55874) | 2001-12-19 (ID 50832) | France league S11 ≤2001-02-04 |
| starteam (205194) | 2002-01-17 (ID 55874) | 2001-12-19 (ID 50832) | Canada league S1 ≤2001-09-16 † |
| Fragment (278692) | 2003-01-14 (ID 230281) | 2002-01-17 (ID 55874) | Turkey league S1 ≤2001-09-16 † |
| m0nk3y (301257) | 2003-01-14 (ID 230281) | 2002-01-17 (ID 55874) | Latvia league S1 ≤2002-08-18 † |
| calvito\_21 (303625) | 2003-03-18 (ID 303148) | 2003-01-14 (ID 230281) | Colombia league S1 ≤2001-09-16; Colombia league S2 ≤2002-01-06 |
| eLcINO (303908) | 2003-03-18 (ID 303148) | 2003-01-14 (ID 230281) | Italy league S13 ≤2001-09-16; Italy league S14 ≤2002-01-06 |
| Ryszardo (309565) | 2003-03-18 (ID 303148) | 2003-01-14 (ID 230281) | Poland league S2 ≤2002-01-06 |
| children (314251) | 2003-03-26 (ID 312391) | 2003-03-18 (ID 303148) | Thailand league S2 ≤2002-01-06 |
| julius76 (314819) | 2003-03-26 (ID 312391) | 2003-03-18 (ID 303148) | Italy league S11 ≤2001-02-04 |
| rocko7 (463636) | 2003-06-13 (ID 433681) | 2003-05-29 (ID 407079) | Romania league S2 ≤2002-01-06 |
| realkevin (470576) | 2003-06-13 (ID 433681) | 2003-05-29 (ID 407079) | Argentina league S11 ≤2001-02-04 |
| sir\_silas (473397) | 2003-06-13 (ID 433681) | 2003-05-29 (ID 407079) | Romania league S1 ≤2001-09-16; Romania league S3 ≤2002-04-28 |
| Odelaine (480487) | 2003-06-13 (ID 433681) | 2003-05-29 (ID 407079) | Germany league S13 ≤2001-09-16; Germany league S14 ≤2002-01-06; Germany league S15 ≤2002-04-28 |
| carlosansal (482212) | 2003-06-13 (ID 433681) | 2003-05-29 (ID 407079) | Spain league S3 ≤2002-04-28 |
| siimi007 (482238) | 2003-06-13 (ID 433681) | 2003-05-29 (ID 407079) | Estonia league S1 ≤2002-08-18 |
| mafiakurakura (499410) | 2003-07-19 (ID 496980) | 2003-07-18 (ID 496286) | Indonesia league S1 ≤2002-08-18 |
| Binho (523839) | 2003-08-03 (ID 522014) | 2003-07-19 (ID 496980) | Copa do Brasil (Brazil) S3 ≤2002-04-24; Brazil league S3 ≤2002-04-28 |
| kew1n (526792) | 2003-08-03 (ID 522014) | 2003-07-19 (ID 496980) | Hungary league S1 ≤2002-08-18 |
| ventalaca (571562) | 2003-08-27 (ID 566127) | 2003-08-03 (ID 522014) | Portugal league S1 ≤2001-09-16 |
| zadrugar (668698) | 2003-10-08 (ID 657955) | 2003-10-05 (ID 651833) | Куп Србије (Serbia) S2 ≤2002-12-04 |
| savcan (701465) | 2003-10-08 (ID 657955) | 2003-10-05 (ID 651833) | Slovenia league S2 ≤2003-03-30 |
| 123thomas123 (711847) | 2003-10-08 (ID 657955) | 2003-10-05 (ID 651833) | Denmark league S14 ≤2002-01-06 |
| lichno (716259) | 2003-10-08 (ID 657955) | 2003-10-05 (ID 651833) | Bulgaria league S2 ≤2003-03-30 |
| APedro (722055) | 2003-10-08 (ID 657955) | 2003-10-05 (ID 651833) | Portugal league S3 ≤2002-04-28 |
| Finkas (757219) | 2003-10-08 (ID 657955) | 2003-10-05 (ID 651833) | Portugal league S2 ≤2002-01-06 |
| GRGPAP (838011) | 2003-12-14 (ID 833134) | 2003-12-11 (ID 823728) | Κύπελλο Ελλάδος (Greece) S2 ≤2002-12-04 |
| gui34 (1414819) | 2004-06-10 (ID 1412981) | 2004-05-13 (ID 1315639) | France league S15 ≤2002-04-28 |
| gauyeu (1423251) | 2004-06-10 (ID 1412981) | 2004-05-13 (ID 1315639) | Vietnam league S2 ≤2003-11-09 |
| islamabad (1436344) | 2004-06-10 (ID 1412981) | 2004-05-13 (ID 1315639) | Pakistan league S2 ≤2003-11-09 |
| susdimp (1824205) | 2004-09-23 (ID 1787338) | 2004-09-18 (ID 1769530) | Faroe Islands league S1 ≤2004-02-29 |
| Ra-tica (2313413) | 2005-01-08 (ID 2220986) | 2004-12-31 (ID 2192748) | Costa Rica league S1 ≤2004-06-20 |
| luis\_angel (2412635) | 2005-02-14 (ID 2385695) | 2005-02-11 (ID 2373232) | Mexico league S20 ≤2003-11-09; Copa Nacional de México (Mexico) S21 ≤2004-02-25 |
| MyndaZaS (2477061) | 2005-02-23 (ID 2427838) | 2005-02-22 (ID 2426869) | Lithuania league S2 ≤2003-11-09 |
| dino24 (3148037) | 2005-07-21 (ID 3121901) | 2005-07-10 (ID 3076447) | Croatia league S1 ≤2002-08-18 |
| Ciobik (3216098) | 2005-08-09 (ID 3197808) | 2005-08-04 (ID 3178524) | Moldova league S1 ≤2005-01-30 |
| Rynno (3559190) | 2005-09-30 (ID 3446090) | 2005-09-15 (ID 3369681) | Eesti Karikas (Estonia) S6 ≤2004-02-25; Eesti Karikas (Estonia) S7 ≤2004-06-16 |
| Jack32 (3872038) | 2005-12-28 (ID 3859828) | 2005-12-26 (ID 3854944) | Czechia league S1 ≤2002-08-18 |
| julian71 (3985766) | 2006-01-13 (ID 3931628) | 2006-01-10 (ID 3913427) | Austria-Cup (Austria) S3 ≤2002-08-14; Austria league S3 ≤2002-08-18; Austria-Cup (Austria) S4 ≤2002-12-04; Austria league S4 ≤2002-12-08 |
| crislibo (4109073) | 2006-01-13 (ID 3931628) | 2006-01-10 (ID 3913427) | Costa Rica league S3 ≤2005-01-30; La Copa Tica (Costa Rica) S4 ≤2005-05-18; Costa Rica league S4 ≤2005-05-22 |
| Randee (4355940) | 2006-03-28 (ID 4310645) | 2006-03-11 (ID 4224176) | Cupa Moldovei (Moldova) S1 ≤2005-01-26 |
| rustynath (4684215) | 2006-05-30 (ID 4654218) | 2006-05-11 (ID 4540620) | South Korea league S3 ≤2002-04-28 |
| Abdabs (5124624) | 2006-08-25 (ID 5059099) | 2006-08-23 (ID 5052435) | Coppa Italia (Italy) S22 ≤2004-06-16 |
| Stibro99 (5357908) | 2006-09-25 (ID 5229841) | 2006-09-17 (ID 5188318) | Slovakia league S2 ≤2003-11-09 |
| -zico- (5423235) | 2006-10-19 (ID 5364705) | 2006-09-25 (ID 5229841) | Scottish Cup (Scotland) S8 ≤2003-11-05 |
| jhojho28 (5470006) | 2006-11-07 (ID 5462595) | 2006-10-19 (ID 5364705) | Copa Colombia (Colombia) S6 ≤2003-03-26; Colombia league S6 ≤2003-03-30 |
| Moxhi (5492690) | 2006-11-07 (ID 5462595) | 2006-10-19 (ID 5364705) | Kupa e Shqipërisë (Albania) S1 ≤2005-01-26 |
| PXNDA (5891553) | 2007-01-16 (ID 5788546) | 2007-01-15 (ID 5782229) | Mexico league S11 ≤2001-02-04 |
| dr-maus (5892046) | 2007-01-16 (ID 5788546) | 2007-01-15 (ID 5782229) | Suriname league S3 ≤2006-04-23 |
| AbTalib (6088845) | 2007-03-11 (ID 6054033) | 2007-03-08 (ID 6038462) | Azerbaijan league S1 ≤2006-08-13 |
| Bagger (6114932) | 2007-03-21 (ID 6108728) | 2007-03-11 (ID 6054033) | Coupe de Luxembourg (Luxembourg) S2 ≤2004-10-06 |
| eliuperez (6200361) | 2007-03-25 (ID 6127012) | 2007-03-21 (ID 6108728) | Honduras league S3 ≤2005-09-11; Copa Nacional Catracha (Honduras) S5 ≤2006-04-19; Copa Nacional Catracha (Honduras) S6 ≤2006-08-09; Honduras league S6 ≤2006-08-13; Copa Nacional Catracha (Honduras) S7 ≤2006-11-29; Honduras league S7 ≤2006-12-03 † |
| mek-js (6252130) | 2007-04-14 (ID 6234131) | 2007-03-25 (ID 6127012) | Iceland league S17 ≤2006-12-03 |
| Dineokos (6582471) | 2007-05-17 (ID 6403993) | 2007-05-09 (ID 6364143) | Belgium league S2 ≤2002-04-28 |
| dedous (6686890) | 2007-05-17 (ID 6403993) | 2007-05-09 (ID 6364143) | Czechia league S4 ≤2003-07-20 |
| Karrde19 (6704939) | 2007-07-05 (ID 6688470) | 2007-05-17 (ID 6403993) | Bahrain league S1 ≤2006-04-23 |
| salimbari (6771173) | 2007-07-16 (ID 6734909) | 2007-07-05 (ID 6688470) | Kuwait league S1 ≤2006-08-13; Kuwait league S2 ≤2006-12-03 |
| katarata (6806504) | 2007-07-16 (ID 6734909) | 2007-07-05 (ID 6688470) | Angola league S1 ≤2006-12-03 |
| cheri (6914309) | 2007-08-24 (ID 6908131) | 2007-07-16 (ID 6734909) | Luxembourg league S2 ≤2004-10-10; Luxembourg league S3 ≤2005-01-30 |
| kaddra77 (6957327) | 2007-08-24 (ID 6908131) | 2007-07-16 (ID 6734909) | Northern Ireland league S1 ≤2004-10-10; N. Ireland Cup (Northern Ireland) S5 ≤2005-12-28; Northern Ireland league S5 ≤2006-01-01; Northern Ireland league S7 ≤2006-08-13 |
| bedo13 (7007124) | 2007-08-24 (ID 6908131) | 2007-07-16 (ID 6734909) | Jordan league S1 ≤2005-05-22 |
| Ham-kam (7159693) | 2007-08-24 (ID 6908131) | 2007-07-16 (ID 6734909) | Iceland league S4 ≤2002-12-08 |
| Whitesox (7165676) | 2007-08-24 (ID 6908131) | 2007-07-16 (ID 6734909) | Liechtenstein Cup (Liechtenstein) S5 ≤2007-03-21; Liechtenstein league S5 ≤2007-03-25 |
| blaaacky (7165983) | 2007-08-24 (ID 6908131) | 2007-07-16 (ID 6734909) | Austria-Cup (Austria) S2 ≤2002-04-24 |
| Eldeloschistes (7169908) | 2007-08-24 (ID 6908131) | 2007-07-16 (ID 6734909) | Peru league S11 ≤2004-10-10; Copa Perú (Peru) S13 ≤2005-05-18; Peru league S13 ≤2005-05-22 |
| Bansse (7399726) | 2007-11-10 (ID 7257216) | 2007-10-29 (ID 7213323) | Serbia league S6 ≤2004-02-29; Куп Србије (Serbia) S11 ≤2005-09-07 |
| ranpim (7401542) | 2007-11-10 (ID 7257216) | 2007-10-29 (ID 7213323) | Costa Rica league S2 ≤2004-10-10; Costa Rica league S5 ≤2005-09-11; La Copa Tica (Costa Rica) S6 ≤2005-12-28; Costa Rica league S6 ≤2006-01-01; La Copa Tica (Costa Rica) S7 ≤2006-04-19; Costa Rica league S7 ≤2006-04-23; Costa Rica league S8 ≤2006-08-13 |
| ninefourfour (7720127) | 2008-02-18 (ID 7650194) | 2008-02-06 (ID 7598319) | Oceanian Cup (Oceania) S19 ≤2007-03-21 |
| bauer04 (7741706) | 2008-02-18 (ID 7650194) | 2008-02-06 (ID 7598319) | Kuwait league S4 ≤2007-07-15 |
| Miss\_Psycho (7898770) | 2008-03-25 (ID 7804043) | 2008-03-23 (ID 7796996) | Côte d’Ivoire league S1 ≤2006-04-23 |
| thproject (7972637) | 2008-04-18 (ID 7913760) | 2008-04-17 (ID 7909415) | South Korea league S2 ≤2002-01-06 |
| Tom1987 (7999813) | 2008-04-18 (ID 7913760) | 2008-04-17 (ID 7909415) | Kyrgyz Republic league S1 ≤2005-01-30 |
| geo2023 (8113374) | 2008-05-21 (ID 8048932) | 2008-04-18 (ID 7913760) | Κύπελλο Ελλάδος (Greece) S10 ≤2005-05-18; Greece league S12 ≤2006-01-01 |
| ivan6306 (8139533) | 2008-05-21 (ID 8048932) | 2008-04-18 (ID 7913760) | Mexico league S19 ≤2003-07-20; Copa Nacional de México (Mexico) S20 ≤2003-11-05; Mexico league S23 ≤2004-10-10; Copa Nacional de México (Mexico) S24 ≤2005-01-26; Mexico league S28 ≤2006-04-23; Mexico league S30 ≤2006-12-03 |
| Edolla69\_666 (8183213) | 2008-06-14 (ID 8148260) | 2008-05-21 (ID 8048932) | Cape Verde league S3 ≤2006-12-03; Cape Verde league S4 ≤2007-03-25; Taça de Cabo Verde (Cape Verde) S6 ≤2007-10-31; Cape Verde league S6 ≤2007-11-04; Taça de Cabo Verde (Cape Verde) S7 ≤2008-02-20 † |
| DxHT-pawpol (8190906) | 2008-06-14 (ID 8148260) | 2008-05-21 (ID 8048932) | Guatemala league S6 ≤2006-12-03; Guatemala league S8 ≤2007-07-15 |
| leferba (8308149) | 2008-07-12 (ID 8259320) | 2008-07-11 (ID 8255649) | Colombia league S7 ≤2003-07-20; Colombia league S8 ≤2003-11-09; Copa Colombia (Colombia) S9 ≤2004-02-25 |
| kvathron (8363859) | 2008-08-11 (ID 8359600) | 2008-07-12 (ID 8259320) | Český pohár (Czechia) S7 ≤2004-06-16; Český pohár (Czechia) S14 ≤2006-08-09; Český pohár (Czechia) S15 ≤2006-11-29 |
| Sylly (8376721) | 2008-08-11 (ID 8359600) | 2008-07-12 (ID 8259320) | Magyar Kupa (Hungary) S9 ≤2005-01-26 |
| Brank\_Wernersson (8489944) | 2008-08-29 (ID 8415845) | 2008-08-25 (ID 8402251) | Bangladesh Cup (Bangladesh) S2 ≤2007-03-21; Bangladesh league S2 ≤2007-03-25 |
| akkad (8537021) | 2008-08-29 (ID 8415845) | 2008-08-25 (ID 8402251) | Iraq league S1 ≤2006-08-13 |
| Cavelieri (8543566) | 2008-08-29 (ID 8415845) | 2008-08-25 (ID 8402251) | Oceania league S1 ≤2001-09-16 |
| kiwoui (8585100) | 2008-08-29 (ID 8415845) | 2008-08-25 (ID 8402251) | Kyrgyzstan Cup (Kyrgyz Republic) S11 ≤2008-02-20 |
| Milzinas (8588852) | 2008-08-29 (ID 8415845) | 2008-08-25 (ID 8402251) | Lithuania league S4 ≤2004-06-20 |
| oscarhll12 (8729999) | 2008-11-15 (ID 8701122) | 2008-10-22 (ID 8611610) | Senegal league S1 ≤2006-01-01 |
| schwacm (8911182) | 2009-01-04 (ID 8888417) | 2009-01-03 (ID 8883065) | US Open Cup (USA) S34 ≤2008-02-20 |
| juve80 (8974775) | 2009-01-15 (ID 8929432) | 2009-01-15 (ID 8926895) | Kaas El Malek (Bahrain) S2 ≤2006-08-09; Bahrain league S2 ≤2006-08-13 |
| Huseyn\_555 (9015059) | 2009-01-15 (ID 8929432) | 2009-01-15 (ID 8926895) | Azərbaycan Kuboku (Azerbaijan) S1 ≤2006-08-09 |
| elyisuz00 (9017664) | 2009-01-15 (ID 8929432) | 2009-01-15 (ID 8926895) | Venezuela league S1 ≤2001-09-16 |
| ahmed2030 (9020618) | 2009-01-15 (ID 8929432) | 2009-01-15 (ID 8926895) | Oman league S1 ≤2007-03-25 |
| matrix34 (9115025) | 2009-02-01 (ID 9039027) | 2009-01-15 (ID 8929432) | Taça de Angola (Angola) S3 ≤2007-07-11 |
| biancorossonero (9117583) | 2009-02-01 (ID 9039027) | 2009-01-15 (ID 8929432) | Tanzania league S1 ≤2008-06-15 |
| lvl\_Rashid\_lvl (9191400) | 2009-02-21 (ID 9128728) | 2009-02-01 (ID 9039027) | Syria league S1 ≤2008-02-24 |
| JagerDen (9192337) | 2009-02-21 (ID 9128728) | 2009-02-01 (ID 9039027) | Russia league S2 ≤2002-01-06 |
| SteveCanyon (9208274) | 2009-02-21 (ID 9128728) | 2009-02-01 (ID 9039027) | Kaas El Malek (Bahrain) S6 ≤2007-10-31; Bahrain league S6 ≤2007-11-04; Bahrain league S7 ≤2008-02-24; Kaas El Malek (Bahrain) S9 ≤2008-10-01 |
| Spirit\_of\_Yesterday (9223638) | 2009-02-21 (ID 9128728) | 2009-02-01 (ID 9039027) | Кубок России (Russia) S18 ≤2006-11-29; Russia league S21 ≤2007-11-04 |
| gedisas30 (9259569) | 2009-03-26 (ID 9255088) | 2009-03-21 (ID 9238459) | Northern Ireland league S3 ≤2005-05-22 |
| JESUSROJAS (9337896) | 2009-04-17 (ID 9331110) | 2009-04-14 (ID 9321686) | Copa Colombia (Colombia) S13 ≤2005-05-18; Copa Colombia (Colombia) S14 ≤2005-09-07; Colombia league S14 ≤2005-09-11; Colombia league S15 ≤2006-01-01; Colombia league S18 ≤2006-12-03 |
| Evreyman06 (9360248) | 2009-04-17 (ID 9331110) | 2009-04-14 (ID 9321686) | Armenia league S2 ≤2006-04-23 |
| lebanese (9369659) | 2009-04-17 (ID 9331110) | 2009-04-14 (ID 9321686) | Lebanon league S1 ≤2006-01-01 |
| fittif (9537622) | 2009-05-23 (ID 9464167) | 2009-04-17 (ID 9331110) | Senegal league S4 ≤2006-12-03 |
| Canary76 (9552644) | 2009-05-23 (ID 9464167) | 2009-04-17 (ID 9331110) | Thai Cup (Thailand) S11 ≤2004-10-06; Thailand league S18 ≤2006-12-03 |
| BABA-COOL63 (9583766) | 2009-06-16 (ID 9553738) | 2009-05-23 (ID 9464167) | Kenya league S9 ≤2007-03-25 |
| don\_ok (9636387) | 2009-06-16 (ID 9553738) | 2009-05-23 (ID 9464167) | France league S18 ≤2003-03-30 |
| arsze (9719490) | 2009-08-04 (ID 9709772) | 2009-07-25 (ID 9678252) | Poland league S1 ≤2001-09-16 |
| Mascara (9756641) | 2009-08-09 (ID 9725425) | 2009-08-04 (ID 9709772) | Jamaica league S3 ≤2005-05-22; Jamaica Cup (Jamaica) S4 ≤2005-09-07; Jamaica league S4 ≤2005-09-11; Jamaica Cup (Jamaica) S5 ≤2005-12-28; Jamaica league S5 ≤2006-01-01; Jamaica Cup (Jamaica) S6 ≤2006-04-19; Jamaica league S6 ≤2006-04-23; Jamaica Cup (Jamaica) S7 ≤2006-08-09 |
| WildeHorde1948 (9826267) | 2009-09-06 (ID 9816045) | 2009-08-09 (ID 9725425) | Taça de Angola (Angola) S7 ≤2008-10-01; Angola league S7 ≤2008-10-05 |
| Turgin (9829737) | 2009-09-06 (ID 9816045) | 2009-08-09 (ID 9725425) | Copa Gran Jaguar (Guatemala) S3 ≤2005-12-28; Guatemala league S4 ≤2006-04-23; Copa Gran Jaguar (Guatemala) S5 ≤2006-08-09; Guatemala league S5 ≤2006-08-13 |
| xpsilo (9883032) | 2009-09-06 (ID 9816045) | 2009-08-09 (ID 9725425) | Philippines league S1 ≤2002-08-18 |
| Fejfis (9904393) | 2009-09-06 (ID 9816045) | 2009-08-09 (ID 9725425) | Suriname league S2 ≤2006-01-01 |
| sadomazohist (9936989) | 2009-09-06 (ID 9816045) | 2009-08-09 (ID 9725425) | Greece league S7 ≤2004-06-20; Κύπελλο Ελλάδος (Greece) S8 ≤2004-10-06; Greece league S8 ≤2004-10-10 |
| jantato (9965959) | 2009-09-06 (ID 9816045) | 2009-08-09 (ID 9725425) | Dominican Republic league S1 ≤2004-06-20 |
| Anar\_32 (9971511) | 2009-09-06 (ID 9816045) | 2009-08-09 (ID 9725425) | Azərbaycan Kuboku (Azerbaijan) S2 ≤2006-11-29; Azerbaijan league S2 ≤2006-12-03 |
| omarbev (10009157) | 2009-09-06 (ID 9816045) | 2009-08-09 (ID 9725425) | Купа на България (Bulgaria) S7 ≤2004-10-06 |
| \_Spicke\_ (10018058) | 2009-09-06 (ID 9816045) | 2009-08-09 (ID 9725425) | Taça de Portugal (Portugal) S21 ≤2007-10-31 |
| EHP-Apholion (10041425) | 2009-09-06 (ID 9816045) | 2009-08-09 (ID 9725425) | Copa Nacional Catracha (Honduras) S12 ≤2008-06-11 |
| uny11 (10150426) | 2009-09-06 (ID 9816045) | 2009-08-09 (ID 9725425) | Copa Constitució (Andorra) S9 ≤2007-10-31 |
| mid18 (10162429) | 2009-09-06 (ID 9816045) | 2009-08-09 (ID 9725425) | Copa Nacional de México (Mexico) S32 ≤2007-07-11; Copa Nacional de México (Mexico) S33 ≤2007-10-31 |
| Iginla (10217829) | 2010-01-03 (ID 10186882) | 2009-09-06 (ID 9816045) | N. Ireland Cup (Northern Ireland) S16 ≤2009-05-13; N. Ireland Cup (Northern Ireland) S17 ≤2009-09-02 †; Northern Ireland league S17 ≤2009-09-06 † |
| Finelweld (10223055) | 2010-01-03 (ID 10186882) | 2009-09-06 (ID 9816045) | Spain league S4 ≤2002-08-18; Spain league S6 ≤2003-03-30 |
| 02-looberghe (10232479) | 2010-01-03 (ID 10186882) | 2009-09-06 (ID 9816045) | France league S13 ≤2001-09-16 |
| Torekomode (10239403) | 2010-01-17 (ID 10233544) | 2010-01-03 (ID 10186882) | Barbados league S1 ≤2006-04-23 |
| aalbecon (10292970) | 2010-01-30 (ID 10277262) | 2010-01-17 (ID 10233544) | Coupe nationale (Côte d’Ivoire) S4 ≤2007-03-21; Côte d’Ivoire league S4 ≤2007-03-25 |
| Rouras (10364509) | 2010-01-30 (ID 10277262) | 2010-01-17 (ID 10233544) | Copa Constitució (Andorra) S2 ≤2005-09-07; Andorra league S4 ≤2006-04-23; Copa Constitució (Andorra) S7 ≤2007-03-21 |
| grinzers (10408587) | 2010-02-27 (ID 10365330) | 2010-01-30 (ID 10277262) | Pakistan Cup (Pakistan) S15 ≤2007-10-31 |
| caubry (10480732) | 2010-02-27 (ID 10365330) | 2010-01-30 (ID 10277262) | Coupe nationale (Côte d’Ivoire) S1 ≤2006-04-19 |
| masterMUNGO (10480927) | 2010-02-27 (ID 10365330) | 2010-01-30 (ID 10277262) | Poland league S17 ≤2006-08-13; Poland league S19 ≤2007-03-25 |
| bcfc81 (10514148) | 2010-04-16 (ID 10502329) | 2010-04-14 (ID 10496115) | Hayastani gavat (Armenia) S7 ≤2007-10-31; Armenia league S8 ≤2008-02-24; Armenia league S10 ≤2008-10-05 |
| bjorn123 (10519497) | 2010-04-16 (ID 10502329) | 2010-04-14 (ID 10496115) | Íslandsbikarinn (Iceland) S9 ≤2004-06-16; Iceland league S9 ≤2004-06-20; Iceland league S10 ≤2004-10-10; Íslandsbikarinn (Iceland) S13 ≤2005-09-07 |
| Tampe (10520814) | 2010-04-20 (own SignupDate) | 2010-04-16 (ID 10502329) | Trinidad & Tobago league S3 ≤2006-04-23; Trinidad & Tobago league S4 ≤2006-08-13; The Pro Bowl (Trinidad & Tobago) S5 ≤2006-11-29; Trinidad & Tobago league S5 ≤2006-12-03; The Pro Bowl (Trinidad & Tobago) S6 ≤2007-03-21; Trinidad & Tobago league S6 ≤2007-03-25; Trinidad & Tobago league S7 ≤2007-07-15; The Pro Bowl (Trinidad & Tobago) S13 ≤2009-05-13; The Pro Bowl (Trinidad & Tobago) S14 ≤2009-09-02 |
| Layzin93 (10534293) | 2010-04-20 (ID 10520814) | 2010-04-16 (ID 10502329) | Kampuchea Cup (Cambodia) S7 ≤2009-09-02 |
| ricki85 (10534897) | 2010-04-20 (ID 10520814) | 2010-04-16 (ID 10502329) | Kaas El Malek (Bahrain) S7 ≤2008-02-20; Bahrain league S8 ≤2008-06-15; Kaas El Malek (Bahrain) S11 ≤2009-05-13; Kaas El Malek (Bahrain) S12 ≤2009-09-02 |
| alexdu13 (10642731) | 2010-05-08 (ID 10585025) | 2010-04-20 (ID 10520814) | Copa Nacional Rubén Darío (Nicaragua) S2 ≤2005-12-28; Copa Nacional Rubén Darío (Nicaragua) S4 ≤2006-08-09 |
| Cenarius (10726446) | 2010-05-08 (ID 10585025) | 2010-04-20 (ID 10520814) | Nicaragua league S1 ≤2005-09-11 |
| fabioune (10754296) | 2010-06-29 (ID 10735102) | 2010-05-08 (ID 10585025) | Montenegro league S2 ≤2007-03-25 |
| marciner (10825992) | 2010-07-21 (ID 10789537) | 2010-06-29 (ID 10735102) | Poland league S5 ≤2002-12-08 |
| Hero389 (10829371) | 2010-07-21 (ID 10789537) | 2010-06-29 (ID 10735102) | Mongol Uls Cup (Mongolia) S1 ≤2005-12-28; Mongolia league S1 ≤2006-01-01 |
| Akaiy (10846443) | 2010-07-21 (ID 10789537) | 2010-06-29 (ID 10735102) | Český pohár (Czechia) S12 ≤2005-12-28 |
| ILDAVIDE (10896353) | 2010-08-22 (ID 10876689) | 2010-07-21 (ID 10789537) | South African Cup (South Africa) S6 ≤2003-03-26; South Africa league S6 ≤2003-03-30; South Africa league S8 ≤2003-11-09 |
| Christaldo (10949405) | 2010-08-22 (ID 10876689) | 2010-07-21 (ID 10789537) | Deutschland-Pokal (Germany) S15 ≤2002-04-24; Germany league S16 ≤2002-08-18; Deutschland-Pokal (Germany) S17 ≤2002-12-04; Germany league S17 ≤2002-12-08; Deutschland-Pokal (Germany) S21 ≤2004-02-25; Deutschland-Pokal (Germany) S22 ≤2004-06-16 |
| Phil\_B (10950698) | 2010-08-22 (ID 10876689) | 2010-07-21 (ID 10789537) | Guatemala league S2 ≤2005-09-11 |
| yomindo (10961433) | 2010-08-22 (ID 10876689) | 2010-07-21 (ID 10789537) | Angola league S4 ≤2007-11-04 |
| SoyOkey (11073608) | 2010-10-10 (ID 11008704) | 2010-08-22 (ID 10876689) | US Open Cup (USA) S30 ≤2006-11-29 |
| siftekhar (11087526) | 2010-10-10 (ID 11008704) | 2010-08-22 (ID 10876689) | Bangladesh Cup (Bangladesh) S7 ≤2008-10-01; Bangladesh league S7 ≤2008-10-05; Bangladesh Cup (Bangladesh) S8 ≤2009-01-21; Bangladesh league S8 ≤2009-01-25; Bangladesh Cup (Bangladesh) S9 ≤2009-05-13; Bangladesh league S9 ≤2009-05-17; Bangladesh Cup (Bangladesh) S11 ≤2009-12-23; Bangladesh league S11 ≤2009-12-27; Bangladesh league S12 ≤2010-04-18 |
| nowmore (11090298) | 2010-10-10 (ID 11008704) | 2010-08-22 (ID 10876689) | Mongol Uls Cup (Mongolia) S14 ≤2009-12-23 |
| Mod-Bassgen (11095947) | 2010-10-10 (ID 11008704) | 2010-08-22 (ID 10876689) | Armenia league S15 ≤2010-04-18 |
| pipo1985 (11097328) | 2010-10-10 (ID 11008704) | 2010-08-22 (ID 10876689) | Deutschland-Pokal (Germany) S18 ≤2003-03-26; Germany league S18 ≤2003-03-30; Germany league S19 ≤2003-07-20; Germany league S20 ≤2003-11-09; Germany league S22 ≤2004-06-20; Germany league S23 ≤2004-10-10 |
| Leonardo88 (11115852) | 2010-11-25 (ID 11107505) | 2010-10-10 (ID 11008704) | Colombia league S17 ≤2006-08-13; Copa Colombia (Colombia) S18 ≤2006-11-29; Colombia league S19 ≤2007-03-25 |
| josemartinezbeas (11146274) | 2010-12-08 (ID 11135632) | 2010-12-04 (ID 11127965) | Andorra league S2 ≤2005-09-11; Copa Constitució (Andorra) S3 ≤2005-12-28; Andorra league S3 ≤2006-01-01; Copa Constitució (Andorra) S4 ≤2006-04-19; Copa Constitució (Andorra) S6 ≤2006-11-29; Andorra league S6 ≤2006-12-03; Andorra league S7 ≤2007-03-25; Copa Constitució (Andorra) S8 ≤2007-07-11; Andorra league S8 ≤2007-07-15; Andorra league S9 ≤2007-11-04; Copa Constitució (Andorra) S10 ≤2008-02-20; Andorra league S10 ≤2008-02-24; Copa Constitució (Andorra) S11 ≤2008-06-11; Andorra league S11 ≤2008-06-15; Andorra league S12 ≤2008-10-05; Copa Constitució (Andorra) S13 ≤2009-01-21; Andorra league S13 ≤2009-01-25; Andorra league S14 ≤2009-05-17 |
| Big\_chief111 (11231422) | 2010-12-08 (ID 11135632) | 2010-12-04 (ID 11127965) | South Africa league S2 ≤2002-01-06 |
| martina73 (11298119) | 2011-02-19 (ID 11282665) | 2010-12-08 (ID 11135632) | Austria league S20 ≤2007-11-04 |
| DieterPes (11328198) | 2011-02-19 (ID 11282665) | 2010-12-08 (ID 11135632) | Íslandsbikarinn (Iceland) S7 ≤2003-11-05 |
| Il-Milanese (11329915) | 2011-02-19 (ID 11282665) | 2010-12-08 (ID 11135632) | Armenia league S3 ≤2006-08-13; Armenia league S4 ≤2006-12-03 |
| anantara (11330207) | 2011-02-19 (ID 11282665) | 2010-12-08 (ID 11135632) | Thailand league S4 ≤2002-08-18 |
| djsugo3 (11344764) | 2011-02-19 (ID 11282665) | 2010-12-08 (ID 11135632) | Copa Gran Jaguar (Guatemala) S12 ≤2008-10-01 |
| LA-lojzek91 (11497291) | 2011-05-31 (ID 11478483) | 2011-05-14 (ID 11446351) | Taça de Cabo Verde (Cape Verde) S13 ≤2009-12-23; Cape Verde league S13 ≤2009-12-27 |
| \_Sputnik\_ (11507744) | 2011-05-31 (ID 11478483) | 2011-05-14 (ID 11446351) | Løgmanssteypið (Faroe Islands) S6 ≤2005-09-07; Løgmanssteypið (Faroe Islands) S7 ≤2005-12-28 |
| PYMS18 (11615330) | 2011-06-22 (ID 11519346) | 2011-05-31 (ID 11478483) | Barbados Cup (Barbados) S7 ≤2008-02-20; Barbados Cup (Barbados) S8 ≤2008-06-11 |
| Hennes\_Weisweiler\_VIII (11673801) | 2011-08-14 (ID 11617226) | 2011-06-22 (ID 11519346) | Luxembourg league S1 ≤2004-06-20 |
| catalyste (11690860) | 2011-08-14 (ID 11617226) | 2011-06-22 (ID 11519346) | Benin Cup (Benin) S2 ≤2008-06-11 |
| francescoric (11805656) | 2011-09-23 (ID 11692271) | 2011-08-14 (ID 11617226) | Indonesia Cup (Indonesia) S9 ≤2005-01-26; Indonesia league S16 ≤2007-03-25; Indonesia league S17 ≤2007-07-15; Indonesia Cup (Indonesia) S19 ≤2008-02-20; Indonesia league S19 ≤2008-02-24; Indonesia Cup (Indonesia) S21 ≤2008-10-01 |
| drolf (11904558) | 2011-09-23 (ID 11692271) | 2011-08-14 (ID 11617226) | Mozambique league S11 ≤2010-11-28 |
| afganstan\_0093 (11915468) | 2011-09-23 (ID 11692271) | 2011-08-14 (ID 11617226) | Iran league S1 ≤2004-06-20 |
| papi\_ (11916705) | 2011-09-23 (ID 11692271) | 2011-08-14 (ID 11617226) | Bangladesh league S1 ≤2006-12-03 |
| wartschnell (11932723) | 2011-09-23 (ID 11692271) | 2011-08-14 (ID 11617226) | Kampuchea Cup (Cambodia) S4 ≤2008-10-01 |
| vale112786 (11964765) | 2011-09-23 (ID 11692271) | 2011-08-14 (ID 11617226) | Tanzania league S5 ≤2009-09-06 |
| Gaboni (12077547) | 2012-05-02 (ID 12066535) | 2012-03-24 (ID 12006392) | La Copa Tica (Costa Rica) S5 ≤2005-09-07; La Copa Tica (Costa Rica) S24 ≤2011-07-06 |
| Gunnar-Gunnarsson (12109158) | 2012-05-02 (ID 12066535) | 2012-03-24 (ID 12006392) | Jamaica league S2 ≤2005-01-30; Jamaica Cup (Jamaica) S3 ≤2005-05-18 |
| Master\_lim (12187246) | 2012-05-02 (ID 12066535) | 2012-03-24 (ID 12006392) | Malaysia league S6 ≤2003-07-20; Malaysia league S11 ≤2005-01-30; Malaysia league S13 ≤2005-09-11 |
| fmoblv (12218057) | 2012-06-22 (ID 12188748) | 2012-05-02 (ID 12066535) | Latvijas Nacionālais kauss (Latvia) S3 ≤2003-03-26 |
| vigonanh (12285763) | 2012-07-10 (ID 12240772) | 2012-06-22 (ID 12188748) | Cúp Quốc Gia (Vietnam) S2 ≤2003-11-05; Vietnam league S5 ≤2004-10-10; Cúp Quốc Gia (Vietnam) S6 ≤2005-01-26; Vietnam league S6 ≤2005-01-30; Cúp Quốc Gia (Vietnam) S7 ≤2005-05-18; Vietnam league S7 ≤2005-05-22; Vietnam league S8 ≤2005-09-11 |
| INAASSITALIA (12384744) | 2012-09-23 (ID 12381722) | 2012-09-03 (ID 12353168) | Cameroon league S1 ≤2011-07-10 |
| RinghioGrohl (12386117) | 2012-09-23 (ID 12381722) | 2012-09-03 (ID 12353168) | Kyrgyzstan Cup (Kyrgyz Republic) S1 ≤2005-01-26 |
| Pierre\_78 (12387983) | 2012-09-23 (ID 12381722) | 2012-09-03 (ID 12353168) | Lebanese FA Cup (Lebanon) S3 ≤2006-08-09; Lebanon league S3 ≤2006-08-13; Lebanese FA Cup (Lebanon) S5 ≤2007-03-21; Lebanon league S5 ≤2007-03-25; Lebanese FA Cup (Lebanon) S6 ≤2007-07-11; Lebanon league S6 ≤2007-07-15 |
| Espyngharda (12397397) | 2012-09-23 (ID 12381722) | 2012-09-03 (ID 12353168) | Jordan league S19 ≤2010-11-28; Jordan league S21 ≤2011-07-10 |
| 3wisemonkeys (12471502) | 2012-10-13 (ID 12417857) | 2012-10-05 (ID 12404341) | Copa del Istmo (Panama) S7 ≤2006-08-09 |
| 86passi (12526500) | 2012-12-25 (ID 12521486) | 2012-10-13 (ID 12417857) | Gold Coast Cup (Ghana) S14 ≤2011-10-26; Ghana league S14 ≤2011-10-30; Gold Coast Cup (Ghana) S15 ≤2012-02-15; Ghana league S15 ≤2012-02-19; Gold Coast Cup (Ghana) S16 ≤2012-06-06; Ghana league S16 ≤2012-06-10 |
| xinito\_ (12557611) | 2012-12-25 (ID 12521486) | 2012-10-13 (ID 12417857) | Ecuador league S2 ≤2004-06-20 |
| fyltou (12596670) | 2012-12-25 (ID 12521486) | 2012-10-13 (ID 12417857) | Taça de Mocambique (Mozambique) S14 ≤2011-10-26 |
| aysemyildiz (12604863) | 2012-12-25 (ID 12521486) | 2012-10-13 (ID 12417857) | Uzbekistan league S1 ≤2011-07-10 |
| Buddhas\_Hand (12620914) | 2013-03-07 (ID 12611998) | 2012-12-25 (ID 12521486) | Maldives league S2 ≤2009-01-25 |
| draminos13 (12716926) | 2013-03-07 (ID 12611998) | 2012-12-25 (ID 12521486) | Κύπελλο Ελλάδος (Greece) S27 ≤2010-08-04; Κύπελλο Ελλάδος (Greece) S28 ≤2010-11-24 |
| jaryck1984 (12777070) | 2013-06-12 (ID 12746233) | 2013-03-07 (ID 12611998) | Dhivehi Raajje Cup (Maldives) S2 ≤2009-01-21 |
| Johanna1986 (12839924) | 2013-10-12 (ID 12838909) | 2013-10-10 (ID 12838205) | Copa Quisqueya (Dominican Republic) S20 ≤2010-04-14 |
| Rumbul (12921278) | 2013-10-27 (ID 12847900) | 2013-10-12 (ID 12838909) | Faroe Islands league S6 ≤2005-09-11 |
| gbetie (12941937) | 2013-10-27 (ID 12847900) | 2013-10-12 (ID 12838909) | Benin Cup (Benin) S4 ≤2009-01-21; Benin league S4 ≤2009-01-25 |
| Patry\_q (12949811) | 2013-10-27 (ID 12847900) | 2013-10-12 (ID 12838909) | Armenia league S1 ≤2006-01-01 |
| KoeKieBE (12952179) | 2013-10-27 (ID 12847900) | 2013-10-12 (ID 12838909) | Maldives league S5 ≤2009-12-27; Dhivehi Raajje Cup (Maldives) S6 ≤2010-04-14; Maldives league S6 ≤2010-04-18 |
| alestorry90 (13022599) | 2014-06-23 (ID 12972961) | 2013-10-27 (ID 12847900) | Pokal Slovenije (Slovenia) S19 ≤2008-06-11; Slovenia league S24 ≤2009-12-27; Slovenia league S32 ≤2012-06-10; Pokal Slovenije (Slovenia) S34 ≤2013-01-16 |
| mascaochoco (13031565) | 2014-06-23 (ID 12972961) | 2013-10-27 (ID 12847900) | Iceland league S1 ≤2002-01-06 |
| Neverstraight (13051885) | 2014-12-16 (ID 13049047) | 2014-11-18 (ID 13038309) | Coupe nationale (Côte d’Ivoire) S3 ≤2006-11-29; Côte d’Ivoire league S3 ≤2006-12-03; Coupe nationale (Côte d’Ivoire) S5 ≤2007-07-11; Côte d’Ivoire league S5 ≤2007-07-15; Coupe nationale (Côte d’Ivoire) S6 ≤2007-10-31; Côte d’Ivoire league S6 ≤2007-11-04 |
| ahmadir (13065200) | 2015-01-16 (ID 13059759) | 2014-12-16 (ID 13049047) | Maldives league S1 ≤2008-10-05 |
| ricky\_05 (13077190) | 2015-01-16 (ID 13059759) | 2014-12-16 (ID 13049047) | Copa del Istmo (Panama) S17 ≤2009-09-02; Copa del Istmo (Panama) S19 ≤2010-04-14; Copa del Istmo (Panama) S22 ≤2011-03-16; Copa del Istmo (Panama) S23 ≤2011-07-06; Panama league S26 ≤2012-06-10 |
| kasiete (13078700) | 2015-01-16 (ID 13059759) | 2014-12-16 (ID 13049047) | Copa Chile (Chile) S35 ≤2012-02-15 |
| paul\_sg (13080804) | 2015-01-16 (ID 13059759) | 2014-12-16 (ID 13049047) | Liechtenstein Cup (Liechtenstein) S15 ≤2010-04-14; Liechtenstein Cup (Liechtenstein) S28 ≤2014-04-09 |
| FCS-HB-22-Hanseatics (13094368) | 2015-01-16 (ID 13059759) | 2014-12-16 (ID 13049047) | Germany league S12 ≤2001-05-27 |
| Kasselhoff (13102463) | 2015-01-16 (ID 13059759) | 2014-12-16 (ID 13049047) | Ka'as Al-Sultan Qaboos (Oman) S16 ≤2011-10-26; Oman league S17 ≤2012-02-19; Oman league S18 ≤2012-06-10; Oman league S20 ≤2013-01-20; Oman league S21 ≤2013-05-12; Oman league S22 ≤2013-09-01; Ka'as Al-Sultan Qaboos (Oman) S23 ≤2013-12-18; Oman league S25 ≤2014-08-03 |
| tobias123456789 (13129610) | 2015-06-30 (ID 13129104) | 2015-01-16 (ID 13059759) | Benin league S1 ≤2008-02-24 |
| chrellef (13170490) | 2015-09-21 (ID 13159604) | 2015-09-20 (ID 13158992) | Bangladesh Cup (Bangladesh) S12 ≤2010-04-14; Bangladesh league S13 ≤2010-08-08; Bangladesh Cup (Bangladesh) S14 ≤2010-11-24; Bangladesh league S14 ≤2010-11-28; Bangladesh Cup (Bangladesh) S15 ≤2011-03-16; Bangladesh league S15 ≤2011-03-20; Bangladesh Cup (Bangladesh) S16 ≤2011-07-06 |
| diebohne (13175524) | 2015-10-24 (ID 13170561) | 2015-09-21 (ID 13159604) | Copa Safir d'Andorra (Andorra) S32 ≤2014-11-19 |
| pbonhom (13189882) | 2015-10-24 (ID 13170561) | 2015-09-21 (ID 13159604) | Dominican Republic league S18 ≤2009-09-06; Dominican Republic league S21 ≤2010-08-08; Copa Quisqueya (Dominican Republic) S22 ≤2010-11-24; Copa Quisqueya (Dominican Republic) S24 ≤2011-07-06; Dominican Republic league S24 ≤2011-07-10; Dominican Republic league S25 ≤2011-10-30 |
| JtgMilan (13190261) | 2015-10-24 (ID 13170561) | 2015-09-21 (ID 13159604) | Indonesia Cup (Indonesia) S4 ≤2003-07-16 |
| Knoxville\_89 (13192281) | 2015-10-24 (ID 13170561) | 2015-09-21 (ID 13159604) | Kyrgyzstan Ruby Challenger Cup (Kyrgyz Republic) S33 ≤2014-11-19 |
| DaPetro (13208650) | 2016-02-04 (ID 13202223) | 2016-02-03 (ID 13201762) | Copa Nacional de Cuba (Cuba) S9 ≤2013-12-18; Copa Nacional de Cuba (Cuba) S10 ≤2014-04-09 |
| nickhlaz (13219982) | 2016-02-04 (ID 13202223) | 2016-02-03 (ID 13201762) | Trøstecupen (Norway) S47 ≤2015-07-01 |
| Sektorista (13243387) | 2016-02-04 (ID 13202223) | 2016-02-03 (ID 13201762) | Czechia league S12 ≤2006-01-01; Czechia league S13 ≤2006-04-23 |
| fdojm (13272692) | 2016-07-07 (ID 13254260) | 2016-02-04 (ID 13202223) | Copa Nacional de México (Mexico) S52 ≤2013-08-28; Copa Nacional de México (Mexico) S54 ≤2014-04-09; Copa Zafiro Olmeca (Mexico) S56 ≤2014-11-19 |
| Charto23 (13282963) | 2016-09-20 (ID 13276581) | 2016-07-07 (ID 13254260) | Undercuppen (Denmark) S56 ≤2014-11-19 |
| Rosario\_Majella (13285632) | 2016-09-20 (ID 13276581) | 2016-07-07 (ID 13254260) | Coppa Italia (Italy) S15 ≤2002-04-24; Coppa Italia (Italy) S16 ≤2002-08-14 |
| ABogdan93 (13300750) | 2016-11-14 (ID 13293914) | 2016-09-20 (ID 13276581) | Romania league S8 ≤2003-11-09; Romania league S11 ≤2004-10-10 |
| aryan-2 (13311795) | 2016-12-24 (ID 13305646) | 2016-11-14 (ID 13293914) | Persian Gulf Cup (Iran) S39 ≤2016-02-10 |
| Rebellion30 (13319867) | 2016-12-24 (ID 13305646) | 2016-11-14 (ID 13293914) | Copa Zafiro Bulto (Costa Rica) S35 ≤2014-11-19 |
| fritz11 (13322506) | 2016-12-24 (ID 13305646) | 2016-11-14 (ID 13293914) | Ghana Consolation Cup (Ghana) S27 ≤2015-10-21 |
| YupiFC (13327941) | 2017-02-25 (ID 13324950) | 2016-12-24 (ID 13305646) | Copa Consuelo "Juan Alberto Schiaffino" (Uruguay) S48 ≤2016-02-10 |
| 4sp3r0x (13337582) | 2017-02-25 (ID 13324950) | 2016-12-24 (ID 13305646) | Copa de Cartón (Chile) S47 ≤2015-10-21 |
| youshanwushui (13341966) | 2017-05-02 (ID 13341869) | 2017-02-25 (ID 13324950) | China Cup (People's Republic of China) S12 ≤2005-01-26; China Cup (People's Republic of China) S13 ≤2005-05-18; People's Republic of China league S13 ≤2005-05-22; China Cup (People's Republic of China) S14 ≤2005-09-07; People's Republic of China league S14 ≤2005-09-11; China Cup (People's Republic of China) S15 ≤2005-12-28; People's Republic of China league S15 ≤2006-01-01; China Cup (People's Republic of China) S16 ≤2006-04-19; People's Republic of China league S16 ≤2006-04-23 |
| Calceatense (13343765) | 2017-05-02 (ID 13341869) | 2017-02-25 (ID 13324950) | Dominican Republic league S5 ≤2005-09-11 |
| Badhi65 (13348453) | 2017-05-02 (ID 13341869) | 2017-02-25 (ID 13324950) | Uzbekistan league S3 ≤2012-02-19; Uzbekistan league S10 ≤2014-04-13 |
| Tave76 (13352550) | 2017-05-02 (ID 13341869) | 2017-02-25 (ID 13324950) | Copa Consuelo Roba Oxígeno (Costa Rica) S38 ≤2015-10-21 |
| Garojh (13356038) | 2017-07-01 (own SignupDate) | 2017-05-02 (ID 13341869) | Hayastani gavat (Armenia) S11 ≤2009-01-21; Armenia league S13 ≤2009-09-06 |
| Giiii (13361730) | 2017-07-01 (ID 13356038) | 2017-05-02 (ID 13341869) | Coppa Bernina (Switzerland) S43 ≤2014-11-19 |
| OkRaT80 (13362258) | 2017-07-01 (ID 13356038) | 2017-05-02 (ID 13341869) | Scottish Cup (Scotland) S37 ≤2012-09-26 |
| ARA\_1987 (13368978) | 2017-07-01 (ID 13356038) | 2017-05-02 (ID 13341869) | Persian Gulf Cup (Iran) S5 ≤2005-09-07; Iran league S5 ≤2005-09-11; Iran league S6 ≤2006-01-01 |
| Mitev30 (13373671) | 2017-08-27 (ID 13372105) | 2017-07-01 (ID 13356038) | Куп на Македонија (North Macedonia) S19 ≤2010-04-14; North Macedonia league S19 ≤2010-04-18; Куп на Македонија (North Macedonia) S22 ≤2011-03-16; Куп на Македонија (North Macedonia) S28 ≤2013-01-16 |
| marcellq8 (13400499) | 2017-10-07 (ID 13383320) | 2017-08-27 (ID 13372105) | Kuwait league S17 ≤2011-07-10; Al Kuwayt Emir Cup (Kuwait) S21 ≤2012-09-26; Kuwait league S21 ≤2012-09-30 |
| arik1234 (13401439) | 2017-10-07 (ID 13383320) | 2017-08-27 (ID 13372105) | Israel State Cup (Israel) S31 ≤2012-02-15 |
| -Ercolino- (13401483) | 2017-10-07 (ID 13383320) | 2017-08-27 (ID 13372105) | Coupe Mousel (Luxembourg) S39 ≤2016-02-10 |
| tvinsi (13405583) | 2017-10-07 (ID 13383320) | 2017-08-27 (ID 13372105) | Íslandsbikarinn (Iceland) S47 ≤2016-02-10 |
| mauritio24 (13406489) | 2017-10-07 (ID 13383320) | 2017-08-27 (ID 13372105) | Taça de Consolação de Moçambique (Mozambique) S29 ≤2016-06-01 |
| stanley87 (13408947) | 2017-10-07 (ID 13383320) | 2017-08-27 (ID 13372105) | Pohár slezské orlice (Czechia) S47 ≤2016-09-21 |
| fabiompn (13410948) | 2017-10-07 (ID 13383320) | 2017-08-27 (ID 13372105) | Taça de Portugal (Portugal) S50 ≤2016-09-21 |
| plicploc76000 (13424284) | 2018-03-24 (ID 13419033) | 2018-02-26 (ID 13413709) | Coupe nationale (Côte d’Ivoire) S2 ≤2006-08-09 |
| lejonensbk (13426627) | 2018-03-24 (ID 13419033) | 2018-02-26 (ID 13413709) | Al Yaman Consolation Cup (Yemen) S32 ≤2016-09-21 |
| Maus11 (13428899) | 2018-03-24 (ID 13419033) | 2018-02-26 (ID 13413709) | Kup Bosne i Hercegovine (Bosnia and Herzegovina) S44 ≤2016-09-21 |
| liontaratos (13434473) | 2018-05-16 (ID 13430721) | 2018-03-24 (ID 13419033) | Jamaica Consolation Cup (Jamaica) S44 ≤2017-12-13 † |
| gamermitta (13436167) | 2018-05-16 (ID 13430721) | 2018-03-24 (ID 13419033) | KNVB Beker (Netherlands) S48 ≤2015-10-21 |
| dekreek88 (13437610) | 2018-05-16 (ID 13430721) | 2018-03-24 (ID 13419033) | Uganda Cup (Uganda) S6 ≤2010-04-14; Uganda league S10 ≤2011-07-10; Uganda league S11 ≤2011-10-30 |
| harle53 (13439149) | 2018-05-16 (ID 13430721) | 2018-03-24 (ID 13419033) | Taça de Mocambique (Mozambique) S11 ≤2010-11-24 |
| phoenixng (13441061) | 2018-05-16 (ID 13430721) | 2018-03-24 (ID 13419033) | Consolation Cup (People's Republic of China) S51 ≤2017-01-11 |
| Hellboyart (13444982) | 2018-05-16 (ID 13430721) | 2018-03-24 (ID 13419033) | Hayastani gavat (Armenia) S6 ≤2007-07-11; Armenia league S7 ≤2007-11-04; Hayastani gavat (Armenia) S8 ≤2008-02-20; Hayastan Consolation Cup (Armenia) S32 ≤2015-07-01 |
| Masternano (13449350) | 2018-05-16 (ID 13430721) | 2018-03-24 (ID 13419033) | El Salvador league S22 ≤2011-07-10 |
| kryptohaker (13450791) | 2018-05-16 (ID 13430721) | 2018-03-24 (ID 13419033) | Azərbaycan Yaqut Kuboku (Azerbaijan) S28 ≤2014-11-19 |
| Cronen84 (13457343) | 2018-05-16 (ID 13430721) | 2018-03-24 (ID 13419033) | Copa Zafiro Ronald Raldes (Bolivia) S36 ≤2014-11-19 |
| -Tonza- (13457616) | 2018-05-16 (ID 13430721) | 2018-03-24 (ID 13419033) | Suomen Cup (Finland) S29 ≤2006-08-09; Suomen Cup (Finland) S31 ≤2007-03-21 |
| Verde33 (13462038) | 2018-09-19 (ID 13459840) | 2018-05-16 (ID 13430721) | Copa Argentina Diego Armando Maradona (Argentina) S52 ≤2013-08-28; Copa Argentina Diego Armando Maradona (Argentina) S54 ≤2014-04-09; Copa Argentina Diego Armando Maradona (Argentina) S55 ≤2014-07-30 |
| raul2100 (13467553) | 2018-09-19 (ID 13459840) | 2018-05-16 (ID 13430721) | Schneeflucht-Cup (Liechtenstein) S41 ≤2018-04-04 † |
| Michusdz (13473226) | 2018-11-01 (ID 13468066) | 2018-11-01 (ID 13468062) | Íslandsbikarinn (Iceland) S22 ≤2008-06-11; Iceland league S22 ≤2008-06-15 |
| belsun2018 (13473527) | 2018-11-01 (ID 13468066) | 2018-11-01 (ID 13468062) | Consolante (Benin) S26 ≤2015-10-21 |
| -Rudy- (13481763) | 2018-11-01 (ID 13468066) | 2018-11-01 (ID 13468062) | Kenya Cup (Kenya) S1 ≤2004-10-06; Kenya league S1 ≤2004-10-10 |
| Maarten\_VM (13485378) | 2018-11-01 (ID 13468066) | 2018-11-01 (ID 13468062) | Belgium Ruby Challenger Cup (Belgium) S51 ≤2017-05-03 |
| Mirza2070 (13489471) | 2018-11-01 (ID 13468066) | 2018-11-01 (ID 13468062) | Kup gubitnika kupova Bosne i Hercegovine (Bosnia and Herzegovina) S48 ≤2017-12-13 |
| Peludo\_churu (13490183) | 2018-11-01 (ID 13468066) | 2018-11-01 (ID 13468062) | Copa Argentina Diego Armando Maradona (Argentina) S30 ≤2006-11-29 |
| levissim0 (13497218) | 2018-11-01 (ID 13468066) | 2018-11-01 (ID 13468062) | Dominican Republic league S2 ≤2004-10-10 |
| IvoBasay (13500960) | 2018-11-01 (ID 13468066) | 2018-11-01 (ID 13468062) | Copa Consolación Peor es nada (Honduras) S35 ≤2015-07-01 |
| Mokkeleka (13501705) | 2018-11-01 (ID 13468066) | 2018-11-01 (ID 13468062) | Suomen lohdutuscup (Finland) S58 ≤2015-07-01 |
| DeniSkor (13501849) | 2018-11-01 (ID 13468066) | 2018-11-01 (ID 13468062) | Кубок надежды (Russia) S51 ≤2017-01-11 |
| Pastu92 (13504065) | 2018-11-01 (ID 13468066) | 2018-11-01 (ID 13468062) | Copa Chile (Chile) S34 ≤2011-10-26; Chile league S35 ≤2012-02-19; Copa Chile (Chile) S36 ≤2012-06-06 |
| Merciki (13504766) | 2018-11-01 (ID 13468066) | 2018-11-01 (ID 13468062) | Kampuchea Emerald Challenger Cup (Cambodia) S31 ≤2017-01-11 |
| Mario\_74 (13506117) | 2018-11-01 (ID 13468066) | 2018-11-01 (ID 13468062) | Poland league S4 ≤2002-08-18 |
| Noravank (13511766) | 2019-04-09 (ID 13509862) | 2018-11-01 (ID 13468066) | Hayastani gavat (Armenia) S43 ≤2018-11-14 † |
| Santipona2019 (13518260) | 2019-04-09 (ID 13509862) | 2018-11-01 (ID 13468066) | Copa Uruguay (Uruguay) S42 ≤2014-04-09 |
| Donsirolff (13521065) | 2019-04-09 (ID 13509862) | 2018-11-01 (ID 13468066) | Ghana Ruby Challenger Cup (Ghana) S26 ≤2015-07-01 |
| Ellavorn (13527898) | 2019-04-09 (ID 13509862) | 2018-11-01 (ID 13468066) | Barbados league S29 ≤2014-11-23 |
| Kokovics81 (13528385) | 2019-04-09 (ID 13509862) | 2018-11-01 (ID 13468066) | Magyar Kupa (Hungary) S37 ≤2013-08-28 |
| frenk1970 (13532527) | 2019-07-13 (ID 13532476) | 2019-04-09 (ID 13509862) | Pokal Slovenije (Slovenia) S35 ≤2013-05-08; Cankarjev pokal (Slovenia) S42 ≤2015-07-01 |
| dabier97 (13533057) | 2019-07-13 (ID 13532476) | 2019-04-09 (ID 13509862) | Copa Desafío Esmeralda (Cuba) S13 ≤2015-03-11 |
| Furniz (13533594) | 2019-07-13 (ID 13532476) | 2019-04-09 (ID 13509862) | Rúbínbikar Íslands (Iceland) S45 ≤2015-07-01; Smaragðsbikar Íslands (Iceland) S50 ≤2017-01-11 |
| Flatthamser (13538350) | 2019-07-13 (ID 13532476) | 2019-04-09 (ID 13509862) | Kaas Al-Sheikh Zayed (United Arab Emirates) S23 ≤2011-03-16; Kaas Al-Sheikh Zayed (United Arab Emirates) S25 ≤2011-10-26 |
| tree\_s (13538534) | 2019-07-13 (ID 13532476) | 2019-04-09 (ID 13509862) | Canadian Cup (Canada) S45 ≤2015-03-11 |
| vadimon (13539055) | 2019-07-13 (ID 13532476) | 2019-04-09 (ID 13509862) | Israel league S3 ≤2003-07-20; Israel State Cup (Israel) S4 ≤2003-11-05; Israel league S5 ≤2004-02-29; Israel league S6 ≤2004-06-20; Israel State Cup (Israel) S7 ≤2004-10-06; Israel league S7 ≤2004-10-10; Israel league S8 ≤2005-01-30 |
| chevchenko (13542171) | 2019-08-22 (ID 13541758) | 2019-07-13 (ID 13532476) | Copa Nacional de Cuba (Cuba) S3 ≤2012-02-15; Cuba league S3 ≤2012-02-19 |
| drDjolers (13545623) | 2019-08-22 (ID 13541758) | 2019-07-13 (ID 13532476) | Куп српске заставе (Serbia) S44 ≤2015-10-21; Куп белог орла (Serbia) S52 ≤2018-04-04 |
| mrcambuurfan2 (13546339) | 2019-08-22 (ID 13541758) | 2019-07-13 (ID 13532476) | Puchar Dożynkowy (Poland) S49 ≤2016-06-01 |
| Scorpzgz (13549291) | 2019-08-22 (ID 13541758) | 2019-07-13 (ID 13532476) | Copa Consolación (Dominican Republic) S49 ≤2019-03-06 |
| Spinat73 (13554376) | 2019-08-22 (ID 13541758) | 2019-07-13 (ID 13532476) | Cape Verde league S27 ≤2014-04-13 |
| EWOLVES17 (13558300) | 2019-10-11 (ID 13557250) | 2019-10-10 (ID 13556691) | Ghana league S4 ≤2008-10-05 |
| Leonscorp (13558551) | 2019-10-11 (ID 13557250) | 2019-10-10 (ID 13556691) | Safiirkarikas (Estonia) S53 ≤2018-07-25 |
| klouzo (13574584) | 2019-10-11 (ID 13557250) | 2019-10-10 (ID 13556691) | Ζαφειρένιο Κύπελλο Ελλάδος (Greece) S46 ≤2016-06-01; Σμαραγδένιο Κύπελλο Ελλάδος (Greece) S52 ≤2018-04-04 |
| Aarka (13578633) | 2019-10-11 (ID 13557250) | 2019-10-10 (ID 13556691) | Uganda league S4 ≤2009-09-06; Uganda Cup (Uganda) S5 ≤2009-12-23 |
| boellinho (13579725) | 2019-10-11 (ID 13557250) | 2019-10-10 (ID 13556691) | Switzerland Cup (Switzerland) S34 ≤2012-02-15 |
| rauldidel (13580606) | 2019-10-11 (ID 13557250) | 2019-10-10 (ID 13556691) | Copa Desafío Rubí (Dominican Republic) S48 ≤2018-11-14 |
| Teipon (13602864) | 2020-01-30 (ID 13600491) | 2020-01-25 (ID 13598381) | Kenya Ruby Challenger Cup (Kenya) S45 ≤2018-04-04; Kenya Ruby Challenger Cup (Kenya) S49 ≤2019-06-26 |
| THEBIPO (13606614) | 2020-01-30 (ID 13600491) | 2020-01-25 (ID 13598381) | Copa Desafío Esmeralda (Dominican Republic) S36 ≤2015-03-11; Copa Desafío Rubí (Dominican Republic) S37 ≤2015-07-01 |
| Patron182 (13614882) | 2020-03-07 (ID 13613177) | 2020-02-21 (ID 13608481) | Copa Argentina Diego Armando Maradona (Argentina) S25 ≤2005-05-18 |
| CrookFox (13620665) | 2020-03-22 (ID 13618552) | 2020-03-18 (ID 13616686) | Oceania Emerald Challenger Cup (Oceania) S54 ≤2017-12-13; Oceanian Cup (Oceania) S55 ≤2018-04-04 |
| Ivanytskiy96 (13621281) | 2020-03-28 (ID 13620936) | 2020-03-22 (ID 13618552) | Кубок України (Ukraine) S49 ≤2018-04-04 |
| goseidos (13622879) | 2020-03-28 (ID 13620936) | 2020-03-22 (ID 13618552) | Tanzania Consolation Cup (Tanzania) S29 ≤2017-01-11 |
| seb061208 (13623280) | 2020-03-28 (ID 13620936) | 2020-03-22 (ID 13618552) | Belgium Ruby Challenger Cup (Belgium) S47 ≤2016-02-10 |
| Mascht1988 (13627158) | 2020-04-10 (ID 13625999) | 2020-03-28 (ID 13620936) | Barbados Emerald Challenger Cup (Barbados) S36 ≤2017-01-11 |
| andrisigari (13627609) | 2020-04-10 (ID 13625999) | 2020-03-28 (ID 13620936) | Magyar Kupa (Hungary) S5 ≤2003-11-05; Magyar Kupa (Hungary) S7 ≤2004-06-16; Bozsik József Ligakupa (Hungary) S43 ≤2015-07-01 |
| gr33nmachin3 (13633423) | 2020-04-10 (ID 13625999) | 2020-03-28 (ID 13620936) | Oceania Ruby Challenger Cup (Oceania) S46 ≤2015-07-01 |
| Ercolinovic (13634405) | 2020-04-10 (ID 13625999) | 2020-03-28 (ID 13620936) | Trophée Pantelis (France) S66 ≤2017-12-13 |
| Manager\_Arjuna (13640175) | 2020-05-09 (ID 13638794) | 2020-04-10 (ID 13625999) | Indonesia Cup (Indonesia) S13 ≤2006-04-19 |
| GardensBK (13647670) | 2020-05-21 (ID 13643349) | 2020-05-20 (ID 13642772) | Taça Challenger Esmeralda de Cabo Verde (Cape Verde) S30 ≤2015-03-11 |
| Taxista (13649438) | 2020-05-21 (ID 13643349) | 2020-05-20 (ID 13642772) | Cape Verde league S1 ≤2006-04-23 |
| Tomahawk- (13654163) | 2020-06-08 (ID 13651055) | 2020-05-21 (ID 13643349) | Coupe nationale (Côte d’Ivoire) S18 ≤2011-07-06; Coupe nationale (Côte d’Ivoire) S22 ≤2012-09-26; Trophée Rubis (Côte d’Ivoire) S31 ≤2015-07-01; Trophée Rubis (Côte d’Ivoire) S43 ≤2019-03-06 |
| Namtok (13655964) | 2020-06-28 (own SignupDate) | 2020-06-08 (ID 13651055) | Kampuchea Ruby Challenger Cup (Cambodia) S24 ≤2014-11-19; Kampuchea Emerald Challenger Cup (Cambodia) S28 ≤2016-02-10 |
| Diego2910 (13657897) | 2020-06-28 (ID 13655964) | 2020-06-08 (ID 13651055) | Copa Perú (Peru) S51 ≤2017-01-11; Copa Esmeralda Machu Picchu (Peru) S53 ≤2017-08-23 |
| Ivanhoe\_ (13657979) | 2020-06-28 (ID 13655964) | 2020-06-08 (ID 13651055) | Kup regija Bosne i Hercegovine (Bosnia and Herzegovina) S41 ≤2015-10-21 |
| PereHocquet (13661460) | 2020-06-28 (ID 13655964) | 2020-06-08 (ID 13651055) | Belgium Ruby Challenger Cup (Belgium) S44 ≤2015-03-11 |
| gambito88reload (13663511) | 2020-07-27 (ID 13663436) | 2020-06-28 (ID 13655964) | Mongol Uls Cup (Mongolia) S30 ≤2014-11-19; Mongolia league S31 ≤2015-03-15; Mongol Uls Ruby Challenger Cup (Mongolia) S33 ≤2015-10-21 |
| BoLoXs2386 (13663649) | 2020-07-27 (ID 13663436) | 2020-06-28 (ID 13655964) | Copa Barandiarán Piedra (Venezuela) S47 ≤2015-10-21 |
| Lois\_Amoros (13668070) | 2020-07-27 (ID 13663436) | 2020-06-28 (ID 13655964) | Trophée Marc-Vivien Foé (Cameroon) S25 ≤2018-11-14 |
| Tomi327 (13668384) | 2020-07-27 (ID 13663436) | 2020-06-28 (ID 13655964) | Puskás Ferenc Ligakupa (Hungary) S53 ≤2018-07-25 |
| BCEMXAHA (13669070) | 2020-07-27 (ID 13663436) | 2020-06-28 (ID 13655964) | Изумрудный кубок вызова (Russia) S54 ≤2017-12-13 |
| Natan4Fun (13671649) | 2020-08-26 (own SignupDate) | 2020-07-27 (ID 13663436) | Copa Nacional Rubén Darío (Nicaragua) S14 ≤2009-09-02; Copa Nacional Rubén Darío (Nicaragua) S16 ≤2010-04-14 |
| kclinzenberg (13672872) | 2020-08-26 (ID 13671649) | 2020-07-27 (ID 13663436) | Roter-Burgunder-Cup (Austria) S47 ≤2016-02-10 |
| Promus (13674543) | 2020-08-26 (ID 13671649) | 2020-07-27 (ID 13663436) | Liechtenstein Cup (Liechtenstein) S9 ≤2008-06-11; Liechtenstein league S18 ≤2011-03-20; Liechtenstein league S19 ≤2011-07-10; Liechtenstein league S21 ≤2012-02-19 |
| mateo\_matt (13685884) | 2020-09-12 (ID 13676869) | 2020-08-26 (ID 13671649) | Suriname league S7 ≤2007-07-15 |
| mitapop (13686178) | 2020-09-12 (ID 13676869) | 2020-08-26 (ID 13671649) | Куп српског грба (Serbia) S48 ≤2017-01-11 |
| Evros7 (13686712) | 2020-09-12 (ID 13676869) | 2020-08-26 (ID 13671649) | Greece league S9 ≤2005-01-30 |
| Malmzon (13689209) | 2020-10-20 (ID 13688022) | 2020-09-12 (ID 13676869) | Kyrgyzstan Cup (Kyrgyz Republic) S28 ≤2013-05-08 |
| frunzel2 (13692812) | 2020-10-25 (ID 13690390) | 2020-10-20 (ID 13688022) | Singapore Cup (Singapore) S13 ≤2005-09-07 |
| Colmaxter (13694427) | 2020-10-25 (ID 13690390) | 2020-10-20 (ID 13688022) | Oceanian Cup (Oceania) S33 ≤2011-07-06 |
| daro1717 (13695587) | 2020-10-25 (ID 13690390) | 2020-10-20 (ID 13688022) | Uganda Cup (Uganda) S7 ≤2010-08-04; Uganda Cup (Uganda) S10 ≤2011-07-06; Uganda Consolation Cup (Uganda) S35 ≤2019-03-06 |
| 21jose21 (13700014) | 2020-10-25 (ID 13690390) | 2020-10-20 (ID 13688022) | Philippine Football Federation Cup (Philippines) S31 ≤2011-10-26 |
| bermukha (13700758) | 2020-10-25 (ID 13690390) | 2020-10-20 (ID 13688022) | ბორის პაიჭაძის სახელობის თასი (Georgia) S40 ≤2017-05-03 |
| WalterHeinrich (13701898) | 2020-10-25 (ID 13690390) | 2020-10-20 (ID 13688022) | Curaçao Emerald Challenger Cup (Curaçao) S3 ≤2019-10-16 |
| Huenpe (13705428) | 2020-10-25 (ID 13690390) | 2020-10-20 (ID 13688022) | Copa Argentina Diego Armando Maradona (Argentina) S26 ≤2005-09-07 |
| andrewhta22 (13707742) | 2020-12-31 (ID 13707332) | 2020-10-25 (ID 13690390) | Barbados Cup (Barbados) S20 ≤2012-02-15; Barbados league S20 ≤2012-02-19 |
| 19pit87 (13708144) | 2020-12-31 (ID 13707332) | 2020-10-25 (ID 13690390) | Puchar Polski (Poland) S22 ≤2008-02-20 |
| RVBOmer (13715452) | 2021-01-18 (ID 13713061) | 2021-01-11 (ID 13711014) | Korea Consolation Cup (South Korea) S46 ≤2015-07-01 |
| May-Garcia (13722903) | 2021-01-18 (ID 13713061) | 2021-01-11 (ID 13711014) | Copa Consolación Sacuanjoche (Nicaragua) S34 ≤2015-10-21 |
| Anselmo65 (13722913) | 2021-01-18 (ID 13713061) | 2021-01-11 (ID 13711014) | São Tomé e Príncipe Sapphire Challenger Cup (São Tomé e Príncipe) S4 ≤2020-02-05 |
| Vuggy007 (13725305) | 2021-03-06 (ID 13724653) | 2021-03-05 (ID 13724491) | Copa Consuelo (Bolivia) S37 ≤2015-03-11; Copa Consuelo (Bolivia) S38 ≤2015-07-01 |
| DoniMcG (13726053) | 2021-03-06 (ID 13724653) | 2021-03-05 (ID 13724491) | Ireland Sapphire Challenger Cup (Ireland) S50 ≤2016-09-21 |
| Mintti (13726127) | 2021-03-06 (ID 13724653) | 2021-03-05 (ID 13724491) | Suomen lohdutuscup (Finland) S60 ≤2016-02-10 |
| Veneik13 (13726329) | 2021-03-06 (ID 13724653) | 2021-03-05 (ID 13724491) | Nigeria league S9 ≤2006-08-13; Nigerian League Cup (Nigeria) S10 ≤2006-11-29; Nigerian League Cup (Nigeria) S11 ≤2007-03-21; Nigeria league S11 ≤2007-03-25; Nigerian League Cup (Nigeria) S12 ≤2007-07-11; Nigeria league S12 ≤2007-07-15; Nigerian League Cup (Nigeria) S13 ≤2007-10-31; Nigeria league S13 ≤2007-11-04; Nigerian League Cup (Nigeria) S14 ≤2008-02-20; Nigeria league S14 ≤2008-02-24; Nigerian League Cup (Nigeria) S15 ≤2008-06-11; Nigeria league S15 ≤2008-06-15; Nigerian League Cup (Nigeria) S16 ≤2008-10-01; Nigeria league S16 ≤2008-10-05; Nigerian League Cup (Nigeria) S17 ≤2009-01-21; Nigeria league S17 ≤2009-01-25; Nigerian League Cup (Nigeria) S18 ≤2009-05-13; Nigeria league S18 ≤2009-05-17; Nigerian League Cup (Nigeria) S19 ≤2009-09-02; Nigeria league S19 ≤2009-09-06; Nigeria league S20 ≤2009-12-27; Nigeria league S21 ≤2010-04-18; Nigerian League Cup (Nigeria) S22 ≤2010-08-04; Nigeria league S22 ≤2010-08-08; Nigeria league S23 ≤2010-11-28; Nigeria league S24 ≤2011-03-20; Nigerian League Cup (Nigeria) S25 ≤2011-07-06; Nigeria league S25 ≤2011-07-10; Nigeria Emerald Challenger Cup (Nigeria) S36 ≤2014-11-19 |
| paris\_nyx (13727676) | 2021-03-06 (ID 13724653) | 2021-03-05 (ID 13724491) | Κύπελλο Τιμής Ελλάδος (Greece) S58 ≤2020-02-05 |
| topumt (13728189) | 2021-03-06 (ID 13724653) | 2021-03-05 (ID 13724491) | Copa Consolación Sacuanjoche (Nicaragua) S38 ≤2017-01-11 |
| Jona23db (13729740) | 2021-03-06 (ID 13724653) | 2021-03-05 (ID 13724491) | Coupe Bofferding (Luxembourg) S41 ≤2016-09-21 |
| 404\_Error (13740529) | 2021-04-01 (ID 13730718) | 2021-03-06 (ID 13724653) | Κύπελλο Τιμής Ελλάδος (Greece) S41 ≤2014-11-19 |
| emadureira (13741798) | 2021-04-01 (ID 13730718) | 2021-03-06 (ID 13724653) | Taça de Angola (Angola) S35 ≤2017-05-03; Taça Challenger Esmeralda de Angola (Angola) S36 ≤2017-08-23 |
| ingvarbrix (13741874) | 2021-04-01 (ID 13730718) | 2021-03-06 (ID 13724653) | Croatia league S6 ≤2004-02-29; Croatia league S8 ≤2004-10-10; Croatia league S11 ≤2005-09-11; Croatia league S12 ≤2006-01-01; Croatia league S13 ≤2006-04-23; Croatia league S14 ≤2006-08-13; Kup Hrvatske (Croatia) S16 ≤2007-03-21; Croatia league S19 ≤2008-02-24 |
| Honzavavra9 (13741992) | 2021-04-01 (ID 13730718) | 2021-03-06 (ID 13724653) | Nitwittův pohár českého lva (Czechia) S55 ≤2019-03-06 |
| kizawski (13742349) | 2021-04-01 (ID 13730718) | 2021-03-06 (ID 13724653) | Copa Quisqueya (Dominican Republic) S27 ≤2012-06-06 |
| retwro (13743376) | 2021-04-01 (ID 13730718) | 2021-03-06 (ID 13724653) | Troosttrofee (Suriname) S35 ≤2016-02-10 |
| Lionel-OH (13747387) | 2021-06-12 (ID 13746989) | 2021-05-31 (ID 13744861) | Belize league S1 ≤2020-09-20; Belize league S2 ≤2021-01-10 |
| Kisbasket (13752074) | 2021-06-12 (ID 13746989) | 2021-05-31 (ID 13744861) | Vigaszág Kupa (Hungary) S48 ≤2017-01-11 |
| Michaelsson (13753011) | 2021-06-12 (ID 13746989) | 2021-05-31 (ID 13744861) | Oceania Emerald Challenger Cup (Oceania) S52 ≤2017-05-03; Oceania Emerald Challenger Cup (Oceania) S53 ≤2017-08-23 |
| MateMilan07 (13753517) | 2021-06-12 (ID 13746989) | 2021-05-31 (ID 13744861) | Magyar Kupa (Hungary) S4 ≤2003-07-16 |
| Klamott (13759471) | 2021-07-12 (ID 13754231) | 2021-07-11 (ID 13753823) | Liechtenstein Cup (Liechtenstein) S1 ≤2005-12-28 |
| salavecis (13761229) | 2021-07-12 (ID 13754231) | 2021-07-11 (ID 13753823) | Daugavas kauss (Latvia) S42 ≤2015-03-11; Lubāna kauss (Latvia) S43 ≤2015-07-01 |
| c4st1 (13762086) | 2021-07-12 (ID 13754231) | 2021-07-11 (ID 13753823) | Copa Safira (Brazil) S54 ≤2017-12-13 |
| TUN4-os (13763853) | 2021-07-12 (ID 13754231) | 2021-07-11 (ID 13753823) | Kup sjećanja - TimonZ (Croatia) S43 ≤2015-07-01 |
| RJDeans (13769723) | 2021-07-12 (ID 13754231) | 2021-07-11 (ID 13753823) | Copa Presidente (El Salvador) S16 ≤2009-09-02 |
| Authentik71 (13772357) | 2021-07-12 (ID 13754231) | 2021-07-11 (ID 13753823) | Democratic Republic of the Congo league S1 ≤2020-02-09 |
| HectorTameem (13773700) | 2021-07-12 (ID 13754231) | 2021-07-11 (ID 13753823) | Taça de Mocambique (Mozambique) S1 ≤2007-10-31; Taça de Mocambique (Mozambique) S2 ≤2008-02-20; Mozambique league S2 ≤2008-02-24; Mozambique league S3 ≤2008-06-15; Taça de Mocambique (Mozambique) S4 ≤2008-10-01; Mozambique league S4 ≤2008-10-05; Taça de Mocambique (Mozambique) S5 ≤2009-01-21; Mozambique league S5 ≤2009-01-25; Mozambique league S9 ≤2010-04-18; Mozambique league S10 ≤2010-08-08 |
| BertrandJoal (13777693) | 2021-07-12 (ID 13754231) | 2021-07-11 (ID 13753823) | Trophée Rubis (France) S63 ≤2017-01-11 |
| amorbello (13778416) | 2021-07-12 (ID 13754231) | 2021-07-11 (ID 13753823) | Copa Chile (Chile) S48 ≤2016-02-10 |
| s\_paul82 (13779332) | 2021-07-12 (ID 13754231) | 2021-07-11 (ID 13753823) | Nicaragua league S26 ≤2013-05-12; Copa Nacional Rubén Darío (Nicaragua) S27 ≤2013-08-28; Copa Nacional Rubén Darío (Nicaragua) S28 ≤2013-12-18; Copa Nacional Rubén Darío (Nicaragua) S29 ≤2014-04-09; Nicaragua league S30 ≤2014-08-03; Copa Nacional Rubén Darío (Nicaragua) S31 ≤2014-11-19 |
| UnitedPuxo (13782336) | 2021-07-12 (ID 13754231) | 2021-07-11 (ID 13753823) | Copa Rubí (Spain) S52 ≤2017-05-03 |
| UncleAlbert (13782554) | 2021-07-12 (ID 13754231) | 2021-07-11 (ID 13753823) | Safirni kup (Croatia) S59 ≤2020-05-27 |
| matucariolo (13785797) | 2021-07-12 (ID 13754231) | 2021-07-11 (ID 13753823) | Copa Rubí La Negrita (Costa Rica) S38 ≤2015-10-21 |
| GaloGaloGalo (13793486) | 2021-07-12 (ID 13754231) | 2021-07-11 (ID 13753823) | Copa Safira (Brazil) S45 ≤2015-03-11 |
| Midlajz (13800579) | 2021-12-06 (ID 13799754) | 2021-07-12 (ID 13754231) | Smaragdový pohár (Slovakia) S40 ≤2015-07-01 |
| Ferrerinhooo (13801819) | 2021-12-06 (ID 13799754) | 2021-07-12 (ID 13754231) | Coupe de France (France) S55 ≤2014-07-30 |
| DerCoach72 (13802849) | 2021-12-06 (ID 13799754) | 2021-07-12 (ID 13754231) | Oceania Sapphire Challenger Cup (Oceania) S55 ≤2018-04-04 |
| Grishtiano (13802895) | 2021-12-06 (ID 13799754) | 2021-07-12 (ID 13754231) | Coupe Bofferding (Luxembourg) S45 ≤2017-12-13; Coupe de Luxembourg (Luxembourg) S46 ≤2018-04-04 |
| Sabhas (13803156) | 2021-12-06 (ID 13799754) | 2021-07-12 (ID 13754231) | St Vincent & Grenadines Cup (Saint Vincent and the Grenadines) S1 ≤2020-09-16; St Vincent & Grenadines Ruby Challenger Cup (Saint Vincent and the Grenadines) S3 ≤2021-04-28 † |
| KamBou4 (13805345) | 2021-12-06 (ID 13799754) | 2021-07-12 (ID 13754231) | Český pohár (Czechia) S10 ≤2005-05-18 |
| danimellow84 (13806679) | 2021-12-06 (ID 13799754) | 2021-07-12 (ID 13754231) | Taça de Mocambique (Mozambique) S29 ≤2016-06-01; Taça Challenger Esmeralda de Moçambique (Mozambique) S31 ≤2017-01-11; Taça de Mocambique (Mozambique) S32 ≤2017-05-03; Taça de Mocambique (Mozambique) S33 ≤2017-08-23 |
| MrRemo (13808860) | 2021-12-06 (ID 13799754) | 2021-07-12 (ID 13754231) | Puerto Rico Emerald Challenger Cup (Puerto Rico) S2 ≤2021-04-28 † |
| deijii (13810761) | 2021-12-06 (ID 13799754) | 2021-07-12 (ID 13754231) | Copa Rubí (Spain) S49 ≤2016-06-01; Copa Esmeralda (Spain) S50 ≤2016-09-21 |
| Shinthant (13810980) | 2021-12-06 (ID 13799754) | 2021-07-12 (ID 13754231) | Myanmar league S1 ≤2021-01-10 |
| AlenBHS (13811852) | 2021-12-06 (ID 13799754) | 2021-07-12 (ID 13754231) | Maple Cup (Canada) S61 ≤2020-02-05; Maple Cup (Canada) S64 ≤2021-01-06 |
| Simo946 (13817857) | 2022-02-10 (ID 13817655) | 2021-12-06 (ID 13799754) | Copa Consolación Sacuanjoche (Nicaragua) S44 ≤2018-11-14 |
| Babao06 (13818975) | 2022-02-10 (ID 13817655) | 2021-12-06 (ID 13799754) | Brazil league S2 ≤2002-01-06 |
| paraKapara (13821410) | 2022-02-10 (ID 13817655) | 2021-12-06 (ID 13799754) | Kampuchea Emerald Challenger Cup (Cambodia) S30 ≤2016-09-21 |
| Vicky\_AC (13823685) | 2022-02-10 (ID 13817655) | 2021-12-06 (ID 13799754) | Dominican Republic league S4 ≤2005-05-22; Copa Quisqueya (Dominican Republic) S5 ≤2005-09-07; Copa Quisqueya (Dominican Republic) S6 ≤2005-12-28; Dominican Republic league S6 ≤2006-01-01; Dominican Republic league S7 ≤2006-04-23; Copa Quisqueya (Dominican Republic) S8 ≤2006-08-09; Dominican Republic league S9 ≤2006-12-03 |
| mrinc45 (13827291) | 2022-02-10 (ID 13817655) | 2021-12-06 (ID 13799754) | Kup sjećanja - TimonZ (Croatia) S54 ≤2018-11-14 |
| ferencsics (13867884) | 2022-02-10 (ID 13817655) | 2021-12-06 (ID 13799754) | Hidegkuti Nándor Ligakupa (Hungary) S42 ≤2015-03-11 |
| EdoContreras (13875472) | 2022-02-10 (ID 13817655) | 2021-12-06 (ID 13799754) | Copa Zafiro Olmeca (Mexico) S71 ≤2019-06-26; Copa Rubí Azteca (Mexico) S72 ≤2019-10-16 |
| miss00 (13875990) | 2022-02-10 (ID 13817655) | 2021-12-06 (ID 13799754) | Zafírový pohár (Slovakia) S58 ≤2021-01-06 |
| dolmando (13876287) | 2022-02-10 (ID 13817655) | 2021-12-06 (ID 13799754) | Copa Argentina Diego Armando Maradona (Argentina) S32 ≤2007-07-11 |
| elbetouio (13879885) | 2022-02-10 (ID 13817655) | 2021-12-06 (ID 13799754) | Copa Desafío Zafiro (Ecuador) S37 ≤2015-03-11; Copa Consuelo (Ecuador) S56 ≤2021-01-06 |
| Suavimani (13883044) | 2022-02-10 (ID 13817655) | 2021-12-06 (ID 13799754) | Schneeflucht-Cup (Liechtenstein) S46 ≤2019-10-16 |
| Serious18 (13883080) | 2022-02-10 (ID 13817655) | 2021-12-06 (ID 13799754) | Myanmar league S2 ≤2021-05-02; Myanmar league S3 ≤2021-08-22 † |
| Yourmom (13883783) | 2022-02-10 (ID 13817655) | 2021-12-06 (ID 13799754) | Puerto Rico league S2 ≤2021-05-02 |
| mr\_Sh\_Holmes (13889656) | 2022-05-31 (ID 13889291) | 2022-02-10 (ID 13817655) | Kazakhstan Sapphire Challenger Cup (Kazakhstan) S39 ≤2017-05-03; Kazakhstan Sapphire Challenger Cup (Kazakhstan) S45 ≤2019-03-06 |
| Globaler (13895678) | 2022-06-02 (ID 13890095) | 2022-05-31 (ID 13889291) | Coppa Italia (Italy) S36 ≤2008-10-01 |
| marlin\_borow (13895733) | 2022-06-02 (ID 13890095) | 2022-05-31 (ID 13889291) | Copa del Istmo (Panama) S32 ≤2014-04-09 |
| Chalita389 (13899123) | 2022-06-02 (ID 13890095) | 2022-05-31 (ID 13889291) | Thailand league S3 ≤2002-04-28 |
| etto\_\_ (13903239) | 2022-06-02 (ID 13890095) | 2022-05-31 (ID 13889291) | Deutschland-Pokal (Germany) S64 ≤2017-05-03 |
| Chrisy86 (13903281) | 2022-06-02 (ID 13890095) | 2022-05-31 (ID 13889291) | Saltire Cup (Scotland) S44 ≤2014-11-19 |
| K2Gingarelho (13903981) | 2022-06-02 (ID 13890095) | 2022-05-31 (ID 13889291) | Taça de Portugal (Portugal) S40 ≤2013-08-28 |
| dalepopp (13904321) | 2022-06-02 (ID 13890095) | 2022-05-31 (ID 13889291) | Northern Ireland Consolation Cup (Northern Ireland) S48 ≤2019-03-06 |
| Thiou21 (13904364) | 2022-06-02 (ID 13890095) | 2022-05-31 (ID 13889291) | Σμαραγδένιο Κύπελλο Ελλάδος (Greece) S53 ≤2018-07-25 |
| Majkmore (13904654) | 2022-06-02 (ID 13890095) | 2022-05-31 (ID 13889291) | Smaragdový pohár (Slovakia) S55 ≤2020-02-05 |
| RoefeFringer (13905703) | 2022-06-02 (ID 13890095) | 2022-05-31 (ID 13889291) | Uganda Cup (Uganda) S16 ≤2013-05-08; Uganda Cup (Uganda) S18 ≤2013-12-18 |
| EddyS1 (13911067) | 2022-06-02 (ID 13890095) | 2022-05-31 (ID 13889291) | Robijnen Beker (Netherlands) S64 ≤2020-09-16 |
| TheEmir (13911475) | 2022-06-02 (ID 13890095) | 2022-05-31 (ID 13889291) | Rubincupen (Sweden) S64 ≤2017-05-03 |
| ByFx211 (13913175) | 2022-06-02 (ID 13890095) | 2022-05-31 (ID 13889291) | Mozambique league S1 ≤2007-11-04 |
| FCDuif (13915778) | 2022-06-02 (ID 13890095) | 2022-05-31 (ID 13889291) | Spek-en-Bonenschaal (Netherlands) S57 ≤2018-07-25 |
| ShinySuit (13916271) | 2022-06-02 (ID 13890095) | 2022-05-31 (ID 13889291) | Curaçao Consolation Cup (Curaçao) S10 ≤2021-12-08 |
| Franobili (13916715) | 2022-10-02 (ID 13916356) | 2022-06-02 (ID 13890095) | Smaragdni kup (Croatia) S47 ≤2016-09-21 |
| Pegasus22 (13918485) | 2022-10-02 (ID 13916356) | 2022-06-02 (ID 13890095) | Royal Cup (Canada) S56 ≤2018-07-25 |
| kzk90 (13922205) | 2022-10-15 (ID 13918755) | 2022-10-02 (ID 13916356) | Kazakhstan Cup (Kazakhstan) S16 ≤2010-04-14 |
| Kochmar (13923258) | 2022-10-15 (ID 13918755) | 2022-10-02 (ID 13916356) | Кубок Двору (Ukraine) S52 ≤2019-03-06 |
| Hutchers (13924042) | 2022-10-15 (ID 13918755) | 2022-10-02 (ID 13916356) | St Vincent & Grenadines Consolation Cup (Saint Vincent and the Grenadines) S4 ≤2021-08-18 |
| Kentvic (13925785) | 2022-10-15 (ID 13918755) | 2022-10-02 (ID 13916356) | Куп нада Србије (Serbia) S51 ≤2017-12-13 |
| BobTheHermit (13926581) | 2022-10-15 (ID 13918755) | 2022-10-02 (ID 13916356) | Coppa Alpi (Italy) S61 ≤2016-06-01 |
| LabrosP (13927346) | 2022-10-15 (ID 13918755) | 2022-10-02 (ID 13916356) | Ρουμπινένιο Κύπελλο Ελλάδος (Greece) S43 ≤2015-07-01; Κύπελλο Ελλάδος (Greece) S45 ≤2016-02-10 |
| Darbarz (13928310) | 2022-10-15 (ID 13918755) | 2022-10-02 (ID 13916356) | Taça Nacional de São Tomé e Príncipe (São Tomé e Príncipe) S3 ≤2019-10-16; São Tomé e Príncipe Emerald Challenger Cup (São Tomé e Príncipe) S5 ≤2020-05-27; São Tomé e Príncipe league S7 ≤2021-01-10; São Tomé e Príncipe league S8 ≤2021-05-02; São Tomé e Príncipe league S9 ≤2021-08-22; São Tomé e Príncipe league S10 ≤2021-12-12 |
| Darkry (13932749) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | India Sapphire Challenger Cup (India) S65 ≤2021-04-28 |
| Naldoohhhh (13933795) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Oceania Emerald Challenger Cup (Oceania) S63 ≤2020-09-16 |
| Ekvivalents (13934143) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Sprīdīša kauss (Latvia) S51 ≤2017-12-13 |
| Hejhakala (13935925) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Harmbikar Íslands (Iceland) S58 ≤2019-06-26 |
| Antzmann (13936498) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Jamaica Sapphire Challenger Cup (Jamaica) S35 ≤2015-03-11; Jamaica Ruby Challenger Cup (Jamaica) S57 ≤2021-12-08 |
| muxix (13939593) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Liechtenstein Cup (Liechtenstein) S43 ≤2018-11-14; Liechtenstein Cup (Liechtenstein) S45 ≤2019-06-26; Liechtenstein Cup (Liechtenstein) S46 ≤2019-10-16 |
| currahee18 (13940263) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Slovenský pohár (Slovakia) S33 ≤2013-05-08 |
| MrPer (13940368) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Svenska Cupen (Sweden) S51 ≤2013-05-08; Rubincupen (Sweden) S57 ≤2015-03-11 |
| EZEKIELX (13940844) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Türkiye Kupası (Turkey) S53 ≤2017-08-23 |
| Bomblin (13942521) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Puchar Polski (Poland) S37 ≤2012-09-26 |
| TireedClimber (13945087) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Kenya Consolation Cup (Kenya) S34 ≤2014-11-19; Kenya Consolation Cup (Kenya) S56 ≤2021-08-18 |
| Bimber9999 (13949371) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Szafirowy Puchar Drugiej Szansy (Poland) S48 ≤2016-02-10 |
| Adrianrtf (13949381) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Puchar Polski (Poland) S20 ≤2007-07-11 |
| tommy4440 (13951351) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Coupe de France (France) S70 ≤2019-03-06 |
| jb37600 (13952753) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Dawlat Qatar Consolation Cup (Qatar) S24 ≤2015-07-01 |
| Ruslebiffen (13954360) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Norgesmesterskapet (Norway) S29 ≤2009-12-23 |
| Hidyk (13954713) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Nitwittův pohár českého lva (Czechia) S54 ≤2018-11-14 |
| SeniorPink (13955174) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Copa Nacional de México (Mexico) S43 ≤2010-11-24 |
| nodar321 (13959170) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Gold Coast Cup (Ghana) S1 ≤2007-10-31; Gold Coast Cup (Ghana) S2 ≤2008-02-20; Ghana league S2 ≤2008-02-24; Gold Coast Cup (Ghana) S3 ≤2008-06-11; Ghana league S3 ≤2008-06-15; Gold Coast Cup (Ghana) S4 ≤2008-10-01; Gold Coast Cup (Ghana) S5 ≤2009-01-21; Ghana league S5 ≤2009-01-25; Gold Coast Cup (Ghana) S6 ≤2009-05-13; Ghana league S6 ≤2009-05-17; Gold Coast Cup (Ghana) S7 ≤2009-09-02; Ghana league S7 ≤2009-09-06; Ghana league S8 ≤2009-12-27; Gold Coast Cup (Ghana) S9 ≤2010-04-14; Ghana league S9 ≤2010-04-18; Gold Coast Cup (Ghana) S10 ≤2010-08-04; Ghana league S10 ≤2010-08-08; Gold Coast Cup (Ghana) S11 ≤2010-11-24; Ghana league S11 ≤2010-11-28; Gold Coast Cup (Ghana) S12 ≤2011-03-16; Ghana league S12 ≤2011-03-20; Gold Coast Cup (Ghana) S13 ≤2011-07-06; Ghana league S13 ≤2011-07-10; Ghana Consolation Cup (Ghana) S42 ≤2020-05-27 |
| 194491 (13960166) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Szafirowy Puchar Drugiej Szansy (Poland) S46 ≤2015-07-01 |
| rvila10 (13962644) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Copa Rubí Azteca (Mexico) S76 ≤2021-01-06; Copa Esmeralda Maya (Mexico) S78 ≤2021-08-18 |
| MikalNordli (13963255) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Norgesmesterskapet (Norway) S65 ≤2021-01-06 |
| SantiJoao (13964578) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Coupe Simon (Luxembourg) S37 ≤2015-07-01 |
| HH7891 (13966583) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Oceania Consolation Cup (Oceania) S49 ≤2016-06-01 |
| Kennykent (13968113) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Íslandsbikarinn (Iceland) S26 ≤2009-09-02 |
| bpstyles (13970882) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | US Open Cup (USA) S36 ≤2008-10-01 |
| Xuxu79 (13972328) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Al Kuwayt Sapphire Challenger Cup (Kuwait) S35 ≤2017-01-11; Al Kuwayt Sapphire Challenger Cup (Kuwait) S40 ≤2018-07-25; Al Kuwayt Sapphire Challenger Cup (Kuwait) S41 ≤2018-11-14 |
| Rexxy (13974130) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Kazakhstan Cup (Kazakhstan) S2 ≤2005-12-28; Kazakhstan league S2 ≤2006-01-01; Kazakhstan league S3 ≤2006-04-23; Kazakhstan Cup (Kazakhstan) S4 ≤2006-08-09 |
| RogerNS (13977266) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Copa de Consolació d'Andorra (Andorra) S45 ≤2018-11-14; Copa de Consolació d'Andorra (Andorra) S52 ≤2021-01-06 |
| MaikWest91 (13978157) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Tröstcupen (Sweden) S64 ≤2017-05-03 |
| marco1b (13978269) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Täli-Cup (Liechtenstein) S35 ≤2016-06-01; Sareis-Cup (Liechtenstein) S38 ≤2017-05-03; Täli-Cup (Liechtenstein) S40 ≤2017-12-13; Sareis-Cup (Liechtenstein) S53 ≤2021-12-08; Hochegg-Cup (Liechtenstein) S54 ≤2022-03-30 |
| Foottie (13978819) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Smaragden Beker (Netherlands) S48 ≤2015-10-21 |
| Pro\_Luca (13979142) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Golden Cervelat Cup (Switzerland) S44 ≤2015-03-11 |
| dalila24 (13979828) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Taça Challenger Esmeralda de Portugal (Portugal) S46 ≤2015-07-01 |
| Sistematic\_80 (13980411) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Copa Julio de Pablos Caño Zafiro (Chile) S47 ≤2015-10-21 |
| Chelseafootballclub (13980467) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | English Cup (England) S27 ≤2005-12-28; England league S27 ≤2006-01-01 |
| Borges313 (13980951) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Tröstcupen (Sweden) S58 ≤2015-07-01; Rubincupen (Sweden) S67 ≤2018-04-04 |
| MaestroDelHT (13981329) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Copa Desafío Rubí (Ecuador) S47 ≤2018-04-04 |
| LA-Sor3na (13984052) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Northern Ireland Consolation Cup (Northern Ireland) S55 ≤2021-04-28; Northern Ireland Consolation Cup (Northern Ireland) S58 ≤2022-03-30 |
| Aleixito01 (13984908) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Andorra league S1 ≤2005-05-22 |
| GeoffreyMwila (13985157) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Zambia league S1 ≤2021-01-10 |
| godsp (13985743) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Nigeria league S1 ≤2004-02-29 |
| buccilatino (13985892) | 2022-11-30 (ID 13931362) | 2022-10-15 (ID 13918755) | Coppa del Nonno (Italy) S60 ≤2016-02-10 |
| Foensi82 (13998889) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Gotthard Cup (Switzerland) S44 ≤2015-03-11 |
| cruxcrux (14003925) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Ireland Consolation Cup (Ireland) S56 ≤2018-07-25 |
| AFKostas (14005137) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Uganda Consolation Cup (Uganda) S22 ≤2015-03-11 |
| academicsugar (14008699) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Harmbikar Íslands (Iceland) S46 ≤2015-10-21; Harmbikar Íslands (Iceland) S69 ≤2022-11-09 |
| priusdriver (14008706) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Deutschland-Pokal (Germany) S67 ≤2018-04-04 |
| Masiukaiser (14009918) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Copa Zafiro (Spain) S51 ≤2017-01-11 |
| MixcoBull (14010435) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Guatemala league S1 ≤2005-05-22 |
| mayibongwe01 (14011148) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | South Africa league S1 ≤2001-09-16 |
| immy1 (14011893) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Uganda league S1 ≤2008-10-05 |
| TEMESGEN (14012728) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Federal Democratic Republic of Ethiopia league S1 ≤2020-02-09 |
| igorvg (14013247) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Copa Consolación (Spain) S44 ≤2014-11-19 |
| DmCNero (14013318) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Copa Desafío Rubí (Cuba) S31 ≤2020-09-16 |
| Mayumi\_ (14014088) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Copa Perú (Peru) S36 ≤2012-06-06; Copa Perú (Peru) S39 ≤2013-05-08 |
| gicih (14014601) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Trofeul Carpaţi (Romania) S59 ≤2019-06-26 |
| Damiatronico (14014809) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Copa Ecuador (Ecuador) S1 ≤2004-02-25; Ecuador league S1 ≤2004-02-29 |
| Ve21Sa (14015074) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Copa Consuelo (Ecuador) S51 ≤2019-06-26 |
| strale22 (14015513) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Montenegro league S1 ≤2006-12-03 |
| DragonesNegros (14015978) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Copa Ecuador (Ecuador) S11 ≤2007-03-21 |
| Naddodd (14016939) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Íslandsbikarinn (Iceland) S23 ≤2008-10-01 |
| MilkyBoom (14018455) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Hayastan Consolation Cup (Armenia) S37 ≤2017-01-11; Hayastan Ruby Challenger Cup (Armenia) S51 ≤2021-04-28 |
| ptryk (14020787) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Puchar Polski (Poland) S36 ≤2012-06-06 |
| GM-Themasterman (14020846) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | SVB Beker (Suriname) S2 ≤2005-12-28; SVB Beker (Suriname) S3 ≤2006-04-19; Suriname league S4 ≤2006-08-13; SVB Beker (Suriname) S5 ≤2006-11-29; Suriname league S5 ≤2006-12-03; SVB Beker (Suriname) S6 ≤2007-03-21; Suriname league S6 ≤2007-03-25; SVB Beker (Suriname) S7 ≤2007-07-11; SVB Beker (Suriname) S9 ≤2008-02-20; Suriname league S10 ≤2008-06-15 |
| Bremer65 (14021809) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Rubin-Pokal (Germany) S57 ≤2015-03-11 |
| christianeqs (14022794) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Copa Esmeralda Maya (Mexico) S59 ≤2015-10-21 |
| 99Pass (14025055) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Coppa del Nonno (Italy) S71 ≤2019-06-26 |
| Dzhuk (14027892) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Българска купа на лигата (Изумруд) (Bulgaria) S45 ≤2016-06-01; Bulgaria league S46 ≤2016-09-25 |
| wizard72opet (14028291) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Куп српског грба (Serbia) S57 ≤2019-10-16 |
| Thina (14032014) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | South Africa Consolation Cup (South Africa) S50 ≤2016-09-21 |
| Mod-Dockumer (14035613) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Mongol Uls Cup (Mongolia) S27 ≤2013-12-18 |
| chris\_sen (14036592) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Consolante (France) S58 ≤2015-07-01 |
| Giwrgos21 (14038760) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Ζαφειρένιο Κύπελλο Ελλάδος (Greece) S64 ≤2021-12-08 |
| Sahebeh (14042020) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Palestine Consolation Cup (Palestine) S24 ≤2018-07-25 |
| Roman159 (14042144) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Smaragden Beker (Netherlands) S54 ≤2017-08-23 |
| MarceloBasurto (14042226) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Copa Esmeralda Maya (Mexico) S57 ≤2015-03-11; Copa Esmeralda Maya (Mexico) S70 ≤2019-03-06; Copa Rubí Azteca (Mexico) S71 ≤2019-06-26 |
| Zemute (14043241) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Baltijos taurė (Lithuania) S39 ≤2015-03-11 |
| Iphaeth (14045888) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Malaysia Ruby Challenger Cup (Malaysia) S43 ≤2014-11-19 |
| Behrooz\_R (14051410) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Pakistan Ruby Challenger Cup (Pakistan) S43 ≤2016-06-01 |
| IsaRut (14055180) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Tröstcupen (Sweden) S66 ≤2017-12-13 |
| Wesoly87 (14058691) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Szafirowy Puchar Drugiej Szansy (Poland) S47 ≤2015-10-21; Szafirowy Puchar Drugiej Szansy (Poland) S49 ≤2016-06-01 |
| trigger9 (14060236) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Baltijos taurė (Lithuania) S47 ≤2017-08-23 |
| MikuSuns27 (14060909) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Copa Consuelo "Juan Alberto Schiaffino" (Uruguay) S54 ≤2017-12-13 |
| Monzza79 (14062746) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Rubincupen (Sweden) S69 ≤2018-11-14 |
| hendra123 (14064185) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Indonesia league S2 ≤2002-12-08; Indonesia league S4 ≤2003-07-20; Indonesia league S5 ≤2003-11-09; Indonesia league S6 ≤2004-02-29; Indonesia league S7 ≤2004-06-20; Indonesia league S8 ≤2004-10-10; Indonesia league S9 ≤2005-01-30 |
| King\_Arni (14066279) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Saphir-Pokal (Germany) S77 ≤2021-04-28 |
| MirkoMatko (14069579) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Rubínový pohár (Slovakia) S43 ≤2016-06-01 |
| karolis11 (14072258) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Gintaro taurė (Lithuania) S62 ≤2022-03-30 |
| tony2274 (14076526) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Copa Esmeralda Maya (Mexico) S80 ≤2022-03-30 |
| seyhawk04 (14076577) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Hong Kong Cup (Hong Kong) S14 ≤2006-11-29 |
| PMELegends (14077282) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Switzerland Cup (Switzerland) S50 ≤2017-01-11 |
| slmshr (14077467) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Azərbaycan Təsəlli Kuboku (Azerbaijan) S53 ≤2022-07-20 |
| NicolasMatiFranco (14082187) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Copa Esmeralda "José Nasazzi" (Uruguay) S53 ≤2017-08-23 |
| Tincho1972 (14085647) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Copa Esmeralda Pedro 'Apache' Zurita (Argentina) S70 ≤2019-03-06; Copa Argentina Diego Armando Maradona (Argentina) S74 ≤2020-05-27 |
| OliverLY (14088575) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Copa Gran Jaguar (Guatemala) S11 ≤2008-06-11 |
| damianmanso95 (14096322) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Oceanian Cup (Oceania) S24 ≤2008-10-01 |
| MrWigum (14097552) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Ireland Emerald Challenger Cup (Ireland) S52 ≤2017-05-03 |
| Ezequiel301192 (14098163) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Copa Esmeralda "José Nasazzi" (Uruguay) S52 ≤2017-05-03 |
| Murillioonfire (14098272) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Deutschland-Pokal (Germany) S42 ≤2010-08-04 |
| Tuber0 (14099752) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Coppa Appennini (Italy) S63 ≤2017-01-11 |
| bercardi\_23 (14100998) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Yakut Kupası (Turkey) S53 ≤2017-08-23 |
| Trancos1981 (14102659) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Copa Rubí Marimba (Guatemala) S37 ≤2016-06-01 |
| DcBioo (14104112) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Kup sjećanja - TimonZ (Croatia) S52 ≤2018-04-04 |
| Wanie\_D (14104844) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | South Africa Consolation Cup (South Africa) S45 ≤2015-03-11 |
| zhan\_dos (14109811) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Kazakhstan Sapphire Challenger Cup (Kazakhstan) S40 ≤2017-08-23 |
| Dwellingnton93 (14116685) | 2023-06-28 (ID 13990671) | 2023-06-15 (ID 13986083) | Suomen lohdutuscup (Finland) S56 ≤2014-11-19; Suomen Joutsen-haastajacup (Finland) S61 ≤2016-06-01; Suomen Joutsen-haastajacup (Finland) S63 ≤2017-01-11; Suomen Karhu-haastajacup (Finland) S66 ≤2017-12-13 |

## Appendix B: review only (ID older than the account)

Not in the proposed corrections. The credited account's own `SignupDate` is after the title, but
the ID was issued before it.

| Credited manager | Title (latest possible date) | Account SignupDate | ID issued no earlier than |
| --- | --- | --- | --- |
| machlas (970104) | Taça de Mocambique (Mozambique) S7 ≤2009-09-02 | 2016-09-18 | 2004-02-02 (ID 956902) |
| machlas (970104) | Taça de Mocambique (Mozambique) S10 ≤2010-08-04 | 2016-09-18 | 2004-02-02 (ID 956902) |
| machlas (970104) | Mozambique league S12 ≤2011-03-20 | 2016-09-18 | 2004-02-02 (ID 956902) |
| machlas (970104) | Mozambique league S14 ≤2011-10-30 | 2016-09-18 | 2004-02-02 (ID 956902) |
| CUBAnec7 (2556908) | Kampuchea Consolation Cup (Cambodia) S28 ≤2016-02-10 | 2019-11-09 | 2005-03-17 (ID 2549099) |
| blight\_zero (2857550) | Uganda league S2 ≤2009-01-25 | 2017-05-02 | 2005-04-27 (ID 2732684) |
| blight\_zero (2857550) | Uganda league S3 ≤2009-05-17 | 2017-05-02 | 2005-04-27 (ID 2732684) |
| lionelbu (4907465) | O'zbekiston Kubogi (Uzbekistan) S17 ≤2016-06-01 | 2017-11-26 | 2006-07-05 (ID 4843099) |
| lionelbu (4907465) | Uzbekistan league S17 ≤2016-06-05 | 2017-11-26 | 2006-07-05 (ID 4843099) |
| lionelbu (4907465) | Uzbekistan league S18 ≤2016-09-25 | 2017-11-26 | 2006-07-05 (ID 4843099) |
| GM-Merfis (8997364) | Irish Cup (Ireland) S66 ≤2021-08-18 | 2026-09-14 | 2009-01-15 (ID 8929432) |
| GM-Merfis (8997364) | Copa Esmeralda (Brazil) S62 ≤2020-05-27 | 2026-09-14 | 2009-01-15 (ID 8929432) |
| GM-Merfis (8997364) | Ireland Sapphire Challenger Cup (Ireland) S80 ≤2025-12-03 | 2026-09-14 | 2009-01-15 (ID 8929432) |
| FurioGiunta (9943299) | Argentina league S61 ≤2016-06-05 | 2020-03-13 | 2009-09-06 (ID 9816045) |
| FurioGiunta (9943299) | Argentina league S65 ≤2017-08-27 | 2020-03-13 | 2009-09-06 (ID 9816045) |

## Appendix C: borderline (inside the safety margin)

Not flagged and not in the proposed corrections. The earliest possible account creation is 1–111
days after the latest possible title date.

| Credited manager | Title (latest possible date) | Account created no earlier than | Gap (days) |
| --- | --- | --- | ---: |
| teofilled (56755) | Venezuela league S2 ≤2002-01-06 | 2002-01-17 (ID 55874) | 11 |
| victorwoo (115986) | People's Republic of China league S2 ≤2002-01-06 | 2002-01-17 (ID 55874) | 11 |
| kungnen (116515) | Chile league S2 ≤2002-01-06 | 2002-01-17 (ID 55874) | 11 |
| edo\_maajka (946795) | Bosnia and Herzegovina league S2 ≤2003-11-09 | 2004-01-14 (ID 904733) | 66 |
| rxdude (1730221) | United Arab Emirates league S1 ≤2004-06-20 | 2004-08-25 (ID 1676803) | 66 |
| koukoull (1843137) | Cyprus league S1 ≤2004-06-20 | 2004-10-05 (ID 1837243) | 107 |
| Flaco185 (2638455) | Honduras league S1 ≤2005-01-30 | 2005-03-31 (ID 2607039) | 60 |
| virys (3545679) | Kazakhstan league S1 ≤2005-09-11 | 2005-09-30 (ID 3446090) | 19 |
| rottapoika (3717083) | Trinidad & Tobago league S1 ≤2005-09-11 | 2005-11-22 (ID 3703704) | 72 |
| black\_star (3756801) | Kyrgyz Republic league S3 ≤2005-09-11 | 2005-11-22 (ID 3703704) | 72 |
| Trasko (4248792) | Jordan league S3 ≤2006-01-01 | 2006-03-11 (ID 4224176) | 69 |
| Urs\_Parcat (5675845) | Al Iraq Cup (Iraq) S2 ≤2006-11-29 | 2006-12-14 (ID 5636220) | 15 |
| mek-js (6252130) | Íslandsbikarinn (Iceland) S18 ≤2007-03-21 | 2007-04-14 (ID 6234131) | 24 |
| mek-js (6252130) | Iceland league S18 ≤2007-03-25 | 2007-04-14 (ID 6234131) | 20 |
| GM-Shamil (7564618) | Azerbaijan league S5 ≤2007-11-04 | 2008-01-24 (ID 7545702) | 81 |
| DxHT-pawpol (8190906) | Guatemala league S10 ≤2008-02-24 | 2008-06-14 (ID 8148260) | 111 |
| Creynoso (8536378) | Nicaragua league S10 ≤2008-06-15 | 2008-08-29 (ID 8415845) | 75 |
| matrix34 (9115025) | Angola league S8 ≤2009-01-25 | 2009-02-01 (ID 9039027) | 7 |
| murphy38 (9165040) | Íslandsbikarinn (Iceland) S24 ≤2009-01-21 | 2009-02-21 (ID 9128728) | 31 |
| dkvucr (10094782) | Dhivehi Raajje Cup (Maldives) S4 ≤2009-09-02 | 2009-09-06 (ID 9816045) | 4 |
| Iginla (10217829) | Northern Ireland league S18 ≤2009-12-27 | 2010-01-03 (ID 10186882) | 7 |
| thediddler (10493212) | Scotland league S28 ≤2009-12-27 | 2010-02-27 (ID 10365330) | 62 |
| fabioune (10754296) | Montenegro league S12 ≤2010-04-18 | 2010-06-29 (ID 10735102) | 72 |
| ewbcst (10896775) | Bangladesh Cup (Bangladesh) S13 ≤2010-08-04 | 2010-08-22 (ID 10876689) | 18 |
| LA-lojzek91 (11497291) | Cape Verde league S17 ≤2011-03-20 | 2011-05-31 (ID 11478483) | 72 |
| vale112786 (11964765) | Tanzania Cup (Tanzania) S11 ≤2011-07-06 | 2011-09-23 (ID 11692271) | 79 |
| vale112786 (11964765) | Tanzania league S11 ≤2011-07-10 | 2011-09-23 (ID 11692271) | 75 |
| 86passi (12526500) | Gold Coast Cup (Ghana) S17 ≤2012-09-26 | 2012-12-25 (ID 12521486) | 90 |
| 86passi (12526500) | Ghana league S17 ≤2012-09-30 | 2012-12-25 (ID 12521486) | 86 |
| SebRBx (13052004) | Tanzania Consolation Cup (Tanzania) S22 ≤2014-11-19 | 2014-12-16 (ID 13049047) | 27 |
| Kasselhoff (13102463) | Oman league S26 ≤2014-11-23 | 2015-01-16 (ID 13059759) | 54 |
| Chihiri (13124753) | Nippon Consolation Cup (Japan) S44 ≤2014-11-19 | 2015-01-16 (ID 13059759) | 58 |
| ASGuard (13252420) | Rubínový pohár (Slovakia) S41 ≤2015-10-21 | 2016-02-04 (ID 13202223) | 106 |
| josecarlos3008 (13273737) | Copa Esmeralda Machu Picchu (Peru) S49 ≤2016-06-01 | 2016-07-07 (ID 13254260) | 36 |
| Rebellion30 (13319867) | Copa Consuelo Roba Oxígeno (Costa Rica) S41 ≤2016-09-21 | 2016-12-24 (ID 13305646) | 94 |
| brunclik (13322507) | Kyrgyzstan Ruby Challenger Cup (Kyrgyz Republic) S39 ≤2016-09-21 | 2016-12-24 (ID 13305646) | 94 |
| MLOMLO (13540713) | O’zbekiston Emerald Challenger Cup (Uzbekistan) S27 ≤2019-06-26 | 2019-07-13 (ID 13532476) | 17 |
| Teipon (13602864) | Kenya Cup (Kenya) S50 ≤2019-10-16 | 2020-01-30 (ID 13600491) | 106 |
| Jootss (13649679) | Saffieren Beker (Suriname) S48 ≤2020-02-05 | 2020-05-21 (ID 13643349) | 106 |
| PrincepsPulacha (13712202) | Saint Vincent and the Grenadines league S2 ≤2021-01-10 | 2021-01-11 (ID 13711014) | 1 |
| Sabhas (13803156) | Saint Vincent and the Grenadines league S4 ≤2021-08-22 | 2021-12-06 (ID 13799754) | 106 |
| MrRemo (13808860) | Puerto Rico Ruby Challenger Cup (Puerto Rico) S3 ≤2021-08-18 | 2021-12-06 (ID 13799754) | 110 |
| Peppe\_mio (13964250) | Coppa Montale (San Marino) S7 ≤2022-11-09 | 2022-11-30 (ID 13931362) | 21 |
| Lukas2728 (13996879) | Al Urdun Consolation Cup (Jordan) S60 ≤2023-06-21 | 2023-06-28 (ID 13990671) | 7 |
| LAujust (14067721) | 塞翁挑战者杯 (Sapphire Challenger Cup) (People's Republic of China) S72 ≤2023-06-21 | 2023-06-28 (ID 13990671) | 7 |
| continent1 (14080373) | Jamaica Consolation Cup (Jamaica) S62 ≤2023-06-21 | 2023-06-28 (ID 13990671) | 7 |
