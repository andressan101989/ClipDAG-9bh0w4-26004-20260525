import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrations = new URL('../supabase/migrations/', import.meta.url);
const rankingClient = readFileSync(new URL('../services/feedRankingService.ts', import.meta.url), 'utf8');

function readMigration(suffix) {
  const matches = readdirSync(migrations).filter(name => name.endsWith(suffix));
  assert.equal(matches.length, 1, `exactly one migration must end with ${suffix}`);
  return { filename: matches[0], sql: readFileSync(new URL(matches[0], migrations), 'utf8') };
}

function functionBody(sql, qualifiedName) {
  const start = sql.toLowerCase().indexOf(`create or replace function ${qualifiedName}`.toLowerCase());
  assert.ok(start >= 0, `${qualifiedName} must be defined`);
  const end = sql.toLowerCase().indexOf('\nrevoke all on function', start);
  assert.ok(end > start, `${qualifiedName} must have explicit ACL handling`);
  return sql.slice(start, end);
}

function cteBody(sql, name, nextName) {
  const match = sql.match(new RegExp(`${name}\\s+as\\s+materialized\\s*\\(([\\s\\S]*?)\\r?\\n\\s*\\),\\r?\\n\\s*${nextName}\\s+as(?:\\s+materialized)?`, 'i'));
  assert.ok(match, `${name} CTE must precede ${nextName}`);
  return match[1].replace(/\s+/g, ' ').trim();
}

test('F3 adds exact dormant L5 policy defaults and bounds', () => {
  const { filename, sql } = readMigration('_algo6_l5_f3_semantic_affinity_ranking.sql');
  assert.match(filename, /^\d{14}_algo6_l5_f3_semantic_affinity_ranking\.sql$/);
  assert.match(sql, /^begin;/i);
  assert.match(sql, /commit;\s*$/i);
  const defaults = new Map([
    ['l5_semantic_enabled', 'false'],
    ['l5_semantic_horizon_days', '30'],
    ['l5_semantic_history_cap', '50'],
    ['l5_semantic_positive_watch_ratio_threshold', '0.650000'],
    ['l5_semantic_positive_min_distinct_videos', '2'],
    ['l5_semantic_negative_min_distinct_videos', '2'],
    ['l5_semantic_full_confidence_videos', '10'],
    ['l5_semantic_positive_similarity_floor', '0.350000'],
    ['l5_semantic_negative_similarity_floor', '0.450000'],
    ['l5_semantic_positive_cap', '12'],
    ['l5_semantic_negative_cap', '8'],
  ]);
  for (const [column, value] of defaults) {
    assert.match(sql, new RegExp(`add column\\s+${column}[\\s\\S]{0,100}?not null\\s+default\\s+${value}`, 'i'),
      `${column} must keep its approved default`);
  }
  for (const contract of [
    /l5_semantic_horizon_days\s+between\s+1\s+and\s+365/i,
    /l5_semantic_history_cap\s+between\s+1\s+and\s+200/i,
    /l5_semantic_positive_watch_ratio_threshold\s+between\s+0\s+and\s+1/i,
    /l5_semantic_positive_min_distinct_videos\s+between\s+1\s+and\s+50/i,
    /l5_semantic_negative_min_distinct_videos\s+between\s+1\s+and\s+50/i,
    /l5_semantic_full_confidence_videos\s*>=\s*l5_semantic_positive_min_distinct_videos/i,
    /l5_semantic_full_confidence_videos\s*<=\s*200/i,
    /l5_semantic_positive_similarity_floor\s*>=\s*-1[\s\S]{0,100}l5_semantic_positive_similarity_floor\s*<\s*1/i,
    /l5_semantic_negative_similarity_floor\s*>=\s*-1[\s\S]{0,100}l5_semantic_negative_similarity_floor\s*<\s*1/i,
    /l5_semantic_positive_cap\s+between\s+0\s+and\s+100/i,
    /l5_semantic_negative_cap\s+between\s+0\s+and\s+100/i,
  ]) assert.match(sql, contract);
  assert.doesNotMatch(sql, /update\s+private\.algo_l1_policy[\s\S]{0,120}l5_semantic_enabled\s*=\s*true/i);
});

