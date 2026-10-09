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

function loadCleanupEdge(providerMode = 'success', dbUpdateMode = 'success') {
  let handler;
  const providerCalls = [];
  const updates = [];
  const logs = [];
  let videoUpdateCount = 0;
  class StreamProviderError extends Error {
    constructor(code, httpStatus = 502, transient = false) {
      super(code);
      this.code = code;
      this.httpStatus = httpStatus;
      this.transient = transient;
    }
  }
  const mutation = result => {
    const chain = {
      eq() { return chain; },
      select() { return chain; },
      maybeSingle() { return Promise.resolve(result); },
      then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
    };
    return chain;
  };
  const db = {
    async rpc(name) {
      if (name === 'cleanup_stale_media_upload_records') return { data: [], error: null };
      assert.equal(name, 'cleanup_stale_creator_premium_video_records');
      return {
        data: [{ id: '30000000-0000-4000-8000-000000000001', cloudflare_uid: 'provider-secret-uid', delete_attempts: 2 }],
        error: null,
      };
    },
    from(table) {
      return {
        update(values) {
          updates.push({ table, values: structuredClone(values) });
          if (table === 'video_assets') {
            videoUpdateCount += 1;
            if (dbUpdateMode === 'fail_deleted' && videoUpdateCount === 1) {
              return mutation({ data: null, error: { message: 'write failed' } });
            }
            if (dbUpdateMode === 'fail_all') {
              return mutation({ data: null, error: { message: 'write failed' } });
            }
            return mutation({
              data: { id: '30000000-0000-4000-8000-000000000001' },
              error: null,
            });
          }
          return mutation({ error: null });
        },
      };
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
      if (specifier === '../_shared/r2.ts') return { deleteObject: async () => {} };
      if (specifier === '../_shared/stream.ts') return {
        StreamProviderError,
        sanitizeProviderError: error => ({ code: error.code ?? 'stream_provider_error', message: error.code ?? 'stream_provider_error' }),
        async streamFetch(pathname, init) {
          providerCalls.push({ pathname, method: init?.method });
          if (providerMode === 'not_found') throw new StreamProviderError('stream_not_found', 404);
          if (providerMode === 'error') throw new StreamProviderError('stream_provider_temporarily_unavailable', 503, true);
          return { success: true };
        },
      };
      throw new Error(`Unexpected cleanup module: ${specifier}`);
    },
    Deno: {
      env: { get: name => name === 'MEDIA_CLEANUP_SECRET' ? 'cleanup-secret' : undefined },
      serve(fn) { handler = fn; },
    },
  }, { filename: 'cleanup-stale-media-uploads.js' });
  return { handler, providerCalls, updates, logs };
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
  assert.match(edge, /deleteObject/);
  assert.match(edge, /streamFetch/);
  assert.match(edge, /method\s*:\s*'DELETE'/);
  assert.match(edge, /StreamProviderError/);
  assert.match(edge, /stream_not_found/);
  assert.match(edge, /status\s*:\s*'deleted'/);
  assert.match(edge, /status\s*:\s*'delete_pending'/);
  assert.doesNotMatch(edge, /console\.(?:log|warn|error)/);
  assert.doesNotMatch(edge, /cloudflare_uid[^\n]*(?:log|warn|error)/i);
});

test('cleanup Edge never claims ordinary Stream purposes', () => {
  assert.doesNotMatch(edge, /eq\(\s*['"]purpose['"]\s*,\s*['"](?:feed_video|business_library)['"]\s*\)/i);
  assert.doesNotMatch(sql, /purpose\s+in\s*\([^)]*(?:feed_video|business_library)/i);
});

test('cleanup Edge treats provider 404 as idempotent deletion without logging identifiers', async () => {
  const harness = loadCleanupEdge('not_found');
  const { response, payload } = await invokeCleanup(harness);
  assert.equal(response.status, 200);
  assert.equal(payload.premiumVideosDeleted, 1);
  assert.deepEqual(harness.providerCalls, [{ pathname: '/provider-secret-uid', method: 'DELETE' }]);
  assert.equal(harness.updates.at(-1).table, 'video_assets');
  assert.equal(harness.updates.at(-1).values.status, 'deleted');
  assert.deepEqual(harness.logs, []);
});

test('cleanup Edge keeps provider failures delete_pending for the database backoff retry', async () => {
  const harness = loadCleanupEdge('error');
  const { response, payload } = await invokeCleanup(harness);
  assert.equal(response.status, 200);
  assert.equal(payload.premiumVideosDeleted, 0);
  assert.equal(harness.updates.at(-1).table, 'video_assets');
  assert.equal(harness.updates.at(-1).values.status, 'delete_pending');
  assert.equal(harness.updates.at(-1).values.error_code, 'stream_provider_temporarily_unavailable');
  assert.deepEqual(harness.logs, []);
});

test('cleanup Edge never reports a Premium video deleted when the database completion write fails', async () => {
  const harness = loadCleanupEdge('success', 'fail_deleted');
  const { response, payload } = await invokeCleanup(harness);
  assert.equal(response.status, 200);
  assert.equal(payload.premiumVideosDeleted, 0);
  assert.equal(harness.updates.at(-1).table, 'video_assets');
  assert.equal(harness.updates.at(-1).values.status, 'delete_pending');
  assert.deepEqual(harness.logs, []);
});

test('cleanup Edge returns a controlled failure when the retry-state write also fails', async () => {
  const harness = loadCleanupEdge('error', 'fail_all');
  const { response, payload } = await invokeCleanup(harness);
  assert.equal(response.status, 500);
  assert.equal(payload.error, 'cleanup_failed');
  assert.deepEqual(harness.logs, []);
});
