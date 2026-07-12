begin;

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
  v_expo_push_token text := nullif(trim(p_expo_push_token), '');
  v_native_push_token text := nullif(trim(p_native_push_token), '');
  v_voip_push_token text := nullif(trim(p_voip_push_token), '');
  v_app_version text := nullif(trim(p_app_version), '');
  v_device_model text := nullif(trim(p_device_model), '');
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

  if v_expo_push_token is not null and exists (
    select 1 from public.call_devices as cd
     where cd.expo_push_token = v_expo_push_token
       and cd.user_id <> v_user_id
  ) then
    raise exception 'expo push token belongs to another user';
  end if;

  if v_native_push_token is not null and exists (
    select 1 from public.call_devices as cd
     where cd.native_push_token = v_native_push_token
       and cd.user_id <> v_user_id
  ) then
    raise exception 'native push token belongs to another user';
  end if;

  if v_voip_push_token is not null and exists (
    select 1 from public.call_devices as cd
     where cd.voip_push_token = v_voip_push_token
       and cd.user_id <> v_user_id
  ) then
    raise exception 'voip push token belongs to another user';
  end if;

  insert into public.call_devices (
    user_id, installation_id, platform, expo_push_token, native_push_token,
    voip_push_token, app_version, device_model, active, last_seen_at
  ) values (
    v_user_id, v_installation_id, v_platform, v_expo_push_token, v_native_push_token,
    v_voip_push_token, v_app_version, v_device_model, true, now()
  )
  on conflict (user_id, installation_id) do update
    set platform = excluded.platform,
        expo_push_token = coalesce(excluded.expo_push_token, call_devices.expo_push_token),
        native_push_token = coalesce(excluded.native_push_token, call_devices.native_push_token),
        voip_push_token = coalesce(excluded.voip_push_token, call_devices.voip_push_token),
        app_version = coalesce(excluded.app_version, call_devices.app_version),
        device_model = coalesce(excluded.device_model, call_devices.device_model),
        active = true,
        last_seen_at = now()
  returning id into v_device_id;

  return query select v_device_id;
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
  v_busy public.calls%rowtype;
  v_new_id uuid;
  v_lock_a bigint;
  v_lock_b bigint;
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

  v_lock_a := hashtextextended(least(v_caller_id::text, p_callee_id::text), 0);
  v_lock_b := hashtextextended(greatest(v_caller_id::text, p_callee_id::text), 0);
  perform pg_advisory_xact_lock(v_lock_a);
  if v_lock_b <> v_lock_a then
    perform pg_advisory_xact_lock(v_lock_b);
  end if;

  perform public.expire_stale_calls();

  select c.*
    into v_existing
    from public.calls as c
   where c.caller_id = v_caller_id
     and c.idempotency_key = v_key
   for update;

  if v_existing.id is not null then
    if v_existing.callee_id <> p_callee_id or v_existing.call_type <> v_call_type then
      raise exception 'idempotency key reused with different call parameters';
    end if;

    return query
      select c.id, c.caller_id, c.callee_id, c.channel_name, c.call_type, c.status, c.expires_at
        from public.calls as c
       where c.id = v_existing.id;
    return;
  end if;

  select c.*
    into v_busy
    from public.calls as c
   where c.status in ('ringing', 'accepted')
     and (c.caller_id = v_caller_id or c.callee_id = v_caller_id)
   order by c.created_at desc
   limit 1
   for update;

  if v_busy.id is not null then
    raise exception 'caller already in active call';
  end if;

  select c.*
    into v_busy
    from public.calls as c
   where c.status in ('ringing', 'accepted')
     and (c.caller_id = p_callee_id or c.callee_id = p_callee_id)
   order by c.created_at desc
   limit 1
   for update;

  if v_busy.id is not null then
    raise exception 'callee is busy';
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
    if v_call.callee_device_id is not null
       and p_callee_device_id is not null
       and v_call.callee_device_id <> p_callee_device_id then
      raise exception 'call already answered on another device';
    end if;
    if v_call.callee_device_id is not null and p_callee_device_id is null then
      raise exception 'call already answered on another device';
    end if;
    return query select v_call.id, v_call.channel_name, v_call.call_type, v_call.status;
    return;
  end if;

  if v_call.status <> 'ringing' then
    return query select v_call.id, v_call.channel_name, v_call.call_type, v_call.status;
    return;
  end if;

  if v_call.expires_at is not null and v_call.expires_at < now() then
    update public.calls as c
       set status = 'expired',
           end_reason = 'timeout',
           ended_at = coalesce(c.ended_at, now())
     where c.id = v_call.id
     returning c.* into v_call;

    return query select v_call.id, v_call.channel_name, v_call.call_type, v_call.status;
    return;
  end if;

  update public.calls as c
     set status = 'accepted',
         accepted_at = now(),
         callee_device_id = coalesce(p_callee_device_id, c.callee_device_id)
   where c.id = v_call.id
   returning c.* into v_call;

  return query select v_call.id, v_call.channel_name, v_call.call_type, v_call.status;
end;
$$;

create or replace function public.timeout_call(p_call_id uuid)
returns table (call_id uuid, status text)
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
  if v_user_id <> v_call.caller_id and v_user_id <> v_call.callee_id then
    raise exception 'not call participant';
  end if;

  if v_call.status in ('expired', 'missed', 'ended', 'cancelled', 'rejected') then
    return query select v_call.id, v_call.status;
    return;
  end if;
  if v_call.status <> 'ringing' then
    raise exception 'call is not ringing';
  end if;
  if v_call.expires_at is not null and now() < v_call.expires_at then
    raise exception 'call has not expired';
  end if;

  update public.calls as c
     set status = 'expired',
         end_reason = 'timeout',
         ended_at = coalesce(c.ended_at, now())
   where c.id = v_call.id
   returning c.* into v_call;

  return query select v_call.id, v_call.status;
end;
$$;

grant execute on function public.register_call_device(text, text, text, text, text, text, text) to authenticated;
grant execute on function public.start_call(uuid, text, text, uuid) to authenticated;
grant execute on function public.accept_call(uuid, uuid) to authenticated;
grant execute on function public.timeout_call(uuid) to authenticated;

commit;
