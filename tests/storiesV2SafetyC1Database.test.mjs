import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

// Like the B1 and P3 database suites, this checks the emitted SQL contract.
// The separate disposable-PostgreSQL suite proves execution and isolation.
const migrationName = '20261027120000_stories_v2_safety_c1_technical_policy_prep.sql';
const policySha256 = '90961e8f5c4859bfdc38e851c0b5518b69e114c53896b740b30e4da491291ee4';
const migrations = new URL('../supabase/migrations/', import.meta.url);
const matches = readdirSync(migrations).filter(name => /_stories_v2_safety_c1_.*\.sql$/.test(name));
const sql = matches.includes(migrationName) ? readFileSync(new URL(migrationName, migrations), 'utf8') : '';
const artifactBytes = readFileSync(new URL('../docs/stories-v2-content-safety-policy-candidate-v1.json', import.meta.url));
const artifact = JSON.parse(artifactBytes.toString('utf8'));
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function definition(name) {
  const match = sql.match(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${escape(name)}\\s*\\([^]*?\\bas\\s+\\$\\$([^]*?)\\$\\$\\s*;`, 'i'));
  assert.ok(match, `C1 migration must define ${name}`);
  return { source: match[0], body: match[1] };
}

function embeddedJson(name, tag) {
  const { body } = definition(name);
  const match = body.match(new RegExp(`\\$${tag}\\$\\s*([^]*?)\\s*\\$${tag}\\$::jsonb`, 'i'));
  assert.ok(match, `${name} must return its inspectable JSON contract`);
  return JSON.parse(match[1]);
}

test('missing or duplicate C1 migration leaves the technical safety contract uninstalled', () => {
  assert.deepEqual(matches, [migrationName], 'ship exactly the new forward-only C1 migration');
});

test('a substituted policy artifact cannot acquire the pinned database policy identity', () => {
  // Hash the actual bytes independently, without copying a SQL hashing helper or normalizing line endings.
  assert.equal(createHash('sha256').update(artifactBytes).digest('hex'), policySha256);
  const installed = embeddedJson('private.story_content_safety_policy_c1_v1', 'policy');
  assert.equal(installed.artifact_sha256, policySha256);
  const { artifact_sha256: _digest, ...policy } = installed;
  assert.deepEqual(policy, artifact, 'the digest must identify the entire normative artifact');
});

test('technical installation cannot silently activate an owner-unapproved Story policy', () => {
  const control = embeddedJson('private.story_content_safety_control_c1_v1', 'control');
  assert.equal(control.policy_artifact_sha256, policySha256);
  assert.equal(control.activation, false);
  assert.equal(control.owner_approved_policy, false);
  assert.equal(control.auto_publish_enabled, false);
  assert.equal(control.mode, 'fail_closed_review');
  assert.equal(control.automatic_allow_authorized, false);
  assert.equal(control.automatic_block_authorized, false);
});

test('the candidate separates incomplete technical evidence from a normative review disposition', () => {
  for (const key of ['stale_generation_or_fingerprint', 'missing_required_evidence', 'provider_failure']) {
    assert.equal(artifact.decision_contract[key].technical_state, 'pending');
    assert.equal(artifact.decision_contract[key].normative_disposition, 'review_required');
  }
  assert.equal(artifact.decision_contract.provider_failure.retry, 'bounded');
  assert.equal(artifact.decision_contract.ambiguous_or_conflicting_evidence.technical_state, 'review');
  assert.equal(artifact.decision_contract.ambiguous_or_conflicting_evidence.normative_disposition, 'human_review_required');
});

test('client execution of private policy helpers cannot bypass the Story decision authority', () => {
  for (const [name, args] of [
    ['story_content_safety_policy_c1_v1', ''],
    ['story_content_safety_control_c1_v1', ''],
    ['story_content_safety_candidate_c1_v1', 'uuid'],
    ['story_author_text_bundle_c1_v1', 'uuid'],
  ]) {
    const qualified = `private.${name}`;
    assert.match(definition(qualified).source, /security\s+definer\s+set\s+search_path\s*(?:=|to)\s*''/i);
    assert.match(sql, new RegExp(`alter\\s+function\\s+${escape(qualified)}\\s*\\(\\s*${args}\\s*\\)\\s+owner\\s+to\\s+postgres`, 'i'));
    assert.match(sql, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${escape(qualified)}\\s*\\(\\s*${args}\\s*\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*service_role`, 'i'));
    assert.doesNotMatch(sql, new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${escape(qualified)}\\s*\\(`, 'i'));
  }
});

test('interactive prompts or option labels cannot evade the scanner author-text input', () => {
  const bundle = definition('private.story_author_text_bundle_c1_v1').body;
  const snapshot = definition('private.content_safety_target_snapshot').body;
  assert.match(bundle, /story_composition/i);
  assert.match(bundle, /->>\s*'text'/i);
  assert.match(bundle, /private\.story_interactive_elements/i);
  assert.match(bundle, /public_config\s*->>\s*'prompt'/i);
  assert.match(bundle, /public_config\s*->\s*'options'/i);
  assert.match(bundle, /->>\s*'label'/i);
  assert.match(bundle, /order\s+by/i, 'bundle ordering must be deterministic');
  assert.doesNotMatch(bundle, /private_answer|correct_option_id|story_interactive_responses/i, 'private quiz answers and viewer replies are separate private evidence');
  assert.match(snapshot, /'text'\s*,\s*private\.story_author_text_bundle_c1_v1\s*\(\s*p_target_id\s*\)/i);
});

test('historical fingerprints cannot claim the expanded C1 author-text evidence coverage', () => {
  const fingerprint = definition('private.story_current_fingerprint').body;
  assert.match(fingerprint, /'stories-safety-evidence-c1-v1'/);
  assert.match(fingerprint, /private\.story_author_text_bundle_c1_v1\s*\(\s*p_story_id\s*\)/i);
  for (const identity of ['user_id', 'shared_video_id', 'definition_digest', 'media_asset_links', 'video_asset_links']) {
    assert.match(fingerprint, new RegExp(`\\b${identity}\\b`, 'i'));
  }
  assert.doesNotMatch(sql.replace(/\bas\s+\$\$[^]*?\$\$\s*;/gi, ''), /update\s+private\.(?:story_safety_state|content_safety_scans)\b/i, 'historical evidence must not be relabeled during installation');
});

test('an analyzed audio transcript cannot count as complete before its current rules finish', () => {
  const sync = definition('private.story_sync_safety_from_scan_v1').body;
  assert.match(sync, /new\.audio_status\s*=\s*'not_applicable'/i);
  assert.match(sync, /new\.audio_status\s*=\s*'analyzed'[\s\S]*exists\s*\(/i);
  assert.match(sync, /private\.content_safety_audio_transcripts/i);
  assert.match(sync, /source_scan_id\s*=\s*coalesce\s*\(\s*new\.media_source_scan_id\s*,\s*new\.id\s*\)/i);
  assert.match(sync, /source_content_fingerprint\s*=\s*(?:source_scan\.)?content_fingerprint/i);
  assert.match(sync, /rule_eval_status\s*=\s*'completed'/i);
  assert.match(sync, /rule_eval_ruleset_fingerprint\s*=\s*private\.content_safety_transcript_ruleset_fingerprint\s*\(/i);
  assert.doesNotMatch(sync, /v_audio\s*:=\s*new\.audio_status\s+in\s*\(\s*'analyzed'\s*,\s*'not_applicable'\s*\)/i);
});

test('an analyzed visual flag cannot replace a current canonical analysis identity', () => {
  const sync = definition('private.story_sync_safety_from_scan_v1').body;
  assert.match(sync, /new\.visual_status\s*=\s*'not_applicable'/i);
  assert.match(sync, /new\.visual_status\s*=\s*'analyzed'[\s\S]*new\.visual_analysis_id\s+is\s+not\s+null[\s\S]*exists\s*\(/i);
  assert.match(sync, /private\.content_safety_visual_analyses/i);
  assert.match(sync, /analysis\.id\s*=\s*new\.visual_analysis_id/i);
  assert.match(sync, /analysis\.source_content_fingerprint\s*=\s*analysis_scan\.content_fingerprint/i);
  assert.match(sync, /analysis\.prompt_version\s*=\s*new\.visual_prompt_version/i);
  assert.match(sync, /analysis\.video_asset_id\s+is\s+not\s+distinct\s+from\s+new\.visual_video_asset_id/i);
  assert.match(sync, /analysis\.media_asset_id\s+is\s+not\s+distinct\s+from\s+new\.visual_media_asset_id/i);
  assert.doesNotMatch(sync, /v_visual\s*:=\s*new\.visual_status\s+in\s*\(\s*'analyzed'\s*,\s*'not_applicable'\s*\)/i);
});

test('same-identity create replay cannot reset completed audio or visual evidence', () => {
  const enqueue = definition('private.story_enqueue_media_safety_v1').body;
  const sharedEnqueue = definition('private.enqueue_content_safety_scan').body;
  for (const body of [enqueue, sharedEnqueue]) {
    // A current scan must be returned before calling the resetting enqueue core or writing modality state.
    const firstMutation = body.search(/(?:perform|:=)\s*private\.enqueue_content_safety_scan|update\s+private\.(?:content_safety_scans|story_safety_state)/i);
    const guard = body.slice(0, firstMutation < 0 ? body.length : firstMutation);
    assert.match(guard, /private\.story_safety_state/i);
    assert.match(guard, /private\.content_safety_scans/i);
    assert.match(guard, /evidence_fingerprint\s*=\s*(?:v_fingerprint|private\.story_current_fingerprint\s*\()/i);
    assert.match(guard, /content_fingerprint\s*=/i);
    assert.match(guard, /return\s+\w+\s*;/i, 'identity replay must return before evidence writes');
  }
  assert.match(sharedEnqueue, /p_requested_reason\s*<>\s*'retry'\s+and\s+v_scan_id\s+is\s+not\s+null\s+then\s+return/i,
    'an explicit bounded retry must be able to bypass replay preservation');
});

test('a fabricated passed row cannot expose a Story under an inactive or different policy', () => {
  const access = definition('private.story_can_access').body;
  assert.match(access, /s\.user_id\s*=\s*auth\.uid\s*\(/i);
  assert.match(access, /safety\.state\s*=\s*'passed'/i);
  assert.match(access, /safety\.evidence_generation\s*=\s*safety\.generation/i);
  assert.match(access, /safety\.evidence_fingerprint\s*=\s*private\.story_current_fingerprint\s*\(/i);
  assert.match(access, /private\.story_content_safety_control_c1_v1\s*\(/i);
  assert.match(access, /->>\s*'activation'/i);
  assert.match(access, /->>\s*'owner_approved_policy'/i);
  assert.match(access, /safety\.policy_digest\s*=/i);
  assert.match(access, /->>\s*'policy_artifact_sha256'/i);
});

test('completed evidence cannot become an automatic passed decision during technical prep', () => {
  const candidate = definition('private.story_content_safety_candidate_c1_v1').body;
  const sync = definition('private.story_sync_safety_from_scan_v1').body;
  assert.match(candidate, /private\.story_content_safety_control_c1_v1\s*\(/i);
  assert.match(candidate, /'review'/i);
  assert.match(candidate, /'pending'/i);
  assert.match(sync, /state\s*=\s*case\s+when\s+v_visual\s+and\s+v_audio\s+and\s+v_text\s+then\s*'review'\s+else\s*'pending'\s+end/i);
  assert.match(sync, /policy_digest\s*=\s*null/i);
  assert.match(sync, /state\.scan_id\s*=\s*new\.id/i);
  assert.match(sync, /new\.content_fingerprint\s*=\s*private\.content_safety_sha256\s*\(/i);
  const writers = sql.replace(definition('private.story_can_access').source, '').replace(/--[^\n]*/g, '');
  assert.doesNotMatch(writers, /'passed'|['"]decision['"]\s*[:,]\s*['"]allow['"]/i);
});

test('oversized images cannot enter visual work that the scanner cannot process', () => {
  const visual = definition('private.content_safety_visual_source').body;
  assert.match(visual, /size_bytes\s+between\s+1\s+and\s+10485760/i);
  assert.doesNotMatch(visual, /size_bytes\s+between\s+1\s+and\s+25000000/i);
  assert.match(visual, /duration_seconds\s*<=\s*15/i);
  assert.match(visual, /visibility\s*=\s*'private'/i);
});

test('Story preparation cannot change P3 decisions or MEDIA-C1 lifecycle authorities', () => {
  const snapshot = definition('private.content_safety_target_snapshot').body;
  const visual = definition('private.content_safety_visual_source').body;
  const enqueue = definition('private.enqueue_content_safety_scan').body;
  for (const [body, core] of [
    [snapshot, 'content_safety_target_snapshot'],
    [visual, 'content_safety_visual_source'],
    [enqueue, 'enqueue_content_safety_scan'],
  ]) {
    assert.match(body, /p_target_type\s*<>\s*'story'/i, 'non-Story inputs must delegate');
    assert.match(body, new RegExp(`private\\.${core}_(?:b1|c1)_core\\s*\\(`, 'i'));
  }
  assert.doesNotMatch(sql, /create\s+(?:or\s+replace\s+)?function\s+(?:private|public)\.(?:\w*creator_premium_content_safety\w*|\w*content_safety_context\w*|reserve_stream_upload_asset|cleanup_stale_creator_premium_video_records|schedule_video_asset_deletion_v1|story_schedule_stream_on_delete_v1|delete_story)\s*\(/i);
  assert.doesNotMatch(sql, /(?:insert\s+into|update|delete\s+from)\s+(?:private|public)\.(?:media_assets|video_assets|media_asset_links|video_asset_links|content_safety_policies)\b/i);
  assert.doesNotMatch(sql, /create\s+(?:or\s+replace\s+)?function\s+public\./i, 'C1 must add no public RPC');
});
