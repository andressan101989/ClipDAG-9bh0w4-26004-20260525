import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const rankingClient = readFileSync(
  new URL('../services/feedRankingService.ts', import.meta.url),
  'utf8',
);

function readL5Migration() {
  const matches = readdirSync(migrationDirectory)
    .filter(name => name.endsWith('_algo6_l5_semantic_embedding_foundation.sql'));
  assert.equal(matches.length, 1, 'exactly one generated L5-F1 migration must exist');
  return {
    filename: matches[0],
    sql: readFileSync(new URL(matches[0], migrationDirectory), 'utf8'),
  };
}

function functionBody(sql, qualifiedName) {
  const marker = `create or replace function ${qualifiedName}`;
  const start = sql.toLowerCase().indexOf(marker.toLowerCase());
  assert.ok(start >= 0, `${qualifiedName} must be defined by L5-F1`);
  const nextAcl = sql.toLowerCase().indexOf('\nrevoke all on function', start);
  assert.ok(nextAcl > start, `${qualifiedName} must have explicit ACL handling`);
  return sql.slice(start, nextAcl);
}

test('L5-F1 installs pgvector in extensions and one canonical private profile table', () => {
  const { filename, sql } = readL5Migration();
  assert.match(filename, /^\d{14}_algo6_l5_semantic_embedding_foundation\.sql$/);
  assert.match(sql, /^begin;/i);
  assert.match(sql, /commit;\s*$/i);
  assert.match(sql, /create extension if not exists vector\s+with schema extensions/i);
  assert.equal(
    (sql.match(/create table\s+private\.video_semantic_profiles/gi) ?? []).length,
    1,
  );
  assert.match(sql, /video_id\s+uuid\s+primary key/i);
  assert.match(sql, /references\s+public\.videos\s*\(\s*id\s*\)[\s\S]{0,80}on delete cascade/i);
  assert.match(sql, /embedding\s+extensions\.vector\s*\(\s*1024\s*\)/i);
  assert.match(sql, /semantic_input_version\s+text[\s\S]{0,120}video-semantic-v1/i);
  assert.match(sql, /provider\s+text[\s\S]{0,120}cloudflare_workers_ai/i);
  assert.match(sql, /model\s+text[\s\S]{0,120}@cf\/baai\/bge-m3/i);
  assert.match(sql, /embedding_dimensions\s+integer[\s\S]{0,120}1024/i);
});

test('canonical profile constraints bound fingerprints, states, attempts and timestamps', () => {
  const { sql } = readL5Migration();
  for (const fingerprint of [
    'source_content_fingerprint',
    'semantic_input_fingerprint',
    'caption_fingerprint',
    'source_transcript_fingerprint',
  ]) {
    assert.match(sql, new RegExp(`${fingerprint}[\\s\\S]{0,400}(?:\\^\\[0-9a-f\\]\\{64\\}\\$|64-char)`, 'i'));
  }
  assert.match(sql, /status\s+in\s*\(\s*'pending'\s*,\s*'processing'\s*,\s*'ready'\s*,\s*'failed'\s*,\s*'not_eligible'\s*\)/i);
  assert.match(sql, /attempt_count\s+between\s+0\s+and\s+5/i);
  assert.match(sql, /provider_call_count\s*>=\s*0/i);
  assert.match(sql, /status\s*=\s*'ready'[\s\S]{0,250}embedding\s+is\s+not\s+null/i);
  assert.match(sql, /status\s*=\s*'processing'[\s\S]{0,250}started_at\s+is\s+not\s+null/i);
  assert.match(sql, /updated_at\s*>=\s*created_at/i);
  assert.match(sql, /create index[\s\S]{0,300}available_at[\s\S]{0,300}status\s*=\s*'pending'/i);
  assert.doesNotMatch(sql, /using\s+(?:hnsw|ivfflat)/i);
});

test('semantic input reuses the canonical content snapshot and hash authority', () => {
  const { sql } = readL5Migration();
  const input = functionBody(sql, 'private.video_semantic_input_v1');
  assert.match(input, /private\.content_safety_target_snapshot\s*\(\s*'video'\s*,\s*p_video_id\s*\)/i);
  assert.match(input, /private\.content_safety_sha256/i);
  assert.match(input, /video-semantic-v1/i);
  assert.match(input, /regexp_replace[\s\S]{0,300}\\s\+/i);
  assert.match(input, /left\s*\([\s\S]{0,200}2048\s*\)/i);
  assert.match(input, /left\s*\([\s\S]{0,200}12000\s*\)/i);
  assert.match(input, /left\s*\([\s\S]{0,200}15000\s*\)/i);
  assert.match(input, /caption:\\n/i);
  assert.match(input, /transcript:\\n/i);
  assert.match(input, /eligible/i);
  assert.match(input, /no_semantic_text/i);
});

