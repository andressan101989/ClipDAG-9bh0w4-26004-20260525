-- BUSINESS-WEB-BW-D
-- Capability-scoped Ads Manager projections and non-financial mutations.
-- Funding, spend, release, delivery and finalization authorities are intentionally unchanged.

create or replace function public.search_my_business_ad_campaigns(
  p_business_owner_id uuid,
  p_status text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'marketplace_auth_required';
  end if;
  if not (
    private.business_actor_has_capability(p_business_owner_id, 'business.ads.read')
    or private.business_actor_has_capability(p_business_owner_id, 'business.ads.manage')
  ) then
    raise exception using errcode = '42501', message = 'business_capability_required';
  end if;
  if p_status is not null and p_status not in (
    'draft', 'scheduled', 'active', 'paused', 'exhausted', 'completed', 'cancelled'
  ) then
    raise exception using errcode = '22023', message = 'marketplace_ad_status_invalid';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception using errcode = '22023', message = 'marketplace_ad_cursor_invalid';
  end if;

  with candidates as (
    select
      c.id,
      c.product_id,
      p.title as product_title,
      p.images[1] as product_image_url,
      c.name,
      c.status,
      c.starts_at,
      c.ends_at,
      c.total_budget_bdag,
      c.spent_bdag,
      c.released_bdag,
      greatest(c.total_budget_bdag - c.spent_bdag - c.released_bdag, 0::numeric) as remaining_reserved_bdag,
      c.eligible_elapsed_seconds,
      c.eligibility_state,
      c.eligibility_reason,
      c.created_at,
      c.updated_at
    from public.marketplace_ad_campaigns as c
    join public.products as p on p.id = c.product_id
    where c.seller_id = p_business_owner_id
      and (p_status is null or c.status = p_status)
      and (
        p_cursor_created_at is null
        or (c.created_at, c.id) < (p_cursor_created_at, p_cursor_id)
      )
    order by c.created_at desc, c.id desc
    limit v_limit + 1
  ), numbered as (
    select candidates.*, row_number() over (order by candidates.created_at desc, candidates.id desc) as rn
    from candidates
  ), page_rows as (
    select * from numbered where rn <= v_limit
  ), enriched as (
    select
      r.*,
      coalesce(e.impressions, 0) as impressions,
      coalesce(e.clicks, 0) as clicks,
      coalesce(e.product_views, 0) as product_views,
      coalesce(e.cart_adds, 0) as cart_adds,
      coalesce(a.orders, 0) as orders,
      coalesce(a.attributed_gmv_bdag, 0::numeric) as attributed_gmv_bdag,
      f.finalized_at
    from page_rows as r
    left join lateral (
      select
        count(*) filter (where ev.event_type = 'impression')::bigint as impressions,
        count(*) filter (where ev.event_type = 'click')::bigint as clicks,
        count(*) filter (where ev.event_type = 'product_view')::bigint as product_views,
        count(*) filter (where ev.event_type = 'add_to_cart')::bigint as cart_adds
      from public.marketplace_ad_events as ev
      where ev.campaign_id = r.id
    ) as e on true
    left join lateral (
      select
        count(distinct oa.order_id)::bigint as orders,
        coalesce(sum(oa.attributed_gmv_bdag), 0::numeric) as attributed_gmv_bdag
      from public.marketplace_order_ad_attribution as oa
      where oa.campaign_id = r.id
    ) as a on true
    left join public.marketplace_ad_finalizations as f on f.campaign_id = r.id
  ), campaign_summary as (
    select
      count(*) filter (where c.status in ('scheduled', 'active'))::bigint as active_campaigns,
      coalesce(sum(c.total_budget_bdag), 0::numeric) as total_budget_bdag,
      coalesce(sum(c.spent_bdag), 0::numeric) as spent_bdag
    from public.marketplace_ad_campaigns as c
    where c.seller_id = p_business_owner_id
  ), event_summary as (
    select
      count(*) filter (where ev.event_type = 'impression')::bigint as impressions,
      count(*) filter (where ev.event_type = 'click')::bigint as clicks
    from public.marketplace_ad_events as ev
    join public.marketplace_ad_campaigns as c on c.id = ev.campaign_id
    where c.seller_id = p_business_owner_id
  ), attribution_summary as (
    select
      count(distinct oa.order_id)::bigint as orders,
      coalesce(sum(oa.attributed_gmv_bdag), 0::numeric) as attributed_gmv_bdag
    from public.marketplace_order_ad_attribution as oa
    join public.marketplace_ad_campaigns as c on c.id = oa.campaign_id
    where c.seller_id = p_business_owner_id
  )
  select pg_catalog.jsonb_build_object(
    'items', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', x.id,
          'product_id', x.product_id,
          'product_title', x.product_title,
          'product_image_url', x.product_image_url,
          'name', x.name,
          'status', x.status,
          'starts_at', x.starts_at,
          'ends_at', x.ends_at,
          'total_budget_bdag', x.total_budget_bdag,
          'spent_bdag', x.spent_bdag,
          'released_bdag', x.released_bdag,
          'remaining_reserved_bdag', x.remaining_reserved_bdag,
          'eligible_elapsed_seconds', x.eligible_elapsed_seconds,
          'eligibility_state', x.eligibility_state,
          'eligibility_reason', x.eligibility_reason,
          'impressions', x.impressions,
          'clicks', x.clicks,
          'product_views', x.product_views,
          'cart_adds', x.cart_adds,
          'orders', x.orders,
          'attributed_gmv_bdag', x.attributed_gmv_bdag,
          'finalized_at', x.finalized_at,
          'created_at', x.created_at,
          'updated_at', x.updated_at
        ) order by x.created_at desc, x.id desc
      )
      from enriched as x
    ), '[]'::jsonb),
    'next_cursor', case when exists (select 1 from numbered where rn = v_limit + 1) then (
      select pg_catalog.jsonb_build_object('created_at', n.created_at, 'id', n.id)
      from numbered as n
      where n.rn = v_limit
    ) else null end,
    'summary', (
      select pg_catalog.jsonb_build_object(
        'active_campaigns', cs.active_campaigns,
        'total_budget_bdag', cs.total_budget_bdag,
        'spent_bdag', cs.spent_bdag,
        'impressions', es.impressions,
        'clicks', es.clicks,
        'orders', ats.orders,
        'attributed_gmv_bdag', ats.attributed_gmv_bdag
      )
      from campaign_summary as cs
      cross join event_summary as es
      cross join attribution_summary as ats
    )
  ) into v_result;

  return v_result;
