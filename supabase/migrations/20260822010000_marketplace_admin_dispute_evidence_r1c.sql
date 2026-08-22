begin;

create or replace function public.get_marketplace_admin_dispute_detail(p_dispute_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_result jsonb;
begin
  perform public.marketplace_require_admin();
  if p_dispute_id is null then raise exception using errcode='22023',message='marketplace_admin_dispute_id_required';end if;
  select jsonb_build_object(
    'dispute',jsonb_build_object('id',d.id,'status',d.status,'reason_code',d.reason_code,'buyer_note',d.buyer_note,'created_at',d.created_at,'resolved_at',d.resolved_at),
    'order',jsonb_build_object('id',o.id,'order_number',o.order_number,'status',o.status,'currency',o.currency,'total',o.total,'created_at',o.created_at),
    'buyer',jsonb_build_object('id',d.buyer_id,'username',bp.username,'display_name',bp.display_name),
    'seller',jsonb_build_object('id',d.seller_id,'display_name',coalesce(ms.display_name,sp.display_name),'status',ms.status),
    'store',jsonb_build_object('id',st.id,'name',st.name,'slug',st.slug,'status',st.status),
    'affected_items',coalesce((select jsonb_agg(jsonb_build_object('id',oi.id,'product_id',oi.product_id,'variant_id',oi.variant_id,'product_title',oi.product_title,'variant_title',oi.variant_title,'sku',oi.sku,'options',oi.option_snapshot,'image_url',oi.image_url,'unit_price',oi.unit_price,'quantity',oi.quantity,'line_total',oi.line_total,'currency',oi.currency)order by di.created_at,oi.id)from public.marketplace_dispute_items di join public.marketplace_order_items oi on oi.id=di.order_item_id and oi.order_id=d.order_id where di.dispute_id=d.id),'[]'::jsonb),
    'buyer_evidence_asset_ids',coalesce((select jsonb_agg(l.asset_id order by l.position)from public.media_asset_links l where l.entity_type='marketplace_dispute'and l.entity_id=d.id and l.slot='buyer_evidence'),'[]'::jsonb),
    'seller_response',(select jsonb_build_object('id',r.id,'note',r.note,'created_at',r.created_at,'evidence_asset_ids',coalesce((select jsonb_agg(l.asset_id order by l.position)from public.media_asset_links l where l.entity_type='marketplace_dispute'and l.entity_id=d.id and l.slot='seller_evidence'),'[]'::jsonb))from public.marketplace_dispute_seller_responses r where r.dispute_id=d.id),
    'payment',(select jsonb_build_object('id',p.id,'status',p.status,'currency',p.currency,'gross_amount',p.gross_amount,'paid_at',p.paid_at,'refunded_at',p.refunded_at)from public.marketplace_payments p where p.checkout_id=o.checkout_id),
    'allocation',(select jsonb_build_object('id',a.id,'status',a.status,'gross_amount',a.gross_amount,'seller_net_amount',a.seller_net_amount,'platform_fee_amount',a.platform_fee_amount,'creator_commission_amount',a.creator_commission_amount,'released_at',a.released_at,'refunded_at',a.refunded_at)from public.marketplace_payment_allocations a where a.order_id=o.id),
    'shipment',(select jsonb_build_object('status',s.status,'carrier_name',s.carrier_name,'tracking_number',s.tracking_number,'shipped_at',s.shipped_at,'delivered_at',s.delivered_at)from public.marketplace_order_shipments s where s.order_id=o.id),
    'settlement',(select jsonb_build_object('id',s.id,'status',s.status,'gross_amount',s.gross_amount,'seller_net_amount',s.seller_net_amount,'platform_fee_amount',s.platform_fee_amount,'creator_commission_amount',s.creator_commission_amount,'released_at',s.released_at)from public.marketplace_order_settlements s where s.order_id=o.id),
    'settlement_legs',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'leg_type',l.leg_type,'beneficiary_user_id',l.beneficiary_user_id,'amount',l.amount,'status',l.status,'created_at',l.created_at)order by l.leg_key)from public.marketplace_order_settlements s join public.marketplace_settlement_legs l on l.settlement_id=s.id where s.order_id=o.id),'[]'::jsonb),
    'reversal',(select jsonb_build_object('id',r.id,'gross_amount',r.gross_amount,'currency',r.currency,'reason_code',r.reason_code,'created_at',r.created_at)from public.marketplace_settlement_reversals r where r.order_id=o.id),
    'reversal_legs',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'leg_type',l.leg_type,'beneficiary_user_id',l.beneficiary_user_id,'original_amount',l.original_amount,'reversal_amount',l.reversal_amount,'created_at',l.created_at)order by l.id)from public.marketplace_settlement_reversals r join public.marketplace_settlement_reversal_legs l on l.reversal_id=r.id where r.order_id=o.id),'[]'::jsonb),
    'creator_attributions',coalesce((select jsonb_agg(jsonb_build_object('order_item_id',a.order_item_id,'creator_user_id',a.creator_user_id,'source_surface',a.source_surface,'source_entity_id',a.source_entity_id,'product_id',a.product_id,'historical_bps',a.commission_bps,'attributed_at',a.attributed_at)order by a.order_item_id)from public.marketplace_order_item_creator_attributions a where a.order_id=o.id),'[]'::jsonb),
    'creator_allocations',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'order_item_id',a.order_item_id,'creator_user_id',a.creator_user_id,'item_gmv',a.commission_base_amount,'commission_amount',a.commission_amount,'created_at',a.created_at)order by a.order_item_id)from public.marketplace_order_item_creator_allocations a where a.order_id=o.id),'[]'::jsonb),
    'review_actions',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'actor_id',a.actor_id,'action',a.action,'reason_code',a.reason_code,'note',a.note,'metadata',a.metadata,'created_at',a.created_at)order by a.created_at,a.id)from public.marketplace_dispute_review_actions a where a.dispute_id=d.id),'[]'::jsonb),
    'final_decision',(select jsonb_build_object('id',x.id,'resolver_id',x.resolver_id,'outcome',x.outcome,'reason_code',x.reason_code,'note',x.note,'financial_result',x.financial_result,'decided_at',x.decided_at)from public.marketplace_dispute_decisions x where x.dispute_id=d.id),
    'timeline',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'event_type',e.event_type,'from_status',e.from_status,'to_status',e.to_status,'actor_role',e.actor_role,'reason_code',e.reason_code,'created_at',e.created_at)order by e.created_at,e.id)from public.marketplace_order_events e where e.order_id=o.id),'[]'::jsonb),
    'admin_actions',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'actor_id',a.actor_id,'action',a.action,'reason_code',a.reason_code,'created_at',a.created_at)order by a.created_at,a.id)from public.marketplace_admin_action_audit a where a.target_type='dispute'and a.target_id=d.id),'[]'::jsonb)
  )into v_result from public.marketplace_order_disputes d join public.marketplace_orders o on o.id=d.order_id
  left join public.user_profiles bp on bp.id=d.buyer_id left join public.user_profiles sp on sp.id=d.seller_id
  join public.marketplace_sellers ms on ms.user_id=d.seller_id join public.marketplace_stores st on st.id=o.store_id where d.id=p_dispute_id;
  if v_result is null then raise exception using errcode='P0002',message='marketplace_admin_dispute_not_found';end if;return v_result;
end$$;

revoke all on function public.get_marketplace_admin_dispute_detail(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_marketplace_admin_dispute_detail(uuid) to authenticated,service_role;

comment on function public.get_marketplace_admin_dispute_detail(uuid) is
  'Admin-only immutable Marketplace dispute dossier with buyer and seller private evidence asset references; no financial authority.';

notify pgrst,'reload schema';
commit;
