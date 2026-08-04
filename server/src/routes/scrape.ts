import type { FastifyInstance } from 'fastify';
import { readFileSync, appendFileSync, existsSync } from 'node:fs';

/**
 * Dev-only endpoints to drive the in-browser team-history scrape from the user's logged-in
 * Chrome (which has Hattrick's Cloudflare clearance; our server is 403'd). The browser GETs the
 * target teams, POSTs back resolved managers, and we persist to a JSONL file (no DB writes here,
 * so it can't collide with a concurrent enrichment). Resume-safe via /done.
 */
export async function registerScrapeRoutes(app: FastifyInstance): Promise<void> {
  const dir = process.env.SCRAPE_DIR;
  // SCRAPE_PHASE selects which target/result files the SAME in-browser scraper (it only knows the
  // generic endpoints) reads and writes, so each phase's files — and its /done skip-set — stay
  // isolated from the others:
  //   undefined -> league (unresolved.json / managers.jsonl)
  //   'cup'     -> national cups (cup-unresolved.json / cups.jsonl)
  //   'masters' -> Hattrick Masters (masters-unresolved.json / masters-owners.jsonl). A separate
  //                done-set matters here: a team already scraped for its national cups (its cup
  //                seasons) still needs scraping for its Masters season, which the cup pass filtered out.
  //   'generation' -> the "Heroes of YYYY Trophy" cohorts (generation-unresolved.json /
  //                   generation-owners.jsonl). /done is unused for this phase (its browser script
  //                   runs start-to-finish in one pass, not team-resumable — the same teamId can
  //                   legitimately win multiple cohort/season editions, so teamId is not a valid
  //                   dedup key here the way it is for the other phases).
  //   'worldcup-coaches' -> a national team's full coaching-tenure history (World Cup manager
  //                         attribution — worldcup-coaches-unresolved.json / worldcup-coaches.jsonl).
  //                         teamId IS a valid /done key here: each team's history is scraped once.
  //   'elections' -> a country's National Coach election history (elections-unresolved.json /
  //                  elections.jsonl). "teamId" here is actually a leagueId — the generic /done
  //                  dedup only cares that it's a stable numeric key, scraped once per country.
  //   'ntcups'  -> the regional national-team cups (-> ntcups.jsonl). The ONLY target-less phase:
  //                its console script carries the five cup ids itself and runs standalone, so
  //                /targets is unused — only /results and /done (keyed by cupId) apply. Running the
  //                phase is optional; the script downloads a .jsonl either way (see sync/ntCups.ts).
  const phase = process.env.SCRAPE_PHASE;
  const targetsName =
    phase === 'masters' ? 'masters-unresolved.json'
    : phase === 'cup' ? 'cup-unresolved.json'
    : phase === 'generation' ? 'generation-unresolved.json'
    : phase === 'worldcup-coaches' ? 'worldcup-coaches-unresolved.json'
    : phase === 'elections' ? 'elections-unresolved.json'
    : 'unresolved.json';
  const resultsName =
    phase === 'masters' ? 'masters-owners.jsonl'
    : phase === 'cup' ? 'cups.jsonl'
    : phase === 'generation' ? 'generation-owners.jsonl'
    : phase === 'worldcup-coaches' ? 'worldcup-coaches.jsonl'
    : phase === 'elections' ? 'elections.jsonl'
    : phase === 'ntcups' ? 'ntcups.jsonl'
    : 'managers.jsonl';
  const targetsFile = () => `${dir}/${targetsName}`;
  const resultsFile = () => `${dir}/${resultsName}`;

  app.get('/api/scrape/targets', async () => {
    if (!dir || !existsSync(targetsFile())) return [];
    return JSON.parse(readFileSync(targetsFile(), 'utf8'));
  });

  // Keys already scraped (so the browser can resume after an interruption).
  //
  // Each phase writes its own record shape, and only the team-history ones actually carry a
  // `teamId`: elections records are keyed by `leagueId` and the regional cups by `cupId`. Reading
  // `teamId` alone yielded a Set containing nothing but `undefined` (serialised as `[null]`), so
  // `done` never matched a target and an interrupted run silently restarted from the top —
  // re-scraping every country and appending a duplicate of everything already collected.
  app.get('/api/scrape/done', async () => {
    if (!dir || !existsSync(resultsFile())) return [];
    const ids = new Set<number>();
    for (const line of readFileSync(resultsFile(), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        const id = r.teamId ?? r.leagueId ?? r.cupId;
        if (typeof id === 'number') ids.add(id);
      } catch { /* skip */ }
    }
    return [...ids];
  });

  app.post<{ Body: unknown }>('/api/scrape/results', async (req) => {
    const recs = req.body;
    if (!dir || !Array.isArray(recs)) return { ok: false, received: 0 };
    appendFileSync(resultsFile(), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return { ok: true, received: recs.length };
  });
}
