// Real disposable PostgreSQL proof for Creator Premium QA Final F1.
// Set RUN_CREATOR_PREMIUM_F1_LOCAL=1 to execute it.
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import test from 'node:test'

const enabled = process.env.RUN_CREATOR_PREMIUM_F1_LOCAL === '1'
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

const F1_RPC_SECURITY_CASES = [
  {
    signature: 'public.submit_my_creator_premium_content_with_plans_v1(uuid,uuid[],uuid)',
    advisorFingerprint: '1c20753b55dcdb2d0a8e6a3365fcf45453495a74a49d76b9b51af4e51d7b923f',
    caseIds: [
      'submit_anon_acl', 'submit_service_role_acl', 'submit_cross_owner',
      'submit_active_plan_required', 'submit_atomic_active_version',
      'submit_idempotent_replay', 'submit_scan_enqueued', 'submit_concurrent_lock_order',
      'submit_finance_no_side_effect',
    ],
  },
  {
    signature: 'public.retire_my_creator_premium_content_v1(uuid)',
    advisorFingerprint: 'b0cdd5e8a440096ebc6bbd35fee9b785180d71ae6d06209ade7feaa6c0877c4d',
    caseIds: [
      'retire_anon_acl', 'retire_service_role_acl', 'retire_cross_owner',
      'retire_published_only', 'retire_financial_history_blocked',
      'retire_media_scan_offer_preserved', 'retire_idempotent_replay',
      'retire_finance_no_side_effect',
    ],
  },
  {
    signature: 'public.delete_my_creator_premium_plan_draft_v1(uuid,uuid)',
    advisorFingerprint: '5ceb93fa71004f64ba75a7bd251fadaf66d7ebdce81fb48904fd988ed9023fef',
    caseIds: [
      'plan_delete_anon_acl', 'plan_delete_service_role_acl', 'plan_delete_cross_owner',
      'plan_delete_draft_only', 'plan_delete_dependencies_blocked',
      'plan_delete_dependency_free', 'plan_delete_idempotent_replay',
      'plan_delete_finance_no_side_effect',
    ],
  },
]

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function gitBlobSha1(value) {
  const bytes = Buffer.from(value, 'utf8')
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

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

function psqlConcurrent(db, sql, marker = null) {
  assert.match(db, /^[a-z0-9_]+$/)
  const child = spawn('docker', [
    'exec', '-i', container, '/bin/sh', '-c',
    `psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d ${db} -At -F '|'`,
  ], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  let markerResolved = marker === null
  let resolveMarker
  let rejectMarker
  const markerReady = new Promise((resolve, reject) => {
    resolveMarker = resolve
    rejectMarker = reject
    if (markerResolved) resolve()
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    stdout += chunk
    if (!markerResolved && stdout.includes(marker)) {
      markerResolved = true
      resolveMarker()
    }
  })
  child.stderr.on('data', chunk => { stderr += chunk })
  const completion = new Promise((resolve, reject) => {
    child.on('error', error => {
      if (!markerResolved) rejectMarker(error)
      reject(error)
    })
    child.on('close', status => {
      if (!markerResolved) rejectMarker(new Error(`marker not observed: ${marker}\n${stdout}\n${stderr}`))
      resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() })
    })
  })
  child.stdin.end(sql)
  return { markerReady, completion }
}

function asRole(db, role, actor, sql, { allowFailure = false } = {}) {
  const subject = actor ? `set local request.jwt.claim.sub='${actor}';` : ''
  return psql(db, `
    begin;
    ${subject}
    set local request.jwt.claim.role='${role}';
    set local role ${role};
    ${sql};
    commit;
  `, { allowFailure })
}

function expectFailure(result, expected) {
  assert.notEqual(result.status, 0, `expected failure matching ${expected}`)
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(expected, 'i'))
}

function json(result) {
  return JSON.parse(result.stdout)
}

