/*
 * National Coach elections scraper — run in a logged-in www.hattrick.org tab. Fetches
 * World/Elections/History.aspx?LeagueID=X for each target (a tracked country) and parses its
 * "World Cup | Host | Winner | Votes" table. Unlike the coach-tenure page, the Winner cell links
 * the userId directly — "A former user" (no link) is the same unattributed sentinel used
 * everywhere else. A country can show the SAME "World Cup N" row twice (a mid-cycle re-election),
 * which is intentional — every row is kept, not deduped.
 *
 * POSTs each country's full roll to /api/scrape/results (-> elections.jsonl) as it completes.
 * Self-running, resume-safe (skips /done). "teamId" in the target/result shape is actually a
 * leagueId here. Watch window.__elProg; stop with window.__elProg.stop = true.
 */
(() => {
  const SRV = 'http://localhost:3001';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function findElectionsTable(doc) {
    const tables = [...doc.querySelectorAll('table')];
    for (const t of tables) {
      const headerText = (t.querySelector('tr')?.textContent || '').trim();
      if (/World Cup/i.test(headerText) && /Host/i.test(headerText) && /Winner/i.test(headerText)) return t;
    }
    return null;
  }

  async function scrapeCountry(leagueId, label) {
    const url = `/en/World/Elections/History.aspx?LeagueID=${leagueId}`;
    const res = await fetch(url);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = findElectionsTable(doc);
    if (!table) return { blocked: true };

    const rows = [...table.querySelectorAll('tr')].slice(1);
    const out = [];
    for (const tr of rows) {
      const cells = [...tr.querySelectorAll('td')];
      if (cells.length < 4) continue;
      const cycleText = cells[0].textContent.trim();
      const m = cycleText.match(/World Cup (\d+)/i);
      if (!m) continue;
      const edition = Number(m[1]);
      const host = cells[1].textContent.trim();
      const a = cells[2].querySelector('a[href*="userId="]');
      const winnerUserId = a ? Number((a.getAttribute('href').match(/userId=(\d+)/) || [])[1]) : null;
      const winnerUserName = a ? a.textContent.trim() : null;
      const votes = cells[3].textContent.trim() || null;
      out.push({ leagueId, countryName: label, edition, host, winnerUserId, winnerUserName, votes });
    }
    return { rows: out };
  }

  async function run() {
    const targets = await fetch(SRV + '/api/scrape/targets').then((r) => r.json());
    const done = new Set(await fetch(SRV + '/api/scrape/done').then((r) => r.json()));
    const todo = targets.filter((t) => !done.has(t.teamId));
    const prog = (window.__elProg = { total: todo.length, done: 0, resolved: 0, blocks: 0, current: null, finished: false, stop: false });

    let cblocks = 0;
    for (const t of todo) {
      if (prog.stop) break;
      prog.current = t.label;
      let r;
      try { r = await scrapeCountry(t.teamId, t.label); } catch { r = { blocked: true }; }

      if (r.blocked) {
        cblocks++;
        prog.blocks++;
        await sleep(Math.min(90000, 8000 * cblocks));
        try { r = await scrapeCountry(t.teamId, t.label); } catch { r = { blocked: true }; }
        if (r.blocked) { await sleep(30000); continue; }
      }
      cblocks = 0;

      const rows = r.rows || [];
      const post = rows.length ? rows : [{ leagueId: t.teamId, countryName: t.label, edition: 0, host: '', winnerUserId: null, winnerUserName: null, votes: null }];
      try { await fetch(SRV + '/api/scrape/results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(post) }); } catch {}
      prog.done++;
      prog.resolved += rows.length;
      await sleep(300 + Math.random() * 300);
    }
    prog.finished = true;
  }

  window.__elLoop = run();
})();
'elections scraper started';
