begin;

alter table private.advertising_event_policy
  add column marketplace_purchase_conversion_enabled boolean not null default false,
  add column marketplace_purchase_conversion_started_at timestamptz,
  add column marketplace_purchase_conversion_cursor_confirmed_at timestamptz,
  add column marketplace_purchase_conversion_cursor_order_item_id uuid;

alter table private.advertising_event_policy
  add constraint advertising_event_policy_marketplace_conversion_cutover_chk
    check (not marketplace_purchase_conversion_enabled or marketplace_purchase_conversion_started_at is not null),
  add constraint advertising_event_policy_marketplace_conversion_cursor_chk
    check (
      (marketplace_purchase_conversion_cursor_confirmed_at is null and marketplace_purchase_conversion_cursor_order_item_id is null)
      or
      (marketplace_purchase_conversion_cursor_confirmed_at is not null and marketplace_purchase_conversion_cursor_order_item_id is not null)
    );

update private.advertising_event_policy
set marketplace_purchase_conversion_enabled = true,
    marketplace_purchase_conversion_started_at = clock_timestamp(),
    marketplace_purchase_conversion_cursor_confirmed_at = null,
    marketplace_purchase_conversion_cursor_order_item_id = null
where singleton;

create index marketplace_orders_ads_conversion_scan_idx
  on public.marketplace_orders(confirmed_at,id)
  where confirmed_at is not null and cancelled_at is null and expired_at is null;

create or replace function private.advertising_marketplace_sales_ad_destination_valid(p_ad_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when campaign.objective <> 'marketplace_sales' then true
      when destination.destination_type = 'marketplace_product' then exists (
        select 1
        from private.business_account_marketplace_links link
        join public.marketplace_sellers seller
          on seller.user_id = link.marketplace_seller_user_id
         and seller.status = 'approved'
        join public.products product
          on product.id = destination.target_product_id
         and product.seller_id = link.marketplace_seller_user_id
         and product.status = 'active'
         and product.published_at is not null
         and product.deleted_at is null
         and product.moderation_status = 'approved'
         and product.product_type = 'physical'
         and product.currency = 'BDAG'
        join public.marketplace_stores store
          on store.id = product.store_id
         and store.seller_id = product.seller_id
         and store.status = 'active'
        where link.business_account_id = account.business_account_id
          and public.marketplace_product_publication_reason(product.id,product.seller_id) is null
      )
      when destination.destination_type = 'marketplace_store' then exists (
        select 1
        from private.business_account_marketplace_links link
        join public.marketplace_sellers seller
          on seller.user_id = link.marketplace_seller_user_id
         and seller.status = 'approved'
        join public.marketplace_stores store
          on store.id = destination.target_store_id
         and store.seller_id = link.marketplace_seller_user_id
         and store.status = 'active'
        where link.business_account_id = account.business_account_id
      )
      else false
    end
    from private.advertising_ads ad
    join private.advertising_ad_sets ad_set on ad_set.id = ad.ad_set_id
    join private.advertising_campaigns campaign on campaign.id = ad_set.campaign_id
    join private.ad_accounts account on account.id = campaign.ad_account_id
    join private.advertising_destinations destination on destination.id = ad.destination_id
    where ad.id = p_ad_id
      and destination.campaign_id = campaign.id
  ),false)
$$;

revoke all on function private.advertising_marketplace_sales_ad_destination_valid(uuid)
  from public,anon,authenticated,service_role;

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
  v_errors integer := 0;
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
    where order_row.confirmed_at >= v_policy.marketplace_purchase_conversion_started_at
      and order_row.cancelled_at is null
      and order_row.expired_at is null
      and order_row.status in ('confirmed','processing','shipped','delivered')
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
      begin
        v_result := public.record_advertising_marketplace_purchase_conversion_v2(v_item.id,v_conversion_key);
      exception when others then
        v_errors := v_errors + 1;
        exit;
      end;
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
    'attributed',v_attributed,'skipped_no_touch',v_skipped_no_touch,'errors',v_errors,
    'cursor_confirmed_at',(select marketplace_purchase_conversion_cursor_confirmed_at from private.advertising_event_policy where singleton),
    'cursor_order_item_id',(select marketplace_purchase_conversion_cursor_order_item_id from private.advertising_event_policy where singleton)
  );
end;
$$;

revoke all on function public.reconcile_advertising_marketplace_purchase_conversions_v2(integer)
  from public,anon,authenticated;
grant execute on function public.reconcile_advertising_marketplace_purchase_conversions_v2(integer)
  to service_role;