test('transcript reuse is current, useful, deterministic and Whisper-only', () => {
  const { sql } = readL5Migration();
  const input = functionBody(sql, 'private.video_semantic_input_v1');
  assert.match(input, /private\.content_safety_audio_transcripts/i);
  assert.match(input, /private\.content_safety_scans/i);
  assert.match(input, /target_type\s*=\s*'video'/i);
  assert.match(input, /source_scan_id\s*=\s*[a-z0-9_.]+\.id/i);
  assert.match(input, /source_content_fingerprint\s*=\s*v_source_content_fingerprint/i);
  assert.match(input, /no_speech\s*=\s*false/i);
  assert.match(input, /word_count\s*>\s*0/i);
  assert.match(input, /btrim\s*\([\s\S]{0,80}transcript_text[\s\S]{0,80}\)\s*<>\s*''/i);
  assert.match(input, /cloudflare_workers_ai/i);
  assert.match(input, /@cf\/openai\/whisper-large-v3-turbo/i);
  assert.match(input, /order by[\s\S]{0,100}created_at\s+desc[\s\S]{0,100}id\s+desc/i);
  assert.match(input, /limit\s+1/i);
});

test('sync and triggers only update lifecycle state for semantic content changes', () => {
  const { sql } = readL5Migration();
  const sync = functionBody(sql, 'private.sync_video_semantic_profile_v1');
  assert.match(sync, /private\.video_semantic_input_v1/i);
  assert.match(sync, /insert into\s+private\.video_semantic_profiles/i);
  assert.match(sync, /on conflict\s*\(\s*video_id\s*\)/i);
  assert.match(sync, /semantic_input_fingerprint/i);
  assert.match(sync, /embedding\s*=\s*null/i);
  assert.match(sync, /attempt_count\s*=\s*0/i);
  assert.match(sync, /status\s*=\s*'pending'|then\s+'pending'/i);
  assert.match(sync, /status\s*=\s*'not_eligible'|then\s+'not_eligible'|else\s+'not_eligible'/i);

  assert.match(sql, /after insert or update of\s+caption\s*,\s*video_url\s*,\s*media_urls\s*,\s*edited_at\s+on\s+public\.videos/i);
  assert.doesNotMatch(sql, /update of[^;]*(?:views_count|likes_count|comments_count|saves_count)/i);
  assert.match(sql, /after insert\s+on\s+private\.content_safety_audio_transcripts/i);
  const videoTrigger = functionBody(sql, 'private.sync_video_semantic_profile_from_video_v1');
  const transcriptTrigger = functionBody(sql, 'private.sync_video_semantic_profile_from_transcript_v1');
  assert.doesNotMatch(`${videoTrigger}\n${transcriptTrigger}`, /(?:http|net\.http|fetch\s*\(|cloudflare|ai\/run)/i);
});

test('exactly four service-only public semantic RPCs preserve bounded queue semantics', () => {
  const { sql } = readL5Migration();
  const expected = [
    'refresh_video_semantic_profile_v1',
    'claim_video_semantic_profiles_v1',
    'complete_video_semantic_profile_v1',
    'fail_video_semantic_profile_v1',
  ];
  const publicSemanticFunctions = [...sql.matchAll(/create or replace function\s+public\.([a-z0-9_]*video_semantic[a-z0-9_]*)/gi)]
    .map(match => match[1]);
  assert.deepEqual([...new Set(publicSemanticFunctions)].sort(), expected.sort());

  const claim = functionBody(sql, 'public.claim_video_semantic_profiles_v1');
  assert.match(claim, /p_limit\s+integer\s+default\s+8/i);
  assert.match(claim, /p_limit\s+between\s+1\s+and\s+25/i);
  assert.match(claim, /for update skip locked/i);
  assert.match(claim, /status\s*=\s*'pending'/i);
  assert.match(claim, /attempt_count\s*<\s*5/i);
  assert.match(claim, /available_at\s*<=\s*clock_timestamp\s*\(\s*\)/i);
  assert.match(claim, /attempt_count\s*=\s*[a-z0-9_.]*attempt_count\s*\+\s*1/i);

  const complete = functionBody(sql, 'public.complete_video_semantic_profile_v1');
  assert.match(complete, /p_embedding\s+extensions\.vector\s*\(\s*1024\s*\)/i);
  assert.match(complete, /for update/i);
  assert.match(complete, /status\s*(?:=|<>)\s*'processing'/i);
  assert.match(complete, /semantic_input_fingerprint/i);
  assert.match(complete, /provider_call_count\s*=\s*[a-z0-9_.]*provider_call_count\s*\+\s*1/i);

  const fail = functionBody(sql, 'public.fail_video_semantic_profile_v1');
  assert.match(fail, /p_retryable\s+boolean\s+default\s+true/i);
  assert.match(fail, /p_provider_called\s+boolean\s+default\s+false/i);
  assert.match(fail, /attempt_count\s*<\s*5/i);
  assert.match(fail, /available_at/i);
  assert.match(fail, /last_error_code/i);
});

test('table and helper access fails closed while public RPCs are service-role only', () => {
  const { sql } = readL5Migration();
  assert.match(sql, /alter table\s+private\.video_semantic_profiles\s+enable row level security/i);
  assert.match(sql, /revoke all on table\s+private\.video_semantic_profiles\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
  for (const name of [
    'refresh_video_semantic_profile_v1',
    'claim_video_semantic_profiles_v1',
    'complete_video_semantic_profile_v1',
    'fail_video_semantic_profile_v1',
  ]) {
    const body = functionBody(sql, `public.${name}`);
    assert.match(body, /security definer/i);
    assert.match(body, /set search_path\s*=\s*''/i);
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]{0,300}?from public, anon, authenticated, service_role`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]{0,300}?to service_role`, 'i'));
  }
  assert.match(sql, /revoke all on function\s+private\.video_semantic_input_v1\s*\(\s*uuid\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
  assert.match(sql, /revoke all on function\s+private\.sync_video_semantic_profile_v1\s*\(\s*uuid\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
});

test('the canonical reconciler grows from 43 to exactly 48 counters', () => {
  const { sql } = readL5Migration();
  const reconciler = functionBody(sql, 'public.reconcile_algo_l1_v1');
  const keys = [...reconciler.matchAll(/^\s{4}'([a-z][a-z0-9_]*)'\s*,\s*\(/gm)].map(match => match[1]);
  assert.equal(new Set(keys).size, 48, 'reconciler must expose exactly 48 unique counters');
  for (const key of [
    'l5_vector_extension_missing',
    'l5_semantic_profile_authority_missing',
    'l5_semantic_queue_authority_missing',
    'l5_parallel_semantic_authority_present',
    'l5_sensitive_semantic_source_present',
  ]) assert.ok(keys.includes(key), `${key} must be reconciled`);
  assert.match(reconciler, /extensions\.vector|extname\s*=\s*'vector'/i);
  assert.match(reconciler, /video_embeddings|content_embeddings/i);
  assert.match(reconciler, /user_interest_vectors|user_semantic_profiles/i);
  assert.match(reconciler, /content_safety_alerts|public\.reports/i);
  assert.match(reconciler, /visual|advertising|marketplace|messages|location|device|network|financial/i);
});

test('F1 adds no parallel semantic authority or forbidden semantic dependency', () => {
  const { sql } = readL5Migration();
  const input = functionBody(sql, 'private.video_semantic_input_v1');
  const approvedCreate = /create table\s+private\.video_semantic_profiles/gi;
  assert.equal((sql.match(/create table\s+(?:private|public)\.[a-z0-9_]*(?:semantic|embedding|vector|interest)[a-z0-9_]*/gi) ?? []).length, 1);
  assert.equal((sql.match(approvedCreate) ?? []).length, 1);
  assert.doesNotMatch(sql, /pgmq|vectorize|pinecone/i);
  assert.doesNotMatch(sql, /create table[^;]*(?:queue|user_interest|creator_embedding|semantic_score|ranking_cache)/i);
  for (const forbidden of [
    /content_safety_alerts/i,
    /public\.reports/i,
    /admin_user_warnings/i,
    /content_safety_visual_analyses/i,
    /analysis_result|review_required|visual[-_]safety/i,
    /advertising|marketplace|shipping|orders/i,
    /financial|ledger|wallet/i,
    /messages|private_chat/i,
    /user_profiles\.location|gps|ip_address/i,
    /device|network/i,
  ]) assert.doesNotMatch(input, forbidden);
});

test('F1 migration and client contain no Feed ranking or behavioral L5 change', () => {
  const { sql } = readL5Migration();
  assert.doesNotMatch(sql, /create or replace function\s+public\.get_ranked_feed_l1_v1/i);
  assert.doesNotMatch(sql, /alter table\s+private\.algo_l1_policy|update\s+private\.algo_l1_policy/i);
  assert.doesNotMatch(sql, /behavioral_l5|rank_score/i);
  assert.doesNotMatch(rankingClient, /behavioral_l5|video_semantic_profiles|semantic_(?:score|similarity)/i);
});

test('F1 migration is dormant and performs no existing-video backfill or provider call', () => {
  const { sql } = readL5Migration();
  assert.doesNotMatch(sql, /insert into\s+private\.video_semantic_profiles\s*\([^;]*\)\s*select/i);
  assert.doesNotMatch(sql, /(?:select|perform|call)\s+public\.refresh_video_semantic_profile_v1\s*\(/i,
    'migration must define but never invoke refresh; function definitions are checked separately');
  assert.doesNotMatch(sql, /(?:http|net\.http|ai\/run|workers\.dev)/i);
  assert.doesNotMatch(sql, /(?:insert|update|delete)[\s\S]{0,80}public\.(?:video_views|likes|comments|video_saves|follows)/i);
});
