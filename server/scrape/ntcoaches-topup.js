(() => {
const SRV = 'http://localhost:3001';
const TEAMS = [3222, 3126, 3134, 3247, 3015, 3306, 3198, 3184, 3190, 3031, 3130, 3085, 3108, 3216, 3228, 3308, 3300, 3224, 3087, 3260, 3218, 3150, 3301, 3230, 3104];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const href = (el) => (el && el.getAttribute('href')) || '';
// Hattrick prints dates in the ACCOUNT's chosen format: 26.02.2002 for some, 26-08-2006 for
// others. Match any separator and normalise to dots, which is what the committed
// worldcup-coaches.json seed and CoachTenure use. A dot-only matcher silently yields zero rows.
const DATE = /(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})/;
const pad = (n) => (n.length < 2 ? '0' + n : n);
const scrapeTeam = async (teamId) => {
const res = await fetch('/en/Club/NationalTeam/NTFormerCoaches.aspx?teamId=' + teamId);
const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
const out = [];
// Don't filter on cell count: the fetched page carries the site shell's hidden shop/payment
// tables too, so identify a tenure row by "has a date cell", not by its shape.
for (const tr of doc.querySelectorAll('tr')) {
const cells = [...tr.querySelectorAll('td')];
if (!cells.length) continue;
const dc = cells.find((c) => DATE.test(c.textContent.trim()));
if (!dc) continue;
const m = dc.textContent.trim().match(DATE);
const a = [...tr.querySelectorAll('a')].find((x) => href(x).indexOf('userId=') >= 0);
const other = cells.filter((c) => c !== dc).map((c) => c.textContent.trim()).filter(Boolean);
out.push({
teamId: teamId,
date: pad(m[1]) + '.' + pad(m[2]) + '.' + m[3],
userId: a ? Number((href(a).match(/userId=(\d+)/) || [])[1]) || 0 : 0,
name: a ? a.textContent.trim() : (other[0] || ''),
});
}
return out.length ? out : null;
};
const download = (rows) => {
const blob = new Blob([rows.map((r) => JSON.stringify(r)).join('\n') + '\n'], { type: 'application/x-ndjson' });
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = 'ntcoaches.jsonl';
document.body.appendChild(a);
a.click();
a.remove();
};
const run = async () => {
const rows = (window.__ncRows = []);
const prog = (window.__ncProg = { total: TEAMS.length, done: 0, tenures: 0, current: null, finished: false, stop: false });
for (const teamId of TEAMS) {
if (prog.stop) break;
prog.current = teamId;
let got = null;
try { got = await scrapeTeam(teamId); } catch (e) { got = null; }
if (!got) { await sleep(15000); try { got = await scrapeTeam(teamId); } catch (e) { got = null; } }
if (!got) { console.warn('[ntcoaches] team ' + teamId + ': blocked, skipped'); continue; }
rows.push(...got);
try { await fetch(SRV + '/api/scrape/results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(got) }); } catch (e) {}
prog.done++;
prog.tenures += got.length;
console.log('[ntcoaches] team ' + teamId + ': ' + got.length + ' tenures');
await sleep(300 + Math.random() * 300);
}
prog.finished = true;
if (rows.length) download(rows);
console.log('[ntcoaches] done - ' + rows.length + ' tenure rows in window.__ncRows');
};
window.__ncLoop = run();
})();
