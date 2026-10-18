// Real disposable PostgreSQL proof. Set RUN_CREATOR_PREMIUM_P2_ACTIVATION_LOCAL=1 to enable it.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const enabled = process.env.RUN_CREATOR_PREMIUM_P2_ACTIVATION_LOCAL === '1'
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

function imageFixtureSql({ actor, content, scan, analysis, original, teaser, title }) {
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
      '${content}','${actor}','${title}','P2 activation disposable fixture','image','purchase',
      'pending_review',clock_timestamp(),'${scan}','${'a'.repeat(64)}','pending',clock_timestamp()
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
      '{}'::integer[],
      '{"schema_version":"visual-safety-v1","review_required":false,"findings":[],"summary":"Synthetic fixture."}'::jsonb,
      '${'d'.repeat(64)}',1
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

function contextResult({ decision, categories, uncertainty = 'unambiguous', age = 'not_relevant', consent = 'not_relevant', rationale }) {
  return JSON.stringify({
    schema_version: 'creator-premium-context-p2-v1',
    policy_id: 'nelyon.creator_premium.general.p1.v1',
    decision,
    categories,
    coverage: { text: 'complete', transcript: 'not_applicable', visual: 'complete' },
    uncertainty,
    age_uncertainty: age,
    consent_uncertainty: consent,
    certainty_basis: 'discrete_contract',
    rationale_codes: rationale,
  })
}

function completeContext(db, scan, result) {
  const claims = JSON.parse(asRole(
    db, 'service_role',
    'select public.claim_creator_premium_content_safety_context_v1(1)',
  ).stdout)
  const claim = claims[0]
  if (!claim) {
    const diagnostic = psql(db, `
      select pg_catalog.jsonb_build_object(
        'scan_status',source.status,
        'text_status',source.text_status,
        'reports_status',source.reports_status,
        'visual_status',source.visual_status,
        'audio_status',source.audio_status,
        'lifecycle_status',content.lifecycle_status,
        'verification_bound',content.verification_scan_id=source.id
          and content.verification_fingerprint=source.content_fingerprint,
        'snapshot_present',private.content_safety_target_snapshot(
          'creator_premium',content.id
        ) is not null,
        'fingerprint_current',source.content_fingerprint=
          private.content_safety_sha256(
            'creator_premium|'||content.id::text||'|'||coalesce(
              private.content_safety_target_snapshot(
                'creator_premium',content.id
              )->>'content_version',''
            )
          ),
        'evaluation_count',(select pg_catalog.count(*)
          from private.creator_premium_content_safety_context_evaluations
          where source_scan_id=source.id)
      )
      from private.content_safety_scans source
      join private.creator_premium_contents content on content.id=source.target_id
      where source.id='${scan}'
    `).stdout
    throw new Error(`context claim missing: ${diagnostic}`)
  }
  assert.equal(claim.scan_id, scan)
  return JSON.parse(asRole(db, 'service_role', `
    select public.complete_creator_premium_content_safety_context_v1(
      '${scan}','${claim.content_fingerprint}',${claim.attempt_count},
      '${result}'::jsonb
    )
  `).stdout)
}

test('P2 activation disposable harness binds one forward activation migration', () => {
  for (const item of chain) assert.equal(item.found.length, 1, item.suffix)
  assert.match(chain.at(-1).found[0], /^\d{14}_creator_premium_content_safety_p2_activation\.sql$/)
})

test('P2 activation publishes only allow, keeps review private, rejects block, and recovers only policy-blocked rows', {
  skip: !enabled,
  timeout: 900_000,
}, () => {
  const db = `premium_p2_activation_${randomUUID().replaceAll('-', '').slice(0, 8)}`
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

    assert.equal(psql(db, `select private.creator_premium_content_safety_policy_p1_v1()#>>'{activation,status}'`).stdout, 'active')
    assert.equal(psql(db, `select private.creator_premium_content_safety_policy_p1_v1()#>>'{activation,enabled}'`).stdout, 'true')
    assert.equal(psql(db, `select private.creator_premium_content_safety_policy_p1_v1()#>>'{activation,auto_publish_enabled}'`).stdout, 'true')
    assert.equal(psql(db, `select pg_catalog.jsonb_array_length(private.creator_premium_content_safety_policy_p1_v1()#>'{activation,blockers}')`).stdout, '0')
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(psql(db, `select has_function_privilege('${role}','private.creator_premium_content_safety_decision_p1_v1(uuid)','execute')`).stdout, 'f')
    }
    assert.equal(psql(db, `select has_function_privilege('service_role','public.reconcile_creator_premium_publications_v1(integer)','execute')`).stdout, 't')
    assert.equal(psql(db, `select has_function_privilege('authenticated','public.reconcile_creator_premium_publications_v1(integer)','execute')`).stdout, 'f')

    psql(db, `
      set session_replication_role=replica;
      insert into auth.users(id,is_anonymous) values('${actor}',false);
      insert into public.user_profiles(id,username) values('${actor}','p2_activation_actor');
      insert into private.user_age_eligibility(
        user_id,status,minimum_age,policy_version,evaluated_at,source,age_band,birth_date
      )
      select '${actor}','eligible',policy.minimum_age,policy.policy_version,
             clock_timestamp(),'signup_metadata','age_18_plus',current_date-interval '30 years'
      from private.age_eligibility_policy policy where policy.singleton=true;
      set session_replication_role=origin;
    `)

    const allow = {
      content: randomUUID(), scan: randomUUID(), analysis: randomUUID(),
      original: randomUUID(), teaser: randomUUID(), offer: randomUUID(),
    }
    psql(db, imageFixtureSql({ actor, ...allow, title: 'Educational allow fixture' }))
    psql(db, `
      insert into private.creator_premium_offer_versions(
        id,content_id,creator_id,version,price_bdag,currency,status,activated_at
      ) values(
        '${allow.offer}','${allow.content}','${actor}',1,10,'BDAG','active',clock_timestamp()
      )
    `)
    psql(db, `
      update private.content_safety_scans set
        content_fingerprint=private.content_safety_sha256(
          'creator_premium|'||target_id::text||'|'||coalesce(
            private.content_safety_target_snapshot(
              'creator_premium',target_id
            )->>'content_version',''
          )
        )
      where id='${allow.scan}';
      update private.creator_premium_contents content_row set
        verification_fingerprint=scan_row.content_fingerprint
      from private.content_safety_scans scan_row
      where content_row.id='${allow.content}' and scan_row.id='${allow.scan}';
      update private.content_safety_visual_analyses analysis_row set
        source_content_fingerprint=scan_row.content_fingerprint
      from private.content_safety_scans scan_row
      where analysis_row.id='${allow.analysis}' and scan_row.id='${allow.scan}';
    `)
    const allowResult = contextResult({
      decision: 'allow', categories: ['education'],
      rationale: ['educational_context', 'quoted_or_negated_context'],
    })
    completeContext(db, allow.scan, allowResult)
    const allowDecision = JSON.parse(psql(db, `select private.creator_premium_content_safety_decision_p1_v1('${allow.scan}')`).stdout)
    assert.equal(allowDecision.decision, 'allow')
    assert.equal(allowDecision.activation_effect, true)
    psql(db, `
      update private.creator_premium_contents set
        verification_status='failed',
        verification_error_code='content_safety_policy_not_configured',
        verification_completed_at=clock_timestamp()
      where id='${allow.content}'
    `)
    const allowReconcile = JSON.parse(asRole(
      db, 'service_role', 'select public.reconcile_creator_premium_publications_v1(1)',
    ).stdout)
    assert.equal(allowReconcile.processed, 1)
    assert.equal(allowReconcile.results[0].outcome, 'published')
    assert.equal(psql(db, `select lifecycle_status||'|'||verification_status from private.creator_premium_contents where id='${allow.content}'`).stdout, 'published|passed')

    const review = {
      content: randomUUID(), scan: randomUUID(), analysis: randomUUID(),
      original: randomUUID(), teaser: randomUUID(),
    }
    psql(db, imageFixtureSql({ actor, ...review, title: 'Uncertain age review fixture' }))
    completeContext(db, review.scan, contextResult({
      decision: 'review', categories: ['age_uncertain'], uncertainty: 'ambiguous',
      age: 'present', rationale: ['age_requires_review'],
    }))
    const reviewReconcile = JSON.parse(asRole(
      db, 'service_role', 'select public.reconcile_creator_premium_publications_v1(1)',
    ).stdout)
    assert.equal(reviewReconcile.results[0].outcome, 'review')
    assert.equal(psql(db, `select lifecycle_status||'|'||verification_status from private.creator_premium_contents where id='${review.content}'`).stdout, 'quarantined|restricted')

    const blocked = {
      content: randomUUID(), scan: randomUUID(), analysis: randomUUID(),
      original: randomUUID(), teaser: randomUUID(),
    }
    psql(db, imageFixtureSql({ actor, ...blocked, title: 'Severe block fixture' }))
    completeContext(db, blocked.scan, contextResult({
      decision: 'block', categories: ['non_consensual_intimate_content'],
      consent: 'present', rationale: ['severe_explicit_context'],
    }))
    const blockReconcile = JSON.parse(asRole(
      db, 'service_role', 'select public.reconcile_creator_premium_publications_v1(1)',
    ).stdout)
    assert.equal(blockReconcile.results[0].outcome, 'blocked')
    assert.equal(psql(db, `select lifecycle_status||'|'||verification_status from private.creator_premium_contents where id='${blocked.content}'`).stdout, 'rejected|blocked')

    const untouched = {
      content: randomUUID(), scan: randomUUID(), analysis: randomUUID(),
      original: randomUUID(), teaser: randomUUID(),
    }
    psql(db, imageFixtureSql({ actor, ...untouched, title: 'Unrelated failure fixture' }))
    completeContext(db, untouched.scan, allowResult)
    psql(db, `
      update private.creator_premium_contents set
        verification_status='failed',
        verification_error_code='creator_premium_safety_provider_failed',
        verification_completed_at=clock_timestamp()
      where id='${untouched.content}'
    `)
    const untouchedReconcile = JSON.parse(asRole(
      db, 'service_role', 'select public.reconcile_creator_premium_publications_v1(25)',
    ).stdout)
    assert.equal(untouchedReconcile.processed, 0)
    assert.equal(psql(db, `select lifecycle_status||'|'||verification_status from private.creator_premium_contents where id='${untouched.content}'`).stdout, 'pending_review|failed')

    assert.equal(psql(db, `select purchase_enabled::text||'|'||subscription_enabled::text||'|'||refunds_enabled::text||'|'||platform_fee_bps::text from private.creator_premium_finance_policy where singleton=true`).stdout, 'false|false|false|0')
  } finally {
    docker(`dropdb -U supabase_admin --if-exists ${db}`, { allowFailure: true })
  }
})