end;
$function$;

create or replace function public.get_my_business_ad_campaign(
  p_business_owner_id uuid,
  p_campaign_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'marketplace_auth_required';
  end if;
  if not (
    private.business_actor_has_capability(p_business_owner_id, 'business.ads.read')
    or private.business_actor_has_capability(p_business_owner_id, 'business.ads.manage')
  ) then
    raise exception using errcode = '42501', message = 'business_capability_required';
  end if;

  select pg_catalog.jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'status', c.status,
    'starts_at', c.starts_at,
    'ends_at', c.ends_at,
    'total_budget_bdag', c.total_budget_bdag,
    'spent_bdag', c.spent_bdag,
    'released_bdag', c.released_bdag,
    'remaining_reserved_bdag', greatest(c.total_budget_bdag - c.spent_bdag - c.released_bdag, 0::numeric),
    'funded_at', c.funded_at,
    'paused_at', c.paused_at,
    'completed_at', c.completed_at,
    'eligible_elapsed_seconds', c.eligible_elapsed_seconds,
    'eligibility_state', c.eligibility_state,
    'eligibility_reason', c.eligibility_reason,
    'created_at', c.created_at,
    'updated_at', c.updated_at,
    'product', pg_catalog.jsonb_build_object(
      'id', p.id,
      'title', p.title,
      'image_url', p.images[1],
      'price', p.price,
      'currency', p.currency
    ),
    'metrics', pg_catalog.jsonb_build_object(
      'impressions', coalesce(ev.impressions, 0),
      'clicks', coalesce(ev.clicks, 0),
      'product_views', coalesce(ev.product_views, 0),
      'cart_adds', coalesce(ev.cart_adds, 0),
      'orders', coalesce(atm.orders, 0),
      'attributed_gmv_bdag', coalesce(atm.attributed_gmv_bdag, 0::numeric)
    ),
    'delivery_surfaces', coalesce(ev.surfaces, '[]'::jsonb),
    'attribution', coalesce(atm.items, '[]'::jsonb),
    'finalization', case when f.campaign_id is null then null else pg_catalog.jsonb_build_object(
      'eligible_elapsed_seconds', f.eligible_elapsed_seconds,
      'delivery_target_seconds', f.delivery_target_seconds,
      'final_target_bdag', f.final_target_bdag,
      'spent_before_bdag', f.spent_before_bdag,
      'final_spend_delta_bdag', f.final_spend_delta_bdag,
      'released_bdag', f.released_bdag,
      'finalized_at', f.finalized_at
    ) end
  )
  into v_result
  from public.marketplace_ad_campaigns as c
  join public.products as p on p.id = c.product_id
  left join lateral (
    select
      coalesce(sum(s.impressions), 0)::bigint as impressions,
      coalesce(sum(s.clicks), 0)::bigint as clicks,
      coalesce(sum(s.product_views), 0)::bigint as product_views,
      coalesce(sum(s.cart_adds), 0)::bigint as cart_adds,
      coalesce(pg_catalog.jsonb_agg(s.surface_metrics order by s.surface) filter (where s.surface is not null), '[]'::jsonb) as surfaces
    from (
      select
        e2.surface,
        count(*) filter (where e2.event_type = 'impression')::bigint as impressions,
        count(*) filter (where e2.event_type = 'click')::bigint as clicks,
        count(*) filter (where e2.event_type = 'product_view')::bigint as product_views,
        count(*) filter (where e2.event_type = 'add_to_cart')::bigint as cart_adds,
        pg_catalog.jsonb_build_object(
          'surface', e2.surface,
          'impressions', count(*) filter (where e2.event_type = 'impression'),
          'clicks', count(*) filter (where e2.event_type = 'click'),
          'product_views', count(*) filter (where e2.event_type = 'product_view'),
          'cart_adds', count(*) filter (where e2.event_type = 'add_to_cart'),
          'purchases', count(*) filter (where e2.event_type = 'purchase')
        ) as surface_metrics
      from public.marketplace_ad_events as e2
      where e2.campaign_id = c.id
      group by e2.surface
    ) as s
  ) as ev on true
  left join lateral (
    select
      count(distinct a.order_id)::bigint as orders,
      coalesce(sum(a.attributed_gmv_bdag), 0::numeric) as attributed_gmv_bdag,
      coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'order_number', a.order_number,
          'attributed_gmv_bdag', a.attributed_gmv_bdag,
          'attributed_at', a.attributed_at
        ) order by a.attributed_at desc, a.order_number
      ), '[]'::jsonb) as items
    from (
      select
        oa.order_id,
        o.order_number,
        sum(oa.attributed_gmv_bdag) as attributed_gmv_bdag,
        max(oa.attributed_at) as attributed_at
      from public.marketplace_order_ad_attribution as oa
      join public.marketplace_orders as o on o.id = oa.order_id
      where oa.campaign_id = c.id
      group by oa.order_id, o.order_number
    ) as a
  ) as atm on true
  left join public.marketplace_ad_finalizations as f on f.campaign_id = c.id
  where c.id = p_campaign_id
    and c.seller_id = p_business_owner_id;

  if v_result is null then
    raise exception using errcode = 'P0002', message = 'marketplace_ad_campaign_not_found';
  end if;
  return v_result;
