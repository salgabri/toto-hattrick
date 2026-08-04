# AGENTS.md

Guidance for Codex working in this repo. Read [the spec](hattrick-archive-spec.md) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before non-trivial changes.

## What this is
A webapp that syncs a Hattrick team's match history from the **CHPP API** into a local DB and
serves previous seasons' results from that DB. The DB is the point: Hattrick won't serve unlimited
history on demand, so we sync once and read locally forever.

## Stack (decided — do not re-litigate)
- TypeScript everywhere · **Fastify** backend · **React + Vite** frontend
- **SQLite via Prisma** (swap to Postgres later by changing the datasource only)
- `oauth-1.0a` + node `crypto` (HMAC-SHA1 signing) · global `fetch` for calls
- `fast-xml-parser` for XML · `zod` for parsed-response shapes and env config

## Layout
```
server/   Fastify backend (TS, ESM, NodeNext)
  src/config/  env.ts — zod-validated env (build step 1, done)
  src/chpp/    auth.ts (OAuth) · client.ts (signed GET + XML→obj) · endpoints.ts (per file=)
  src/schemas/ zod schemas for parsed XML — STUBBED until /samples exist
  src/sync/    syncTeam() archive walker + season.ts windows/derivation
  src/routes/  read.ts (DB read API) · auth.ts (OAuth flow) · sync.ts (manual trigger)
  src/db/      prisma client
  prisma/      schema.prisma
  samples/     real CHPP XML goes here  ← gates the schema work
web/      React + Vite frontend (JSON only)
docs/     ARCHITECTURE.md
```

## Guardrails — do not violate
1. **Secrets are server-side only.** Never put the consumer secret, access token, or any OAuth
   value in frontend code or in a URL the browser sees. The browser talks ONLY to `/api/*` JSON.
2. **Pin explicit API `version` params.** Never omit them (see `chpp/endpoints.ts`).
3. **Never re-fetch a match already in the DB.** Finished matches never change. Sync is
   resume-safe: re-running duplicates nothing and re-fetches nothing stored.
4. **Do not invent XML field names.** If `server/samples` lacks the XML you need to parse,
   **stop and ask** for it. The schema parse functions throw on purpose until modelled against
   real data.
5. **Keep sync callable outside HTTP.** All sync logic lives in `syncTeam()`, not in the route
   handler, so a scheduler can call it later.

## Build order (current state)
1. ✅ Env config + zod validation (`config/env.ts`).
2. ✅ **OAuth 1.0a end-to-end** — signed `teamdetails` returns parsed data. NB: Hattrick's IIS
   rejects the OAuth `Authorization` header (IIS 401.2); sign the `oauth_*` params into the URL
   **query string** instead (`auth.ts` `buildSignedUrl`).
3. ✅ Prisma migration (SQLite `dev.db`).
4. ✅ `matchesarchive` + season-window pagination → DB. NB: matchesarchive's date filter only
   honours **date-only** `YYYY-MM-DD` — a time component makes it ignore the range.
5. ✅ `matchdetails` enrichment, skip-if-stored (team-level ratings/scorers; per-player lineup
   would be a future `matchlineup` add).
6. ✅ JSON read API (`routes/read.ts`).
7. ◐ React frontend (champions table + standings + season results done).
8. ✅ **League champions** per season — `leaguefixtures(unit, season)` serves historical results;
   reconstruct the table (`sync/standings.ts`) → `SeasonStanding`. `syncLeagueHistory()`.

## Conventions
- ESM throughout. Server imports use explicit `.js` extensions (NodeNext resolution).
- Read env only via `config/env.ts`'s exported `env`; never touch `process.env` elsewhere.
- One shared Prisma client from `db/client.ts`.
- `chpp/client.ts` returns `unknown`; the caller validates with a zod schema.
- Derive `season` from `matchDate` and store it — don't compute it at query time.

## Commands
```bash
npm install                          # root — installs both workspaces
cp server/.env.example server/.env   # then fill CHPP_CONSUMER_KEY / _SECRET
npm run db:generate -w server        # prisma client
npm run db:migrate  -w server        # create/apply migration
npm run dev                          # server (:3001) + web (:5173) together
npm run typecheck                    # both workspaces
```

Env lives in `server/.env` (each workspace runs with its own cwd; the server is the only
process that reads env). `DATABASE_URL=file:./dev.db` is relative to `server/prisma/`.

## When stuck
- Missing XML to parse → ask the user for the `/samples` file; do not guess shapes.
- OAuth call returns an IIS 401 HTML page (not `oauth_problem` text) → it's the `Authorization`
  header being rejected, NOT signing. Put the `oauth_*` params in the query string (done in
  `buildSignedUrl`). Only suspect base-string/encoding once a proper OAuth error body appears.
- matchesarchive ignoring your date range → drop the time component (use `YYYY-MM-DD`).
