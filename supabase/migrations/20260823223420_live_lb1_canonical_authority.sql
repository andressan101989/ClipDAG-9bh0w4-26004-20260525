begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.live_agora_uid(p_user_id uuid)
returns integer
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_text text := p_user_id::text;
  v_hash numeric := 0;
  v_index integer;
begin
  for v_index in 1..length(v_text) loop
    v_hash := mod(v_hash * 31 + ascii(substr(v_text, v_index, 1)), 4294967296);
  end loop;
  return (mod(v_hash, 2147483647) + 1)::integer;
end;
$$;

revoke all on function private.live_agora_uid(uuid) from public, anon, authenticated, service_role;

alter table public.live_control_events
  drop constraint if exists live_control_events_event_type_check;
alter table public.live_control_events
  add constraint live_control_events_event_type_check
  check (event_type in (
    'presence_enter', 'presence_leave',
    'request_join', 'host_invite', 'host_invite_response',
    'approve_join', 'reject_join',
    'mute', 'unmute', 'lock_mic', 'unlock_mic',
    'grant_floor', 'revoke_floor', 'remove_cohost',
    'timer_start', 'timer_stop', 'reaction'
  ));

create index if not exists live_control_events_reaction_actor_rate_idx
  on public.live_control_events (session_id, actor_user_id, created_at desc)
  where event_type = 'reaction';

create index if not exists live_messages_session_user_created_idx
  on public.live_messages (session_id, user_id, created_at desc);

create or replace function public.live_set_participant_presence(
  p_session_id uuid,
  p_present boolean
)
returns public.live_participants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.live_sessions%rowtype;
  v_participant public.live_participants%rowtype;
  v_username text;
  v_transition boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'live_auth_required';
  end if;
  if p_present is null then
    raise exception using errcode = '22023', message = 'live_presence_invalid';
  end if;

  select * into v_session
  from public.live_sessions
  where id = p_session_id
  for update;
  if not found or v_session.status <> 'live' then
    raise exception using errcode = '55000', message = 'live_session_not_joinable';
  end if;
  if v_session.host_id = v_actor then
    raise exception using errcode = '42501', message = 'live_host_presence_not_counted';
  end if;

  select coalesce(nullif(btrim(up.username), ''), 'user') into v_username
  from public.user_profiles up where up.id = v_actor;
  v_username := coalesce(v_username, 'user');

  select * into v_participant
  from public.live_participants
  where session_id = p_session_id and user_id = v_actor
  for update;

  if p_present then
    if not found then
      insert into public.live_participants (
        session_id, user_id, agora_uid, username, role, status,
        mic_muted, mic_locked, camera_enabled, floor_granted,
        floor_started_at, floor_duration_seconds
      ) values (
        p_session_id, v_actor, private.live_agora_uid(v_actor), v_username,
        'audience', 'active', false, false, true, false, null, null
      ) returning * into v_participant;
      v_transition := true;
    elsif v_participant.status <> 'active' then
      update public.live_participants
      set agora_uid = private.live_agora_uid(v_actor),
          username = v_username,
          role = case when role = 'cohost' then 'cohost' else 'audience' end,
          status = 'active',
          mic_muted = case when role = 'cohost' then mic_muted else false end,
          mic_locked = case when role = 'cohost' then mic_locked else false end,
          camera_enabled = true,
          floor_granted = case when role = 'cohost' then floor_granted else false end,
          floor_started_at = case when role = 'cohost' then floor_started_at else null end,
          floor_duration_seconds = case when role = 'cohost' then floor_duration_seconds else null end
      where id = v_participant.id
      returning * into v_participant;
      v_transition := true;
    else
      update public.live_participants
      set agora_uid = private.live_agora_uid(v_actor), username = v_username
      where id = v_participant.id
        and (agora_uid is distinct from private.live_agora_uid(v_actor)
             or username is distinct from v_username)
      returning * into v_participant;
      if not found then
        select * into v_participant from public.live_participants
        where session_id = p_session_id and user_id = v_actor;
      end if;
    end if;

    if v_transition then
      update public.live_sessions
      set viewer_count = viewer_count + 1
      where id = p_session_id;
      insert into public.live_control_events (
        session_id, target_user_id, actor_user_id, event_type, payload
      ) values (
        p_session_id, v_actor, v_actor, 'presence_enter',
        jsonb_build_object('username', v_username)
      );
    end if;
  else
    if not found then
      return null;
    end if;
    if v_participant.status = 'active' then
      update public.live_participants
      set status = 'inactive',
          role = case when role = 'cohost' then 'cohost' else 'audience' end,
          mic_muted = true,
          floor_granted = false,
          floor_started_at = null,
          floor_duration_seconds = null
      where id = v_participant.id
      returning * into v_participant;
      update public.live_sessions
      set viewer_count = greatest(0, viewer_count - 1)
      where id = p_session_id;
      insert into public.live_control_events (
        session_id, target_user_id, actor_user_id, event_type, payload
      ) values (
        p_session_id, v_actor, v_actor, 'presence_leave',
        jsonb_build_object('username', v_username)
      );
    end if;
  end if;

  return v_participant;
