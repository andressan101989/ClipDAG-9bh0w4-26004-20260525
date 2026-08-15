-- MKT-B8B marketplace_admin_operations_core
begin;

create table public.marketplace_admin_action_audit(
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id),
  action text not null check(action in(
    'dispute_manual_review','dispute_refund_buyer','dispute_release_seller','dispute_reject_claim',
    'seller_approve','seller_reject','seller_suspend','seller_restore',
    'product_approve','product_reject','product_suspend')),
  target_type text not null check(target_type in('dispute','seller','product')),
  target_id uuid not null,
  idempotency_key uuid not null,
  reason_code text check(reason_code is null or(reason_code=btrim(reason_code)and char_length(reason_code)between 2 and 100)),
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  unique(actor_id,idempotency_key)
);
create index marketplace_admin_action_audit_target_idx on public.marketplace_admin_action_audit(target_type,target_id,created_at desc,id desc);
create index marketplace_disputes_admin_status_created_idx on public.marketplace_order_disputes(status,created_at desc,id desc);
create index marketplace_sellers_admin_status_created_idx on public.marketplace_sellers(status,created_at desc,user_id desc);
create index products_admin_moderation_created_idx on public.products(moderation_status,status,created_at desc,id desc)where deleted_at is null;

alter table public.marketplace_admin_action_audit enable row level security;
revoke all on public.marketplace_admin_action_audit from public,anon,authenticated;
grant select on public.marketplace_admin_action_audit to service_role;

create or replace function public.marketplace_reject_admin_action_audit_mutation()
returns trigger language plpgsql set search_path=pg_catalog,public as $$begin
  raise exception using errcode='42501',message='marketplace_admin_action_audit_immutable';
end$$;
create trigger marketplace_admin_action_audit_immutable before update or delete on public.marketplace_admin_action_audit
for each row execute function public.marketplace_reject_admin_action_audit_mutation();

create or replace function public.marketplace_admin_operation_fingerprint(
  p_action text,p_target_id uuid,p_reason text,p_note text default null
)returns text language sql immutable set search_path=pg_catalog,public as $$
  select encode(extensions.digest(concat_ws('|',p_action,p_target_id::text,coalesce(p_reason,''),coalesce(p_note,'')),'sha256'),'hex')
$$;

create or replace function public.get_my_marketplace_admin_access()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_actor uuid;v_profile public.user_profiles;
begin
  v_actor:=public.marketplace_require_admin();
  select*into strict v_profile from public.user_profiles where id=v_actor;
  return jsonb_build_object('user_id',v_profile.id,'username',v_profile.username,'display_name',v_profile.display_name,'admin',true,
    'capabilities',jsonb_build_array('marketplace:read','marketplace:disputes','marketplace:sellers','marketplace:products'));
end$$;

