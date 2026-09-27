begin;

revoke all on function public.record_advertising_interaction_v2(uuid,text,uuid)
  from public, anon, authenticated, service_role;
drop function public.record_advertising_interaction_v2(uuid,text,uuid);

create function public.record_advertising_interaction_v2(
  p_impression_event_id uuid,
  p_event_type text,
  p_event_key uuid,
  p_viewer_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.advertising_event_policy;
  v_parent private.advertising_events;
  v_prior private.advertising_events;
  v_created private.advertising_events;
begin
  if p_viewer_user_id is null then
    raise exception using errcode = '22023', message = 'advertising_viewer_required';
  end if;
  if p_event_type not in ('click','destination_open','video_view','engagement') then
    raise exception using errcode = '22023', message = 'advertising_interaction_type_invalid';
  end if;
  if p_event_key is null then
    raise exception using errcode = '22023', message = 'advertising_event_key_required';
  end if;

  select * into strict v_policy
  from private.advertising_event_policy
  where singleton = true;

  select * into v_parent
  from private.advertising_events
  where id = p_impression_event_id
    and event_type = 'impression';
  if not found then
    raise exception using errcode = '22023', message = 'advertising_parent_impression_required';
  end if;
  if v_parent.viewer_user_id is distinct from p_viewer_user_id then
    raise exception using errcode = '42501', message = 'advertising_interaction_viewer_mismatch';
  end if;

  select * into v_prior
  from private.advertising_events
  where event_key = p_event_key;
  if found then
    if v_prior.event_type <> p_event_type
      or v_prior.parent_impression_event_id <> p_impression_event_id then
      raise exception using errcode = '23505', message = 'advertising_event_idempotency_conflict';
    end if;
    return pg_catalog.to_jsonb(v_prior);
  end if;

  if clock_timestamp() > v_parent.occurred_at
    + pg_catalog.make_interval(hours => v_policy.interaction_max_delay_hours) then
    raise exception using errcode = '22023', message = 'advertising_interaction_window_expired';
  end if;

  insert into private.advertising_events(
    event_key,event_type,ad_id,campaign_id,ad_set_id,creative_version_id,destination_id,
    audience_version_id,placement_selection_version_id,placement_code,viewer_user_id,
    parent_impression_event_id,context_fingerprint
  ) values (
    p_event_key,p_event_type,v_parent.ad_id,v_parent.campaign_id,v_parent.ad_set_id,
    v_parent.creative_version_id,v_parent.destination_id,v_parent.audience_version_id,
    v_parent.placement_selection_version_id,v_parent.placement_code,v_parent.viewer_user_id,
    v_parent.id,v_parent.context_fingerprint
  ) returning * into v_created;
  return pg_catalog.to_jsonb(v_created);
exception when unique_violation then
  select * into v_prior
  from private.advertising_events
  where event_key = p_event_key;
  if not found
    or v_prior.event_type <> p_event_type
    or v_prior.parent_impression_event_id <> p_impression_event_id then
    raise exception using errcode = '23505', message = 'advertising_event_idempotency_conflict';
  end if;
  return pg_catalog.to_jsonb(v_prior);
end;
$$;

revoke all on function public.record_advertising_interaction_v2(uuid,text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.record_advertising_interaction_v2(uuid,text,uuid,uuid)
  to service_role;

notify pgrst, 'reload schema';

commit;
