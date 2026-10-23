import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const migrations = new URL('../supabase/migrations/', import.meta.url);
const matches = readdirSync(migrations)
  .filter(name => name.endsWith('_creator_premium_b5_creator_management_ux.sql'));
const sql = matches.length === 1
  ? readFileSync(new URL(`../supabase/migrations/${matches[0]}`, import.meta.url), 'utf8')
  : '';
const cleanupPath = new URL('supabase/functions/cleanup-stale-media-uploads/index.ts', root);
const edge = existsSync(cleanupPath) ? readFileSync(cleanupPath, 'utf8') : '';

function compile(source, filename) {
  return ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function loadCleanupEdge(
  providerMode = 'success',
  dbUpdateMode = 'success',
  operation = 'delete',
  completion = 'finalized',
  cloudflareUid = 'provider-secret-uid',
  purpose = 'creator_premium_video',
) {
  let handler;
  const providerCalls = [];
  const rpcCalls = [];
  const logs = [];
  let claimed = false;
  let streamVerificationCount = 0;
  class StreamProviderError extends Error {
    constructor(code, httpStatus = 502, transient = false) {
      super(code);
      this.code = code;
      this.httpStatus = httpStatus;
      this.transient = transient;
    }
  }
  const db = {
    async rpc(name, params = {}) {
      rpcCalls.push({ name, params: structuredClone(params) });
      if (name === 'cleanup_stale_media_upload_records') return { data: [], error: null };
      if (name === 'cleanup_stale_creator_premium_video_records') {
        const data = claimed ? [] : [{
          id: '30000000-0000-4000-8000-000000000001',
          cloudflare_uid: cloudflareUid,
          purpose,
          delete_attempts: 2,
          operation,
        }];
        claimed = true;
        return { data, error: null };
      }
      if (name === 'record_creator_premium_video_provider_delete_v1') {
        return { data: true, error: null };
      }
      if (name === 'finalize_creator_premium_video_cleanup_v1') {
        if (dbUpdateMode === 'fail_finalize') {
          return { data: null, error: { message: 'write failed' } };
        }
        return { data: completion, error: null };
      }
      if (name === 'record_creator_premium_video_cleanup_failure_v1') {
        if (dbUpdateMode === 'fail_retry') {
          return { data: null, error: { message: 'write failed' } };
        }
        return { data: true, error: null };
      }
      throw new Error(`Unexpected cleanup RPC: ${name}`);
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compile(edge, 'cleanup-stale-media-uploads.ts'), {
    module,
    exports: module.exports,
    Request,
    Response,
    Headers,
    URL,
    AbortSignal,
    structuredClone,
    console: {
      log: (...args) => logs.push(args),
      warn: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    },
    require(specifier) {
      if (specifier === '../_shared/mediaAuth.ts') return {
        admin: () => db,
        json: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
      };
      if (specifier === '../_shared/r2.ts') return {
        deleteObjectWithReceipt: async () => ({ alreadyAbsent: false, requestId: null }),
        verifyObjectAbsent: async () => ({ absent: true, requestId: null }),
        isR2Transient: () => false,
      };
      if (specifier === '../_shared/stream.ts') return {
        StreamProviderError,
        sanitizeProviderError: error => ({ code: error.code ?? 'stream_provider_error', message: error.code ?? 'stream_provider_error' }),
        async deleteStreamVideo(uid) {
          providerCalls.push({ operation: 'delete', uid });
          if (providerMode === 'error') throw new StreamProviderError('stream_provider_temporarily_unavailable', 503, true);
          return {
            accepted: true,
            alreadyAbsent: providerMode === 'not_found',
            requestId: 'delete-request',
          };
        },
        async verifyStreamVideoAbsent(uid) {
          providerCalls.push({ operation: 'verify_absence', uid });
          streamVerificationCount += 1;
          return {
            absent: providerMode !== 'reappeared' || streamVerificationCount > 1,
            requestId: `verify-request-${streamVerificationCount}`,
          };
        },
      };
      throw new Error(`Unexpected cleanup module: ${specifier}`);
    },
    Deno: {
      env: { get: name => name === 'MEDIA_CLEANUP_SECRET' ? 'cleanup-secret' : undefined },
      serve(fn) { handler = fn; },
    },
  }, { filename: 'cleanup-stale-media-uploads.js' });
  return { handler, providerCalls, rpcCalls, logs };
}

async function invokeCleanup(harness) {
  const response = await harness.handler(new Request('https://edge.test', {
    method: 'POST',
    headers: { 'X-Cleanup-Secret': 'cleanup-secret' },
  }));
  return { response, payload: await response.json() };
}

test('video replacement is atomic, idempotent, and schedules both old canonical assets', () => {
  assert.match(sql, /drop\s+function\s+public\.set_my_creator_premium_video_media_v1\(uuid\s*,\s*uuid\s*,\s*uuid\)/i);
  assert.match(sql, /function\s+public\.set_my_creator_premium_video_media_v1/i);
  assert.match(sql, /replacement_cleanup_scheduled\s+boolean/i);
  assert.match(sql, /v_old_teaser\s*=\s*p_teaser_asset_id[\s\S]*v_old_video\s*=\s*p_video_asset_id[\s\S]*replayed/i);
  assert.match(sql, /delete\s+from\s+public\.media_asset_links/i);
  assert.match(sql, /delete\s+from\s+public\.video_asset_links/i);
  assert.match(sql, /public\.schedule_media_asset_deletion\s*\(\s*v_old_teaser/i);
  assert.match(sql, /private\.schedule_creator_premium_video_deletion_v1\s*\(\s*v_old_video/i);
});

test('Premium Stream scheduling cannot touch linked, Feed, or Business assets', () => {
  assert.match(sql, /function\s+private\.schedule_creator_premium_video_deletion_v1/i);
  assert.match(sql, /purpose\s*<>\s*'creator_premium_video'/i);
  assert.match(sql, /not\s+exists\s*\([\s\S]*public\.video_asset_links/i);
  assert.match(sql, /status\s*=\s*'delete_pending'/i);
  assert.match(sql, /next_cleanup_attempt_at\s*=\s*pg_catalog\.clock_timestamp\(\)/i);
});

test('service-role cleanup claims only due or abandoned unlinked Premium videos', () => {
  assert.match(sql, /function\s+public\.cleanup_stale_creator_premium_video_records\s*\(p_limit\s+integer/i);
  assert.match(sql, /purpose\s*=\s*'creator_premium_video'/i);
  assert.match(sql, /status\s*=\s*'delete_pending'[\s\S]*next_cleanup_attempt_at/i);
  assert.match(sql, /status\s+in\s*\(\s*'pending'\s*,\s*'uploading'\s*,\s*'processing'\s*,\s*'ready'\s*,\s*'failed'\s*\)/i);
  assert.match(sql, /created_at\s*<\s*pg_catalog\.clock_timestamp\(\)\s*-\s*interval\s*'24 hours'/i);
  assert.match(sql, /not\s+exists\s*\([\s\S]*public\.video_asset_links/i);
  assert.match(sql, /for\s+update\s+skip\s+locked/i);
  assert.match(sql, /delete_attempts\s*=\s*asset\.delete_attempts\s*\+\s*1/i);
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.cleanup_stale_creator_premium_video_records\(integer\)\s+to\s+service_role/i);
  assert.doesNotMatch(sql, /cron\.schedule|cleanup-stale-media-uploads[^']*\*\/15/i);
});

test('abandoned Premium video promotion locks candidates before delete_pending transition', () => {
  const cleanup = sql.match(
    /create\s+function\s+public\.cleanup_stale_creator_premium_video_records[\s\S]*?\n\$\$;/i,
  )?.[0] ?? '';
  const abandoned = cleanup.match(/with\s+abandoned\s+as\s*\([\s\S]*?\)\s*update\s+public\.video_assets/i)?.[0] ?? '';

  assert.match(abandoned, /for\s+update\s+of\s+asset\s+skip\s+locked/i);
  assert.match(abandoned, /not\s+exists\s*\([\s\S]*public\.video_asset_links/i);
  assert.match(abandoned, /purpose\s*=\s*'creator_premium_video'/i);
});

test('existing cleanup Edge handles R2 and Premium Stream through canonical clients', () => {
  assert.match(edge, /cleanup_stale_media_upload_records/);
  assert.match(edge, /cleanup_stale_creator_premium_video_records/);
  assert.match(edge, /deleteObjectWithReceipt/);
  assert.match(edge, /verifyObjectAbsent/);
  assert.match(edge, /deleteStreamVideo/);
  assert.match(edge, /verifyStreamVideoAbsent/);
  assert.match(edge, /finalize_media_asset_cleanup_v1/);
  assert.match(edge, /record_media_asset_cleanup_failure_v1/);
  assert.match(edge, /finalize_creator_premium_video_cleanup_v1/);
  assert.match(edge, /record_creator_premium_video_cleanup_failure_v1/);
  assert.doesNotMatch(edge, /\.from\(\s*['"](?:media_assets|video_assets)['"]\s*\)\s*\.update/i);
  assert.doesNotMatch(edge, /console\.(?:log|warn|error)/);
  assert.doesNotMatch(
    edge,
    /console\.(?:log|warn|error)\([^)]*cloudflare_uid/i,
  );
});

test('cleanup claims both provider lanes before concurrent bounded provider work', () => {
  const loop = edge.slice(edge.indexOf('for(let round=0'));
  const r2Claim = loop.indexOf("cleanup_stale_media_upload_records");
  const streamClaim = loop.indexOf("cleanup_stale_creator_premium_video_records");
  const providerWork = loop.indexOf('Promise.allSettled');
  assert.ok(r2Claim >= 0 && r2Claim < providerWork);
  assert.ok(streamClaim >= 0 && streamClaim < providerWork);
  assert.match(edge, /const\s+PROVIDER_DEADLINE_MS\s*=\s*35_000/);
  assert.match(edge, /const\s+START_NEW_WORK_BUDGET_MS\s*=\s*20_000/);
});

test('cleanup Edge never claims ordinary Stream purposes', () => {
  assert.doesNotMatch(edge, /eq\(\s*['"]purpose['"]\s*,\s*['"](?:feed_video|business_library)['"]\s*\)/i);
  assert.doesNotMatch(sql, /purpose\s+in\s*\([^)]*(?:feed_video|business_library)/i);
});

test('cleanup Edge treats provider 404 as idempotent deletion without logging identifiers', async () => {
  const harness = loadCleanupEdge('not_found');
  const { response, payload } = await invokeCleanup(harness);
  assert.equal(response.status, 200);
  assert.equal(payload.streamVideosClaimed, 1);
  assert.equal(payload.streamVideosDeleted, 1);
  assert.equal(payload.premiumVideosDeleted, 1);
  assert.deepEqual(harness.providerCalls, [
    { operation: 'delete', uid: 'provider-secret-uid' },
    { operation: 'verify_absence', uid: 'provider-secret-uid' },
  ]);
  const finalized = harness.rpcCalls.find(call => call.name === 'finalize_creator_premium_video_cleanup_v1');
  assert.equal(finalized.params.p_operation, 'delete');
  assert.equal(finalized.params.p_delete_outcome, 'already_absent');
  assert.equal(finalized.params.p_delete_request_id, 'delete-request');
  assert.equal(finalized.params.p_absence_request_id, 'verify-request-1');
  assert.equal(finalized.params.p_delete_attempt, 2);
  assert.deepEqual(harness.logs, []);
});

test('cleanup Edge reports generic Stream and Premium telemetry without relabelling Feed assets', async () => {
  const harness = loadCleanupEdge(
    'not_found',
    'success',
    'delete',
    'finalized',
    'provider-secret-uid',
    'feed_video',
  );
  const { response, payload } = await invokeCleanup(harness);
  assert.equal(response.status, 200);
  assert.equal(payload.streamVideosClaimed, 1);
  assert.equal(payload.streamVideosDeleted, 1);
  assert.equal(payload.streamVideosRechecked, 0);
  assert.equal(payload.premiumVideosStale, 0);
  assert.equal(payload.premiumVideosDeleted, 0);
  assert.equal(payload.premiumVideosRechecked, 0);
});

test('cleanup Edge performs only independent absence verification for final tombstones', async () => {
  const harness = loadCleanupEdge('success', 'success', 'verify_absence', 'verified');
  const { response, payload } = await invokeCleanup(harness);
  assert.equal(response.status, 200);
  assert.equal(payload.premiumVideosDeleted, 0);
  assert.equal(payload.premiumVideosRechecked, 1);
  assert.deepEqual(harness.providerCalls, [
    { operation: 'verify_absence', uid: 'provider-secret-uid' },
  ]);
  const finalized = harness.rpcCalls.find(call => call.name === 'finalize_creator_premium_video_cleanup_v1');
  assert.equal(finalized.params.p_operation, 'verify_absence');
  assert.equal(finalized.params.p_delete_outcome, null);
  assert.equal(finalized.params.p_delete_request_id, null);
  assert.equal(finalized.params.p_absence_request_id, 'verify-request-1');
  assert.deepEqual(harness.logs, []);
});

test('cleanup Edge keeps provider failures delete_pending for the database backoff retry', async () => {
  const harness = loadCleanupEdge('error');
  const { response, payload } = await invokeCleanup(harness);
  assert.equal(response.status, 200);
  assert.equal(payload.premiumVideosDeleted, 0);
  const failure = harness.rpcCalls.find(call => call.name === 'record_creator_premium_video_cleanup_failure_v1');
  assert.equal(failure.params.p_error_code, 'stream_provider_temporarily_unavailable');
  assert.equal(failure.params.p_delete_attempt, 2);
  assert.deepEqual(harness.logs, []);
});

test('cleanup Edge treats a missing Stream UID as indeterminate, never as physical absence', async () => {
  const harness = loadCleanupEdge('success', 'success', 'delete', 'finalized', null);
  const { response, payload } = await invokeCleanup(harness);
  assert.equal(response.status, 200);
  assert.equal(payload.premiumVideosDeleted, 0);
  assert.deepEqual(harness.providerCalls, []);
  const failure = harness.rpcCalls.find(call => call.name === 'record_creator_premium_video_cleanup_failure_v1');
  assert.equal(failure.params.p_error_code, 'stream_provider_identity_missing');
  assert.equal(
    harness.rpcCalls.some(call => call.name === 'finalize_creator_premium_video_cleanup_v1'),
    false,
  );
});

test('cleanup Edge re-deletes a tombstoned Stream object that reappears before finalizing', async () => {
  const harness = loadCleanupEdge('reappeared', 'success', 'verify_absence', 'verified_recheck_scheduled');
  const { response, payload } = await invokeCleanup(harness);
  assert.equal(response.status, 200);
  assert.equal(payload.premiumVideosRechecked, 1);
  assert.deepEqual(harness.providerCalls, [
    { operation: 'verify_absence', uid: 'provider-secret-uid' },
    { operation: 'delete', uid: 'provider-secret-uid' },
    { operation: 'verify_absence', uid: 'provider-secret-uid' },
  ]);
  const receipt = harness.rpcCalls.find(call => call.name === 'record_creator_premium_video_provider_delete_v1');
  assert.equal(receipt.params.p_operation, 'verify_absence');
  const finalized = harness.rpcCalls.find(call => call.name === 'finalize_creator_premium_video_cleanup_v1');
  assert.equal(finalized.params.p_absence_request_id, 'verify-request-2');
});

test('cleanup Edge never reports a Premium video deleted when the database completion write fails', async () => {
  const harness = loadCleanupEdge('success', 'fail_finalize');
  const { response, payload } = await invokeCleanup(harness);
  assert.equal(response.status, 500);
  assert.equal(payload.error, 'cleanup_failed');
  assert.equal(harness.rpcCalls.at(-1).name, 'finalize_creator_premium_video_cleanup_v1');
  assert.deepEqual(harness.logs, []);
});

test('cleanup Edge returns a controlled failure when the retry-state write also fails', async () => {
  const harness = loadCleanupEdge('error', 'fail_retry');
  const { response, payload } = await invokeCleanup(harness);
  assert.equal(response.status, 500);
  assert.equal(payload.error, 'cleanup_failed');
  assert.deepEqual(harness.logs, []);
});
