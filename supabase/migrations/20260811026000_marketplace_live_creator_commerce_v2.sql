-- MKT-B7E: buyer-safe LIVE attribution handoff for the shared Marketplace cart.
-- Financial authority remains in B7A/B7F. Own-product pins intentionally return
-- no creator attribution and continue through the ordinary Marketplace checkout.

-- Preserve the existing host/idempotency/readiness contract while making the
-- one-featured transition compatible with the partial unique index. A single
-- multi-row UPDATE can check the new featured row before clearing the old row.
create or replace function public.feature_live_session_product(
  p_session_id uuid,
  p_live_session_product_id uuid,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  fingerprint text;
  prior public.live_commerce_commands;
  c record;
  r public.live_session_products;
  readiness record;
  result jsonb;
begin
  if actor is null or p_session_id is null or p_live_session_product_id is null or p_idempotency_key is null then
    raise exception using message = 'live_commerce_invalid_input';
  end if;
  fingerprint := encode(extensions.digest(concat_ws('|',
    'feature', p_session_id, p_live_session_product_id), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':' || p_idempotency_key::text, 0));
  select * into prior
  from public.live_commerce_commands
  where actor_id = actor and idempotency_key = p_idempotency_key;
  if found then
    if prior.request_fingerprint <> fingerprint then
      raise exception using message = 'live_commerce_idempotency_conflict';
    end if;
    return prior.result_json;
  end if;
  select * into c from public.live_commerce_host_context(p_session_id);
  perform pg_advisory_xact_lock(hashtextextended('live-feature:' || p_session_id, 0));
  select * into r
  from public.live_session_products
  where id = p_live_session_product_id
    and session_id = p_session_id
    and status = 'active'
  for update;
  if not found then
    raise exception using message = 'live_commerce_pin_not_found';
  end if;
  select * into readiness
  from public.marketplace_evaluate_live_product_readiness(r.product_id, actor);
  if readiness.reason_code <> 'ready' then
    raise exception using message = 'live_product_readiness_' || readiness.reason_code;
  end if;
  if not exists (
    select 1
    from public.products p
    join public.marketplace_stores st on st.id = p.store_id and st.status = 'active'
    join public.marketplace_sellers ms on ms.user_id = p.seller_id and ms.status = 'approved'
    join public.marketplace_product_variants v on v.product_id = p.id
      and v.status = 'active' and v.archived_at is null
    join public.marketplace_inventory_levels i on i.variant_id = v.id and i.on_hand > i.reserved
    where p.id = r.product_id
      and p.status = 'active'
      and p.moderation_status = 'approved'
      and p.deleted_at is null
      and p.product_type = 'physical'
      and p.currency = 'BDAG'
  ) or (
    r.commerce_mode = 'affiliate_product'
    and not exists (
      select 1
      from public.marketplace_live_affiliate_offers o
      where o.id = r.affiliate_offer_id
        and o.status = 'active'
        and (o.starts_at is null or o.starts_at <= now())
        and (o.ends_at is null or o.ends_at > now())
        and (o.offer_scope = 'public_creator' or o.creator_id = actor)
    )
  ) then
    raise exception using message = 'live_commerce_product_unavailable';
  end if;

  update public.live_session_products
  set is_featured = false, version = version + 1
  where session_id = p_session_id
    and status = 'active'
    and is_featured
    and id <> r.id;
  update public.live_session_products
  set is_featured = true, version = version + 1
  where id = r.id and not is_featured;

  result := jsonb_build_object('id', r.id, 'is_featured', true);
  insert into public.live_commerce_commands(
    actor_id, session_id, command_type, idempotency_key, request_fingerprint, result_json)
  values(actor, p_session_id, 'feature', p_idempotency_key, fingerprint, result);
  return result;
end
$$;

create or replace function public.create_marketplace_creator_live_attribution(
  p_live_session_product_id uuid,
  p_variant_id uuid,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_pin public.live_session_products;
  v_session public.live_sessions;
  v_receipt jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'marketplace_auth_required';
  end if;
  if p_live_session_product_id is null or p_variant_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'marketplace_creator_live_attribution_invalid_input';
  end if;

  select * into v_pin
  from public.live_session_products
  where id = p_live_session_product_id
  for share;
  if not found or v_pin.status <> 'active' then
    raise exception using errcode = '22023', message = 'marketplace_creator_live_source_unavailable';
  end if;

  select * into v_session
  from public.live_sessions
  where id = v_pin.session_id
  for share;
  if not found or v_session.status <> 'live' or v_session.host_id <> v_pin.host_id then
    raise exception using errcode = '22023', message = 'marketplace_creator_live_source_unavailable';
  end if;

  if not exists (
    select 1
    from public.marketplace_product_variants v
    where v.id = p_variant_id
      and v.product_id = v_pin.product_id
      and v.seller_id = v_pin.seller_id
      and v.store_id = v_pin.store_id
      and v.status = 'active'
      and v.archived_at is null
  ) then
    raise exception using errcode = '23514', message = 'marketplace_creator_attribution_variant_mismatch';
  end if;

  if v_actor = v_pin.seller_id then
    raise exception using errcode = '23514', message = 'marketplace_own_product_forbidden';
  end if;

  if v_pin.commerce_mode = 'own_product' then
    return jsonb_build_object(
      'id', null,
      'commerce_mode', 'own_product',
      'creator_user_id', null,
      'product_id', v_pin.product_id,
      'variant_id', p_variant_id,
      'source_surface', 'live',
      'source_entity_id', v_pin.id
    );
  end if;

  if v_pin.commerce_mode <> 'affiliate_product'
    or v_pin.affiliate_offer_id is null
    or v_actor = v_pin.host_id then
    raise exception using errcode = '23514', message = 'marketplace_creator_live_source_unavailable';
  end if;

  v_receipt := public.marketplace_create_creator_commerce_attribution_internal(
    v_pin.affiliate_offer_id,
    v_pin.host_id,
    p_variant_id,
    'live',
    v_pin.id,
    p_idempotency_key
  );

  return v_receipt || jsonb_build_object('commerce_mode', 'affiliate_product');
end
$$;

revoke all on function public.create_marketplace_creator_live_attribution(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.create_marketplace_creator_live_attribution(uuid, uuid, uuid)
  to authenticated, service_role;

comment on function public.create_marketplace_creator_live_attribution(uuid, uuid, uuid) is
  'B7E buyer-safe LIVE Add/Buy handoff. Derives session, pin, creator, seller, product, and current seller-approved entitlement server-side; own-product pins return no affiliate attribution.';
