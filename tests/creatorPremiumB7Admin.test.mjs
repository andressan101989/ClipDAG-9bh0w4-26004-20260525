import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = relative => {
  const path = new URL(relative, root);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};

const imageEdge = read('supabase/functions/get-media-url/index.ts');
const streamEdge = read('supabase/functions/get-stream-playback/index.ts');
const app = read('apps/admin-web/src/App.tsx');
const nav = read('apps/admin-web/src/layout/adminNavigation.ts');
const api = read('apps/admin-web/src/lib/adminApi.ts');
const pages = read('apps/admin-web/src/pages/AdminCreatorPremiumPages.tsx');
const reportSubject = read('apps/admin-web/src/components/AdminReportSubject.tsx');

test('existing image grant adds exact admin review context without weakening B6 entitlement', () => {
  assert.match(imageEdge, /admin_review/i);
  assert.match(imageEdge, /premium_content_id/i);
  assert.match(imageEdge, /creator_premium\.review\.read/i);
  assert.match(imageEdge, /admin_actor_has_capability/i);
  assert.match(imageEdge, /get_admin_creator_premium_content_v1/i);
  assert.match(imageEdge, /pending_review[\s\S]*published[\s\S]*rejected[\s\S]*quarantined[\s\S]*removed/i);
  assert.match(imageEdge, /content_kind[\s\S]*image/i);
  assert.match(imageEdge, /owner_id/i);
  assert.match(imageEdge, /creator_premium_original_image/i);
  assert.match(imageEdge, /visibility[^\n]*'private'/i);
  assert.match(imageEdge, /status[^\n]*'ready'/i);
  assert.match(imageEdge, /signGet\([^\n]*300\)/i);
  assert.match(imageEdge, /Cache-Control['"]?\s*:\s*['"]private, no-store/i);
  assert.match(imageEdge, /get_my_creator_premium_entitlement_v1/i, 'normal B6 path must remain');
  const premiumGrantResponse = imageEdge.match(/return corsJson\(\{success:true,data:\{[\s\S]*?\}\},200,/i)?.[0] ?? '';
  assert.ok(premiumGrantResponse, 'premium image response must be explicit');
  assert.doesNotMatch(premiumGrantResponse, /object_key|bucket_name|cloudflare_uid/i);
});

test('existing Stream grant adds exact admin review context and retains signed-only provider proof', () => {
  assert.match(streamEdge, /admin_review/i);
  assert.match(streamEdge, /creator_premium\.review\.read/i);
  assert.match(streamEdge, /admin_actor_has_capability/i);
  assert.match(streamEdge, /get_admin_creator_premium_content_v1/i);
  assert.match(streamEdge, /pending_review[\s\S]*published[\s\S]*rejected[\s\S]*quarantined[\s\S]*removed/i);
  assert.match(streamEdge, /content_kind[\s\S]*video/i);
  assert.match(streamEdge, /owner_id/i);
  assert.match(streamEdge, /req\.method\s*===\s*['"]OPTIONS['"][\s\S]*status\s*:\s*204/i);
  assert.match(streamEdge, /hasPremiumProviderProof/i);
  assert.match(streamEdge, /createPremiumStreamPlaybackGrant/i);
  assert.match(streamEdge, /Cache-Control['"]?\s*:\s*['"]private, no-store/i);
  assert.match(streamEdge, /get_my_creator_premium_entitlement_v1/i, 'normal B6 path must remain');
  const premiumGrantResponse = streamEdge.match(/return premiumJson\(\{success:true,data:\{contentId,[\s\S]*?\}\}\)/i)?.[0] ?? '';
  assert.ok(premiumGrantResponse, 'premium Stream response must be explicit');
  assert.doesNotMatch(premiumGrantResponse, /cloudflareUid\s*:/i);
});

test('Admin Web has one capability-routed Creator Premium review surface', () => {
  assert.ok(pages, 'AdminCreatorPremiumPages.tsx must exist');
  assert.match(app, /AdminCreatorPremium/i);
  assert.match(app, /CapabilityRoute\s+capability="creator_premium\.review\.read"/i);
  assert.match(app, /creator-premium/i);
  assert.match(nav, /creator_premium\.review\.read/i);
  assert.match(nav, /Creator Premium/i);
  assert.match(pages, /Pending|pending_review|En revisión/i);
  assert.match(pages, /Publicado|published/i);
  assert.match(pages, /Rechazado|rejected/i);
  assert.match(pages, /Cuarentena|quarantined/i);
  assert.match(pages, /Retirado|removed/i);
  assert.doesNotMatch(pages, /object_key|bucket_name|cloudflare_uid/i);
  assert.match(pages, /next_cursor/i);
  assert.match(pages, /Cargar más/i);
  assert.match(pages, /lifecycle===['"]pending_review['"]\?\[['"]approve['"],['"]reject['"]\]/i);
  assert.match(pages, /lifecycle===['"]rejected['"]\?\[['"]restore['"]\]/i);
});

test('Admin review pagination fences late pages when filters or retries change', () => {
  assert.match(pages, /useRef/i);
  assert.match(pages, /queueRequestGeneration\s*=\s*useRef\(0\)/i);
  assert.ok(
    (pages.match(/\+\+queueRequestGeneration\.current/g) ?? []).length >= 2,
    'initial and paginated requests must each own a generation',
  );
  assert.match(pages, /request\s*===\s*queueRequestGeneration\.current/i);
  assert.match(pages, /return\s*\(\s*\)\s*=>\s*\{[^}]*queueRequestGeneration\.current\s*\+=\s*1/i);
  assert.match(pages, /const\s+requestedStatus\s*=\s*status/i);
  assert.match(pages, /const\s+requestedQuery\s*=\s*query/i);
  assert.match(pages, /requestedStatus\s*===\s*statusRef\.current/i);
  assert.match(pages, /requestedQuery\s*===\s*queryRef\.current/i);
});

test('Admin API validates review commands, safe grants, and audited refund wrappers', () => {
  for (const rpc of [
    'search_admin_creator_premium_content_v1',
    'get_admin_creator_premium_content_v1',
    'admin_review_creator_premium_content_v1',
    'admin_refund_creator_premium_purchase_v1',
    'admin_refund_creator_premium_subscription_period_v1',
  ]) assert.match(api, new RegExp(`rpc\\(\\s*['"]${rpc}['"]`, 'i'));
  assert.match(api, /premium_content_id/i);
  assert.match(api, /admin_review\s*:\s*true/i);
  assert.match(api, /idempotencyKey/i);
  assert.match(api, /money_moved/i);
  assert.doesNotMatch(api, /rpc\(\s*['"]refund_creator_premium_purchase_v1['"]/i);
  assert.doesNotMatch(api, /rpc\(\s*['"]refund_creator_premium_subscription_period_v1['"]/i);
});

test('refund controls require both explicit write capability and enabled server policy', () => {
  assert.match(pages, /creator_premium\.refunds\.write/i);
  assert.match(pages, /refunds_enabled/i);
  assert.match(pages, /Confirm|confirm|window\.confirm/i);
  assert.match(pages, /reason|motivo/i);
  assert.doesNotMatch(pages, /ledger_debit|ledger_credit|platform_fee_bps\s*[*\/+-]/i);
});

test('admin temporary grants are memory-only and cleared on lifecycle changes', () => {
  assert.match(pages, /useState/i);
  assert.match(pages, /useEffect[\s\S]*return\s*\(\s*\)\s*=>/i);
  assert.match(pages, /set(?:Image|Video|Media)Grant\s*\(\s*null\s*\)/i);
  assert.doesNotMatch(pages, /localStorage|sessionStorage|indexedDB|AsyncStorage|SecureStore/i);
  assert.doesNotMatch(pages, /console\.(?:log|error|warn)\([^\n]*(?:url|grant|token)/i);
});

test('existing Admin report parser and subject render Creator Premium safely', () => {
  assert.match(api, /AdminReportContentType[^\n]*creator_premium/i);
  assert.match(api, /value\s*===\s*["']creator_premium["']/i);
  assert.match(reportSubject, /creator_premium/i);
  assert.match(reportSubject, /creator-premium\//i);
  assert.doesNotMatch(reportSubject, /object_key|bucket_name|cloudflare_uid|hls_url|dash_url/i);
});
