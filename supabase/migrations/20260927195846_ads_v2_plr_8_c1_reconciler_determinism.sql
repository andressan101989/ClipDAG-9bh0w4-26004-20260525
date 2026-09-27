begin;

create or replace function public.reconcile_advertising_marketplace_purchase_conversions_v2(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.advertising_event_policy;
  v_item record;
  v_limit integer := coalesce(p_limit,100);
  v_has_touch boolean;
  v_existing boolean;
  v_result jsonb;
  v_conversion_key uuid;
  v_processed integer := 0;
  v_converted integer := 0;
  v_attributed integer := 0;
  v_skipped_no_touch integer := 0;
begin
  if session_user not in ('postgres','supabase_admin')
    and coalesce((select auth.role()),'') <> 'service_role' then
    raise exception using errcode='42501',message='advertising_conversion_reconciliation_forbidden';
  end if;
  if v_limit < 1 or v_limit > 500 then
    raise exception using errcode='22023',message='advertising_conversion_reconciliation_limit_invalid';
  end if;

  select * into strict v_policy
  from private.advertising_event_policy
  where singleton
  for update;

  if not v_policy.marketplace_purchase_conversion_enabled then
    return pg_catalog.jsonb_build_object(
      'authority','ads_v2','enabled',false,'processed',0,'converted',0,
      'attributed',0,'skipped_no_touch',0,'errors',0
    );
  end if;

  for v_item in
    select item.id,item.product_id,item.store_id,item.line_total,item.currency,
      order_row.buyer_id,order_row.confirmed_at
    from public.marketplace_orders order_row
    join public.marketplace_order_items item on item.order_id=order_row.id
    where order_row.confirmed_at is not null
      and order_row.confirmed_at >= v_policy.marketplace_purchase_conversion_started_at
      and order_row.cancelled_at is null
      and order_row.expired_at is null
      and (
        v_policy.marketplace_purchase_conversion_cursor_confirmed_at is null
        or (order_row.confirmed_at,item.id) > (
          v_policy.marketplace_purchase_conversion_cursor_confirmed_at,
          v_policy.marketplace_purchase_conversion_cursor_order_item_id
        )
      )
    order by order_row.confirmed_at,item.id
    limit v_limit
  loop
    v_processed := v_processed + 1;

    select exists (
      select 1
      from private.advertising_events event
      join private.advertising_campaigns campaign on campaign.id=event.campaign_id
      join private.advertising_destinations destination on destination.id=event.destination_id
      where event.viewer_user_id=v_item.buyer_id
        and event.occurred_at<=v_item.confirmed_at
        and (
          (event.event_type='click' and event.occurred_at>=v_item.confirmed_at-pg_catalog.make_interval(hours=>v_policy.click_attribution_window_hours))
          or
          (event.event_type='impression' and event.occurred_at>=v_item.confirmed_at-pg_catalog.make_interval(hours=>v_policy.impression_attribution_window_hours))
        )
        and campaign.objective='marketplace_sales'
        and (
          (destination.destination_type='marketplace_product' and destination.target_product_id=v_item.product_id)
          or
          (destination.destination_type='marketplace_store' and destination.target_store_id=v_item.store_id)
        )
    ) into v_has_touch;

    if not v_has_touch then
      v_skipped_no_touch := v_skipped_no_touch + 1;
    else
      select exists (
        select 1 from private.advertising_conversions conversion
        where conversion.source_type='marketplace_order_item'
          and conversion.source_reference_id=v_item.id
          and conversion.conversion_type='marketplace_purchase'
      ) into v_existing;
      v_conversion_key := (
        pg_catalog.substr(pg_catalog.md5('ads-v2-marketplace-purchase:'||v_item.id::text),1,8)||'-'||
        pg_catalog.substr(pg_catalog.md5('ads-v2-marketplace-purchase:'||v_item.id::text),9,4)||'-4'||
        pg_catalog.substr(pg_catalog.md5('ads-v2-marketplace-purchase:'||v_item.id::text),14,3)||'-a'||
        pg_catalog.substr(pg_catalog.md5('ads-v2-marketplace-purchase:'||v_item.id::text),18,3)||'-'||
        pg_catalog.substr(pg_catalog.md5('ads-v2-marketplace-purchase:'||v_item.id::text),21,12)
      )::uuid;
      v_result := public.record_advertising_marketplace_purchase_conversion_v2(v_item.id,v_conversion_key);
      if not v_existing then v_converted := v_converted + 1; end if;
      if coalesce((v_result->>'attributed')::boolean,false) then v_attributed := v_attributed + 1; end if;
    end if;

    update private.advertising_event_policy
    set marketplace_purchase_conversion_cursor_confirmed_at=v_item.confirmed_at,
        marketplace_purchase_conversion_cursor_order_item_id=v_item.id
    where singleton;
  end loop;

  return pg_catalog.jsonb_build_object(
    'authority','ads_v2','enabled',true,'processed',v_processed,'converted',v_converted,
    'attributed',v_attributed,'skipped_no_touch',v_skipped_no_touch,'errors',0,
    'cursor_confirmed_at',(select marketplace_purchase_conversion_cursor_confirmed_at from private.advertising_event_policy where singleton),
    'cursor_order_item_id',(select marketplace_purchase_conversion_cursor_order_item_id from private.advertising_event_policy where singleton)
  );
end;
$$;

revoke all on function public.reconcile_advertising_marketplace_purchase_conversions_v2(integer)
  from public,anon,authenticated;
grant execute on function public.reconcile_advertising_marketplace_purchase_conversions_v2(integer)
  to service_role;

comment on function public.reconcile_advertising_marketplace_purchase_conversions_v2(integer) is
  'Bounded, cutover-scoped Ads V2 Marketplace purchase analytics reconciliation. Purchase eligibility follows canonical confirmed/cancelled/expired state; unexpected item failures propagate so the transaction and cursor remain retry-safe.';

commit;
