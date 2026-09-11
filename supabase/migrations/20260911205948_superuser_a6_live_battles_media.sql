-- SUPERUSER-A6: canonical LIVE, Battle and Media administrative operations.
-- No roles, capabilities, assignments, financial facts or production domain rows are created.

do $a6_precheck$
begin
  if (select count(*) from private.admin_roles)<>6
     or (select count(*) from private.admin_capabilities)<>47
     or (select count(*) from private.admin_role_capabilities)<>142
     or (select count(*) from private.admin_role_grant_rules)<>7 then
    raise exception 'a6_canonical_catalog_precondition_failed';
  end if;
  if exists(select 1 from private.admin_user_roles where role_code='SUPER_ADMIN' and revoked_at is null) then
    raise exception 'a6_super_admin_precondition_failed';
  end if;
  if (select count(*) from private.admin_capabilities where capability_code in(
    'live.sessions.read','live.sessions.moderate','live.sessions.terminate',
    'battles.sessions.read','battles.sessions.moderate',
    'media.assets.read','media.assets.moderate'
  ))<>7 then
    raise exception 'a6_required_capability_missing';
  end if;
  if exists(select 1 from public.live_sessions where status='live')
     or exists(select 1 from public.live_battles where status in('pending','accepted','countdown','active')) then
    raise exception 'a6_active_runtime_precondition_failed';
  end if;
end
$a6_precheck$;

