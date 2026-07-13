begin;

alter table public.call_push_deliveries
  add column if not exists attempt_count integer not null default 0;

alter table public.call_push_deliveries
  drop constraint if exists call_push_deliveries_provider_check;

alter table public.call_push_deliveries
  add constraint call_push_deliveries_provider_check
  check (provider in ('expo', 'apns_voip'));

alter table public.call_push_deliveries
  drop constraint if exists call_push_deliveries_status_check;

alter table public.call_push_deliveries
  add constraint call_push_deliveries_status_check
  check (status in ('pending', 'processing', 'sent', 'failed', 'skipped'));

drop index if exists public.call_push_deliveries_call_device_event_uidx;

create unique index if not exists call_push_deliveries_call_device_event_provider_uidx
  on public.call_push_deliveries (
    call_id,
    device_id,
    event_type,
    provider
  );

drop index if exists public.call_push_deliveries_pending_idx;

create index if not exists call_push_deliveries_pending_idx
  on public.call_push_deliveries (
    event_type,
    provider,
    status,
    created_at
  )
  where status in ('pending', 'failed', 'processing');

create or replace function public.claim_call_push_delivery(
  p_call_id uuid,
  p_device_id uuid,
  p_event_type text,
  p_provider text default 'apns_voip'
)
returns table (
  delivery_id uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_provider <> 'apns_voip' then
    raise exception 'invalid provider';
  end if;

  if p_event_type not in (
    'incoming_call',
    'call_cancelled',
    'call_ended'
  ) then
    raise exception 'invalid event_type';
  end if;

  return query
  insert into public.call_push_deliveries as cpd (
    call_id,
    device_id,
    event_type,
    provider,
    status,
    attempt_count,
    attempted_at
  )
  values (
    p_call_id,
    p_device_id,
    p_event_type,
    p_provider,
    'processing',
    1,
    now()
  )
  on conflict (
    call_id,
    device_id,
    event_type,
    provider
  )
  do update
  set
    status = 'processing',
    attempt_count = cpd.attempt_count + 1,
    attempted_at = now(),
    error_code = null,
    error_message = null
  where (
      cpd.status in ('pending', 'failed')
      or (
        cpd.status = 'processing'
        and cpd.attempted_at < now() - interval '60 seconds'
      )
    )
    and cpd.attempt_count < 3
  returning
    cpd.id,
    cpd.attempt_count;
end;
$$;

revoke all
on function public.claim_call_push_delivery(uuid, uuid, text, text)
from public, anon, authenticated;

grant execute
on function public.claim_call_push_delivery(uuid, uuid, text, text)
to service_role;

commit;
