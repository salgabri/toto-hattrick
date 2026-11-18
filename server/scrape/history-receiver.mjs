// Local sink for Club History captures read by club-history-capture.js in a hattrick.org tab.
// Binds 127.0.0.1 only, answers only hattrick.org origins, and appends one JSON line per club.
//
//   node server/scrape/history-receiver.mjs <capture dir> [port=3017]
//
//   GET  /targets  -> <capture dir>/targets.json, as [{ teamId, leagueId, club }]
//   GET  /done     -> team ids already received in <capture dir>/histories.jsonl
//   POST /results  -> appends each posted club record to <capture dir>/histories.jsonl
//   GET  /         -> { ok, out, clubs } status
//
// Then, in the hattrick.org tab: window.__htHistory.start('http://127.0.0.1:<port>').
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';

if (!process.argv[2]) {
  console.error('usage: node history-receiver.mjs <capture dir> [port]');
  process.exit(2);
}
const dir = resolve(process.argv[2]);
const port = Number(process.argv[3] ?? 3017);
const out = join(dir, 'histories.jsonl');
const targetsPath = join(dir, 'targets.json');
const ALLOWED = /^https:\/\/(www\d*\.)?hattrick\.org$/;
const MAX_BODY = 8_000_000;
mkdirSync(dir, { recursive: true });

const doneIds = () => existsSync(out)
  ? [...new Set(readFileSync(out, 'utf8').split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line).teamId; } catch { return null; }
  }).filter(Number.isSafeInteger))]
  : [];

createServer((req, res) => {
  const origin = req.headers.origin ?? '';
  const cors = ALLOWED.test(origin) ? {
    'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Private-Network': 'true',
  } : {};
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(body)); };
  if (req.method === 'OPTIONS') return send(ALLOWED.test(origin) ? 204 : 403, {});
  if (origin && !ALLOWED.test(origin)) return send(403, { error: 'origin not allowed' });
  if (req.method === 'GET' && req.url === '/done') return send(200, doneIds());
  if (req.method === 'GET' && req.url === '/targets') {
    if (!existsSync(targetsPath)) return send(404, { error: 'no targets.json in the capture dir' });
    return send(200, JSON.parse(readFileSync(targetsPath, 'utf8')).map(target => ({ teamId: target.teamId, leagueId: target.leagueId, club: target.club })));
  }
  if (req.method === 'GET') return send(200, { ok: true, out, clubs: doneIds().length });
  if (req.method === 'POST' && req.url === '/results') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > MAX_BODY) req.destroy(); });
    req.on('end', () => {
      try {
        const records = [].concat(JSON.parse(body));
        for (const record of records) {
          if (!Number.isSafeInteger(record.teamId) || record.teamId <= 0 || !Array.isArray(record.pages)) throw new Error('bad record');
        }
        appendFileSync(out, records.map(record => JSON.stringify({ ...record, receivedAt: new Date().toISOString() })).join('\n') + '\n');
        send(200, { ok: true, received: records.length });
      } catch (error) { send(400, { error: String(error.message) }); }
    });
    return;
  }
  send(404, { error: 'not found' });
}).listen(port, '127.0.0.1', () => console.log(`history receiver on http://127.0.0.1:${port} -> ${out}`));
