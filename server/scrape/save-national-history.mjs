import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Store only public DOM evidence observed through the logged-in browser: no cookies or tokens.
export function saveNationalHistory(kind, record) {
  if (!['coaches', 'elections', 'cups', 'worldcups', 'profiles'].includes(kind)) throw new Error('Unknown capture kind');
  const id = record.userId ?? record.teamId ?? record.leagueId ?? record.cupId ?? record.isYouth;
  if (!/^(?:\d+|true|false)$/.test(String(id))) throw new Error('A numeric identity or bracket is required');
  const directory = new URL(`../../.scrape/national-winner-recovery/${kind}/`, import.meta.url);
  mkdirSync(fileURLToPath(directory), { recursive: true });
  const path = fileURLToPath(new URL(`${id}.json`, directory));
  const data = { ...record, capturedAt: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(data, null, 2));
  return { path, entries: data.entries?.length ?? data.rows?.length ?? 0 };
}
