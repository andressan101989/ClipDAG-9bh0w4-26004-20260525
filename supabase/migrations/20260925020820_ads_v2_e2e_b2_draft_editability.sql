begin;

create or replace function private.advertising_campaign_result(p_campaign_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id',campaign.id,'ad_account_id',campaign.ad_account_id,
    'business_account_id',account.business_account_id,'name',campaign.name,
    'objective',campaign.objective,'status',campaign.status,
    'created_at',campaign.created_at,'updated_at',campaign.updated_at,'archived_at',campaign.archived_at,
    'lifecycle',pg_catalog.jsonb_build_object(
      'activation_enabled',lifecycle.activation_enabled,
      'automatic_transitions_enabled',lifecycle.automatic_transitions_enabled,
      'requires_financial_settlement',coalesce(
        campaign.status in ('completed','cancelled') and finance.finance_status='funded'
          and finance.funded_bdag-finance.spent_bdag-finance.released_bdag>0,false
      )
    ),
    'ad_sets', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', s.id, 'name', s.name, 'status', s.status, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
      'created_at', s.created_at, 'updated_at', s.updated_at,
      'audience', case when a.id is null then null else pg_catalog.jsonb_build_object('id', a.id, 'status', a.status, 'latest_version_number', av.version_number) end,
      'placement_selection', case when ps.id is null then null else pg_catalog.jsonb_build_object('id', ps.id, 'status', ps.status, 'latest_version_number', pv.version_number) end
    ) order by s.created_at, s.id), '[]'::jsonb)
      from private.advertising_ad_sets s
      left join private.advertising_audiences a on a.ad_set_id = s.id
      left join lateral (select v.version_number from private.advertising_audience_versions v where v.audience_id=a.id order by v.version_number desc limit 1) av on true
      left join private.advertising_placement_selections ps on ps.ad_set_id=s.id
      left join lateral (select v.version_number from private.advertising_placement_selection_versions v where v.placement_selection_id=ps.id order by v.version_number desc limit 1) pv on true
      where s.campaign_id=campaign.id),
    'destinations', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', d.id, 'destination_type', d.destination_type, 'external_url', d.external_url,
      'target_user_id', d.target_user_id, 'target_business_account_id', d.target_business_account_id,
      'target_product_id', d.target_product_id, 'target_store_id', d.target_store_id,
      'status', d.status, 'created_at', d.created_at, 'updated_at', d.updated_at
    ) order by d.created_at, d.id), '[]'::jsonb) from private.advertising_destinations d where d.campaign_id=campaign.id)
  )
  from private.advertising_campaigns campaign
  join private.ad_accounts account on account.id=campaign.ad_account_id
  cross join private.advertising_campaign_lifecycle_policy lifecycle
  left join private.advertising_campaign_finance finance on finance.campaign_id=campaign.id
  where campaign.id=p_campaign_id and lifecycle.singleton;
$$;

create or replace function public.update_my_advertising_ad_set_draft(
  p_ad_set_id uuid, p_name text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_expected_updated_at timestamptz, p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid()); v_name text := btrim(p_name); v_campaign_id uuid; v_row private.advertising_ad_sets; v_context record;
begin
  if v_actor is null then raise exception using errcode='42501', message='advertising_auth_required'; end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_actor) then raise exception using errcode='42501', message='advertising_adult_eligibility_required'; end if;
  if p_idempotency_key is null then raise exception using errcode='22023', message='advertising_idempotency_key_required'; end if;
  select campaign_id into v_campaign_id from private.advertising_ad_sets where id=p_ad_set_id;
  if v_campaign_id is null then raise exception using errcode='P0002', message='advertising_ad_set_not_found'; end if;
  select * into strict v_context from private.ads_require_owned_draft_campaign(v_actor,v_campaign_id);
  select * into v_row from private.advertising_ad_sets where id=p_ad_set_id for update;
  if v_row.id is null or v_row.campaign_id is distinct from v_campaign_id then raise exception using errcode='P0002', message='advertising_ad_set_not_found'; end if;
  if v_row.status <> 'draft' then raise exception using errcode='42501', message='advertising_ad_set_draft_access_denied'; end if;
  if v_row.name is not distinct from v_name and v_row.starts_at is not distinct from p_starts_at and v_row.ends_at is not distinct from p_ends_at then
    return pg_catalog.jsonb_build_object('id',v_row.id,'campaign_id',v_row.campaign_id,'name',v_row.name,'status',v_row.status,'starts_at',v_row.starts_at,'ends_at',v_row.ends_at,'created_at',v_row.created_at,'updated_at',v_row.updated_at);
  end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then raise exception using errcode='40001', message='advertising_ad_set_draft_stale'; end if;
  if v_name is null or char_length(v_name) not between 2 and 120 then raise exception using errcode='22023', message='advertising_ad_set_name_invalid'; end if;
  if not ((p_starts_at is null and p_ends_at is null) or (p_starts_at is not null and p_ends_at is not null and p_starts_at < p_ends_at)) then
    raise exception using errcode='22023', message='advertising_ad_set_schedule_invalid';
  end if;
  update private.advertising_ad_sets set name=v_name, starts_at=p_starts_at, ends_at=p_ends_at where id=v_row.id returning * into v_row;
  return pg_catalog.jsonb_build_object('id',v_row.id,'campaign_id',v_row.campaign_id,'name',v_row.name,'status',v_row.status,'starts_at',v_row.starts_at,'ends_at',v_row.ends_at,'created_at',v_row.created_at,'updated_at',v_row.updated_at);
