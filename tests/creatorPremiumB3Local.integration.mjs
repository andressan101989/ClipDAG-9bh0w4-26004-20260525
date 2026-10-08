// Real disposable PostgreSQL proof. Set NELYON_PREMIUM_B3_LOCAL=1 to enable it.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.NELYON_PREMIUM_B3_LOCAL === '1';
const container = process.env.NELYON_PREMIUM_B3_CONTAINER ?? 'nelyon-ads-v2-d-compile';
const template = process.env.NELYON_PREMIUM_B3_TEMPLATE ?? 'algo6_final_compile_a2';
const wslNamespacePid = process.env.NELYON_PREMIUM_B3_WSL_PID ?? '';
const migrations = new URL('../supabase/migrations/', import.meta.url);
const migrationText = suffix => {
  const found = readdirSync(migrations).filter(name => name.endsWith(suffix));
  return {
    found,
    sql: found.length === 1
      ? readFileSync(new URL(`../supabase/migrations/${found[0]}`, import.meta.url), 'utf8')
      : '',
  };
};
const b1 = migrationText('_creator_premium_b1_canonical_foundation.sql');
const b2 = migrationText('_creator_premium_b2_private_image_media.sql');
const b3 = migrationText('_creator_premium_b3_signed_stream_playback.sql');

