# Season-95 current-owner manager attribution — 2026-10-30

A one-off, operator-approved exception to the attribution rules in the
[runbook](UPDATE_RUNBOOK.md#release-quality-attribution-audit) and
[historical recovery guide](HISTORICAL_WINNER_RECOVERY.md#unverified-legacy-approximations).
The season-95 catch-up published every new league champion and domestic cup winner with manager
"—". For this release only, every current-edition winner still lacking a manager was filled from
the winning club's owner, as reported by CHPP after the final. The default updater is unchanged:
future winners still publish as manager pending until reviewed Club History evidence exists.

## Results

| Scope | Targets | Attributed | Left pending |
| --- | ---: | ---: | ---: |
| League champions, latest edition | 159 | 156 | 3 |
| Domestic cups added by the 2026-10-29/30 runs | 82 | 82 | 0 |
| Domestic cups from earlier weekly runs, latest edition | 172 | 169 | 3 |

The CHPP pass made 406 attributions naming 394 managers. 120 of them were new manager rows, and
their nationalities were resolved in the same pass. A Club History review then added one more (see
below). The finals were played between 2026-09-09 and 2026-10-28.

Older editions, including the 174 historical cup rows that the same runs re-checked, were out of
scope and remain pending.

## Clubs without an owner

Seven winning clubs have no owner today, so CHPP could not name one. Their public Club History pages
were then reviewed one at a time, at the operator's direction.

- **FC Speedcore** (Cameroon's Trophée Roger Milla S51). "22.04.2017 The club changed owner as
  gabber55 took control and renamed it FC Speedcore." links user 13281465. History pages 1–7 cover
  2015–2026 and contain no later ownership change. CHPP shows the club ownerless only from
  2026-09-26, ten days after the 2026-09-16 final. gabber55 managed it at the win and is now
  attributed.
- **Lwy Bhutanu** (Bhutan Ruby Challenger Cup S3), **Erekir** (Algeria's Consolante S69) and
  **los domis** (Dominican Republic's Copa Consolación S74). Each was "founded by" one manager:
  minios88, El_Sodo and fabriziromano. CHPP shows each club ownerless 20–33 days before its final.
  minios88 is still active and manages another club. The other two had not logged in since July
  and May. These wins had no manager.
- **Town Area Rovers** (Gibraltar S3), **Trongsa United** (Bhutan S3) and **Nicosia Cyclops**
  (Hattrick Femme International S2). Their complete histories name no founder or owner; they have
  been bots since creation.

Hattrick words every one of these wins "under the leadership of a now retired manager". That
includes the bot-run Nicosia Cyclops title, so the phrase alone never identifies a person. The six
titles without a manager stay "—".

## Evidence and guards

- **Calls.** One `teamdetails` 3.6 response per winning club (406 calls) and one
  `managercompendium` 1.5 response per owner without a recorded nationality (121 calls). Both
  were fetched sequentially, with 1 s pacing, on 2026-10-30. No HTML page was requested.
- **Retained evidence.** Raw responses are kept privately under
  `.scrape/owner-snapshots-2026-10-30/`. `manifest.jsonl` records each file's capture time, size
  and SHA-256.
- **Guards.** A club was attributed only when all of these held:
  - It is not a bot and has a real owner.
  - The owner took the club over at least 30 days before the final, and the owner's account
    predates the final.
  - Its current name equals the stored winner.
  - It plays in the competition's country.
  - No title the archive already credits for the same club and season names someone else.
- **Decisive match dates.** These come from the retained `leaguefixtures` and final-round
  `cupmatches` responses.
- **Takeover dates.** `Team/FoundedDate` restarts when a manager takes a club over:
  - Club 174, one of the oldest IDs, shows 2004-11-08, its owner's activation time.
  - Every primary club's `FoundedDate` equals its owner's activation.
  - The September Club History captures record takeovers on exactly the `FoundedDate` day.
    For example, club 793488's "took control 06-05-2013" matches 2013-05-06.
  - A club's trophy cabinet lists only titles won since `FoundedDate`: none of 7,947 trophies
    across 595 clubs predates it.
  - The latest accepted takeover was 2026-03-17, so every attributed owner held the club for the
    whole season. The shortest gap before a final was 217 days.
- **Corroboration.** Every title the archive already credits for these clubs names the current
  owner. Some of those older credits may themselves come from earlier approximations, so this
  agreement is not fully independent.
- **Trophy cabinets.** All 250 cup winners already list the season's trophy. It was gained a few
  hours after the stored final. League trophies are awarded at the season changeover, so those
  were not yet present.

## How it was applied

1. `update:checkout` exported the accepted snapshot.
2. One guarded transaction set `championUserId` and `championUserName`, only where the stored
   winner matched and the manager was empty. A manager already in the archive keeps their existing
   login name. The same transaction inserted the new `HattrickUser` rows and filled one missing
   nationality.
3. Two independent verification rounds re-derived every decision from the raw XML and audited
   the database diff.
4. `update:import` validated the checkout: schema, protected facts and an unchanged ledger.
5. A `--no-fetch` updater run packaged the release, which shipped through the normal Git and
   Vercel flow.
6. The FC Speedcore attribution followed the same checkout, guarded edit, import and release path
   as a separate one-row release.

These rows are contemporaneous-owner approximations, not Club History evidence. Reviewed evidence
that names a different manager will surface as a conflict for review. It never overwrites a row
automatically.
