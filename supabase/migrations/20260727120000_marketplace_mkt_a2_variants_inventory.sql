begin;

-- MKT-A2: authoritative product variants, SKU and seller inventory.
-- Prices remain BDAG numeric(20,8). Inventory mutations are seller-only;
-- no orders, reservations, wallet or ledger behavior is introduced.

alter table public.products
  add column if not exists variant_price_max numeric(20,8),
  add column if not exists active_variant_count integer not null default 1;
alter table public.products
  add constraint products_variant_price_max_check
    check (variant_price_max is null or
      (variant_price_max>0 and variant_price_max=round(variant_price_max,8))),
  add constraint products_active_variant_count_check check (active_variant_count>=0);

create table public.marketplace_product_options (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_product_options_name_check
    check (char_length(name) between 1 and 40 and name=btrim(name)),
  constraint marketplace_product_options_position_check check (position between 0 and 2)
);
create unique index marketplace_product_options_name_unique
  on public.marketplace_product_options(product_id,lower(name));
create unique index marketplace_product_options_position_unique
  on public.marketplace_product_options(product_id,position);
create index marketplace_product_options_product_idx
  on public.marketplace_product_options(product_id,position);

create table public.marketplace_product_option_values (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.marketplace_product_options(id) on delete cascade,
  value text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_option_values_value_check
    check (char_length(value) between 1 and 60 and value=btrim(value)),
  constraint marketplace_option_values_position_check check (position between 0 and 19)
);
create unique index marketplace_option_values_value_unique
  on public.marketplace_product_option_values(option_id,lower(value));
create unique index marketplace_option_values_position_unique
  on public.marketplace_product_option_values(option_id,position);
create index marketplace_option_values_option_idx
  on public.marketplace_product_option_values(option_id,position);

create table public.marketplace_product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  store_id uuid not null references public.marketplace_stores(id) on delete restrict,
  seller_id uuid not null references public.marketplace_sellers(user_id) on delete restrict,
  sku text not null,
  sku_normalized text not null,
  title text,
  price numeric(20,8) not null,
  compare_at_price numeric(20,8),
  status text not null default 'active',
  is_default boolean not null default false,
  image_asset_id uuid references public.media_assets(id) on delete set null,
  barcode text,
  combination_key text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint marketplace_variants_sku_check
    check (sku=sku_normalized and char_length(sku_normalized) between 1 and 64
      and sku_normalized ~ '^[A-Z0-9._-]+$'),
  constraint marketplace_variants_title_check
    check (title is null or char_length(title) between 1 and 120),
  constraint marketplace_variants_price_check
    check (price>0 and price=round(price,8)),
  constraint marketplace_variants_compare_price_check
    check (compare_at_price is null or
      (compare_at_price>=price and compare_at_price=round(compare_at_price,8))),
  constraint marketplace_variants_status_check check (status in ('active','inactive','archived')),
  constraint marketplace_variants_archive_check
    check ((status='archived')=(archived_at is not null)),
  constraint marketplace_variants_barcode_check
    check (barcode is null or char_length(barcode) between 1 and 64)
);
create unique index marketplace_variants_store_sku_unique
  on public.marketplace_product_variants(store_id,sku_normalized);
create unique index marketplace_variants_combination_unique
  on public.marketplace_product_variants(product_id,combination_key)
  where status<>'archived';
create unique index marketplace_variants_default_unique
  on public.marketplace_product_variants(product_id)
  where is_default and status<>'archived';
create index marketplace_variants_product_idx
  on public.marketplace_product_variants(product_id,status,created_at);
create index marketplace_variants_seller_idx
  on public.marketplace_product_variants(seller_id,updated_at desc);

create table public.marketplace_variant_option_values (
  variant_id uuid not null references public.marketplace_product_variants(id) on delete cascade,
  option_value_id uuid not null references public.marketplace_product_option_values(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(variant_id,option_value_id)
);
create index marketplace_variant_option_values_value_idx
  on public.marketplace_variant_option_values(option_value_id,variant_id);

create table public.marketplace_inventory_levels (
  variant_id uuid primary key references public.marketplace_product_variants(id) on delete restrict,
  on_hand integer not null,
  reserved integer not null default 0,
  low_stock_threshold integer not null default 0,
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_inventory_on_hand_check check (on_hand between 0 and 1000000000),
  constraint marketplace_inventory_reserved_check check (reserved>=0 and reserved<=on_hand),
  constraint marketplace_inventory_threshold_check check (low_stock_threshold between 0 and 1000000000),
  constraint marketplace_inventory_version_check check (version>=0)
);
create index marketplace_inventory_low_stock_idx
  on public.marketplace_inventory_levels(on_hand,low_stock_threshold);

create table public.marketplace_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.marketplace_product_variants(id) on delete restrict,
  seller_id uuid not null references public.marketplace_sellers(user_id) on delete restrict,
  movement_type text not null,
  delta integer not null,
  previous_on_hand integer not null,
  resulting_on_hand integer not null,
  reason text,
  idempotency_key uuid not null,
  request_fingerprint text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint marketplace_inventory_movement_type_check
    check (movement_type in ('backfill','initial','seller_set','seller_adjust','correction')),
  constraint marketplace_inventory_movement_quantities_check
    check (previous_on_hand between 0 and 1000000000
      and resulting_on_hand between 0 and 1000000000
      and resulting_on_hand-previous_on_hand=delta),
  constraint marketplace_inventory_reason_check
    check (reason is null or char_length(reason)<=240)
);
create unique index marketplace_inventory_idempotency_unique
  on public.marketplace_inventory_movements(created_by,idempotency_key);
create index marketplace_inventory_movements_variant_idx
  on public.marketplace_inventory_movements(variant_id,created_at desc);
create index marketplace_inventory_movements_seller_idx
  on public.marketplace_inventory_movements(seller_id,created_at desc);

create table public.marketplace_variant_configuration_requests (
  actor_id uuid not null,
  idempotency_key uuid not null,
  product_id uuid not null references public.products(id) on delete restrict,
  request_fingerprint text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key(actor_id,idempotency_key)
);

create trigger marketplace_product_options_set_updated_at before update
on public.marketplace_product_options for each row
execute function public.marketplace_set_updated_at();
create trigger marketplace_option_values_set_updated_at before update
on public.marketplace_product_option_values for each row
execute function public.marketplace_set_updated_at();
create trigger marketplace_product_variants_set_updated_at before update
on public.marketplace_product_variants for each row
execute function public.marketplace_set_updated_at();
create trigger marketplace_inventory_levels_set_updated_at before update
on public.marketplace_inventory_levels for each row
execute function public.marketplace_set_updated_at();

