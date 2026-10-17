import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { FINANCE_SNAPSHOT_SQL } from '../scripts/nelyon-production-snapshot-adapter.mjs';

const enabled = process.env.RUN_CREATOR_PREMIUM_B7_LOCAL === '1';
const container = process.env.CREATOR_PREMIUM_PG_CONTAINER || 'nelyon-ads-v2-d-compile';
const template = process.env.CREATOR_PREMIUM_PG_TEMPLATE || 'algo6_final_compile_a2';
const wslNamespacePid = process.env.CREATOR_PREMIUM_PG_WSL_PID || '';
const migrations = new URL('../supabase/migrations/', import.meta.url);
const phases = [
  '_creator_premium_b1_canonical_foundation.sql',
  '_creator_premium_b2_private_image_media.sql',
  '_creator_premium_b3_signed_stream_playback.sql',
  '_creator_premium_b4_atomic_finance_authority.sql',
  '_creator_premium_b4_c1_exact_fee_snapshot_binding.sql',
  '_creator_premium_b5_creator_management_ux.sql',
  '_creator_premium_b7_full_functional_commercial_completion.sql',
];
const chain = phases.map(suffix => {
  const found = readdirSync(migrations).filter(name => name.endsWith(suffix));
  return {
    suffix,
    found,
    sql: found.length === 1 ? readFileSync(new URL(`../supabase/migrations/${found[0]}`, import.meta.url), 'utf8') : '',
  };
});
const c1Files = readdirSync(migrations).filter(name => name.endsWith('_creator_premium_c1_submission_cancellation.sql'));
const c1Sql = c1Files.length === 1
  ? readFileSync(new URL(`../supabase/migrations/${c1Files[0]}`, import.meta.url), 'utf8')
  : '';

const A2_B7_BLOB = '43f014260e0ecfa6f0634e61e1646594bcf13e1d';
const C1_MIGRATION_BLOB = '4605ac94221a52d47190b1575ab1a71e23c82fac';
const C1_RPC_SECURITY_CASE = {
  signature: 'public.cancel_my_creator_premium_submission_v1(uuid)',
  fingerprint: '053c9a441c11dc657382c6448b017d8fcf73c16fb5a3e4baf6275e24e2216129',
  caseIds: [
    'cancel_anon_acl',
    'cancel_auth_required',
    'cancel_concurrent_idempotent',
    'cancel_cross_owner',
    'cancel_finance_no_side_effect',
    'cancel_invalid_state',
    'cancel_media_offer_history_preserved',
    'cancel_service_role_acl',
    'cancel_stale_scan_generation_fenced',
  ],
};
const A2_RPC_SECURITY_CASES = [
  {
    signature: 'public.admin_refund_creator_premium_purchase_v1(uuid,uuid,text)',
    fingerprint: 'ed47c5c8fd92b0a9111c500797b896e5f4adda72528447877e07d3bf7fc976f4',
    caseIds: ['purchase_refund_anon_acl', 'purchase_refund_user_denied', 'purchase_refund_admin_without_capability', 'purchase_refund_invalid_input', 'purchase_refund_finance_off_no_side_effect', 'purchase_refund_authorized_idempotent_concurrency'],
  },
  {
    signature: 'public.admin_refund_creator_premium_subscription_period_v1(uuid,uuid,text)',
    fingerprint: '3bafc12c90e4b6b681d940783a2f7c18f4fff412914dfe089273361e4a985a3d',
    caseIds: ['period_refund_anon_acl', 'period_refund_user_denied', 'period_refund_admin_without_capability', 'period_refund_invalid_input', 'period_refund_finance_off_no_side_effect', 'period_refund_authorized_idempotent'],
  },
  {
    signature: 'public.admin_review_creator_premium_content_v1(uuid,text,text,uuid)',
    fingerprint: '818953854378a3580fa558d66b184ae7ceacac35521ce7b31c24c077cf8c5aa4',
    caseIds: ['admin_review_anon_acl', 'admin_review_user_denied', 'admin_review_admin_without_capability', 'admin_review_invalid_input', 'admin_review_exact_replay_conflict', 'admin_restore_fresh_scan_no_fabricated_pass'],
  },
  {
    signature: 'public.get_admin_creator_premium_content_v1(uuid)',
    fingerprint: '1e59a5e4beb48d63e41b8f19d6cdff3470ec18e0ca57b3d35348bd2fc0921596',
    caseIds: ['admin_detail_anon_acl', 'admin_detail_user_denied', 'admin_detail_admin_without_capability', 'admin_detail_authorized_read'],
  },
  {
    signature: 'public.get_admin_creator_premium_refund_candidates_v1(uuid)',
    fingerprint: 'bd0ce992865c9e2c34a64970b0c9c0a619a0d604d0a046429ec9c030ccd3d709',
    caseIds: ['refund_candidates_anon_acl', 'refund_candidates_user_denied', 'refund_candidates_admin_without_capability', 'refund_candidates_authorized_read'],
  },
  {
    signature: 'public.get_creator_premium_commerce_v1(uuid)',
    fingerprint: '00657ba374cdad7085ed6b574482e19d7fa16907edcc701c94fc18c87961edb2',
    caseIds: ['commerce_anon_acl', 'commerce_auth_required', 'commerce_invalid_target', 'commerce_published_visibility_no_private_locator', 'commerce_finance_off'],
  },
  {
    signature: 'public.get_my_creator_premium_commercial_summary_v1(timestamptz,timestamptz)',
    fingerprint: '4840132edacadeb572fa8fd51214941fda033da797e4d60aa6cb1bb1fd7004af',
    caseIds: ['summary_anon_acl', 'summary_auth_required', 'summary_invalid_range', 'summary_caller_only'],
  },
  {
    signature: 'public.get_my_creator_premium_subscriptions_v1(timestamptz,uuid,integer)',
    fingerprint: '6c2cb58d906d98f9a58d63890eabe14a123dae7c93c177e131e284b720154c88',
    caseIds: ['subscriptions_anon_acl', 'subscriptions_auth_required', 'subscriptions_half_cursor', 'subscriptions_caller_only'],
  },
  {
    signature: 'public.reopen_my_creator_premium_rejected_v1(uuid)',
    fingerprint: '977f751ed2fa6c2202aac797ca71df433a804b90a7c6cc667bd2813dd5c33adc',
    caseIds: ['reopen_anon_acl', 'reopen_auth_required', 'reopen_invalid_target', 'reopen_cross_owner', 'reopen_rejected_only', 'reopen_financial_history', 'reopen_lock_concurrency_no_scan'],
  },
  {
    signature: 'public.report_creator_premium_content_v1(uuid,text,text)',
    fingerprint: '91d927799c49e43c6e0f70e789a71a58ab4d39f10c0704f9aa7bfab2e9da7bcb',
    caseIds: ['report_anon_acl', 'report_auth_required', 'report_invalid_input', 'report_self_forbidden', 'report_concurrency_single_pending', 'report_no_private_locator'],
  },
  {
    signature: 'public.search_admin_creator_premium_content_v1(text,text,timestamptz,uuid,integer)',
    fingerprint: '67c61f041625ca6c348fdadffed8e2a997e40e1b6a7b6e4005d7e0ca8e7f8720',
    caseIds: ['admin_search_anon_acl', 'admin_search_user_denied', 'admin_search_admin_without_capability', 'admin_search_invalid_status', 'admin_search_half_cursor', 'admin_search_authorized_read'],
  },
];

