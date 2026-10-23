import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => readFileSync(path.join(root, relative), 'utf8');
const migrationNames = readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter(name => name.endsWith('_creator_premium_media_lifecycle_c1.sql'));
const migration = migrationNames.length === 1
  ? read(`supabase/migrations/${migrationNames[0]}`)
  : '';

function compileCommonJs(source, filename) {
  return ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
}

function executeModule(source, filename, modules = {}, globals = {}) {
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    Request,
    Response,
    Headers,
    URL,
    crypto,
    console,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    atob,
    btoa,
    setTimeout,
    clearTimeout,
    ...globals,
    require(specifier) {
      if (Object.hasOwn(modules, specifier)) return modules[specifier];
      throw new Error(`Unexpected module in ${filename}: ${specifier}`);
    },
  };
  vm.runInNewContext(compileCommonJs(source, filename), sandbox, { filename });
  return module.exports;
}

function streamModule(fetchImpl) {
  return executeModule(read('supabase/functions/_shared/stream.ts'), 'stream.ts', {}, {
    fetch: fetchImpl,
    Deno: {
      env: {
        get(name) {
          return {
            CLOUDFLARE_ACCOUNT_ID: 'account',
            CLOUDFLARE_STREAM_TOKEN: 'token',
            STREAM_CUSTOMER_CODE: 'customer',
          }[name];
        },
      },
    },
  });
}

function cleanupHandler({ rpc, verifyObjectAbsent, deleteObjectWithReceipt }) {
  let handler;
  class MockStreamProviderError extends Error {}
  executeModule(
    read('supabase/functions/cleanup-stale-media-uploads/index.ts'),
    'cleanup-stale-media-uploads/index.ts',
    {
      '../_shared/mediaAuth.ts': {
        admin: () => ({ rpc }),
        json: (body, status = 200) => new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      },
      '../_shared/r2.ts': {
        deleteObjectWithReceipt,
        isR2Transient: () => false,
        verifyObjectAbsent,
      },
      '../_shared/stream.ts': {
        deleteStreamVideo: async () => {
          throw new Error('unexpected_stream_delete');
        },
        sanitizeProviderError: () => ({ code: 'stream_provider_failed' }),
        StreamProviderError: MockStreamProviderError,
        verifyStreamVideoAbsent: async () => {
          throw new Error('unexpected_stream_verify');
        },
      },
    },
    {
      Deno: {
        env: { get: name => name === 'MEDIA_CLEANUP_SECRET' ? 'cleanup-secret' : undefined },
        serve(callback) { handler = callback; },
      },
    },
  );
  assert.equal(typeof handler, 'function');
  return handler;
}

async function runLateR2PutCleanup({
  receiptData = true,
  receiptError = null,
  completionData = 'verified',
  completionError = null,
} = {}) {
  const row = {
    id: '20000000-0000-0000-0000-000000000099',
    bucket_name: 'private-media',
    object_key: 'opaque-test-object',
    cleanup_attempts: 9,
    operation: 'verify_absence',
    failure_exhausts: false,
  };
  const rpcCalls = [];
  const providerCalls = [];
  let claimed = false;
  const rpc = async (name, args) => {
    rpcCalls.push({ name, args });
    if (name === 'cleanup_stale_media_upload_records') {
      if (claimed) return { data: [], error: null };
      claimed = true;
      return { data: [row], error: null };
    }
    if (name === 'cleanup_stale_creator_premium_video_records') {
      return { data: [], error: null };
    }
    if (name === 'record_media_asset_provider_delete_v1') {
      return { data: receiptData, error: receiptError };
    }
    if (name === 'finalize_media_asset_cleanup_v1') {
      return { data: completionData, error: completionError };
    }
    if (name === 'record_media_asset_cleanup_failure_v1') {
      return { data: true, error: null };
    }
    throw new Error(`unexpected_rpc:${name}`);
  };
  const verificationResults = [
    { absent: false, requestId: 'head-present' },
    { absent: true, requestId: 'head-absent' },
  ];
  const handler = cleanupHandler({
    rpc,
    async verifyObjectAbsent(bucket, key) {
      providerCalls.push({ operation: 'head', bucket, key });
      const result = verificationResults.shift();
      if (!result) throw new Error('unexpected_extra_head');
      return result;
    },
    async deleteObjectWithReceipt(bucket, key) {
      providerCalls.push({ operation: 'delete', bucket, key });
      return { alreadyAbsent: false, requestId: 'delete-late-put' };
    },
  });
  const response = await handler(new Request('https://cleanup.test', {
    method: 'POST',
    headers: { 'X-Cleanup-Secret': 'cleanup-secret' },
  }));
  return {
    status: response.status,
    body: await response.json(),
    providerCalls,
    rpcCalls,
    row,
  };
}