create or replace function public.marketplace_normalize_sku(p_value text)
returns text language plpgsql immutable set search_path=public
as $$
declare v_sku text;
begin
  v_sku:=upper(regexp_replace(btrim(coalesce(p_value,'')),'\s+','-','g'));
  if char_length(v_sku) not between 1 and 64 or v_sku !~ '^[A-Z0-9._-]+$' then
    raise exception using errcode='22023',message='marketplace_invalid_sku';
  end if;
  return v_sku;
end;
$$;

create or replace function public.marketplace_auto_sku(p_product_id uuid)
returns text language sql immutable set search_path=public
as $$ select 'AUTO-'||upper(substr(replace(p_product_id::text,'-',''),1,16)); $$;

create or replace function public.refresh_marketplace_product_projection(p_product_id uuid)
returns void language plpgsql security definer set search_path=public
as $$
declare v_price numeric(20,8); v_price_max numeric(20,8); v_stock bigint; v_count integer;
begin
  perform 1 from public.products where id=p_product_id for update;
  select min(v.price),max(v.price),coalesce(sum(greatest(l.on_hand-l.reserved,0)),0),count(*)
  into v_price,v_price_max,v_stock,v_count
  from public.marketplace_product_variants v
  join public.marketplace_inventory_levels l on l.variant_id=v.id
  where v.product_id=p_product_id and v.status='active' and v.archived_at is null;
  update public.products
  set price=coalesce(v_price,price),variant_price_max=v_price_max,
      active_variant_count=v_count,
      stock=least(coalesce(v_stock,0),2147483647)::integer
  where id=p_product_id;
end;
$$;

-- Backfill is idempotent and preserves all product/media/save rows.
insert into public.marketplace_product_variants(
  product_id,store_id,seller_id,sku,sku_normalized,title,price,compare_at_price,
  status,is_default,combination_key,created_at,updated_at
)
select p.id,p.store_id,p.seller_id,public.marketplace_auto_sku(p.id),
  public.marketplace_auto_sku(p.id),null,p.price,p.compare_at_price,'active',true,'',
  p.created_at,p.updated_at
from public.products p
where p.deleted_at is null
  and not exists(select 1 from public.marketplace_product_variants v where v.product_id=p.id);

insert into public.marketplace_inventory_levels(
  variant_id,on_hand,reserved,low_stock_threshold,version,created_at,updated_at
)
select v.id,p.stock,0,0,0,p.created_at,p.updated_at
from public.marketplace_product_variants v join public.products p on p.id=v.product_id
where not exists(select 1 from public.marketplace_inventory_levels l where l.variant_id=v.id);

insert into public.marketplace_inventory_movements(
  variant_id,seller_id,movement_type,delta,previous_on_hand,resulting_on_hand,
  reason,idempotency_key,request_fingerprint,created_by,created_at
)
select v.id,v.seller_id,'backfill',l.on_hand,0,l.on_hand,'MKT-A2 backfill',
  v.id,'backfill:'||v.id::text,null,v.created_at
from public.marketplace_product_variants v
join public.marketplace_inventory_levels l on l.variant_id=v.id
where not exists(
  select 1 from public.marketplace_inventory_movements m
  where m.variant_id=v.id and m.movement_type='backfill'
);

update public.products p set variant_price_max=p.price,active_variant_count=1
where p.deleted_at is null;

do $$
begin
  if exists(select 1 from public.products where deleted_at is null and stock<0) then
    raise exception 'marketplace_backfill_negative_stock';
  end if;
  if exists(
    select p.id from public.products p left join public.marketplace_product_variants v
      on v.product_id=p.id and v.is_default and v.status<>'archived'
    where p.deleted_at is null group by p.id having count(v.id)<>1
  ) then raise exception 'marketplace_backfill_default_variant_failed'; end if;
  if exists(
    select 1 from public.marketplace_product_variants v
    left join public.marketplace_inventory_levels l on l.variant_id=v.id where l.variant_id is null
  ) then raise exception 'marketplace_backfill_inventory_failed'; end if;
  if exists(
    select 1 from public.marketplace_product_variants v join public.products p on p.id=v.product_id
    where v.seller_id<>p.seller_id or v.store_id<>p.store_id
  ) then raise exception 'marketplace_backfill_ownership_failed'; end if;
end;
$$;

create or replace function public.marketplace_assert_variant_owner(p_variant_id uuid)
returns public.marketplace_product_variants
language plpgsql security definer set search_path=public
as $$
declare v public.marketplace_product_variants;
begin
  select pv.* into v
  from public.marketplace_product_variants pv
  join public.products p on p.id=pv.product_id
  join public.marketplace_stores s on s.id=pv.store_id
  where pv.id=p_variant_id and pv.seller_id=auth.uid() and p.seller_id=auth.uid()
    and p.deleted_at is null and s.seller_id=auth.uid() and s.status='active'
  for update of pv;
  if not found or not public.marketplace_seller_is_approved(auth.uid()) then
    raise exception using errcode='42501',message='marketplace_variant_not_editable';
  end if;
  return v;
end;
$$;

create or replace function public.marketplace_validate_variant_image(
  p_product_id uuid,p_asset_id uuid
) returns void language plpgsql security definer set search_path=public
as $$
begin
  if p_asset_id is null then return; end if;
  if not exists(
    select 1 from public.media_assets a
    join public.media_asset_links l on l.asset_id=a.id
    where a.id=p_asset_id and a.owner_id=auth.uid() and a.status='ready'
      and a.purpose='product_image' and a.media_kind='image'
      and l.entity_type='shop_product' and l.entity_id=p_product_id and l.slot='image'
  ) then raise exception using errcode='42501',message='marketplace_variant_image_not_allowed'; end if;
end;
$$;

create or replace function public.update_marketplace_product_variant(
  p_variant_id uuid,p_sku text,p_price numeric,p_compare_at_price numeric,
  p_status text,p_image_asset_id uuid default null,p_title text default null,
  p_barcode text default null
) returns void language plpgsql security definer set search_path=public
as $$
declare v public.marketplace_product_variants; v_sku text; v_price numeric(20,8);
  v_compare numeric(20,8);
