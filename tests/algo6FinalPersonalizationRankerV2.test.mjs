import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const migrationNames = readdirSync(migrationDirectory)
  .filter(name => name.endsWith('_algo6_personalization_ranker_v2.sql'));
const migrationSql = migrationNames.length === 1
  ? readFileSync(new URL(migrationNames[0], migrationDirectory), 'utf8')
  : '';
const allMigrationSql = readdirSync(migrationDirectory)
  .filter(name => name.endsWith('.sql'))
  .map(name => readFileSync(new URL(name, migrationDirectory), 'utf8'))
  .join('\n');

test('ranker V2 uses one CLI-named migration and the same canonical Feed RPC', () => {
  assert.equal(migrationNames.length, 1);
  assert.match(migrationNames[0], /^\d{14}_algo6_personalization_ranker_v2\.sql$/);
  assert.match(migrationSql, /create function public\.get_ranked_feed_l1_v1\(/i);
  assert.doesNotMatch(migrationSql, /get_ranked_feed_(?:v2|l6)|personalized_feed|ai_feed|cold_start_feed/i);
  assert.doesNotMatch(allMigrationSql, /create\s+(?:or replace\s+)?function\s+public\.(?:personalized_feed|ai_feed|cold_start_feed)/i);
});

test('cold-start features and exact 20-video decay are computed inside the bounded ranker', () => {
  for (const field of [
    'explicit_interest_similarity', 'explicit_interest_points',
    'preferred_language_points', 'content_region_points',
    'explicit_seed_weight', 'behavioral_confidence',
  ]) assert.match(migrationSql, new RegExp(field, 'i'));
  assert.match(migrationSql, /count\s*\(\s*distinct\s+[^)]*video_id/i);
  assert.match(migrationSql, /least\s*\(\s*1(?:::numeric)?\s*,\s*v_behavior_signal_count::numeric\s*\/\s*20\.0::numeric\s*\)/i);
  assert.match(migrationSql, /greatest\s*\(\s*0::numeric\s*,\s*1::numeric\s*-\s*v_behavioral_confidence\s*\)/i);
  assert.match(migrationSql, /preferences_updated_at/i);
  assert.match(migrationSql, /exit_reason\s*=\s*'swipe'/i);
  assert.match(migrationSql, /v_behavior_signal_count[\s\S]*vv\.exit_reason\s*=\s*'swipe'/i);
  assert.match(migrationSql, /l5_negative_valid_events[\s\S]*l5_negative_distinct[\s\S]*nve\.exit_reason\s*=\s*'swipe'[\s\S]*l5_negative_history/i);
});

test('personalization is a soft bounded boost and missing embeddings remain eligible', () => {
  assert.match(migrationSql, /cosine_distance|<=>/i);
  assert.match(migrationSql, /detected_language/i);
  assert.match(migrationSql, /content_region_code/i);
  assert.match(migrationSql, /exploration_points/i);
  assert.match(migrationSql, /creator_page_cap/i);
  assert.match(migrationSql, /explicit_candidate_semantics[\s\S]*left join private\.video_semantic_profiles/i);
  assert.match(migrationSql, /coalesce\(ecs\.explicit_interest_similarity,0/i);
  assert.doesNotMatch(migrationSql, /gps|latitude|longitude|ip_address|device_fingerprint/i);
});

test('new decisions use V2 old-plus-six snapshot while historical V1 remains valid', () => {
  assert.match(migrationSql, /organic-ranking-features-personalization-v2/i);
  assert.match(migrationSql, /organic-ranking-features-l1-l5-v1/i);
  for (const field of [
    'freshness_points', 'l5_semantic_adjustment', 'explicit_interest_similarity',
    'explicit_interest_points', 'preferred_language_points', 'content_region_points',
    'explicit_seed_weight', 'behavioral_confidence',
  ]) assert.match(migrationSql, new RegExp(`'${field}'`, 'i'));
  assert.doesNotMatch(migrationSql, /delete\s+from\s+private\.organic_ranking_/i);
});
