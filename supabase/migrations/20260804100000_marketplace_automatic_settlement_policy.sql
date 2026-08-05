begin;

create table if not exists public.marketplace_settlement_policy (
  singleton boolean primary key default true check (singleton),
  maximum_confirmation_days integer not null default 14
    check (maximum_confirmation_days between 1 and 90),
  updated_at timestamptz not null default now()
);

insert into public.marketplace_settlement_policy(singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.marketplace_order_disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.marketplace_orders(id),
  checkout_id uuid not null references public.marketplace_checkout_sessions(id),
  buyer_id uuid not null references auth.users(id),
  seller_id uuid not null references auth.users(id),
  status text not null default 'open'
    check (status in ('open','under_review','resolved','rejected','cancelled')),
  reason_code text not null
    check (reason_code in ('not_received','damaged','incorrect_item','missing_items','other')),
  buyer_note text check (buyer_note is null or char_length(buyer_note) between 1 and 1000),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (buyer_id,idempotency_key)
);

create unique index if not exists marketplace_order_one_active_dispute
on public.marketplace_order_disputes(order_id)
where status in ('open','under_review');

alter table public.marketplace_settlement_policy enable row level security;
alter table public.marketplace_order_disputes enable row level security;

create or replace function public.report_marketplace_order_problem(
  p_order_id uuid,
  p_reason_code text,
  p_buyer_note text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.marketplace_orders;
  v_dispute public.marketplace_order_disputes;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='marketplace_auth_required';
  end if;
  if p_order_id is null or p_idempotency_key is null
     or p_reason_code not in ('not_received','damaged','incorrect_item','missing_items','other')
     or (p_buyer_note is not null and char_length(btrim(p_buyer_note)) not between 1 and 1000) then
    raise exception using errcode='22023',message='marketplace_dispute_invalid_input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('marketplace-dispute:'||p_order_id::text,0));
  select * into v_order from public.marketplace_orders where id=p_order_id for update;
  if not found then raise exception using errcode='P0002',message='marketplace_order_not_found'; end if;
  if v_order.buyer_id<>auth.uid() then
    raise exception using errcode='42501',message='marketplace_order_not_owned';
  end if;
  if v_order.status not in ('shipped','delivered') then
    raise exception using errcode='22023',message='marketplace_dispute_order_state_conflict';
  end if;
  if exists(select 1 from public.marketplace_order_settlements where order_id=v_order.id) then
    raise exception using errcode='22023',message='marketplace_dispute_settlement_completed';
  end if;

  select * into v_dispute
  from public.marketplace_order_disputes
  where buyer_id=auth.uid() and idempotency_key=p_idempotency_key;
  if found then
    if (v_dispute.order_id,v_dispute.reason_code,coalesce(v_dispute.buyer_note,''))
       is distinct from (p_order_id,p_reason_code,coalesce(nullif(btrim(p_buyer_note),''),'')) then
      raise exception using errcode='23505',message='marketplace_dispute_idempotency_conflict';
    end if;
  else
    insert into public.marketplace_order_disputes(
      order_id,checkout_id,buyer_id,seller_id,reason_code,buyer_note,idempotency_key
    ) values (
      v_order.id,v_order.checkout_id,v_order.buyer_id,v_order.seller_id,
      p_reason_code,nullif(btrim(p_buyer_note),''),p_idempotency_key
    ) returning * into v_dispute;

    insert into public.marketplace_order_events(
      order_id,checkout_id,buyer_id,seller_id,store_id,event_type,from_status,to_status,
      actor_id,actor_role,idempotency_key,metadata
    ) values (
      v_order.id,v_order.checkout_id,v_order.buyer_id,v_order.seller_id,v_order.store_id,
      'dispute_opened',v_order.status,v_order.status,v_order.buyer_id,'buyer',p_idempotency_key,
      jsonb_build_object('reason_code',p_reason_code)
    );
  end if;

  return jsonb_build_object(
    'status',v_dispute.status,
    'reason_code',v_dispute.reason_code,
    'settlement_blocked',v_dispute.status in ('open','under_review'),
    'created_at',v_dispute.created_at
  );
end;
$$;

create or replace function public.settle_eligible_marketplace_orders(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer;
  v_order record;
  v_processed integer:=0;
  v_failed integer:=0;
  v_key uuid;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise exception using errcode='42501',message='marketplace_settlement_service_role_required';
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception using errcode='22023',message='marketplace_settlement_invalid_limit';
  end if;

  select maximum_confirmation_days into strict v_days
  from public.marketplace_settlement_policy where singleton;

  for v_order in
    select o.id,o.buyer_id
    from public.marketplace_orders o
    join public.marketplace_order_shipments sh on sh.order_id=o.id and sh.status='shipped'
    join public.marketplace_payment_allocations a on a.order_id=o.id and a.status='held'
    where o.status='shipped'
      and sh.shipped_at<=now()-make_interval(days=>v_days)
      and not exists (
        select 1 from public.marketplace_order_disputes d
        where d.order_id=o.id and d.status in ('open','under_review')
      )
      and not exists (select 1 from public.marketplace_order_settlements s where s.order_id=o.id)
    order by sh.shipped_at,o.id
    limit p_limit
    for update of o skip locked
  loop
    begin
      v_key := (
        substr(md5('marketplace-auto-settlement:'||v_order.id::text),1,8)||'-'||
        substr(md5('marketplace-auto-settlement:'||v_order.id::text),9,4)||'-4'||
        substr(md5('marketplace-auto-settlement:'||v_order.id::text),14,3)||'-8'||
        substr(md5('marketplace-auto-settlement:'||v_order.id::text),18,3)||'-'||
        substr(md5('marketplace-auto-settlement:'||v_order.id::text),21,12)
      )::uuid;
      perform public.confirm_marketplace_order_delivery_and_release(v_order.buyer_id,v_order.id,v_key);
      v_processed:=v_processed+1;
    exception when others then
      v_failed:=v_failed+1;
    end;
  end loop;

  return jsonb_build_object('processed',v_processed,'failed',v_failed,'policy_days',v_days);
end;
$$;

revoke all on table public.marketplace_settlement_policy,public.marketplace_order_disputes
from public,anon,authenticated;
revoke all on function public.report_marketplace_order_problem(uuid,text,text,uuid),
  public.settle_eligible_marketplace_orders(integer)
from public,anon,authenticated;
grant execute on function public.report_marketplace_order_problem(uuid,text,text,uuid)
to authenticated,service_role;
grant execute on function public.settle_eligible_marketplace_orders(integer)
to service_role;

commit;