begin
  v:=public.marketplace_assert_variant_owner(p_variant_id);
  if v.status='archived' then
    raise exception using errcode='22023',message='marketplace_variant_archived';
  end if;
  if p_status not in ('active','inactive') then
    raise exception using errcode='22023',message='marketplace_invalid_variant_status';
  end if;
  v_sku:=public.marketplace_normalize_sku(p_sku);
  v_price:=public.marketplace_normalize_price(p_price);
  if p_compare_at_price is not null then
    v_compare:=public.marketplace_normalize_price(p_compare_at_price);
    if v_compare<v_price then
      raise exception using errcode='22023',message='invalid_compare_at_price';
    end if;
  end if;
  perform public.marketplace_validate_variant_image(v.product_id,p_image_asset_id);
  begin
    update public.marketplace_product_variants set
      sku=v_sku,sku_normalized=v_sku,price=v_price,compare_at_price=v_compare,
      status=p_status,image_asset_id=p_image_asset_id,
      title=nullif(btrim(p_title),''),
      barcode=case when p_barcode is null then null else nullif(btrim(p_barcode),'') end
    where id=p_variant_id;
  exception when unique_violation then
    raise exception using errcode='23505',message='marketplace_sku_exists';
  end;
  perform public.refresh_marketplace_product_projection(v.product_id);
end;
$$;

create or replace function public.set_marketplace_default_variant(p_variant_id uuid)
returns void language plpgsql security definer set search_path=public
as $$
declare v public.marketplace_product_variants;
begin
  v:=public.marketplace_assert_variant_owner(p_variant_id);
  if v.status='archived' then
    raise exception using errcode='22023',message='marketplace_variant_archived';
  end if;
  update public.marketplace_product_variants set is_default=false
  where product_id=v.product_id and is_default and id<>v.id;
  update public.marketplace_product_variants set is_default=true where id=v.id;
end;
$$;

create or replace function public.archive_marketplace_product_variant(
  p_variant_id uuid,p_replacement_default_id uuid default null
) returns void language plpgsql security definer set search_path=public
as $$
declare v public.marketplace_product_variants; v_remaining integer;
begin
  v:=public.marketplace_assert_variant_owner(p_variant_id);
  if v.status='archived' then return; end if;
  select count(*) into v_remaining from public.marketplace_product_variants
  where product_id=v.product_id and status<>'archived' and id<>v.id;
  if v_remaining<1 then
    raise exception using errcode='22023',message='marketplace_last_variant_required';
  end if;
  if v.is_default then
    if p_replacement_default_id is null or not exists(
      select 1 from public.marketplace_product_variants
      where id=p_replacement_default_id and product_id=v.product_id
        and status<>'archived' and id<>v.id
    ) then raise exception using errcode='22023',message='marketplace_replacement_default_required'; end if;
    update public.marketplace_product_variants set is_default=false where id=v.id;
    update public.marketplace_product_variants set is_default=true where id=p_replacement_default_id;
  end if;
  update public.marketplace_product_variants
  set status='archived',archived_at=now(),is_default=false where id=v.id;
  perform public.refresh_marketplace_product_projection(v.product_id);
end;
$$;

create or replace function public.restore_marketplace_product_variant(p_variant_id uuid)
returns void language plpgsql security definer set search_path=public
as $$
declare v public.marketplace_product_variants; v_expected text; v_option_count integer;
begin
  v:=public.marketplace_assert_variant_owner(p_variant_id);
  if v.status<>'archived' then return; end if;
  if exists(
    select 1 from public.marketplace_product_variants x
    where x.store_id=v.store_id and x.sku_normalized=v.sku_normalized
      and x.id<>v.id
  ) then raise exception using errcode='23505',message='marketplace_sku_exists'; end if;
  select count(*) into v_option_count from public.marketplace_product_options where product_id=v.product_id;
  select coalesce(string_agg(ov.id::text,',' order by o.position),'') into v_expected
  from public.marketplace_variant_option_values a
  join public.marketplace_product_option_values ov on ov.id=a.option_value_id
  join public.marketplace_product_options o on o.id=ov.option_id
  where a.variant_id=v.id;
  if v_option_count<>(select count(*) from public.marketplace_variant_option_values where variant_id=v.id)
     or v_expected<>v.combination_key then
    raise exception using errcode='22023',message='marketplace_variant_combination_invalid';
  end if;
  if exists(
    select 1 from public.marketplace_product_variants x
    where x.product_id=v.product_id and x.combination_key=v.combination_key
      and x.status<>'archived' and x.id<>v.id
  ) then raise exception using errcode='23505',message='marketplace_duplicate_combination'; end if;
  update public.marketplace_product_variants
  set status='inactive',archived_at=null where id=v.id;
  perform public.refresh_marketplace_product_projection(v.product_id);
end;
$$;

create or replace function public.marketplace_mutate_inventory(
  p_variant_id uuid,p_value integer,p_is_adjustment boolean,p_reason text,
  p_idempotency_key uuid
) returns table(
  variant_id uuid,previous_on_hand integer,resulting_on_hand integer,
  available_quantity integer,inventory_version bigint,movement_id uuid
) language plpgsql security definer set search_path=public
as $$
declare v public.marketplace_product_variants; l public.marketplace_inventory_levels;
  v_result integer; v_type text; v_fp text; v_movement uuid; m public.marketplace_inventory_movements;
begin
  if p_idempotency_key is null then
    raise exception using errcode='22023',message='marketplace_idempotency_key_required';
  end if;
  if char_length(coalesce(p_reason,''))>240 then
    raise exception using errcode='22023',message='marketplace_invalid_inventory_reason';
  end if;
  v:=public.marketplace_assert_variant_owner(p_variant_id);
  if v.status='archived' then
    raise exception using errcode='22023',message='marketplace_variant_archived';
  end if;
  v_type:=case when p_is_adjustment then 'seller_adjust' else 'seller_set' end;
  v_fp:=md5(v_type||':'||p_variant_id::text||':'||p_value::text||':'||
    coalesce(btrim(p_reason),''));
  select * into m from public.marketplace_inventory_movements
  where created_by=auth.uid() and idempotency_key=p_idempotency_key;
  if found then
    if m.request_fingerprint<>v_fp then
      raise exception using errcode='22023',message='marketplace_idempotency_conflict';
    end if;
    return query select m.variant_id,m.previous_on_hand,m.resulting_on_hand,
      m.resulting_on_hand-l2.reserved,l2.version,m.id
      from public.marketplace_inventory_levels l2 where l2.variant_id=m.variant_id;
    return;
  end if;
  select * into l from public.marketplace_inventory_levels
  where marketplace_inventory_levels.variant_id=p_variant_id for update;
  if not found then raise exception 'marketplace_inventory_missing'; end if;
  v_result:=case when p_is_adjustment then l.on_hand+p_value else p_value end;
  if v_result<l.reserved or v_result<0 or v_result>1000000000 then
    raise exception using errcode='22023',message='marketplace_invalid_inventory_quantity';
  end if;
  insert into public.marketplace_inventory_movements(
    variant_id,seller_id,movement_type,delta,previous_on_hand,resulting_on_hand,
    reason,idempotency_key,request_fingerprint,created_by
  ) values(
    p_variant_id,v.seller_id,v_type,v_result-l.on_hand,l.on_hand,v_result,
    nullif(btrim(p_reason),''),p_idempotency_key,v_fp,auth.uid()
  ) returning id into v_movement;
  update public.marketplace_inventory_levels
  set on_hand=v_result,version=version+1 where marketplace_inventory_levels.variant_id=p_variant_id
  returning version into l.version;
  perform public.refresh_marketplace_product_projection(v.product_id);
  return query select p_variant_id,l.on_hand,v_result,v_result-l.reserved,l.version,v_movement;
