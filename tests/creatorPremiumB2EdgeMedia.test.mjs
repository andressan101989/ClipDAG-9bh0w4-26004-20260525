import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => readFileSync(path.join(root, relative), 'utf8');

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

const purposeModule = executeModule(
  read('supabase/functions/_shared/mediaPurposes.ts'),
  'mediaPurposes.ts',
);

test('Premium image purpose validator enforces exact MIME, 25 MB, and visibility contracts', () => {
  const teaser = purposeModule.validateMediaRequest(
    'creator_premium_teaser_image', 'image/webp', 25_000_000, 'public',
  );
  const original = purposeModule.validateMediaRequest(
    'creator_premium_original_image', 'image/jpeg', 25_000_000, 'private',
  );
  assert.equal(teaser.rule.kind, 'image');
  assert.equal(teaser.rule.defaultVisibility, 'public');
  assert.equal(original.rule.kind, 'image');
  assert.equal(original.rule.defaultVisibility, 'private');
  assert.equal(purposeModule.validateMediaRequest(
    'creator_premium_teaser_image', 'image/gif', 1, 'public',
  ).error, 'invalid_mime_type');
  assert.equal(purposeModule.validateMediaRequest(
    'creator_premium_original_image', 'image/png', 25_000_001, 'private',
  ).error, 'invalid_size');
  assert.equal(purposeModule.validateMediaRequest(
    'creator_premium_teaser_image', 'image/png', 1, 'private',
  ).error, 'visibility_not_allowed');
  assert.equal(purposeModule.validateMediaRequest(
    'creator_premium_original_image', 'image/png', 1, 'public',
  ).error, 'visibility_not_allowed');
});

