import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { env } from '../config/env.js';
import { bootstrapArchive, configuredStore, planUpdate, publishPending, repositoryPath, runUpdate, safeFailure } from '../update/runner.js';
import { acknowledgeReviewCaptureManifest, adoptReviewedArchive, checkoutForReview } from '../update/review.js';
import { confirmGitRelease, exportGitRelease, validateGitRelease } from '../update/gitRelease.js';

try {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    'no-fetch': { type: 'boolean', default: false }, publish: { type: 'boolean', default: false }, draft: { type: 'boolean', default: false },
    database: { type: 'string' }, manifest: { type: 'string' }, output: { type: 'string' }, commit: { type: 'string' },
    candidate: { type: 'string' }, previous: { type: 'string' }, 'timeout-ms': { type: 'string' },
  } });
  if (positionals.length !== 1 || (values.publish && values.draft)) throw new Error('Usage: update.ts plan|bootstrap|run|publish|export-git|validate-git|confirm-git|checkout|acknowledge|import [options]');
  switch (positionals[0]) {
    case 'plan': await planUpdate(); break;
    case 'bootstrap': await bootstrapArchive(); break;
    case 'run': await runUpdate({ noFetch: values['no-fetch'], publish: values.publish, draft: values.draft }); break;
    case 'publish': await publishPending(values.publish); break;
    case 'export-git': {
      if (!values.output) throw new Error('export-git requires --output web/public/data');
      const output = resolve(repositoryPath, values.output);
      if (output !== join(repositoryPath, 'web', 'public', 'data'))
        throw new Error('export-git --output must be exactly web/public/data');
      console.log(JSON.stringify(await exportGitRelease({ store: configuredStore(), repositoryPath, outputDataDir: output }), null, 2));
      break;
    }
    case 'validate-git': {
      if (!values.candidate) throw new Error('validate-git requires --candidate and accepts an optional --previous data directory');
      const checked = await validateGitRelease(resolve(values.candidate), values.previous ? resolve(values.previous) : undefined);
      console.log(JSON.stringify({ dataVersion: checked.manifest.dataVersion, codeRevision: checked.manifest.codeRevision,
        versions: checked.versions, sourceCount: checked.manifest.sources.length }, null, 2));
      break;
    }
    case 'confirm-git': {
      if (!values.commit) throw new Error('confirm-git requires --commit with the deployed full Git SHA');
      if (!env.UPDATE_PUBLIC_URL) throw new Error('confirm-git requires UPDATE_PUBLIC_URL');
      if (env.UPDATE_DEPLOY_PROVIDER !== 'vercel' || !env.VERCEL_PROJECT_ID || !env.VERCEL_TOKEN)
        throw new Error('confirm-git requires UPDATE_DEPLOY_PROVIDER=vercel, VERCEL_PROJECT_ID, and VERCEL_TOKEN');
      const timeoutMs = values['timeout-ms'] === undefined ? undefined : Number(values['timeout-ms']);
      console.log(JSON.stringify(await confirmGitRelease({ store: configuredStore(), publicUrl: env.UPDATE_PUBLIC_URL,
        commit: values.commit, timeoutMs, vercelProjectId: env.VERCEL_PROJECT_ID,
        vercelTeamId: env.VERCEL_TEAM_ID, vercelToken: env.VERCEL_TOKEN,
      }), null, 2));
      break;
    }
    case 'checkout':
      if (!values.database) throw new Error('checkout requires --database pointing to a NEW review database');
      console.log(JSON.stringify(await checkoutForReview({ store: configuredStore(), databasePath: resolve(values.database) }), null, 2));
      break;
    case 'acknowledge':
      if (!values.database || !values.manifest)
        throw new Error('acknowledge requires --database and --manifest');
      console.log(JSON.stringify(await acknowledgeReviewCaptureManifest({ databasePath: resolve(values.database), repositoryPath,
        manifestPath: values.manifest }), null, 2));
      break;
    case 'import':
      if (!values.database) throw new Error('import requires --database pointing to a reviewed checkout');
      console.log(JSON.stringify(await adoptReviewedArchive({ store: configuredStore(), databasePath: resolve(values.database), repositoryPath, codeRevision: env.GITHUB_SHA ?? 'local-reviewed-import' }), null, 2));
      break;
    default: throw new Error('Unknown update command');
  }
} catch (error) { console.error(`[update] ${safeFailure(error)}`); process.exitCode = 1; }
