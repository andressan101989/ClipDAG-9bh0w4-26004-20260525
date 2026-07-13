begin;

create or replace function public.register_call_device(
  p_installation_id text,
  p_platform text,
  p_expo_push_token text default null,
  p_native_push_token text default null,
  p_voip_push_token text default null,
  p_app_version text default null,
  p_device_model text default null
)
returns table (
  device_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_installation_id text := nullif(trim(p_installation_id), '');
  v_platform text := lower(nullif(trim(p_platform), ''));
  v_expo_push_token text := nullif(trim(p_expo_push_token), '');
  v_native_push_token text := nullif(trim(p_native_push_token), '');
  v_voip_push_token text := nullif(trim(p_voip_push_token), '');
  v_app_version text := nullif(trim(p_app_version), '');
  v_device_model text := nullif(trim(p_device_model), '');
  v_device_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if v_installation_id is null then
    raise exception 'installation_id is required';
  end if;

  if v_platform not in ('ios', 'android') then
    raise exception 'invalid platform';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('call-device-installation:' || v_installation_id, 0)
  );

  if v_expo_push_token is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('call-device-expo:' || v_expo_push_token, 0)
    );
  end if;

  if v_native_push_token is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('call-device-native:' || v_native_push_token, 0)
    );
  end if;

  if v_voip_push_token is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('call-device-voip:' || v_voip_push_token, 0)
    );
  end if;

  select cd.id
    into v_device_id
    from public.call_devices as cd
   where cd.user_id = v_user_id
     and cd.installation_id = v_installation_id
   for update;

  if v_device_id is null then
    insert into public.call_devices (
      user_id,
      installation_id,
      platform,
      app_version,
      device_model,
      active,
      last_seen_at,
      updated_at
    )
    values (
      v_user_id,
      v_installation_id,
      v_platform,
      v_app_version,
      v_device_model,
      true,
      now(),
      now()
    )
    returning id into v_device_id;
  end if;

  if v_expo_push_token is not null then
    update public.call_devices as cd
       set expo_push_token = null,
           active = case
             when cd.native_push_token is null
              and cd.voip_push_token is null
             then false
             else cd.active
           end,
           updated_at = now()
     where cd.id <> v_device_id
       and cd.expo_push_token = v_expo_push_token;
  end if;

  if v_native_push_token is not null then
    update public.call_devices as cd
       set native_push_token = null,
           active = case
             when cd.expo_push_token is null
              and cd.voip_push_token is null
             then false
             else cd.active
           end,
           updated_at = now()
     where cd.id <> v_device_id
       and cd.native_push_token = v_native_push_token;
  end if;

  if v_voip_push_token is not null then
    update public.call_devices as cd
       set voip_push_token = null,
           active = case
             when cd.expo_push_token is null
              and cd.native_push_token is null
             then false
             else cd.active
           end,
           updated_at = now()
     where cd.id <> v_device_id
       and cd.voip_push_token = v_voip_push_token;
  end if;

  update public.call_devices as cd
     set platform = v_platform,
         expo_push_token = coalesce(v_expo_push_token, cd.expo_push_token),
         native_push_token = coalesce(v_native_push_token, cd.native_push_token),
         voip_push_token = coalesce(v_voip_push_token, cd.voip_push_token),
         app_version = coalesce(v_app_version, cd.app_version),
         device_model = coalesce(v_device_model, cd.device_model),
         active = true,
         last_seen_at = now(),
         updated_at = now()
   where cd.id = v_device_id;

  return query select v_device_id;
end;
$$;

revoke all
on function public.register_call_device(text, text, text, text, text, text, text)
from public, anon, authenticated;

grant execute
on function public.register_call_device(text, text, text, text, text, text, text)
to authenticated;

commit;