test('C1 migration exists exactly once and extends canonical rows without enrolling historical tombstones', () => {
  assert.equal(migrationNames.length, 1);
  assert.match(migration, /alter\s+table\s+public\.media_assets[\s\S]*upload_authorization_expires_at/i);
  assert.match(migration, /lifecycle_contract_version/i);
  assert.match(migration, /provider_absence_verified_at/i);
  assert.doesNotMatch(migration, /update\s+public\.(?:media_assets|video_assets)[\s\S]*lifecycle_contract_version\s*=\s*1[\s\S]*where\s+true/i);
});

test('terminal lifecycle guards prevent callbacks from resurrecting deletion states', () => {
  assert.match(migration, /function\s+private\.guard_ready_media_asset_identity\(\)/i);
  assert.match(migration, /old\.status\s+in\s*\(\s*'delete_pending'\s*,\s*'deleted'\s*\)/i);
  assert.match(migration, /media_asset_terminal_state_immutable/i);
  assert.match(migration, /function\s+private\.guard_ready_video_asset_identity\(\)/i);
  assert.match(migration, /video_asset_terminal_state_immutable/i);
});

test('C1 transition guards keep the pre-C1 cleanup Edge fail-closed during rollout', () => {
  assert.match(migration, /media_asset_delete_confirmation_required/i);
  assert.match(migration, /video_asset_delete_confirmation_required/i);
  assert.match(
    migration,
    /old\.lifecycle_contract_version\s*=\s*1[\s\S]*?old\.status\s*=\s*'delete_pending'[\s\S]*?new\.status\s*=\s*'deleted'[\s\S]*?new\.provider_absence_verified_at\s+is\s+null/i,
  );
  assert.match(
    migration,
    /new\.provider_absence_recheck_after\s+is\s+null/i,
  );
});

test('universal link guards serialize every legacy and Premium binder with deletion', () => {
  assert.match(migration, /function\s+private\.guard_media_asset_link_lifecycle_v1\(\)/i);
  assert.match(migration, /function\s+private\.guard_video_asset_link_lifecycle_v1\(\)/i);
  assert.match(migration, /select\s+asset\.status[\s\S]*from\s+public\.media_assets[\s\S]*for\s+update/i);
  assert.match(migration, /select\s+asset\.status[\s\S]*from\s+public\.video_assets[\s\S]*for\s+update/i);
  assert.match(migration, /media_asset_link_lifecycle_invalid/i);
  assert.match(migration, /video_asset_link_lifecycle_invalid/i);
  assert.match(migration, /create\s+trigger\s+media_asset_links_guard_lifecycle_c1/i);
  assert.match(migration, /create\s+trigger\s+video_asset_links_guard_lifecycle_c1/i);
});