end;
$function$;

create or replace function public.search_my_business_ad_eligible_products(
  p_business_owner_id uuid,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'marketplace_auth_required';
  end if;
  if not (
    private.business_actor_has_capability(p_business_owner_id, 'business.ads.read')
    or private.business_actor_has_capability(p_business_owner_id, 'business.ads.manage')
  ) then
    raise exception using errcode = '42501', message = 'business_capability_required';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception using errcode = '22023', message = 'marketplace_ad_cursor_invalid';
  end if;

  with candidates as (
    select p.id, p.title, p.images[1] as thumbnail_url, p.price, p.currency, p.created_at
    from public.products as p
    where p.seller_id = p_business_owner_id
      and public.marketplace_ad_product_is_eligible(p_business_owner_id, p.id, p.store_id)
      and (
        p_cursor_created_at is null
        or (p.created_at, p.id) < (p_cursor_created_at, p_cursor_id)
      )
    order by p.created_at desc, p.id desc
    limit v_limit + 1
  ), numbered as (
    select candidates.*, row_number() over (order by candidates.created_at desc, candidates.id desc) as rn
    from candidates
  )
  select pg_catalog.jsonb_build_object(
    'items', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', n.id,
          'title', n.title,
          'thumbnail_url', n.thumbnail_url,
          'price', n.price,
          'currency', n.currency,
          'created_at', n.created_at
        ) order by n.created_at desc, n.id desc
      )
      from numbered as n
      where n.rn <= v_limit
    ), '[]'::jsonb),
    'next_cursor', case when exists (select 1 from numbered where rn = v_limit + 1) then (
      select pg_catalog.jsonb_build_object('created_at', n.created_at, 'id', n.id)
      from numbered as n
      where n.rn = v_limit
    ) else null end
  ) into v_result;

  return v_result;
