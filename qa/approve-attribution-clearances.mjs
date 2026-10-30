// Turn a reviewed proposal into the committed clearance manifest that `update clear` accepts.
// Run it only after the review. It writes one new file and never overwrites one.
//
//   node qa/approve-attribution-clearances.mjs --proposal qa/pre-signup-attribution-clearances.proposed.json \
//     --reviewed-at 2026-10-31 [--confidence high] \
//     --out server/src/data/reviewed-attribution-clearances-2026-10-30.json
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({ options: {
  proposal: { type: 'string' }, out: { type: 'string' }, 'reviewed-at': { type: 'string' },
  confidence: { type: 'string', default: 'all' },
} });
if (!args.proposal || !args.out || !/^\d{4}-\d{2}-\d{2}$/.test(args['reviewed-at'] ?? ''))
  throw new Error('Usage: --proposal <file> --reviewed-at YYYY-MM-DD --out server/src/data/reviewed-attribution-clearances-<name>.json [--confidence high|all]');
if (!['high', 'all'].includes(args.confidence)) throw new Error('--confidence must be high or all');
if (!/(^|[\\/])server[\\/]src[\\/]data[\\/]reviewed-attribution-clearances-[a-z0-9-]+\.json$/.test(args.out))
  throw new Error('--out must be server/src/data/reviewed-attribution-clearances-<name>.json');

const proposal = JSON.parse(readFileSync(args.proposal, 'utf8'));
if (proposal.format !== 'proposed-attribution-clearance-v1') throw new Error('Not a proposed attribution clearance file');
const { format, status, records, ...header } = proposal;
const kept = records.filter(record => args.confidence === 'all' || record.confidence === 'high')
  .map(record => ({ ...record, reviewedAt: args['reviewed-at'] }));
if (!kept.length) throw new Error('No records selected');
const head = JSON.stringify({ format: 'reviewed-attribution-clearance-v1', status: 'reviewed', ...header }, null, 1).replace(/\n}$/, '');
// Same one-record-per-line layout as the proposal; `update clear` re-validates every record.
writeFileSync(args.out, `${head},\n "records": [\n${kept.map(record => `  ${JSON.stringify(record)}`).join(',\n')}\n ]\n}\n`, { flag: 'wx' });
console.log(JSON.stringify({ out: args.out, records: kept.length, droppedForConfidence: records.length - kept.length }));