end; $$;

create or replace function private.advertising_validate_destination_draft(
  p_actor uuid, p_business_account_id uuid, p_destination_type text, p_external_url text,
  p_target_user_id uuid, p_target_business_account_id uuid, p_target_product_id uuid, p_target_store_id uuid
)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  case p_destination_type
    when 'external_url' then
      if p_external_url is null or p_external_url !~* '^https://[^[:space:]]+$' or p_target_user_id is not null or p_target_business_account_id is not null or p_target_product_id is not null or p_target_store_id is not null then raise exception using errcode='22023', message='advertising_destination_external_url_invalid'; end if;
    when 'nelyon_profile' then
      if p_target_user_id is distinct from p_actor or p_external_url is not null or p_target_business_account_id is not null or p_target_product_id is not null or p_target_store_id is not null then raise exception using errcode='42501', message='advertising_destination_profile_access_denied'; end if;
    when 'business_account' then
      if p_target_business_account_id is distinct from p_business_account_id or p_external_url is not null or p_target_user_id is not null or p_target_product_id is not null or p_target_store_id is not null then raise exception using errcode='42501', message='advertising_destination_business_access_denied'; end if;
    when 'marketplace_product' then
      if p_external_url is not null or p_target_user_id is not null or p_target_business_account_id is not null or p_target_product_id is null or p_target_store_id is not null or not exists (select 1 from private.business_account_marketplace_links l join public.marketplace_sellers s on s.user_id=l.marketplace_seller_user_id and s.status='approved' join public.products p on p.id=p_target_product_id and p.seller_id=l.marketplace_seller_user_id and p.deleted_at is null join public.marketplace_stores st on st.id=p.store_id and st.seller_id=l.marketplace_seller_user_id where l.business_account_id=p_business_account_id) then raise exception using errcode='42501', message='advertising_destination_marketplace_product_access_denied'; end if;
    when 'marketplace_store' then
      if p_external_url is not null or p_target_user_id is not null or p_target_business_account_id is not null or p_target_product_id is not null or p_target_store_id is null or not exists (select 1 from private.business_account_marketplace_links l join public.marketplace_sellers s on s.user_id=l.marketplace_seller_user_id and s.status='approved' join public.marketplace_stores st on st.id=p_target_store_id and st.seller_id=l.marketplace_seller_user_id where l.business_account_id=p_business_account_id) then raise exception using errcode='42501', message='advertising_destination_marketplace_store_access_denied'; end if;
    else raise exception using errcode='22023', message='advertising_destination_type_invalid';
  end case;
end; $$;

create or replace function public.create_my_advertising_destination_draft(
  p_campaign_id uuid, p_destination_type text, p_idempotency_key uuid,
  p_external_url text default null, p_target_user_id uuid default null,
  p_target_business_account_id uuid default null, p_target_product_id uuid default null,
  p_target_store_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid()); v_type text := lower(btrim(p_destination_type));
  v_url text := btrim(p_external_url); v_context record; v_row private.advertising_destinations;
begin
  if v_actor is null then raise exception using errcode='42501', message='advertising_auth_required'; end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_actor) then raise exception using errcode='42501', message='advertising_adult_eligibility_required'; end if;
  if p_idempotency_key is null then raise exception using errcode='22023', message='advertising_idempotency_key_required'; end if;
  select * into strict v_context from private.ads_require_owned_draft_campaign(v_actor,p_campaign_id);
  perform private.advertising_validate_destination_draft(v_actor,v_context.business_account_id,v_type,v_url,p_target_user_id,p_target_business_account_id,p_target_product_id,p_target_store_id);
  insert into private.advertising_destinations(campaign_id,destination_type,external_url,target_user_id,target_business_account_id,target_product_id,target_store_id,status,creation_idempotency_key,created_by)
  values(p_campaign_id,v_type,v_url,p_target_user_id,p_target_business_account_id,p_target_product_id,p_target_store_id,'draft',p_idempotency_key,v_actor)
  on conflict(campaign_id,creation_idempotency_key) do nothing returning * into v_row;
  if v_row.id is null then
    select * into strict v_row from private.advertising_destinations where campaign_id=p_campaign_id and creation_idempotency_key=p_idempotency_key;
    if v_row.destination_type is distinct from v_type or v_row.external_url is distinct from v_url or v_row.target_user_id is distinct from p_target_user_id or v_row.target_business_account_id is distinct from p_target_business_account_id or v_row.target_product_id is distinct from p_target_product_id or v_row.target_store_id is distinct from p_target_store_id or v_row.created_by is distinct from v_actor then raise exception using errcode='23505', message='advertising_destination_idempotency_conflict'; end if;
  end if;
  return pg_catalog.jsonb_build_object('id',v_row.id,'campaign_id',v_row.campaign_id,'destination_type',v_row.destination_type,'external_url',v_row.external_url,'target_user_id',v_row.target_user_id,'target_business_account_id',v_row.target_business_account_id,'target_product_id',v_row.target_product_id,'target_store_id',v_row.target_store_id,'status',v_row.status,'created_at',v_row.created_at);
