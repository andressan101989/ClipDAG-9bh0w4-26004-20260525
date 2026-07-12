begin;

alter table public.calls
  add column if not exists idempotency_key text,
  add column if not exists accepted_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists end_reason text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists caller_device_id uuid,
  add column if not exists callee_device_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'calls_status_check'
       and conrelid = 'public.calls'::regclass
  ) then
    alter table public.calls
      add constraint calls_status_check
      check (status in ('ringing', 'accepted', 'rejected', 'missed', 'ended', 'cancelled', 'expired'))
      not valid;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'calls_call_type_check'
       and conrelid = 'public.calls'::regclass
  ) then
    alter table public.calls
      add constraint calls_call_type_check
      check (call_type in ('audio', 'video'))
      not valid;
  end if;
end;
$$;

create table if not exists public.call_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id text not null,
  platform text not null check (platform in ('ios', 'android')),
  expo_push_token text,
  native_push_token text,
  voip_push_token text,
  app_version text,
  device_model text,
  active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint call_devices_installation_not_blank check (length(trim(installation_id)) > 0)
);

create unique index if not exists call_devices_user_installation_uidx
  on public.call_devices (user_id, installation_id);

create unique index if not exists call_devices_expo_push_token_uidx
  on public.call_devices (expo_push_token)
  where expo_push_token is not null;

create unique index if not exists call_devices_native_push_token_uidx
  on public.call_devices (native_push_token)
  where native_push_token is not null;

create unique index if not exists call_devices_voip_push_token_uidx
  on public.call_devices (voip_push_token)
  where voip_push_token is not null;

create index if not exists call_devices_user_active_idx
  on public.call_devices (user_id, active, last_seen_at desc);

create unique index if not exists calls_caller_idempotency_uidx
  on public.calls (caller_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists calls_callee_status_created_idx
  on public.calls (callee_id, status, created_at desc);

create index if not exists calls_caller_status_created_idx
  on public.calls (caller_id, status, created_at desc);

create index if not exists calls_status_expires_idx
  on public.calls (status, expires_at);

create index if not exists calls_updated_at_idx
  on public.calls (updated_at desc);

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'calls_caller_device_fk'
       and conrelid = 'public.calls'::regclass
  ) then
    alter table public.calls
      add constraint calls_caller_device_fk
      foreign key (caller_device_id) references public.call_devices(id)
      not valid;
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conname = 'calls_callee_device_fk'
       and conrelid = 'public.calls'::regclass
  ) then
    alter table public.calls
      add constraint calls_callee_device_fk
      foreign key (callee_device_id) references public.call_devices(id)
      not valid;
  end if;
end;
$$;

alter table public.call_devices enable row level security;

drop policy if exists "call_devices_select_own" on public.call_devices;
create policy "call_devices_select_own" on public.call_devices
  for select using (auth.uid() = user_id);

drop policy if exists "call_devices_insert_own" on public.call_devices;
create policy "call_devices_insert_own" on public.call_devices
  for insert with check (auth.uid() = user_id);

drop policy if exists "call_devices_update_own" on public.call_devices;
create policy "call_devices_update_own" on public.call_devices
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.touch_call_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists calls_touch_updated_at on public.calls;
create trigger calls_touch_updated_at
before update on public.calls
for each row execute function public.touch_call_updated_at();

create or replace function public.touch_call_device_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists call_devices_touch_updated_at on public.call_devices;
create trigger call_devices_touch_updated_at
before update on public.call_devices
for each row execute function public.touch_call_device_updated_at();

