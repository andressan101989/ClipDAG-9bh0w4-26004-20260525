begin;

create or replace function public.marketplace_block_disputed_allocation_release()
returns trigger language plpgsql set search_path=public as $$begin
 if old.status='held'and new.status='released'
   and exists(select 1 from public.marketplace_order_disputes d where d.order_id=old.order_id and d.status in('open','under_review'))
   and not exists(select 1 from public.marketplace_order_settlements s where s.order_id=old.order_id and s.release_actor_role='admin')then
   raise exception using message='marketplace_settlement_dispute_active';
 end if;
 return new;
end$$;

revoke all on function public.marketplace_block_disputed_allocation_release()from public,anon,authenticated;

commit;
