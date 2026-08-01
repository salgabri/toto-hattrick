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
  const phase = process.env.SCRAPE_PHASE;
  const targetsName = phase === 'masters' ? 'masters-unresolved.json' : phase === 'cup' ? 'cup-unresolved.json' : phase === 'generation' ? 'generation-unresolved.json' : 'unresolved.json';
  const resultsName = phase === 'masters' ? 'masters-owners.jsonl' : phase === 'cup' ? 'cups.jsonl' : phase === 'generation' ? 'generation-owners.jsonl' : 'managers.jsonl';
  const targetsFile = () => `${dir}/${targetsName}`;
  const resultsFile = () => `${dir}/${resultsName}`;

  app.get('/api/scrape/targets', async () => {
    if (!dir || !existsSync(targetsFile())) return [];
    return JSON.parse(readFileSync(targetsFile(), 'utf8'));
  });

  // teamIds already scraped (so the browser can resume after an interruption).
  app.get('/api/scrape/done', async () => {
    if (!dir || !existsSync(resultsFile())) return [];
    const ids = new Set<number>();
    for (const line of readFileSync(resultsFile(), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { ids.add(JSON.parse(line).teamId); } catch { /* skip */ }
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
