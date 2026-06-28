# Hattrick Season Archive — Build Spec for Claude Code

A webapp that fetches a team's match history from the Hattrick CHPP API, stores it in a local database, and displays previous seasons' results. The database is the point: Hattrick doesn't serve unlimited match history on demand, so we sync once and read locally forever.

---

## Stack (decided — do not re-litigate)

- **Language:** TypeScript everywhere
- **Backend:** Fastify (Node.js)
- **Frontend:** React + Vite
- **DB + ORM:** SQLite via Prisma (schema is typed; swap to Postgres later by changing the datasource only)
- **HTTP / OAuth:** `oauth-1.0a` + `crypto` for request signing; `undici` or `node-fetch` for calls
- **XML parsing:** `fast-xml-parser`
- **Validation:** `zod` for parsed-response shapes and env config

Rationale the agent should respect: OAuth signing + the consumer secret live **server-side only**. The browser talks exclusively to our backend's JSON endpoints, never to Hattrick and never sees XML or secrets.

---

## Critical context about the Hattrick CHPP API

1. **Auth is OAuth 1.0a three-legged** (NOT OAuth 2.0). Flow: request token → user authorizes on Hattrick → access token. Store the access token + secret per user.
2. **Responses are XML**, version-specific. Each endpoint has a `version` parameter — pin explicit versions, do not omit.
3. **You need a registered CHPP app** (consumer key + secret) before any live call works. Treat these as env vars: `CHPP_CONSUMER_KEY`, `CHPP_CONSUMER_SECRET`.
4. **Base endpoint:** `https://chpp.hattrick.org/chppxml.ashx` with a `file` query param selecting the endpoint (e.g. `?file=matchesarchive`).
5. **Rate limits and CHPP terms are real.** Finished matches never change, so never re-fetch a match already stored. Cache aggressively.

> ⚠️ **Do not guess the XML schema.** The user will drop sample XML responses for `matchesarchive` and `matchdetails` into `/samples`. Parse against those real shapes. If `/samples` is empty, stop and ask for them rather than inventing field names.

---

## Relevant endpoints

| `file=` | Purpose | Notes |
|---|---|---|
| `matchesarchive` | Historical matches for a team in a date range | **Primary source for old seasons.** Has a max date-range per call → paginate by season windows. Params: `teamID`, `FirstMatchDate`, `LastMatchDate`. |
| `matchdetails` | Goals, ratings, lineup for one match | Params: `matchID`, optional `matchEvents`. Call per match to enrich. |
| `matches` | Recent/upcoming matches in a short window | Useful for keeping the archive current. |
| `teamdetails` | Team metadata, founded date | Use to bound how far back to sync. |

---

## Architecture

Two halves, cleanly separated:

### 1. Sync job (`/server/sync`)
- Manual trigger (`POST /api/sync/:teamId`) to start; structure it so a cron/scheduler can call the same function later.
- Walks backward season by season using `matchesarchive` with date-range windows.
- For each match returned: if `matchId` already in DB → skip. Otherwise insert the summary, then call `matchdetails` to fill goals/ratings/lineup.
- Polite pacing: small delay between calls, respect any rate-limit signals, resume-safe (re-running never duplicates and never re-fetches stored matches).

### 2. Read API (`/server/routes`)
Serves the frontend from **our DB**, never live Hattrick:
- `GET /api/seasons` — list of seasons we have data for
- `GET /api/seasons/:season/matches` — results in a season
- `GET /api/matches/:matchId` — full detail
- `GET /api/teams/:teamId/summary` — W/D/L, goals for/against per season

### 3. Frontend (`/web`)
- Season selector → results table (date, opponent, home/away, score, type)
- Match detail view (lineup, scorers, ratings)
- Per-season summary stats
- Reads only the JSON endpoints above.

---

## Suggested repo structure

```
hattrick-archive/
├── server/
│   ├── src/
│   │   ├── chpp/          # OAuth signing + raw CHPP calls
│   │   │   ├── auth.ts        # 3-legged OAuth 1.0a flow
│   │   │   ├── client.ts      # signed request + XML→object
│   │   │   └── endpoints.ts   # typed wrappers per file=
│   │   ├── sync/          # archive sync job
│   │   ├── routes/        # JSON read API for frontend
│   │   ├── db/            # prisma client + helpers
│   │   ├── schemas/       # zod schemas for parsed XML
│   │   └── server.ts
│   ├── prisma/
│   │   └── schema.prisma
│   └── samples/          # <-- real XML responses go here
├── web/                  # React + Vite
└── README.md
```

---

## Data model (starting point — refine against real XML)

- **Team**: `teamId` (PK), `name`, `foundedDate`, `leagueId`
- **Match**: `matchId` (PK), `teamId`, `season`, `matchDate`, `homeTeamId`, `awayTeamId`, `homeTeamName`, `awayTeamName`, `homeGoals`, `awayGoals`, `matchType`, `detailsFetched` (bool)
- **MatchDetail**: `matchId` (PK/FK), `lineupJson`, `scorersJson`, `ratingsJson` (store enriched detail as JSON columns to start; normalize later only if a feature needs it)

`season` isn't always a literal field in Hattrick's response — derive it from `matchDate` against Hattrick's season boundaries, and store it so season queries stay cheap.

---

## Build order

1. Env config + `zod` validation for the four CHPP/DB vars. Fail loudly if missing.
2. OAuth 1.0a flow end to end — prove you can get an access token and make ONE signed `teamdetails` call returning parsed data. **Get this working before anything else.**
3. Prisma schema + migration.
4. `matchesarchive` wrapper + season-window pagination, writing summaries to DB.
5. `matchdetails` enrichment pass with skip-if-stored.
6. JSON read API.
7. React frontend.

Don't move past step 2 until a real signed call succeeds — every later step depends on it, and it's where the fiddly OAuth signing bugs surface.

---

## Guardrails for the agent

- Never put the consumer secret, access token, or any OAuth value in frontend code or in a URL the browser sees.
- Pin explicit API `version` params; don't omit them.
- Never re-fetch a match already in the DB.
- If `/samples` lacks the XML you need to parse, **stop and ask** — do not invent field names.
- Keep the sync function callable both manually and by a future scheduler (no logic locked inside an HTTP handler).
