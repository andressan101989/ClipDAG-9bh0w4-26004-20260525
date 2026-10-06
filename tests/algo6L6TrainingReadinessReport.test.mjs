import assert from 'node:assert/strict';
import test from 'node:test';

const previousUrl = process.env.SUPABASE_URL;
const previousServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const {
  exitCodeForReadiness,
  formatTrainingReadinessReport,
  validateTrainingReadiness,
} = await import('../scripts/report-algo6-l6-training-readiness.mjs');

if (previousUrl === undefined) delete process.env.SUPABASE_URL;
else process.env.SUPABASE_URL = previousUrl;
if (previousServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceKey;

function fixture(overrides = {}) {
  return {
    contract_version: 'algo6-l6-training-readiness-v1',
    generated_at: '2026-10-06T01:00:00.000Z',
    observation_schema_version: 'organic-ranking-observation-v1',
    feature_contract_version: 'organic-ranking-features-l1-l5-v1',
    overall_status: 'NOT_READY',
    training_entry_ready: false,
    blocking_reasons: ['unique_visible_organic_impressions', 'unresolved_label_contracts'],
    global_gates: {
      unique_visible_organic_impressions: {
        current: 28, total: 28, distinct: 28, required: 250000, status: 'NOT_READY',
      },
      valid_retention_samples: { current: 28, required: 100000, status: 'NOT_READY' },
      authenticated_viewers: { current: 1, required: 2000, status: 'NOT_READY' },
      distinct_videos: { current: 7, required: 2000, status: 'NOT_READY' },
      distinct_creators: { current: 2, required: 200, status: 'NOT_READY' },
      continuous_observation_days: { current: 0, required: 84, status: 'NOT_READY' },
    },
    data_quality: {
      visible_impressions_total: 28,
      unique_impression_client_event_ids: 28,
      duplicate_impression_identities: 0,
      finalized_view_links: 28,
      unlinked_mature_impressions: 0,
      view_link_coverage_ratio: 1,
      malformed_feature_snapshots: 0,
      structural_failure_count: 0,
    },
    observation_continuity: {
      oldest_mature_impression_at: null,
      newest_mature_impression_at: null,
      observed_calendar_days: 0,
      longest_consecutive_observation_days: 0,
      required_continuous_days: 84,
      continuity_pass: false,
    },
    head_monitoring: {
      long_watch: {
        label_contract_status: 'PROVISIONAL_LABEL_CONTRACT',
        positive_source_count: 7,
        negative_source_count: 21,
        required_positive: 10000,
        required_negative: 10000,
        status: 'PROVISIONAL_LABEL_CONTRACT',
      },
      completion: {
        label_contract_status: 'PENDING_FINAL_LABEL_CONTRACT',
        true_source_count: 7,
        false_source_count: 21,
        required_positive: 10000,
        required_negative: 10000,
        status: 'PENDING_FINAL_LABEL_CONTRACT',
      },
      early_exit: {
        label_contract_status: 'PROVISIONAL_LABEL_CONTRACT',
        positive_source_count: null,
        negative_source_count: null,
        required_positive: 10000,
        required_negative: 10000,
        status: 'PROVISIONAL_LABEL_CONTRACT',
        exit_reason_distribution: { swipe: 20, background: 8, unmount: 0, unknown: 0, ended: 0 },
      },
      rewatch: {
        label_contract_status: 'PENDING_FINAL_LABEL_CONTRACT',
        positive_source_count: 0,
        required_positive: 5000,
        status: 'PENDING_FINAL_LABEL_CONTRACT',
      },
      save: {
        label_contract_status: 'PENDING_FINAL_LABEL_CONTRACT',
        external_mature_positive_count: 0,
        required_positive: 5000,
        status: 'PENDING_FINAL_LABEL_CONTRACT',
      },
      like: {
        label_contract_status: 'PENDING_FINAL_LABEL_CONTRACT',
        external_mature_positive_count: 0,
        required_positive: 5000,
        status: 'PENDING_FINAL_LABEL_CONTRACT',
      },
      follow: {
        label_contract_status: 'PENDING_FINAL_LABEL_CONTRACT',
        external_mature_event_count: 0,
        required_positive: null,
        status: 'PENDING_FINAL_LABEL_CONTRACT',
      },
      reversals: { unlike: 1, unsave: 3, unfollow: 1, label_interpretation: 'RAW_EVENTS_ONLY' },
    },
    temporal_split: {
      status: 'PROPOSED_TEMPORAL_SPLIT_V1',
      train_weeks: 8,
      validation_weeks: 2,
      untouched_test_weeks: 2,
      validation_sparse_support: { current: null, required: 500, status: 'NOT_EVALUABLE' },
      untouched_test_sparse_support: { current: null, required: 500, status: 'NOT_EVALUABLE' },
    },
    current_policy_state: {
      policy_version: 'nelyon-algo-l1-v1', canary_generation: 14, canary_enabled: false,
      canary_target_layer: 'l5', production_rollout_bps: 0, l2_affinity_enabled: false,
      l3_quality_enabled: false, l4_context_enabled: false, l5_semantic_enabled: false,
    },
    service_role_key: 'must-never-print-this-secret',
    ...overrides,
  };
}

test('module import is pure and validates the approved aggregate contract without environment access', () => {
  assert.equal(validateTrainingReadiness(fixture()).overall_status, 'NOT_READY');
});

test('formatter prints every global gate with CURRENT, REQUIRED and STATUS', () => {
  const report = formatTrainingReadinessReport(fixture());
  for (const gate of [
    'UNIQUE_VISIBLE_ORGANIC_IMPRESSIONS', 'VALID_RETENTION_SAMPLES',
    'AUTHENTICATED_VIEWERS', 'DISTINCT_VIDEOS', 'DISTINCT_CREATORS',
    'CONTINUOUS_OBSERVATION_DAYS',
  ]) assert.match(report, new RegExp(`${gate} CURRENT=.* REQUIRED=.* STATUS=`));
  assert.match(report, /VISIBLE_IMPRESSIONS_TOTAL = 28/);
  assert.match(report, /UNIQUE_IMPRESSION_CLIENT_EVENT_IDS = 28/);
  assert.match(report, /TRAINING_ENTRY_READY = false/);
});

test('formatter exposes provisional, pending and not-evaluable status without inventing readiness', () => {
  const report = formatTrainingReadinessReport(fixture());
  assert.match(report, /LONG_WATCH[\s\S]*PROVISIONAL_LABEL_CONTRACT/);
  assert.match(report, /EARLY_EXIT[\s\S]*PROVISIONAL_LABEL_CONTRACT/);
  assert.match(report, /COMPLETION[\s\S]*PENDING_FINAL_LABEL_CONTRACT/);
  assert.match(report, /VALIDATION_SPARSE_SUPPORT CURRENT=NOT_EVALUABLE REQUIRED=500 STATUS=NOT_EVALUABLE/);
  assert.match(report, /UNTOUCHED_TEST_SPARSE_SUPPORT CURRENT=NOT_EVALUABLE REQUIRED=500 STATUS=NOT_EVALUABLE/);
});

test('formatter allowlists aggregate fields and never prints injected credentials or raw identity keys', () => {
  const report = formatTrainingReadinessReport(fixture({
    service_role_key: 'super-secret-value',
    viewer_user_id: 'c1000000-0000-4000-8000-000000000001',
  }));
  assert.doesNotMatch(report, /super-secret-value|service_role_key|viewer_user_id|c1000000-/i);
});

test('healthy NOT_READY is an operator success while STRUCTURAL_FAILURE exits nonzero', () => {
  assert.equal(exitCodeForReadiness(fixture()), 0);
  const structural = fixture({
    overall_status: 'STRUCTURAL_FAILURE',
    blocking_reasons: ['structural_failure'],
    data_quality: { ...fixture().data_quality, duplicate_impression_identities: 1, structural_failure_count: 1 },
  });
  assert.equal(exitCodeForReadiness(structural), 1);
  assert.match(formatTrainingReadinessReport(structural), /OVERALL_STATUS = STRUCTURAL_FAILURE/);
});

test('malformed or unexpectedly ready responses are structural operator failures', () => {
  assert.throws(() => validateTrainingReadiness({}), /invalid training readiness response/i);
  assert.equal(exitCodeForReadiness({}), 1);
  assert.equal(exitCodeForReadiness(fixture({ training_entry_ready: true })), 1);
  assert.throws(() => formatTrainingReadinessReport(fixture({
    contract_version: 'unknown-contract',
  })), /invalid training readiness response/i);
});