function docker(command, { input = '', allowFailure = false } = {}) {
  const executable = wslNamespacePid ? 'wsl.exe' : 'docker';
  const args = wslNamespacePid
    ? ['-d', 'docker-desktop', '-u', 'root', '-e', 'nsenter', '-t', wslNamespacePid,
      '-m', '-u', '-i', '-n', '-p', '/bin/sh', '-c', command]
    : ['exec', '-i', container, '/bin/sh', '-c', command];
  const result = spawnSync(executable, args, {
    encoding: 'utf8', input, maxBuffer: 96 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`docker command failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function dockerAsync(command, { input = '' } = {}) {
  const executable = wslNamespacePid ? 'wsl.exe' : 'docker';
  const args = wslNamespacePid
    ? ['-d', 'docker-desktop', '-u', 'root', '-e', 'nsenter', '-t', wslNamespacePid,
      '-m', '-u', '-i', '-n', '-p', '/bin/sh', '-c', command]
    : ['exec', '-i', container, '/bin/sh', '-c', command];
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.stdin.end(input);
  });
}

function psql(db, sql, options = {}) {
  assert.match(db, /^[a-z0-9_]+$/);
  return docker(`psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d ${db} -At -F '|'`, { input: sql, ...options });
}

function asRole(db, role, actor, sql, options = {}) {
  const subject = actor ? `set local request.jwt.claim.sub='${actor}';` : '';
  return psql(db, `begin;${subject}set local request.jwt.claim.role='${role}';set local role ${role};${sql};commit;`, options);
}

function asRoleAsync(db, role, actor, sql) {
  const subject = actor ? `set local request.jwt.claim.sub='${actor}';` : '';
  return dockerAsync(`psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d ${db} -At -F '|'`, {
    input: `begin;${subject}set local request.jwt.claim.role='${role}';set local role ${role};${sql};commit;`,
  });
}

function expectFailure(result, expected) {
  assert.notEqual(result.status, 0, `expected failure matching ${expected}`);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(expected, 'i'));
}

function json(result) {
  return JSON.parse(result.stdout);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

test('B7 disposable harness targets the complete single-migration Premium chain', () => {
  for (const item of chain) assert.equal(item.found.length, 1, item.suffix);
  assert.match(chain.at(-1).found[0], /^\d{14}_creator_premium_b7_full_functional_commercial_completion\.sql$/);
  assert.ok(chain.at(-1).sql.length > 20_000);
});

test('C1 disposable harness binds exactly one forward-only cancellation migration', () => {
  assert.equal(c1Files.length, 1);
  assert.match(c1Files[0], /^\d{14}_creator_premium_c1_submission_cancellation\.sql$/);
  assert.match(c1Sql, /cancel_my_creator_premium_submission_v1/);
});

test('B7 disposable harness contains executable lifecycle and financial invariants, not install-only smoke checks', () => {
  const source = readFileSync(new URL('./creatorPremiumB7Local.integration.mjs', import.meta.url), 'utf8');
  for (const contract of [
    'create_my_creator_premium_draft_v1',
    'submit_my_creator_premium_content_for_review_v1',
    'claim_content_safety_scans',
    'complete_content_safety_visual_analysis',
    'complete_content_safety_audio_transcription',
    'reconcile_creator_premium_publications_v1',
    'admin_review_creator_premium_content_v1',
    'admin_review_content_safety_alert',
    'purchase_creator_premium_content_v1',
    'subscribe_creator_premium_plan_v1',
    'cancel_creator_premium_subscription_v1',
    'admin_refund_creator_premium_purchase_v1',
    'admin_refund_creator_premium_subscription_period_v1',
    'get_my_creator_premium_entitlement_v1',
    'report_creator_premium_content_v1',
    'ledger_entries',
    'admin_action_audit',
    'admin_idempotency_conflict',
    'money_moved',
    'replayed',
    'already_refunded',
    'rollback',
    'creator_premium_legacy_reverification_required',
  ]) assert.match(source, new RegExp(contract, 'i'), `missing executable proof: ${contract}`);
  assert.match(source, /1000[\s\S]*1\.00000000[\s\S]*9\.00000000/i, 'exact eight-decimal fee fixture is required');
  assert.match(source, /count\s*\(\s*\*\s*\)[\s\S]*public\.ledger_entries/i);
});

test('A2 RPC security matrix contains executable case coverage', () => {
  assert.equal(A2_RPC_SECURITY_CASES.length, 11);
  const source = readFileSync(new URL('./creatorPremiumB7Local.integration.mjs', import.meta.url), 'utf8');
  const marker = "test('B7 disposable database denies unauthorized access to all eleven A2 RPCs'";
  const executable = source.slice(source.lastIndexOf(marker));
  for (const item of A2_RPC_SECURITY_CASES) {
    assert.match(executable, new RegExp(item.signature.split(/[.(]/)[1], 'i'), `missing RPC execution: ${item.signature}`);
    for (const caseId of item.caseIds) {
      assert.match(executable, new RegExp(`proved\\.add\\(['\"]${caseId}['\"]\\)`), `missing executable A2 case: ${caseId}`);
    }
  }
});

test('B7 disposable database denies unauthorized access to all eleven A2 RPCs', {
  skip: !enabled,
  timeout: 900_000,
}, async t => {
  const db = `premium_b7_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const uid = () => randomUUID();
  const id = {
    creator: uid(), buyer: uid(), other: uid(), admin: uid(), limitedAdmin: uid(),
    purchaseRequest: uid(), subscriptionRequest: uid(), moderationRequest: uid(), blockedRequest: uid(),
    purchaseOfferRequest: uid(), moderationOfferRequest: uid(), blockedOfferRequest: uid(), planRequest: uid(),
    purchaseKey: uid(), subscriptionKey: uid(), cancelKey: uid(), safetyDismissKey: uid(),
    purchaseRefundKey: uid(), periodRefundKey: uid(), rollbackKey: uid(),
    purchaseTeaser: uid(), purchaseOriginal: uid(), subscriptionTeaser: uid(), subscriptionVideo: uid(),
    moderationTeaser: uid(), moderationOriginal: uid(), blockedTeaser: uid(), blockedOriginal: uid(),
    legacyCreator: uid(), legacyPending: uid(), legacyDeleted: uid(),
    legacyPendingRequest: uid(), legacyDeletedRequest: uid(), legacyOfferRequest: uid(),
    legacyTeaser: uid(), legacyOriginal: uid(),
    modeSwitchRequest: uid(), modeSwitchOfferRequest: uid(), modeSwitchPlanRequest: uid(),
    reopenRequest: uid(), reopenOfferRequest: uid(), reopenTeaser: uid(), reopenOriginal: uid(),
    c1CancelRequest: uid(), c1CancelOfferRequest: uid(), c1CancelTeaser: uid(), c1CancelOriginal: uid(),
  };
  const proved = new Set();
  const c1Proved = new Set();
  const service = (name, args, options = {}) => asRole(
    db, 'service_role', null,
    `select public.${name}(${args.map(value => `'${value}'`).join(',')})`,
    options,
  );
  const adminCommand = (name, args, options = {}) => asRole(
    db, 'authenticated', id.admin,
    `select public.${name}(${args.map(value => `'${value}'`).join(',')})`,
    options,
  );
  const adminCommandAsync = (name, args) => asRoleAsync(
    db, 'authenticated', id.admin,
    `select public.${name}(${args.map(value => `'${value}'`).join(',')})`,
  );
  const createDraft = (title, access, request, kind = 'image') => json(asRole(db, 'authenticated', id.creator, `
    select to_jsonb(result) from public.create_my_creator_premium_draft_v1(
      '${title}','B7 disposable proof','${kind}','${access}','${request}'
    ) result;
  `));
  const imageAsset = (assetId, purpose, visibility, publicUrl = null, ownerId = id.creator) => `
    insert into public.media_assets(
      id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,
      mime_type,size_bytes,status,ready_at,public_url
    ) values(
      '${assetId}','${ownerId}','r2','image','${purpose}','${visibility}',
      '${visibility === 'public' ? 'public-bucket' : 'private-bucket'}',
      'premium/${assetId}.jpg','image/jpeg',1000,'ready',clock_timestamp(),
      ${publicUrl ? `'${publicUrl}'` : 'null'}
    );`;
  const streamAsset = assetId => `
    insert into public.video_assets(
      id,owner_id,provider,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes,
      max_duration_seconds,duration_seconds,ready_at,provider_metadata,hls_url,dash_url,thumbnail_url
    ) values(
      '${assetId}','${id.creator}','cloudflare_stream','creator_premium_video','private','ready',
      'premium-${assetId}','video/mp4',2000,60,12,clock_timestamp(),
      '{"require_signed_urls":true}'::jsonb,null,null,null
    );`;
  const completeAutomaticSafety = (blockedContentIds = []) => {
    const blocked = new Set(blockedContentIds);
    const textClaims = json(asRole(db, 'service_role', null, 'select public.claim_content_safety_scans(25)'));
    for (const claim of textClaims) {
      assert.equal(claim.target_type, 'creator_premium');
      json(asRole(db, 'service_role', null, `select public.complete_content_safety_scan('${claim.id}','[]'::jsonb)`));
    }

    for (let index = 0; index < 10; index += 1) {
      const claims = json(asRole(db, 'service_role', null, 'select public.claim_content_safety_audio_scans(1)'));
      if (claims.length === 0) break;
      const claim = claims[0];
      assert.equal(claim.target_type, 'creator_premium');
      const transcriptFingerprint = createHash('sha256').update(`audio:${claim.target_id}`).digest('hex');
      json(asRole(db, 'service_role', null, `select public.complete_content_safety_audio_transcription(
        '${claim.scan_id}','${claim.source_asset_id}','${claim.content_fingerprint}','en','safe transcript',2,
        '[{"start":0,"end":1,"text":"safe transcript"}]'::jsonb,false,'${transcriptFingerprint}',false
      )`));
    }
    const transcriptClaims = json(asRole(db, 'service_role', null, 'select public.claim_content_safety_transcript_evaluations(25)'));
    for (const claim of transcriptClaims) {
      json(asRole(db, 'service_role', null, `select public.complete_content_safety_transcript_evaluation(
        '${claim.transcript_id}','${claim.ruleset_fingerprint}','[]'::jsonb
      )`));
    }

    for (let index = 0; index < 20; index += 1) {
      const claims = json(asRole(db, 'service_role', null, 'select public.claim_content_safety_visual_scans(1)'));
      if (claims.length === 0) break;
      const claim = claims[0];
      assert.equal(claim.target_type, 'creator_premium');
      const isBlocked = blocked.has(claim.target_id);
      const result = isBlocked
        ? { schema_version: 'visual-safety-v1', review_required: true, findings: [{ category: 'sexual', triage_level: 'critical', description: 'Disposable severe safety signal', frame_index: null }], summary: 'Severe disposable safety signal.' }
        : { schema_version: 'visual-safety-v1', review_required: false, findings: [], summary: 'No disposable safety signal.' };
      const timestamps = claim.source_kind === 'eligible_stream_video' ? 'array[0]::integer[]' : 'array[]::integer[]';
      const analysisFingerprint = createHash('sha256').update(`visual:${claim.target_id}:${JSON.stringify(result)}`).digest('hex');
      json(asRole(db, 'service_role', null, `select public.complete_content_safety_visual_analysis(
        '${claim.scan_id}','${claim.content_fingerprint}','${JSON.stringify(result)}'::jsonb,
        '${analysisFingerprint}',${timestamps}
      )`));
    }
    return json(asRole(db, 'service_role', null, 'select public.reconcile_creator_premium_publications_v1(50)'));
  };
  const balances = () => psql(db, `
    select jsonb_object_agg(coalesce(owner_id::text,account_type),balance
      order by coalesce(owner_id::text,account_type))
    from public.ledger_accounts
    where (owner_id in ('${id.creator}','${id.buyer}') and account_type='user')
       or (owner_id is null and account_type='platform' and currency='BDAG');
  `).stdout;
  const financeCounts = () => psql(db, `
    select count(*)||'|'||(select count(*) from public.ledger_entries)
    from public.financial_transactions;
  `).stdout;
  const securityState = () => psql(db, `
    select pg_catalog.jsonb_build_object(
      'reports',(select pg_catalog.count(*) from public.reports),
      'admin_audit',(select pg_catalog.count(*) from private.admin_action_audit),
      'financial_transactions',(select pg_catalog.count(*) from public.financial_transactions),
      'ledger_entries',(select pg_catalog.count(*) from public.ledger_entries),
      'ledger_balance',(select coalesce(pg_catalog.sum(balance),0)::text from public.ledger_accounts),
      'content_lifecycle',(select coalesce(pg_catalog.jsonb_object_agg(id::text,lifecycle_status order by id),'{}'::jsonb) from private.creator_premium_contents),
      'scans',(select pg_catalog.count(*) from private.content_safety_scans)
    );
  `).stdout;
  try {
    docker(`createdb -U supabase_admin -T ${template} ${db}`);
    // Schema-only production clones do not necessarily retain the complete
    // canonical admin-role seed catalog. B7 deliberately grants moderation
    // capabilities to MODERATOR, so restore that canonical identity in the
    // disposable database instead of weakening the migration's foreign key.
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
    `);
    psql(db, chain.slice(0, -1).map(item => item.sql).join('\n'));

    // Reproduce the exact classes of B5 rows observed before B7: a private
    // purchase with ready media + active offer already pending review, and a
    // deleted row. Install B7 only after these fixtures exist.
    psql(db, `
      set session_replication_role=replica;
      insert into auth.users(id,is_anonymous) values('${id.legacyCreator}',false);
      insert into public.user_profiles(id,username) values('${id.legacyCreator}','b7_legacy_creator');
      insert into private.user_age_eligibility(
        user_id,status,minimum_age,policy_version,evaluated_at,source,age_band,birth_date
      )
      select '${id.legacyCreator}','eligible',policy.minimum_age,policy.policy_version,
             clock_timestamp(),'signup_metadata','age_18_plus',current_date-interval '30 years'
      from private.age_eligibility_policy policy where policy.singleton=true;
      insert into private.creator_premium_contents(
        id,creator_id,client_request_id,title,description,content_kind,access_mode,lifecycle_status
      ) values(
        '${id.legacyPending}','${id.legacyCreator}','${id.legacyPendingRequest}',
        'Legacy B5 pending','Representative pre-B7 pending row','image','purchase','draft'
      );
      insert into private.creator_premium_contents(
        id,creator_id,client_request_id,title,description,content_kind,access_mode,
        lifecycle_status,deleted_at
      ) values(
        '${id.legacyDeleted}','${id.legacyCreator}','${id.legacyDeletedRequest}',
        'Legacy B5 deleted','Representative pre-B7 deleted row','image','purchase',
        'deleted',clock_timestamp()
      );
      set session_replication_role=origin;
      ${imageAsset(id.legacyTeaser, 'creator_premium_teaser_image', 'public', 'https://cdn.test/legacy-teaser.jpg', id.legacyCreator)}
      ${imageAsset(id.legacyOriginal, 'creator_premium_original_image', 'private', null, id.legacyCreator)}
    `);
    assert.equal(json(asRole(db, 'authenticated', id.legacyCreator, `
      select to_jsonb(result) from public.set_my_creator_premium_image_media_v1(
        '${id.legacyPending}','${id.legacyTeaser}','${id.legacyOriginal}'
      ) result
    `)).media_ready, true);
    json(asRole(db, 'authenticated', id.legacyCreator, `
      select to_jsonb(result) from public.set_my_creator_premium_offer_v1(
        '${id.legacyPending}',7.00000000,'${id.legacyOfferRequest}'
      ) result
    `));
    psql(db, `update private.creator_premium_contents
      set lifecycle_status='pending_review',updated_at=clock_timestamp()
      where id='${id.legacyPending}'`);
    assert.equal(psql(db, `select lifecycle_status from private.creator_premium_contents where id='${id.legacyPending}'`).stdout, 'pending_review');

    psql(db, chain.at(-1).sql);
    psql(db, c1Sql);
    assert.equal(psql(db, `select has_function_privilege('anon','public.cancel_my_creator_premium_submission_v1(uuid)','execute')`).stdout, 'f');
    assert.equal(psql(db, `select has_function_privilege('service_role','public.cancel_my_creator_premium_submission_v1(uuid)','execute')`).stdout, 'f');
    assert.equal(psql(db, `select has_function_privilege('authenticated','public.cancel_my_creator_premium_submission_v1(uuid)','execute')`).stdout, 't');
    c1Proved.add('cancel_anon_acl');
    c1Proved.add('cancel_service_role_acl');
    for (const item of A2_RPC_SECURITY_CASES) {
      assert.equal(
        psql(db, `select pg_catalog.has_function_privilege('anon','${item.signature}','execute')`).stdout,
        'f',
        `anon execute must remain revoked for ${item.signature}`,
      );
    }
    proved.add('purchase_refund_anon_acl');
    proved.add('period_refund_anon_acl');
    proved.add('admin_review_anon_acl');
    proved.add('admin_detail_anon_acl');
    proved.add('refund_candidates_anon_acl');
    proved.add('commerce_anon_acl');
    proved.add('summary_anon_acl');
    proved.add('subscriptions_anon_acl');
    proved.add('reopen_anon_acl');
    proved.add('report_anon_acl');
    proved.add('admin_search_anon_acl');
    assert.equal(psql(db, `
      select lifecycle_status||'|'||verification_status||'|'||verification_error_code||'|'||
        (submitted_at is not null)::text||'|'||
        (select count(*) from private.content_safety_scans where target_type='creator_premium' and target_id=content.id)::text
      from private.creator_premium_contents content where content.id='${id.legacyPending}'
    `).stdout, 'pending_review|not_requested|creator_premium_legacy_reverification_required|true|0');
    assert.equal(psql(db, `
      select lifecycle_status||'|'||(deleted_at is not null)::text||'|'||verification_status
      from private.creator_premium_contents where id='${id.legacyDeleted}'
    `).stdout, 'deleted|true|not_requested');
    assert.equal(json(asRole(db, 'authenticated', id.legacyCreator, `
      select to_jsonb(result) from public.submit_my_creator_premium_content_for_review_v1('${id.legacyPending}') result
    `)).lifecycle_status, 'pending_review');
    assert.equal(psql(db, `
      select verification_status||'|'||(verification_scan_id is not null)::text||'|'||
        (select count(*) from private.content_safety_scans where target_type='creator_premium' and target_id=content.id)::text
      from private.creator_premium_contents content where content.id='${id.legacyPending}'
    `).stdout, 'pending|true|1');

    const functions = psql(db, `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('search_admin_creator_premium_content_v1','get_admin_creator_premium_content_v1','admin_review_creator_premium_content_v1','get_creator_premium_commerce_v1','get_my_creator_premium_subscriptions_v1','get_my_creator_premium_commercial_summary_v1','admin_refund_creator_premium_purchase_v1','admin_refund_creator_premium_subscription_period_v1')`).stdout;
    assert.equal(functions, '8');

    psql(db, `
      truncate table public.ledger_entries,public.financial_transactions,public.ledger_accounts cascade;
      insert into public.ledger_accounts(owner_id,account_type,currency,balance,frozen)
      values(null,'platform','BDAG',30,false);
      set session_replication_role=replica;
      insert into auth.users(id,is_anonymous) values
        ('${id.creator}',false),('${id.buyer}',false),('${id.other}',false),
        ('${id.admin}',false),('${id.limitedAdmin}',false);
      insert into public.user_profiles(id,username) values
        ('${id.creator}','b7_creator'),('${id.buyer}','b7_buyer'),
        ('${id.other}','b7_other'),('${id.admin}','b7_admin'),
        ('${id.limitedAdmin}','b7_limited_admin');
      insert into private.user_age_eligibility(
        user_id,status,minimum_age,policy_version,evaluated_at,source,age_band,birth_date
      )
      select fixture.user_id,'eligible',policy.minimum_age,policy.policy_version,
             clock_timestamp(),'signup_metadata','age_18_plus',current_date-interval '30 years'
      from (values('${id.creator}'::uuid),('${id.buyer}'::uuid),('${id.other}'::uuid),
        ('${id.admin}'::uuid),('${id.limitedAdmin}'::uuid)) fixture(user_id)
      cross join private.age_eligibility_policy policy where policy.singleton=true;
      insert into private.admin_roles(
        role_code,display_name,description,is_assignable,is_root,is_exclusive
      ) values(
        'A2_AUDITOR','A2 Auditor','Disposable administrator without Premium capabilities.',
        true,false,false
      );
      insert into private.admin_role_capabilities(role_code,capability_code)
      values('SUPER_ADMIN','creator_premium.refunds.write')
      on conflict(role_code,capability_code) do nothing;
      insert into private.admin_user_roles(
        user_id,role_code,grant_actor_kind,grant_operator_reference,grant_reason
      ) values
      (
        '${id.admin}','SUPER_ADMIN','trusted_operator','b7-f1-disposable-fixture',
        'Disposable B7-F1 capability proof'
      ),(
        '${id.limitedAdmin}','A2_AUDITOR','trusted_operator','a2-disposable-fixture',
        'Disposable exact-capability denial proof'
      );
      set session_replication_role=origin;
      select public.ensure_ledger_account('${id.creator}');
      select public.ensure_ledger_account('${id.buyer}');
      update public.ledger_accounts set balance=100,frozen=false
      where owner_id='${id.buyer}' and account_type='user';
      update public.ledger_accounts set balance=30,frozen=false
      where owner_id='${id.creator}' and account_type='user';
      insert into private.content_safety_rules(
        code,label,category,detector_type,pattern,severity,scopes,enabled,version,
        policy_source,policy_reference,policy_version,locale,rationale,approval_state,
        approved_by,approved_at,created_by,updated_by
      ) values(
        'b7_disposable_safety','B7 disposable governed policy','child_safety','keyword',
        'nevermatchb7safe','critical',array['creator_premium_text','transcript']::text[],true,1,
        'community_guidelines','community-guidelines#prohibited-content','b7-f2','und',
        'Disposable approved rule used only inside the isolated database.','approved',
        '${id.admin}',clock_timestamp(),'${id.admin}','${id.admin}'
      );
    `);

    assert.equal(psql(db, `select purchase_enabled||'|'||subscription_enabled||'|'||refunds_enabled||'|'||platform_fee_bps from private.creator_premium_finance_policy where singleton`).stdout, 'false|false|false|0');
    const deniedAdminSql = [
      `select public.admin_refund_creator_premium_purchase_v1('${uid()}','${uid()}','admin_requested')`,
      `select public.admin_refund_creator_premium_subscription_period_v1('${uid()}','${uid()}','admin_requested')`,
      `select public.admin_review_creator_premium_content_v1('${uid()}','quarantine','reviewed','${uid()}')`,
      `select public.get_admin_creator_premium_content_v1('${uid()}')`,
      `select public.get_admin_creator_premium_refund_candidates_v1('${uid()}')`,
      `select public.search_admin_creator_premium_content_v1()`,
    ];
    const deniedState = securityState();
    for (const sql of deniedAdminSql) {
      expectFailure(asRole(db, 'authenticated', id.buyer, sql, { allowFailure: true }), 'admin_capability_forbidden');
      expectFailure(asRole(db, 'authenticated', id.limitedAdmin, sql, { allowFailure: true }), 'admin_capability_forbidden');
    }
    proved.add('purchase_refund_user_denied');
    proved.add('purchase_refund_admin_without_capability');
    proved.add('period_refund_user_denied');
    proved.add('period_refund_admin_without_capability');
    proved.add('admin_review_user_denied');
    proved.add('admin_review_admin_without_capability');
    proved.add('admin_detail_user_denied');
    proved.add('admin_detail_admin_without_capability');
    proved.add('refund_candidates_user_denied');
    proved.add('refund_candidates_admin_without_capability');
    proved.add('admin_search_user_denied');
    proved.add('admin_search_admin_without_capability');

    for (const [sql, expected] of [
      [`select public.get_creator_premium_commerce_v1('${uid()}')`, 'creator_premium_auth_required'],
      ['select public.get_my_creator_premium_commercial_summary_v1()', 'creator_premium_auth_required'],
      ['select public.get_my_creator_premium_subscriptions_v1()', 'creator_premium_auth_required'],
      [`select public.reopen_my_creator_premium_rejected_v1('${uid()}')`, 'creator_premium_auth_required'],
      [`select public.report_creator_premium_content_v1('${uid()}','fraud','anonymous')`, 'authentication_required'],
    ]) expectFailure(asRole(db, 'authenticated', null, sql, { allowFailure: true }), expected);
    proved.add('commerce_auth_required');
    proved.add('summary_auth_required');
    proved.add('subscriptions_auth_required');
    proved.add('reopen_auth_required');
    proved.add('report_auth_required');

    for (const [sql, expected] of [
      [`select public.admin_refund_creator_premium_purchase_v1('${uid()}','${uid()}','bad reason')`, 'creator_premium_admin_refund_invalid'],
      [`select public.admin_refund_creator_premium_subscription_period_v1('${uid()}','${uid()}','bad reason')`, 'creator_premium_admin_refund_invalid'],
      [`select public.admin_review_creator_premium_content_v1('${uid()}','approve','x','${uid()}')`, 'creator_premium_admin_review_invalid'],
      ['select public.get_admin_creator_premium_content_v1(null)', 'creator_premium_admin_content_invalid'],
      ['select public.get_admin_creator_premium_refund_candidates_v1(null)', 'creator_premium_refund_target_invalid'],
      ["select public.search_admin_creator_premium_content_v1('invalid',null,null,null,50)", 'creator_premium_admin_status_invalid'],
      ['select public.get_creator_premium_commerce_v1(null)', 'creator_premium_invalid_content'],
      ["select public.get_my_creator_premium_commercial_summary_v1('2026-02-01'::timestamptz,'2026-01-01'::timestamptz)", 'creator_premium_summary_range_invalid'],
      ['select public.reopen_my_creator_premium_rejected_v1(null)', 'creator_premium_invalid_content'],
      [`select public.report_creator_premium_content_v1('${uid()}','invalid_reason','x')`, 'creator_premium_report_invalid'],
    ]) {
      const actor = sql.includes('get_my_') || sql.includes('get_creator_') || sql.includes('reopen_') || sql.includes('report_')
        ? id.buyer : id.admin;
      const result = asRole(db, 'authenticated', actor, sql, { allowFailure: true });
      expectFailure(result, expected);
    }
    expectFailure(asRole(db, 'authenticated', id.admin, `select public.search_admin_creator_premium_content_v1('pending_review',null,clock_timestamp(),null,50)`, { allowFailure: true }), 'creator_premium_admin_cursor_invalid');
    expectFailure(asRole(db, 'authenticated', id.buyer, `select public.get_my_creator_premium_subscriptions_v1(clock_timestamp(),null,50)`, { allowFailure: true }), 'creator_premium_subscription_cursor_invalid');
    proved.add('purchase_refund_invalid_input');
    proved.add('period_refund_invalid_input');
    proved.add('admin_review_invalid_input');
    proved.add('admin_search_invalid_status');
    proved.add('admin_search_half_cursor');
    proved.add('commerce_invalid_target');
    proved.add('summary_invalid_range');
    proved.add('subscriptions_half_cursor');
    proved.add('reopen_invalid_target');
    proved.add('report_invalid_input');
    assert.equal(securityState(), deniedState, 'denied/invalid A2 RPC calls must be side-effect free');
    assert.equal(psql(db, `select has_function_privilege('authenticated','public.refund_creator_premium_purchase_v1(uuid,uuid,text)','execute')`).stdout, 'f');
    const emptySubscriptions = json(asRole(
      db,
      'authenticated',
      id.buyer,
      `select public.get_my_creator_premium_subscriptions_v1(null,null,50)`,
    ));
    assert.deepEqual(emptySubscriptions.items, []);
    assert.equal(emptySubscriptions.next_cursor, null);

    const purchase = createDraft('B7 purchase', 'purchase', id.purchaseRequest);
    const subscription = createDraft('B7 subscription', 'subscription', id.subscriptionRequest, 'video');
    const moderation = createDraft('B7 moderation', 'purchase', id.moderationRequest);
    const blocked = createDraft('B7 blocked', 'purchase', id.blockedRequest);
    const modeSwitch = createDraft('B7 mode switch', 'purchase_or_subscription', id.modeSwitchRequest);
    const reopen = createDraft('B7 reopen', 'purchase', id.reopenRequest);
    const c1Cancel = createDraft('C1 cancellation', 'purchase', id.c1CancelRequest);
    expectFailure(asRole(db, 'authenticated', id.other, `select * from public.update_my_creator_premium_draft_v1('${purchase.id}','stolen','stolen','image','purchase')`, { allowFailure: true }), 'creator_premium_content_not_found');
    expectFailure(asRole(db, 'authenticated', id.creator, `select public.reopen_my_creator_premium_rejected_v1('${purchase.id}')`, { allowFailure: true }), 'creator_premium_rejected_only');
    proved.add('reopen_rejected_only');
    expectFailure(asRole(db, 'authenticated', id.other, `select public.reopen_my_creator_premium_rejected_v1('${reopen.id}')`, { allowFailure: true }), 'creator_premium_content_not_found');
    proved.add('reopen_cross_owner');

    psql(db, `
      ${imageAsset(id.purchaseTeaser, 'creator_premium_teaser_image', 'public', 'https://cdn.test/purchase-teaser.jpg')}
      ${imageAsset(id.purchaseOriginal, 'creator_premium_original_image', 'private')}
      ${imageAsset(id.subscriptionTeaser, 'creator_premium_teaser_image', 'public', 'https://cdn.test/subscription-teaser.jpg')}
      ${streamAsset(id.subscriptionVideo)}
      ${imageAsset(id.moderationTeaser, 'creator_premium_teaser_image', 'public', 'https://cdn.test/moderation-teaser.jpg')}
      ${imageAsset(id.moderationOriginal, 'creator_premium_original_image', 'private')}
      ${imageAsset(id.blockedTeaser, 'creator_premium_teaser_image', 'public', 'https://cdn.test/blocked-teaser.jpg')}
      ${imageAsset(id.blockedOriginal, 'creator_premium_original_image', 'private')}
      ${imageAsset(id.reopenTeaser, 'creator_premium_teaser_image', 'public', 'https://cdn.test/reopen-teaser.jpg')}
      ${imageAsset(id.reopenOriginal, 'creator_premium_original_image', 'private')}
      ${imageAsset(id.c1CancelTeaser, 'creator_premium_teaser_image', 'public', 'https://cdn.test/c1-cancel-teaser.jpg')}
      ${imageAsset(id.c1CancelOriginal, 'creator_premium_original_image', 'private')}
    `);
    for (const [contentId, teaserId, originalId] of [
      [purchase.id,id.purchaseTeaser,id.purchaseOriginal],
      [moderation.id,id.moderationTeaser,id.moderationOriginal],
      [blocked.id,id.blockedTeaser,id.blockedOriginal],
      [reopen.id,id.reopenTeaser,id.reopenOriginal],
      [c1Cancel.id,id.c1CancelTeaser,id.c1CancelOriginal],
    ]) {
      const attached = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_image_media_v1('${contentId}','${teaserId}','${originalId}') result`));
      assert.equal(attached.media_ready, true);
    }
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_video_media_v1('${subscription.id}','${id.subscriptionTeaser}','${id.subscriptionVideo}') result`)).media_ready, true);

    json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_offer_v1('${purchase.id}',10.00000000,'${id.purchaseOfferRequest}') result`));
    json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_offer_v1('${moderation.id}',4.00000000,'${id.moderationOfferRequest}') result`));
    json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_offer_v1('${blocked.id}',3.00000000,'${id.blockedOfferRequest}') result`));
    json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_offer_v1('${reopen.id}',2.00000000,'${id.reopenOfferRequest}') result`));
    json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_offer_v1('${c1Cancel.id}',8.00000000,'${id.c1CancelOfferRequest}') result`));
    json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_offer_v1('${modeSwitch.id}',6.00000000,'${id.modeSwitchOfferRequest}') result`));
    const plan = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.create_my_creator_premium_plan_draft_v1('B7 plan','Disposable plan',20.00000000,30,'${id.planRequest}') result`));
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_plan_contents_v1('${plan.id}',array['${subscription.id}']::uuid[]) result`)).mapped_content_count, 1);
    const modeSwitchPlan = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.create_my_creator_premium_plan_draft_v1('B7 switch plan','Disposable switch plan',15.00000000,30,'${id.modeSwitchPlanRequest}') result`));
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_plan_contents_v1('${modeSwitchPlan.id}',array['${modeSwitch.id}']::uuid[]) result`)).mapped_content_count, 1);
    json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.update_my_creator_premium_draft_v1('${modeSwitch.id}','B7 mode switch','Disposable transition','image','purchase') result`));
    assert.equal(psql(db, `
      select content.access_mode||'|'||
        (select count(*) from private.creator_premium_plan_contents mapping where mapping.content_id=content.id)::text||'|'||
        (select count(*) from private.creator_premium_offer_versions offer where offer.content_id=content.id and offer.status='active')::text
      from private.creator_premium_contents content where content.id='${modeSwitch.id}'
    `).stdout, 'purchase|0|1');

    for (const contentId of [purchase.id,subscription.id,moderation.id,blocked.id,reopen.id]) {
      assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.submit_my_creator_premium_content_for_review_v1('${contentId}') result`)).lifecycle_status, 'pending_review');
    }
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.submit_my_creator_premium_content_for_review_v1('${c1Cancel.id}') result`)).lifecycle_status, 'pending_review');
    expectFailure(asRole(db, 'authenticated', id.other, `select public.cancel_my_creator_premium_submission_v1('${c1Cancel.id}')`, { allowFailure: true }), 'creator_premium_content_not_found');
    expectFailure(asRole(db, 'authenticated', null, `select public.cancel_my_creator_premium_submission_v1('${c1Cancel.id}')`, { allowFailure: true }), 'creator_premium_auth_required');
    expectFailure(asRole(db, 'authenticated', id.legacyCreator, `select public.cancel_my_creator_premium_submission_v1('${id.legacyDeleted}')`, { allowFailure: true }), 'creator_premium_submission_cancel_invalid_state');
    c1Proved.add('cancel_cross_owner');
    c1Proved.add('cancel_auth_required');
    c1Proved.add('cancel_invalid_state');
    const c1Before = psql(db, `
      select verification_generation||'|'||
        (select count(*) from private.content_safety_scans where target_type='creator_premium' and target_id=content.id)||'|'||
        (select count(*) from public.media_asset_links where entity_type='creator_premium_content' and entity_id=content.id)||'|'||
        (select count(*) from private.creator_premium_offer_versions where content_id=content.id)
      from private.creator_premium_contents content where content.id='${c1Cancel.id}'
    `).stdout.split('|');
    const concurrentCancel = await Promise.all([
      asRoleAsync(db, 'authenticated', id.creator, `select to_jsonb(result) from public.cancel_my_creator_premium_submission_v1('${c1Cancel.id}') result`),
      asRoleAsync(db, 'authenticated', id.creator, `select to_jsonb(result) from public.cancel_my_creator_premium_submission_v1('${c1Cancel.id}') result`),
    ]);
    assert.equal(concurrentCancel.filter(result => result.status === 0).length, 2);
    const cancelResults = concurrentCancel.map(result => JSON.parse(result.stdout));
    assert.equal(cancelResults.filter(result => result.cancelled === true).length, 1);
    assert.equal(cancelResults.filter(result => result.cancelled === false).length, 1);
    c1Proved.add('cancel_concurrent_idempotent');
    assert.equal(psql(db, `
      select lifecycle_status||'|'||verification_status||'|'||
        (submitted_at is null)::text||'|'||(verification_scan_id is null)::text||'|'||
        (verification_fingerprint is null)::text||'|'||(verification_requested_at is null)::text||'|'||
        (verification_completed_at is null)::text
      from private.creator_premium_contents where id='${c1Cancel.id}'
    `).stdout, 'draft|not_requested|true|true|true|true|true');
    const c1After = psql(db, `
      select verification_generation||'|'||
        (select count(*) from private.content_safety_scans where target_type='creator_premium' and target_id=content.id)||'|'||
        (select count(*) from public.media_asset_links where entity_type='creator_premium_content' and entity_id=content.id)||'|'||
        (select count(*) from private.creator_premium_offer_versions where content_id=content.id)
      from private.creator_premium_contents content where content.id='${c1Cancel.id}'
    `).stdout.split('|');
    assert.equal(Number(c1After[0]), Number(c1Before[0]) + 1);
    c1Proved.add('cancel_stale_scan_generation_fenced');
    assert.deepEqual(c1After.slice(1), c1Before.slice(1), 'scan history, media links, and offer versions must be preserved');
    c1Proved.add('cancel_media_offer_history_preserved');
    expectFailure(asRole(db, 'authenticated', id.creator, `select public.admin_review_creator_premium_content_v1('${purchase.id}','approve','self approval','${uid()}')`, { allowFailure: true }), 'admin_capability_forbidden');

    const review = (contentId, action, reason, key = uid()) => json(adminCommand(
      'admin_review_creator_premium_content_v1',[contentId,action,reason,key],
    ));
    expectFailure(adminCommand('admin_review_creator_premium_content_v1',[purchase.id,'approve','manual bypass forbidden',uid()], { allowFailure: true }), 'creator_premium_admin_review_invalid');
    const subscriptionScanBefore = psql(db, `select verification_scan_id from private.creator_premium_contents where id='${subscription.id}'`).stdout;
    const subscriptionScanCountBefore = psql(db, `select count(*) from private.content_safety_scans where target_type='creator_premium' and target_id='${subscription.id}'`).stdout;
    const initialReconcile = completeAutomaticSafety([blocked.id,reopen.id]);
    assert.ok(initialReconcile.processed >= 5);
    assert.equal(psql(db, `select lifecycle_status||'|'||verification_status from private.creator_premium_contents where id='${purchase.id}'`).stdout, 'published|passed');
    assert.equal(psql(db, `select lifecycle_status||'|'||verification_status||'|'||verification_error_code from private.creator_premium_contents where id='${subscription.id}'`).stdout, 'pending_review|commercial_pending|creator_premium_active_plan_required');
    assert.equal(psql(db, `select lifecycle_status||'|'||verification_status from private.creator_premium_contents where id='${moderation.id}'`).stdout, 'published|passed');
    assert.equal(psql(db, `select lifecycle_status||'|'||verification_status from private.creator_premium_contents where id='${blocked.id}'`).stdout, 'quarantined|restricted');
    assert.equal(psql(db, `select lifecycle_status||'|'||verification_status from private.creator_premium_contents where id='${reopen.id}'`).stdout, 'quarantined|restricted');
    const reopenScanCount = psql(db, `select count(*) from private.content_safety_scans where target_type='creator_premium' and target_id='${reopen.id}'`).stdout;
    psql(db, `update private.creator_premium_contents set lifecycle_status='rejected',quarantined_at=null,verification_status='blocked',review_reason='a2 disposable rejection' where id='${reopen.id}'`);
    const concurrentReopen = await Promise.all([
      asRoleAsync(db, 'authenticated', id.creator, `select public.reopen_my_creator_premium_rejected_v1('${reopen.id}')`),
      asRoleAsync(db, 'authenticated', id.creator, `select public.reopen_my_creator_premium_rejected_v1('${reopen.id}')`),
    ]);
    assert.equal(concurrentReopen.filter(result => result.status === 0).length, 1);
    assert.equal(concurrentReopen.filter(result => /creator_premium_rejected_only/i.test(`${result.stdout}\n${result.stderr}`)).length, 1);
    assert.equal(psql(db, `select lifecycle_status||'|'||verification_status from private.creator_premium_contents where id='${reopen.id}'`).stdout, 'draft|not_requested');
    assert.equal(psql(db, `select count(*) from private.content_safety_scans where target_type='creator_premium' and target_id='${reopen.id}'`).stdout, reopenScanCount);
    proved.add('reopen_lock_concurrency_no_scan');

    assert.equal(psql(db, 'select count(*) from public.financial_transactions').stdout, '0');
    c1Proved.add('cancel_finance_no_side_effect');
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.activate_my_creator_premium_plan_v1('${plan.id}') result`)).status, 'active');
    const activationReconcile = json(asRole(db, 'service_role', null, 'select public.reconcile_creator_premium_publications_v1(50)'));
    assert.ok(activationReconcile.processed >= 1);
    assert.equal(psql(db, `select lifecycle_status||'|'||verification_status from private.creator_premium_contents where id='${subscription.id}'`).stdout, 'published|passed');
    assert.equal(psql(db, `select verification_scan_id from private.creator_premium_contents where id='${subscription.id}'`).stdout, subscriptionScanBefore);
    assert.equal(psql(db, `select count(*) from private.content_safety_scans where target_type='creator_premium' and target_id='${subscription.id}'`).stdout, subscriptionScanCountBefore);

    const adminSearch = json(asRole(db, 'authenticated', id.admin, `select public.search_admin_creator_premium_content_v1(null,null,null,null,50)`));
    assert.ok(adminSearch.items.some(item => item.id === purchase.id));
    proved.add('admin_search_authorized_read');
    const adminDetail = json(asRole(db, 'authenticated', id.admin, `select public.get_admin_creator_premium_content_v1('${purchase.id}')`));
    assert.equal(adminDetail.id, purchase.id);
    proved.add('admin_detail_authorized_read');
    const commerceOff = json(asRole(db, 'authenticated', id.buyer, `select public.get_creator_premium_commerce_v1('${purchase.id}')`));
    assert.deepEqual(commerceOff.policy, {
      policy_version: 'creator-premium-b4-v1',
      purchase_enabled: false,
      refunds_enabled: false,
      subscription_enabled: false,
    });
    assert.equal(commerceOff.operations.purchase_available, false);
    assert.equal(commerceOff.operations.purchase_blocker, 'creator_premium_purchase_disabled');
    assert.doesNotMatch(JSON.stringify(commerceOff), /private-bucket|object_key|cloudflare_uid|original_url/i);
    proved.add('commerce_published_visibility_no_private_locator');
    proved.add('commerce_finance_off');
    expectFailure(asRole(db, 'authenticated', id.creator, `select public.report_creator_premium_content_v1('${purchase.id}','fraud','self report')`, { allowFailure: true }), 'creator_premium_report_self_forbidden');
    proved.add('report_self_forbidden');

    const blockedAlertId = psql(db, `select id from private.content_safety_alerts where target_type='creator_premium' and target_id='${blocked.id}' and source_type='visual_classifier' order by created_at desc limit 1`).stdout;
    assert.match(blockedAlertId, /^[0-9a-f-]{36}$/i);
    expectFailure(adminCommand('admin_review_creator_premium_content_v1',[blocked.id,'restore','unsafe restore without alert resolution',uid()], { allowFailure: true }), 'creator_premium_safety_alert_resolution_required');
    expectFailure(asRole(db, 'authenticated', id.buyer, `select public.admin_review_content_safety_alert('${blockedAlertId}','dismiss','no_violation','not authorized','${uid()}')`, { allowFailure: true }), 'admin_capability_forbidden');
    const dismissed = json(adminCommand('admin_review_content_safety_alert',[blockedAlertId,'dismiss','no_violation','Disposable verified false positive',id.safetyDismissKey]));
    assert.equal(dismissed.status, 'dismissed');
    assert.equal(json(adminCommand('admin_review_content_safety_alert',[blockedAlertId,'dismiss','no_violation','Disposable verified false positive',id.safetyDismissKey])).idempotent, true);
    assert.equal(review(blocked.id,'restore','canonical false-positive resolution recorded').lifecycle_status, 'pending_review');
    completeAutomaticSafety();
    assert.equal(psql(db, `select lifecycle_status||'|'||verification_status from private.creator_premium_contents where id='${blocked.id}'`).stdout, 'published|passed');
    assert.equal(psql(db, `select count(*) from private.content_safety_alerts where target_type='creator_premium' and target_id='${blocked.id}' and source_type='visual_classifier'`).stdout, '1');
    const newEvidenceReport = asRole(db, 'authenticated', id.buyer, `select public.report_creator_premium_content_v1('${blocked.id}','fraud','New disposable evidence after false-positive dismissal')`).stdout;
    assert.match(newEvidenceReport, /^[0-9a-f-]{36}$/i);
    completeAutomaticSafety();
    assert.equal(psql(db, `select lifecycle_status||'|'||verification_status from private.creator_premium_contents where id='${blocked.id}'`).stdout, 'quarantined|restricted');
    expectFailure(adminCommand('admin_review_creator_premium_content_v1',[blocked.id,'restore','new evidence still active',uid()], { allowFailure: true }), 'creator_premium_safety_alert_resolution_required');

    const quarantineKey = uid();
    assert.equal(review(moderation.id,'quarantine','post-publication safety review',quarantineKey).lifecycle_status, 'quarantined');
    assert.equal(review(moderation.id,'quarantine','post-publication safety review',quarantineKey).replayed, true);
    expectFailure(adminCommand('admin_review_creator_premium_content_v1',[moderation.id,'remove','changed payload',quarantineKey], { allowFailure: true }), 'admin_idempotency_conflict');
    proved.add('admin_review_exact_replay_conflict');
    assert.equal(review(moderation.id,'restore','safety cleared').lifecycle_status, 'pending_review');
    const firstRestoreScan = psql(db, `select verification_scan_id from private.creator_premium_contents where id='${moderation.id}'`).stdout;
    completeAutomaticSafety();
    assert.equal(psql(db, `select lifecycle_status||'|'||verification_status from private.creator_premium_contents where id='${moderation.id}'`).stdout, 'published|passed');
    assert.equal(review(moderation.id,'remove','owner policy removal').lifecycle_status, 'removed');
    assert.equal(review(moderation.id,'restore','new verification required').lifecycle_status, 'pending_review');
    const secondRestoreState = psql(db, `select verification_scan_id||'|'||verification_status from private.creator_premium_contents where id='${moderation.id}'`).stdout;
    assert.match(secondRestoreState, /^[0-9a-f-]{36}\|pending$/i);
    assert.notEqual(secondRestoreState.split('|')[0], firstRestoreScan);
    proved.add('admin_restore_fresh_scan_no_fabricated_pass');
    assert.equal(json(psql(db, `select private.finalize_creator_premium_safety_scan_v1('${firstRestoreScan}')`)).outcome, 'stale_scan');
    completeAutomaticSafety();
    assert.equal(psql(db, `select lifecycle_status||'|'||verification_status from private.creator_premium_contents where id='${moderation.id}'`).stdout, 'published|passed');
    assert.equal(psql(db, `select count(*) from private.admin_action_audit where target_id='${moderation.id}' and action like 'creator_premium.%'`).stdout, '4');

    assert.equal(asRole(db, 'authenticated', id.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${purchase.id}')`).stdout, 'f');
    const disabledCounts = financeCounts(), disabledBalances = balances();
    expectFailure(service('purchase_creator_premium_content_v1',[id.buyer,purchase.id,id.purchaseKey], { allowFailure: true }), 'creator_premium_purchase_disabled');
    expectFailure(service('subscribe_creator_premium_plan_v1',[id.buyer,plan.id,id.subscriptionKey], { allowFailure: true }), 'creator_premium_subscription_disabled');
    assert.equal(financeCounts(), disabledCounts);assert.equal(balances(), disabledBalances);

    psql(db, `update private.creator_premium_finance_policy set purchase_enabled=true,subscription_enabled=true,refunds_enabled=true,platform_fee_bps=1000,updated_at=clock_timestamp()`);
    const purchaseResult = json(service('purchase_creator_premium_content_v1',[id.buyer,purchase.id,id.purchaseKey]));
    assert.equal(purchaseResult.money_moved, true);
    assert.equal(psql(db, `select gross_amount_bdag||'|'||platform_fee_bps||'|'||platform_fee_bdag||'|'||creator_net_bdag from private.creator_premium_purchase_receipts where id='${purchaseResult.receipt_id}'`).stdout, '10.00000000|1000|1.00000000|9.00000000');
    assert.equal(psql(db, `select count(*) from public.ledger_entries where txn_id='${purchaseResult.financial_transaction_id}'`).stdout, '3');
    assert.equal(asRole(db, 'authenticated', id.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${purchase.id}')`).stdout, 't');
    const purchaseReplayCounts = financeCounts(), purchaseReplayBalances = balances();
    assert.equal(json(service('purchase_creator_premium_content_v1',[id.buyer,purchase.id,id.purchaseKey])).money_moved, false);
    assert.equal(financeCounts(), purchaseReplayCounts);assert.equal(balances(), purchaseReplayBalances);

    const subscriptionResult = json(service('subscribe_creator_premium_plan_v1',[id.buyer,plan.id,id.subscriptionKey]));
    assert.equal(subscriptionResult.money_moved, true);
    assert.equal(psql(db, `select gross_amount_bdag||'|'||platform_fee_bps||'|'||platform_fee_bdag||'|'||creator_net_bdag from private.creator_premium_subscription_periods where id='${subscriptionResult.period_id}'`).stdout, '20.00000000|1000|2.00000000|18.00000000');
    assert.equal(asRole(db, 'authenticated', id.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${subscription.id}')`).stdout, 't');
    const cancelled = json(service('cancel_creator_premium_subscription_v1',[id.buyer,subscriptionResult.subscription_id,id.cancelKey]));
    assert.equal(cancelled.status, 'cancelled');assert.equal(cancelled.money_moved, false);
    assert.equal(asRole(db, 'authenticated', id.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${subscription.id}')`).stdout, 't');
    assert.equal(psql(db, `begin;alter table private.creator_premium_subscription_periods disable trigger creator_premium_period_snapshot_guard;update private.creator_premium_subscription_periods set paid_through_at=clock_timestamp()-interval '1 second' where id='${subscriptionResult.period_id}';set local request.jwt.claim.sub='${id.buyer}';set local request.jwt.claim.role='authenticated';set local role authenticated;select allowed from public.get_my_creator_premium_entitlement_v1('${subscription.id}');rollback;`).stdout, 'f');

    const refundCandidates = json(asRole(db, 'authenticated', id.admin, `select public.get_admin_creator_premium_refund_candidates_v1('${purchase.id}')`));
    assert.equal(refundCandidates.purchases.length, 1);
    assert.equal(refundCandidates.purchases[0].receipt_id, purchaseResult.receipt_id);
    proved.add('refund_candidates_authorized_read');
    const buyerSubscriptions = json(asRole(db, 'authenticated', id.buyer, 'select public.get_my_creator_premium_subscriptions_v1(null,null,50)'));
    const otherSubscriptions = json(asRole(db, 'authenticated', id.other, 'select public.get_my_creator_premium_subscriptions_v1(null,null,50)'));
    assert.equal(buyerSubscriptions.items.length, 1);
    assert.deepEqual(otherSubscriptions.items, []);
    assert.doesNotMatch(JSON.stringify(buyerSubscriptions), /private-bucket|object_key|cloudflare_uid|original_url/i);
    proved.add('subscriptions_caller_only');
    const creatorSummaryBeforeRefund = json(asRole(db, 'authenticated', id.creator, 'select public.get_my_creator_premium_commercial_summary_v1()'));
    const otherSummary = json(asRole(db, 'authenticated', id.other, 'select public.get_my_creator_premium_commercial_summary_v1()'));
    assert.notEqual(creatorSummaryBeforeRefund.net_retained, '0.00000000');
    assert.equal(otherSummary.net_retained, '0.00000000');
    assert.doesNotMatch(JSON.stringify(creatorSummaryBeforeRefund), /private-bucket|object_key|cloudflare_uid|original_url/i);
    proved.add('summary_caller_only');

    psql(db, `update private.creator_premium_finance_policy set purchase_enabled=false,subscription_enabled=false,refunds_enabled=false,platform_fee_bps=0,updated_at=clock_timestamp()`);
    const financeOffState = securityState(), financeOffCounts = financeCounts(), financeOffBalances = balances();
    expectFailure(adminCommand('admin_refund_creator_premium_purchase_v1',[purchaseResult.receipt_id,uid(),'admin_requested'], { allowFailure: true }), 'creator_premium_refunds_disabled');
    expectFailure(adminCommand('admin_refund_creator_premium_subscription_period_v1',[subscriptionResult.period_id,uid(),'admin_requested'], { allowFailure: true }), 'creator_premium_refunds_disabled');
    assert.equal(financeCounts(), financeOffCounts);
    assert.equal(balances(), financeOffBalances);
    assert.equal(securityState(), financeOffState);
    proved.add('purchase_refund_finance_off_no_side_effect');
    proved.add('period_refund_finance_off_no_side_effect');
    psql(db, `update private.creator_premium_finance_policy set purchase_enabled=true,subscription_enabled=true,refunds_enabled=true,platform_fee_bps=1000,updated_at=clock_timestamp()`);

    const concurrentReports = await Promise.all([
      asRoleAsync(db, 'authenticated', id.buyer, `select public.report_creator_premium_content_v1('${purchase.id}','fraud','Disposable report without private URL')`),
      asRoleAsync(db, 'authenticated', id.buyer, `select public.report_creator_premium_content_v1('${purchase.id}','fraud','Concurrent duplicate without private URL')`),
    ]);
    assert.equal(concurrentReports.filter(result => result.status === 0).length, 1);
    assert.equal(concurrentReports.filter(result => /creator_premium_report_pending_exists/i.test(`${result.stdout}\n${result.stderr}`)).length, 1);
    const reportId = concurrentReports.find(result => result.status === 0).stdout;
    assert.match(reportId, /^[0-9a-f-]{36}$/i);
    assert.equal(psql(db, `select reported_content_type||'|'||reason from public.reports where id='${reportId}'`).stdout, 'creator_premium|fraud');
    assert.equal(psql(db, `select count(*) from public.reports where reporter_user_id='${id.buyer}' and reported_content_id='${purchase.id}' and reported_content_type='creator_premium' and status='pending'`).stdout, '1');
    proved.add('report_concurrency_single_pending');
    proved.add('report_no_private_locator');
    expectFailure(asRole(db, 'authenticated', id.buyer, `select public.report_creator_premium_content_v1('${purchase.id}','fraud','duplicate')`, { allowFailure: true }), 'creator_premium_report_pending_exists');
    expectFailure(asRole(db, 'authenticated', id.buyer, `select * from private.creator_premium_purchase_receipts`, { allowFailure: true }), 'permission denied');

    const purchaseRefundCounts = financeCounts(), purchaseRefundBalances = balances();
    const concurrentPurchaseRefund = await Promise.all([
      adminCommandAsync('admin_refund_creator_premium_purchase_v1',[purchaseResult.receipt_id,id.purchaseRefundKey,'admin_requested']),
      adminCommandAsync('admin_refund_creator_premium_purchase_v1',[purchaseResult.receipt_id,id.purchaseRefundKey,'admin_requested']),
    ]);
    for (const result of concurrentPurchaseRefund)assert.equal(result.status,0,result.stderr);
    const purchaseRefundResults = concurrentPurchaseRefund.map(result=>JSON.parse(result.stdout));
    assert.equal(purchaseRefundResults.filter(result=>result.money_moved).length,1);
    assert.equal(purchaseRefundResults.filter(result=>result.replayed).length,1);
    const purchaseRefundAfterCounts=financeCounts().split('|').map(Number),purchaseRefundBeforeCounts=purchaseRefundCounts.split('|').map(Number);
    assert.deepEqual(purchaseRefundAfterCounts,[purchaseRefundBeforeCounts[0]+1,purchaseRefundBeforeCounts[1]+3]);
    assert.equal(psql(db, `select count(*) from private.admin_action_audit where action='creator_premium.purchase_refund' and target_id='${purchaseResult.receipt_id}'`).stdout, '1');
    assert.equal(psql(db, `select outcome||'|'||(metadata->>'money_moved')||'|'||(metadata->>'replayed')||'|'||(metadata->>'already_refunded') from private.admin_action_audit where action='creator_premium.purchase_refund' and target_id='${purchaseResult.receipt_id}'`).stdout, 'succeeded|true|false|false');
    const purchaseRefundReplay = json(adminCommand('admin_refund_creator_premium_purchase_v1',[purchaseResult.receipt_id,id.purchaseRefundKey,'admin_requested']));
    assert.deepEqual({money_moved:purchaseRefundReplay.money_moved,replayed:purchaseRefundReplay.replayed,already_refunded:purchaseRefundReplay.already_refunded},{money_moved:false,replayed:true,already_refunded:true});
    expectFailure(adminCommand('admin_refund_creator_premium_purchase_v1',[purchaseResult.receipt_id,id.purchaseRefundKey,'changed_reason'], { allowFailure: true }), 'admin_idempotency_conflict');
    const purchaseRefundNoOp = json(adminCommand('admin_refund_creator_premium_purchase_v1',[purchaseResult.receipt_id,uid(),'admin_requested']));
    assert.deepEqual({money_moved:purchaseRefundNoOp.money_moved,replayed:purchaseRefundNoOp.replayed,already_refunded:purchaseRefundNoOp.already_refunded},{money_moved:false,replayed:false,already_refunded:true});
    assert.equal(psql(db, `select outcome||'|'||(metadata->>'money_moved')||'|'||(metadata->>'replayed')||'|'||(metadata->>'already_refunded') from private.admin_action_audit where action='creator_premium.purchase_refund' and target_id='${purchaseResult.receipt_id}' order by created_at desc limit 1`).stdout, 'no_op|false|false|true');
    assert.equal(asRole(db, 'authenticated', id.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${purchase.id}')`).stdout, 'f');
    assert.notEqual(financeCounts(), purchaseRefundCounts);assert.notEqual(balances(), purchaseRefundBalances);
    proved.add('purchase_refund_authorized_idempotent_concurrency');

    const periodRefundCounts = financeCounts();
    const periodRefund = json(adminCommand('admin_refund_creator_premium_subscription_period_v1',[subscriptionResult.period_id,id.periodRefundKey,'admin_requested']));
    assert.equal(periodRefund.money_moved,true);
    const periodCountsAfterFirst = financeCounts();
    const periodAfter=periodCountsAfterFirst.split('|').map(Number),periodBefore=periodRefundCounts.split('|').map(Number);
    assert.deepEqual(periodAfter,[periodBefore[0]+1,periodBefore[1]+3]);
    const periodReplay = json(adminCommand('admin_refund_creator_premium_subscription_period_v1',[subscriptionResult.period_id,id.periodRefundKey,'admin_requested']));
    assert.deepEqual({money_moved:periodReplay.money_moved,replayed:periodReplay.replayed,already_refunded:periodReplay.already_refunded},{money_moved:false,replayed:true,already_refunded:true});
    assert.equal(financeCounts(),periodCountsAfterFirst);
    const periodNoOp = json(adminCommand('admin_refund_creator_premium_subscription_period_v1',[subscriptionResult.period_id,uid(),'admin_requested']));
    assert.equal(periodNoOp.money_moved,false);assert.equal(financeCounts(),periodCountsAfterFirst);
    assert.notEqual(periodCountsAfterFirst,periodRefundCounts);
    assert.equal(asRole(db, 'authenticated', id.buyer, `select allowed from public.get_my_creator_premium_entitlement_v1('${subscription.id}')`).stdout, 'f');
    proved.add('period_refund_authorized_idempotent');

    const entriesBeforeRollback = psql(db, `select count(*) from public.ledger_entries`).stdout;
    const rollbackBalances = balances(), rollbackCounts = financeCounts();
    psql(db, `create function private.b7_test_force_receipt_failure() returns trigger language plpgsql as $$begin raise exception 'b7_test_forced_rollback';end;$$;create trigger b7_test_force_receipt_failure after insert on private.creator_premium_purchase_receipts for each row execute function private.b7_test_force_receipt_failure();`);
    expectFailure(service('purchase_creator_premium_content_v1',[id.buyer,purchase.id,id.rollbackKey], { allowFailure: true }), 'b7_test_forced_rollback');
    assert.equal(financeCounts(),rollbackCounts);assert.equal(balances(),rollbackBalances);
    assert.equal(psql(db, `select count(*) from public.ledger_entries`).stdout,entriesBeforeRollback);
    psql(db, `drop trigger b7_test_force_receipt_failure on private.creator_premium_purchase_receipts;drop function private.b7_test_force_receipt_failure()`);

    assert.equal(psql(db, `select round(sum(case when entry_type='credit' then amount else -amount end),8) from public.ledger_entries where txn_id in(select id from public.financial_transactions where operation_type like 'creator_premium_%')`).stdout, '0.00000000');
    const summary = json(asRole(db, 'authenticated', id.creator, `select public.get_my_creator_premium_commercial_summary_v1()`));
    assert.equal(summary.currency,'BDAG');assert.equal(summary.net_retained,'0.00000000');
    assert.doesNotMatch(JSON.stringify(summary),/estimated_revenue|conversion_rate|private.*url/i);
    psql(db, `update private.creator_premium_contents set lifecycle_status='rejected',published_at=null,review_reason='a2 financial history rejection',verification_status='blocked' where id='${purchase.id}'`);
    const financialHistoryState = securityState();
    expectFailure(asRole(db, 'authenticated', id.creator, `select public.reopen_my_creator_premium_rejected_v1('${purchase.id}')`, { allowFailure: true }), 'creator_premium_rejected_has_financial_history');
    assert.equal(securityState(), financialHistoryState);
    proved.add('reopen_financial_history');
    psql(db, `update private.creator_premium_finance_policy set purchase_enabled=false,subscription_enabled=false,refunds_enabled=false,platform_fee_bps=0,updated_at=clock_timestamp()`);
    assert.equal(psql(db, `select purchase_enabled||'|'||subscription_enabled||'|'||refunds_enabled||'|'||platform_fee_bps from private.creator_premium_finance_policy where singleton`).stdout, 'false|false|false|0');

    const expectedCaseIds = A2_RPC_SECURITY_CASES.flatMap(item => item.caseIds).sort();
    assert.deepEqual([...proved].sort(), expectedCaseIds);
    const evidence = {
      schema_version: 1,
      b7_blob: A2_B7_BLOB,
      rpcs: A2_RPC_SECURITY_CASES.map(item => ({
        signature: item.signature,
        fingerprint: item.fingerprint,
        case_ids: [...item.caseIds],
        result: 'SAFE',
      })),
      result: 'PASS',
    };
    const evidenceSha256 = createHash('sha256').update(`${canonicalJson(evidence)}\n`, 'utf8').digest('hex');
    t.diagnostic(`A2_RPC_SECURITY_EVIDENCE_SHA256 ${evidenceSha256}`);
    assert.deepEqual([...c1Proved].sort(), [...C1_RPC_SECURITY_CASE.caseIds].sort());
    const c1Evidence = {
      schema_version: 1,
      migration_blob: C1_MIGRATION_BLOB,
      rpc: {
        signature: C1_RPC_SECURITY_CASE.signature,
        fingerprint: C1_RPC_SECURITY_CASE.fingerprint,
        case_ids: [...C1_RPC_SECURITY_CASE.caseIds],
        result: 'SAFE',
      },
      result: 'PASS',
    };
    const c1EvidenceSha256 = createHash('sha256').update(`${canonicalJson(c1Evidence)}\n`, 'utf8').digest('hex');
    t.diagnostic(`C1_RPC_SECURITY_EVIDENCE_SHA256 ${c1EvidenceSha256}`);
  } finally {
    docker(`dropdb -U supabase_admin --force --if-exists ${db}`, { allowFailure: true });
  }
});

test('release finance snapshot accepts the deployed legacy journal contract and still rejects a broken canonical transaction', {
  skip: !enabled,
  timeout: 900_000,
}, () => {
  const db = `premium_b7_snapshot_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const ids = {
    ownerA: randomUUID(), ownerB: randomUUID(),
    accountA: randomUUID(), accountB: randomUUID(), platform: randomUUID(), escrow: randomUUID(),
    legacyTransfer: randomUUID(), legacyTransferJournal: randomUUID(),
    deposit: randomUUID(), withdrawal: randomUUID(), withdrawalJournal: randomUUID(),
    canonicalAB: randomUUID(), canonicalBA: randomUUID(), journalOnlyReward: randomUUID(),
    brokenCanonical: randomUUID(),
  };
  const snapshot = () => json(psql(db, `
    prepare nelyon_finance_snapshot(text,text) as ${FINANCE_SNAPSHOT_SQL};
    execute nelyon_finance_snapshot('m6-fixture','m6-run');
    deallocate nelyon_finance_snapshot;
  `));
  try {
    docker(`createdb -U supabase_admin -T ${template} ${db}`);
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
    `);
    psql(db, chain.map(item => item.sql).join('\n'));
    psql(db, `
      truncate table public.ledger_entries,public.financial_transactions,public.ledger_accounts cascade;
      set session_replication_role=replica;
      insert into auth.users(id,is_anonymous) values('${ids.ownerA}',false),('${ids.ownerB}',false);
      insert into public.user_profiles(id,username) values('${ids.ownerA}','snapshot_owner_a'),('${ids.ownerB}','snapshot_owner_b');
      set session_replication_role=origin;
      insert into public.ledger_accounts(id,owner_id,account_type,currency,balance,frozen) values
        ('${ids.accountA}','${ids.ownerA}','user','BDAG',79,false),
        ('${ids.accountB}','${ids.ownerB}','user','BDAG',7,false),
        ('${ids.platform}',null,'platform','BDAG',1,false),
        ('${ids.escrow}',null,'escrow','BDAG',18,false);

      insert into public.financial_transactions(
        id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,
        reference_type,reference_id,created_at
      ) values
        ('${ids.legacyTransfer}','${ids.accountA}','${ids.accountB}','transfer',10,1,'BDAG','completed',null,null,'2026-07-05T12:00:00Z'),
        ('${ids.deposit}',null,'${ids.accountA}','deposit',5,0,'BDAG','completed','deposit_confirmation','fixture','2026-07-06T12:00:00Z'),
        ('${ids.withdrawal}','${ids.accountA}','${ids.escrow}','withdrawal',20,2,'BDAG','completed',null,null,'2026-07-07T12:00:00Z'),
        ('${ids.canonicalAB}','${ids.accountA}','${ids.accountB}','marketplace_payment_capture',1,0,'BDAG','completed','marketplace_checkout','fixture-a','2026-08-01T12:00:00Z'),
        ('${ids.canonicalBA}','${ids.accountB}','${ids.accountA}','marketplace_return_refund',1,0,'BDAG','completed','marketplace_return_refund','fixture-b','2026-08-01T12:00:00Z');

      insert into public.ledger_entries(id,txn_id,account_id,entry_type,amount,balance_after,description,metadata,created_at) values
        ('10000000-0000-4000-8000-000000000001','${ids.legacyTransferJournal}','${ids.accountA}','debit',10,90,'legacy transfer',jsonb_build_object('fin_txn_id','${ids.legacyTransfer}'),'2026-07-05T12:00:00Z'),
        ('10000000-0000-4000-8000-000000000002','${ids.legacyTransferJournal}','${ids.accountB}','credit',9,9,'legacy transfer',jsonb_build_object('fin_txn_id','${ids.legacyTransfer}'),'2026-07-05T12:00:00Z'),
        ('10000000-0000-4000-8000-000000000003','${ids.legacyTransferJournal}','${ids.platform}','credit',1,1,'legacy transfer fee',jsonb_build_object('fin_txn_id','${ids.legacyTransfer}'),'2026-07-05T12:00:00Z'),
        ('20000000-0000-4000-8000-000000000001','${ids.deposit}','${ids.accountA}','credit',5,95,'legacy external deposit',jsonb_build_object('fin_txn_id','${ids.deposit}'),'2026-07-06T12:00:00Z'),
        ('30000000-0000-4000-8000-000000000001','${ids.withdrawalJournal}','${ids.accountA}','debit',20,75,'legacy withdrawal hold',null,'2026-07-07T12:00:00Z'),
        ('30000000-0000-4000-8000-000000000002','${ids.withdrawalJournal}','${ids.escrow}','credit',18,18,'legacy withdrawal escrow',null,'2026-07-07T12:00:00Z'),
        ('ffffffff-0000-4000-8000-000000000001','${ids.canonicalAB}','${ids.accountA}','debit',1,78,'canonical debit','{}','2026-08-01T12:00:00Z'),
        ('ffffffff-0000-4000-8000-000000000002','${ids.canonicalAB}','${ids.accountB}','credit',1,8,'canonical credit','{}','2026-08-01T12:00:00Z'),
        ('00000000-0000-4000-8000-000000000001','${ids.canonicalBA}','${ids.accountB}','debit',1,7,'canonical refund debit','{}','2026-08-01T12:00:00Z'),
        ('00000000-0000-4000-8000-000000000002','${ids.canonicalBA}','${ids.accountA}','credit',1,79,'canonical refund credit','{}','2026-08-01T12:00:00Z'),
        ('40000000-0000-4000-8000-000000000001','${ids.journalOnlyReward}','${ids.accountB}','credit',2,7,'legacy journal-only reward',jsonb_build_object('type','like_reward'),'2026-07-12T12:00:00Z');
    `);

    assert.deepEqual(snapshot().reconciliation, {
      account_balance_ledger_mismatch: 0,
      completed_credit_account_mismatch: 0,
      completed_credit_total_mismatch: 0,
      completed_debit_account_mismatch: 0,
      completed_debit_total_mismatch: 0,
      completed_without_credit: 0,
      completed_without_debit: 0,
      noncanonical_entry_type: 0,
      orphan_ledger_entries: 0,
      premium_finance_policy_row_count_mismatch: 0,
    });

    psql(db, `insert into public.financial_transactions(
      id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,
      reference_type,reference_id,created_at
    ) values(
      '${ids.brokenCanonical}','${ids.accountA}','${ids.accountB}','marketplace_payment_capture',3,0,'BDAG','completed',
      'marketplace_checkout','broken-fixture','2026-08-02T12:00:00Z'
    )`);
    const broken = snapshot().reconciliation;
    assert.equal(broken.completed_without_debit, 1);
    assert.equal(broken.completed_without_credit, 1);
    assert.equal(broken.completed_debit_total_mismatch, 1);
    assert.equal(broken.completed_credit_total_mismatch, 1);
  } finally {
    docker(`dropdb -U supabase_admin --force --if-exists ${db}`, { allowFailure: true });
  }
});
