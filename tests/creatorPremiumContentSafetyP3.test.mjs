import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

const migrations = new URL('../supabase/migrations/', import.meta.url)
const matches = readdirSync(migrations)
  .filter(name => /^\d{14}_creator_premium_content_safety_p3_.*\.sql$/.test(name))
const sql = matches.length === 1
  ? readFileSync(new URL(`../supabase/migrations/${matches[0]}`, import.meta.url), 'utf8')
  : ''

function functionBody(qualifiedName) {
  const escaped = qualifiedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = sql.match(new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+${escaped}\\s*\\([^]*?\\bas\\s+\\$\\$([^]*?)\\$\\$\\s*;`,
    'i',
  ))
  return match?.[1] ?? ''
}

test('P3 is one forward-only policy refinement with a new immutable identity', () => {
  assert.equal(matches.length, 1, 'P3 must have exactly one forward-only policy-refinement migration')
  assert.match(sql, /creator-premium-context-p3-v1/i)
  assert.match(sql, /nelyon\.creator_premium\.general\.p1\.v2/i)
  assert.match(sql, /non_graphic_law_enforcement_operation/i)
  assert.match(sql, /ambiguous_weapon_or_law_enforcement_context/i)
  assert.match(sql, /non_graphic_law_enforcement_context/i)
  assert.doesNotMatch(
    sql,
    /update\s+private\.creator_premium_content_safety_context_evaluations[\s\S]{0,500}\b(?:policy_id|schema_version|prompt_version)\s*=/i,
    'P3 must append new versioned evidence, never relabel P2/v1 evidence',
  )
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

test('P3 allow ignores only visual-classifier alerts while unresolved nonvisual alerts force review', () => {
  const candidate = functionBody('private.creator_premium_content_safety_candidate_p3_v1')
  assert.match(candidate, /v_decision\s*=\s*'allow'[\s\S]*exists\s*\([\s\S]*private\.content_safety_alerts/i)
  assert.match(candidate, /alert\.scan_id\s*=\s*v_scan\.id/i)
  assert.match(candidate, /alert\.source_type\s*<>\s*'visual_classifier'/i)
  assert.match(candidate, /not\s*\(\s*alert\.status\s*=\s*'dismissed'\s+and\s+alert\.resolution\s*=\s*'no_violation'\s*\)/i)
  assert.match(candidate, /v_decision\s*:=\s*'review'/i)
  assert.doesNotMatch(
    candidate,
    /source_type\s+not\s+in\s*\([^)]*'text_rule'[^)]*'audio_transcript_rule'[^)]*'visual_classifier'/i,
    'P3 cannot inherit the broad P2 alert bypass',
  )
})

test('P3 double reconciliation leaves a published visual-only allow stable and still processes nonvisual alerts', () => {
  const reconciler = functionBody('public.reconcile_creator_premium_publications_v1')
  assert.notEqual(reconciler, '', 'P3 must replace the canonical reconciler, not add a parallel job')
  assert.match(
    reconciler,
    /content\.lifecycle_status\s*=\s*'published'[\s\S]*private\.content_safety_alerts[\s\S]*alert\.scan_id\s*=\s*scan\.id[\s\S]*alert\.source_type\s*<>\s*'visual_classifier'/i,
    'a second reconciliation must not select a published P3 allow solely for its visual classifier alert',
  )
  assert.match(
    reconciler,
    /not\s*\(\s*alert\.status\s*=\s*'dismissed'\s+and\s+alert\.resolution\s*=\s*'no_violation'\s*\)/i,
    'an unresolved nonvisual alert must remain eligible for fail-closed reconciliation',
  )
  assert.match(reconciler, /for\s+update\s+of\s+scan\s+skip\s+locked/i)
  assert.doesNotMatch(reconciler, /creator_premium_content_safety_candidate_p2_v1/i)
})

test('P3 migration stays narrow and cannot change Finance or grant client execution', () => {
  assert.notEqual(sql, '', 'P3 policy refinement migration must exist before its safety scope can pass')
  assert.doesNotMatch(sql, /\b(?:drop\s+table|truncate)\b/i)
  assert.doesNotMatch(sql, /update\s+private\.creator_premium_finance_policy/i)
  assert.doesNotMatch(sql, /insert\s+into\s+(?:public\.)?(?:financial_transactions|ledger_entries)/i)
  assert.doesNotMatch(sql, /grant\s+execute[\s\S]{0,160}\bto\s+(?:anon|authenticated)\b/i)
})