end;
$function$;

create or replace function public.create_marketplace_ad_campaign_draft(
  p_product_id uuid,
  p_name text,
  p_budget_bdag numeric,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_owner_id uuid;
  v_product public.products;
  v_prior public.marketplace_ad_campaigns;
  v_config public.marketplace_ad_config;
  v_normalized numeric(20,8) := pg_catalog.round(p_budget_bdag, 8);
  v_created uuid;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'marketplace_auth_required';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'marketplace_idempotency_key_required';
  end if;

  select p.* into v_product
  from public.products as p
  where p.id = p_product_id
    and p.deleted_at is null;
  if not found then
    raise exception using errcode = '42501', message = 'marketplace_ad_product_ineligible';
  end if;
  v_owner_id := v_product.seller_id;
  perform private.business_require_capability(v_owner_id, 'business.ads.manage');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_owner_id::text || ':marketplace-ad-draft:' || p_idempotency_key::text, 0)
  );
  select c.* into v_prior
  from public.marketplace_ad_campaigns as c
  where c.seller_id = v_owner_id
    and c.creation_idempotency_key = p_idempotency_key;
  if found then
    if v_prior.product_id is distinct from p_product_id
      or v_prior.name is distinct from nullif(pg_catalog.btrim(p_name), '')
      or v_prior.total_budget_bdag is distinct from v_normalized
      or v_prior.starts_at is distinct from p_starts_at
      or v_prior.ends_at is distinct from p_ends_at then
      raise exception using errcode = '23505', message = 'marketplace_ad_idempotency_conflict';
    end if;
    return public.marketplace_ad_campaign_result(v_prior.id);
  end if;

  if not public.marketplace_ad_product_is_eligible(v_owner_id, v_product.id, v_product.store_id) then
    raise exception using errcode = '42501', message = 'marketplace_ad_product_ineligible';
  end if;
  select c.* into strict v_config
  from public.marketplace_ad_config as c
  where c.singleton;
  if v_normalized < v_config.minimum_budget_bdag or v_normalized > v_config.maximum_budget_bdag then
    raise exception using errcode = '22023', message = 'marketplace_ad_budget_invalid';
  end if;
  if p_starts_at is null
    or p_ends_at is null
    or p_ends_at <= pg_catalog.now()
    or p_ends_at - p_starts_at < v_config.minimum_duration
    or p_ends_at - p_starts_at > v_config.maximum_duration then
    raise exception using errcode = '22023', message = 'marketplace_ad_window_invalid';
  end if;

  insert into public.marketplace_ad_campaigns (
    seller_id, store_id, product_id, name, starts_at, ends_at,
    total_budget_bdag, creation_idempotency_key
  ) values (
    v_owner_id, v_product.store_id, v_product.id,
    nullif(pg_catalog.btrim(p_name), ''), p_starts_at, p_ends_at,
    v_normalized, p_idempotency_key
  ) returning id into v_created;

  return public.marketplace_ad_campaign_result(v_created);
