create or replace function public.add_my_marketplace_creator_showcase_product(
  p_product_id uuid,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid();v_fp text;v_prior public.marketplace_creator_showcase_commands;
  v_product public.products;v_offer record;v_item public.marketplace_creator_showcase_items;
  v_result jsonb;v_position integer;v_active_count integer;
begin
  if v_actor is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if p_product_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='marketplace_creator_showcase_invalid_input';end if;
  v_fp:=encode(extensions.digest(concat_ws('|','marketplace_creator_showcase_add',v_actor,p_product_id),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('marketplace-creator-showcase-command:'||v_actor||':'||p_idempotency_key,0));
  select * into v_prior from public.marketplace_creator_showcase_commands
    where actor_id=v_actor and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_fingerprint<>v_fp then
      raise exception using errcode='23505',message='marketplace_creator_showcase_idempotency_conflict';end if;
    return v_prior.result_json;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('marketplace-creator-showcase:'||v_actor,0));
  select * into v_product from public.products where id=p_product_id for share;
  if not found or v_product.seller_id=v_actor or v_product.status<>'active'
    or v_product.moderation_status<>'approved' or v_product.published_at is null
    or v_product.deleted_at is not null or v_product.product_type<>'physical' or v_product.currency<>'BDAG' then
    raise exception using errcode='22023',message='marketplace_creator_showcase_product_ineligible';end if;
  select * into v_offer from public.marketplace_resolve_live_affiliate_offer(p_product_id,v_actor);
  if not found then raise exception using errcode='22023',message='marketplace_creator_showcase_offer_ineligible';end if;
  perform 1 from public.marketplace_live_affiliate_offers where id=v_offer.offer_id for share;
  select * into v_item from public.marketplace_creator_showcase_items
    where creator_user_id=v_actor and product_id=p_product_id and status='active' for update;
  if not found then
    select count(*)::integer into v_active_count from public.marketplace_creator_showcase_items
      where creator_user_id=v_actor and status='active';
    if v_active_count>=100 then
      raise exception using errcode='22023',message='marketplace_creator_showcase_limit_reached';end if;
    select coalesce(max(sort_position),-1)+1 into v_position from public.marketplace_creator_showcase_items
      where creator_user_id=v_actor and status='active';
    insert into public.marketplace_creator_showcase_items(creator_user_id,seller_id,store_id,
      product_id,selected_entitlement_id,sort_position,idempotency_key,request_fingerprint)
    values(v_actor,v_offer.seller_id,v_offer.store_id,p_product_id,v_offer.offer_id,v_position,p_idempotency_key,v_fp)
    returning * into v_item;
  end if;
  v_result:=jsonb_build_object('id',v_item.id,'creator_user_id',v_item.creator_user_id,
    'product_id',v_item.product_id,'selected_entitlement_id',v_item.selected_entitlement_id,
    'status',v_item.status,'sort_position',v_item.sort_position,'selected_at',v_item.selected_at);
  insert into public.marketplace_creator_showcase_commands(actor_id,command_type,idempotency_key,request_fingerprint,result_json)
    values(v_actor,'add',p_idempotency_key,v_fp,v_result);
  return v_result;
end$$;

create or replace function public.reconcile_marketplace_creator_showcase()
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object(
  'orphan_showcase_creator',(select count(*) from public.marketplace_creator_showcase_items s left join auth.users u on u.id=s.creator_user_id where u.id is null),
  'orphan_showcase_product',(select count(*) from public.marketplace_creator_showcase_items s left join public.products p on p.id=s.product_id where p.id is null),
  'wrong_showcase_seller',(select count(*) from public.marketplace_creator_showcase_items s join public.products p on p.id=s.product_id where s.seller_id<>p.seller_id),
  'wrong_showcase_store',(select count(*) from public.marketplace_creator_showcase_items s join public.products p on p.id=s.product_id where s.store_id<>p.store_id),
  'self_showcase_product',(select count(*) from public.marketplace_creator_showcase_items where creator_user_id=seller_id),
  'invalid_showcase_status',(select count(*) from public.marketplace_creator_showcase_items where status not in('active','removed') or(status='active')is distinct from(removed_at is null)),
  'duplicate_active_creator_product',(select count(*) from(select creator_user_id,product_id from public.marketplace_creator_showcase_items where status='active' group by 1,2 having count(*)>1)x),
  'active_showcase_over_limit',(select count(*) from(select creator_user_id from public.marketplace_creator_showcase_items where status='active' group by creator_user_id having count(*)>100)x),
  'invalid_sort_position',(select count(*) from public.marketplace_creator_showcase_items where sort_position<0 or sort_position>1000000),
  'duplicate_active_sort_position',(select count(*) from(select creator_user_id,sort_position from public.marketplace_creator_showcase_items where status='active' group by 1,2 having count(*)>1)x),
  'invalid_request_fingerprint',(select count(*) from public.marketplace_creator_showcase_items where char_length(request_fingerprint)<>64 or request_fingerprint!~'^[0-9a-f]{64}$'),
  'selected_entitlement_missing',(select count(*) from public.marketplace_creator_showcase_items s left join public.marketplace_live_affiliate_offers o on o.id=s.selected_entitlement_id where o.id is null),
  'selected_entitlement_product_mismatch',(select count(*) from public.marketplace_creator_showcase_items s join public.marketplace_live_affiliate_offers o on o.id=s.selected_entitlement_id where(o.product_id,o.seller_id,o.store_id)is distinct from(s.product_id,s.seller_id,s.store_id)),
  'selected_entitlement_creator_scope_mismatch',(select count(*) from public.marketplace_creator_showcase_items s join public.marketplace_live_affiliate_offers o on o.id=s.selected_entitlement_id where(o.offer_scope='specific_creator'and o.creator_id<>s.creator_user_id)or(o.offer_scope='public_creator'and o.creator_id is not null)),
  'showcase_attribution_missing_source_item',(select count(*) from public.marketplace_creator_commerce_attributions a left join public.marketplace_creator_showcase_items s on s.id=a.source_entity_id where a.source_surface='creator_showcase'and s.id is null),
  'showcase_attribution_creator_mismatch',(select count(*) from public.marketplace_creator_commerce_attributions a join public.marketplace_creator_showcase_items s on s.id=a.source_entity_id where a.source_surface='creator_showcase'and a.creator_user_id<>s.creator_user_id),
  'showcase_attribution_product_mismatch',(select count(*) from public.marketplace_creator_commerce_attributions a join public.marketplace_creator_showcase_items s on s.id=a.source_entity_id where a.source_surface='creator_showcase'and(a.product_id,a.seller_id,a.store_id)is distinct from(s.product_id,s.seller_id,s.store_id)),
  'showcase_attribution_source_mismatch',(select count(*) from public.marketplace_creator_commerce_attributions a join public.marketplace_creator_showcase_items s on s.id=a.source_entity_id where a.source_surface='creator_showcase'and s.removed_at is not null and a.attributed_at>=s.removed_at),
  'showcase_attribution_entitlement_mismatch',(select count(*) from public.marketplace_creator_commerce_attributions a join public.marketplace_live_affiliate_offers o on o.id=a.entitlement_id where a.source_surface='creator_showcase'and(a.product_id,a.seller_id,a.store_id,a.commission_bps)is distinct from(o.product_id,o.seller_id,o.store_id,o.commission_bps)),
  'showcase_item_attribution_snapshot_mismatch',(select count(*) from public.marketplace_order_item_creator_attributions s join public.marketplace_creator_commerce_attributions a on a.id=s.attribution_id where s.source_surface='creator_showcase'and(s.creator_user_id,s.product_id,s.variant_id,s.entitlement_id,s.commission_bps,s.source_entity_id)is distinct from(a.creator_user_id,a.product_id,coalesce(a.variant_id,s.variant_id),a.entitlement_id,a.commission_bps,a.source_entity_id)),
  'showcase_b7f_creator_mismatch',(select count(*) from public.marketplace_order_item_creator_attributions s left join public.marketplace_order_item_creator_allocations a on a.order_item_id=s.order_item_id where s.source_surface='creator_showcase'and exists(select 1 from public.marketplace_payments p where p.checkout_id=s.checkout_id)and(a.id is null or a.creator_user_id<>s.creator_user_id)),
  'showcase_b7f_bps_mismatch',(select count(*) from public.marketplace_order_item_creator_attributions s join public.marketplace_order_item_creator_allocations a on a.order_item_id=s.order_item_id where s.source_surface='creator_showcase'and a.commission_bps<>s.commission_bps),
  'showcase_settlement_creator_mismatch',(select count(*) from public.marketplace_order_item_creator_allocations a join public.marketplace_order_item_creator_attributions s on s.order_item_id=a.order_item_id join public.marketplace_order_settlements st on st.order_id=a.order_id where s.source_surface='creator_showcase'and st.status='completed'and not exists(select 1 from public.marketplace_settlement_legs l where l.settlement_id=st.id and l.leg_type='creator_commission'and l.beneficiary_user_id=a.creator_user_id))
)$$;

revoke all on function public.reconcile_marketplace_creator_showcase() from public,anon,authenticated,service_role;
grant execute on function public.reconcile_marketplace_creator_showcase() to service_role;

comment on function public.add_my_marketplace_creator_showcase_product(uuid,uuid) is
  'Idempotent creator showcase selection authority capped at 100 active products under the creator showcase transaction lock.';
