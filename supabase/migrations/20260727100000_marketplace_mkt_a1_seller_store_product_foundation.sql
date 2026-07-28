begin;

-- MKT-A1 preserves every existing product, save and media link. Sellers that
-- published before approval existed are explicitly grandfathered as approved.

create or replace function public.marketplace_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.marketplace_sellers (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','suspended')),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 80),
  application_note text check (application_note is null or char_length(application_note) <= 1000),
  approved_at timestamptz,
  approved_by uuid references public.user_profiles(id) on delete set null,
  suspended_at timestamptz,
  suspension_reason text check (suspension_reason is null or char_length(suspension_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketplace_sellers_status_idx
  on public.marketplace_sellers(status, created_at desc);

drop trigger if exists marketplace_sellers_set_updated_at on public.marketplace_sellers;
create trigger marketplace_sellers_set_updated_at
before update on public.marketplace_sellers
for each row execute function public.marketplace_set_updated_at();

create table if not exists public.marketplace_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  parent_id uuid references public.marketplace_categories(id) on delete restrict,
  status text not null default 'active' check (status in ('active','inactive')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);

create index if not exists marketplace_categories_public_idx
  on public.marketplace_categories(status, sort_order, name);

drop trigger if exists marketplace_categories_set_updated_at on public.marketplace_categories;
create trigger marketplace_categories_set_updated_at
before update on public.marketplace_categories
for each row execute function public.marketplace_set_updated_at();

insert into public.marketplace_categories(id,slug,name,sort_order)
values
  ('10000000-0000-4000-8000-000000000001','digital','Digital',10),
  ('10000000-0000-4000-8000-000000000002','physical','Fisico',20),
  ('10000000-0000-4000-8000-000000000003','art','Arte',30),
  ('10000000-0000-4000-8000-000000000004','music','Musica',40),
  ('10000000-0000-4000-8000-000000000005','clothing','Ropa',50),
  ('10000000-0000-4000-8000-000000000006','other','Otros',60)
on conflict (slug) do update
set name=excluded.name,sort_order=excluded.sort_order;

create table if not exists public.marketplace_stores (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.marketplace_sellers(user_id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 100),
  slug text not null unique check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text check (description is null or char_length(description) <= 1000),
  logo_asset_id uuid references public.media_assets(id) on delete set null,
  banner_asset_id uuid references public.media_assets(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','active','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_stores_one_primary_per_seller unique(seller_id)
);

alter table public.media_asset_links
  drop constraint if exists media_asset_links_entity_type_check;
alter table public.media_asset_links
  add constraint media_asset_links_entity_type_check
  check (entity_type in (
    'user_profile','video_post','story','chat_message','shop_product',
    'exclusive_content','marketplace_store'
  ));

create index if not exists marketplace_stores_public_idx
  on public.marketplace_stores(status, created_at desc);

drop trigger if exists marketplace_stores_set_updated_at on public.marketplace_stores;
create trigger marketplace_stores_set_updated_at
before update on public.marketplace_stores
for each row execute function public.marketplace_set_updated_at();

-- Abort before changing scale if an existing value cannot fit numeric(20,8)
-- exactly. numeric(20,8) permits twelve integer digits.
do $$
begin
  if exists (
    select 1 from public.products
    where price <> round(price,8)
       or abs(price) >= 1000000000000
  ) then
    raise exception 'marketplace_product_price_incompatible_with_numeric_20_8';
  end if;
end;
$$;

alter table public.products
  alter column price type numeric(20,8) using price::numeric(20,8),
  add column if not exists store_id uuid references public.marketplace_stores(id) on delete restrict,
  add column if not exists category_id uuid references public.marketplace_categories(id) on delete restrict,
  add column if not exists brand text,
  add column if not exists compare_at_price numeric(20,8),
  add column if not exists product_type text not null default 'physical',
  add column if not exists moderation_status text not null default 'pending',
  add column if not exists moderation_reason text,
  add column if not exists published_at timestamptz,
  add column if not exists deleted_at timestamptz;

alter table public.products
  drop constraint if exists products_price_positive,
  add constraint products_price_positive check (price > 0 and price = round(price,8)),
  add constraint products_compare_price_check
    check (compare_at_price is null or (compare_at_price >= price and compare_at_price = round(compare_at_price,8))),
  add constraint products_brand_length_check
    check (brand is null or char_length(brand) <= 100),
  add constraint products_product_type_check
    check (product_type in ('physical','digital')),
  add constraint products_moderation_status_check
    check (moderation_status in ('pending','approved','rejected','suspended')),
  add constraint products_moderation_reason_length_check
    check (moderation_reason is null or char_length(moderation_reason) <= 500);

-- Grandfather existing publishers. Future applications retain the pending
-- default and require an explicit admin/service-role approval.
insert into public.marketplace_sellers(
  user_id,status,display_name,approved_at,created_at,updated_at
)
select distinct
  p.seller_id,
  'approved',
  left(coalesce(nullif(btrim(up.display_name),''),nullif(btrim(up.username),''),'Vendedor'),80),
  now(),
  min(p.created_at),
  now()
from public.products p
join public.user_profiles up on up.id=p.seller_id
group by p.seller_id,up.display_name,up.username
on conflict (user_id) do nothing;

insert into public.marketplace_stores(
  seller_id,name,slug,description,status,created_at,updated_at
)
select
  ms.user_id,
  left(ms.display_name,100),
  'store-' || replace(ms.user_id::text,'-',''),
  null,
  'active',
  ms.created_at,
  now()
from public.marketplace_sellers ms
where exists(select 1 from public.products p where p.seller_id=ms.user_id)
on conflict (seller_id) do nothing;

update public.products p
set store_id=s.id
from public.marketplace_stores s
where s.seller_id=p.seller_id and p.store_id is null;

update public.products p
set category_id=c.id
from public.marketplace_categories c
where c.slug=p.category and p.category_id is null;

update public.products
set category_id=(select id from public.marketplace_categories where slug='other')
where category_id is null;

update public.products
set moderation_status=case when status='active' then 'approved' else moderation_status end,
    published_at=case when status='active' then coalesce(published_at,created_at) else published_at end,
    deleted_at=case when status='deleted' then coalesce(deleted_at,updated_at,created_at) else deleted_at end;

alter table public.products
  alter column store_id set not null,
  alter column category_id set not null;

create index if not exists products_public_marketplace_idx
  on public.products(status,moderation_status,deleted_at,category_id,created_at desc);
create index if not exists products_store_dashboard_idx
  on public.products(store_id,status,updated_at desc);
create index if not exists products_seller_dashboard_idx
  on public.products(seller_id,deleted_at,updated_at desc);

create or replace function public.marketplace_actor_is_admin()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select coalesce(current_setting('request.jwt.claim.role',true),'')='service_role'
    or exists(
      select 1 from public.user_profiles
      where id=auth.uid() and is_admin=true
    );
$$;

create or replace function public.marketplace_seller_is_approved(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1 from public.marketplace_sellers
    where user_id=p_user_id and status='approved'
  );
$$;

create or replace function public.marketplace_normalize_slug(p_value text)
returns text
language sql
immutable
set search_path=public
as $$
  select trim(both '-' from regexp_replace(
    regexp_replace(lower(btrim(coalesce(p_value,''))),'[^a-z0-9]+','-','g'),
    '-+','-','g'
  ));
$$;

create or replace function public.marketplace_normalize_price(p_value numeric)
returns numeric(20,8)
language plpgsql
immutable
set search_path=public
as $$
declare v_price numeric(20,8);
begin
  if p_value is null or p_value<=0 or abs(p_value)>=1000000000000
     or p_value<>round(p_value,8) then
    raise exception using errcode='22023',message='invalid_marketplace_price';
  end if;
  v_price:=round(p_value,8)::numeric(20,8);
  if v_price<=0 then raise exception using errcode='22023',message='invalid_marketplace_price'; end if;
  return v_price;
end;
$$;

create or replace function public.apply_marketplace_seller(
  p_display_name text,
  p_application_note text default null
) returns public.marketplace_sellers
language plpgsql
security definer
set search_path=public
as $$
declare v_user_id uuid:=auth.uid(); v_row public.marketplace_sellers;
begin
  if v_user_id is null then raise exception using errcode='28000',message='not_authenticated'; end if;
  if char_length(btrim(coalesce(p_display_name,''))) not between 2 and 80 then
    raise exception using errcode='22023',message='invalid_seller_display_name';
  end if;
  if p_application_note is not null and char_length(p_application_note)>1000 then
    raise exception using errcode='22023',message='invalid_application_note';
  end if;
  insert into public.marketplace_sellers(user_id,status,display_name,application_note)
  values(v_user_id,'pending',btrim(p_display_name),nullif(btrim(p_application_note),''))
  returning * into v_row;
  return v_row;
exception when unique_violation then
  raise exception using errcode='23505',message='seller_application_exists';
end;
$$;

create or replace function public.update_marketplace_seller_application(
  p_display_name text,
  p_application_note text default null
) returns public.marketplace_sellers
language plpgsql
security definer
set search_path=public
as $$
declare v_user_id uuid:=auth.uid(); v_row public.marketplace_sellers;
begin
  if v_user_id is null then raise exception using errcode='28000',message='not_authenticated'; end if;
  if char_length(btrim(coalesce(p_display_name,''))) not between 2 and 80 then
    raise exception using errcode='22023',message='invalid_seller_display_name';
  end if;
  update public.marketplace_sellers
  set display_name=btrim(p_display_name),
      application_note=nullif(btrim(p_application_note),''),
      status=case when status='rejected' then 'pending' else status end
  where user_id=v_user_id and status in ('pending','rejected')
  returning * into v_row;
  if not found then raise exception using errcode='42501',message='seller_application_not_editable'; end if;
  return v_row;
end;
$$;

create or replace function public.set_marketplace_seller_status(
  p_user_id uuid,
  p_status text,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path=public
as $$
declare v_actor uuid:=auth.uid();
begin
  if not public.marketplace_actor_is_admin() then
    raise exception using errcode='42501',message='marketplace_admin_required';
  end if;
  if v_actor is not null and v_actor=p_user_id then
    raise exception using errcode='42501',message='seller_self_moderation_forbidden';
  end if;
  if p_status not in ('approved','rejected','suspended') then
    raise exception using errcode='22023',message='invalid_seller_status';
  end if;
  update public.marketplace_sellers
  set status=p_status,
      approved_at=case when p_status='approved' then now() else approved_at end,
      approved_by=case when p_status='approved' then v_actor else approved_by end,
      suspended_at=case when p_status='suspended' then now() else null end,
      suspension_reason=case when p_status in ('rejected','suspended') then left(nullif(btrim(p_reason),''),500) else null end
  where user_id=p_user_id;
  if not found then raise exception using errcode='P0002',message='seller_not_found'; end if;
  if p_status='suspended' then
    update public.marketplace_stores set status='suspended' where seller_id=p_user_id;
  end if;
end;
$$;

create or replace function public.approve_marketplace_seller(p_user_id uuid)
returns void language sql security definer set search_path=public
as $$ select public.set_marketplace_seller_status(p_user_id,'approved',null); $$;
create or replace function public.reject_marketplace_seller(p_user_id uuid,p_reason text default null)
returns void language sql security definer set search_path=public
as $$ select public.set_marketplace_seller_status(p_user_id,'rejected',p_reason); $$;
create or replace function public.suspend_marketplace_seller(p_user_id uuid,p_reason text)
returns void language sql security definer set search_path=public
as $$ select public.set_marketplace_seller_status(p_user_id,'suspended',p_reason); $$;

create or replace function public.restore_marketplace_seller(p_user_id uuid)
returns void
language plpgsql security definer set search_path=public
as $$
begin
  if not public.marketplace_actor_is_admin() then
    raise exception using errcode='42501',message='marketplace_admin_required';
  end if;
  if auth.uid() is not null and auth.uid()=p_user_id then
    raise exception using errcode='42501',message='seller_self_moderation_forbidden';
  end if;
  update public.marketplace_sellers
  set status='approved',approved_at=coalesce(approved_at,now()),approved_by=auth.uid(),
      suspended_at=null,suspension_reason=null
  where user_id=p_user_id and status='suspended';
  if not found then raise exception using errcode='P0002',message='suspended_seller_not_found'; end if;
end;
$$;

create or replace function public.create_marketplace_store(
  p_name text,p_slug text,p_description text default null
) returns uuid
language plpgsql security definer set search_path=public
as $$
declare v_user_id uuid:=auth.uid(); v_slug text; v_id uuid;
begin
  if not public.marketplace_seller_is_approved(v_user_id) then
    raise exception using errcode='42501',message='approved_seller_required';
  end if;
  if char_length(btrim(coalesce(p_name,''))) not between 2 and 100 then
    raise exception using errcode='22023',message='invalid_store_name';
  end if;
  if p_description is not null and char_length(p_description)>1000 then
    raise exception using errcode='22023',message='invalid_store_description';
  end if;
  v_slug:=public.marketplace_normalize_slug(p_slug);
  if char_length(v_slug) not between 3 and 80 then
    raise exception using errcode='22023',message='invalid_store_slug';
  end if;
  insert into public.marketplace_stores(seller_id,name,slug,description,status)
  values(v_user_id,btrim(p_name),v_slug,nullif(btrim(p_description),''),'active')
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception using errcode='23505',message='store_or_slug_exists';
end;
$$;

create or replace function public.update_marketplace_store(
  p_store_id uuid,p_name text,p_slug text,p_description text default null
) returns void
language plpgsql security definer set search_path=public
as $$
declare v_user_id uuid:=auth.uid(); v_slug text;
begin
  if not public.marketplace_seller_is_approved(v_user_id) then
    raise exception using errcode='42501',message='approved_seller_required';
  end if;
  if char_length(btrim(coalesce(p_name,''))) not between 2 and 100 then
    raise exception using errcode='22023',message='invalid_store_name';
  end if;
  if p_description is not null and char_length(p_description)>1000 then
    raise exception using errcode='22023',message='invalid_store_description';
  end if;
  v_slug:=public.marketplace_normalize_slug(p_slug);
  if char_length(v_slug) not between 3 and 80 then
    raise exception using errcode='22023',message='invalid_store_slug';
  end if;
  update public.marketplace_stores
  set name=btrim(p_name),slug=v_slug,description=nullif(btrim(p_description),'')
  where id=p_store_id and seller_id=v_user_id and status<>'suspended';
  if not found then raise exception using errcode='42501',message='store_not_editable'; end if;
exception when unique_violation then
  raise exception using errcode='23505',message='store_slug_exists';
end;
$$;

create or replace function public.set_marketplace_store_media(
  p_store_id uuid,p_logo_asset_id uuid default null,p_banner_asset_id uuid default null
) returns void
language plpgsql security definer set search_path=public
as $$
declare
  v_user_id uuid:=auth.uid();
  v_previous_logo uuid;
  v_previous_banner uuid;
begin
  if not public.marketplace_seller_is_approved(v_user_id) then
    raise exception using errcode='42501',message='approved_seller_required';
  end if;
  perform 1 from public.marketplace_stores
  where id=p_store_id and seller_id=v_user_id and status<>'suspended' for update;
  if not found then raise exception using errcode='42501',message='store_not_editable'; end if;
  if p_logo_asset_id is not null and not exists(
    select 1 from public.media_assets
    where id=p_logo_asset_id and owner_id=v_user_id and status='ready'
      and visibility='public' and media_kind='image' and purpose='store_logo'
  ) then raise exception using errcode='42501',message='store_logo_not_ready_or_owned'; end if;
  if p_banner_asset_id is not null and not exists(
    select 1 from public.media_assets
    where id=p_banner_asset_id and owner_id=v_user_id and status='ready'
      and visibility='public' and media_kind='image' and purpose='store_banner'
  ) then raise exception using errcode='42501',message='store_banner_not_ready_or_owned'; end if;
  select logo_asset_id,banner_asset_id into v_previous_logo,v_previous_banner
  from public.marketplace_stores where id=p_store_id;
  delete from public.media_asset_links
  where entity_type='marketplace_store' and entity_id=p_store_id
    and slot in ('logo','banner');
  if p_logo_asset_id is not null then
    insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
    values(p_logo_asset_id,'marketplace_store',p_store_id,'logo',0);
  end if;
  if p_banner_asset_id is not null then
    insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
    values(p_banner_asset_id,'marketplace_store',p_store_id,'banner',0);
  end if;
  update public.marketplace_stores
  set logo_asset_id=p_logo_asset_id,banner_asset_id=p_banner_asset_id
  where id=p_store_id;
  update public.media_assets
  set status='delete_pending',error_code='store_media_replaced',
      next_cleanup_attempt_at=coalesce(next_cleanup_attempt_at,now()),updated_at=now()
  where owner_id=v_user_id
    and id in (v_previous_logo,v_previous_banner)
    and id is distinct from p_logo_asset_id and id is distinct from p_banner_asset_id
    and not public.media_asset_has_valid_links(id);
end;
$$;

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
      )
  );
$$;

create or replace function public.create_marketplace_product(
  p_store_id uuid,p_category_id uuid,p_title text,p_description text,p_price numeric,
  p_brand text,p_compare_at_price numeric,p_asset_ids uuid[],p_stock integer,p_tags text[]
) returns uuid
language plpgsql security definer set search_path=public
as $$
declare
  v_user_id uuid:=auth.uid(); v_product_id uuid; v_price numeric(20,8);
  v_compare numeric(20,8); v_count integer:=coalesce(array_length(p_asset_ids,1),0);
  v_urls text[]:='{}'::text[]; v_category_slug text;
begin
  if not public.marketplace_seller_is_approved(v_user_id) then
    raise exception using errcode='42501',message='approved_seller_required';
  end if;
  perform 1 from public.marketplace_stores
  where id=p_store_id and seller_id=v_user_id and status='active' for update;
  if not found then raise exception using errcode='42501',message='active_owned_store_required'; end if;
  select slug into v_category_slug from public.marketplace_categories
  where id=p_category_id and status='active';
  if v_category_slug is null then raise exception using errcode='22023',message='active_category_required'; end if;
  if char_length(btrim(coalesce(p_title,''))) not between 1 and 80 then
    raise exception using errcode='22023',message='invalid_product_title';
  end if;
  if char_length(coalesce(p_description,''))>2000 then
    raise exception using errcode='22023',message='invalid_product_description';
  end if;
  if p_stock is null or p_stock<0 then raise exception using errcode='22023',message='invalid_product_stock'; end if;
  v_price:=public.marketplace_normalize_price(p_price);
  if p_compare_at_price is not null then
    v_compare:=public.marketplace_normalize_price(p_compare_at_price);
    if v_compare<v_price then raise exception using errcode='22023',message='invalid_compare_at_price'; end if;
  end if;
  if v_count>4 then raise exception using errcode='22023',message='invalid_media_count'; end if;
  if (select count(distinct id) from unnest(coalesce(p_asset_ids,'{}'::uuid[])) id)<>v_count then
    raise exception using errcode='22023',message='duplicate_asset';
  end if;
  if v_count>0 then
    perform id from public.media_assets where id=any(p_asset_ids) order by id for update;
    select array_agg(a.public_url order by ids.ordinality) into v_urls
    from unnest(p_asset_ids) with ordinality ids(id,ordinality)
    join public.media_assets a on a.id=ids.id
    where a.owner_id=v_user_id and a.status='ready' and a.visibility='public'
      and a.media_kind='image' and a.purpose='product_image' and a.public_url is not null;
    if coalesce(array_length(v_urls,1),0)<>v_count then
      raise exception using errcode='42501',message='product_media_not_ready_or_owned';
    end if;
  end if;
  insert into public.products(
    seller_id,store_id,title,description,price,currency,category,category_id,images,
    stock,status,tags,brand,compare_at_price,product_type,moderation_status,published_at
  ) values(
    v_user_id,p_store_id,btrim(p_title),coalesce(p_description,''),v_price,'BDAG',
    v_category_slug,p_category_id,v_urls,p_stock,'active',coalesce(p_tags,'{}'::text[]),
    nullif(btrim(p_brand),''),v_compare,'physical','approved',now()
  ) returning id into v_product_id;
  insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
  select p_asset_ids[i],'shop_product',v_product_id,'image',i-1
  from generate_subscripts(p_asset_ids,1) i;
  return v_product_id;
end;
$$;

create or replace function public.update_marketplace_product(
  p_product_id uuid,p_category_id uuid,p_title text,p_description text,p_price numeric,
  p_brand text,p_compare_at_price numeric,p_stock integer,p_tags text[]
) returns void
language plpgsql security definer set search_path=public
as $$
declare v_user_id uuid:=auth.uid(); v_price numeric(20,8); v_compare numeric(20,8); v_slug text;
begin
  if not public.marketplace_seller_is_approved(v_user_id) then
    raise exception using errcode='42501',message='approved_seller_required';
  end if;
  perform 1 from public.products p join public.marketplace_stores s on s.id=p.store_id
  where p.id=p_product_id and p.seller_id=v_user_id and p.deleted_at is null
    and s.seller_id=v_user_id and s.status='active' for update of p;
  if not found then raise exception using errcode='42501',message='product_not_editable'; end if;
  select slug into v_slug from public.marketplace_categories where id=p_category_id and status='active';
  if v_slug is null then raise exception using errcode='22023',message='active_category_required'; end if;
  if char_length(btrim(coalesce(p_title,''))) not between 1 and 80
    or char_length(coalesce(p_description,''))>2000 or p_stock is null or p_stock<0 then
    raise exception using errcode='22023',message='invalid_product_fields';
  end if;
  v_price:=public.marketplace_normalize_price(p_price);
  if p_compare_at_price is not null then
    v_compare:=public.marketplace_normalize_price(p_compare_at_price);
    if v_compare<v_price then raise exception using errcode='22023',message='invalid_compare_at_price'; end if;
  end if;
  update public.products
  set category_id=p_category_id,category=v_slug,title=btrim(p_title),
      description=coalesce(p_description,''),price=v_price,brand=nullif(btrim(p_brand),''),
      compare_at_price=v_compare,stock=p_stock,tags=coalesce(p_tags,'{}'::text[])
  where id=p_product_id;
end;
$$;

create or replace function public.set_marketplace_product_publication(
  p_product_id uuid,p_publish boolean
) returns void
language plpgsql security definer set search_path=public
as $$
declare v_user_id uuid:=auth.uid();
begin
  if not public.marketplace_seller_is_approved(v_user_id) then
    raise exception using errcode='42501',message='approved_seller_required';
  end if;
  update public.products p
  set status=case when p_publish then 'active' else 'paused' end,
      published_at=case when p_publish then coalesce(published_at,now()) else published_at end
  from public.marketplace_stores s,public.marketplace_categories c
  where p.id=p_product_id and p.seller_id=v_user_id and p.deleted_at is null
    and p.store_id=s.id and s.seller_id=v_user_id and s.status='active'
    and p.category_id=c.id and c.status='active'
    and p.moderation_status='approved';
  if not found then raise exception using errcode='42501',message='product_publication_not_allowed'; end if;
end;
$$;

create or replace function public.publish_marketplace_product(p_product_id uuid)
returns void language sql security definer set search_path=public
as $$ select public.set_marketplace_product_publication(p_product_id,true); $$;
create or replace function public.pause_marketplace_product(p_product_id uuid)
returns void language sql security definer set search_path=public
as $$ select public.set_marketplace_product_publication(p_product_id,false); $$;

create or replace function public.soft_delete_marketplace_product(p_product_id uuid)
returns void
language plpgsql security definer set search_path=public
as $$
declare v_user_id uuid:=auth.uid();
begin
  if not public.marketplace_seller_is_approved(v_user_id) then
    raise exception using errcode='42501',message='approved_seller_required';
  end if;
  update public.products set status='deleted',deleted_at=now()
  where id=p_product_id and seller_id=v_user_id and deleted_at is null;
  if not found then raise exception using errcode='42501',message='product_not_deletable'; end if;
end;
$$;

create or replace function public.replace_marketplace_product_media(
  p_product_id uuid,p_asset_ids uuid[]
) returns text[]
language plpgsql security definer set search_path=public
as $$
declare
  v_user_id uuid:=auth.uid(); v_count integer:=coalesce(array_length(p_asset_ids,1),0);
  v_urls text[]:='{}'::text[]; v_old_assets uuid[];
begin
  if not public.marketplace_seller_is_approved(v_user_id) then
    raise exception using errcode='42501',message='approved_seller_required';
  end if;
  perform 1 from public.products where id=p_product_id and seller_id=v_user_id and deleted_at is null for update;
  if not found then raise exception using errcode='42501',message='product_not_editable'; end if;
  if v_count>4 or (select count(distinct id) from unnest(coalesce(p_asset_ids,'{}'::uuid[])) id)<>v_count then
    raise exception using errcode='22023',message='invalid_product_media';
  end if;
  if v_count>0 then
    perform id from public.media_assets where id=any(p_asset_ids) order by id for update;
    select array_agg(a.public_url order by ids.ordinality) into v_urls
    from unnest(p_asset_ids) with ordinality ids(id,ordinality)
    join public.media_assets a on a.id=ids.id
    where a.owner_id=v_user_id and a.status='ready' and a.visibility='public'
      and a.media_kind='image' and a.purpose='product_image' and a.public_url is not null;
    if coalesce(array_length(v_urls,1),0)<>v_count then
      raise exception using errcode='42501',message='product_media_not_ready_or_owned';
    end if;
  end if;
  select coalesce(array_agg(asset_id),'{}'::uuid[]) into v_old_assets
  from public.media_asset_links
  where entity_type='shop_product' and entity_id=p_product_id and slot='image';
  delete from public.media_asset_links
  where entity_type='shop_product' and entity_id=p_product_id and slot='image';
  insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
  select p_asset_ids[i],'shop_product',p_product_id,'image',i-1
  from generate_subscripts(p_asset_ids,1) i;
  update public.products set images=v_urls where id=p_product_id;
  update public.media_assets a
  set status='delete_pending',error_code='product_media_replaced',
      next_cleanup_attempt_at=coalesce(next_cleanup_attempt_at,now()),updated_at=now()
  where a.id=any(v_old_assets) and not (a.id=any(coalesce(p_asset_ids,'{}'::uuid[])))
    and a.owner_id=v_user_id and a.status='ready'
    and not exists(select 1 from public.media_asset_links l where l.asset_id=a.id);
  return v_urls;
end;
$$;

create or replace function public.reorder_marketplace_product_media(p_product_id uuid,p_asset_ids uuid[])
returns text[] language sql security definer set search_path=public
as $$ select public.replace_marketplace_product_media(p_product_id,p_asset_ids); $$;

create or replace function public.remove_marketplace_product_media(p_product_id uuid,p_asset_id uuid)
returns text[]
language plpgsql security definer set search_path=public
as $$
declare v_assets uuid[];
begin
  select coalesce(array_agg(asset_id order by position),'{}'::uuid[]) into v_assets
  from public.media_asset_links
  where entity_type='shop_product' and entity_id=p_product_id and slot='image' and asset_id<>p_asset_id;
  return public.replace_marketplace_product_media(p_product_id,v_assets);
end;
$$;

-- Direct product mutation is closed. RPCs above derive ownership, category,
-- currency, price, moderation and media projection on the server.
revoke insert,update,delete on public.products from anon,authenticated;
drop policy if exists products_insert_owned_bdag on public.products;
drop policy if exists products_update_owned on public.products;
drop policy if exists products_read_active_or_owned on public.products;

create policy products_read_public_or_owned
on public.products for select to anon,authenticated
using (
  seller_id=auth.uid()
  or (
    status='active' and moderation_status='approved' and deleted_at is null
    and product_type='physical'
    and public.marketplace_seller_is_approved(seller_id)
    and exists(select 1 from public.marketplace_stores s where s.id=store_id and s.status='active')
    and exists(select 1 from public.marketplace_categories c where c.id=category_id and c.status='active')
  )
);

revoke select on public.products from anon,authenticated;
grant select (
  id,seller_id,store_id,title,description,price,currency,category,category_id,
  images,stock,status,tags,total_sales,created_at,updated_at,brand,
  compare_at_price,product_type,moderation_status,published_at,deleted_at
) on public.products to anon,authenticated;

alter table public.marketplace_sellers enable row level security;
alter table public.marketplace_stores enable row level security;
alter table public.marketplace_categories enable row level security;

create policy marketplace_sellers_read_own_or_admin
on public.marketplace_sellers for select to authenticated
using(user_id=auth.uid() or public.marketplace_actor_is_admin());
create policy marketplace_stores_read_public_or_owned
on public.marketplace_stores for select to anon,authenticated
using(
  seller_id=auth.uid()
  or (status='active' and public.marketplace_seller_is_approved(seller_id))
);
create policy marketplace_categories_read_active
on public.marketplace_categories for select to anon,authenticated
using(status='active' or public.marketplace_actor_is_admin());

revoke all on public.marketplace_sellers from public,anon,authenticated;
grant select on public.marketplace_sellers to authenticated;
revoke all on public.marketplace_stores from public,anon,authenticated;
grant select on public.marketplace_stores to anon,authenticated;
revoke all on public.marketplace_categories from public,anon,authenticated;
grant select on public.marketplace_categories to anon,authenticated;
grant all on public.marketplace_sellers,public.marketplace_stores,public.marketplace_categories to service_role;

-- Old catalog creator remains present for schema compatibility but is no
-- longer client-executable.
revoke execute on function public.create_product_with_media(text,text,numeric,text,uuid[],integer,text[])
from public,anon,authenticated;

revoke all on function public.marketplace_actor_is_admin() from public;
grant execute on function public.marketplace_actor_is_admin() to anon,authenticated,service_role;
revoke all on function public.marketplace_seller_is_approved(uuid) from public;
grant execute on function public.marketplace_seller_is_approved(uuid) to anon,authenticated,service_role;
revoke all on function public.marketplace_normalize_slug(text) from public,anon,authenticated;
grant execute on function public.marketplace_normalize_slug(text) to service_role;
revoke all on function public.marketplace_normalize_price(numeric) from public,anon,authenticated;
grant execute on function public.marketplace_normalize_price(numeric) to service_role;

revoke all on function public.apply_marketplace_seller(text,text) from public,anon;
grant execute on function public.apply_marketplace_seller(text,text) to authenticated;
revoke all on function public.update_marketplace_seller_application(text,text) from public,anon;
grant execute on function public.update_marketplace_seller_application(text,text) to authenticated;

revoke all on function public.set_marketplace_seller_status(uuid,text,text) from public,anon,authenticated;
grant execute on function public.set_marketplace_seller_status(uuid,text,text) to service_role;
revoke all on function public.approve_marketplace_seller(uuid) from public,anon;
grant execute on function public.approve_marketplace_seller(uuid) to authenticated,service_role;
revoke all on function public.reject_marketplace_seller(uuid,text) from public,anon;
grant execute on function public.reject_marketplace_seller(uuid,text) to authenticated,service_role;
revoke all on function public.suspend_marketplace_seller(uuid,text) from public,anon;
grant execute on function public.suspend_marketplace_seller(uuid,text) to authenticated,service_role;
revoke all on function public.restore_marketplace_seller(uuid) from public,anon;
grant execute on function public.restore_marketplace_seller(uuid) to authenticated,service_role;

revoke all on function public.create_marketplace_store(text,text,text) from public,anon;
grant execute on function public.create_marketplace_store(text,text,text) to authenticated;
revoke all on function public.update_marketplace_store(uuid,text,text,text) from public,anon;
grant execute on function public.update_marketplace_store(uuid,text,text,text) to authenticated;
revoke all on function public.set_marketplace_store_media(uuid,uuid,uuid) from public,anon;
grant execute on function public.set_marketplace_store_media(uuid,uuid,uuid) to authenticated;

revoke all on function public.create_marketplace_product(uuid,uuid,text,text,numeric,text,numeric,uuid[],integer,text[])
from public,anon;
grant execute on function public.create_marketplace_product(uuid,uuid,text,text,numeric,text,numeric,uuid[],integer,text[])
to authenticated;
revoke all on function public.update_marketplace_product(uuid,uuid,text,text,numeric,text,numeric,integer,text[])
from public,anon;
grant execute on function public.update_marketplace_product(uuid,uuid,text,text,numeric,text,numeric,integer,text[])
to authenticated;
revoke all on function public.set_marketplace_product_publication(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_marketplace_product_publication(uuid,boolean) to service_role;
revoke all on function public.publish_marketplace_product(uuid) from public,anon;
grant execute on function public.publish_marketplace_product(uuid) to authenticated;
revoke all on function public.pause_marketplace_product(uuid) from public,anon;
grant execute on function public.pause_marketplace_product(uuid) to authenticated;
revoke all on function public.soft_delete_marketplace_product(uuid) from public,anon;
grant execute on function public.soft_delete_marketplace_product(uuid) to authenticated;
revoke all on function public.replace_marketplace_product_media(uuid,uuid[]) from public,anon;
grant execute on function public.replace_marketplace_product_media(uuid,uuid[]) to authenticated;
revoke all on function public.reorder_marketplace_product_media(uuid,uuid[]) from public,anon;
grant execute on function public.reorder_marketplace_product_media(uuid,uuid[]) to authenticated;
revoke all on function public.remove_marketplace_product_media(uuid,uuid) from public,anon;
grant execute on function public.remove_marketplace_product_media(uuid,uuid) to authenticated;

revoke all on function public.marketplace_set_updated_at() from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
