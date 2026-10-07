// Real disposable PostgreSQL proof. Set NELYON_PREMIUM_B2_LOCAL=1 to enable it.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.NELYON_PREMIUM_B2_LOCAL === '1';
const container = process.env.NELYON_PREMIUM_B2_CONTAINER ?? 'nelyon-ads-v2-d-compile';
const template = process.env.NELYON_PREMIUM_B2_TEMPLATE ?? 'algo6_final_compile_a2';
const wslNamespacePid = process.env.NELYON_PREMIUM_B2_WSL_PID ?? '';
const migrations = new URL('../supabase/migrations/', import.meta.url);
const b1Matches = readdirSync(migrations)
  .filter(name => name.endsWith('_creator_premium_b1_canonical_foundation.sql'));
const b2Matches = readdirSync(migrations)
  .filter(name => name.endsWith('_creator_premium_b2_private_image_media.sql'));
const b1 = b1Matches.length === 1
  ? readFileSync(new URL(`../supabase/migrations/${b1Matches[0]}`, import.meta.url), 'utf8')
  : '';
const b2 = b2Matches.length === 1
  ? readFileSync(new URL(`../supabase/migrations/${b2Matches[0]}`, import.meta.url), 'utf8')
  : '';

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

test('B2 disposable harness targets B1 plus exactly one generated B2 migration', () => {
  assert.equal(b1Matches.length, 1);
  assert.equal(b2Matches.length, 1);
  assert.match(b2Matches[0], /^\d{14}_creator_premium_b2_private_image_media\.sql$/);
  assert.ok(b2.length > 10_000);
});

