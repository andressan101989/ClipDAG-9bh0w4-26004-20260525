-- ADS-V2-PLR-11-C1: structural video-view uniqueness and durable message-start evidence.
-- Billing, launch mode, Finance and Chat message persistence authorities remain unchanged.

begin;

do $$
begin
  if exists (
    select 1
    from private.advertising_events event
    where event.event_type='video_view'
    group by event.parent_impression_event_id
    having count(*)>1
  ) then
    raise exception using errcode='23505',message='advertising_video_view_parent_duplicate_preexisting';
  end if;
end;
$$;

create unique index advertising_events_video_view_parent_uidx
on private.advertising_events(parent_impression_event_id)
where event_type='video_view';

create or replace function public.record_advertising_interaction_v2(
  p_impression_event_id uuid,p_event_type text,p_event_key uuid,p_viewer_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_policy private.advertising_event_policy;v_parent private.advertising_events;
  v_prior private.advertising_events;v_created private.advertising_events;
  v_creative_format text;
begin
  if p_viewer_user_id is null then raise exception using errcode='22023',message='advertising_viewer_required';end if;
  if p_event_type not in ('click','destination_open','video_view','engagement') then raise exception using errcode='22023',message='advertising_interaction_type_invalid';end if;
  if p_event_key is null then raise exception using errcode='22023',message='advertising_event_key_required';end if;
  select * into strict v_policy from private.advertising_event_policy where singleton;
  select * into v_parent from private.advertising_events where id=p_impression_event_id and event_type='impression';
  if not found then raise exception using errcode='22023',message='advertising_parent_impression_required';end if;
  if v_parent.viewer_user_id is distinct from p_viewer_user_id then raise exception using errcode='42501',message='advertising_interaction_viewer_mismatch';end if;

  if p_event_type='video_view' then
    select version.format into v_creative_format
    from private.advertising_creative_versions version
    where version.id=v_parent.creative_version_id;
    if v_creative_format is distinct from 'video' then
      raise exception using errcode='22023',message='advertising_video_view_creative_invalid';
    end if;
  end if;

  select * into v_prior from private.advertising_events where event_key=p_event_key;
  if found then
    if v_prior.event_type<>p_event_type or v_prior.parent_impression_event_id<>p_impression_event_id then
      raise exception using errcode='23505',message='advertising_event_idempotency_conflict';
    end if;
    if p_event_type='destination_open' then perform private.advertising_record_profile_visit_for_event_v2(v_prior.id);end if;
    return pg_catalog.to_jsonb(v_prior);
  end if;

  if p_event_type='video_view' then
    select * into v_prior from private.advertising_events
    where parent_impression_event_id=p_impression_event_id and event_type='video_view';
    if found then return pg_catalog.to_jsonb(v_prior);end if;
  end if;

  if pg_catalog.clock_timestamp()>v_parent.occurred_at+pg_catalog.make_interval(hours=>v_policy.interaction_max_delay_hours) then
    raise exception using errcode='22023',message='advertising_interaction_window_expired';
  end if;
  insert into private.advertising_events(
    event_key,event_type,ad_id,campaign_id,ad_set_id,creative_version_id,destination_id,
    audience_version_id,placement_selection_version_id,placement_code,viewer_user_id,
    parent_impression_event_id,context_fingerprint
  ) values(
    p_event_key,p_event_type,v_parent.ad_id,v_parent.campaign_id,v_parent.ad_set_id,
    v_parent.creative_version_id,v_parent.destination_id,v_parent.audience_version_id,
    v_parent.placement_selection_version_id,v_parent.placement_code,v_parent.viewer_user_id,
    v_parent.id,v_parent.context_fingerprint
  ) returning * into v_created;
  if p_event_type='destination_open' then perform private.advertising_record_profile_visit_for_event_v2(v_created.id);end if;
  return pg_catalog.to_jsonb(v_created);
exception when unique_violation then
  select * into v_prior from private.advertising_events where event_key=p_event_key;
  if found then
    if v_prior.event_type<>p_event_type or v_prior.parent_impression_event_id<>p_impression_event_id then
      raise exception using errcode='23505',message='advertising_event_idempotency_conflict';
    end if;
  elsif p_event_type='video_view' then
    select * into v_prior from private.advertising_events
    where parent_impression_event_id=p_impression_event_id and event_type='video_view';
  end if;
  if not found then raise;end if;
  if p_event_type='destination_open' then perform private.advertising_record_profile_visit_for_event_v2(v_prior.id);end if;
  return pg_catalog.to_jsonb(v_prior);
end;
$$;

revoke all on function public.record_advertising_interaction_v2(uuid,text,uuid,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.record_advertising_interaction_v2(uuid,text,uuid,uuid)
to service_role;

create or replace function public.record_advertising_message_start_conversion_v2(
  p_message_id uuid,p_impression_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());v_impression private.advertising_events;
  v_click private.advertising_events;v_destination private.advertising_destinations;
  v_message public.messages;v_first_message public.messages;
  v_policy private.advertising_event_policy;v_objective text;v_touch_at timestamptz;
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required';end if;
  if p_message_id is null or p_impression_event_id is null then raise exception using errcode='22023',message='advertising_message_conversion_input_invalid';end if;
  select * into v_impression from private.advertising_events
  where id=p_impression_event_id and event_type='impression' and viewer_user_id=v_actor;
  if found then
    select objective into v_objective from private.advertising_campaigns where id=v_impression.campaign_id;
    select * into v_destination from private.advertising_destinations where id=v_impression.destination_id;
  end if;
  if not found or v_objective<>'messages' or v_destination.destination_type<>'nelyon_message'
    or v_destination.target_user_id is null then
    raise exception using errcode='42501',message='advertising_message_conversion_context_invalid';
  end if;

  select * into strict v_policy from private.advertising_event_policy where singleton;
  select * into v_message from public.messages
  where id=p_message_id and sender_id=v_actor and recipient_id=v_destination.target_user_id
    and message_type in ('text','image','video','one_time_image','voice')
    and deleted_at is null and created_at>=v_impression.occurred_at;
  if not found then raise exception using errcode='42501',message='advertising_message_conversion_message_invalid';end if;
  if v_message.created_at>v_impression.occurred_at+pg_catalog.make_interval(hours=>v_policy.interaction_max_delay_hours) then
    raise exception using errcode='22023',message='advertising_message_conversion_window_expired';
  end if;

  select * into v_click from private.advertising_events event
  where event.parent_impression_event_id=v_impression.id and event.event_type='click'
    and event.viewer_user_id=v_actor and event.destination_id=v_destination.id
    and event.occurred_at<=v_message.created_at
    and event.occurred_at>=v_message.created_at-pg_catalog.make_interval(hours=>v_policy.click_attribution_window_hours)
  order by event.occurred_at desc,event.id desc limit 1;
  v_touch_at:=case when found then v_click.occurred_at else v_impression.occurred_at end;

  select * into v_first_message from public.messages message
  where message.sender_id=v_actor and message.recipient_id=v_destination.target_user_id
    and message.message_type in ('text','image','video','one_time_image','voice')
    and message.deleted_at is null and message.created_at>=v_touch_at
    and message.created_at<=v_message.created_at
  order by message.created_at,message.id limit 1;
  if not found or v_first_message.id is distinct from v_message.id then
    raise exception using errcode='22023',message='advertising_message_conversion_message_not_first_outbound';
  end if;

  return private.record_advertising_direct_conversion_v2(
    pg_catalog.md5('ads-v2-message-start:'||v_impression.id::text)::uuid,
    'message_start','advertising_impression',v_impression.id,v_actor,
    v_impression.id,v_first_message.created_at
  );
end;
$$;

revoke all on function public.record_advertising_message_start_conversion_v2(uuid,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.record_advertising_message_start_conversion_v2(uuid,uuid)
to authenticated;

commit;
