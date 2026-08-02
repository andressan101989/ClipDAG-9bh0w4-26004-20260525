begin;
create or replace function public.fetch_my_marketplace_order(p_order_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.marketplace_orders;v_response jsonb;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
 select * into o from public.marketplace_orders where id=p_order_id;
 if not found or o.buyer_id<>auth.uid() then raise exception using errcode='42501',message='marketplace_order_not_found';end if;
 if not exists(select 1 from public.marketplace_checkout_sessions c join public.marketplace_payments p on p.checkout_id=c.id where c.id=o.checkout_id and c.status='paid' and p.status='paid') then raise exception using errcode='42501',message='marketplace_order_not_paid';end if;
 v_response:=public.marketplace_order_detail_response(o.id,'buyer');
 return v_response #- '{shipment,seller_note}' #- '{shipment,id}';
end $$;
revoke all on function public.fetch_my_marketplace_order(uuid) from public,anon,authenticated;
grant execute on function public.fetch_my_marketplace_order(uuid) to authenticated,service_role;
commit;