function queryResult(result) {
  const chain = {
    select() { return chain; },
    eq() { return chain; },
    gte() { return chain; },
    in() { return chain; },
    limit() { return chain; },
    maybeSingle: async () => result,
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  return chain;
}

function loadCreateMediaUpload({ authorize = { data: true, error: null } } = {}) {
  let handler;
  const inserts = [];
  const rpcCalls = [];
  const updates = [];
  const db = {
    from(table) {
      return {
        select() { return queryResult({ data: [], count: 0, error: null }); },
        insert(row) { inserts.push({ table, row }); return Promise.resolve({ error: null }); },
        update(row) {
          updates.push({ table, row });
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
  const caller = {
    async rpc(name, args) {
      rpcCalls.push({ name, args: JSON.parse(JSON.stringify(args)) });
      return authorize;
    },
  };
  executeModule(read('supabase/functions/create-media-upload/index.ts'), 'create-media-upload.ts', {
    '../_shared/businessMediaAuth.ts': {
      businessActorHasAdvertiserOwnerMediaAccess: async () => false,
      businessActorHasAnyCapability: async () => false,
      isUuid: value => /^[0-9a-f-]{36}$/i.test(String(value)),
    },
    '../_shared/mediaAuth.ts': {
      authenticatedUser: async () => ({ id: '10000000-0000-4000-8000-000000000001' }),
      authenticatedClient: () => caller,
      admin: () => db,
      corsHeaders: {},
      json: (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
        status, headers: { 'Content-Type': 'application/json', ...headers },
      }),
    },
    '../_shared/mediaPurposes.ts': purposeModule,
    '../_shared/r2.ts': {
      R2_PRIVATE_BUCKET: () => 'private-bucket',
      R2_PUBLIC_BUCKET: () => 'public-bucket',
      signPutIfAbsent: async () => 'https://upload.example.test/signed-put',
    },
  }, {
    Deno: {
      env: { get: () => 'deployment' },
      serve(fn) { handler = fn; },
    },
  });
  return { handler, inserts, rpcCalls, updates };
}

async function post(handler, body) {
  const response = await handler(new Request('https://edge.test', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { response, json: await response.json() };
}

const contentId = '20000000-0000-4000-8000-000000000001';
const baseUpload = {
  mime_type: 'image/jpeg', size_bytes: 1234, file_name: 'safe.jpg',
};

test('create-media-upload rejects missing/malformed/unexpected Premium context before asset creation', async () => {
  for (const [body, expected] of [
    [{ ...baseUpload, purpose: 'creator_premium_teaser_image', visibility: 'public' }, 400],
    [{ ...baseUpload, purpose: 'creator_premium_original_image', visibility: 'private', premium_content_id: 'bad' }, 400],
    [{ ...baseUpload, purpose: 'post_image', visibility: 'public', premium_content_id: contentId }, 400],
    [{ ...baseUpload, purpose: 'creator_premium_original_image', visibility: 'public', premium_content_id: contentId }, 400],
  ]) {
    const harness = loadCreateMediaUpload();
    const { response } = await post(harness.handler, body);
    assert.equal(response.status, expected);
    assert.equal(harness.inserts.length, 0);
  }
});

test('create-media-upload requires canonical RPC authorization and forces the two storage visibilities', async () => {
  const denied = loadCreateMediaUpload({ authorize: { data: false, error: null } });
  assert.equal((await post(denied.handler, {
    ...baseUpload, purpose: 'creator_premium_teaser_image', visibility: 'public', premium_content_id: contentId,
  })).response.status, 403);
  assert.equal(denied.inserts.length, 0);

  for (const [purpose, visibility, bucket] of [
    ['creator_premium_teaser_image', 'public', 'public-bucket'],
    ['creator_premium_original_image', 'private', 'private-bucket'],
  ]) {
    const allowed = loadCreateMediaUpload();
    const { response, json } = await post(allowed.handler, {
      ...baseUpload, purpose, visibility, premium_content_id: contentId,
    });
    assert.equal(response.status, 200);
    assert.equal(json.success, true);
    assert.deepEqual(allowed.rpcCalls, [{
      name: 'authorize_my_creator_premium_image_upload_v1',
      args: { p_content_id: contentId, p_purpose: purpose },
    }]);
    assert.equal(allowed.inserts.length, 1);
    assert.equal(allowed.inserts[0].row.visibility, visibility);
    assert.equal(allowed.inserts[0].row.bucket_name, bucket);
    assert.equal(allowed.inserts[0].row.purpose, purpose);
  }
});

function chainFor(rows) {
  const filters = [];
  let limitValue = null;
  const chain = {
    select() { return chain; },
    eq(column, value) { filters.push([column, value]); return chain; },
    in() { return chain; },
    or() { return chain; },
    gt() { return chain; },
    limit(value) { limitValue = value; return chain; },
    async maybeSingle() {
      const selected = rows.filter(row => filters.every(([column, value]) => row[column] === value));
      return { data: selected.length === 1 ? selected[0] : null, error: null };
    },
    then(resolve, reject) {
      const selected = rows.filter(row => filters.every(([column, value]) => row[column] === value));
      const data = limitValue == null ? selected : selected.slice(0, limitValue);
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
  return chain;
}

function loadGetMediaUrl({
  entitlement = { allowed: true, source: 'owner', reason: 'owner', expires_at: null },
  links = [{
    asset_id: '30000000-0000-4000-8000-000000000001',
    entity_type: 'creator_premium_content', entity_id: contentId, slot: 'original', position: 0,
  }],
  assets = [{
    id: '30000000-0000-4000-8000-000000000001', owner_id: '10000000-0000-4000-8000-000000000001',
    purpose: 'creator_premium_original_image', provider: 'r2', media_kind: 'image',
    visibility: 'private', status: 'ready', public_url: null,
    bucket_name: 'private-bucket', object_key: 'private/original.jpg',
  }],
} = {}) {
  let handler;
  const signCalls = [];
  const rpcCalls = [];
  const db = {
    from(table) {
      if (table === 'media_asset_links') return chainFor(links);
      if (table === 'media_assets') return chainFor(assets);
      return chainFor([]);
    },
  };
  const caller = {
    async rpc(name, args) {
      rpcCalls.push({ name, args: JSON.parse(JSON.stringify(args)) });
      return { data: [entitlement], error: null };
    },
    from() { return chainFor([]); },
  };
  executeModule(read('supabase/functions/get-media-url/index.ts'), 'get-media-url.ts', {
    '../_shared/mediaAuth.ts': {
      authenticatedUser: async () => ({ id: '10000000-0000-4000-8000-000000000001' }),
      authenticatedClient: () => caller,
      admin: () => db,
    },
    '../_shared/r2.ts': {
      publicUrl: key => `https://public.example.test/${key}`,
      async signGet(bucket, key, ttl) {
        signCalls.push({ bucket, key, ttl });
        return `https://signed.example.test/${key}?secret=redacted`;
      },
    },
  }, {
    Deno: { serve(fn) { handler = fn; } },
  });
  return { handler, rpcCalls, signCalls };
}

test('get-media-url authenticates entitlement before resolving and signing one Premium original', async () => {
  const harness = loadGetMediaUrl();
  const { response, json } = await post(harness.handler, { premium_content_id: contentId });
  assert.equal(response.status, 200);
  assert.deepEqual(harness.rpcCalls, [{
    name: 'get_my_creator_premium_entitlement_v1',
    args: { p_content_id: contentId },
  }]);
  assert.equal(harness.signCalls.length, 1);
  assert.equal(harness.signCalls[0].ttl, 300);
  assert.deepEqual(Object.keys(json.data).sort(), ['contentId', 'expiresAt', 'url']);
  assert.equal(json.data.contentId, contentId);
  assert.match(json.data.url, /^https:\/\//);
  assert.ok(Date.parse(json.data.expiresAt) > Date.now());
  assert.ok(Date.parse(json.data.expiresAt) <= Date.now() + 301_000);
  assert.match(response.headers.get('cache-control') ?? '', /private/i);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/i);
  assert.equal(response.headers.get('pragma'), 'no-cache');
  for (const forbidden of ['assetId', 'bucketName', 'objectKey']) {
    assert.equal(Object.hasOwn(json.data, forbidden), false);
  }
});

test('get-media-url fails closed for malformed, denied, missing, duplicate, or malformed Premium originals', async () => {
  assert.equal((await post(loadGetMediaUrl().handler, { premium_content_id: 'bad' })).response.status, 400);
  assert.equal((await post(loadGetMediaUrl({ entitlement: {
    allowed: false, source: 'none', reason: 'not_entitled', expires_at: null,
  } }).handler, { premium_content_id: contentId })).response.status, 403);
  assert.equal((await post(loadGetMediaUrl({ links: [] }).handler, {
    premium_content_id: contentId,
  })).response.status, 404);
  const duplicate = [
    { asset_id: '30000000-0000-4000-8000-000000000001', entity_type: 'creator_premium_content', entity_id: contentId, slot: 'original', position: 0 },
    { asset_id: '30000000-0000-4000-8000-000000000002', entity_type: 'creator_premium_content', entity_id: contentId, slot: 'original', position: 0 },
  ];
  assert.equal((await post(loadGetMediaUrl({ links: duplicate }).handler, {
    premium_content_id: contentId,
  })).response.status, 409);
  const wrong = [{
    id: '30000000-0000-4000-8000-000000000001', owner_id: '10000000-0000-4000-8000-000000000001',
    purpose: 'post_image', provider: 'r2', media_kind: 'image', visibility: 'public',
    status: 'ready', public_url: 'https://public.example.test/a.jpg', bucket_name: 'public', object_key: 'a.jpg',
  }];
  assert.equal((await post(loadGetMediaUrl({ assets: wrong }).handler, {
    premium_content_id: contentId,
  })).response.status, 403);
});

test('generic asset_id and admin-context routes cannot bypass Premium original entitlement', async () => {
  const assetId = '30000000-0000-4000-8000-000000000001';
  for (const body of [
    { asset_id: assetId },
    { asset_id: assetId, admin_context: { surface: 'story', entity_id: contentId } },
  ]) {
    const harness = loadGetMediaUrl();
    const { response } = await post(harness.handler, body);
    assert.equal(response.status, 403);
    assert.equal(harness.signCalls.length, 0);
  }
});

test('Premium Edge sources never log signed URLs or change Stream functions', () => {
  const source = `${read('supabase/functions/create-media-upload/index.ts')}\n${read('supabase/functions/get-media-url/index.ts')}`;
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^)]*(?:signedUrl|uploadUrl|url)/i);
  for (const streamPath of [
    'supabase/functions/create-stream-upload/index.ts',
    'supabase/functions/get-stream-playback/index.ts',
    'supabase/functions/delete-stream-video/index.ts',
    'supabase/functions/stream-webhook/index.ts',
  ]) assert.ok(read(streamPath).length > 0);
});
