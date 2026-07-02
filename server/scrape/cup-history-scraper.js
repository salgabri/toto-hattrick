/*
 * Cup ownership scraper — run in a logged-in www.hattrick.org tab (paste in the console, or inject
 * via the browser MCP). Only the logged-in browser has Hattrick's Cloudflare clearance; the server
 * is 403'd, so the scrape must originate here.
 *
 * Unlike the league scrape (which infers owners from ownership-change events by DOM index), each
 * Club/History CUP-VICTORY event names the winning manager inline, e.g.
 *   "In season 73, Bikini emerged victorious from …Ruby Challenger Cup. They were managed by Bikinis."
 * with a /Club/Manager/?userId= link — so owner-at-cup-season is read directly, no index matching.
 *
 * Flow: pull ranked targets [{teamId, seasons[]}] from the cup-phase server (run it with
 * SCRAPE_PHASE=cup), scrape each team's history (all pages via ASP.NET ViewState POST), POST back
 * {teamId, season, userId, name} to /api/scrape/results (→ cups.jsonl). Self-running, resume-safe
 * (skips /done), backs off on rate-limit blocks. Watch window.__cupProg; stop with
 * window.__cupProg.stop = true.
 */
(() => {
  const SRV = 'http://localhost:3001';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Cup names are language-specific (Coppa, Pohár, Puchar, Κύπελλο…) so we DON'T match on them.
  // Only cup-victory events carry a manager link (league-finish events don't), so a manager link +
  // a victory phrasing = a cup win, in any language. Exclude ownership events (also carry a link).
  const isOwner = (l) => /took control|took over|changed owner|has taken over|now managed by|left the club|abandoned|bought the club/i.test(l);
  const isWin = (l) => !isOwner(l) && /victorious|\bwon\b|winner|to the title|leadership of|memorable for/i.test(l);

  // Parse one history document → { season: {userId, name} } for cup victories. null = no events
  // container (a Cloudflare/rate-limit challenge rather than a real page).
  function parseDoc(doc) {
    const cont = doc.querySelector('[id*="ucOtherEvents"]');
    if (!cont) return null;
    const res = {};
    let cur = null; // current "Season N" header, fallback when a line omits the season
    for (const el of cont.querySelectorAll('*')) {
      if (el.children.length === 0) {
        const sh = (el.textContent || '').trim().match(/^Season (\d+)$/i);
        if (sh) cur = Number(sh[1]);
      }
      if (el.tagName === 'A' && /\/Club\/Manager\//.test(el.getAttribute('href') || '')) {
        const host = el.closest('td') || el.parentElement;
        const line = (host?.innerText || '').replace(/\s+/g, ' ').trim();
        if (!isWin(line)) continue;
        const uid = Number((el.getAttribute('href').match(/userId=(\d+)/) || [])[1]);
        const sm = line.match(/season (\d+)/i);
        const s = sm ? Number(sm[1]) : cur;
        if (uid && s) res[s] = { userId: uid, name: el.textContent.trim() };
      }
    }
    return res;
  }

  // Scrape one team across all history pages (page 1 GET + ViewState POST per pager page).
  async function scrapeTeam(teamId) {
    const url = `/en/Club/History/?teamId=${teamId}`;
    const doc = new DOMParser().parseFromString(await fetch(url).then((r) => r.text()), 'text/html');
    const p1 = parseDoc(doc);
    if (p1 === null) return { blocked: true };
    const merged = Object.assign({}, p1);
    const pagers = [...new Set(
      [...doc.querySelectorAll('a[href*="__doPostBack"]')]
        .map((a) => (a.getAttribute('href').match(/__doPostBack\('([^']+)'/) || [])[1])
        .filter((t) => t && /ucOtherEvents.*repPages/.test(t)),
    )];
    const inputs = [...doc.querySelectorAll('input[name]')];
    for (const tg of pagers) {
      const p = new URLSearchParams();
      for (const i of inputs) p.set(i.name, i.value || '');
      p.set('__EVENTTARGET', tg);
      p.set('__EVENTARGUMENT', '');
      const html = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p.toString() }).then((r) => r.text());
      const d = parseDoc(new DOMParser().parseFromString(html, 'text/html'));
      if (d) Object.assign(merged, d);
      await sleep(150);
    }
    return { merged };
  }

  async function run() {
    const targets = await fetch(SRV + '/api/scrape/targets').then((r) => r.json());
    const done = new Set(await fetch(SRV + '/api/scrape/done').then((r) => r.json()));
    const todo = targets.filter((t) => !done.has(t.teamId));
    const prog = (window.__cupProg = { total: todo.length, done: 0, resolved: 0, blocks: 0, current: null, finished: false, stop: false });

    let cblocks = 0;
    for (const t of todo) {
      if (prog.stop) break;
      prog.current = t.teamId;
      let r;
      try { r = await scrapeTeam(t.teamId); } catch { r = { blocked: true }; }

      if (r.blocked) {
        cblocks++;
        prog.blocks++;
        await sleep(Math.min(90000, 8000 * cblocks)); // escalating backoff on rate-limit blocks
        try { r = await scrapeTeam(t.teamId); } catch { r = { blocked: true }; }
        if (r.blocked) { await sleep(30000); continue; } // still blocked: leave for a later resume pass
      }
      cblocks = 0;

      const merged = r.merged || {};
      const recs = Object.entries(merged)
        .filter(([s]) => t.seasons.includes(Number(s)))
        .map(([s, v]) => ({ teamId: t.teamId, season: Number(s), userId: v.userId, name: v.name }));
      // Even a 0-result team is marked done (sentinel) so it isn't re-scraped; ingest ignores userId 0.
      const post = recs.length ? recs : [{ teamId: t.teamId, season: 0, userId: 0, name: '' }];
      try { await fetch(SRV + '/api/scrape/results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(post) }); } catch {}
      prog.done++;
      prog.resolved += recs.length;
      await sleep(300 + Math.random() * 300);
    }
    prog.finished = true;
  }

  window.__cupLoop = run();
})();
'cup scraper started';