end;
$$;

create or replace function public.set_marketplace_variant_inventory(
  p_variant_id uuid,p_new_on_hand integer,p_reason text,p_idempotency_key uuid
) returns table(
  variant_id uuid,previous_on_hand integer,resulting_on_hand integer,
  available_quantity integer,inventory_version bigint,movement_id uuid
) language sql security definer set search_path=public
as $$ select * from public.marketplace_mutate_inventory(
  p_variant_id,p_new_on_hand,false,p_reason,p_idempotency_key); $$;

create or replace function public.adjust_marketplace_variant_inventory(
  p_variant_id uuid,p_delta integer,p_reason text,p_idempotency_key uuid
) returns table(
  variant_id uuid,previous_on_hand integer,resulting_on_hand integer,
  available_quantity integer,inventory_version bigint,movement_id uuid
) language sql security definer set search_path=public
as $$ select * from public.marketplace_mutate_inventory(
  p_variant_id,p_delta,true,p_reason,p_idempotency_key); $$;

create or replace function public.set_marketplace_variant_low_stock_threshold(
  p_variant_id uuid,p_threshold integer
) returns void language plpgsql security definer set search_path=public
as $$
begin
  perform public.marketplace_assert_variant_owner(p_variant_id);
  if p_threshold is null or p_threshold<0 or p_threshold>1000000000 then
    raise exception using errcode='22023',message='marketplace_invalid_low_stock_threshold';
  end if;
  update public.marketplace_inventory_levels set low_stock_threshold=p_threshold
  where variant_id=p_variant_id;
end;
$$;

