begin;

alter table public.call_presentation_config
  add column if not exists terminal_voip_activation_cutoff timestamptz,
  add column if not exists terminal_voip_stale_classified_at timestamptz,
  add column if not exists terminal_voip_pre_activation_stale_count integer not null default 0
    check (terminal_voip_pre_activation_stale_count >= 0);

-- The cutoff records eligibility, not activation. The Edge flag and both
-- terminal jobs remain unchanged/inactive after this migration.
update public.call_presentation_config cfg
   set terminal_voip_activation_cutoff = coalesce(
         cfg.terminal_voip_activation_cutoff,
         statement_timestamp()
       )
 where cfg.id = true;

with cutoff as materialized (
  select cfg.terminal_voip_activation_cutoff as activated_at
    from public.call_presentation_config cfg
   where cfg.id = true
), classified as (
  update public.call_push_deliveries cpd
     set status = 'skipped',
         error_code = 'PRE_ACTIVATION_STALE',
         error_message = 'terminal delivery predates activation cutoff',
         next_attempt_at = null
    from cutoff
   where cpd.provider = 'apns_voip'
     and cpd.event_type in (
       'call_cancelled', 'call_expired', 'call_rejected',
       'call_ended', 'call_answered_elsewhere'
     )
     and cpd.created_at < cutoff.activated_at
     and cpd.status in ('pending', 'failed', 'processing')
     and cpd.error_code is distinct from 'PRE_ACTIVATION_STALE'
  returning cpd.id
)
select count(*) from classified;

update public.call_presentation_config cfg
   set terminal_voip_stale_classified_at = coalesce(
         cfg.terminal_voip_stale_classified_at,
         statement_timestamp()
       ),
       terminal_voip_pre_activation_stale_count = (
         select count(*)::integer
           from public.call_push_deliveries cpd
          where cpd.provider = 'apns_voip'
            and cpd.event_type in (
              'call_cancelled', 'call_expired', 'call_rejected',
              'call_ended', 'call_answered_elsewhere'
            )
            and cpd.created_at < cfg.terminal_voip_activation_cutoff
            and cpd.status = 'skipped'
            and cpd.error_code = 'PRE_ACTIVATION_STALE'
       )
 where cfg.id = true;

create index if not exists call_push_deliveries_terminal_post_cutoff_idx
  on public.call_push_deliveries (
    provider,
    status,
    created_at,
    next_attempt_at,
    last_attempt_at
  )
  where provider = 'apns_voip'
    and event_type in (
      'call_cancelled', 'call_expired', 'call_rejected',
      'call_ended', 'call_answered_elsewhere'
    )
    and presentation_version = 0
    and status in ('pending', 'failed', 'processing');

drop function if exists public.claim_pending_call_push_deliveries(text, integer);

create function public.claim_pending_call_push_deliveries(
  p_provider text,
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
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_cutoff timestamptz;
begin
  if p_provider <> 'apns_voip' then
    raise exception 'invalid provider';
  end if;

  select cfg.terminal_voip_activation_cutoff
    into v_cutoff
    from public.call_presentation_config cfg
   where cfg.id = true
   for share;

  if v_cutoff is null then
    return;
  end if;

  return query
  with candidates as materialized (
    select cpd.id
      from public.call_push_deliveries cpd
      join public.call_devices cd on cd.id = cpd.device_id
     where cpd.provider = p_provider
       and cpd.event_type in (
         'call_cancelled', 'call_expired', 'call_rejected',
         'call_ended', 'call_answered_elsewhere'
       )
       and cpd.presentation_version = 0
       and cpd.created_at >= v_cutoff
       and cpd.error_code is distinct from 'PRE_ACTIVATION_STALE'
       and cd.active = true
       and cd.platform = 'ios'
       and cd.terminal_voip_version >= 1
       and cd.voip_push_token is not null
       and length(trim(cd.voip_push_token)) > 0
       and cpd.attempt_count < 3
       and (
         (cpd.status = 'pending'
           and (cpd.next_attempt_at is null or cpd.next_attempt_at <= clock_timestamp()))
         or (cpd.status = 'failed'
           and cpd.next_attempt_at is not null
           and cpd.next_attempt_at <= clock_timestamp())
         or (cpd.status = 'processing'
           and coalesce(cpd.last_attempt_at, cpd.attempted_at, cpd.created_at)
             < clock_timestamp() - interval '60 seconds')
       )
     order by coalesce(cpd.next_attempt_at, cpd.created_at), cpd.created_at
     for update of cpd skip locked
     limit v_limit
  ), claimed as (
    update public.call_push_deliveries cpd
       set status = 'processing',
           attempt_count = cpd.attempt_count + 1,
           attempted_at = clock_timestamp(),
           last_attempt_at = clock_timestamp(),
           error_code = null,
           error_message = null
      from candidates
     where cpd.id = candidates.id
     returning cpd.id, cpd.call_id, cpd.device_id, cpd.event_type,
               cpd.payload, cpd.attempt_count
  )
  select claimed.id, claimed.call_id, claimed.device_id, claimed.event_type,
         claimed.payload, claimed.attempt_count
    from claimed;
end;
$$;

revoke all on function public.claim_pending_call_push_deliveries(text, integer)
from public, anon, authenticated;
grant execute on function public.claim_pending_call_push_deliveries(text, integer)
to service_role;

commit;
