-- BUSINESS-WEB-BW-I
-- One capability-scoped, read-only projection over existing canonical authorities.
-- No tables, financial mutations, historical DML, or parallel analytics state.

create or replace function public.get_my_business_analytics(
  p_business_owner_id uuid,
  p_range text default '30d'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_days integer;
  v_current_end timestamptz;
  v_current_start timestamptz;
  v_previous_start timestamptz;
  v_analytics_allowed boolean;
  v_ads_allowed boolean;
  v_finance_allowed boolean;
  v_payouts_allowed boolean;
  v_current jsonb;
  v_previous jsonb;
  v_daily jsonb;
  v_products jsonb;
  v_variants jsonb;
  v_sources jsonb;
  v_ads jsonb;
  v_finance jsonb;
  v_payouts jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'marketplace_auth_required';
  end if;
  if p_business_owner_id is null then
    raise exception using errcode = '22023', message = 'business_owner_required';
  end if;

  v_analytics_allowed := private.business_actor_has_capability(
    p_business_owner_id,
    'business.analytics.read'
  );
  if not v_analytics_allowed then
    raise exception using errcode = '42501', message = 'business_capability_required';
  end if;

  v_days := case p_range when '7d' then 7 when '30d' then 30 when '90d' then 90 else null end;
  if v_days is null then
    raise exception using errcode = '22023', message = 'business_analytics_range_invalid';
  end if;

  v_current_end := (pg_catalog.date_trunc('day', pg_catalog.now() at time zone 'UTC') at time zone 'UTC') + interval '1 day';
  v_current_start := v_current_end - pg_catalog.make_interval(days => v_days);
  v_previous_start := v_current_start - pg_catalog.make_interval(days => v_days);

  v_ads_allowed :=
    private.business_actor_has_capability(p_business_owner_id, 'business.ads.read')
    or private.business_actor_has_capability(p_business_owner_id, 'business.ads.manage');
  v_finance_allowed := private.business_actor_has_capability(p_business_owner_id, 'business.finance.read');
  v_payouts_allowed :=
    private.business_actor_has_capability(p_business_owner_id, 'business.payouts.read')
    or private.business_actor_has_capability(p_business_owner_id, 'business.payouts.manage');

  select pg_catalog.jsonb_build_object(
    'gmv_bdag', coalesce(sum(e.gross_merchandise_bdag) filter (where e.event_name = 'purchase_completed'), 0::numeric)::text,
    'orders', count(distinct e.order_id) filter (where e.event_name = 'purchase_completed'),
    'units', coalesce(sum(e.quantity) filter (where e.event_name = 'purchase_completed'), 0),
    'product_views', count(*) filter (where e.event_name = 'product_view'),
    'cart_adds', count(*) filter (where e.event_name = 'add_to_cart'),
    'refunded_bdag', (
      select coalesce(sum(a.gross_amount), 0::numeric)::text
      from public.marketplace_payment_allocations as a
      where a.seller_id = p_business_owner_id
        and a.refunded_at >= v_current_start
        and a.refunded_at < v_current_end
    )
  ) into v_current
  from public.marketplace_commerce_events as e
  where e.seller_id = p_business_owner_id
    and e.occurred_at >= v_current_start
    and e.occurred_at < v_current_end;

  select pg_catalog.jsonb_build_object(
    'gmv_bdag', coalesce(sum(e.gross_merchandise_bdag) filter (where e.event_name = 'purchase_completed'), 0::numeric)::text,
    'orders', count(distinct e.order_id) filter (where e.event_name = 'purchase_completed'),
    'units', coalesce(sum(e.quantity) filter (where e.event_name = 'purchase_completed'), 0),
    'product_views', count(*) filter (where e.event_name = 'product_view'),
    'cart_adds', count(*) filter (where e.event_name = 'add_to_cart'),
    'refunded_bdag', (
      select coalesce(sum(a.gross_amount), 0::numeric)::text
      from public.marketplace_payment_allocations as a
      where a.seller_id = p_business_owner_id
        and a.refunded_at >= v_previous_start
        and a.refunded_at < v_current_start
    )
  ) into v_previous
  from public.marketplace_commerce_events as e
  where e.seller_id = p_business_owner_id
    and e.occurred_at >= v_previous_start
    and e.occurred_at < v_current_start;

  with days as (
    select d::date as day
    from pg_catalog.generate_series(
      v_current_start,
      v_current_end - interval '1 day',
      interval '1 day'
    ) as d
  ), activity as (
    select
      (e.occurred_at at time zone 'UTC')::date as day,
      coalesce(sum(e.gross_merchandise_bdag) filter (where e.event_name = 'purchase_completed'), 0::numeric) as gmv_bdag,
      count(distinct e.order_id) filter (where e.event_name = 'purchase_completed') as orders,
      coalesce(sum(e.quantity) filter (where e.event_name = 'purchase_completed'), 0) as units,
      count(*) filter (where e.event_name = 'product_view') as product_views
    from public.marketplace_commerce_events as e
    where e.seller_id = p_business_owner_id
      and e.occurred_at >= v_current_start
      and e.occurred_at < v_current_end
    group by 1
  )
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'day', pg_catalog.to_char(d.day, 'YYYY-MM-DD'),
      'gmv_bdag', coalesce(a.gmv_bdag, 0::numeric)::text,
      'orders', coalesce(a.orders, 0),
      'units', coalesce(a.units, 0),
      'product_views', coalesce(a.product_views, 0)
    ) order by d.day
  ), '[]'::jsonb) into v_daily
  from days as d
  left join activity as a using (day);

  with product_activity as (
    select
      e.product_id,
      coalesce(max(p.title), 'Producto eliminado') as title,
      (array_agg(p.images[1]) filter (where p.images[1] is not null))[1] as image_url,
      count(*) filter (where e.event_name = 'product_view') as views,
      coalesce(sum(e.quantity) filter (where e.event_name = 'purchase_completed'), 0) as units,
      count(distinct e.order_id) filter (where e.event_name = 'purchase_completed') as orders,
      coalesce(sum(e.gross_merchandise_bdag) filter (where e.event_name = 'purchase_completed'), 0::numeric) as gmv_bdag
    from public.marketplace_commerce_events as e
    left join public.products as p on p.id = e.product_id
    where e.seller_id = p_business_owner_id
      and e.occurred_at >= v_current_start
      and e.occurred_at < v_current_end
      and e.product_id is not null
    group by e.product_id
  ), ranked as (
    select pa.*, count(*) over () as total_count
    from product_activity as pa
    order by pa.gmv_bdag desc, pa.units desc, pa.views desc, pa.product_id
    limit 20
  )
  select pg_catalog.jsonb_build_object(
    'items', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'product_id', r.product_id,
      'title', r.title,
      'image_url', r.image_url,
      'views', r.views,
      'units', r.units,
      'orders', r.orders,
      'gmv_bdag', r.gmv_bdag::text
    ) order by r.gmv_bdag desc, r.units desc, r.views desc, r.product_id), '[]'::jsonb),
    'total_count', coalesce(max(r.total_count), 0)
  ) into v_products
  from ranked as r;

  with variant_activity as (
    select
      e.variant_id,
      e.product_id,
      coalesce(max(nullif(v.title, '')), max(nullif(v.sku, '')), 'Variante eliminada') as label,
      count(*) filter (where e.event_name in ('variant_selected', 'product_view')) as views,
      coalesce(sum(e.quantity) filter (where e.event_name = 'purchase_completed'), 0) as units,
      count(distinct e.order_id) filter (where e.event_name = 'purchase_completed') as orders,
      coalesce(sum(e.gross_merchandise_bdag) filter (where e.event_name = 'purchase_completed'), 0::numeric) as gmv_bdag
    from public.marketplace_commerce_events as e
    left join public.marketplace_product_variants as v on v.id = e.variant_id
    where e.seller_id = p_business_owner_id
      and e.occurred_at >= v_current_start
      and e.occurred_at < v_current_end
      and e.variant_id is not null
    group by e.variant_id, e.product_id
  ), ranked as (
    select va.*, count(*) over () as total_count
    from variant_activity as va
    order by va.gmv_bdag desc, va.units desc, va.views desc, va.variant_id
    limit 20
  )
  select pg_catalog.jsonb_build_object(
    'items', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'variant_id', r.variant_id,
      'product_id', r.product_id,
      'label', r.label,
      'views', r.views,
      'units', r.units,
      'orders', r.orders,
      'gmv_bdag', r.gmv_bdag::text
    ) order by r.gmv_bdag desc, r.units desc, r.views desc, r.variant_id), '[]'::jsonb),
    'total_count', coalesce(max(r.total_count), 0)
  ) into v_variants
  from ranked as r;

  with source_activity as (
    select
      e.source_type as source,
      count(*) filter (where e.event_name = 'product_view') as views,
      count(*) filter (where e.event_name = 'add_to_cart') as cart_adds,
      count(distinct e.order_id) filter (where e.event_name = 'purchase_completed') as orders,
      coalesce(sum(e.quantity) filter (where e.event_name = 'purchase_completed'), 0) as units,
      coalesce(sum(e.gross_merchandise_bdag) filter (where e.event_name = 'purchase_completed'), 0::numeric) as gmv_bdag
    from public.marketplace_commerce_events as e
    where e.seller_id = p_business_owner_id
      and e.occurred_at >= v_current_start
      and e.occurred_at < v_current_end
    group by e.source_type
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'source', s.source,
    'views', s.views,
    'cart_adds', s.cart_adds,
    'orders', s.orders,
    'units', s.units,
    'gmv_bdag', s.gmv_bdag::text
  ) order by s.gmv_bdag desc, s.source), '[]'::jsonb) into v_sources
  from source_activity as s;

  if v_ads_allowed then
    with campaign_summary as (
      select count(*) filter (where c.status in ('scheduled', 'active')) as active_campaigns
      from public.marketplace_ad_campaigns as c
      where c.seller_id = p_business_owner_id
    ), event_summary as (
      select
        count(*) filter (where e.event_type = 'impression') as impressions,
        count(*) filter (where e.event_type = 'click') as clicks
      from public.marketplace_ad_events as e
      join public.marketplace_ad_campaigns as c on c.id = e.campaign_id
      where c.seller_id = p_business_owner_id
        and e.occurred_at >= v_current_start
        and e.occurred_at < v_current_end
    ), spend_summary as (
      select coalesce(sum(m.delta_spend_bdag), 0::numeric) as spent_bdag
      from public.marketplace_ad_delivery_materializations as m
      join public.marketplace_ad_campaigns as c on c.id = m.campaign_id
      where c.seller_id = p_business_owner_id
        and m.bucket_start >= v_current_start
        and m.bucket_start < v_current_end
    ), attribution_summary as (
      select
        count(distinct a.order_id) as attributed_orders,
        coalesce(sum(a.attributed_gmv_bdag), 0::numeric) as attributed_gmv_bdag
      from public.marketplace_order_ad_attribution as a
      join public.marketplace_ad_campaigns as c on c.id = a.campaign_id
      where c.seller_id = p_business_owner_id
        and a.attributed_at >= v_current_start
        and a.attributed_at < v_current_end
    )
    select pg_catalog.jsonb_build_object(
      'active_campaigns', c.active_campaigns,
      'impressions', e.impressions,
      'clicks', e.clicks,
      'spent_bdag', s.spent_bdag::text,
      'attributed_orders', a.attributed_orders,
      'attributed_gmv_bdag', a.attributed_gmv_bdag::text,
      'roas', case when s.spent_bdag = 0 then null else pg_catalog.round(a.attributed_gmv_bdag / s.spent_bdag, 4)::text end
    ) into v_ads
    from campaign_summary as c
    cross join event_summary as e
    cross join spend_summary as s
    cross join attribution_summary as a;
  end if;

  if v_finance_allowed then
    select pg_catalog.jsonb_build_object(
      'bdag_balance', coalesce((
        select a.balance
        from public.ledger_accounts as a
        where a.owner_id = p_business_owner_id
          and a.account_type = 'user'
          and a.currency = 'BDAG'
        limit 1
      ), 0::numeric)::text,
      'settled_orders', count(distinct s.order_id),
      'seller_net_bdag', coalesce(sum(s.seller_net_amount), 0::numeric)::text
    ) into v_finance
    from public.marketplace_order_settlements as s
    where s.seller_id = p_business_owner_id
      and s.status = 'completed'
      and s.released_at >= v_current_start
      and s.released_at < v_current_end;
  end if;

  if v_payouts_allowed then
    select pg_catalog.jsonb_build_object(
      'pending_count', count(*) filter (where w.status in ('pending', 'queued', 'requested', 'signing')),
      'broadcasting_count', count(*) filter (where w.status in ('broadcasting', 'broadcasted')),
      'completed_count', count(*) filter (
        where w.status = 'completed'
          and w.completed_at >= v_current_start
          and w.completed_at < v_current_end
      ),
      'completed_bdag', coalesce(sum(w.bdag_amount) filter (
        where w.status = 'completed'
          and w.completed_at >= v_current_start
          and w.completed_at < v_current_end
      ), 0::numeric)::text
    ) into v_payouts
    from public.withdrawal_requests as w
    where w.user_id = p_business_owner_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'business_owner_id', p_business_owner_id,
    'range', p_range,
    'timezone', 'UTC',
    'generated_at', pg_catalog.now(),
    'window', pg_catalog.jsonb_build_object(
      'current_start', v_current_start,
      'current_end', v_current_end,
      'previous_start', v_previous_start,
      'previous_end', v_current_start
    ),
    'commerce', pg_catalog.jsonb_build_object(
      'current', v_current,
      'previous', v_previous,
      'comparisons', pg_catalog.jsonb_build_object(
        'gmv_percent', case when (v_previous->>'gmv_bdag')::numeric = 0 then null else pg_catalog.round(((v_current->>'gmv_bdag')::numeric - (v_previous->>'gmv_bdag')::numeric) * 100 / (v_previous->>'gmv_bdag')::numeric, 2)::text end,
        'orders_percent', case when (v_previous->>'orders')::numeric = 0 then null else pg_catalog.round(((v_current->>'orders')::numeric - (v_previous->>'orders')::numeric) * 100 / (v_previous->>'orders')::numeric, 2)::text end,
        'units_percent', case when (v_previous->>'units')::numeric = 0 then null else pg_catalog.round(((v_current->>'units')::numeric - (v_previous->>'units')::numeric) * 100 / (v_previous->>'units')::numeric, 2)::text end,
        'product_views_percent', case when (v_previous->>'product_views')::numeric = 0 then null else pg_catalog.round(((v_current->>'product_views')::numeric - (v_previous->>'product_views')::numeric) * 100 / (v_previous->>'product_views')::numeric, 2)::text end
      ),
      'daily', v_daily,
      'products', v_products,
      'variants', v_variants,
      'sources', v_sources
    ),
    'ads', pg_catalog.jsonb_build_object('authorized', v_ads_allowed, 'data', case when v_ads_allowed then v_ads else null end),
    'finance', pg_catalog.jsonb_build_object('authorized', v_finance_allowed, 'data', case when v_finance_allowed then v_finance else null end),
    'payouts', pg_catalog.jsonb_build_object('authorized', v_payouts_allowed, 'data', case when v_payouts_allowed then v_payouts else null end)
  );
end;
$function$;

comment on function public.get_my_business_analytics(uuid, text) is
  'BW-I read-only unified Business Analytics. Commerce requires business.analytics.read; Ads, Finance and Payout payloads are independently capability-gated.';

revoke all on function public.get_my_business_analytics(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.get_my_business_analytics(uuid, text) to authenticated, service_role;