end;
$$;

create or replace function public.live_request_to_join(p_session_id uuid)
returns public.live_participants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.live_sessions%rowtype;
  v_participant public.live_participants%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501', message='live_auth_required'; end if;
  select * into v_session from public.live_sessions where id=p_session_id for update;
  if not found or v_session.status<>'live' then raise exception using errcode='55000', message='live_session_not_joinable'; end if;
  if v_session.host_id=v_actor then raise exception using errcode='42501', message='live_host_cannot_request'; end if;
  select * into v_participant from public.live_participants
  where session_id=p_session_id and user_id=v_actor for update;
  if not found or v_participant.status<>'active' then raise exception using errcode='55000', message='live_participant_not_active'; end if;
  if v_participant.role='cohost' then return v_participant; end if;
  if v_participant.role='requested' then return v_participant; end if;
  if v_participant.role not in ('audience','removed') then raise exception using errcode='55000', message='live_join_transition_invalid'; end if;

  update public.live_participants
  set role='requested', mic_muted=false, mic_locked=false, camera_enabled=true,
      floor_granted=false, floor_started_at=null, floor_duration_seconds=null
  where id=v_participant.id returning * into v_participant;
  insert into public.live_control_events(session_id,target_user_id,actor_user_id,event_type,payload)
  values(p_session_id,v_actor,v_actor,'request_join',jsonb_build_object('username',coalesce(v_participant.username,'user')));
  return v_participant;
end;
$$;

create or replace function public.live_host_invite_participant(
  p_session_id uuid,
  p_target_user_id uuid
)
returns public.live_control_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.live_sessions%rowtype;
  v_participant public.live_participants%rowtype;
  v_event public.live_control_events%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501', message='live_auth_required'; end if;
  if p_target_user_id is null or p_target_user_id=v_actor then raise exception using errcode='22023', message='live_target_invalid'; end if;
  select * into v_session from public.live_sessions where id=p_session_id for update;
  if not found or v_session.status<>'live' then raise exception using errcode='55000', message='live_session_not_joinable'; end if;
  if v_session.host_id<>v_actor then raise exception using errcode='42501', message='live_host_required'; end if;
  select * into v_participant from public.live_participants
  where session_id=p_session_id and user_id=p_target_user_id for update;
  if not found or v_participant.status<>'active' or v_participant.role<>'audience' then
    raise exception using errcode='55000', message='live_invite_target_invalid';
  end if;

  select e.* into v_event
  from public.live_control_events e
  where e.session_id=p_session_id and e.target_user_id=p_target_user_id
    and e.actor_user_id=v_actor and e.event_type='host_invite'
    and not exists (
      select 1 from public.live_control_events x
      where x.session_id=e.session_id and x.target_user_id=e.target_user_id
        and x.created_at>e.created_at
        and x.event_type in ('host_invite_response','request_join','presence_leave','presence_enter','reject_join','remove_cohost')
    )
  order by e.created_at desc, e.id desc limit 1;
  if found then return v_event; end if;

  insert into public.live_control_events(session_id,target_user_id,actor_user_id,event_type,payload)
  values(p_session_id,p_target_user_id,v_actor,'host_invite',jsonb_build_object('username',coalesce(v_participant.username,'user')))
  returning * into v_event;
  return v_event;
end;
$$;

