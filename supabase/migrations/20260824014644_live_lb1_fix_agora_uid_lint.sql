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
begin
  for v_index in 1..length(v_text) loop
    v_hash := mod(v_hash * 31 + ascii(substr(v_text, v_index, 1)), 4294967296);
  end loop;
  return (mod(v_hash, 2147483647) + 1)::integer;
end;
$$;

revoke all on function private.live_agora_uid(uuid)
  from public, anon, authenticated, service_role;
