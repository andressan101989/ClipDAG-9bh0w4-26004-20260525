import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createCreatorPremiumRenewalScheduler } from '../services/creatorPremiumViewerRuntime.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => readFileSync(path.join(root, relative), 'utf8');

test('renewal scheduler fires about fifteen seconds before the earliest active expiry', () => {
  const NOW = Date.parse('2026-10-09T12:00:00.000Z');
  let clock = NOW;
  const timers = [];
  const cleared = [];
  let renewals = 0;
  let expirations = 0;
  const scheduler = createCreatorPremiumRenewalScheduler({
    now: () => clock,
    setTimeout: (callback, delay) => {
      const timer = { callback, delay, id: timers.length + 1 };
      timers.push(timer);
      return timer.id;
    },
    clearTimeout: id => cleared.push(id),
    onRenew: () => { renewals += 1; },
    onExpire: () => { expirations += 1; },
  });

  scheduler.schedule({
    focused: true,
    status: 'ready',
    grantExpiresAt: new Date(NOW + 300_000).toISOString(),
    entitlementExpiresAt: new Date(NOW + 120_000).toISOString(),
  });
  assert.equal(timers.at(-1).delay, 105_000);
  clock += timers.at(-1).delay;
  timers.at(-1).callback();
  assert.equal(renewals, 1);

  scheduler.schedule({
    focused: true,
    status: 'ready',
    grantExpiresAt: new Date(NOW + 300_000).toISOString(),
    entitlementExpiresAt: new Date(NOW + 120_000).toISOString(),
  });
  assert.equal(timers.at(-1).delay, 15_000);
  clock += timers.at(-1).delay;
  timers.at(-1).callback();
  assert.equal(renewals, 1, 'the unchanged entitlement expiry must not renew in a zero-delay loop');
  assert.equal(expirations, 1, 'the unchanged authority must fail closed at its hard expiry');

  scheduler.schedule({
    focused: true,
    status: 'playing',
    grantExpiresAt: new Date(clock - 1).toISOString(),
    entitlementExpiresAt: null,
  });
  assert.equal(timers.at(-1).delay, 0);
  timers.at(-1).callback();
  assert.equal(renewals, 1);
  assert.equal(expirations, 2);
});

test('renewal scheduler renews a grant once, then preserves only its hard-expiry fail-closed timer', () => {
  const NOW = Date.parse('2026-10-09T12:00:00.000Z');
  let clock = NOW;
  const timers = [];
  let renewals = 0;
  let expirations = 0;
  const scheduler = createCreatorPremiumRenewalScheduler({
    now: () => clock,
    setTimeout: (callback, delay) => {
      const timer = { callback, delay, id: timers.length + 1 };
      timers.push(timer);
      return timer.id;
    },
    clearTimeout: () => {},
    onRenew: () => { renewals += 1; },
    onExpire: () => { expirations += 1; },
  });
  const grantExpiresAt = new Date(NOW + 300_000).toISOString();
  scheduler.schedule({ focused: true, status: 'paused', grantExpiresAt, entitlementExpiresAt: null });
  assert.equal(timers.at(-1).delay, 285_000);
  clock += timers.at(-1).delay;
  timers.at(-1).callback();
  assert.equal(renewals, 1);
  scheduler.schedule({ focused: true, status: 'ready', grantExpiresAt, entitlementExpiresAt: null });
  assert.equal(timers.at(-1).delay, 15_000);
  clock += timers.at(-1).delay;
  timers.at(-1).callback();
  assert.equal(renewals, 1);
  assert.equal(expirations, 1);
});

test('renewal scheduler never runs for hidden or denied content and cancels prior timers', () => {
  let nextId = 0;
  const active = new Map();
  let renewals = 0;
  const scheduler = createCreatorPremiumRenewalScheduler({
    now: () => 1_000,
    setTimeout: (callback, delay) => {
      nextId += 1;
      active.set(nextId, { callback, delay });
      return nextId;
    },
    clearTimeout: id => active.delete(id),
    onRenew: () => { renewals += 1; },
  });

  scheduler.schedule({ focused: true, status: 'ready', grantExpiresAt: new Date(61_000).toISOString(), entitlementExpiresAt: null });
  assert.equal(active.size, 1);
  scheduler.schedule({ focused: false, status: 'ready', grantExpiresAt: new Date(61_000).toISOString(), entitlementExpiresAt: null });
  assert.equal(active.size, 0);
  scheduler.schedule({ focused: true, status: 'revoked', grantExpiresAt: new Date(61_000).toISOString(), entitlementExpiresAt: null });
  assert.equal(active.size, 0);
  assert.equal(renewals, 0);
});

