import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** Every module the compiled file loads before any of its code runs (static imports and re-exports). */
function staticGraph(entry: URL): Map<string, string | null> {
  const parents = new Map<string, string | null>();
  const visit = (url: URL, parent: string | null) => {
    const file = fileURLToPath(url);
    if (parents.has(file)) return;
    parents.set(file, parent);
    const source = readFileSync(url, 'utf8');
    for (const match of source.matchAll(/^\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm)) {
      visit(new URL(match[1]!, url), file);
    }
  };
  visit(entry, null);
  return parents;
}

test('the updater entry never loads the shared Prisma client before `run` selects its database', () => {
  // runUpdate() points DATABASE_URL at the isolated working.db and only then imports db/client.js.
  // A client constructed earlier stays bound to .env's database (2026-11-18: the run read dev.db
  // and failed on its missing UpdateSource table), so command modules that need Prisma load lazily.
  const graph = staticGraph(new URL('./update.js', import.meta.url));
  const client = fileURLToPath(new URL('../db/client.js', import.meta.url));
  const chain: string[] = [];
  let file: string | null | undefined = client;
  while (file && graph.has(file)) { chain.unshift(file); file = graph.get(file); }
  assert.deepEqual(chain, [], `db/client.js is statically reachable: ${chain.join(' -> ')}`);
  assert.ok(graph.size > 5, 'the walker must follow the entry\'s real imports');
});
