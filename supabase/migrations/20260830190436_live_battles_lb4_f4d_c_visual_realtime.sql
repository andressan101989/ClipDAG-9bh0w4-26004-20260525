begin;

alter table public.live_battle_public_states
  add column local_battle_side text;

update public.live_battle_public_states as projection
set local_battle_side = case
  when projection.session_id = battle.challenger_session_id
    and projection.local_host_user_id = battle.challenger_user_id
    then 'challenger'
  when projection.session_id = battle.opponent_session_id
    and projection.local_host_user_id = battle.opponent_user_id
    then 'opponent'
  else null
end
from public.live_battles as battle
where battle.id = projection.battle_id;

alter table public.live_battle_public_states
  alter column local_battle_side set not null,
  add constraint live_battle_public_states_local_side_check
    check (local_battle_side in ('challenger', 'opponent')) not valid;

alter table public.live_battle_public_states
  validate constraint live_battle_public_states_local_side_check;

comment on column public.live_battle_public_states.local_battle_side is
  'Canonical side for this observed LIVE session; assigned only by projection synchronization.';

create function private.sync_live_battle_public_local_side()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_battle public.live_battles%rowtype;
begin
  select battle.* into strict v_battle
  from public.live_battles as battle
  where battle.id = new.battle_id;

  if new.session_id = v_battle.challenger_session_id
    and new.local_host_user_id = v_battle.challenger_user_id
    and new.opponent_session_id = v_battle.opponent_session_id
    and new.opponent_host_user_id = v_battle.opponent_user_id
  then
    new.local_battle_side := 'challenger';
  elsif new.session_id = v_battle.opponent_session_id
    and new.local_host_user_id = v_battle.opponent_user_id
    and new.opponent_session_id = v_battle.challenger_session_id
    and new.opponent_host_user_id = v_battle.challenger_user_id
  then
    new.local_battle_side := 'opponent';
  else
    raise exception using
      errcode = '23514',
      message = 'live_battle_public_local_side_mismatch';
  end if;

  return new;
end;
$$;

create trigger live_battle_public_states_sync_local_side
before insert or update on public.live_battle_public_states
for each row execute function private.sync_live_battle_public_local_side();

create or replace function public.get_live_battle_public_snapshot(
  p_session_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'server_now', pg_catalog.clock_timestamp(),
    'state', (
      select pg_catalog.jsonb_build_object(
        'session_id', public_state.session_id,
        'battle_id', public_state.battle_id,
        'opponent_session_id', public_state.opponent_session_id,
        'local_battle_side', public_state.local_battle_side,
        'local_host_user_id', public_state.local_host_user_id,
        'opponent_host_user_id', public_state.opponent_host_user_id,
        'local_host_agora_uid', public_state.local_host_agora_uid,
        'opponent_host_agora_uid', public_state.opponent_host_agora_uid,
        'status', public_state.status,
        'version', public_state.version,
        'scheduled_start_at', public_state.scheduled_start_at,
        'started_at', public_state.started_at,
        'scheduled_end_at', public_state.scheduled_end_at,
        'ended_at', public_state.ended_at,
        'updated_at', public_state.updated_at,
        'challenger_score', public_state.challenger_score,
        'opponent_score', public_state.opponent_score,
        'score_version', public_state.score_version,
        'outcome', public_state.outcome,
        'winner_user_id', public_state.winner_user_id,
        'score_updated_at', public_state.score_updated_at,
        'projection_version', public_state.projection_version,
        'boost_rule_version', public_state.boost_rule_version,
        'rose_target_units', public_state.rose_target_units,
        'challenger_rose_progress_units',
          public_state.challenger_rose_progress_units,
        'opponent_rose_progress_units',
          public_state.opponent_rose_progress_units,
        'challenger_rose_activations_remaining',
          public_state.challenger_rose_activations_remaining,
        'opponent_rose_activations_remaining',
          public_state.opponent_rose_activations_remaining,
        'challenger_glove_uses_remaining',
          public_state.challenger_glove_uses_remaining,
        'opponent_glove_uses_remaining',
          public_state.opponent_glove_uses_remaining,
        'challenger_x2_starts_at', public_state.challenger_x2_starts_at,
        'challenger_x2_expires_at', public_state.challenger_x2_expires_at,
        'opponent_x2_starts_at', public_state.opponent_x2_starts_at,
        'opponent_x2_expires_at', public_state.opponent_x2_expires_at,
        'challenger_x3_starts_at', public_state.challenger_x3_starts_at,
        'challenger_x3_expires_at', public_state.challenger_x3_expires_at,
        'opponent_x3_starts_at', public_state.opponent_x3_starts_at,
        'opponent_x3_expires_at', public_state.opponent_x3_expires_at,
        'power_version', public_state.power_version,
        'power_updated_at', public_state.power_updated_at,
        'server_clock_at', public_state.server_clock_at
      )
      from public.live_battle_public_states as public_state
      where public_state.session_id = p_session_id
    )
  );
$$;

alter function private.sync_live_battle_public_local_side()
  owner to postgres;
alter function public.get_live_battle_public_snapshot(uuid)
  owner to postgres;

revoke all on function private.sync_live_battle_public_local_side()
  from public, anon, authenticated, service_role;
revoke all on function public.get_live_battle_public_snapshot(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_live_battle_public_snapshot(uuid)
  to authenticated;

commit;
