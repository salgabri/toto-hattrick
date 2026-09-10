import '../config/env.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import evidence from '../data/recovered-cup-final-evidence.json' with { type: 'json' };
import { prisma } from '../db/client.js';
import { applyCupFinalRecovery, planCupFinalRecovery } from '../sync/recoverCupFinals.js';

// Run from server/: node dist/scripts/recover-cup-finals.js [--apply]
// Default is a DB-read-only plan; no CHPP calls. Apply adds only still-absent, verified winners.
const apply = process.argv.includes('--apply');
const unknown = process.argv.slice(2).filter(a => a !== '--apply');
if (unknown.length) throw new Error(`Unknown arguments: ${unknown.join(', ')}`);
try {
  const plans = await planCupFinalRecovery(evidence);
  if (apply && plans.some(p => p.status === 'conflict')) throw new Error('Conflicting finals exist; no changes applied');
  const outcome = apply ? await applyCupFinalRecovery(plans) : undefined;
  const out = fileURLToPath(new URL(`../../../.scrape/cup-final-recovery/${apply ? 'applied' : 'dry-run'}.json`, import.meta.url));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), apply, outcome, plans }, null, 2));
  const counts = Object.fromEntries(['ready', 'already-stored', 'no-winner', 'unresolved', 'conflict'].map(status => [status, plans.filter(p => p.status === status).length]));
  console.log(JSON.stringify({ apply, ...counts, outcome, out }, null, 2));
} finally { await prisma.$disconnect(); }