test('viewer hook revalidates session, entitlement, focus, foreground, auth changes, and timers', () => {
  const hook = read('hooks/useCreatorPremiumViewer.ts');
  assert.match(hook, /getCurrentCreatorPremiumUserId/);
  assert.match(hook, /getMyCreatorPremiumEntitlement/);
  assert.match(hook, /getCreatorPremiumOriginalImageGrant/);
  assert.match(hook, /getCreatorPremiumVideoPlaybackGrant/);
  assert.match(hook, /usePremiumScreenProtection/);
  assert.match(hook, /useFocusEffect/);
  assert.match(hook, /AppState\.addEventListener/);
  assert.match(hook, /auth\.onAuthStateChange/);
  assert.match(hook, /invalidate\('background'\)/);
  assert.match(hook, /invalidate\('logout'\)/);
  assert.match(hook, /createCreatorPremiumRenewalScheduler/);
  assert.match(hook, /protectionState\s*===\s*'protected'/);
  assert.match(hook, /controller\.dispose\(\)/);
  assert.match(hook, /subscription\.unsubscribe\(\)/);
  assert.doesNotMatch(hook, /AsyncStorage|SecureStore|SQLite|FileSystem|MediaLibrary|console\.|analytics/i);
});

test('revalidation hides the active grant before an asynchronous session lookup can cross expiry', () => {
  const hook = read('hooks/useCreatorPremiumViewer.ts');
  const runOpenStart = hook.indexOf('const runOpen = useCallback');
  const runOpenEnd = hook.indexOf('refreshRef.current = runOpen');
  const runOpen = hook.slice(runOpenStart, runOpenEnd);
  const hideIndex = runOpen.indexOf("controller.invalidate('revalidate')");
  const identityIndex = runOpen.indexOf('await getCurrentCreatorPremiumUserId()');
  assert.ok(runOpenStart >= 0 && runOpenEnd > runOpenStart);
  assert.ok(hideIndex >= 0, 'revalidation must clear the mounted grant immediately');
  assert.ok(identityIndex > hideIndex, 'grant clearing must precede the async identity lookup');
});