create or replace function public.live_respond_to_host_invite(
  p_session_id uuid,
  p_invite_id uuid,
  p_accept boolean
)
returns public.live_participants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.live_sessions%rowtype;
  v_participant public.live_participants%rowtype;
  v_invite public.live_control_events%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501', message='live_auth_required'; end if;
  if p_invite_id is null or p_accept is null then raise exception using errcode='22023', message='live_invite_response_invalid'; end if;
  select * into v_session from public.live_sessions where id=p_session_id for update;
  if not found or v_session.status<>'live' then raise exception using errcode='55000', message='live_session_not_joinable'; end if;
  select * into v_participant from public.live_participants
  where session_id=p_session_id and user_id=v_actor for update;
  if not found or v_participant.status<>'active' then raise exception using errcode='55000', message='live_participant_not_active'; end if;
  if p_accept and v_participant.role='cohost' then return v_participant; end if;

  select * into v_invite from public.live_control_events
  where id=p_invite_id and session_id=p_session_id and target_user_id=v_actor
    and actor_user_id=v_session.host_id and event_type='host_invite'
  for update;
  if not found then
    raise exception using errcode='55000', message='live_invite_not_active';
  end if;
  if exists (
    select 1 from public.live_control_events x
    where x.session_id=p_session_id and x.target_user_id=v_actor
      and x.event_type='host_invite_response'
      and x.payload->>'invite_id'=p_invite_id::text
      and (x.payload->>'accepted')::boolean=p_accept
  ) then
    return v_participant;
  end if;
  if exists (
    select 1 from public.live_control_events x
    where x.session_id=p_session_id and x.target_user_id=v_actor
      and (
        (x.event_type='host_invite_response' and x.payload->>'invite_id'=p_invite_id::text)
        or (x.created_at>v_invite.created_at and x.event_type in ('request_join','presence_leave','presence_enter','reject_join','remove_cohost'))
      )
  ) then
    raise exception using errcode='55000', message='live_invite_not_active';
  end if;

  if v_participant.role<>'audience' then raise exception using errcode='55000', message='live_invite_transition_invalid'; end if;
  if p_accept then
    update public.live_participants
    set role='cohost', status='active', mic_muted=false, mic_locked=false,
        camera_enabled=true, floor_granted=true, floor_started_at=clock_timestamp(),
        floor_duration_seconds=null
    where id=v_participant.id returning * into v_participant;
  end if;
  insert into public.live_control_events(session_id,target_user_id,actor_user_id,event_type,payload)
  values(p_session_id,v_actor,v_actor,'host_invite_response',
    jsonb_build_object('invite_id',p_invite_id,'accepted',p_accept,'username',coalesce(v_participant.username,'user')));
  return v_participant;
end;
$$;

create or replace function public.live_host_decide_join_request(
  p_session_id uuid,
  p_target_user_id uuid,
  p_approve boolean
)
returns public.live_participants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.live_sessions%rowtype;
  v_participant public.live_participants%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501', message='live_auth_required'; end if;
  if p_target_user_id is null or p_approve is null then raise exception using errcode='22023', message='live_decision_invalid'; end if;
  select * into v_session from public.live_sessions where id=p_session_id for update;
  if not found or v_session.status<>'live' then raise exception using errcode='55000', message='live_session_not_joinable'; end if;
  if v_session.host_id<>v_actor then raise exception using errcode='42501', message='live_host_required'; end if;
  select * into v_participant from public.live_participants
  where session_id=p_session_id and user_id=p_target_user_id for update;
  if not found or v_participant.status<>'active' then raise exception using errcode='55000', message='live_participant_not_active'; end if;
  if p_approve and v_participant.role='cohost' then return v_participant; end if;
  if not p_approve and v_participant.role='audience' then return v_participant; end if;
  if v_participant.role<>'requested' then raise exception using errcode='55000', message='live_request_not_active'; end if;

  update public.live_participants
  set role=case when p_approve then 'cohost' else 'audience' end,
      status='active', mic_muted=false, mic_locked=false, camera_enabled=true,
      floor_granted=p_approve,
      floor_started_at=case when p_approve then clock_timestamp() else null end,
      floor_duration_seconds=null
  where id=v_participant.id returning * into v_participant;
  insert into public.live_control_events(session_id,target_user_id,actor_user_id,event_type,payload)
  values(p_session_id,p_target_user_id,v_actor,
    case when p_approve then 'approve_join' else 'reject_join' end,
    jsonb_build_object('username',coalesce(v_participant.username,'user')));
  return v_participant;
end;
$$;

create or replace function public.live_host_control_participant(
  p_session_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_duration_seconds integer default null
)
returns public.live_participants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.live_sessions%rowtype;
  v_participant public.live_participants%rowtype;
  v_changed boolean := false;
  v_payload jsonb;
