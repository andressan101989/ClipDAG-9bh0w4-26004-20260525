import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const CONTRACT_VERSIONS = new Set([
  'algo6-l6-training-readiness-v1',
  'algo6-l6-training-readiness-v2',
]);
const GLOBAL_GATE_NAMES = [
  'unique_visible_organic_impressions',
  'valid_retention_samples',
  'authenticated_viewers',
  'distinct_videos',
  'distinct_creators',
  'continuous_observation_days',
];
const DATA_QUALITY_NAMES = [
  'visible_impressions_total',
  'unique_impression_client_event_ids',
  'duplicate_impression_identities',
  'finalized_view_links',
  'multiple_finalized_views_per_impression',
  'unlinked_mature_impressions',
  'view_link_coverage_ratio',
  'wrong_video_joins',
  'wrong_session_joins',
  'wrong_viewer_joins',
  'malformed_feature_snapshots',
  'unknown_feature_keys',
  'invalid_observation_contract_versions',
  'invalid_feature_contract_versions',
  'self_authored_engagement_rows',
  'orphan_impression_references',
  'orphan_engagement_references',
  'engagement_events_outside_attribution_window',
  'future_dated_observation_rows',
  'decision_item_count_mismatches',
  'duplicate_decision_video_memberships',
  'engagement_events_total',
  'unique_engagement_action_ids',
  'duplicate_engagement_action_ids',
  'authenticated_impressions',
  'anonymous_impressions',
  'anonymous_client_sessions',
  'mature_impressions',
  'immature_impressions',
  'self_authored_impressions',
  'structural_failure_count',
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(message) {
  throw new TypeError(`Invalid training readiness response: ${message}`);
}

export function validateTrainingReadiness(readiness) {
  if (!isRecord(readiness)) invalid('expected an object');
  if (!CONTRACT_VERSIONS.has(readiness.contract_version)) invalid('unexpected contract version');
  if (!['NOT_READY', 'STRUCTURAL_FAILURE', 'READY_FOR_TRAINING_PHASE', 'READY'].includes(readiness.overall_status)) {
    invalid('unexpected overall status');
  }
  if (typeof readiness.training_entry_ready !== 'boolean') invalid('missing training_entry_ready');
  if (!Array.isArray(readiness.blocking_reasons)) invalid('missing blocking_reasons');
  if (!isRecord(readiness.global_gates)) invalid('missing global_gates');
  for (const name of GLOBAL_GATE_NAMES) {
    const gate = readiness.global_gates[name];
    if (!isRecord(gate)) invalid(`missing global gate ${name}`);
    if (!(typeof gate.current === 'number' && Number.isFinite(gate.current))) {
      invalid(`invalid current value for ${name}`);
    }
    if (!(typeof gate.required === 'number' && Number.isFinite(gate.required))) {
      invalid(`invalid required value for ${name}`);
    }
    if (!['PASS', 'NOT_READY', 'STRUCTURAL_FAILURE'].includes(gate.status)) {
      invalid(`invalid status for ${name}`);
    }
  }
  const impressionGate = readiness.global_gates.unique_visible_organic_impressions;
  if (!(typeof impressionGate.total === 'number' && typeof impressionGate.distinct === 'number')) {
    invalid('visible impression total/distinct values are required');
  }
  if (!isRecord(readiness.data_quality)
      || typeof readiness.data_quality.structural_failure_count !== 'number') {
    invalid('missing data_quality');
  }
  if (!isRecord(readiness.observation_continuity)) invalid('missing observation_continuity');
  if (!isRecord(readiness.head_monitoring)) invalid('missing head_monitoring');
  if (!isRecord(readiness.temporal_split)) invalid('missing temporal_split');
  if (!isRecord(readiness.current_policy_state)) invalid('missing current_policy_state');
  return readiness;
}

function printable(value) {
  if (value === null || value === undefined) return 'NOT_EVALUABLE';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function gateLine(name, gate) {
  return `${name.toUpperCase()} CURRENT=${printable(gate.current)} REQUIRED=${printable(gate.required)} STATUS=${gate.status}`;
}

function headLine(name, head) {
  const current = head.positive_count
    ?? head.external_mature_positive_count
    ?? head.external_mature_event_count
    ?? head.positive_source_count
    ?? head.true_source_count
    ?? null;
  const negative = head.negative_count ?? head.negative_source_count ?? head.false_source_count;
  const currentText = negative === undefined
    ? printable(current)
    : `${printable(current)}/${printable(negative)}`;
  const requiredText = head.required_negative === undefined
    ? printable(head.required_positive)
    : `${printable(head.required_positive)}/${printable(head.required_negative)}`;
  return `${name.toUpperCase()} CURRENT=${currentText} REQUIRED=${requiredText} STATUS=${head.status} LABEL_CONTRACT=${head.label_contract_status}`;
}

export function formatTrainingReadinessReport(input) {
  const readiness = validateTrainingReadiness(input);
  const lines = [
    'ALGO-6 L6 TRAINING READINESS',
    `CONTRACT_VERSION = ${readiness.contract_version}`,
    `GENERATED_AT = ${readiness.generated_at}`,
    `OVERALL_STATUS = ${readiness.overall_status}`,
    `TRAINING_ENTRY_READY = ${readiness.training_entry_ready}`,
    `BLOCKING_REASONS = ${readiness.blocking_reasons.join(',') || 'NONE'}`,
    '',
    'GLOBAL GATES',
  ];
  for (const name of GLOBAL_GATE_NAMES) lines.push(gateLine(name, readiness.global_gates[name]));
  lines.push(
    `VISIBLE_IMPRESSIONS_TOTAL = ${readiness.global_gates.unique_visible_organic_impressions.total}`,
    `UNIQUE_IMPRESSION_CLIENT_EVENT_IDS = ${readiness.global_gates.unique_visible_organic_impressions.distinct}`,
    '',
    'HEAD MONITORING',
  );
  for (const name of ['long_watch', 'completion', 'early_exit', 'rewatch', 'save', 'like', 'follow']) {
    const head = readiness.head_monitoring[name];
    if (!isRecord(head)) invalid(`missing head ${name}`);
    lines.push(headLine(name, head));
  }
  lines.push(
    `EXIT_REASON_DISTRIBUTION = ${printable(readiness.head_monitoring.early_exit.exit_reason_distribution)}`,
    `REVERSALS = ${printable(readiness.head_monitoring.reversals)}`,
    '',
    'TEMPORAL SPLIT',
    `TEMPORAL_SPLIT_STATUS = ${readiness.temporal_split.status}`,
    formatSparseSupport('validation_sparse_support', readiness.temporal_split.validation_sparse_support),
    formatSparseSupport('untouched_test_sparse_support', readiness.temporal_split.untouched_test_sparse_support),
    '',
    'DATA QUALITY',
  );
  for (const name of DATA_QUALITY_NAMES) {
    if (Object.hasOwn(readiness.data_quality, name)) {
      lines.push(`${name.toUpperCase()} = ${printable(readiness.data_quality[name])}`);
    }
  }
  lines.push(
    '',
    'OBSERVATION CONTINUITY',
    `OLDEST_MATURE_IMPRESSION_AT = ${printable(readiness.observation_continuity.oldest_mature_impression_at)}`,
    `NEWEST_MATURE_IMPRESSION_AT = ${printable(readiness.observation_continuity.newest_mature_impression_at)}`,
    `OBSERVED_CALENDAR_DAYS = ${printable(readiness.observation_continuity.observed_calendar_days)}`,
    `LONGEST_CONSECUTIVE_OBSERVATION_DAYS = ${printable(readiness.observation_continuity.longest_consecutive_observation_days)}`,
    `REQUIRED_CONTINUOUS_DAYS = ${printable(readiness.observation_continuity.required_continuous_days)}`,
    `CONTINUITY_PASS = ${printable(readiness.observation_continuity.continuity_pass)}`,
    '',
    'CURRENT POLICY STATE',
    `POLICY_VERSION = ${printable(readiness.current_policy_state.policy_version)}`,
    `CANARY_GENERATION = ${printable(readiness.current_policy_state.canary_generation)}`,
    `CANARY_ENABLED = ${printable(readiness.current_policy_state.canary_enabled)}`,
    `PRODUCTION_ROLLOUT_BPS = ${printable(readiness.current_policy_state.production_rollout_bps)}`,
    `L2_L3_L4_L5 = ${[
      readiness.current_policy_state.l2_affinity_enabled,
      readiness.current_policy_state.l3_quality_enabled,
      readiness.current_policy_state.l4_context_enabled,
      readiness.current_policy_state.l5_semantic_enabled,
    ].map(printable).join('/')}`,
  );
  return `${lines.join('\n')}\n`;
}

function formatSparseSupport(name, support) {
  if (!isRecord(support)) invalid(`missing ${name}`);
  if (Object.hasOwn(support, 'current')) return gateLine(name, support);
  const values = ['rewatch', 'save', 'like'].map(key => Number(support[key] ?? 0));
  const current = Math.min(...values);
  const required = Number(support.required_each ?? 500);
  const status = current >= required ? 'PASS' : 'NOT_READY';
  return `${name.toUpperCase()} CURRENT=${current} REQUIRED=${required} STATUS=${status}`;
}

export function exitCodeForReadiness(input) {
  try {
    const readiness = validateTrainingReadiness(input);
    if (readiness.overall_status === 'STRUCTURAL_FAILURE') return 1;
    if (readiness.data_quality.structural_failure_count !== 0) return 1;
    if (readiness.training_entry_ready && readiness.overall_status !== 'READY_FOR_TRAINING_PHASE') return 1;
    return 0;
  } catch {
    return 1;
  }
}

async function fetchTrainingReadiness() {
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceSecret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceSecret) throw new Error('Supabase server credentials are not configured');
  const client = createClient(url, serviceSecret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.rpc('get_algo6_l6_training_readiness_v2');
  if (error) throw new Error(`Readiness RPC failed (${error.code ?? 'unknown'})`);
  return data;
}

async function main() {
  try {
    const readiness = await fetchTrainingReadiness();
    process.stdout.write(formatTrainingReadinessReport(readiness));
    process.exitCode = exitCodeForReadiness(readiness);
  } catch (error) {
    process.stderr.write(`L6 readiness structural monitoring failure: ${error.message}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) await main();
