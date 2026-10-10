import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = relative => {
  const path = new URL(relative, root);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};

const service = read('services/creatorPremiumService.ts');
const ledger = read('services/financial/ledgerClient.ts');
const profile = read('app/creator/[id].tsx');
const offer = read('app/creator-premium-offer/[contentId].tsx');
const subscriptions = read('app/my-subscriptions.tsx');
const hub = read('app/creator-monetization.tsx');
const layout = read('app/_layout.tsx');

test('locked profile cards use only teaser metadata and navigate by contentId to the offer surface', () => {
  const start = profile.indexOf('{/* ── Exclusive content grid');
  const end = profile.indexOf("{profileTab === 'products'", start);
  const premiumGrid = start >= 0 && end > start ? profile.slice(start, end) : '';
  assert.ok(premiumGrid, 'profile Premium grid must be identifiable');
  assert.match(profile, /fetchCreatorPremiumCatalog/i);
  assert.match(premiumGrid, /teaser_url/i);
  assert.match(premiumGrid, /creator-premium-offer\/\[contentId\]/i);
  assert.match(premiumGrid, /params\s*:\s*\{\s*contentId\s*:\s*item\.id\s*\}/i);
  assert.doesNotMatch(premiumGrid, /getCreatorPremiumOriginalImageGrant|getCreatorPremiumVideoPlaybackGrant/i);
  assert.doesNotMatch(premiumGrid, /(?:hls|dash|thumbnail|signed)_?url/i);
});

test('commerce screen receives only contentId and renders canonical offers/plans', () => {
  assert.ok(offer, 'creator Premium offer route must exist');
  assert.match(offer, /useLocalSearchParams/i);
  assert.match(offer, /contentId/i);
  assert.match(offer, /fetchCreatorPremiumCommerce/i);
  assert.match(offer, /price_bdag/i);
  assert.match(offer, /billing_period_days/i);
  assert.match(offer, /Cada[^\n]*días/i);
  assert.doesNotMatch(offer, /asset_id|cloudflare_uid|object_key|bucket_name/i);
  assert.doesNotMatch(offer, /Number\([^\n]*price|parseFloat\([^\n]*price/i);
});

test('purchase and subscription actions are double-gated and use stable in-memory UUID attempts', () => {
  assert.match(offer, /CREATOR_PREMIUM_FINANCE_AVAILABLE/i);
  assert.match(offer, /purchase_enabled/i);
  assert.match(offer, /subscription_enabled/i);
  assert.match(offer, /purchaseContent/i);
  assert.match(offer, /subscribeToPlan/i);
  assert.match(offer, /randomUUID/i);
  assert.match(offer, /useRef/i);
  assert.match(offer, /busy|inFlight|pending/i);
  assert.match(offer, /idempotencyKey/i);
  assert.doesNotMatch(offer, /\b(?:amount|fee|creator_account_id|platform_account_id)\s*:/i);
  assert.match(service, /CREATOR_PREMIUM_FINANCE_AVAILABLE:\s*boolean\s*=\s*false/i);
  assert.match(ledger, /idempotencyKey/i);
});

test('commerce and subscription requests are fenced to the active user and screen context', () => {
  for (const source of [offer, subscriptions]) {
    assert.match(source, /useAuth/i);
    assert.match(source, /contextGeneration/i);
    assert.match(source, /requestGeneration/i);
    assert.match(source, /generation\s*!==\s*contextGeneration\.current/i);
  }
  assert.match(offer, /subscriptionAttempts\.current\.clear\(\)/i);
  assert.match(offer, /purchaseAttempt\.current\s*=\s*randomUUID\(\)/i);
  assert.match(subscriptions, /cancelAttempts\.current\.clear\(\)/i);
});

test('subscription UI uses canonical relationships and removes legacy fake commerce', () => {
  assert.match(subscriptions, /fetchMyCreatorPremiumSubscriptions/i);
  assert.match(subscriptions, /cancelCreatorPremiumSubscription/i);
  assert.match(subscriptions, /paid_through_at/i);
  assert.match(subscriptions, /billing_period_days/i);
  assert.match(subscriptions, /Cada[^\n]*días/i);
  assert.match(subscriptions, /renovaci[oó]n autom[aá]tica[^\n]*(?:no|sin)|no[^\n]*renovaci[oó]n autom[aá]tica/i);
  for (const legacy of ['free_dms', 'DMs gratis', 'subscribers_count', 'Gasto mensual total', 'BDAG/mes', 'Insignia VIP']) {
    assert.doesNotMatch(subscriptions, new RegExp(legacy, 'i'));
  }
  assert.doesNotMatch(subscriptions, /services\/subscriptionService|economyService/i);
});

test('creator hub exposes real earnings and rejection recovery without client accounting', () => {
  assert.match(hub, /Ingresos/i);
  assert.match(hub, /fetchMyCreatorPremiumCommercialSummary/i);
  assert.match(hub, /gross|bruto/i);
  assert.match(hub, /platform_fee|comisi[oó]n/i);
  assert.match(hub, /creator_net|neto/i);
  assert.match(hub, /refund|reembolso/i);
  assert.match(hub, /rejected|Rechazado/i);
  assert.match(hub, /reopenMyCreatorPremiumRejected/i);
  assert.doesNotMatch(hub, /Number\([^\n]*(?:gross|fee|net|revenue)|parseFloat\([^\n]*(?:gross|fee|net|revenue)/i);
  assert.doesNotMatch(hub, /fake|mock|estimated_revenue|conversion_rate|views_count/i);
});

test('Premium reporting sends safe identifiers and reason text, never private grants', () => {
  assert.match(offer, /reportCreatorPremiumContent/i);
  assert.match(offer, /reason|motivo/i);
  assert.match(service, /report_creator_premium_content_v1/i);
  assert.doesNotMatch(service, /signedUrl|object_key|bucket_name|cloudflare_uid/i);
  assert.doesNotMatch(offer, /signedUrl|object_key|bucket_name|cloudflare_uid/i);
});

test('offer route is registered and B6 remains the only protected viewer', () => {
  assert.match(layout, /creator-premium-offer\/\[contentId\]/i);
  assert.match(layout, /creator-premium-viewer\/\[contentId\]/i);
  assert.doesNotMatch(offer, /expo-video|ProtectedPremiumImage|ProtectedPremiumVideo|getCreatorPremiumOriginalImageGrant|getCreatorPremiumVideoPlaybackGrant/i);
  assert.doesNotMatch(offer, /AsyncStorage|SecureStore|FileSystem|MediaLibrary|Share\./i);
});