create or replace function public.register_call_device(
  p_installation_id text,
  p_platform text,
  p_expo_push_token text default null,
  p_native_push_token text default null,
  p_voip_push_token text default null,
  p_app_version text default null,
  p_device_model text default null
)
returns table (device_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_installation_id text := nullif(trim(p_installation_id), '');
  v_platform text := lower(nullif(trim(p_platform), ''));
  v_device_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;
  if v_installation_id is null then
    raise exception 'installation_id is required';
  end if;
  if v_platform not in ('ios', 'android') then
    raise exception 'invalid platform';
  end if;

  if p_expo_push_token is not null and exists (
    select 1 from public.call_devices as cd
     where cd.expo_push_token = p_expo_push_token
       and cd.user_id <> v_user_id
  ) then
    raise exception 'expo push token belongs to another user';
  end if;

  if p_native_push_token is not null and exists (
    select 1 from public.call_devices as cd
     where cd.native_push_token = p_native_push_token
       and cd.user_id <> v_user_id
  ) then
    raise exception 'native push token belongs to another user';
  end if;

  if p_voip_push_token is not null and exists (
    select 1 from public.call_devices as cd
     where cd.voip_push_token = p_voip_push_token
       and cd.user_id <> v_user_id
  ) then
    raise exception 'voip push token belongs to another user';
  end if;

  insert into public.call_devices (
    user_id, installation_id, platform, expo_push_token, native_push_token,
    voip_push_token, app_version, device_model, active, last_seen_at
  ) values (
    v_user_id, v_installation_id, v_platform, p_expo_push_token, p_native_push_token,
    p_voip_push_token, p_app_version, p_device_model, true, now()
  )
  on conflict (user_id, installation_id) do update
    set platform = excluded.platform,
        expo_push_token = excluded.expo_push_token,
        native_push_token = excluded.native_push_token,
        voip_push_token = excluded.voip_push_token,
        app_version = excluded.app_version,
        device_model = excluded.device_model,
        active = true,
        last_seen_at = now()
  returning id into v_device_id;

  return query select v_device_id;
end;
$$;

create or replace function public.deactivate_call_device(p_installation_id text)
returns table (device_id uuid, active boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_installation_id text := nullif(trim(p_installation_id), '');
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;
  if v_installation_id is null then
    raise exception 'installation_id is required';
  end if;

  return query
    update public.call_devices as cd
       set active = false,
           last_seen_at = now()
     where cd.user_id = v_user_id
       and cd.installation_id = v_installation_id
     returning cd.id, cd.active;
end;
$$;

create or replace function public.expire_stale_calls()
returns table (closed_count integer, closed_ids uuid[])
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
begin
  with expired as (
    update public.calls as c
       set status = 'expired',
           end_reason = coalesce(c.end_reason, 'timeout'),
           ended_at = coalesce(c.ended_at, now())
     where c.status = 'ringing'
       and (
         (c.expires_at is not null and c.expires_at < now())
         or (c.expires_at is null and c.created_at < now() - interval '45 seconds')
       )
     returning c.id
  ),
  stale as (
    update public.calls as c
       set status = 'ended',
           end_reason = coalesce(c.end_reason, 'system_cleanup'),
           ended_at = coalesce(c.ended_at, now())
     where c.status = 'accepted'
       and (
         c.updated_at < now() - interval '12 hours'
         or c.created_at < now() - interval '12 hours'
       )
     returning c.id
  )
  select coalesce(array_agg(stale.id), '{}')
    into v_ids
    from (
      select expired.id from expired
      union all
      select stale.id from stale
    ) as stale;

  return query select coalesce(array_length(v_ids, 1), 0), coalesce(v_ids, '{}');
end;
$$;

create or replace function public.start_call(
  p_callee_id uuid,
  p_call_type text,
  p_idempotency_key text,
  p_caller_device_id uuid default null
)
returns table (
  call_id uuid,
  caller_id uuid,
  callee_id uuid,
  channel_name text,
  call_type text,
  status text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_id uuid := auth.uid();
  v_call_type text := lower(nullif(trim(p_call_type), ''));
  v_key text := nullif(trim(p_idempotency_key), '');
  v_existing public.calls%rowtype;
  v_new_id uuid;
begin
  if v_caller_id is null then
    raise exception 'not authenticated';
  end if;
  if p_callee_id is null then
    raise exception 'callee_id is required';
  end if;
  if p_callee_id = v_caller_id then
    raise exception 'cannot call yourself';
  end if;
  if v_call_type not in ('audio', 'video') then
    raise exception 'invalid call_type';
  end if;
  if v_key is null then
    raise exception 'idempotency_key is required';
  end if;
  if not exists (select 1 from public.user_profiles as up where up.id = p_callee_id) then
    raise exception 'callee not found';
  end if;
  if p_caller_device_id is not null and not exists (
    select 1 from public.call_devices as cd
     where cd.id = p_caller_device_id
       and cd.user_id = v_caller_id
       and cd.active = true
  ) then
    raise exception 'caller device not found';
  end if;

  perform public.expire_stale_calls();

  select c.*
    into v_existing
    from public.calls as c
   where c.caller_id = v_caller_id
     and c.idempotency_key = v_key
   for update;

  if v_existing.id is not null then
    return query
      select c.id, c.caller_id, c.callee_id, c.channel_name, c.call_type, c.status, c.expires_at
        from public.calls as c
       where c.id = v_existing.id;
    return;
  end if;

  v_new_id := gen_random_uuid();

  begin
    insert into public.calls (
      id, caller_id, callee_id, channel_name, status, call_type, created_at,
      updated_at, expires_at, idempotency_key, caller_device_id
    ) values (
      v_new_id,
      v_caller_id,
      p_callee_id,
      'c_' || replace(v_new_id::text, '-', ''),
      'ringing',
      v_call_type,
      now(),
      now(),
      now() + interval '45 seconds',
      v_key,
      p_caller_device_id
    )
    returning public.calls.id into v_new_id;
  exception when unique_violation then
    select c.id
      into v_new_id
      from public.calls as c
     where c.caller_id = v_caller_id
       and c.idempotency_key = v_key;
  end;

  return query
    select c.id, c.caller_id, c.callee_id, c.channel_name, c.call_type, c.status, c.expires_at
      from public.calls as c
     where c.id = v_new_id;
end;
$$;

create or replace function public.accept_call(
  p_call_id uuid,
  p_callee_device_id uuid default null
)
returns table (call_id uuid, channel_name text, call_type text, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_call public.calls%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select c.*
    into v_call
    from public.calls as c
   where c.id = p_call_id
   for update;

  if v_call.id is null then
    raise exception 'call not found';
  end if;
  if v_call.callee_id <> v_user_id then
    raise exception 'not call callee';
  end if;
  if p_callee_device_id is not null and not exists (
    select 1 from public.call_devices as cd
     where cd.id = p_callee_device_id
       and cd.user_id = v_user_id
       and cd.active = true
  ) then
    raise exception 'callee device not found';
  end if;

  if v_call.status = 'accepted' then
    return query select v_call.id, v_call.channel_name, v_call.call_type, v_call.status;
    return;
  end if;
  if v_call.status <> 'ringing' then
    raise exception 'call is not ringing';
  end if;
  if v_call.expires_at is not null and v_call.expires_at < now() then
    update public.calls as c
       set status = 'expired',
           end_reason = 'timeout',
           ended_at = coalesce(c.ended_at, now())
     where c.id = v_call.id;
    raise exception 'call expired';
  end if;

  update public.calls as c
     set status = 'accepted',
         accepted_at = coalesce(c.accepted_at, now()),
         callee_device_id = coalesce(p_callee_device_id, c.callee_device_id)
   where c.id = v_call.id
   returning c.* into v_call;

  return query select v_call.id, v_call.channel_name, v_call.call_type, v_call.status;
end;
$$;

create or replace function public.reject_call(p_call_id uuid, p_reason text default 'user_rejected')
returns table (call_id uuid, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'user_rejected');
  v_call public.calls%rowtype;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if v_reason not in ('user_rejected', 'caller_cancelled', 'user_ended', 'timeout', 'disconnected', 'busy', 'answered_elsewhere', 'system_cleanup') then
    raise exception 'invalid reason';
  end if;

  select c.* into v_call from public.calls as c where c.id = p_call_id for update;
  if v_call.id is null then raise exception 'call not found'; end if;
  if v_call.callee_id <> v_user_id then raise exception 'not call callee'; end if;

  if v_call.status in ('rejected', 'missed', 'ended', 'cancelled', 'expired') then
    return query select v_call.id, v_call.status;
    return;
  end if;
  if v_call.status <> 'ringing' then raise exception 'call is not ringing'; end if;

  update public.calls as c
     set status = 'rejected',
         rejected_at = coalesce(c.rejected_at, now()),
         ended_at = coalesce(c.ended_at, now()),
         end_reason = v_reason
   where c.id = v_call.id
   returning c.* into v_call;

  return query select v_call.id, v_call.status;
end;
$$;

create or replace function public.cancel_call(p_call_id uuid)
returns table (call_id uuid, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_call public.calls%rowtype;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;

  select c.* into v_call from public.calls as c where c.id = p_call_id for update;
  if v_call.id is null then raise exception 'call not found'; end if;
  if v_call.caller_id <> v_user_id then raise exception 'not call caller'; end if;

  if v_call.status in ('rejected', 'missed', 'ended', 'cancelled', 'expired') then
    return query select v_call.id, v_call.status;
    return;
  end if;
  if v_call.status <> 'ringing' then raise exception 'call is not ringing'; end if;

  update public.calls as c
     set status = 'cancelled',
         ended_at = coalesce(c.ended_at, now()),
         end_reason = 'caller_cancelled'
   where c.id = v_call.id
   returning c.* into v_call;

  return query select v_call.id, v_call.status;
end;
$$;

create or replace function public.end_call(p_call_id uuid, p_reason text default 'user_ended')
returns table (call_id uuid, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'user_ended');
  v_call public.calls%rowtype;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if v_reason not in ('user_rejected', 'caller_cancelled', 'user_ended', 'timeout', 'disconnected', 'busy', 'answered_elsewhere', 'system_cleanup') then
    raise exception 'invalid reason';
  end if;

  select c.* into v_call from public.calls as c where c.id = p_call_id for update;
  if v_call.id is null then raise exception 'call not found'; end if;
  if v_user_id <> v_call.caller_id and v_user_id <> v_call.callee_id then
    raise exception 'not call participant';
  end if;

  if v_call.status in ('rejected', 'missed', 'ended', 'cancelled', 'expired') then
    return query select v_call.id, v_call.status;
    return;
  end if;
  if v_call.status <> 'accepted' then
    raise exception 'call is not active';
  end if;

  update public.calls as c
     set status = 'ended',
         ended_at = coalesce(c.ended_at, now()),
         end_reason = v_reason
   where c.id = v_call.id
   returning c.* into v_call;

  return query select v_call.id, v_call.status;
end;
$$;

grant execute on function public.register_call_device(text, text, text, text, text, text, text) to authenticated;
grant execute on function public.deactivate_call_device(text) to authenticated;
grant execute on function public.start_call(uuid, text, text, uuid) to authenticated;
grant execute on function public.accept_call(uuid, uuid) to authenticated;
grant execute on function public.reject_call(uuid, text) to authenticated;
grant execute on function public.cancel_call(uuid) to authenticated;
grant execute on function public.end_call(uuid, text) to authenticated;
revoke execute on function public.expire_stale_calls() from public, anon, authenticated;
grant execute on function public.expire_stale_calls() to service_role;

do $$
begin
  if not exists (
    select 1
      from pg_publication as p
      join pg_publication_rel as pr on pr.prpubid = p.oid
      where p.pubname = 'supabase_realtime'
        and pr.prrelid = 'public.calls'::regclass
  ) then
    alter publication supabase_realtime add table public.calls;
  end if;
end;
$$;

commit;