create or replace function public.submit_my_advertising_ad_for_review(
  p_ad_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_ad private.advertising_ads;
  v_version private.advertising_creative_versions;
  v_event private.advertising_ad_review_events;
  v_validated_content_fingerprint text;
  v_submission_fingerprint text;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'advertising_auth_required';
  end if;
  if p_ad_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'advertising_ad_submission_input_invalid';
  end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_actor) then
    raise exception using errcode = '42501', message = 'advertising_adult_eligibility_required';
  end if;

  select * into v_ad from private.advertising_ads where id = p_ad_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'advertising_ad_not_found';
  end if;

  perform 1
  from private.advertising_ads as ad
  join private.advertising_ad_sets as ad_set on ad_set.id = ad.ad_set_id
  join private.advertising_campaigns as campaign on campaign.id = ad_set.campaign_id
  join private.ad_accounts as account on account.id = campaign.ad_account_id
  join private.business_accounts as business on business.id = account.business_account_id
  join private.advertising_destinations as destination on destination.id = ad.destination_id
  join private.advertising_creative_versions as version on version.id = ad.creative_version_id
  join private.advertising_creatives as creative on creative.id = version.creative_id
  where ad.id = p_ad_id
    and ad.status = 'draft'
    and ad_set.status = 'draft'
    and campaign.status = 'draft'
    and destination.status = 'draft'
    and destination.campaign_id = campaign.id
    and creative.status = 'draft'
    and creative.ad_account_id = campaign.ad_account_id
    and account.status = 'active'
    and business.status = 'active'
    and business.owner_user_id = v_actor;
  if not found then
    raise exception using errcode = '42501', message = 'advertising_ad_submission_access_denied';
  end if;
  if not private.advertising_marketplace_sales_ad_destination_valid(p_ad_id) then
    raise exception using errcode='22023',message='advertising_marketplace_sales_destination_invalid';
  end if;

  select * into v_event
  from private.advertising_ad_review_events
  where ad_id = p_ad_id and idempotency_key = p_idempotency_key;
  if found then
    if v_event.event_type <> 'submitted'
      or v_event.actor_user_id <> v_actor
      or v_event.submission_fingerprint is distinct from v_ad.submission_fingerprint then
      raise exception using errcode = '23505', message = 'advertising_ad_submission_idempotency_conflict';
    end if;
    return private.ads_ad_result(p_ad_id);
  end if;

  if v_ad.review_status = 'approved' then
    raise exception using errcode = '55000', message = 'advertising_ad_already_approved';
  end if;
  if v_ad.review_status = 'pending' then
    return private.ads_ad_result(p_ad_id);
  end if;

  select * into v_version
  from private.advertising_creative_versions
  where id = v_ad.creative_version_id;
  v_validated_content_fingerprint := private.ads_validate_creative_payload(
    v_version.created_by, v_version.format, v_version.media_asset_id,
    v_version.video_asset_id, v_version.primary_text, v_version.headline,
    v_version.description, v_version.call_to_action
  );
  if v_validated_content_fingerprint is distinct from v_version.content_fingerprint then
    raise exception using errcode = '55000', message = 'advertising_creative_content_changed';
  end if;

  v_submission_fingerprint := private.ads_ad_submission_fingerprint(p_ad_id);
  if v_submission_fingerprint is null then
    raise exception using errcode = '55000', message = 'advertising_ad_submission_fingerprint_failed';
  end if;

  update private.advertising_ads
  set review_status = 'pending', submission_fingerprint = v_submission_fingerprint,
      submitted_at = clock_timestamp(), reviewed_at = null
  where id = p_ad_id;

  insert into private.advertising_ad_review_events(
    ad_id, event_type, actor_user_id, submission_fingerprint,
    reason_code, note, note_is_internal, idempotency_key
  ) values (
    p_ad_id, 'submitted', v_actor, v_submission_fingerprint,
    null, null, true, p_idempotency_key
  );
  return private.ads_ad_result(p_ad_id);
end;
$$;

revoke all on function public.submit_my_advertising_ad_for_review(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.submit_my_advertising_ad_for_review(uuid,uuid)
  to authenticated;

do $$
declare v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname='reconcile-advertising-marketplace-purchase-conversions-v2'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule(
    'reconcile-advertising-marketplace-purchase-conversions-v2',
    '* * * * *',
    'select public.reconcile_advertising_marketplace_purchase_conversions_v2(100);'
  );
end;
$$;

comment on function public.reconcile_advertising_marketplace_purchase_conversions_v2(integer) is
  'Bounded, cutover-scoped Ads V2 Marketplace purchase analytics reconciliation. Reuses the canonical last_click_then_impression authority and never participates in checkout or financial allocation.';

commit;
