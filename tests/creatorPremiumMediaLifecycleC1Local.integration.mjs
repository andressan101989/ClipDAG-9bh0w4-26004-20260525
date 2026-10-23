import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const image = 'public.ecr.aws/supabase/postgres:17.11.0.004';
const database = 'media_c1';
const password = `media-c1-${randomUUID()}`;
const container = `nelyon-media-c1-${randomUUID().replaceAll('-', '').slice(0, 16)}`;

const ownerId = '10000000-0000-0000-0000-000000000001';
const r2HistoryId = '20000000-0000-0000-0000-000000000001';
const streamHistoryId = '30000000-0000-0000-0000-000000000001';
const legacyDeletedLinkedId = '20000000-0000-0000-0000-000000000099';
const legacyDeletedEntityId = '40000000-0000-0000-0000-000000000099';

function docker(args, options = {}) {
  return spawnSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
}

function psql(sql, { check = true } = {}) {
  const result = docker([
    'exec', '-i', container,
    'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', database,
  ], { input: sql });
  if (check && result.status !== 0) {
    throw new Error(`psql failed (${result.status}): ${result.stderr}\n${result.stdout}`);
  }
  return result;
}

function psqlAsync(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'exec', '-i', container,
      'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', database,
    ], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ status: code, stdout, stderr }));
    child.stdin.end(sql);
  });
}

function migrationPath() {
  const names = readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter(name => name.endsWith('_creator_premium_media_lifecycle_c1.sql'));
  assert.equal(names.length, 1, 'exactly one Media Lifecycle C1 migration must exist');
  return path.join(root, 'supabase', 'migrations', names[0]);
}

const bootstrap = String.raw`
create schema if not exists auth;
create schema if not exists private;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $roles$
begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end
$roles$;

create table if not exists auth.users(id uuid primary key);
insert into auth.users(id) values ('${ownerId}') on conflict(id) do nothing;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;

create table public.media_assets(
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  provider text not null,
  media_kind text not null,
  purpose text not null,
  visibility text not null,
  bucket_name text not null,
  object_key text not null,
  mime_type text not null,
  size_bytes bigint,
  original_filename text,
  etag text,
  width integer,
  height integer,
  duration_ms bigint,
  status text not null,
  error_code text,
  cleanup_attempts integer not null default 0,
  last_cleanup_attempt_at timestamptz,
  next_cleanup_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ready_at timestamptz,
  deleted_at timestamptz,
  public_url text
);
create table public.media_asset_links(
  id uuid primary key default extensions.gen_random_uuid(),
  asset_id uuid not null references public.media_assets(id),
  entity_type text not null,
  entity_id uuid not null,
  slot text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create table public.user_profiles(
  id uuid primary key,
  avatar_url text
);
create table public.videos(
  id uuid primary key
);
create table public.stories(
  id uuid primary key,
  expires_at timestamptz not null
);
create table public.products(
  id uuid primary key,
  status text not null default 'active'
);
create function public.media_asset_has_valid_links(p_asset_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.media_asset_links link
    where link.asset_id=p_asset_id
      and (
        link.entity_type <> 'story'
        or exists(
          select 1 from public.stories story
          where story.id=link.entity_id and story.expires_at>pg_catalog.clock_timestamp()
        )
      )
  )
$$;

create table public.video_assets(
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  provider text not null default 'cloudflare_stream',
  purpose text not null,
  visibility text not null,
  status text not null,
  cloudflare_uid text unique,
  mime_type text not null,
  size_bytes bigint not null,
  original_filename text,
  max_duration_seconds integer not null default 180,
  duration_seconds numeric,
  width integer,
  height integer,
  hls_url text,
  dash_url text,
  thumbnail_url text,
  upload_expires_at timestamptz,
  provider_status text,
  provider_progress numeric,
  provider_metadata jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  last_provider_check_at timestamptz,
  ready_at timestamptz,
  delete_attempts integer not null default 0,
  next_cleanup_attempt_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.video_asset_links(
  id uuid primary key default extensions.gen_random_uuid(),
  asset_id uuid not null references public.video_assets(id),
  owner_id uuid not null references auth.users(id),
  entity_type text not null,
  entity_id uuid not null,
  slot text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table private.admin_action_audit(
  id uuid primary key default extensions.gen_random_uuid(),
  actor_id uuid references auth.users(id),
  action text not null,
  target_type text not null,
  target_id uuid not null,
  idempotency_key uuid not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  actor_kind text not null,
  actor_role_snapshot text[] not null,
  actor_capability text,
  domain text not null,
  target_ref text,
  outcome text not null,
  financial_effect boolean not null,
  contains_pii boolean not null,
  idempotency_scope text not null,
  request_fingerprint text not null,
  unique(idempotency_scope,idempotency_key)
);
alter table private.admin_action_audit enable row level security;
revoke all on private.admin_action_audit from public,anon,authenticated,service_role;

create function private.admin_reject_action_audit_mutation()
returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='42501',message='admin_action_audit_immutable'; end
$$;
create trigger admin_action_audit_immutable before update or delete
on private.admin_action_audit for each row execute function private.admin_reject_action_audit_mutation();

create function private.guard_ready_media_asset_identity()
returns trigger language plpgsql set search_path='' as $$ begin return new; end $$;
create function private.guard_ready_video_asset_identity()
returns trigger language plpgsql set search_path='' as $$ begin return new; end $$;
create trigger media_assets_guard_ready_identity before update on public.media_assets
for each row execute function private.guard_ready_media_asset_identity();
create trigger video_assets_guard_ready_identity before update on public.video_assets
for each row execute function private.guard_ready_video_asset_identity();

create function private.schedule_creator_premium_video_deletion_v1(uuid,uuid)
returns text language sql security definer set search_path='' as $$ select 'legacy'::text $$;

create function public.cleanup_stale_media_upload_records(integer default 50)
returns table(id uuid,bucket_name text,object_key text,cleanup_attempts integer)
language sql security definer set search_path='' as $$
  select null::uuid,null::text,null::text,null::integer where false
$$;
create function public.cleanup_stale_creator_premium_video_records(integer default 50)
returns table(id uuid,cloudflare_uid text,delete_attempts integer)
language sql security definer set search_path='' as $$
  select null::uuid,null::text,null::integer where false
$$;

create function public.bind_test_video(p_asset_id uuid,p_owner_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform asset.id from public.video_assets asset where asset.id=p_asset_id for update;
  if not exists(select 1 from public.video_assets asset
                where asset.id=p_asset_id and asset.owner_id=p_owner_id and asset.status='ready') then
    return false;
  end if;
  insert into public.video_asset_links(asset_id,owner_id,entity_type,entity_id,slot)
  values(p_asset_id,p_owner_id,'creator_premium_content',extensions.gen_random_uuid(),'original');
  return true;
end
$$;

create table private.finance_switches(
  singleton boolean primary key default true,
  purchase_enabled boolean not null,
  subscription_enabled boolean not null,
  refunds_enabled boolean not null,
  platform_fee_bps integer not null
);
insert into private.finance_switches values(true,false,false,false,0);

insert into public.media_assets(
  id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,
  size_bytes,status,created_at
) values (
  '${r2HistoryId}','${ownerId}','r2','image','creator_premium_original_image','private',
  'private-media','historical/object','image/jpeg',100,'failed',now()-interval '2 hours'
);
insert into public.video_assets(
  id,owner_id,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes,created_at
) values (
  '${streamHistoryId}','${ownerId}','creator_premium_video','private','failed','historical-stream',
  'video/mp4',100,now()-interval '2 days'
);
insert into public.media_assets(
  id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,
  size_bytes,status,deleted_at,created_at
) values (
  '${legacyDeletedLinkedId}','${ownerId}','r2','image','chat_attachment','private',
  'private-media','legacy/deleted-linked','image/jpeg',100,'deleted',now(),now()-interval '2 days'
);
insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
values('${legacyDeletedLinkedId}','chat_message','${legacyDeletedEntityId}','attachment',0);

alter table public.media_assets enable row level security;
alter table public.video_assets enable row level security;
alter table public.media_asset_links enable row level security;
alter table public.video_asset_links enable row level security;
revoke all on public.media_assets,public.video_assets,public.media_asset_links,public.video_asset_links
from public,anon,authenticated;
grant select on public.media_assets,public.video_assets,public.media_asset_links,public.video_asset_links
to authenticated;
grant all on public.media_assets,public.video_assets,public.media_asset_links,public.video_asset_links
to service_role;
`;

