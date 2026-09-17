create table public.marketplace_ad_campaign_placements (
  campaign_id uuid not null references public.marketplace_ad_campaigns(id) on delete cascade,
  surface text not null check (surface in ('marketplace_home', 'marketplace_search', 'social_feed')),
  created_at timestamptz not null default pg_catalog.now(),
  primary key (campaign_id, surface)
);

create index marketplace_ad_campaign_placements_surface_campaign_idx
  on public.marketplace_ad_campaign_placements(surface, campaign_id);

alter table public.marketplace_ad_campaign_placements enable row level security;
alter table public.marketplace_ad_campaign_placements force row level security;

create policy marketplace_ad_campaign_placements_no_direct_client_access
  on public.marketplace_ad_campaign_placements
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all on table public.marketplace_ad_campaign_placements from public, anon, authenticated;
grant select, insert, update, delete on table public.marketplace_ad_campaign_placements to service_role;

insert into public.marketplace_ad_campaign_placements (campaign_id, surface)
select c.id, s.surface
from public.marketplace_ad_campaigns as c
cross join (values ('marketplace_home'::text), ('marketplace_search'::text)) as s(surface)
on conflict (campaign_id, surface) do nothing;

alter table public.marketplace_ad_events
  drop constraint marketplace_ad_events_surface_check;

alter table public.marketplace_ad_events
  add constraint marketplace_ad_events_surface_check
  check (surface in ('marketplace_home', 'marketplace_search', 'social_feed', 'product_detail', 'cart', 'checkout'));

create or replace function public.set_my_marketplace_ad_campaign_placements(
  p_campaign_id uuid,
  p_surfaces text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.marketplace_ad_campaigns;
  v_distinct_count integer;
  v_placements text[];
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'marketplace_auth_required';
  end if;
  if p_campaign_id is null then
    raise exception using errcode = '22023', message = 'marketplace_ad_campaign_required';
  end if;
  if p_surfaces is null or cardinality(p_surfaces) < 1 or cardinality(p_surfaces) > 3 then
    raise exception using errcode = '22023', message = 'marketplace_ad_placements_invalid';
  end if;

  select count(distinct requested.surface)::integer
  into v_distinct_count
  from unnest(p_surfaces) as requested(surface);

  if v_distinct_count <> cardinality(p_surfaces)
    or exists (
      select 1
      from unnest(p_surfaces) as requested(surface)
      where requested.surface is null
        or requested.surface not in ('marketplace_home', 'marketplace_search', 'social_feed')
    ) then
    raise exception using errcode = '22023', message = 'marketplace_ad_placements_invalid';
  end if;

  select c.*
  into v_campaign
  from public.marketplace_ad_campaigns as c
  where c.id = p_campaign_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'marketplace_ad_campaign_not_found';
  end if;

  perform private.business_require_capability(v_campaign.seller_id, 'business.ads.manage');

  if v_campaign.status <> 'draft' or v_campaign.funded_at is not null then
    raise exception using errcode = '22023', message = 'marketplace_ad_placements_locked';
  end if;

  delete from public.marketplace_ad_campaign_placements as placement
  where placement.campaign_id = v_campaign.id;

  insert into public.marketplace_ad_campaign_placements (campaign_id, surface)
  select v_campaign.id, requested.surface
  from unnest(p_surfaces) as requested(surface);

  select array_agg(placement.surface order by placement.surface)
  into v_placements
  from public.marketplace_ad_campaign_placements as placement
  where placement.campaign_id = v_campaign.id;

  return pg_catalog.jsonb_build_object(
    'campaign_id', v_campaign.id,
    'placements', v_placements
  );
end;
$$;

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
as $$
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
    insert into public.marketplace_ad_campaign_placements (campaign_id, surface)
    values
      (v_prior.id, 'marketplace_home'),
      (v_prior.id, 'marketplace_search')
    on conflict (campaign_id, surface) do nothing;
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

  insert into public.marketplace_ad_campaign_placements (campaign_id, surface)
  values
    (v_created, 'marketplace_home'),
    (v_created, 'marketplace_search');

  return public.marketplace_ad_campaign_result(v_created);
end;
$$;

create or replace function public.fetch_marketplace_sponsored_products_v2(
  p_surface text,
  p_category text default null,
  p_limit integer default 4,
  p_session text default null
)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'campaign_id', c.id,
    'product_id', p.id,
    'title', p.title,
    'images', p.images,
    'seller', pg_catalog.jsonb_build_object('username', u.username, 'display_name', u.display_name),
    'price', (card->>'price')::numeric,
    'base_price', (card->>'base_price')::numeric,
    'promotion_id', card->>'promotion_id',
    'sponsored', true,
    'label', 'Patrocinado'
  )
  from public.marketplace_ad_campaigns as c
  join public.products as p on p.id = c.product_id
  join public.user_profiles as u on u.id = c.seller_id
  cross join lateral public.marketplace_ad_delivery_eligibility_at(c.id, pg_catalog.now()) as elig
  join lateral public.marketplace_public_product_card_price(p.id, pg_catalog.now()) as card on true
  where p_surface in ('marketplace_home', 'marketplace_search', 'social_feed')
    and exists (
      select 1
      from public.marketplace_ad_campaign_placements as placement
      where placement.campaign_id = c.id
        and placement.surface = p_surface
    )
    and elig.eligible
    and c.funded_at is not null
    and c.status in ('active', 'scheduled')
    and c.spent_bdag + c.released_bdag < c.total_budget_bdag
    and (p_category is null or p.category = p_category)
  order by pg_catalog.md5(
    c.id::text || coalesce(p_session, 'public') || pg_catalog.date_trunc('hour', pg_catalog.now())::text
  )
  limit least(greatest(coalesce(p_limit, 4), 0), 8)
