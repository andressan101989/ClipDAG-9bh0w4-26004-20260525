// Real disposable PostgreSQL proof. Set RUN_CREATOR_PREMIUM_P3_LOCAL=1 to enable it.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const enabled = process.env.RUN_CREATOR_PREMIUM_P3_LOCAL === '1'
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
  '_creator_premium_content_safety_p2_evidence_runtime.sql',
  '_creator_premium_content_safety_p2_activation.sql',
  '_creator_premium_qa_final_f1.sql',
  '_creator_premium_f1_c4_final_recovery.sql',
  '_creator_premium_f1_c6_submit_unavailable_mapping_recovery.sql',
  '_creator_premium_content_safety_p3_contextual_violence_policy_v2.sql',
  '_creator_premium_p3_c3_safety_decision_recovery.sql',
]
const chain = suffixes.map(suffix => {
  const found = readdirSync(migrations).filter(name => name.endsWith(suffix))
  return {
    suffix,
    found,
    sql: found.length === 1
      ? readFileSync(new URL(`../supabase/migrations/${found[0]}`, import.meta.url), 'utf8')
      : '',
  }
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
  return docker(`psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d ${db} -At -F '|'`, {
    input: sql, allowFailure,
  })
}

function asRole(db, role, sql, { allowFailure = false } = {}) {
  return psql(db, `
    begin;
    set local request.jwt.claim.role='${role}';
    set local role ${role};
    ${sql};
    commit;
  `, { allowFailure })
}

function quoteSql(value) {
  return String(value).replaceAll("'", "''")
}

function imageFixtureSql({
  actor, content, scan, analysis, original, teaser, title, findings,
  generation = 1,
  promptVersion = 'creator-premium-visual-safety-p3-v1',
  weaponDisposition = findings.some(finding => finding.category === 'weapons')
    ? 'visible_non_threatening'
    : 'none',
}) {
  const analysisResult = JSON.stringify({
    schema_version: promptVersion,
    ...(promptVersion === 'creator-premium-visual-safety-p3-v1'
      ? { weapon_disposition: weaponDisposition }
      : {}),
    review_required: findings.length > 0,
    findings: findings.map(finding => ({ ...finding, frame_index: null })),
    summary: 'Synthetic non-sensitive P3 fixture.',
  })
  return `
    set session_replication_role=replica;
    insert into private.content_safety_scans(
      id,target_type,target_id,owner_user_id,content_fingerprint,status,requested_reason,
      text_status,audio_status,visual_status,reports_status,completed_at,created_at,updated_at,
      visual_provider,visual_model,visual_prompt_version,visual_source_kind
    ) values(
      '${scan}','creator_premium','${content}','${actor}','${'a'.repeat(64)}',
      'completed','retry','analyzed','not_applicable','analyzed','analyzed',clock_timestamp(),
      clock_timestamp()-interval '1 second',clock_timestamp(),
      'cloudflare_workers_ai','@cf/google/gemma-4-26b-a4b-it','${promptVersion}','eligible_image'
    );
    insert into private.creator_premium_contents(
      id,creator_id,title,description,content_kind,access_mode,lifecycle_status,
      submitted_at,verification_scan_id,verification_fingerprint,verification_status,
      verification_requested_at,verification_generation
    ) values(
      '${content}','${actor}','${quoteSql(title)}','P3 contextual violence disposable fixture',
      'image','purchase','pending_review',clock_timestamp(),'${scan}','${'a'.repeat(64)}',
      'pending',clock_timestamp(),${generation}
    );
    insert into public.media_assets(
      id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,
      mime_type,size_bytes,status,ready_at,public_url
    ) values
      ('${teaser}','${actor}','r2','image','creator_premium_teaser_image','public',
       'public-bucket','premium/${teaser}.jpg','image/jpeg',1000,'ready',clock_timestamp(),
       'https://cdn.test/${teaser}.jpg'),
      ('${original}','${actor}','r2','image','creator_premium_original_image','private',
       'private-bucket','premium/${original}.jpg','image/jpeg',2000,'ready',clock_timestamp(),null);
    insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,"position") values
      ('${teaser}','creator_premium_content','${content}','teaser',0),
      ('${original}','creator_premium_content','${content}','original',0);
    insert into private.content_safety_visual_analyses(
      id,source_scan_id,media_asset_id,source_content_fingerprint,provider,model,
      prompt_version,sample_strategy,frame_count,frame_timestamps_ms,analysis_result,
      analysis_fingerprint,provider_call_count
    ) values(
      '${analysis}','${scan}','${original}','${'a'.repeat(64)}','cloudflare_workers_ai',
      '@cf/google/gemma-4-26b-a4b-it','${promptVersion}','single_image_v1',1,
      '{}'::integer[],'${quoteSql(analysisResult)}'::jsonb,'${'d'.repeat(64)}',1
    );
    update private.content_safety_scans set
      content_fingerprint=private.content_safety_sha256(
        'creator_premium|'||target_id::text||'|'||coalesce(
          private.content_safety_target_snapshot('creator_premium',target_id)->>'content_version',''
        )
      ),
      visual_analysis_id='${analysis}',visual_media_asset_id='${original}'
    where id='${scan}';
    update private.creator_premium_contents content_row set
      verification_fingerprint=scan_row.content_fingerprint
    from private.content_safety_scans scan_row
    where content_row.id='${content}' and scan_row.id='${scan}';
    update private.content_safety_visual_analyses analysis_row set
      source_content_fingerprint=scan_row.content_fingerprint
    from private.content_safety_scans scan_row
    where analysis_row.id='${analysis}' and scan_row.id='${scan}';
    set session_replication_role=origin;
  `
}

function videoFixtureSql({
  actor, content, scan, analysis, video, transcript, teaser, title, generation = 2,
}) {
  const analysisResult = JSON.stringify({
    schema_version: 'creator-premium-visual-safety-p3-v1',
    weapon_disposition: 'visible_non_threatening',
    review_required: true,
    findings: [0, 2, 4].map(frameIndex => ({
      category: 'weapons',
      triage_level: 'low',
      description: 'Visible but non-threatening service weapon in a synthetic fixture.',
      frame_index: frameIndex,
    })),
    summary: 'Five synthetic sampled frames show no threat, force, injury, blood, or violence.',
  })
  return `
    set session_replication_role=replica;
    insert into private.content_safety_scans(
      id,target_type,target_id,owner_user_id,content_fingerprint,status,requested_reason,
      text_status,audio_status,visual_status,reports_status,completed_at,created_at,updated_at,
      visual_provider,visual_model,visual_prompt_version,visual_source_kind
    ) values(
      '${scan}','creator_premium','${content}','${actor}','${'a'.repeat(64)}',
      'completed','retry','analyzed','analyzed','analyzed','analyzed',clock_timestamp(),
      clock_timestamp()-interval '1 second',clock_timestamp(),
      'cloudflare_workers_ai','@cf/google/gemma-4-26b-a4b-it',
      'creator-premium-visual-safety-p3-v1','eligible_stream_video'
    );
    insert into private.creator_premium_contents(
      id,creator_id,title,description,content_kind,access_mode,lifecycle_status,
      submitted_at,verification_scan_id,verification_fingerprint,verification_status,
      verification_requested_at,verification_generation
    ) values(
      '${content}','${actor}','${quoteSql(title)}','P3 generation two video fixture',
      'video','purchase','pending_review',clock_timestamp(),'${scan}','${'a'.repeat(64)}',
      'pending',clock_timestamp(),${generation}
    );
    insert into public.media_assets(
      id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,
      mime_type,size_bytes,status,ready_at,public_url
    ) values(
      '${teaser}','${actor}','r2','image','creator_premium_teaser_image','public',
      'public-bucket','premium/${teaser}.jpg','image/jpeg',1000,'ready',clock_timestamp(),
      'https://cdn.test/${teaser}.jpg'
    );
    insert into public.video_assets(
      id,owner_id,provider,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes,
      max_duration_seconds,duration_seconds,ready_at,provider_metadata,hls_url,dash_url,
      thumbnail_url
    ) values(
      '${video}','${actor}','cloudflare_stream','creator_premium_video','private','ready',
      'premium-${video}','video/mp4',2000000,180,90,clock_timestamp(),
      '{"require_signed_urls":true}'::jsonb,null,null,null
    );
    insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,"position") values
      ('${teaser}','creator_premium_content','${content}','teaser',0);
    insert into public.video_asset_links(
      asset_id,owner_id,entity_type,entity_id,slot,"position"
    ) values(
      '${video}','${actor}','creator_premium_content','${content}','original',0
    );
    insert into private.content_safety_visual_analyses(
      id,source_scan_id,video_asset_id,source_content_fingerprint,provider,model,
      prompt_version,sample_strategy,frame_count,frame_timestamps_ms,analysis_result,
      analysis_fingerprint,provider_call_count
    ) values(
      '${analysis}','${scan}','${video}','${'a'.repeat(64)}','cloudflare_workers_ai',
      '@cf/google/gemma-4-26b-a4b-it','creator-premium-visual-safety-p3-v1',
      'percentile_5_v1',5,array[0,22500,45000,67500,90000]::integer[],
      '${quoteSql(analysisResult)}'::jsonb,'${'d'.repeat(64)}',5
    );
    insert into private.content_safety_audio_transcripts(
      id,source_scan_id,source_asset_id,source_content_fingerprint,provider,model,
      detected_language,transcript_text,word_count,segments,no_speech,
      transcript_fingerprint,rule_eval_status,rule_eval_attempt_count,
      rule_eval_ruleset_fingerprint,rule_eval_completed_at,created_at,updated_at
    ) values(
      '${transcript}','${scan}','${video}','${'a'.repeat(64)}','cloudflare_workers_ai',
      '@cf/openai/whisper-large-v3-turbo','es',
      'Operativo pacifico sin amenaza fuerza sangre lesion ni violencia.',9,'[]'::jsonb,false,
      '${'e'.repeat(64)}','completed',1,'${'f'.repeat(64)}',clock_timestamp(),
      clock_timestamp()-interval '1 second',clock_timestamp()
    );
    update private.content_safety_scans set
      content_fingerprint=private.content_safety_sha256(
        'creator_premium|'||target_id::text||'|'||coalesce(
          private.content_safety_target_snapshot('creator_premium',target_id)->>'content_version',''
        )
      ),
      visual_analysis_id='${analysis}',visual_video_asset_id='${video}',
      audio_source_asset_id='${video}'
    where id='${scan}';
    update private.creator_premium_contents content_row set
      verification_fingerprint=scan_row.content_fingerprint
    from private.content_safety_scans scan_row
    where content_row.id='${content}' and scan_row.id='${scan}';
    update private.content_safety_visual_analyses analysis_row set
      source_content_fingerprint=scan_row.content_fingerprint
    from private.content_safety_scans scan_row
    where analysis_row.id='${analysis}' and scan_row.id='${scan}';
    update private.content_safety_audio_transcripts transcript_row set
      source_content_fingerprint=scan_row.content_fingerprint
    from private.content_safety_scans scan_row
    where transcript_row.id='${transcript}' and scan_row.id='${scan}';
    set session_replication_role=origin;
  `
}

function addActiveOffer(db, actor, fixture) {
  psql(db, `
    insert into private.creator_premium_offer_versions(
      id,content_id,creator_id,version,price_bdag,currency,status,activated_at
    ) values(
      '${fixture.offer}','${fixture.content}','${actor}',1,10,'BDAG','active',clock_timestamp()
    );
    update private.content_safety_scans set
      content_fingerprint=private.content_safety_sha256(
        'creator_premium|'||target_id::text||'|'||coalesce(
          private.content_safety_target_snapshot('creator_premium',target_id)->>'content_version',''
        )
      )
    where id='${fixture.scan}';
    update private.creator_premium_contents content_row set
      verification_fingerprint=scan_row.content_fingerprint
    from private.content_safety_scans scan_row
    where content_row.id='${fixture.content}' and scan_row.id='${fixture.scan}';
    update private.content_safety_visual_analyses analysis_row set
      source_content_fingerprint=scan_row.content_fingerprint
    from private.content_safety_scans scan_row
    where analysis_row.id='${fixture.analysis}' and scan_row.id='${fixture.scan}';
    update private.content_safety_audio_transcripts transcript_row set
      source_content_fingerprint=scan_row.content_fingerprint
    from private.content_safety_scans scan_row
    where transcript_row.source_scan_id='${fixture.scan}' and scan_row.id='${fixture.scan}';
  `)
}

function p3ContextResult({ transcript = 'not_applicable' } = {}) {
  return JSON.stringify({
    schema_version: 'creator-premium-context-p3-v1',
    policy_id: 'nelyon.creator_premium.general.p1.v2',
    decision: 'allow',
    categories: [
      'non_graphic_law_enforcement_operation',
      'non_threatening_weapon_presence',
    ],
    coverage: { text: 'complete', transcript, visual: 'complete' },
    uncertainty: 'unambiguous',
    age_uncertainty: 'not_relevant',
    consent_uncertainty: 'not_relevant',
    weapon_state: 'visible_non_threatening',
    law_enforcement_state: 'routine_peaceful',
    violence_state: 'none_observed',
    certainty_basis: 'discrete_contract',
    rationale_codes: [
      'non_graphic_law_enforcement_context',
      'non_threatening_weapon_context',
    ],
  })
}

function p3CanonicalizedWeaponAllowResult({ transcript = 'complete' } = {}) {
  const result = JSON.parse(p3ContextResult({ transcript }))
  result.categories = ['entertainment', 'non_threatening_weapon_presence']
  result.law_enforcement_state = 'not_observed'
  result.rationale_codes = ['benign_context', 'non_threatening_weapon_context']
  return JSON.stringify(result)
}

function p2ContextResult() {
  return JSON.stringify({
    schema_version: 'creator-premium-context-p2-v1',
    policy_id: 'nelyon.creator_premium.general.p1.v1',
    decision: 'allow',
    categories: ['education'],
    coverage: { text: 'complete', transcript: 'not_applicable', visual: 'complete' },
    uncertainty: 'unambiguous',
    age_uncertainty: 'not_relevant',
    consent_uncertainty: 'not_relevant',
    certainty_basis: 'discrete_contract',
    rationale_codes: ['educational_context'],
  })
}

function p3ReviewResult() {
  return JSON.stringify({
    schema_version: 'creator-premium-context-p3-v1',
    policy_id: 'nelyon.creator_premium.general.p1.v2',
    decision: 'review',
    categories: ['ambiguous_weapon_or_law_enforcement_context'],
    coverage: { text: 'complete', transcript: 'not_applicable', visual: 'complete' },
    uncertainty: 'ambiguous',
    age_uncertainty: 'not_relevant',
    consent_uncertainty: 'not_relevant',
    weapon_state: 'visible_non_threatening',
    law_enforcement_state: 'routine_peaceful',
    violence_state: 'none_observed',
    certainty_basis: 'discrete_contract',
    rationale_codes: ['ambiguous_context'],
  })
}

function claimP3(db) {
  const claims = JSON.parse(asRole(
    db, 'service_role',
    `select public.claim_creator_premium_content_safety_context_v1(
      1,'content-safety-scan-p3-v1'
    )`,
  ).stdout)
  const diagnostics = claims.length === 1 ? '' : psql(db, `
    select pg_catalog.jsonb_build_object(
      'scan_id',scan.id,'status',scan.status,'text',scan.text_status,
      'reports',scan.reports_status,'visual',scan.visual_status,
      'visual_prompt',scan.visual_prompt_version,
      'source_kind',scan.visual_source_kind,
      'analysis_prompt',analysis.prompt_version,
      'analysis_schema',analysis.analysis_result->>'schema_version',
      'analysis_result',analysis.analysis_result,
      'analysis_valid',private.content_safety_visual_result_valid_for_prompt(
        analysis.analysis_result,analysis.prompt_version,
        scan.visual_source_kind,null,analysis.frame_count
      ),
      'lifecycle',content.lifecycle_status,
      'scan_binding',content.verification_scan_id=scan.id,
      'fingerprint_binding',content.verification_fingerprint=scan.content_fingerprint
    )
    from private.content_safety_scans scan
    join private.creator_premium_contents content on content.id=scan.target_id
    join private.content_safety_visual_analyses analysis on analysis.id=scan.visual_analysis_id
    where scan.target_type='creator_premium'
    order by scan.created_at desc limit 1
  `).stdout
  assert.equal(claims.length, 1, `${JSON.stringify(claims)} ${diagnostics}`)
  assert.equal(claims[0].policy_id, 'nelyon.creator_premium.general.p1.v2')
  assert.equal(claims[0].schema_version, 'creator-premium-context-p3-v1')
  assert.equal(claims[0].prompt_version, 'creator-premium-context-p3-v1')
  return claims[0]
}

function completeP3(db, claim, result) {
  return JSON.parse(asRole(db, 'service_role', `
    select public.complete_creator_premium_content_safety_context_v1(
      '${claim.scan_id}','${claim.content_fingerprint}',${claim.attempt_count},
      '${quoteSql(result)}'::jsonb,'content-safety-scan-p3-v1'
    )
  `).stdout)
}

function insertContextEvaluation(db, fixture, {
  policyId,
  schemaVersion,
  promptVersion,
  status = 'pending',
  result = null,
}) {
  const terminal = status === 'completed'
  psql(db, `
    insert into private.creator_premium_content_safety_context_evaluations(
      source_scan_id,target_id,owner_user_id,source_content_fingerprint,
      policy_id,schema_version,prompt_version,transcript_coverage,
      visual_analysis_id,visual_analysis_fingerprint,status,attempt_count,
      provider_call_count,completed_at,context_result,evaluation_fingerprint,
      created_at,updated_at
    )
    select
      scan.id,content.id,content.creator_id,scan.content_fingerprint,
      '${policyId}','${schemaVersion}','${promptVersion}','not_applicable',
      analysis.id,analysis.analysis_fingerprint,'${status}',${terminal ? 1 : 0},
      ${terminal ? 1 : 0},${terminal ? 'clock_timestamp()' : 'null'},
      ${terminal ? `'${quoteSql(result)}'::jsonb` : 'null'},
      ${terminal ? `'${'e'.repeat(64)}'` : 'null'},
      clock_timestamp()-interval '1 second',clock_timestamp()
    from private.content_safety_scans scan
    join private.creator_premium_contents content on content.id=scan.target_id
    join private.content_safety_visual_analyses analysis on analysis.id=scan.visual_analysis_id
    where scan.id='${fixture.scan}'
  `)
  if (terminal && policyId === 'nelyon.creator_premium.general.p1.v1') {
    psql(db, `
      update private.creator_premium_content_safety_context_evaluations evaluation set
        evaluation_fingerprint=private.content_safety_sha256(
          evaluation.source_scan_id::text||'|'||
          evaluation.source_content_fingerprint||'|'||
          evaluation.policy_id||'|'||evaluation.provider||'|'||
          evaluation.model||'|'||evaluation.prompt_version||'|'||
          evaluation.transcript_coverage||'|'||
          coalesce(evaluation.transcript_id::text,'')||'|'||
          coalesce(evaluation.transcript_fingerprint,'')||'|'||
          evaluation.visual_analysis_id::text||'|'||
          evaluation.visual_analysis_fingerprint||'|'||
          evaluation.context_result::text
        )
      where evaluation.source_scan_id='${fixture.scan}'
        and evaluation.policy_id='nelyon.creator_premium.general.p1.v1'
    `)
  }
}

function addAlert(db, actor, fixture, { sourceType, category, fingerprint, ruleId = null }) {
  psql(db, `
    insert into private.content_safety_alerts(
      scan_id,target_type,target_id,owner_user_id,source_type,rule_id,category,severity,
      confidence,priority_score,alert_fingerprint,evidence
    ) values(
      '${fixture.scan}','creator_premium','${fixture.content}','${actor}',
      '${sourceType}',${ruleId ? `'${ruleId}'` : 'null'},'${category}','medium',0.85,60,'${fingerprint}',
      '${sourceType === 'audio_transcript_rule'
        ? `{"fixture":"synthetic_p3","transcript_id":"${randomUUID()}"}`
        : '{"fixture":"synthetic_p3"}'}'::jsonb
    )
  `)
}

test('P3 disposable harness binds the contextual policy and one focal P3-C3 recovery migration', () => {
  for (const item of chain) assert.equal(item.found.length, 1, item.suffix)
  assert.match(
    chain.at(-2).found[0],
    /^\d{14}_creator_premium_content_safety_p3_contextual_violence_policy_v2\.sql$/,
  )
  assert.match(
    chain.at(-1).found[0],
    /^\d{14}_creator_premium_p3_c3_safety_decision_recovery\.sql$/,
  )
})

test('P3 disposable runtime preserves version identity, publishes contextual scanner allow, and fails closed on external or P2-only evidence', {
  skip: !enabled,
  timeout: 900_000,
}, () => {
  const db = `premium_p3_${randomUUID().replaceAll('-', '').slice(0, 8)}`
  const actor = randomUUID()
    const contextualRule = randomUUID()
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
    for (const item of chain.slice(0, -1)) psql(db, item.sql)
    const validatorOwnerBefore = psql(db, `
      select pg_catalog.pg_get_userbyid(proc.proowner)
      from pg_catalog.pg_proc proc
      where proc.oid=
        'private.creator_premium_content_safety_context_result_valid_p3_v1(jsonb,text)'::regprocedure
    `).stdout
    psql(db, chain.at(-1).sql)

    assert.equal(
      psql(db, `
        select relrowsecurity::text||'|'||relforcerowsecurity::text
        from pg_catalog.pg_class
        where oid='private.creator_premium_content_safety_context_evaluations'::regclass
      `).stdout,
      'true|true',
    )
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(psql(db, `
        select has_table_privilege(
          '${role}','private.creator_premium_content_safety_context_evaluations','select'
        )
      `).stdout, 'f')
    }
    assert.equal(psql(db, `
      select has_function_privilege(
        'service_role','public.claim_creator_premium_content_safety_context_v1(integer)','execute'
      )
    `).stdout, 't')
    assert.equal(psql(db, `
      select has_function_privilege(
        'authenticated','public.claim_creator_premium_content_safety_context_v1(integer)','execute'
      )
    `).stdout, 'f')
    for (const signature of [
      'public.claim_content_safety_visual_scans(integer,text)',
      'public.claim_creator_premium_content_safety_context_v1(integer,text)',
      'public.complete_creator_premium_content_safety_context_v1(uuid,text,integer,jsonb,text)',
      'public.fail_creator_premium_content_safety_context_v1(uuid,text,integer,text,boolean,boolean,text)',
    ]) {
      assert.equal(psql(db, `
        select has_function_privilege('service_role','${signature}','execute')
      `).stdout, 't', `service_role:${signature}`)
      assert.equal(psql(db, `
        select has_function_privilege('authenticated','${signature}','execute')
      `).stdout, 'f', `authenticated:${signature}`)
    }
    for (const signature of [
      'private.content_safety_visual_analysis_id_for_asset(uuid,uuid,text)',
      'private.content_safety_visual_producer_scan_id(uuid,uuid,text)',
      'private.creator_premium_content_safety_context_result_valid_p3_v1(jsonb,text)',
      'private.creator_premium_content_safety_visual_allow_compatible_p3_v1(jsonb,jsonb)',
      'private.creator_premium_content_safety_historical_p2_allow_valid_p3_v1(uuid)',
    ]) {
      for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
        assert.equal(psql(db, `
          select has_function_privilege('${role}','${signature}','execute')
        `).stdout, 'f', `${role}:${signature}`)
      }
    }
    assert.equal(psql(db, `
      select pg_catalog.pg_get_userbyid(proc.proowner)||'|'||
        proc.prosecdef::text||'|'||proc.provolatile::text||'|'||
        coalesce(pg_catalog.array_to_string(proc.proconfig,','),'')
      from pg_catalog.pg_proc proc
      where proc.oid=
        'private.creator_premium_content_safety_context_result_valid_p3_v1(jsonb,text)'::regprocedure
    `).stdout, `${validatorOwnerBefore}|false|i|search_path=""`)
    for (const role of ['postgres', 'supabase_admin']) {
      assert.equal(psql(db, `
        select has_function_privilege(
          '${role}',
          'private.creator_premium_content_safety_context_result_valid_p3_v1(jsonb,text)',
          'execute'
        )
      `).stdout, 't', `${role}:private validator execute`)
    }

    for (const path of [
      ['schema_version'], ['policy_id'], ['decision'], ['uncertainty'],
      ['age_uncertainty'], ['consent_uncertainty'], ['certainty_basis'],
      ['weapon_state'], ['law_enforcement_state'], ['violence_state'],
      ['coverage', 'text'], ['coverage', 'transcript'], ['coverage', 'visual'],
    ]) {
      const invalid = JSON.parse(p3ContextResult())
      if (path.length === 1) invalid[path[0]] = null
      else invalid[path[0]][path[1]] = null
      assert.equal(psql(db, `
        select private.creator_premium_content_safety_context_result_valid_p3_v1(
          '${quoteSql(JSON.stringify(invalid))}'::jsonb,'not_applicable'
        )
      `).stdout, 'f', `JSON null must fail at ${path.join('.')}`)
    }
    assert.equal(psql(db, `
      select private.creator_premium_content_safety_visual_allow_compatible_p3_v1(
        '${quoteSql(p3ContextResult())}'::jsonb,
        '{"findings":[{"category":null,"triage_level":null}]}'::jsonb
      )
    `).stdout, 'f', 'JSON-null visual finding fields must fail closed')
    const threateningAllow = JSON.parse(p3ContextResult())
    threateningAllow.weapon_state = 'pointed_brandished_fired_or_threatening'
    threateningAllow.law_enforcement_state = 'force_or_confrontation'
    assert.equal(psql(db, `
      select private.creator_premium_content_safety_context_result_valid_p3_v1(
        '${quoteSql(JSON.stringify(threateningAllow))}'::jsonb,'not_applicable'
      )
    `).stdout, 'f', 'a threatening weapon signal can never validate as ALLOW')
    const contradictoryResults = [
      {
        ...JSON.parse(p3ContextResult()),
        categories: ['education'],
        weapon_state: 'not_observed',
        law_enforcement_state: 'not_observed',
        rationale_codes: ['violent_threat_context'],
      },
      {
        ...JSON.parse(p3ContextResult()),
        categories: ['education'],
        weapon_state: 'not_observed',
        law_enforcement_state: 'not_observed',
        rationale_codes: ['contradictory_signals'],
      },
      {
        ...JSON.parse(p3ContextResult()),
        decision: 'review',
        categories: ['documentary_violence'],
        uncertainty: 'ambiguous',
        weapon_state: 'not_observed',
        law_enforcement_state: 'not_observed',
        violence_state: 'graphic_or_severe',
        rationale_codes: ['visual_review_signal'],
      },
      {
        ...JSON.parse(p3ContextResult()),
        decision: 'block',
        categories: ['graphic_serious_assault'],
        weapon_state: 'not_observed',
        law_enforcement_state: 'not_observed',
        violence_state: 'graphic_or_severe',
        rationale_codes: ['benign_context'],
      },
    ]
    for (const invalid of contradictoryResults) {
      assert.equal(psql(db, `
        select private.creator_premium_content_safety_context_result_valid_p3_v1(
          '${quoteSql(JSON.stringify(invalid))}'::jsonb,'not_applicable'
        )
      `).stdout, 'f', `contradictory provider output must fail closed: ${JSON.stringify(invalid)}`)
    }
    assert.equal(psql(db, `
      select private.creator_premium_content_safety_context_result_valid_p3_v1(
        '${quoteSql(p3ReviewResult())}'::jsonb,'not_applicable'
      )
    `).stdout, 't', 'REVIEW may preserve independent safe observable states without ALLOW labels')
    const independentBlock = JSON.parse(p3ReviewResult())
    independentBlock.decision = 'block'
    independentBlock.categories = ['graphic_serious_assault']
    independentBlock.uncertainty = 'unambiguous'
    independentBlock.violence_state = 'graphic_or_severe'
    independentBlock.rationale_codes = ['severe_explicit_context']
    assert.equal(psql(db, `
      select private.creator_premium_content_safety_context_result_valid_p3_v1(
        '${quoteSql(JSON.stringify(independentBlock))}'::jsonb,'not_applicable'
      )
    `).stdout, 't', 'BLOCK may preserve unrelated bounded weapon and police observations')

    assert.equal(
      psql(db, `
        select (private.creator_premium_content_safety_policy_p1_v1()#>>'{activation,status}')
          ||'|'||(private.creator_premium_content_safety_policy_p1_v1()#>>'{activation,enabled}')
          ||'|'||(private.creator_premium_content_safety_policy_p1_v1()#>>'{activation,auto_publish_enabled}')
      `).stdout,
      'superseded|false|false',
    )
    assert.deepEqual(
      JSON.parse(psql(db, `
        select private.creator_premium_content_safety_policy_p1_v1()#>'{activation,gates}'
      `).stdout),
      {
        contextual_text_classification: 'verified',
        contextual_transcript_classification: 'verified',
        age_uncertainty_signal: 'verified',
        consent_uncertainty_signal: 'verified',
        model_confidence_contract: 'verified',
        account_quota_headroom: 'verified',
        private_media_policy_e2e: 'verified',
      },
      'P3 must preserve all seven verified P2 evidence gates in historical policy metadata',
    )
    assert.equal(
      psql(db, `
        select (private.creator_premium_content_safety_policy_p1_v2()#>>'{activation,status}')
          ||'|'||(private.creator_premium_content_safety_policy_p1_v2()#>>'{activation,enabled}')
          ||'|'||(private.creator_premium_content_safety_policy_p1_v2()#>>'{activation,auto_publish_enabled}')
      `).stdout,
      'active|true|true',
    )

    psql(db, `
      set session_replication_role=replica;
      insert into auth.users(id,is_anonymous) values('${actor}',false);
      insert into public.user_profiles(id,username) values('${actor}','p3_disposable_actor');
      insert into private.user_age_eligibility(
        user_id,status,minimum_age,policy_version,evaluated_at,source,age_band,birth_date
      )
      select '${actor}','eligible',policy.minimum_age,policy.policy_version,
             clock_timestamp(),'signup_metadata','age_18_plus',current_date-interval '30 years'
      from private.age_eligibility_policy policy where policy.singleton=true;
      set session_replication_role=origin;
      insert into private.content_safety_rules(
        id,code,label,category,detector_type,pattern,severity,scopes,enabled,
        created_by,updated_by,policy_source,policy_reference,policy_version,locale,
        rationale,approval_state,approved_by,approved_at
      ) values(
        '${contextualRule}','p3_contextual_fixture','P3 contextual fixture','weapons',
        'phrase','synthetic contextual evidence','medium',
        array['creator_premium_text','transcript'],true,'${actor}','${actor}',
        'owner_manual','owner-policy-2026-10-p3','p3','und',
        'Synthetic disposable proof for contextual scanner alert handling.',
        'approved','${actor}',clock_timestamp()
      );
    `)

    const visualFailure = {
      content: randomUUID(), scan: randomUUID(), analysis: randomUUID(),
      original: randomUUID(), teaser: randomUUID(), offer: randomUUID(),
      legacyScan: randomUUID(),
    }
    psql(db, imageFixtureSql({
      actor,
      ...visualFailure,
      title: 'P3 exact-version visual failure fixture',
      findings: [],
    }))
    psql(db, `
      update private.content_safety_scans set
        status='processing',visual_status='pending',visual_analysis_id=null,
        visual_attempt_count=0,visual_provider_call_count=0,
        visual_started_at=null,visual_completed_at=null,
        visual_frame_cursor=0,visual_partial_result=null,
        visual_available_at=clock_timestamp(),visual_last_error_code=null
      where id='${visualFailure.scan}';
      delete from private.content_safety_visual_analyses
      where id='${visualFailure.analysis}';
    `)
    assert.equal(psql(db, `
      select private.content_safety_visual_producer_scan_id(
        null,'${visualFailure.original}','creator-premium-visual-safety-p3-v1'
      )='${visualFailure.scan}'
    `).stdout, 't')
    assert.deepEqual(JSON.parse(asRole(
      db, 'service_role',
      'select public.claim_content_safety_visual_scans(1)',
    ).stdout), [], 'the legacy worker must not claim P3 visual work during migration-first rollout')
    const p3VisualClaims = JSON.parse(asRole(db, 'service_role', `
      select public.claim_content_safety_visual_scans(
        1,'content-safety-scan-p3-v1'
      )
    `).stdout)
    assert.equal(p3VisualClaims.length, 1)
    assert.equal(p3VisualClaims[0].scan_id, visualFailure.scan)
    assert.equal(
      p3VisualClaims[0].visual_prompt_version,
      'creator-premium-visual-safety-p3-v1',
    )
    const retryFailure = JSON.parse(asRole(db, 'service_role', `
      select public.fail_content_safety_visual_scan(
        '${visualFailure.scan}','visual_provider_timeout',true,true
      )
    `).stdout)
    assert.equal(retryFailure.visual_status, 'pending')
    assert.equal(retryFailure.retryable, true)
    assert.equal(retryFailure.provider_call_count, 1)
    assert.equal(psql(db, `
      select visual_status||'|'||visual_provider_call_count::text||'|'||visual_last_error_code
      from private.content_safety_scans where id='${visualFailure.scan}'
    `).stdout, 'pending|1|visual_provider_timeout')

    psql(db, `
      insert into private.content_safety_scans(
        id,target_type,target_id,owner_user_id,content_fingerprint,status,requested_reason,
        text_status,audio_status,visual_status,reports_status,created_at,updated_at,
        visual_provider,visual_model,visual_prompt_version,visual_source_kind,
        visual_media_asset_id,visual_attempt_count,visual_provider_call_count,
        visual_frame_cursor,visual_available_at
      )
      select
        '${visualFailure.legacyScan}',target_type,target_id,owner_user_id,
        '${'d'.repeat(64)}','processing','retry',text_status,audio_status,'pending',
        reports_status,clock_timestamp()-interval '1 second',clock_timestamp(),
        visual_provider,visual_model,'visual-safety-v1',visual_source_kind,
        visual_media_asset_id,1,0,0,clock_timestamp()
      from private.content_safety_scans where id='${visualFailure.scan}';
      update private.content_safety_scans set
        visual_status='pending',visual_attempt_count=5,
        visual_started_at=clock_timestamp(),visual_completed_at=null
      where id='${visualFailure.scan}'
    `)
    const terminalFailure = JSON.parse(asRole(db, 'service_role', `
      select public.fail_content_safety_visual_scan(
        '${visualFailure.scan}','visual_provider_exhausted',true,true
      )
    `).stdout)
    assert.equal(terminalFailure.visual_status, 'failed')
    assert.equal(terminalFailure.retryable, false)
    assert.equal(terminalFailure.provider_call_count, 2)
    assert.equal(psql(db, `
      select visual_status||'|'||visual_provider_call_count::text||'|'||visual_last_error_code
      from private.content_safety_scans where id='${visualFailure.scan}'
    `).stdout, 'failed|2|visual_provider_exhausted')
    assert.equal(psql(db, `
      select visual_status||'|'||visual_provider_call_count::text||'|'||
        coalesce(visual_last_error_code,'none')
      from private.content_safety_scans where id='${visualFailure.legacyScan}'
    `).stdout, 'pending|0|none', 'P3 failure must not contaminate a v1 sibling')

    const p2InFlight = {
      content: randomUUID(), scan: randomUUID(), analysis: randomUUID(),
      original: randomUUID(), teaser: randomUUID(), offer: randomUUID(),
    }
    psql(db, imageFixtureSql({
      actor,
      ...p2InFlight,
      title: 'P2 in-flight rollout completion fixture',
      findings: [],
      promptVersion: 'visual-safety-v1',
    }))
    insertContextEvaluation(db, p2InFlight, {
      policyId: 'nelyon.creator_premium.general.p1.v1',
      schemaVersion: 'creator-premium-context-p2-v1',
      promptVersion: 'creator-premium-context-p2-v1',
    })
    psql(db, `
      update private.creator_premium_content_safety_context_evaluations set
        status='processing',attempt_count=1,started_at=clock_timestamp()
      where source_scan_id='${p2InFlight.scan}'
        and policy_id='nelyon.creator_premium.general.p1.v1'
    `)
    const p2InFlightFingerprint = psql(db, `
      select content_fingerprint from private.content_safety_scans
      where id='${p2InFlight.scan}'
    `).stdout
    const completedP2InFlight = JSON.parse(asRole(db, 'service_role', `
      select public.complete_creator_premium_content_safety_context_v1(
        '${p2InFlight.scan}','${p2InFlightFingerprint}',1,
        '${quoteSql(p2ContextResult())}'::jsonb
      )
    `).stdout)
    assert.equal(completedP2InFlight.context_status, 'completed')
    assert.equal(psql(db, `
      select lifecycle_status||'|'||verification_status
      from private.creator_premium_contents where id='${p2InFlight.content}'
    `).stdout, 'pending_review|pending',
    'finishing in-flight P2 evidence after migration must not publish or reclassify it')

    const p2FailedInFlight = {
      content: randomUUID(), scan: randomUUID(), analysis: randomUUID(),
      original: randomUUID(), teaser: randomUUID(), offer: randomUUID(),
    }
    psql(db, imageFixtureSql({
      actor,
      ...p2FailedInFlight,
      title: 'P2 in-flight rollout failure fixture',
      findings: [],
      promptVersion: 'visual-safety-v1',
    }))
    insertContextEvaluation(db, p2FailedInFlight, {
      policyId: 'nelyon.creator_premium.general.p1.v1',
      schemaVersion: 'creator-premium-context-p2-v1',
      promptVersion: 'creator-premium-context-p2-v1',
    })
    psql(db, `
      update private.creator_premium_content_safety_context_evaluations set
        status='processing',attempt_count=1,started_at=clock_timestamp()
      where source_scan_id='${p2FailedInFlight.scan}'
        and policy_id='nelyon.creator_premium.general.p1.v1'
    `)
    const p2FailedInFlightFingerprint = psql(db, `
      select content_fingerprint from private.content_safety_scans
      where id='${p2FailedInFlight.scan}'
    `).stdout
    const failedP2InFlight = JSON.parse(asRole(db, 'service_role', `
      select public.fail_creator_premium_content_safety_context_v1(
        '${p2FailedInFlight.scan}','${p2FailedInFlightFingerprint}',1,
        'rollout_provider_failure',false,true
      )
    `).stdout)
    assert.equal(failedP2InFlight.context_status, 'failed')
    assert.equal(psql(db, `
      select lifecycle_status||'|'||verification_status
      from private.creator_premium_contents where id='${p2FailedInFlight.content}'
    `).stdout, 'pending_review|pending')

    const allowed = {
      content: randomUUID(), scan: randomUUID(), analysis: randomUUID(),
      original: randomUUID(), teaser: randomUUID(), offer: randomUUID(),
    }
    psql(db, imageFixtureSql({
      actor,
      ...allowed,
      title: 'Peaceful police operation fixture',
      findings: [{
        category: 'weapons',
        triage_level: 'medium',
        description: 'Holstered service weapon during a peaceful operation.',
      }],
    }))
    assert.equal(psql(db, `
      select
        (private.content_safety_visual_analysis_id_for_asset(
          null,'${allowed.original}','creator-premium-visual-safety-p3-v1'
        )='${allowed.analysis}')::text||'|'||
        (private.content_safety_visual_analysis_id_for_asset(
          null,'${allowed.original}','visual-safety-v1'
        ) is null)::text||'|'||
        (private.content_safety_visual_producer_scan_id(
          null,'${allowed.original}','creator-premium-visual-safety-p3-v1'
        )='${allowed.scan}')::text||'|'||
        (private.content_safety_visual_producer_scan_id(
          null,'${allowed.original}','visual-safety-v1'
        ) is null)::text
    `).stdout, 'true|true|true|true',
    'P3 visual analysis and producer dedup must be exact-version bounded')
    addActiveOffer(db, actor, allowed)
    addAlert(db, actor, allowed, {
      sourceType: 'visual_classifier',
      category: 'weapons',
      fingerprint: 'b'.repeat(64),
    })
    addAlert(db, actor, allowed, {
      sourceType: 'text_rule',
      category: 'weapons',
      fingerprint: '1'.repeat(64),
      ruleId: contextualRule,
    })
    addAlert(db, actor, allowed, {
      sourceType: 'audio_transcript_rule',
      category: 'weapons',
      fingerprint: '2'.repeat(64),
      ruleId: contextualRule,
    })

    assert.deepEqual(JSON.parse(asRole(
      db, 'service_role',
      'select public.claim_creator_premium_content_safety_context_v1(1)',
    ).stdout), [], 'the legacy worker must not claim P3 context work during migration-first rollout')
    const badWorkerContract = asRole(db, 'service_role', `
      select public.claim_creator_premium_content_safety_context_v1(
        1,'content-safety-scan-unknown'
      )
    `, { allowFailure: true })
    assert.notEqual(badWorkerContract.status, 0)
    assert.match(
      `${badWorkerContract.stdout}\n${badWorkerContract.stderr}`,
      /unsupported_content_safety_worker_contract/i,
    )
    const p3Claim = claimP3(db)
    assert.equal(p3Claim.scan_id, allowed.scan)
    insertContextEvaluation(db, allowed, {
      policyId: 'nelyon.creator_premium.general.p1.v1',
      schemaVersion: 'creator-premium-context-p2-v1',
      promptVersion: 'creator-premium-context-p2-v1',
    })
    assert.equal(psql(db, `
      select pg_catalog.string_agg(
        policy_id||'|'||schema_version||'|'||prompt_version, E'\n'
        order by policy_id
      )
      from private.creator_premium_content_safety_context_evaluations
      where source_scan_id='${allowed.scan}'
    `).stdout, [
      'nelyon.creator_premium.general.p1.v1|creator-premium-context-p2-v1|creator-premium-context-p2-v1',
      'nelyon.creator_premium.general.p1.v2|creator-premium-context-p3-v1|creator-premium-context-p3-v1',
    ].join('\n'))

    const crossPolicy = psql(db, `
      update private.creator_premium_content_safety_context_evaluations
      set policy_id='nelyon.creator_premium.general.p1.v2'
      where source_scan_id='${allowed.scan}'
        and policy_id='nelyon.creator_premium.general.p1.v1'
    `, { allowFailure: true })
    assert.notEqual(crossPolicy.status, 0)
    assert.match(`${crossPolicy.stdout}\n${crossPolicy.stderr}`, /creator_premium_context_revision_check/i)

    const crossSchema = psql(db, `
      update private.creator_premium_content_safety_context_evaluations
      set schema_version='creator-premium-context-p3-v1'
      where source_scan_id='${allowed.scan}'
        and policy_id='nelyon.creator_premium.general.p1.v1'
    `, { allowFailure: true })
    assert.notEqual(crossSchema.status, 0)
    assert.match(`${crossSchema.stdout}\n${crossSchema.stderr}`, /creator_premium_context_revision_check/i)

    completeP3(db, p3Claim, p3ContextResult())
    assert.deepEqual(JSON.parse(asRole(
      db, 'service_role',
      'select public.claim_creator_premium_content_safety_context_v1(1)',
    ).stdout), [], 'the canonical claim path must never claim pending P2/v1 evidence')

    const allowDecision = JSON.parse(psql(db, `
      select private.creator_premium_content_safety_decision_p1_v1('${allowed.scan}')
    `).stdout)
    assert.equal(allowDecision.policy_id, 'nelyon.creator_premium.general.p1.v2')
    assert.equal(allowDecision.decision, 'allow')
    assert.equal(allowDecision.activation_effect, true)

    const firstReconcile = JSON.parse(asRole(
      db, 'service_role', 'select public.reconcile_creator_premium_publications_v1(25)',
    ).stdout)
    assert.equal(firstReconcile.processed, 1)
    assert.equal(firstReconcile.results[0].outcome, 'published')
    assert.equal(psql(db, `
      select lifecycle_status||'|'||verification_status
      from private.creator_premium_contents where id='${allowed.content}'
    `).stdout, 'published|passed')
    assert.equal(psql(db, `
      select pg_catalog.string_agg(source_type||'|'||status, E'\n' order by source_type)
      from private.content_safety_alerts where scan_id='${allowed.scan}'
    `).stdout, [
      'audio_transcript_rule|open',
      'text_rule|open',
      'visual_classifier|open',
    ].join('\n'), 'P3 must preserve contextualized scanner alerts as audit evidence')

    const secondReconcile = JSON.parse(asRole(
      db, 'service_role', 'select public.reconcile_creator_premium_publications_v1(25)',
    ).stdout)
    assert.equal(secondReconcile.processed, 0)
    assert.equal(psql(db, `
      select lifecycle_status||'|'||verification_status
      from private.creator_premium_contents where id='${allowed.content}'
    `).stdout, 'published|passed')

    const generationTwo = {
      content: randomUUID(), scan: randomUUID(), analysis: randomUUID(),
      original: randomUUID(), teaser: randomUUID(), offer: randomUUID(),
    }
    psql(db, imageFixtureSql({
      actor,
      ...generationTwo,
      generation: 2,
      title: 'P3 generation two review fixture',
      findings: [{
        category: 'weapons',
        triage_level: 'low',
        description: 'Visible but non-threatening weapon in an ambiguous wider context.',
      }],
    }))
    const generationTwoClaim = claimP3(db)
    assert.equal(generationTwoClaim.scan_id, generationTwo.scan)
    assert.equal(psql(db, `
      select verification_generation from private.creator_premium_contents
      where id='${generationTwo.content}'
    `).stdout, '2')
    completeP3(db, generationTwoClaim, p3ReviewResult())
    const generationTwoDecision = JSON.parse(psql(db, `
      select private.creator_premium_content_safety_decision_p1_v1('${generationTwo.scan}')
    `).stdout)
    assert.equal(generationTwoDecision.decision, 'review')
    const generationTwoReconcile = JSON.parse(asRole(
      db, 'service_role', 'select public.reconcile_creator_premium_publications_v1(25)',
    ).stdout)
    assert.equal(generationTwoReconcile.processed, 1)
    assert.equal(generationTwoReconcile.results[0].outcome, 'review')
    assert.equal(psql(db, `
      select lifecycle_status||'|'||verification_status||'|'||verification_generation
      from private.creator_premium_contents where id='${generationTwo.content}'
    `).stdout, 'quarantined|restricted|2')
    assert.equal(JSON.parse(asRole(
      db, 'service_role', 'select public.reconcile_creator_premium_publications_v1(25)',
    ).stdout).processed, 0, 'generation two reconciliation stays idempotent')

    const generationTwoVideo = {
      content: randomUUID(), scan: randomUUID(), analysis: randomUUID(),
      video: randomUUID(), transcript: randomUUID(), teaser: randomUUID(),
      offer: randomUUID(),
    }
    psql(db, videoFixtureSql({
      actor,
      ...generationTwoVideo,
      generation: 2,
      title: 'P3 generation two video allow fixture',
    }))
    addActiveOffer(db, actor, generationTwoVideo)
    const generationTwoVideoClaim = claimP3(db)
    assert.equal(generationTwoVideoClaim.scan_id, generationTwoVideo.scan)
    assert.equal(generationTwoVideoClaim.transcript_coverage, 'complete')
    assert.match(generationTwoVideoClaim.transcript_text, /operativo pacifico/i)
    assert.equal(psql(db, `
      select verification_generation from private.creator_premium_contents
      where id='${generationTwoVideo.content}'
    `).stdout, '2')
    completeP3(
      db,
      generationTwoVideoClaim,
      p3CanonicalizedWeaponAllowResult({ transcript: 'complete' }),
    )
    const generationTwoVideoDecision = JSON.parse(psql(db, `
      select private.creator_premium_content_safety_decision_p1_v1(
        '${generationTwoVideo.scan}'
      )
    `).stdout)
    assert.equal(generationTwoVideoDecision.decision, 'allow')
    const generationTwoVideoReconcile = JSON.parse(asRole(
      db, 'service_role', 'select public.reconcile_creator_premium_publications_v1(25)',
    ).stdout)
    assert.equal(generationTwoVideoReconcile.processed, 1)
    assert.equal(generationTwoVideoReconcile.results[0].outcome, 'published')
    assert.equal(psql(db, `
      select lifecycle_status||'|'||verification_status||'|'||verification_generation
      from private.creator_premium_contents where id='${generationTwoVideo.content}'
    `).stdout, 'published|passed|2')
    assert.equal(JSON.parse(asRole(
      db, 'service_role', 'select public.reconcile_creator_premium_publications_v1(25)',
    ).stdout).processed, 0, 'generation two video reconciliation stays idempotent')

    addAlert(db, actor, allowed, {
      sourceType: 'user_reports',
      category: 'threat',
      fingerprint: 'c'.repeat(64),
    })
    const nonvisualReconcile = JSON.parse(asRole(
      db, 'service_role', 'select public.reconcile_creator_premium_publications_v1(25)',
    ).stdout)
    assert.equal(nonvisualReconcile.processed, 1)
    assert.equal(nonvisualReconcile.results[0].outcome, 'restricted')
    assert.equal(psql(db, `
      select lifecycle_status||'|'||verification_status
      from private.creator_premium_contents where id='${allowed.content}'
    `).stdout, 'quarantined|restricted')

    const historicalP2 = {
      content: randomUUID(), scan: randomUUID(), analysis: randomUUID(),
      original: randomUUID(), teaser: randomUUID(), offer: randomUUID(),
    }
    psql(db, imageFixtureSql({
      actor,
      ...historicalP2,
      title: 'Historical exact P2 allow fixture',
      promptVersion: 'visual-safety-v1',
      findings: [{
        category: 'weapons',
        triage_level: 'medium',
        description: 'Synthetic historical visual signal.',
      }],
    }))
    assert.equal(psql(db, `
      select
        (private.content_safety_visual_analysis_id_for_asset(
          null,'${historicalP2.original}','visual-safety-v1'
        )='${historicalP2.analysis}')::text||'|'||
        (private.content_safety_visual_analysis_id_for_asset(
          null,'${historicalP2.original}','creator-premium-visual-safety-p3-v1'
        ) is null)::text||'|'||
        (private.content_safety_visual_producer_scan_id(
          null,'${historicalP2.original}','visual-safety-v1'
        )='${historicalP2.scan}')::text||'|'||
        (private.content_safety_visual_producer_scan_id(
          null,'${historicalP2.original}','creator-premium-visual-safety-p3-v1'
        ) is null)::text
    `).stdout, 'true|true|true|true',
    'historical P2 visual evidence must remain readable only through its exact v1 contract')
    addActiveOffer(db, actor, historicalP2)
    insertContextEvaluation(db, historicalP2, {
      policyId: 'nelyon.creator_premium.general.p1.v1',
      schemaVersion: 'creator-premium-context-p2-v1',
      promptVersion: 'creator-premium-context-p2-v1',
      status: 'completed',
      result: p2ContextResult(),
    })
    addAlert(db, actor, historicalP2, {
      sourceType: 'visual_classifier',
      category: 'weapons',
      fingerprint: 'f'.repeat(64),
    })
    addAlert(db, actor, historicalP2, {
      sourceType: 'text_rule',
      category: 'weapons',
      fingerprint: '3'.repeat(64),
      ruleId: contextualRule,
    })
    addAlert(db, actor, historicalP2, {
      sourceType: 'audio_transcript_rule',
      category: 'weapons',
      fingerprint: '4'.repeat(64),
      ruleId: contextualRule,
    })
    psql(db, `
      update private.creator_premium_contents set
        lifecycle_status='published',verification_status='passed',
        published_at=clock_timestamp(),verification_completed_at=clock_timestamp()
      where id='${historicalP2.content}'
    `)
    assert.equal(psql(db, `
      select private.creator_premium_content_safety_historical_p2_allow_valid_p3_v1(
        '${historicalP2.scan}'
      )
    `).stdout, 't')
    const historicalProducerScan = randomUUID()
    psql(db, `
      insert into private.content_safety_scans(
        id,target_type,target_id,owner_user_id,content_fingerprint,status,
        requested_reason,text_status,audio_status,visual_status,reports_status,
        completed_at,created_at,updated_at,visual_source_kind,
        visual_media_asset_id,visual_analysis_id
      )
      select
        '${historicalProducerScan}',target_type,target_id,owner_user_id,
        '${'e'.repeat(64)}','completed',requested_reason,text_status,audio_status,
        'analyzed',reports_status,completed_at,
        created_at-interval '1 second',updated_at-interval '1 second',
        visual_source_kind,visual_media_asset_id,null
      from private.content_safety_scans where id='${historicalP2.scan}';
      update private.content_safety_visual_analyses set
        source_scan_id='${historicalProducerScan}',
        source_content_fingerprint='${'e'.repeat(64)}'
      where id='${historicalP2.analysis}'
    `)
    assert.equal(psql(db, `
      select private.creator_premium_content_safety_historical_p2_allow_valid_p3_v1(
        '${historicalP2.scan}'
      )
    `).stdout, 't', 'a canonical visual proof reused from another producer scan must remain valid')
    psql(db, `
      update private.creator_premium_content_safety_context_evaluations set
        target_id='${allowed.content}'
      where source_scan_id='${historicalP2.scan}'
        and policy_id='nelyon.creator_premium.general.p1.v1'
    `)
    assert.equal(psql(db, `
      select private.creator_premium_content_safety_historical_p2_allow_valid_p3_v1(
        '${historicalP2.scan}'
      )
    `).stdout, 'f', 'a P2 evaluation bound to another content cannot grandfather publication')
    psql(db, `
      update private.creator_premium_content_safety_context_evaluations set
        target_id='${historicalP2.content}'
      where source_scan_id='${historicalP2.scan}'
        and policy_id='nelyon.creator_premium.general.p1.v1'
    `)
    assert.equal(psql(db, `
      select private.creator_premium_content_safety_historical_p2_allow_valid_p3_v1(
        '${historicalP2.scan}'
      )
    `).stdout, 't')
    const historicalDirect = JSON.parse(psql(db, `
      select private.finalize_creator_premium_safety_scan_v1('${historicalP2.scan}')
    `).stdout)
    assert.equal(historicalDirect.outcome, 'published_unchanged_historical_policy')
    const historicalReconcile = JSON.parse(asRole(
      db, 'service_role', 'select public.reconcile_creator_premium_publications_v1(25)',
    ).stdout)
    assert.equal(historicalReconcile.processed, 0)
    assert.equal(psql(db, `
      select lifecycle_status||'|'||verification_status
      from private.creator_premium_contents where id='${historicalP2.content}'
    `).stdout, 'published|passed')
    assert.equal(psql(db, `
      select status from private.content_safety_alerts
      where scan_id='${historicalP2.scan}' and source_type='visual_classifier'
    `).stdout, 'open')

    const unsupportedPublished = {
      content: randomUUID(), scan: randomUUID(), analysis: randomUUID(),
      original: randomUUID(), teaser: randomUUID(), offer: randomUUID(),
    }
    psql(db, imageFixtureSql({
      actor,
      ...unsupportedPublished,
      title: 'Published alert without policy authority fixture',
      findings: [{
        category: 'violence',
        triage_level: 'high',
        description: 'Synthetic high-severity signal without contextual authority.',
      }],
    }))
    addActiveOffer(db, actor, unsupportedPublished)
    addAlert(db, actor, unsupportedPublished, {
      sourceType: 'visual_classifier',
      category: 'violence',
      fingerprint: '9'.repeat(64),
    })
    psql(db, `
      update private.creator_premium_contents set
        lifecycle_status='published',verification_status='passed',
        published_at=clock_timestamp(),verification_completed_at=clock_timestamp()
      where id='${unsupportedPublished.content}'
    `)
    const unsupportedReconcile = JSON.parse(asRole(
      db, 'service_role', 'select public.reconcile_creator_premium_publications_v1(25)',
    ).stdout)
    assert.equal(unsupportedReconcile.processed, 1)
    assert.equal(unsupportedReconcile.results[0].outcome, 'restricted')
    assert.equal(psql(db, `
      select lifecycle_status||'|'||verification_status
      from private.creator_premium_contents where id='${unsupportedPublished.content}'
    `).stdout, 'quarantined|restricted')

    const p2Only = {
      content: randomUUID(), scan: randomUUID(), analysis: randomUUID(),
      original: randomUUID(), teaser: randomUUID(), offer: randomUUID(),
    }
    psql(db, imageFixtureSql({
      actor,
      ...p2Only,
      title: 'Historical P2 evidence fixture',
      promptVersion: 'visual-safety-v1',
      findings: [],
    }))
    addActiveOffer(db, actor, p2Only)
    insertContextEvaluation(db, p2Only, {
      policyId: 'nelyon.creator_premium.general.p1.v1',
      schemaVersion: 'creator-premium-context-p2-v1',
      promptVersion: 'creator-premium-context-p2-v1',
      status: 'completed',
      result: p2ContextResult(),
    })
    const p2OnlyDecision = JSON.parse(psql(db, `
      select private.creator_premium_content_safety_decision_p1_v1('${p2Only.scan}')
    `).stdout)
    assert.equal(p2OnlyDecision.policy_id, 'nelyon.creator_premium.general.p1.v2')
    assert.equal(p2OnlyDecision.decision, 'technical_failure')
    assert.notEqual(p2OnlyDecision.activation_effect, true)

    const p2OnlyReconcile = JSON.parse(asRole(
      db, 'service_role', 'select public.reconcile_creator_premium_publications_v1(25)',
    ).stdout)
    assert.equal(p2OnlyReconcile.processed, 0)
    assert.equal(psql(db, `
      select lifecycle_status||'|'||verification_status
      from private.creator_premium_contents where id='${p2Only.content}'
    `).stdout, 'pending_review|pending',
    'a historical P2-only decision must not be reclassified automatically by P3')
    assert.equal(psql(db, `
      select content.lifecycle_status||'|'||content.verification_status||'|'||evaluation.status
      from private.creator_premium_contents content
      join private.creator_premium_content_safety_context_evaluations evaluation
        on evaluation.target_id=content.id
       and evaluation.policy_id='nelyon.creator_premium.general.p1.v1'
      where content.id='${p2InFlight.content}'
    `).stdout, 'pending_review|pending|completed',
    'completed in-flight P2 work must remain historical after repeated P3 reconciliation')
    assert.equal(psql(db, `
      select content.lifecycle_status||'|'||content.verification_status||'|'||evaluation.status
      from private.creator_premium_contents content
      join private.creator_premium_content_safety_context_evaluations evaluation
        on evaluation.target_id=content.id
       and evaluation.policy_id='nelyon.creator_premium.general.p1.v1'
      where content.id='${p2FailedInFlight.content}'
    `).stdout, 'pending_review|pending|failed',
    'failed in-flight P2 work must remain historical after repeated P3 reconciliation')

    assert.equal(psql(db, `
      select purchase_enabled::text||'|'||subscription_enabled::text||'|'||
             refunds_enabled::text||'|'||platform_fee_bps::text
      from private.creator_premium_finance_policy where singleton=true
    `).stdout, 'false|false|false|0')
  } finally {
    docker(`dropdb -U supabase_admin --if-exists ${db}`, { allowFailure: true })
  }
})
