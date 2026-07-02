/**
 * Copy the flag SVGs we actually use from the `flag-icons` package into public/flags/.
 *
 * The set of codes is derived from src/aggregate/flags.ts (both ISO maps), so adding a country
 * there + re-running this keeps the on-disk flags in sync. Self-hosting keeps the static archive
 * free of any runtime CDN dependency.
 *
 *   npm run flags:sync -w web
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const webRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
const flagsTs = path.join(webRoot, 'src/aggregate/flags.ts');
// Locate flag-icons wherever npm hoisted it (root or web node_modules).
const require = createRequire(import.meta.url);
const srcDir = path.join(path.dirname(require.resolve('flag-icons/package.json')), 'flags/4x3');
const outDir = path.join(webRoot, 'public/flags');

const src = fs.readFileSync(flagsTs, 'utf8');
const mapRegion = src.split('export const NATIONALITY_ISO')[1].split('/** ')[0];
const codes = new Set();
for (const m of mapRegion.matchAll(/:\s*'(gb-[a-z]+|[a-z]{2})'/g)) codes.add(m[1]);
const wanted = [...codes].sort();

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const missing = [];
let copied = 0;
for (const c of wanted) {
  const f = path.join(srcDir, `${c}.svg`);
  if (fs.existsSync(f)) {
    fs.copyFileSync(f, path.join(outDir, `${c}.svg`));
    copied++;
  } else missing.push(c);
}

console.log(`flags:sync — ${copied}/${wanted.length} copied to public/flags`);
if (missing.length) {
  console.error(`  MISSING from flag-icons: ${missing.join(', ')}`);
  process.exit(1);
}