begin
  if v_actor is null then raise exception using errcode='42501', message='live_auth_required'; end if;
  if p_action not in ('mute','unmute','lock_mic','unlock_mic','grant_floor','revoke_floor','timer_start','timer_stop','remove_cohost') then
    raise exception using errcode='22023', message='live_control_action_invalid';
  end if;
  if (p_action='timer_start' and p_duration_seconds not in (60,120))
     or (p_action<>'timer_start' and p_duration_seconds is not null) then
    raise exception using errcode='22023', message='live_control_duration_invalid';
  end if;
  select * into v_session from public.live_sessions where id=p_session_id for update;
  if not found or v_session.status<>'live' then raise exception using errcode='55000', message='live_session_not_joinable'; end if;
  if v_session.host_id<>v_actor then raise exception using errcode='42501', message='live_host_required'; end if;
  select * into v_participant from public.live_participants
  where session_id=p_session_id and user_id=p_target_user_id for update;
  if not found or v_participant.status<>'active' or v_participant.role<>'cohost' then
    raise exception using errcode='55000', message='live_cohost_not_active';
  end if;

  if p_action='mute' and not v_participant.mic_muted then
    update public.live_participants set mic_muted=true where id=v_participant.id returning * into v_participant; v_changed:=true;
  elsif p_action='unmute' and v_participant.mic_muted then
    if v_participant.mic_locked then raise exception using errcode='55000', message='live_mic_locked'; end if;
    update public.live_participants set mic_muted=false where id=v_participant.id returning * into v_participant; v_changed:=true;
  elsif p_action='lock_mic' and (not v_participant.mic_locked or not v_participant.mic_muted) then
    update public.live_participants set mic_locked=true,mic_muted=true where id=v_participant.id returning * into v_participant; v_changed:=true;
  elsif p_action='unlock_mic' and v_participant.mic_locked then
    update public.live_participants set mic_locked=false where id=v_participant.id returning * into v_participant; v_changed:=true;
  elsif p_action='grant_floor' and (not v_participant.floor_granted or v_participant.floor_duration_seconds is not null) then
    update public.live_participants set floor_granted=true,floor_started_at=clock_timestamp(),floor_duration_seconds=null where id=v_participant.id returning * into v_participant; v_changed:=true;
  elsif p_action='revoke_floor' and (v_participant.floor_granted or v_participant.floor_started_at is not null) then
    update public.live_participants set floor_granted=false,floor_started_at=null,floor_duration_seconds=null where id=v_participant.id returning * into v_participant; v_changed:=true;
  elsif p_action='timer_start' and (not v_participant.floor_granted or v_participant.floor_duration_seconds is distinct from p_duration_seconds) then
    update public.live_participants set floor_granted=true,floor_started_at=clock_timestamp(),floor_duration_seconds=p_duration_seconds where id=v_participant.id returning * into v_participant; v_changed:=true;
  elsif p_action='timer_stop' and (not v_participant.floor_granted or v_participant.floor_duration_seconds is not null) then
    update public.live_participants set floor_granted=true,floor_started_at=clock_timestamp(),floor_duration_seconds=null where id=v_participant.id returning * into v_participant; v_changed:=true;
  elsif p_action='remove_cohost' then
    update public.live_participants set role='removed',status='active',mic_muted=true,mic_locked=true,camera_enabled=false,
      floor_granted=false,floor_started_at=null,floor_duration_seconds=null
    where id=v_participant.id returning * into v_participant; v_changed:=true;
  end if;

  if v_changed then
    v_payload:=jsonb_build_object('username',coalesce(v_participant.username,'user'));
    if p_action='timer_start' then v_payload:=v_payload||jsonb_build_object('seconds',p_duration_seconds); end if;
    insert into public.live_control_events(session_id,target_user_id,actor_user_id,event_type,payload)
    values(p_session_id,p_target_user_id,v_actor,p_action,v_payload);
  end if;
  return v_participant;
end;
$$;

