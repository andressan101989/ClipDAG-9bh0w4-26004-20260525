// Real disposable PostgreSQL proof. Set RUN_CREATOR_PREMIUM_P2_LOCAL=1 to enable it.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const enabled = process.env.RUN_CREATOR_PREMIUM_P2_LOCAL === '1'
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

function imageFixtureSql({ actor, content, scan, analysis, media, title }) {
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
      '${content}','${actor}','${title}','Context evidence fixture','image','purchase',
      'pending_review',clock_timestamp(),'${scan}','${'a'.repeat(64)}','pending',clock_timestamp()
    );
    insert into private.content_safety_visual_analyses(
      id,source_scan_id,media_asset_id,source_content_fingerprint,provider,model,
      prompt_version,sample_strategy,frame_count,frame_timestamps_ms,analysis_result,
      analysis_fingerprint,provider_call_count
    ) values(
      '${analysis}','${scan}','${media}','${'a'.repeat(64)}','cloudflare_workers_ai',
      '@cf/google/gemma-4-26b-a4b-it','visual-safety-v1','single_image_v1',1,
      '{}'::integer[],
      '{"schema_version":"visual-safety-v1","review_required":false,"findings":[],"summary":"Synthetic safe frame."}'::jsonb,
      '${'d'.repeat(64)}',1
    );
    update private.content_safety_scans set
      content_fingerprint=private.content_safety_sha256(
        'creator_premium|'||target_id::text||'|'||coalesce(
          private.content_safety_target_snapshot('creator_premium',target_id)->>'content_version',''
        )
      ),
      visual_analysis_id='${analysis}',visual_media_asset_id='${media}'
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

