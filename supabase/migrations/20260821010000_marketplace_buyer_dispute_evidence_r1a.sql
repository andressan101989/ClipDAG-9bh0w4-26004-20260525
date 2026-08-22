begin;

create table public.marketplace_dispute_items (
  dispute_id uuid not null references public.marketplace_order_disputes(id) on delete restrict,
  order_item_id uuid not null references public.marketplace_order_items(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (dispute_id, order_item_id)
);

alter table public.marketplace_dispute_items enable row level security;
revoke all on table public.marketplace_dispute_items from public, anon, authenticated;
grant all on table public.marketplace_dispute_items to service_role;

alter table public.media_asset_links
  drop constraint media_asset_links_entity_type_check;
alter table public.media_asset_links
  add constraint media_asset_links_entity_type_check check (entity_type in (
    'user_profile','video_post','story','chat_message','shop_product',
    'exclusive_content','marketplace_store','marketplace_dispute'
  ));

create unique index marketplace_dispute_evidence_position_unique
on public.media_asset_links(entity_id, slot, position)
where entity_type='marketplace_dispute' and slot='buyer_evidence';

create or replace function public.media_asset_has_valid_links(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists (
    select 1
    from public.media_asset_links l
    join public.media_assets a on a.id=l.asset_id
    where l.asset_id=p_asset_id
      and (
        (l.entity_type='user_profile' and exists(
          select 1 from public.user_profiles u
          where u.id=l.entity_id and u.avatar_url=a.public_url
        ))
        or (l.entity_type='video_post' and exists(
          select 1 from public.videos v where v.id=l.entity_id
        ))
        or (l.entity_type='story' and exists(
          select 1 from public.stories s where s.id=l.entity_id and s.expires_at>now()
        ))
        or (l.entity_type='shop_product' and exists(
          select 1 from public.products p where p.id=l.entity_id and p.status<>'deleted'
        ))
        or (l.entity_type='marketplace_store' and exists(
          select 1 from public.marketplace_stores s
          where s.id=l.entity_id
            and ((l.slot='logo' and s.logo_asset_id=l.asset_id)
              or (l.slot='banner' and s.banner_asset_id=l.asset_id))
        ))
        or (l.entity_type='marketplace_dispute' and l.slot='buyer_evidence' and exists(
          select 1 from public.marketplace_order_disputes d where d.id=l.entity_id
        ))
      )
  );
$$;

revoke all on function public.media_asset_has_valid_links(uuid)
  from public, anon, authenticated;
grant execute on function public.media_asset_has_valid_links(uuid)
  to service_role;

drop function public.report_marketplace_order_problem(uuid,text,text,uuid);

create function public.report_marketplace_order_problem(
  p_order_id uuid,
  p_reason_code text,
  p_buyer_note text,
  p_idempotency_key uuid,
  p_order_item_ids uuid[] default '{}'::uuid[],
  p_evidence_asset_ids uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.marketplace_orders;
  v_dispute public.marketplace_order_disputes;
  v_item_ids uuid[];
  v_asset_ids uuid[];
  v_item_count integer;
  v_evidence_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='marketplace_auth_required';
  end if;

  v_item_ids:=coalesce(p_order_item_ids,'{}'::uuid[]);
  v_asset_ids:=coalesce(p_evidence_asset_ids,'{}'::uuid[]);
  v_item_count:=cardinality(v_item_ids);
  v_evidence_count:=cardinality(v_asset_ids);

  if p_order_id is null or p_idempotency_key is null
     or p_reason_code not in ('not_received','damaged','incorrect_item','missing_items','other')
     or (p_buyer_note is not null and char_length(btrim(p_buyer_note)) not between 1 and 1000)
     or (p_reason_code='other' and char_length(btrim(coalesce(p_buyer_note,'')))<3)
     or v_item_count not between 0 and 100
     or v_evidence_count not between 0 and 6
     or (select count(distinct value) from unnest(v_item_ids) value)<>v_item_count
     or (select count(distinct value) from unnest(v_asset_ids) value)<>v_evidence_count
     or (p_reason_code in ('damaged','incorrect_item','missing_items') and v_evidence_count<1) then
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
  -- Compatibility for trusted historical callers of the original four-argument
  -- signature: an omitted item array means every immutable item in this order.
  if v_item_count=0 then
    select coalesce(array_agg(id order by id),'{}'::uuid[]) into v_item_ids
    from public.marketplace_order_items where order_id=v_order.id;
    v_item_count:=cardinality(v_item_ids);
  end if;
  if v_item_count not between 1 and 100 then
    raise exception using errcode='22023',message='marketplace_dispute_invalid_input';
  end if;
  if (select count(*) from public.marketplace_order_items where order_id=v_order.id and id=any(v_item_ids))<>v_item_count then
    raise exception using errcode='42501',message='marketplace_dispute_invalid_input';
  end if;

  if v_evidence_count>0 then
    perform id from public.media_assets where id=any(v_asset_ids) order by id for update;
    if (select count(*) from public.media_assets
        where id=any(v_asset_ids) and owner_id=auth.uid() and status='ready'
          and visibility='private' and media_kind='image' and purpose='dispute_evidence')<>v_evidence_count then
      raise exception using errcode='42501',message='marketplace_dispute_invalid_input';
    end if;
  end if;

  select * into v_dispute
  from public.marketplace_order_disputes
  where buyer_id=auth.uid() and idempotency_key=p_idempotency_key;
  if found then
    if (v_dispute.order_id,v_dispute.reason_code,coalesce(v_dispute.buyer_note,''))
       is distinct from (p_order_id,p_reason_code,coalesce(nullif(btrim(p_buyer_note),''),''))
       or (select coalesce(array_agg(di.order_item_id order by di.order_item_id),'{}'::uuid[])
           from public.marketplace_dispute_items di where di.dispute_id=v_dispute.id)
          is distinct from (select coalesce(array_agg(value order by value),'{}'::uuid[]) from unnest(v_item_ids) value)
       or (select coalesce(array_agg(l.asset_id order by l.position),'{}'::uuid[])
           from public.media_asset_links l where l.entity_type='marketplace_dispute'
             and l.entity_id=v_dispute.id and l.slot='buyer_evidence')
          is distinct from coalesce(v_asset_ids,'{}'::uuid[]) then
      raise exception using errcode='23505',message='marketplace_dispute_idempotency_conflict';
    end if;
  else
    if exists(select 1 from public.marketplace_order_disputes
              where order_id=v_order.id and status in ('open','under_review')) then
      raise exception using errcode='23505',message='marketplace_dispute_idempotency_conflict';
    end if;

    insert into public.marketplace_order_disputes(
      order_id,checkout_id,buyer_id,seller_id,reason_code,buyer_note,idempotency_key
    ) values (
      v_order.id,v_order.checkout_id,v_order.buyer_id,v_order.seller_id,
      p_reason_code,nullif(btrim(p_buyer_note),''),p_idempotency_key
    ) returning * into v_dispute;

    insert into public.marketplace_dispute_items(dispute_id,order_item_id)
    select v_dispute.id,value from unnest(v_item_ids) value;

    insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
    select value,'marketplace_dispute',v_dispute.id,'buyer_evidence',(ordinality-1)::integer
    from unnest(v_asset_ids) with ordinality evidence(value,ordinality);

    insert into public.marketplace_order_events(
      order_id,checkout_id,buyer_id,seller_id,store_id,event_type,from_status,to_status,
      actor_id,actor_role,idempotency_key,metadata
    ) values (
      v_order.id,v_order.checkout_id,v_order.buyer_id,v_order.seller_id,v_order.store_id,
      'dispute_opened',v_order.status,v_order.status,v_order.buyer_id,'buyer',p_idempotency_key,
      jsonb_build_object('reason_code',p_reason_code,'affected_item_count',v_item_count,'evidence_count',v_evidence_count)
    );
  end if;

  return jsonb_build_object(
    'dispute_id',v_dispute.id,
    'status',v_dispute.status,
    'reason_code',v_dispute.reason_code,
    'settlement_blocked',v_dispute.status in ('open','under_review'),
    'affected_item_count',v_item_count,
    'evidence_count',v_evidence_count,
    'created_at',v_dispute.created_at
  );
end;
$$;

revoke all on function public.report_marketplace_order_problem(uuid,text,text,uuid,uuid[],uuid[])
  from public, anon, authenticated;
grant execute on function public.report_marketplace_order_problem(uuid,text,text,uuid,uuid[],uuid[])
  to authenticated, service_role;

commit;