create or replace function public.live_enforce_participant_timer(
  p_session_id uuid,
  p_target_user_id uuid
)
returns public.live_participants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.live_sessions%rowtype;
  v_participant public.live_participants%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501', message='live_auth_required'; end if;
  select * into v_session from public.live_sessions where id=p_session_id for update;
  if not found or v_session.status<>'live' then raise exception using errcode='55000', message='live_session_not_joinable'; end if;
  if v_actor<>v_session.host_id and v_actor<>p_target_user_id then raise exception using errcode='42501', message='live_timer_enforcement_denied'; end if;
  select * into v_participant from public.live_participants
  where session_id=p_session_id and user_id=p_target_user_id for update;
  if not found or v_participant.status<>'active' or v_participant.role<>'cohost' then
    raise exception using errcode='55000', message='live_cohost_not_active';
  end if;
  if v_participant.floor_started_at is null or v_participant.floor_duration_seconds not in (60,120)
     or clock_timestamp()<v_participant.floor_started_at+make_interval(secs=>v_participant.floor_duration_seconds)
     or v_participant.mic_muted then return v_participant; end if;
  update public.live_participants set mic_muted=true,floor_granted=false
  where id=v_participant.id returning * into v_participant;
  insert into public.live_control_events(session_id,target_user_id,actor_user_id,event_type,payload)
  values(p_session_id,p_target_user_id,v_session.host_id,'mute',
    jsonb_build_object('username',coalesce(v_participant.username,'user'),'reason','timer_expired','seconds',v_participant.floor_duration_seconds));
  return v_participant;
end;
$$;

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

create or replace function public.live_send_message(p_session_id uuid, p_message text)
returns public.live_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_session public.live_sessions%rowtype;
  v_username text;
  v_message text := btrim(p_message);
  v_row public.live_messages%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501', message='live_auth_required'; end if;
  if v_message is null or v_message='' or length(v_message)>200 then raise exception using errcode='22023', message='live_message_invalid'; end if;
  if v_message ~ '[[:cntrl:]]' then raise exception using errcode='22023', message='live_message_invalid'; end if;
  select * into v_session from public.live_sessions where id=p_session_id for share;
  if not found or v_session.status<>'live' then raise exception using errcode='55000', message='live_session_not_joinable'; end if;
  if v_session.host_id<>v_actor and not exists(
    select 1 from public.live_participants p where p.session_id=p_session_id and p.user_id=v_actor and p.status='active'
  ) then raise exception using errcode='42501', message='live_participant_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_session_id::text||':'||v_actor::text||':message',0));
  if exists(select 1 from public.live_messages m where m.session_id=p_session_id and m.user_id=v_actor
    and m.created_at>clock_timestamp()-interval '2 seconds') then
    raise exception using errcode='55000', message='live_message_rate_limited';
  end if;
  select coalesce(nullif(btrim(up.username),''),'user') into v_username from public.user_profiles up where up.id=v_actor;
  insert into public.live_messages(session_id,user_id,username,message)
  values(p_session_id,v_actor,coalesce(v_username,'user'),v_message) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.live_update_session_title(p_session_id uuid, p_title text)
returns public.live_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_title text := btrim(p_title);
  v_session public.live_sessions%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501', message='live_auth_required'; end if;
  if v_title is null or v_title='' or length(v_title)>200 or v_title ~ '[[:cntrl:]]' then
    raise exception using errcode='22023', message='live_title_invalid';
  end if;
  select * into v_session from public.live_sessions where id=p_session_id for update;
  if not found or v_session.status<>'live' then raise exception using errcode='55000', message='live_session_not_joinable'; end if;
  if v_session.host_id<>v_actor then raise exception using errcode='42501', message='live_host_required'; end if;
  if v_session.title is distinct from v_title then
    update public.live_sessions set title=v_title where id=p_session_id returning * into v_session;
  end if;
  return v_session;
end;
$$;

drop function if exists public.increment_live_viewer_count(uuid, integer);

do $$
declare v_policy record;
begin
  for v_policy in
    select schemaname, tablename, policyname from pg_catalog.pg_policies
    where schemaname='public' and tablename in (
      'live_sessions','live_participants','live_control_events','live_messages',
      'live_gift_transactions','gift_catalog'
    )
  loop
    execute format('drop policy %I on %I.%I',v_policy.policyname,v_policy.schemaname,v_policy.tablename);
  end loop;
end;
$$;

alter table public.live_sessions enable row level security;
alter table public.live_participants enable row level security;
alter table public.live_control_events enable row level security;
alter table public.live_messages enable row level security;
alter table public.live_gift_transactions enable row level security;
alter table public.gift_catalog enable row level security;

