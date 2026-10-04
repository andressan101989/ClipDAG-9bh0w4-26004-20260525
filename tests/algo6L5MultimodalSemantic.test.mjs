import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrations = new URL('../supabase/migrations/', import.meta.url);
function readF2Migration() {
  const matches = readdirSync(migrations)
    .filter(name => name.endsWith('_algo6_l5_f2_multimodal_semantic.sql'));
  assert.equal(matches.length, 1, 'exactly one generated L5-F2 migration must exist');
  return { filename: matches[0], sql: readFileSync(new URL(matches[0], migrations), 'utf8') };
}

function functionBody(sql, qualifiedName) {
  const start = sql.toLowerCase().indexOf(`create or replace function ${qualifiedName}`.toLowerCase());
  assert.ok(start >= 0, `${qualifiedName} must be defined by L5-F2`);
  const end = sql.toLowerCase().indexOf('\nrevoke all on function', start);
  assert.ok(end > start, `${qualifiedName} must have explicit ACL handling`);
  return sql.slice(start, end);
}

test('F2 alters the single canonical profile and creates no semantic relation', () => {
  const { filename, sql } = readF2Migration();
  assert.match(filename, /^\d{14}_algo6_l5_f2_multimodal_semantic\.sql$/);
  assert.match(sql, /^begin;/i);
  assert.match(sql, /commit;\s*$/i);
  assert.match(sql, /alter table\s+private\.video_semantic_profiles/i);
  assert.doesNotMatch(sql, /create\s+(?:unlogged\s+)?table\s+(?:public|private)\./i);
  assert.doesNotMatch(sql, /pgmq|vectorize|pinecone|hnsw|ivfflat/i);
  for (const column of [
    'visual_semantic_status', 'visual_source_kind', 'visual_source_fingerprint',
    'visual_source_video_asset_id', 'visual_source_media_asset_id',
    'visual_provider', 'visual_model', 'visual_prompt_version',
    'visual_sample_strategy', 'visual_frame_timestamps_ms',
    'visual_semantic_text', 'visual_semantic_fingerprint',
    'visual_attempt_count', 'visual_available_at', 'visual_started_at',
    'visual_completed_at', 'visual_last_error_code', 'visual_provider_call_count',
  ]) assert.match(sql, new RegExp(`\\b${column}\\b`, 'i'), `${column} must be on the canonical row`);
  assert.match(sql, /visual_semantic_status[\s\S]{0,600}'pending'[\s\S]{0,80}'processing'[\s\S]{0,80}'ready'[\s\S]{0,80}'failed'[\s\S]{0,80}'not_applicable'[\s\S]{0,80}'not_configured'/i);
  assert.match(sql, /visual_provider[\s\S]{0,200}cloudflare_workers_ai/i);
  assert.match(sql, /visual_model[\s\S]{0,200}@cf\/google\/gemma-4-26b-a4b-it/i);
  assert.match(sql, /visual_prompt_version[\s\S]{0,200}video-semantic-visual-v1/i);
  assert.match(sql, /visual_attempt_count\s+between\s+0\s+and\s+5/i);
  assert.match(sql, /visual_provider_call_count\s*>=\s*0/i);
  assert.match(sql, /char_length\s*\(\s*visual_semantic_text\s*\)\s*<=\s*2500/i);
});

test('visual source wrapper delegates to the existing resolver and fingerprints source identity only', () => {
  const { sql } = readF2Migration();
  const source = functionBody(sql, 'private.video_semantic_visual_source_v1');
  assert.match(source, /private\.content_safety_visual_source\s*\(\s*'video'\s*,\s*p_video_id\s*\)/i);
  assert.match(source, /private\.content_safety_sha256/i);
  assert.match(source, /eligible_stream_video/i);
  assert.match(source, /video_asset_id[\s\S]{0,400}cloudflare_uid[\s\S]{0,400}duration_seconds[\s\S]{0,400}mime_type/i);
  assert.match(source, /eligible_image/i);
  assert.match(source, /media_asset_id[\s\S]{0,400}bucket_name[\s\S]{0,400}object_key[\s\S]{0,400}mime_type[\s\S]{0,400}size_bytes/i);
  assert.doesNotMatch(source, /(?:public\.)?(?:video_asset_links|video_assets|media_asset_links|media_assets)/i);
  assert.doesNotMatch(source, /caption|source_content_fingerprint|content_version/i);
});

