/*
 * Regional national-team cups scraper — paste into the console of a logged-in www.hattrick.org tab.
 *
 * Walks Africa / America / Asia and Oceania / Europe / Nations Cup: for each, it opens
 * World/WorldCup/Cup.aspx?cupId=X, reads the SEASON dropdown to learn which seasons that cup has,
 * then fetches every season and parses its podium.
 *
 * Standalone by design — no local server required. Results are collected in window.__ntRows and
 * downloaded as ntcups.jsonl when it finishes, ready for:
 *     IN=<downloaded ntcups.jsonl> npm run sync:ntcups -w server
 * If the dev server IS running with SCRAPE_PHASE=ntcups it also posts each cup to
 * /api/scrape/results as it completes (and skips cups already in /done, so a re-run resumes);
 * when the server isn't reachable those calls are skipped silently and the download still happens.
 *
 * Parsing notes, from server/samples/ntcup-europe-s41.html:
 *  - The champion comes from `.podium` — its three child divs are winner, runner-up, and third,
 *    and the THIRD one holds BOTH losing semi-finalists (joint 3rd/4th), so it can carry 2 names.
 *    Slot order is DOM order, not visual podium order (verified against the Final in the sample).
 *  - Each podium entry links the nation twice: League.aspx?LeagueID=N (the country) and
 *    NationalTeam.aspx?teamId=N (the NT entity). The teamId is what coach attribution needs.
 *  - The play-off tree is inside a declarative shadow root, so a DOMParser'd document cannot see
 *    it. Never parse the final from there — the podium is light DOM and always present.
 *  - An unfinished season has no podium; it's still recorded (champion null) so the row exists and
 *    refreshes to a champion on a later run.
 *
 * Watch window.__ntProg; stop with window.__ntProg.stop = true.
 */
