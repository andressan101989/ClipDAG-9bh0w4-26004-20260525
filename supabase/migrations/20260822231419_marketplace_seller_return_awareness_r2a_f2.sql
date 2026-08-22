-- R2A-F2: surface seller return-request attention through the existing order
-- architecture and fail closed on new unfunded approvals until R2B installs
-- the funded reverse-escrow authority. This migration moves no money.
begin;

create or replace function public.fetch_my_marketplace_sales(
  p_status text default null,
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)returns jsonb language plpgsql security definer set search_path=public as $$
declare v_limit int:=least(greatest(coalesce(p_limit,20),1),50);v_store uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if not exists(select 1 from public.marketplace_sellers where user_id=auth.uid() and status='approved') then raise exception using errcode='42501',message='marketplace_seller_not_approved';end if;
  select id into v_store from public.marketplace_stores where seller_id=auth.uid() and status='active';
  if v_store is null then raise exception using errcode='42501',message='marketplace_store_inactive';end if;
  if p_status is not null and p_status not in ('confirmed','processing','shipped','delivered','cancelled','refunded','partially_refunded') then raise exception using errcode='22023',message='marketplace_invalid_order_status';end if;
  return coalesce((
    select jsonb_agg(x.row order by x.created_at desc,x.id desc)
    from (
      select o.created_at,o.id,jsonb_build_object(
        'id',o.id,'order_number',o.order_number,'checkout_id',o.checkout_id,'checkout_reference',c.reference,
        'status',o.status,'store_id',o.store_id,'store_name',st.name,'total',o.total,'currency',o.currency,
        'created_at',o.created_at,'confirmed_at',o.confirmed_at,'processing_at',o.processing_at,
        'shipped_at',o.shipped_at,'delivered_at',o.delivered_at,'recipient_name',sa.recipient_name,
        'city',sa.city,'region',sa.region,'country',sa.country,
        'distinct_lines',(select count(*) from public.marketplace_order_items i where i.order_id=o.id),
        'total_quantity',(select sum(i.quantity) from public.marketplace_order_items i where i.order_id=o.id),
        'gross_amount',a.gross_amount,'platform_fee_amount',a.platform_fee_amount,
        'seller_net_amount',a.seller_net_amount,'allocation_status',a.status,'released_at',a.released_at,
        'carrier_name',sh.carrier_name,'tracking_number',sh.tracking_number,
        'active_dispute',(
          select jsonb_build_object(
            'id',d.id,'status',d.status,'reason_code',d.reason_code,'created_at',d.created_at,
            'seller_response_submitted',exists(
              select 1 from public.marketplace_dispute_seller_responses sr where sr.dispute_id=d.id
            )
          )
          from public.marketplace_order_disputes d
          where d.order_id=o.id and d.seller_id=auth.uid() and d.status in('open','under_review')
          order by d.created_at desc,d.id desc limit 1
        ),
        'active_return_request',(
          select jsonb_build_object('id',rr.id,'status',rr.status,'created_at',rr.created_at)
          from public.marketplace_return_requests rr
          where rr.order_id=o.id and rr.seller_id=auth.uid() and rr.status='requested'
          order by rr.created_at desc,rr.id desc limit 1
        )
      ) row
      from public.marketplace_orders o
      join public.marketplace_checkout_sessions c on c.id=o.checkout_id and c.status='paid'
      join public.marketplace_stores st on st.id=o.store_id
      join public.marketplace_checkout_shipping_addresses sa on sa.checkout_id=o.checkout_id
      join public.marketplace_payment_allocations a on a.order_id=o.id
      left join public.marketplace_order_shipments sh on sh.order_id=o.id
      where o.seller_id=auth.uid() and o.store_id=v_store
        and (p_status is null or o.status=p_status)
        and (p_before_created_at is null or (o.created_at,o.id)<(p_before_created_at,p_before_id))
      order by o.created_at desc,o.id desc limit v_limit
    )x
  ),'[]'::jsonb);
end;
$$;

