import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const enabled = process.env.NELYON_ALGO6_F0_LOCAL === '1';
const container = process.env.NELYON_ALGO6_F0_CONTAINER ?? 'nelyon-ads-v2-d-compile';
const template = process.env.NELYON_ALGO6_F0_TEMPLATE ?? 'plr9_production_clone2';
const owner = 'supabase_admin';
const migrationDirectory = new URL('../supabase/migrations/', import.meta.url);

const ids = {
  publicOwner: '21000000-0000-4000-8000-000000000001',
  privateOwner: '21000000-0000-4000-8000-000000000002',
  follower: '21000000-0000-4000-8000-000000000003',
  viewer: '21000000-0000-4000-8000-000000000004',
  reverseBlocker: '21000000-0000-4000-8000-000000000005',
  publicVideo: '22000000-0000-4000-8000-000000000001',
  privateVideo: '22000000-0000-4000-8000-000000000002',
  noDurationVideo: '22000000-0000-4000-8000-000000000003',
  fallbackDurationVideo: '22000000-0000-4000-8000-000000000004',
  reverseBlockedVideo: '22000000-0000-4000-8000-000000000005',
  moderatedVideo: '22000000-0000-4000-8000-000000000006',
  videoAsset: '23000000-0000-4000-8000-000000000001',
  mediaAsset: '23000000-0000-4000-8000-000000000002',
};

function f0Migration() {
  const matches = readdirSync(migrationDirectory)
    .filter(name => name.endsWith('_algo6_l1_f0_signal_eligibility_foundation.sql'));
  assert.equal(matches.length, 1, 'exactly one generated F0 migration must exist');
  return readFileSync(new URL(matches[0], migrationDirectory), 'utf8');
}

function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    input,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`docker ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function psql(db, sql, { allowFailure = false, authenticator = false } = {}) {
  const args = ['exec', '-i'];
  if (authenticator) args.push('-e', 'PGPASSWORD=postgres');
  args.push(
    container,
    'psql',
    ...(authenticator ? ['-h', '127.0.0.1', '-p', '5432'] : []),
    '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', authenticator ? 'authenticator' : owner,
    '-d', db,
    '-At',
  );
  return docker(args, { input: sql, allowFailure });
}

function createDatabase() {
  const sql = f0Migration();
  const db = `algo6_f0_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  docker(['exec', container, 'createdb', '-U', owner, '-T', template, db]);
  psql(db, sql);
  return db;
}

function dropDatabase(db) {
  docker(['exec', container, 'dropdb', '-U', owner, '--force', '--if-exists', db], { allowFailure: true });
}

function actorSql(role, actor, sql) {
  const subject = actor ?? '';
  return `begin;set local role ${role};` +
    `select set_config('request.jwt.claim.role','${role}',true);` +
    `select set_config('request.jwt.claim.sub','${subject}',true);` +
    `${sql};commit;`;
}

function actorCall(db, role, actor, sql, { allowFailure = false } = {}) {
  return psql(db, actorSql(role, actor, sql), { allowFailure, authenticator: true });
}

function lastLine(result) {
  return result.stdout.split(/\r?\n/).filter(Boolean).at(-1) ?? '';
}

function recordSql(videoId, eventId, sessionId, watchMs, reason) {
  return `select status||'|'||watch_duration_ms||'|'||coalesce(media_duration_ms::text,'null')||'|'||` +
    `coalesce(completion_ratio::text,'null')||'|'||coalesce(completed::text,'null')||'|'||rewatch_count||'|'||views_count ` +
    `from public.record_video_view_v1('${videoId}','${eventId}','${sessionId}',${watchMs},'${reason}')`;
}