test('Media Lifecycle C1 SQL is fenced, serialized, auditable, and leaves history unenrolled', { timeout: 180_000 }, async t => {
  assert.equal(docker(['version', '--format', '{{.Server.Version}}']).status, 0, 'Docker must be available');
  const migration = readFileSync(migrationPath(), 'utf8');
  const started = docker([
    'run', '-d', '--rm', '--name', container,
    '--tmpfs', '/var/lib/postgresql/data',
    '-e', `POSTGRES_PASSWORD=${password}`,
    '-e', `POSTGRES_DB=${database}`,
    image,
  ]);
  assert.equal(started.status, 0, started.stderr);
  t.after(() => docker(['rm', '-f', container]));

  let ready = false;
  let consecutiveReady = 0;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const probe = docker(['exec', container, 'pg_isready', '-U', 'postgres', '-d', database]);
    consecutiveReady = probe.status === 0 ? consecutiveReady + 1 : 0;
    if (consecutiveReady >= 8) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  assert.equal(ready, true, 'isolated PostgreSQL did not become ready');

  psql(bootstrap);
  psql(migration);

  assert.equal(
    psql(`select concat_ws('|',lifecycle_contract_version,upload_authorization_expires_at,provider_absence_verified_at)
          from public.media_assets where id='${r2HistoryId}'`).stdout.trim(),
    '',
    'historical R2 rows must not be enrolled or backfilled',
  );
  assert.equal(
    psql(`select concat_ws('|',lifecycle_contract_version,provider_absence_verified_at)
          from public.video_assets where id='${streamHistoryId}'`).stdout.trim(),
    '',
    'historical Stream rows must not be enrolled or backfilled',
  );
  assert.equal(
    psql(`select count(*) from public.cleanup_stale_media_upload_records(50)
          where id='${r2HistoryId}'`).stdout.trim(),
    '0',
  );
  assert.equal(
    psql(`select count(*) from public.cleanup_stale_creator_premium_video_records(50)
          where id='${streamHistoryId}'`).stdout.trim(),
    '0',
  );
  psql(`select count(*) from public.cleanup_stale_media_upload_records(50)`);
  assert.equal(
    psql(`select count(*) from public.media_asset_links
          where asset_id='${legacyDeletedLinkedId}'`).stdout.trim(),
    '1',
    'a legacy deleted row must retain a still-valid link during housekeeping',
  );

  const expiredStory = '50000000-0000-0000-0000-000000000001';
  const expiredStoryAsset = '20000000-0000-0000-0000-000000000010';
  psql(`insert into public.stories(id,expires_at)
        values('${expiredStory}',now()-interval '1 minute');
        insert into public.media_assets(
          id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,
          size_bytes,status,created_at
        ) values(
          '${expiredStoryAsset}','${ownerId}','r2','image','story_image','private',
          'private-media','story/expired','image/jpeg',100,'ready',now()-interval '2 hours'
        );
        insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
        values('${expiredStoryAsset}','story','${expiredStory}','original',0);`);
  assert.equal(
    psql(`select count(*) from public.cleanup_stale_media_upload_records(50)
          where id='${expiredStoryAsset}'`).stdout.trim(),
    '1',
    'expired-story housekeeping must enroll and claim the newly unlinked asset',
  );
  assert.equal(
    psql(`select concat_ws('|',status,lifecycle_contract_version,cleanup_attempts)
          from public.media_assets where id='${expiredStoryAsset}'`).stdout.trim(),
    'delete_pending|1|1',
  );
  assert.equal(
    psql(`select count(*) from public.stories where id='${expiredStory}'`).stdout.trim(),
    '0',
  );

  const lockedStory = '50000000-0000-0000-0000-000000000002';
  const lockedStoryAsset = '20000000-0000-0000-0000-000000000011';
  psql(`insert into public.stories(id,expires_at)
        values('${lockedStory}',now()-interval '1 minute');
        insert into public.media_assets(
          id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,
          size_bytes,status,created_at
        ) values(
          '${lockedStoryAsset}','${ownerId}','r2','image','story_image','private',
          'private-media','story/locked','image/jpeg',100,'ready',now()-interval '2 hours'
        );
        insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
        values('${lockedStoryAsset}','story','${lockedStory}','original',0);`);
  const lockedAsset = psqlAsync(`begin;
    select id from public.media_assets where id='${lockedStoryAsset}' for update;
    select pg_sleep(1);
    commit;`);
  await new Promise(resolve => setTimeout(resolve, 150));
  const skippedSweep = psqlAsync(
    `select count(*) from public.cleanup_stale_media_upload_records(50)
      where id='${lockedStoryAsset}'`,
  );
  const [lockedResult, skippedResult] = await Promise.all([lockedAsset, skippedSweep]);
  assert.equal(lockedResult.status, 0, lockedResult.stderr);
  assert.equal(skippedResult.status, 0, skippedResult.stderr);
  assert.equal(skippedResult.stdout.trim(), '0');
  assert.equal(
    psql(`select count(*) from public.media_asset_links
          where asset_id='${lockedStoryAsset}'`).stdout.trim(),
    '1',
    'SKIP LOCKED must not remove a link before acquiring the shared asset lock',
  );
  assert.equal(
    psql(`select count(*) from public.cleanup_stale_media_upload_records(50)
          where id='${lockedStoryAsset}'`).stdout.trim(),
    '1',
    'the next sweep must retry the preserved invalid link after the lock is released',
  );
  assert.equal(
    psql(`select count(*) from public.media_asset_links
          where asset_id='${lockedStoryAsset}'`).stdout.trim(),
    '0',
  );

  const legacyBusinessAsset = '20000000-0000-0000-0000-000000000012';
  psql(`insert into public.media_assets(
    id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,
    status,lifecycle_contract_version,upload_authorization_expires_at
  ) values('${legacyBusinessAsset}','${ownerId}','r2','image','business_library','public',
    'public-media','business/serialized','image/jpeg',100,'ready',1,now()-interval '1 hour')`);
  const legacyBinder = psqlAsync(`begin;
    insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
    values('${legacyBusinessAsset}','marketplace_store',extensions.gen_random_uuid(),'logo',0);
    select pg_sleep(1);
    commit;`);
  await new Promise(resolve => setTimeout(resolve, 150));
  const legacyDelete = psqlAsync(
    `select public.schedule_media_asset_deletion('${legacyBusinessAsset}','${ownerId}')`,
  );
  const [legacyBindResult, legacyDeleteResult] = await Promise.all([legacyBinder, legacyDelete]);
  assert.equal(legacyBindResult.status, 0, legacyBindResult.stderr);
  assert.equal(legacyDeleteResult.status, 0, legacyDeleteResult.stderr);
  assert.equal(
    legacyDeleteResult.stdout.trim(),
    'asset_in_use',
    'the universal trigger must serialize an unlocked legacy Business binder before delete',
  );
  psql(`delete from public.media_asset_links where asset_id='${legacyBusinessAsset}'`);
  assert.equal(
    psql(`select public.schedule_media_asset_deletion('${legacyBusinessAsset}','${ownerId}')`).stdout.trim(),
    'scheduled',
  );
  const lateBusinessBind = psql(
    `insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
     values('${legacyBusinessAsset}','marketplace_store',extensions.gen_random_uuid(),'logo',0)`,
    { check: false },
  );
  assert.notEqual(lateBusinessBind.status, 0);
  assert.match(lateBusinessBind.stderr, /media_asset_link_lifecycle_invalid/);

  const reservedStream = '30000000-0000-0000-0000-000000000009';
  assert.equal(
    psql(`select public.reserve_stream_upload_asset('${reservedStream}','${ownerId}',
      'video/mp4',100,'safe.mp4','creator_premium_video')`).stdout.trim(),
    'created',
  );
  assert.equal(
    psql(`select lifecycle_contract_version=1
            and upload_expires_at between now()+interval '14 minutes'
                                      and now()+interval '16 minutes'
          from public.video_assets where id='${reservedStream}'`).stdout.trim(),
    't',
  );
  assert.equal(
    psql(`select public.schedule_video_asset_deletion_v1('${reservedStream}','${ownerId}')`).stdout.trim(),
    'scheduled',
  );
  assert.equal(
    psql(`select count(*) from public.cleanup_stale_creator_premium_video_records(50)
          where id='${reservedStream}'`).stdout.trim(),
    '0',
    'Stream cleanup must wait until its persisted upload authority expires',
  );

  const terminalR2 = '20000000-0000-0000-0000-000000000002';
  psql(`insert into public.media_assets(
    id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,
    status,lifecycle_contract_version,deleted_at
  ) values('${terminalR2}','${ownerId}','r2','image','creator_premium_original_image','private',
    'private-media','terminal/object','image/jpeg',100,'deleted',1,now())`);
  const r2Resurrection = psql(
    `update public.media_assets set status='ready' where id='${terminalR2}'`, { check: false },
  );
  assert.notEqual(r2Resurrection.status, 0);
  assert.match(r2Resurrection.stderr, /media_asset_terminal_state_immutable/);
  const r2IdentitySwap = psql(
    `update public.media_assets set object_key='terminal/other'
      where id='${terminalR2}'`, { check: false },
  );
  assert.notEqual(r2IdentitySwap.status, 0);
  assert.match(r2IdentitySwap.stderr, /media_asset_terminal_identity_immutable/);

  const terminalStream = '30000000-0000-0000-0000-000000000002';
  psql(`insert into public.video_assets(
    id,owner_id,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes,lifecycle_contract_version,deleted_at
  ) values('${terminalStream}','${ownerId}','creator_premium_video','private','deleted','terminal-stream',
    'video/mp4',100,1,now())`);
  const streamResurrection = psql(
    `update public.video_assets set status='ready' where id='${terminalStream}'`, { check: false },
  );
  assert.notEqual(streamResurrection.status, 0);
  assert.match(streamResurrection.stderr, /video_asset_terminal_state_immutable/);
  const streamIdentitySwap = psql(
    `update public.video_assets set cloudflare_uid='terminal-stream-other'
      where id='${terminalStream}'`, { check: false },
  );
  assert.notEqual(streamIdentitySwap.status, 0);
  assert.match(streamIdentitySwap.stderr, /video_asset_terminal_identity_immutable/);

  const rolloutR2 = '20000000-0000-0000-0000-000000000017';
  psql(`insert into public.media_assets(
    id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,
    status,lifecycle_contract_version,upload_authorization_expires_at,created_at
  ) values('${rolloutR2}','${ownerId}','r2','image','creator_premium_original_image','private',
    'private-media','rollout/object','image/jpeg',100,'delete_pending',1,
    now()-interval '90 minutes',now()-interval '2 hours')`);
  const legacyR2Completion = psql(
    `update public.media_assets set status='deleted',deleted_at=now(),next_cleanup_attempt_at=null
      where id='${rolloutR2}' and status='delete_pending'`, { check: false },
  );
  assert.notEqual(legacyR2Completion.status, 0);
  assert.match(legacyR2Completion.stderr, /media_asset_delete_confirmation_required/);
  assert.equal(
    psql(`select status from public.media_assets where id='${rolloutR2}'`).stdout.trim(),
    'delete_pending',
    'the pre-C1 cleanup Edge must fail closed after the migration is applied',
  );

  const rolloutStream = '30000000-0000-0000-0000-000000000017';
  psql(`insert into public.video_assets(
    id,owner_id,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes,
    lifecycle_contract_version,upload_expires_at,created_at
  ) values('${rolloutStream}','${ownerId}','creator_premium_video','private','delete_pending',
    'rollout-stream','video/mp4',100,1,now()-interval '90 minutes',now()-interval '2 hours')`);
  const legacyStreamCompletion = psql(
    `update public.video_assets set status='deleted',deleted_at=now(),next_cleanup_attempt_at=null,
      hls_url=null,dash_url=null,thumbnail_url=null
      where id='${rolloutStream}' and purpose='creator_premium_video' and status='delete_pending'`,
    { check: false },
  );
  assert.notEqual(legacyStreamCompletion.status, 0);
  assert.match(legacyStreamCompletion.stderr, /video_asset_delete_confirmation_required/);
  assert.equal(
    psql(`select status from public.video_assets where id='${rolloutStream}'`).stdout.trim(),
    'delete_pending',
    'the pre-C1 Stream cleanup path must fail closed after the migration is applied',
  );

  const bindFirst = '30000000-0000-0000-0000-000000000003';
  psql(`insert into public.video_assets(
    id,owner_id,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes,lifecycle_contract_version
  ) values('${bindFirst}','${ownerId}','creator_premium_video','private','ready','bind-first',
    'video/mp4',100,1)`);
  const binder = psqlAsync(`begin;
    select id from public.video_assets where id='${bindFirst}' for update;
    select pg_sleep(1);
    select public.bind_test_video('${bindFirst}','${ownerId}');
    commit;`);
  await new Promise(resolve => setTimeout(resolve, 150));
  const scheduler = psqlAsync(
    `select public.schedule_creator_premium_video_deletion_v1('${bindFirst}','${ownerId}')`,
  );
  const [bindResult, scheduleResult] = await Promise.all([binder, scheduler]);
  assert.equal(bindResult.status, 0, bindResult.stderr);
  assert.equal(scheduleResult.status, 0, scheduleResult.stderr);
  assert.equal(scheduleResult.stdout.trim(), 'asset_in_use');

  const deleteFirst = '30000000-0000-0000-0000-000000000004';
  psql(`insert into public.video_assets(
    id,owner_id,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes
  ) values('${deleteFirst}','${ownerId}','creator_premium_video','private','ready','delete-first',
    'video/mp4',100)`);
  assert.equal(
    psql(`select public.schedule_creator_premium_video_deletion_v1('${deleteFirst}','${ownerId}')`).stdout.trim(),
    'scheduled',
  );
  assert.equal(
    psql(`select public.bind_test_video('${deleteFirst}','${ownerId}')`).stdout.trim(),
    'f',
  );
  const lateDirectVideoBind = psql(
    `insert into public.video_asset_links(asset_id,owner_id,entity_type,entity_id,slot,position)
     values('${deleteFirst}','${ownerId}','video_post',extensions.gen_random_uuid(),'original',0)`,
    { check: false },
  );
  assert.notEqual(lateDirectVideoBind.status, 0);
  assert.match(lateDirectVideoBind.stderr, /video_asset_link_lifecycle_invalid/);
  assert.equal(
    psql(`select concat_ws('|',status,lifecycle_contract_version) from public.video_assets
          where id='${deleteFirst}'`).stdout.trim(),
    'delete_pending|1',
  );

  const mixedLinkAsset = '20000000-0000-0000-0000-000000000007';
  psql(`insert into public.media_assets(
    id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,
    size_bytes,status,ready_at,created_at
  ) values('${mixedLinkAsset}','${ownerId}','r2','image','post_media','private',
    'private-media','mixed-links/object','image/jpeg',100,'ready',now(),now()-interval '2 days')`);
  psql(`insert into public.media_asset_links(
    asset_id,entity_type,entity_id,slot,position
  ) values
    ('${mixedLinkAsset}','video_post',extensions.gen_random_uuid(),'image',0),
    ('${mixedLinkAsset}','chat_message',extensions.gen_random_uuid(),'image',1)`);
  psql(`select count(*) from public.cleanup_stale_media_upload_records(50)`);
  assert.equal(
    psql(`select concat_ws('|',status,
      (select count(*) from public.media_asset_links link where link.asset_id=asset.id))
      from public.media_assets asset where asset.id='${mixedLinkAsset}'`).stdout.trim(),
    'ready|1',
    'removing one proven-invalid legacy link must not terminalize an asset with another link',
  );

  const legacyCounterStream = '30000000-0000-0000-0000-000000000007';
  psql(`insert into public.video_assets(
    id,owner_id,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes,delete_attempts
  ) values('${legacyCounterStream}','${ownerId}','creator_premium_video','private','ready',
    'legacy-counter-stream','video/mp4',100,99)`);
  assert.equal(
    psql(`select public.schedule_creator_premium_video_deletion_v1(
      '${legacyCounterStream}','${ownerId}')`).stdout.trim(),
    'scheduled',
  );
  assert.equal(
    psql(`select concat_ws('|',delete_attempts,lifecycle_contract_version)
      from public.video_assets where id='${legacyCounterStream}'`).stdout.trim(),
    '0|1',
  );

  const legacyCounterR2 = '20000000-0000-0000-0000-000000000008';
  psql(`insert into public.media_assets(
    id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,
    size_bytes,status,cleanup_attempts
  ) values('${legacyCounterR2}','${ownerId}','r2','image','creator_premium_original_image',
    'private','private-media','legacy-counter/object','image/jpeg',100,'ready',99)`);
  assert.equal(
    psql(`select public.schedule_media_asset_deletion('${legacyCounterR2}','${ownerId}')`).stdout.trim(),
    'scheduled',
  );
  assert.equal(
    psql(`select concat_ws('|',cleanup_attempts,lifecycle_contract_version)
      from public.media_assets where id='${legacyCounterR2}'`).stdout.trim(),
    '0|1',
  );

  const r2C1 = '20000000-0000-0000-0000-000000000003';
  psql(`insert into public.media_assets(
    id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,
    status,lifecycle_contract_version,upload_authorization_expires_at,created_at
  ) values('${r2C1}','${ownerId}','r2','image','creator_premium_original_image','private',
    'private-media','c1/object','image/jpeg',100,'failed',1,now()-interval '90 minutes',now()-interval '2 hours')`);
  const claim1 = psql(`select concat_ws('|',id,cleanup_attempts,operation)
                       from public.cleanup_stale_media_upload_records(50) where id='${r2C1}'`).stdout.trim();
  assert.equal(claim1, `${r2C1}|1|delete`);
  assert.equal(
    psql(`select public.finalize_media_asset_cleanup_v1('${r2C1}',99,'delete',
      'delete_accepted','delete-r2-stale','absence-r2-stale')`).stdout.trim(),
    'stale',
  );
  assert.equal(
    psql(`select public.finalize_media_asset_cleanup_v1('${r2C1}',1,'delete',
      'delete_accepted','delete-r2-1','absence-r2-1')`).stdout.trim(),
    'recheck_scheduled',
  );
  assert.equal(
    psql(`select public.schedule_media_asset_deletion('${r2C1}','${ownerId}')`).stdout.trim(),
    'scheduled',
  );
  assert.equal(
    psql(`select concat_ws('|',status,cleanup_attempts,
      provider_absence_verified_at is not null,provider_absence_recheck_after is not null)
      from public.media_assets where id='${r2C1}'`).stdout.trim(),
    'delete_pending|1|t|t',
    'an idempotent R2 schedule retry must preserve the acquired fence and absence evidence',
  );
  psql(`update public.media_assets set provider_absence_recheck_after=now()-interval '1 second',
        next_cleanup_attempt_at=now()-interval '1 second' where id='${r2C1}'`);
  const claim2 = psql(`select concat_ws('|',cleanup_attempts,operation)
                       from public.cleanup_stale_media_upload_records(50) where id='${r2C1}'`).stdout.trim();
  assert.equal(claim2, '2|verify_absence');
  assert.equal(
    psql(`select count(*) from public.cleanup_stale_media_upload_records(50)
      where id='${r2C1}'`).stdout.trim(),
    '0',
    'the confirmation claim must advance its lease before the provider callback returns',
  );
  assert.equal(
    psql(`select public.finalize_media_asset_cleanup_v1('${r2C1}',2,'verify_absence',
      null,null,'absence-r2-2')`).stdout.trim(),
    'finalized',
  );
  assert.equal(
    psql(`select concat_ws('|',status,cleanup_attempts,post_delete_verification_attempts,
      provider_absence_recheck_after between now()+interval '23 hours'
        and now()+interval '25 hours')
          from public.media_assets where id='${r2C1}'`).stdout.trim(),
    'deleted|2|0|t',
    'entering deleted must preserve the global fence and start a separate verification budget',
  );
  psql(`update public.media_assets set provider_absence_recheck_after=now()-interval '1 second'
        where id='${r2C1}'`);
  const claim3 = psql(`select concat_ws('|',cleanup_attempts,operation)
                       from public.cleanup_stale_media_upload_records(50) where id='${r2C1}'`).stdout.trim();
  assert.equal(claim3, '3|verify_absence');
  assert.equal(
    psql(`select public.finalize_media_asset_cleanup_v1('${r2C1}',2,'verify_absence',
      null,null,'stale-pre-delete-callback')`).stdout.trim(),
    'stale',
    'a callback from the pre-tombstone fence must not match the post-delete claim',
  );
  assert.equal(
    psql(`select public.record_media_asset_provider_delete_v1('${r2C1}',3,
      'verify_absence','delete_accepted','delete-r2-reappeared')`).stdout.trim(),
    't',
  );
  assert.equal(
    psql(`select public.finalize_media_asset_cleanup_v1('${r2C1}',3,'verify_absence',
      'delete_accepted','delete-r2-reappeared','absence-r2-post-delete')`).stdout.trim(),
    'verified',
  );
  assert.equal(
    psql(`select concat_ws('|',status,cleanup_attempts,post_delete_verification_attempts,
      provider_absence_recheck_after is null,next_cleanup_attempt_at is null)
          from public.media_assets where id='${r2C1}'`).stdout.trim(),
    'deleted|3|1|t|t',
  );
  assert.equal(
    psql(`select count(*) from public.cleanup_stale_media_upload_records(50)
          where id='${r2C1}'`).stdout.trim(),
    '0',
    'successful post-delete verification must complete the finite loop',
  );

  const postDeleteFailureR2 = '20000000-0000-0000-0000-000000000013';
  psql(`insert into public.media_assets(
    id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,
    status,lifecycle_contract_version,cleanup_attempts,post_delete_verification_attempts,
    provider_absence_verified_at,
    provider_absence_recheck_after,upload_authorization_expires_at,deleted_at
  ) values('${postDeleteFailureR2}','${ownerId}','r2','image','creator_premium_original_image',
    'private','private-media','post-delete-failure/object','image/jpeg',100,'deleted',1,7,0,
    now()-interval '1 hour',now()-interval '1 second',now()-interval '2 hours',now())`);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const fence = 7 + attempt;
    assert.equal(
      psql(`select concat_ws('|',cleanup_attempts,operation,failure_exhausts)
        from public.cleanup_stale_media_upload_records(50)
        where id='${postDeleteFailureR2}'`).stdout.trim(),
      `${fence}|verify_absence|${attempt === 3 ? 't' : 'f'}`,
    );
    assert.equal(
      psql(`select post_delete_verification_attempts from public.media_assets
        where id='${postDeleteFailureR2}'`).stdout.trim(),
      String(attempt),
    );
    assert.equal(
      psql(`select public.record_media_asset_cleanup_failure_v1(
        '${postDeleteFailureR2}',${fence},'r2_absence_verification_failed')`).stdout.trim(),
      't',
    );
    if (attempt < 3) {
      assert.equal(
        psql(`select provider_absence_recheck_after > now()
          from public.media_assets where id='${postDeleteFailureR2}'`).stdout.trim(),
        't',
      );
      psql(`update public.media_assets set provider_absence_recheck_after=now()-interval '1 second'
        where id='${postDeleteFailureR2}'`);
    }
  }
  assert.equal(
    psql(`select concat_ws('|',error_code,provider_absence_recheck_after,next_cleanup_attempt_at)
      from public.media_assets where id='${postDeleteFailureR2}'`).stdout.trim(),
    'media_post_delete_verification_exhausted',
  );
  assert.equal(
    psql(`select count(*) from public.cleanup_stale_media_upload_records(50)
      where id='${postDeleteFailureR2}'`).stdout.trim(),
    '0',
  );

  const verifierBackoffR2 = '20000000-0000-0000-0000-000000000006';
  psql(`insert into public.media_assets(
    id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,
    status,lifecycle_contract_version,cleanup_attempts,provider_absence_verified_at,
    provider_absence_recheck_after,upload_authorization_expires_at
  ) values('${verifierBackoffR2}','${ownerId}','r2','image','creator_premium_original_image',
    'private','private-media','verifier-backoff/object','image/jpeg',100,'delete_pending',1,1,
    now()-interval '1 hour',now()-interval '1 second',now()-interval '2 hours')`);
  assert.equal(
    psql(`select concat_ws('|',cleanup_attempts,operation)
      from public.cleanup_stale_media_upload_records(50) where id='${verifierBackoffR2}'`).stdout.trim(),
    '2|verify_absence',
  );
  assert.equal(
    psql(`select public.record_media_asset_cleanup_failure_v1('${verifierBackoffR2}',2,
      'r2_absence_verification_failed')`).stdout.trim(),
    't',
  );
  assert.equal(
    psql(`select provider_absence_recheck_after > now()
      from public.media_assets where id='${verifierBackoffR2}'`).stdout.trim(),
    't',
  );
  assert.equal(
    psql(`select count(*) from public.cleanup_stale_media_upload_records(50)
      where id='${verifierBackoffR2}'`).stdout.trim(),
    '0',
    'a failed second observation must honor database backoff instead of hot-looping',
  );

  const exhaustedR2 = '20000000-0000-0000-0000-000000000004';
  psql(`insert into public.media_assets(
    id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,
    status,lifecycle_contract_version,cleanup_attempts,next_cleanup_attempt_at
  ) values('${exhaustedR2}','${ownerId}','r2','image','creator_premium_original_image','private',
    'private-media','exhausted/object','image/jpeg',100,'delete_pending',1,11,now()-interval '1 second')`);
  assert.equal(
    psql(`select cleanup_attempts from public.cleanup_stale_media_upload_records(50)
          where id='${exhaustedR2}'`).stdout.trim(),
    '12',
  );
  assert.equal(
    psql(`select public.record_media_asset_cleanup_failure_v1('${exhaustedR2}',12,'provider_timeout')`).stdout.trim(),
    't',
  );
  assert.equal(
    psql(`select concat_ws('|',error_code,next_cleanup_attempt_at,provider_absence_recheck_after)
          from public.media_assets where id='${exhaustedR2}'`).stdout.trim(),
    'media_cleanup_attempts_exhausted',
  );
  assert.equal(
    psql(`select count(*) from public.cleanup_stale_media_upload_records(50)
          where id='${exhaustedR2}'`).stdout.trim(),
    '0',
    'exhausted cleanup must remain preserved for inventory/manual review',
  );

  const lastChanceR2 = '20000000-0000-0000-0000-000000000005';
  psql(`insert into public.media_assets(
    id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,
    status,lifecycle_contract_version,cleanup_attempts,next_cleanup_attempt_at,
    provider_absence_verified_at,provider_absence_recheck_after,upload_authorization_expires_at
  ) values('${lastChanceR2}','${ownerId}','r2','image','creator_premium_original_image','private',
    'private-media','last-chance/object','image/jpeg',100,'delete_pending',1,11,
    now()-interval '1 second',now()-interval '1 hour',now()-interval '1 second',
    now()-interval '2 hours')`);
  assert.equal(
    psql(`select cleanup_attempts from public.cleanup_stale_media_upload_records(50)
          where id='${lastChanceR2}'`).stdout.trim(),
    '12',
  );
  assert.equal(
    psql(`select public.finalize_media_asset_cleanup_v1('${lastChanceR2}',12,'verify_absence',
      null,null,'absence-r2-last')`).stdout.trim(),
    'finalized',
    'a successful second absence observation on the final attempt must commit the tombstone',
  );
  assert.equal(
    psql(`select concat_ws('|',status,cleanup_attempts,post_delete_verification_attempts)
      from public.media_assets where id='${lastChanceR2}'`).stdout.trim(),
    'deleted|12|0',
  );

  const cappedConfirmR2 = '20000000-0000-0000-0000-000000000014';
  psql(`insert into public.media_assets(
    id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,
    status,lifecycle_contract_version,cleanup_attempts,provider_absence_verified_at,
    provider_absence_recheck_after,upload_authorization_expires_at
  ) values('${cappedConfirmR2}','${ownerId}','r2','image','creator_premium_original_image',
    'private','private-media','capped-confirm/object','image/jpeg',100,'delete_pending',1,12,
    now()-interval '1 hour',now()-interval '1 second',now()-interval '2 hours')`);
  assert.equal(
    psql(`select concat_ws('|',cleanup_attempts,operation)
      from public.cleanup_stale_media_upload_records(50) where id='${cappedConfirmR2}'`).stdout.trim(),
    '13|verify_absence',
  );
  psql(`update public.media_assets set provider_absence_recheck_after=now()-interval '1 second'
    where id='${cappedConfirmR2}'`);
  assert.equal(
    psql(`select count(*) from public.cleanup_stale_media_upload_records(50)
      where id='${cappedConfirmR2}'`).stdout.trim(),
    '0',
    'a lost confirmation callback must not create an unbounded attempt 14',
  );
  assert.equal(
    psql(`select concat_ws('|',error_code,next_cleanup_attempt_at,provider_absence_recheck_after)
      from public.media_assets where id='${cappedConfirmR2}'`).stdout.trim(),
    'media_cleanup_attempts_exhausted',
    'the expired final confirmation lease must be classified without another provider call',
  );
  assert.equal(
    psql(`select public.finalize_media_asset_cleanup_v1('${cappedConfirmR2}',13,
      'verify_absence',null,null,'late-confirm-r2')`).stdout.trim(),
    'stale',
    'a callback arriving after the final confirmation lease was reaped must be fenced',
  );

  const lostInitialR2 = '20000000-0000-0000-0000-000000000015';
  psql(`insert into public.media_assets(
    id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,
    status,lifecycle_contract_version,cleanup_attempts,next_cleanup_attempt_at,
    upload_authorization_expires_at
  ) values('${lostInitialR2}','${ownerId}','r2','image','creator_premium_original_image',
    'private','private-media','lost-initial/object','image/jpeg',100,'delete_pending',1,11,
    now()-interval '1 second',now()-interval '2 hours')`);
  assert.equal(
    psql(`select concat_ws('|',cleanup_attempts,operation)
      from public.cleanup_stale_media_upload_records(50) where id='${lostInitialR2}'`).stdout.trim(),
    '12|delete',
  );
  psql(`update public.media_assets set next_cleanup_attempt_at=now()-interval '1 second'
    where id='${lostInitialR2}'`);
  assert.equal(
    psql(`select count(*) from public.cleanup_stale_media_upload_records(50)
      where id='${lostInitialR2}'`).stdout.trim(),
    '0',
  );
  assert.equal(
    psql(`select concat_ws('|',error_code,next_cleanup_attempt_at,provider_absence_recheck_after)
      from public.media_assets where id='${lostInitialR2}'`).stdout.trim(),
    'media_cleanup_attempts_exhausted',
  );
  assert.equal(
    psql(`select public.record_media_asset_provider_delete_v1('${lostInitialR2}',12,
      'delete','delete_accepted','late-delete-r2')`).stdout.trim(),
    'f',
  );
  assert.equal(
    psql(`select public.finalize_media_asset_cleanup_v1('${lostInitialR2}',12,'delete',
      'delete_accepted','late-delete-r2','late-absence-r2')`).stdout.trim(),
    'stale',
  );
  assert.equal(
    psql(`select public.record_media_asset_cleanup_failure_v1(
      '${lostInitialR2}',12,'late_provider_failure')`).stdout.trim(),
    'f',
  );

  const lostPostDeleteR2 = '20000000-0000-0000-0000-000000000016';
  psql(`insert into public.media_assets(
    id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,
    status,lifecycle_contract_version,cleanup_attempts,post_delete_verification_attempts,
    provider_absence_verified_at,provider_absence_recheck_after,deleted_at
  ) values('${lostPostDeleteR2}','${ownerId}','r2','image','creator_premium_original_image',
    'private','private-media','lost-post-delete/object','image/jpeg',100,'deleted',1,20,2,
    now()-interval '1 hour',now()-interval '1 second',now())`);
  assert.equal(
    psql(`select concat_ws('|',cleanup_attempts,operation,failure_exhausts)
      from public.cleanup_stale_media_upload_records(50) where id='${lostPostDeleteR2}'`).stdout.trim(),
    '21|verify_absence|t',
  );
  psql(`update public.media_assets set provider_absence_recheck_after=now()-interval '1 second'
    where id='${lostPostDeleteR2}'`);
  assert.equal(
    psql(`select count(*) from public.cleanup_stale_media_upload_records(50)
      where id='${lostPostDeleteR2}'`).stdout.trim(),
    '0',
  );
  assert.equal(
    psql(`select concat_ws('|',error_code,next_cleanup_attempt_at,provider_absence_recheck_after)
      from public.media_assets where id='${lostPostDeleteR2}'`).stdout.trim(),
    'media_post_delete_verification_exhausted',
  );
  assert.equal(
    psql(`select public.finalize_media_asset_cleanup_v1('${lostPostDeleteR2}',21,
      'verify_absence',null,null,'late-post-delete-r2')`).stdout.trim(),
    'stale',
  );

  const streamClaim = psql(`select concat_ws('|',id,delete_attempts,operation,purpose)
    from public.cleanup_stale_creator_premium_video_records(50) where id='${deleteFirst}'`).stdout.trim();
  assert.equal(streamClaim, `${deleteFirst}|1|delete|creator_premium_video`);
  assert.equal(
    psql(`select public.finalize_creator_premium_video_cleanup_v1('${deleteFirst}',1,'delete',
      'delete_accepted','delete-stream-1','absence-stream-1')`).stdout.trim(),
    'recheck_scheduled',
  );
  assert.equal(
    psql(`select public.schedule_video_asset_deletion_v1('${deleteFirst}','${ownerId}')`).stdout.trim(),
    'scheduled',
  );
  assert.equal(
    psql(`select concat_ws('|',status,delete_attempts,
      provider_absence_verified_at is not null,provider_absence_recheck_after is not null)
      from public.video_assets where id='${deleteFirst}'`).stdout.trim(),
    'delete_pending|1|t|t',
    'an idempotent Stream schedule retry must preserve the acquired fence and absence evidence',
  );
  psql(`update public.video_assets set provider_absence_recheck_after=now()-interval '1 second',
        next_cleanup_attempt_at=now()-interval '1 second' where id='${deleteFirst}'`);
  assert.equal(
    psql(`select concat_ws('|',delete_attempts,operation)
          from public.cleanup_stale_creator_premium_video_records(50) where id='${deleteFirst}'`).stdout.trim(),
    '2|verify_absence',
  );
  assert.equal(
    psql(`select count(*) from public.cleanup_stale_creator_premium_video_records(50)
      where id='${deleteFirst}'`).stdout.trim(),
    '0',
  );
  assert.equal(
    psql(`select public.finalize_creator_premium_video_cleanup_v1('${deleteFirst}',2,'verify_absence',
      null,null,'absence-stream-2')`).stdout.trim(),
    'finalized',
  );
  assert.equal(
    psql(`select concat_ws('|',status,delete_attempts,post_delete_verification_attempts,
      provider_absence_recheck_after between now()+interval '23 hours'
        and now()+interval '25 hours')
      from public.video_assets where id='${deleteFirst}'`).stdout.trim(),
    'deleted|2|0|t',
  );
  psql(`update public.video_assets set provider_absence_recheck_after=now()-interval '1 second'
        where id='${deleteFirst}'`);
  assert.equal(
    psql(`select concat_ws('|',delete_attempts,operation)
          from public.cleanup_stale_creator_premium_video_records(50) where id='${deleteFirst}'`).stdout.trim(),
    '3|verify_absence',
  );
  assert.equal(
    psql(`select public.finalize_creator_premium_video_cleanup_v1('${deleteFirst}',2,
      'verify_absence',null,null,'stale-stream-pre-delete-callback')`).stdout.trim(),
    'stale',
  );
  assert.equal(
    psql(`select public.record_creator_premium_video_provider_delete_v1('${deleteFirst}',3,
      'verify_absence','delete_accepted','delete-stream-reappeared')`).stdout.trim(),
    't',
  );
  assert.equal(
    psql(`select public.finalize_creator_premium_video_cleanup_v1('${deleteFirst}',3,'verify_absence',
      'delete_accepted','delete-stream-reappeared','absence-stream-post-delete')`).stdout.trim(),
    'verified',
  );
  assert.equal(
    psql(`select concat_ws('|',status,delete_attempts,post_delete_verification_attempts,
      provider_absence_recheck_after is null,next_cleanup_attempt_at is null)
      from public.video_assets where id='${deleteFirst}'`).stdout.trim(),
    'deleted|3|1|t|t',
  );

  const postDeleteFailureStream = '30000000-0000-0000-0000-000000000013';
  psql(`insert into public.video_assets(
    id,owner_id,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes,
    lifecycle_contract_version,delete_attempts,post_delete_verification_attempts,
    provider_absence_verified_at,
    provider_absence_recheck_after,upload_expires_at,deleted_at
  ) values('${postDeleteFailureStream}','${ownerId}','creator_premium_video','private','deleted',
    'post-delete-failure-stream','video/mp4',100,1,7,0,now()-interval '1 hour',
    now()-interval '1 second',now()-interval '2 hours',now())`);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const fence = 7 + attempt;
    assert.equal(
      psql(`select concat_ws('|',delete_attempts,operation,failure_exhausts)
        from public.cleanup_stale_creator_premium_video_records(50)
        where id='${postDeleteFailureStream}'`).stdout.trim(),
      `${fence}|verify_absence|${attempt === 3 ? 't' : 'f'}`,
    );
    assert.equal(
      psql(`select post_delete_verification_attempts from public.video_assets
        where id='${postDeleteFailureStream}'`).stdout.trim(),
      String(attempt),
    );
    assert.equal(
      psql(`select public.record_creator_premium_video_cleanup_failure_v1(
        '${postDeleteFailureStream}',${fence},'stream_absence_verification_failed')`).stdout.trim(),
      't',
    );
    if (attempt < 3) {
      psql(`update public.video_assets set provider_absence_recheck_after=now()-interval '1 second'
        where id='${postDeleteFailureStream}'`);
    }
  }
  assert.equal(
    psql(`select concat_ws('|',error_code,provider_absence_recheck_after,next_cleanup_attempt_at)
      from public.video_assets where id='${postDeleteFailureStream}'`).stdout.trim(),
    'stream_post_delete_verification_exhausted',
  );
  assert.equal(
    psql(`select count(*) from public.cleanup_stale_creator_premium_video_records(50)
      where id='${postDeleteFailureStream}'`).stdout.trim(),
    '0',
  );

  const verifierBackoffStream = '30000000-0000-0000-0000-000000000006';
  psql(`insert into public.video_assets(
    id,owner_id,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes,
    lifecycle_contract_version,delete_attempts,provider_absence_verified_at,
    provider_absence_recheck_after,upload_expires_at
  ) values('${verifierBackoffStream}','${ownerId}','creator_premium_video','private',
    'delete_pending','verifier-backoff-stream','video/mp4',100,1,1,
    now()-interval '1 hour',now()-interval '1 second',now()-interval '2 hours')`);
  assert.equal(
    psql(`select concat_ws('|',delete_attempts,operation)
      from public.cleanup_stale_creator_premium_video_records(50)
      where id='${verifierBackoffStream}'`).stdout.trim(),
    '2|verify_absence',
  );
  assert.equal(
    psql(`select public.record_creator_premium_video_cleanup_failure_v1(
      '${verifierBackoffStream}',2,'stream_provider_temporarily_unavailable')`).stdout.trim(),
    't',
  );
  assert.equal(
    psql(`select provider_absence_recheck_after > now()
      from public.video_assets where id='${verifierBackoffStream}'`).stdout.trim(),
    't',
  );
  assert.equal(
    psql(`select count(*) from public.cleanup_stale_creator_premium_video_records(50)
      where id='${verifierBackoffStream}'`).stdout.trim(),
    '0',
  );

  const lastChanceStream = '30000000-0000-0000-0000-000000000005';
  psql(`insert into public.video_assets(
    id,owner_id,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes,
    lifecycle_contract_version,delete_attempts,next_cleanup_attempt_at,
    provider_absence_verified_at,provider_absence_recheck_after,upload_expires_at
  ) values('${lastChanceStream}','${ownerId}','creator_premium_video','private','delete_pending',
    'last-chance-stream','video/mp4',100,1,11,now()-interval '1 second',
    now()-interval '1 hour',now()-interval '1 second',now()-interval '2 hours')`);
  assert.equal(
    psql(`select delete_attempts from public.cleanup_stale_creator_premium_video_records(50)
          where id='${lastChanceStream}'`).stdout.trim(),
    '12',
  );
  assert.equal(
    psql(`select public.finalize_creator_premium_video_cleanup_v1('${lastChanceStream}',12,'verify_absence',
      null,null,'absence-stream-last')`).stdout.trim(),
    'finalized',
    'a successful Stream absence observation on the final attempt must commit the tombstone',
  );
  assert.equal(
    psql(`select concat_ws('|',status,delete_attempts,post_delete_verification_attempts)
      from public.video_assets where id='${lastChanceStream}'`).stdout.trim(),
    'deleted|12|0',
  );

  const cappedConfirmStream = '30000000-0000-0000-0000-000000000014';
  psql(`insert into public.video_assets(
    id,owner_id,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes,
    lifecycle_contract_version,delete_attempts,provider_absence_verified_at,
    provider_absence_recheck_after,upload_expires_at
  ) values('${cappedConfirmStream}','${ownerId}','creator_premium_video','private','delete_pending',
    'capped-confirm-stream','video/mp4',100,1,12,now()-interval '1 hour',
    now()-interval '1 second',now()-interval '2 hours')`);
  assert.equal(
    psql(`select concat_ws('|',delete_attempts,operation)
      from public.cleanup_stale_creator_premium_video_records(50)
      where id='${cappedConfirmStream}'`).stdout.trim(),
    '13|verify_absence',
  );
  psql(`update public.video_assets set provider_absence_recheck_after=now()-interval '1 second'
    where id='${cappedConfirmStream}'`);
  assert.equal(
    psql(`select count(*) from public.cleanup_stale_creator_premium_video_records(50)
      where id='${cappedConfirmStream}'`).stdout.trim(),
    '0',
  );
  assert.equal(
    psql(`select concat_ws('|',error_code,next_cleanup_attempt_at,provider_absence_recheck_after)
      from public.video_assets where id='${cappedConfirmStream}'`).stdout.trim(),
    'stream_cleanup_attempts_exhausted',
  );
  assert.equal(
    psql(`select public.finalize_creator_premium_video_cleanup_v1('${cappedConfirmStream}',13,
      'verify_absence',null,null,'late-confirm-stream')`).stdout.trim(),
    'stale',
  );

  const lostInitialStream = '30000000-0000-0000-0000-000000000015';
  psql(`insert into public.video_assets(
    id,owner_id,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes,
    lifecycle_contract_version,delete_attempts,next_cleanup_attempt_at,upload_expires_at
  ) values('${lostInitialStream}','${ownerId}','creator_premium_video','private','delete_pending',
    'lost-initial-stream','video/mp4',100,1,11,now()-interval '1 second',now()-interval '2 hours')`);
  assert.equal(
    psql(`select concat_ws('|',delete_attempts,operation)
      from public.cleanup_stale_creator_premium_video_records(50)
      where id='${lostInitialStream}'`).stdout.trim(),
    '12|delete',
  );
  psql(`update public.video_assets set next_cleanup_attempt_at=now()-interval '1 second'
    where id='${lostInitialStream}'`);
  assert.equal(
    psql(`select count(*) from public.cleanup_stale_creator_premium_video_records(50)
      where id='${lostInitialStream}'`).stdout.trim(),
    '0',
  );
  assert.equal(
    psql(`select concat_ws('|',error_code,next_cleanup_attempt_at,provider_absence_recheck_after)
      from public.video_assets where id='${lostInitialStream}'`).stdout.trim(),
    'stream_cleanup_attempts_exhausted',
  );
  assert.equal(
    psql(`select public.record_creator_premium_video_provider_delete_v1('${lostInitialStream}',12,
      'delete','delete_accepted','late-delete-stream')`).stdout.trim(),
    'f',
  );
  assert.equal(
    psql(`select public.finalize_creator_premium_video_cleanup_v1('${lostInitialStream}',12,'delete',
      'delete_accepted','late-delete-stream','late-absence-stream')`).stdout.trim(),
    'stale',
  );
  assert.equal(
    psql(`select public.record_creator_premium_video_cleanup_failure_v1(
      '${lostInitialStream}',12,'late_provider_failure')`).stdout.trim(),
    'f',
  );

  const lostPostDeleteStream = '30000000-0000-0000-0000-000000000016';
  psql(`insert into public.video_assets(
    id,owner_id,purpose,visibility,status,cloudflare_uid,mime_type,size_bytes,
    lifecycle_contract_version,delete_attempts,post_delete_verification_attempts,
    provider_absence_verified_at,provider_absence_recheck_after,deleted_at
  ) values('${lostPostDeleteStream}','${ownerId}','creator_premium_video','private','deleted',
    'lost-post-delete-stream','video/mp4',100,1,20,2,now()-interval '1 hour',
    now()-interval '1 second',now())`);
  assert.equal(
    psql(`select concat_ws('|',delete_attempts,operation,failure_exhausts)
      from public.cleanup_stale_creator_premium_video_records(50)
      where id='${lostPostDeleteStream}'`).stdout.trim(),
    '21|verify_absence|t',
  );
  psql(`update public.video_assets set provider_absence_recheck_after=now()-interval '1 second'
    where id='${lostPostDeleteStream}'`);
  assert.equal(
    psql(`select count(*) from public.cleanup_stale_creator_premium_video_records(50)
      where id='${lostPostDeleteStream}'`).stdout.trim(),
    '0',
  );
  assert.equal(
    psql(`select concat_ws('|',error_code,next_cleanup_attempt_at,provider_absence_recheck_after)
      from public.video_assets where id='${lostPostDeleteStream}'`).stdout.trim(),
    'stream_post_delete_verification_exhausted',
  );
  assert.equal(
    psql(`select public.finalize_creator_premium_video_cleanup_v1('${lostPostDeleteStream}',21,
      'verify_absence',null,null,'late-post-delete-stream')`).stdout.trim(),
    'stale',
  );

  assert.equal(
    psql(`select count(*) from private.admin_action_audit
      where target_id in ('${cappedConfirmR2}','${lostInitialR2}','${lostPostDeleteR2}',
        '${cappedConfirmStream}','${lostInitialStream}','${lostPostDeleteStream}')
        and metadata->>'provider_outcome'='claim_lease_expired'
        and outcome='failed'`).stdout.trim(),
    '6',
    'every final-claim reaper path must leave a sanitized immutable receipt',
  );

  assert.equal(
    psql(`select count(*) >= 4 and bool_and(
      domain='media_lifecycle' and actor_kind='system_workflow' and financial_effect=false
      and contains_pii=false and not(metadata ? 'object_key') and not(metadata ? 'cloudflare_uid')
      and not(metadata ? 'signed_url')) from private.admin_action_audit`).stdout.trim(),
    't',
  );
  assert.equal(
    psql(`select string_agg(action || ':' || coalesce(metadata->>'provider_request_id','none'),','
                         order by (metadata->>'attempt')::integer,action)
          from private.admin_action_audit
          where target_id='${r2C1}'
            and action in (
              'media_lifecycle.delete_requested',
              'media_lifecycle.absence_check_requested',
              'media_lifecycle.delete_accepted',
              'media_lifecycle.absence_observed',
              'media_lifecycle.tombstone_confirmed',
              'media_lifecycle.absence_verified'
            )`).stdout.trim(),
    [
      'media_lifecycle.absence_observed:absence-r2-1',
      'media_lifecycle.delete_accepted:delete-r2-1',
      'media_lifecycle.delete_requested:none',
      'media_lifecycle.absence_check_requested:none',
      'media_lifecycle.tombstone_confirmed:absence-r2-2',
      'media_lifecycle.absence_check_requested:none',
      'media_lifecycle.absence_verified:absence-r2-post-delete',
      'media_lifecycle.delete_accepted:delete-r2-reappeared',
    ].join(','),
    'audit receipts must independently capture claim, provider DELETE, tombstone, and absence evidence',
  );
  const immutable = psql(`update private.admin_action_audit set outcome='failed'`, { check: false });
  assert.notEqual(immutable.status, 0);
  assert.match(immutable.stderr, /admin_action_audit_immutable/);

  for (const signature of [
    'public.schedule_video_asset_deletion_v1(uuid,uuid)',
    'public.schedule_creator_premium_video_deletion_v1(uuid,uuid)',
    'public.record_media_asset_provider_delete_v1(uuid,integer,text,text,text)',
    'public.record_creator_premium_video_provider_delete_v1(uuid,integer,text,text,text)',
    'public.finalize_media_asset_cleanup_v1(uuid,integer,text,text,text,text)',
    'public.record_media_asset_cleanup_failure_v1(uuid,integer,text)',
    'public.finalize_creator_premium_video_cleanup_v1(uuid,integer,text,text,text,text)',
    'public.record_creator_premium_video_cleanup_failure_v1(uuid,integer,text)',
  ]) {
    assert.equal(
      psql(`select concat_ws('|',
        has_function_privilege('anon','${signature}','execute'),
        has_function_privilege('authenticated','${signature}','execute'),
        has_function_privilege('service_role','${signature}','execute'))`).stdout.trim(),
      'f|f|t',
      signature,
    );
  }
  assert.equal(
    psql(`select concat_ws('|',
      (select relrowsecurity from pg_class where oid='public.media_assets'::regclass),
      (select relrowsecurity from pg_class where oid='public.video_assets'::regclass),
      purchase_enabled,subscription_enabled,refunds_enabled,platform_fee_bps)
      from private.finance_switches where singleton`).stdout.trim(),
    't|t|f|f|f|0',
  );
});