create or replace function public.search_marketplace_admin_disputes(
  p_query text default null,p_status text default null,p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,p_limit integer default 50
)returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_rows jsonb;v_next jsonb;v_count integer;v_query text:=nullif(btrim(p_query),'');
begin
  perform public.marketplace_require_admin();
  if p_limit not between 1 and 100 then raise exception using errcode='22023',message='marketplace_admin_page_limit_invalid';end if;
  if(v_query is not null and char_length(v_query)>100)or((p_cursor_created_at is null)<>(p_cursor_id is null))then raise exception using errcode='22023',message='marketplace_admin_dispute_search_invalid';end if;
  if p_status is not null and p_status not in('open','under_review','resolved','rejected','cancelled')then raise exception using errcode='22023',message='marketplace_admin_dispute_status_invalid';end if;
  with candidate as(
    select d.id,d.status,d.reason_code,d.created_at,d.resolved_at,o.id order_id,o.order_number,o.status order_status,
      coalesce(bp.display_name,bp.username,'Comprador')buyer_name,coalesce(ms.display_name,sp.display_name,sp.username,'Vendedor')seller_name,
      st.id store_id,st.name store_name,p.status payment_status,a.status allocation_status,
      exists(select 1 from public.marketplace_order_settlements s where s.order_id=o.id)settled,
      exists(select 1 from public.marketplace_settlement_reversals r where r.order_id=o.id)reversed
    from public.marketplace_order_disputes d join public.marketplace_orders o on o.id=d.order_id
    left join public.user_profiles bp on bp.id=d.buyer_id left join public.user_profiles sp on sp.id=d.seller_id
    join public.marketplace_sellers ms on ms.user_id=d.seller_id join public.marketplace_stores st on st.id=o.store_id
    left join public.marketplace_payments p on p.checkout_id=o.checkout_id left join public.marketplace_payment_allocations a on a.order_id=o.id
    where(p_status is null or d.status=p_status)and(p_cursor_created_at is null or(d.created_at,d.id)<(p_cursor_created_at,p_cursor_id))
      and(v_query is null or d.id::text ilike'%'||v_query||'%'or o.order_number ilike'%'||v_query||'%'or coalesce(bp.username,'')ilike'%'||v_query||'%'or coalesce(bp.display_name,'')ilike'%'||v_query||'%'or ms.display_name ilike'%'||v_query||'%'or st.name ilike'%'||v_query||'%')
    order by d.created_at desc,d.id desc limit p_limit+1
  ),numbered as(select*,row_number()over(order by created_at desc,id desc)rn from candidate)
  select coalesce(jsonb_agg(to_jsonb(n)-'rn' order by created_at desc,id desc),'[]'::jsonb),count(*) into v_rows,v_count from numbered n where rn<=p_limit;
  if v_count=p_limit and(select count(*)from candidate)>p_limit then select jsonb_build_object('created_at',created_at,'id',id)into v_next from candidate order by created_at desc,id desc offset p_limit-1 limit 1;end if;
  return jsonb_build_object('disputes',v_rows,'next_cursor',v_next,'page_size',v_count);
end$$;

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

