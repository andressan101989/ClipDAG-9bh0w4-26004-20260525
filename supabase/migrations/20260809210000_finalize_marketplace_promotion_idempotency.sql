begin;

create or replace function public.create_marketplace_product_promotion(p_product_id uuid,p_variant_id uuid,p_promotion_type text,p_value numeric,p_starts_at timestamptz,p_ends_at timestamptz,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); prod public.products; variant public.marketplace_product_variants; prior public.marketplace_product_promotions; created public.marketplace_product_promotions; base_price numeric(20,8); normalized numeric(20,8);
begin
  if actor is null then raise exception using errcode='42501',message='marketplace_auth_required'; end if;
  if p_idempotency_key is null then raise exception using errcode='22023',message='marketplace_idempotency_key_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('marketplace-promotion:'||p_product_id::text||':'||coalesce(p_variant_id::text,'product'),0));
  select * into prior from public.marketplace_product_promotions where created_by=actor and idempotency_key=p_idempotency_key;
  if found then
    normalized:=case when p_promotion_type='percentage' then round(p_value,2) else round(p_value,8) end;
    if prior.product_id is distinct from p_product_id
      or prior.variant_id is distinct from p_variant_id
      or prior.promotion_type is distinct from p_promotion_type
      or prior.starts_at is distinct from p_starts_at
      or prior.ends_at is distinct from p_ends_at
      or p_promotion_type not in ('percentage','fixed_amount','promotional_price')
      or (p_promotion_type='percentage' and prior.percentage_off is distinct from normalized)
      or (p_promotion_type='fixed_amount' and prior.fixed_amount_bdag is distinct from normalized)
      or (p_promotion_type='promotional_price' and prior.promotional_price_bdag is distinct from normalized)
    then raise exception using errcode='23505',message='marketplace_promotion_idempotency_conflict'; end if;
    return to_jsonb(prior);
  end if;
  select * into prod from public.products where id=p_product_id and seller_id=actor and deleted_at is null;
  if not found then raise exception using errcode='42501',message='marketplace_promotion_product_not_owned'; end if;
  if prod.store_id is null or prod.product_type<>'physical' or prod.currency<>'BDAG' then raise exception using errcode='22023',message='marketplace_promotion_product_ineligible'; end if;
  if p_variant_id is not null then select * into variant from public.marketplace_product_variants where id=p_variant_id and product_id=prod.id and seller_id=actor and archived_at is null;
    if not found then raise exception using errcode='22023',message='marketplace_promotion_variant_invalid'; end if; base_price:=variant.price;
  else select min(price) into base_price from public.marketplace_product_variants where product_id=prod.id and status='active' and archived_at is null; end if;
  if base_price is null then raise exception using errcode='22023',message='marketplace_promotion_product_ineligible'; end if;
  if p_starts_at is null or p_ends_at is null or p_starts_at>=p_ends_at or p_ends_at<=now() or p_ends_at>now()+interval '2 years' then raise exception using errcode='22023',message='marketplace_promotion_window_invalid'; end if;
  normalized:=round(p_value,8);
  if p_promotion_type='percentage' and (p_value<1 or p_value>95) then raise exception using errcode='22023',message='marketplace_promotion_value_invalid';
  elsif p_promotion_type='fixed_amount' and (normalized<=0 or normalized>=base_price) then raise exception using errcode='22023',message='marketplace_promotion_value_invalid';
  elsif p_promotion_type='promotional_price' and (normalized<=0 or normalized>=base_price or (p_variant_id is null and (select count(*) from public.marketplace_product_variants where product_id=prod.id and status='active' and archived_at is null)>1)) then raise exception using errcode='22023',message='marketplace_promotion_value_invalid';
  elsif p_promotion_type not in ('percentage','fixed_amount','promotional_price') then raise exception using errcode='22023',message='marketplace_promotion_type_invalid'; end if;
  if exists(select 1 from public.marketplace_product_promotions p where p.product_id=prod.id and p.variant_id is not distinct from p_variant_id and p.status='enabled' and tstzrange(p.starts_at,p.ends_at,'[)')&&tstzrange(p_starts_at,p_ends_at,'[)')) then raise exception using errcode='23P01',message='marketplace_promotion_overlap'; end if;
  insert into public.marketplace_product_promotions(seller_id,store_id,product_id,variant_id,promotion_type,percentage_off,fixed_amount_bdag,promotional_price_bdag,starts_at,ends_at,created_by,idempotency_key)
  values(actor,prod.store_id,prod.id,p_variant_id,p_promotion_type,case when p_promotion_type='percentage' then p_value end,case when p_promotion_type='fixed_amount' then normalized end,case when p_promotion_type='promotional_price' then normalized end,p_starts_at,p_ends_at,actor,p_idempotency_key) returning * into created;
  return to_jsonb(created);
end;$$;

notify pgrst,'reload schema';
commit;
