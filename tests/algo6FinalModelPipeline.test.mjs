import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);
const migrationNames = readdirSync(migrationDirectory)
  .filter(name => name.endsWith('_algo6_l6_training_model_pipeline.sql'));
const migrationSql = migrationNames.length === 1
  ? readFileSync(new URL(migrationNames[0], migrationDirectory), 'utf8')
  : '';
const trainerUrl = new URL('../scripts/algo6/train_model.py', import.meta.url);
const requirementsUrl = new URL('../scripts/algo6/requirements.txt', import.meta.url);
const workflowUrl = new URL('../.github/workflows/algo6-model-train.yml', import.meta.url);
const trainer = existsSync(trainerUrl) ? readFileSync(trainerUrl, 'utf8') : '';
const requirements = existsSync(requirementsUrl) ? readFileSync(requirementsUrl, 'utf8') : '';
const workflow = existsSync(workflowUrl) ? readFileSync(workflowUrl, 'utf8') : '';

test('model pipeline is one CLI-named migration with exactly one private registry', () => {
  assert.equal(migrationNames.length, 1);
  assert.match(migrationNames[0], /^\d{14}_algo6_l6_training_model_pipeline\.sql$/);
  const registries = [...migrationSql.matchAll(/create\s+table\s+private\.([a-z0-9_]*model[a-z0-9_]*)/gi)]
    .map(match => match[1]);
  assert.deepEqual(registries, ['algo6_model_versions']);
  for (const column of [
    'model_version', 'status', 'feature_contract_version', 'label_contract_version',
    'training_window_start', 'training_window_end', 'training_sample_count',
    'head_metrics', 'model_payload', 'created_by', 'promoted_at', 'retired_at',
  ]) assert.match(migrationSql, new RegExp(column, 'i'));
  assert.match(migrationSql, /candidate[^\n]*canary[^\n]*active[^\n]*rejected[^\n]*retired/i);
});

test('V2 is the only public readiness authority and final labels are explicit', () => {
  assert.match(migrationSql, /function public\.get_algo6_l6_training_readiness_v2\(\)/i);
  assert.match(migrationSql, /alter function public\.get_algo6_l6_training_readiness_v1\(\) set schema private/i);
  assert.match(migrationSql, /organic-ranking-features-personalization-v2/i);
  assert.match(migrationSql, /algo6-l6-label-contract-v1/i);
  assert.match(migrationSql, /completion_ratio\s*>=\s*0\.50/i);
  assert.match(migrationSql, /exit_reason\s*=\s*'swipe'/i);
  assert.match(migrationSql, /short_watch_ratio_threshold/i);
  assert.match(migrationSql, /rewatch_count\s*>\s*0/i);
  assert.match(migrationSql, /row_number\(\)[\s\S]*(?:like|unlike)/i);
  assert.match(migrationSql, /row_number\(\)[\s\S]*(?:save|unsave)/i);
  assert.doesNotMatch(migrationSql, /PENDING_FINAL_LABEL_CONTRACT|PROVISIONAL_LABEL_CONTRACT/i);
});

test('readiness V2 dynamically requires every approved global, head, split, and integrity gate', () => {
  for (const value of [250000, 100000, 2000, 200, 84, 10000, 5000, 500]) {
    assert.match(migrationSql, new RegExp(`\\b${value}\\b`));
  }
  assert.match(migrationSql, /count\s*\(\s*distinct\s+[^)]*client_event_id/i);
  assert.match(migrationSql, /training_entry_ready/i);
  assert.match(migrationSql, /structural_failure_count/i);
  assert.match(migrationSql, /'train_weeks'\s*,\s*8/i);
  assert.match(migrationSql, /'validation_weeks'\s*,\s*2/i);
  assert.match(migrationSql, /'untouched_test_weeks'\s*,\s*2/i);
  assert.doesNotMatch(migrationSql, /training_entry_ready['"]?\s*,\s*false/i);
  assert.match(migrationSql, /grant execute on function public\.get_algo6_l6_training_readiness_v2\(\) to service_role/i);
});

test('same-ranker inference is dormant, local, canaryable, and manually reversible', () => {
  for (const field of [
    'l6_ml_enabled', 'l6_active_model_id', 'l6_canary_model_id',
    'l6_objective_weights', 'l6_objective_version',
  ]) assert.match(migrationSql, new RegExp(field, 'i'));
  assert.match(migrationSql, /canary_target_layer[^;]*l6/i);
  assert.match(migrationSql, /candidate_to_canary|promote_algo6_model|manage_algo6_model/i);
  assert.match(migrationSql, /rollback/i);
  assert.match(migrationSql, /single_active|where\s+status\s*=\s*'active'/i);
  assert.doesNotMatch(migrationSql, /http_|net\.http|fetch\(|edge function|inference_service/i);
});

test('deterministic trainer, pinned dependencies, and non-promoting daily workflow exist', () => {
  assert.ok(existsSync(trainerUrl));
  assert.ok(existsSync(requirementsUrl));
  assert.ok(existsSync(workflowUrl));
  assert.match(requirements, /scikit-learn==/i);
  assert.match(requirements, /numpy==/i);
  assert.match(trainer, /LogisticRegression/);
  assert.match(trainer, /CalibratedClassifier|platt|sigmoid/i);
  assert.match(trainer, /get_algo6_l6_training_readiness_v2/i);
  assert.match(trainer, /candidate/i);
  assert.doesNotMatch(trainer, /status[^\n]*active|candidate_to_active/i);
  assert.match(workflow, /schedule:/i);
  assert.match(workflow, /workflow_dispatch:/i);
  assert.match(workflow, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(workflow, /candidate_to_active|promote.*active/i);
});
