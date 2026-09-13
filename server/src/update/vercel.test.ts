import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, deployRelease, digest, type DeployReleaseOptions } from './deploy.js';
import { RELEASE_FILES, type ReleaseManifest } from './release.js';
import { VERCEL_ROUTES } from './vercelRoutes.js';

async function harness(run: (options: DeployReleaseOptions, fake: ReturnType<typeof vercel>) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'hattrick-vercel-'));
  const dataVersion = 'b'.repeat(64);
  const files = new Map<string, Buffer>([
    ['/index.html', Buffer.from('<html><script src="/assets/app.js"></script></html>')],
    ['/assets/app.js', Buffer.from('document.title="Archive";')],
    ['/assets/other.js', Buffer.from('export const route="cups";')],
    ['/assets/app.css', Buffer.from('body{color:#222}')],
  ]);
  const manifest: ReleaseManifest = { schemaVersion: 1, dataVersion, codeRevision: 'rev123', generatedAt: '2026-09-12T05:17:00Z', lastChangedAt: '2026-09-12T05:17:00Z', sources: [], files: {} as ReleaseManifest['files'] };
  for (const name of RELEASE_FILES) {
    const path = `/data/versions/${dataVersion}/${name}`;
    files.set(path, Buffer.from('[]'));
    manifest.files[name] = { path, bytes: 2, sha256: digest(Buffer.from('[]')) };
  }
  files.set('/data/manifest.json', Buffer.from(JSON.stringify(manifest)));
  for (const [path, bytes] of files) {
    await mkdir(join(dir, path.slice(1), '..'), { recursive: true });
    await writeFile(join(dir, path.slice(1)), bytes);
  }
  const fake = vercel(files, manifest);
  let elapsed = 0;
  try {
    await run({ provider: 'vercel', artifactDir: dir, manifest, vercelProjectId: 'prj_123', vercelTeamId: 'team_123', vercelToken: 'APISECRET', vercelProtectionBypass: 'BYPASSSECRET', publicUrl: 'https://archive.test', fetchImpl: fake.fetch, now: () => Date.UTC(2026, 8, 12) + elapsed, sleep: async (ms) => { fake.waits.push(ms); elapsed += ms; } }, fake);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

function vercel(files: Map<string, Buffer>, manifest: ReleaseManifest) {
  const events: string[] = [];
  const waits: number[] = [];
  const uploads = new Map<string, Buffer>();
  const state = {
    published: false, corrupt: '', wrongProject: false, wrongTeam: false, wrongDomain: false,
    unverifiedDomain: false, redirectDomain: false, previewDomain: false, rollingRelease: false,
    unauthorized: false, neverReady: false, deploymentError: false, retry429: false, timeout: false,
    loseCreateResponse: false, losePromoteResponse: false, failPromote: false, promoteUnauthorized: false,
    productionChanged: false, earlyProductionChanged: false, changeProductionOnCreate: false,
    aliasChanged: false, changeAliasOnCreate: false,
    productionMismatch: false, wrongMetadata: false, unsafeUrl: false,
    earlyAlias: false, providerAlias: false, rootDirectory: '', functions: false, lambdaFunction: false,
    malformedLambda: false, malformedLambdaMetadata: false, missingLambdaOutput: false, multipleLambdas: false,
    wrongLambdaEntrypoint: false, draftVerified: false, manifestMismatch: false,
  };
  const outputConfig = Buffer.from(JSON.stringify({ version: 3, routes: VERCEL_ROUTES }));
  const artifactHash = digest(Buffer.from(canonical({
    files: [...files].map(([path, bytes]) => [path, digest(bytes)]).sort(([a], [b]) => a!.localeCompare(b!)),
    outputConfig: digest(outputConfig),
  })));
  const metadata = { archiveDataVersion: manifest.dataVersion, archiveCodeRevision: manifest.codeRevision, archiveArtifactHash: artifactHash };
  const deployment = () => {
    const emptyBuild: Record<string, unknown> = {
      id: 'bld_123', createdAt: state.malformedLambdaMetadata ? 'today' : Date.UTC(2026, 8, 12),
      entrypoint: state.wrongLambdaEntrypoint ? 'api/index.ts' : '.',
      output: state.malformedLambda ? null : state.lambdaFunction ? [{ path: 'api/index.func', functionName: 'index' }] : [],
      readyState: 'READY', readyStateAt: Date.UTC(2026, 8, 12),
    };
    if (state.missingLambdaOutput) delete emptyBuild.output;
    return {
      id: 'dpl_123', projectId: state.wrongProject ? 'prj_wrong' : 'prj_123', ownerId: 'team_123', team: { id: state.wrongTeam ? 'team_wrong' : 'team_123' },
      target: 'production', readyState: state.deploymentError ? 'ERROR' : state.neverReady ? 'BUILDING' : 'READY',
      url: state.unsafeUrl ? 'attacker.test' : 'archive-dpl123.vercel.app',
      alias: state.earlyAlias ? ['archive.test'] : state.providerAlias ? ['archive-team.vercel.app'] : [],
      meta: state.wrongMetadata ? { ...metadata, archiveCodeRevision: 'old' } : metadata,
      functions: state.functions ? { '/api': {} } : null,
      lambdas: state.multipleLambdas ? [emptyBuild, { ...emptyBuild, id: 'bld_456' }] : [emptyBuild],
    };
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    events.push(`${method} ${url.hostname}${url.pathname}`);
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal, 'each request has a timeout');
    assert.ok(!url.href.includes('SECRET'), 'credentials never enter URLs');
    if (url.hostname === 'api.vercel.com') {
      assert.equal(headers.get('Authorization'), 'Bearer APISECRET');
      assert.equal(headers.get('x-vercel-protection-bypass'), null);
      assert.equal(url.searchParams.get('teamId'), 'team_123');
      if (state.timeout) return await new Promise((_resolve, reject) => { init!.signal!.addEventListener('abort', () => reject(new Error('APISECRET timeout')), { once: true }); });
      if (state.unauthorized) return new Response('APISECRET private diagnostics', { status: 401 });
      if (state.retry429) { state.retry429 = false; return new Response('APISECRET throttle', { status: 429, headers: { 'Retry-After': '2' } }); }
      if (url.pathname === '/v9/projects/prj_123') return Response.json({
        id: 'prj_123', name: 'archive', accountId: 'team_123', rootDirectory: state.rootDirectory || null,
        rollingRelease: state.rollingRelease ? { stages: [] } : null,
        targets: { production: { id: state.productionMismatch ? 'dpl_other' : state.published ? 'dpl_123' : state.earlyProductionChanged || state.productionChanged && state.draftVerified ? 'dpl_external' : 'dpl_previous' } },
      });
      if (url.pathname === '/v9/projects/prj_123/domains/archive.test') return Response.json({
        name: 'archive.test', projectId: state.wrongDomain ? 'prj_wrong' : 'prj_123', verified: !state.unverifiedDomain,
        redirect: state.redirectDomain ? 'elsewhere.test' : null, gitBranch: state.previewDomain ? 'feature' : null,
      });
      if (url.pathname === '/v4/aliases/archive.test') return Response.json({
        alias: 'archive.test', projectId: 'prj_123', redirect: null,
        deploymentId: state.aliasChanged ? 'dpl_external' : state.productionMismatch ? 'dpl_other' : state.published ? 'dpl_123' : 'dpl_previous',
      });
      if (url.pathname === '/v2/files') {
        assert.equal(method, 'POST');
        const bytes = Buffer.from(init?.body as Uint8Array);
        assert.equal(headers.get('x-vercel-digest'), digest(bytes, 'sha1'));
        assert.equal(headers.get('Content-Length'), String(bytes.length));
        uploads.set(digest(bytes, 'sha1'), bytes);
        return new Response(null, { status: 200 });
      }
      if (url.pathname === '/v13/deployments') {
        assert.equal(method, 'POST');
        assert.equal(url.searchParams.get('prebuilt'), '1');
        const body = JSON.parse(String(init?.body));
        assert.equal(body.target, 'production');
        assert.equal(body.autoAssignCustomDomains, false);
        assert.equal(body.project, 'prj_123');
        assert.equal(body.name, 'archive');
        assert.equal(body.version, 2);
        assert.deepEqual(body.meta, metadata);
        assert.equal(body.gitSource, undefined);
        assert.equal(body.deploymentId, undefined);
        assert.equal(body.projectSettings, undefined, 'must not mutate saved project settings');
        assert.equal(body.env, undefined);
        const prefix = `${state.rootDirectory ? `${state.rootDirectory}/` : ''}.vercel/output`;
        assert.equal(body.files.length, files.size + 1);
        for (const file of body.files as { file: string; sha: string; size: number; mode: number }[]) {
          const bytes = uploads.get(file.sha);
          assert.ok(bytes, 'file reference must have been uploaded');
          assert.equal(file.size, bytes.length);
          assert.equal(file.mode, 0o100644);
          if (file.file === `${prefix}/config.json`) assert.deepEqual(JSON.parse(bytes.toString('utf8')), { version: 3, routes: VERCEL_ROUTES });
          else { assert.ok(file.file.startsWith(`${prefix}/static/`)); assert.deepEqual(bytes, files.get(file.file.slice(`${prefix}/static`.length))); }
        }
        if (state.loseCreateResponse) throw new Error('APISECRET creation result unknown');
        if (state.changeProductionOnCreate) state.earlyProductionChanged = true;
        if (state.changeAliasOnCreate) state.aliasChanged = true;
        return Response.json({ id: 'dpl_123' });
      }
      if (url.pathname === '/v13/deployments/dpl_123') return Response.json(deployment());
      if (url.pathname === '/v10/projects/prj_123/promote/dpl_123') {
        assert.equal(method, 'POST');
        assert.equal(init?.body, '{}');
        assert.ok(state.draftVerified, 'must check staged files before promoting');
        if (state.promoteUnauthorized) return new Response('APISECRET permission', { status: 403 });
        if (state.failPromote) throw new Error('APISECRET network');
        state.published = true;
        if (state.losePromoteResponse) throw new Error('APISECRET response lost');
        return Response.json({}, { status: 202 });
      }
      assert.fail(`Unexpected API path ${url.pathname}`);
    }
    assert.equal(headers.get('Authorization'), null);
    if (url.hostname === 'archive-dpl123.vercel.app') {
      if (headers.get('x-vercel-protection-bypass') === null) return new Response('BYPASSSECRET protected deployment', { status: 403 });
      assert.equal(headers.get('x-vercel-protection-bypass'), 'BYPASSSECRET');
    }
    else { assert.equal(url.hostname, 'archive.test'); assert.equal(headers.get('x-vercel-protection-bypass'), null); }
    if (url.hostname === 'archive.test' && !state.published) return Response.json({ dataVersion: 'old' });
    if (state.manifestMismatch && url.pathname === '/data/manifest.json') return Response.json({ ...manifest, codeRevision: 'old' });
    if (state.corrupt && url.pathname.endsWith(state.corrupt)) return new Response('CORRUPT');
    const bytes = files.get(url.pathname);
    if (url.hostname === 'archive-dpl123.vercel.app' && url.pathname === '/assets/app.css') state.draftVerified = true;
    return bytes === undefined ? new Response(null, { status: 404 }) : new Response(new Uint8Array(bytes));
  };
  return { events, waits, uploads, state, fetch: fetcher };
}