create or replace function public.fetch_my_marketplace_returns(
  p_limit integer default 20,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=auth.uid();v_limit integer;v_store uuid;
begin
  if v_actor is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if not exists(select 1 from public.marketplace_sellers where user_id=v_actor and status='approved') then raise exception using errcode='42501',message='marketplace_seller_not_approved';end if;
  select id into v_store from public.marketplace_stores where seller_id=v_actor and status='active';
  if v_store is null then raise exception using errcode='42501',message='marketplace_store_inactive';end if;
  if p_limit is null or p_limit<1 or p_limit>50 then raise exception using errcode='22023',message='marketplace_invalid_limit';end if;
  if (p_before_created_at is null)<>(p_before_id is null) then raise exception using errcode='22023',message='marketplace_invalid_cursor';end if;
  v_limit:=p_limit;
  return (
    with scoped as(
      select rr.id,rr.status,rr.created_at,o.id order_id,o.order_number,o.status order_status,
        st.id store_id,st.name store_name
      from public.marketplace_return_requests rr
      join public.marketplace_orders o on o.id=rr.order_id and o.seller_id=v_actor
      join public.marketplace_stores st on st.id=o.store_id and st.id=v_store
      where rr.seller_id=v_actor
    ),attention as(
      select * from scoped where status='requested'
    ),paged as(
      select * from attention
      where p_before_created_at is null or (created_at,id)<(p_before_created_at,p_before_id)
      order by created_at desc,id desc limit v_limit+1
    ),selected as(
      select * from paged order by created_at desc,id desc limit v_limit
    )
    select jsonb_build_object(
      'attention_count',(select count(*) from attention),
      'requested_count',(select count(*) from scoped where status='requested'),
      'approved_count',(select count(*) from scoped where status='approved'),
      'returns',coalesce((select jsonb_agg(jsonb_build_object(
        'return_id',id,'status',status,'created_at',created_at,
        'order_id',order_id,'order_number',order_number,'order_status',order_status,
        'store_id',store_id,'store_name',store_name
      )order by created_at desc,id desc)from selected),'[]'::jsonb),
      'next_cursor',case when(select count(*) from paged)>v_limit then(
        select jsonb_build_object('created_at',created_at,'id',id)
        from selected order by created_at asc,id asc limit 1
      )else null end
    ));
end;
$$;

create or replace function public.respond_to_marketplace_return(
  p_return_id uuid,
  p_decision text,
  p_seller_note text,
  p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_actor uuid:=auth.uid();
  v_request public.marketplace_return_requests;
  v_prior public.marketplace_return_requests;
  v_decision text:=lower(regexp_replace(coalesce(p_decision,''),'^[[:space:]]+|[[:space:]]+$','','g'));
  v_note text:=nullif(regexp_replace(coalesce(p_seller_note,''),'^[[:space:]]+|[[:space:]]+$','','g'),'');
  v_status text;
  v_fingerprint text;
  v_now timestamptz:=clock_timestamp();
begin
  if v_actor is null then
    raise exception using errcode='42501',message='marketplace_auth_required';
  end if;
  if p_return_id is null or p_idempotency_key is null or v_decision not in('approve','reject')
     or (v_note is not null and(char_length(v_note)>1000
       or v_note~*'<[[:space:]]*/?[[:alpha:]][^>]*>')) then
    raise exception using errcode='22023',message='marketplace_return_decision_invalid_input';
  end if;
  v_status:=case v_decision when'approve'then'approved'else'rejected'end;
  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
    'return_id',p_return_id,'decision',v_decision,'seller_note',v_note
  )::text,'UTF8'),'sha256'),'hex');

  perform pg_advisory_xact_lock(hashtextextended('marketplace-return-decision:'||p_return_id::text,0));
  select * into v_request
  from public.marketplace_return_requests where id=p_return_id for update;
  if not found then
    raise exception using errcode='P0002',message='marketplace_return_not_found';
  end if;
  if v_request.seller_id<>v_actor then
    raise exception using errcode='42501',message='marketplace_return_not_owned';
  end if;

  select * into v_prior
  from public.marketplace_return_requests
  where seller_id=v_actor and decision_idempotency_key=p_idempotency_key
  for update;
  if found then
    if v_prior.id<>p_return_id or v_prior.decision_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='marketplace_return_decision_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'return_request',jsonb_build_object(
        'id',v_prior.id,'order_id',v_prior.order_id,'status',v_prior.status,
        'buyer_note',v_prior.buyer_note,'seller_note',v_prior.seller_note,
        'created_at',v_prior.created_at,'decided_at',v_prior.decided_at
      ),'money_moved',false
    );
  end if;
  if v_request.status<>'requested' then
    raise exception using errcode='23505',message='marketplace_return_already_decided';
  end if;
  if v_decision='approve' then
    raise exception using errcode='55000',message='marketplace_return_approval_funding_required';
  end if;

  update public.marketplace_return_requests set
    status=v_status,
    seller_note=v_note,
    decision_idempotency_key=p_idempotency_key,
    decision_fingerprint=v_fingerprint,
    decided_at=v_now,
    updated_at=v_now
  where id=v_request.id
  returning * into v_request;

  insert into public.marketplace_order_events(
    order_id,checkout_id,buyer_id,seller_id,store_id,event_type,from_status,to_status,
    actor_id,actor_role,reason_code,idempotency_key,metadata,created_at
  )values(
    v_request.order_id,v_request.checkout_id,v_request.buyer_id,v_request.seller_id,v_request.store_id,
    case when v_status='approved'then'return_approved'else'return_rejected'end,
    (select status from public.marketplace_orders where id=v_request.order_id),
    (select status from public.marketplace_orders where id=v_request.order_id),
    v_actor,'seller',case when v_status='approved'then'marketplace_return_approved'else'marketplace_return_rejected'end,
    p_idempotency_key,jsonb_build_object('return_request_id',v_request.id,'status',v_status),v_now
  );

  return jsonb_build_object(
    'return_request',jsonb_build_object(
      'id',v_request.id,'order_id',v_request.order_id,'status',v_request.status,
      'buyer_note',v_request.buyer_note,'seller_note',v_request.seller_note,
      'created_at',v_request.created_at,'decided_at',v_request.decided_at
    ),'money_moved',false
  );
end;
$$;

comment on function public.fetch_my_marketplace_returns(integer,timestamptz,uuid) is
  'Seller-owned requested Marketplace return inbox with stable cursor pagination and no buyer note or financial internals.';
comment on function public.respond_to_marketplace_return(uuid,text,text,uuid) is
  'Seller-only idempotent return decision authority. New approvals fail closed until R2B secures reverse-return escrow; rejection moves no money.';

revoke all on function public.fetch_my_marketplace_sales(text,integer,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.fetch_my_marketplace_sales(text,integer,timestamptz,uuid) to authenticated,service_role;
revoke all on function public.fetch_my_marketplace_returns(integer,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.fetch_my_marketplace_returns(integer,timestamptz,uuid) to authenticated,service_role;
revoke all on function public.respond_to_marketplace_return(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.respond_to_marketplace_return(uuid,text,text,uuid) to authenticated,service_role;

commit;
