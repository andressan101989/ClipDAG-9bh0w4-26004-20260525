do $$
declare
  v_definition text;
  v_original text:=$scope$
  'missing_b7f_allocation',(select count(*) from snapshot
    where payment_status='paid' and payment_allocation_id is not null
      and not exists(select 1 from public.marketplace_order_item_creator_allocations b
        where b.order_item_id=snapshot.order_item_id)),$scope$;
  v_corrected text:=$scope$
  'missing_b7f_allocation',(select count(*) from snapshot cross join activation
    where snapshot.created_at>=activation.activated_at
      and payment_status='paid' and payment_allocation_id is not null
      and not exists(select 1 from public.marketplace_order_item_creator_allocations b
        where b.order_item_id=snapshot.order_item_id)),$scope$;
begin
  select pg_get_functiondef(
    'public.reconcile_marketplace_creator_commerce()'::regprocedure)
  into v_definition;
  if strpos(v_definition,v_original)=0 then
    raise exception using errcode='55000',
      message='marketplace_creator_commerce_reconciliation_definition_mismatch';
  end if;
  execute replace(v_definition,v_original,v_corrected);
end$$;

comment on function public.reconcile_marketplace_creator_commerce() is
  'Reconciles canonical creator-commerce authority. Historical LIVE snapshots backfilled before B7A remain auditable; B7F materialization is mandatory for snapshots created under B7A.';
