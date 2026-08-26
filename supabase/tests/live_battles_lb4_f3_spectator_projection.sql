begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values
('41000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lb4f3-host-a@proof.local','proof',now(),now(),now()),
('41000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lb4f3-host-b@proof.local','proof',now(),now(),now());

insert into public.user_profiles (id, username, display_name, is_admin) values
('41000000-0000-4000-8000-000000000001','lb4f3_host_a','LB4-F3 host A',false),
('41000000-0000-4000-8000-000000000002','lb4f3_host_b','LB4-F3 host B',false);

insert into public.live_sessions (
  id, host_id, title, status, viewer_count, started_at, ended_at,
  created_at, last_heartbeat_at, host_disconnected_at, end_reason
) values
('42000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','LB4-F3 A','live',0,'2026-08-26 12:00:00+00',null,'2026-08-26 12:00:00+00','2026-08-26 12:00:00+00',null,null),
('42000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000002','LB4-F3 B','live',0,'2026-08-26 12:00:00+00',null,'2026-08-26 12:00:00+00','2026-08-26 12:00:00+00',null,null);

-- Private invitation states never produce rows.
insert into public.live_battles (
  id, challenger_user_id, opponent_user_id,
  challenger_session_id, opponent_session_id,
  status, invite_expires_at, last_transition_actor_id,
  last_transition_reason, version, created_at, updated_at
) values (
  '43000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000002',
  '42000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000002',
  'pending','2026-08-26 12:00:30+00',
  '41000000-0000-4000-8000-000000000001',
  'invite_created',1,'2026-08-26 12:00:00+00','2026-08-26 12:00:00+00'
);

do $$
begin
  if exists (
    select 1 from public.live_battle_public_states
    where battle_id = '43000000-0000-4000-8000-000000000001'
  ) then raise exception 'pending_projected'; end if;
end;
$$;

update public.live_battles
set status='accepted', accepted_at='2026-08-26 12:00:01+00',
    last_transition_actor_id='41000000-0000-4000-8000-000000000002',
    last_transition_reason='invite_accepted', version=2,
    updated_at='2026-08-26 12:00:01+00'
where id='43000000-0000-4000-8000-000000000001';

do $$
begin
  if exists (
    select 1 from public.live_battle_public_states
    where battle_id = '43000000-0000-4000-8000-000000000001'
  ) then raise exception 'accepted_projected'; end if;
end;
$$;

update public.live_battles
set status='cancelled', ended_at='2026-08-26 12:00:02+00',
    last_transition_actor_id='41000000-0000-4000-8000-000000000001',
    last_transition_reason='challenger_cancelled', version=3,
    updated_at='2026-08-26 12:00:02+00'
where id='43000000-0000-4000-8000-000000000001';

do $$
begin
  if exists (
    select 1 from public.live_battle_public_states
    where battle_id = '43000000-0000-4000-8000-000000000001'
  ) then raise exception 'pre_countdown_cancel_projected'; end if;
end;
$$;

-- Rejected and expired remain private.
insert into public.live_battles (
  id, challenger_user_id, opponent_user_id, challenger_session_id, opponent_session_id,
  status, invite_expires_at, ended_at, last_transition_actor_id,
  last_transition_reason, version, created_at, updated_at
) values
('43000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000002','42000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000002','rejected','2026-08-26 12:01:30+00','2026-08-26 12:01:02+00','41000000-0000-4000-8000-000000000002','invite_rejected',2,'2026-08-26 12:01:00+00','2026-08-26 12:01:02+00'),
('43000000-0000-4000-8000-000000000003','41000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000002','42000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000002','expired','2026-08-26 12:02:30+00','2026-08-26 12:02:30+00',null,'invite_expired',2,'2026-08-26 12:02:00+00','2026-08-26 12:02:30+00');

do $$
begin
  if exists (
    select 1 from public.live_battle_public_states
    where battle_id in (
      '43000000-0000-4000-8000-000000000002',
      '43000000-0000-4000-8000-000000000003'
    )
  ) then raise exception 'rejected_or_expired_projected'; end if;
end;
$$;

