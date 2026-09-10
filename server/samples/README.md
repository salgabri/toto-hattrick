# CHPP XML samples

Drop **real** XML responses here. The zod schemas in `../src/schemas` must be modelled
against these files — the spec forbids inventing field names.

Needed before sync (steps 4–5) can run:

| File | Source endpoint | How to capture |
|------|-----------------|----------------|
| `teamdetails.xml`    | `?file=teamdetails&version=3.6`    | Step-2 smoke test response |
| `matchesarchive.xml` | `?file=matchesarchive&version=1.4` | One season window for your team |
| `matchdetails.xml`   | `?file=matchdetails&version=3.0`   | One finished match |

Until these exist, `parseMatchesArchive` / `parseMatchDetails` / `parseTeamDetails`
throw on purpose. Model the schema, replace the stub, then run sync.

> If a capture contains private team data you don't want committed, name it
> `*.local.xml` (git-ignored) and keep a redacted copy for the repo.

## Cup-final recovery captures — 10 September 2026 UTC

The `cup-final-*-3.0.xml` files are minimal excerpts of actual authenticated CHPP
`file=matchdetails&version=3.0` responses. The private envelope and unrelated player
data were omitted; retained match fields and event wording were not invented.
Original full responses remain in ignored `matchdetails-3.0-*.local.xml` captures.

- `cup-final-18279050-3.0.xml`: Croatia cup56/S7, a historical second leg. Event72
  names the extra-time **match** winner; the preceding cup round establishes the
  first leg, and the cup winner comes from the aggregate.
- `cup-final-541334258-3.0.xml`: Iran Alborz Cup714/S38. Event500 explicitly reports
  a mutual walkover, with subject team0, minute0, part0. No winner is assigned.
- `cup-final-771464494-3.0.xml`: Masters cup183/S95, captured while absent from all
  local match/final tables. This proves Masters uses MatchType7 and
  MatchContextId183; domestic cup captures use MatchType3.

The first two requests included `matchEvents=true`. The Masters compatibility
probe requested no events because it validates type/context and score only.
Safe source URLs, captured scores, and SHA256 hashes for the 50 initial gap finals
are in `src/data/recovered-cup-final-evidence.json`; Masters probe facts are in
`qa/masters-format-evidence.json` relative to the repository root. All match IDs
were checked against stored finals/matches before their first fetch.