-- One participant mutator shared by the host and canonical admin wrappers.
create function private.live_apply_participant_control(
  p_session_id uuid,p_target_user_id uuid,p_action text,p_duration_seconds integer,
  p_actor uuid,p_authority text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare
  v_session public.live_sessions%rowtype;
  v_participant public.live_participants%rowtype;
  v_changed boolean:=false;
  v_payload jsonb;
begin
  if p_actor is null or p_session_id is null or p_target_user_id is null
     or p_authority not in('host','admin') then
    raise exception using errcode='22023',message='live_control_input_invalid';
  end if;
  if p_action not in('mute','unmute','lock_mic','unlock_mic','grant_floor','revoke_floor',
                     'timer_start','timer_stop','remove_cohost') then
    raise exception using errcode='22023',message='live_control_action_invalid';
  end if;
  if p_authority='admin' and p_action not in('mute','lock_mic','remove_cohost') then
    raise exception using errcode='42501',message='live_admin_control_action_forbidden';
  end if;
  if (p_action='timer_start' and p_duration_seconds not in(60,120))
     or (p_action<>'timer_start' and p_duration_seconds is not null) then
    raise exception using errcode='22023',message='live_control_duration_invalid';
  end if;
  select * into v_session from public.live_sessions where id=p_session_id for update;
  if not found or v_session.status<>'live' then
    raise exception using errcode='55000',message='live_session_not_joinable';
  end if;
  if p_authority='host' and v_session.host_id<>p_actor then
    raise exception using errcode='42501',message='live_host_required';
  end if;
  if p_target_user_id=v_session.host_id then
    raise exception using errcode='42501',message='live_host_target_forbidden';
  end if;
  select * into v_participant from public.live_participants
  where session_id=p_session_id and user_id=p_target_user_id for update;
  if not found or v_participant.status<>'active' or v_participant.role<>'cohost' then
    raise exception using errcode='55000',message='live_cohost_not_active';
  end if;

  if p_action='mute' and not v_participant.mic_muted then
    update public.live_participants set mic_muted=true
    where id=v_participant.id returning * into v_participant;v_changed:=true;
  elsif p_action='unmute' and v_participant.mic_muted then
    if v_participant.mic_locked then
      raise exception using errcode='55000',message='live_mic_locked';
    end if;
    update public.live_participants set mic_muted=false
    where id=v_participant.id returning * into v_participant;v_changed:=true;
  elsif p_action='lock_mic' and(not v_participant.mic_locked or not v_participant.mic_muted) then
    update public.live_participants set mic_locked=true,mic_muted=true
    where id=v_participant.id returning * into v_participant;v_changed:=true;
  elsif p_action='unlock_mic' and v_participant.mic_locked then
    update public.live_participants set mic_locked=false
    where id=v_participant.id returning * into v_participant;v_changed:=true;
  elsif p_action='grant_floor' and(not v_participant.floor_granted or v_participant.floor_duration_seconds is not null) then
    update public.live_participants set floor_granted=true,floor_started_at=clock_timestamp(),floor_duration_seconds=null
    where id=v_participant.id returning * into v_participant;v_changed:=true;
  elsif p_action='revoke_floor' and(v_participant.floor_granted or v_participant.floor_started_at is not null) then
    update public.live_participants set floor_granted=false,floor_started_at=null,floor_duration_seconds=null
    where id=v_participant.id returning * into v_participant;v_changed:=true;
  elsif p_action='timer_start' and(not v_participant.floor_granted or v_participant.floor_duration_seconds is distinct from p_duration_seconds) then
    update public.live_participants set floor_granted=true,floor_started_at=clock_timestamp(),
      floor_duration_seconds=p_duration_seconds
    where id=v_participant.id returning * into v_participant;v_changed:=true;
  elsif p_action='timer_stop' and(not v_participant.floor_granted or v_participant.floor_duration_seconds is not null) then
    update public.live_participants set floor_granted=true,floor_started_at=clock_timestamp(),floor_duration_seconds=null
    where id=v_participant.id returning * into v_participant;v_changed:=true;
  elsif p_action='remove_cohost' then
    update public.live_participants set role='removed',status='active',mic_muted=true,mic_locked=true,
      camera_enabled=false,floor_granted=false,floor_started_at=null,floor_duration_seconds=null
    where id=v_participant.id returning * into v_participant;v_changed:=true;
  end if;

  if v_changed then
    v_payload:=jsonb_build_object('username',coalesce(v_participant.username,'user'),
      'authority',p_authority);
    if p_action='timer_start' then
      v_payload:=v_payload||jsonb_build_object('seconds',p_duration_seconds);
    end if;
    insert into public.live_control_events(session_id,target_user_id,actor_user_id,event_type,payload)
    values(p_session_id,p_target_user_id,p_actor,p_action,v_payload);
  end if;
  return jsonb_build_object('participant_id',v_participant.id,'session_id',v_participant.session_id,
    'user_id',v_participant.user_id,'role',v_participant.role,'status',v_participant.status,
    'mic_muted',v_participant.mic_muted,'mic_locked',v_participant.mic_locked,
    'camera_enabled',v_participant.camera_enabled,'floor_granted',v_participant.floor_granted,
    'floor_started_at',v_participant.floor_started_at,
    'floor_duration_seconds',v_participant.floor_duration_seconds,'changed',v_changed);
end;
$$;

create or replace function public.live_host_control_participant(
  p_session_id uuid,p_target_user_id uuid,p_action text,p_duration_seconds integer default null
) returns public.live_participants
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_result jsonb;v_participant public.live_participants;
begin
  if v_actor is null then raise exception using errcode='42501',message='live_auth_required';end if;
  v_result:=private.live_apply_participant_control(p_session_id,p_target_user_id,p_action,
    p_duration_seconds,v_actor,'host');
  select * into strict v_participant from public.live_participants
  where id=(v_result->>'participant_id')::uuid;
  return v_participant;
end;
$$;

-- One canonical live-session end mutator shared by host/admin boundaries.
create function private.live_end_session(
  p_session_id uuid,p_actor uuid,p_authority text,p_end_reason text,p_now timestamptz
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_session public.live_sessions%rowtype;v_before text;
begin
  if p_session_id is null or p_actor is null or p_now is null or p_authority not in('host','admin') then
    raise exception using errcode='22023',message='live_end_input_invalid';
  end if;
  select * into v_session from public.live_sessions where id=p_session_id for update;
  if not found then raise exception using errcode='P0002',message='live_session_not_found';end if;
  if p_authority='host' and v_session.host_id<>p_actor then
    raise exception using errcode='42501',message='live_host_required';
  end if;
  if p_authority='admin' and p_end_reason<>'admin_terminated' then
    raise exception using errcode='22023',message='live_admin_end_reason_invalid';
  end if;
  v_before:=v_session.status;
  if v_session.status<>'live' then
    return jsonb_build_object('session_id',v_session.id,'previous_status',v_before,
      'status',v_session.status,'ended_at',v_session.ended_at,'end_reason',v_session.end_reason,
      'result','no_op');
  end if;
  update public.live_sessions set status='ended',ended_at=coalesce(ended_at,p_now),
    end_reason=p_end_reason,
    host_disconnected_at=case when p_end_reason='host_ended' then host_disconnected_at
      else coalesce(host_disconnected_at,p_now) end
  where id=p_session_id returning * into v_session;
  return jsonb_build_object('session_id',v_session.id,'previous_status',v_before,
    'status',v_session.status,'ended_at',v_session.ended_at,'end_reason',v_session.end_reason,
    'result','succeeded');
end;
$$;

create or replace function public.end_live_session(
  p_session_id uuid,p_reason text default 'host_ended'
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_reason text:=coalesce(nullif(btrim(p_reason),''),'host_ended');v_result jsonb;
begin
  if v_actor is null then raise exception using errcode='42501',message='not authenticated';end if;
  if v_reason not in('host_ended','host_disconnected','stale_heartbeat','replaced_by_new_live',
                     'recovered_on_startup','admin_cleanup') then v_reason:='host_ended';end if;
  v_result:=private.live_end_session(p_session_id,v_actor,'host',v_reason,clock_timestamp());
  if (v_result->>'result')='no_op' then
    return jsonb_build_object('ok',true,'already_ended',true,'session_id',p_session_id);
  end if;
  return jsonb_build_object('ok',true,'already_ended',false,'session_id',p_session_id,
    'reason',v_reason);
end;
$$;

-- Extend only the existing transition validator; the state mutation/event/reconciliation stay unchanged.
create or replace function private.live_battle_transition(
  p_battle_id uuid,p_expected_status text,p_next_status text,p_actor_user_id uuid,
  p_reason text,p_now timestamptz
) returns public.live_battles
language plpgsql
set search_path to ''
as $$
declare v_battle public.live_battles%rowtype;v_next_version bigint;
begin
  select battle.* into v_battle from public.live_battles battle
  where battle.id=p_battle_id for update;
  if not found then raise exception using errcode='P0002',message='live_battle_not_found';end if;
  if v_battle.status is distinct from p_expected_status then
    raise exception using errcode='55000',message='live_battle_state_changed';end if;
  if not coalesce(
    (p_expected_status='pending' and p_next_status in('accepted','rejected','cancelled','expired')) or
    (p_expected_status='accepted' and p_next_status in('countdown','cancelled')) or
    (p_expected_status='countdown' and p_next_status in('active','cancelled')) or
    (p_expected_status='active' and p_next_status in('completed','cancelled')),false) then
    raise exception using errcode='55000',message='live_battle_transition_invalid';
  end if;
  if p_next_status='accepted' and(p_actor_user_id is distinct from v_battle.opponent_user_id or p_reason is distinct from 'invite_accepted') then
    raise exception using errcode='42501',message='live_battle_transition_actor_invalid';
  elsif p_next_status='rejected' and(p_actor_user_id is distinct from v_battle.opponent_user_id or p_reason is distinct from 'invite_rejected') then
    raise exception using errcode='42501',message='live_battle_transition_actor_invalid';
  elsif p_next_status='expired' and(p_actor_user_id is not null or p_reason is distinct from 'invite_expired') then
    raise exception using errcode='42501',message='live_battle_transition_actor_invalid';
  elsif p_next_status='countdown' and(p_actor_user_id is null
    or p_actor_user_id not in(v_battle.challenger_user_id,v_battle.opponent_user_id)
    or p_reason is distinct from 'countdown_started') then
    raise exception using errcode='42501',message='live_battle_transition_actor_invalid';
  elsif p_next_status='active' and(p_actor_user_id is not null or p_reason is distinct from 'countdown_elapsed') then
    raise exception using errcode='42501',message='live_battle_transition_actor_invalid';
  elsif p_next_status='completed' and(p_actor_user_id is not null or p_reason is distinct from 'battle_duration_elapsed') then
    raise exception using errcode='42501',message='live_battle_transition_actor_invalid';
  elsif p_next_status='cancelled' and not(
    (p_actor_user_id is not null and p_actor_user_id=v_battle.challenger_user_id and p_reason='challenger_cancelled') or
    (p_actor_user_id is not null and p_actor_user_id=v_battle.opponent_user_id and p_reason='opponent_cancelled') or
    (p_expected_status='accepted' and p_actor_user_id is null and p_reason in('accepted_start_timeout','session_not_live_after_accept')) or
    (p_expected_status='countdown' and p_actor_user_id is null and p_reason='session_not_live_before_start') or
    (p_actor_user_id is not null and p_reason in('admin_cancelled','admin_live_terminated'))
  ) then
    raise exception using errcode='42501',message='live_battle_transition_actor_invalid';
  end if;

  v_next_version:=v_battle.version+1;
  update public.live_battles battle set status=p_next_status,
    accepted_at=case when p_next_status='accepted' then p_now else battle.accepted_at end,
    countdown_started_at=case when p_next_status='countdown' then p_now else battle.countdown_started_at end,
    scheduled_start_at=case when p_next_status='countdown' then p_now+interval '3 seconds' else battle.scheduled_start_at end,
    started_at=case when p_next_status='active' then battle.scheduled_start_at else battle.started_at end,
    scheduled_end_at=case when p_next_status='active' then battle.scheduled_start_at+interval '300 seconds' else battle.scheduled_end_at end,
    ended_at=case when p_next_status='expired' then battle.invite_expires_at
      when p_next_status='completed' then battle.scheduled_end_at
      when p_next_status in('rejected','cancelled') then p_now else battle.ended_at end,
    last_transition_actor_id=p_actor_user_id,last_transition_reason=p_reason,
    version=v_next_version,updated_at=p_now
  where battle.id=p_battle_id and battle.status=p_expected_status and battle.version=v_battle.version
  returning * into v_battle;
  if not found then raise exception using errcode='55000',message='live_battle_state_changed';end if;
  insert into public.live_battle_events(battle_id,actor_user_id,from_status,to_status,reason,version,created_at)
  values(v_battle.id,p_actor_user_id,p_expected_status,p_next_status,p_reason,v_next_version,p_now);
  if p_next_status in('completed','cancelled') then
    perform private.reconcile_live_battle_score_locked(v_battle.id,p_now);
  end if;
  return v_battle;
end;
$$;

create function private.admin_cancel_live_battle_core(
  p_battle_id uuid,p_actor uuid,p_transition_reason text,p_now timestamptz
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_seed public.live_battles%rowtype;v_battle public.live_battles%rowtype;v_before text;
begin
  if p_actor is null or p_battle_id is null or p_now is null
     or p_transition_reason not in('admin_cancelled','admin_live_terminated') then
    raise exception using errcode='22023',message='admin_battle_cancel_invalid';end if;
  select * into v_seed from public.live_battles where id=p_battle_id;
  if not found then raise exception using errcode='P0002',message='live_battle_not_found';end if;
  perform private.live_battle_lock_users(v_seed.challenger_user_id,v_seed.opponent_user_id);
  perform private.live_battle_lock_sessions(v_seed.challenger_session_id,v_seed.opponent_session_id);
  select * into strict v_battle from public.live_battles where id=p_battle_id for update;
  v_before:=v_battle.status;
  v_battle:=private.live_battle_reconcile_locked(v_battle.id,p_now);
  if v_battle.status in('completed','cancelled','rejected','expired') then
    return jsonb_build_object('battle_id',v_battle.id,'previous_status',v_before,
      'final_status',v_battle.status,'series_id',v_battle.series_id,
      'round_number',v_battle.round_number,'result','no_op');
  end if;
  v_before:=v_battle.status;
  v_battle:=private.live_battle_transition(v_battle.id,v_battle.status,'cancelled',
    p_actor,p_transition_reason,p_now);
  return jsonb_build_object('battle_id',v_battle.id,'previous_status',v_before,
    'final_status',v_battle.status,'series_id',v_battle.series_id,
    'round_number',v_battle.round_number,'result','succeeded');
end;
$$;

-- Safe bounded reads.
create function public.search_admin_live_sessions(
  p_query text default null,p_status text default null,p_host_id uuid default null,
  p_cursor_started_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 50
) returns jsonb
language plpgsql stable security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_query text:=nullif(btrim(p_query),'');v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('live.sessions.read');
  if p_status is not null and p_status not in('live','ended') then
    raise exception using errcode='22023',message='admin_live_status_invalid';end if;
  if v_query is not null and char_length(v_query)>120 then
    raise exception using errcode='22023',message='admin_live_query_invalid';end if;
  if (p_cursor_started_at is null)<>(p_cursor_id is null) then
    raise exception using errcode='22023',message='admin_live_cursor_invalid';end if;
  return coalesce((with page as(
    select s.*,p.username,p.display_name,p.avatar_url,
      (select count(*) from public.live_participants lp where lp.session_id=s.id and lp.status='active') active_participant_count,
      (select count(*) from public.live_participants lp where lp.session_id=s.id and lp.status='active' and lp.role='cohost') active_cohost_count,
      (select b.id from public.live_battles b where s.id in(b.challenger_session_id,b.opponent_session_id)
        and b.status in('pending','accepted','countdown','active') order by b.created_at desc limit 1) open_battle_id
    from public.live_sessions s left join public.public_user_profiles p on p.id=s.host_id
    where(p_status is null or s.status=p_status) and(p_host_id is null or s.host_id=p_host_id)
      and(v_query is null or s.id::text=v_query or s.title ilike '%'||v_query||'%'
        or p.username ilike '%'||v_query||'%' or p.display_name ilike '%'||v_query||'%')
      and(p_cursor_started_at is null or(s.started_at,s.id)<(p_cursor_started_at,p_cursor_id))
    order by s.started_at desc,s.id desc limit v_limit
  )select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'host',jsonb_build_object('id',host_id,'username',username,'display_name',display_name,'avatar_url',avatar_url),
    'title',title,'status',status,'viewer_count',viewer_count,'started_at',started_at,'ended_at',ended_at,
    'last_heartbeat_at',last_heartbeat_at,'host_disconnected_at',host_disconnected_at,'end_reason',end_reason,
    'active_participant_count',active_participant_count,'active_cohost_count',active_cohost_count,
    'open_battle_id',open_battle_id)order by started_at desc,id desc),'[]'::jsonb),
    'next_cursor',case when count(*)=v_limit then(select jsonb_build_object('started_at',started_at,'id',id)
      from page order by started_at,id limit 1)else null end)from page),
    jsonb_build_object('items','[]'::jsonb,'next_cursor',null));