function videoFixtureSql({ actor, content, scan, analysis, video, transcript, title }) {
  return `
    set session_replication_role=replica;
    insert into private.content_safety_scans(
      id,target_type,target_id,owner_user_id,content_fingerprint,status,requested_reason,
      text_status,audio_status,visual_status,reports_status,completed_at,created_at,updated_at
    ) values(
      '${scan}','creator_premium','${content}','${actor}','${'a'.repeat(64)}',
      'completed','retry','analyzed','analyzed','analyzed','analyzed',clock_timestamp(),
      clock_timestamp()-interval '1 second',clock_timestamp()
    );
    insert into private.creator_premium_contents(
      id,creator_id,title,description,content_kind,access_mode,lifecycle_status,
      submitted_at,verification_scan_id,verification_fingerprint,verification_status,
      verification_requested_at
    ) values(
      '${content}','${actor}','${title}','Context transcript fixture','video','purchase',
      'pending_review',clock_timestamp(),'${scan}','${'a'.repeat(64)}','pending',clock_timestamp()
    );
    insert into private.content_safety_visual_analyses(
      id,source_scan_id,video_asset_id,source_content_fingerprint,provider,model,
      prompt_version,sample_strategy,frame_count,frame_timestamps_ms,analysis_result,
      analysis_fingerprint,provider_call_count
    ) values(
      '${analysis}','${scan}','${video}','${'a'.repeat(64)}','cloudflare_workers_ai',
      '@cf/google/gemma-4-26b-a4b-it','visual-safety-v1','percentile_5_v1',1,
      array[1000]::integer[],
      '{"schema_version":"visual-safety-v1","review_required":false,"findings":[],"summary":"Synthetic educational video frame."}'::jsonb,
      '${'d'.repeat(64)}',1
    );
    insert into private.content_safety_audio_transcripts(
      id,source_scan_id,source_asset_id,source_content_fingerprint,provider,model,
      detected_language,transcript_text,word_count,segments,no_speech,
      transcript_fingerprint,rule_eval_status,rule_eval_attempt_count,
      rule_eval_ruleset_fingerprint,rule_eval_completed_at,created_at,updated_at
    ) values(
      '${transcript}','${scan}','${video}','${'a'.repeat(64)}','cloudflare_workers_ai',
      '@cf/openai/whisper-large-v3-turbo','es',
      'Este curso condena la violencia y enseña a pedir ayuda.',10,'[]'::jsonb,false,
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

function contextResult({ decision, categories, transcript = 'not_applicable', uncertainty = 'unambiguous', age = 'not_relevant', consent = 'not_relevant', rationale }) {
  return JSON.stringify({
    schema_version: 'creator-premium-context-p2-v1',
    policy_id: 'nelyon.creator_premium.general.p1.v1',
    decision,
    categories,
    coverage: { text: 'complete', transcript, visual: 'complete' },
    uncertainty,
    age_uncertainty: age,
    consent_uncertainty: consent,
    certainty_basis: 'discrete_contract',
    rationale_codes: rationale,
  })
}

test('P2 disposable harness binds the complete Premium chain and one P2 evidence migration', () => {
  for (const item of chain) assert.equal(item.found.length, 1, item.suffix)
  assert.match(chain.at(-1).found[0], /^\d{14}_creator_premium_content_safety_p2_evidence_runtime\.sql$/)
})

test('P2 compiles and proves private evidence, bounded claims, candidate decisions, and disabled activation', {
  skip: !enabled,
  timeout: 900_000,
}, () => {
  const db = `premium_p2_${randomUUID().replaceAll('-', '').slice(0, 12)}`
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

    assert.equal(psql(db, `select relrowsecurity::text||'|'||relforcerowsecurity::text from pg_catalog.pg_class where oid='private.creator_premium_content_safety_context_evaluations'::regclass`).stdout, 'true|true')
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(psql(db, `select has_table_privilege('${role}','private.creator_premium_content_safety_context_evaluations','select')`).stdout, 'f')
      assert.equal(psql(db, `select has_function_privilege('${role}','private.creator_premium_content_safety_candidate_p2_v1(uuid)','execute')`).stdout, 'f')
    }
    assert.equal(psql(db, `select has_function_privilege('service_role','public.claim_creator_premium_content_safety_context_v1(integer)','execute')`).stdout, 't')
    assert.equal(psql(db, `select has_function_privilege('service_role','public.complete_creator_premium_content_safety_context_v1(uuid,text,integer,jsonb)','execute')`).stdout, 't')
    assert.equal(psql(db, `select has_function_privilege('service_role','public.fail_creator_premium_content_safety_context_v1(uuid,text,integer,text,boolean,boolean)','execute')`).stdout, 't')
    assert.equal(psql(db, `select has_function_privilege('authenticated','public.claim_creator_premium_content_safety_context_v1(integer)','execute')`).stdout, 'f')
    assert.equal(psql(db, `select private.creator_premium_content_safety_policy_p1_v1()#>>'{activation,enabled}'`).stdout, 'false')
    assert.equal(psql(db, `select count(*) from private.creator_premium_content_safety_context_evaluations`).stdout, '0')

    psql(db, `
      set session_replication_role=replica;
      insert into auth.users(id,is_anonymous) values('${actor}',false);
      insert into public.user_profiles(id,username) values('${actor}','p2_disposable_actor');
      set session_replication_role=origin;
    `)

    const allow = { content: randomUUID(), scan: randomUUID(), analysis: randomUUID(), media: randomUUID() }
    psql(db, imageFixtureSql({ actor, ...allow, title: 'Curso que condena la violencia' }))
    const allowClaim = JSON.parse(psql(db, `select public.claim_creator_premium_content_safety_context_v1(1)`).stdout)
    assert.equal(allowClaim.length, 1)
    assert.equal(allowClaim[0].scan_id, allow.scan)
    assert.equal(allowClaim[0].transcript_coverage, 'not_applicable')
    assert.equal(allowClaim[0].transcript_text, '')
    assert.equal(Object.hasOwn(allowClaim[0], 'owner_user_id'), false)
    assert.equal(Object.hasOwn(allowClaim[0], 'media_url'), false)
    const allowJson = contextResult({ decision: 'allow', categories: ['education'], rationale: ['educational_context', 'quoted_or_negated_context'] })
    const allowReceipt = JSON.parse(psql(db, `select public.complete_creator_premium_content_safety_context_v1('${allow.scan}','${allowClaim[0].content_fingerprint}',${allowClaim[0].attempt_count},'${allowJson}'::jsonb)`).stdout)
    assert.equal(allowReceipt.context_status, 'completed')
    assert.equal(allowReceipt.decision, 'allow')
    assert.match(allowReceipt.evaluation_fingerprint, /^[0-9a-f]{64}$/)
    assert.equal(JSON.parse(psql(db, `select private.creator_premium_content_safety_candidate_p2_v1('${allow.scan}')`).stdout).decision, 'allow')
    assert.equal(JSON.parse(psql(db, `select private.creator_premium_content_safety_decision_p1_v1('${allow.scan}')`).stdout).decision, 'awaiting_policy')
    psql(db, `update private.content_safety_visual_analyses set analysis_fingerprint='${'1'.repeat(64)}' where id='${allow.analysis}'`)
    assert.equal(JSON.parse(psql(db, `select private.creator_premium_content_safety_candidate_p2_v1('${allow.scan}')`).stdout).decision, 'technical_failure')
    psql(db, `update private.content_safety_visual_analyses set analysis_fingerprint='${'d'.repeat(64)}' where id='${allow.analysis}'`)
    const replay = JSON.parse(psql(db, `select public.complete_creator_premium_content_safety_context_v1('${allow.scan}','${allowClaim[0].content_fingerprint}',${allowClaim[0].attempt_count},'${allowJson}'::jsonb)`).stdout)
    assert.equal(replay.replayed, true)
    assert.equal(psql(db, `select provider_call_count from private.creator_premium_content_safety_context_evaluations where source_scan_id='${allow.scan}'`).stdout, '1')
    assert.notEqual(psql(db, `select public.claim_creator_premium_content_safety_context_v1(2)`, { allowFailure: true }).status, 0)

    const review = { content: randomUUID(), scan: randomUUID(), analysis: randomUUID(), media: randomUUID() }
    psql(db, imageFixtureSql({ actor, ...review, title: 'Escena ambigua para revisión' }))
    const reviewClaim = JSON.parse(psql(db, `select public.claim_creator_premium_content_safety_context_v1(1)`).stdout)[0]
    assert.equal(reviewClaim.scan_id, review.scan)
    const invalidReview = contextResult({ decision: 'review', categories: ['age_uncertain'], uncertainty: 'ambiguous', rationale: ['age_requires_review'] })
    const invalidCompletion = psql(db, `select public.complete_creator_premium_content_safety_context_v1('${review.scan}','${reviewClaim.content_fingerprint}',${reviewClaim.attempt_count},'${invalidReview}'::jsonb)`, { allowFailure: true })
    assert.notEqual(invalidCompletion.status, 0)
    assert.match(invalidCompletion.stderr, /creator_premium_context_schema_invalid/i)
    const reviewJson = contextResult({ decision: 'review', categories: ['age_uncertain'], uncertainty: 'ambiguous', age: 'present', rationale: ['age_requires_review'] })
    psql(db, `select public.complete_creator_premium_content_safety_context_v1('${review.scan}','${reviewClaim.content_fingerprint}',${reviewClaim.attempt_count},'${reviewJson}'::jsonb)`)
    assert.equal(JSON.parse(psql(db, `select private.creator_premium_content_safety_candidate_p2_v1('${review.scan}')`).stdout).decision, 'review')

    const blocked = { content: randomUUID(), scan: randomUUID(), analysis: randomUUID(), media: randomUUID() }
    psql(db, imageFixtureSql({ actor, ...blocked, title: 'Explicit non-consensual test fixture' }))
    const blockClaim = JSON.parse(psql(db, `select public.claim_creator_premium_content_safety_context_v1(1)`).stdout)[0]
    assert.equal(blockClaim.scan_id, blocked.scan)
    const blockJson = contextResult({ decision: 'block', categories: ['non_consensual_intimate_content'], consent: 'present', rationale: ['severe_explicit_context'] })
    psql(db, `select public.complete_creator_premium_content_safety_context_v1('${blocked.scan}','${blockClaim.content_fingerprint}',${blockClaim.attempt_count},'${blockJson}'::jsonb)`)
    assert.equal(JSON.parse(psql(db, `select private.creator_premium_content_safety_candidate_p2_v1('${blocked.scan}')`).stdout).decision, 'block')

    const fenced = { content: randomUUID(), scan: randomUUID(), analysis: randomUUID(), media: randomUUID() }
    psql(db, imageFixtureSql({ actor, ...fenced, title: 'Generation fence fixture' }))
    const firstFencedClaim = JSON.parse(psql(db, `select public.claim_creator_premium_content_safety_context_v1(1)`).stdout)[0]
    assert.equal(firstFencedClaim.scan_id, fenced.scan)
    psql(db, `update private.creator_premium_content_safety_context_evaluations set created_at=clock_timestamp()-interval '12 minutes',started_at=clock_timestamp()-interval '11 minutes' where source_scan_id='${fenced.scan}'`)
    const secondFencedClaim = JSON.parse(psql(db, `select public.claim_creator_premium_content_safety_context_v1(1)`).stdout)[0]
    assert.equal(secondFencedClaim.scan_id, fenced.scan)
    assert.equal(secondFencedClaim.attempt_count, firstFencedClaim.attempt_count + 1)
    const staleAttempt = psql(db, `select public.complete_creator_premium_content_safety_context_v1('${fenced.scan}','${firstFencedClaim.content_fingerprint}',${firstFencedClaim.attempt_count},'${allowJson}'::jsonb)`, { allowFailure: true })
    assert.notEqual(staleAttempt.status, 0)
    assert.match(staleAttempt.stderr, /creator_premium_context_attempt_stale/i)
    psql(db, `select public.complete_creator_premium_content_safety_context_v1('${fenced.scan}','${secondFencedClaim.content_fingerprint}',${secondFencedClaim.attempt_count},'${allowJson}'::jsonb)`)
    assert.equal(JSON.parse(psql(db, `select private.creator_premium_content_safety_candidate_p2_v1('${fenced.scan}')`).stdout).decision, 'allow')

    const retry = { content: randomUUID(), scan: randomUUID(), analysis: randomUUID(), media: randomUUID() }
    psql(db, imageFixtureSql({ actor, ...retry, title: 'Bounded retry fixture' }))
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const claim = JSON.parse(psql(db, `select public.claim_creator_premium_content_safety_context_v1(1)`).stdout)
      assert.equal(claim.length, 1)
      assert.equal(claim[0].scan_id, retry.scan)
      assert.equal(claim[0].attempt_count, attempt)
      if (attempt === 1) {
        const wrongFingerprint = psql(db, `select public.fail_creator_premium_content_safety_context_v1('${retry.scan}','${'0'.repeat(64)}',${claim[0].attempt_count},'provider_timeout',true,true)`, { allowFailure: true })
        assert.notEqual(wrongFingerprint.status, 0)
        assert.match(wrongFingerprint.stderr, /creator_premium_context_evaluation_not_found/i)
      }
      const receipt = JSON.parse(psql(db, `select public.fail_creator_premium_content_safety_context_v1('${retry.scan}','${claim[0].content_fingerprint}',${claim[0].attempt_count},'provider_timeout',true,true)`).stdout)
      assert.equal(receipt.context_status, attempt < 5 ? 'pending' : 'failed')
      if (attempt < 5) psql(db, `update private.creator_premium_content_safety_context_evaluations set available_at=clock_timestamp() where source_scan_id='${retry.scan}'`)
    }
    assert.equal(psql(db, `select attempt_count::text||'|'||provider_call_count::text||'|'||status from private.creator_premium_content_safety_context_evaluations where source_scan_id='${retry.scan}'`).stdout, '5|5|failed')
    assert.deepEqual(JSON.parse(psql(db, `select public.claim_creator_premium_content_safety_context_v1(1)`).stdout), [])

    const video = { content: randomUUID(), scan: randomUUID(), analysis: randomUUID(), video: randomUUID(), transcript: randomUUID() }
    psql(db, videoFixtureSql({ actor, ...video, title: 'Curso audiovisual educativo' }))
    const videoClaim = JSON.parse(psql(db, `select public.claim_creator_premium_content_safety_context_v1(1)`).stdout)[0]
    assert.equal(videoClaim.scan_id, video.scan)
    assert.equal(videoClaim.transcript_coverage, 'complete')
    assert.match(videoClaim.transcript_text, /condena la violencia/i)
    const videoAllow = contextResult({ decision: 'allow', categories: ['education'], transcript: 'complete', rationale: ['educational_context', 'quoted_or_negated_context'] })
    psql(db, `select public.complete_creator_premium_content_safety_context_v1('${video.scan}','${videoClaim.content_fingerprint}',${videoClaim.attempt_count},'${videoAllow}'::jsonb)`)
    assert.equal(JSON.parse(psql(db, `select private.creator_premium_content_safety_candidate_p2_v1('${video.scan}')`).stdout).decision, 'allow')
    psql(db, `update private.content_safety_audio_transcripts set transcript_fingerprint='${'2'.repeat(64)}' where id='${video.transcript}'`)
    assert.equal(JSON.parse(psql(db, `select private.creator_premium_content_safety_candidate_p2_v1('${video.scan}')`).stdout).decision, 'technical_failure')
    psql(db, `update private.content_safety_audio_transcripts set transcript_fingerprint='${'e'.repeat(64)}' where id='${video.transcript}'`)

    const stale = { content: randomUUID(), scan: randomUUID(), analysis: randomUUID(), media: randomUUID() }
    psql(db, imageFixtureSql({ actor, ...stale, title: 'Stale binding fixture' }))
    const staleClaim = JSON.parse(psql(db, `select public.claim_creator_premium_content_safety_context_v1(1)`).stdout)[0]
    assert.equal(staleClaim.scan_id, stale.scan)
    psql(db, `update private.creator_premium_contents set title='Stale binding fixture changed',updated_at=clock_timestamp() where id='${stale.content}'`)
    const staleCompletion = psql(db, `select public.complete_creator_premium_content_safety_context_v1('${stale.scan}','${staleClaim.content_fingerprint}',${staleClaim.attempt_count},'${allowJson}'::jsonb)`, { allowFailure: true })
    assert.notEqual(staleCompletion.status, 0)
    assert.match(staleCompletion.stderr, /creator_premium_context_binding_invalid/i)
    assert.equal(JSON.parse(psql(db, `select private.creator_premium_content_safety_candidate_p2_v1('${stale.scan}')`).stdout).decision, 'technical_failure')
  } finally {
    docker(`dropdb -U supabase_admin --if-exists ${db}`, { allowFailure: true })
  }
})
