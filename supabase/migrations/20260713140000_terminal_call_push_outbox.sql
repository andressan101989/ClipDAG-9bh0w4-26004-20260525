begin;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

alter table public.call_devices
  add column if not exists terminal_voip_version smallint not null default 0;

alter table public.call_devices
  drop constraint if exists call_devices_terminal_voip_version_check;

alter table public.call_devices
  add constraint call_devices_terminal_voip_version_check
  check (terminal_voip_version >= 0);

alter table public.call_push_deliveries
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists event_status text,
  add column if not exists event_reason text,
  add column if not exists event_timestamp timestamptz,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists last_attempt_at timestamptz;

alter table public.call_push_deliveries
  drop constraint if exists call_push_deliveries_event_type_check;

alter table public.call_push_deliveries
  add constraint call_push_deliveries_event_type_check
  check (event_type in (
    'incoming_call',
    'call_cancelled',
    'call_expired',
    'call_rejected',
    'call_ended',
    'call_answered_elsewhere'
  ));

create index if not exists call_push_deliveries_dispatch_idx
  on public.call_push_deliveries (
    provider,
    status,
    next_attempt_at,
    last_attempt_at,
    created_at
  )
  where status in ('pending', 'failed', 'processing');

-- Replace the seven-argument function instead of creating an overlapping
-- overload. Existing named calls remain valid because the new final argument
-- defaults to zero. No current client opts into terminal VoIP delivery.
drop function if exists public.register_call_device(text, text, text, text, text, text, text);

