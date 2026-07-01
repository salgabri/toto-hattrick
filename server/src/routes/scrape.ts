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
  const targetsFile = () => `${dir}/unresolved.json`;
  const resultsFile = () => `${dir}/managers.jsonl`;

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
