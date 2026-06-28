# Hattrick Season Archive

Fetch a Hattrick team's match history from the **CHPP API**, store it in a local database, and
browse previous seasons' results. Hattrick doesn't serve unlimited history on demand, so we sync
once and read locally forever.

- **Backend:** Fastify + TypeScript, SQLite via Prisma, OAuth 1.0a to CHPP, XML parsing server-side.
- **Frontend:** React + Vite. Talks only to our JSON API — never to Hattrick, never to XML or secrets.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and [CLAUDE.md](CLAUDE.md) for the
build rules and guardrails.

## Prerequisites
- Node 20+ (developed on 24)
- A registered CHPP app (consumer key + secret) — https://www.hattrick.org/en/community/Chpp/

## Setup
```bash
npm install
cp server/.env.example server/.env   # fill CHPP_CONSUMER_KEY and CHPP_CONSUMER_SECRET
npm run db:generate -w server
npm run db:migrate  -w server        # creates the SQLite DB at server/prisma/dev.db
npm run dev                          # backend :3001 + frontend :5173
```

## Status
Scaffold. Build order tracked in [CLAUDE.md](CLAUDE.md):

| Step | State |
|------|-------|
| 1. Env config + zod validation | ✅ done |
| 2. OAuth 1.0a end-to-end (signed `teamdetails`) | ⬜ next — do before anything else |
| 3. Prisma migration | ⬜ schema written |
| 4. `matchesarchive` sync | ⬜ needs `/samples` XML |
| 5. `matchdetails` enrichment | ⬜ needs `/samples` XML |
| 6. JSON read API | ✅ done |
| 7. React frontend | ◐ season table done |

> ⚠️ The sync/parse path is intentionally stubbed and throws until real CHPP XML samples are
> placed in `server/samples/`. The spec forbids inventing field names — see `server/samples/README.md`.

## Layout
```
server/  Fastify backend (chpp · sync · routes · schemas · db)
web/     React + Vite frontend
docs/    architecture
```