-- Countdown creates exactly two symmetric rows using canonical UIDs.
insert into public.live_battles (
  id, challenger_user_id, opponent_user_id, challenger_session_id, opponent_session_id,
  status, invite_expires_at, accepted_at, countdown_started_at, scheduled_start_at,
  last_transition_actor_id, last_transition_reason, version, created_at, updated_at
) values (
  '43000000-0000-4000-8000-000000000004',
  '41000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000002',
  '42000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000002',
  'countdown','2026-08-26 12:03:30+00','2026-08-26 12:03:01+00',
  '2026-08-26 12:03:02+00','2026-08-26 12:03:05+00',
  '41000000-0000-4000-8000-000000000001','countdown_started',3,
  '2026-08-26 12:03:00+00','2026-08-26 12:03:02+00'
);

do $$
begin
  if (select count(*) from public.live_battle_public_states where battle_id='43000000-0000-4000-8000-000000000004') <> 2
    then raise exception 'countdown_not_symmetric'; end if;
  if not exists (
    select 1 from public.live_battle_public_states a
    join public.live_battle_public_states b
      on b.battle_id=a.battle_id and b.session_id=a.opponent_session_id
    where a.session_id='42000000-0000-4000-8000-000000000001'
      and b.opponent_session_id=a.session_id
      and a.local_host_user_id=b.opponent_host_user_id
      and a.opponent_host_user_id=b.local_host_user_id
      and a.local_host_agora_uid=private.live_agora_uid(a.local_host_user_id)
      and a.opponent_host_agora_uid=private.live_agora_uid(a.opponent_host_user_id)
      and b.local_host_agora_uid=private.live_agora_uid(b.local_host_user_id)
      and b.opponent_host_agora_uid=private.live_agora_uid(b.opponent_host_user_id)
  ) then raise exception 'projection_direction_or_uid_invalid'; end if;
end;
$$;

-- A repeated or lower version cannot regress either row.
update public.live_battles
set version=2, updated_at='2026-08-26 12:03:01+00'
where id='43000000-0000-4000-8000-000000000004';

do $$
begin
  if exists (
    select 1 from public.live_battle_public_states
    where battle_id='43000000-0000-4000-8000-000000000004' and version<>3
  ) then raise exception 'projection_version_regressed'; end if;
end;
$$;

update public.live_battles
set version=4, updated_at='2026-08-26 12:03:03+00'
where id='43000000-0000-4000-8000-000000000004';
update public.live_battles
set version=4, updated_at=updated_at
where id='43000000-0000-4000-8000-000000000004';

do $$
begin
  if (select count(*) from public.live_battle_public_states where battle_id='43000000-0000-4000-8000-000000000004' and version=4)<>2
    then raise exception 'projection_retry_not_idempotent'; end if;
end;
$$;

-- Active and completed update both rows together.
update public.live_battles
set status='active', started_at=scheduled_start_at,
    scheduled_end_at=scheduled_start_at+interval '300 seconds',
    last_transition_actor_id=null,last_transition_reason='countdown_elapsed',
    version=5,updated_at='2026-08-26 12:03:05+00'
where id='43000000-0000-4000-8000-000000000004';

do $$
begin
  if (select count(*) from public.live_battle_public_states where battle_id='43000000-0000-4000-8000-000000000004' and status='active' and version=5)<>2
    then raise exception 'active_projection_invalid'; end if;
end;
$$;

update public.live_battles
set status='completed',ended_at=scheduled_end_at,
    last_transition_actor_id=null,last_transition_reason='battle_duration_elapsed',
    version=6,updated_at=scheduled_end_at
where id='43000000-0000-4000-8000-000000000004';

do $$
begin
  if (select count(*) from public.live_battle_public_states where battle_id='43000000-0000-4000-8000-000000000004' and status='completed' and version=6)<>2
    then raise exception 'completed_projection_invalid'; end if;
end;
$$;

-- A new Battle remains private until countdown, then replaces both terminal rows.
insert into public.live_battles (
  id, challenger_user_id, opponent_user_id, challenger_session_id, opponent_session_id,
  status, invite_expires_at, accepted_at, countdown_started_at, scheduled_start_at,
  last_transition_actor_id, last_transition_reason, version, created_at, updated_at
) values (
  '43000000-0000-4000-8000-000000000005',
  '41000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000002',
  '42000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000002',
  'countdown','2026-08-26 12:10:30+00','2026-08-26 12:10:01+00',
  '2026-08-26 12:10:02+00','2026-08-26 12:10:05+00',
  '41000000-0000-4000-8000-000000000001','countdown_started',3,
  '2026-08-26 12:10:00+00','2026-08-26 12:10:02+00'
);