test('Vercel uploads only exact prebuilt files, stores staged ID, verifies all data and scripts without promotion', async () => harness(async (options, fake) => {
  const receipt = await deployRelease({ ...options, onDraftCreated: async (id) => { assert.equal(id, 'dpl_123'); fake.events.push('saved'); } });
  assert.equal(receipt.provider, 'vercel');
  assert.equal(receipt.published, false);
  assert.equal(receipt.url, 'https://archive-dpl123.vercel.app');
  assert.equal(fake.state.published, false);
  assert.ok(fake.events.indexOf('saved') < fake.events.indexOf('GET api.vercel.com/v13/deployments/dpl_123'));
  assert.equal(fake.events.filter((event) => event.includes('/promote/')).length, 0);
  assert.equal(fake.uploads.size, 7, 'seven identical JSON bundles upload once');
  assert.ok(fake.events.includes('GET archive-dpl123.vercel.app/assets/other.js'));
  for (const name of RELEASE_FILES) assert.ok(fake.events.some((event) => event.endsWith(name)));
}));
test('Vercel prebuilt root-directory prefix preserves existing project settings', async () => harness(async (options, fake) => {
  fake.state.rootDirectory = 'apps/web';
  await deployRelease(options);
}));
test('Vercel promotes the verified exact deployment and reconciles a lost response without rebuilding', async () => harness(async (options, fake) => {
  fake.state.losePromoteResponse = true;
  const receipt = await deployRelease({ ...options, publish: true, onBeforePublish: async () => { fake.events.push('lease checked'); } });
  assert.equal(receipt.published, true);
  assert.equal(receipt.url, 'https://archive.test');
  const promote = fake.events.findIndex((event) => event.includes('/promote/'));
  assert.ok(fake.events.indexOf('lease checked') < promote);
  assert.equal(fake.events.filter((event) => event.includes('/promote/')).length, 1);
  assert.equal(fake.events.filter((event) => event === 'POST api.vercel.com/v13/deployments').length, 1);
}));
test('Vercel saved deployment retry confirms current ID and exact release without uploading or promoting again', async () => harness(async (options, fake) => {
  fake.state.published = true;
  const receipt = await deployRelease({ ...options, existingDeployId: 'dpl_123', publish: true });
  assert.equal(receipt.published, true);
  assert.equal(fake.events.filter((event) => event.startsWith('POST')).length, 0);
}));
test('wrong Vercel public project, redirect, preview, and unverified domains fail before writes', async () => {
  for (const flag of ['wrongDomain', 'redirectDomain', 'previewDomain', 'unverifiedDomain'] as const) await harness(async (options, fake) => {
    fake.state[flag] = true;
    await assert.rejects(deployRelease({ ...options, publish: true }), /does not belong/);
    assert.equal(fake.events.filter((event) => event.startsWith('POST')).length, 0);
  });
});
test('saved Vercel deployments from another project/team or old artifact are rejected before verification', async () => {
  for (const flag of ['wrongProject', 'wrongTeam', 'wrongMetadata'] as const) await harness(async (options, fake) => {
    fake.state[flag] = true;
    await assert.rejects(deployRelease({ ...options, publish: true, existingDeployId: 'dpl_123' }), /does not belong|does not match/);
    assert.equal(fake.events.filter((event) => event.startsWith('POST')).length, 0);
    assert.equal(fake.events.filter((event) => event.includes('archive-dpl123.vercel.app')).length, 0);
  });
});
test('corrupt Vercel manifest, data, HTML, or secondary script cannot be promoted', async () => {
  for (const path of ['cups.json', 'index.html', 'other.js', 'app.css']) await harness(async (options, fake) => {
    fake.state.corrupt = path;
    await assert.rejects(deployRelease({ ...options, publish: true }), /asset does not match/);
    assert.equal(fake.events.filter((event) => event.includes('/promote/')).length, 0);
  });
  await harness(async (options, fake) => {
    fake.state.manifestMismatch = true;
    await assert.rejects(deployRelease({ ...options, publish: true }), /manifest does not match/);
  });
});
test('Vercel protection bypass cannot leak through an untrusted returned URL', async () => harness(async (options, fake) => {
  fake.state.unsafeUrl = true;
  await assert.rejects(deployRelease(options), /valid HTTPS site origin/);
  assert.equal(fake.events.some((event) => event.includes('attacker.test')), false);
}));
test('protected Vercel staging fails closed without a bypass secret and never changes protection settings', async () => harness(async (options, fake) => {
  await assert.rejects(deployRelease({ ...options, publish: true, vercelProtectionBypass: undefined }), (error: Error) => /HTTP 403/.test(error.message) && !error.message.includes('SECRET'));
  assert.equal(fake.events.some((event) => event.startsWith('PATCH') || event.includes('/promote/')), false);
}));
test('Vercel failed staging and unexpectedly assigned domains cannot proceed to promotion', async () => {
  for (const flag of ['deploymentError', 'earlyAlias'] as const) await harness(async (options, fake) => {
    fake.state[flag] = true;
    await assert.rejects(deployRelease({ ...options, publish: true }), /could not prepare|assigned production domains/);
    assert.equal(fake.events.some((event) => event.includes('/promote/')), false);
  });
});
test('Vercel permits its automatic provider staging alias without moving production early', async () => harness(async (options, fake) => {
  fake.state.providerAlias = true;
  const receipt = await deployRelease({ ...options, publish: true });
  assert.equal(receipt.published, true);
  assert.equal(fake.events.filter((event) => event.includes('/promote/')).length, 1);
  const firstDeploymentRead = fake.events.indexOf('GET api.vercel.com/v13/deployments/dpl_123');
  const promotion = fake.events.findIndex((event) => event.includes('/promote/'));
  assert.ok(fake.events.slice(firstDeploymentRead + 1, promotion).includes('GET api.vercel.com/v9/projects/prj_123'));
}));
test('Vercel rejects an early production-target move with or without a provider alias', async () => {
  for (const providerAlias of [false, true]) await harness(async (options, fake) => {
    fake.state.providerAlias = providerAlias;
    fake.state.changeProductionOnCreate = true;
    await assert.rejects(deployRelease({ ...options, publish: true }), /production domains/);
    assert.equal(fake.events.some((event) => event.includes('/promote/')), false);
    assert.equal(fake.state.draftVerified, false);
  });
});
test('Vercel rejects an early canonical-alias move even when the project target is unchanged', async () => harness(async (options, fake) => {
  fake.state.providerAlias = true;
  fake.state.changeAliasOnCreate = true;
  await assert.rejects(deployRelease({ ...options, publish: true }), /production domains/);
  assert.equal(fake.events.some((event) => event.includes('/promote/')), false);
  assert.equal(fake.state.draftVerified, false);
}));
test('Vercel accepts Vercel\'s empty static Build record but refuses runtime functions', async () => harness(async (options, fake) => {
  fake.state.rollingRelease = true;
  await assert.rejects(deployRelease(options), /rolling releases/);
  assert.equal(fake.events.filter((event) => event.startsWith('POST')).length, 0);
  fake.state.rollingRelease = false;
  for (const flag of ['functions', 'lambdaFunction', 'malformedLambda', 'malformedLambdaMetadata', 'missingLambdaOutput', 'multipleLambdas', 'wrongLambdaEntrypoint'] as const) {
    fake.state[flag] = true;
    await assert.rejects(deployRelease({ ...options, existingDeployId: 'dpl_123' }), /server functions/);
    assert.equal(fake.events.some((event) => event.includes('archive-dpl123.vercel.app') || event.includes('/promote/')), false);
    fake.state[flag] = false;
    fake.events.length = 0;
  }
}));
test('Vercel API authentication errors are bounded and sanitized', async () => harness(async (options, fake) => {
  fake.state.unauthorized = true;
  await assert.rejects(deployRelease(options), (error: Error) => /HTTP 401/.test(error.message) && !error.message.includes('SECRET'));
  assert.equal(fake.events.length, 1);
}));
test('Vercel transient reads honor Retry-After; unready deployments hit a deadline', async () => harness(async (options, fake) => {
  fake.state.retry429 = true;
  await deployRelease(options);
  assert.deepEqual(fake.waits, [2000]);
  fake.state.neverReady = true;
  await assert.rejects(deployRelease({ ...options, timeoutMs: 5000, existingDeployId: 'dpl_123' }), /deadline exceeded/);
}));
test('Vercel network requests have enforceable per-call timeouts', async () => harness(async (options, fake) => {
  const keepAlive = setTimeout(() => {}, 1000);
  fake.state.timeout = true;
  try { await assert.rejects(deployRelease({ ...options, timeoutMs: 10 }), (error: Error) => /deadline exceeded/.test(error.message) && !error.message.includes('SECRET')); }
  finally { clearTimeout(keepAlive); }
}));
test('Vercel creation response uncertainty never retries creation or changes production', async () => harness(async (options, fake) => {
  fake.state.loseCreateResponse = true;
  await assert.rejects(deployRelease(options), (error: Error) => /retry the saved artifact/.test(error.message) && !error.message.includes('SECRET'));
  assert.equal(fake.events.filter((event) => event === 'POST api.vercel.com/v13/deployments').length, 1);
  assert.equal(fake.events.some((event) => event.includes('/promote/')), false);
}));
test('Vercel failed unknown promotion remains safely retryable from the saved deployment', async () => harness(async (options, fake) => {
  fake.state.failPromote = true;
  await assert.rejects(deployRelease({ ...options, publish: true }), /could not be confirmed/);
  assert.equal(fake.events.filter((event) => event.includes('/promote/')).length, 1);
  fake.state.failPromote = false;
  fake.events.length = 0;
  const receipt = await deployRelease({ ...options, publish: true, existingDeployId: 'dpl_123' });
  assert.equal(receipt.published, true);
  assert.equal(fake.events.filter((event) => event === 'POST api.vercel.com/v13/deployments' || event === 'POST api.vercel.com/v2/files').length, 0);
}));
test('Vercel publication requires current project target, not just matching public bytes', async () => harness(async (options, fake) => {
  fake.state.productionMismatch = true;
  await assert.rejects(deployRelease({ ...options, publish: true }), /could not be confirmed/);
  assert.equal(fake.events.filter((event) => event.includes('/promote/')).length, 1);
}));
test('a changed Vercel production target or lost writer lease prevents promotion', async () => harness(async (options, fake) => {
  fake.state.productionChanged = true;
  await assert.rejects(deployRelease({ ...options, publish: true }), /production changed/);
  assert.equal(fake.events.some((event) => event.includes('/promote/')), false);
  fake.state.productionChanged = false;
  await assert.rejects(deployRelease({ ...options, publish: true, onBeforePublish: async () => { throw new Error('Lease lost'); } }), /Lease lost/);
  assert.equal(fake.events.some((event) => event.includes('/promote/')), false);
}));
test('Vercel promotion errors never expose diagnostics or retry the write', async () => harness(async (options, fake) => {
  fake.state.promoteUnauthorized = true;
  await assert.rejects(deployRelease({ ...options, publish: true }), (error: Error) => /HTTP 403/.test(error.message) && !error.message.includes('SECRET'));
  assert.equal(fake.events.filter((event) => event.includes('/promote/')).length, 1);
}));
test('Vercel local config errors and forbidden artifact files fail without network calls', async () => harness(async (options, fake) => {
  await assert.rejects(deployRelease({ ...options, vercelProjectId: undefined }), /project ID/);
  await assert.rejects(deployRelease({ ...options, publicUrl: undefined, publish: true }), /verification URL/);
  await writeFile(join(options.artifactDir, '.env'), 'APISECRET');
  await assert.rejects(deployRelease(options), /unsafe file path/);
  assert.equal(fake.events.length, 0);
}));