end;
$$;

create function public.get_admin_live_session_detail(p_session_id uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_result jsonb;
begin
  perform public.admin_require_capability('live.sessions.read');
  select jsonb_build_object(
    'session',jsonb_build_object('id',s.id,'title',s.title,'status',s.status,'viewer_count',s.viewer_count,
      'started_at',s.started_at,'ended_at',s.ended_at,'last_heartbeat_at',s.last_heartbeat_at,
      'host_disconnected_at',s.host_disconnected_at,'end_reason',s.end_reason),
    'host',jsonb_build_object('id',s.host_id,'username',hp.username,'display_name',hp.display_name,'avatar_url',hp.avatar_url),
    'participants',coalesce((select jsonb_agg(jsonb_build_object('id',lp.id,'user',jsonb_build_object(
      'id',lp.user_id,'username',up.username,'display_name',up.display_name,'avatar_url',up.avatar_url),
      'role',lp.role,'status',lp.status,'mic_muted',lp.mic_muted,'mic_locked',lp.mic_locked,
      'camera_enabled',lp.camera_enabled,'floor_granted',lp.floor_granted,
      'floor_started_at',lp.floor_started_at,'floor_duration_seconds',lp.floor_duration_seconds,
      'created_at',lp.created_at,'updated_at',lp.updated_at)order by lp.created_at,lp.id)
      from public.live_participants lp left join public.public_user_profiles up on up.id=lp.user_id
      where lp.session_id=s.id),'[]'::jsonb),
    'recent_messages',coalesce((select jsonb_agg(x.item order by x.created_at,x.id)from(
      select m.created_at,m.id,jsonb_build_object('id',m.id,'user_id',m.user_id,'username',m.username,
        'message',left(m.message,1000),'created_at',m.created_at)item
      from public.live_messages m where m.session_id=s.id order by m.created_at desc,m.id desc limit 100)x),'[]'::jsonb),
    'battle',coalesce((select jsonb_build_object('id',b.id,'status',b.status,'series_id',b.series_id,
      'round_number',b.round_number,'challenger_user_id',b.challenger_user_id,
      'opponent_user_id',b.opponent_user_id,'started_at',b.started_at,'ended_at',b.ended_at,
      'last_transition_reason',b.last_transition_reason)
      from public.live_battles b where s.id in(b.challenger_session_id,b.opponent_session_id)
      order by(case when b.status in('pending','accepted','countdown','active')then 0 else 1 end),b.created_at desc limit 1),null)
  ) into v_result from public.live_sessions s
  left join public.public_user_profiles hp on hp.id=s.host_id where s.id=p_session_id;
  if v_result is null then raise exception using errcode='P0002',message='admin_live_session_not_found';end if;
  return v_result;
end;
$$;

create function public.search_admin_live_battles(
  p_query text default null,p_status text default null,p_participant_user_id uuid default null,
  p_series_id uuid default null,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_query text:=nullif(btrim(p_query),'');v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('battles.sessions.read');
  if p_status is not null and p_status not in('pending','accepted','countdown','active','completed','rejected','cancelled','expired') then
    raise exception using errcode='22023',message='admin_battle_status_invalid';end if;
  if v_query is not null and char_length(v_query)>120 then
    raise exception using errcode='22023',message='admin_battle_query_invalid';end if;
  if (p_cursor_created_at is null)<>(p_cursor_id is null) then
    raise exception using errcode='22023',message='admin_battle_cursor_invalid';end if;
  return coalesce((with page as(
    select b.*,cp.username c_username,cp.display_name c_display_name,cp.avatar_url c_avatar_url,
      op.username o_username,op.display_name o_display_name,op.avatar_url o_avatar_url,
      sc.challenger_score,sc.opponent_score,sc.outcome,sc.winner_user_id
    from public.live_battles b
    left join public.public_user_profiles cp on cp.id=b.challenger_user_id
    left join public.public_user_profiles op on op.id=b.opponent_user_id
    left join public.live_battle_score_states sc on sc.battle_id=b.id
    where(p_status is null or b.status=p_status)
      and(p_participant_user_id is null or p_participant_user_id in(b.challenger_user_id,b.opponent_user_id))
      and(p_series_id is null or b.series_id=p_series_id)
      and(v_query is null or b.id::text=v_query or b.series_id::text=v_query
        or cp.username ilike '%'||v_query||'%' or cp.display_name ilike '%'||v_query||'%'
        or op.username ilike '%'||v_query||'%' or op.display_name ilike '%'||v_query||'%')
      and(p_cursor_created_at is null or(b.created_at,b.id)<(p_cursor_created_at,p_cursor_id))
    order by b.created_at desc,b.id desc limit v_limit
  )select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'status',status,'series_id',series_id,'round_number',round_number,
    'challenger',jsonb_build_object('id',challenger_user_id,'username',c_username,'display_name',c_display_name,'avatar_url',c_avatar_url),
    'opponent',jsonb_build_object('id',opponent_user_id,'username',o_username,'display_name',o_display_name,'avatar_url',o_avatar_url),
    'challenger_session_id',challenger_session_id,'opponent_session_id',opponent_session_id,
    'created_at',created_at,'accepted_at',accepted_at,'started_at',started_at,'ended_at',ended_at,
    'last_transition_reason',last_transition_reason,'challenger_score',coalesce(challenger_score,0),
    'opponent_score',coalesce(opponent_score,0),'outcome',coalesce(outcome,'pending'),
    'winner_user_id',winner_user_id)order by created_at desc,id desc),'[]'::jsonb),
    'next_cursor',case when count(*)=v_limit then(select jsonb_build_object('created_at',created_at,'id',id)
      from page order by created_at,id limit 1)else null end)from page),
    jsonb_build_object('items','[]'::jsonb,'next_cursor',null));