function mediaFixture({ owner, content, teaser, original }) {
  return `
    insert into public.media_assets(
      id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,
      mime_type,size_bytes,status,ready_at,public_url
    ) values
      ('${teaser}','${owner}','r2','image','creator_premium_teaser_image','public',
       'public-bucket','premium/${teaser}.jpg','image/jpeg',1000,'ready',clock_timestamp(),
       'https://cdn.test/${teaser}.jpg'),
      ('${original}','${owner}','r2','image','creator_premium_original_image','private',
       'private-bucket','premium/${original}.jpg','image/jpeg',2000,'ready',clock_timestamp(),null);
    insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,"position") values
      ('${teaser}','creator_premium_content','${content}','teaser',0),
      ('${original}','creator_premium_content','${content}','original',0);
  `
}

function publishedFixture({ owner, content, scan, teaser, original, title }) {
  return `
    insert into private.creator_premium_contents(
      id,creator_id,title,description,content_kind,access_mode,lifecycle_status
    ) values(
      '${content}','${owner}','${title}','F1 disposable fixture','image','subscription','draft'
    );
    ${mediaFixture({ owner, content, teaser, original })}
    insert into private.content_safety_scans(
      id,target_type,target_id,owner_user_id,content_fingerprint,status,requested_reason,
      text_status,audio_status,visual_status,reports_status,completed_at,created_at,updated_at
    ) values(
      '${scan}','creator_premium','${content}','${owner}','${'a'.repeat(64)}',
      'completed','content_created','analyzed','not_applicable','analyzed','analyzed',
      clock_timestamp(),clock_timestamp()-interval '1 second',clock_timestamp()
    );
    update private.creator_premium_contents set
      lifecycle_status='published',published_at=clock_timestamp(),
      submitted_at=clock_timestamp()-interval '1 minute',verification_scan_id='${scan}',
      verification_fingerprint='${'a'.repeat(64)}',verification_status='passed',
      verification_requested_at=clock_timestamp()-interval '2 minutes',
      verification_completed_at=clock_timestamp(),updated_at=clock_timestamp()
    where id='${content}';
  `
}

test('F1 disposable harness binds one forward migration after the activated P2 chain', () => {
  for (const item of chain) assert.equal(item.found.length, 1, item.suffix)
  assert.match(chain.at(-1).found[0], /^\d{14}_creator_premium_qa_final_f1\.sql$/)
  assert.match(chain.at(-1).sql, /submit_my_creator_premium_content_with_plans_v1/)
  assert.match(chain.at(-1).sql, /max_duration_seconds between 1 and 180/)
})

