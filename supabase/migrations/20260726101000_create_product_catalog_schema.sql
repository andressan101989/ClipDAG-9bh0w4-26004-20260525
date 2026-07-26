begin;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null,
  title text not null,
  description text not null default '',
  price numeric not null,
  currency text not null default 'BDAG',
  category text not null default 'other',
  images text[] not null default '{}'::text[],
  stock integer not null default 0,
  status text not null default 'active',
  tags text[] not null default '{}'::text[],
  total_sales integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_seller_id_fkey
    foreign key (seller_id) references public.user_profiles(id) on delete cascade,
  constraint products_title_not_empty
    check (length(btrim(title)) > 0),
  constraint products_price_positive
    check (price > 0),
  constraint products_currency_bdag
    check (currency = 'BDAG'),
  constraint products_category_check
    check (category in ('digital','physical','art','music','clothing','other')),
  constraint products_status_check
    check (status in ('active','paused','sold_out','deleted')),
  constraint products_stock_nonnegative
    check (stock >= 0),
  constraint products_total_sales_nonnegative
    check (total_sales >= 0)
);

create index products_status_created_idx
  on public.products(status, created_at desc);
create index products_seller_created_idx
  on public.products(seller_id, created_at desc);
create index products_category_status_idx
  on public.products(category, status);

create or replace function public.set_product_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_product_updated_at();

create table public.product_saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint product_saves_user_product_key unique(user_id, product_id)
);

create index product_saves_product_idx
  on public.product_saves(product_id);

alter table public.products enable row level security;
alter table public.product_saves enable row level security;

create policy products_read_active_or_owned
  on public.products
  for select
  to anon, authenticated
  using (status = 'active' or seller_id = auth.uid());

create policy products_insert_owned_bdag
  on public.products
  for insert
  to authenticated
  with check (seller_id = auth.uid() and currency = 'BDAG');

create policy products_update_owned
  on public.products
  for update
  to authenticated
  using (seller_id = auth.uid())
  with check (seller_id = auth.uid() and currency = 'BDAG');

create policy product_saves_read_owned
  on public.product_saves
  for select
  to authenticated
  using (user_id = auth.uid());

create policy product_saves_insert_owned
  on public.product_saves
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy product_saves_delete_owned
  on public.product_saves
  for delete
  to authenticated
  using (user_id = auth.uid());

grant select on public.products to anon, authenticated;
grant insert, update on public.products to authenticated;
grant select, insert, delete on public.product_saves to authenticated;

revoke all on function public.set_product_updated_at() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
