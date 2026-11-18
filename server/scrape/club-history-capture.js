/*
 * Complete Club History capture for winner attribution (docs/HISTORICAL_WINNER_RECOVERY.md format).
 * Run in a www*.hattrick.org tab (javascript_tool); Club History is public, so no sign-in is needed.
 * Defines window.__htHistory:
 *   readClub(teamId)            -> { teamId, complete, sourceURL, pages: [{ page, sourceURL, title, rows: [{ text, links }] }] }
 *                                  Reads page 1 by GET and every further page by ASP.NET postback, using the
 *                                  ViewState of the page whose pager showed that page number. A page whose
 *                                  rendered page number differs from the requested one marks the club incomplete.
 *   start(receiver)             -> reads every target from <receiver>/targets not yet in <receiver>/done and
 *                                  POSTs each club to <receiver>/results; one page per 1.2–2 s.
 *   status()                    -> progress.
 * Rows are the innermost <tr> elements of the ucOtherEvents container (season headers included), with exact
 * text and link destinations. Club History dates render in the account's format (dots or dashes).
 */
(() => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const pace = () => sleep(1200 + Math.random() * 800);
  const clean = text => text.replace(/\s+/g, ' ').trim();
  const parse = html => new DOMParser().parseFromString(html, 'text/html');
  const container = doc => doc.querySelector('[id*="ucOtherEvents"]');
  const rowsOf = doc => [...container(doc).querySelectorAll('tr')].filter(tr => !tr.querySelector('tr'))
    .map(tr => ({ text: clean(tr.textContent), links: [...tr.querySelectorAll('a')].map(a => ({ text: clean(a.textContent), href: a.getAttribute('href') || '' })) }))
    .filter(row => row.text);
  const currentPage = doc => Number(container(doc).querySelector('[id*="ucPagerTop"] a.page[disabled] strong, [id*="ucPagerTop"] strong')?.textContent.trim() || 1);
  const pagerLinks = doc => [...container(doc).querySelectorAll('a[id*="ucPagerTop_repPages"]')].map(a => ({
    page: Number(a.textContent.trim()), target: ((a.getAttribute('href') || '').match(/__doPostBack\('([^']+)'/) || [])[1] })).filter(link => link.page > 0 && link.target);
  async function load(url, init) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      // Club History is public: a signed-out page carries a hidden login form, so only the
      // events container decides whether a real history page arrived.
      const response = await fetch(url, { credentials: 'include', ...init });
      const doc = parse(await response.text());
      if (response.ok && container(doc)) return doc;
      await sleep(15000 * attempt); // rate limit or challenge page: back off
    }
    throw new Error('history page unavailable');
  }
  async function readClub(teamId) {
    const url = `/en/Club/History/?teamId=${teamId}`;
    const sourceURL = `https://www.hattrick.org${url}`;
    const first = await load(url);
    const pages = new Map([[1, { page: 1, sourceURL, title: first.title, rows: rowsOf(first) }]]);
    let complete = currentPage(first) === 1;
    const queue = [first];
    while (queue.length) {
      const doc = queue.shift();
      // Post only the hidden page state: a visible form's submit button (e.g. the signed-out
      // login box) would make ASP.NET handle that button instead of the pager postback.
      const form = [...doc.querySelectorAll('input[type=hidden][name]')];
      for (const link of pagerLinks(doc)) {
        if (pages.has(link.page)) continue;
        await pace();
        const body = new URLSearchParams();
        for (const input of form) body.set(input.name, input.value || '');
        body.set('__EVENTTARGET', link.target);
        body.set('__EVENTARGUMENT', '');
        const next = await load(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
        if (currentPage(next) !== link.page) { complete = false; continue; }
        pages.set(link.page, { page: link.page, sourceURL, title: next.title, rows: rowsOf(next) });
        queue.push(next);
      }
    }
    const numbers = [...pages.keys()].sort((a, b) => a - b);
    complete = complete && numbers.every((page, index) => page === index + 1);
    return { teamId, complete, sourceURL, capturedAt: new Date().toISOString(), pages: numbers.map(page => pages.get(page)) };
  }
  const state = { total: 0, done: 0, failed: [], posted: 0, finished: false, stop: false, signedOut: false, current: null };
  window.__htHistory = {
    readClub,
    start(receiver) {
      if (state.total && !state.finished) return 'already running';
      Object.assign(state, { total: 0, done: 0, failed: [], posted: 0, finished: false, stop: false, signedOut: false });
      (async () => {
        const targets = await (await fetch(`${receiver}/targets`)).json();
        const done = new Set(await (await fetch(`${receiver}/done`)).json());
        const todo = targets.filter(target => !done.has(target.teamId));
        state.total = todo.length;
        for (const target of todo) {
          if (state.stop) break;
          state.current = target.teamId;
          try {
            const history = await readClub(target.teamId);
            const record = { ...history, leagueId: target.leagueId ?? undefined, club: target.club };
            const response = await fetch(`${receiver}/results`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) });
            if (!response.ok) throw new Error(`receiver ${response.status}`);
            state.posted++;
          } catch (error) {
            state.failed.push({ teamId: target.teamId, error: String(error.message) });
          }
          state.done++;
          await pace();
        }
        state.finished = true;
      })();
      return 'started';
    },
    status: () => ({ ...state, failed: state.failed.slice(-5), failedCount: state.failed.length }),
  };
  return 'window.__htHistory ready';
})();