do $$
begin
  if (select count(*) from public.live_battle_public_states where battle_id='43000000-0000-4000-8000-000000000005')<>2
    or exists (select 1 from public.live_battle_public_states where battle_id='43000000-0000-4000-8000-000000000004')
    then raise exception 'terminal_projection_not_replaced'; end if;
end;
$$;

update public.live_battles
set status='cancelled',ended_at='2026-08-26 12:10:04+00',
    last_transition_actor_id='41000000-0000-4000-8000-000000000002',
    last_transition_reason='opponent_cancelled',version=4,
    updated_at='2026-08-26 12:10:04+00'
where id='43000000-0000-4000-8000-000000000005';

do $$
begin
  if (select count(*) from public.live_battle_public_states where battle_id='43000000-0000-4000-8000-000000000005' and status='cancelled')<>2
    then raise exception 'post_countdown_cancel_projection_invalid'; end if;
  if exists (
    select battle_id from public.live_battle_public_states
    where battle_id='43000000-0000-4000-8000-000000000005'
    group by battle_id having count(*)<>2
  ) then raise exception 'one_sided_projection_exists'; end if;
end;
$$;

-- Client roles have SELECT-only access, and only while the observed LIVE remains active.
set local role authenticated;
do $$
begin
  begin
    insert into public.live_battle_public_states (
      session_id,battle_id,opponent_session_id,local_host_user_id,opponent_host_user_id,
      local_host_agora_uid,opponent_host_agora_uid,status,version,updated_at
    ) values (
      '42000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000005',
      '42000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000001',
      '41000000-0000-4000-8000-000000000002',1,2,'cancelled',4,now()
    );
    raise exception 'authenticated_insert_allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.live_battle_public_states set version=99;
    raise exception 'authenticated_update_allowed';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.live_battle_public_states;
    raise exception 'authenticated_delete_allowed';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.live_battle_public_states where session_id='42000000-0000-4000-8000-000000000001')<>1
    then raise exception 'authenticated_observable_live_read_denied'; end if;
end;
$$;
reset role;

set local role anon;
do $$
begin
  begin
    perform 1 from public.live_battle_public_states;
    raise exception 'anon_select_allowed';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;

update public.live_sessions
set status='ended',ended_at='2026-08-26 12:11:00+00',end_reason='host_ended'
where id='42000000-0000-4000-8000-000000000001';

set local role authenticated;
do $$
begin
  if exists (
    select 1 from public.live_battle_public_states
    where session_id='42000000-0000-4000-8000-000000000001'
  ) then raise exception 'ended_session_projection_readable'; end if;
end;
$$;
reset role;

do $$
begin
  if has_function_privilege('anon','private.sync_live_battle_public_states()','EXECUTE')
    or has_function_privilege('authenticated','private.sync_live_battle_public_states()','EXECUTE')
    or has_function_privilege('service_role','private.sync_live_battle_public_states()','EXECUTE')
    then raise exception 'projection_helper_client_acl'; end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='sync_live_battle_public_states'
      and p.proowner='postgres'::regrole
      and p.proconfig @> array['search_path=""']
  ) then raise exception 'projection_helper_hardening_invalid'; end if;
  if (select count(*) from pg_publication p
      join pg_publication_rel pr on pr.prpubid=p.oid
      where p.pubname='supabase_realtime'
        and pr.prrelid='public.live_battle_public_states'::regclass)<>1
    then raise exception 'projection_realtime_publication_invalid'; end if;
  if exists (
    select 1 from pg_publication p join pg_publication_rel pr on pr.prpubid=p.oid
    where p.pubname='supabase_realtime'
      and pr.prrelid='public.live_battle_events'::regclass
  ) then raise exception 'battle_events_published'; end if;
end;
$$;

rollback;

do $$
begin
  if exists (select 1 from auth.users where email like 'lb4f3-%@proof.local')
    or exists (select 1 from public.live_battles where id::text like '43000000-%')
    or exists (select 1 from public.live_battle_public_states where battle_id::text like '43000000-%')
    then raise exception 'lb4_f3_fixture_cleanup_failed'; end if;
end;
$$;
