import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

import {
  CreatorPremiumGrantError,
  clearCreatorPremiumContentKindHints,
  createCreatorPremiumViewerController,
  getCreatorPremiumContentKindHint,
  rememberCreatorPremiumContentKind,
} from '../services/creatorPremiumViewerRuntime.mjs';

const USER_A = '10000000-0000-4000-8000-000000000001';
const USER_B = '10000000-0000-4000-8000-000000000002';
const CONTENT_A = '20000000-0000-4000-8000-000000000001';
const CONTENT_B = '20000000-0000-4000-8000-000000000002';
const NOW = Date.parse('2026-10-09T12:00:00.000Z');
const root = path.resolve(import.meta.dirname, '..');
const signedStreamToken = 'eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3QifQ.eyJzdWIiOiJwcm92aWRlci11aWQiLCJleHAiOjE3OTAwMDAwMDB9.c2lnbmF0dXJl';

function compile(source, filename) {
  return ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
}

function loadImageGrantService(invoke) {
  const module = { exports: {} };
  const source = readFileSync(path.join(root, 'services/creatorPremiumMediaService.ts'), 'utf8');
  vm.runInNewContext(compile(source, 'creatorPremiumMediaService.ts'), {
    module,
    exports: module.exports,
    console,
    URL,
    require(specifier) {
      if (specifier === '@/services/mediaService') return {
        uploadMediaFromUri: async () => { throw new Error('unused'); },
        deleteMediaAsset: async () => {},
        getSafeMediaError: error => ({
          code: error?.code ?? error?.message ?? 'media_operation_failed',
          message: error?.message ?? 'media_operation_failed',
        }),
      };
      if (specifier === '@/template') return {
        getSupabaseClient: () => ({ functions: { invoke }, rpc: async () => ({ data: [], error: null }) }),
      };
      throw new Error(`Unexpected image module: ${specifier}`);
    },
  }, { filename: 'creatorPremiumMediaService.js' });
  return module.exports;
}

function loadVideoGrantService(invoke) {
  const module = { exports: {} };
  const source = readFileSync(path.join(root, 'services/creatorPremiumStreamService.ts'), 'utf8');
  vm.runInNewContext(compile(source, 'creatorPremiumStreamService.ts'), {
    module,
    exports: module.exports,
    console,
    URL,
    require(specifier) {
      if (specifier === '@/services/mediaService') return {
        uploadMediaFromUri: async () => { throw new Error('unused'); },
        deleteMediaAsset: async () => {},
        getSafeMediaError: error => ({ code: error?.code ?? 'media_operation_failed' }),
      };
      if (specifier === '@/services/streamService') return {
        createCreatorPremiumStreamUpload: async () => { throw new Error('unused'); },
        postVideoToStreamUploadUrl: async () => {},
        waitForCreatorPremiumStreamReady: async () => {},
        deleteStreamVideo: async () => {},
        getCreatorPremiumStreamCleanupAssetId: () => undefined,
        getSafeStreamError: error => ({ code: error?.code ?? 'stream_operation_failed' }),
      };
      if (specifier === '@/template') return {
        getSupabaseClient: () => ({ functions: { invoke }, rpc: async () => ({ data: [], error: null }) }),
      };
      throw new Error(`Unexpected video module: ${specifier}`);
    },
  }, { filename: 'creatorPremiumStreamService.js' });
  return module.exports;
}

function loadPremiumMetadataService(getUser) {
  const module = { exports: {} };
  const source = readFileSync(path.join(root, 'services/creatorPremiumService.ts'), 'utf8');
  vm.runInNewContext(compile(source, 'creatorPremiumService.ts'), {
    module,
    exports: module.exports,
    console,
    require(specifier) {
      if (specifier === '@/template') return {
        getSupabaseClient: () => ({
          auth: { getUser },
          rpc: async () => ({ data: [], error: null }),
        }),
      };
      throw new Error(`Unexpected metadata module: ${specifier}`);
    },
  }, { filename: 'creatorPremiumService.js' });
  return module.exports;
}

const imageGrant = (contentId = CONTENT_A, expiresAt = NOW + 300_000) => ({
  contentId,
  url: 'https://premium-private.0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/original.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=secret',
  expiresAt: new Date(expiresAt).toISOString(),
});

