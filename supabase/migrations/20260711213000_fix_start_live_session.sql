begin;

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
  v_existing public.live_sessions%rowtype;
begin
  if v_host_id is null then
    raise exception 'not authenticated';
  end if;

  if p_session_id is null then
    raise exception 'session id is required';
  end if;

  select ls.*
    into v_existing
    from public.live_sessions as ls
   where ls.id = p_session_id
   for update;

  if found and v_existing.host_id <> v_host_id then
    raise exception 'live session belongs to another host';
  end if;

  update public.live_sessions as ls
     set status = 'ended',
         ended_at = coalesce(ls.ended_at, now()),
         end_reason = coalesce(ls.end_reason, 'replaced_by_new_live'),
         host_disconnected_at = coalesce(ls.host_disconnected_at, now())
   where ls.host_id = v_host_id
     and ls.status = 'live'
     and ls.id <> p_session_id;

  if v_existing.id is not null then
    update public.live_sessions as ls
       set title = coalesce(nullif(trim(p_title), ''), ls.title, 'Live'),
           status = 'live',
           ended_at = null,
           end_reason = null,
           last_heartbeat_at = now(),
           host_disconnected_at = null
     where ls.id = p_session_id
       and ls.host_id = v_host_id;
  else
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
  end if;

  return query
    select ls.id, ls.status, ls.started_at, ls.last_heartbeat_at
      from public.live_sessions as ls
     where ls.id = p_session_id
       and ls.host_id = v_host_id;
end;
$$;

grant execute on function public.start_live_session(uuid, text) to authenticated;

commit;
