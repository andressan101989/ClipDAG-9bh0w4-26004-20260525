begin;

-- D4D-D installs foreground presentation arbitration inertly. Existing rows
-- remain legacy presentation_version=0 and the feature flag remains disabled.
alter table public.call_push_deliveries
  add column if not exists presentation_version smallint not null default 0,
  add column if not exists presentation_owner text,
  add column if not exists claim_deadline_at timestamptz,
  add column if not exists presentation_claimed_at timestamptz,
  add column if not exists dispatch_claimed_at timestamptz,
  add column if not exists presentation_closed_at timestamptz,
  add column if not exists presentation_close_reason text,
  add column if not exists send_started_at timestamptz,
  add column if not exists dispatch_lease_id uuid,
  add column if not exists dispatch_lease_scope text;

alter table public.call_devices
  add column if not exists foreground_presentation_version smallint not null default 0;

alter table public.call_devices
  add constraint call_devices_foreground_presentation_version_check
  check (foreground_presentation_version between 0 and 1);

alter table public.call_push_deliveries
  add constraint call_push_deliveries_presentation_version_check
    check (presentation_version >= 0),
  add constraint call_push_deliveries_presentation_owner_check
    check (presentation_owner is null or presentation_owner in ('onspace', 'callkit')),
  add constraint call_push_deliveries_dispatch_lease_scope_check
    check (dispatch_lease_scope is null or dispatch_lease_scope in ('call', 'watchdog')),
  add constraint call_push_deliveries_presentation_close_reason_check
    check (
      presentation_close_reason is null
      or presentation_close_reason in ('terminal', 'timeout', 'rollback', 'superseded')
    ),
  add constraint call_push_deliveries_presentation_close_pair_check
    check (
      (presentation_closed_at is null and presentation_close_reason is null)
      or (presentation_closed_at is not null and presentation_close_reason is not null)
    ),
  add constraint call_push_deliveries_presentation_scope_check
    check (
      (
        presentation_version = 0
        and presentation_owner is null
        and claim_deadline_at is null
        and presentation_claimed_at is null
        and dispatch_claimed_at is null
        and presentation_closed_at is null
        and presentation_close_reason is null
        and send_started_at is null
        and dispatch_lease_id is null
        and dispatch_lease_scope is null
      )
      or (
        presentation_version >= 1
        and event_type = 'incoming_call'
        and provider = 'apns_voip'
      )
    ),
  add constraint call_push_deliveries_authoritative_incoming_state_check
    check (
      not (
        presentation_version >= 1
        and event_type = 'incoming_call'
        and provider = 'apns_voip'
      )
      or (
        claim_deadline_at is not null
        and (
          (
            presentation_owner is null
            and status = 'pending'
            and presentation_closed_at is null
            and send_started_at is null
            and presentation_claimed_at is null
            and dispatch_claimed_at is null
            and dispatch_lease_id is null
            and dispatch_lease_scope is null
          )
          or (
            presentation_owner = 'onspace'
            and status = 'skipped'
            and presentation_claimed_at is not null
            and dispatch_claimed_at is null
            and send_started_at is null
            and dispatch_lease_id is null
            and dispatch_lease_scope is null
          )
          or (
            presentation_owner = 'callkit'
            and status = 'processing'
            and dispatch_claimed_at is not null
            and presentation_claimed_at is null
            and (presentation_closed_at is null or send_started_at is not null)
            and dispatch_lease_id is not null
            and dispatch_lease_scope in ('call', 'watchdog')
          )
          or (
            presentation_owner = 'callkit'
            and status in ('sent', 'failed')
            and dispatch_claimed_at is not null
            and presentation_claimed_at is null
            and send_started_at is not null
            and dispatch_lease_id is not null
            and dispatch_lease_scope in ('call', 'watchdog')
          )
          or (
            presentation_owner is null
            and status = 'skipped'
            and presentation_closed_at is not null
            and send_started_at is null
            and presentation_claimed_at is null
            and dispatch_claimed_at is null
            and dispatch_lease_id is null
            and dispatch_lease_scope is null
          )
          or (
            presentation_owner = 'callkit'
            and status = 'skipped'
            and presentation_closed_at is not null
            and dispatch_claimed_at is not null
            and presentation_claimed_at is null
            and send_started_at is null
            and dispatch_lease_id is not null
            and dispatch_lease_scope in ('call', 'watchdog')
          )
        )
      )
    );

create index if not exists call_push_deliveries_incoming_claim_idx
  on public.call_push_deliveries (call_id, claim_deadline_at, status)
  where event_type = 'incoming_call'
    and provider = 'apns_voip'
    and presentation_version >= 1
    and presentation_owner is null
    and status = 'pending'
    and presentation_closed_at is null;

create index if not exists call_push_deliveries_incoming_retry_idx
  on public.call_push_deliveries (next_attempt_at, last_attempt_at, created_at)
  where event_type = 'incoming_call'
    and provider = 'apns_voip'
    and presentation_version >= 1
    and presentation_owner = 'callkit'
    and status in ('failed', 'processing');

create index if not exists call_push_deliveries_incoming_sender_barrier_idx
  on public.call_push_deliveries (call_id, device_id, presentation_version)
  where event_type = 'incoming_call'
    and provider = 'apns_voip'
    and presentation_version >= 1;

create table public.call_presentation_config (
  id boolean primary key default true check (id = true),
  foreground_presentation_enabled boolean not null default false,
  foreground_claim_grace_ms integer not null default 1500
    check (foreground_claim_grace_ms between 250 and 2000),
  incoming_max_attempts integer not null default 3
    check (incoming_max_attempts between 1 and 5),
  primary_lease_ms integer not null default 10000
    check (primary_lease_ms between 1000 and 60000),
  watchdog_lease_ms integer not null default 15000
    check (watchdog_lease_ms between 1000 and 60000),
  updated_at timestamptz not null default now()
);

insert into public.call_presentation_config (id, foreground_presentation_enabled)
values (true, false);

alter table public.call_presentation_config enable row level security;
revoke all on table public.call_presentation_config from public, anon, authenticated;