function runContainer(command, { input, allowFailure = false } = {}) {
  const executable = wslNamespacePid ? 'wsl.exe' : 'docker';
  const args = wslNamespacePid
    ? ['-d', 'docker-desktop', '-u', 'root', '-e', 'nsenter', '-t', wslNamespacePid,
      '-m', '-u', '-i', '-n', '-p', '/bin/sh', '-c', command]
    : ['exec', '-i', container, '/bin/sh', '-c', command];
  const result = spawnSync(executable, args, {
    encoding: 'utf8', input, maxBuffer: 32 * 1024 * 1024,
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

function expectFailure(result, message) {
  assert.notEqual(result.status, 0, `expected failure matching ${message}`);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(message, 'i'));
}

test('B3 disposable harness targets B1, B2, and exactly one generated B3 migration', () => {
  assert.equal(b1.found.length, 1);
  assert.equal(b2.found.length, 1);
  assert.equal(b3.found.length, 1);
  assert.match(b3.found[0], /^\d{14}_creator_premium_b3_signed_stream_playback\.sql$/);
  assert.ok(b3.sql.length > 10_000);
});

test('B3 compiles and proves private Stream binding, projections, RLS, and B2 compatibility', {
  skip: !enabled,
  timeout: 300_000,
}, () => {
  const db = `premium_b3_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const id = {
    creator: 'b1000000-0000-4000-8000-000000000001',
    creator2: 'b1000000-0000-4000-8000-000000000002',
    buyer: 'b1000000-0000-4000-8000-000000000003',
    minor: 'b1000000-0000-4000-8000-000000000004',
    video1: 'b2000000-0000-4000-8000-000000000001',
    video2: 'b2000000-0000-4000-8000-000000000002',
    videoPublished: 'b2000000-0000-4000-8000-000000000003',
    image1: 'b2000000-0000-4000-8000-000000000004',
    minorVideo: 'b2000000-0000-4000-8000-000000000005',
    teaser1: 'b3000000-0000-4000-8000-000000000001',
    teaser2: 'b3000000-0000-4000-8000-000000000002',
    teaser3: 'b3000000-0000-4000-8000-000000000003',
    imageOriginal: 'b3000000-0000-4000-8000-000000000004',
    stream1: 'b4000000-0000-4000-8000-000000000001',
    stream2: 'b4000000-0000-4000-8000-000000000002',
    stream3: 'b4000000-0000-4000-8000-000000000003',
    streamCross: 'b4000000-0000-4000-8000-000000000004',
    streamFeed: 'b4000000-0000-4000-8000-000000000005',
    streamPending: 'b4000000-0000-4000-8000-000000000006',
    reservedPremium: 'b4000000-0000-4000-8000-000000000007',
    reservedFeed: 'b4000000-0000-4000-8000-000000000008',
  };

  const teaser = ({ assetId, owner = id.creator, publicUrl }) => `
    insert into public.media_assets(
      id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,
      size_bytes,status,ready_at,public_url
    ) values (
      '${assetId}','${owner}','r2','image','creator_premium_teaser_image','public',
      'public-bucket','premium/${assetId}.jpg','image/jpeg',1000,'ready',clock_timestamp(),'${publicUrl}'
    );`;

  const stream = ({
    assetId, owner = id.creator, purpose = 'creator_premium_video', visibility = 'private',
    status = 'ready', uid = assetId.replaceAll('-', '').slice(0, 32), signed = true,
  }) => `
    insert into public.video_assets(
      id,owner_id,provider,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes,
      max_duration_seconds,duration_seconds,width,height,hls_url,dash_url,thumbnail_url,
      provider_status,provider_progress,provider_metadata,ready_at,last_provider_check_at
      ,created_at
    ) values (
      '${assetId}','${owner}','cloudflare_stream','${purpose}','${visibility}','${status}',
      '${uid}','video/mp4',1000000,60,${status === 'ready' ? '12' : 'null'},
      ${status === 'ready' ? '1920' : 'null'},${status === 'ready' ? '1080' : 'null'},
      ${purpose === 'creator_premium_video' ? 'null' : `'https://customer.example/${uid}/manifest/video.m3u8'`},
      null,null,'${status}',${status === 'ready' ? '100' : '25'},
      '${signed ? '{"require_signed_urls":true}' : '{}'}'::jsonb,
      ${status === 'ready' ? 'clock_timestamp()' : 'null'},clock_timestamp(),
      clock_timestamp() - interval '2 minutes'
    );`;

  try {
    runContainer(`createdb -U supabase_admin -T ${template} ${db}`);
    psql(db, `${b1.sql}\n${b2.sql}\n${b3.sql}`);

    const purposeConstraint = psql(db, `select pg_get_constraintdef(oid) from pg_constraint where conname='video_assets_purpose_check'`).stdout;
    assert.match(purposeConstraint, /feed_video/);
    assert.match(purposeConstraint, /business_library/);
    assert.match(purposeConstraint, /creator_premium_video/);
    const entityConstraint = psql(db, `select pg_get_constraintdef(oid) from pg_constraint where conname='video_asset_links_entity_type_check'`).stdout;
    assert.match(entityConstraint, /exclusive_content/);
    assert.match(entityConstraint, /creator_premium_content/);
    assert.equal(psql(db, `select count(*) from pg_trigger where tgname='video_asset_links_guard_creator_premium' and not tgisinternal`).stdout, '1');
    assert.equal(psql(db, `select count(*) from pg_indexes where schemaname='public' and indexname like 'creator_premium_video_%_uidx'`).stdout, '2');

    psql(db, `
      set session_replication_role=replica;
      insert into auth.users(id,is_anonymous) values
        ('${id.creator}',false),('${id.creator2}',false),('${id.buyer}',false),('${id.minor}',false);
      insert into public.user_profiles(id,username) values
        ('${id.creator}','premium_b3_creator'),('${id.creator2}','premium_b3_creator2'),
        ('${id.buyer}','premium_b3_buyer'),('${id.minor}','premium_b3_minor');
      insert into private.user_age_eligibility(
        user_id,status,minimum_age,policy_version,evaluated_at,source,age_band,birth_date
      ) values
        ('${id.creator}','eligible',13,'nelyon-age-v2',clock_timestamp(),'signup_metadata','age_18_plus',current_date-interval '30 years'),
        ('${id.creator2}','eligible',13,'nelyon-age-v2',clock_timestamp(),'signup_metadata','age_18_plus',current_date-interval '31 years'),
        ('${id.buyer}','eligible',13,'nelyon-age-v2',clock_timestamp(),'signup_metadata','age_18_plus',current_date-interval '25 years'),
        ('${id.minor}','eligible',13,'nelyon-age-v2',clock_timestamp(),'signup_metadata','age_13_17',current_date-interval '16 years');
      set session_replication_role=origin;
      insert into private.creator_premium_contents(id,creator_id,title,content_kind,access_mode,lifecycle_status,published_at)
      values
        ('${id.video1}','${id.creator}','Video one','video','purchase','draft',null),
        ('${id.video2}','${id.creator}','Video two','video','purchase','draft',null),
        ('${id.videoPublished}','${id.creator}','Video published','video','purchase','published',clock_timestamp()),
        ('${id.image1}','${id.creator}','Image one','image','purchase','draft',null),
        ('${id.minorVideo}','${id.minor}','Minor video','video','purchase','draft',null);
      ${teaser({ assetId: id.teaser1, publicUrl: 'https://cdn.example.test/b3-teaser1.jpg' })}
      ${teaser({ assetId: id.teaser2, publicUrl: 'https://cdn.example.test/b3-teaser2.jpg' })}
      ${teaser({ assetId: id.teaser3, publicUrl: 'https://cdn.example.test/b3-teaser3.jpg' })}
      insert into public.media_assets(
        id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,
        size_bytes,status,ready_at,public_url
      ) values (
        '${id.imageOriginal}','${id.creator}','r2','image','creator_premium_original_image','private',
        'private-bucket','premium/${id.imageOriginal}.jpg','image/jpeg',1000,'ready',clock_timestamp(),null
      );
      ${stream({ assetId: id.stream1 })}
      ${stream({ assetId: id.stream2 })}
      ${stream({ assetId: id.stream3 })}
      ${stream({ assetId: id.streamCross, owner: id.creator2 })}
      ${stream({ assetId: id.streamFeed, purpose: 'feed_video', visibility: 'public', signed: false })}
      ${stream({ assetId: id.streamPending, status: 'processing' })}
    `);

    assert.equal(asRole(db, 'authenticated', id.creator, `select public.authorize_my_creator_premium_video_upload_v1('${id.video1}')`).stdout, 't');
    assert.equal(asRole(db, 'authenticated', id.creator, `select public.authorize_my_creator_premium_image_upload_v1('${id.video1}','creator_premium_teaser_image')`).stdout, 't');
    expectFailure(asRole(db, 'authenticated', id.creator, `select public.authorize_my_creator_premium_image_upload_v1('${id.video1}','creator_premium_original_image')`, { allowFailure: true }), 'image_content_required');
    expectFailure(asRole(db, 'authenticated', id.minor, `select public.authorize_my_creator_premium_video_upload_v1('${id.minorVideo}')`, { allowFailure: true }), 'age_eligibility');
    expectFailure(asRole(db, 'authenticated', id.buyer, `select public.authorize_my_creator_premium_video_upload_v1('${id.video1}')`, { allowFailure: true }), 'content_not_found');
    expectFailure(asRole(db, 'authenticated', id.creator, `select public.authorize_my_creator_premium_video_upload_v1('${id.videoPublished}')`, { allowFailure: true }), 'draft_only');
    expectFailure(asRole(db, 'authenticated', id.creator, `select public.authorize_my_creator_premium_video_upload_v1('${id.image1}')`, { allowFailure: true }), 'video_content_required');

    assert.equal(asRole(db, 'service_role', null, `select public.reserve_stream_upload_asset('${id.reservedPremium}','${id.creator}','video/mp4',1000,'premium.mp4','creator_premium_video')`).stdout, 'created');
    assert.equal(psql(db, `select purpose||'|'||visibility from public.video_assets where id='${id.reservedPremium}'`).stdout, 'creator_premium_video|private');
    assert.equal(asRole(db, 'service_role', null, `select public.reserve_stream_upload_asset('${id.reservedFeed}','${id.creator2}','video/mp4',1000,'feed.mp4')`).stdout, 'created');
    assert.equal(psql(db, `select purpose||'|'||visibility from public.video_assets where id='${id.reservedFeed}'`).stdout, 'feed_video|public');

    for (const invalid of [
      `insert into public.video_assets(id,owner_id,provider,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes,max_duration_seconds,duration_seconds,ready_at,provider_metadata) values(gen_random_uuid(),'${id.creator}','cloudflare_stream','creator_premium_video','public','processing','bad-public','video/mp4',1,60,null,null,'{}')`,
      `insert into public.video_assets(id,owner_id,provider,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes,max_duration_seconds,duration_seconds,ready_at,provider_metadata) values(gen_random_uuid(),'${id.creator}','cloudflare_stream','creator_premium_video','private','ready','missing-proof','video/mp4',1,60,1,clock_timestamp(),'{}')`,
      `insert into public.video_assets(id,owner_id,provider,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes,max_duration_seconds,duration_seconds,ready_at,provider_metadata) values(gen_random_uuid(),'${id.creator}','cloudflare_stream','creator_premium_video','private','ready','false-proof','video/mp4',1,60,1,clock_timestamp(),'{"require_signed_urls":false}')`,
      `insert into public.video_assets(id,owner_id,provider,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes,max_duration_seconds,duration_seconds,ready_at,provider_metadata) values(gen_random_uuid(),'${id.creator}','cloudflare_stream','creator_premium_video','private','ready','string-proof','video/mp4',1,60,1,clock_timestamp(),'{"require_signed_urls":"true"}')`,
      `insert into public.video_assets(id,owner_id,provider,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes,max_duration_seconds,duration_seconds,ready_at,provider_metadata,hls_url) values(gen_random_uuid(),'${id.creator}','cloudflare_stream','creator_premium_video','private','ready','url-proof','video/mp4',1,60,1,clock_timestamp(),'{"require_signed_urls":true}','https://forbidden.test/video.m3u8')`,
    ]) expectFailure(psql(db, invalid, { allowFailure: true }), 'check constraint');

    for (const invalidLink of [
      `insert into public.video_asset_links(asset_id,owner_id,entity_type,entity_id,slot,position) values('${id.stream3}','${id.creator}','creator_premium_content','${id.video2}','wrong',0)`,
      `insert into public.video_asset_links(asset_id,owner_id,entity_type,entity_id,slot,position) values('${id.stream3}','${id.creator}','creator_premium_content','${id.video2}','original',1)`,
      `insert into public.video_asset_links(asset_id,owner_id,entity_type,entity_id,slot,position) values('${id.streamCross}','${id.creator2}','creator_premium_content','${id.video2}','original',0)`,
      `insert into public.video_asset_links(asset_id,owner_id,entity_type,entity_id,slot,position) values('${id.streamFeed}','${id.creator}','creator_premium_content','${id.video2}','original',0)`,
      `insert into public.video_asset_links(asset_id,owner_id,entity_type,entity_id,slot,position) values('${id.streamPending}','${id.creator}','creator_premium_content','${id.video2}','original',0)`,
      `insert into public.video_asset_links(asset_id,owner_id,entity_type,entity_id,slot,position) values('${id.stream3}','${id.creator}','creator_premium_content','${id.image1}','original',0)`,
      `insert into public.video_asset_links(asset_id,owner_id,entity_type,entity_id,slot,position) values('${id.stream3}','${id.creator}','video_post','${id.video2}','video',0)`,
    ]) expectFailure(psql(db, invalidLink, { allowFailure: true }), 'creator_premium|check constraint');

    const first = JSON.parse(asRole(db, 'authenticated', id.creator, `
      select to_jsonb(result) from public.set_my_creator_premium_video_media_v1(
        '${id.video1}','${id.teaser1}','${id.stream1}'
      ) result;
    `).stdout);
    assert.deepEqual(first, {
      content_id: id.video1,
      teaser_url: 'https://cdn.example.test/b3-teaser1.jpg',
      teaser_attached: true,
      video_attached: true,
      media_ready: true,
      replayed: false,
    });
    const replay = JSON.parse(asRole(db, 'authenticated', id.creator, `
      select to_jsonb(result) from public.set_my_creator_premium_video_media_v1(
        '${id.video1}','${id.teaser1}','${id.stream1}'
      ) result;
    `).stdout);
    assert.equal(replay.replayed, true);
    assert.equal(psql(db, `select count(*) from public.video_asset_links where entity_type='creator_premium_content' and entity_id='${id.video1}'`).stdout, '1');
    assert.equal(psql(db, `select count(*) from public.media_asset_links where entity_type='creator_premium_content' and entity_id='${id.video1}' and slot='teaser'`).stdout, '1');
    assert.equal(psql(db, `select public.media_asset_has_valid_links('${id.teaser1}')`).stdout, 't');

    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.set_my_creator_premium_video_media_v1('${id.video1}','${id.teaser2}','${id.stream2}')`, { allowFailure: true }), 'video_media_already_bound');
    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.set_my_creator_premium_video_media_v1('${id.video2}','${id.teaser2}','${id.stream1}')`, { allowFailure: true }), 'video_asset_in_use');
    expectFailure(asRole(db, 'authenticated', id.creator2, `select * from public.set_my_creator_premium_video_media_v1('${id.video1}','${id.teaser2}','${id.streamCross}')`, { allowFailure: true }), 'content_not_found');
    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.set_my_creator_premium_video_media_v1('${id.video2}','${id.teaser2}','${id.streamFeed}')`, { allowFailure: true }), 'video_invalid');
    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.set_my_creator_premium_video_media_v1('${id.video2}','${id.teaser2}','${id.streamPending}')`, { allowFailure: true }), 'video_invalid');
    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.set_my_creator_premium_video_media_v1('${id.image1}','${id.teaser2}','${id.stream2}')`, { allowFailure: true }), 'video_content_required');
    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.set_my_creator_premium_video_media_v1('${id.videoPublished}','${id.teaser2}','${id.stream2}')`, { allowFailure: true }), 'draft_only');

    assert.equal(asRole(db, 'authenticated', id.creator, `select count(*) from public.video_assets where id='${id.stream1}'`).stdout, '0');
    assert.equal(asRole(db, 'authenticated', id.creator, `select count(*) from public.video_asset_links where entity_type='creator_premium_content'`).stdout, '0');

    const ownerState = JSON.parse(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.get_my_creator_premium_video_media_v1('${id.video1}') result`).stdout);
    assert.equal(ownerState.video_attached, true);
    assert.equal(ownerState.video_ready, true);
    assert.equal(ownerState.media_ready, true);
    for (const forbidden of ['video_asset_id', 'cloudflare_uid', 'hls_url', 'dash_url', 'thumbnail_url']) {
      assert.equal(Object.hasOwn(ownerState, forbidden), false, forbidden);
    }

    psql(db, `update private.creator_premium_contents set lifecycle_status='published',published_at=clock_timestamp(),updated_at=clock_timestamp() where id='${id.video1}'`);
    const catalog = JSON.parse(asRole(db, 'authenticated', id.buyer, `select to_jsonb(result) from public.get_creator_premium_catalog_v1('${id.creator}',24,null,null) result where result.id='${id.video1}'`).stdout);
    assert.equal(catalog.teaser_url, 'https://cdn.example.test/b3-teaser1.jpg');
    for (const forbidden of ['video_asset_id', 'cloudflare_uid', 'hls_url', 'dash_url', 'thumbnail_url']) {
      assert.equal(Object.hasOwn(catalog, forbidden), false, forbidden);
    }
    const ownerList = JSON.parse(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.get_my_creator_premium_contents_v1(24,null,null) result where result.id='${id.video1}'`).stdout);
    assert.equal(ownerList.video_attached, true);
    assert.equal(ownerList.video_media_ready, true);

    const imageBind = JSON.parse(asRole(db, 'authenticated', id.creator, `select to_jsonb(result) from public.set_my_creator_premium_image_media_v1('${id.image1}','${id.teaser2}','${id.imageOriginal}') result`).stdout);
    assert.equal(imageBind.media_ready, true);

    assert.equal(psql(db, `select concat_ws('|',
      has_function_privilege('anon','public.set_my_creator_premium_video_media_v1(uuid,uuid,uuid)','execute'),
      has_function_privilege('authenticated','public.set_my_creator_premium_video_media_v1(uuid,uuid,uuid)','execute'),
      has_function_privilege('service_role','public.set_my_creator_premium_video_media_v1(uuid,uuid,uuid)','execute'))`).stdout, 'f|t|f');
    assert.equal(psql(db, `select count(*) from public.video_assets where purpose='feed_video' and id='${id.streamFeed}'`).stdout, '1');
    assert.equal(psql(db, `select count(*) from public.video_assets where purpose='business_library' and status in ('pending','uploading','processing','ready','failed','delete_pending','deleted')`).status, 0);
  } finally {
    runContainer(`dropdb -U supabase_admin --force --if-exists ${db}`, { allowFailure: true });
  }
});