end;
$function$;

create or replace function public.pause_marketplace_ad_campaign(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_campaign public.marketplace_ad_campaigns;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'marketplace_auth_required';
  end if;
  select c.* into v_campaign
  from public.marketplace_ad_campaigns as c
  where c.id = p_campaign_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'marketplace_ad_not_pauseable';
  end if;
  perform private.business_require_capability(v_campaign.seller_id, 'business.ads.manage');
  if v_campaign.status not in ('active', 'scheduled') then
    raise exception using errcode = '42501', message = 'marketplace_ad_not_pauseable';
  end if;

  update public.marketplace_ad_campaigns
  set status = 'paused', paused_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where id = v_campaign.id;
  return public.marketplace_ad_campaign_result(v_campaign.id);
end;
$function$;

create or replace function public.resume_marketplace_ad_campaign(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_campaign public.marketplace_ad_campaigns;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'marketplace_auth_required';
  end if;
  select c.* into v_campaign
  from public.marketplace_ad_campaigns as c
  where c.id = p_campaign_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'marketplace_ad_not_resumable';
  end if;
  perform private.business_require_capability(v_campaign.seller_id, 'business.ads.manage');
  if v_campaign.status <> 'paused' then
    raise exception using errcode = '42501', message = 'marketplace_ad_not_resumable';
  end if;
  if pg_catalog.now() >= v_campaign.ends_at
    or v_campaign.spent_bdag + v_campaign.released_bdag >= v_campaign.total_budget_bdag
    or not public.marketplace_ad_product_is_eligible(
      v_campaign.seller_id, v_campaign.product_id, v_campaign.store_id
    ) then
    raise exception using errcode = '22023', message = 'marketplace_ad_not_resumable';
  end if;

  update public.marketplace_ad_campaigns
  set
    status = case when starts_at > pg_catalog.now() then 'scheduled' else 'active' end,
    paused_at = null,
    updated_at = pg_catalog.now()
  where id = v_campaign.id;
  return public.marketplace_ad_campaign_result(v_campaign.id);
end;
$function$;

revoke all on function public.search_my_business_ad_campaigns(uuid, text, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.get_my_business_ad_campaign(uuid, uuid) from public, anon, authenticated;
revoke all on function public.search_my_business_ad_eligible_products(uuid, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.create_marketplace_ad_campaign_draft(uuid, text, numeric, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.pause_marketplace_ad_campaign(uuid) from public, anon, authenticated;
revoke all on function public.resume_marketplace_ad_campaign(uuid) from public, anon, authenticated;

grant execute on function public.search_my_business_ad_campaigns(uuid, text, timestamptz, uuid, integer) to authenticated, service_role;
grant execute on function public.get_my_business_ad_campaign(uuid, uuid) to authenticated, service_role;
grant execute on function public.search_my_business_ad_eligible_products(uuid, timestamptz, uuid, integer) to authenticated, service_role;
grant execute on function public.create_marketplace_ad_campaign_draft(uuid, text, numeric, timestamptz, timestamptz, uuid) to authenticated, service_role;
grant execute on function public.pause_marketplace_ad_campaign(uuid) to authenticated, service_role;
grant execute on function public.resume_marketplace_ad_campaign(uuid) to authenticated, service_role;