end;
$$;

create function public.get_admin_live_battle_detail(p_battle_id uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_result jsonb;
begin
  perform public.admin_require_capability('battles.sessions.read');
  select jsonb_build_object(
    'battle',jsonb_build_object('id',b.id,'status',b.status,'series_id',b.series_id,'round_number',b.round_number,
      'challenger_session_id',b.challenger_session_id,'opponent_session_id',b.opponent_session_id,
      'invite_expires_at',b.invite_expires_at,'accepted_at',b.accepted_at,
      'countdown_started_at',b.countdown_started_at,'scheduled_start_at',b.scheduled_start_at,
      'started_at',b.started_at,'scheduled_end_at',b.scheduled_end_at,'ended_at',b.ended_at,
      'last_transition_reason',b.last_transition_reason,'version',b.version,'created_at',b.created_at,'updated_at',b.updated_at),
    'challenger',jsonb_build_object('id',b.challenger_user_id,'username',cp.username,'display_name',cp.display_name,'avatar_url',cp.avatar_url),
    'opponent',jsonb_build_object('id',b.opponent_user_id,'username',op.username,'display_name',op.display_name,'avatar_url',op.avatar_url),
    'sessions',jsonb_build_array(
      jsonb_build_object('id',cs.id,'title',cs.title,'status',cs.status,'started_at',cs.started_at,'ended_at',cs.ended_at),
      jsonb_build_object('id',os.id,'title',os.title,'status',os.status,'started_at',os.started_at,'ended_at',os.ended_at)),
    'score',case when sc.battle_id is null then null else jsonb_build_object(
      'challenger_score',sc.challenger_score,'opponent_score',sc.opponent_score,'score_version',sc.score_version,
      'outcome',sc.outcome,'winner_user_id',sc.winner_user_id,'finalized_at',sc.finalized_at,'updated_at',sc.updated_at)end,
    'public_state',case when ps.battle_id is null then null else jsonb_build_object(
      'status',ps.status,'version',ps.version,'outcome',ps.outcome,'winner_user_id',ps.winner_user_id,
      'projection_version',ps.projection_version,'series_status',ps.series_status,'series_version',ps.series_version)end,
    'series',case when sr.id is null then null else jsonb_build_object('id',sr.id,'format',sr.format,
      'max_rounds',sr.max_rounds,'wins_required',sr.wins_required,'status',sr.status,
      'challenger_wins',sr.challenger_wins,'opponent_wins',sr.opponent_wins,'ties',sr.ties,
      'rounds_completed',sr.rounds_completed,'champion_user_id',sr.champion_user_id,'version',sr.version)end,
    'gift_count',(select count(*) from public.live_gift_transactions g where g.battle_id=b.id),
    'like_event_count',(select count(*) from public.live_battle_like_score_events l where l.battle_id=b.id),
    'events',coalesce((select jsonb_agg(e.item order by e.created_at,e.id)from(
      select ev.created_at,ev.id,jsonb_build_object('from_status',ev.from_status,'to_status',ev.to_status,
        'reason',ev.reason,'version',ev.version,'created_at',ev.created_at)item
      from public.live_battle_events ev where ev.battle_id=b.id
      order by ev.created_at desc,ev.id desc limit 100)e),'[]'::jsonb)
  ) into v_result from public.live_battles b
  left join public.public_user_profiles cp on cp.id=b.challenger_user_id
  left join public.public_user_profiles op on op.id=b.opponent_user_id
  left join public.live_sessions cs on cs.id=b.challenger_session_id
  left join public.live_sessions os on os.id=b.opponent_session_id
  left join public.live_battle_score_states sc on sc.battle_id=b.id
  left join public.live_battle_public_states ps on ps.battle_id=b.id and ps.session_id=b.challenger_session_id
  left join public.live_battle_series sr on sr.id=b.series_id
  where b.id=p_battle_id;
  if v_result is null then raise exception using errcode='P0002',message='admin_battle_not_found';end if;
  return v_result;
end;
$$;

create function public.search_admin_media_assets(
  p_query text default null,p_status text default null,p_visibility text default null,
  p_provider text default null,p_media_kind text default null,p_purpose text default null,
  p_link_state text default null,p_owner_id uuid default null,
  p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 50
) returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_query text:=nullif(btrim(p_query),'');v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('media.assets.read');
  if p_status is not null and p_status not in('pending','uploading','ready','failed','delete_pending','deleted') then
    raise exception using errcode='22023',message='admin_media_status_invalid';end if;
  if p_visibility is not null and p_visibility not in('public','private') then
    raise exception using errcode='22023',message='admin_media_visibility_invalid';end if;
  if p_link_state is not null and p_link_state not in('linked','unlinked') then
    raise exception using errcode='22023',message='admin_media_link_state_invalid';end if;
  if v_query is not null and(char_length(v_query)>36 or v_query!~*'^[0-9a-f-]+$') then
    raise exception using errcode='22023',message='admin_media_query_invalid';end if;
  if (p_cursor_created_at is null)<>(p_cursor_id is null) then
    raise exception using errcode='22023',message='admin_media_cursor_invalid';end if;
  return coalesce((with page as(
    select a.*,p.username,p.display_name,p.avatar_url,
      public.media_asset_has_valid_links(a.id) has_valid_links,
      (select count(*) from public.media_asset_links l where l.asset_id=a.id) link_count
    from public.media_assets a left join public.public_user_profiles p on p.id=a.owner_id
    where(v_query is null or a.id::text=v_query) and(p_status is null or a.status=p_status)
      and(p_visibility is null or a.visibility=p_visibility) and(p_provider is null or a.provider=p_provider)
      and(p_media_kind is null or a.media_kind=p_media_kind) and(p_purpose is null or a.purpose=p_purpose)
      and(p_owner_id is null or a.owner_id=p_owner_id)
      and(p_link_state is null or(p_link_state='linked')=public.media_asset_has_valid_links(a.id))
      and(p_cursor_created_at is null or(a.created_at,a.id)<(p_cursor_created_at,p_cursor_id))
    order by a.created_at desc,a.id desc limit v_limit
  )select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'owner',jsonb_build_object('id',owner_id,'username',username,'display_name',display_name,'avatar_url',avatar_url),
    'provider',provider,'media_kind',media_kind,'purpose',purpose,'visibility',visibility,'status',status,
    'mime_type',mime_type,'size_bytes',size_bytes,'width',width,'height',height,'duration_ms',duration_ms,
    'error_code',error_code,'cleanup_attempts',cleanup_attempts,'created_at',created_at,'updated_at',updated_at,
    'ready_at',ready_at,'deleted_at',deleted_at,'has_valid_links',has_valid_links,'link_count',link_count,
    'public_url',case when visibility='public' and status='ready' and public_url~*'^https://' then public_url end)
    order by created_at desc,id desc),'[]'::jsonb),
    'next_cursor',case when count(*)=v_limit then(select jsonb_build_object('created_at',created_at,'id',id)
      from page order by created_at,id limit 1)else null end)from page),
    jsonb_build_object('items','[]'::jsonb,'next_cursor',null));
