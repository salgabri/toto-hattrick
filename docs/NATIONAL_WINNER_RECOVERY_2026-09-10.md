# National winner recovery — 10 September 2026

Follow-up to the club-title recovery: reviewed senior World Cups, U20/U21 World Cups,
all ten registered senior/youth regional cups, and national-coach elections.

Applied locally: **8 national podium attributions and 9 election wins**. The database
and all static JSON have been rebaked; nothing has been deployed or committed.

## Recovered podiums

| Competition | Place / nation | Manager |
| --- | --- | --- |
| Senior World Cup XI | Silver / Ukraina | petrovich (574515) |
| Senior World Cup XVIII | Silver / Slovenija | Jomba_slo (5211677) |
| Senior World Cup XXXIV | Silver / England | Bissy9 (13059769) |
| U20 World Cup IX | Gold / Deutschland | Alando-Brinkman (184069) |
| U20 World Cup IX | Silver / México | Morelos (215249) |
| U20 World Cup XI | Bronze / Italia, second bronze slot | Mokiforever (1585064) |
| U20 World Cup XXII | Silver / Malta | EmanBusuttil (2337687) |
| U20 World Cup XXVI | Silver / Belarus | swim_Minsk (1560543) |

Five complete official former-coach histories supply date-bounded identities. Three
reviewed records use independent Hattrick Press, historical wiki and numeric-profile
evidence. See [source notes](NATIONAL_WINNER_RECOVERY_SOURCES.md) and the replayable
`verified-national-coach-histories.json` / `verified-national-trophy-winners.json`.

## Recovered elections

The browser sweep captured **156 complete country election pages**. Nine existing
unassigned rows could be matched uniquely to observed numeric winner links:

- Trent71 (2721158): South Africa senior XXVI and youth XXIII–XXV; Bulgaria youth XXVII.
- kepica (11767525): Slovenia youth XXII–XXIII; Mongolia youth XXIX.
- zanco907 (12280866): Dominican Republic youth XXII.

The five supporting full pages, including every former-user occurrence, are retained
in `verified-national-election-histories.json`. CHPP resolved nationalities for all
three newly added managers. Election identity is not used to infer a later trophy.

## Unresolved and deliberately excluded

- National podium gaps declined from **49 to 41**: **9 gold and 32 silver/bronze**.
  No regional coach was safely recoverable from the reviewed evidence. Albania's U21
  Nations Cup season 37 (13 September 2024) remains unknown: the official tenure is
  an unlinked retired user, not the predecessor Thomas941.
- Missing election identities declined from **1,606 to 1,597**. Four source tuples
  have indistinguishable repeat-election edition/host/vote values (Cape Verde youth
  XVIII, Kuwait senior XXXII, Cameroon youth XXVIII and Honduras youth XXIII). They
  remain ambiguous, even when one occurrence links a live manager.
- Three newly observed youth XLI re-election rows in Denmark, Latvia and Nepal are
  recorded in the audit but not inserted by the missing-identity repair. Existing
  election history is preserved. A deliberate full-history sync can add distinct
  occurrences with the hardened ingestion path.
- Username reuse and conflicting histories are not resolved by name matching. In
  particular, England youth's official history identifies active PirateWolf (47604)
  from 29 June 2004 to 8 February 2005, while the senior World Cup V coach is retired.
  The conflicting wiki alias is insufficient to credit that senior silver medal.

## Prevention and verification

- Legacy incomplete flat-tenure attribution is disabled. Complete histories retain
  retired-user boundaries; same-day changes, wrong age brackets, invalid dates and
  conflicting national-team IDs are rejected. Existing positive coaches are protected.
- Bronze requires direct trophy evidence, not a guessed semifinal date. Sparse bronze
  identities keep their original positions.
- World Cup and regional ingestion is fill-only for historical podium facts. Partial
  pages cannot erase winners, change their nations, reorder bronze or reopen a finished
  cup. Conflicting facts require review. Invalid supplied calendar dates are rejected.
- Election ingestion no longer deletes country histories. Only explicitly complete
  snapshots can fill or append uniquely identified occurrences; repeat ambiguity is
  detected before filtering former users.
- Both recovery replays report zero pending changes, zero conflicts and zero rejected
  evidence. **154 tests pass**, including isolated SQLite ingestion tests; server/web
  typechecks and frontend production build pass. Browser checks confirm the repaired
  youth coach links and Trent71's five election wins.
- A read-only comparison with the backup confirms eight changed coach slots across
  seven World Cup rows, nine election identities and three new manager records. All
  competition/election row counts, event facts, previous club repairs and existing
  manager metadata are unchanged.

Backup: `.backup/national-winner-recovery-20260910/` (database and all seven static
data files, taken after the earlier club recovery). Detailed plans, source captures,
apply reports and replay checks are under `.scrape/national-winner-recovery/`.

Reproduce from `server/` after `npm run build`, initially without `--apply`:

```sh
node dist/scripts/recover-national-coaches.js
node dist/scripts/recover-elections.js --input src/data/verified-national-election-histories.json
```

See [recovery mechanics](NATIONAL_COACH_RECOVERY.md) for input requirements and guards.