create function public.register_call_device(
  p_installation_id text,
  p_platform text,
  p_expo_push_token text default null,
  p_native_push_token text default null,
  p_voip_push_token text default null,
  p_app_version text default null,
  p_device_model text default null,
  p_terminal_voip_version smallint default 0
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
  v_terminal_voip_version smallint := coalesce(p_terminal_voip_version, 0);
  v_device_id uuid;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if v_installation_id is null then raise exception 'installation_id is required'; end if;
  if v_platform not in ('ios', 'android') then raise exception 'invalid platform'; end if;
  if v_terminal_voip_version < 0 then raise exception 'invalid terminal_voip_version'; end if;

  perform pg_advisory_xact_lock(hashtextextended('call-device-installation:' || v_installation_id, 0));
  if v_expo_push_token is not null then
    perform pg_advisory_xact_lock(hashtextextended('call-device-expo:' || v_expo_push_token, 0));
  end if;
  if v_native_push_token is not null then
    perform pg_advisory_xact_lock(hashtextextended('call-device-native:' || v_native_push_token, 0));
  end if;
  if v_voip_push_token is not null then
    perform pg_advisory_xact_lock(hashtextextended('call-device-voip:' || v_voip_push_token, 0));
  end if;

  select cd.id into v_device_id
    from public.call_devices as cd
   where cd.user_id = v_user_id
     and cd.installation_id = v_installation_id
   for update;

  if v_device_id is null then
    insert into public.call_devices (
      user_id, installation_id, platform, app_version, device_model,
      terminal_voip_version, active, last_seen_at, updated_at
    ) values (
      v_user_id, v_installation_id, v_platform, v_app_version, v_device_model,
      v_terminal_voip_version, true, now(), now()
    ) returning id into v_device_id;
  end if;

  if v_expo_push_token is not null then
    update public.call_devices as cd
       set expo_push_token = null,
           active = case when cd.native_push_token is null and cd.voip_push_token is null then false else cd.active end,
           updated_at = now()
     where cd.id <> v_device_id and cd.expo_push_token = v_expo_push_token;
  end if;
  if v_native_push_token is not null then
    update public.call_devices as cd
       set native_push_token = null,
           active = case when cd.expo_push_token is null and cd.voip_push_token is null then false else cd.active end,
           updated_at = now()
     where cd.id <> v_device_id and cd.native_push_token = v_native_push_token;
  end if;
  if v_voip_push_token is not null then
    update public.call_devices as cd
       set voip_push_token = null,
           active = case when cd.expo_push_token is null and cd.native_push_token is null then false else cd.active end,
           terminal_voip_version = 0,
           updated_at = now()
     where cd.id <> v_device_id and cd.voip_push_token = v_voip_push_token;
  end if;

  update public.call_devices as cd
     set platform = v_platform,
         expo_push_token = coalesce(v_expo_push_token, cd.expo_push_token),
         native_push_token = coalesce(v_native_push_token, cd.native_push_token),
         voip_push_token = coalesce(v_voip_push_token, cd.voip_push_token),
         app_version = coalesce(v_app_version, cd.app_version),
         device_model = coalesce(v_device_model, cd.device_model),
         terminal_voip_version = v_terminal_voip_version,
         active = true,
         last_seen_at = now(),
         updated_at = now()
   where cd.id = v_device_id;

  return query select v_device_id;
end;
$$;

revoke all on function public.register_call_device(text, text, text, text, text, text, text, smallint)
from public, anon, authenticated;
grant execute on function public.register_call_device(text, text, text, text, text, text, text, smallint)
to authenticated;

create or replace function public.enqueue_call_terminal_deliveries(
  p_call_id uuid,
  p_event_type text,
  p_status text,
  p_reason text,
  p_excluded_device_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_call public.calls%rowtype;
  v_event_type text := lower(nullif(trim(p_event_type), ''));
  v_status text := lower(nullif(trim(p_status), ''));
  v_reason text := lower(nullif(trim(p_reason), ''));
  v_timestamp timestamptz := clock_timestamp();
  v_inserted integer := 0;
begin
  if v_event_type not in (
    'call_cancelled', 'call_expired', 'call_rejected',
    'call_ended', 'call_answered_elsewhere'
  ) then
    raise exception 'invalid terminal event_type';
  end if;
  if v_status is null then raise exception 'event status is required'; end if;
  if v_reason is null then raise exception 'event reason is required'; end if;

  select c.* into v_call from public.calls as c where c.id = p_call_id;
  if v_call.id is null then raise exception 'call not found'; end if;

  insert into public.call_push_deliveries (
    call_id, device_id, event_type, provider, status, attempt_count,
    payload, event_status, event_reason, event_timestamp, next_attempt_at
  )
  select
    v_call.id,
    cd.id,
    v_event_type,
    'apns_voip',
    'pending',
    0,
    jsonb_build_object(
      'type', v_event_type,
      'call_id', v_call.id::text,
      'status', v_status,
      'reason', v_reason,
      'timestamp', to_char(v_timestamp at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    v_status,
    v_reason,
    v_timestamp,
    v_timestamp
  from public.call_devices as cd
  where cd.user_id = v_call.callee_id
    and cd.platform = 'ios'
    and cd.active = true
    and cd.voip_push_token is not null
    and length(trim(cd.voip_push_token)) > 0
    and cd.terminal_voip_version >= 1
    and (p_excluded_device_id is null or cd.id <> p_excluded_device_id)
  on conflict (call_id, device_id, event_type, provider) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.enqueue_call_terminal_deliveries(uuid, text, text, text, uuid)
from public, anon, authenticated;
grant execute on function public.enqueue_call_terminal_deliveries(uuid, text, text, text, uuid)
to service_role;

create or replace function public.claim_pending_call_push_deliveries(
  p_provider text,
  p_limit integer default 25
)
returns table (
  delivery_id uuid,
  call_id uuid,
  device_id uuid,
  event_type text,
  payload jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  if p_provider <> 'apns_voip' then raise exception 'invalid provider'; end if;

  return query
  with candidates as (
    select cpd.id
      from public.call_push_deliveries as cpd
     where cpd.provider = p_provider
       and cpd.event_type in (
         'call_cancelled', 'call_expired', 'call_rejected',
         'call_ended', 'call_answered_elsewhere'
       )
       and cpd.attempt_count < 3
       and (
         (cpd.status in ('pending', 'failed') and coalesce(cpd.next_attempt_at, cpd.created_at) <= now())
         or (cpd.status = 'processing' and coalesce(cpd.last_attempt_at, cpd.attempted_at, cpd.created_at) < now() - interval '60 seconds')
       )
     order by coalesce(cpd.next_attempt_at, cpd.created_at), cpd.created_at
     for update skip locked
     limit v_limit
  ), claimed as (
    update public.call_push_deliveries as cpd
       set status = 'processing',
           attempt_count = cpd.attempt_count + 1,
           attempted_at = now(),
           last_attempt_at = now(),
           error_code = null,
           error_message = null
      from candidates
     where cpd.id = candidates.id
     returning cpd.id, cpd.call_id, cpd.device_id, cpd.event_type, cpd.payload
  )
  select claimed.id, claimed.call_id, claimed.device_id, claimed.event_type, claimed.payload
    from claimed;
end;
$$;

revoke all on function public.claim_pending_call_push_deliveries(text, integer)
from public, anon, authenticated;
grant execute on function public.claim_pending_call_push_deliveries(text, integer)
to service_role;

create or replace function public.expire_stale_calls()
returns table (closed_count integer, closed_ids uuid[])
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_call record;
  v_ids uuid[] := '{}';
begin
  for v_call in
    update public.calls as c
       set status = 'expired', end_reason = coalesce(c.end_reason, 'timeout'), ended_at = coalesce(c.ended_at, now())
     where c.status = 'ringing'
       and ((c.expires_at is not null and c.expires_at < now()) or (c.expires_at is null and c.created_at < now() - interval '45 seconds'))
     returning c.id, c.status, c.end_reason
  loop
    v_ids := array_append(v_ids, v_call.id);
    perform public.enqueue_call_terminal_deliveries(v_call.id, 'call_expired', 'expired', coalesce(v_call.end_reason, 'timeout'));
  end loop;

  for v_call in
    update public.calls as c
       set status = 'ended', end_reason = coalesce(c.end_reason, 'system_cleanup'), ended_at = coalesce(c.ended_at, now())
     where c.status = 'accepted'
       and (c.updated_at < now() - interval '12 hours' or c.created_at < now() - interval '12 hours')
     returning c.id, c.status, c.end_reason
  loop
    v_ids := array_append(v_ids, v_call.id);
    perform public.enqueue_call_terminal_deliveries(v_call.id, 'call_ended', 'ended', coalesce(v_call.end_reason, 'system_cleanup'));
  end loop;

  return query select coalesce(array_length(v_ids, 1), 0), v_ids;
end;
$$;

create or replace function public.accept_call(p_call_id uuid, p_callee_device_id uuid default null)
returns table (call_id uuid, channel_name text, call_type text, status text)
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
  if v_call.callee_id <> v_user_id then raise exception 'not call callee'; end if;
  if p_callee_device_id is not null and not exists (
    select 1 from public.call_devices cd where cd.id = p_callee_device_id and cd.user_id = v_user_id and cd.active = true
  ) then raise exception 'callee device not found'; end if;

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
    update public.calls c set status = 'expired', end_reason = 'timeout', ended_at = coalesce(c.ended_at, now())
     where c.id = v_call.id returning c.* into v_call;
    perform public.enqueue_call_terminal_deliveries(v_call.id, 'call_expired', 'expired', 'timeout');
    return query select v_call.id, v_call.channel_name, v_call.call_type, v_call.status;
    return;
  end if;

  update public.calls c
     set status = 'accepted', accepted_at = now(), callee_device_id = coalesce(p_callee_device_id, c.callee_device_id)
   where c.id = v_call.id returning c.* into v_call;
  perform public.enqueue_call_terminal_deliveries(
    v_call.id, 'call_answered_elsewhere', 'accepted', 'answered_elsewhere', v_call.callee_device_id
  );
  return query select v_call.id, v_call.channel_name, v_call.call_type, v_call.status;
end;
$$;

create or replace function public.reject_call(p_call_id uuid, p_reason text default 'user_rejected')
returns table (call_id uuid, status text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'user_rejected');
  v_call public.calls%rowtype;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if v_reason not in ('user_rejected','caller_cancelled','user_ended','timeout','disconnected','busy','answered_elsewhere','system_cleanup') then raise exception 'invalid reason'; end if;
  select c.* into v_call from public.calls c where c.id = p_call_id for update;
  if v_call.id is null then raise exception 'call not found'; end if;
  if v_call.callee_id <> v_user_id then raise exception 'not call callee'; end if;
  if v_call.status in ('rejected','missed','ended','cancelled','expired') then return query select v_call.id, v_call.status; return; end if;
  if v_call.status <> 'ringing' then raise exception 'call is not ringing'; end if;
  update public.calls c set status = 'rejected', rejected_at = coalesce(c.rejected_at, now()), ended_at = coalesce(c.ended_at, now()), end_reason = v_reason
   where c.id = v_call.id returning c.* into v_call;
  perform public.enqueue_call_terminal_deliveries(v_call.id, 'call_rejected', 'rejected', v_reason);
  return query select v_call.id, v_call.status;
end;
$$;

create or replace function public.cancel_call(p_call_id uuid)
returns table (call_id uuid, status text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user_id uuid := auth.uid(); v_call public.calls%rowtype;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  select c.* into v_call from public.calls c where c.id = p_call_id for update;
  if v_call.id is null then raise exception 'call not found'; end if;
  if v_call.caller_id <> v_user_id then raise exception 'not call caller'; end if;
  if v_call.status in ('rejected','missed','ended','cancelled','expired') then return query select v_call.id, v_call.status; return; end if;
  if v_call.status <> 'ringing' then raise exception 'call is not ringing'; end if;
  update public.calls c set status = 'cancelled', ended_at = coalesce(c.ended_at, now()), end_reason = 'caller_cancelled'
   where c.id = v_call.id returning c.* into v_call;
  perform public.enqueue_call_terminal_deliveries(v_call.id, 'call_cancelled', 'cancelled', 'caller_cancelled');
  return query select v_call.id, v_call.status;
end;
$$;

create or replace function public.end_call(p_call_id uuid, p_reason text default 'user_ended')
returns table (call_id uuid, status text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'user_ended');
  v_call public.calls%rowtype;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if v_reason not in ('user_rejected','caller_cancelled','user_ended','timeout','disconnected','busy','answered_elsewhere','system_cleanup') then raise exception 'invalid reason'; end if;
  select c.* into v_call from public.calls c where c.id = p_call_id for update;
  if v_call.id is null then raise exception 'call not found'; end if;
  if v_user_id <> v_call.caller_id and v_user_id <> v_call.callee_id then raise exception 'not call participant'; end if;
  if v_call.status in ('rejected','missed','ended','cancelled','expired') then return query select v_call.id, v_call.status; return; end if;
  if v_call.status <> 'accepted' then raise exception 'call is not active'; end if;
  update public.calls c set status = 'ended', ended_at = coalesce(c.ended_at, now()), end_reason = v_reason
   where c.id = v_call.id returning c.* into v_call;
  perform public.enqueue_call_terminal_deliveries(v_call.id, 'call_ended', 'ended', v_reason);
  return query select v_call.id, v_call.status;
end;
$$;

create or replace function public.timeout_call(p_call_id uuid)
returns table (call_id uuid, status text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user_id uuid := auth.uid(); v_call public.calls%rowtype;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  select c.* into v_call from public.calls c where c.id = p_call_id for update;
  if v_call.id is null then raise exception 'call not found'; end if;
  if v_user_id <> v_call.caller_id and v_user_id <> v_call.callee_id then raise exception 'not call participant'; end if;
  if v_call.status in ('expired','missed','ended','cancelled','rejected') then return query select v_call.id, v_call.status; return; end if;
  if v_call.status <> 'ringing' then raise exception 'call is not ringing'; end if;
  if v_call.expires_at is not null and now() < v_call.expires_at then raise exception 'call has not expired'; end if;
  update public.calls c set status = 'expired', end_reason = 'timeout', ended_at = coalesce(c.ended_at, now())
   where c.id = v_call.id returning c.* into v_call;
  perform public.enqueue_call_terminal_deliveries(v_call.id, 'call_expired', 'expired', 'timeout');
  return query select v_call.id, v_call.status;
end;
$$;

-- Reads only named Vault entries. No secret value is stored in this migration.
create or replace function public.wake_call_push_dispatcher()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_project_url text;
  v_publishable_key text;
  v_dispatch_secret text;
  v_request_id bigint;
begin
  select ds.decrypted_secret into v_project_url
    from vault.decrypted_secrets ds where ds.name = 'call_dispatch_project_url' limit 1;
  select ds.decrypted_secret into v_publishable_key
    from vault.decrypted_secrets ds where ds.name = 'call_dispatch_publishable_key' limit 1;
  select ds.decrypted_secret into v_dispatch_secret
    from vault.decrypted_secrets ds where ds.name = 'call_dispatch_secret' limit 1;
  if nullif(trim(v_project_url), '') is null
     or nullif(trim(v_publishable_key), '') is null
     or nullif(v_dispatch_secret, '') is null then
    return null;
  end if;
  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/dispatch-call-push-deliveries',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_publishable_key,
      'Authorization', 'Bearer ' || v_publishable_key,
      'x-call-dispatch-secret', v_dispatch_secret
    ),
    body := '{"source":"call_push_deliveries"}'::jsonb,
    timeout_milliseconds := 10000
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function public.wake_call_push_dispatcher() from public, anon, authenticated;
grant execute on function public.wake_call_push_dispatcher() to service_role;

create or replace function public.call_push_deliveries_wake_dispatcher()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if current_setting('onspace.call_dispatch_woken', true) = '1' then
    return new;
  end if;
  perform set_config('onspace.call_dispatch_woken', '1', true);
  perform public.wake_call_push_dispatcher();
  return new;
end;
$$;

drop trigger if exists call_push_deliveries_terminal_dispatch on public.call_push_deliveries;
create trigger call_push_deliveries_terminal_dispatch
after insert on public.call_push_deliveries
for each row
when (
  new.provider = 'apns_voip'
  and new.status = 'pending'
  and new.event_type in ('call_cancelled','call_expired','call_rejected','call_ended','call_answered_elsewhere')
)
execute function public.call_push_deliveries_wake_dispatcher();

-- PUSH1 installs both one-minute backup jobs inactive. A later activation
-- phase enables them only after the native receiver and operational secrets
-- are ready. Applying this migration starts no recurring work.
do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'call-push-dispatch-retry';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  select cron.schedule(
    'call-push-dispatch-retry',
    '* * * * *',
    'select public.wake_call_push_dispatcher()'
  ) into v_job_id;
  perform cron.alter_job(v_job_id, active := false);

  select jobid into v_job_id from cron.job where jobname = 'expire-stale-calls';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  select cron.schedule(
    'expire-stale-calls',
    '* * * * *',
    'select public.expire_stale_calls()'
  ) into v_job_id;
  perform cron.alter_job(v_job_id, active := false);
end;
$$;

commit;
