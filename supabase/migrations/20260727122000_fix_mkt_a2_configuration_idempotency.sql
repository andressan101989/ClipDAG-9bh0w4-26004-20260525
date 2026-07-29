begin;

-- MKT-A2 corrective: resolve an exact configuration retry before any
-- inventory comparison or threshold update. A transaction-scoped advisory
-- lock serializes concurrent requests for the same authenticated actor/key;
-- the existing request table remains the authoritative idempotency record.
create or replace function public.configure_marketplace_product_variants(
  p_product_id uuid,p_options_json jsonb,p_variants_json jsonb,p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid:=auth.uid();
  v_fingerprint text;
  v_prior public.marketplace_variant_configuration_requests;
  v_variant jsonb;
  v_existing_variant_id uuid;
  v_authoritative_on_hand integer;
  v_supplied_on_hand integer;
  v_threshold integer;
  v_sku text;
  v_result jsonb;
  v_result_variant jsonb;
begin
  if not public.marketplace_seller_is_approved(v_user)
     or not exists(
       select 1
       from public.products p
       join public.marketplace_stores s on s.id=p.store_id
       where p.id=p_product_id
         and p.seller_id=v_user
         and p.deleted_at is null
         and s.seller_id=v_user
         and s.status='active'
     ) then
    raise exception using errcode='42501',message='product_not_editable';
  end if;

  if p_idempotency_key is null
     or jsonb_typeof(p_options_json)<>'array'
     or jsonb_typeof(p_variants_json)<>'array' then
    raise exception using errcode='22023',message='marketplace_invalid_variant_configuration';
  end if;

  v_fingerprint:=md5(
    p_product_id::text||':'||p_options_json::text||':'||p_variants_json::text
  );

  -- A concurrent duplicate waits here until the first transaction commits.
  -- It then observes the stored request below and returns without reaching
  -- inventory validation, the internal configuration, or threshold updates.
  perform pg_advisory_xact_lock(
    hashtext(v_user::text),
    hashtext(p_idempotency_key::text)
  );

  select * into v_prior
  from public.marketplace_variant_configuration_requests
  where actor_id=v_user and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.product_id<>p_product_id
       or v_prior.request_fingerprint<>v_fingerprint then
      raise exception using errcode='22023',message='marketplace_idempotency_conflict';
    end if;
    if v_prior.response is null then
      raise exception using errcode='P0001',message='marketplace_idempotency_response_missing';
    end if;
    return v_prior.response;
  end if;

  -- New keys retain the existing authoritative inventory contract.
  for v_variant in select value from jsonb_array_elements(p_variants_json) loop
    if not (v_variant ? 'on_hand') or jsonb_typeof(v_variant->'on_hand')<>'number' then
      raise exception using errcode='22023',message='marketplace_invalid_inventory_quantity';
    end if;
    v_supplied_on_hand:=(v_variant->>'on_hand')::integer;
    v_threshold:=coalesce((v_variant->>'low_stock_threshold')::integer,0);
    if v_supplied_on_hand<0 or v_supplied_on_hand>1000000000 then
      raise exception using errcode='22023',message='marketplace_invalid_inventory_quantity';
    end if;
    if v_threshold<0 or v_threshold>1000000000 then
      raise exception using errcode='22023',message='marketplace_invalid_low_stock_threshold';
    end if;

    v_existing_variant_id:=null;
    if nullif(v_variant->>'id','') is not null then
      select id into v_existing_variant_id
      from public.marketplace_product_variants
      where id=(v_variant->>'id')::uuid and product_id=p_product_id;
    end if;
    if v_existing_variant_id is null and nullif(v_variant->>'sku','') is not null then
      v_sku:=public.marketplace_normalize_sku(v_variant->>'sku');
      select id into v_existing_variant_id
      from public.marketplace_product_variants
      where product_id=p_product_id and sku_normalized=v_sku
      order by created_at
      limit 1;
    end if;

    if v_existing_variant_id is not null then
      select on_hand into v_authoritative_on_hand
      from public.marketplace_inventory_levels
      where variant_id=v_existing_variant_id
      for update;
      if not found then
        raise exception using errcode='P0001',message='marketplace_inventory_missing';
      end if;
      if v_supplied_on_hand<>v_authoritative_on_hand then
        raise exception using
          errcode='22023',
          message='marketplace_existing_inventory_requires_inventory_action';
      end if;
    end if;
  end loop;

  v_result:=public.configure_marketplace_product_variants_mkt_a2_original(
    p_product_id,p_options_json,p_variants_json,p_idempotency_key
  );

  -- This block is reachable only for a new request record. Cached exact
  -- retries returned above and can never reapply an old threshold.
  for v_variant in select value from jsonb_array_elements(p_variants_json) loop
    v_sku:=public.marketplace_normalize_sku(v_variant->>'sku');
    v_threshold:=coalesce((v_variant->>'low_stock_threshold')::integer,0);
    select value into v_result_variant
    from jsonb_array_elements(v_result)
    where value->>'sku'=v_sku
    limit 1;
    if v_result_variant is null then
      raise exception using errcode='P0001',message='marketplace_variant_configuration_incomplete';
    end if;
    update public.marketplace_inventory_levels
    set low_stock_threshold=v_threshold
    where variant_id=(v_result_variant->>'id')::uuid;
  end loop;

  return v_result;
end;
$$;

revoke all on function public.configure_marketplace_product_variants(
  uuid,jsonb,jsonb,uuid
) from public,anon;
grant execute on function public.configure_marketplace_product_variants(
  uuid,jsonb,jsonb,uuid
) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
