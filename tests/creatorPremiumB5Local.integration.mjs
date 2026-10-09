// Real disposable PostgreSQL proof. Set NELYON_PREMIUM_B5_LOCAL=1 to enable it.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.NELYON_PREMIUM_B5_LOCAL === '1';
const container = process.env.NELYON_PREMIUM_B5_CONTAINER ?? 'nelyon-ads-v2-d-compile';
const template = process.env.NELYON_PREMIUM_B5_TEMPLATE ?? 'algo6_final_compile_a2';
const wslNamespacePid = process.env.NELYON_PREMIUM_B5_WSL_PID ?? '';
const migrations = new URL('../supabase/migrations/', import.meta.url);

function migration(suffix) {
  const found = readdirSync(migrations).filter(name => name.endsWith(suffix));
  return {
    found,
    sql: found.length === 1
      ? readFileSync(new URL(`../supabase/migrations/${found[0]}`, import.meta.url), 'utf8')
      : '',
  };
}

const chain = [
  migration('_creator_premium_b1_canonical_foundation.sql'),
  migration('_creator_premium_b2_private_image_media.sql'),
  migration('_creator_premium_b3_signed_stream_playback.sql'),
  migration('_creator_premium_b4_atomic_finance_authority.sql'),
  migration('_creator_premium_b4_c1_exact_fee_snapshot_binding.sql'),
  migration('_creator_premium_b5_creator_management_ux.sql'),
];

