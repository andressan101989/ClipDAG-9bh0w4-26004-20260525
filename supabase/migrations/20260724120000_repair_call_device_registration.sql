begin;

create or replace function public.repair_call_device_registration(
  p_new_installation_id text,
  p_legacy_installation_id text default null,
  p_platform text default 'ios',
  p_voip_push_token text default null,
  p_expo_push_token text default null,
  p_native_push_token text default null,
  p_app_version text default null,
  p_device_model text default null,
  p_foreground_presentation_version smallint default 0,
  p_terminal_voip_version smallint default 0
)
returns table (
  success boolean,
  device_id uuid,
  token_bound boolean,
  legacy_deactivated boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_new_installation_id text := nullif(trim(p_new_installation_id), '');
  v_legacy_installation_id text := nullif(trim(p_legacy_installation_id), '');
  v_platform text := lower(nullif(trim(p_platform), ''));
  v_voip_push_token text := nullif(trim(p_voip_push_token), '');
  v_expo_push_token text := nullif(trim(p_expo_push_token), '');
  v_native_push_token text := nullif(trim(p_native_push_token), '');
  v_app_version text := nullif(trim(p_app_version), '');
  v_device_model text := nullif(trim(p_device_model), '');
  v_foreground_version smallint := coalesce(p_foreground_presentation_version, 0);
  v_terminal_version smallint := coalesce(p_terminal_voip_version, 0);
  v_device_id uuid;
  v_token_bound boolean := false;
  v_legacy_deactivated boolean := true;
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if v_platform <> 'ios' then raise exception 'invalid platform'; end if;
  if v_new_installation_id is null then raise exception 'new installation_id is required'; end if;
  if v_voip_push_token is null then raise exception 'voip_push_token is required'; end if;
  if v_foreground_version not between 0 and 1 then
    raise exception 'invalid foreground_presentation_version';
  end if;
  if v_terminal_version < 0 then raise exception 'invalid terminal_voip_version'; end if;

  perform pg_advisory_xact_lock(hashtextextended('call-device-user:' || v_user_id::text, 0));
  perform pg_advisory_xact_lock(
    hashtextextended('call-device-installation:' || v_new_installation_id, 0)
  );
  perform pg_advisory_xact_lock(hashtextextended('call-device-voip:' || v_voip_push_token, 0));

  select cd.id
    into v_device_id
    from public.call_devices cd
   where cd.user_id = v_user_id
     and cd.installation_id = v_new_installation_id
   for update;

  if v_device_id is null then
    insert into public.call_devices (
      user_id,
      installation_id,
      platform,
      app_version,
      device_model,
      foreground_presentation_version,
      terminal_voip_version,
      active,
      last_seen_at,
      updated_at
    ) values (
      v_user_id,
      v_new_installation_id,
      v_platform,
      v_app_version,
      v_device_model,
      v_foreground_version,
      v_terminal_version,
      true,
      clock_timestamp(),
      clock_timestamp()
    )
    returning id into v_device_id;
  end if;

  -- Transfer each token under the same advisory locks used by normal device
  -- registration. Historical rows are retained, but a token can only remain
  -- bound to the target installation.
  update public.call_devices cd
     set voip_push_token = null,
         terminal_voip_version = 0,
         active = case
           when cd.expo_push_token is null and cd.native_push_token is null then false
           else cd.active
         end,
         updated_at = clock_timestamp()
   where cd.id <> v_device_id
     and cd.voip_push_token = v_voip_push_token;

  if v_expo_push_token is not null then
    update public.call_devices cd
       set expo_push_token = null,
           active = case
             when cd.native_push_token is null and cd.voip_push_token is null then false
             else cd.active
           end,
           updated_at = clock_timestamp()
     where cd.id <> v_device_id
       and cd.expo_push_token = v_expo_push_token;
  end if;

  if v_native_push_token is not null then
    update public.call_devices cd
       set native_push_token = null,
           active = case
             when cd.expo_push_token is null and cd.voip_push_token is null then false
             else cd.active
           end,
           updated_at = clock_timestamp()
     where cd.id <> v_device_id
       and cd.native_push_token = v_native_push_token;
  end if;

  update public.call_devices cd
     set platform = 'ios',
         expo_push_token = coalesce(v_expo_push_token, cd.expo_push_token),
         native_push_token = coalesce(v_native_push_token, cd.native_push_token),
         voip_push_token = v_voip_push_token,
         app_version = coalesce(v_app_version, cd.app_version),
         device_model = coalesce(v_device_model, cd.device_model),
         foreground_presentation_version = v_foreground_version,
         terminal_voip_version = v_terminal_version,
         active = true,
         last_seen_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where cd.id = v_device_id;

  select exists (
    select 1
      from public.call_devices cd
     where cd.id = v_device_id
       and cd.user_id = v_user_id
       and cd.installation_id = v_new_installation_id
       and cd.active = true
       and cd.platform = 'ios'
       and cd.voip_push_token = v_voip_push_token
       and cd.foreground_presentation_version = v_foreground_version
       and cd.terminal_voip_version = v_terminal_version
  ) into v_token_bound;

  if not v_token_bound then
    raise exception 'token binding verification failed';
  end if;

  if v_legacy_installation_id is not null
     and v_legacy_installation_id <> v_new_installation_id then
    update public.call_devices cd
       set active = false,
           foreground_presentation_version = 0,
           terminal_voip_version = 0,
           updated_at = clock_timestamp()
     where cd.user_id = v_user_id
       and cd.installation_id = v_legacy_installation_id
       and cd.id <> v_device_id;

    select not exists (
      select 1
        from public.call_devices cd
       where cd.user_id = v_user_id
         and cd.installation_id = v_legacy_installation_id
         and cd.active = true
    ) into v_legacy_deactivated;
  end if;

  return query
  select true, v_device_id, v_token_bound, v_legacy_deactivated;
end;
$$;

revoke all on function public.repair_call_device_registration(
  text, text, text, text, text, text, text, text, smallint, smallint
) from public, anon, authenticated;

grant execute on function public.repair_call_device_registration(
  text, text, text, text, text, text, text, text, smallint, smallint
) to authenticated;

commit;
