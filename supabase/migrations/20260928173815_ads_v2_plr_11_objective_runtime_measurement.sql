-- ADS-V2-PLR-11: truthful objective runtime and measurement contracts.
-- Billing remains restricted to impression/click and production remains DISARMED.

begin;

alter table private.advertising_objective_capabilities
  add column primary_metric text,
  add column availability_reason text;

alter table private.advertising_objective_capabilities
  add constraint advertising_objective_capabilities_primary_metric_chk check (
    primary_metric is null or primary_metric in (
      'impressions','unique_reach','clicks','qualified_interactions','video_views',
      'profile_visits','message_starts','app_store_opens','attributed_conversions'
    )
  );

update private.advertising_objective_capabilities as capability
set capability_version='nelyon-ads-objective-capabilities-v2',
    status=matrix.status,
    setup_enabled=matrix.setup_enabled,
    delivery_runtime_ready=matrix.delivery_ready,
    billing_runtime_ready=matrix.billing_ready,
    conversion_runtime_ready=matrix.conversion_ready,
    billable_event_type=matrix.billable_event_type,
    primary_metric=matrix.primary_metric,
    availability_reason=matrix.availability_reason,
    updated_at=pg_catalog.clock_timestamp()
from (values
  ('awareness','supported',true,true,true,false,'impression','impressions',null),
  ('reach','supported',true,true,true,false,'impression','unique_reach',null),
  ('traffic','supported',true,true,true,false,'click','clicks',null),
  ('engagement','supported',true,true,true,false,'click','qualified_interactions',null),
  ('video_views','supported',true,true,true,false,'impression','video_views',null),
  ('profile_visits','supported',true,true,true,true,'click','profile_visits',null),
  ('messages','supported',true,true,true,true,'click','message_starts',null),
  ('app_promotion','supported',true,true,true,false,'click','app_store_opens','App-store visits are measured; installs are not measured.'),
  ('marketplace_sales','supported',true,true,true,true,'click','attributed_conversions',null),
  ('website_conversions','not_available',false,false,false,false,null,null,'Website conversion tracking is not configured yet.')
) as matrix(objective,status,setup_enabled,delivery_ready,billing_ready,conversion_ready,billable_event_type,primary_metric,availability_reason)
where capability.objective=matrix.objective;

alter table private.advertising_objective_capabilities
  add constraint advertising_objective_capabilities_v2_shape_chk check (
    (status='supported' and setup_enabled and delivery_runtime_ready
      and billing_runtime_ready and billable_event_type in ('impression','click')
      and primary_metric is not null)
    or
    (status='not_available' and not setup_enabled and not delivery_runtime_ready
      and not billing_runtime_ready and not conversion_runtime_ready
      and billable_event_type is null and primary_metric is null
      and availability_reason is not null)
  );

alter table private.advertising_destinations
  drop constraint advertising_destinations_type_chk,
  drop constraint advertising_destinations_target_xor_chk;

alter table private.advertising_destinations
  add constraint advertising_destinations_type_chk check (destination_type in (
    'external_url','nelyon_profile','nelyon_message','business_account',
    'marketplace_product','marketplace_store'
  )),
  add constraint advertising_destinations_target_xor_chk check (
    (destination_type='external_url'
      and external_url is not null and target_user_id is null
      and target_business_account_id is null and target_product_id is null and target_store_id is null)
    or
    (destination_type in ('nelyon_profile','nelyon_message')
      and external_url is null and target_user_id is not null
      and target_business_account_id is null and target_product_id is null and target_store_id is null)
    or
    (destination_type='business_account'
      and external_url is null and target_user_id is null
      and target_business_account_id is not null and target_product_id is null and target_store_id is null)
    or
    (destination_type='marketplace_product'
      and external_url is null and target_user_id is null
      and target_business_account_id is null and target_product_id is not null and target_store_id is null)
    or
    (destination_type='marketplace_store'
      and external_url is null and target_user_id is null
      and target_business_account_id is null and target_product_id is null and target_store_id is not null)
  );

create or replace function private.advertising_app_store_url_valid(p_url text)
returns boolean
language sql
immutable
security definer
set search_path=''
as $$
  select p_url is not null
    and p_url=pg_catalog.btrim(p_url)
    and p_url ~* '^https://(apps[.]apple[.]com|play[.]google[.]com)(/[^[:space:]]*)?$'
$$;

revoke all on function private.advertising_app_store_url_valid(text)
from public,anon,authenticated,service_role;

