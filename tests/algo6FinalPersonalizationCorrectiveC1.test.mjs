import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationsUrl = new URL('../supabase/migrations/', import.meta.url);
const migrationNames = readdirSync(migrationsUrl)
  .filter(name => name.endsWith('_algo6_final_personalization_corrective_c1.sql'));
const migrationSql = migrationNames.length === 1
  ? readFileSync(new URL(migrationNames[0], migrationsUrl), 'utf8')
  : '';
const deployedRankerSql = readFileSync(
  new URL('../supabase/migrations/20261006160329_algo6_l6_training_model_pipeline.sql', import.meta.url),
  'utf8',
);
const service = readFileSync(new URL('../services/personalizationService.ts', import.meta.url), 'utf8');
const onboarding = readFileSync(new URL('../app/onboarding/personalization.tsx', import.meta.url), 'utf8');

test('C1 is one forward-only migration and deployed macro migrations stay historical', () => {
  assert.equal(migrationNames.length, 1);
  assert.match(migrationNames[0], /^\d{14}_algo6_final_personalization_corrective_c1\.sql$/);
  assert.match(migrationSql, /alter\s+table\s+private\.user_personalization_profiles[\s\S]*add\s+column\s+account_region_code/i);
  assert.doesNotMatch(migrationSql, /create\s+table\s+(?:private\.)?(?:user_personalization|advertising_audiences|algo6_model)/i);
});

test('personalization V2 separates account and preferred-content region with one browser write authority', () => {
  for (const fn of [
    'get_personalization_onboarding_catalog_v2',
    'get_my_personalization_onboarding_v2',
    'save_my_personalization_preferences_v2',
  ]) {
    assert.match(migrationSql, new RegExp(`function public\\.${fn}\\(`, 'i'));
    assert.match(migrationSql, new RegExp(`grant execute on function public\\.${fn}\\([^;]*\\)\\s+to authenticated`, 'i'));
  }
  for (const fn of [
    'get_personalization_onboarding_catalog_v1',
    'get_my_personalization_onboarding_v1',
    'save_my_personalization_preferences_v1',
  ]) {
    assert.match(migrationSql, new RegExp(`revoke (?:all|execute) on function public\\.${fn}\\([^;]*\\)[\\s\\S]{0,120}from public, ?anon, ?authenticated`, 'i'));
  }
  assert.match(migrationSql, /account_region_code[\s\S]*\^\[A-Z\]\{2\}\$/i);
  assert.match(migrationSql, /personalization_account_region_invalid/i);
  assert.match(migrationSql, /'account_region_contract'\s*,\s*'ISO_3166_1_ALPHA_2'/i);
  assert.match(migrationSql, /'content_region_contract'\s*,\s*'GLOBAL_OR_ISO_3166_1_ALPHA_2'/i);
  assert.match(service, /get_personalization_onboarding_catalog_v2/);
  assert.match(service, /get_my_personalization_onboarding_v2/);
  assert.match(service, /save_my_personalization_preferences_v2/);
  assert.doesNotMatch(service, /get_personalization_onboarding_catalog_v1|get_my_personalization_onboarding_v1|save_my_personalization_preferences_v1/);
});

