create or replace function public.search_my_business_returns(
  p_business_owner_id uuid,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 30
)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_limit integer:=least(greatest(coalesce(p_limit,30),1),60);v_rows jsonb;v_more boolean;v_cursor jsonb;
begin
  if not(private.business_actor_has_capability(p_business_owner_id,'business.returns.read')
    or private.business_actor_has_capability(p_business_owner_id,'business.returns.manage'))then
    raise exception using errcode='42501',message='business_returns_read_required';end if;
  with candidates as(
    select r.*,rf.refund_receipt_exists,rf.refunded_at,rf.resolution_mode
    from public.marketplace_return_requests r
    left join lateral(
      select true refund_receipt_exists,rr.refunded_at,rr.resolution_mode
      from public.marketplace_return_refunds rr
      where rr.return_request_id=r.id
      order by rr.refunded_at desc,rr.id desc
      limit 1
    )rf on true
    where r.seller_id=p_business_owner_id
      and(p_cursor_created_at is null or(r.created_at,r.id)<(p_cursor_created_at,p_cursor_id))
    order by r.created_at desc,r.id desc limit v_limit+1
  ),numbered as(select *,pg_catalog.row_number()over(order by created_at desc,id desc)rn from candidates)
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'order_id',order_id,
    'order_number',(select o.order_number from public.marketplace_orders o where o.id=numbered.order_id),'status',status,
    'buyer_note',buyer_note,'seller_note',seller_note,'created_at',created_at,'decided_at',decided_at,
    'shipment',(select pg_catalog.jsonb_build_object('id',s.id,'status',s.status,'return_label_asset_id',s.return_label_asset_id,
      'label_sent_at',s.label_sent_at,'tracking_number',s.tracking_number,'received_at',s.received_at)
      from public.marketplace_return_shipments s where s.return_request_id=numbered.id),
    'refund_status',case when refund_receipt_exists then 'refunded' else null end,
    'refunded_at',refunded_at,'resolution_mode',resolution_mode)
    order by created_at desc,id desc)filter(where rn<=v_limit),'[]'::jsonb),
  pg_catalog.count(*)>v_limit,
  (select pg_catalog.jsonb_build_object('created_at',created_at,'id',id) from numbered where rn=v_limit)
  into v_rows,v_more,v_cursor from numbered;
  return pg_catalog.jsonb_build_object('items',v_rows,'next_cursor',case when v_more then v_cursor else null end);
end;$function$;