function seed(db) {
  psql(db, `
    insert into private.age_eligibility_policy(
      singleton,minimum_age,policy_version,creator_exclusive_minimum_age
    ) values(true,13,'nelyon-age-v2',18)
    on conflict(singleton) do nothing;
    insert into auth.users(id) values
      ('${ids.publicOwner}'),('${ids.privateOwner}'),('${ids.follower}'),
      ('${ids.viewer}'),('${ids.reverseBlocker}');
    insert into public.user_profiles(id,username,is_private) values
      ('${ids.publicOwner}','f0_public',false),
      ('${ids.privateOwner}','f0_private',true),
      ('${ids.follower}','f0_follower',false),
      ('${ids.viewer}','f0_viewer',false),
      ('${ids.reverseBlocker}','f0_reverse_blocker',false);
    insert into public.follows(follower_id,following_id)
      values('${ids.follower}','${ids.privateOwner}');
    insert into public.videos(id,user_id,video_url,caption,views_count,created_at) values
      ('${ids.publicVideo}','${ids.publicOwner}','https://example.test/public.mp4','f0 public',11,'2026-09-30T10:00:00Z'),
      ('${ids.privateVideo}','${ids.privateOwner}','https://example.test/private.mp4','f0 private',0,'2026-09-30T10:00:01Z'),
      ('${ids.noDurationVideo}','${ids.publicOwner}','https://example.test/no-duration.mp4','f0 no duration',0,'2026-09-30T10:00:02Z'),
      ('${ids.fallbackDurationVideo}','${ids.publicOwner}','https://example.test/fallback.mp4','f0 fallback',0,'2026-09-30T10:00:03Z'),
      ('${ids.reverseBlockedVideo}','${ids.reverseBlocker}','https://example.test/blocked.mp4','f0 blocked',0,'2026-09-30T10:00:04Z'),
      ('${ids.moderatedVideo}','${ids.publicOwner}','https://example.test/moderated.mp4','f0 moderated',0,'2026-09-30T10:00:05Z');
    insert into public.video_assets(
      id,owner_id,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes,
      duration_seconds,hls_url,ready_at
    ) values(
      '${ids.videoAsset}','${ids.publicOwner}','feed_video','public','ready','f0-duration-asset',
      'video/mp4',1024,10,'https://example.test/f0/manifest.m3u8',clock_timestamp()
    );
    insert into public.video_asset_links(asset_id,owner_id,entity_type,entity_id,slot,position)
      values('${ids.videoAsset}','${ids.publicOwner}','video_post','${ids.publicVideo}','video',0);
    insert into public.media_assets(
      id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,duration_ms,status
    ) values(
      '${ids.mediaAsset}','${ids.publicOwner}','supabase_legacy','video','feed_video','public',
      'videos','f0/fallback.mp4','video/mp4',1024,5000,'ready'
    );
    insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
      values('${ids.mediaAsset}','video_post','${ids.fallbackDurationVideo}','video',0);
  `);
}