test('database cleanup uses row locks, link rechecks, and attempt counters as fences', () => {
  assert.match(migration, /function\s+public\.schedule_creator_premium_video_deletion_v1\s*\(/i);
  assert.match(migration, /private\.schedule_creator_premium_video_deletion_v1\s*\(/i);
  assert.match(migration, /function\s+public\.cleanup_stale_media_upload_records\s*\(/i);
  assert.match(migration, /status\s+in\s*\(\s*'pending'\s*,\s*'uploading'\s*,\s*'failed'\s*\)/i);
  assert.match(migration, /for\s+update[\s\S]*skip\s+locked/i);
  assert.match(migration, /cleanup_attempts\s*=\s*asset\.cleanup_attempts\s*\+\s*1/i);
  assert.match(migration, /delete_attempts\s*=\s*asset\.delete_attempts\s*\+\s*1/i);
  assert.match(migration, /not\s+exists\s*\([\s\S]*media_asset_links/i);
  assert.match(migration, /not\s+exists\s*\([\s\S]*video_asset_links/i);
  assert.match(migration, /cleanup_attempts\s*<\s*12/i);
  assert.match(migration, /delete_attempts\s*<\s*12/i);
  assert.match(
    migration,
    /cleanup_stale_creator_premium_video_records[\s\S]*?returns\s+table\([\s\S]*?purpose\s+text/i,
  );
  assert.match(
    migration,
    /case\s+when\s+claimed\.status\s*=\s*'deleted'[\s\S]*?or\s+claimed\.provider_absence_verified_at\s+is\s+not\s+null[\s\S]*?then\s+'verify_absence'\s+else\s+'delete'/i,
  );
});

test('C1 cleanup preserves canonical expired-story and dangling-link housekeeping', () => {
  const cleanup = migration.match(
    /create\s+function\s+public\.cleanup_stale_media_upload_records[\s\S]*?\n\$\$;/i,
  )?.[0] ?? '';
  assert.match(cleanup, /delete\s+from\s+public\.media_asset_links[\s\S]*public\.stories/i);
  assert.match(cleanup, /delete\s+from\s+public\.stories\s+story\s+where\s+story\.expires_at/i);
  assert.match(cleanup, /linked_entity_missing/i);
  assert.match(
    cleanup,
    /not\s+exists\s*\(\s*select\s+1\s+from\s+public\.media_asset_links\s+remaining[\s\S]*remaining\.asset_id\s*=\s*asset\.id/i,
  );
  assert.match(cleanup, /lifecycle_contract_version\s*=\s*1/i);
  assert.doesNotMatch(
    cleanup,
    /or\s+asset\.status\s*=\s*'deleted'/i,
    'a tombstone alone must never be treated as proof that a legacy link is invalid',
  );
});

test('post-delete verification is a finite fence separate from provider deletion retries', () => {
  assert.match(migration, /post_delete_verification_attempts\s+integer\s+not\s+null\s+default\s+0/i);
  assert.match(
    migration,
    /asset\.status\s*=\s*'deleted'[\s\S]*?asset\.post_delete_verification_attempts\s*<\s*3[\s\S]*?provider_absence_recheck_after\s*<=\s*pg_catalog\.clock_timestamp\(\)/i,
  );
  assert.match(
    migration,
    /post_delete_verification_attempts\s*=\s*case\s+when\s+claimed\.status\s*=\s*'deleted'[\s\S]*?post_delete_verification_attempts\s*\+\s*1/i,
  );
  assert.match(migration, /provider_absence_verified_at\s+is\s+not\s+null[\s\S]*?cleanup_attempts\s*<\s*13/i);
  assert.match(migration, /provider_absence_verified_at\s+is\s+not\s+null[\s\S]*?delete_attempts\s*<\s*13/i);
  assert.match(
    migration,
    /set\s+provider_absence_verified_at\s*=\s*pg_catalog\.clock_timestamp\(\)[\s\S]*?provider_absence_recheck_after\s*=\s*null[\s\S]*?return\s+'verified'/i,
  );
  assert.doesNotMatch(
    migration,
    /set\s+status\s*=\s*'deleted'[\s\S]{0,500}?(?:cleanup_attempts|delete_attempts)\s*=\s*0/i,
    'the global callback fence must remain monotonic after tombstoning',
  );
  assert.match(migration, /media_post_delete_verification_exhausted/i);
  assert.match(migration, /stream_post_delete_verification_exhausted/i);
});

test('expired final claim leases are reaped locally with stable audited outcomes', () => {
  assert.match(migration, /expired_final_claim/i);
  assert.match(migration, /cleanup_attempts\s*>=\s*12/i);
  assert.match(migration, /cleanup_attempts\s*>=\s*13/i);
  assert.match(migration, /delete_attempts\s*>=\s*12/i);
  assert.match(migration, /delete_attempts\s*>=\s*13/i);
  assert.match(migration, /post_delete_verification_attempts\s*>=\s*3/i);
  assert.match(migration, /'claim_lease_expired'/i);
  assert.match(
    migration,
    /next_cleanup_attempt_at\s*=\s*null[\s\S]*?provider_absence_recheck_after\s*=\s*null/i,
  );
  assert.match(migration, /for\s+update\s+of\s+asset\s+skip\s+locked/i);
});

test('fenced completion and retry authorities are service-only and write sanitized immutable receipts', () => {
  for (const name of [
    'record_media_asset_provider_delete_v1',
    'record_creator_premium_video_provider_delete_v1',
    'finalize_media_asset_cleanup_v1',
    'record_media_asset_cleanup_failure_v1',
    'finalize_creator_premium_video_cleanup_v1',
    'record_creator_premium_video_cleanup_failure_v1',
  ]) {
    assert.match(migration, new RegExp(`function\\s+public\\.${name}\\s*\\(`, 'i'));
    assert.match(migration, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${name}[\\s\\S]*from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`, 'i'));
    assert.match(migration, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}[\\s\\S]*to\\s+service_role`, 'i'));
  }
  assert.match(migration, /cleanup_attempts\s*=\s*p_cleanup_attempt/i);
  assert.match(migration, /delete_attempts\s*=\s*p_delete_attempt/i);
  assert.match(migration, /insert\s+into\s+private\.admin_action_audit/i);
  assert.match(migration, /'system_workflow'/i);
  assert.match(migration, /'media_lifecycle'/i);
  assert.match(migration, /'delete_requested'/i);
  assert.match(migration, /'delete_accepted'/i);
  assert.match(migration, /'tombstone_confirmed'/i);
  assert.match(migration, /'absence_verified'/i);
  assert.match(migration, /p_operation\s+not\s+in\s*\(\s*'delete'\s*,\s*'verify_absence'\s*\)/i);
  const auditFunction = migration.match(
    /create\s+or\s+replace\s+function\s+private\.record_media_lifecycle_audit_v1[\s\S]*?\n\$\$;/i,
  )?.[0] ?? '';
  assert.ok(auditFunction.length > 0);
  assert.doesNotMatch(auditFunction, /object_key|cloudflare_uid|signed_url/i);
});

test('shared Stream client accepts empty successful DELETE and verifies absence separately', async () => {
  const calls = [];
  const mod = streamModule(async (url, init) => {
    calls.push({ url: String(url), method: init?.method });
    if (init?.method === 'DELETE') {
      return new Response(null, { status: 204, headers: { 'cf-ray': 'delete-ray' } });
    }
    return new Response(JSON.stringify({ success: false, errors: [{ code: 10006 }] }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'cf-ray': 'get-ray' },
    });
  });
  assert.equal(typeof mod.deleteStreamVideo, 'function');
  assert.equal(typeof mod.verifyStreamVideoAbsent, 'function');
  assert.equal(JSON.stringify(await mod.deleteStreamVideo('provider-uid')), JSON.stringify({
    accepted: true,
    alreadyAbsent: false,
    requestId: 'delete-ray',
  }));
  assert.equal(JSON.stringify(await mod.verifyStreamVideoAbsent('provider-uid')), JSON.stringify({
    absent: true,
    requestId: 'get-ray',
  }));
  await assert.rejects(
    () => mod.verifyStreamVideoAbsent(''),
    error => error?.code === 'stream_provider_identity_missing',
  );
  assert.deepEqual(calls.map(call => call.method), ['DELETE', 'GET']);
});

test('shared Stream client rejects an explicit success:false DELETE envelope', async () => {
  const mod = streamModule(async () => new Response(JSON.stringify({ success: false }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'cf-ray': 'invalid-delete-ray' },
  }));
  await assert.rejects(
    () => mod.deleteStreamVideo('provider-uid'),
    error => error?.code === 'stream_provider_invalid_response',
  );
});

test('R2 shared client exposes independent origin absence verification', () => {
  const source = read('supabase/functions/_shared/r2.ts');
  assert.match(source, /export\s+async\s+function\s+verifyObjectAbsent/i);
  assert.match(source, /HeadObjectCommand/i);
  assert.match(source, /isR2NotFound/i);
  assert.match(source, /requestId/i);
  assert.match(source, /AbortSignal\.timeout\(15_000\)/i);
});

test('R2 issuance persists authorization expiry and C1 contract before returning the signed URL', () => {
  const source = read('supabase/functions/create-media-upload/index.ts');
  assert.match(source, /upload_authorization_expires_at/i);
  assert.match(source, /lifecycle_contract_version\s*:\s*1/i);
  const persistIndex = source.indexOf('upload_authorization_expires_at');
  const responseIndex = source.indexOf('uploadUrl');
  assert.ok(persistIndex >= 0 && responseIndex > persistIndex);
});

test('R2 finalize is compare-and-set and never reports ready after a zero-row write', () => {
  const source = read('supabase/functions/finalize-media-upload/index.ts');
  assert.match(source, /\.in\(\s*['"]status['"]\s*,\s*\[\s*['"]pending['"]\s*,\s*['"]uploading['"]\s*\]\s*\)/i);
  assert.match(source, /\.select\(\s*['"]id['"]\s*\)\.maybeSingle\(\)/i);
  assert.match(source, /media_finalize_stale/i);
  assert.match(source, /schedule_media_asset_deletion/i);
  assert.doesNotMatch(source, /await\s+deleteObject\(/i);
});

test('owner delete routes only schedule canonical deletion and never call providers directly', () => {
  const media = read('supabase/functions/delete-media-asset/index.ts');
  const stream = read('supabase/functions/delete-stream-video/index.ts');
  assert.match(media, /schedule_media_asset_deletion/i);
  assert.doesNotMatch(media, /deleteObject\(|finalize_media_asset_deletion/i);
  assert.match(stream, /schedule_video_asset_deletion_v1/i);
  assert.doesNotMatch(stream, /streamFetch|deleteStreamVideo/i);
});

test('webhook and playback use exact observed-state CAS while Stream allocation is pending-only', () => {
  for (const relative of [
    'supabase/functions/stream-webhook/index.ts',
    'supabase/functions/get-stream-playback/index.ts',
  ]) {
    const source = read(relative);
    assert.match(source, /\.eq\(\s*['"]status['"]\s*,\s*(?:String\()?asset\.status/i, relative);
    assert.match(source, /\.select\(\s*['"][^'"]+['"]\s*\)\.maybeSingle\(\)/i, relative);
  }
  const allocation = read('supabase/functions/create-stream-upload/index.ts');
  assert.match(allocation, /\.in\(\s*['"]status['"]\s*,\s*\[\s*['"]pending['"]\s*\]\s*\)/i);
  assert.match(allocation, /\.select\(\s*['"]id['"]\s*\)\.maybeSingle\(\)/i);
  assert.match(read('supabase/functions/stream-webhook/index.ts'), /\.eq\(\s*['"]cloudflare_uid['"]/i);
  assert.match(read('supabase/functions/get-stream-playback/index.ts'), /\.eq\(\s*['"]cloudflare_uid['"]/i);
  assert.match(allocation, /stream_allocation_stale/i);
});

test('R2 post-delete verification re-deletes a late PUT and finalizes only after a second HEAD', async () => {
  const result = await runLateR2PutCleanup();
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.objectsDeleted, 0);
  assert.equal(result.body.objectsRechecked, 1);
  assert.deepEqual(
    result.providerCalls.map(call => call.operation),
    ['head', 'delete', 'head'],
  );
  const lifecycleCalls = result.rpcCalls.filter(call => [
    'record_media_asset_provider_delete_v1',
    'finalize_media_asset_cleanup_v1',
  ].includes(call.name));
  assert.deepEqual(lifecycleCalls.map(call => call.name), [
    'record_media_asset_provider_delete_v1',
    'finalize_media_asset_cleanup_v1',
  ]);
  assert.equal(JSON.stringify(lifecycleCalls[0].args), JSON.stringify({
    p_asset_id: result.row.id,
    p_cleanup_attempt: result.row.cleanup_attempts,
    p_operation: 'verify_absence',
    p_delete_outcome: 'delete_accepted',
    p_delete_request_id: 'delete-late-put',
  }));
  assert.equal(JSON.stringify(lifecycleCalls[1].args), JSON.stringify({
    p_asset_id: result.row.id,
    p_cleanup_attempt: result.row.cleanup_attempts,
    p_operation: 'verify_absence',
    p_delete_outcome: 'delete_accepted',
    p_delete_request_id: 'delete-late-put',
    p_absence_request_id: 'head-absent',
  }));
});

test('R2 cleanup stops when a provider receipt or finalization write is not confirmed', async () => {
  for (const scenario of [
    { receiptError: { message: 'receipt_write_failed' }, blockedAt: 'receipt' },
    { completionError: { message: 'finalize_write_failed' }, blockedAt: 'finalize' },
  ]) {
    const result = await runLateR2PutCleanup(scenario);
    assert.equal(result.status, 500, scenario.blockedAt);
    assert.equal(result.body.success, false, scenario.blockedAt);
    assert.equal(result.body.error, 'cleanup_failed', scenario.blockedAt);
    assert.equal(result.body.objectsRechecked, 0, scenario.blockedAt);
    const names = result.rpcCalls.map(call => call.name);
    assert.equal(
      names.includes('finalize_media_asset_cleanup_v1'),
      scenario.blockedAt === 'finalize',
      scenario.blockedAt,
    );
    assert.equal(names.includes('record_media_asset_cleanup_failure_v1'), false);
  }
});

test('R2 cleanup treats a rejected receipt fence as stale and never finalizes it', async () => {
  const result = await runLateR2PutCleanup({ receiptData: false });
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.staleClaims, 1);
  assert.equal(result.body.objectsRechecked, 0);
  assert.equal(
    result.rpcCalls.some(call => call.name === 'finalize_media_asset_cleanup_v1'),
    false,
  );
  assert.deepEqual(
    result.providerCalls.map(call => call.operation),
    ['head', 'delete'],
  );
});

test('cleanup delegates fenced completion, verifies absence, and never increments on DB failure', () => {
  const source = read('supabase/functions/cleanup-stale-media-uploads/index.ts');
  assert.match(source, /verifyObjectAbsent/i);
  assert.match(source, /verifyStreamVideoAbsent/i);
  assert.match(source, /finalize_media_asset_cleanup_v1/i);
  assert.match(source, /record_media_asset_cleanup_failure_v1/i);
  assert.match(source, /record_media_asset_provider_delete_v1/i);
  assert.match(source, /finalize_creator_premium_video_cleanup_v1/i);
  assert.match(source, /record_creator_premium_video_cleanup_failure_v1/i);
  assert.match(source, /record_creator_premium_video_provider_delete_v1/i);
  assert.match(source, /row\.operation\s*===\s*['"]delete['"]/i);
  assert.match(source, /verification\?\.absent\s*===\s*false/i);
  assert.match(source, /p_limit\s*:\s*1/i);
  assert.doesNotMatch(source, /Promise\.all\s*\(/i);
  assert.match(source, /p_absence_request_id/i);
  assert.match(source, /exhaustedClaims/i);
  assert.match(source, /row\.failure_exhausts/i);
  assert.doesNotMatch(source, /\.from\(\s*['"]media_assets['"]\s*\)\.update/i);
  assert.doesNotMatch(source, /\.from\(\s*['"]video_assets['"]\s*\)\.update/i);
});

test('C1 files never log provider identities, signed URLs, or private media', () => {
  for (const relative of [
    'supabase/functions/cleanup-stale-media-uploads/index.ts',
    'supabase/functions/delete-media-asset/index.ts',
    'supabase/functions/delete-stream-video/index.ts',
    'supabase/functions/stream-webhook/index.ts',
    'supabase/functions/get-stream-playback/index.ts',
  ]) {
    assert.equal(existsSync(path.join(root, relative)), true);
    const source = read(relative);
    assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^\n]*(?:object_key|cloudflare_uid|uploadUrl|signed)/i, relative);
  }
});
