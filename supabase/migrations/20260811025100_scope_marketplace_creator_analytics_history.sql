begin;

create or replace function public.reconcile_marketplace_creator_commerce_analytics()
returns jsonb language sql stable security definer set search_path=public as $$
with activation as(select activated_at from public.marketplace_creator_commerce_authority_state where singleton),
allocation_totals as(
 select order_id,creator_user_id,round(sum(commission_amount),8)amount from public.marketplace_order_item_creator_allocations group by order_id,creator_user_id
),leg_totals as(
 select s.order_id,l.beneficiary_user_id creator_user_id,round(sum(l.amount),8)amount
 from public.marketplace_order_settlements s join public.marketplace_settlement_legs l on l.settlement_id=s.id and l.leg_type='creator_commission'
 group by s.order_id,l.beneficiary_user_id
),reversal_totals as(
 select r.order_id,l.beneficiary_user_id creator_user_id,round(sum(l.reversal_amount),8)amount
 from public.marketplace_settlement_reversals r join public.marketplace_settlement_reversal_legs l on l.reversal_id=r.id and l.leg_type='creator_commission'
 group by r.order_id,l.beneficiary_user_id
)
select jsonb_build_object(
 'creator_item_attribution_without_allocation',(select count(*)from public.marketplace_order_item_creator_attributions s cross join activation x where s.created_at>=x.activated_at and exists(select 1 from public.marketplace_payments p where p.checkout_id=s.checkout_id)and not exists(select 1 from public.marketplace_order_item_creator_allocations a where a.order_item_id=s.order_item_id)),
 'creator_allocation_without_item_attribution',(select count(*)from public.marketplace_order_item_creator_allocations a cross join activation x where a.created_at>=x.activated_at and not exists(select 1 from public.marketplace_order_item_creator_attributions s where s.order_item_id=a.order_item_id)),
 'creator_allocation_creator_mismatch',(select count(*)from public.marketplace_order_item_creator_allocations a join public.marketplace_order_item_creator_attributions s on s.order_item_id=a.order_item_id where a.creator_user_id<>s.creator_user_id),
 'creator_allocation_product_mismatch',(select count(*)from public.marketplace_order_item_creator_allocations a join public.marketplace_order_item_creator_attributions s on s.order_item_id=a.order_item_id join public.marketplace_order_items i on i.id=a.order_item_id where s.product_id<>i.product_id),
 'creator_generated_commission_mismatch',(select count(*)from allocation_totals a join public.marketplace_payment_allocations p on p.order_id=a.order_id where a.amount>p.creator_commission_amount),
 'creator_settlement_leg_without_creator_allocation',(select count(*)from public.marketplace_order_settlements s join public.marketplace_settlement_legs l on l.settlement_id=s.id and l.leg_type='creator_commission'cross join activation x where s.created_at>=x.activated_at and not exists(select 1 from public.marketplace_order_item_creator_allocations a where a.order_id=s.order_id and a.creator_user_id=l.beneficiary_user_id)),
 'creator_settlement_beneficiary_mismatch',(select count(*)from leg_totals l join allocation_totals a using(order_id,creator_user_id)where l.amount<>a.amount),
 'creator_reversal_leg_without_settlement_leg',(select count(*)from public.marketplace_settlement_reversal_legs r left join public.marketplace_settlement_legs l on l.id=r.original_settlement_leg_id where r.leg_type='creator_commission'and l.id is null),
 'creator_reversal_beneficiary_mismatch',(select count(*)from public.marketplace_settlement_reversal_legs r join public.marketplace_settlement_legs l on l.id=r.original_settlement_leg_id where r.leg_type='creator_commission'and(r.beneficiary_user_id,r.reversal_amount)is distinct from(l.beneficiary_user_id,l.amount)),
 'creator_net_commission_negative_unexplained',(select count(*)from reversal_totals r left join leg_totals l using(order_id,creator_user_id)where r.amount>coalesce(l.amount,0)),
 'creator_surface_invalid',(select count(*)from public.marketplace_order_item_creator_attributions where source_surface not in('live','direct_creator_link','creator_showcase','feed','reel')),
 'creator_source_entity_missing_currently_required_identity',(select count(*)from public.marketplace_order_item_creator_attributions s where(s.source_surface='creator_showcase'and not exists(select 1 from public.marketplace_creator_showcase_items x where x.id=s.source_entity_id))or(s.source_surface in('feed','reel')and not exists(select 1 from public.marketplace_creator_content_product_tags x where x.id=s.source_entity_id))or(s.source_surface='live'and not exists(select 1 from public.live_session_products x where x.id=s.source_entity_id))or(s.source_surface='direct_creator_link'and not exists(select 1 from public.marketplace_live_affiliate_offers x where x.id=s.source_entity_id))),
 'creator_item_gmv_basis_mismatch',(select count(*)from public.marketplace_order_item_creator_allocations a join public.marketplace_order_items i on i.id=a.order_item_id where a.commission_base_amount<>i.line_total),
 'creator_order_count_orphan',(select count(*)from public.marketplace_order_item_creator_attributions s left join public.marketplace_orders o on o.id=s.order_id where o.id is null),
 'creator_analytics_event_source_unresolvable',(select count(*)from public.marketplace_commerce_events e where e.event_name in('product_view','add_to_cart')and((e.source_type='feed'and exists(select 1 from public.marketplace_creator_content_product_tags x where x.id=e.source_entity_id)and not exists(select 1 from public.marketplace_creator_content_product_tags t where t.id=e.source_entity_id and t.content_type='feed'))or(e.source_type='clip'and exists(select 1 from public.marketplace_creator_content_product_tags x where x.id=e.source_entity_id)and not exists(select 1 from public.marketplace_creator_content_product_tags t where t.id=e.source_entity_id and t.content_type='reel')))),
 'creator_event_product_mismatch',(select count(*)from public.marketplace_commerce_events e where e.event_name in('product_view','add_to_cart')and((e.source_type='creator'and exists(select 1 from public.marketplace_creator_showcase_items s where s.id=e.source_entity_id and s.product_id<>e.product_id))or(e.source_type in('feed','clip')and exists(select 1 from public.marketplace_creator_content_product_tags t where t.id=e.source_entity_id and t.product_id<>e.product_id))or(e.source_type='live'and exists(select 1 from public.live_session_products p where p.id=e.source_entity_id and p.product_id<>e.product_id)))),
 'creator_settlement_total_mismatch',(select count(*)from allocation_totals a join leg_totals l using(order_id,creator_user_id)where a.amount<>l.amount),
 'creator_reversal_total_mismatch',(select count(*)from reversal_totals r join leg_totals l using(order_id,creator_user_id)where r.amount<>l.amount)
)$$;

comment on function public.reconcile_marketplace_creator_commerce_analytics() is
  'B7D integrity reconciliation. Mandatory normalized creator allocations are scoped to the B7A authority era; legitimate pre-B7F LIVE settlement history remains canonical and unchanged.';

commit;