create or replace function public.admin_resolve_marketplace_dispute(
  p_dispute_id uuid,p_outcome text,p_reason_code text,p_note text,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid;v_result jsonb;v_role text;v_action text;v_reason text:=lower(btrim(coalesce(p_reason_code,'')));v_note text:=nullif(btrim(p_note),'');v_fingerprint text;v_prior public.marketplace_admin_action_audit;
begin
  v_actor:=public.marketplace_require_admin();
  if p_dispute_id is null or p_idempotency_key is null or p_outcome not in('manual_review','refund_buyer','release_seller','reject_claim')or char_length(v_reason)not between 2 and 100 or(v_note is not null and char_length(v_note)>1000)then raise exception using errcode='22023',message='marketplace_admin_dispute_command_invalid';end if;
  v_action:='dispute_'||p_outcome;v_fingerprint:=public.marketplace_admin_operation_fingerprint(v_action,p_dispute_id,v_reason,v_note);
  perform pg_advisory_xact_lock(hashtextextended('marketplace-admin-command:'||v_actor::text||':'||p_idempotency_key::text,0));
  select*into v_prior from public.marketplace_admin_action_audit where actor_id=v_actor and idempotency_key=p_idempotency_key;
  if found and(v_prior.action,v_prior.target_type,v_prior.target_id,v_prior.metadata->>'request_fingerprint')is distinct from(v_action,'dispute',p_dispute_id,v_fingerprint)then raise exception using errcode='23505',message='marketplace_admin_idempotency_conflict';end if;
  v_role:=coalesce(current_setting('request.jwt.claim.role',true),'');
  begin
    perform set_config('request.jwt.claim.role','service_role',true);
    v_result:=public.resolve_marketplace_dispute(v_actor,p_dispute_id,p_outcome,v_reason,v_note,p_idempotency_key,null);
    perform set_config('request.jwt.claim.role',v_role,true);
  exception when others then perform set_config('request.jwt.claim.role',v_role,true);raise;end;
  insert into public.marketplace_admin_action_audit(actor_id,action,target_type,target_id,idempotency_key,reason_code,metadata)
  values(v_actor,v_action,'dispute',p_dispute_id,p_idempotency_key,v_reason,jsonb_build_object('request_fingerprint',v_fingerprint,'result_kind',v_result->>'kind','canonical_id',coalesce(v_result->'finalDecision'->>'id',v_result->'reviewAction'->>'id'),'money_moved',coalesce((v_result->>'money_moved')::boolean,(v_result->'finalDecision'->'financial_result'->>'money_moved')::boolean,false)))on conflict(actor_id,idempotency_key)do nothing;
  return v_result;
end$$;

create or replace function public.search_marketplace_admin_sellers(
  p_query text default null,p_status text default null,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 50
)returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_rows jsonb;v_next jsonb;v_count integer;v_query text:=nullif(btrim(p_query),'');
begin
  perform public.marketplace_require_admin();if p_limit not between 1 and 100 or(v_query is not null and char_length(v_query)>100)or((p_cursor_created_at is null)<>(p_cursor_id is null))then raise exception using errcode='22023',message='marketplace_admin_seller_search_invalid';end if;
  if p_status is not null and p_status not in('pending','approved','rejected','suspended')then raise exception using errcode='22023',message='marketplace_admin_seller_status_invalid';end if;
  with candidate as(select s.user_id id,s.status,s.display_name,s.application_note,s.approved_at,s.suspended_at,s.suspension_reason,s.created_at,
    p.username,p.display_name profile_display_name,st.id store_id,st.name store_name,st.status store_status,
    (select count(*)from public.products x where x.seller_id=s.user_id and x.deleted_at is null)product_count,
    (select count(*)from public.marketplace_orders o where o.seller_id=s.user_id)order_count,
    (select count(*)from public.marketplace_order_disputes d where d.seller_id=s.user_id and d.status in('open','under_review'))open_disputes
    from public.marketplace_sellers s join public.user_profiles p on p.id=s.user_id left join public.marketplace_stores st on st.seller_id=s.user_id
    where(p_status is null or s.status=p_status)and(p_cursor_created_at is null or(s.created_at,s.user_id)<(p_cursor_created_at,p_cursor_id))
      and(v_query is null or s.user_id::text ilike'%'||v_query||'%'or s.display_name ilike'%'||v_query||'%'or coalesce(p.username,'')ilike'%'||v_query||'%'or coalesce(st.name,'')ilike'%'||v_query||'%')
    order by s.created_at desc,s.user_id desc limit p_limit+1),numbered as(select*,row_number()over(order by created_at desc,id desc)rn from candidate)
  select coalesce(jsonb_agg(to_jsonb(n)-'rn' order by created_at desc,id desc),'[]'::jsonb),count(*)into v_rows,v_count from numbered n where rn<=p_limit;
  if v_count=p_limit and(select count(*)from candidate)>p_limit then select jsonb_build_object('created_at',created_at,'id',id)into v_next from candidate order by created_at desc,id desc offset p_limit-1 limit 1;end if;
  return jsonb_build_object('sellers',v_rows,'next_cursor',v_next,'page_size',v_count);
end$$;

create or replace function public.get_marketplace_admin_seller_detail(p_seller_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare v_result jsonb;begin
  perform public.marketplace_require_admin();
  select jsonb_build_object('seller',jsonb_build_object('id',s.user_id,'status',s.status,'display_name',s.display_name,'application_note',s.application_note,'approved_at',s.approved_at,'approved_by',s.approved_by,'suspended_at',s.suspended_at,'suspension_reason',s.suspension_reason,'created_at',s.created_at,'updated_at',s.updated_at),
    'profile',jsonb_build_object('username',p.username,'display_name',p.display_name),
    'store',case when st.id is null then null else jsonb_build_object('id',st.id,'name',st.name,'slug',st.slug,'status',st.status,'created_at',st.created_at,'updated_at',st.updated_at)end,
    'product_counts',jsonb_build_object('total',(select count(*)from public.products x where x.seller_id=s.user_id and x.deleted_at is null),'active',(select count(*)from public.products x where x.seller_id=s.user_id and x.status='active'and x.moderation_status='approved'and x.deleted_at is null),'attention',(select count(*)from public.products x where x.seller_id=s.user_id and x.deleted_at is null and x.moderation_status in('pending','rejected','suspended'))),
    'order_summary',jsonb_build_object('orders',(select count(*)from public.marketplace_orders o where o.seller_id=s.user_id),'paid_gmv',(select coalesce(sum(a.gross_amount),0)::numeric(20,8)from public.marketplace_payment_allocations a where a.seller_id=s.user_id)),
    'open_disputes',(select count(*)from public.marketplace_order_disputes d where d.seller_id=s.user_id and d.status in('open','under_review')),
    'admin_actions',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'actor_id',a.actor_id,'action',a.action,'reason_code',a.reason_code,'created_at',a.created_at)order by a.created_at,a.id)from public.marketplace_admin_action_audit a where a.target_type='seller'and a.target_id=s.user_id),'[]'::jsonb))into v_result
  from public.marketplace_sellers s join public.user_profiles p on p.id=s.user_id left join public.marketplace_stores st on st.seller_id=s.user_id where s.user_id=p_seller_id;
  if v_result is null then raise exception using errcode='P0002',message='marketplace_admin_seller_not_found';end if;return v_result;end$$;