(() => {
  const SRV = 'http://localhost:3001';

  // Mirrors NT_CUPS in server/src/sync/ntCups.ts. The World Cup (5001315) and Contender League
  // (6244933) share the same dropdown but are deliberately excluded — the World Cup keeps its
  // History.aspx roll of honour, so scraping it here would double-count every senior title.
  const CUPS = [
    { cupId: 5001278, name: 'Africa Cup' },
    { cupId: 5001277, name: 'America Cup' },
    { cupId: 5001279, name: 'Asia and Oceania Cup' },
    { cupId: 5001273, name: 'Europe Cup' },
    { cupId: 5001319, name: 'Nations Cup' },
  ];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

  /** "<b>Label:</b> value" paragraphs in the tournament info block. */
  function infoValue(doc, label) {
    for (const p of doc.querySelectorAll('p')) {
      const b = p.querySelector('b');
      if (!b) continue;
      if (new RegExp(`^${label}\\s*:?$`, 'i').test(text(b))) return text(p).replace(text(b), '').replace(/^:\s*/, '').trim();
    }
    return null;
  }

  /** One podium slot -> the nations in it (the 3rd slot holds two). */
  function podiumNations(slot) {
    if (!slot) return [];
    return [...slot.querySelectorAll('.podium-name > div')]
      .map((d) => {
        const nt = d.querySelector('a[href*="teamId="]');
        const lg = d.querySelector('a[href*="LeagueID="]');
        return {
          name: text(nt) || (nt && nt.getAttribute('title')) || '',
          teamId: nt ? Number((nt.getAttribute('href').match(/teamId=(\d+)/) || [])[1]) || null : null,
          leagueId: lg ? Number((lg.getAttribute('href').match(/LeagueID=(\d+)/i) || [])[1]) || null : null,
        };
      })
      .filter((n) => n.name);
  }

  /** The <h1> ships as the placeholder "Loading..." and is filled in client-side, so a fetched copy
   *  never has the real title. The tournament dropdown's selected option does, in the server HTML. */
  function cupTitle(doc, cupId) {
    const sel = [...doc.querySelectorAll('select')].find((s) => (s.id || '').indexOf('ddlTournaments') >= 0);
    const opt = sel && ([...sel.querySelectorAll('option')].find((o) => Number(o.value) === cupId) || sel.querySelector('option[selected]'));
    const fromDropdown = text(opt);
    if (fromDropdown) return fromDropdown;
    const known = CUPS.find((c) => c.cupId === cupId);
    return known ? known.name : String(cupId);
  }

  function parseSeasonPage(doc, cupId, season) {
    const cupName = cupTitle(doc, cupId);
    const host = text(doc.querySelector('.byline a[href*="NationalTeam.aspx"]')) || null;
    const podium = doc.querySelector('.podium');
    const slots = podium ? [...podium.children] : [];
    const first = podiumNations(slots[0])[0] || null;
    const second = podiumNations(slots[1])[0] || null;
    const third = podiumNations(slots[2]);

    return {
      teamId: cupId, // the /done dedup key — this phase scrapes one cup at a time, not one team
      cupId,
      season,
      cupName,
      host,
      status: infoValue(doc, 'Status'),
      startedDate: infoValue(doc, 'Started on'),
      finalDate: infoValue(doc, 'Final'),
      champion: first ? first.name : null,
      championTeamId: first ? first.teamId : null,
      championLeagueId: first ? first.leagueId : null,
      runnerUp: second ? second.name : null,
      thirdFourth: third.map((n) => n.name),
    };
  }

  async function getDoc(url) {
    const res = await fetch(url);
    const html = await res.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  /** Season numbers offered for this cup, in the dropdown's own order. */
  function seasonsOf(doc) {
    const sel = doc.querySelector('select[id*="ddlSeasons"]');
    if (!sel) return [];
    return [...sel.querySelectorAll('option')].map((o) => Number(o.value)).filter((n) => Number.isFinite(n));
  }

  async function scrapeCup(cupId) {
    const base = `/en/World/WorldCup/Cup.aspx?cupId=${cupId}`;
    const first = await getDoc(base);
    const seasons = seasonsOf(first);
    if (!seasons.length) return { blocked: true };

    const out = [];
    for (const season of seasons) {
      const doc = await getDoc(`${base}&season=${season}`);
      out.push(parseSeasonPage(doc, cupId, season));
      window.__ntProg.seasons++;
      await sleep(300 + Math.random() * 300);
    }
    return { rows: out };
  }

  /** Best-effort only: no dev server (or a different phase) simply means file-only output. */
  async function serverGet(path, fallback) {
    try {
      const r = await fetch(SRV + path);
      return r.ok ? await r.json() : fallback;
    } catch { return fallback; }
  }

  function download(rows) {
    const blob = new Blob([rows.map((r) => JSON.stringify(r)).join('\n') + '\n'], { type: 'application/x-ndjson' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ntcups.jsonl';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  async function run() {
    const done = new Set(await serverGet('/api/scrape/done', []));
    const todo = CUPS.filter((c) => !done.has(c.cupId));
    const rows = (window.__ntRows = []);
    const prog = (window.__ntProg = { total: todo.length, done: 0, seasons: 0, blocks: 0, current: null, finished: false, stop: false });

    let cblocks = 0;
    for (const c of todo) {
      if (prog.stop) break;
      prog.current = c.name;
      let r;
      try { r = await scrapeCup(c.cupId); } catch { r = { blocked: true }; }

      if (r.blocked) {
        cblocks++;
        prog.blocks++;
        await sleep(Math.min(90000, 8000 * cblocks));
        try { r = await scrapeCup(c.cupId); } catch { r = { blocked: true }; }
        if (r.blocked) { await sleep(30000); continue; }
      }
      cblocks = 0;

      const got = r.rows || [];
      rows.push(...got);
      if (got.length) {
        try {
          await fetch(SRV + '/api/scrape/results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(got) });
        } catch { /* no server — the download at the end is the delivery path */ }
      }
      prog.done++;
      console.log(`[ntcups] ${c.name}: ${got.length} season(s), ${got.filter((x) => x.champion).length} decided`);
      await sleep(500 + Math.random() * 500);
    }

    prog.finished = true;
    if (rows.length) download(rows);
    console.log(`[ntcups] finished — ${rows.length} cup-season(s) in window.__ntRows`);
    return rows;
  }

  window.__ntLoop = run();
})();
'nt cups scraper started — watch window.__ntProg, results land in window.__ntRows';