create or replace function public.configure_marketplace_product_variants(
  p_product_id uuid,p_options_json jsonb,p_variants_json jsonb,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=public
as $$
declare
  v_user uuid:=auth.uid(); p public.products; opt jsonb; val jsonb; vr jsonb;
  v_option_id uuid; v_value_id uuid; v_variant_id uuid; v_ids uuid[];
  v_option_count integer; v_variant_count integer; v_value_count integer;
  v_position integer; v_value_position integer; v_name text; v_value text;
  v_sku text; v_price numeric(20,8); v_compare numeric(20,8); v_status text;
  v_default_count integer:=0; v_key text; v_combo jsonb; v_image uuid;
  v_existing uuid[]:='{}'::uuid[]; v_result jsonb:='[]'::jsonb;
  v_fingerprint text; v_prior public.marketplace_variant_configuration_requests;
begin
  if p_idempotency_key is null then
    raise exception using errcode='22023',message='marketplace_idempotency_key_required';
  end if;
  if jsonb_typeof(p_options_json)<>'array' or jsonb_typeof(p_variants_json)<>'array' then
    raise exception using errcode='22023',message='marketplace_invalid_variant_configuration';
  end if;
  select px.* into p from public.products px join public.marketplace_stores s on s.id=px.store_id
  where px.id=p_product_id and px.seller_id=v_user and px.deleted_at is null
    and s.seller_id=v_user and s.status='active' for update of px;
  if not found or not public.marketplace_seller_is_approved(v_user) then
    raise exception using errcode='42501',message='product_not_editable';
  end if;
  v_fingerprint:=md5(p_product_id::text||':'||p_options_json::text||':'||p_variants_json::text);
  select * into v_prior from public.marketplace_variant_configuration_requests
  where actor_id=v_user and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.product_id<>p_product_id or v_prior.request_fingerprint<>v_fingerprint then
      raise exception using errcode='22023',message='marketplace_idempotency_conflict';
    end if;
    return coalesce(v_prior.response,'[]'::jsonb);
  end if;
  begin
    insert into public.marketplace_variant_configuration_requests(
      actor_id,idempotency_key,product_id,request_fingerprint
    ) values(v_user,p_idempotency_key,p_product_id,v_fingerprint);
  exception when unique_violation then
    select * into v_prior from public.marketplace_variant_configuration_requests
    where actor_id=v_user and idempotency_key=p_idempotency_key;
    if v_prior.product_id<>p_product_id or v_prior.request_fingerprint<>v_fingerprint then
      raise exception using errcode='22023',message='marketplace_idempotency_conflict';
    end if;
    return coalesce(v_prior.response,'[]'::jsonb);
  end;
  v_option_count:=jsonb_array_length(p_options_json);
  v_variant_count:=jsonb_array_length(p_variants_json);
  if v_option_count>3 or v_variant_count<1 or v_variant_count>100 then
    raise exception using errcode='22023',message='marketplace_variant_limits_exceeded';
  end if;
  if exists(
    select 1 from jsonb_array_elements(p_options_json) x
    group by lower(btrim(x->>'name')) having count(*)>1
  ) then raise exception using errcode='23505',message='marketplace_duplicate_option_name'; end if;

  -- Removed combinations are archived; movement history is retained.
  update public.marketplace_product_variants set status='archived',archived_at=now(),is_default=false
  where product_id=p_product_id and status<>'archived';
  delete from public.marketplace_variant_option_values a
  using public.marketplace_product_variants v
  where v.id=a.variant_id and v.product_id=p_product_id;
  delete from public.marketplace_product_options where product_id=p_product_id;

  v_position:=0;
  for opt in select value from jsonb_array_elements(p_options_json) loop
    if (opt-'name'-'values')<>'{}'::jsonb
       or jsonb_typeof(opt->'values')<>'array' then
      raise exception using errcode='22023',message='marketplace_invalid_option_fields';
    end if;
    v_name:=btrim(opt->>'name');
    if char_length(v_name) not between 1 and 40 then
      raise exception using errcode='22023',message='marketplace_invalid_option_name';
    end if;
    v_value_count:=jsonb_array_length(opt->'values');
    if v_value_count<1 or v_value_count>20 then
      raise exception using errcode='22023',message='marketplace_option_value_limit';
    end if;
    if exists(
      select 1 from jsonb_array_elements_text(opt->'values') x(value)
      group by lower(btrim(value)) having count(*)>1
    ) then raise exception using errcode='23505',message='marketplace_duplicate_option_value'; end if;
    insert into public.marketplace_product_options(product_id,name,position)
    values(p_product_id,v_name,v_position) returning id into v_option_id;
    v_value_position:=0;
    for val in select to_jsonb(value) from jsonb_array_elements_text(opt->'values') loop
      v_value:=btrim(val#>>'{}');
      if char_length(v_value) not between 1 and 60 then
        raise exception using errcode='22023',message='marketplace_invalid_option_value';
      end if;
      insert into public.marketplace_product_option_values(option_id,value,position)
      values(v_option_id,v_value,v_value_position);
      v_value_position:=v_value_position+1;
    end loop;
    v_position:=v_position+1;
  end loop;

  for vr in select value from jsonb_array_elements(p_variants_json) loop
    if (vr-'id'-'sku'-'title'-'price'-'compare_at_price'-'status'-'is_default'
          -'image_asset_id'-'barcode'-'option_values'-'on_hand'-'low_stock_threshold')<>'{}'::jsonb then
      raise exception using errcode='22023',message='marketplace_invalid_variant_fields';
    end if;
    v_sku:=public.marketplace_normalize_sku(vr->>'sku');
    v_price:=public.marketplace_normalize_price((vr->>'price')::numeric);
    v_compare:=null;
    if nullif(vr->>'compare_at_price','') is not null then
      v_compare:=public.marketplace_normalize_price((vr->>'compare_at_price')::numeric);
      if v_compare<v_price then raise exception using errcode='22023',message='invalid_compare_at_price'; end if;
    end if;
    v_status:=coalesce(vr->>'status','active');
    if v_status not in ('active','inactive') then
      raise exception using errcode='22023',message='marketplace_invalid_variant_status';
    end if;
    if coalesce((vr->>'is_default')::boolean,false) then v_default_count:=v_default_count+1; end if;
    v_combo:=coalesce(vr->'option_values','[]'::jsonb);
    if jsonb_typeof(v_combo)<>'array' or jsonb_array_length(v_combo)<>v_option_count then
      raise exception using errcode='22023',message='marketplace_incomplete_combination';
    end if;
    select coalesce(array_agg(ov.id order by o.position),'{}'::uuid[]),
      coalesce(string_agg(ov.id::text,',' order by o.position),'')
    into v_ids,v_key
    from jsonb_array_elements_text(v_combo) with ordinality supplied(value,position)
    join public.marketplace_product_options o
      on o.product_id=p_product_id and o.position=supplied.position-1
    join public.marketplace_product_option_values ov
      on ov.option_id=o.id and lower(ov.value)=lower(btrim(supplied.value));
    if coalesce(array_length(v_ids,1),0)<>v_option_count then
      raise exception using errcode='22023',message='marketplace_option_value_not_found';
    end if;
    v_image:=nullif(vr->>'image_asset_id','')::uuid;
    perform public.marketplace_validate_variant_image(p_product_id,v_image);
    v_variant_id:=null;
    if nullif(vr->>'id','') is not null then
      select id into v_variant_id from public.marketplace_product_variants
      where id=(vr->>'id')::uuid and product_id=p_product_id;
    end if;
    if v_variant_id is null then
      select id into v_variant_id from public.marketplace_product_variants
      where product_id=p_product_id and sku_normalized=v_sku order by created_at limit 1;
    end if;
    begin
      if v_variant_id is null then
        insert into public.marketplace_product_variants(
          product_id,store_id,seller_id,sku,sku_normalized,title,price,compare_at_price,
          status,is_default,image_asset_id,barcode,combination_key
        ) values(
          p_product_id,p.store_id,p.seller_id,v_sku,v_sku,nullif(btrim(vr->>'title'),''),
          v_price,v_compare,v_status,coalesce((vr->>'is_default')::boolean,false),
          v_image,nullif(btrim(vr->>'barcode'),''),v_key
        ) returning id into v_variant_id;
        insert into public.marketplace_inventory_levels(
          variant_id,on_hand,reserved,low_stock_threshold,version
        ) values(
          v_variant_id,coalesce((vr->>'on_hand')::integer,0),0,
          coalesce((vr->>'low_stock_threshold')::integer,0),0
        );
        insert into public.marketplace_inventory_movements(
          variant_id,seller_id,movement_type,delta,previous_on_hand,resulting_on_hand,
          reason,idempotency_key,request_fingerprint,created_by
        ) values(
          v_variant_id,p.seller_id,'initial',coalesce((vr->>'on_hand')::integer,0),0,
          coalesce((vr->>'on_hand')::integer,0),'Variant configuration',
          gen_random_uuid(),'configure:'||p_idempotency_key::text||':'||v_variant_id::text,v_user
        );
      else
        delete from public.marketplace_variant_option_values where variant_id=v_variant_id;
        update public.marketplace_product_variants set
          sku=v_sku,sku_normalized=v_sku,title=nullif(btrim(vr->>'title'),''),
          price=v_price,compare_at_price=v_compare,status=v_status,archived_at=null,
          is_default=coalesce((vr->>'is_default')::boolean,false),
          image_asset_id=v_image,barcode=nullif(btrim(vr->>'barcode'),''),
          combination_key=v_key
        where id=v_variant_id;
      end if;
    exception when unique_violation then
      if exists(select 1 from public.marketplace_product_variants
        where store_id=p.store_id and sku_normalized=v_sku and id<>coalesce(v_variant_id,gen_random_uuid()))
      then raise exception using errcode='23505',message='marketplace_sku_exists';
      else raise exception using errcode='23505',message='marketplace_duplicate_combination'; end if;
    end;
    insert into public.marketplace_variant_option_values(variant_id,option_value_id)
    select v_variant_id,unnest(v_ids);
    v_existing:=array_append(v_existing,v_variant_id);
    v_result:=v_result||jsonb_build_array(jsonb_build_object('id',v_variant_id,'sku',v_sku));
  end loop;
  if v_default_count<>1 then
    raise exception using errcode='22023',message='marketplace_exactly_one_default_required';
  end if;
  if (select count(*) from public.marketplace_product_variants
      where product_id=p_product_id and status<>'archived')<>v_variant_count then
    raise exception using errcode='22023',message='marketplace_variant_configuration_incomplete';
  end if;
  perform public.refresh_marketplace_product_projection(p_product_id);
  update public.marketplace_variant_configuration_requests set response=v_result
  where actor_id=v_user and idempotency_key=p_idempotency_key;
  return v_result;
end;
$$;

create or replace function public.create_marketplace_product(
  p_store_id uuid,p_category_id uuid,p_title text,p_description text,p_price numeric,
  p_brand text,p_compare_at_price numeric,p_asset_ids uuid[],p_stock integer,p_tags text[]
) returns uuid language plpgsql security definer set search_path=public
as $$
declare
  v_user uuid:=auth.uid(); v_product uuid; v_variant uuid; v_price numeric(20,8);
  v_compare numeric(20,8); v_count integer:=coalesce(array_length(p_asset_ids,1),0);
  v_urls text[]:='{}'::text[]; v_slug text; v_sku text;
begin
  if not public.marketplace_seller_is_approved(v_user) then
    raise exception using errcode='42501',message='approved_seller_required';
  end if;
  perform 1 from public.marketplace_stores
  where id=p_store_id and seller_id=v_user and status='active' for update;
  if not found then raise exception using errcode='42501',message='active_owned_store_required'; end if;
  select slug into v_slug from public.marketplace_categories where id=p_category_id and status='active';
  if v_slug is null then raise exception using errcode='22023',message='active_category_required'; end if;
  if char_length(btrim(coalesce(p_title,''))) not between 1 and 80
     or char_length(coalesce(p_description,''))>2000
     or p_stock is null or p_stock<0 or p_stock>1000000000 then
    raise exception using errcode='22023',message='invalid_product_fields';
  end if;
  v_price:=public.marketplace_normalize_price(p_price);
  if p_compare_at_price is not null then
    v_compare:=public.marketplace_normalize_price(p_compare_at_price);
    if v_compare<v_price then raise exception using errcode='22023',message='invalid_compare_at_price'; end if;
  end if;
  if v_count>4 or
    (select count(distinct id) from unnest(coalesce(p_asset_ids,'{}'::uuid[])) id)<>v_count then
    raise exception using errcode='22023',message='invalid_product_media';
  end if;
  if v_count>0 then
    perform id from public.media_assets where id=any(p_asset_ids) order by id for update;
    select array_agg(a.public_url order by ids.ordinality) into v_urls
    from unnest(p_asset_ids) with ordinality ids(id,ordinality)
    join public.media_assets a on a.id=ids.id
    where a.owner_id=v_user and a.status='ready' and a.visibility='public'
      and a.media_kind='image' and a.purpose='product_image' and a.public_url is not null;
    if coalesce(array_length(v_urls,1),0)<>v_count then
      raise exception using errcode='42501',message='product_media_not_ready_or_owned';
    end if;
  end if;
  insert into public.products(
    seller_id,store_id,title,description,price,currency,category,category_id,images,
    stock,status,tags,brand,compare_at_price,product_type,moderation_status,published_at
  ) values(
    v_user,p_store_id,btrim(p_title),coalesce(p_description,''),v_price,'BDAG',
    v_slug,p_category_id,v_urls,p_stock,'active',coalesce(p_tags,'{}'::text[]),
    nullif(btrim(p_brand),''),v_compare,'physical','approved',now()
  ) returning id into v_product;
  insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
  select p_asset_ids[i],'shop_product',v_product,'image',i-1
  from generate_subscripts(p_asset_ids,1) i;
  v_sku:=public.marketplace_auto_sku(v_product);
  insert into public.marketplace_product_variants(
    product_id,store_id,seller_id,sku,sku_normalized,price,compare_at_price,
    status,is_default,combination_key
  ) values(v_product,p_store_id,v_user,v_sku,v_sku,v_price,v_compare,'active',true,'')
  returning id into v_variant;
  insert into public.marketplace_inventory_levels(variant_id,on_hand)
  values(v_variant,p_stock);
  insert into public.marketplace_inventory_movements(
    variant_id,seller_id,movement_type,delta,previous_on_hand,resulting_on_hand,
    reason,idempotency_key,request_fingerprint,created_by
  ) values(
    v_variant,v_user,'initial',p_stock,0,p_stock,'Product creation',
    gen_random_uuid(),'initial:'||v_variant::text,v_user
  );
  perform public.refresh_marketplace_product_projection(v_product);
  return v_product;
end;
$$;

create or replace function public.update_marketplace_product(
  p_product_id uuid,p_category_id uuid,p_title text,p_description text,p_price numeric,
  p_brand text,p_compare_at_price numeric,p_stock integer,p_tags text[]
) returns void language plpgsql security definer set search_path=public
as $$
declare v_user uuid:=auth.uid(); v_slug text; v_default uuid; v_option_count integer;
  v_price numeric(20,8); v_compare numeric(20,8);
begin
  if not public.marketplace_seller_is_approved(v_user) then
    raise exception using errcode='42501',message='approved_seller_required';
  end if;
  perform 1 from public.products p join public.marketplace_stores s on s.id=p.store_id
  where p.id=p_product_id and p.seller_id=v_user and p.deleted_at is null
    and s.seller_id=v_user and s.status='active' for update of p;
  if not found then raise exception using errcode='42501',message='product_not_editable'; end if;
  select slug into v_slug from public.marketplace_categories where id=p_category_id and status='active';
  if v_slug is null or char_length(btrim(coalesce(p_title,''))) not between 1 and 80
     or char_length(coalesce(p_description,''))>2000 then
    raise exception using errcode='22023',message='invalid_product_fields';
  end if;
  select count(*) into v_option_count from public.marketplace_product_options where product_id=p_product_id;
  update public.products set category_id=p_category_id,category=v_slug,title=btrim(p_title),
    description=coalesce(p_description,''),brand=nullif(btrim(p_brand),''),
    tags=coalesce(p_tags,'{}'::text[]) where id=p_product_id;
  if v_option_count=0 then
    if p_stock is null or p_stock<0 or p_stock>1000000000 then
      raise exception using errcode='22023',message='invalid_product_stock';
    end if;
    v_price:=public.marketplace_normalize_price(p_price);
    if p_compare_at_price is not null then
      v_compare:=public.marketplace_normalize_price(p_compare_at_price);
      if v_compare<v_price then raise exception using errcode='22023',message='invalid_compare_at_price'; end if;
    end if;
    select id into v_default from public.marketplace_product_variants
    where product_id=p_product_id and is_default and status<>'archived' for update;
    update public.marketplace_product_variants set price=v_price,compare_at_price=v_compare where id=v_default;
    perform * from public.marketplace_mutate_inventory(
      v_default,p_stock,false,'Simple product edit',gen_random_uuid());
  else
    perform public.refresh_marketplace_product_projection(p_product_id);
  end if;
end;
$$;

create or replace function public.fetch_marketplace_product_detail(p_product_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public
as $$
declare v_public boolean; v_owner boolean; result jsonb;
begin
  select p.seller_id=auth.uid(),
    p.status='active' and p.moderation_status='approved' and p.deleted_at is null
      and p.product_type='physical' and public.marketplace_seller_is_approved(p.seller_id)
      and s.status='active' and c.status='active'
  into v_owner,v_public
  from public.products p join public.marketplace_stores s on s.id=p.store_id
  join public.marketplace_categories c on c.id=p.category_id where p.id=p_product_id;
  if not coalesce(v_owner,false) and not coalesce(v_public,false) then return null; end if;
  select jsonb_build_object(
    'product_id',p.id,
    'options',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',o.id,'name',o.name,'position',o.position,
        'values',(select coalesce(jsonb_agg(jsonb_build_object(
          'id',ov.id,'value',ov.value,'position',ov.position
        ) order by ov.position),'[]'::jsonb)
        from public.marketplace_product_option_values ov where ov.option_id=o.id)
      ) order by o.position)
      from public.marketplace_product_options o where o.product_id=p.id
    ),'[]'::jsonb),
    'variants',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',v.id,'product_id',v.product_id,
        'sku',case when v_owner then v.sku else null end,
        'title',v.title,'price',v.price,'compare_at_price',v.compare_at_price,
        'status',v.status,'is_default',v.is_default,'image_asset_id',v.image_asset_id,
        'image_url',a.public_url,
        'available_quantity',greatest(l.on_hand-l.reserved,0),
        'option_value_ids',coalesce((select jsonb_agg(x.option_value_id order by o.position)
          from public.marketplace_variant_option_values x
          join public.marketplace_product_option_values ov on ov.id=x.option_value_id
          join public.marketplace_product_options o on o.id=ov.option_id
          where x.variant_id=v.id),'[]'::jsonb)
      ) order by v.is_default desc,v.created_at)
      from public.marketplace_product_variants v
      join public.marketplace_inventory_levels l on l.variant_id=v.id
      left join public.media_assets a on a.id=v.image_asset_id and a.status='ready'
      where v.product_id=p.id and v.status<>'archived'
        and (v_owner or v.status='active')
    ),'[]'::jsonb)
  ) into result from public.products p where p.id=p_product_id;
  return result;