create policy live_sessions_read on public.live_sessions for select to anon, authenticated using (true);
create policy live_participants_read_authorized on public.live_participants for select to authenticated using (
  user_id=(select auth.uid()) or exists(
    select 1 from public.live_sessions s where s.id=live_participants.session_id and s.host_id=(select auth.uid()) and s.status='live'
  )
);
create policy live_control_events_read_authorized on public.live_control_events for select to authenticated using (
  actor_user_id=(select auth.uid()) or target_user_id=(select auth.uid()) or exists(
    select 1 from public.live_sessions s where s.id=live_control_events.session_id and s.host_id=(select auth.uid()) and s.status='live'
  ) or (
    event_type='reaction' and exists(
      select 1 from public.live_participants p where p.session_id=live_control_events.session_id
        and p.user_id=(select auth.uid()) and p.status='active'
    )
  )
);
create policy live_messages_read_authorized on public.live_messages for select to authenticated using (
  exists(select 1 from public.live_sessions s where s.id=live_messages.session_id and s.host_id=(select auth.uid()))
  or exists(select 1 from public.live_participants p where p.session_id=live_messages.session_id
    and p.user_id=(select auth.uid()) and p.status='active')
);
create policy live_gift_transactions_read_participant on public.live_gift_transactions for select to authenticated using (
  sender_user_id=(select auth.uid()) or receiver_user_id=(select auth.uid()) or exists(
    select 1 from public.live_sessions s where s.id=live_gift_transactions.session_id and s.host_id=(select auth.uid())
  )
);
create policy gift_catalog_read_active on public.gift_catalog for select to authenticated using (active and enabled);

revoke all privileges on table public.live_sessions, public.live_participants,
  public.live_control_events, public.live_messages, public.live_gift_transactions,
  public.gift_catalog from public, anon, authenticated, service_role;
grant select on table public.live_sessions to anon, authenticated, service_role;
grant select on table public.live_participants to authenticated, service_role;
grant select on table public.live_control_events, public.live_messages,
  public.live_gift_transactions, public.gift_catalog to authenticated;

alter function public.start_live_session(uuid,text) set search_path='';
alter function public.heartbeat_live_session(uuid) set search_path='';
alter function public.mark_live_session_disconnected(uuid) set search_path='';
alter function public.end_live_session(uuid,text) set search_path='';
alter function public.recover_host_live_sessions() set search_path='';
alter function public.close_stale_live_sessions() set search_path='';
alter function public.send_live_gift(uuid,text,text) set search_path='';
alter function public.emit_live_gift_control_event() set search_path='';
alter function public.set_live_participants_updated_at() set search_path='';

revoke execute on function public.start_live_session(uuid,text),
  public.heartbeat_live_session(uuid), public.mark_live_session_disconnected(uuid),
  public.end_live_session(uuid,text), public.recover_host_live_sessions(),
  public.close_stale_live_sessions(), public.send_live_gift(uuid,text,text),
  public.emit_live_gift_control_event(), public.set_live_participants_updated_at(),
  public.live_set_participant_presence(uuid,boolean), public.live_request_to_join(uuid),
  public.live_host_invite_participant(uuid,uuid), public.live_respond_to_host_invite(uuid,uuid,boolean),
  public.live_host_decide_join_request(uuid,uuid,boolean),
  public.live_host_control_participant(uuid,uuid,text,integer),
  public.live_enforce_participant_timer(uuid,uuid), public.live_emit_reaction(uuid,text),
  public.live_send_message(uuid,text), public.live_update_session_title(uuid,text)
from public, anon, authenticated, service_role;

grant execute on function public.start_live_session(uuid,text),
  public.heartbeat_live_session(uuid), public.mark_live_session_disconnected(uuid),
  public.end_live_session(uuid,text), public.recover_host_live_sessions(),
  public.send_live_gift(uuid,text,text), public.live_set_participant_presence(uuid,boolean),
  public.live_request_to_join(uuid), public.live_host_invite_participant(uuid,uuid),
  public.live_respond_to_host_invite(uuid,uuid,boolean),
  public.live_host_decide_join_request(uuid,uuid,boolean),
  public.live_host_control_participant(uuid,uuid,text,integer),
  public.live_enforce_participant_timer(uuid,uuid), public.live_emit_reaction(uuid,text),
  public.live_send_message(uuid,text), public.live_update_session_title(uuid,text)
to authenticated;
grant execute on function public.close_stale_live_sessions() to service_role;

commit;
