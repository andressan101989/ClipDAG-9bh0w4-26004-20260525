begin;

create or replace function public.release_foreground_call_presentation_to_callkit(
  p_call_id uuid,
  p_device_id uuid
)
returns table (result text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_call public.calls%rowtype;
  v_device_version smallint;
  v_delivery public.call_push_deliveries%rowtype;
  v_released_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select c.*
    into v_call
    from public.calls c
   where c.id = p_call_id
   for update;

  if v_call.id is null
     or (v_call.caller_id <> v_user_id and v_call.callee_id <> v_user_id) then
    return query select 'not_found'::text;
    return;
  end if;

  if v_call.status <> 'ringing'
     or (v_call.expires_at is not null and v_call.expires_at <= clock_timestamp()) then
    return query select 'terminal'::text;
    return;
  end if;

  select cd.foreground_presentation_version
    into v_device_version
    from public.call_devices cd
   where cd.id = p_device_id
     and cd.user_id = v_user_id
     and cd.active = true
     and cd.platform = 'ios'
     and cd.foreground_presentation_version >= 1;

  if v_device_version is null then
    return query select 'not_found'::text;
    return;
  end if;

  select cpd.*
    into v_delivery
    from public.call_push_deliveries cpd
   where cpd.call_id = p_call_id
     and cpd.device_id = p_device_id
     and cpd.event_type = 'incoming_call'
     and cpd.provider = 'apns_voip'
     and cpd.presentation_version = v_device_version
   for update;

  if v_delivery.id is null then
    return query select 'not_found'::text;
    return;
  end if;

  if v_delivery.presentation_closed_at is not null then
    return query select 'terminal'::text;
    return;
  end if;

  if v_delivery.presentation_owner = 'callkit'
     or (v_delivery.presentation_owner is null and v_delivery.status = 'pending') then
    return query select 'already_callkit'::text;
    return;
  end if;

  -- send_started_at is an irreversible presentation boundary. Even an
  -- unexpected prestate must fail closed instead of returning ownership.
  if v_delivery.presentation_owner is distinct from 'onspace'
     or v_delivery.status <> 'skipped'
     or v_delivery.send_started_at is not null
     or v_delivery.delivered_at is not null
     or v_delivery.dispatch_claimed_at is not null
     or v_delivery.dispatch_lease_id is not null
     or v_delivery.dispatch_lease_scope is not null then
    return query select 'not_releasable'::text;
    return;
  end if;

  update public.call_push_deliveries cpd
     set presentation_owner = null,
         status = 'pending',
         presentation_claimed_at = null,
         claim_deadline_at = least(cpd.claim_deadline_at, clock_timestamp()),
         next_attempt_at = null,
         error_code = null,
         error_message = null
   where cpd.id = v_delivery.id
     and cpd.call_id = p_call_id
     and cpd.device_id = p_device_id
     and cpd.event_type = 'incoming_call'
     and cpd.provider = 'apns_voip'
     and cpd.presentation_version = v_device_version
     and cpd.presentation_owner = 'onspace'
     and cpd.status = 'skipped'
     and cpd.presentation_closed_at is null
     and cpd.send_started_at is null
     and cpd.delivered_at is null
     and cpd.dispatch_claimed_at is null
     and cpd.dispatch_lease_id is null
     and cpd.dispatch_lease_scope is null
     and exists (
       select 1
         from public.calls c
        where c.id = p_call_id
          and c.status = 'ringing'
          and (c.expires_at is null or c.expires_at > clock_timestamp())
     )
  returning cpd.id into v_released_id;

  if v_released_id is not null then
    return query select 'released'::text;
    return;
  end if;

  -- The call and delivery rows are locked, so this is only a conservative
  -- idempotent fallback for an unexpected conditional-update mismatch.
  return query select 'not_releasable'::text;
end;
$$;

revoke all on function public.release_foreground_call_presentation_to_callkit(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.release_foreground_call_presentation_to_callkit(uuid, uuid)
to authenticated;

commit;
