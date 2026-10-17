import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = relative => {
  const path = new URL(relative, root);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};

let presentation;
let presentationLoadError;
try {
  presentation = await import('../services/creatorPremiumPresentation.mjs');
} catch (error) {
  presentationLoadError = error;
}

function presentationApi() {
  assert.ifError(presentationLoadError);
  assert.ok(presentation, 'Creator Premium C1 presentation contracts must load');
  return presentation;
}

const hub = read('app/creator-monetization.tsx');
const editor = read('app/creator-premium-editor.tsx');
const offer = read('app/creator-premium-offer/[contentId].tsx');
const subscriptions = read('app/my-subscriptions.tsx');
const integration = read('services/creatorPremiumIntegrationState.ts');
const service = read('services/creatorPremiumService.ts');
const migration = read('supabase/migrations/20261017193000_creator_premium_c1_submission_cancellation.sql');

test('Premium BDAG display is exact, Spanish-localized, and always has two decimals', () => {
  const { formatCreatorPremiumBdag } = presentationApi();
  const cases = [
    ['1500', '1.500,00 BDAG'],
    ['200.00000000', '200,00 BDAG'],
    ['0', '0,00 BDAG'],
    ['1.23456789', '1,23 BDAG'],
    ['1.23500000', '1,24 BDAG'],
    ['999.99999999', '1.000,00 BDAG'],
    ['-12.345', '-12,35 BDAG'],
  ];
  for (const [input, expected] of cases) assert.equal(formatCreatorPremiumBdag(input), expected, input);
  assert.equal(formatCreatorPremiumBdag(null), 'Sin precio');
  assert.equal(formatCreatorPremiumBdag(undefined, { empty: '—' }), '—');
  assert.equal(formatCreatorPremiumBdag(1500), '— BDAG', 'numeric finance inputs must fail closed');
});

