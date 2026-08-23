begin;

create or replace function public.reconcile_marketplace_return_shipments()
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select jsonb_build_object(
  'orphan_return_shipment',(select count(*)from public.marketplace_return_shipments rs
    left join public.marketplace_return_requests rr on rr.id=rs.return_request_id
    left join public.marketplace_orders o on o.id=rs.order_id
    left join public.marketplace_stores st on st.id=rs.store_id
    where rr.id is null or o.id is null or st.id is null),
  'return_identity_mismatch',(select count(*)from public.marketplace_return_shipments rs
    join public.marketplace_return_requests rr on rr.id=rs.return_request_id
    join public.marketplace_orders o on o.id=rs.order_id
    where rr.order_id<>rs.order_id or rr.buyer_id<>rs.buyer_id or rr.seller_id<>rs.seller_id
      or rr.store_id<>rs.store_id or o.buyer_id<>rs.buyer_id or o.seller_id<>rs.seller_id
      or o.store_id<>rs.store_id),
  'unfunded_return_shipment',(select count(*)from public.marketplace_return_shipments rs
    join public.marketplace_return_requests rr on rr.id=rs.return_request_id
    left join public.marketplace_return_refund_holds h on h.return_request_id=rr.id
      and h.order_id=rs.order_id and h.status='held'
    where rr.status<>'approved' or h.id is null),
  'missing_return_label_link',(select count(*)from public.marketplace_return_shipments rs
    where rs.return_label_asset_id is not null and not exists(
      select 1 from public.media_asset_links l where l.asset_id=rs.return_label_asset_id
        and l.entity_type='marketplace_return_shipment' and l.entity_id=rs.id and l.slot='return_label')),
  'invalid_return_label_asset',(select count(*)from public.marketplace_return_shipments rs
    left join public.media_assets a on a.id=rs.return_label_asset_id
    where rs.return_label_asset_id is not null and(a.id is null or a.owner_id<>rs.seller_id
      or a.status<>'ready' or a.visibility<>'private' or a.media_kind<>'document'
      or a.purpose<>'return_label' or a.mime_type<>'application/pdf')),
  'legacy_shipped_without_label',(select count(*)from public.marketplace_return_shipments rs
    where rs.status='shipped' and rs.return_label_asset_id is null),
  'invalid_tracking_state',(select count(*)from public.marketplace_return_shipments rs
    where(rs.status='awaiting_buyer_shipment' and rs.return_label_asset_id is null and(
      rs.carrier_name is not null or rs.tracking_number is not null or rs.label_sent_at is not null))
      or(rs.return_label_asset_id is not null and(
        rs.carrier_name is null or rs.tracking_number is null or rs.label_sent_at is null))
      or(rs.status='shipped' and rs.shipped_at is null)),
  'destination_changed_after_shipping',(select count(*)from public.marketplace_return_shipments rs
    where rs.status='shipped' and rs.shipped_destination_fingerprint is distinct from rs.destination_fingerprint),
  'return_shipment_count',(select count(*)from public.marketplace_return_shipments)
);
$$;

revoke all on function public.reconcile_marketplace_return_shipments()
  from public,anon,authenticated;
grant execute on function public.reconcile_marketplace_return_shipments()
  to service_role;

comment on function public.reconcile_marketplace_return_shipments() is
  'Reconciles canonical return shipments while reporting pre-R2B3 shipped rows without labels as legacy-compatible data.';

commit;