create or replace function private.advertising_objective_destination_valid(
  p_objective text,p_destination_type text,p_external_url text,
  p_target_user_id uuid,p_target_business_account_id uuid,
  p_target_product_id uuid,p_target_store_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select case
    when p_objective='website_conversions' then false
    when p_objective='profile_visits' then p_destination_type='nelyon_profile' and p_target_user_id is not null
    when p_objective='messages' then p_destination_type='nelyon_message' and p_target_user_id is not null
    when p_objective='app_promotion' then p_destination_type='external_url'
      and private.advertising_app_store_url_valid(p_external_url)
    when p_objective='marketplace_sales' then p_destination_type in ('marketplace_product','marketplace_store')
      and ((p_destination_type='marketplace_product' and p_target_product_id is not null)
        or (p_destination_type='marketplace_store' and p_target_store_id is not null))
    else p_destination_type in ('external_url','nelyon_profile','business_account','marketplace_product','marketplace_store')
  end
$$;

revoke all on function private.advertising_objective_destination_valid(text,text,text,uuid,uuid,uuid,uuid)
from public,anon,authenticated,service_role;

create or replace function private.advertising_validate_destination_draft(
  p_actor uuid,p_business_account_id uuid,p_destination_type text,p_external_url text,
  p_target_user_id uuid,p_target_business_account_id uuid,p_target_product_id uuid,p_target_store_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  case p_destination_type
    when 'external_url' then
      if p_external_url is null or p_external_url !~* '^https://[^[:space:]]+$'
        or p_target_user_id is not null or p_target_business_account_id is not null
        or p_target_product_id is not null or p_target_store_id is not null then
        raise exception using errcode='22023',message='advertising_destination_external_url_invalid';
      end if;
    when 'nelyon_profile','nelyon_message' then
      if p_target_user_id is distinct from p_actor or p_external_url is not null
        or p_target_business_account_id is not null or p_target_product_id is not null
        or p_target_store_id is not null then
        raise exception using errcode='42501',message=case p_destination_type
          when 'nelyon_message' then 'advertising_destination_message_access_denied'
          else 'advertising_destination_profile_access_denied' end;
      end if;
    when 'business_account' then
      if p_target_business_account_id is distinct from p_business_account_id or p_external_url is not null
        or p_target_user_id is not null or p_target_product_id is not null or p_target_store_id is not null then
        raise exception using errcode='42501',message='advertising_destination_business_access_denied';
      end if;
    when 'marketplace_product' then
      if p_external_url is not null or p_target_user_id is not null or p_target_business_account_id is not null
        or p_target_product_id is null or p_target_store_id is not null or not exists (
          select 1 from private.business_account_marketplace_links link
          join public.marketplace_sellers seller on seller.user_id=link.marketplace_seller_user_id and seller.status='approved'
          join public.products product on product.id=p_target_product_id
            and product.seller_id=link.marketplace_seller_user_id and product.deleted_at is null
          join public.marketplace_stores store on store.id=product.store_id and store.seller_id=link.marketplace_seller_user_id
          where link.business_account_id=p_business_account_id
        ) then raise exception using errcode='42501',message='advertising_destination_marketplace_product_access_denied';end if;
    when 'marketplace_store' then
      if p_external_url is not null or p_target_user_id is not null or p_target_business_account_id is not null
        or p_target_product_id is not null or p_target_store_id is null or not exists (
          select 1 from private.business_account_marketplace_links link
          join public.marketplace_sellers seller on seller.user_id=link.marketplace_seller_user_id and seller.status='approved'
          join public.marketplace_stores store on store.id=p_target_store_id and store.seller_id=link.marketplace_seller_user_id
          where link.business_account_id=p_business_account_id
        ) then raise exception using errcode='42501',message='advertising_destination_marketplace_store_access_denied';end if;
    else raise exception using errcode='22023',message='advertising_destination_type_invalid';
  end case;
end;
$$;

revoke all on function private.advertising_validate_destination_draft(uuid,uuid,text,text,uuid,uuid,uuid,uuid)
from public,anon,authenticated,service_role;

create or replace function public.create_my_advertising_destination_draft(
  p_campaign_id uuid,p_destination_type text,p_idempotency_key uuid,
  p_external_url text default null,p_target_user_id uuid default null,
  p_target_business_account_id uuid default null,p_target_product_id uuid default null,
  p_target_store_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());v_type text:=pg_catalog.lower(pg_catalog.btrim(p_destination_type));
  v_url text:=pg_catalog.btrim(p_external_url);v_target_user_id uuid:=p_target_user_id;
  v_context record;v_row private.advertising_destinations;v_objective text;
begin
  if v_actor is null then raise exception using errcode='42501',message='advertising_auth_required';end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_actor) then raise exception using errcode='42501',message='advertising_adult_eligibility_required';end if;
  if p_idempotency_key is null then raise exception using errcode='22023',message='advertising_idempotency_key_required';end if;
  select * into strict v_context from private.ads_require_owned_draft_campaign(v_actor,p_campaign_id);
  select objective into strict v_objective from private.advertising_campaigns where id=p_campaign_id;
  if v_type in ('nelyon_profile','nelyon_message') and v_target_user_id is null then v_target_user_id:=v_actor;end if;
  perform private.advertising_validate_destination_draft(v_actor,v_context.business_account_id,v_type,v_url,v_target_user_id,p_target_business_account_id,p_target_product_id,p_target_store_id);
  if not private.advertising_objective_destination_valid(v_objective,v_type,v_url,v_target_user_id,p_target_business_account_id,p_target_product_id,p_target_store_id) then
    raise exception using errcode='22023',message='advertising_objective_destination_invalid',detail=v_objective;
  end if;
  insert into private.advertising_destinations(
    campaign_id,destination_type,external_url,target_user_id,target_business_account_id,
    target_product_id,target_store_id,status,creation_idempotency_key,created_by
  ) values(
    p_campaign_id,v_type,v_url,v_target_user_id,p_target_business_account_id,
    p_target_product_id,p_target_store_id,'draft',p_idempotency_key,v_actor
  ) on conflict(campaign_id,creation_idempotency_key)do nothing returning * into v_row;
  if v_row.id is null then
    select * into strict v_row from private.advertising_destinations
    where campaign_id=p_campaign_id and creation_idempotency_key=p_idempotency_key;
    if v_row.destination_type is distinct from v_type or v_row.external_url is distinct from v_url
      or v_row.target_user_id is distinct from v_target_user_id
      or v_row.target_business_account_id is distinct from p_target_business_account_id
      or v_row.target_product_id is distinct from p_target_product_id
      or v_row.target_store_id is distinct from p_target_store_id or v_row.created_by is distinct from v_actor then
      raise exception using errcode='23505',message='advertising_destination_idempotency_conflict';
    end if;
  end if;
  return pg_catalog.jsonb_build_object(
    'id',v_row.id,'campaign_id',v_row.campaign_id,'destination_type',v_row.destination_type,
    'external_url',v_row.external_url,'target_user_id',v_row.target_user_id,
    'target_business_account_id',v_row.target_business_account_id,'target_product_id',v_row.target_product_id,
    'target_store_id',v_row.target_store_id,'status',v_row.status,'created_at',v_row.created_at
  );
end;
$$;

create or replace function public.update_my_advertising_destination_draft(
  p_destination_id uuid,p_destination_type text,p_expected_updated_at timestamptz,p_idempotency_key uuid,
  p_external_url text default null,p_target_user_id uuid default null,p_target_business_account_id uuid default null,
  p_target_product_id uuid default null,p_target_store_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());v_type text:=pg_catalog.lower(pg_catalog.btrim(p_destination_type));
  v_url text:=pg_catalog.btrim(p_external_url);v_target_user_id uuid:=p_target_user_id;
  v_campaign_id uuid;v_row private.advertising_destinations;v_context record;v_objective text;
begin
  if v_actor is null then raise exception using errcode='42501',message='advertising_auth_required';end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_actor) then raise exception using errcode='42501',message='advertising_adult_eligibility_required';end if;
  if p_idempotency_key is null then raise exception using errcode='22023',message='advertising_idempotency_key_required';end if;
  select campaign_id into v_campaign_id from private.advertising_destinations where id=p_destination_id;
  if v_campaign_id is null then raise exception using errcode='P0002',message='advertising_destination_not_found';end if;
  select * into strict v_context from private.ads_require_owned_draft_campaign(v_actor,v_campaign_id);
  select objective into strict v_objective from private.advertising_campaigns where id=v_campaign_id;
  select * into v_row from private.advertising_destinations where id=p_destination_id for update;
  if v_row.id is null or v_row.campaign_id is distinct from v_campaign_id then raise exception using errcode='P0002',message='advertising_destination_not_found';end if;
  if v_row.status<>'draft' then raise exception using errcode='42501',message='advertising_destination_draft_access_denied';end if;
  if v_type in ('nelyon_profile','nelyon_message') and v_target_user_id is null then v_target_user_id:=v_actor;end if;
  if v_row.destination_type is not distinct from v_type and v_row.external_url is not distinct from v_url
    and v_row.target_user_id is not distinct from v_target_user_id
    and v_row.target_business_account_id is not distinct from p_target_business_account_id
    and v_row.target_product_id is not distinct from p_target_product_id
    and v_row.target_store_id is not distinct from p_target_store_id then
    return pg_catalog.to_jsonb(v_row);
  end if;
  if exists(select 1 from private.advertising_ads ad where ad.destination_id=v_row.id) then raise exception using errcode='55000',message='advertising_destination_in_use';end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then raise exception using errcode='40001',message='advertising_destination_draft_stale';end if;
  perform private.advertising_validate_destination_draft(v_actor,v_context.business_account_id,v_type,v_url,v_target_user_id,p_target_business_account_id,p_target_product_id,p_target_store_id);
  if not private.advertising_objective_destination_valid(v_objective,v_type,v_url,v_target_user_id,p_target_business_account_id,p_target_product_id,p_target_store_id) then
    raise exception using errcode='22023',message='advertising_objective_destination_invalid',detail=v_objective;
  end if;
  update private.advertising_destinations set destination_type=v_type,external_url=v_url,
    target_user_id=v_target_user_id,target_business_account_id=p_target_business_account_id,
    target_product_id=p_target_product_id,target_store_id=p_target_store_id
  where id=v_row.id returning * into v_row;
  return pg_catalog.to_jsonb(v_row);
