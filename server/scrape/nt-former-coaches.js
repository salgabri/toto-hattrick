/*
 * Dated national-coach tenure for the weekly assisted update (docs/WEEKLY_UPDATE_PLAYBOOK.md).
 * Run in the built-in browser on a signed-in www*.hattrick.org tab (javascript_tool). Defines
 * window.__htTenure(teamIds): reads Club/NationalTeam/NTFormerCoaches.aspx for each national-team
 * id (oldest entry first, "dd-mm-yyyy name", the user link carries the id; "Retired user" has none)
 * and returns { json, sha256 } where json maps teamId -> { url, capturedAt, entries, entriesSha256,
 * tail } — the --tenure input of update:attribute. Only the last 6 entries travel; the full list is
 * fingerprinted.
 */
(() => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const sha256 = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  window.__htTenure = async teamIds => {
    const out = {};
    for (const teamId of teamIds) {
      const url = `/en/Club/NationalTeam/NTFormerCoaches.aspx?teamId=${teamId}`;
      const doc = new DOMParser().parseFromString(await (await fetch(url, { credentials: 'include' })).text(), 'text/html');
      if (doc.querySelector('input[type=password]')) throw new Error('signed out');
      const entries = [];
      const seen = new Set();
      for (const element of doc.querySelectorAll('tr, li, .boxBody p, .boxBody div')) {
        const text = element.textContent.replace(/\s+/g, ' ').trim();
        if (!/^\d{2}[-.\/]\d{2}[-.\/]\d{4}/.test(text) || text.length > 200 || seen.has(text)) continue;
        seen.add(text);
        const link = [...element.querySelectorAll('a')].find(a => /userId=\d+/i.test(a.getAttribute('href') || ''));
        entries.push({ date: text.slice(0, 10), userId: link ? Number(link.getAttribute('href').match(/userId=(\d+)/i)[1]) : 0,
          name: link ? link.textContent.trim() : text.slice(10).trim(), text });
      }
      out[teamId] = { url: location.origin + url, capturedAt: new Date().toISOString(), entries: entries.length,
        entriesSha256: await sha256(JSON.stringify(entries)), tail: entries.slice(-6) };
      await sleep(1500);
    }
    const json = JSON.stringify(out);
    return { teams: teamIds.length, bytes: new TextEncoder().encode(json).length, sha256: await sha256(json), json };
  };
  return 'window.__htTenure ready';
})();