test('F1 disposable database proves 180s isolation, plan versioning, owner lifecycle, ACL, and finance invariants', {
  skip: !enabled,
  timeout: 900_000,
}, async t => {
  const db = `premium_f1_${randomUUID().replaceAll('-', '').slice(0, 10)}`
  const uid = () => randomUUID()
  const id = {
    creator: uid(), other: uid(), buyer: uid(),
    currentContent: uid(), currentScan: uid(), targetContent: uid(), currentTeaser: uid(), currentOriginal: uid(),
    targetTeaser: uid(), targetOriginal: uid(), activePlanRequest: uid(), submitRequest: uid(),
    concurrentContent: uid(), concurrentTeaser: uid(), concurrentOriginal: uid(),
    concurrentPlanRequest: uid(), concurrentCloneRequest: uid(), concurrentSubmitRequest: uid(),
    safetyVideoRequest: uid(),
    draftDeleteRequest: uid(), dependentDeleteRequest: uid(),
    published: uid(), publishedScan: uid(), publishedTeaser: uid(), publishedOriginal: uid(),
    financial: uid(), financialScan: uid(), financialTeaser: uid(), financialOriginal: uid(),
    financialPlan: uid(), subscription: uid(),
  }
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

    psql(db, `
      set session_replication_role=replica;
      insert into auth.users(id,is_anonymous) values
        ('${id.creator}',false),('${id.other}',false),('${id.buyer}',false);
      insert into public.user_profiles(id,username) values
        ('${id.creator}','f1_creator'),('${id.other}','f1_other'),('${id.buyer}','f1_buyer');
      insert into private.user_age_eligibility(
        user_id,status,minimum_age,policy_version,evaluated_at,source,age_band,birth_date
      )
      select users.id,'eligible',policy.minimum_age,policy.policy_version,
             clock_timestamp(),'signup_metadata','age_18_plus',current_date-interval '30 years'
      from (values ('${id.creator}'::uuid),('${id.other}'::uuid),('${id.buyer}'::uuid)) users(id)
      cross join private.age_eligibility_policy policy
      where policy.singleton=true;
      set session_replication_role=origin;
    `)

    const financeBefore = psql(db, `
      select (select count(*) from public.financial_transactions)||'|'||
             (select count(*) from public.ledger_entries)||'|'||
             (select count(*) from public.ledger_accounts)
    `).stdout
    const proved = new Set()

    // ACL and ownership boundaries are exact: clients cannot use the internal
    // reservation authority, anon/service_role cannot call owner RPCs, and a
    // different authenticated owner cannot mutate the target.
    for (const signature of [
      'public.submit_my_creator_premium_content_with_plans_v1(uuid,uuid[],uuid)',
      'public.retire_my_creator_premium_content_v1(uuid)',
      'public.delete_my_creator_premium_plan_draft_v1(uuid,uuid)',
    ]) {
      assert.equal(psql(db, `select has_function_privilege('authenticated','${signature}','execute')`).stdout, 't')
      assert.equal(psql(db, `select has_function_privilege('anon','${signature}','execute')`).stdout, 'f')
      assert.equal(psql(db, `select has_function_privilege('service_role','${signature}','execute')`).stdout, 'f')
      assert.equal(psql(db, `select proconfig @> array['search_path=""'] from pg_proc where oid='${signature}'::regprocedure`).stdout, 't')
      assert.equal(psql(db, `select pg_get_userbyid(proowner) from pg_proc where oid='${signature}'::regprocedure`).stdout, 'postgres')
      const prefix = signature.includes('submit_my_') ? 'submit'
        : signature.includes('retire_my_') ? 'retire' : 'plan_delete'
      proved.add(`${prefix}_anon_acl`)
      proved.add(`${prefix}_service_role_acl`)
    }

    // The existing 200 MB cap is unchanged. Premium receives 180 seconds and
    // feed keeps 60 seconds from the same server-side authority.
    const premiumAsset = uid()
    const feedAsset = uid()
    assert.equal(asRole(db, 'service_role', null, `select public.reserve_stream_upload_asset(
      '${premiumAsset}','${id.creator}','video/mp4',199999999,'premium.mp4','creator_premium_video'
    )`).stdout, 'created')
    assert.equal(asRole(db, 'service_role', null, `select public.reserve_stream_upload_asset(
      '${feedAsset}','${id.other}','video/mp4',199999999,'feed.mp4','feed_video'
    )`).stdout, 'created')
    assert.equal(psql(db, `select purpose||'|'||visibility||'|'||max_duration_seconds from public.video_assets where id='${premiumAsset}'`).stdout, 'creator_premium_video|private|180')
    assert.equal(psql(db, `select purpose||'|'||visibility||'|'||max_duration_seconds from public.video_assets where id='${feedAsset}'`).stdout, 'feed_video|public|60')
    expectFailure(psql(db, `update public.video_assets set max_duration_seconds=181 where id='${premiumAsset}'`, { allowFailure: true }), 'video_assets_(duration_limit|creator_premium_contract)_check')
    expectFailure(psql(db, `update public.video_assets set max_duration_seconds=61 where id='${feedAsset}'`, { allowFailure: true }), 'video_assets_duration_limit_check')

    const safetyVideo = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.create_my_creator_premium_draft_v1(
      'Three minute safety fixture','F1 duration proof','video','purchase','${id.safetyVideoRequest}'
    ) result`))
    psql(db, `
      update public.video_assets set
        status='ready',cloudflare_uid='f1-180-second-private-fixture',duration_seconds=180,
        ready_at=clock_timestamp(),provider_metadata='{"require_signed_urls":true}'::jsonb
      where id='${premiumAsset}';
      insert into public.video_asset_links(
        asset_id,owner_id,entity_type,entity_id,slot,"position"
      ) values(
        '${premiumAsset}','${id.creator}','creator_premium_content','${safetyVideo.id}','original',0
      );
    `)
    assert.equal(psql(db, `select (private.content_safety_audio_source('creator_premium','${safetyVideo.id}')#>>'{kind}')||'|'||(private.content_safety_audio_source('creator_premium','${safetyVideo.id}')#>>'{duration_seconds}')`).stdout, 'eligible|180')
    assert.equal(psql(db, `select (private.content_safety_visual_source('creator_premium','${safetyVideo.id}')#>>'{kind}')||'|'||(private.content_safety_visual_source('creator_premium','${safetyVideo.id}')#>>'{duration_seconds}')`).stdout, 'eligible_stream_video|180')
    const safetyScan = psql(db, `select private.enqueue_content_safety_scan('creator_premium','${safetyVideo.id}','content_created')`).stdout
    assert.match(safetyScan, /^[0-9a-f-]{36}$/i)
    const audioClaim = json(asRole(db, 'service_role', null, 'select public.claim_content_safety_audio_scans(1)'))[0]
    assert.equal(audioClaim.scan_id, safetyScan)
    assert.equal(audioClaim.duration_seconds, 180)
    const visualClaim = json(asRole(db, 'service_role', null, 'select public.claim_content_safety_visual_scans(1)'))[0]
    assert.equal(visualClaim.scan_id, safetyScan)
    assert.equal(visualClaim.duration_seconds, 180)

    const createDraft = (title, access, request) => {
      const created = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.create_my_creator_premium_draft_v1(
        '${title}','F1 disposable proof','image','${access}','${request}'
      ) result`))
      return created
    }
    psql(db, publishedFixture({
      owner: id.creator, content: id.currentContent, scan: id.currentScan,
      teaser: id.currentTeaser, original: id.currentOriginal, title: 'Current plan content',
    }))
    id.targetContent = createDraft('New subscription content', 'subscription', id.targetContent).id
    psql(db, `
      ${mediaFixture({ owner: id.creator, content: id.targetContent, teaser: id.targetTeaser, original: id.targetOriginal })}
    `)
    for (const row of [[id.targetContent, id.targetTeaser, id.targetOriginal]]) {
      assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_image_media_v1(
        '${row[0]}','${row[1]}','${row[2]}'
      ) result`)).media_ready, true)
    }
    const activePlan = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.create_my_creator_premium_plan_draft_v1(
      'F1 VIP','Versioned plan',1500.00000000,30,'${id.activePlanRequest}'
    ) result`))
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_plan_contents_v1(
      '${activePlan.id}',array['${id.currentContent}']::uuid[]
    ) result`)).mapped_content_count, 1)
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.activate_my_creator_premium_plan_v1('${activePlan.id}') result`)).status, 'active')

    // Two real sessions prove the canonical family -> plan -> content lock order.
    // The activation session owns the family lock before submit starts. With the
    // previous content-first F1 order this forms a deterministic deadlock; the
    // fixed submit waits without owning the content row, so activation reaches
    // its expected domain rejection and submit then completes.
    const concurrent = createDraft('Concurrent subscription content', 'subscription', id.concurrentContent)
    psql(db, mediaFixture({
      owner: id.creator, content: concurrent.id,
      teaser: id.concurrentTeaser, original: id.concurrentOriginal,
    }))
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_image_media_v1(
      '${concurrent.id}','${id.concurrentTeaser}','${id.concurrentOriginal}'
    ) result`)).media_ready, true)
    const concurrentPlan = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.create_my_creator_premium_plan_draft_v1(
      'Concurrency family','Lock ordering proof',99.00000000,30,'${id.concurrentPlanRequest}'
    ) result`))
    asRole(db, 'authenticated', id.creator, `select public.set_my_creator_premium_plan_contents_v1(
      '${concurrentPlan.id}',array['${id.currentContent}']::uuid[]
    )`)
    asRole(db, 'authenticated', id.creator, `select public.activate_my_creator_premium_plan_v1('${concurrentPlan.id}')`)
    const concurrentClone = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.clone_my_creator_premium_plan_version_v1(
      '${concurrentPlan.id}','${id.concurrentCloneRequest}'
    ) result`))
    asRole(db, 'authenticated', id.creator, `select public.set_my_creator_premium_plan_contents_v1(
      '${concurrentClone.id}',array['${id.currentContent}','${concurrent.id}']::uuid[]
    )`)
    const concurrentPlanKey = psql(db, `select plan_key from private.creator_premium_plans where id='${concurrentClone.id}'`).stdout
    assert.match(concurrentPlanKey, /^[a-z0-9_]+$/)
    const activation = psqlConcurrent(db, `
      begin;
      select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        'creator-premium-plan-version:${id.creator}:${concurrentPlanKey}',0
      ));
      select 'F1_FAMILY_LOCK_READY';
      select pg_catalog.pg_sleep(1);
      set local request.jwt.claim.sub='${id.creator}';
      set local request.jwt.claim.role='authenticated';
      set local role authenticated;
      do $activation$
      begin
        perform 1 from public.activate_my_creator_premium_plan_v1('${concurrentClone.id}');
        raise exception 'expected activation domain rejection';
      exception when sqlstate '55000' then
        if sqlerrm <> 'creator_premium_plan_content_review_required' then raise; end if;
      end
      $activation$;
      select 'F1_ACTIVATION_EXPECTED_BLOCK';
      commit;
    `, 'F1_FAMILY_LOCK_READY')
    await activation.markerReady
    const concurrentSubmit = psqlConcurrent(db, `
      begin;
      set local request.jwt.claim.sub='${id.creator}';
      set local request.jwt.claim.role='authenticated';
      set local role authenticated;
      select to_jsonb(result) from public.submit_my_creator_premium_content_with_plans_v1(
        '${concurrent.id}',array['${concurrentPlan.id}']::uuid[],'${id.concurrentSubmitRequest}'
      ) result;
      commit;
    `)
    const [activationResult, submitResult] = await Promise.all([
      activation.completion,
      concurrentSubmit.completion,
    ])
    assert.equal(activationResult.status, 0, activationResult.stderr)
    assert.match(activationResult.stdout, /F1_ACTIVATION_EXPECTED_BLOCK/)
    assert.equal(submitResult.status, 0, `${submitResult.stdout}\n${submitResult.stderr}`)
    assert.doesNotMatch(`${activationResult.stderr}\n${submitResult.stderr}`, /deadlock detected/i)
    assert.equal(JSON.parse(submitResult.stdout.split(/\r?\n/).find(line => line.startsWith('{'))).lifecycle_status, 'pending_review')
    proved.add('submit_concurrent_lock_order')

    expectFailure(asRole(db, 'authenticated', id.creator, `select public.submit_my_creator_premium_content_with_plans_v1(
      '${id.targetContent}',array[]::uuid[],'${uid()}'
    )`, { allowFailure: true }), 'creator_premium_active_plan_required')
    proved.add('submit_active_plan_required')
    expectFailure(asRole(db, 'authenticated', id.other, `select public.submit_my_creator_premium_content_with_plans_v1(
      '${id.targetContent}',array['${activePlan.id}']::uuid[],'${id.submitRequest}'
    )`, { allowFailure: true }), 'creator_premium_content_not_found')
    proved.add('submit_cross_owner')
    const submitted = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.submit_my_creator_premium_content_with_plans_v1(
      '${id.targetContent}',array['${activePlan.id}']::uuid[],'${id.submitRequest}'
    ) result`))
    assert.equal(submitted.lifecycle_status, 'pending_review')
    assert.equal(submitted.replayed, false)
    assert.equal(submitted.versioned_plan_ids.length, 1)
    assert.equal(submitted.active_plan_ids.length, 1)
    assert.notEqual(submitted.active_plan_ids[0], activePlan.id)
    proved.add('submit_atomic_active_version')
    const replayed = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.submit_my_creator_premium_content_with_plans_v1(
      '${id.targetContent}',array['${activePlan.id}']::uuid[],'${id.submitRequest}'
    ) result`))
    assert.equal(replayed.replayed, true)
    proved.add('submit_idempotent_replay')
    assert.equal(psql(db, `select status from private.creator_premium_plans where id='${activePlan.id}'`).stdout, 'retired')
    assert.equal(psql(db, `select count(*) from private.creator_premium_plan_contents where content_id='${id.targetContent}' and plan_id=any(array[${submitted.active_plan_ids.map(plan => `'${plan}'::uuid`).join(',')}])`).stdout, '1')
    assert.equal(psql(db, `select count(*) from private.content_safety_scans where target_type='creator_premium' and target_id='${id.targetContent}'`).stdout, '1')
    proved.add('submit_scan_enqueued')

    // A dependency-free draft is the only plan row that may be physically
    // deleted. Replay remains deterministic even though the row is gone.
    const draft = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.create_my_creator_premium_plan_draft_v1(
      'Disposable draft','No dependencies',20.00000000,30,'${id.draftDeleteRequest}'
    ) result`))
    expectFailure(asRole(db, 'authenticated', id.other, `select public.delete_my_creator_premium_plan_draft_v1('${draft.id}','${uid()}')`, { allowFailure: true }), 'creator_premium_plan_not_found')
    proved.add('plan_delete_cross_owner')
    const deleted = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.delete_my_creator_premium_plan_draft_v1('${draft.id}','${id.draftDeleteRequest}') result`))
    assert.equal(deleted.deleted, true)
    assert.equal(deleted.replayed, false)
    proved.add('plan_delete_dependency_free')
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.delete_my_creator_premium_plan_draft_v1('${draft.id}','${id.draftDeleteRequest}') result`)).replayed, true)
    proved.add('plan_delete_idempotent_replay')
    assert.equal(psql(db, `select count(*) from private.creator_premium_plans where id='${draft.id}'`).stdout, '0')

    const dependentDraft = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.create_my_creator_premium_plan_draft_v1(
      'Dependent draft','Must be preserved',21.00000000,30,'${id.dependentDeleteRequest}'
    ) result`))
    asRole(db, 'authenticated', id.creator, `select public.set_my_creator_premium_plan_contents_v1(
      '${dependentDraft.id}',array['${id.currentContent}']::uuid[]
    )`)
    expectFailure(asRole(db, 'authenticated', id.creator, `select public.delete_my_creator_premium_plan_draft_v1(
      '${dependentDraft.id}','${uid()}'
    )`, { allowFailure: true }), 'creator_premium_plan_has_dependencies')
    proved.add('plan_delete_dependencies_blocked')
    expectFailure(asRole(db, 'authenticated', id.creator, `select public.delete_my_creator_premium_plan_draft_v1(
      '${submitted.active_plan_ids[0]}','${uid()}'
    )`, { allowFailure: true }), 'creator_premium_plan_draft_only')
    proved.add('plan_delete_draft_only')

    // Owner withdrawal preserves scan/media history and retires the active
    // offer. A different owner is denied; replay is harmless.
    psql(db, publishedFixture({
      owner: id.creator, content: id.published, scan: id.publishedScan,
      teaser: id.publishedTeaser, original: id.publishedOriginal, title: 'Published removable',
    }))
    psql(db, `insert into private.creator_premium_offer_versions(
      content_id,creator_id,version,price_bdag,currency,status,activated_at
    ) values('${id.published}','${id.creator}',1,10.00000000,'BDAG','active',clock_timestamp())`)
    expectFailure(asRole(db, 'authenticated', id.other, `select public.retire_my_creator_premium_content_v1('${id.published}')`, { allowFailure: true }), 'creator_premium_content_not_found')
    proved.add('retire_cross_owner')
    expectFailure(asRole(db, 'authenticated', id.creator, `select public.retire_my_creator_premium_content_v1('${id.targetContent}')`, { allowFailure: true }), 'creator_premium_content_published_only')
    proved.add('retire_published_only')
    const retired = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.retire_my_creator_premium_content_v1('${id.published}') result`))
    assert.equal(retired.lifecycle_status, 'removed')
    assert.equal(retired.replayed, false)
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.retire_my_creator_premium_content_v1('${id.published}') result`)).replayed, true)
    proved.add('retire_idempotent_replay')
    assert.equal(psql(db, `select status from private.creator_premium_offer_versions where content_id='${id.published}'`).stdout, 'retired')
    assert.equal(psql(db, `select count(*) from public.media_asset_links where entity_type='creator_premium_content' and entity_id='${id.published}'`).stdout, '2')
    assert.equal(psql(db, `select count(*) from private.content_safety_scans where id='${id.publishedScan}'`).stdout, '1')
    proved.add('retire_media_scan_offer_preserved')

    // Existing subscriber obligations block withdrawal without touching the
    // subscription, content, media, or any financial authority.
    psql(db, publishedFixture({
      owner: id.creator, content: id.financial, scan: id.financialScan,
      teaser: id.financialTeaser, original: id.financialOriginal, title: 'Published subscribed',
    }))
    psql(db, `
      insert into private.creator_premium_plans(
        id,creator_id,plan_key,version,name,description,price_bdag,currency,
        billing_period_days,status,activated_at
      ) values(
        '${id.financialPlan}','${id.creator}','financial_fixture',1,'Financial fixture','',
        30.00000000,'BDAG',30,'draft',null
      );
      insert into private.creator_premium_plan_contents(plan_id,content_id,creator_id)
      values('${id.financialPlan}','${id.financial}','${id.creator}');
      update private.creator_premium_plans set status='active',activated_at=clock_timestamp()
      where id='${id.financialPlan}';
      insert into private.creator_premium_subscriptions(
        id,subscriber_id,creator_id,plan_id,idempotency_key,status,started_at
      ) values(
        '${id.subscription}','${id.buyer}','${id.creator}','${id.financialPlan}','${uid()}',
        'active',clock_timestamp()
      );
    `)
    expectFailure(asRole(db, 'authenticated', id.creator, `select public.retire_my_creator_premium_content_v1('${id.financial}')`, { allowFailure: true }), 'creator_premium_content_has_financial_history')
    proved.add('retire_financial_history_blocked')
    assert.equal(psql(db, `select lifecycle_status from private.creator_premium_contents where id='${id.financial}'`).stdout, 'published')
    assert.equal(psql(db, `select status from private.creator_premium_subscriptions where id='${id.subscription}'`).stdout, 'active')

    assert.equal(psql(db, `select private.creator_premium_content_safety_policy_p1_v1()#>>'{activation,enabled}'`).stdout, 'true')
    assert.equal(psql(db, `select private.creator_premium_content_safety_policy_p1_v1()#>>'{activation,auto_publish_enabled}'`).stdout, 'true')
    assert.equal(psql(db, `select purchase_enabled||'|'||subscription_enabled||'|'||refunds_enabled||'|'||platform_fee_bps from private.creator_premium_finance_policy where singleton`).stdout, 'false|false|false|0')
    assert.equal(psql(db, `
      select (select count(*) from public.financial_transactions)||'|'||
             (select count(*) from public.ledger_entries)||'|'||
             (select count(*) from public.ledger_accounts)
    `).stdout, financeBefore)
    for (const prefix of ['submit','retire','plan_delete']) proved.add(`${prefix}_finance_no_side_effect`)

    const expectedCaseIds = F1_RPC_SECURITY_CASES.flatMap(item => item.caseIds).sort()
    assert.deepEqual([...proved].sort(), expectedCaseIds)
    const migrationSql = chain.at(-1).sql
    const migrationBlob = gitBlobSha1(migrationSql)
    const evidence = {
      schema_version: 1,
      migration_blob: migrationBlob,
      rpcs: F1_RPC_SECURITY_CASES.map(item => ({
        signature: item.signature,
        fingerprint: item.advisorFingerprint,
        case_ids: [...item.caseIds],
        result: 'SAFE',
      })),
      result: 'PASS',
    }
    const evidenceSha256 = createHash('sha256')
      .update(`${canonicalJson(evidence)}\n`, 'utf8').digest('hex')
    t.diagnostic(`F1_RPC_SECURITY_EVIDENCE_SHA256 ${evidenceSha256}`)
    t.diagnostic(`F1_MIGRATION_BLOB ${migrationBlob}`)
    for (const item of F1_RPC_SECURITY_CASES) {
      const encoded = psql(db, `select pg_catalog.translate(
        pg_catalog.encode(pg_catalog.convert_to(pg_catalog.pg_get_functiondef('${item.signature}'::regprocedure),'UTF8'),'base64'),
        E'\\n\\r',''
      )`).stdout
      const definition = Buffer.from(encoded, 'base64').toString('utf8').replace(/\r\n?/g, '\n')
      const definitionSha256 = createHash('sha256').update(definition).digest('hex')
      t.diagnostic(`F1_RPC_DEFINITION_SHA256 ${item.signature} ${definitionSha256}`)
    }
  } finally {
    docker(`dropdb -U supabase_admin --if-exists ${db}`, { allowFailure: true })
  }
})