test('semantic input v2 reuses v1 text semantics and includes only current ready visual semantics', () => {
  const { sql } = readF2Migration();
  const input = functionBody(sql, 'private.video_semantic_input_v2');
  assert.match(input, /private\.video_semantic_input_v1\s*\(\s*p_video_id\s*\)/i);
  assert.match(input, /private\.video_semantic_visual_source_v1\s*\(\s*p_video_id\s*\)/i);
  assert.match(input, /video-semantic-v2/i);
  assert.match(input, /visual_semantic_status\s*=\s*'ready'/i);
  assert.match(input, /visual_source_fingerprint/i);
  assert.match(input, /visual:\\n/i);
  assert.match(input, /left\s*\([\s\S]{0,180}2500\s*\)/i);
  assert.match(input, /left\s*\([\s\S]{0,180}18000\s*\)/i);
  assert.match(input, /private\.content_safety_sha256/i);
  assert.doesNotMatch(input, /content_safety_visual_analyses|analysis_result|review_required/i);
});

test('canonical sync preserves ready visual data on text-only changes and clears it on visual source changes', () => {
  const { sql } = readF2Migration();
  const sync = functionBody(sql, 'private.sync_video_semantic_profile_v1');
  assert.match(sync, /private\.video_semantic_input_v2/i);
  assert.match(sync, /private\.video_semantic_visual_source_v1/i);
  assert.match(sync, /visual_source_fingerprint/i);
  assert.match(sync, /visual_semantic_text\s*=\s*null/i);
  assert.match(sync, /visual_semantic_fingerprint\s*=\s*null/i);
  assert.match(sync, /visual_semantic_status\s*=\s*'pending'|then\s+'pending'/i);
  assert.match(sync, /not_applicable|not_configured/i);
  assert.match(sync, /embedding\s*=\s*null/i);
  assert.match(sync, /semantic_input_version[\s\S]{0,300}video-semantic-v2/i);
});

test('embedding claim waits for terminal visual lifecycle and recomputes v2 input', () => {
  const { sql } = readF2Migration();
  const claim = functionBody(sql, 'public.claim_video_semantic_profiles_v1');
  assert.match(claim, /visual_semantic_status\s+in\s*\(\s*'ready'\s*,\s*'failed'\s*,\s*'not_applicable'\s*,\s*'not_configured'\s*\)/i);
  assert.doesNotMatch(claim, /visual_semantic_status\s+in\s*\([^)]*'pending'|visual_semantic_status\s+in\s*\([^)]*'processing'/i);
  assert.match(claim, /private\.video_semantic_input_v2/i);
  assert.match(claim, /for update skip locked/i);
});

