begin;

alter table public.live_sessions
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists host_disconnected_at timestamptz,
  add column if not exists end_reason text;

create index if not exists live_sessions_status_heartbeat_idx
  on public.live_sessions (status, last_heartbeat_at desc);

create index if not exists live_sessions_host_status_idx
  on public.live_sessions (host_id, status);

create or replace function public.start_live_session(
  p_session_id uuid,
  p_title text
)
returns table (
  id uuid,
  status text,
  started_at timestamptz,
  last_heartbeat_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_host_id uuid := auth.uid();
begin
  if v_host_id is null then
    raise exception 'not authenticated';
  end if;

  if p_session_id is null then
    raise exception 'session id is required';
  end if;

  update public.live_sessions
     set status = 'ended',
         ended_at = coalesce(ended_at, now()),
         end_reason = coalesce(end_reason, 'replaced_by_new_live'),
         host_disconnected_at = coalesce(host_disconnected_at, now())
   where host_id = v_host_id
     and status = 'live'
     and id <> p_session_id;

  insert into public.live_sessions (
    id,
    host_id,
    title,
    status,
    viewer_count,
    started_at,
    last_heartbeat_at,
    host_disconnected_at,
    end_reason
  ) values (
    p_session_id,
    v_host_id,
    coalesce(nullif(trim(p_title), ''), 'Live'),
    'live',
    0,
    now(),
    now(),
    null,
    null
  );

  return query
    select ls.id, ls.status, ls.started_at, ls.last_heartbeat_at
      from public.live_sessions ls
     where ls.id = p_session_id;
end;
$$;

create or replace function public.heartbeat_live_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_host_id uuid := auth.uid();
  v_updated_id uuid;
begin
  if v_host_id is null then
    raise exception 'not authenticated';
  end if;

  update public.live_sessions
     set last_heartbeat_at = now(),
         host_disconnected_at = null
   where id = p_session_id
     and host_id = v_host_id
     and status = 'live'
   returning id into v_updated_id;

  if v_updated_id is null then
    return jsonb_build_object('ok', false, 'status', 'not_live');
  end if;

  return jsonb_build_object('ok', true, 'session_id', v_updated_id, 'last_heartbeat_at', now());
end;
$$;

create or replace function public.mark_live_session_disconnected(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_host_id uuid := auth.uid();
  v_updated_id uuid;
begin
  if v_host_id is null then
    raise exception 'not authenticated';
  end if;

  update public.live_sessions
     set host_disconnected_at = now()
   where id = p_session_id
     and host_id = v_host_id
     and status = 'live'
   returning id into v_updated_id;

  return jsonb_build_object('ok', v_updated_id is not null, 'session_id', v_updated_id);
end;
$$;

create or replace function public.end_live_session(
  p_session_id uuid,
  p_reason text default 'host_ended'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_host_id uuid := auth.uid();
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'host_ended');
  v_session public.live_sessions%rowtype;
begin
  if v_host_id is null then
    raise exception 'not authenticated';
  end if;

  if v_reason not in (
    'host_ended',
    'host_disconnected',
    'stale_heartbeat',
    'replaced_by_new_live',
    'recovered_on_startup',
    'admin_cleanup'
  ) then
    v_reason := 'host_ended';
  end if;

  select * into v_session
    from public.live_sessions
   where id = p_session_id
     and host_id = v_host_id;

  if not found then
    raise exception 'live session not found';
  end if;

  if v_session.status <> 'live' then
    return jsonb_build_object('ok', true, 'already_ended', true, 'session_id', p_session_id);
  end if;

  update public.live_sessions
     set status = 'ended',
         ended_at = coalesce(ended_at, now()),
         end_reason = v_reason,
         host_disconnected_at = case when v_reason = 'host_ended' then host_disconnected_at else coalesce(host_disconnected_at, now()) end
   where id = p_session_id;

  return jsonb_build_object('ok', true, 'already_ended', false, 'session_id', p_session_id, 'reason', v_reason);
end;
$$;

create or replace function public.close_stale_live_sessions()
returns table (closed_count integer, closed_ids uuid[])
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_closed_ids uuid[];
begin
  if auth.uid() is null and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'not authenticated';
  end if;

  with closed as (
    update public.live_sessions
       set status = 'ended',
           ended_at = coalesce(ended_at, now()),
           end_reason = 'stale_heartbeat',
           host_disconnected_at = coalesce(host_disconnected_at, now())
     where status = 'live'
       and coalesce(last_heartbeat_at, started_at) < now() - interval '90 seconds'
     returning id
  )
  select array_agg(id) into v_closed_ids
    from closed;

  return query select coalesce(array_length(v_closed_ids, 1), 0), coalesce(v_closed_ids, array[]::uuid[]);
end;
$$;

create or replace function public.recover_host_live_sessions()
returns table (closed_count integer, closed_ids uuid[])
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_host_id uuid := auth.uid();
  v_closed_ids uuid[];
begin
  if v_host_id is null then
    raise exception 'not authenticated';
  end if;

  with stale as (
    update public.live_sessions
       set status = 'ended',
           ended_at = coalesce(ended_at, now()),
           end_reason = 'recovered_on_startup',
           host_disconnected_at = coalesce(host_disconnected_at, now())
     where host_id = v_host_id
       and status = 'live'
       and (
         coalesce(last_heartbeat_at, started_at) < now() - interval '90 seconds'
         or host_disconnected_at < now() - interval '30 seconds'
       )
     returning id
  ),
  duplicate_live as (
    select id
      from (
        select id, row_number() over (order by coalesce(last_heartbeat_at, started_at) desc, started_at desc) as rn
          from public.live_sessions
         where host_id = v_host_id
           and status = 'live'
      ) ranked
     where rn > 1
  ),
  closed_dupes as (
    update public.live_sessions ls
       set status = 'ended',
           ended_at = coalesce(ended_at, now()),
           end_reason = 'replaced_by_new_live',
           host_disconnected_at = coalesce(host_disconnected_at, now())
      from duplicate_live d
     where ls.id = d.id
     returning ls.id
  )
  select array_agg(id) into v_closed_ids
    from (
      select id from stale
      union all
      select id from closed_dupes
    ) closed;

  return query select coalesce(array_length(v_closed_ids, 1), 0), coalesce(v_closed_ids, array[]::uuid[]);
end;
$$;

-- One active live per host. Existing stale sessions are closed first so the
-- constraint can be added without deleting historical rows.
update public.live_sessions
   set status = 'ended',
       ended_at = coalesce(ended_at, now()),
       end_reason = 'admin_cleanup',
       host_disconnected_at = coalesce(host_disconnected_at, now())
 where status = 'live'
   and coalesce(last_heartbeat_at, started_at) < now() - interval '90 seconds';

with ranked as (
  select id, row_number() over (
    partition by host_id
    order by coalesce(last_heartbeat_at, started_at) desc, started_at desc
  ) as rn
    from public.live_sessions
   where status = 'live'
)
update public.live_sessions ls
   set status = 'ended',
       ended_at = coalesce(ended_at, now()),
       end_reason = 'replaced_by_new_live',
       host_disconnected_at = coalesce(host_disconnected_at, now())
  from ranked r
 where ls.id = r.id
   and r.rn > 1;

create unique index if not exists live_sessions_one_live_per_host_uidx
  on public.live_sessions (host_id)
  where status = 'live';

grant execute on function public.start_live_session(uuid, text) to authenticated;
grant execute on function public.heartbeat_live_session(uuid) to authenticated;
grant execute on function public.mark_live_session_disconnected(uuid) to authenticated;
grant execute on function public.end_live_session(uuid, text) to authenticated;
grant execute on function public.close_stale_live_sessions() to authenticated, service_role;
grant execute on function public.recover_host_live_sessions() to authenticated;

commit;
