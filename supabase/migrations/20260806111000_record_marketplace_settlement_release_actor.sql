begin;

alter table public.marketplace_order_settlements
  add column release_actor_id uuid references auth.users(id),
  add column release_actor_role text;

alter table public.marketplace_order_settlements disable trigger marketplace_settlements_immutable;
update public.marketplace_order_settlements set release_actor_id=confirmed_by,release_actor_role='buyer';
alter table public.marketplace_order_settlements enable trigger marketplace_settlements_immutable;

alter table public.marketplace_order_settlements
  alter column confirmed_by drop not null,
  alter column release_actor_id set not null,
  alter column release_actor_role set not null,
  add constraint marketplace_settlement_release_actor_role_check check(release_actor_role in('buyer','admin'));

alter table public.marketplace_order_settlements drop constraint marketplace_settlement_buyer_check;
alter table public.marketplace_order_settlements add constraint marketplace_settlement_actor_semantics_check check(
 (release_actor_role='buyer'and confirmed_by=buyer_id and release_actor_id=buyer_id)
 or(release_actor_role='admin'and confirmed_by is null and release_actor_id<>buyer_id)
);

create or replace function public.marketplace_settlement_capture_actor()
returns trigger language plpgsql set search_path=public as $$begin
 if new.confirmed_by=new.buyer_id then
   new.release_actor_id:=new.buyer_id;new.release_actor_role:='buyer';
 else
   new.release_actor_id:=new.confirmed_by;new.release_actor_role:='admin';new.confirmed_by:=null;
 end if;
 return new;
end$$;
create trigger marketplace_settlement_capture_actor before insert on public.marketplace_order_settlements
for each row execute function public.marketplace_settlement_capture_actor();

revoke all on function public.marketplace_settlement_capture_actor()from public,anon,authenticated;

commit;