end;
$$;

create function public.get_admin_media_asset_detail(p_asset_id uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_result jsonb;
begin
  perform public.admin_require_capability('media.assets.read');
  select jsonb_build_object('id',a.id,'owner',jsonb_build_object('id',a.owner_id,'username',p.username,
    'display_name',p.display_name,'avatar_url',p.avatar_url),'provider',a.provider,'media_kind',a.media_kind,
    'purpose',a.purpose,'visibility',a.visibility,'status',a.status,'mime_type',a.mime_type,
    'size_bytes',a.size_bytes,'width',a.width,'height',a.height,'duration_ms',a.duration_ms,
    'error_code',a.error_code,'cleanup_attempts',a.cleanup_attempts,
    'last_cleanup_attempt_at',a.last_cleanup_attempt_at,'next_cleanup_attempt_at',a.next_cleanup_attempt_at,
    'created_at',a.created_at,'updated_at',a.updated_at,'ready_at',a.ready_at,'deleted_at',a.deleted_at,
    'has_valid_links',public.media_asset_has_valid_links(a.id),
    'public_url',case when a.visibility='public' and a.status='ready' and a.public_url~*'^https://' then a.public_url end,
    'links',coalesce((select jsonb_agg(jsonb_build_object('entity_type',l.entity_type,'entity_id',l.entity_id,
      'slot',l.slot,'position',l.position,'is_cover',l.is_cover)order by l.created_at,l.id)
      from public.media_asset_links l where l.asset_id=a.id),'[]'::jsonb))
  into v_result from public.media_assets a left join public.public_user_profiles p on p.id=a.owner_id
  where a.id=p_asset_id;
  if v_result is null then raise exception using errcode='P0002',message='admin_media_asset_not_found';end if;
  return v_result;
end;
$$;

-- Human administrative mutations use the one global audit as their idempotency envelope.
create function public.admin_moderate_live_participant(
  p_session_id uuid,p_target_user_id uuid,p_action text,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid;v_reason text:=nullif(btrim(p_reason),'');v_scope text;v_fingerprint text;
  v_existing private.admin_action_audit;v_core jsonb;v_receipt jsonb;v_outcome text;
begin
  v_actor:=public.admin_require_capability('live.sessions.moderate');
  if p_session_id is null or p_target_user_id is null or p_idempotency_key is null
     or p_action not in('mute','lock_mic','remove_cohost') or v_reason is null
     or char_length(v_reason) not between 2 and 500 then
    raise exception using errcode='22023',message='admin_live_moderation_invalid';end if;
  v_scope:='v1|human|'||v_actor::text||'|live.sessions.moderate|live.participant.'||p_action;
  v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object('contract_version',1,
    'actor_kind','human_admin','actor_id',v_actor,'capability','live.sessions.moderate',
    'action','live.participant.'||p_action,'session_id',p_session_id,
    'target_user_id',p_target_user_id,'reason',v_reason));
  perform pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_idempotency_key::text,0));
  select * into v_existing from private.admin_action_audit
  where actor_id=v_actor and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';end if;
    return v_existing.metadata->'receipt';
  end if;
  v_core:=private.live_apply_participant_control(p_session_id,p_target_user_id,p_action,null,v_actor,'admin');
  v_outcome:=case when(v_core->>'changed')::boolean then 'succeeded' else 'no_op' end;
  v_receipt:=jsonb_build_object('session_id',p_session_id,'target_user_id',p_target_user_id,
    'action',p_action,'result',v_outcome,'participant',v_core-'changed');
  insert into private.admin_action_audit(actor_id,actor_kind,actor_role_snapshot,actor_capability,
    domain,action,target_type,target_id,target_ref,reason,outcome,financial_effect,contains_pii,
    metadata,idempotency_scope,idempotency_key,request_fingerprint)
  values(v_actor,'human_admin',private.admin_active_role_codes(v_actor),'live.sessions.moderate',
    'live','live.participant.'||p_action,'live_participant',p_target_user_id,p_session_id::text,
    v_reason,v_outcome,false,false,jsonb_build_object('receipt',v_receipt),v_scope,p_idempotency_key,v_fingerprint);
  return v_receipt;
