/*
 * National-team coaching-history scraper — run in a logged-in www.hattrick.org tab. Fetches
 * NTFormerCoaches.aspx?teamId=X for each target (a World Cup champion nation's senior or youth
 * team) and parses its [Date, User] tenure table: each row is the date a new coach TOOK OVER, so
 * the coach in charge when a World Cup edition finished is whoever's tenure started most recently
 * on/before that date (matched server-side in sync/worldCup.ts). "Retired user" rows have no
 * manager link — recorded with userId 0, same UNKNOWN sentinel used everywhere else.
 *
 * POSTs each team's full tenure list to /api/scrape/results (-> worldcup-coaches.jsonl) as it
 * completes. Self-running, resume-safe (skips /done). Watch window.__wcProg; stop with
 * window.__wcProg.stop = true.
 */
(() => {
  const SRV = 'http://localhost:3001';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Hattrick prints dates in the ACCOUNT's chosen format — 26.02.2002 on one login, 26-08-2006 on
  // another. Match any separator and normalise to the dots that CoachTenure and the committed
  // worldcup-coaches.json seed use; a dot-only matcher silently produces zero tenures.
  const DATE = /(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})/;
  const pad = (n) => (n.length < 2 ? '0' + n : n);

  async function scrapeTeam(teamId) {
    const url = `/en/Club/NationalTeam/NTFormerCoaches.aspx?teamId=${teamId}`;
    const res = await fetch(url);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // NB: identify a tenure row by "contains a date", not by cell count — the fetched page also
    // carries the site shell's hidden shop/payment tables, whose rows have 2-3 cells too.
    const out = [];
    for (const tr of doc.querySelectorAll('tr')) {
      const cells = [...tr.querySelectorAll('td')];
      if (!cells.length) continue;
      const dateCell = cells.find((c) => DATE.test(c.textContent.trim()));
      if (!dateCell) continue;
      const m = dateCell.textContent.trim().match(DATE);
      const a = tr.querySelector('a[href*="userId="]');
      const other = cells.filter((c) => c !== dateCell).map((c) => c.textContent.trim()).filter(Boolean);
      const date = `${pad(m[1])}.${pad(m[2])}.${m[3]}`;
      if (a) {
        const userId = Number((a.getAttribute('href').match(/userId=(\d+)/) || [])[1]);
        out.push({ teamId, date, userId, name: a.textContent.trim() });
      } else {
        out.push({ teamId, date, userId: 0, name: other[0] || '' });
      }
    }
    if (out.length === 0) return { blocked: true };
    return { rows: out };
  }

  async function run() {
    const targets = await fetch(SRV + '/api/scrape/targets').then((r) => r.json());
    const done = new Set(await fetch(SRV + '/api/scrape/done').then((r) => r.json()));
    const todo = targets.filter((t) => !done.has(t.teamId));
    const prog = (window.__wcProg = { total: todo.length, done: 0, resolved: 0, blocks: 0, current: null, finished: false, stop: false });

    let cblocks = 0;
    for (const t of todo) {
      if (prog.stop) break;
      prog.current = t.label;
      let r;
      try { r = await scrapeTeam(t.teamId); } catch { r = { blocked: true }; }

      if (r.blocked) {
        cblocks++;
        prog.blocks++;
        await sleep(Math.min(90000, 8000 * cblocks));
        try { r = await scrapeTeam(t.teamId); } catch { r = { blocked: true }; }
        if (r.blocked) { await sleep(30000); continue; }
      }
      cblocks = 0;

      const rows = r.rows || [];
      const post = rows.length ? rows : [{ teamId: t.teamId, date: '', userId: 0, name: '' }];
      try { await fetch(SRV + '/api/scrape/results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(post) }); } catch {}
      prog.done++;
      prog.resolved += rows.length;
      await sleep(300 + Math.random() * 300);
    }
    prog.finished = true;
  }

  window.__wcLoop = run();
})();
'world cup coaches scraper started';
