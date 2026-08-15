begin;

alter table public.marketplace_admin_action_audit
  drop constraint marketplace_admin_action_audit_reason_code_check;
alter table public.marketplace_admin_action_audit
  add constraint marketplace_admin_action_audit_reason_code_check
  check(reason_code is null or(reason_code=btrim(reason_code)and char_length(reason_code)between 2 and 500));

create or replace function public.search_marketplace_admin_disputes(
  p_query text default null,p_status text default null,p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,p_limit integer default 50
)returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_rows jsonb;v_next jsonb;v_count integer;v_has_more boolean;v_query text:=nullif(btrim(p_query),'');
begin
  perform public.marketplace_require_admin();
  if p_limit is null or p_limit<1 or p_limit>100 then raise exception using errcode='22023',message='marketplace_admin_page_limit_invalid';end if;
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
  select coalesce(jsonb_agg(to_jsonb(n)-'rn' order by created_at desc,id desc)filter(where rn<=p_limit),'[]'::jsonb),count(*)filter(where rn<=p_limit),coalesce(bool_or(rn>p_limit),false),(jsonb_agg(jsonb_build_object('created_at',created_at,'id',id))filter(where rn=p_limit))->0 into v_rows,v_count,v_has_more,v_next from numbered n;
  if not v_has_more then v_next:=null;end if;
  return jsonb_build_object('disputes',v_rows,'next_cursor',v_next,'page_size',v_count);
end$$;

create or replace function public.search_marketplace_admin_sellers(
  p_query text default null,p_status text default null,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 50
)returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_rows jsonb;v_next jsonb;v_count integer;v_has_more boolean;v_query text:=nullif(btrim(p_query),'');
begin
  perform public.marketplace_require_admin();
  if p_limit is null or p_limit<1 or p_limit>100 or(v_query is not null and char_length(v_query)>100)or((p_cursor_created_at is null)<>(p_cursor_id is null))then raise exception using errcode='22023',message='marketplace_admin_seller_search_invalid';end if;
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
  select coalesce(jsonb_agg(to_jsonb(n)-'rn' order by created_at desc,id desc)filter(where rn<=p_limit),'[]'::jsonb),count(*)filter(where rn<=p_limit),coalesce(bool_or(rn>p_limit),false),(jsonb_agg(jsonb_build_object('created_at',created_at,'id',id))filter(where rn=p_limit))->0 into v_rows,v_count,v_has_more,v_next from numbered n;
  if not v_has_more then v_next:=null;end if;
  return jsonb_build_object('sellers',v_rows,'next_cursor',v_next,'page_size',v_count);
end$$;

create or replace function public.search_marketplace_admin_products(
  p_query text default null,p_moderation_status text default null,p_status text default null,p_store_id uuid default null,p_seller_id uuid default null,
  p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 50
)returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_rows jsonb;v_next jsonb;v_count integer;v_has_more boolean;v_query text:=nullif(btrim(p_query),'');begin
  perform public.marketplace_require_admin();
  if p_limit is null or p_limit<1 or p_limit>100 or(v_query is not null and char_length(v_query)>100)or((p_cursor_created_at is null)<>(p_cursor_id is null))then raise exception using errcode='22023',message='marketplace_admin_product_search_invalid';end if;
  if p_moderation_status is not null and p_moderation_status not in('pending','approved','rejected','suspended')then raise exception using errcode='22023',message='marketplace_admin_product_moderation_invalid';end if;
  if p_status is not null and p_status not in('active','paused','sold_out')then raise exception using errcode='22023',message='marketplace_admin_product_status_invalid';end if;
  with candidate as(select p.id,p.title,p.status,p.moderation_status,p.moderation_reason,p.product_type,p.currency,p.price,p.published_at,p.created_at,p.seller_id,s.display_name seller_name,p.store_id,st.name store_name,st.status store_status,
    (select count(*)from public.marketplace_product_variants v where v.product_id=p.id and v.archived_at is null)variant_count,
    coalesce((select sum(greatest(i.on_hand-i.reserved,0))from public.marketplace_product_variants v join public.marketplace_inventory_levels i on i.variant_id=v.id where v.product_id=p.id and v.status='active'and v.archived_at is null),0)available_units
    from public.products p join public.marketplace_sellers s on s.user_id=p.seller_id join public.marketplace_stores st on st.id=p.store_id where p.deleted_at is null
      and(p_moderation_status is null or p.moderation_status=p_moderation_status)and(p_status is null or p.status=p_status)and(p_store_id is null or p.store_id=p_store_id)and(p_seller_id is null or p.seller_id=p_seller_id)
      and(p_cursor_created_at is null or(p.created_at,p.id)<(p_cursor_created_at,p_cursor_id))and(v_query is null or p.id::text ilike'%'||v_query||'%'or p.title ilike'%'||v_query||'%'or s.display_name ilike'%'||v_query||'%'or st.name ilike'%'||v_query||'%')
    order by p.created_at desc,p.id desc limit p_limit+1),numbered as(select*,row_number()over(order by created_at desc,id desc)rn from candidate)
  select coalesce(jsonb_agg(to_jsonb(n)-'rn' order by created_at desc,id desc)filter(where rn<=p_limit),'[]'::jsonb),count(*)filter(where rn<=p_limit),coalesce(bool_or(rn>p_limit),false),(jsonb_agg(jsonb_build_object('created_at',created_at,'id',id))filter(where rn=p_limit))->0 into v_rows,v_count,v_has_more,v_next from numbered n;
  if not v_has_more then v_next:=null;end if;
  return jsonb_build_object('products',v_rows,'next_cursor',v_next,'page_size',v_count);
end$$;

revoke all on function public.search_marketplace_admin_disputes(text,text,timestamptz,uuid,integer),
  public.search_marketplace_admin_sellers(text,text,timestamptz,uuid,integer),
  public.search_marketplace_admin_products(text,text,text,uuid,uuid,timestamptz,uuid,integer)
from public,anon,authenticated,service_role;
grant execute on function public.search_marketplace_admin_disputes(text,text,timestamptz,uuid,integer),
  public.search_marketplace_admin_sellers(text,text,timestamptz,uuid,integer),
  public.search_marketplace_admin_products(text,text,text,uuid,uuid,timestamptz,uuid,integer)
to authenticated,service_role;

comment on constraint marketplace_admin_action_audit_reason_code_check on public.marketplace_admin_action_audit is
  'B8B audit accepts every validated reason: disputes up to 100 characters; seller/product moderation up to 500.';

notify pgrst,'reload schema';
commit;
