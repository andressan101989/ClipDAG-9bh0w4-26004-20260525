begin;

alter table public.calls
  add column if not exists handoff_completed_at timestamptz,
  add column if not exists joined_at timestamptz,
  add column if not exists media_connected_at timestamptz,
  add column if not exists last_heartbeat_at timestamptz;

alter table public.call_presentation_config
  add column if not exists call_liveness_cleanup_enabled boolean not null default false;

create index if not exists calls_accepted_liveness_idx
  on public.calls (status, last_heartbeat_at, media_connected_at, handoff_completed_at)
  where status = 'accepted';

create or replace function public.mark_call_handoff_completed(p_call_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user_id uuid := auth.uid(); v_updated_id uuid;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  update public.calls c
     set handoff_completed_at = coalesce(c.handoff_completed_at, clock_timestamp())
   where c.id = p_call_id and c.status = 'accepted'
     and v_user_id in (c.caller_id, c.callee_id)
  returning c.id into v_updated_id;
  return v_updated_id is not null;
end;
$$;

create or replace function public.mark_call_joined(p_call_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user_id uuid := auth.uid(); v_updated_id uuid;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  update public.calls c
     set joined_at = coalesce(c.joined_at, clock_timestamp())
   where c.id = p_call_id and c.status = 'accepted'
     and v_user_id in (c.caller_id, c.callee_id)
  returning c.id into v_updated_id;
  return v_updated_id is not null;
end;
$$;

create or replace function public.mark_call_media_connected(p_call_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user_id uuid := auth.uid(); v_updated_id uuid;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  update public.calls c
     set handoff_completed_at = coalesce(c.handoff_completed_at, clock_timestamp()),
         joined_at = coalesce(c.joined_at, clock_timestamp()),
         media_connected_at = coalesce(c.media_connected_at, clock_timestamp()),
         last_heartbeat_at = clock_timestamp()
   where c.id = p_call_id and c.status = 'accepted'
     and v_user_id in (c.caller_id, c.callee_id)
  returning c.id into v_updated_id;
  return v_updated_id is not null;
end;
$$;

create or replace function public.heartbeat_call(p_call_id uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user_id uuid := auth.uid(); v_updated_id uuid;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  update public.calls c
     set handoff_completed_at = coalesce(c.handoff_completed_at, clock_timestamp()),
         joined_at = coalesce(c.joined_at, clock_timestamp()),
         media_connected_at = coalesce(c.media_connected_at, clock_timestamp()),
         last_heartbeat_at = clock_timestamp()
   where c.id = p_call_id and c.status = 'accepted'
     and v_user_id in (c.caller_id, c.callee_id)
  returning c.id into v_updated_id;
  return v_updated_id is not null;
end;
$$;

revoke all on function public.mark_call_handoff_completed(uuid) from public, anon;
revoke all on function public.mark_call_joined(uuid) from public, anon;
revoke all on function public.mark_call_media_connected(uuid) from public, anon;
revoke all on function public.heartbeat_call(uuid) from public, anon;
grant execute on function public.mark_call_handoff_completed(uuid) to authenticated;
grant execute on function public.mark_call_joined(uuid) to authenticated;
grant execute on function public.mark_call_media_connected(uuid) to authenticated;
grant execute on function public.heartbeat_call(uuid) to authenticated;

create or replace function public.expire_stale_calls()
returns table (closed_count integer, closed_ids uuid[])
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_call record; v_ids uuid[] := '{}';
begin
  for v_call in
    with candidates as (
      select c.id from public.calls c
       where c.status = 'ringing'
         and ((c.expires_at is not null and c.expires_at < clock_timestamp())
           or (c.expires_at is null and c.created_at < clock_timestamp() - interval '45 seconds'))
       for update of c skip locked
    ), closed as (
      update public.calls c
         set status = 'expired', end_reason = coalesce(c.end_reason, 'timeout'),
             ended_at = coalesce(c.ended_at, clock_timestamp())
        from candidates where c.id = candidates.id and c.status = 'ringing'
      returning c.id, c.end_reason
    ) select * from closed
  loop
    v_ids := array_append(v_ids, v_call.id);
    perform public.invalidate_incoming_call_presentations(v_call.id, 'timeout');
    perform public.enqueue_call_terminal_deliveries(v_call.id, 'call_expired', 'expired', coalesce(v_call.end_reason, 'timeout'));
  end loop;

  for v_call in
    with candidates as (
      select c.id from public.calls c
       where c.status = 'accepted'
         and exists (
           select 1 from public.call_presentation_config cfg
            where cfg.id = true and cfg.call_liveness_cleanup_enabled = true
         )
         and (
         (c.handoff_completed_at is null and coalesce(c.accepted_at, c.updated_at, c.created_at) < clock_timestamp() - interval '3 minutes')
         or (c.handoff_completed_at is not null and c.media_connected_at is null
             and c.handoff_completed_at < clock_timestamp() - interval '3 minutes')
         or (c.media_connected_at is not null
             and coalesce(c.last_heartbeat_at, c.media_connected_at) < clock_timestamp() - interval '10 minutes')
       )
       for update of c skip locked
    ), closed as (
      update public.calls c
         set status = 'ended', end_reason = coalesce(c.end_reason, 'system_cleanup'),
             ended_at = coalesce(c.ended_at, clock_timestamp())
        from candidates where c.id = candidates.id and c.status = 'accepted'
      returning c.id, c.end_reason
    ) select * from closed
  loop
    v_ids := array_append(v_ids, v_call.id);
    perform public.invalidate_incoming_call_presentations(v_call.id, 'terminal');
    perform public.enqueue_call_terminal_deliveries(v_call.id, 'call_ended', 'ended', coalesce(v_call.end_reason, 'system_cleanup'));
  end loop;
  return query select coalesce(array_length(v_ids, 1), 0), v_ids;
end;
$$;

revoke execute on function public.expire_stale_calls() from public, anon, authenticated;
grant execute on function public.expire_stale_calls() to service_role;

commit;
