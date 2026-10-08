import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const helperPath = path.join(root, 'supabase/functions/_shared/premiumStreamSecurity.ts');
const read = relative => readFileSync(path.join(root, relative), 'utf8');

function compileCommonJs(source, filename) {
  return ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function executeModule(source, filename, modules = {}, globals = {}) {
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    crypto,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    URL,
    Date,
    ...globals,
    require(specifier) {
      if (Object.hasOwn(modules, specifier)) return modules[specifier];
      throw new Error(`Unexpected module in ${filename}: ${specifier}`);
    },
  };
  vm.runInNewContext(compileCommonJs(source, filename), sandbox, { filename });
  return module.exports;
}

function loadHelper(env = {}) {
  assert.equal(existsSync(helperPath), true, 'Premium Stream security helper must exist');
  return executeModule(read('supabase/functions/_shared/premiumStreamSecurity.ts'), 'premiumStreamSecurity.ts', {
    './stream.ts': {
      STREAM_MAX_DURATION_SECONDS: 60,
      durationOrNull(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      },
      positiveDimensionOrNull(value) {
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
      },
      progressOrNull(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
      },
    },
  }, {
    Deno: { env: { get: name => env[name] } },
  });
}

function decodePart(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

async function verifyLocally(token, publicJwk, nowSeconds) {
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  if (!headerPart || !payloadPart || !signaturePart) return false;
  const key = await crypto.subtle.importKey(
    'jwk', publicJwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['verify'],
  );
  const signatureValid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key,
    Buffer.from(signaturePart, 'base64url'),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  const claims = decodePart(payloadPart);
  return signatureValid && claims.nbf <= nowSeconds && claims.exp > nowSeconds;
}

test('Premium reconciliation requires signed provider protection and never persists provider URLs', () => {
  const helper = loadHelper();
  const ready = helper.reconcilePremiumStreamVideo({
    uid: 'provider-uid',
    duration: 12,
    width: 1920,
    height: 1080,
    readyToStream: true,
    requireSignedURLs: true,
    status: { state: 'ready', pctComplete: 100 },
    playback: { hls: 'https://forbidden/hls', dash: 'https://forbidden/dash' },
    thumbnail: 'https://forbidden/thumb',
  }, 'provider-uid', 60);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.hls_url, null);
  assert.equal(ready.dash_url, null);
  assert.equal(ready.thumbnail_url, null);
  assert.deepEqual(JSON.parse(JSON.stringify(ready.provider_metadata)), { require_signed_urls: true });

  for (const requireSignedURLs of [false, undefined]) {
    const rejected = helper.reconcilePremiumStreamVideo({
      uid: 'provider-uid', duration: 12, readyToStream: true,
      requireSignedURLs, status: { state: 'ready' },
    }, 'provider-uid', 60);
    assert.equal(rejected.status, 'failed');
    assert.equal(rejected.error_code, 'creator_premium_stream_signed_urls_required');
    assert.equal(rejected.ready_at, null);
    assert.equal(rejected.hls_url, null);
  }
  const wrongUid = helper.reconcilePremiumStreamVideo({
    uid: 'other-uid', duration: 12, readyToStream: true,
    requireSignedURLs: true, status: { state: 'ready' },
  }, 'provider-uid', 60);
  assert.equal(wrongUid.status, 'failed');
  assert.equal(wrongUid.error_code, 'stream_ready_invariant_failed');
});

test('locally signed Stream token is RS256, bounded to 300 seconds, and cryptographically verifiable', async () => {
  const pair = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
  }, true, ['sign', 'verify']);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const wrongPair = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
  }, true, ['sign', 'verify']);
  const wrongPublicJwk = await crypto.subtle.exportKey('jwk', wrongPair.publicKey);
  const jwkB64 = Buffer.from(JSON.stringify(privateJwk), 'utf8').toString('base64');
  const now = 1_800_000_000;
  const helper = loadHelper();
  const grant = await helper.createPremiumStreamPlaybackGrant({
    cloudflareUid: '0123456789abcdef0123456789abcdef',
    customerCode: 'abc123',
    nowSeconds: now,
    keyId: 'test-key-id',
    privateJwkB64: jwkB64,
  });

  assert.deepEqual(Object.keys(grant).sort(), ['dashUrl', 'expiresAt', 'hlsUrl', 'thumbnailUrl']);
  const hls = new URL(grant.hlsUrl);
  const dash = new URL(grant.dashUrl);
  const thumbnail = new URL(grant.thumbnailUrl);
  assert.equal(hls.hostname, 'customer-abc123.cloudflarestream.com');
  assert.match(hls.pathname, /^\/[A-Za-z0-9_.-]+\/manifest\/video\.m3u8$/);
  assert.match(dash.pathname, /^\/[A-Za-z0-9_.-]+\/manifest\/video\.mpd$/);
  assert.match(thumbnail.pathname, /^\/[A-Za-z0-9_.-]+\/thumbnails\/thumbnail\.jpg$/);
  const token = hls.pathname.split('/')[1];
  assert.equal(dash.pathname.split('/')[1], token);
  assert.equal(thumbnail.pathname.split('/')[1], token);
  const [headerPart, payloadPart] = token.split('.');
  const header = decodePart(headerPart);
  const claims = decodePart(payloadPart);
  assert.deepEqual(header, { alg: 'RS256', kid: 'test-key-id' });
  assert.equal(claims.sub, '0123456789abcdef0123456789abcdef');
  assert.equal(claims.kid, 'test-key-id');
  assert.equal(claims.exp, now + 300);
  assert.equal(claims.nbf, now - 30);
  assert.equal(Object.hasOwn(claims, 'downloadable'), false);
  assert.equal(Object.hasOwn(claims, 'download'), false);
  assert.equal(await verifyLocally(token, publicJwk, now), true);
  assert.equal(await verifyLocally(token, wrongPublicJwk, now), false);
  assert.equal(Date.parse(grant.expiresAt), (now + 300) * 1000);

  const expired = await helper.createPremiumStreamPlaybackGrant({
    cloudflareUid: '0123456789abcdef0123456789abcdef',
    customerCode: 'abc123',
    nowSeconds: now - 301,
    keyId: 'test-key-id',
    privateJwkB64: jwkB64,
  });
  const expiredToken = new URL(expired.hlsUrl).pathname.split('/')[1];
  assert.equal(await verifyLocally(expiredToken, publicJwk, now), false);
});

test('runtime signing loads only the two named secrets and returns no raw token or key material', async () => {
  const pair = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
  }, true, ['sign', 'verify']);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const helper = loadHelper({
    STREAM_SIGNING_KEY_ID: 'runtime-key-id',
    STREAM_SIGNING_KEY_JWK_B64: Buffer.from(JSON.stringify(privateJwk), 'utf8').toString('base64'),
  });
  const grant = await helper.createPremiumStreamPlaybackGrant({
    cloudflareUid: '0123456789abcdef0123456789abcdef',
    customerCode: 'abc123',
    nowSeconds: 1_800_000_000,
  });
  const serialized = JSON.stringify(grant);
  assert.doesNotMatch(serialized, /runtime-key-id/);
  assert.doesNotMatch(serialized, /\"kty\"|\"d\"/);
  assert.equal(Object.hasOwn(grant, 'token'), false);
});
