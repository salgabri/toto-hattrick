/*
 * National-coach elections read for the weekly assisted update (docs/WEEKLY_UPDATE_PLAYBOOK.md).
 * Run in the built-in browser on a signed-in www*.hattrick.org tab (javascript_tool). Defines
 * window.__htElections:
 *   start(leagueIds, cutoff)  reads World/Elections/History.aspx for each league, one page every
 *                             1.2–2 s, keeping every row of editions >= cutoff and a fingerprint of
 *                             the older rows (row count + first 16 hex of SHA-256 over sorted
 *                             "edition|host|winnerUserId|votes" lines).
 *   status()                  progress, failures, sign-out detection.
 *   chunk(from, to)           compact JSON for results[from..to) by league id, with its SHA-256,
 *                             in the shape server/src/update/electionCapture.ts reads (chunk-N.json).
 *   older(pairs)              full older rows ([edition, host, userId, name, votes]) for
 *                             [leagueId, isYouth] pairs the server reports in needsOlderDetails.
 * Parsing follows server/scrape/elections-scraper.js: two tables (senior, U20/U21) whose youth rows
 * carry "repElectionsU20" in their ids; "A former user" has no userId link.
 */
(() => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const sha256 = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  async function readRows(leagueId) {
    const response = await fetch(`/en/World/Elections/History.aspx?LeagueID=${leagueId}`, { credentials: 'include' });
    if (!response.ok) throw new Error(`http ${response.status}`);
    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (doc.querySelector('input[type=password]')) throw new Error('signed out');
    const tables = [...doc.querySelectorAll('table')].filter(table => {
      const header = (table.querySelector('tr')?.textContent || '').trim();
      return /World Cup/i.test(header) && /Host/i.test(header) && /Winner/i.test(header);
    });
    if (!tables.length) throw new Error('no election tables');
    const rows = [];
    tables.forEach((table, tableIndex) => {
      for (const tr of [...table.querySelectorAll('tr')].slice(1)) {
        const cells = [...tr.querySelectorAll('td')];
        if (cells.length < 4) continue;
        const cycle = cells[0].textContent.trim().match(/World Cup (\d+)/i);
        if (!cycle) continue;
        const link = cells[2].querySelector('a[href*="userId="]');
        const id = tr.id || '';
        rows.push({ edition: Number(cycle[1]), host: cells[1].textContent.trim(),
          userId: link ? Number((link.getAttribute('href').match(/userId=(\d+)/) || [])[1]) : null,
          name: link ? link.textContent.trim() : null, votes: cells[3].textContent.trim() || null,
          youth: /repElections/i.test(id) ? /repElectionsU20/i.test(id) : tableIndex > 0 });
      }
    });
    return rows;
  }
  const state = { total: 0, done: 0, failed: [], results: {}, finished: false, stop: false, signedOut: false };
  window.__htElections = {
    start(leagueIds, cutoff) {
      if (state.total && !state.finished) return 'already running';
      Object.assign(state, { total: leagueIds.length, done: 0, failed: [], results: {}, finished: false, stop: false, signedOut: false, cutoff });
      (async () => {
        for (const leagueId of leagueIds) {
          if (state.stop) break;
          let rows = null;
          for (let attempt = 1; attempt <= 3 && !rows; attempt++) {
            try { rows = await readRows(leagueId); }
            catch (error) { if (String(error.message) === 'signed out') { state.signedOut = true; state.stop = true; break; } await sleep(6000 * attempt); }
          }
          if (rows) {
            const fingerprint = async youth => {
              const lines = rows.filter(row => row.youth === youth && row.edition < cutoff).map(row => `${row.edition}|${row.host}|${row.userId ?? ''}|${row.votes ?? ''}`).sort();
              return [lines.length, (await sha256(lines.join('\n'))).slice(0, 16)];
            };
            const [senior, youth] = [await fingerprint(false), await fingerprint(true)];
            state.results[leagueId] = { t: new Date().toISOString(), c: cutoff, n: rows.length, o: [...senior, ...youth],
              r: rows.filter(row => row.edition >= cutoff).map(row => [row.edition, row.host, row.userId, row.name, row.votes, row.youth ? 1 : 0]) };
          } else state.failed.push(leagueId);
          state.done++;
          await sleep(1200 + Math.random() * 800);
        }
        state.finished = true;
      })();
      return `started ${leagueIds.length}`;
    },
    status: () => ({ total: state.total, done: state.done, failed: state.failed, signedOut: state.signedOut, finished: state.finished }),
    async chunk(from, to) {
      const keys = Object.keys(state.results).map(Number).sort((a, b) => a - b).slice(from, to);
      const json = JSON.stringify(Object.fromEntries(keys.map(key => [key, state.results[key]])));
      return { keys: keys.length, first: keys[0], last: keys.at(-1), bytes: new TextEncoder().encode(json).length, sha256: await sha256(json), json };
    },
    async older(pairs) {
      const out = {};
      for (const [leagueId, youth] of pairs) {
        const rows = await readRows(leagueId);
        out[`${leagueId}${youth ? 'Y' : 'S'}`] = rows.filter(row => row.youth === youth && row.edition < state.cutoff)
          .map(row => [row.edition, row.host, row.userId, row.name, row.votes]);
        await sleep(1500);
      }
      const json = JSON.stringify(out);
      return { pairs: pairs.length, bytes: new TextEncoder().encode(json).length, sha256: await sha256(json), json };
    },
  };
  return 'window.__htElections ready';
})();