create or replace function public.admin_moderate_marketplace_seller(
  p_seller_id uuid,p_action text,p_reason text,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid;v_seller public.marketplace_sellers;v_reason text:=nullif(btrim(p_reason),'');v_fingerprint text;v_prior public.marketplace_admin_action_audit;v_receipt jsonb;v_action text;
begin
  v_actor:=public.marketplace_require_admin();if p_seller_id is null or p_idempotency_key is null or p_action not in('approve','reject','suspend','restore')or v_actor=p_seller_id then raise exception using errcode='22023',message='marketplace_admin_seller_command_invalid';end if;
  if p_action in('reject','suspend')and(v_reason is null or char_length(v_reason)not between 2 and 500)then raise exception using errcode='22023',message='marketplace_admin_seller_reason_required';end if;
  if p_action in('approve','restore')then v_reason:=null;end if;v_action:='seller_'||p_action;v_fingerprint:=public.marketplace_admin_operation_fingerprint(v_action,p_seller_id,v_reason,null);
  perform pg_advisory_xact_lock(hashtextextended('marketplace-admin-command:'||v_actor::text||':'||p_idempotency_key::text,0));select*into v_prior from public.marketplace_admin_action_audit where actor_id=v_actor and idempotency_key=p_idempotency_key;
  if found then if(v_prior.action,v_prior.target_type,v_prior.target_id,v_prior.metadata->>'request_fingerprint')is distinct from(v_action,'seller',p_seller_id,v_fingerprint)then raise exception using errcode='23505',message='marketplace_admin_idempotency_conflict';end if;return v_prior.metadata->'receipt';end if;
  perform pg_advisory_xact_lock(hashtextextended('marketplace-admin-seller:'||p_seller_id::text,0));select*into v_seller from public.marketplace_sellers where user_id=p_seller_id for update;if not found then raise exception using errcode='P0002',message='marketplace_admin_seller_not_found';end if;
  if(p_action='approve'and v_seller.status not in('pending','rejected'))or(p_action='reject'and v_seller.status<>'pending')or(p_action='suspend'and v_seller.status<>'approved')or(p_action='restore'and v_seller.status<>'suspended')then raise exception using errcode='22023',message='marketplace_admin_seller_transition_invalid';end if;
  if p_action='approve'then perform public.approve_marketplace_seller(p_seller_id);elsif p_action='reject'then perform public.reject_marketplace_seller(p_seller_id,v_reason);elsif p_action='suspend'then perform public.suspend_marketplace_seller(p_seller_id,v_reason);else perform public.restore_marketplace_seller(p_seller_id);end if;
  select jsonb_build_object('seller_id',s.user_id,'status',s.status,'store_status',st.status,'action',p_action,'updated_at',s.updated_at)into v_receipt from public.marketplace_sellers s left join public.marketplace_stores st on st.seller_id=s.user_id where s.user_id=p_seller_id;
  insert into public.marketplace_admin_action_audit(actor_id,action,target_type,target_id,idempotency_key,reason_code,metadata)values(v_actor,v_action,'seller',p_seller_id,p_idempotency_key,v_reason,jsonb_build_object('request_fingerprint',v_fingerprint,'receipt',v_receipt));return v_receipt;
end$$;

create or replace function public.search_marketplace_admin_products(
  p_query text default null,p_moderation_status text default null,p_status text default null,p_store_id uuid default null,p_seller_id uuid default null,
  p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 50
)returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_rows jsonb;v_next jsonb;v_count integer;v_query text:=nullif(btrim(p_query),'');begin
  perform public.marketplace_require_admin();if p_limit not between 1 and 100 or(v_query is not null and char_length(v_query)>100)or((p_cursor_created_at is null)<>(p_cursor_id is null))then raise exception using errcode='22023',message='marketplace_admin_product_search_invalid';end if;
  if p_moderation_status is not null and p_moderation_status not in('pending','approved','rejected','suspended')then raise exception using errcode='22023',message='marketplace_admin_product_moderation_invalid';end if;
  if p_status is not null and p_status not in('active','paused','sold_out')then raise exception using errcode='22023',message='marketplace_admin_product_status_invalid';end if;
  with candidate as(select p.id,p.title,p.status,p.moderation_status,p.moderation_reason,p.product_type,p.currency,p.price,p.published_at,p.created_at,p.seller_id,s.display_name seller_name,p.store_id,st.name store_name,st.status store_status,
    (select count(*)from public.marketplace_product_variants v where v.product_id=p.id and v.archived_at is null)variant_count,
    coalesce((select sum(greatest(i.on_hand-i.reserved,0))from public.marketplace_product_variants v join public.marketplace_inventory_levels i on i.variant_id=v.id where v.product_id=p.id and v.status='active'and v.archived_at is null),0)available_units
    from public.products p join public.marketplace_sellers s on s.user_id=p.seller_id join public.marketplace_stores st on st.id=p.store_id where p.deleted_at is null
      and(p_moderation_status is null or p.moderation_status=p_moderation_status)and(p_status is null or p.status=p_status)and(p_store_id is null or p.store_id=p_store_id)and(p_seller_id is null or p.seller_id=p_seller_id)
      and(p_cursor_created_at is null or(p.created_at,p.id)<(p_cursor_created_at,p_cursor_id))and(v_query is null or p.id::text ilike'%'||v_query||'%'or p.title ilike'%'||v_query||'%'or s.display_name ilike'%'||v_query||'%'or st.name ilike'%'||v_query||'%')
    order by p.created_at desc,p.id desc limit p_limit+1),numbered as(select*,row_number()over(order by created_at desc,id desc)rn from candidate)
  select coalesce(jsonb_agg(to_jsonb(n)-'rn' order by created_at desc,id desc),'[]'::jsonb),count(*)into v_rows,v_count from numbered n where rn<=p_limit;
  if v_count=p_limit and(select count(*)from candidate)>p_limit then select jsonb_build_object('created_at',created_at,'id',id)into v_next from candidate order by created_at desc,id desc offset p_limit-1 limit 1;end if;
  return jsonb_build_object('products',v_rows,'next_cursor',v_next,'page_size',v_count);end$$;

create or replace function public.get_marketplace_admin_product_detail(p_product_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare v_result jsonb;begin
  perform public.marketplace_require_admin();
  select jsonb_build_object('product',jsonb_build_object('id',p.id,'title',p.title,'description',p.description,'status',p.status,'moderation_status',p.moderation_status,'moderation_reason',p.moderation_reason,'product_type',p.product_type,'currency',p.currency,'price',p.price,'compare_at_price',p.compare_at_price,'images',p.images,'published_at',p.published_at,'created_at',p.created_at,'updated_at',p.updated_at,'shipping_profile_id',p.shipping_profile_id),
    'seller',jsonb_build_object('id',s.user_id,'display_name',s.display_name,'status',s.status),'store',jsonb_build_object('id',st.id,'name',st.name,'slug',st.slug,'status',st.status),
    'variants',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'sku',v.sku,'title',v.title,'status',v.status,'price',v.price,'compare_at_price',v.compare_at_price,'on_hand',i.on_hand,'reserved',i.reserved,'available',greatest(i.on_hand-i.reserved,0),'archived_at',v.archived_at)order by v.created_at,v.id)from public.marketplace_product_variants v left join public.marketplace_inventory_levels i on i.variant_id=v.id where v.product_id=p.id),'[]'::jsonb),
    'usage',jsonb_build_object('showcase_refs',(select count(*)from public.marketplace_creator_showcase_items x where x.product_id=p.id),'content_tag_refs',(select count(*)from public.marketplace_creator_content_product_tags x where x.product_id=p.id),'live_refs',(select count(*)from public.live_session_products x where x.product_id=p.id)),
    'admin_actions',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'actor_id',a.actor_id,'action',a.action,'reason_code',a.reason_code,'created_at',a.created_at)order by a.created_at,a.id)from public.marketplace_admin_action_audit a where a.target_type='product'and a.target_id=p.id),'[]'::jsonb))into v_result
  from public.products p join public.marketplace_sellers s on s.user_id=p.seller_id join public.marketplace_stores st on st.id=p.store_id where p.id=p_product_id;
  if v_result is null then raise exception using errcode='P0002',message='marketplace_admin_product_not_found';end if;return v_result;end$$;

