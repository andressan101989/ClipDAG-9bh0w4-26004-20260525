begin;

create function public.get_live_battle_public_snapshot(p_session_id uuid)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'server_now', pg_catalog.clock_timestamp(),
    'state', (
      select pg_catalog.to_jsonb(public_state)
      from public.live_battle_public_states as public_state
      where public_state.session_id = p_session_id
    )
  );
$$;

alter function public.get_live_battle_public_snapshot(uuid) owner to postgres;

revoke all on function public.get_live_battle_public_snapshot(uuid)
from public, anon, authenticated, service_role;

grant execute on function public.get_live_battle_public_snapshot(uuid)
to authenticated;

commit;