const videoGrant = (contentId = CONTENT_A, expiresAt = NOW + 300_000) => ({
  contentId,
  hlsUrl: `https://customer-test.cloudflarestream.com/${signedStreamToken}/manifest/video.m3u8`,
  dashUrl: `https://customer-test.cloudflarestream.com/${signedStreamToken}/manifest/video.mpd`,
  thumbnailUrl: `https://customer-test.cloudflarestream.com/${signedStreamToken}/thumbnails/thumbnail.jpg`,
  expiresAt: new Date(expiresAt).toISOString(),
});

const entitlement = (overrides = {}) => ({
  allowed: true,
  source: 'owner',
  reason: 'owner',
  expires_at: null,
  ...overrides,
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeController(overrides = {}) {
  let currentUserId = USER_A;
  const calls = [];
  const snapshots = [];
  const dependencies = {
    now: () => NOW,
    getCurrentUserId: async () => currentUserId,
    getEntitlement: async contentId => {
      calls.push(['entitlement', contentId]);
      return entitlement();
    },
    getImageGrant: async contentId => {
      calls.push(['image', contentId]);
      return imageGrant(contentId);
    },
    getVideoGrant: async contentId => {
      calls.push(['video', contentId]);
      throw new CreatorPremiumGrantError('missing', 'creator_premium_video_missing');
    },
    ...overrides,
  };
  const controller = createCreatorPremiumViewerController(dependencies, snapshot => {
    snapshots.push(structuredClone(snapshot));
  });
  return {
    controller,
    calls,
    snapshots,
    setCurrentUserId(value) { currentUserId = value; },
  };
}

test.beforeEach(() => clearCreatorPremiumContentKindHints());

test('owner, purchase, and subscription entitlements reveal a validated in-memory image grant', async t => {
  for (const source of ['owner', 'purchase', 'subscription']) {
    await t.test(source, async () => {
      rememberCreatorPremiumContentKind(USER_A, CONTENT_A, 'image');
      const { controller } = makeController({
        getEntitlement: async () => entitlement({ source, reason: source }),
      });
      await controller.open({ userId: USER_A, contentId: CONTENT_A });
      const snapshot = controller.getSnapshot();
      assert.equal(snapshot.status, 'ready');
      assert.equal(snapshot.mediaKind, 'image');
      assert.equal(snapshot.grant.contentId, CONTENT_A);
      assert.equal(snapshot.entitlementSource, source);
    });
  }
});

test('entitlement denial reasons fail closed without requesting media', async t => {
  const cases = [
    ['not_entitled', 'locked'],
    ['content_not_published', 'locked'],
    ['age_eligibility_required', 'restricted'],
    ['actor_account_restricted', 'restricted'],
    ['creator_account_restricted', 'restricted'],
    ['blocked_relationship', 'restricted'],
    ['content_unavailable', 'restricted'],
    ['purchase_refunded', 'revoked'],
    ['financial_transaction_reversed', 'revoked'],
    ['subscription_expired', 'expired'],
  ];
  for (const [reason, status] of cases) {
    await t.test(reason, async () => {
      let mediaCalls = 0;
      const { controller } = makeController({
        getEntitlement: async () => entitlement({ allowed: false, source: 'none', reason }),
        getImageGrant: async () => { mediaCalls += 1; return imageGrant(); },
        getVideoGrant: async () => { mediaCalls += 1; return videoGrant(); },
      });
      await controller.open({ userId: USER_A, contentId: CONTENT_A });
      assert.equal(controller.getSnapshot().status, status);
      assert.equal(controller.getSnapshot().grant, null);
      assert.equal(mediaCalls, 0);
    });
  }
});

test('an allowed entitlement with an expired paid period is denied before media', async () => {
  let mediaCalls = 0;
  const { controller } = makeController({
    getEntitlement: async () => entitlement({
      source: 'subscription',
      expires_at: new Date(NOW - 1).toISOString(),
    }),
    getImageGrant: async () => { mediaCalls += 1; return imageGrant(); },
  });
  await controller.open({ userId: USER_A, contentId: CONTENT_A });
  assert.equal(controller.getSnapshot().status, 'expired');
  assert.equal(mediaCalls, 0);
});

test('a malformed allowed entitlement source fails closed before media', async () => {
  let mediaCalls = 0;
  const { controller } = makeController({
    getEntitlement: async () => entitlement({ source: 'none' }),
    getImageGrant: async () => { mediaCalls += 1; return imageGrant(); },
    getVideoGrant: async () => { mediaCalls += 1; return videoGrant(); },
  });
  await controller.open({ userId: USER_A, contentId: CONTENT_A });
  assert.equal(controller.getSnapshot().status, 'error');
  assert.equal(controller.getSnapshot().reason, 'invalid_entitlement');
  assert.equal(controller.getSnapshot().grant, null);
  assert.equal(mediaCalls, 0);
});

test('absent purchase and absent subscription remain locked and never request original media', async t => {
  for (const reason of ['purchase_required', 'subscription_required']) {
    await t.test(reason, async () => {
      let mediaCalls = 0;
      const { controller } = makeController({
        getEntitlement: async () => entitlement({ allowed: false, source: 'none', reason }),
        getImageGrant: async () => { mediaCalls += 1; return imageGrant(); },
        getVideoGrant: async () => { mediaCalls += 1; return videoGrant(); },
      });
      await controller.open({ userId: USER_A, contentId: CONTENT_A });
      assert.equal(controller.getSnapshot().status, 'locked');
      assert.equal(controller.getSnapshot().grant, null);
      assert.equal(mediaCalls, 0);
    });
  }
});

test('image grants fail closed when expired, overlong, insecure, or for another content', async t => {
  const cases = [
    ['expired', imageGrant(CONTENT_A, NOW - 1)],
    ['overlong', imageGrant(CONTENT_A, NOW + 315_001)],
    ['insecure', { ...imageGrant(), url: 'http://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/original.jpg' }],
    ['unapproved-domain', { ...imageGrant(), url: 'https://private.example.test/original.jpg?signature=secret' }],
    ['credentials', { ...imageGrant(), url: 'https://user:pass@0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/original.jpg' }],
    ['fragment', { ...imageGrant(), url: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/original.jpg#secret' }],
    ['nondefault-port', { ...imageGrant(), url: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com:8443/premium-private/original.jpg' }],
    ['cross-content', imageGrant(CONTENT_B)],
  ];
  for (const [name, grant] of cases) {
    await t.test(name, async () => {
      rememberCreatorPremiumContentKind(USER_A, CONTENT_A, 'image');
      const { controller } = makeController({ getImageGrant: async () => grant });
      await controller.open({ userId: USER_A, contentId: CONTENT_A });
      assert.equal(controller.getSnapshot().status, 'error');
      assert.equal(controller.getSnapshot().grant, null);
    });
  }
});

test('canonical B3 signed Stream URLs remain accepted by the viewer runtime', async () => {
  rememberCreatorPremiumContentKind(USER_A, CONTENT_A, 'video');
  const { controller } = makeController({ getVideoGrant: async () => videoGrant() });
  await controller.open({ userId: USER_A, contentId: CONTENT_A });
  assert.equal(controller.getSnapshot().status, 'ready');
  assert.deepEqual(controller.getSnapshot().grant, { kind: 'video', ...videoGrant() });
});

test('video grants fail closed for a wrong domain, token shape, content, or expiry', async t => {
  const cases = [
    ['domain', { ...videoGrant(), hlsUrl: `https://video.example.test/${signedStreamToken}/manifest/video.m3u8` }],
    ['token', { ...videoGrant(), dashUrl: 'https://customer-test.cloudflarestream.com/not-a-signed-jwt/manifest/video.mpd' }],
    ['content', videoGrant(CONTENT_B)],
    ['expiry', videoGrant(CONTENT_A, NOW + 315_001)],
  ];
  for (const [name, grant] of cases) {
    await t.test(name, async () => {
      rememberCreatorPremiumContentKind(USER_A, CONTENT_A, 'video');
      const { controller } = makeController({ getVideoGrant: async () => grant });
      await controller.open({ userId: USER_A, contentId: CONTENT_A });
      assert.equal(controller.getSnapshot().status, 'error');
      assert.equal(controller.getSnapshot().grant, null);
    });
  }
});

test('viewer runtime rejects coherent noncanonical mutations across every signed Stream URL', async t => {
  const mutations = [
    ['credentials', value => value.replace('https://', 'https://user:pass@')],
    ['nondefault-port', value => value.replace('.cloudflarestream.com', '.cloudflarestream.com:8443')],
    ['fragment', value => `${value}#private`],
    ['unexpected-query', value => `${value}?download=1`],
    ['noncanonical-token', value => value.replace(signedStreamToken, 'not-a-signed-jwt')],
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, async () => {
      const base = videoGrant();
      const grant = {
        ...base,
        hlsUrl: mutate(base.hlsUrl),
        dashUrl: mutate(base.dashUrl),
        thumbnailUrl: mutate(base.thumbnailUrl),
      };
      rememberCreatorPremiumContentKind(USER_A, CONTENT_A, 'video');
      const { controller } = makeController({ getVideoGrant: async () => grant });
      await controller.open({ userId: USER_A, contentId: CONTENT_A });
      assert.equal(controller.getSnapshot().status, 'error');
      assert.equal(controller.getSnapshot().grant, null);
    });
  }
});

test('401, 403, revocation, and security failures are terminal and never try another provider', async t => {
  for (const [name, error] of [
    ['401', new CreatorPremiumGrantError('denied', 'http_401')],
    ['403', new CreatorPremiumGrantError('denied', 'http_403')],
    ['revoked', new CreatorPremiumGrantError('denied', 'creator_premium_revoked')],
    ['security', new CreatorPremiumGrantError('invalid', 'invalid_premium_image_grant')],
  ]) {
    await t.test(name, async () => {
      rememberCreatorPremiumContentKind(USER_A, CONTENT_A, 'image');
      let videoCalls = 0;
      const { controller } = makeController({
        getImageGrant: async () => { throw error; },
        getVideoGrant: async () => { videoCalls += 1; return videoGrant(); },
      });
      await controller.open({ userId: USER_A, contentId: CONTENT_A });
      assert.equal(videoCalls, 0);
      assert.equal(controller.getSnapshot().grant, null);
      assert.equal(controller.getSnapshot().status, name === 'security' ? 'error' : 'revoked');
    });
  }
});

test('only an explicit missing response may fall back from a stale hint', async () => {
  rememberCreatorPremiumContentKind(USER_A, CONTENT_A, 'image');
  const calls = [];
  const { controller } = makeController({
    getImageGrant: async () => {
      calls.push('image');
      throw new CreatorPremiumGrantError('missing', 'creator_premium_image_missing');
    },
    getVideoGrant: async () => {
      calls.push('video');
      return videoGrant();
    },
  });
  await controller.open({ userId: USER_A, contentId: CONTENT_A });
  assert.deepEqual(calls, ['image', 'video']);
  assert.equal(controller.getSnapshot().mediaKind, 'video');
  assert.equal(getCreatorPremiumContentKindHint(USER_A, CONTENT_A), 'video');
});

test('direct entry resolves exactly one provider and rejects an ambiguous dual grant', async () => {
  const valid = makeController({
    getImageGrant: async () => { throw new CreatorPremiumGrantError('missing', 'missing'); },
    getVideoGrant: async () => videoGrant(),
  });
  await valid.controller.open({ userId: USER_A, contentId: CONTENT_A });
  assert.equal(valid.controller.getSnapshot().mediaKind, 'video');

  clearCreatorPremiumContentKindHints();
  const ambiguous = makeController({
    getImageGrant: async () => imageGrant(),
    getVideoGrant: async () => videoGrant(),
  });
  await ambiguous.controller.open({ userId: USER_A, contentId: CONTENT_A });
  assert.equal(ambiguous.controller.getSnapshot().status, 'error');
  assert.equal(ambiguous.controller.getSnapshot().reason, 'ambiguous_media');
  assert.equal(ambiguous.controller.getSnapshot().grant, null);
});

test('direct entry reports missing media only after both canonical providers return missing', async () => {
  const { controller, calls } = makeController({
    getImageGrant: async contentId => {
      calls.push(['image', contentId]);
      throw new CreatorPremiumGrantError('missing', 'image_missing');
    },
    getVideoGrant: async contentId => {
      calls.push(['video', contentId]);
      throw new CreatorPremiumGrantError('missing', 'video_missing');
    },
  });
  await controller.open({ userId: USER_A, contentId: CONTENT_A });
  assert.deepEqual(calls.map(call => call[0]), ['entitlement', 'image', 'video']);
  assert.equal(controller.getSnapshot().status, 'error');
  assert.equal(controller.getSnapshot().reason, 'media_unavailable');
});

test('network and provider failures are terminal during direct entry', async t => {
  for (const code of ['network', 'unavailable']) {
    await t.test(code, async () => {
      let videoCalls = 0;
      const { controller } = makeController({
        getImageGrant: async () => { throw new CreatorPremiumGrantError(code, code); },
        getVideoGrant: async () => { videoCalls += 1; return videoGrant(); },
      });
      await controller.open({ userId: USER_A, contentId: CONTENT_A });
      assert.equal(videoCalls, 0);
      assert.equal(controller.getSnapshot().status, code === 'network' ? 'offline' : 'error');
    });
  }
});

test('a user change after grant acquisition discards the result', async () => {
  const grantDeferred = deferred();
  rememberCreatorPremiumContentKind(USER_A, CONTENT_A, 'image');
  const runtime = makeController({ getImageGrant: async () => grantDeferred.promise });
  const opening = runtime.controller.open({ userId: USER_A, contentId: CONTENT_A });
  runtime.setCurrentUserId(USER_B);
  grantDeferred.resolve(imageGrant());
  await opening;
  assert.equal(runtime.controller.getSnapshot().status, 'locked');
  assert.equal(runtime.controller.getSnapshot().reason, 'identity_changed');
  assert.equal(runtime.controller.getSnapshot().grant, null);
});

test('entitlement or grant expiry during the final identity check cannot publish ready media', async t => {
  for (const expiringAuthority of ['entitlement', 'grant']) {
    await t.test(expiringAuthority, async () => {
      let clock = NOW;
      let identityChecks = 0;
      const finalIdentity = deferred();
      rememberCreatorPremiumContentKind(USER_A, CONTENT_A, 'image');
      const { controller } = makeController({
        now: () => clock,
        getCurrentUserId: async () => {
          identityChecks += 1;
          return identityChecks === 1 ? USER_A : finalIdentity.promise;
        },
        getEntitlement: async () => entitlement({
          source: 'subscription',
          expires_at: expiringAuthority === 'entitlement'
            ? new Date(NOW + 1_000).toISOString()
            : null,
        }),
        getImageGrant: async () => imageGrant(
          CONTENT_A,
          expiringAuthority === 'grant' ? NOW + 1_000 : NOW + 300_000,
        ),
      });

      const opening = controller.open({ userId: USER_A, contentId: CONTENT_A });
      while (identityChecks < 2) await Promise.resolve();
      clock = NOW + 2_000;
      finalIdentity.resolve(USER_A);
      await opening;

      const snapshot = controller.getSnapshot();
      assert.notEqual(snapshot.status, 'ready');
      assert.equal(snapshot.status, 'expired');
      assert.equal(snapshot.grant, null);
    });
  }
});

test('late content-A result cannot overwrite a newer content-B session', async () => {
  const grantA = deferred();
  const enteredGrantA = deferred();
  rememberCreatorPremiumContentKind(USER_A, CONTENT_A, 'image');
  rememberCreatorPremiumContentKind(USER_A, CONTENT_B, 'image');
  const runtime = makeController({
    getImageGrant: async contentId => {
      if (contentId !== CONTENT_A) return imageGrant(CONTENT_B);
      enteredGrantA.resolve();
      return grantA.promise;
    },
  });
  const openingA = runtime.controller.open({ userId: USER_A, contentId: CONTENT_A });
  await enteredGrantA.promise;
  await runtime.controller.open({ userId: USER_A, contentId: CONTENT_B });
  grantA.resolve(imageGrant(CONTENT_A));
  await openingA;
  assert.equal(runtime.controller.getSnapshot().contentId, CONTENT_B);
  assert.equal(runtime.controller.getSnapshot().grant.contentId, CONTENT_B);
});

test('close and logout invalidate late grants and clear in-memory media', async t => {
  for (const reason of ['close', 'logout']) {
    await t.test(reason, async () => {
      const pending = deferred();
      const enteredGrant = deferred();
      rememberCreatorPremiumContentKind(USER_A, CONTENT_A, 'image');
      const { controller } = makeController({
        getImageGrant: async () => {
          enteredGrant.resolve();
          return pending.promise;
        },
      });
      const opening = controller.open({ userId: USER_A, contentId: CONTENT_A });
      await enteredGrant.promise;
      controller.invalidate(reason);
      pending.resolve(imageGrant());
      await opening;
      assert.equal(controller.getSnapshot().grant, null);
      assert.equal(controller.getSnapshot().status, reason === 'logout' ? 'locked' : 'idle');
    });
  }
});

test('unmount disposal prevents a late grant from restoring protected content', async () => {
  const pending = deferred();
  const enteredGrant = deferred();
  rememberCreatorPremiumContentKind(USER_A, CONTENT_A, 'image');
  const { controller } = makeController({
    getImageGrant: async () => {
      enteredGrant.resolve();
      return pending.promise;
    },
  });
  const opening = controller.open({ userId: USER_A, contentId: CONTENT_A });
  await enteredGrant.promise;
  controller.dispose();
  pending.resolve(imageGrant());
  await opening;
  assert.equal(controller.getSnapshot().status, 'idle');
  assert.equal(controller.getSnapshot().reason, 'disposed');
  assert.equal(controller.getSnapshot().grant, null);
});

test('content-kind hints are user-scoped, bounded, and clearable', () => {
  rememberCreatorPremiumContentKind(USER_A, CONTENT_A, 'image');
  assert.equal(getCreatorPremiumContentKindHint(USER_A, CONTENT_A), 'image');
  assert.equal(getCreatorPremiumContentKindHint(USER_B, CONTENT_A), null);
  for (let index = 0; index < 130; index += 1) {
    rememberCreatorPremiumContentKind(USER_A, `content-${index}`, 'video');
  }
  assert.equal(getCreatorPremiumContentKindHint(USER_A, CONTENT_A), null);
  clearCreatorPremiumContentKindHints();
  assert.equal(getCreatorPremiumContentKindHint(USER_A, 'content-129'), null);
});

test('canonical image service returns content identity and rejects grants beyond the TTL ceiling', async () => {
  const service = loadImageGrantService(async () => ({
    data: { success: true, data: imageGrant(CONTENT_A, Date.now() + 300_000) },
    error: null,
  }));
  const valid = await service.getCreatorPremiumOriginalImageGrant(CONTENT_A);
  assert.equal(valid.contentId, CONTENT_A);

  const overlong = loadImageGrantService(async () => ({
    data: { success: true, data: imageGrant(CONTENT_A, Date.now() + 316_000) },
    error: null,
  }));
  await assert.rejects(
    () => overlong.getCreatorPremiumOriginalImageGrant(CONTENT_A),
    /invalid_premium_image_grant/,
  );

  const foreignHost = loadImageGrantService(async () => ({
    data: {
      success: true,
      data: { ...imageGrant(CONTENT_A, Date.now() + 300_000), url: 'https://tracker.example.test/original.jpg' },
    },
    error: null,
  }));
  await assert.rejects(
    () => foreignHost.getCreatorPremiumOriginalImageGrant(CONTENT_A),
    /invalid_premium_image_grant/,
  );
});

test('canonical image and video services preserve safe typed denial/missing/unavailable failures', async t => {
  const cases = [
    [401, 'denied'],
    [403, 'denied'],
    [404, 'missing'],
    [503, 'unavailable'],
  ];
  for (const [status, expected] of cases) {
    await t.test(String(status), async () => {
      for (const load of [loadImageGrantService, loadVideoGrantService]) {
        const service = load(async () => ({ data: null, error: { context: { status } } }));
        const operation = load === loadImageGrantService
          ? () => service.getCreatorPremiumOriginalImageGrant(CONTENT_A)
          : () => service.getCreatorPremiumVideoPlaybackGrant(CONTENT_A);
        await assert.rejects(operation, error => {
          assert.equal(error.grantCode, expected);
          assert.doesNotMatch(error.message, /https?:|token|cloudflare/i);
          return true;
        });
      }
    });
  }
});

test('canonical video service returns content identity in a validated signed grant', async () => {
  const service = loadVideoGrantService(async () => ({
    data: { success: true, data: videoGrant(CONTENT_A, Date.now() + 300_000) },
    error: null,
  }));
  const grant = await service.getCreatorPremiumVideoPlaybackGrant(CONTENT_A);
  assert.equal(grant.contentId, CONTENT_A);
});

test('viewer capability is explicit while finance and aggregate public launch remain disabled', async () => {
  const service = loadPremiumMetadataService(async () => ({
    data: { user: { id: USER_A } },
    error: null,
  }));
  assert.equal(service.CREATOR_PREMIUM_VIEWER_AVAILABLE, true);
  assert.equal(service.CREATOR_PREMIUM_FINANCE_AVAILABLE, false);
  assert.equal(service.CREATOR_PREMIUM_MEDIA_AVAILABLE, false);
  assert.doesNotMatch(service.CREATOR_PREMIUM_FOUNDATION_MESSAGE, /visor protegido todavía no/i);
  assert.equal(await service.getCurrentCreatorPremiumUserId(), USER_A);
});
