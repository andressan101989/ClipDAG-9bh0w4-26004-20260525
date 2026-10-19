import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

const migrations = new URL('../supabase/migrations/', import.meta.url)
const matches = readdirSync(migrations)
  .filter(name => /^\d{14}_creator_premium_content_safety_p3_.*\.sql$/.test(name))
const sql = matches.length === 1
  ? readFileSync(new URL(`../supabase/migrations/${matches[0]}`, import.meta.url), 'utf8')
  : ''
const policyArtifactText = readFileSync(
  new URL('../docs/creator-premium-content-safety-policy-general-v2.json', import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n')
const policyArtifact = JSON.parse(policyArtifactText)

function functionBody(qualifiedName) {
  const escaped = qualifiedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = sql.match(new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+${escaped}\\s*\\([^]*?\\bas\\s+\\$\\$([^]*?)\\$\\$\\s*;`,
    'i',
  ))
  return match?.[1] ?? ''
}

function withoutFunctionBodies(source) {
  return source.replace(/\bas\s+\$\$[^]*?\$\$\s*;/gi, '')
}

test('P3 is one forward-only policy refinement with a new immutable identity', () => {
  assert.equal(matches.length, 1, 'P3 must have exactly one forward-only policy-refinement migration')
  assert.match(sql, /creator-premium-context-p3-v1/i)
  assert.match(sql, /nelyon\.creator_premium\.general\.p1\.v2/i)
  assert.match(sql, /non_graphic_law_enforcement_operation/i)
  assert.match(sql, /non_threatening_weapon_presence/i)
  assert.match(sql, /ambiguous_weapon_or_law_enforcement_context/i)
  assert.match(sql, /non_graphic_law_enforcement_context/i)
  assert.doesNotMatch(
    sql,
    /update\s+private\.creator_premium_content_safety_context_evaluations[\s\S]{0,500}\b(?:policy_id|schema_version|prompt_version)\s*=/i,
    'P3 must append new versioned evidence, never relabel P2/v1 evidence',
  )
})

test('P3 supersedes P2 without erasing its approved matrix or seven-gate evidence', () => {
  const historicalPolicy = functionBody('private.creator_premium_content_safety_policy_p1_v1')
  assert.notEqual(historicalPolicy, '', 'the historical P2 policy function must remain available')
  assert.match(historicalPolicy, /"status"\s*:\s*"superseded"/i)
  assert.match(historicalPolicy, /"enabled"\s*:\s*false/i)
  assert.match(historicalPolicy, /"auto_publish_enabled"\s*:\s*false/i)
  assert.match(historicalPolicy, /"successor_policy_id"\s*:\s*"nelyon\.creator_premium\.general\.p1\.v2"/i)
  assert.match(historicalPolicy, /"activation_evidence_sha256"\s*:\s*"9837d584c15864d4ed34963bf050cbf2d018f601e91f49142bb4910d1c8c1f7a"/i)
  for (const gate of [
    'contextual_text_classification',
    'contextual_transcript_classification',
    'age_uncertainty_signal',
    'consent_uncertainty_signal',
    'model_confidence_contract',
    'account_quota_headroom',
    'private_media_policy_e2e',
  ]) assert.match(historicalPolicy, new RegExp(`"${gate}"\\s*:\\s*"verified"`, 'i'))
  assert.match(historicalPolicy, /"swimwear"/i)
  assert.match(historicalPolicy, /"child_sexual_exploitation"/i)
  assert.match(historicalPolicy, /"finance"\s*:\s*\{[^}]*"purchase_enabled"\s*:\s*false/i)
})

test('P3 database policy is semantically identical to the owner-approved artifact and pins its canonical Git LF SHA-256', () => {
  const policyBody = functionBody('private.creator_premium_content_safety_policy_p1_v2')
  const embeddedMatch = policyBody.match(/\$policy\$\s*([^]*?)\s*\$policy\$::jsonb/i)
  assert.ok(embeddedMatch, 'the canonical P3 policy function must embed its versioned JSON artifact')
  const embedded = JSON.parse(embeddedMatch[1])
  const expectedSha = createHash('sha256').update(policyArtifactText, 'utf8').digest('hex')
  assert.equal(embedded.artifact_sha256, expectedSha)
  const { artifact_sha256: _artifactSha, ...embeddedPolicy } = embedded
  assert.deepEqual(embeddedPolicy, policyArtifact)
  assert.match(sql, new RegExp(`policy_artifact_sha256'\\s*,\\s*'${expectedSha}'`, 'i'))
})

test('P3 decision authority accepts only evidence bound to the exact current scan fingerprint and version', () => {
  const candidate = functionBody('private.creator_premium_content_safety_candidate_p3_v1')
  const authority = functionBody('private.creator_premium_content_safety_decision_p1_v1')
  assert.notEqual(candidate, '', 'P3 must add one versioned candidate, not mutate the P2 candidate')
  assert.match(candidate, /source_scan_id\s*=\s*v_scan\.id/i)
  assert.match(candidate, /source_content_fingerprint\s*=\s*v_scan\.content_fingerprint/i)
  assert.match(candidate, /policy_id\s*=\s*'nelyon\.creator_premium\.general\.p1\.v2'/i)
  assert.match(candidate, /schema_version\s*=\s*'creator-premium-context-p3-v1'/i)
  assert.match(candidate, /prompt_version\s*=\s*'creator-premium-context-p3-v1'/i)
  assert.doesNotMatch(candidate, /nelyon\.creator_premium\.general\.p1\.v1|creator-premium-context-p2-v1/i)
  assert.match(authority, /creator_premium_content_safety_candidate_p3_v1\s*\(\s*p_scan_id\s*\)/i)
  assert.doesNotMatch(authority, /creator_premium_content_safety_candidate_p2_v1\s*\(\s*p_scan_id\s*\)/i)
})

test('P3 contextualizes only scanner text audio and visual alerts while external alerts force review', () => {
  const candidate = functionBody('private.creator_premium_content_safety_candidate_p3_v1')
  assert.match(candidate, /v_decision\s*=\s*'allow'[\s\S]*exists\s*\([\s\S]*private\.content_safety_alerts/i)
  assert.match(candidate, /alert\.scan_id\s*=\s*v_scan\.id/i)
  assert.match(
    candidate,
    /alert\.source_type\s+not\s+in\s*\(\s*'text_rule'\s*,\s*'audio_transcript_rule'\s*,\s*'visual_classifier'\s*\)/i,
  )
  assert.match(candidate, /not\s*\(\s*alert\.status\s*=\s*'dismissed'\s+and\s+alert\.resolution\s*=\s*'no_violation'\s*\)/i)
  assert.match(candidate, /v_decision\s*:=\s*'review'/i)
  assert.doesNotMatch(candidate, /alert\.source_type\s*<>\s*'visual_classifier'/i)
})

test('P3 validates visual compatibility for every ALLOW instead of trusting the model category label', () => {
  const compatibility = functionBody('private.creator_premium_content_safety_visual_allow_compatible_p3_v1')
  const candidate = functionBody('private.creator_premium_content_safety_candidate_p3_v1')
  const completion = functionBody('public.complete_creator_premium_content_safety_context_v1')
  assert.notEqual(compatibility, '')
  assert.match(compatibility, /finding->>'category'\s*=\s*'weapons'/i)
  assert.match(compatibility, /finding->>'category'\s*=\s*'sexual'/i)
  assert.match(compatibility, /finding->>'triage_level'\s+in\s*\(\s*'low'\s*,\s*'medium'\s*\)/i)
  assert.match(compatibility, /non_threatening_weapon_presence/i)
  assert.match(compatibility, /non_threatening_weapon_context/i)
  assert.match(compatibility, /finding->>'category'\s*=\s*'other'[\s\S]*non_graphic_law_enforcement_operation/i)
  assert.match(compatibility, /creator-premium-visual-safety-p3-v1/i)
  assert.match(compatibility, /analysis_result->>'weapon_disposition'/i)
  assert.match(compatibility, /visible_non_threatening/i)
  assert.match(candidate, /creator_premium_content_safety_visual_allow_compatible_p3_v1\s*\(/i)
  assert.match(completion, /creator_premium_content_safety_visual_allow_compatible_p3_v1\s*\(/i)
})

test('P3 versions only new Creator Premium visual scans while retaining bounded v1 compatibility', () => {
  const enqueue = functionBody('private.enqueue_content_safety_scan')
  const claim = functionBody('public.claim_content_safety_visual_scans')
  const complete = functionBody('public.complete_content_safety_visual_analysis')
  const attach = functionBody('private.content_safety_attach_visual_analysis')
  assert.match(sql, /creator-premium-visual-safety-p3-v1/i)
  assert.match(sql, /content_safety_scans_visual_prompt_check[\s\S]*visual-safety-v1[\s\S]*creator-premium-visual-safety-p3-v1/i)
  assert.match(sql, /content_safety_visual_analyses_prompt_check[\s\S]*visual-safety-v1[\s\S]*creator-premium-visual-safety-p3-v1/i)
  assert.match(enqueue, /p_target_type\s*=\s*'creator_premium'[\s\S]*creator-premium-visual-safety-p3-v1/i)
  assert.match(claim, /visual_prompt_version/i)
  assert.match(claim, /creator-premium-visual-safety-p3-v1/i)
  assert.match(complete, /v_scan\.visual_prompt_version/i)
  assert.match(complete, /analysis_result->>'weapon_disposition'/i)
  assert.match(attach, /scan\.visual_prompt_version\s*=\s*v_analysis\.prompt_version/i)

  const worker = readFileSync(
    new URL('../supabase/functions/content-safety-scan/index.ts', import.meta.url),
    'utf8',
  )
  assert.match(worker, /visual_prompt_version/i)
  assert.match(worker, /promptVersion:\s*String\(scan\.visual_prompt_version\)/i)
  assert.match(worker, /scan\.visual_prompt_version[^]*JSON\.stringify\(result\)/i)
})

test('P3 double reconciliation leaves contextual scanner alerts stable and still processes external alerts', () => {
  const reconciler = functionBody('public.reconcile_creator_premium_publications_v1')
  assert.notEqual(reconciler, '', 'P3 must replace the canonical reconciler, not add a parallel job')
  assert.match(
    reconciler,
    /content\.lifecycle_status\s*=\s*'published'[\s\S]*private\.content_safety_alerts[\s\S]*alert\.scan_id\s*=\s*scan\.id[\s\S]*alert\.source_type\s+not\s+in\s*\(\s*'text_rule'\s*,\s*'audio_transcript_rule'\s*,\s*'visual_classifier'\s*\)/i,
    'a second reconciliation must not select a published P3 allow solely for contextual scanner alerts',
  )
  assert.match(
    reconciler,
    /not\s*\(\s*alert\.status\s*=\s*'dismissed'\s+and\s+alert\.resolution\s*=\s*'no_violation'\s*\)/i,
    'an unresolved external alert must remain eligible for fail-closed reconciliation',
  )
  assert.match(reconciler, /for\s+update\s+of\s+scan\s+skip\s+locked/i)
  assert.doesNotMatch(reconciler, /creator_premium_content_safety_candidate_p2_v1/i)
})

test('P3 preserves only a proven exact P2 ALLOW and fails closed when published visual alerts lack authority', () => {
  const finalizer = functionBody('private.finalize_creator_premium_safety_scan_v1')
  const reconciler = functionBody('public.reconcile_creator_premium_publications_v1')
  const historicalGuard = functionBody('private.creator_premium_content_safety_historical_p2_allow_valid_p3_v1')
  assert.notEqual(historicalGuard, '')
  assert.match(historicalGuard, /nelyon\.creator_premium\.general\.p1\.v1/i)
  assert.match(historicalGuard, /creator-premium-context-p2-v1/i)
  assert.match(historicalGuard, /status\s*=\s*'completed'/i)
  assert.match(historicalGuard, /context_result->>'decision'\s+is\s+distinct\s+from\s+'allow'/i)
  assert.match(historicalGuard, /evaluation\.target_id\s*=\s*v_content\.id/i)
  assert.match(historicalGuard, /evaluation\.owner_user_id\s*=\s*v_content\.creator_id/i)
  assert.match(historicalGuard, /source_content_fingerprint\s*=\s*v_scan\.content_fingerprint/i)
  assert.match(finalizer, /published_unchanged_historical_policy/i)
  assert.match(finalizer, /creator_premium_content_safety_historical_p2_allow_valid_p3_v1\s*\(/i)
  assert.match(
    reconciler,
    /content\.lifecycle_status\s*=\s*'published'[\s\S]*creator_premium_content_safety_historical_p2_allow_valid_p3_v1\s*\(/i,
  )
  assert.match(sql, /historical_restricted_content_is_not_auto_restored/i)
  assert.doesNotMatch(
    withoutFunctionBodies(sql),
    /(?:update|insert\s+into)\s+private\.creator_premium_contents/i,
    'P3 may define future decision functions but cannot mutate historical content during migration',
  )
})

test('P3 migration stays narrow and cannot change Finance or grant client execution', () => {
  assert.notEqual(sql, '', 'P3 policy refinement migration must exist before its safety scope can pass')
  assert.doesNotMatch(sql, /\b(?:drop\s+table|truncate)\b/i)
  assert.doesNotMatch(sql, /update\s+private\.creator_premium_finance_policy/i)
  assert.doesNotMatch(sql, /insert\s+into\s+(?:public\.)?(?:financial_transactions|ledger_entries)/i)
  assert.doesNotMatch(sql, /grant\s+execute[\s\S]{0,160}\bto\s+(?:anon|authenticated)\b/i)
  assert.match(
    sql,
    /revoke\s+all\s+on\s+function\s+private\.creator_premium_content_safety_visual_allow_compatible_p3_v1\s*\(jsonb,jsonb\)[\s\S]*?from\s+public,\s*anon,\s*authenticated,\s*service_role/i,
  )
  assert.match(
    sql,
    /revoke\s+all\s+on\s+function\s+private\.creator_premium_content_safety_historical_p2_allow_valid_p3_v1\s*\(uuid\)[\s\S]*?from\s+public,\s*anon,\s*authenticated,\s*service_role/i,
  )
})