test('Premium screens share the string-only formatter for every commercial surface', () => {
  for (const source of [hub, offer, subscriptions]) {
    assert.match(source, /formatCreatorPremiumBdag/);
  }
  assert.doesNotMatch(hub, /function\s+money\s*\(/);
  assert.doesNotMatch(offer, /const\s+formatExactBdag\s*=/);
  assert.doesNotMatch(subscriptions, /const\s+exactBdag\s*=/);
  for (const field of ['gross', 'platform_fee', 'creator_net', 'refund', 'net_retained', 'creator_net_bdag', 'purchase_net_retained']) {
    assert.match(hub, new RegExp(`formatCreatorPremiumBdag\\(.*${field}`));
  }
  assert.doesNotMatch(`${hub}\n${offer}\n${subscriptions}`, /Number\([^\n]*(?:price_bdag|gross|platform_fee|creator_net|refund|net_retained)/i);
});

test('lifecycle presentation distinguishes processing, policy, retry, approval, and history', () => {
  const { creatorPremiumLifecyclePresentation: present } = presentationApi();
  assert.deepEqual(present({ lifecycle_status: 'draft', verification_status: 'not_requested' }), {
    state: 'draft', label: 'Borrador', tone: 'purple', polling: false,
    canRetry: false, canCancel: false, canDelete: true,
    copy: 'Puedes editar, reemplazar medios o eliminar este borrador.',
  });
  assert.equal(present({ lifecycle_status: 'pending_review', verification_status: 'pending' }).state, 'processing');
  assert.equal(present({ lifecycle_status: 'pending_review', verification_status: 'pending' }).polling, true);
  assert.equal(present({
    lifecycle_status: 'pending_review', verification_status: 'not_requested',
    verification_error_code: 'creator_premium_legacy_reverification_required',
  }).state, 'legacy_reverification_required');
  assert.equal(present({
    lifecycle_status: 'pending_review', verification_status: 'failed',
    verification_error_code: 'creator_premium_safety_provider_failed',
  }).state, 'failed');
  assert.equal(present({
    lifecycle_status: 'pending_review', verification_status: 'failed',
    verification_error_code: 'content_safety_policy_not_configured',
  }).state, 'awaiting_policy');
  assert.equal(present({
    lifecycle_status: 'pending_review', verification_status: 'failed',
    verification_error_code: 'content_safety_policy_not_configured',
  }).canRetry, false, 'policy absence must not offer a retry loop');
  assert.equal(present({ lifecycle_status: 'pending_review', verification_status: 'commercial_pending' }).state, 'approved');
  assert.equal(present({ lifecycle_status: 'rejected', verification_status: 'blocked' }).state, 'rejected');
  assert.equal(present({ lifecycle_status: 'published', verification_status: 'passed' }).state, 'published');
  assert.equal(present({ lifecycle_status: 'deleted', verification_status: 'not_requested' }).state, 'deleted');
  assert.equal(present({ lifecycle_status: 'deleted', verification_status: 'not_requested' }).canDelete, false);
});

test('native iOS video selection defaults to Photos and retains explicit Files fallback', () => {
  const photoBody = editor.slice(editor.indexOf('const pickVideoFromPhotos'), editor.indexOf('const pickVideoFromFiles'));
  const filesBody = editor.slice(editor.indexOf('const pickVideoFromFiles'), editor.indexOf('const uploadMedia'));
  assert.match(photoBody, /requestMediaLibraryPermissionsAsync/);
  assert.match(photoBody, /launchImageLibraryAsync/);
  assert.match(photoBody, /mediaTypes\s*:\s*\[\s*['"]videos['"]\s*\]/);
  assert.doesNotMatch(photoBody, /DocumentPicker/);
  assert.match(filesBody, /DocumentPicker\.getDocumentAsync/);
  assert.match(editor, /Elegir desde Files/);
  assert.match(editor, /duration/i);
  assert.match(editor, /normalizeCreatorPremiumVideoPickerAsset/);
});

test('video picker normalization enforces MIME, bytes, and the 60-second Photos limit', () => {
  const { normalizeCreatorPremiumVideoPickerAsset: normalize } = presentationApi();
  assert.deepEqual(normalize({ uri: 'file:///ok.mov', mimeType: 'video/quicktime', fileName: 'ok.mov', sizeBytes: 12, durationMs: 60_000 }), {
    uri: 'file:///ok.mov', mimeType: 'video/quicktime', fileName: 'ok.mov', sizeBytes: 12,
  });
  assert.throws(() => normalize({ uri: 'file:///bad.bin', mimeType: 'application/octet-stream', fileName: 'bad.bin', sizeBytes: 12, durationMs: 1000 }), /creator_premium_video_mime_invalid/);
  assert.throws(() => normalize({ uri: 'file:///large.mp4', mimeType: 'video/mp4', fileName: 'large.mp4', sizeBytes: 200_000_001, durationMs: 1000 }), /creator_premium_video_size_invalid/);
  assert.throws(() => normalize({ uri: 'file:///long.mp4', mimeType: 'video/mp4', fileName: 'long.mp4', sizeBytes: 12, durationMs: 60_001 }), /creator_premium_video_duration_invalid/);
  assert.equal(normalize(null), null, 'picker cancellation must be a no-op');
});

test('every content card opens the existing editor and exposes no duplicate detail route', () => {
  assert.match(hub, /<Pressable\s+key=\{item\.id\}[\s\S]*?creator-premium-editor/);
  assert.match(hub, /accessibilityRole=["']button["']/);
  assert.doesNotMatch(hub, /creator-premium-(?:detail|manage)/);
});

test('verification retry excludes awaiting-policy loops while preserving provider and legacy recovery', async () => {
  const contracts = await import('../services/creatorPremiumIntegrationState.ts');
  assert.equal(contracts.creatorPremiumVerificationCanRetry({
    lifecycle_status: 'pending_review', verification_status: 'failed',
    verification_error_code: 'creator_premium_safety_provider_failed',
  }), true);
  assert.equal(contracts.creatorPremiumVerificationCanRetry({
    lifecycle_status: 'pending_review', verification_status: 'not_requested',
    verification_error_code: 'creator_premium_legacy_reverification_required',
  }), true);
  assert.equal(contracts.creatorPremiumVerificationCanRetry({
    lifecycle_status: 'pending_review', verification_status: 'failed',
    verification_error_code: 'content_safety_policy_not_configured',
  }), false);
  assert.match(integration, /content_safety_audio_policy_not_configured/);
});

test('C1 cancellation is one canonical owner-only forward transition with stale-scan fencing', () => {
  assert.match(service, /export\s+async\s+function\s+cancelMyCreatorPremiumSubmission/);
  assert.match(service, /rpc\(['"]cancel_my_creator_premium_submission_v1['"]/);
  assert.match(service, /p_content_id\s*:\s*contentId/);

  assert.match(migration, /create\s+function\s+public\.cancel_my_creator_premium_submission_v1\s*\(\s*p_content_id\s+uuid\s*\)/i);
  assert.match(migration, /security\s+definer[\s\S]*set\s+search_path\s*=\s*''/i);
  assert.match(migration, /auth\.uid\(\)/i);
  assert.match(migration, /current_user_is_creator_exclusive_age_eligible/i);
  assert.match(migration, /creator_premium_actor_is_operational_v1/i);
  assert.match(migration, /pg_advisory_xact_lock[\s\S]*creator-premium-content:/i);
  assert.match(migration, /creator_id\s*=\s*v_actor[\s\S]*for\s+update/i);
  assert.match(migration, /lifecycle_status\s*=\s*'draft'[\s\S]*cancelled\s*:?=\s*false/i,
    'an already-draft replay must be an idempotent no-op');
  assert.match(migration, /lifecycle_status\s*<>\s*'pending_review'[\s\S]*creator_premium_submission_cancel_invalid_state/i);
  assert.match(migration, /verification_generation\s*=\s*content\.verification_generation\s*\+\s*1/i);
  for (const field of [
    'submitted_at', 'reviewed_at', 'reviewed_by', 'review_reason', 'removal_reason',
    'verification_scan_id', 'verification_fingerprint', 'verification_error_code',
    'verification_requested_at', 'verification_completed_at',
  ]) assert.match(migration, new RegExp(`${field}\\s*=\\s*null`, 'i'), field);
  assert.match(migration, /verification_status\s*=\s*'not_requested'/i);
  assert.doesNotMatch(migration, /delete\s+from|truncate\s+table|drop\s+table/i);
  assert.doesNotMatch(migration, /financial_transactions|ledger_entries|ledger_accounts/i);
  assert.match(migration, /revoke\s+all\s+on\s+function[\s\S]*from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
  assert.match(migration, /grant\s+execute\s+on\s+function[\s\S]*to\s+authenticated/i);
  assert.match(migration, /alter\s+function[\s\S]*owner\s+to\s+postgres/i);
});