test('F3 keeps one canonical RPC, candidate authority, signature and cursor shape', () => {
  const { sql } = readMigration('_algo6_l5_f3_semantic_affinity_ranking.sql');
  const { sql: l4 } = readMigration('_algo6_l4_directed_canary.sql');
  const ranking = functionBody(sql, 'public.get_ranked_feed_l1_v1');
  const definitions = [...sql.matchAll(/create or replace function\s+public\.get_ranked_feed_l1_v1/gi)];
  assert.equal(definitions.length, 1);
  assert.match(ranking, /p_client_session_id\s+uuid[\s\S]*p_limit\s+integer[\s\S]*p_as_of\s+timestamp with time zone[\s\S]*p_before_score\s+numeric[\s\S]*p_before_created_at\s+timestamp with time zone[\s\S]*p_before_id\s+uuid[\s\S]*p_policy_version\s+text/i);
  assert.match(ranking, /returns table\s*\([\s\S]*ranking_mode text[\s\S]*rank_score numeric\(18,6\)[\s\S]*cursor_score numeric\(18,6\)[\s\S]*effective_page_limit integer/i);
  assert.equal(cteBody(ranking, 'candidates', 'candidate_ids'), cteBody(functionBody(l4, 'public.get_ranked_feed_l1_v1'), 'candidates', 'candidate_ids'));
  assert.match(ranking, /\(d\.delivery_score,\s*d\.created_at,\s*d\.id\)[\s\S]{0,120}<\s*\(p_before_score,\s*p_before_created_at,\s*p_before_id\)/i);
  assert.match(sql, /revoke all on function public\.get_ranked_feed_l1_v1\([\s\S]{0,300}\) from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant execute on function public\.get_ranked_feed_l1_v1\([\s\S]{0,300}\) to anon, authenticated/i);
  assert.match(ranking, /security definer/i);
  assert.match(ranking, /set search_path\s*=\s*''/i);
});

test('positive semantic history is distinct, bounded, self-excluding and comment-free', () => {
  const { sql } = readMigration('_algo6_l5_f3_semantic_affinity_ranking.sql');
  const ranking = functionBody(sql, 'public.get_ranked_feed_l1_v1');
  assert.match(ranking, /l5_positive_like_signals/i);
  assert.match(ranking, /from public\.likes/i);
  assert.match(ranking, /l5_positive_save_signals/i);
  assert.match(ranking, /from public\.video_saves/i);
  assert.match(ranking, /l5_positive_view_signals/i);
  assert.match(ranking, /completed\s+is\s+true/i);
  assert.match(ranking, /completion_ratio\s*>=\s*v_policy\.l5_semantic_positive_watch_ratio_threshold/i);
  assert.match(ranking, /rewatch_count\s*>\s*0/i);
  assert.match(ranking, /v\.user_id\s*<>\s*v_viewer_id/i);
  assert.match(ranking, /max\([^)]*positive_signal/i);
  assert.match(ranking, /order by\s+most_recent_positive_signal\s+desc\s*,\s*video_id\s+desc[\s\S]{0,120}limit\s+v_policy\.l5_semantic_history_cap/i);
  const l5Section = ranking.slice(ranking.search(/l5_positive_like_signals/i), ranking.search(/like_features\s+as/i));
  assert.doesNotMatch(l5Section, /public\.comments|public\.follows/i);
});

test('centroids and candidate semantics use only current ready v2 BGE-M3 vectors', () => {
  const { sql } = readMigration('_algo6_l5_f3_semantic_affinity_ranking.sql');
  const ranking = functionBody(sql, 'public.get_ranked_feed_l1_v1');
  for (const token of [
    "status = 'ready'", "semantic_input_version = 'video-semantic-v2'",
    "provider = 'cloudflare_workers_ai'", "model = '@cf/baai/bge-m3'",
    'embedding_dimensions = 1024', 'embedding is not null',
    'extensions.vector_norm', 'completed_at <= v_as_of', 'updated_at <= v_as_of',
  ]) assert.ok(ranking.toLowerCase().includes(token.toLowerCase()), `${token} must gate embeddings`);
  assert.match(ranking, /extensions\.avg\s*\(\s*[^)]*embedding[^)]*\)/i);
  assert.match(ranking, /l5_positive_distinct_video_count|positive_distinct_video_count/i);
  assert.match(ranking, /l5_negative_distinct_video_count|negative_distinct_video_count/i);
  assert.doesNotMatch(sql, /create\s+(?:unlogged\s+)?table[\s\S]{0,100}(?:centroid|user_semantic|interest_vector)/i);
});

