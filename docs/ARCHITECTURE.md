# Architecture — Hattrick Season Archive

## Why this exists

Hattrick doesn't serve unlimited match history on demand. We sync a team's matches from the
CHPP API **once** into a local database, then read from that DB forever. Finished matches never
change, so the archive only ever grows — we never re-fetch what we already have.

## The hard boundary

```
            ┌─────────────────────────────────────────────┐
            │                  BROWSER                     │
            │   React + Vite  →  JSON only, same-origin     │
            └───────────────┬─────────────────────────────┘
                            │  /api/* (JSON)
            ┌───────────────▼─────────────────────────────┐
            │                  BACKEND (Fastify)           │
            │                                              │
            │  routes/   read API (DB) · auth · sync       │
            │  sync/     archive walker (callable fn)      │
            │  chpp/     OAuth signing + XML→object        │
            │  schemas/  zod validation of parsed XML      │
            │  db/       Prisma client                     │
            └───────┬───────────────────────┬─────────────┘
                    │ signed OAuth 1.0a      │ SQL
                    │ (secret server-side)   │
        ┌───────────▼──────────┐   ┌─────────▼──────────┐
        │  Hattrick CHPP API   │   │  SQLite (Prisma)   │
        │  XML, versioned      │   │  swap → Postgres   │
        └──────────────────────┘   └────────────────────┘
```

**Invariant:** OAuth signing, the consumer secret, access tokens, and XML never cross into the
browser. The frontend only ever sees JSON from our own endpoints. This is non-negotiable — see
the guardrails in [CLAUDE.md](../CLAUDE.md).

## Two halves

### 1. Sync (write path) — `server/src/sync`
- Entry point: `syncTeam(token, teamId, opts)` — a plain async function, **not** locked inside an
  HTTP handler, so a cron/scheduler can call the same function later.
- Walks **backward** season by season via `matchesarchive`, paginating by date-range windows
  (`seasonWindows`), because the endpoint caps the range per call.
- Per match: skip if already stored (resume-safe, no duplicates, no re-fetch), else insert the
  summary, then enrich via `matchdetails`.
- Polite pacing (`PACING_MS`) between calls; respects CHPP terms.
- Triggered manually today via `POST /api/sync/:teamId`.

### 2. Read (read path) — `server/src/routes/read.ts`
Serves the frontend from **our DB**, never live Hattrick:
- `GET /api/seasons` — seasons we have data for
- `GET /api/seasons/:season/matches` — results in a season
- `GET /api/matches/:matchId` — full detail
- `GET /api/teams/:teamId/summary` — per-season W/D/L + goals for/against

## CHPP integration — `server/src/chpp`
- `auth.ts` — three-legged **OAuth 1.0a** (request token → authorize → access token). HMAC-SHA1
  signing via `oauth-1.0a` + node `crypto`.
- `client.ts` — signed GET to `chppxml.ashx`, parses XML → object with `fast-xml-parser`. Returns
  `unknown`; the caller validates shape.
- `endpoints.ts` — one typed wrapper per `file=`, each with an **explicitly pinned `version`**.

## Schema validation — `server/src/schemas`
Zod schemas validate the parsed XML. **Deliberately stubbed**: the real field names come from the
sample XML the user drops into `server/samples`. Inventing field names is forbidden — the parse
functions throw until modelled against real data.

## Data model — `server/prisma/schema.prisma`
- `Team` — `teamId` PK, founded date (bounds how far back to sync).
- `Match` — one summary row from `matchesarchive`; `detailsFetched` flips true after enrichment.
  `season` is **derived** from `matchDate` (Hattrick has no universal season field) and stored so
  season queries stay cheap.
- `MatchDetail` — enriched lineup/scorers/ratings as JSON columns (normalize later only if a
  feature needs it).
- `ChppToken` — per-user OAuth access token + secret, server-side only.

SQLite now; switch to Postgres by changing the Prisma `datasource` + `DATABASE_URL` only.

## Build order (see [the spec](../hattrick-archive-spec.md))
1. ✅ Env config + zod validation — `config/env.ts` (fails loudly if vars missing).
2. ⬜ **OAuth end-to-end** — one signed `teamdetails` call returning parsed data. *Do this before
   anything else; it's where the fiddly signing bugs surface.*
3. ⬜ Prisma migration (schema written; run `db:migrate`).
4. ⬜ `matchesarchive` + season-window pagination → DB (needs samples).
5. ⬜ `matchdetails` enrichment, skip-if-stored (needs samples).
6. ✅ JSON read API — implemented (DB-only, schema-independent).
7. ◐ React frontend — season selector + results table scaffolded; detail view + summary next.

## Current state
Scaffold compiles and the read API runs against an empty DB. The write path (sync) and schema
validation are intentionally stubbed and throw until real XML samples exist. Nothing past step 2
should be wired live until a real signed call succeeds.