$$;

create or replace function public.record_marketplace_ad_event(
  p_campaign_id uuid,
  p_product_id uuid,
  p_event_type text,
  p_surface text,
  p_event_key text,
  p_anonymous_session_id text default null,
  p_metadata jsonb default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_campaign public.marketplace_ad_campaigns;
  v_prior public.marketplace_ad_events;
  v_bucket timestamptz := pg_catalog.to_timestamp(floor(extract(epoch from pg_catalog.now()) / 600) * 600);
  v_created public.marketplace_ad_events;
  v_touch uuid;
  v_allowed text[];
begin
  if v_actor is null
    and (p_anonymous_session_id is null or pg_catalog.char_length(p_anonymous_session_id) not between 16 and 128) then
    raise exception using errcode = '22023', message = 'marketplace_ad_actor_required';
  end if;
  if p_event_type not in ('impression', 'click', 'product_view', 'add_to_cart')
    or p_surface not in ('marketplace_home', 'marketplace_search', 'social_feed', 'product_detail', 'cart') then
    raise exception using errcode = '22023', message = 'marketplace_ad_event_invalid';
  end if;
  if p_event_key is null or pg_catalog.char_length(p_event_key) not between 16 and 160 then
    raise exception using errcode = '22023', message = 'marketplace_ad_event_key_invalid';
  end if;
  v_allowed := case p_event_type
    when 'impression' then array['position']
    when 'click' then array['position']
    when 'product_view' then array[]::text[]
    else array['variant_id', 'quantity']
  end;
  if pg_catalog.jsonb_typeof(p_metadata) <> 'object'
    or exists (
      select 1
      from pg_catalog.jsonb_object_keys(p_metadata) as metadata_key(key)
      where not (metadata_key.key = any(v_allowed))
    ) then
    raise exception using errcode = '22023', message = 'marketplace_ad_metadata_invalid';
  end if;

  select c.* into v_campaign
  from public.marketplace_ad_campaigns as c
  where c.id = p_campaign_id
    and c.product_id = p_product_id;
  if not found then
    raise exception using errcode = '22023', message = 'marketplace_ad_product_mismatch';
  end if;

  if p_surface in ('marketplace_home', 'marketplace_search', 'social_feed')
    and not exists (
      select 1
      from public.marketplace_ad_campaign_placements as placement
      where placement.campaign_id = v_campaign.id
        and placement.surface = p_surface
    ) then
    raise exception using errcode = '22023', message = 'marketplace_ad_placement_not_enabled';
  end if;

  if p_event_type in ('impression', 'click', 'product_view')
    and (
      not v_campaign.eligibility_state
      or v_campaign.starts_at > pg_catalog.now()
      or v_campaign.ends_at <= pg_catalog.now()
      or v_campaign.status not in ('active', 'scheduled')
    ) then
    raise exception using errcode = '22023', message = 'marketplace_ad_not_delivery_eligible';
  end if;

  select e.* into v_prior
  from public.marketplace_ad_events as e
  where e.event_key = p_event_key;
  if found then
    if v_prior.campaign_id <> v_campaign.id
      or v_prior.product_id <> p_product_id
      or v_prior.event_type <> p_event_type
      or v_prior.surface <> p_surface
      or v_prior.metadata <> p_metadata
      or v_prior.viewer_id is distinct from v_actor
      or v_prior.anonymous_session_id is distinct from (case when v_actor is null then p_anonymous_session_id end) then
      raise exception using errcode = '23505', message = 'marketplace_ad_event_idempotency_conflict';
    end if;
    if v_prior.event_type = 'product_view' then
      select touch.id into v_touch
      from public.marketplace_ad_touches as touch
      where touch.source_event_id = v_prior.id;
    end if;
    return to_jsonb(v_prior) || pg_catalog.jsonb_build_object('touch_id', v_touch);
  end if;

  begin
    insert into public.marketplace_ad_events (
      campaign_id, product_id, viewer_id, anonymous_session_id,
      event_type, surface, event_key, event_bucket, metadata
    ) values (
      v_campaign.id, p_product_id, v_actor,
      case when v_actor is null then p_anonymous_session_id end,
      p_event_type, p_surface, p_event_key, v_bucket, p_metadata
    ) returning * into v_created;
  exception when unique_violation then
    if p_event_type = 'impression' then
      select e.* into v_created
      from public.marketplace_ad_events as e
      where e.campaign_id = v_campaign.id
        and coalesce(e.viewer_id::text, e.anonymous_session_id) = coalesce(v_actor::text, p_anonymous_session_id)
        and e.surface = p_surface
        and e.event_bucket = v_bucket
        and e.event_type = 'impression';
    else
      raise;
    end if;
  end;

  if p_event_type = 'product_view' then
    insert into public.marketplace_ad_touches (
      campaign_id, product_id, viewer_id, anonymous_session_id,
      surface, touched_at, expires_at, source_event_id
    ) values (
      v_campaign.id, p_product_id, v_actor,
      case when v_actor is null then p_anonymous_session_id end,
      p_surface, pg_catalog.now(), pg_catalog.now() + interval '24 hours', v_created.id
    ) returning id into v_touch;
  end if;

  return to_jsonb(v_created) || pg_catalog.jsonb_build_object('touch_id', v_touch);
end;
$$;

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
as $$
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
      c.id, c.product_id, p.title as product_title, p.images[1] as product_image_url,
      c.name, c.status, c.starts_at, c.ends_at, c.total_budget_bdag,
      c.spent_bdag, c.released_bdag,
      greatest(c.total_budget_bdag - c.spent_bdag - c.released_bdag, 0::numeric) as remaining_reserved_bdag,
      c.eligible_elapsed_seconds, c.eligibility_state, c.eligibility_reason,
      c.created_at, c.updated_at
    from public.marketplace_ad_campaigns as c
    join public.products as p on p.id = c.product_id
    where c.seller_id = p_business_owner_id
      and (p_status is null or c.status = p_status)
      and (p_cursor_created_at is null or (c.created_at, c.id) < (p_cursor_created_at, p_cursor_id))
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
      coalesce(pl.placements, array[]::text[]) as placements,
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
      select count(distinct oa.order_id)::bigint as orders,
        coalesce(sum(oa.attributed_gmv_bdag), 0::numeric) as attributed_gmv_bdag
      from public.marketplace_order_ad_attribution as oa
      where oa.campaign_id = r.id
    ) as a on true
    left join lateral (
      select array_agg(placement.surface order by placement.surface) as placements
      from public.marketplace_ad_campaign_placements as placement
      where placement.campaign_id = r.id
    ) as pl on true
    left join public.marketplace_ad_finalizations as f on f.campaign_id = r.id
  ), campaign_summary as (
    select
      count(*) filter (where c.status in ('scheduled', 'active'))::bigint as active_campaigns,
      coalesce(sum(c.total_budget_bdag), 0::numeric) as total_budget_bdag,
      coalesce(sum(c.spent_bdag), 0::numeric) as spent_bdag
    from public.marketplace_ad_campaigns as c
    where c.seller_id = p_business_owner_id
  ), event_summary as (
    select count(*) filter (where ev.event_type = 'impression')::bigint as impressions,
      count(*) filter (where ev.event_type = 'click')::bigint as clicks
    from public.marketplace_ad_events as ev
    join public.marketplace_ad_campaigns as c on c.id = ev.campaign_id
    where c.seller_id = p_business_owner_id
  ), attribution_summary as (
    select count(distinct oa.order_id)::bigint as orders,
      coalesce(sum(oa.attributed_gmv_bdag), 0::numeric) as attributed_gmv_bdag
    from public.marketplace_order_ad_attribution as oa
    join public.marketplace_ad_campaigns as c on c.id = oa.campaign_id
    where c.seller_id = p_business_owner_id
  )
  select pg_catalog.jsonb_build_object(
    'items', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', x.id, 'product_id', x.product_id, 'product_title', x.product_title,
          'product_image_url', x.product_image_url, 'name', x.name, 'status', x.status,
          'starts_at', x.starts_at, 'ends_at', x.ends_at,
          'total_budget_bdag', x.total_budget_bdag, 'spent_bdag', x.spent_bdag,
          'released_bdag', x.released_bdag, 'remaining_reserved_bdag', x.remaining_reserved_bdag,
          'eligible_elapsed_seconds', x.eligible_elapsed_seconds,
          'eligibility_state', x.eligibility_state, 'eligibility_reason', x.eligibility_reason,
          'impressions', x.impressions, 'clicks', x.clicks,
          'product_views', x.product_views, 'cart_adds', x.cart_adds,
          'orders', x.orders, 'attributed_gmv_bdag', x.attributed_gmv_bdag,
          'placements', x.placements, 'finalized_at', x.finalized_at,
          'created_at', x.created_at, 'updated_at', x.updated_at
        ) order by x.created_at desc, x.id desc
      ) from enriched as x
    ), '[]'::jsonb),
    'next_cursor', case when exists (select 1 from numbered where rn = v_limit + 1) then (
      select pg_catalog.jsonb_build_object('created_at', n.created_at, 'id', n.id)
      from numbered as n where n.rn = v_limit
    ) else null end,
    'summary', (
      select pg_catalog.jsonb_build_object(
        'active_campaigns', cs.active_campaigns, 'total_budget_bdag', cs.total_budget_bdag,
        'spent_bdag', cs.spent_bdag, 'impressions', es.impressions, 'clicks', es.clicks,
        'orders', ats.orders, 'attributed_gmv_bdag', ats.attributed_gmv_bdag
      )
      from campaign_summary as cs
      cross join event_summary as es
      cross join attribution_summary as ats
    )
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.get_my_business_ad_campaign(
  p_business_owner_id uuid,
  p_campaign_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    'id', c.id, 'name', c.name, 'status', c.status,
    'starts_at', c.starts_at, 'ends_at', c.ends_at,
    'total_budget_bdag', c.total_budget_bdag, 'spent_bdag', c.spent_bdag,
    'released_bdag', c.released_bdag,
    'remaining_reserved_bdag', greatest(c.total_budget_bdag - c.spent_bdag - c.released_bdag, 0::numeric),
    'funded_at', c.funded_at, 'paused_at', c.paused_at, 'completed_at', c.completed_at,
    'eligible_elapsed_seconds', c.eligible_elapsed_seconds,
    'eligibility_state', c.eligibility_state, 'eligibility_reason', c.eligibility_reason,
    'created_at', c.created_at, 'updated_at', c.updated_at,
    'placements', coalesce(pl.placements, array[]::text[]),
    'product', pg_catalog.jsonb_build_object(
      'id', p.id, 'title', p.title, 'image_url', p.images[1],
      'price', p.price, 'currency', p.currency
    ),
    'metrics', pg_catalog.jsonb_build_object(
      'impressions', coalesce(ev.impressions, 0), 'clicks', coalesce(ev.clicks, 0),
      'product_views', coalesce(ev.product_views, 0), 'cart_adds', coalesce(ev.cart_adds, 0),
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
  ) into v_result
  from public.marketplace_ad_campaigns as c
  join public.products as p on p.id = c.product_id
  left join lateral (
    select array_agg(placement.surface order by placement.surface) as placements
    from public.marketplace_ad_campaign_placements as placement
    where placement.campaign_id = c.id
  ) as pl on true
  left join lateral (
    select
      coalesce(sum(s.impressions), 0)::bigint as impressions,
      coalesce(sum(s.clicks), 0)::bigint as clicks,
      coalesce(sum(s.product_views), 0)::bigint as product_views,
      coalesce(sum(s.cart_adds), 0)::bigint as cart_adds,
      coalesce(pg_catalog.jsonb_agg(s.surface_metrics order by s.surface)
        filter (where s.surface is not null), '[]'::jsonb) as surfaces
    from (
      select e2.surface,
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
    select count(distinct a.order_id)::bigint as orders,
      coalesce(sum(a.attributed_gmv_bdag), 0::numeric) as attributed_gmv_bdag,
      coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'order_number', a.order_number,
          'attributed_gmv_bdag', a.attributed_gmv_bdag,
          'attributed_at', a.attributed_at
        ) order by a.attributed_at desc, a.order_number
      ), '[]'::jsonb) as items
    from (
      select oa.order_id, o.order_number,
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
$$;

revoke all on function public.set_my_marketplace_ad_campaign_placements(uuid, text[]) from public, anon;
grant execute on function public.set_my_marketplace_ad_campaign_placements(uuid, text[]) to authenticated, service_role;

revoke all on function public.create_marketplace_ad_campaign_draft(uuid, text, numeric, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.create_marketplace_ad_campaign_draft(uuid, text, numeric, timestamptz, timestamptz, uuid) to authenticated, service_role;

revoke all on function public.fetch_marketplace_sponsored_products_v2(text, text, integer, text) from public;
grant execute on function public.fetch_marketplace_sponsored_products_v2(text, text, integer, text) to anon, authenticated, service_role;

revoke all on function public.record_marketplace_ad_event(uuid, uuid, text, text, text, text, jsonb) from public;
grant execute on function public.record_marketplace_ad_event(uuid, uuid, text, text, text, text, jsonb) to anon, authenticated, service_role;

revoke all on function public.search_my_business_ad_campaigns(uuid, text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.search_my_business_ad_campaigns(uuid, text, timestamptz, uuid, integer) to authenticated, service_role;

revoke all on function public.get_my_business_ad_campaign(uuid, uuid) from public, anon;
grant execute on function public.get_my_business_ad_campaign(uuid, uuid) to authenticated, service_role;