test('negative history uses latest valid retention and positive-wins conflict resolution', () => {
  const { sql } = readMigration('_algo6_l5_f3_semantic_affinity_ranking.sql');
  const ranking = functionBody(sql, 'public.get_ranked_feed_l1_v1');
  assert.match(ranking, /l5_negative[\s\S]*media_duration_ms\s+is\s+not\s+null/i);
  assert.match(ranking, /media_duration_ms\s*>\s*0/i);
  assert.match(ranking, /completion_ratio\s+is\s+not\s+null/i);
  assert.match(ranking, /completion_ratio\s*<\s*v_policy\.short_watch_ratio_threshold/i);
  assert.match(ranking, /exit_reason\s+in\s*\(\s*'swipe'\s*,\s*'background'\s*,\s*'unmount'\s*\)/i);
  assert.match(ranking, /row_number\s*\(\s*\)\s+over\s*\([\s\S]{0,180}partition by[^)]*video_id[\s\S]{0,180}created_at\s+desc/i);
  assert.match(ranking, /not exists\s*\([\s\S]{0,180}l5_positive/i);
  assert.match(ranking, /order by\s+latest_negative_signal\s+desc\s*,\s*video_id\s+desc[\s\S]{0,120}limit\s+v_policy\.l5_semantic_history_cap/i);
});

test('L5 scoring is exact cosine, confidence-scaled, bounded and self-safe', () => {
  const { sql } = readMigration('_algo6_l5_f3_semantic_affinity_ranking.sql');
  const ranking = functionBody(sql, 'public.get_ranked_feed_l1_v1');
  assert.match(ranking, /v_l5_effective\s*:=\s*v_behavioral\s+and\s+v_viewer_id\s+is\s+not\s+null\s+and\s+v_policy\.l5_semantic_enabled/i);
  assert.match(ranking, /1\s*-\s*\([^)]*embedding\s+operator\s*\(\s*extensions\.<=>\s*\)\s+[^)]*centroid[^)]*\)/i);
  assert.match(ranking, /greatest\s*\(\s*-1[\s\S]{0,100}least\s*\(\s*1/i);
  assert.match(ranking, /l5_semantic_positive_cap[\s\S]{0,500}l5_semantic_positive_similarity_floor/i);
  assert.match(ranking, /l5_semantic_negative_cap[\s\S]{0,500}l5_semantic_negative_similarity_floor/i);
  assert.match(ranking, /l5_semantic_full_confidence_videos/i);
  assert.match(ranking, /c\.user_id\s*=\s*v_viewer_id[\s\S]{0,120}then\s+0::numeric/i);
  assert.match(ranking, /when\s+v_l5_effective\s+then[\s\S]{0,180}l5_semantic_positive_points[\s\S]{0,100}-\s*l5_semantic_negative_penalty[\s\S]{0,100}else\s+0::numeric/i);
  assert.match(ranking, /\+\s*l5_semantic_adjustment/i);
});

test('mode precedence puts authenticated global L5 above existing layers without directed L5', () => {
  const { sql } = readMigration('_algo6_l5_f3_semantic_affinity_ranking.sql');
  const ranking = functionBody(sql, 'public.get_ranked_feed_l1_v1');
  assert.match(ranking, /when not v_behavioral then 'chronological'[\s\S]*when v_l5_effective then 'behavioral_l5'[\s\S]*when v_l4_effective then 'behavioral_l4'[\s\S]*when v_l3_effective then 'behavioral_l3'[\s\S]*when v_l2_effective then 'behavioral_l2'[\s\S]*else 'behavioral_l1'/i);
  assert.doesNotMatch(ranking, /directed_l5|canary_target_layer\s*=\s*'l5'/i);
});

test('F3 adds no user vector, ANN, provider, sensitive dependency or candidate retrieval', () => {
  const { sql } = readMigration('_algo6_l5_f3_semantic_affinity_ranking.sql');
  assert.doesNotMatch(sql, /\b(?:hnsw|ivfflat|vectorize|pinecone)\b/i);
  assert.doesNotMatch(sql, /create\s+(?:unlogged\s+)?table/i);
  assert.doesNotMatch(sql, /(?:http|net\.http|workers\.dev|ai\/run)/i);
  for (const forbidden of [
    /content_safety_alerts|public\.reports|admin_user_warnings/i,
    /advertising_|marketplace_|financial_transactions|ledger_entries|wallet/i,
    /public\.messages|private_chat|user_profiles\.location/i,
    /gps|latitude|longitude|device_model|network_type|network_state/i,
  ]) assert.doesNotMatch(functionBody(sql, 'public.get_ranked_feed_l1_v1'), forbidden);
  for (const name of [
    'user_interest_vectors', 'user_semantic_profiles', 'viewer_embeddings',
    'semantic_centroids', 'semantic_interest_cache', 'user_embedding_cache',
  ]) assert.doesNotMatch(sql, new RegExp(`create\\s+(?:unlogged\\s+)?(?:table|materialized view)\\s+(?:public|private)\\.${name}`, 'i'));
});

