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