function runContainer(command, { input, allowFailure = false } = {}) {
  const executable = wslNamespacePid ? 'wsl.exe' : 'docker';
  const args = wslNamespacePid
    ? ['-d', 'docker-desktop', '-u', 'root', '-e', 'nsenter', '-t', wslNamespacePid,
      '-m', '-u', '-i', '-n', '-p', '/bin/sh', '-c', command]
    : ['exec', '-i', container, '/bin/sh', '-c', command];
  const result = spawnSync(executable, args, {
    encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${executable} disposable command failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function psql(db, sql, options = {}) {
  assert.match(db, /^[a-z0-9_]+$/);
  return runContainer(
    `psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d ${db} -At -F '|'`,
    { input: sql, ...options },
  );
}

function asRole(db, role, actor, sql, options = {}) {
  const subject = actor ? `set local request.jwt.claim.sub='${actor}';` : '';
  return psql(db, `begin;${subject}set local request.jwt.claim.role='${role}';set local role ${role};${sql};commit;`, options);
}

function expectFailure(result, expected) {
  assert.notEqual(result.status, 0, `expected failure matching ${expected}`);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(expected, 'i'));
}

function json(result) {
  return JSON.parse(result.stdout);
}

test('B5 disposable harness targets the complete Premium chain and one generated B5 migration', () => {
  for (const item of chain) assert.equal(item.found.length, 1);
  assert.match(chain.at(-1).found[0], /^\d{14}_creator_premium_b5_creator_management_ux\.sql$/);
  assert.ok(chain.at(-1).sql.length > 20_000);
});

test('B5 compiles and proves creator draft, media, offer, plan, review, delete, and cleanup lifecycle', {
  skip: !enabled,
  timeout: 600_000,
}, () => {
  const db = `premium_b5_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const uid = () => randomUUID();
  const id = {
    creator: uid(), other: uid(), minor: uid(), restricted: uid(),
    request: uid(), changedRequest: uid(), imageRequest: uid(), videoRequest: uid(),
    subscriptionRequest: uid(), subscription2Request: uid(), deleteRequest: uid(), otherRequest: uid(),
    offer1: uid(), offer2: uid(), offerNoOp: uid(), offer3: uid(), videoOffer: uid(), deleteOffer: uid(), nanOfferRequest: uid(),
    planRequest: uid(), planCloneRequest: uid(), deletePlanRequest: uid(), nanPlanRequest: uid(),
    collisionPlanRequest: uid(),
    teaser1: uid(), original1: uid(), teaser2: uid(), original2: uid(), teaser3: uid(), original3: uid(),
    videoTeaser1: uid(), videoTeaser2: uid(), video1: uid(), video2: uid(),
    stalePremium: uid(), recentPremium: uid(), business: uid(), feed: uid(),
    deleteTeaser: uid(), deleteOriginal: uid(),
  };

  const imageAsset = ({ assetId, purpose, visibility, url = null, age = '0 minutes' }) => `
    insert into public.media_assets(
      id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,
      size_bytes,status,ready_at,public_url,created_at
    ) values (
      '${assetId}','${id.creator}','r2','image','${purpose}','${visibility}',
      '${visibility === 'public' ? 'public-bucket' : 'private-bucket'}','premium/${assetId}.jpg',
      'image/jpeg',1000,'ready',clock_timestamp(),${url ? `'${url}'` : 'null'},
      clock_timestamp() - interval '${age}'
    );`;
  const streamAsset = ({ assetId, purpose = 'creator_premium_video', status = 'ready', age = '0 minutes' }) => `
    insert into public.video_assets(
      id,owner_id,provider,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes,
      max_duration_seconds,duration_seconds,width,height,provider_status,provider_progress,
      provider_metadata,ready_at,last_provider_check_at,created_at
    ) values (
      '${assetId}','${id.creator}','cloudflare_stream','${purpose}',
      '${purpose === 'creator_premium_video' ? 'private' : 'public'}','${status}',
      '${assetId.replaceAll('-', '').slice(0, 32)}','video/mp4',1000000,60,
      ${status === 'ready' ? '12,1920,1080' : 'null,null,null'},'${status}',
      ${status === 'ready' ? '100' : '20'},
      '${purpose === 'creator_premium_video' ? '{"require_signed_urls":true}' : '{}'}'::jsonb,
      ${status === 'ready' ? 'clock_timestamp()' : 'null'},clock_timestamp(),
      clock_timestamp() - interval '${age}'
    );`;

  try {
    runContainer(`createdb -U supabase_admin -T ${template} ${db}`);
    psql(db, chain.map(item => item.sql).join('\n'));

    psql(db, `
      set session_replication_role=replica;
      insert into auth.users(id,is_anonymous,banned_until) values
        ('${id.creator}',false,null),('${id.other}',false,null),('${id.minor}',false,null),
        ('${id.restricted}',false,clock_timestamp()+interval '1 day');
      insert into public.user_profiles(id,username) values
        ('${id.creator}','premium_b5_creator'),('${id.other}','premium_b5_other'),
        ('${id.minor}','premium_b5_minor'),('${id.restricted}','premium_b5_restricted');
      insert into private.user_age_eligibility(
        user_id,status,minimum_age,policy_version,evaluated_at,source,age_band,birth_date
      )
      select fixture.user_id,'eligible',policy.minimum_age,policy.policy_version,
             clock_timestamp(),'signup_metadata',fixture.age_band,
             current_date-fixture.years*interval '1 year'
      from (values
        ('${id.creator}'::uuid,'age_18_plus'::text,30),
        ('${id.other}'::uuid,'age_18_plus'::text,31),
        ('${id.minor}'::uuid,'age_13_17'::text,16),
        ('${id.restricted}'::uuid,'age_18_plus'::text,32)
      ) fixture(user_id,age_band,years)
      cross join private.age_eligibility_policy policy where policy.singleton=true;
      set session_replication_role=origin;
    `);

    const create = (actor, title, kind, access, request, options = {}) => asRole(db, 'authenticated', actor, `
      select to_jsonb(result) from public.create_my_creator_premium_draft_v1(
        '${title}','description','${kind}','${access}','${request}'
      ) result;
    `, options);
    const first = json(create(id.creator, 'Idempotent draft', 'image', 'purchase', id.request));
    assert.equal(first.created, true);
    assert.equal(json(create(id.creator, 'Idempotent draft', 'image', 'purchase', id.request)).id, first.id);
    expectFailure(create(id.creator, 'Changed payload', 'image', 'purchase', id.request, { allowFailure: true }), 'idempotency_conflict');
    expectFailure(create(id.minor, 'Minor draft', 'image', 'purchase', uid(), { allowFailure: true }), 'age_eligibility');
    expectFailure(create(id.restricted, 'Restricted draft', 'image', 'purchase', uid(), { allowFailure: true }), 'account_restricted');

    const image = json(create(id.creator, 'Image draft', 'image', 'purchase', id.imageRequest));
    const video = json(create(id.creator, 'Video draft', 'video', 'purchase', id.videoRequest));
    const subscription = json(create(id.creator, 'Subscription draft', 'image', 'subscription', id.subscriptionRequest));
    const subscription2 = json(create(id.creator, 'Second subscription draft', 'image', 'subscription', id.subscription2Request));
    const deleted = json(create(id.creator, 'Delete me', 'image', 'purchase_or_subscription', id.deleteRequest));
    const other = json(create(id.other, 'Other content', 'image', 'subscription', id.otherRequest));

    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.update_my_creator_premium_draft_v1('${first.id}','Idempotent draft','description','video','purchase') result`)).id, first.id);
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.update_my_creator_premium_draft_v1('${first.id}','Idempotent draft','description','image','purchase') result`)).id, first.id);

    psql(db, `
      ${imageAsset({ assetId: id.teaser1, purpose: 'creator_premium_teaser_image', visibility: 'public', url: 'https://cdn.test/teaser1.jpg' })}
      ${imageAsset({ assetId: id.original1, purpose: 'creator_premium_original_image', visibility: 'private' })}
      ${imageAsset({ assetId: id.teaser2, purpose: 'creator_premium_teaser_image', visibility: 'public', url: 'https://cdn.test/teaser2.jpg' })}
      ${imageAsset({ assetId: id.original2, purpose: 'creator_premium_original_image', visibility: 'private' })}
      ${imageAsset({ assetId: id.teaser3, purpose: 'creator_premium_teaser_image', visibility: 'public', url: 'https://cdn.test/teaser3.jpg' })}
      ${imageAsset({ assetId: id.original3, purpose: 'creator_premium_original_image', visibility: 'private' })}
      ${imageAsset({ assetId: id.videoTeaser1, purpose: 'creator_premium_teaser_image', visibility: 'public', url: 'https://cdn.test/video1.jpg' })}
      ${imageAsset({ assetId: id.videoTeaser2, purpose: 'creator_premium_teaser_image', visibility: 'public', url: 'https://cdn.test/video2.jpg' })}
      ${imageAsset({ assetId: id.deleteTeaser, purpose: 'creator_premium_teaser_image', visibility: 'public', url: 'https://cdn.test/delete.jpg' })}
      ${imageAsset({ assetId: id.deleteOriginal, purpose: 'creator_premium_original_image', visibility: 'private' })}
      ${streamAsset({ assetId: id.video1 })}
      ${streamAsset({ assetId: id.video2 })}
      ${streamAsset({ assetId: id.stalePremium, status: 'uploading', age: '25 hours' })}
      ${streamAsset({ assetId: id.recentPremium, status: 'uploading', age: '2 hours' })}
      ${streamAsset({ assetId: id.business, purpose: 'business_library', status: 'uploading', age: '48 hours' })}
      ${streamAsset({ assetId: id.feed, purpose: 'feed_video', status: 'uploading', age: '48 hours' })}
    `);

    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_image_media_v1('${image.id}','${id.teaser1}','${id.original1}') result`)).media_ready, true);
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_image_media_v1('${subscription.id}','${id.teaser2}','${id.original2}') result`)).media_ready, true);
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_image_media_v1('${subscription2.id}','${id.teaser3}','${id.original3}') result`)).media_ready, true);
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_image_media_v1('${deleted.id}','${id.deleteTeaser}','${id.deleteOriginal}') result`)).media_ready, true);
    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.update_my_creator_premium_draft_v1('${image.id}','Image draft','description','video','purchase')`, { allowFailure: true }), 'content_kind_locked_by_media');

    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.set_my_creator_premium_offer_v1('${image.id}','NaN'::numeric,'${id.nanOfferRequest}')`, { allowFailure: true }), 'creator_premium_offer_invalid');
    expectFailure(psql(db, `insert into private.creator_premium_offer_versions(content_id,creator_id,version,price_bdag,currency,status) values ('${image.id}','${id.creator}',99,'NaN'::numeric,'BDAG','draft')`, { allowFailure: true }), 'creator_premium_offer_versions_price_check');

    const offer1 = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_offer_v1('${image.id}',10,'${id.offer1}') result`));
    assert.equal(offer1.version, 1);
    assert.equal(offer1.price_bdag, '10.00000000');
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_offer_v1('${image.id}',10.00000000,'${id.offer1}') result`)).version, 1);
    const offer2 = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_offer_v1('${image.id}',12,'${id.offer2}') result`));
    assert.equal(offer2.version, 2);
    const offerNoOp = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_offer_v1('${image.id}',12,'${id.offerNoOp}') result`));
    assert.equal(offerNoOp.version, 2);
    assert.equal(offerNoOp.replayed, true);
    const offer3 = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_offer_v1('${image.id}',13,'${id.offer3}') result`));
    assert.equal(offer3.version, 3);
    const lostResponseReplay = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_offer_v1('${image.id}',12,'${id.offerNoOp}') result`));
    assert.equal(lostResponseReplay.version, 2);
    assert.equal(lostResponseReplay.replayed, true);
    assert.equal(psql(db, `select string_agg(version||':'||status,',' order by version) from private.creator_premium_offer_versions where content_id='${image.id}'`).stdout, '1:retired,2:retired,3:active');
    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.update_my_creator_premium_draft_v1('${image.id}','Image draft','description','image','subscription')`, { allowFailure: true }), 'access_mode_locked_by_commercial_state');

    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.create_my_creator_premium_plan_draft_v1('Invalid','NaN','NaN'::numeric,30,'${id.nanPlanRequest}')`, { allowFailure: true }), 'creator_premium_plan_invalid');
    expectFailure(psql(db, `insert into private.creator_premium_plans(creator_id,plan_key,version,name,description,price_bdag,currency,status,billing_period_days) values ('${id.creator}','plan_nan_direct',1,'Invalid','NaN','NaN'::numeric,'BDAG','draft',30)`, { allowFailure: true }), 'creator_premium_plans_price_check');
    json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.create_my_creator_premium_plan_draft_v1('a|b','c',20,30,'${id.collisionPlanRequest}') result`));
    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.create_my_creator_premium_plan_draft_v1('a','b|c',20,30,'${id.collisionPlanRequest}')`, { allowFailure: true }), 'creator_premium_plan_idempotency_conflict');

    const plan = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.create_my_creator_premium_plan_draft_v1('VIP','Plan',20,30,'${id.planRequest}') result`));
    assert.equal(plan.version, 1);
    assert.equal(plan.billing_period_days, 30);
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.create_my_creator_premium_plan_draft_v1('VIP','Plan',20.00000000,30,'${id.planRequest}') result`)).id, plan.id);
    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.set_my_creator_premium_plan_contents_v1('${plan.id}',array['${other.id}']::uuid[])`, { allowFailure: true }), 'plan_content_not_found');
    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.set_my_creator_premium_plan_contents_v1('${plan.id}',array['${image.id}']::uuid[])`, { allowFailure: true }), 'subscription_required');
    const mapped = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_plan_contents_v1('${plan.id}',array['${subscription.id}','${subscription.id}','${subscription2.id}']::uuid[]) result`));
    assert.equal(mapped.mapped_content_count, 2);
    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.update_my_creator_premium_draft_v1('${subscription.id}','Subscription draft','description','image','purchase')`, { allowFailure: true }), 'access_mode_locked_by_commercial_state');

    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.activate_my_creator_premium_plan_v1('${plan.id}')`, { allowFailure: true }), 'plan_content_review_required');
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.submit_my_creator_premium_content_for_review_v1('${subscription.id}') result`)).lifecycle_status, 'pending_review');
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.submit_my_creator_premium_content_for_review_v1('${subscription2.id}') result`)).lifecycle_status, 'pending_review');
    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.set_my_creator_premium_plan_contents_v1('${plan.id}','{}'::uuid[])`, { allowFailure: true }), 'plan_content_review_locked');
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.activate_my_creator_premium_plan_v1('${plan.id}') result`)).status, 'active');
    const clone = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.clone_my_creator_premium_plan_version_v1('${plan.id}','${id.planCloneRequest}') result`));
    assert.equal(clone.version, 2);
    assert.equal(clone.status, 'draft');
    assert.equal(psql(db, `select count(*) from private.creator_premium_plan_contents where plan_id='${clone.id}'`).stdout, '2');
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_plan_contents_v1('${clone.id}',array['${subscription2.id}']::uuid[]) result`)).mapped_content_count, 1);
    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.activate_my_creator_premium_plan_v1('${clone.id}')`, { allowFailure: true }), 'plan_content_review_locked');
    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.retire_my_creator_premium_plan_v1('${plan.id}')`, { allowFailure: true }), 'plan_content_review_locked');

    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.submit_my_creator_premium_content_for_review_v1('${image.id}') result`)).lifecycle_status, 'pending_review');
    assert.equal(psql(db, `select published_at is null from private.creator_premium_contents where id='${image.id}'`).stdout, 't');
    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.update_my_creator_premium_draft_v1('${image.id}','No publish','description','image','purchase')`, { allowFailure: true }), 'draft_only');

    const firstVideo = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_video_media_v1('${video.id}','${id.videoTeaser1}','${id.video1}') result`));
    assert.equal(firstVideo.replayed, false);
    const replacement = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_video_media_v1('${video.id}','${id.videoTeaser2}','${id.video2}') result`));
    assert.equal(replacement.replacement_cleanup_scheduled, true);
    assert.equal(psql(db, `select status from public.video_assets where id='${id.video1}'`).stdout, 'delete_pending');
    assert.equal(psql(db, `select count(*) from public.video_asset_links where entity_id='${video.id}' and asset_id='${id.video2}'`).stdout, '1');
    assert.equal(json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_video_media_v1('${video.id}','${id.videoTeaser2}','${id.video2}') result`)).replayed, true);
    asRole(db, 'authenticated', id.creator, `select public.set_my_creator_premium_offer_v1('${video.id}',8,'${id.videoOffer}')`);

    asRole(db, 'authenticated', id.creator, `select public.set_my_creator_premium_offer_v1('${deleted.id}',5,'${id.deleteOffer}')`);
    const deletePlan = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.create_my_creator_premium_plan_draft_v1('Delete plan','Plan',5,14,'${id.deletePlanRequest}') result`));
    asRole(db, 'authenticated', id.creator, `select public.set_my_creator_premium_plan_contents_v1('${deletePlan.id}',array['${deleted.id}']::uuid[])`);
    const deletedResult = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.delete_my_creator_premium_draft_v1('${deleted.id}') result`));
    assert.equal(deletedResult.lifecycle_status, 'deleted');
    assert.equal(psql(db, `select count(*) from private.creator_premium_plan_contents where content_id='${deleted.id}'`).stdout, '0');
    assert.equal(psql(db, `select status from private.creator_premium_offer_versions where content_id='${deleted.id}'`).stdout, 'retired');

    const claimed = psql(db, `select id from public.cleanup_stale_creator_premium_video_records(50) order by id`).stdout.split(/\r?\n/).filter(Boolean);
    assert.ok(claimed.includes(id.video1));
    assert.ok(claimed.includes(id.stalePremium));
    assert.ok(!claimed.includes(id.video2));
    assert.ok(!claimed.includes(id.recentPremium));
    assert.ok(!claimed.includes(id.business));
    assert.ok(!claimed.includes(id.feed));
    assert.equal(psql(db, `select status from public.video_assets where id='${id.business}'`).stdout, 'uploading');

    const owner = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.get_my_creator_premium_contents_v1(100,null,null) result where result.id='${video.id}'`));
    assert.equal(owner.video_media_ready, true);
    assert.equal(owner.submission_ready, true);
    psql(db, `
      insert into private.creator_premium_contents(
        creator_id,title,description,content_kind,access_mode,lifecycle_status,client_request_id
      )
      select '${id.creator}', 'Newer draft ' || item, '', 'image', 'purchase', 'draft', gen_random_uuid()
      from generate_series(1, 101) item;
    `);
    const exactOlder = json(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.get_my_creator_premium_content_v1('${video.id}') result`));
    assert.equal(exactOlder.id, video.id);
    for (const forbidden of ['cloudflare_uid', 'video_asset_id', 'object_key', 'bucket_name']) {
      assert.equal(Object.hasOwn(owner, forbidden), false);
    }
    assert.equal(psql(db, `select count(*) from public.financial_transactions where operation_type like 'creator_premium_%'`).stdout, '0');
    assert.equal(psql(db, `select purchase_enabled||'|'||subscription_enabled||'|'||refunds_enabled||'|'||platform_fee_bps from private.creator_premium_finance_policy`).stdout, 'false|false|false|0');

    for (const signature of [
      'set_my_creator_premium_offer_v1(uuid,numeric,uuid)',
      'create_my_creator_premium_plan_draft_v1(text,text,numeric,integer,uuid)',
      'submit_my_creator_premium_content_for_review_v1(uuid)',
      'delete_my_creator_premium_draft_v1(uuid)',
    ]) {
      assert.equal(psql(db, `select concat_ws('|',has_function_privilege('anon','public.${signature}','execute'),has_function_privilege('authenticated','public.${signature}','execute'))`).stdout, 'f|t');
    }
    assert.equal(psql(db, `select concat_ws('|',has_function_privilege('anon','public.cleanup_stale_creator_premium_video_records(integer)','execute'),has_function_privilege('authenticated','public.cleanup_stale_creator_premium_video_records(integer)','execute'),has_function_privilege('service_role','public.cleanup_stale_creator_premium_video_records(integer)','execute'))`).stdout, 'f|f|t');
  } finally {
    runContainer(`dropdb -U supabase_admin --force --if-exists ${db}`, { allowFailure: true });
  }
});
