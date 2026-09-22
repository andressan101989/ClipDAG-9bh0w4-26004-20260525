begin;

create table private.business_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null
    references public.user_profiles(id) on delete cascade,
  display_name text not null,
  status text not null default 'active',
  origin text not null,
  creation_idempotency_key uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_accounts_display_name_chk
    check (
      display_name = btrim(display_name)
      and char_length(display_name) between 2 and 120
    ),
  constraint business_accounts_status_chk
    check (status in ('active', 'suspended', 'closed')),
  constraint business_accounts_origin_chk
    check (origin in ('advertiser_self_service', 'marketplace_backfill'))
);

create index business_accounts_owner_created_idx
  on private.business_accounts(owner_user_id, created_at desc, id desc);

create unique index business_accounts_owner_idempotency_uidx
  on private.business_accounts(owner_user_id, creation_idempotency_key)
  where creation_idempotency_key is not null;

create unique index business_accounts_marketplace_origin_uidx
  on private.business_accounts(owner_user_id)
  where origin = 'marketplace_backfill';

create table private.business_account_marketplace_links (
  business_account_id uuid not null
    references private.business_accounts(id) on delete cascade,
  marketplace_seller_user_id uuid not null
    references public.marketplace_sellers(user_id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (business_account_id, marketplace_seller_user_id),
  unique (marketplace_seller_user_id)
);

create table private.ad_accounts (
  id uuid primary key default gen_random_uuid(),
  business_account_id uuid not null
    references private.business_accounts(id) on delete cascade,
  name text not null,
  status text not null default 'active',
  billing_currency text not null default 'BDAG',
  is_default boolean not null default false,
  created_by uuid not null
    references public.user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_accounts_name_chk
    check (
      name = btrim(name)
      and char_length(name) between 2 and 120
    ),
  constraint ad_accounts_status_chk
    check (status in ('active', 'suspended', 'closed')),
  constraint ad_accounts_billing_currency_chk
    check (billing_currency = 'BDAG')
);

create index ad_accounts_business_created_idx
  on private.ad_accounts(business_account_id, created_at desc, id desc);

create index ad_accounts_created_by_idx
  on private.ad_accounts(created_by);

create unique index ad_accounts_one_default_per_business_uidx
  on private.ad_accounts(business_account_id)
  where is_default;

alter table private.business_accounts enable row level security;
alter table private.business_accounts force row level security;
alter table private.business_account_marketplace_links enable row level security;
alter table private.business_account_marketplace_links force row level security;
alter table private.ad_accounts enable row level security;
alter table private.ad_accounts force row level security;

create policy business_accounts_deny_clients
on private.business_accounts for all to anon, authenticated
using (false) with check (false);

create policy business_account_marketplace_links_deny_clients
on private.business_account_marketplace_links for all to anon, authenticated
using (false) with check (false);

create policy ad_accounts_deny_clients
on private.ad_accounts for all to anon, authenticated
using (false) with check (false);

revoke all on table private.business_accounts from public, anon, authenticated, service_role;
revoke all on table private.business_account_marketplace_links from public, anon, authenticated, service_role;
revoke all on table private.ad_accounts from public, anon, authenticated, service_role;

create or replace function private.business_account_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger business_accounts_touch_updated_at
before update on private.business_accounts
for each row execute function private.business_account_touch_updated_at();

create trigger ad_accounts_touch_updated_at
before update on private.ad_accounts
for each row execute function private.business_account_touch_updated_at();

create or replace function private.provision_marketplace_seller_business_account(
  p_seller_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller public.marketplace_sellers;
  v_business_account_id uuid;
begin
  select s.*
  into v_seller
  from public.marketplace_sellers as s
  where s.user_id = p_seller_user_id
  for update;

  if not found or v_seller.status <> 'approved' then
    return null;
  end if;

  select l.business_account_id
  into v_business_account_id
  from private.business_account_marketplace_links as l
  where l.marketplace_seller_user_id = p_seller_user_id;

  if v_business_account_id is null then
    insert into private.business_accounts (
      owner_user_id,
      display_name,
      status,
      origin,
      creation_idempotency_key
    )
    values (
      v_seller.user_id,
      btrim(v_seller.display_name),
      'active',
      'marketplace_backfill',
      null
    )
    on conflict (owner_user_id) where origin = 'marketplace_backfill'
    do nothing
    returning id into v_business_account_id;

    if v_business_account_id is null then
      select b.id
      into strict v_business_account_id
      from private.business_accounts as b
      where b.owner_user_id = v_seller.user_id
        and b.origin = 'marketplace_backfill';
    end if;

    insert into private.business_account_marketplace_links (
      business_account_id,
      marketplace_seller_user_id
    )
    values (v_business_account_id, v_seller.user_id)
    on conflict (marketplace_seller_user_id) do nothing;

    select l.business_account_id
    into strict v_business_account_id
    from private.business_account_marketplace_links as l
    where l.marketplace_seller_user_id = v_seller.user_id;
  end if;

  insert into private.ad_accounts (
    business_account_id,
    name,
    status,
    billing_currency,
    is_default,
    created_by
  )
  values (
    v_business_account_id,
    'Nelyon Ads',
    'active',
    'BDAG',
    true,
    v_seller.user_id
  )
  on conflict (business_account_id) where is_default
  do nothing;

  return v_business_account_id;
end;
$$;

create or replace function private.marketplace_seller_business_account_after_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' then
    perform private.provision_marketplace_seller_business_account(new.user_id);
  end if;
  return new;
end;
$$;

create trigger marketplace_sellers_provision_business_account
after insert or update of status on public.marketplace_sellers
for each row execute function private.marketplace_seller_business_account_after_approval();

create or replace function public.create_my_business_account(
  p_display_name text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_display_name text := btrim(p_display_name);
  v_business private.business_accounts;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'business_auth_required';
  end if;

  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'business_idempotency_key_required';
  end if;

  if v_display_name is null
    or char_length(v_display_name) < 2
    or char_length(v_display_name) > 120 then
    raise exception using errcode = '22023', message = 'business_display_name_invalid';
  end if;

  insert into private.business_accounts (
    owner_user_id,
    display_name,
    status,
    origin,
    creation_idempotency_key
  )
  values (
    v_actor,
    v_display_name,
    'active',
    'advertiser_self_service',
    p_idempotency_key
  )
  on conflict (owner_user_id, creation_idempotency_key)
    where creation_idempotency_key is not null
  do nothing
  returning * into v_business;

  if v_business.id is null then
    select b.*
    into strict v_business
    from private.business_accounts as b
    where b.owner_user_id = v_actor
      and b.creation_idempotency_key = p_idempotency_key;
  end if;

  insert into private.ad_accounts (
    business_account_id,
    name,
    status,
    billing_currency,
    is_default,
    created_by
  )
  values (
    v_business.id,
    'Nelyon Ads',
    'active',
    'BDAG',
    true,
    v_actor
  )
  on conflict (business_account_id) where is_default
  do nothing;

  return jsonb_build_object(
    'business_account_id', v_business.id,
    'display_name', v_business.display_name,
    'status', v_business.status,
    'access_type', 'owner',
    'marketplace', jsonb_build_object(
      'linked', false,
      'marketplace_seller_user_id', null,
      'seller_status', null
    ),
    'ad_accounts', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', a.id,
            'name', a.name,
            'status', a.status,
            'billing_currency', a.billing_currency,
            'is_default', a.is_default
          ) order by a.is_default desc, a.created_at, a.id
        ),
        '[]'::jsonb
      )
      from private.ad_accounts as a
      where a.business_account_id = v_business.id
    )
  );
