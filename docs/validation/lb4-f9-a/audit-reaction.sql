-- Read-only source audit; original LB1 definition, not a migration.
create or replace function public.live_emit_reaction(p_session_id uuid, p_emoji text)
returns public.live_control_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.live_sessions%rowtype;
  v_username text;
  v_event public.live_control_events%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501', message='live_auth_required'; end if;
  if p_emoji is distinct from chr(10084)||chr(65039) then raise exception using errcode='22023', message='live_reaction_invalid'; end if;
  select * into v_session from public.live_sessions where id=p_session_id for share;
  if not found or v_session.status<>'live' then raise exception using errcode='55000', message='live_session_not_joinable'; end if;
  if v_session.host_id<>v_actor and not exists(
    select 1 from public.live_participants p where p.session_id=p_session_id and p.user_id=v_actor and p.status='active'
  ) then raise exception using errcode='42501', message='live_participant_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_session_id::text||':'||v_actor::text||':reaction',0));
  if (select count(*) from public.live_control_events e
      where e.session_id=p_session_id and e.actor_user_id=v_actor and e.event_type='reaction'
        and e.created_at>clock_timestamp()-interval '5 seconds'
        and coalesce(e.payload->>'gift_real','false')<>'true')>=8 then
    raise exception using errcode='55000', message='live_reaction_rate_limited';
  end if;
  select coalesce(nullif(btrim(up.username),''),'user') into v_username from public.user_profiles up where up.id=v_actor;
  insert into public.live_control_events(session_id,target_user_id,actor_user_id,event_type,payload)
  values(p_session_id,v_actor,v_actor,'reaction',jsonb_build_object('emoji',p_emoji,'username',coalesce(v_username,'user')))
  returning * into v_event;
  return v_event;
end;
$$;