test('viewer route accepts only contentId and keeps an opaque cover until native protection succeeds', () => {
  const viewer = read('app/creator-premium-viewer/[contentId].tsx');
  assert.match(viewer, /useLocalSearchParams<\{\s*contentId\?/);
  assert.match(viewer, /useCreatorPremiumViewer\(contentId\)/);
  assert.match(
    viewer,
    /snapshot\.contentId\s*===\s*contentId/,
    'a route parameter change must synchronously cover the previous content grant',
  );
  assert.match(viewer, /protectionState\s*===\s*'protected'/);
  assert.match(viewer, /styles\.opaqueCover/);
  assert.match(viewer, /ProtectedPremiumImage/);
  assert.match(viewer, /ProtectedPremiumVideo/);
  assert.match(viewer, /PremiumWatermark/);
  assert.match(viewer, /Volver/);
  assert.doesNotMatch(viewer, /assetId|cloudflareUid|signedUrl|hlsUrl\s*=|dashUrl\s*=|thumbnailUrl\s*=/i);
});

test('native media failure clears the grant and waits for an explicit safe retry', () => {
  const hook = read('hooks/useCreatorPremiumViewer.ts');
  const viewer = read('app/creator-premium-viewer/[contentId].tsx');
  assert.match(hook, /failMedia\(\): void/);
  assert.match(hook, /controller\.invalidate\('security'\)/);
  assert.match(viewer, /onError=\{failMedia\}/);
  assert.doesNotMatch(viewer, /onError=\{\(\)\s*=>\s*\{\s*void refresh\(\)/);
});

test('playback status callback is stable and cannot reload the protected source on each state update', () => {
  const viewer = read('app/creator-premium-viewer/[contentId].tsx');
  assert.match(viewer, /const handlePlaybackStateChange\s*=\s*useCallback/);
  assert.match(viewer, /onPlaybackStateChange=\{handlePlaybackStateChange\}/);
  assert.doesNotMatch(viewer, /onPlaybackStateChange=\{isPlaying\s*=>/);
});

test('viewer presents distinct safe states without provider or schema detail', () => {
  const viewer = read('app/creator-premium-viewer/[contentId].tsx');
  for (const state of ['loading', 'locked', 'ready', 'playing', 'paused', 'expired', 'revoked', 'restricted', 'error', 'offline']) {
    assert.match(viewer, new RegExp(`['"]${state}['"]`));
  }
  assert.doesNotMatch(viewer, /bucket|object_key|cloudflare|jwt|service_role|financial_transaction/i);
});

test('creator profile uses only the canonical teaser catalog and contentId-only entitled navigation', () => {
  const profile = read('app/creator/[id].tsx');
  assert.match(profile, /fetchCreatorPremiumCatalog/);
  assert.doesNotMatch(profile, /fetchCreatorExclusiveContent/);
  assert.match(profile, /rememberCreatorPremiumContentKind/);
  assert.match(profile, /item\.entitled/);
  assert.match(profile, /pathname:\s*['"]\/creator-premium-viewer\/\[contentId\]['"]/);
  assert.match(profile, /params:\s*\{\s*contentId:\s*item\.id\s*\}/);
  assert.match(profile, /item\.teaser_url/);
  assert.doesNotMatch(profile, /getCreatorPremiumOriginalImageGrant|getCreatorPremiumVideoPlaybackGrant|object_key|cloudflare_uid/i);
});

test('Premium library uses canonical bounded pagination, deduplication, refresh, retry, and stale-request invalidation', () => {
  const library = read('app/my-premium-library.tsx');
  assert.match(library, /fetchMyCreatorPremiumLibrary/);
  assert.match(library, /fetchCreatorPremiumLibraryTeasers/);
  assert.match(library, /limit:\s*24/);
  assert.match(library, /nextCursor/);
  assert.match(library, /new Map/);
  assert.match(library, /requestGeneration/);
  assert.match(library, /RefreshControl/);
  assert.match(library, /handlePaginationScroll/);
  assert.match(library, /Reintentar/);
  assert.match(library, /Sin contenido Premium/);
  assert.match(library, /Acceso vencido/);
  assert.match(library, /pathname:\s*['"]\/creator-premium-viewer\/\[contentId\]['"]/);
  assert.match(library, /params:\s*\{\s*contentId:\s*item\.id\s*\}/);
  assert.doesNotMatch(library, /getCreatorPremiumOriginalImageGrant|getCreatorPremiumVideoPlaybackGrant|signedUrl|objectKey|assetId|cloudflareUid|hlsUrl|dashUrl|thumbnailUrl/i);
});

test('Premium library binds rows and cursors to the current account and clears them on every identity change', () => {
  const library = read('app/my-premium-library.tsx');
  assert.match(library, /activeUserIdRef/);
  assert.match(library, /itemsOwnerId/);
  assert.match(library, /visibleItems/);
  assert.match(library, /useEffect\(\(\)\s*=>\s*\{/);
  assert.match(library, /nextCursorRef\.current\s*=\s*null/);
  assert.match(library, /setItems\(\[\]\)/);
  assert.match(library, /setItemsOwnerId\(user\?\.id\s*\?\?\s*null\)/);
  assert.match(library, /activeUserIdRef\.current\s*!==\s*expectedUserId/);
  const resetStart = library.indexOf('if (reset) {');
  const fetchStart = library.indexOf('const page = await fetchMyCreatorPremiumLibrary');
  const resetPath = library.slice(resetStart, fetchStart);
  assert.ok(resetStart >= 0 && fetchStart > resetStart);
  assert.match(resetPath, /nextCursorRef\.current\s*=\s*null/);
  assert.match(resetPath, /loadingMoreRef\.current\s*=\s*false/);
});

test('library teaser hydration is canonical, public-projection-only, bounded, and fail-soft', () => {
  const service = read('services/creatorPremiumService.ts');
  assert.match(service, /fetchCreatorPremiumLibraryTeasers/);
  assert.match(service, /fetchCreatorPremiumCatalog\(creatorId,\s*\{\s*limit:\s*100\s*\}\)/);
  assert.match(service, /catalogItem\.entitled/);
  assert.match(service, /teaser_url/);
  assert.doesNotMatch(service, /library.*getCreatorPremiumOriginalImageGrant|library.*getCreatorPremiumVideoPlaybackGrant/i);
});

test('consumer Premium entry and both B6 routes are registered without payment actions', () => {
  const profile = read('app/(tabs)/profile.tsx');
  const layout = read('app/_layout.tsx');
  assert.match(profile, /router\.push\(['"]\/my-premium-library['"]\)/);
  assert.match(layout, /name="my-premium-library"/);
  assert.match(layout, /name="creator-premium-viewer\/\[contentId\]"/);
  for (const file of [
    'app/my-premium-library.tsx',
    'app/creator-premium-viewer/[contentId].tsx',
    'hooks/useCreatorPremiumViewer.ts',
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /purchaseCreatorPremium|subscribeCreatorPremium|refundCreatorPremium|ledgerClient|bdag-ledger/i);
  }
});

test('locked consumer copy is truthful while Premium finance remains disabled', () => {
  const profile = read('app/creator/[id].tsx');
  const library = read('app/my-premium-library.tsx');
  const service = read('services/creatorPremiumService.ts');
  assert.match(profile, /compras.*no están habilitadas/i);
  assert.match(library, /Las compras y suscripciones aún no están habilitadas/i);
  assert.match(service, /CREATOR_PREMIUM_FINANCE_AVAILABLE:\s*boolean\s*=\s*false/);
  assert.doesNotMatch(`${profile}\n${library}`, /Comprar ahora|Suscribirse ahora|Publicar ahora/i);
});