end; $$;

create or replace function public.update_my_advertising_destination_draft(
  p_destination_id uuid, p_destination_type text, p_expected_updated_at timestamptz, p_idempotency_key uuid,
  p_external_url text default null, p_target_user_id uuid default null, p_target_business_account_id uuid default null,
  p_target_product_id uuid default null, p_target_store_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid()); v_type text := lower(btrim(p_destination_type)); v_url text := btrim(p_external_url);
  v_campaign_id uuid; v_row private.advertising_destinations; v_context record;
begin
  if v_actor is null then raise exception using errcode='42501', message='advertising_auth_required'; end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_actor) then raise exception using errcode='42501', message='advertising_adult_eligibility_required'; end if;
  if p_idempotency_key is null then raise exception using errcode='22023', message='advertising_idempotency_key_required'; end if;
  select campaign_id into v_campaign_id from private.advertising_destinations where id=p_destination_id;
  if v_campaign_id is null then raise exception using errcode='P0002', message='advertising_destination_not_found'; end if;
  select * into strict v_context from private.ads_require_owned_draft_campaign(v_actor,v_campaign_id);
  select * into v_row from private.advertising_destinations where id=p_destination_id for update;
  if v_row.id is null or v_row.campaign_id is distinct from v_campaign_id then raise exception using errcode='P0002', message='advertising_destination_not_found'; end if;
  if v_row.status <> 'draft' then raise exception using errcode='42501', message='advertising_destination_draft_access_denied'; end if;
  if v_row.destination_type is not distinct from v_type and v_row.external_url is not distinct from v_url and v_row.target_user_id is not distinct from p_target_user_id and v_row.target_business_account_id is not distinct from p_target_business_account_id and v_row.target_product_id is not distinct from p_target_product_id and v_row.target_store_id is not distinct from p_target_store_id then
    return pg_catalog.jsonb_build_object('id',v_row.id,'campaign_id',v_row.campaign_id,'destination_type',v_row.destination_type,'external_url',v_row.external_url,'target_user_id',v_row.target_user_id,'target_business_account_id',v_row.target_business_account_id,'target_product_id',v_row.target_product_id,'target_store_id',v_row.target_store_id,'status',v_row.status,'created_at',v_row.created_at,'updated_at',v_row.updated_at);
  end if;
  if exists (select 1 from private.advertising_ads ad where ad.destination_id=v_row.id) then raise exception using errcode='55000', message='advertising_destination_in_use'; end if;
  if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then raise exception using errcode='40001', message='advertising_destination_draft_stale'; end if;
  perform private.advertising_validate_destination_draft(v_actor,v_context.business_account_id,v_type,v_url,p_target_user_id,p_target_business_account_id,p_target_product_id,p_target_store_id);
  update private.advertising_destinations set destination_type=v_type, external_url=v_url, target_user_id=p_target_user_id, target_business_account_id=p_target_business_account_id, target_product_id=p_target_product_id, target_store_id=p_target_store_id where id=v_row.id returning * into v_row;
  return pg_catalog.jsonb_build_object('id',v_row.id,'campaign_id',v_row.campaign_id,'destination_type',v_row.destination_type,'external_url',v_row.external_url,'target_user_id',v_row.target_user_id,'target_business_account_id',v_row.target_business_account_id,'target_product_id',v_row.target_product_id,'target_store_id',v_row.target_store_id,'status',v_row.status,'created_at',v_row.created_at,'updated_at',v_row.updated_at);
end; $$;

revoke all on function private.advertising_validate_destination_draft(uuid,uuid,text,text,uuid,uuid,uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.update_my_advertising_ad_set_draft(uuid,text,timestamptz,timestamptz,timestamptz,uuid) from public, anon, authenticated, service_role;
grant execute on function public.update_my_advertising_ad_set_draft(uuid,text,timestamptz,timestamptz,timestamptz,uuid) to authenticated;
revoke all on function public.update_my_advertising_destination_draft(uuid,text,timestamptz,uuid,text,uuid,uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.update_my_advertising_destination_draft(uuid,text,timestamptz,uuid,text,uuid,uuid,uuid,uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
