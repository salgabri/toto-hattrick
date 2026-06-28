# CLAUDE.md

Guidance for Claude Code working in this repo. Read [the spec](hattrick-archive-spec.md) and
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
2. ⬜ **OAuth 1.0a end-to-end** — get an access token, make ONE signed `teamdetails` call that
   returns parsed data. **Do this before anything else.** Don't move past it until a real signed
   call succeeds — every later step depends on it and it's where signing bugs surface.
3. ⬜ Prisma migration (`npm run db:migrate -w server`).
4. ⬜ `matchesarchive` + season-window pagination → DB (needs samples + real schema).
5. ⬜ `matchdetails` enrichment, skip-if-stored (needs samples + real schema).
6. ✅ JSON read API (`routes/read.ts`).
7. ◐ React frontend (season selector + table done; detail view + summary next).

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
- OAuth signing failing → it's almost always the base-string/encoding. Verify the signed
  `teamdetails` smoke test before touching sync.
