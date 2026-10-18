// Real disposable PostgreSQL proof. Set RUN_CREATOR_PREMIUM_P1_LOCAL=1 to enable it.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const enabled = process.env.RUN_CREATOR_PREMIUM_P1_LOCAL === '1'
const container = process.env.CREATOR_PREMIUM_PG_CONTAINER || 'nelyon-ads-v2-d-compile'
const template = process.env.CREATOR_PREMIUM_PG_TEMPLATE || 'algo6_final_compile_a2'
const migrations = new URL('../supabase/migrations/', import.meta.url)
const suffixes = [
  '_creator_premium_b1_canonical_foundation.sql',
  '_creator_premium_b2_private_image_media.sql',
  '_creator_premium_b3_signed_stream_playback.sql',
  '_creator_premium_b4_atomic_finance_authority.sql',
  '_creator_premium_b4_c1_exact_fee_snapshot_binding.sql',
  '_creator_premium_b5_creator_management_ux.sql',
  '_creator_premium_b7_full_functional_commercial_completion.sql',
  '_creator_premium_c1_submission_cancellation.sql',
  '_creator_premium_c3_visual_retry_producer.sql',
  '_creator_premium_content_safety_p1_policy_gate.sql',
]
const chain = suffixes.map(suffix => {
  const found = readdirSync(migrations).filter(name => name.endsWith(suffix))
  return { suffix, found, sql: found.length === 1 ? readFileSync(new URL(`../supabase/migrations/${found[0]}`, import.meta.url), 'utf8') : '' }
})

function docker(command, { input = '', allowFailure = false } = {}) {
  const result = spawnSync('docker', ['exec', '-i', container, '/bin/sh', '-c', command], {
    encoding: 'utf8', input, maxBuffer: 96 * 1024 * 1024,
  })
  if (!allowFailure && result.status !== 0) {
    throw new Error(`docker command failed (${result.status})\n${result.stdout}\n${result.stderr}`)
  }
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() }
}

function psql(db, sql, { allowFailure = false } = {}) {
  assert.match(db, /^[a-z0-9_]+$/)
  return docker(`psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d ${db} -At -F '|'`, { input: sql, allowFailure })
}

test('P1 disposable harness binds the complete Premium chain and one P1 migration', () => {
  for (const item of chain) assert.equal(item.found.length, 1, item.suffix)
  assert.match(chain.at(-1).found[0], /^\d{14}_creator_premium_content_safety_p1_policy_gate\.sql$/)
})

