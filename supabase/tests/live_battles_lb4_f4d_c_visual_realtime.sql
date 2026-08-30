begin;

create temp table lb4_f4d_c_financial_baseline as
select
  (select count(*) from public.gift_catalog) as gift_catalog,
  (select count(*) from public.live_gift_transactions) as gifts,
  (select count(*) from public.financial_transactions) as financial,
  (select count(*) from public.ledger_entries) as ledger,
  (select coalesce(sum(balance), 0) from public.ledger_accounts) as aggregate_balance,
  (select count(*) from public.live_battle_score_events) as score_events,
  (select count(*) from public.live_battle_boost_events) as boost_events;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
) values
('f4dc1000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lb4f4dc-host-a@proof.local','proof',now(),now(),now()),
('f4dc1000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lb4f4dc-host-b@proof.local','proof',now(),now(),now());

insert into public.user_profiles (id, username, display_name, is_admin) values
('f4dc1000-0000-4000-8000-000000000001','lb4f4dc_host_a','LB4-F4D-C host A',false),
('f4dc1000-0000-4000-8000-000000000002','lb4f4dc_host_b','LB4-F4D-C host B',false);

insert into public.live_sessions (
  id, host_id, title, status, viewer_count, started_at, ended_at,
  created_at, last_heartbeat_at, host_disconnected_at, end_reason
) values
('f4dc2000-0000-4000-8000-000000000001','f4dc1000-0000-4000-8000-000000000001','LB4-F4D-C A','live',0,now()-interval '1 minute',null,now()-interval '1 minute',now(),null,null),
('f4dc2000-0000-4000-8000-000000000002','f4dc1000-0000-4000-8000-000000000002','LB4-F4D-C B','live',0,now()-interval '1 minute',null,now()-interval '1 minute',now(),null,null);

insert into public.live_battles (
  id, challenger_user_id, opponent_user_id,
  challenger_session_id, opponent_session_id,
  status, invite_expires_at, accepted_at, countdown_started_at,
  scheduled_start_at, started_at, scheduled_end_at,
  last_transition_actor_id, last_transition_reason,
  version, created_at, updated_at
) values (
  'f4dc3000-0000-4000-8000-000000000001',
  'f4dc1000-0000-4000-8000-000000000001',
  'f4dc1000-0000-4000-8000-000000000002',
  'f4dc2000-0000-4000-8000-000000000001',
  'f4dc2000-0000-4000-8000-000000000002',
  'active', now()-interval '40 seconds', now()-interval '30 seconds',
  now()-interval '23 seconds', now()-interval '20 seconds',
  now()-interval '20 seconds', now()+interval '4 minutes 40 seconds',
  null, 'countdown_elapsed', 4, now()-interval '1 minute', now()
);

do $proof$
begin
  if (select count(*) from public.live_battle_public_states
      where battle_id = 'f4dc3000-0000-4000-8000-000000000001') <> 2
  then raise exception 'f4d_c_projection_pair_failed'; end if;
  if not exists (
    select 1 from public.live_battle_public_states
    where battle_id = 'f4dc3000-0000-4000-8000-000000000001'
      and session_id = 'f4dc2000-0000-4000-8000-000000000001'
      and local_host_user_id = 'f4dc1000-0000-4000-8000-000000000001'
      and local_battle_side = 'challenger'
  ) or not exists (
    select 1 from public.live_battle_public_states
    where battle_id = 'f4dc3000-0000-4000-8000-000000000001'
      and session_id = 'f4dc2000-0000-4000-8000-000000000002'
      and local_host_user_id = 'f4dc1000-0000-4000-8000-000000000002'
      and local_battle_side = 'opponent'
  ) then raise exception 'f4d_c_local_side_mapping_failed'; end if;
end
$proof$;

set local role authenticated;
do $authenticated$
declare
  v_challenger jsonb;
  v_opponent jsonb;
begin
  if (select count(*) from public.live_battle_public_states
      where battle_id = 'f4dc3000-0000-4000-8000-000000000001') <> 2
  then raise exception 'f4d_c_authenticated_projection_read_failed'; end if;
  v_challenger := public.get_live_battle_public_snapshot(
    'f4dc2000-0000-4000-8000-000000000001'
  );
  v_opponent := public.get_live_battle_public_snapshot(
    'f4dc2000-0000-4000-8000-000000000002'
  );
  if v_challenger #>> '{state,local_battle_side}' <> 'challenger'
    or v_opponent #>> '{state,local_battle_side}' <> 'opponent'
  then raise exception 'f4d_c_snapshot_local_side_failed'; end if;
  begin
    update public.live_battle_public_states
    set local_battle_side = 'opponent';
    raise exception 'f4d_c_authenticated_write_allowed';
  exception when insufficient_privilege then null;
  end;
end
$authenticated$;
reset role;

set local role anon;
do $anon$
begin
  begin
    perform 1 from public.live_battle_public_states;
    raise exception 'f4d_c_anon_read_allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_live_battle_public_snapshot(
      'f4dc2000-0000-4000-8000-000000000001'
    );
    raise exception 'f4d_c_anon_snapshot_allowed';
  exception when insufficient_privilege then null;
  end;
end
$anon$;
reset role;

do $economy$
begin
  if exists (
    select 1
    from pg_temp.lb4_f4d_c_financial_baseline as baseline
    where baseline.gift_catalog <> (select count(*) from public.gift_catalog)
      or baseline.gifts <> (select count(*) from public.live_gift_transactions)
      or baseline.financial <> (select count(*) from public.financial_transactions)
      or baseline.ledger <> (select count(*) from public.ledger_entries)
      or baseline.aggregate_balance <> (
        select coalesce(sum(balance), 0) from public.ledger_accounts
      )
      or baseline.score_events <> (select count(*) from public.live_battle_score_events)
      or baseline.boost_events <> (select count(*) from public.live_battle_boost_events)
  ) then raise exception 'f4d_c_economy_changed'; end if;
end
$economy$;

rollback;

do $residue$
begin
  if exists (select 1 from auth.users where email like 'lb4f4dc-%@proof.local')
    or exists (select 1 from public.live_battles where id::text like 'f4dc3000-%')
    or exists (select 1 from public.live_battle_public_states
      where battle_id::text like 'f4dc3000-%')
  then raise exception 'f4d_c_fixture_residue'; end if;
end
$residue$;