test('reconciler grows from 50 to exactly 55 and audits F3 authority fail closed', () => {
  const { sql } = readMigration('_algo6_l5_f3_semantic_affinity_ranking.sql');
  const reconciler = functionBody(sql, 'public.reconcile_algo_l1_v1');
  const keys = [...reconciler.matchAll(/^\s{4}'([a-z][a-z0-9_]*)'\s*,\s*\(/gm)].map(match => match[1]);
  assert.equal(new Set(keys).size, 55);
  for (const key of [
    'l5_semantic_policy_invalid',
    'l5_semantic_unexpectedly_enabled',
    'l5_semantic_ranking_authority_missing',
    'l5_semantic_user_vector_materialization_present',
    'l5_semantic_ranking_sensitive_dependency_present',
  ]) assert.ok(keys.includes(key), `${key} must be reconciled`);
  assert.match(reconciler, /extensions\.avg|<=>|behavioral_l5|l5_semantic_adjustment/i);
  assert.match(reconciler, /user_interest_vectors|user_semantic_profiles|viewer_embeddings|semantic_centroids|semantic_interest_cache|user_embedding_cache/i);
  const materializationCheck = reconciler.slice(
    reconciler.indexOf("'l5_semantic_user_vector_materialization_present'"),
    reconciler.indexOf("'l5_semantic_ranking_sensitive_dependency_present'"),
  );
  assert.match(materializationCheck, /pg_catalog\.pg_class/i);
  assert.match(materializationCheck, /relkind\s+in\s*\(\s*'r'\s*,\s*'p'\s*,\s*'v'\s*,\s*'m'\s*\)/i);
  assert.doesNotMatch(materializationCheck, /information_schema\.tables/i);
  const sensitiveCheck = reconciler.slice(
    reconciler.indexOf("'l5_semantic_ranking_sensitive_dependency_present'"),
    reconciler.indexOf("'canary_generation_invalid'"),
  );
  const normalizedSensitiveCheck = sensitiveCheck.toLowerCase().replaceAll('\\', '');
  for (const token of [
    'content_safety_alerts', 'content_safety_visual_analyses', 'analysis_result',
    'review_required', 'visual_summary', 'visual_findings', 'public.reports',
    'admin_user_warnings', 'advertising_', 'marketplace_', 'financial_transactions',
    'ledger_entries', 'wallet', 'public.messages', 'private_chat',
    'user_profiles.location', 'gps', 'latitude', 'longitude', 'device_model',
    'network_type', 'network_state',
  ]) assert.ok(normalizedSensitiveCheck.includes(token), `${token} must fail closed`);
  assert.match(sql, /revoke all on function public\.reconcile_algo_l1_v1\(\)\s+from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant execute on function public\.reconcile_algo_l1_v1\(\) to service_role/i);
});

test('thin Feed client accepts behavioral_l5 and still rejects unknown modes', async () => {
  assert.match(rankingClient, /RankedFeedMode\s*=\s*[\s\S]{0,220}'behavioral_l5'/);
  assert.match(rankingClient, /row\.ranking_mode\s*===\s*'behavioral_l5'/);
  assert.doesNotMatch(rankingClient, /video_semantic_profiles|semantic_(?:centroid|similarity|score)|embedding/i);
  const { fetchRankedFeedPage } = await import('../services/feedRankingService.ts');
  const row = {
    id: '92000000-0000-4000-8000-000000000001',
    creator_username: 'creator', creator_avatar: '',
    created_at: '2026-10-05T00:00:00.000Z', ranking_mode: 'behavioral_l5',
    policy_version: 'nelyon-algo-l1-v1', rank_score: '2.400000',
    feed_as_of: '2026-10-05T00:01:00.000Z', cursor_score: '2.400000',
    cursor_created_at: '2026-10-05T00:00:00.000Z',
    cursor_id: '92000000-0000-4000-8000-000000000001', effective_page_limit: 10,
    ranking_decision_id: null, ranking_organic_position: null,
  };
  const client = { rpc: async () => ({ data: [row], error: null }) };
  const page = await fetchRankedFeedPage(client, { clientSessionId: '93000000-0000-4000-8000-000000000001' }, value => value.id);
  assert.equal(page.rankingMode, 'behavioral_l5');
  await assert.rejects(
    fetchRankedFeedPage({ rpc: async () => ({ data: [{ ...row, ranking_mode: 'semantic_magic' }], error: null }) },
      { clientSessionId: '93000000-0000-4000-8000-000000000001' }, value => value),
    /Invalid ranked feed row/,
  );
});
