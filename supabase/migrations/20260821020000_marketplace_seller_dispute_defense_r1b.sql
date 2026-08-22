begin;

create table public.marketplace_dispute_seller_responses(
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.marketplace_order_disputes(id) on delete restrict,
  seller_id uuid not null references auth.users(id) on delete restrict,
  note text,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint marketplace_dispute_seller_responses_note_check
    check(note is null or char_length(btrim(note)) between 3 and 1000),
  constraint marketplace_dispute_seller_responses_dispute_key unique(dispute_id),
  constraint marketplace_dispute_seller_responses_idempotency_key unique(seller_id,idempotency_key)
);

alter table public.marketplace_dispute_seller_responses enable row level security;
revoke all on table public.marketplace_dispute_seller_responses from public,anon,authenticated;
grant all on table public.marketplace_dispute_seller_responses to service_role;

create unique index marketplace_dispute_seller_evidence_position_unique
  on public.media_asset_links(entity_id,slot,position)
  where entity_type='marketplace_dispute' and slot='seller_evidence';

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
        or (l.entity_type='marketplace_dispute' and l.slot in ('buyer_evidence','seller_evidence') and exists(
          select 1 from public.marketplace_order_disputes d where d.id=l.entity_id
        ))
      )
  );
$$;

revoke all on function public.media_asset_has_valid_links(uuid)
  from public,anon,authenticated;
grant execute on function public.media_asset_has_valid_links(uuid)
  to service_role;