end;
$$;

create function public.admin_cancel_live_battle(
  p_battle_id uuid,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid;v_reason text:=nullif(btrim(p_reason),'');v_scope text;v_fingerprint text;
  v_existing private.admin_action_audit;v_receipt jsonb;v_outcome text;
begin
  v_actor:=public.admin_require_capability('battles.sessions.moderate');
  if p_battle_id is null or p_idempotency_key is null or v_reason is null
     or char_length(v_reason) not between 2 and 500 then
    raise exception using errcode='22023',message='admin_battle_cancel_invalid';end if;
  v_scope:='v1|human|'||v_actor::text||'|battles.sessions.moderate|battle.cancel';
  v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object('contract_version',1,
    'actor_kind','human_admin','actor_id',v_actor,'capability','battles.sessions.moderate',
    'action','battle.cancel','target_type','live_battle','target_id',p_battle_id,'reason',v_reason));
  perform pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_idempotency_key::text,0));
  select * into v_existing from private.admin_action_audit
  where actor_id=v_actor and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';end if;
    return v_existing.metadata->'receipt';
  end if;
  v_receipt:=private.admin_cancel_live_battle_core(p_battle_id,v_actor,'admin_cancelled',clock_timestamp());
  v_outcome:=v_receipt->>'result';
  insert into private.admin_action_audit(actor_id,actor_kind,actor_role_snapshot,actor_capability,
    domain,action,target_type,target_id,target_ref,reason,outcome,financial_effect,contains_pii,
    metadata,idempotency_scope,idempotency_key,request_fingerprint)
  values(v_actor,'human_admin',private.admin_active_role_codes(v_actor),'battles.sessions.moderate',
    'battles','battle.cancel','live_battle',p_battle_id,null,v_reason,v_outcome,false,false,
    jsonb_build_object('receipt',v_receipt),v_scope,p_idempotency_key,v_fingerprint);
  return v_receipt;
end;
$$;