end;
$$;

revoke all on function public.create_my_advertising_destination_draft(uuid,text,uuid,text,uuid,uuid,uuid,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.create_my_advertising_destination_draft(uuid,text,uuid,text,uuid,uuid,uuid,uuid)
to authenticated;
revoke all on function public.update_my_advertising_destination_draft(uuid,text,timestamptz,uuid,text,uuid,uuid,uuid,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.update_my_advertising_destination_draft(uuid,text,timestamptz,uuid,text,uuid,uuid,uuid,uuid)
to authenticated;

create or replace function private.advertising_ad_objective_contract_issue(p_ad_id uuid)
returns text
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_row record;
begin
  select campaign.objective,destination.destination_type,destination.external_url,
    destination.target_user_id,destination.target_business_account_id,
    destination.target_product_id,destination.target_store_id,version.format
  into v_row
  from private.advertising_ads ad
  join private.advertising_ad_sets ad_set on ad_set.id=ad.ad_set_id
  join private.advertising_campaigns campaign on campaign.id=ad_set.campaign_id
  join private.advertising_destinations destination on destination.id=ad.destination_id
  join private.advertising_creative_versions version on version.id=ad.creative_version_id
  where ad.id=p_ad_id;
  if not found then return 'ad_not_found';end if;
  if v_row.objective='video_views' and v_row.format<>'video' then return 'video_views_creative_required';end if;
  if not private.advertising_objective_destination_valid(
    v_row.objective,v_row.destination_type,v_row.external_url,v_row.target_user_id,
    v_row.target_business_account_id,v_row.target_product_id,v_row.target_store_id
  ) then
    return case v_row.objective
      when 'marketplace_sales' then 'marketplace_sales_destination_invalid'
      when 'profile_visits' then 'profile_visits_destination_invalid'
      when 'messages' then 'messages_destination_invalid'
      when 'app_promotion' then 'app_promotion_store_destination_invalid'
      when 'website_conversions' then 'objective_delivery_not_available'
      else 'objective_destination_invalid' end;
  end if;
  return null;
end;
$$;

revoke all on function private.advertising_ad_objective_contract_issue(uuid)
from public,anon,authenticated,service_role;

create or replace function private.advertising_review_objective_contract_guard()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_issue text;
begin
  if new.review_status='pending' and old.review_status is distinct from new.review_status then
    v_issue:=private.advertising_ad_objective_contract_issue(new.id);
    if v_issue is not null then raise exception using errcode='22023',message=v_issue;end if;
  end if;
  return new;
end;
$$;

revoke all on function private.advertising_review_objective_contract_guard()
from public,anon,authenticated,service_role;

create trigger advertising_ads_objective_contract_guard
before update of review_status on private.advertising_ads
for each row execute function private.advertising_review_objective_contract_guard();

create or replace function private.advertising_delivery_preflight_at(
  p_ad_id uuid,p_placement_code text,p_viewer_user_id uuid,p_at_time timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_result jsonb;v_billing jsonb;v_campaign_id uuid;v_launch_mode text;v_blocker text;
  v_delivery_runtime_ready boolean:=false;v_objective_issue text;
begin
  v_result:=private.advertising_delivery_preflight_structural_at(p_ad_id,p_placement_code,p_viewer_user_id,p_at_time);
  select ad_set.campaign_id,coalesce(capability.delivery_runtime_ready,false)
  into v_campaign_id,v_delivery_runtime_ready
  from private.advertising_ads ad
  join private.advertising_ad_sets ad_set on ad_set.id=ad.ad_set_id
  join private.advertising_campaigns campaign on campaign.id=ad_set.campaign_id
  left join private.advertising_objective_capabilities capability on capability.objective=campaign.objective
  where ad.id=p_ad_id;
  select launch_mode into strict v_launch_mode from private.advertising_canary_policy where singleton;
  v_objective_issue:=private.advertising_ad_objective_contract_issue(p_ad_id);
  if v_campaign_id is not null and not v_delivery_runtime_ready then
    v_result:=pg_catalog.jsonb_set(v_result,'{structurally_ready}','false'::jsonb,true);
    v_result:=pg_catalog.jsonb_set(v_result,'{production_deliverable}','false'::jsonb,true);
    v_result:=pg_catalog.jsonb_set(v_result,'{reason_codes}',coalesce(v_result->'reason_codes','[]'::jsonb)||pg_catalog.jsonb_build_array('objective_delivery_not_available'),true);
  elsif v_campaign_id is not null and v_objective_issue is not null then
    v_result:=pg_catalog.jsonb_set(v_result,'{structurally_ready}','false'::jsonb,true);
    v_result:=pg_catalog.jsonb_set(v_result,'{production_deliverable}','false'::jsonb,true);
    v_result:=pg_catalog.jsonb_set(v_result,'{reason_codes}',coalesce(v_result->'reason_codes','[]'::jsonb)||pg_catalog.jsonb_build_array(v_objective_issue),true);
  elsif v_campaign_id is not null and v_launch_mode in ('CANARY_BILLING','PRODUCTION') then
    v_billing:=private.advertising_campaign_billing_readiness_at(v_campaign_id,p_placement_code,p_at_time);
    if not coalesce((v_billing->>'ready')::boolean,false) then
      v_blocker:=v_billing->>'blocker';
      v_result:=pg_catalog.jsonb_set(v_result,'{structurally_ready}','false'::jsonb,true);
      v_result:=pg_catalog.jsonb_set(v_result,'{production_deliverable}','false'::jsonb,true);
      v_result:=pg_catalog.jsonb_set(v_result,'{reason_codes}',coalesce(v_result->'reason_codes','[]'::jsonb)||pg_catalog.jsonb_build_array(v_blocker),true);
    end if;
    v_result:=v_result||pg_catalog.jsonb_build_object('billing_readiness',v_billing);
  end if;
  return v_result;
end;
$$;

revoke all on function private.advertising_delivery_preflight_at(uuid,text,uuid,timestamptz)
from public,anon,authenticated,service_role;

create or replace function private.resolve_advertising_direct_conversion_attribution(
  p_conversion_id uuid,p_impression_event_id uuid,p_viewer_user_id uuid,p_occurred_at timestamptz
)
returns private.advertising_attributions
language plpgsql
security definer
set search_path=''
as $$
declare
  v_policy private.advertising_event_policy;v_parent private.advertising_events;
  v_touch private.advertising_events;v_result private.advertising_attributions;v_window integer;
begin
  select * into v_result from private.advertising_attributions where conversion_id=p_conversion_id;
  if found then return v_result;end if;
  select * into strict v_policy from private.advertising_event_policy where singleton;
  select * into v_parent from private.advertising_events
  where id=p_impression_event_id and event_type='impression' and viewer_user_id=p_viewer_user_id;
  if not found then raise exception using errcode='22023',message='advertising_conversion_parent_impression_invalid';end if;
  select * into v_touch from private.advertising_events
  where parent_impression_event_id=v_parent.id and event_type='click'
    and viewer_user_id=p_viewer_user_id and occurred_at<=p_occurred_at
    and occurred_at>=p_occurred_at-pg_catalog.make_interval(hours=>v_policy.click_attribution_window_hours)
  order by occurred_at desc,id desc limit 1;
  v_window:=v_policy.click_attribution_window_hours;
  if not found then
    if v_parent.occurred_at>p_occurred_at
      or v_parent.occurred_at<p_occurred_at-pg_catalog.make_interval(hours=>v_policy.impression_attribution_window_hours) then
      return null;
    end if;
    v_touch:=v_parent;v_window:=v_policy.impression_attribution_window_hours;
  end if;
  insert into private.advertising_attributions(
    conversion_id,touch_event_id,touch_event_type,campaign_id,ad_set_id,ad_id,
    creative_version_id,destination_id,placement_code,attribution_model,attribution_window_hours
  ) values(
    p_conversion_id,v_touch.id,v_touch.event_type,v_touch.campaign_id,v_touch.ad_set_id,v_touch.ad_id,
    v_touch.creative_version_id,v_touch.destination_id,v_touch.placement_code,'last_click_then_impression',v_window
  ) returning * into v_result;
  return v_result;
exception when unique_violation then
  select * into v_result from private.advertising_attributions where conversion_id=p_conversion_id;
  if not found then raise;end if;
  return v_result;
end;
$$;

revoke all on function private.resolve_advertising_direct_conversion_attribution(uuid,uuid,uuid,timestamptz)
from public,anon,authenticated,service_role;

create or replace function private.record_advertising_direct_conversion_v2(
  p_conversion_key uuid,p_conversion_type text,p_source_type text,p_source_reference_id uuid,
  p_viewer_user_id uuid,p_impression_event_id uuid,p_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_conversion private.advertising_conversions;v_prior private.advertising_conversions;v_attribution private.advertising_attributions;
begin
  if p_conversion_key is null or p_source_reference_id is null or p_viewer_user_id is null
    or p_impression_event_id is null or p_occurred_at is null then
    raise exception using errcode='22023',message='advertising_conversion_input_invalid';
  end if;
  if p_conversion_type not in ('profile_visit','message_start') then
    raise exception using errcode='22023',message='advertising_conversion_type_invalid';
  end if;
  select * into v_prior from private.advertising_conversions where conversion_key=p_conversion_key;
  if found and(v_prior.conversion_type<>p_conversion_type or v_prior.source_type<>p_source_type
    or v_prior.source_reference_id<>p_source_reference_id or v_prior.viewer_user_id is distinct from p_viewer_user_id)then
    raise exception using errcode='23505',message='advertising_conversion_idempotency_conflict';
  end if;
  if not found then
    select * into v_prior from private.advertising_conversions
    where source_type=p_source_type and source_reference_id=p_source_reference_id
      and conversion_type=p_conversion_type;
  end if;
  if found then v_conversion:=v_prior;
  else
    insert into private.advertising_conversions(
      conversion_key,conversion_type,viewer_user_id,source_type,source_reference_id,
      value_bdag,currency,occurred_at
    ) values(
      p_conversion_key,p_conversion_type,p_viewer_user_id,p_source_type,p_source_reference_id,
      null,null,p_occurred_at
    ) returning * into v_conversion;
  end if;
  v_attribution:=private.resolve_advertising_direct_conversion_attribution(
    v_conversion.id,p_impression_event_id,p_viewer_user_id,v_conversion.occurred_at
  );
  return pg_catalog.jsonb_build_object(
    'conversion_id',v_conversion.id,'conversion_type',v_conversion.conversion_type,
    'attributed',v_attribution.id is not null,'attribution_model',v_attribution.attribution_model,
    'authority','ads_v2'
  );
exception when unique_violation then
  select * into v_conversion from private.advertising_conversions
  where source_type=p_source_type and source_reference_id=p_source_reference_id
    and conversion_type=p_conversion_type;
  if not found then raise;end if;
  v_attribution:=private.resolve_advertising_direct_conversion_attribution(
    v_conversion.id,p_impression_event_id,p_viewer_user_id,v_conversion.occurred_at
  );
  return pg_catalog.jsonb_build_object(
    'conversion_id',v_conversion.id,'conversion_type',v_conversion.conversion_type,
    'attributed',v_attribution.id is not null,'attribution_model',v_attribution.attribution_model,
    'authority','ads_v2'
  );
end;
$$;

revoke all on function private.record_advertising_direct_conversion_v2(uuid,text,text,uuid,uuid,uuid,timestamptz)
from public,anon,authenticated,service_role;

create or replace function private.advertising_record_profile_visit_for_event_v2(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_event private.advertising_events;v_objective text;v_destination_type text;
begin
  select * into v_event from private.advertising_events where id=p_event_id;
  if found then
    select objective into v_objective from private.advertising_campaigns where id=v_event.campaign_id;
    select destination_type into v_destination_type from private.advertising_destinations where id=v_event.destination_id;
  end if;
  if not found or v_event.event_type<>'destination_open' or v_objective<>'profile_visits'
    or v_destination_type<>'nelyon_profile' then return null;end if;
  return private.record_advertising_direct_conversion_v2(
    pg_catalog.md5('ads-v2-profile-visit:'||v_event.parent_impression_event_id::text)::uuid,
    'profile_visit','advertising_impression',v_event.parent_impression_event_id,v_event.viewer_user_id,
    v_event.parent_impression_event_id,v_event.occurred_at
  );
end;
$$;

revoke all on function private.advertising_record_profile_visit_for_event_v2(uuid)
from public,anon,authenticated,service_role;
grant execute on function private.advertising_record_profile_visit_for_event_v2(uuid)
to postgres;

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
begin
  if p_viewer_user_id is null then raise exception using errcode='22023',message='advertising_viewer_required';end if;
  if p_event_type not in ('click','destination_open','video_view','engagement') then raise exception using errcode='22023',message='advertising_interaction_type_invalid';end if;
  if p_event_key is null then raise exception using errcode='22023',message='advertising_event_key_required';end if;
  select * into strict v_policy from private.advertising_event_policy where singleton;
  select * into v_parent from private.advertising_events where id=p_impression_event_id and event_type='impression';
  if not found then raise exception using errcode='22023',message='advertising_parent_impression_required';end if;
  if v_parent.viewer_user_id is distinct from p_viewer_user_id then raise exception using errcode='42501',message='advertising_interaction_viewer_mismatch';end if;
  select * into v_prior from private.advertising_events where event_key=p_event_key;
  if found then
    if v_prior.event_type<>p_event_type or v_prior.parent_impression_event_id<>p_impression_event_id then
      raise exception using errcode='23505',message='advertising_event_idempotency_conflict';
    end if;
    if p_event_type='destination_open' then perform private.advertising_record_profile_visit_for_event_v2(v_prior.id);end if;
    return pg_catalog.to_jsonb(v_prior);
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
  if not found or v_prior.event_type<>p_event_type or v_prior.parent_impression_event_id<>p_impression_event_id then
    raise exception using errcode='23505',message='advertising_event_idempotency_conflict';
  end if;
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
  v_destination_open private.advertising_events;
  v_destination private.advertising_destinations;v_message public.messages;v_first_message public.messages;
  v_policy private.advertising_event_policy;v_objective text;
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
  select * into v_message from public.messages
  where id=p_message_id and sender_id=v_actor and recipient_id=v_destination.target_user_id
    and deleted_at is null and created_at>=v_impression.occurred_at;
  if not found then raise exception using errcode='42501',message='advertising_message_conversion_message_invalid';end if;
  select * into v_destination_open from private.advertising_events event
  where event.parent_impression_event_id=v_impression.id and event.event_type='destination_open'
    and event.viewer_user_id=v_actor and event.destination_id=v_destination.id
    and event.occurred_at<=v_message.created_at
  order by event.occurred_at desc,event.id desc limit 1;
  if not found then raise exception using errcode='42501',message='advertising_message_conversion_destination_open_required';end if;
  select * into strict v_policy from private.advertising_event_policy where singleton;
  if v_message.created_at>v_impression.occurred_at+pg_catalog.make_interval(hours=>v_policy.interaction_max_delay_hours) then
    raise exception using errcode='22023',message='advertising_message_conversion_window_expired';
  end if;
  select * into v_first_message from public.messages message
  where message.sender_id=v_actor and message.recipient_id=v_destination.target_user_id
    and message.deleted_at is null and message.created_at>=v_destination_open.occurred_at
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

create or replace function public.get_my_advertising_objective_capabilities_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_actor uuid:=(select auth.uid());v_result jsonb;
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required';end if;
  select pg_catalog.jsonb_build_object(
    'authority','ads_v2','capability_version',max(capability.capability_version),
    'objectives',coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'objective',capability.objective,'status',capability.status,
      'setup_enabled',capability.setup_enabled,'delivery_runtime_ready',capability.delivery_runtime_ready,
      'billing_runtime_ready',capability.billing_runtime_ready,'conversion_runtime_ready',capability.conversion_runtime_ready,
      'billable_event_type',capability.billable_event_type,'primary_metric',capability.primary_metric,
      'availability_reason',capability.availability_reason
    )order by capability.objective),'[]'::jsonb)
  ) into v_result from private.advertising_objective_capabilities capability;
  return v_result;
end;
$$;

revoke all on function public.get_my_advertising_objective_capabilities_v2()
from public,anon,authenticated,service_role;
grant execute on function public.get_my_advertising_objective_capabilities_v2()
to authenticated;

create or replace function public.get_my_advertising_event_summary(p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());v_objective text;v_conversion_ready boolean;v_primary_metric text;
  v_impressions bigint;v_unique_reach bigint;v_clicks bigint;v_destination_opens bigint;
  v_video_views bigint;v_engagements bigint;v_profile_visits bigint;v_message_starts bigint;v_app_store_opens bigint;
  v_conversions bigint;v_attributed bigint;v_value numeric(20,8);v_spent numeric(20,8);
  v_objective_results numeric;v_objective_result_status text;
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required';end if;
  select campaign.objective,capability.conversion_runtime_ready,capability.primary_metric
  into v_objective,v_conversion_ready,v_primary_metric
  from private.advertising_campaigns campaign
  join private.ad_accounts account on account.id=campaign.ad_account_id
  join private.business_accounts business on business.id=account.business_account_id
  join private.advertising_objective_capabilities capability on capability.objective=campaign.objective
  where campaign.id=p_campaign_id and business.owner_user_id=v_actor;
  if not found then raise exception using errcode='42501',message='advertising_campaign_access_denied';end if;
  select count(*)filter(where event_type='impression'),
    count(distinct viewer_user_id)filter(where event_type='impression' and viewer_user_id is not null),
    count(*)filter(where event_type='click'),count(*)filter(where event_type='destination_open'),
    count(*)filter(where event_type='video_view'),count(*)filter(where event_type='engagement')
  into v_impressions,v_unique_reach,v_clicks,v_destination_opens,v_video_views,v_engagements
  from private.advertising_events where campaign_id=p_campaign_id;
  select count(distinct conversion.id),count(attribution.id),
    count(*)filter(where conversion.conversion_type='profile_visit'),
    count(*)filter(where conversion.conversion_type='message_start'),
    coalesce(sum(conversion.value_bdag)filter(where conversion.conversion_type='marketplace_purchase'),0)
  into v_conversions,v_attributed,v_profile_visits,v_message_starts,v_value
  from private.advertising_attributions attribution
  join private.advertising_conversions conversion on conversion.id=attribution.conversion_id
  where attribution.campaign_id=p_campaign_id;
  select count(*) into v_app_store_opens
  from private.advertising_events event
  join private.advertising_destinations destination on destination.id=event.destination_id
  where event.campaign_id=p_campaign_id and event.event_type='destination_open'
    and v_objective='app_promotion' and destination.destination_type='external_url'
    and private.advertising_app_store_url_valid(destination.external_url);
  select coalesce(spent_bdag,0) into v_spent from private.advertising_campaign_finance where campaign_id=p_campaign_id;
  v_objective_results:=case v_primary_metric
    when 'impressions' then v_impressions when 'unique_reach' then v_unique_reach
    when 'clicks' then v_clicks when 'qualified_interactions' then v_clicks
    when 'video_views' then v_video_views when 'profile_visits' then v_profile_visits
    when 'message_starts' then v_message_starts when 'app_store_opens' then v_app_store_opens
    when 'attributed_conversions' then v_attributed else null end;
  v_objective_result_status:=case when v_primary_metric is null then 'not_applicable' else 'available'end;
  return pg_catalog.jsonb_build_object(
    'authority','ads_v2','objective',v_objective,'primary_metric',v_primary_metric,
    'impressions',v_impressions,'unique_reach',v_unique_reach,'clicks',v_clicks,
    'destination_opens',v_destination_opens,'video_views',v_video_views,'engagements',v_engagements,
    'profile_visits',v_profile_visits,'message_starts',v_message_starts,'app_store_opens',v_app_store_opens,
    'objective_results',v_objective_results,'objective_result_status',v_objective_result_status,
    'conversions',v_conversions,'attributed_conversions',v_attributed,
    'marketplace_purchase_value_bdag',v_value,'spent_bdag',v_spent,
    'ctr',case when v_impressions=0 then null else pg_catalog.round(v_clicks::numeric/v_impressions,8)end,
    'ctr_status',case when v_impressions=0 then 'no_data' else 'available'end,
    'cpc_bdag',case when v_clicks=0 then null else pg_catalog.round(v_spent/v_clicks,8)end,
    'cpc_status',case when v_clicks=0 then 'no_data' else 'available'end,
    'cpm_bdag',case when v_impressions=0 then null else pg_catalog.round(v_spent/v_impressions*1000,8)end,
    'cpm_status',case when v_impressions=0 then 'no_data' else 'available'end,
    'conversion_rate',case when not v_conversion_ready or v_clicks=0 then null else pg_catalog.round(v_attributed::numeric/v_clicks,8)end,
    'conversion_rate_status',case when not v_conversion_ready then 'not_applicable' when v_clicks=0 then 'no_data' else 'available'end,
    'roas',case when v_objective<>'marketplace_sales' or v_spent=0 then null else pg_catalog.round(v_value/v_spent,8)end,
    'roas_status',case when v_objective<>'marketplace_sales' then 'not_applicable' when v_spent=0 then 'no_data' else 'available'end
  );
end;
$$;

revoke all on function public.get_my_advertising_event_summary(uuid)
from public,anon,authenticated,service_role;
grant execute on function public.get_my_advertising_event_summary(uuid)
to authenticated;

notify pgrst,'reload schema';

commit;