create function public.respond_to_marketplace_dispute(
  p_dispute_id uuid,
  p_seller_note text,
  p_evidence_asset_ids uuid[],
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_dispute public.marketplace_order_disputes;
  v_response public.marketplace_dispute_seller_responses;
  v_asset_ids uuid[]:=coalesce(p_evidence_asset_ids,'{}'::uuid[]);
  v_note text:=nullif(btrim(p_seller_note),'');
  v_evidence_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='marketplace_auth_required';
  end if;
  v_evidence_count:=cardinality(v_asset_ids);
  if p_dispute_id is null or p_idempotency_key is null
     or (v_note is null and v_evidence_count=0)
     or (v_note is not null and char_length(v_note) not between 3 and 1000)
     or v_evidence_count not between 0 and 6
     or (select count(distinct value) from unnest(v_asset_ids) value)<>v_evidence_count then
    raise exception using errcode='22023',message='marketplace_dispute_response_invalid_input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('marketplace-dispute-response:'||p_dispute_id::text,0));
  select * into v_dispute from public.marketplace_order_disputes
  where id=p_dispute_id for update;
  if not found then
    raise exception using errcode='P0002',message='marketplace_dispute_not_found';
  end if;
  if v_dispute.seller_id<>auth.uid() then
    raise exception using errcode='42501',message='marketplace_dispute_not_owned';
  end if;
  if v_dispute.status not in ('open','under_review') then
    raise exception using errcode='22023',message='marketplace_dispute_response_state_conflict';
  end if;
  if exists(select 1 from public.marketplace_order_settlements where order_id=v_dispute.order_id) then
    raise exception using errcode='22023',message='marketplace_dispute_settlement_completed';
  end if;

  if v_evidence_count>0 then
    perform id from public.media_assets where id=any(v_asset_ids) order by id for update;
    if (select count(*) from public.media_assets
        where id=any(v_asset_ids) and owner_id=auth.uid() and status='ready'
          and visibility='private' and media_kind='image' and purpose='dispute_evidence')<>v_evidence_count then
      raise exception using errcode='42501',message='marketplace_dispute_response_invalid_input';
    end if;
  end if;

  select * into v_response
  from public.marketplace_dispute_seller_responses
  where seller_id=auth.uid() and idempotency_key=p_idempotency_key;
  if found then
    if (v_response.dispute_id,coalesce(v_response.note,''))
         is distinct from (p_dispute_id,coalesce(v_note,''))
       or (select coalesce(array_agg(l.asset_id order by l.position),'{}'::uuid[])
           from public.media_asset_links l
           where l.entity_type='marketplace_dispute' and l.entity_id=v_response.dispute_id
             and l.slot='seller_evidence') is distinct from v_asset_ids then
      raise exception using errcode='23505',message='marketplace_dispute_response_idempotency_conflict';
    end if;
  else
    if exists(select 1 from public.marketplace_dispute_seller_responses where dispute_id=p_dispute_id) then
      raise exception using errcode='23505',message='marketplace_dispute_response_already_submitted';
    end if;
    insert into public.marketplace_dispute_seller_responses(dispute_id,seller_id,note,idempotency_key)
    values(p_dispute_id,auth.uid(),v_note,p_idempotency_key)
    returning * into v_response;

    insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
    select value,'marketplace_dispute',p_dispute_id,'seller_evidence',(ordinality-1)::integer
    from unnest(v_asset_ids) with ordinality evidence(value,ordinality);
  end if;

  return jsonb_build_object(
    'response_id',v_response.id,
    'dispute_id',v_response.dispute_id,
    'note',v_response.note,
    'evidence_asset_ids',v_asset_ids,
    'created_at',v_response.created_at
  );
end;
$$;

revoke all on function public.respond_to_marketplace_dispute(uuid,text,uuid[],uuid)
  from public,anon,authenticated;
grant execute on function public.respond_to_marketplace_dispute(uuid,text,uuid[],uuid)
  to authenticated,service_role;

create or replace function public.fetch_my_marketplace_order_lifecycle(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare o public.marketplace_orders;
begin
 select*into o from public.marketplace_orders where id=p_order_id;
 if o.id is null then raise exception using message='marketplace_order_not_found';end if;
 if auth.uid()not in(o.buyer_id,o.seller_id)then raise exception using errcode='42501',message='marketplace_order_not_owned';end if;
 return jsonb_build_object(
  'shipping_amount',o.shipping_amount,
  'shipping',(select jsonb_build_object('estimated_delivery_at',sh.estimated_delivery_at)from public.marketplace_order_shipments sh where sh.order_id=o.id),
  'shipping_snapshot',(select jsonb_build_object('processing_days_min',min(s.processing_days_min),'processing_days_max',max(s.processing_days_max),
   'transit_days_min',min(s.transit_days_min),'transit_days_max',max(s.transit_days_max),'return_policy_summary',max(s.return_policy_summary))
   from public.marketplace_order_shipping_snapshots s where s.order_id=o.id),
  'dispute',(select jsonb_build_object(
    'id',d.id,'status',d.status,'reason_code',d.reason_code,'buyer_note',d.buyer_note,'created_at',d.created_at,
    'outcome',x.outcome,'decided_at',x.decided_at,
    'affected_item_ids',coalesce((select jsonb_agg(di.order_item_id order by di.order_item_id)
      from public.marketplace_dispute_items di where di.dispute_id=d.id),'[]'::jsonb),
    'buyer_evidence_asset_ids',coalesce((select jsonb_agg(l.asset_id order by l.position)
      from public.media_asset_links l where l.entity_type='marketplace_dispute'
        and l.entity_id=d.id and l.slot='buyer_evidence'),'[]'::jsonb),
    'seller_response',case when auth.uid()=o.seller_id then (
      select jsonb_build_object(
        'id',r.id,'note',r.note,'created_at',r.created_at,
        'evidence_asset_ids',coalesce((select jsonb_agg(sl.asset_id order by sl.position)
          from public.media_asset_links sl where sl.entity_type='marketplace_dispute'
            and sl.entity_id=d.id and sl.slot='seller_evidence'),'[]'::jsonb)
      ) from public.marketplace_dispute_seller_responses r where r.dispute_id=d.id
    ) else null end)
   from public.marketplace_order_disputes d left join public.marketplace_dispute_decisions x on x.dispute_id=d.id
   where d.order_id=o.id order by d.created_at desc limit 1)
 );
end$$;

revoke all on function public.fetch_my_marketplace_order_lifecycle(uuid)from public,anon;
grant execute on function public.fetch_my_marketplace_order_lifecycle(uuid)to authenticated,service_role;

comment on table public.marketplace_dispute_seller_responses is
  'One immutable seller defense per protected pre-settlement Marketplace dispute.';
comment on function public.respond_to_marketplace_dispute(uuid,text,uuid[],uuid) is
  'Atomically records one idempotent seller defense and private evidence without changing dispute outcome or moving funds.';

commit;