end;
$$;

create or replace function public.get_my_advertiser_accounts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'business_auth_required';
  end if;

  return jsonb_build_object(
    'businesses', coalesce((
      with accessible as (
        select b.id as business_account_id, 'owner'::text as access_type
        from private.business_accounts as b
        where b.owner_user_id = v_actor

        union

        select l.business_account_id, 'member'::text
        from private.business_account_marketplace_links as l
        join public.marketplace_sellers as s
          on s.user_id = l.marketplace_seller_user_id
         and s.status = 'approved'
        join private.business_memberships as m
          on m.business_owner_id = l.marketplace_seller_user_id
         and m.member_user_id = v_actor
         and m.status = 'active'
        join private.business_membership_capabilities as mc
          on mc.membership_id = m.id
         and mc.capability_code in ('business.ads.read', 'business.ads.manage')
        where not exists (
          select 1
          from private.business_accounts as owned
          where owned.id = l.business_account_id
            and owned.owner_user_id = v_actor
        )
      )
      select jsonb_agg(
        jsonb_build_object(
          'business_account_id', b.id,
          'display_name', b.display_name,
          'status', b.status,
          'access_type', x.access_type,
          'marketplace', jsonb_build_object(
            'linked', l.marketplace_seller_user_id is not null,
            'marketplace_seller_user_id', l.marketplace_seller_user_id,
            'seller_status', s.status
          ),
          'ad_accounts', (
            select coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'id', a.id,
                  'name', a.name,
                  'status', a.status,
                  'billing_currency', a.billing_currency,
                  'is_default', a.is_default
                ) order by a.is_default desc, a.created_at, a.id
              ),
              '[]'::jsonb
            )
            from private.ad_accounts as a
            where a.business_account_id = b.id
          )
        ) order by b.created_at, b.id
      )
      from accessible as x
      join private.business_accounts as b
        on b.id = x.business_account_id
      left join private.business_account_marketplace_links as l
        on l.business_account_id = b.id
      left join public.marketplace_sellers as s
        on s.user_id = l.marketplace_seller_user_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function private.business_account_touch_updated_at() from public, anon, authenticated, service_role;