create or replace function public.admin_moderate_marketplace_product(
  p_product_id uuid,p_action text,p_reason text,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid;v_product public.products;v_reason text:=nullif(btrim(p_reason),'');v_fingerprint text;v_prior public.marketplace_admin_action_audit;v_receipt jsonb;v_action text;
begin
  v_actor:=public.marketplace_require_admin();if p_product_id is null or p_idempotency_key is null or p_action not in('approve','reject','suspend')then raise exception using errcode='22023',message='marketplace_admin_product_command_invalid';end if;
  if p_action in('reject','suspend')and(v_reason is null or char_length(v_reason)not between 2 and 500)then raise exception using errcode='22023',message='marketplace_admin_product_reason_required';end if;if p_action='approve'then v_reason:=null;end if;
  v_action:='product_'||p_action;v_fingerprint:=public.marketplace_admin_operation_fingerprint(v_action,p_product_id,v_reason,null);perform pg_advisory_xact_lock(hashtextextended('marketplace-admin-command:'||v_actor::text||':'||p_idempotency_key::text,0));select*into v_prior from public.marketplace_admin_action_audit where actor_id=v_actor and idempotency_key=p_idempotency_key;
  if found then if(v_prior.action,v_prior.target_type,v_prior.target_id,v_prior.metadata->>'request_fingerprint')is distinct from(v_action,'product',p_product_id,v_fingerprint)then raise exception using errcode='23505',message='marketplace_admin_idempotency_conflict';end if;return v_prior.metadata->'receipt';end if;
  perform pg_advisory_xact_lock(hashtextextended('marketplace-admin-product:'||p_product_id::text,0));select*into v_product from public.products where id=p_product_id and deleted_at is null for update;if not found then raise exception using errcode='P0002',message='marketplace_admin_product_not_found';end if;
  if(p_action='approve'and v_product.moderation_status not in('pending','rejected','suspended'))or(p_action='reject'and v_product.moderation_status<>'pending')or(p_action='suspend'and v_product.moderation_status<>'approved')then raise exception using errcode='22023',message='marketplace_admin_product_transition_invalid';end if;
  update public.products set moderation_status=case p_action when'approve'then'approved'when'reject'then'rejected'else'suspended'end,moderation_reason=v_reason,status=case when p_action in('reject','suspend')and status='active'then'paused'else status end,updated_at=now()where id=p_product_id;
  select jsonb_build_object('product_id',id,'moderation_status',moderation_status,'moderation_reason',moderation_reason,'publication_status',status,'action',p_action,'updated_at',updated_at)into v_receipt from public.products where id=p_product_id;
  insert into public.marketplace_admin_action_audit(actor_id,action,target_type,target_id,idempotency_key,reason_code,metadata)values(v_actor,v_action,'product',p_product_id,p_idempotency_key,v_reason,jsonb_build_object('request_fingerprint',v_fingerprint,'receipt',v_receipt));return v_receipt;
end$$;

create or replace function public.reconcile_marketplace_admin_operations()
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$select jsonb_build_object(
  'audit_orphan_actor',(select count(*)from public.marketplace_admin_action_audit a left join auth.users u on u.id=a.actor_id where u.id is null),
  'audit_orphan_dispute',(select count(*)from public.marketplace_admin_action_audit a left join public.marketplace_order_disputes d on d.id=a.target_id where a.target_type='dispute'and d.id is null),
  'audit_orphan_seller',(select count(*)from public.marketplace_admin_action_audit a left join public.marketplace_sellers s on s.user_id=a.target_id where a.target_type='seller'and s.user_id is null),
  'audit_orphan_product',(select count(*)from public.marketplace_admin_action_audit a left join public.products p on p.id=a.target_id where a.target_type='product'and p.id is null),
  'audit_invalid_fingerprint',(select count(*)from public.marketplace_admin_action_audit where coalesce(metadata->>'request_fingerprint','')!~'^[0-9a-f]{64}$'),
  'audit_action_target_mismatch',(select count(*)from public.marketplace_admin_action_audit where(action like'dispute_%')<>(target_type='dispute')or(action like'seller_%')<>(target_type='seller')or(action like'product_%')<>(target_type='product')),
  'audit_dispute_actor_mismatch',(select count(*)from public.marketplace_admin_action_audit a left join public.marketplace_dispute_decisions d on d.id=(a.metadata->>'canonical_id')::uuid left join public.marketplace_dispute_review_actions r on r.id=(a.metadata->>'canonical_id')::uuid where a.target_type='dispute'and coalesce(d.resolver_id,r.actor_id)is distinct from a.actor_id),
  'audit_dispute_target_mismatch',(select count(*)from public.marketplace_admin_action_audit a left join public.marketplace_dispute_decisions d on d.id=(a.metadata->>'canonical_id')::uuid left join public.marketplace_dispute_review_actions r on r.id=(a.metadata->>'canonical_id')::uuid where a.target_type='dispute'and coalesce(d.dispute_id,r.dispute_id)is distinct from a.target_id)
)$$;

revoke all on function public.marketplace_reject_admin_action_audit_mutation(),public.marketplace_admin_operation_fingerprint(text,uuid,text,text),
  public.search_marketplace_admin_disputes(text,text,timestamptz,uuid,integer),public.get_marketplace_admin_dispute_detail(uuid),public.admin_resolve_marketplace_dispute(uuid,text,text,text,uuid),
  public.search_marketplace_admin_sellers(text,text,timestamptz,uuid,integer),public.get_marketplace_admin_seller_detail(uuid),public.admin_moderate_marketplace_seller(uuid,text,text,uuid),
  public.search_marketplace_admin_products(text,text,text,uuid,uuid,timestamptz,uuid,integer),public.get_marketplace_admin_product_detail(uuid),public.admin_moderate_marketplace_product(uuid,text,text,uuid),
  public.reconcile_marketplace_admin_operations()from public,anon,authenticated,service_role;
grant execute on function public.search_marketplace_admin_disputes(text,text,timestamptz,uuid,integer),public.get_marketplace_admin_dispute_detail(uuid),public.admin_resolve_marketplace_dispute(uuid,text,text,text,uuid),
  public.search_marketplace_admin_sellers(text,text,timestamptz,uuid,integer),public.get_marketplace_admin_seller_detail(uuid),public.admin_moderate_marketplace_seller(uuid,text,text,uuid),
  public.search_marketplace_admin_products(text,text,text,uuid,uuid,timestamptz,uuid,integer),public.get_marketplace_admin_product_detail(uuid),public.admin_moderate_marketplace_product(uuid,text,text,uuid)to authenticated,service_role;
grant execute on function public.reconcile_marketplace_admin_operations()to service_role;

comment on table public.marketplace_admin_action_audit is 'Immutable server-written B8B privileged action history; never financial authority.';
comment on function public.admin_resolve_marketplace_dispute(uuid,text,text,text,uuid)is 'Authenticated B8S-admin bridge to the frozen service-role dispute/B7R authority; accepts no amount or actor.';
comment on function public.admin_moderate_marketplace_product(uuid,text,text,uuid)is 'Admin-only moderation state machine; never changes price, inventory, commission, allocation, settlement, or historical order facts.';

notify pgrst,'reload schema';
commit;
