import { prisma } from '../db/client.js';
import { bakeStatic } from '../sync/bake.js';

/**
 * Standalone static bake. Thin wrapper over bakeStatic() (server/src/sync/bake.ts) — the same
 * function the "refresh latest" script re-bakes with. Set OUT to the web's public/data dir.
 */
const out = process.env.OUT ?? '../web/public/data';
const r = await bakeStatic(out);
console.log(`baked ${r.managers} managers, ${r.leagues} leagues, ${r.champions} champion rows -> ${out}`);
console.log(`baked ${r.cups} countries' cups, ${r.cupFinals} cup finals -> ${out}/cups.json`);
await prisma.$disconnect();