test('P1 compiles and proves disabled policy, private ACL, contextual review, and normalized block', {
  skip: !enabled,
  timeout: 900_000,
}, () => {
  const db = `premium_p1_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  const actor = randomUUID()
  const content = randomUUID()
  const scan = randomUUID()
  const rule = randomUUID()
  const analysis = randomUUID()
  const media = randomUUID()
  const analysisFingerprint = 'd'.repeat(64)
  try {
    docker(`createdb -U supabase_admin -T ${template} ${db}`)
    psql(db, `
      insert into private.admin_roles(
        role_code,display_name,description,is_assignable,is_root,is_exclusive
      ) values(
        'MODERATOR','Moderator','Cross-domain safety and moderation authority.',
        true,false,false
      ) on conflict(role_code) do nothing;
      insert into private.admin_capabilities(
        capability_code,domain,effect,description,is_sensitive
      ) values(
        'content.items.moderate','content','write','Moderate content.',true
      ) on conflict(capability_code) do nothing;
      insert into private.admin_role_capabilities(role_code,capability_code)
      values
        ('SUPER_ADMIN','content.items.moderate'),
        ('MODERATOR','content.items.moderate')
      on conflict(role_code,capability_code) do nothing;
    `)
    for (const item of chain) psql(db, item.sql)

    assert.equal(psql(db, `select private.creator_premium_content_safety_policy_p1_v1()#>>'{activation,enabled}'`).stdout, 'false')
    assert.equal(psql(db, `select private.creator_premium_content_safety_policy_p1_v1()->>'artifact_sha256'`).stdout, '43da0f9039abb930aa34e09d513220713264e46b0f4187f91a769c1f9a3af52b')
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(psql(db, `select has_function_privilege('${role}','private.creator_premium_content_safety_policy_p1_v1()','execute')`).stdout, 'f')
      assert.equal(psql(db, `select has_function_privilege('${role}','private.creator_premium_content_safety_decision_p1_v1(uuid)','execute')`).stdout, 'f')
    }
    assert.equal(JSON.parse(psql(db, `select private.creator_premium_content_safety_decision_p1_v1('${randomUUID()}')`).stdout).decision, 'technical_failure')

    psql(db, `
      set session_replication_role=replica;
      insert into auth.users(id,is_anonymous) values('${actor}',false);
      insert into public.user_profiles(id,username) values('${actor}','p1_disposable_actor');
      insert into private.content_safety_scans(
        id,target_type,target_id,owner_user_id,content_fingerprint,status,requested_reason,
        text_status,audio_status,visual_status,reports_status,completed_at
      ) values(
        '${scan}','creator_premium','${content}','${actor}','${'a'.repeat(64)}',
        'completed','retry','analyzed','not_applicable','analyzed','analyzed',clock_timestamp()
      );
      insert into private.creator_premium_contents(
        id,creator_id,title,description,content_kind,access_mode,lifecycle_status,
        submitted_at,verification_scan_id,verification_fingerprint,verification_status,
        verification_requested_at
      ) values(
        '${content}','${actor}','P1 disposable','Policy gate proof','image','purchase',
        'pending_review',clock_timestamp(),'${scan}','${'a'.repeat(64)}','pending',clock_timestamp()
      );
      insert into private.content_safety_visual_analyses(
        id,source_scan_id,media_asset_id,source_content_fingerprint,provider,model,
        prompt_version,sample_strategy,frame_count,frame_timestamps_ms,analysis_result,
        analysis_fingerprint,provider_call_count
      ) values(
        '${analysis}','${scan}','${media}','${'a'.repeat(64)}','cloudflare_workers_ai',
        '@cf/google/gemma-4-26b-a4b-it','visual-safety-v1','single_image_v1',1,
        '{}'::integer[],'{}'::jsonb,'${analysisFingerprint}',1
      );
      update private.content_safety_scans set
        content_fingerprint=private.content_safety_sha256(
          'creator_premium|'||target_id::text||'|'||coalesce(
            private.content_safety_target_snapshot('creator_premium',target_id)->>'content_version',''
          )
        ),
        visual_analysis_id='${analysis}',visual_media_asset_id='${media}'
      where id='${scan}';
      update private.creator_premium_contents content set
        verification_fingerprint=scan.content_fingerprint
      from private.content_safety_scans scan
      where content.id='${content}' and scan.id='${scan}';
      update private.content_safety_visual_analyses analysis set
        source_content_fingerprint=scan.content_fingerprint
      from private.content_safety_scans scan
      where analysis.id='${analysis}' and scan.id='${scan}';
      set session_replication_role=origin;
    `)
    const pending = JSON.parse(psql(db, `select private.creator_premium_content_safety_decision_p1_v1('${scan}')`).stdout)
    assert.equal(pending.decision, 'awaiting_policy', JSON.stringify(pending))
    assert.equal(pending.policy_id, 'nelyon.creator_premium.general.p1.v1')

    // Disposable-only activation override: proves fail-closed decision branches
    // without changing the migration's production activation flag.
    psql(db, `
      create or replace function private.creator_premium_content_safety_policy_p1_v1()
      returns jsonb language sql immutable set search_path=''
      as $$select '{
        "schema_version":"nelyon.creator_premium_content_safety_policy.v1",
        "policy_id":"nelyon.creator_premium.general.p1.v1",
        "artifact_sha256":"43da0f9039abb930aa34e09d513220713264e46b0f4187f91a769c1f9a3af52b",
        "normative_approval":{"status":"approved","source":"owner_prompt","authorized_phase":"CREATOR-PREMIUM-CONTENT-SAFETY-P1","owner_bound":true},
        "scope":{"creator_premium_general":true,"explicit_adult_premium":false,"mobile_explicit_adult":false,"finance_effect":false},
        "activation":{"status":"active","enabled":true,"auto_publish_enabled":true,"blockers":[]},
        "publication":{"auto_publish_requires_all_modalities":true,"requires_current_generation":true,"requires_current_owner_and_permissions":true,"requires_provider_validity":true,"requires_active_approved_policy":true,"requires_unambiguous_allow":true,"technical_failure":"fail_closed","ambiguous_or_incomplete":"human_review","http_200_is_evidence":false},
        "finance":{"purchase_enabled":false,"subscription_enabled":false,"refunds_enabled":false,"platform_fee_bps":0}
      }'::jsonb$$;
      insert into private.content_safety_rules(
        id,code,label,category,detector_type,pattern,severity,scopes,enabled,
        created_by,updated_by,policy_source,policy_reference,policy_version,locale,
        rationale,approval_state,approved_by,approved_at
      ) values(
        '${rule}','p1_disposable_phrase','P1 disposable phrase','other','phrase',
        'medical education','medium',array['creator_premium_text'],true,
        '${actor}','${actor}','owner_manual','owner-policy-2026-10-p1','p1','und',
        'Disposable contextual review proof','approved','${actor}',clock_timestamp()
      );
      insert into private.content_safety_alerts(
        scan_id,target_type,target_id,owner_user_id,source_type,rule_id,category,severity,
        priority_score,alert_fingerprint,evidence
      ) values(
        '${scan}','creator_premium','${content}','${actor}','text_rule','${rule}',
        'other','medium',50,'${'b'.repeat(64)}','{"matched":true}'::jsonb
      );
    `)
    assert.equal(JSON.parse(psql(db, `select private.creator_premium_content_safety_decision_p1_v1('${scan}')`).stdout).decision, 'review')

    psql(db, `
      insert into private.content_safety_alerts(
        scan_id,target_type,target_id,owner_user_id,source_type,category,severity,
        confidence,priority_score,alert_fingerprint,evidence
      ) values(
        '${scan}','creator_premium','${content}','${actor}','visual_classifier',
        'child_safety','critical',0.99,100,'${'c'.repeat(64)}',
        '{"policy_id":"nelyon.creator_premium.general.p1.v1","policy_decision":"block","coverage_complete":true,"confidence_sufficient":true,"age_assessment":"resolved","consent_assessment":"resolved","policy_category":"child_sexual_exploitation","target_type":"creator_premium","target_id":"${content}","owner_user_id":"${actor}","visual_analysis_id":"${analysis}","provider":"cloudflare_workers_ai","model":"@cf/google/gemma-4-26b-a4b-it","prompt_version":"visual-safety-v1","analysis_fingerprint":"${analysisFingerprint}"}'::jsonb
      );
    `)
    assert.equal(JSON.parse(psql(db, `select private.creator_premium_content_safety_decision_p1_v1('${scan}')`).stdout).decision, 'block')

    psql(db, `
      delete from private.content_safety_alerts where scan_id='${scan}';
      insert into private.content_safety_alerts(
        scan_id,target_type,target_id,owner_user_id,source_type,category,severity,
        confidence,priority_score,alert_fingerprint,evidence
      ) values(
        '${scan}','creator_premium','${content}','${actor}','user_reports',
        'sexual','low',0.99,10,'${'e'.repeat(64)}',
        '{"policy_id":"nelyon.creator_premium.general.p1.v1","policy_decision":"block","coverage_complete":"true","confidence_sufficient":"true","age_assessment":"resolved","consent_assessment":"resolved","policy_category":"explicit_sexual_activity","visual_analysis_id":"${analysis}","analysis_fingerprint":"${analysisFingerprint}"}'::jsonb
      );
    `)
    assert.equal(JSON.parse(psql(db, `select private.creator_premium_content_safety_decision_p1_v1('${scan}')`).stdout).decision, 'review')

    psql(db, `update private.creator_premium_contents set verification_fingerprint='${'f'.repeat(64)}' where id='${content}'`)
    const stale = JSON.parse(psql(db, `select private.creator_premium_content_safety_decision_p1_v1('${scan}')`).stdout)
    assert.equal(stale.decision, 'technical_failure')
    assert.equal(stale.reason, 'creator_premium_scan_binding_invalid')
    psql(db, `update private.creator_premium_contents content set verification_fingerprint=scan.content_fingerprint from private.content_safety_scans scan where content.id='${content}' and scan.id='${scan}'`)

    for (const malformed of ['null::jsonb', `'{"decision":"unexpected"}'::jsonb`]) {
      psql(db, `
        create or replace function private.creator_premium_actor_is_age_eligible_v1(p_user_id uuid)
        returns boolean language sql stable set search_path='' as $$select true$$;
        create or replace function private.creator_premium_actor_is_operational_v1(p_user_id uuid)
        returns boolean language sql stable set search_path='' as $$select true$$;
        create or replace function private.creator_premium_content_safety_decision_p1_v1(p_scan_id uuid)
        returns jsonb language sql stable security definer set search_path=''
        as $$select ${malformed}$$;
        update private.creator_premium_contents set lifecycle_status='pending_review',
          verification_status='pending',verification_error_code=null,
          verification_completed_at=null where id='${content}';
      `)
      const invalid = JSON.parse(psql(db, `select private.finalize_creator_premium_safety_scan_v1('${scan}')`).stdout)
      assert.equal(invalid.outcome, 'failed')
      assert.equal(invalid.error, 'creator_premium_safety_decision_invalid')
      assert.equal(psql(db, `select lifecycle_status from private.creator_premium_contents where id='${content}'`).stdout, 'pending_review')
    }
  } finally {
    docker(`dropdb -U supabase_admin --if-exists ${db}`, { allowFailure: true })
  }
})