test('F0 database authority enforces telemetry, eligibility and aggregate-only access', { skip: !enabled, timeout: 120000 }, () => {
  const db = createDatabase();
  try {
    seed(db);

    assert.equal(lastLine(actorCall(db, 'anon', null,
      `select count(*) from public.videos where id='${ids.publicVideo}'`)), '1');
    assert.equal(lastLine(actorCall(db, 'anon', null,
      `select count(*) from public.videos where id='${ids.privateVideo}'`)), '0');
    assert.equal(lastLine(actorCall(db, 'authenticated', ids.privateOwner,
      `select count(*) from public.videos where id='${ids.privateVideo}'`)), '1');
    assert.equal(lastLine(actorCall(db, 'authenticated', ids.follower,
      `select count(*) from public.videos where id='${ids.privateVideo}'`)), '1');
    assert.equal(lastLine(actorCall(db, 'authenticated', ids.viewer,
      `select count(*) from public.videos where id='${ids.privateVideo}'`)), '0');

    const session = randomUUID();
    const shortEvent = randomUUID();
    assert.equal(
      lastLine(actorCall(db, 'authenticated', ids.viewer,
        recordSql(ids.publicVideo, shortEvent, session, 9000, 'swipe'))),
      'recorded|9000|10000|0.900000|false|0|12',
    );
    assert.equal(
      lastLine(actorCall(db, 'authenticated', ids.viewer,
        recordSql(ids.publicVideo, shortEvent, session, 9000, 'swipe'))),
      'replayed|9000|10000|0.900000|false|0|12',
    );
    psql(db, `update public.video_assets set duration_seconds=20 where id='${ids.videoAsset}'`);
    assert.equal(
      lastLine(actorCall(db, 'authenticated', ids.viewer,
        recordSql(ids.publicVideo, shortEvent, session, 9000, 'swipe'))),
      'replayed|9000|10000|0.900000|false|0|12',
      'an exact replay retains its original server derivation after metadata changes',
    );
    psql(db, `update public.video_assets set duration_seconds=10 where id='${ids.videoAsset}'`);
    assert.notEqual(actorCall(db, 'authenticated', ids.viewer,
      recordSql(ids.publicVideo, shortEvent, session, 9001, 'swipe'), { allowFailure: true }).status, 0);
    assert.equal(lastLine(psql(db,
      `select count(*)||'|'||views_count from public.video_views vv join public.videos v on v.id=vv.video_id where vv.client_event_id='${shortEvent}' group by views_count`)), '1|12');

    assert.match(lastLine(actorCall(db, 'authenticated', ids.viewer,
      recordSql(ids.publicVideo, randomUUID(), session, 10000, 'ended'))),
      /^recorded\|10000\|10000\|1\.000000\|true\|0\|13$/);
    assert.match(lastLine(actorCall(db, 'authenticated', ids.viewer,
      recordSql(ids.publicVideo, randomUUID(), session, 25000, 'swipe'))),
      /^recorded\|25000\|10000\|2\.500000\|true\|1\|14$/);
    assert.match(lastLine(actorCall(db, 'authenticated', ids.viewer,
      recordSql(ids.noDurationVideo, randomUUID(), session, 4000, 'background'))),
      /^recorded\|4000\|null\|null\|null\|0\|1$/);
    assert.match(lastLine(actorCall(db, 'authenticated', ids.viewer,
      recordSql(ids.fallbackDurationVideo, randomUUID(), session, 5000, 'ended'))),
      /^recorded\|5000\|5000\|1\.000000\|true\|0\|1$/);
    const anonEvent = randomUUID();
    assert.match(lastLine(actorCall(db, 'anon', null,
      recordSql(ids.noDurationVideo, anonEvent, randomUUID(), 1000, 'unknown'))), /^recorded\|/);
    assert.equal(lastLine(psql(db,
      `select (viewer_id is null)::text from public.video_views where client_event_id='${anonEvent}'`)), 'true');

    assert.notEqual(actorCall(db, 'authenticated', ids.viewer,
      recordSql(ids.publicVideo, randomUUID(), session, 86400001, 'swipe'), { allowFailure: true }).status, 0);
    assert.notEqual(actorCall(db, 'authenticated', ids.viewer,
      recordSql(ids.publicVideo, randomUUID(), session, 1000, 'invalid'), { allowFailure: true }).status, 0);
    assert.notEqual(actorCall(db, 'authenticated', ids.viewer,
      recordSql(randomUUID(), randomUUID(), session, 1000, 'unknown'), { allowFailure: true }).status, 0);

    for (const sql of [
      'select * from public.video_views',
      `insert into public.video_views(video_id,client_event_id,client_session_id,watch_duration_ms,rewatch_count,exit_reason) values('${ids.publicVideo}',gen_random_uuid(),gen_random_uuid(),1,0,'unknown')`,
      `update public.video_views set watch_duration_ms=2 where client_event_id='${shortEvent}'`,
      `delete from public.video_views where client_event_id='${shortEvent}'`,
    ]) {
      assert.notEqual(actorCall(db, 'authenticated', ids.viewer, sql, { allowFailure: true }).status, 0, sql);
    }

    const analytics = lastLine(actorCall(db, 'authenticated', ids.publicOwner,
      `select views||'|'||unique_authenticated_viewers||'|'||avg_watch_ms||'|'||completion_rate||'|'||rewatch_count||'|'||rewatch_rate from public.get_my_video_analytics_v1('${ids.publicVideo}')`));
    assert.equal(analytics, '3|1|14667|66.666667|1|33.333333');
    assert.notEqual(actorCall(db, 'authenticated', ids.viewer,
      `select * from public.get_my_video_analytics_v1('${ids.publicVideo}')`, { allowFailure: true }).status, 0);

    assert.notEqual(actorCall(db, 'authenticated', ids.viewer,
      recordSql(ids.privateVideo, randomUUID(), session, 1000, 'swipe'), { allowFailure: true }).status, 0);
    assert.match(lastLine(actorCall(db, 'authenticated', ids.follower,
      recordSql(ids.privateVideo, randomUUID(), session, 1000, 'swipe'))), /^recorded\|/);

    psql(db, `insert into public.blocked_users(blocker_id,blocked_id) values
      ('${ids.viewer}','${ids.publicOwner}'),('${ids.reverseBlocker}','${ids.follower}');`);
    assert.equal(lastLine(actorCall(db, 'authenticated', ids.viewer,
      `select count(*) from public.videos where id='${ids.publicVideo}'`)), '0');
    assert.equal(lastLine(actorCall(db, 'authenticated', ids.follower,
      `select count(*) from public.videos where id='${ids.reverseBlockedVideo}'`)), '0');
    assert.notEqual(actorCall(db, 'authenticated', ids.viewer,
      recordSql(ids.publicVideo, randomUUID(), session, 1000, 'swipe'), { allowFailure: true }).status, 0);

    const admin = randomUUID();
    psql(db, `insert into auth.users(id) values('${admin}');
      insert into private.admin_capabilities(
        capability_code,domain,effect,description,is_sensitive
      ) values('content.items.hide','content','workflow','Disposable F0 moderation fixture',true)
      on conflict(capability_code) do nothing;
      with action as (
        insert into private.admin_content_moderation_actions(
          actor_id,actor_role_snapshot,actor_capability,target_type,target_id,action,reason,
          idempotency_scope,idempotency_key,request_fingerprint,
          visibility_before,visibility_after,result
        ) values(
          '${admin}','{}','content.items.hide','video','${ids.moderatedVideo}','hide','f0 test',
          'f0|moderation|${ids.moderatedVideo}','${randomUUID()}',repeat('a',64),
          'visible','hidden','succeeded'
        ) returning id
      )
      insert into private.admin_content_moderation_state(
        target_type,target_id,visibility,last_action_id
      ) select 'video','${ids.moderatedVideo}','hidden',id from action;`);
    assert.equal(lastLine(actorCall(db, 'anon', null,
      `select count(*) from public.videos where id='${ids.moderatedVideo}'`)), '0');
    assert.notEqual(actorCall(db, 'anon', null,
      recordSql(ids.moderatedVideo, randomUUID(), randomUUID(), 1000, 'swipe'), { allowFailure: true }).status, 0);

    assert.equal(lastLine(psql(db,
      `select relrowsecurity::text||'|'||relforcerowsecurity::text from pg_class where oid='public.video_views'::regclass`)), 'true|true');
    assert.equal(lastLine(psql(db,
      `select count(*) from pg_indexes where schemaname='public' and indexname in(
        'video_views_client_event_id_key','video_views_viewer_created_idx','video_views_video_created_idx',
        'videos_created_id_desc_idx','videos_user_created_id_desc_idx')`)), '5');
    assert.notEqual(actorCall(db, 'anon', null,
      'select public.reconcile_algo_signal_foundation_v1()', { allowFailure: true }).status, 0);
    assert.equal(lastLine(actorCall(db, 'service_role', null,
      `select bool_and(value::text='0') from jsonb_each(public.reconcile_algo_signal_foundation_v1())`)), 't');
  } finally {
    dropDatabase(db);
  }
});
