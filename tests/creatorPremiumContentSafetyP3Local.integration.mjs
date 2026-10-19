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
  '_creator_premium_content_safety_p3_contextual_violence_policy_v2.sql',
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

function imageFixtureSql({ actor, content, scan, analysis, original, teaser, title, findings }) {
  const analysisResult = JSON.stringify({
    schema_version: 'visual-safety-v1',
    review_required: findings.length > 0,
    findings,
    summary: 'Synthetic non-sensitive P3 fixture.',
  })
  return `
    set session_replication_role=replica;
    insert into private.content_safety_scans(
      id,target_type,target_id,owner_user_id,content_fingerprint,status,requested_reason,
      text_status,audio_status,visual_status,reports_status,completed_at,created_at,updated_at
    ) values(
      '${scan}','creator_premium','${content}','${actor}','${'a'.repeat(64)}',
      'completed','retry','analyzed','not_applicable','analyzed','analyzed',clock_timestamp(),
      clock_timestamp()-interval '1 second',clock_timestamp()
    );
    insert into private.creator_premium_contents(
      id,creator_id,title,description,content_kind,access_mode,lifecycle_status,
      submitted_at,verification_scan_id,verification_fingerprint,verification_status,
      verification_requested_at
    ) values(
      '${content}','${actor}','${quoteSql(title)}','P3 contextual violence disposable fixture',
      'image','purchase','pending_review',clock_timestamp(),'${scan}','${'a'.repeat(64)}',
      'pending',clock_timestamp()
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
      '@cf/google/gemma-4-26b-a4b-it','visual-safety-v1','single_image_v1',1,
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
  `)
}

function p3ContextResult() {
  return JSON.stringify({
    schema_version: 'creator-premium-context-p3-v1',
    policy_id: 'nelyon.creator_premium.general.p1.v2',
    decision: 'allow',
    categories: ['non_graphic_law_enforcement_operation'],
    coverage: { text: 'complete', transcript: 'not_applicable', visual: 'complete' },
    uncertainty: 'unambiguous',
    age_uncertainty: 'not_relevant',
    consent_uncertainty: 'not_relevant',
    certainty_basis: 'discrete_contract',
    rationale_codes: ['non_graphic_law_enforcement_context'],
  })
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

function claimP3(db) {
  const claims = JSON.parse(asRole(
    db, 'service_role',
    'select public.claim_creator_premium_content_safety_context_v1(1)',
  ).stdout)
  assert.equal(claims.length, 1, JSON.stringify(claims))
  assert.equal(claims[0].policy_id, 'nelyon.creator_premium.general.p1.v2')
  assert.equal(claims[0].schema_version, 'creator-premium-context-p3-v1')
  assert.equal(claims[0].prompt_version, 'creator-premium-context-p3-v1')
  return claims[0]
}

function completeP3(db, claim, result) {
  return JSON.parse(asRole(db, 'service_role', `
    select public.complete_creator_premium_content_safety_context_v1(
      '${claim.scan_id}','${claim.content_fingerprint}',${claim.attempt_count},
      '${quoteSql(result)}'::jsonb
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
}

function addAlert(db, actor, fixture, { sourceType, category, fingerprint }) {
  psql(db, `
    insert into private.content_safety_alerts(
      scan_id,target_type,target_id,owner_user_id,source_type,category,severity,
      confidence,priority_score,alert_fingerprint,evidence
    ) values(
      '${fixture.scan}','creator_premium','${fixture.content}','${actor}',
      '${sourceType}','${category}','medium',0.85,60,'${fingerprint}',
      '{"fixture":"synthetic_p3"}'::jsonb
    )
  `)
}

test('P3 disposable harness binds one forward-only contextual violence migration', () => {
  for (const item of chain) assert.equal(item.found.length, 1, item.suffix)
  assert.match(
    chain.at(-1).found[0],
    /^\d{14}_creator_premium_content_safety_p3_contextual_violence_policy_v2\.sql$/,
  )
})

test('P3 disposable runtime preserves version identity, publishes contextual visual allow, and fails closed on nonvisual or P2-only evidence', {
  skip: !enabled,
  timeout: 900_000,
}, () => {
  const db = `premium_p3_${randomUUID().replaceAll('-', '').slice(0, 8)}`
  const actor = randomUUID()
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
    `)

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
    addActiveOffer(db, actor, allowed)
    addAlert(db, actor, allowed, {
      sourceType: 'visual_classifier',
      category: 'weapons',
      fingerprint: 'b'.repeat(64),
    })

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
      select status from private.content_safety_alerts
      where scan_id='${allowed.scan}' and source_type='visual_classifier'
    `).stdout, 'open', 'P3 must preserve the contextualized visual alert as audit evidence')

    const secondReconcile = JSON.parse(asRole(
      db, 'service_role', 'select public.reconcile_creator_premium_publications_v1(25)',
    ).stdout)
    assert.equal(secondReconcile.processed, 0)
    assert.equal(psql(db, `
      select lifecycle_status||'|'||verification_status
      from private.creator_premium_contents where id='${allowed.content}'
    `).stdout, 'published|passed')

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

    const p2Only = {
      content: randomUUID(), scan: randomUUID(), analysis: randomUUID(),
      original: randomUUID(), teaser: randomUUID(), offer: randomUUID(),
    }
    psql(db, imageFixtureSql({
      actor,
      ...p2Only,
      title: 'Historical P2 evidence fixture',
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
    assert.equal(p2OnlyReconcile.processed, 1)
    assert.equal(p2OnlyReconcile.results[0].outcome, 'failed')
    assert.equal(psql(db, `
      select lifecycle_status||'|'||verification_status
      from private.creator_premium_contents where id='${p2Only.content}'
    `).stdout, 'pending_review|failed')

    assert.equal(psql(db, `
      select purchase_enabled::text||'|'||subscription_enabled::text||'|'||
             refunds_enabled::text||'|'||platform_fee_bps::text
      from private.creator_premium_finance_policy where singleton=true
    `).stdout, 'false|false|false|0')
  } finally {
    docker(`dropdb -U supabase_admin --if-exists ${db}`, { allowFailure: true })
  }
})