test('B2 compiles and proves image binding, privacy, replacement, catalog, and regression contracts', {
  skip: !enabled,
  timeout: 240_000,
}, () => {
  const db = `premium_b2_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const id = {
    creator: 'a1000000-0000-4000-8000-000000000001',
    creator2: 'a1000000-0000-4000-8000-000000000002',
    buyer: 'a1000000-0000-4000-8000-000000000003',
    minor: 'a1000000-0000-4000-8000-000000000004',
    content1: 'a2000000-0000-4000-8000-000000000001',
    content2: 'a2000000-0000-4000-8000-000000000002',
    video: 'a2000000-0000-4000-8000-000000000003',
    teaser1: 'a3000000-0000-4000-8000-000000000001',
    original1: 'a3000000-0000-4000-8000-000000000002',
    teaser2: 'a3000000-0000-4000-8000-000000000003',
    original2: 'a3000000-0000-4000-8000-000000000004',
    cross: 'a3000000-0000-4000-8000-000000000005',
    wrongPurpose: 'a3000000-0000-4000-8000-000000000006',
    pending: 'a3000000-0000-4000-8000-000000000007',
  };

  const asset = ({ assetId, owner = id.creator, purpose, visibility, status = 'ready', publicUrl = null }) => `
    insert into public.media_assets(
      id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,
      size_bytes,status,ready_at,public_url
    ) values (
      '${assetId}','${owner}','r2','image','${purpose}','${visibility}',
      '${visibility === 'public' ? 'public-bucket' : 'private-bucket'}','premium/${assetId}.jpg',
      'image/jpeg',1000,'${status}',${status === 'ready' ? 'clock_timestamp()' : 'null'},
      ${publicUrl ? `'${publicUrl}'` : 'null'}
    );`;

  try {
    runContainer(`createdb -U supabase_admin -T ${template} ${db}`);
    psql(db, `${b1}\n${b2}`);

    assert.match(psql(db, `select pg_get_constraintdef(oid) from pg_constraint where conname='media_asset_links_entity_type_check'`).stdout, /exclusive_content/);
    assert.match(psql(db, `select pg_get_constraintdef(oid) from pg_constraint where conname='media_asset_links_entity_type_check'`).stdout, /creator_premium_content/);
    assert.equal(psql(db, `select count(*) from pg_trigger where tgname='media_asset_links_guard_creator_premium' and not tgisinternal`).stdout, '1');
    assert.equal(psql(db, `select count(*) from pg_indexes where schemaname='public' and indexname like 'creator_premium_media_%_uidx'`).stdout, '2');

    psql(db, `
      set session_replication_role=replica;
      insert into auth.users(id,is_anonymous) values
        ('${id.creator}',false),('${id.creator2}',false),('${id.buyer}',false),('${id.minor}',false);
      insert into public.user_profiles(id,username) values
        ('${id.creator}','premium_b2_creator'),('${id.creator2}','premium_b2_creator2'),
        ('${id.buyer}','premium_b2_buyer'),('${id.minor}','premium_b2_minor');
      insert into private.user_age_eligibility(
        user_id,status,minimum_age,policy_version,evaluated_at,source,age_band,birth_date
      ) values
        ('${id.creator}','eligible',13,'nelyon-age-v2',clock_timestamp(),'signup_metadata','age_18_plus',current_date-interval '30 years'),
        ('${id.creator2}','eligible',13,'nelyon-age-v2',clock_timestamp(),'signup_metadata','age_18_plus',current_date-interval '31 years'),
        ('${id.buyer}','eligible',13,'nelyon-age-v2',clock_timestamp(),'signup_metadata','age_18_plus',current_date-interval '25 years'),
        ('${id.minor}','eligible',13,'nelyon-age-v2',clock_timestamp(),'signup_metadata','age_13_17',current_date-interval '16 years');
      set session_replication_role=origin;
      insert into private.creator_premium_contents(id,creator_id,title,content_kind,access_mode,lifecycle_status)
      values
        ('${id.content1}','${id.creator}','Image one','image','purchase','draft'),
        ('${id.content2}','${id.creator}','Image two','image','purchase','draft'),
        ('${id.video}','${id.creator}','Video one','video','purchase','draft');
      ${asset({ assetId: id.teaser1, purpose: 'creator_premium_teaser_image', visibility: 'public', publicUrl: 'https://cdn.example.test/teaser1.jpg' })}
      ${asset({ assetId: id.original1, purpose: 'creator_premium_original_image', visibility: 'private' })}
      ${asset({ assetId: id.teaser2, purpose: 'creator_premium_teaser_image', visibility: 'public', publicUrl: 'https://cdn.example.test/teaser2.jpg' })}
      ${asset({ assetId: id.original2, purpose: 'creator_premium_original_image', visibility: 'private' })}
      ${asset({ assetId: id.cross, owner: id.creator2, purpose: 'creator_premium_teaser_image', visibility: 'public', publicUrl: 'https://cdn.example.test/cross.jpg' })}
      ${asset({ assetId: id.wrongPurpose, purpose: 'post_image', visibility: 'public', publicUrl: 'https://cdn.example.test/wrong.jpg' })}
      ${asset({ assetId: id.pending, purpose: 'creator_premium_original_image', visibility: 'private', status: 'pending' })}
    `);

    assert.equal(asRole(db, 'authenticated', id.creator, `select public.authorize_my_creator_premium_image_upload_v1('${id.content1}','creator_premium_teaser_image')`).stdout, 't');
    assert.equal(asRole(db, 'authenticated', id.creator, `select public.authorize_my_creator_premium_image_upload_v1('${id.content1}','creator_premium_original_image')`).stdout, 't');
    expectFailure(asRole(db, 'authenticated', id.minor, `select public.authorize_my_creator_premium_image_upload_v1('${id.content1}','creator_premium_teaser_image')`, { allowFailure: true }), 'age_eligibility');
    expectFailure(asRole(db, 'authenticated', id.buyer, `select public.authorize_my_creator_premium_image_upload_v1('${id.content1}','creator_premium_teaser_image')`, { allowFailure: true }), 'content_not_found|not_owned');
    expectFailure(asRole(db, 'authenticated', id.creator, `select public.authorize_my_creator_premium_image_upload_v1('${id.video}','creator_premium_teaser_image')`, { allowFailure: true }), 'image_content_required');
    expectFailure(asRole(db, 'authenticated', id.creator, `select public.authorize_my_creator_premium_image_upload_v1('${id.content1}','post_image')`, { allowFailure: true }), 'invalid_purpose');

    const first = JSON.parse(asRole(db, 'authenticated', id.creator, `
      select to_jsonb(result) from public.set_my_creator_premium_image_media_v1(
        '${id.content1}','${id.teaser1}','${id.original1}'
      ) result;
    `).stdout);
    assert.equal(first.media_ready, true);
    assert.equal(first.replayed, false);
    assert.equal(Object.hasOwn(first, 'original_asset_id'), false);
    const replay = JSON.parse(asRole(db, 'authenticated', id.creator, `
      select to_jsonb(result) from public.set_my_creator_premium_image_media_v1(
        '${id.content1}','${id.teaser1}','${id.original1}'
      ) result;
    `).stdout);
    assert.equal(replay.replayed, true);
    assert.equal(psql(db, `select count(*) from public.media_asset_links where entity_type='creator_premium_content' and entity_id='${id.content1}'`).stdout, '2');

    expectFailure(asRole(db, 'authenticated', id.creator2, `select * from public.set_my_creator_premium_image_media_v1('${id.content1}','${id.cross}','${id.original1}')`, { allowFailure: true }), 'content_not_found|not_owned');
    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.set_my_creator_premium_image_media_v1('${id.content2}','${id.teaser1}','${id.original2}')`, { allowFailure: true }), 'asset_in_use|asset_unavailable');
    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.set_my_creator_premium_image_media_v1('${id.content2}','${id.wrongPurpose}','${id.original2}')`, { allowFailure: true }), 'teaser_invalid');
    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.set_my_creator_premium_image_media_v1('${id.content2}','${id.teaser2}','${id.pending}')`, { allowFailure: true }), 'original_invalid');
    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.set_my_creator_premium_image_media_v1('${id.video}','${id.teaser2}','${id.original2}')`, { allowFailure: true }), 'image_content_required');
    expectFailure(asRole(db, 'authenticated', id.creator, `select * from public.set_my_creator_premium_image_media_v1('${id.content2}','${id.teaser2}','${id.teaser2}')`, { allowFailure: true }), 'assets_must_differ');

    for (const sql of [
      `insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position) values('${id.teaser2}','creator_premium_content','${id.content2}','wrong',0)`,
      `insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position) values('${id.teaser2}','creator_premium_content','${id.content2}','teaser',1)`,
      `insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position) values('${id.cross}','creator_premium_content','${id.content2}','teaser',0)`,
      `insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position) values('${id.wrongPurpose}','creator_premium_content','${id.content2}','teaser',0)`,
      `insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position) values('${id.pending}','creator_premium_content','${id.content2}','original',0)`,
      `insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position) values('${id.teaser2}','video_post','${id.content2}','media',0)`,
    ]) expectFailure(psql(db, sql, { allowFailure: true }), 'creator_premium|check constraint');

    const replacement = JSON.parse(asRole(db, 'authenticated', id.creator, `
      select to_jsonb(result) from public.set_my_creator_premium_image_media_v1(
        '${id.content1}','${id.teaser2}','${id.original2}'
      ) result;
    `).stdout);
    assert.equal(replacement.replacement_cleanup_scheduled, true);
    assert.equal(psql(db, `select count(*) from public.media_asset_links where entity_type='creator_premium_content' and entity_id='${id.content1}'`).stdout, '2');
    assert.equal(psql(db, `select string_agg(status,',' order by id) from public.media_assets where id in ('${id.teaser1}','${id.original1}')`).stdout, 'delete_pending,delete_pending');
    assert.equal(psql(db, `select public.media_asset_has_valid_links('${id.teaser2}')`).stdout, 't');
    assert.equal(psql(db, `select public.schedule_media_asset_deletion('${id.teaser2}','${id.creator}')`).stdout, 'asset_in_use');

    assert.equal(asRole(db, 'authenticated', id.creator, `select count(*) from public.media_asset_links where entity_type='creator_premium_content'`).stdout, '0');
    assert.equal(asRole(db, 'authenticated', id.creator, `select count(*) from public.media_assets where id='${id.original2}'`).stdout, '0');
    assert.equal(asRole(db, 'authenticated', id.creator, `select count(*) from public.media_assets where id='${id.teaser2}'`).stdout, '1');
    assert.equal(asRole(db, 'anon', null, `select count(*) from public.media_assets where id='${id.teaser2}'`).stdout, '1');

    const ownerState = JSON.parse(asRole(db, 'authenticated', id.creator, `
      select to_jsonb(result) from public.get_my_creator_premium_image_media_v1('${id.content1}') result;
    `).stdout);
    assert.equal(ownerState.media_ready, true);
    for (const forbidden of ['original_asset_id','object_key','bucket_name','signed_url']) {
      assert.equal(Object.hasOwn(ownerState, forbidden), false, forbidden);
    }

    psql(db, `update private.creator_premium_contents set lifecycle_status='published',published_at=clock_timestamp(),updated_at=clock_timestamp() where id='${id.content1}'`);
    const catalog = JSON.parse(asRole(db, 'authenticated', id.buyer, `
      select to_jsonb(result) from public.get_creator_premium_catalog_v1('${id.creator}',24,null,null) result;
    `).stdout);
    assert.equal(catalog.teaser_url, 'https://cdn.example.test/teaser2.jpg');
    for (const forbidden of ['original_asset_id','object_key','bucket_name','private_url','financial_transaction_id']) {
      assert.equal(Object.hasOwn(catalog, forbidden), false, forbidden);
    }
    const ownerList = JSON.parse(asRole(db, 'authenticated', id.creator, `
      select to_jsonb(result) from public.get_my_creator_premium_contents_v1(24,null,null) result
      where result.id='${id.content1}';
    `).stdout);
    assert.equal(ownerList.teaser_attached, true);
    assert.equal(ownerList.original_attached, true);
    assert.equal(ownerList.image_media_ready, true);

    psql(db, `
      update private.creator_premium_contents set lifecycle_status='removed',published_at=null,removed_at=clock_timestamp(),updated_at=clock_timestamp() where id='${id.content1}';
    `);
    assert.equal(asRole(db, 'authenticated', id.buyer, `select count(*) from public.get_creator_premium_catalog_v1('${id.creator}',24,null,null)`).stdout, '0');

    assert.equal(psql(db, `select concat_ws('|',
      has_function_privilege('anon','public.set_my_creator_premium_image_media_v1(uuid,uuid,uuid)','execute'),
      has_function_privilege('authenticated','public.set_my_creator_premium_image_media_v1(uuid,uuid,uuid)','execute'),
      has_function_privilege('service_role','public.set_my_creator_premium_image_media_v1(uuid,uuid,uuid)','execute'))`).stdout, 'f|t|f');
    assert.equal(psql(db, `select count(*) from public.media_asset_links where entity_type='story' and false`).stdout, '0');
    assert.equal(psql(db, `select count(*) from pg_constraint where conname in ('media_asset_links_story_shape_check','media_assets_ready_public_url_check')`).stdout, '2');
  } finally {
    runContainer(`dropdb -U supabase_admin --force --if-exists ${db}`, { allowFailure: true });
  }
});