create function public.admin_terminate_live_session(
  p_session_id uuid,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid;v_reason text:=nullif(btrim(p_reason),'');v_scope text;v_fingerprint text;
  v_existing private.admin_action_audit;v_live jsonb;v_receipt jsonb;v_outcome text;
  v_battle record;v_battle_receipt jsonb;v_cancelled jsonb:='[]'::jsonb;v_b_scope text;
  v_b_fingerprint text;v_b_idempotency_key uuid;
begin
  v_actor:=public.admin_require_capability('live.sessions.terminate');
  if p_session_id is null or p_idempotency_key is null or v_reason is null
     or char_length(v_reason) not between 2 and 500 then
    raise exception using errcode='22023',message='admin_live_termination_invalid';end if;
  v_scope:='v1|human|'||v_actor::text||'|live.sessions.terminate|live.terminate';
  v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object('contract_version',1,
    'actor_kind','human_admin','actor_id',v_actor,'capability','live.sessions.terminate',
    'action','live.terminate','target_type','live_session','target_id',p_session_id,'reason',v_reason));
  perform pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_idempotency_key::text,0));
  select * into v_existing from private.admin_action_audit
  where actor_id=v_actor and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';end if;
    return v_existing.metadata->'receipt';
  end if;
  if not exists(select 1 from public.live_sessions where id=p_session_id) then
    raise exception using errcode='P0002',message='admin_live_session_not_found';end if;
  for v_battle in select id from public.live_battles
    where p_session_id in(challenger_session_id,opponent_session_id)
      and status in('pending','accepted','countdown','active') order by id
  loop
    v_battle_receipt:=private.admin_cancel_live_battle_core(v_battle.id,v_actor,'admin_live_terminated',clock_timestamp());
    v_cancelled:=v_cancelled||jsonb_build_array(v_battle_receipt);
    v_b_scope:='v1|human|'||v_actor::text||'|live.sessions.terminate|battle.cancel:'||v_battle.id::text;
    v_b_fingerprint:=private.admin_request_fingerprint(jsonb_build_object('contract_version',1,
      'actor_kind','human_admin','actor_id',v_actor,'capability','live.sessions.terminate',
      'action','battle.cancel','target_type','live_battle','target_id',v_battle.id,
      'source_session_id',p_session_id,'reason',v_reason));
    -- The evolved audit also preserves its legacy actor+key uniqueness contract.
    -- Derive one stable child key so a termination can audit each canonical Battle
    -- cancellation without colliding with the parent command receipt.
    v_b_idempotency_key:=md5(p_idempotency_key::text||':battle:'||v_battle.id::text)::uuid;
    insert into private.admin_action_audit(actor_id,actor_kind,actor_role_snapshot,actor_capability,
      domain,action,target_type,target_id,target_ref,reason,outcome,financial_effect,contains_pii,
      metadata,idempotency_scope,idempotency_key,request_fingerprint)
    values(v_actor,'human_admin',private.admin_active_role_codes(v_actor),'live.sessions.terminate',
      'battles','battle.cancel','live_battle',v_battle.id,p_session_id::text,v_reason,
      v_battle_receipt->>'result',false,false,jsonb_build_object('receipt',v_battle_receipt,
        'transition_reason','admin_live_terminated'),v_b_scope,v_b_idempotency_key,v_b_fingerprint);
  end loop;
  v_live:=private.live_end_session(p_session_id,v_actor,'admin','admin_terminated',clock_timestamp());
  v_outcome:=v_live->>'result';
  v_receipt:=v_live||jsonb_build_object('cancelled_battles',v_cancelled);
  insert into private.admin_action_audit(actor_id,actor_kind,actor_role_snapshot,actor_capability,
    domain,action,target_type,target_id,target_ref,reason,outcome,financial_effect,contains_pii,
    metadata,idempotency_scope,idempotency_key,request_fingerprint)
  values(v_actor,'human_admin',private.admin_active_role_codes(v_actor),'live.sessions.terminate',
    'live','live.terminate','live_session',p_session_id,null,v_reason,v_outcome,false,false,
    jsonb_build_object('receipt',v_receipt),v_scope,p_idempotency_key,v_fingerprint);
  return v_receipt;
end;
$$;

-- A5 admin-hidden Chat media remains linked evidence; ordinary deleted messages do not.
create or replace function public.media_asset_has_valid_links(p_asset_id uuid)
returns boolean language sql stable security definer
set search_path to 'pg_catalog','private','public'
as $$
  select exists(select 1 from public.media_asset_links l join public.media_assets a on a.id=l.asset_id
  where l.asset_id=p_asset_id and(
    (l.entity_type='user_profile' and exists(select 1 from public.user_profiles u
      where u.id=l.entity_id and u.avatar_url=a.public_url))
    or(l.entity_type='video_post' and exists(select 1 from public.videos v where v.id=l.entity_id))
    or(l.entity_type='story' and exists(select 1 from public.stories s where s.id=l.entity_id and s.expires_at>now()))
    or(l.entity_type='shop_product' and exists(select 1 from public.products p where p.id=l.entity_id and p.status<>'deleted'))
    or(l.entity_type='marketplace_store' and exists(select 1 from public.marketplace_stores s where s.id=l.entity_id
      and((l.slot='logo' and s.logo_asset_id=l.asset_id)or(l.slot='banner' and s.banner_asset_id=l.asset_id))))
    or(l.entity_type='marketplace_dispute' and l.slot in('buyer_evidence','seller_evidence')
      and exists(select 1 from public.marketplace_order_disputes d where d.id=l.entity_id))
    or(l.entity_type='marketplace_return_shipment' and l.slot='return_label'
      and exists(select 1 from public.marketplace_return_shipments rs
        where rs.id=l.entity_id and rs.return_label_asset_id=l.asset_id))
    or(l.entity_type='chat_message' and l.slot='content' and exists(select 1 from public.messages m
      where m.id=l.entity_id and m.media_asset_id=l.asset_id and(
        m.deleted_at is null or exists(select 1 from private.admin_content_moderation_actions ma
          where ma.target_type='chat_message' and ma.target_id=m.id and ma.action='hide'))))
  ));
$$;