create table public.incoming_call_dispatch_leases (
  call_id uuid primary key references public.calls(id) on delete cascade,
  lease_id uuid not null,
  lease_until timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.incoming_call_dispatch_leases enable row level security;
revoke all on table public.incoming_call_dispatch_leases from public, anon, authenticated;

create table public.incoming_call_watchdog_lease (
  id boolean primary key default true check (id = true),
  lease_id uuid not null,
  lease_until timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.incoming_call_watchdog_lease enable row level security;
revoke all on table public.incoming_call_watchdog_lease from public, anon, authenticated;

create or replace function public.set_call_device_foreground_presentation_version(
  p_device_id uuid,
  p_version smallint
)
returns table (success boolean, effective_version smallint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_version smallint;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if p_version is null or p_version not between 0 and 1 then
    raise exception 'invalid foreground presentation version';
  end if;

  update public.call_devices as cd
     set foreground_presentation_version = p_version,
         updated_at = now()
   where cd.id = p_device_id
     and cd.user_id = v_user_id
     and cd.active = true
     and cd.platform = 'ios'
  returning cd.foreground_presentation_version into v_version;

  if v_version is null then
    return query select false, null::smallint;
    return;
  end if;
  return query select true, v_version;
end;
$$;

revoke all on function public.set_call_device_foreground_presentation_version(uuid, smallint)
from public, anon, authenticated;
grant execute on function public.set_call_device_foreground_presentation_version(uuid, smallint)
to authenticated;

create or replace function public.acquire_incoming_call_dispatch_lease(
  p_call_id uuid,
  p_lease_ms integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_lease_id uuid := gen_random_uuid(); v_acquired uuid;
begin
  if p_call_id is null or p_lease_ms is null or p_lease_ms not between 250 and 60000 then return null; end if;
  insert into public.incoming_call_dispatch_leases as l (
    call_id, lease_id, lease_until, updated_at
  ) values (
    p_call_id, v_lease_id, clock_timestamp() + make_interval(secs => p_lease_ms / 1000.0), clock_timestamp()
  )
  on conflict (call_id) do update
     set lease_id = excluded.lease_id,
         lease_until = excluded.lease_until,
         updated_at = excluded.updated_at
   where l.lease_until <= clock_timestamp()
  returning lease_id into v_acquired;
  return v_acquired;
end;
$$;

-- The dispatcher must renew its unchanged lease_id before a safe fraction of
-- lease_until elapses; renewal never replaces or steals another lease.
create or replace function public.renew_incoming_call_dispatch_lease(
  p_call_id uuid,
  p_lease_id uuid,
  p_lease_ms integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_call_id is null or p_lease_id is null or p_lease_ms is null
     or p_lease_ms not between 250 and 60000 then return false; end if;
  update public.incoming_call_dispatch_leases l
     set lease_until = clock_timestamp() + make_interval(secs => p_lease_ms / 1000.0),
         updated_at = clock_timestamp()
   where l.call_id = p_call_id
     and l.lease_id = p_lease_id
     and l.lease_until > clock_timestamp();
  return found;
end;
$$;

create or replace function public.validate_incoming_call_dispatch_lease(
  p_call_id uuid,
  p_lease_id uuid
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.incoming_call_dispatch_leases l
     where l.call_id = p_call_id
       and l.lease_id = p_lease_id
       and l.lease_until > clock_timestamp()
  );
$$;

create or replace function public.release_incoming_call_dispatch_lease(
  p_call_id uuid,
  p_lease_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.incoming_call_dispatch_leases l
   where l.call_id = p_call_id and l.lease_id = p_lease_id;
  return found;
end;
$$;

create or replace function public.acquire_incoming_watchdog_lease(p_lease_ms integer)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_lease_id uuid := gen_random_uuid(); v_acquired uuid;
begin
  if p_lease_ms is null or p_lease_ms not between 250 and 60000 then return null; end if;
  insert into public.incoming_call_watchdog_lease as l (
    id, lease_id, lease_until, updated_at
  ) values (
    true, v_lease_id, clock_timestamp() + make_interval(secs => p_lease_ms / 1000.0), clock_timestamp()
  )
  on conflict (id) do update
     set lease_id = excluded.lease_id,
         lease_until = excluded.lease_until,
         updated_at = excluded.updated_at
   where l.lease_until <= clock_timestamp()
  returning lease_id into v_acquired;
  return v_acquired;
end;
$$;

-- The global watchdog dispatcher follows the same bounded renewal contract.
create or replace function public.renew_incoming_watchdog_lease(
  p_lease_id uuid,
  p_lease_ms integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_lease_id is null or p_lease_ms is null
     or p_lease_ms not between 250 and 60000 then return false; end if;
  update public.incoming_call_watchdog_lease l
     set lease_until = clock_timestamp() + make_interval(secs => p_lease_ms / 1000.0),
         updated_at = clock_timestamp()
   where l.id = true
     and l.lease_id = p_lease_id
     and l.lease_until > clock_timestamp();
  return found;
end;
$$;

create or replace function public.validate_incoming_watchdog_lease(p_lease_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.incoming_call_watchdog_lease l
     where l.id = true
       and l.lease_id = p_lease_id
       and l.lease_until > clock_timestamp()
  );
$$;

create or replace function public.release_incoming_watchdog_lease(p_lease_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.incoming_call_watchdog_lease l
   where l.id = true and l.lease_id = p_lease_id;
  return found;
end;
$$;

-- Canonical lease-activity predicate used by claim and watchdog work tests.
-- A processing attempt is recoverable only after both its age threshold and
-- its recorded lease have expired (or the recorded lease no longer exists).
create or replace function public.incoming_delivery_dispatch_lease_is_active(
  p_call_id uuid,
  p_lease_id uuid,
  p_lease_scope text
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select case p_lease_scope
    when 'call' then exists (
      select 1
        from public.incoming_call_dispatch_leases l
       where l.call_id = p_call_id
         and l.lease_id = p_lease_id
         and l.lease_until > clock_timestamp()
    )
    when 'watchdog' then exists (
      select 1
        from public.incoming_call_watchdog_lease l
       where l.id = true
         and l.lease_id = p_lease_id
         and l.lease_until > clock_timestamp()
    )
    else false
  end;
$$;

create or replace function public.incoming_dispatch_lease_is_valid(
  p_call_id uuid,
  p_lease_id uuid
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.validate_incoming_call_dispatch_lease(p_call_id, p_lease_id)
      or public.validate_incoming_watchdog_lease(p_lease_id);
$$;

create or replace function public.wake_incoming_call_dispatcher(p_call_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_project_url text;
  v_publishable_key text;
  v_dispatch_secret text;
  v_lease_ms integer;
  v_lease_id uuid;
  v_request_id bigint;
begin
  if not exists (
    select 1 from public.call_push_deliveries cpd
     where cpd.call_id = p_call_id
       and cpd.event_type = 'incoming_call'
       and cpd.provider = 'apns_voip'
       and cpd.presentation_version >= 1
       and cpd.presentation_owner is null
       and cpd.status = 'pending'
       and cpd.presentation_closed_at is null
  ) then return null; end if;

  select c.primary_lease_ms into v_lease_ms
    from public.call_presentation_config c where c.id = true;
  v_lease_id := public.acquire_incoming_call_dispatch_lease(p_call_id, v_lease_ms);
  if v_lease_id is null then return null; end if;

  select ds.decrypted_secret into v_project_url
    from vault.decrypted_secrets ds where ds.name = 'call_dispatch_project_url' limit 1;
  select ds.decrypted_secret into v_publishable_key
    from vault.decrypted_secrets ds where ds.name = 'call_dispatch_publishable_key' limit 1;
  select ds.decrypted_secret into v_dispatch_secret
    from vault.decrypted_secrets ds where ds.name = 'call_dispatch_secret' limit 1;

  if nullif(trim(v_project_url), '') is null
     or nullif(trim(v_publishable_key), '') is null
     or nullif(v_dispatch_secret, '') is null then
    perform public.release_incoming_call_dispatch_lease(p_call_id, v_lease_id);
    return null;
  end if;

  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/dispatch-incoming-call-deliveries',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_publishable_key,
      'Authorization', 'Bearer ' || v_publishable_key,
      'x-call-dispatch-secret', v_dispatch_secret
    ),
    body := jsonb_build_object(
      'source', 'start_call',
      'call_id', p_call_id,
      'lease_id', v_lease_id
    ),
    timeout_milliseconds := 10000
  ) into v_request_id;
  return v_request_id;
exception when others then
  if v_lease_id is not null then
    perform public.release_incoming_call_dispatch_lease(p_call_id, v_lease_id);
  end if;
  raise warning 'incoming call dispatcher wake failed for call suffix %', right(coalesce(p_call_id::text, ''), 8);
  return null;
end;
$$;

create or replace function public.claim_foreground_call_presentation(
  p_call_id uuid,
  p_device_id uuid
)
returns table (owner text, presentation_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_call public.calls%rowtype;
  v_delivery public.call_push_deliveries%rowtype;
  v_enabled boolean := false;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;

  select c.* into v_call from public.calls c where c.id = p_call_id for update;
  if v_call.id is null or v_call.callee_id <> v_user_id then
    return query select 'not_found'::text, 'not_found'::text; return;
  end if;
  if v_call.status <> 'ringing' or (v_call.expires_at is not null and v_call.expires_at <= clock_timestamp()) then
    return query select 'terminal'::text, v_call.status::text; return;
  end if;
  if not exists (
    select 1 from public.call_devices cd
     where cd.id = p_device_id and cd.user_id = v_user_id
       and cd.active = true and cd.platform = 'ios'
       and cd.foreground_presentation_version >= 1
  ) then
    return query select 'not_found'::text, 'not_found'::text; return;
  end if;

  select cpd.* into v_delivery
    from public.call_push_deliveries cpd
   where cpd.call_id = p_call_id and cpd.device_id = p_device_id
     and cpd.event_type = 'incoming_call' and cpd.provider = 'apns_voip'
     and cpd.presentation_version >= 1
   for update;
  if v_delivery.id is null then
    return query select 'not_found'::text, 'not_found'::text; return;
  end if;
  if v_delivery.presentation_owner = 'onspace' then
    return query select 'onspace'::text, 'claimed'::text; return;
  end if;
  if v_delivery.presentation_owner = 'callkit' then
    return query select 'callkit'::text, v_delivery.status::text; return;
  end if;
  if v_delivery.presentation_closed_at is not null then
    return query select 'terminal'::text, v_delivery.presentation_close_reason::text; return;
  end if;

  select cfg.foreground_presentation_enabled into v_enabled
    from public.call_presentation_config cfg where cfg.id = true
    for share;
  if not coalesce(v_enabled, false) then
    return query select 'callkit'::text, 'feature_disabled'::text; return;
  end if;
  if v_delivery.claim_deadline_at <= clock_timestamp() then
    return query select 'callkit'::text, 'deadline_elapsed'::text; return;
  end if;

  update public.call_push_deliveries cpd
     set presentation_owner = 'onspace',
         status = 'skipped',
         presentation_claimed_at = clock_timestamp(),
         next_attempt_at = null,
         error_code = 'FOREGROUND_ONSPACE',
         error_message = null
   where cpd.call_id = p_call_id and cpd.device_id = p_device_id
     and cpd.event_type = 'incoming_call' and cpd.provider = 'apns_voip'
     and cpd.presentation_version >= 1
     and cpd.presentation_owner is null and cpd.status = 'pending'
     and cpd.presentation_closed_at is null
     and cpd.claim_deadline_at > clock_timestamp()
  returning cpd.* into v_delivery;

  if v_delivery.id is not null then
    return query select 'onspace'::text, 'claimed'::text; return;
  end if;

  -- The locked row may only have changed through this transaction. Keep the
  -- response conservative if the conditional update did not win.
  select cpd.* into v_delivery
    from public.call_push_deliveries cpd
   where cpd.call_id = p_call_id and cpd.device_id = p_device_id
     and cpd.event_type = 'incoming_call' and cpd.provider = 'apns_voip'
     and cpd.presentation_version >= 1
   for update;
  if v_delivery.id is null then
    return query select 'not_found'::text, 'not_found'::text; return;
  end if;
  if v_delivery.presentation_owner = 'onspace' then
    return query select 'onspace'::text, 'claimed'::text; return;
  end if;
  if v_delivery.presentation_owner = 'callkit' then
    return query select 'callkit'::text, v_delivery.status::text; return;
  end if;
  if v_delivery.presentation_closed_at is not null then
    return query select 'terminal'::text, v_delivery.presentation_close_reason::text; return;
  end if;
  if v_delivery.claim_deadline_at <= clock_timestamp() then
    return query select 'callkit'::text, 'deadline_elapsed'::text; return;
  end if;
  return query select 'not_found'::text, 'not_found'::text;
end;
$$;

revoke all on function public.claim_foreground_call_presentation(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.claim_foreground_call_presentation(uuid, uuid)
to authenticated;

create or replace function public.claim_incoming_call_deliveries(
  p_lease_id uuid,
  p_call_id uuid default null,
  p_limit integer default 25
)
returns table (
  delivery_id uuid,
  call_id uuid,
  device_id uuid,
  event_type text,
  payload jsonb,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  if p_call_id is not null then
    if not public.validate_incoming_call_dispatch_lease(p_call_id, p_lease_id) then
      raise exception 'invalid incoming dispatcher lease';
    end if;
  elsif not public.validate_incoming_watchdog_lease(p_lease_id) then
    raise exception 'invalid incoming watchdog lease';
  end if;

  return query
  with config as materialized (
    select c.incoming_max_attempts, c.watchdog_lease_ms
      from public.call_presentation_config c where c.id = true
  ), candidate_call_ids as materialized (
    select cpd.call_id,
           min(coalesce(cpd.next_attempt_at, cpd.claim_deadline_at, cpd.created_at)) as due_at
      from public.call_push_deliveries cpd
      cross join config cfg
     where cpd.presentation_version >= 1
       and cpd.event_type = 'incoming_call' and cpd.provider = 'apns_voip'
       and cpd.presentation_closed_at is null
       and cpd.attempt_count < cfg.incoming_max_attempts
       and (p_call_id is null or cpd.call_id = p_call_id)
       and (
         (cpd.presentation_owner is null and cpd.status = 'pending'
           and cpd.claim_deadline_at <= clock_timestamp())
         or (cpd.presentation_owner = 'callkit' and cpd.status = 'failed'
           and cpd.next_attempt_at is not null
           and cpd.next_attempt_at <= clock_timestamp())
         or (cpd.presentation_owner = 'callkit' and cpd.status = 'processing'
           and coalesce(cpd.last_attempt_at, cpd.attempted_at, cpd.updated_at)
             < clock_timestamp() - make_interval(secs => cfg.watchdog_lease_ms / 1000.0)
           and not public.incoming_delivery_dispatch_lease_is_active(
             cpd.call_id, cpd.dispatch_lease_id, cpd.dispatch_lease_scope
           ))
       )
     group by cpd.call_id
     order by due_at
     limit v_limit
  ), locked_calls as materialized (
    select c.id
      from public.calls c
      join candidate_call_ids ids on ids.call_id = c.id
     where c.status = 'ringing'
       and (c.expires_at is null or c.expires_at > clock_timestamp())
     order by ids.due_at
     for update of c skip locked
  ), candidates as materialized (
    select cpd.id
      from public.call_push_deliveries cpd
      join locked_calls lc on lc.id = cpd.call_id
      cross join config cfg
     where cpd.presentation_version >= 1
       and cpd.event_type = 'incoming_call' and cpd.provider = 'apns_voip'
       and cpd.presentation_closed_at is null
       and cpd.attempt_count < cfg.incoming_max_attempts
       and (
         (cpd.presentation_owner is null and cpd.status = 'pending'
           and cpd.claim_deadline_at <= clock_timestamp())
         or (cpd.presentation_owner = 'callkit' and cpd.status = 'failed'
           and cpd.next_attempt_at is not null
           and cpd.next_attempt_at <= clock_timestamp())
         or (cpd.presentation_owner = 'callkit' and cpd.status = 'processing'
           and coalesce(cpd.last_attempt_at, cpd.attempted_at, cpd.updated_at)
             < clock_timestamp() - make_interval(secs => cfg.watchdog_lease_ms / 1000.0)
           and not public.incoming_delivery_dispatch_lease_is_active(
             cpd.call_id, cpd.dispatch_lease_id, cpd.dispatch_lease_scope
           ))
       )
     order by coalesce(cpd.next_attempt_at, cpd.claim_deadline_at, cpd.created_at), cpd.created_at
     for update of cpd skip locked
     limit v_limit
  ), claimed as (
    update public.call_push_deliveries cpd
       set presentation_owner = coalesce(cpd.presentation_owner, 'callkit'),
           status = 'processing',
           dispatch_claimed_at = coalesce(cpd.dispatch_claimed_at, clock_timestamp()),
           attempt_count = cpd.attempt_count + 1,
           attempted_at = clock_timestamp(),
           last_attempt_at = clock_timestamp(),
           dispatch_lease_id = p_lease_id,
           dispatch_lease_scope = case when p_call_id is null then 'watchdog' else 'call' end,
           send_started_at = null,
           next_attempt_at = null,
           error_code = null,
           error_message = null
      from candidates
     where cpd.id = candidates.id
     returning cpd.id, cpd.call_id, cpd.device_id, cpd.event_type, cpd.payload, cpd.attempt_count
  )
  select x.id, x.call_id, x.device_id, x.event_type, x.payload, x.attempt_count
    from claimed x;
end;
$$;

create or replace function public.mark_incoming_call_delivery_send_started(
  p_delivery_id uuid,
  p_expected_attempt integer,
  p_lease_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_call_id uuid; v_stored_lease_id uuid; v_lease_scope text; v_started uuid;
begin
  select cpd.call_id, cpd.dispatch_lease_id, cpd.dispatch_lease_scope
    into v_call_id, v_stored_lease_id, v_lease_scope
    from public.call_push_deliveries cpd where cpd.id = p_delivery_id;
  if v_call_id is null or v_stored_lease_id is distinct from p_lease_id
     or not public.incoming_delivery_dispatch_lease_is_active(
       v_call_id, p_lease_id, v_lease_scope
     ) then return false; end if;
  perform 1 from public.calls c
   where c.id = v_call_id and c.status = 'ringing'
     and (c.expires_at is null or c.expires_at > clock_timestamp())
   for update;
  if not found then return false; end if;

  update public.call_push_deliveries cpd
     set send_started_at = clock_timestamp()
   where cpd.id = p_delivery_id
     and cpd.presentation_version >= 1
     and cpd.presentation_owner = 'callkit'
     and cpd.status = 'processing'
     and cpd.presentation_closed_at is null
      and cpd.send_started_at is null
      and cpd.dispatch_lease_id = p_lease_id
      and cpd.attempt_count = p_expected_attempt
  returning cpd.id into v_started;
  return v_started is not null;
end;
$$;

create or replace function public.finalize_incoming_call_delivery(
  p_delivery_id uuid,
  p_expected_attempt integer,
  p_lease_id uuid,
  p_result text,
  p_provider_ticket_id text default null,
  p_error_code text default null,
  p_error_message text default null,
  p_next_attempt_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_updated uuid; v_result text := lower(nullif(trim(p_result), ''));
begin
  if v_result not in ('sent', 'failed') then raise exception 'invalid delivery result'; end if;
  update public.call_push_deliveries cpd
     set status = v_result,
         provider_ticket_id = case when v_result = 'sent' then left(p_provider_ticket_id, 240) else cpd.provider_ticket_id end,
         delivered_at = case when v_result = 'sent' then clock_timestamp() else cpd.delivered_at end,
         error_code = case when v_result = 'failed' then left(p_error_code, 240) else null end,
         error_message = case when v_result = 'failed' then left(p_error_message, 240) else null end,
         next_attempt_at = case
           when v_result = 'failed'
             and cpd.presentation_closed_at is null
             and p_next_attempt_at is not null
             and p_next_attempt_at > clock_timestamp()
             and cpd.attempt_count < (
               select cfg.incoming_max_attempts
                 from public.call_presentation_config cfg where cfg.id = true
             )
           then p_next_attempt_at
           else null
         end
   where cpd.id = p_delivery_id
     and cpd.presentation_version >= 1
     and cpd.presentation_owner = 'callkit'
      and cpd.status = 'processing'
      and cpd.send_started_at is not null
      and cpd.dispatch_lease_id = p_lease_id
      and cpd.attempt_count = p_expected_attempt
  returning cpd.id into v_updated;
  return v_updated is not null;
end;
$$;

create or replace function public.invalidate_incoming_call_presentations(
  p_call_id uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_reason text := lower(nullif(trim(p_reason), '')); v_updated integer;
begin
  if v_reason not in ('terminal', 'timeout', 'rollback', 'superseded') then
    raise exception 'invalid presentation close reason';
  end if;
  perform 1 from public.calls c where c.id = p_call_id for update;
  if not found then return 0; end if;

  update public.call_push_deliveries cpd
     set status = case
           when cpd.presentation_owner is null and cpd.status = 'pending' then 'skipped'
           when cpd.presentation_owner = 'callkit' and cpd.status = 'processing' and cpd.send_started_at is null then 'skipped'
           else cpd.status
         end,
         presentation_closed_at = coalesce(cpd.presentation_closed_at, clock_timestamp()),
         presentation_close_reason = coalesce(cpd.presentation_close_reason, v_reason),
         next_attempt_at = case
           when cpd.presentation_owner is null and cpd.status = 'pending' then null
           when cpd.presentation_owner = 'callkit' and cpd.status = 'processing' and cpd.send_started_at is null then null
           else cpd.next_attempt_at
         end
   where cpd.call_id = p_call_id
     and cpd.presentation_version >= 1
     and cpd.event_type = 'incoming_call' and cpd.provider = 'apns_voip'
     and cpd.presentation_closed_at is null
     and (
       (cpd.presentation_owner is null and cpd.status = 'pending')
       or (cpd.presentation_owner = 'callkit' and cpd.status in ('processing', 'sent', 'failed'))
       or (cpd.presentation_owner = 'onspace' and cpd.status = 'skipped')
     );
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

create or replace function public.close_unprocessable_incoming_call_presentations(
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500); v_updated integer;
begin
  with candidate_calls as materialized (
    select c.id
      from public.calls c
     where (c.status <> 'ringing' or (c.expires_at is not null and c.expires_at <= clock_timestamp()))
       and exists (
         select 1 from public.call_push_deliveries cpd
          where cpd.call_id = c.id
            and cpd.presentation_version >= 1
            and cpd.event_type = 'incoming_call' and cpd.provider = 'apns_voip'
             and cpd.presentation_closed_at is null
             and (
               (cpd.presentation_owner is null and cpd.status = 'pending')
               or (cpd.presentation_owner = 'callkit' and cpd.status in ('processing', 'sent', 'failed'))
               or (cpd.presentation_owner = 'onspace' and cpd.status = 'skipped')
             )
       )
     order by c.updated_at
     limit v_limit
     for update of c skip locked
  ), closed as (
    update public.call_push_deliveries cpd
       set status = case
             when cpd.presentation_owner is null and cpd.status = 'pending' then 'skipped'
             when cpd.presentation_owner = 'callkit' and cpd.status = 'processing'
               and cpd.send_started_at is null then 'skipped'
             else cpd.status
           end,
           presentation_closed_at = clock_timestamp(),
           presentation_close_reason = case
             when c.expires_at is not null and c.expires_at <= clock_timestamp() then 'timeout'
             else 'terminal'
           end,
           next_attempt_at = case
             when cpd.presentation_owner is null and cpd.status = 'pending' then null
             when cpd.presentation_owner = 'callkit' and cpd.status = 'failed' then null
             when cpd.presentation_owner = 'callkit' and cpd.status = 'processing'
               and cpd.send_started_at is null then null
             else cpd.next_attempt_at
           end
      from candidate_calls cc
      join public.calls c on c.id = cc.id
     where cpd.call_id = cc.id
       and cpd.presentation_version >= 1
       and cpd.event_type = 'incoming_call' and cpd.provider = 'apns_voip'
       and cpd.presentation_closed_at is null
       and (
         (cpd.presentation_owner is null and cpd.status = 'pending')
         or (cpd.presentation_owner = 'callkit' and cpd.status in ('processing', 'sent', 'failed'))
         or (cpd.presentation_owner = 'onspace' and cpd.status = 'skipped')
       )
     returning cpd.id
  )
  select count(*) into v_updated from closed;
  return v_updated;
end;
$$;

create or replace function public.wake_incoming_call_dispatcher_if_needed()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_project_url text; v_publishable_key text; v_dispatch_secret text;
  v_lease_ms integer; v_lease_id uuid; v_request_id bigint;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('incoming-call-dispatch-watchdog', 0)) then return null; end if;
  perform public.close_unprocessable_incoming_call_presentations(100);
  if not exists (
    select 1
      from public.call_push_deliveries cpd
      join public.call_presentation_config cfg on cfg.id = true
      join public.calls c on c.id = cpd.call_id
     where cpd.presentation_version >= 1
       and cpd.event_type = 'incoming_call' and cpd.provider = 'apns_voip'
       and cpd.presentation_closed_at is null
       and c.status = 'ringing'
       and (c.expires_at is null or c.expires_at > clock_timestamp())
       and cpd.attempt_count < cfg.incoming_max_attempts
       and (
         (cpd.presentation_owner is null and cpd.status = 'pending' and cpd.claim_deadline_at <= clock_timestamp())
         or (cpd.presentation_owner = 'callkit' and cpd.status = 'failed'
           and cpd.next_attempt_at is not null
           and cpd.next_attempt_at <= clock_timestamp())
         or (cpd.presentation_owner = 'callkit' and cpd.status = 'processing'
           and coalesce(cpd.last_attempt_at, cpd.attempted_at, cpd.updated_at)
             < clock_timestamp() - make_interval(secs => cfg.watchdog_lease_ms / 1000.0)
           and not public.incoming_delivery_dispatch_lease_is_active(
             cpd.call_id, cpd.dispatch_lease_id, cpd.dispatch_lease_scope
           ))
       )
  ) then return null; end if;

  select c.watchdog_lease_ms into v_lease_ms from public.call_presentation_config c where c.id = true;
  v_lease_id := public.acquire_incoming_watchdog_lease(v_lease_ms);
  if v_lease_id is null then return null; end if;

  select ds.decrypted_secret into v_project_url from vault.decrypted_secrets ds where ds.name = 'call_dispatch_project_url' limit 1;
  select ds.decrypted_secret into v_publishable_key from vault.decrypted_secrets ds where ds.name = 'call_dispatch_publishable_key' limit 1;
  select ds.decrypted_secret into v_dispatch_secret from vault.decrypted_secrets ds where ds.name = 'call_dispatch_secret' limit 1;
  if nullif(trim(v_project_url), '') is null or nullif(trim(v_publishable_key), '') is null or nullif(v_dispatch_secret, '') is null then
    perform public.release_incoming_watchdog_lease(v_lease_id); return null;
  end if;

  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/dispatch-incoming-call-deliveries',
    headers := jsonb_build_object(
      'Content-Type', 'application/json', 'apikey', v_publishable_key,
      'Authorization', 'Bearer ' || v_publishable_key,
      'x-call-dispatch-secret', v_dispatch_secret
    ),
    body := jsonb_build_object('source', 'watchdog', 'lease_id', v_lease_id),
    timeout_milliseconds := 10000
  ) into v_request_id;
  return v_request_id;
exception when others then
  if v_lease_id is not null then perform public.release_incoming_watchdog_lease(v_lease_id); end if;
  raise warning 'incoming call watchdog wake failed';
  return null;
end;
$$;

alter table public.call_push_deliveries
  add constraint call_push_deliveries_call_device_event_provider_uidx
  unique using index call_push_deliveries_call_device_event_provider_uidx;

-- Replace start_call without changing its IOS-B behavior while the flag is false.
create or replace function public.start_call(
  p_callee_id uuid,
  p_call_type text,
  p_idempotency_key text,
  p_caller_device_id uuid default null
)
returns table (
  call_id uuid, caller_id uuid, callee_id uuid, channel_name text,
  call_type text, status text, expires_at timestamptz
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
  v_inserted integer := 0;
  v_foreground_enabled boolean := false;
  v_grace_ms integer := 1500;
begin
  if v_caller_id is null then raise exception 'not authenticated'; end if;
  if p_callee_id is null then raise exception 'callee_id is required'; end if;
  if p_callee_id = v_caller_id then raise exception 'cannot call yourself'; end if;
  if v_call_type not in ('audio', 'video') then raise exception 'invalid call_type'; end if;
  if v_key is null then raise exception 'idempotency_key is required'; end if;
  if not exists (select 1 from public.user_profiles up where up.id = p_callee_id) then raise exception 'callee not found'; end if;
  if p_caller_device_id is not null and not exists (
    select 1 from public.call_devices cd
     where cd.id = p_caller_device_id and cd.user_id = v_caller_id and cd.active = true
  ) then raise exception 'caller device not found'; end if;

  v_lock_a := hashtextextended(least(v_caller_id::text, p_callee_id::text), 0);
  v_lock_b := hashtextextended(greatest(v_caller_id::text, p_callee_id::text), 0);
  perform pg_advisory_xact_lock(v_lock_a);
  if v_lock_b <> v_lock_a then perform pg_advisory_xact_lock(v_lock_b); end if;

  perform public.expire_stale_calls();
  select c.* into v_existing from public.calls c
   where c.caller_id = v_caller_id and c.idempotency_key = v_key for update;
  if v_existing.id is not null then
    if v_existing.callee_id <> p_callee_id or v_existing.call_type <> v_call_type then
      raise exception 'idempotency key reused with different call parameters';
    end if;
    return query select c.id, c.caller_id, c.callee_id, c.channel_name, c.call_type, c.status, c.expires_at
      from public.calls c where c.id = v_existing.id;
    return;
  end if;

  select c.* into v_busy from public.calls c
   where c.status in ('ringing', 'accepted')
     and (c.caller_id = v_caller_id or c.callee_id = v_caller_id)
   order by c.created_at desc limit 1 for update;
  if v_busy.id is not null then raise exception 'caller already in active call'; end if;

  select c.* into v_busy from public.calls c
   where c.status in ('ringing', 'accepted')
     and (c.caller_id = p_callee_id or c.callee_id = p_callee_id)
   order by c.created_at desc limit 1 for update;
  if v_busy.id is not null then raise exception 'callee is busy'; end if;

  v_new_id := gen_random_uuid();
  begin
    insert into public.calls (
      id, caller_id, callee_id, channel_name, status, call_type, created_at,
      updated_at, expires_at, idempotency_key, caller_device_id
    ) values (
      v_new_id, v_caller_id, p_callee_id,
      'c_' || replace(v_new_id::text, '-', ''), 'ringing', v_call_type,
      now(), now(), now() + interval '45 seconds', v_key, p_caller_device_id
    ) returning public.calls.id into v_new_id;
  exception when unique_violation then
    select c.id into v_new_id from public.calls c
     where c.caller_id = v_caller_id and c.idempotency_key = v_key;
  end;

  select cfg.foreground_presentation_enabled, cfg.foreground_claim_grace_ms
    into v_foreground_enabled, v_grace_ms
    from public.call_presentation_config cfg where cfg.id = true;

  if coalesce(v_foreground_enabled, false) then
    insert into public.call_push_deliveries (
      call_id, device_id, event_type, provider, status, attempt_count,
      payload, presentation_version, presentation_owner, claim_deadline_at
    )
    select
      c.id, cd.id, 'incoming_call', 'apns_voip', 'pending', 0,
      jsonb_build_object(
        'type', 'incoming_call', 'call_id', c.id, 'caller_id', c.caller_id,
        'caller_name', coalesce(up.display_name, up.username, 'Llamada entrante'),
        'call_type', c.call_type, 'has_video', c.call_type = 'video',
        'expires_at', c.expires_at
      ),
      1, null, clock_timestamp() + make_interval(secs => v_grace_ms / 1000.0)
    from public.calls c
    join public.user_profiles up on up.id = c.caller_id
    join public.call_devices cd on cd.user_id = c.callee_id
    where c.id = v_new_id and c.status = 'ringing'
      and cd.active = true and cd.platform = 'ios'
      and cd.foreground_presentation_version >= 1
      and cd.voip_push_token is not null and length(trim(cd.voip_push_token)) > 0
    on conflict on constraint call_push_deliveries_call_device_event_provider_uidx
    do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted > 0 then
      begin
        perform public.wake_incoming_call_dispatcher(v_new_id);
      exception when others then
        null;
      end;
    end if;
  end if;

  return query select c.id, c.caller_id, c.callee_id, c.channel_name, c.call_type, c.status, c.expires_at
    from public.calls c where c.id = v_new_id;
end;
$$;

-- Preserve PUSH1 terminal delivery behavior while closing authoritative incoming presentations.
create or replace function public.expire_stale_calls()
returns table (closed_count integer, closed_ids uuid[])
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_call record; v_ids uuid[] := '{}';
begin
  for v_call in
    update public.calls c set status = 'expired', end_reason = coalesce(c.end_reason, 'timeout'), ended_at = coalesce(c.ended_at, now())
     where c.status = 'ringing'
       and ((c.expires_at is not null and c.expires_at < now()) or (c.expires_at is null and c.created_at < now() - interval '45 seconds'))
     returning c.id, c.status, c.end_reason
  loop
    v_ids := array_append(v_ids, v_call.id);
    perform public.invalidate_incoming_call_presentations(v_call.id, 'timeout');
    perform public.enqueue_call_terminal_deliveries(v_call.id, 'call_expired', 'expired', coalesce(v_call.end_reason, 'timeout'));
  end loop;
  for v_call in
    update public.calls c set status = 'ended', end_reason = coalesce(c.end_reason, 'system_cleanup'), ended_at = coalesce(c.ended_at, now())
     where c.status = 'accepted' and (c.updated_at < now() - interval '12 hours' or c.created_at < now() - interval '12 hours')
     returning c.id, c.status, c.end_reason
  loop
    v_ids := array_append(v_ids, v_call.id);
    perform public.invalidate_incoming_call_presentations(v_call.id, 'terminal');
    perform public.enqueue_call_terminal_deliveries(v_call.id, 'call_ended', 'ended', coalesce(v_call.end_reason, 'system_cleanup'));
  end loop;
  return query select coalesce(array_length(v_ids, 1), 0), v_ids;
end;
$$;

create or replace function public.accept_call(p_call_id uuid, p_callee_device_id uuid default null)
returns table (call_id uuid, channel_name text, call_type text, status text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user_id uuid := auth.uid(); v_call public.calls%rowtype;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  select c.* into v_call from public.calls c where c.id = p_call_id for update;
  if v_call.id is null then raise exception 'call not found'; end if;
  if v_call.callee_id <> v_user_id then raise exception 'not call callee'; end if;
  if p_callee_device_id is not null and not exists (select 1 from public.call_devices cd where cd.id=p_callee_device_id and cd.user_id=v_user_id and cd.active=true) then raise exception 'callee device not found'; end if;
  if v_call.status = 'accepted' then
    if v_call.callee_device_id is not null and p_callee_device_id is not null and v_call.callee_device_id <> p_callee_device_id then raise exception 'call already answered on another device'; end if;
    if v_call.callee_device_id is not null and p_callee_device_id is null then raise exception 'call already answered on another device'; end if;
    return query select v_call.id,v_call.channel_name,v_call.call_type,v_call.status; return;
  end if;
  if v_call.status <> 'ringing' then return query select v_call.id,v_call.channel_name,v_call.call_type,v_call.status; return; end if;
  if v_call.expires_at is not null and v_call.expires_at < now() then
    update public.calls c set status='expired',end_reason='timeout',ended_at=coalesce(c.ended_at,now()) where c.id=v_call.id returning c.* into v_call;
    perform public.invalidate_incoming_call_presentations(v_call.id,'timeout');
    perform public.enqueue_call_terminal_deliveries(v_call.id,'call_expired','expired','timeout');
    return query select v_call.id,v_call.channel_name,v_call.call_type,v_call.status; return;
  end if;
  update public.calls c set status='accepted',accepted_at=now(),callee_device_id=coalesce(p_callee_device_id,c.callee_device_id) where c.id=v_call.id returning c.* into v_call;
  perform public.invalidate_incoming_call_presentations(v_call.id,'superseded');
  perform public.enqueue_call_terminal_deliveries(v_call.id,'call_answered_elsewhere','accepted','answered_elsewhere',v_call.callee_device_id);
  return query select v_call.id,v_call.channel_name,v_call.call_type,v_call.status;
end;
$$;

create or replace function public.reject_call(p_call_id uuid, p_reason text default 'user_rejected')
returns table (call_id uuid, status text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user_id uuid:=auth.uid(); v_reason text:=coalesce(nullif(trim(p_reason),''),'user_rejected'); v_call public.calls%rowtype;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if v_reason not in ('user_rejected','caller_cancelled','user_ended','timeout','disconnected','busy','answered_elsewhere','system_cleanup') then raise exception 'invalid reason'; end if;
  select c.* into v_call from public.calls c where c.id=p_call_id for update;
  if v_call.id is null then raise exception 'call not found'; end if;
  if v_call.callee_id<>v_user_id then raise exception 'not call callee'; end if;
  if v_call.status in ('rejected','missed','ended','cancelled','expired') then return query select v_call.id,v_call.status; return; end if;
  if v_call.status<>'ringing' then raise exception 'call is not ringing'; end if;
  update public.calls c set status='rejected',rejected_at=coalesce(c.rejected_at,now()),ended_at=coalesce(c.ended_at,now()),end_reason=v_reason where c.id=v_call.id returning c.* into v_call;
  perform public.invalidate_incoming_call_presentations(v_call.id,'terminal');
  perform public.enqueue_call_terminal_deliveries(v_call.id,'call_rejected','rejected',v_reason);
  return query select v_call.id,v_call.status;
end;
$$;

create or replace function public.cancel_call(p_call_id uuid)
returns table (call_id uuid, status text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user_id uuid:=auth.uid(); v_call public.calls%rowtype;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  select c.* into v_call from public.calls c where c.id=p_call_id for update;
  if v_call.id is null then raise exception 'call not found'; end if;
  if v_call.caller_id<>v_user_id then raise exception 'not call caller'; end if;
  if v_call.status in ('rejected','missed','ended','cancelled','expired') then return query select v_call.id,v_call.status; return; end if;
  if v_call.status<>'ringing' then raise exception 'call is not ringing'; end if;
  update public.calls c set status='cancelled',ended_at=coalesce(c.ended_at,now()),end_reason='caller_cancelled' where c.id=v_call.id returning c.* into v_call;
  perform public.invalidate_incoming_call_presentations(v_call.id,'terminal');
  perform public.enqueue_call_terminal_deliveries(v_call.id,'call_cancelled','cancelled','caller_cancelled');
  return query select v_call.id,v_call.status;
end;
$$;

create or replace function public.end_call(p_call_id uuid, p_reason text default 'user_ended')
returns table (call_id uuid, status text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user_id uuid:=auth.uid(); v_reason text:=coalesce(nullif(trim(p_reason),''),'user_ended'); v_call public.calls%rowtype;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if v_reason not in ('user_rejected','caller_cancelled','user_ended','timeout','disconnected','busy','answered_elsewhere','system_cleanup') then raise exception 'invalid reason'; end if;
  select c.* into v_call from public.calls c where c.id=p_call_id for update;
  if v_call.id is null then raise exception 'call not found'; end if;
  if v_user_id<>v_call.caller_id and v_user_id<>v_call.callee_id then raise exception 'not call participant'; end if;
  if v_call.status in ('rejected','missed','ended','cancelled','expired') then return query select v_call.id,v_call.status; return; end if;
  if v_call.status<>'accepted' then raise exception 'call is not active'; end if;
  update public.calls c set status='ended',ended_at=coalesce(c.ended_at,now()),end_reason=v_reason where c.id=v_call.id returning c.* into v_call;
  perform public.invalidate_incoming_call_presentations(v_call.id,'terminal');
  perform public.enqueue_call_terminal_deliveries(v_call.id,'call_ended','ended',v_reason);
  return query select v_call.id,v_call.status;
end;
$$;

create or replace function public.timeout_call(p_call_id uuid)
returns table (call_id uuid, status text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user_id uuid:=auth.uid(); v_call public.calls%rowtype;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  select c.* into v_call from public.calls c where c.id=p_call_id for update;
  if v_call.id is null then raise exception 'call not found'; end if;
  if v_user_id<>v_call.caller_id and v_user_id<>v_call.callee_id then raise exception 'not call participant'; end if;
  if v_call.status in ('expired','missed','ended','cancelled','rejected') then return query select v_call.id,v_call.status; return; end if;
  if v_call.status<>'ringing' then raise exception 'call is not ringing'; end if;
  if v_call.expires_at is not null and now()<v_call.expires_at then raise exception 'call has not expired'; end if;
  update public.calls c set status='expired',end_reason='timeout',ended_at=coalesce(c.ended_at,now()) where c.id=v_call.id returning c.* into v_call;
  perform public.invalidate_incoming_call_presentations(v_call.id,'timeout');
  perform public.enqueue_call_terminal_deliveries(v_call.id,'call_expired','expired','timeout');
  return query select v_call.id,v_call.status;
end;
$$;

-- Dispatcher-only functions and internal wake/lease helpers.
revoke all on function public.acquire_incoming_call_dispatch_lease(uuid, integer) from public, anon, authenticated;
revoke all on function public.renew_incoming_call_dispatch_lease(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.validate_incoming_call_dispatch_lease(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_incoming_call_dispatch_lease(uuid, uuid) from public, anon, authenticated;
revoke all on function public.acquire_incoming_watchdog_lease(integer) from public, anon, authenticated;
revoke all on function public.renew_incoming_watchdog_lease(uuid, integer) from public, anon, authenticated;
revoke all on function public.validate_incoming_watchdog_lease(uuid) from public, anon, authenticated;
revoke all on function public.release_incoming_watchdog_lease(uuid) from public, anon, authenticated;
revoke all on function public.incoming_dispatch_lease_is_valid(uuid, uuid) from public, anon, authenticated;
revoke all on function public.incoming_delivery_dispatch_lease_is_active(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.wake_incoming_call_dispatcher(uuid) from public, anon, authenticated;
revoke all on function public.wake_incoming_call_dispatcher_if_needed() from public, anon, authenticated;
revoke all on function public.claim_incoming_call_deliveries(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.mark_incoming_call_delivery_send_started(uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.finalize_incoming_call_delivery(uuid, integer, uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.invalidate_incoming_call_presentations(uuid, text) from public, anon, authenticated;
revoke all on function public.close_unprocessable_incoming_call_presentations(integer) from public, anon, authenticated;

grant execute on function public.acquire_incoming_call_dispatch_lease(uuid, integer) to service_role;
grant execute on function public.renew_incoming_call_dispatch_lease(uuid, uuid, integer) to service_role;
grant execute on function public.validate_incoming_call_dispatch_lease(uuid, uuid) to service_role;
grant execute on function public.release_incoming_call_dispatch_lease(uuid, uuid) to service_role;
grant execute on function public.acquire_incoming_watchdog_lease(integer) to service_role;
grant execute on function public.renew_incoming_watchdog_lease(uuid, integer) to service_role;
grant execute on function public.validate_incoming_watchdog_lease(uuid) to service_role;
grant execute on function public.release_incoming_watchdog_lease(uuid) to service_role;
grant execute on function public.incoming_dispatch_lease_is_valid(uuid, uuid) to service_role;
grant execute on function public.incoming_delivery_dispatch_lease_is_active(uuid, uuid, text) to service_role;
grant execute on function public.wake_incoming_call_dispatcher(uuid) to service_role;
grant execute on function public.wake_incoming_call_dispatcher_if_needed() to service_role;
grant execute on function public.claim_incoming_call_deliveries(uuid, uuid, integer) to service_role;
grant execute on function public.mark_incoming_call_delivery_send_started(uuid, integer, uuid) to service_role;
grant execute on function public.finalize_incoming_call_delivery(uuid, integer, uuid, text, text, text, text, timestamptz) to service_role;
grant execute on function public.close_unprocessable_incoming_call_presentations(integer) to service_role;

-- Install the one-second watchdog inertly. A history-retention policy is
-- required before this job is activated in a later phase.
do $$
declare v_job_id bigint; v_active boolean;
begin
  if exists (select 1 from cron.job where jobname = 'call-incoming-dispatch-watchdog') then
    raise exception 'call-incoming-dispatch-watchdog already exists';
  end if;
  select cron.schedule(
    'call-incoming-dispatch-watchdog',
    '1 second',
    'select public.wake_incoming_call_dispatcher_if_needed()'
  ) into v_job_id;
  perform cron.alter_job(v_job_id, active := false);
  select active into v_active from cron.job where jobid = v_job_id;
  if v_active is distinct from false then
    raise exception 'incoming call watchdog was not installed inactive';
  end if;
end;
$$;

commit;