test('exactly three visual RPC authorities are bounded, stale-safe and service-only', () => {
  const { sql } = readF2Migration();
  const names = [...sql.matchAll(/create or replace function\s+public\.([a-z0-9_]*video_semantic_visual[a-z0-9_]*)/gi)]
    .map(match => match[1]);
  assert.deepEqual([...new Set(names)].sort(), [
    'claim_video_semantic_visual_v1',
    'complete_video_semantic_visual_v1',
    'fail_video_semantic_visual_v1',
  ]);

  const claim = functionBody(sql, 'public.claim_video_semantic_visual_v1');
  assert.match(claim, /p_limit\s+integer\s+default\s+2/i);
  assert.match(claim, /p_limit\s+between\s+1\s+and\s+5/i);
  assert.match(claim, /for update skip locked/i);
  assert.match(claim, /visual_semantic_status\s*=\s*'pending'/i);
  assert.match(claim, /visual_attempt_count\s*<\s*5/i);
  assert.match(claim, /private\.video_semantic_visual_source_v1/i);

  const complete = functionBody(sql, 'public.complete_video_semantic_visual_v1');
  assert.match(complete, /for update/i);
  assert.match(complete, /visual_semantic_status\s*(?:=|<>)\s*'processing'/i);
  assert.match(complete, /p_visual_source_fingerprint/i);
  assert.match(complete, /private\.video_semantic_visual_source_v1/i);
  assert.match(complete, /char_length[\s\S]{0,100}2500/i);
  assert.match(complete, /eligible_image[\s\S]{0,240}p_provider_call_count\s*<>\s*1/i);
  assert.match(complete, /eligible_stream_video[\s\S]{0,300}p_provider_call_count\s+not\s+between\s+1\s+and\s+5/i);
  assert.match(complete, /private\.content_safety_sha256/i);
  assert.match(complete, /private\.sync_video_semantic_profile_v1/i);

  const fail = functionBody(sql, 'public.fail_video_semantic_visual_v1');
  assert.match(fail, /visual_attempt_count\s*<\s*5/i);
  assert.match(fail, /p_retryable\s+boolean\s+default\s+true/i);
  assert.match(fail, /p_provider_call_count\s+integer\s+default\s+0/i);
  assert.match(fail, /private\.sync_video_semantic_profile_v1/i);

  for (const name of [...new Set(names)]) {
    const body = functionBody(sql, `public.${name}`);
    assert.match(body, /security definer/i);
    assert.match(body, /set search_path\s*=\s*''/i);
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]{0,400}?from public, anon, authenticated, service_role`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]{0,400}?to service_role`, 'i'));
  }
});

test('F2 keeps table access denied and exposes only an operational visual pending index', () => {
  const { sql } = readF2Migration();
  assert.match(sql, /alter table\s+private\.video_semantic_profiles\s+enable row level security/i);
  assert.match(sql, /revoke all on table\s+private\.video_semantic_profiles\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
  assert.match(sql, /create index[\s\S]{0,300}visual_available_at[\s\S]{0,300}visual_semantic_status\s*=\s*'pending'/i);
  assert.doesNotMatch(sql, /using\s+(?:hnsw|ivfflat)/i);
});

test('reconciler grows from 48 to exactly 50 and audits visual authority and sensitive inference', () => {
  const { sql } = readF2Migration();
  const reconciler = functionBody(sql, 'public.reconcile_algo_l1_v1');
  const keys = [...reconciler.matchAll(/^\s{4}'([a-z][a-z0-9_]*)'\s*,\s*\(/gm)].map(match => match[1]);
  assert.equal(new Set(keys).size, 50);
  assert.ok(keys.includes('l5_visual_semantic_authority_missing'));
  assert.ok(keys.includes('l5_visual_semantic_sensitive_inference_present'));
  assert.match(reconciler, /claim_video_semantic_visual_v1/i);
  assert.match(reconciler, /complete_video_semantic_visual_v1/i);
  assert.match(reconciler, /fail_video_semantic_visual_v1/i);
  assert.match(reconciler, /content_safety_visual_analyses|content_safety_alerts|public\.reports/i);
  assert.match(reconciler, /identity|face|race|ethnicity|religion|sexual|gender|health|disability|politic|location/i);
});

test('F2 is dormant, ranking-separated, and excludes moderation/sensitive sources', () => {
  const { sql } = readF2Migration();
  const input = functionBody(sql, 'private.video_semantic_input_v2');
  assert.doesNotMatch(sql, /create or replace function\s+public\.get_ranked_feed_l1_v1/i);
  assert.doesNotMatch(sql, /behavioral_l5/i);
  assert.doesNotMatch(sql, /insert into\s+private\.video_semantic_profiles\s*\([^;]*\)\s*select/i);
  assert.doesNotMatch(sql, /(?:select|perform|call)\s+public\.refresh_video_semantic_profile_v1\s*\(/i);
  assert.doesNotMatch(sql, /(?:http|net\.http|ai\/run|workers\.dev)/i);
  for (const forbidden of [
    /content_safety_visual_analyses|analysis_result|review_required/i,
    /content_safety_alerts|public\.reports|admin_user_warnings/i,
    /advertising|marketplace|shipping|orders/i,
    /financial_transactions|ledger_entries|wallet/i,
    /messages|private_chat/i,
    /user_profiles\.location|gps|ip_address/i,
    /device_model|network_type|network_state/i,
  ]) assert.doesNotMatch(input, forbidden);
});