create function public.admin_schedule_media_cleanup(
  p_asset_id uuid,p_action text,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid;v_reason text:=nullif(btrim(p_reason),'');v_scope text;v_fingerprint text;
  v_existing private.admin_action_audit;v_asset public.media_assets%rowtype;v_result text;v_receipt jsonb;
begin
  v_actor:=public.admin_require_capability('media.assets.moderate');
  if p_asset_id is null or p_action not in('schedule_cleanup','retry_cleanup')
     or p_idempotency_key is null or v_reason is null or char_length(v_reason) not between 2 and 500 then
    raise exception using errcode='22023',message='admin_media_cleanup_invalid';end if;
  v_scope:='v1|human|'||v_actor::text||'|media.assets.moderate|media.cleanup.'||
    case when p_action='schedule_cleanup'then'schedule'else'retry'end;
  v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object('contract_version',1,
    'actor_kind','human_admin','actor_id',v_actor,'capability','media.assets.moderate',
    'action',p_action,'target_type','media_asset','target_id',p_asset_id,'reason',v_reason));
  perform pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_idempotency_key::text,0));
  select * into v_existing from private.admin_action_audit
  where actor_id=v_actor and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';end if;
    return v_existing.metadata->'receipt';
  end if;
  select * into v_asset from public.media_assets where id=p_asset_id for update;
  if not found then raise exception using errcode='P0002',message='admin_media_asset_not_found';end if;
  if v_asset.status='deleted' then
    v_result:='no_op';
  elsif public.media_asset_has_valid_links(v_asset.id) then
    raise exception using errcode='55000',message='asset_in_use';
  elsif p_action='schedule_cleanup' then
    if public.schedule_media_asset_deletion(v_asset.id,v_asset.owner_id)<>'scheduled' then
      raise exception using errcode='55000',message='admin_media_schedule_failed';end if;
    v_result:='succeeded';
  elsif v_asset.status<>'delete_pending' then
    raise exception using errcode='55000',message='admin_media_retry_state_invalid';
  else
    update public.media_assets set next_cleanup_attempt_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=v_asset.id and status='delete_pending';
    v_result:='succeeded';
  end if;
  select * into v_asset from public.media_assets where id=p_asset_id;
  v_receipt:=jsonb_build_object('asset_id',p_asset_id,'action',p_action,'result',v_result,
    'status',v_asset.status,'cleanup_attempts',v_asset.cleanup_attempts,
    'next_cleanup_attempt_at',v_asset.next_cleanup_attempt_at);
  insert into private.admin_action_audit(actor_id,actor_kind,actor_role_snapshot,actor_capability,
    domain,action,target_type,target_id,target_ref,reason,outcome,financial_effect,contains_pii,
    metadata,idempotency_scope,idempotency_key,request_fingerprint)
  values(v_actor,'human_admin',private.admin_active_role_codes(v_actor),'media.assets.moderate',
    'media','media.cleanup.'||case when p_action='schedule_cleanup'then'schedule'else'retry'end,
    'media_asset',p_asset_id,null,v_reason,v_result,false,false,jsonb_build_object('receipt',v_receipt),
    v_scope,p_idempotency_key,v_fingerprint);
  return v_receipt;
end;
$$;

-- Private cores are never runtime APIs.
revoke all on function private.live_apply_participant_control(uuid,uuid,text,integer,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function private.live_end_session(uuid,uuid,text,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function private.admin_cancel_live_battle_core(uuid,uuid,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function private.live_battle_transition(uuid,text,text,uuid,text,timestamptz)
  from public,anon,authenticated,service_role;

-- Human/public boundaries: authenticated entry, exact capability enforced server-side.
revoke all on function public.search_admin_live_sessions(text,text,uuid,timestamptz,uuid,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.get_admin_live_session_detail(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.admin_moderate_live_participant(uuid,uuid,text,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.admin_terminate_live_session(uuid,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.search_admin_live_battles(text,text,uuid,uuid,timestamptz,uuid,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.get_admin_live_battle_detail(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.admin_cancel_live_battle(uuid,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.search_admin_media_assets(text,text,text,text,text,text,text,uuid,timestamptz,uuid,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.get_admin_media_asset_detail(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.admin_schedule_media_cleanup(uuid,text,text,uuid)
  from public,anon,authenticated,service_role;

grant execute on function public.search_admin_live_sessions(text,text,uuid,timestamptz,uuid,integer) to authenticated;
grant execute on function public.get_admin_live_session_detail(uuid) to authenticated;
grant execute on function public.admin_moderate_live_participant(uuid,uuid,text,text,uuid) to authenticated;
grant execute on function public.admin_terminate_live_session(uuid,text,uuid) to authenticated;
grant execute on function public.search_admin_live_battles(text,text,uuid,uuid,timestamptz,uuid,integer) to authenticated;
grant execute on function public.get_admin_live_battle_detail(uuid) to authenticated;
grant execute on function public.admin_cancel_live_battle(uuid,text,uuid) to authenticated;
grant execute on function public.search_admin_media_assets(text,text,text,text,text,text,text,uuid,timestamptz,uuid,integer) to authenticated;
grant execute on function public.get_admin_media_asset_detail(uuid) to authenticated;
grant execute on function public.admin_schedule_media_cleanup(uuid,text,text,uuid) to authenticated;

-- Preserve existing host and service lifecycle ACLs after CREATE OR REPLACE.
revoke all on function public.live_host_control_participant(uuid,uuid,text,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.live_host_control_participant(uuid,uuid,text,integer) to authenticated;
revoke all on function public.end_live_session(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.end_live_session(uuid,text) to authenticated;
revoke all on function public.media_asset_has_valid_links(uuid) from public,anon,authenticated,service_role;
grant execute on function public.media_asset_has_valid_links(uuid) to service_role;

do $a6_postcheck$
begin
  if (select count(*) from private.admin_roles)<>6
     or (select count(*) from private.admin_capabilities)<>47
     or (select count(*) from private.admin_role_capabilities)<>142
     or (select count(*) from private.admin_role_grant_rules)<>7 then
    raise exception 'a6_catalog_changed';end if;
  if exists(select 1 from private.admin_user_roles where role_code='SUPER_ADMIN' and revoked_at is null) then
    raise exception 'a6_super_admin_created';end if;
  if exists(select 1 from public.live_sessions where status='live')
     or exists(select 1 from public.live_battles where status in('pending','accepted','countdown','active')) then
    raise exception 'a6_deploy_mutated_runtime';end if;
end
$a6_postcheck$;
