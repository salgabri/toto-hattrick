# National trophy coach recovery

World Cup and regional national-cup coaches need evidence for the national team's coaching
tenure at the final, not its present coach and not the election winner for a nominal cycle.
The legacy flat-tenure attribution functions are disabled: they could overwrite known coaches,
clear medals, and extend incomplete histories beyond their demonstrated coverage.

Run from the repository root (paths below are relative to `server/`):

```sh
npm run recover:national-coaches -w server -- --report ../.scrape/national-winner-recovery/coach-plan.json
```

By default this uses the committed `server/src/data/verified-national-coach-histories.json` and
`verified-national-trophy-winners.json`, which are included in compiled builds. The five retained
full histories support the verified recoverable silver slots; unrelated raw captures are not
promoted into the seed. Override either file with `--histories PATH` or `--verified PATH`; an empty
JSON array deliberately disables that input. Inspect the report, then repeat with a new report
path and `--apply`.
This performs no API calls, nationality lookups, election changes, or baking. Reports are exclusive
new files. Default operation only reads the database. Application is atomic per podium row and
guards every original nation, national-team identity, date, and coach slot against concurrent edits.

## Complete history input

An array, or `{ "histories": [...] }`, of:

```json
{
  "teamId": 3041,
  "isYouth": true,
  "complete": true,
  "capturedAt": "2026-09-10T12:00:00.000Z",
  "sourceURL": "https://www.hattrick.org/en/Club/NationalTeam/NTFormerCoaches.aspx?teamId=3041",
  "entries": [
    {"teamId":3041,"date":"20-09-2005","userId":23283,"name":"-Bolla-","text":"20-09-2005 -Bolla-","links":[{"text":"-Bolla-","href":"/Club/Manager/?userId=23283"}]},
    {"teamId":3041,"date":"02-05-2006","userId":0,"name":"Retired user","text":"02-05-2006 Retired user","links":[]}
  ]
}
```

This fragment illustrates entry shape only: never mark a fragment complete. `complete:true` means
all history pages/rows, including the latest current coach and every unlinked/retired boundary,
were captured. Each positive user must match its actual manager link. Missing years before the
oldest entry remain unresolvable, even on a complete page. Capture time bounds the final open
tenure. Invalid calendar dates, future dates, mixed teams, and transitions sharing the final's
date are rejected. Keep unknown coach rows as user ID 0; never delete them to extend a predecessor.

## Reviewed direct trophy evidence

An array, or `{ "verifiedWinners": [...] }`, using:

```text
{ table: "worldCupChampion" | "nationalCupChampion", isYouth: boolean,
  edition?: number, cupId?: number, season?: number,
  slot: "champion" | "runnerUp" | "thirdFourth", podiumIndex?: 0 | 1,
  country: exact stored podium name, finalDate: "YYYY-MM-DD", teamId?: national team ID,
  userId: positive linked/verified ID, name: historical alias,
  sources: [HTTPS source URL, ...], evidence: explanation of direct proof }
```

World Cup records require edition, regional records require cupId + season; bronze requires the
zero-based index. The planner does not verify a web page's truth: these records require human/agent
source review before use, with the linked user identity verified separately from a matching name.
Election results alone are not proof of the coach at a later final. All sources are retained.
Bronze is earned at the semifinal, so the final date is not enough for tenure inference. Bronze
recovery currently requires direct trophy evidence; no guessed semifinal date offset is used.

Only finished competitions with a valid past final date qualify (regional status must be
`Finished`). National IDs must match the exact senior/youth bracket. Every positive stored coach
ID is preserved, even when evidence disagrees; disagreements are conflicts for separate review.
Missing null/0 slots may be filled. Bronze placeholders retain their positions, and country names
containing commas are parsed against the national registry. Existing user aliases, bot flags and
nationality are preserved; a newly created row's `isBot:false` does not assert current activity.
The applicator reads the committed CHPP-derived `national-team-ids.json` alongside populated DB
identities, supporting native nation names even after cache reconstruction leaves DB IDs empty.
Native/English names are linked by their existing league ID; conflicting populated DB IDs disable
that league's mapping. National podium ingests also validate every nonempty supplied date before
creating or filling facts. Empty dates remain partial-scrape holes, while impossible calendar
dates and malformed time values are rejected without modifying the stored podium.