revoke all on function private.provision_marketplace_seller_business_account(uuid) from public, anon, authenticated, service_role;
revoke all on function private.marketplace_seller_business_account_after_approval() from public, anon, authenticated, service_role;
revoke all on function public.create_my_business_account(text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_my_advertiser_accounts() from public, anon, authenticated, service_role;

grant execute on function public.create_my_business_account(text, uuid) to authenticated;
grant execute on function public.get_my_advertiser_accounts() to authenticated;

do $$
declare
  v_seller record;
begin
  for v_seller in
    select user_id
    from public.marketplace_sellers
    where status = 'approved'
    order by user_id
  loop
    perform private.provision_marketplace_seller_business_account(v_seller.user_id);
  end loop;
end;
$$;

do $$
declare
  v_approved integer;
  v_linked integer;
  v_bad_defaults integer;
  v_duplicate_links integer;
begin
  select count(*)::integer
  into v_approved
  from public.marketplace_sellers
  where status = 'approved';

  select count(*)::integer
  into v_linked
  from private.business_account_marketplace_links as l
  join public.marketplace_sellers as s
    on s.user_id = l.marketplace_seller_user_id
  where s.status = 'approved';

  if v_linked <> v_approved then
    raise exception using message = 'advertiser_identity_link_count_mismatch';
  end if;

  select count(*)::integer
  into v_bad_defaults
  from (
    select l.business_account_id
    from private.business_account_marketplace_links as l
    left join private.ad_accounts as a
      on a.business_account_id = l.business_account_id
     and a.is_default
    group by l.business_account_id
    having count(a.id) <> 1
  ) as bad;

  if v_bad_defaults <> 0 then
    raise exception using message = 'advertiser_identity_default_account_mismatch';
  end if;

  select count(*)::integer
  into v_duplicate_links
  from (
    select marketplace_seller_user_id
    from private.business_account_marketplace_links
    group by marketplace_seller_user_id
    having count(*) > 1
  ) as duplicates;

  if v_duplicate_links <> 0 then
    raise exception using message = 'advertiser_identity_duplicate_seller_link';
  end if;
end;
$$;

commit;
