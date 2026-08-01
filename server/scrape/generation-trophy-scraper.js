/*
 * "Heroes of YYYY Trophy" scraper — run in a logged-in www88.hattrick.org tab (paste in the
 * console). 23 perpetual cohorts, one launched per real-world year since 2004, each recurring on
 * its own season counter forever. For each cohort: fetch Tournament.aspx to discover the real name
 * and current season N, then fetch TournamentHistory.aspx?season=1..N for each season's winner from
 * .tournamentBoxBody (team link + "Managed by" manager link). POSTs each cohort's batch to
 * /api/scrape/results (-> generation-owners.jsonl) as it completes. Self-running; watch
 * window.__genProg; stop with window.__genProg.stop = true.
 */
(() => {
  const SRV = 'http://localhost:3001';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const COHORTS = {
    2004: 3116034, 2005: 3116057, 2006: 3116058, 2007: 3116059, 2008: 3116060,
    2009: 3116061, 2010: 3116062, 2011: 3116063, 2012: 3116064, 2013: 3116065,
    2014: 3116067, 2015: 3116068, 2016: 3116070, 2017: 3116071, 2018: 3195190,
    2019: 3427550, 2020: 3704867, 2021: 4945473, 2022: 5255320, 2023: 5555820,
    2024: 5873608, 2025: 6320224, 2026: 6758706,
  };

  async function fetchDoc(url) {
    const res = await fetch(url);
    const html = await res.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  // Tournament.aspx heading text looks like "Season 12 Heroes of 2023 Trophy (5555820)".
  async function cohortMeta(cupId) {
    const doc = await fetchDoc(`/Club/ArenaHub/Tournaments/Tournament.aspx?tournamentId=${cupId}`);
    const text = doc.body.innerText.replace(/\s+/g, ' ');
    const m = text.match(/Season (\d+)\s+([^(]+?)\s*\((\d+)\)/);
    if (!m) return null;
    return { season: Number(m[1]), name: m[2].trim() };
  }

  async function seasonWinner(cupId, season) {
    const doc = await fetchDoc(`/Club/ArenaHub/Tournaments/TournamentHistory.aspx?tournamentId=${cupId}&season=${season}`);
    const box = doc.querySelector('.tournamentBoxBody');
    if (!box) return null;
    const teamA = box.querySelector('a[href*="/Club/?TeamID="], a[href*="/Club/?teamId="]');
    const mgrA = box.querySelector('a[href*="/Club/Manager/"]');
    if (!teamA || !mgrA) return null;
    const teamId = Number((teamA.getAttribute('href').match(/TeamID=(\d+)/i) || [])[1]);
    const userId = Number((mgrA.getAttribute('href').match(/userId=(\d+)/i) || [])[1]);
    if (!teamId || !userId) return null;
    return { teamId, team: teamA.textContent.trim(), userId, manager: mgrA.textContent.trim() };
  }

  async function run() {
    const cohortIds = Object.values(COHORTS);
    const prog = (window.__genProg = {
      totalCohorts: cohortIds.length, cohortsDone: 0, seasonsDone: 0, resolved: 0,
      currentCohort: null, currentSeason: null, finished: false, stop: false, errors: [],
    });

    for (const cupId of cohortIds) {
      if (prog.stop) break;
      prog.currentCohort = cupId;
      let meta;
      try { meta = await cohortMeta(cupId); } catch (e) { prog.errors.push(`meta ${cupId}: ${e}`); continue; }
      if (!meta) { prog.errors.push(`meta ${cupId}: could not parse "Season N ... (id)" heading`); continue; }
      await sleep(300);

      const batch = [];
      for (let season = 1; season <= meta.season; season++) {
        if (prog.stop) break;
        prog.currentSeason = season;
        let w;
        try { w = await seasonWinner(cupId, season); } catch (e) { prog.errors.push(`${cupId} S${season}: ${e}`); w = null; }
        if (w) { batch.push({ cupId, name: meta.name, season, ...w }); prog.resolved++; }
        prog.seasonsDone++;
        await sleep(250 + Math.random() * 200);
      }

      if (batch.length) {
        try { await fetch(SRV + '/api/scrape/results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(batch) }); } catch (e) { prog.errors.push(`post ${cupId}: ${e}`); }
      }
      prog.cohortsDone++;
    }
    prog.finished = true;
  }

  window.__genLoop = run();
})();
'generation trophy scraper started';