end;
$$;

create or replace function public.fetch_seller_product_inventory(p_product_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public
as $$
declare result jsonb;
begin
  if not exists(select 1 from public.products where id=p_product_id and seller_id=auth.uid()
    and deleted_at is null) then
    raise exception using errcode='42501',message='product_not_editable';
  end if;
  select jsonb_build_object(
    'detail',public.fetch_marketplace_product_detail(p_product_id),
    'inventory',coalesce((
      select jsonb_agg(jsonb_build_object(
        'variant_id',v.id,'on_hand',l.on_hand,'reserved',l.reserved,
        'available_quantity',l.on_hand-l.reserved,
        'low_stock_threshold',l.low_stock_threshold,'version',l.version
      ) order by v.is_default desc,v.created_at)
      from public.marketplace_product_variants v
      join public.marketplace_inventory_levels l on l.variant_id=v.id
      where v.product_id=p_product_id and v.status<>'archived'
    ),'[]'::jsonb),
    'movements',coalesce((
      select jsonb_agg(row_data order by created_at desc) from (
        select jsonb_build_object(
          'id',m.id,'variant_id',m.variant_id,'movement_type',m.movement_type,
          'delta',m.delta,'resulting_on_hand',m.resulting_on_hand,
          'reason',m.reason,'created_at',m.created_at
        ) row_data,m.created_at
        from public.marketplace_inventory_movements m
        join public.marketplace_product_variants v on v.id=m.variant_id
        where v.product_id=p_product_id and m.seller_id=auth.uid()
        order by m.created_at desc limit 50
      ) history
    ),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.marketplace_reject_movement_mutation()
returns trigger language plpgsql set search_path=public
as $$
begin
  raise exception using errcode='42501',message='marketplace_inventory_movements_append_only';
end;
$$;
create trigger marketplace_inventory_movements_append_only
before update or delete on public.marketplace_inventory_movements
for each row execute function public.marketplace_reject_movement_mutation();

alter table public.marketplace_product_options enable row level security;
alter table public.marketplace_product_option_values enable row level security;
alter table public.marketplace_product_variants enable row level security;
alter table public.marketplace_variant_option_values enable row level security;
alter table public.marketplace_inventory_levels enable row level security;
alter table public.marketplace_inventory_movements enable row level security;
alter table public.marketplace_variant_configuration_requests enable row level security;

create policy marketplace_options_read_public_or_owned
on public.marketplace_product_options for select to anon,authenticated
using(exists(
  select 1 from public.products p
  join public.marketplace_stores s on s.id=p.store_id
  join public.marketplace_categories c on c.id=p.category_id
  where p.id=product_id and (
    p.seller_id=auth.uid() or (
      p.status='active' and p.moderation_status='approved' and p.deleted_at is null
      and p.product_type='physical' and public.marketplace_seller_is_approved(p.seller_id)
      and s.status='active' and c.status='active'
    )
  )
));
create policy marketplace_option_values_read_public_or_owned
on public.marketplace_product_option_values for select to anon,authenticated
using(exists(
  select 1 from public.marketplace_product_options o
  join public.products p on p.id=o.product_id
  join public.marketplace_stores s on s.id=p.store_id
  join public.marketplace_categories c on c.id=p.category_id
  where o.id=option_id and (
    p.seller_id=auth.uid() or (
      p.status='active' and p.moderation_status='approved' and p.deleted_at is null
      and p.product_type='physical' and public.marketplace_seller_is_approved(p.seller_id)
      and s.status='active' and c.status='active'
    )
  )
));
create policy marketplace_variants_read_public_or_owned
on public.marketplace_product_variants for select to anon,authenticated
using(
  seller_id=auth.uid() or (
    status='active' and archived_at is null and exists(
      select 1 from public.products p
      join public.marketplace_stores s on s.id=p.store_id
      join public.marketplace_categories c on c.id=p.category_id
      where p.id=product_id and p.status='active' and p.moderation_status='approved'
        and p.deleted_at is null and p.product_type='physical'
        and public.marketplace_seller_is_approved(p.seller_id)
        and s.status='active' and c.status='active'
    )
  )
);
create policy marketplace_assignments_read_public_or_owned
on public.marketplace_variant_option_values for select to anon,authenticated
using(exists(
  select 1 from public.marketplace_product_variants v
  join public.products p on p.id=v.product_id
  join public.marketplace_stores s on s.id=p.store_id
  join public.marketplace_categories c on c.id=p.category_id
  where v.id=variant_id and (
    v.seller_id=auth.uid() or (
      v.status='active' and v.archived_at is null and p.status='active'
      and p.moderation_status='approved' and p.deleted_at is null
      and p.product_type='physical' and public.marketplace_seller_is_approved(p.seller_id)
      and s.status='active' and c.status='active'
    )
  )
));
create policy marketplace_inventory_levels_read_owned
on public.marketplace_inventory_levels for select to authenticated
using(exists(select 1 from public.marketplace_product_variants v
  where v.id=variant_id and v.seller_id=auth.uid()));
create policy marketplace_inventory_movements_read_owned
on public.marketplace_inventory_movements for select to authenticated
using(seller_id=auth.uid());

revoke all on public.marketplace_product_options,
  public.marketplace_product_option_values,public.marketplace_product_variants,
  public.marketplace_variant_option_values,public.marketplace_inventory_levels,
  public.marketplace_inventory_movements,public.marketplace_variant_configuration_requests
  from public,anon,authenticated;
grant select on public.marketplace_product_options,public.marketplace_product_option_values,
  public.marketplace_product_variants,public.marketplace_variant_option_values to anon,authenticated;
grant select on public.marketplace_inventory_levels,public.marketplace_inventory_movements to authenticated;
grant all on public.marketplace_product_options,public.marketplace_product_option_values,
  public.marketplace_product_variants,public.marketplace_variant_option_values,
  public.marketplace_inventory_levels,public.marketplace_inventory_movements to service_role;
grant all on public.marketplace_variant_configuration_requests to service_role;

-- Product price/stock stay projection-only for clients.
revoke insert,update,delete on public.products from anon,authenticated;
grant select(variant_price_max,active_variant_count) on public.products to anon,authenticated;
revoke execute on function public.create_product_with_media(text,text,numeric,text,uuid[],integer,text[])
  from public,anon,authenticated;

revoke all on function public.marketplace_normalize_sku(text) from public,anon,authenticated;
grant execute on function public.marketplace_normalize_sku(text) to service_role;
revoke all on function public.marketplace_auto_sku(uuid) from public,anon,authenticated;
grant execute on function public.marketplace_auto_sku(uuid) to service_role;
revoke all on function public.refresh_marketplace_product_projection(uuid) from public,anon,authenticated;
grant execute on function public.refresh_marketplace_product_projection(uuid) to service_role;
revoke all on function public.marketplace_assert_variant_owner(uuid) from public,anon,authenticated;
grant execute on function public.marketplace_assert_variant_owner(uuid) to service_role;
revoke all on function public.marketplace_validate_variant_image(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketplace_validate_variant_image(uuid,uuid) to service_role;
revoke all on function public.marketplace_mutate_inventory(uuid,integer,boolean,text,uuid)
  from public,anon,authenticated;
grant execute on function public.marketplace_mutate_inventory(uuid,integer,boolean,text,uuid)
  to service_role;

revoke all on function public.configure_marketplace_product_variants(uuid,jsonb,jsonb,uuid) from public,anon;
grant execute on function public.configure_marketplace_product_variants(uuid,jsonb,jsonb,uuid) to authenticated;
revoke all on function public.update_marketplace_product_variant(uuid,text,numeric,numeric,text,uuid,text,text)
  from public,anon;
grant execute on function public.update_marketplace_product_variant(uuid,text,numeric,numeric,text,uuid,text,text)
  to authenticated;
revoke all on function public.set_marketplace_default_variant(uuid) from public,anon;
grant execute on function public.set_marketplace_default_variant(uuid) to authenticated;
revoke all on function public.archive_marketplace_product_variant(uuid,uuid) from public,anon;
grant execute on function public.archive_marketplace_product_variant(uuid,uuid) to authenticated;
revoke all on function public.restore_marketplace_product_variant(uuid) from public,anon;
grant execute on function public.restore_marketplace_product_variant(uuid) to authenticated;
revoke all on function public.set_marketplace_variant_inventory(uuid,integer,text,uuid) from public,anon;
grant execute on function public.set_marketplace_variant_inventory(uuid,integer,text,uuid) to authenticated;
revoke all on function public.adjust_marketplace_variant_inventory(uuid,integer,text,uuid) from public,anon;
grant execute on function public.adjust_marketplace_variant_inventory(uuid,integer,text,uuid) to authenticated;
revoke all on function public.set_marketplace_variant_low_stock_threshold(uuid,integer) from public,anon;
grant execute on function public.set_marketplace_variant_low_stock_threshold(uuid,integer) to authenticated;
revoke all on function public.fetch_marketplace_product_detail(uuid) from public;
grant execute on function public.fetch_marketplace_product_detail(uuid) to anon,authenticated,service_role;
revoke all on function public.fetch_seller_product_inventory(uuid) from public,anon;
grant execute on function public.fetch_seller_product_inventory(uuid) to authenticated;
revoke all on function public.marketplace_reject_movement_mutation() from public,anon,authenticated;

-- Replaced MKT-A1 RPC signatures remain authenticated only.
revoke all on function public.create_marketplace_product(uuid,uuid,text,text,numeric,text,numeric,uuid[],integer,text[])
from public,anon;
grant execute on function public.create_marketplace_product(uuid,uuid,text,text,numeric,text,numeric,uuid[],integer,text[])
to authenticated;
revoke all on function public.update_marketplace_product(uuid,uuid,text,text,numeric,text,numeric,integer,text[])
from public,anon;
grant execute on function public.update_marketplace_product(uuid,uuid,text,text,numeric,text,numeric,integer,text[])
to authenticated;

notify pgrst,'reload schema';
commit;