test('personalized rollout-zero users activate the full L2-L5 stack and only swipe is preference-negative', () => {
  assert.match(migrationSql, /v_l2_effective\s*:=\s*v_viewer_id is not null[\s\S]{0,180}v_personalization_effective/i);
  assert.match(migrationSql, /v_l3_effective\s*:=\s*v_behavioral[\s\S]{0,180}v_personalization_effective/i);
  assert.match(migrationSql, /v_l4_effective\s*:=\s*v_behavioral[\s\S]{0,180}v_personalization_effective/i);
  assert.match(migrationSql, /v_l5_effective\s*:=\s*v_behavioral[\s\S]{0,220}v_personalization_effective/i);
  for (const alias of ['l4lvr', 'lrr', 'vv']) {
    assert.match(
      migrationSql,
      new RegExp(`${alias}\\.exit_reason in \\(\\'\\'swipe\\'\\', \\'\\'background\\'\\', \\'\\'unmount\\'\\'\\)[\\s\\S]{0,180}${alias}\\.exit_reason = \\'\\'swipe\\'\\'`, 'i'),
    );
  }
  assert.match(migrationSql, /strpos\(v_definition,E?'[^']*exit_reason in \(''swipe'', ''background'', ''unmount''\)'\)\s*>\s*0/i);
  assert.match(migrationSql, /l3_quality_eligible[\s\S]*exit_reason in \(''swipe'', ''ended''\)/i);
  assert.match(migrationSql, /l4lvr\.exit_reason\s*=\s*''swipe''/i);
  assert.match(migrationSql, /lrr\.exit_reason\s*=\s*''swipe''/i);
  assert.match(migrationSql, /vv\.exit_reason\s*=\s*''swipe''/i);
  assert.match(deployedRankerSql, /l5_negative_valid_events[\s\S]*l5_negative_distinct[\s\S]*exit_reason\s*=\s*'swipe'/i);
  assert.match(deployedRankerSql, /bounded_evidence[\s\S]*exit_reason\s*=\s*'swipe'/i);
});

test('organic, creator recommendation, and Ads use the correct region semantics', () => {
  assert.match(migrationSql, /creator_profile\.account_region_code\s*=\s*v_personalization_profile\.content_region_code/i);
  assert.match(migrationSql, /cp\.account_region_code\s*=\s*vp\.content_region_code/i);
  assert.match(migrationSql, /'account_region_code'\s*,\s*p\.account_region_code/i);
  assert.match(migrationSql, /v_region\s*:=\s*v_traits->>'account_region_code'/i);
  assert.doesNotMatch(migrationSql, /v_region\s*:=\s*v_traits->>'content_region_code'/i);
  assert.doesNotMatch(migrationSql, /gps|latitude|longitude|ip_address|ip geolocation/i);
});

test('editing bypasses onboarding-only follows while preserving the completion timestamp', () => {
  assert.match(migrationSql, /if\s+v_profile\.onboarding_completed_at\s+is\s+null\s+then[\s\S]*personalization_creator_follows_required[\s\S]*end if/i);
  assert.match(migrationSql, /onboarding_completed_at\s*=\s*coalesce\(onboarding_completed_at\s*,\s*v_now\)/i);
  assert.match(onboarding, /Editar personalización/);
  assert.match(onboarding, /isEditing[\s\S]*savePersonalizationPreferences[\s\S]*router\.replace\(['"]\/settings['"]\)/i);
  assert.match(onboarding, /Tu país o región/);
  assert.match(onboarding, /Región del contenido que quieres ver/);
  assert.match(onboarding, /accountRegion/);
});

test('model promotion checks every reconciler counter under the promotion lock', () => {
  assert.match(migrationSql, /pg_advisory_xact_lock\s*\(\s*hashtextextended\s*\(\s*'algo6-model-promotion'/i);
  assert.match(migrationSql, /p_action\s+in\s*\(\s*'candidate_to_canary'\s*,\s*'canary_to_active'\s*,\s*'rollback'\s*\)[\s\S]*public\.reconcile_algo_l1_v1\(\)/i);
  assert.match(migrationSql, /jsonb_each[\s\S]*algo6_model_reconciler_not_clean/i);
  assert.match(migrationSql, /p_action\s*=\s*'candidate_to_rejected'/i);
  assert.match(migrationSql, /p_action\s*=\s*'active_to_retired'/i);
});

test('corrective migration keeps one canonical ranker, registry, and Ads authority', () => {
  assert.ok(existsSync(new URL('../services/personalizationService.ts', import.meta.url)));
  assert.match(migrationSql, /pg_get_functiondef\(p\.oid\)[\s\S]*public\.get_ranked_feed_l1_v1/i);
  assert.match(migrationSql, /execute\s+v_definition/i);
  assert.doesNotMatch(migrationSql, /create\s+(?:or replace\s+)?function\s+public\.get_ranked_feed_l1_v1\(/i);
  assert.doesNotMatch(migrationSql, /get_ranked_feed_(?:v2|l6)|personalized_feed|cold_start_feed|ai_feed/i);
  assert.doesNotMatch(migrationSql, /create\s+table\s+private\.algo6_model_versions/i);
  assert.doesNotMatch(migrationSql, /create\s+table\s+private\.advertising_audiences/i);
});
