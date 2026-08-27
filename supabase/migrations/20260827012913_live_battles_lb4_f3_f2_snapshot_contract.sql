begin;

create or replace function public.get_live_battle_public_snapshot(p_session_id uuid)
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
        'updated_at', public_state.updated_at
      )
      from public.live_battle_public_states as public_state
      where public_state.session_id = p_session_id
    )
  );
$$;

alter function public.get_live_battle_public_snapshot(uuid)
owner to postgres;

revoke all on function public.get_live_battle_public_snapshot(uuid)
from public, anon, authenticated, service_role;

grant execute on function public.get_live_battle_public_snapshot(uuid)
to authenticated;

commit;
