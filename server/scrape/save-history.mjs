import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Artifact sink for history rows read through browser DOM inspection. No cookies, headers,
// credentials, or page markup are retained: only the public club events and their links.
const out = fileURLToPath(new URL('../../.scrape/winner-recovery/histories.json', import.meta.url));
export function saveHistory(history) {
  if (!Number.isSafeInteger(history.teamId) || history.teamId <= 0 || !Array.isArray(history.pages)) {
    throw new Error('Expected a club history with a real team id and observed pages');
  }
  mkdirSync(fileURLToPath(new URL('../../.scrape/winner-recovery/', import.meta.url)), { recursive: true });
  const histories = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : [];
  const index = histories.findIndex(h => h.teamId === history.teamId && h.leagueId === history.leagueId);
  const record = { ...history, capturedAt: new Date().toISOString() };
  if (index < 0) histories.push(record); else histories[index] = record;
  writeFileSync(out, JSON.stringify(histories, null, 2));
  return { teamId: history.teamId, pages: history.pages.length, histories: histories.length, out };
}
