import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const sql = read('supabase/migrations/20261010053524_creator_premium_b7_full_functional_commercial_completion.sql');
const worker = read('supabase/functions/content-safety-scan/index.ts');
const visual = read('supabase/functions/content-safety-scan/visualPipeline.mjs');
const service = read('services/creatorPremiumService.ts');
const editor = read('app/creator-premium-editor.tsx');
const hub = read('app/creator-monetization.tsx');
const admin = read('apps/admin-web/src/pages/AdminCreatorPremiumPages.tsx');

function lastFunctionBody(name, schema = '(?:public|private)') {
  const re = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${schema}\\.${name}\\b`, 'gi');
  const matches = [...sql.matchAll(re)];
  if (!matches.length) return '';
  const start = matches.at(-1).index;
  const rest = sql.slice(start);
  const end = rest.search(/\n\$\$;\s*(?:\n|$)/);
  return end < 0 ? rest : rest.slice(0, end + 4);
}

test('B7-F2 keeps one lifecycle and records immutable automatic-verification evidence', () => {
  for (const column of [
    'verification_scan_id',
    'verification_fingerprint',
    'verification_status',
    'verification_error_code',
    'verification_requested_at',
    'verification_completed_at',
  ]) assert.match(sql, new RegExp(`add\\s+column\\s+${column}\\b`, 'i'), column);
  assert.match(sql, /verification_status[\s\S]*'not_requested'[\s\S]*'pending'[\s\S]*'commercial_pending'[\s\S]*'passed'[\s\S]*'blocked'[\s\S]*'restricted'[\s\S]*'failed'/i);
  assert.doesNotMatch(sql, /create\s+table\s+(?:public|private)\.creator_premium_(?:publication|verification|safety)/i);
});

test('creator publication request queues canonical safety and never self-publishes', () => {
  const body = lastFunctionBody('submit_my_creator_premium_content_for_review_v1', 'public');
  assert.match(body, /private\.enqueue_content_safety_scan\s*\(\s*'creator_premium'/i);
  assert.match(body, /verification_scan_id/i);
  assert.match(body, /verification_fingerprint/i);
  assert.match(body, /lifecycle_status\s*=\s*'pending_review'/i);
  assert.doesNotMatch(body, /lifecycle_status\s*=\s*'published'/i);
  assert.match(body, /for\s+update/i);
  assert.match(body, /pg_advisory_xact_lock/i);
});

test('a failed verification retry revalidates readiness and receives a fresh fingerprint generation', () => {
  const body = lastFunctionBody('submit_my_creator_premium_content_for_review_v1', 'public');
  assert.match(body, /creator_premium_submission_blocker_v1/i);
  assert.match(body, /creator_premium_publication_blocker_v1/i);
  assert.match(
    body,
    /if\s+v_content\.lifecycle_status\s*=\s*'draft'[\s\S]*?else[\s\S]*?creator_premium_publication_blocker_v1/i,
  );
  assert.match(
    body,
    /set\s+verification_generation\s*=\s*content\.verification_generation\s*\+\s*1[\s\S]*?enqueue_content_safety_scan/i,
  );
});

test('Premium snapshot binds text, creator, lifecycle and exact current private originals', () => {
  const body = lastFunctionBody('content_safety_target_snapshot', 'private');
  assert.match(body, /p_target_type\s*=\s*'creator_premium'/i);
  assert.match(body, /creator_premium_contents/i);
  assert.match(body, /creator_premium_original_image/i);
  assert.match(body, /creator_premium_video/i);
  assert.match(body, /content_version/i);
  assert.match(body, /media_asset_id|video_asset_id/i);
  assert.match(body, /eligible_plan_facts/i);
  for (const fact of ['plan_key', 'version', 'price_bdag', 'billing_period_days']) {
    assert.match(body, new RegExp(fact, 'i'), fact);
  }
  assert.match(body, /plan\.status\s+in\s*\(\s*'draft'\s*,\s*'active'\s*\)/i);
  assert.doesNotMatch(body, /public_url[^\n]*creator_premium_original/i);
});

test('canonical visual and audio sources admit only owned ready private Premium originals', () => {
  const visualSource = lastFunctionBody('content_safety_visual_source', 'private');
  const audioSource = lastFunctionBody('content_safety_audio_source', 'private');
  for (const body of [visualSource, audioSource]) {
    assert.match(body, /p_target_type\s*=\s*'creator_premium'/i);
    assert.match(body, /creator_premium_contents/i);
    assert.match(body, /creator_id/i);
    assert.match(body, /status\s*=\s*'ready'/i);
    assert.match(body, /visibility\s*=\s*'private'/i);
  }
  assert.match(visualSource, /creator_premium_original_image/i);
  assert.match(visualSource, /creator_premium_video/i);
  assert.match(audioSource, /creator_premium_video/i);
  assert.match(audioSource, /require_signed_urls/i);
});

test('automatic finalizer requires current scan, fingerprint, every required modality and no alert', () => {
  const body = lastFunctionBody('finalize_creator_premium_safety_scan_v1', 'private');
  assert.match(body, /for\s+update/i);
  assert.match(body, /verification_scan_id/i);
  assert.match(body, /verification_fingerprint/i);
  assert.match(body, /content_fingerprint/i);
  assert.match(body, /text_status\s*<>\s*'analyzed'/i);
  assert.match(body, /visual_status\s*<>\s*'analyzed'/i);
  assert.match(body, /audio_status/i);
  assert.match(body, /content_safety_alerts/i);
  assert.match(body, /creator_premium_publication_blocker_v1/i);
  assert.match(body, /lifecycle_status\s*=\s*'published'/i);
  assert.match(body, /lifecycle_status\s*<>\s*'pending_review'/i);
  assert.match(body, /content_safety_policy_not_configured/i);
  assert.match(body, /detection evidence, not confirmed violations/i);
  assert.match(body, /lifecycle_status\s*=\s*'quarantined'/i);
  const contentLock = body.search(/from\s+private\.creator_premium_contents[\s\S]*?for\s+update/i);
  const serializedTime = body.search(/v_now\s*:=\s*pg_catalog\.clock_timestamp\(\)/i);
  assert.ok(contentLock >= 0 && serializedTime > contentLock, 'publication time must be captured after the content lock');
});

test('completed safety evidence waits for plan activation without a second scan', () => {
  const finalizer = lastFunctionBody('finalize_creator_premium_safety_scan_v1', 'private');
  const reconciler = lastFunctionBody('reconcile_creator_premium_publications_v1', 'public');
  const activate = lastFunctionBody('activate_my_creator_premium_plan_v1', 'public');

  assert.match(
    finalizer,
    /v_blocker\s*=\s*'creator_premium_active_plan_required'[\s\S]*verification_status\s*=\s*'commercial_pending'[\s\S]*verification_error_code\s*=\s*v_blocker[\s\S]*verification_completed_at\s*=\s*v_now/i,
  );
  assert.match(finalizer, /'outcome'\s*,\s*'commercial_pending'/i);
  assert.match(
    reconciler,
    /content\.verification_status\s+in\s*\(\s*'pending'\s*,\s*'commercial_pending'\s*\)/i,
  );
  assert.match(reconciler, /content\.verification_status\s*=\s*'commercial_pending'[\s\S]*plan\.status\s*=\s*'active'/i);
  assert.match(activate, /wake_content_safety_scanner\s*\(\s*\)/i);
  assert.doesNotMatch(activate, /enqueue_content_safety_scan/i);
  assert.match(activate, /content\.verification_status\s*=\s*'commercial_pending'/i);
});

test('a canonical false-positive dismissal suppresses only the identical visual signal', () => {
  const visualAlerts = lastFunctionBody('content_safety_create_visual_alerts_for_scan', 'private');
  const finalizer = lastFunctionBody('finalize_creator_premium_safety_scan_v1', 'private');
  const reconciler = lastFunctionBody('reconcile_creator_premium_publications_v1', 'public');
  const moderation = lastFunctionBody('admin_review_creator_premium_content_v1', 'public');

  assert.match(visualAlerts, /prior_alert\.status\s*=\s*'dismissed'/i);
  assert.match(visualAlerts, /prior_alert\.resolution\s*=\s*'no_violation'/i);
  assert.match(visualAlerts, /prior_alert\.target_type\s*=\s*v_scan\.target_type/i);
  assert.match(visualAlerts, /prior_alert\.target_id\s*=\s*v_scan\.target_id/i);
  assert.match(visualAlerts, /prior_alert\.owner_user_id\s*=\s*v_scan\.owner_user_id/i);
  assert.match(visualAlerts, /prior_alert\.source_type\s*=\s*'visual_classifier'/i);
  assert.match(visualAlerts, /prior_alert\.category\s*=\s*v_category/i);
  for (const fact of [
    'visual_analysis_id',
    'provider',
    'model',
    'prompt_version',
    'analysis_fingerprint',
    'model_triage_level',
    'description',
  ]) assert.match(visualAlerts, new RegExp(`prior_alert\\.evidence[\\s\\S]*${fact}`, 'i'), fact);
  assert.match(visualAlerts, /private\.admin_action_audit/i);
  assert.match(visualAlerts, /audit\.action\s*=\s*'content_safety\.alert\.dismiss'/i);
  assert.match(visualAlerts, /audit\.actor_id\s*=\s*prior_alert\.reviewed_by/i);
  assert.match(visualAlerts, /audit\.reason\s*=\s*prior_alert\.resolution_note/i);
  assert.match(visualAlerts, /audit\.idempotency_key\s+is\s+not\s+null/i);

  const activeAlertPredicate = /not\s*\(\s*alert\.status\s*=\s*'dismissed'\s+and\s+alert\.resolution\s*=\s*'no_violation'\s*\)/gi;
  assert.ok((finalizer.match(activeAlertPredicate) ?? []).length >= 2, 'both publication paths must ignore only canonical false-positive dismissals');
  assert.match(reconciler, activeAlertPredicate);
  assert.match(moderation, /creator_premium_safety_alert_resolution_required/i);
  assert.match(moderation, activeAlertPredicate);
  assert.doesNotMatch(moderation, /verification_status\s*=\s*'passed'|lifecycle_status\s*=\s*'published'/i);
});

test('Premium governance scope is previewable and safety alerts are searchable without original media', () => {
  const preview = lastFunctionBody('preview_content_safety_rule_definition', 'private');
  const search = lastFunctionBody('search_admin_content_safety_alerts', 'public');
  assert.match(preview, /creator_premium_text/i);
  assert.match(preview, /creator_premium_contents/i);
  assert.match(preview, /private_premium_originals_included'\s*,\s*false/i);
  assert.doesNotMatch(preview, /creator_premium_original_image|creator_premium_video|object_key|cloudflare_uid/i);
  assert.match(search, /creator_premium/i);
  assert.match(search, /audio_transcript_rule/i);
});

test('only service role can reconcile publication and late work cannot republish restrictions', () => {
  const body = lastFunctionBody('reconcile_creator_premium_publications_v1', 'public');
  assert.match(body, /auth\.role\(\)\s*<>\s*'service_role'/i);
  assert.match(body, /finalize_creator_premium_safety_scan_v1/i);
  assert.match(
    body,
    /content\.lifecycle_status\s*=\s*'pending_review'\s+and\s+content\.verification_status\s+in\s*\(\s*'pending'\s*,\s*'commercial_pending'\s*\)/i,
  );
  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.reconcile_creator_premium_publications_v1\([^;]*\)[\s\S]*?grant\s+execute[\s\S]*?to\s+service_role/i);
  const finalizer = lastFunctionBody('finalize_creator_premium_safety_scan_v1', 'private');
  assert.match(finalizer, /lifecycle_status\s*<>\s*'pending_review'[\s\S]*return/i);
});

test('reports enter the same scanner and admin cannot manufacture a publication PASS', () => {
  const trigger = lastFunctionBody('content_safety_report_trigger', 'private');
  const enqueue = lastFunctionBody('enqueue_content_safety_scan', 'private');
  const moderation = lastFunctionBody('admin_review_creator_premium_content_v1', 'public');
  assert.match(trigger, /creator_premium/i);
  assert.match(trigger, /enqueue_content_safety_scan/i);
  assert.match(
    enqueue,
    /status\s*=\s*case\s+when\s+private\.content_safety_scans\.status\s*=\s*'processing'\s+then\s+'processing'\s+else\s+'queued'\s+end/i,
  );
  assert.doesNotMatch(
    enqueue,
    /private\.content_safety_scans\.status\s*=\s*'completed'\s+then\s+'completed'/i,
    'a new report must requeue a completed scan so report signals are recomputed',
  );
  assert.doesNotMatch(moderation, /'approve'|'reject'/i);
  assert.match(moderation, /'quarantine'[\s\S]*'remove'[\s\S]*'restore'/i);
  assert.doesNotMatch(moderation, /lifecycle_status\s*=\s*'published'/i);
  assert.match(moderation, /when\s+'restore'[\s\S]*enqueue_content_safety_scan/i);
});

test('worker scans signed private Stream media and reconciles without exposing the grant', () => {
  assert.match(worker, /createPremiumStreamPlaybackGrant/i);
  assert.match(worker, /target_type[^\n]*creator_premium|creator_premium[^\n]*target_type/i);
  assert.match(worker, /reconcile_creator_premium_publications_v1/i);
  assert.match(visual, /signedThumbnailUrl/i);
  assert.doesNotMatch(worker, /console\.(?:log|warn|error)\([^\n]*(?:thumbnailUrl|token|cloudflareUid)/i);
});

test('creator and admin UX describe automatic verification rather than routine human approval', () => {
  assert.match(service, /publishMyCreatorPremiumContent/i);
  assert.match(editor, /Publicar contenido Premium/i);
  assert.match(editor, /Verificando contenido|Verificaci[oó]n pendiente/i);
  assert.match(hub, /Verificando contenido|Verificaci[oó]n pendiente/i);
  assert.match(service, /'commercial_pending'/i);
  assert.match(editor, /Seguridad aprobada[^\n]*activaci[oó]n[^\n]*plan/i);
  assert.match(hub, /Seguridad aprobada[^\n]*activaci[oó]n[^\n]*plan/i);
  assert.doesNotMatch(`${editor}\n${hub}`, /Enviar a revisi[oó]n administrativa|Solo (?:un )?moderador puede publicar|Esperando aprobaci[oó]n del equipo/i);
  assert.match(admin, /Seguridad Premium|Excepciones Premium/i);
  assert.doesNotMatch(admin, /action:\s*['"]approve['"]|action:\s*['"]reject['"]|\[['"]approve['"],['"]reject['"]\]/i);
});

test('B7-F1 refund retry truth and production finance-off contract remain intact', () => {
  for (const field of ['money_moved', 'replayed', 'already_refunded']) assert.match(sql, new RegExp(field, 'i'));
  assert.doesNotMatch(sql, /update\s+private\.creator_premium_finance_policy/i);
  assert.doesNotMatch(sql, /insert\s+into\s+private\.creator_premium_finance_policy/i);
});
