begin;

do $$
begin
  if pg_catalog.to_regclass('private.business_accounts') is null
    or pg_catalog.to_regclass('private.ad_accounts') is null then
    raise exception 'ads_v2_b_foundation_required';
  end if;
  if pg_catalog.to_regclass('public.ad_campaigns') is not null then
    raise exception 'legacy_ad_campaigns_authority_conflict';
  end if;
  if (select count(*) from private.age_eligibility_policy) <> 1 then
    raise exception 'ads_age_policy_singleton_invalid';
  end if;
end;
$$;

create table private.advertising_campaigns (
  id uuid primary key default gen_random_uuid(),
  ad_account_id uuid not null
    references private.ad_accounts(id) on delete cascade,
  name text not null,
  objective text not null,
  status text not null default 'draft',
  created_by uuid not null
    references public.user_profiles(id),
  creation_idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint advertising_campaigns_name_chk check (
    name = btrim(name)
    and char_length(name) between 2 and 120
  ),
  constraint advertising_campaigns_objective_chk check (objective in (
    'awareness',
    'reach',
    'traffic',
    'engagement',
    'video_views',
    'profile_visits',
    'messages',
    'website_conversions',
    'app_promotion',
    'marketplace_sales'
  )),
  constraint advertising_campaigns_status_chk check (status in ('draft', 'archived')),
  constraint advertising_campaigns_archive_state_chk check (
    (status = 'draft' and archived_at is null)
    or (status = 'archived' and archived_at is not null)
  ),
  constraint advertising_campaigns_ad_account_idempotency_key
    unique (ad_account_id, creation_idempotency_key)
);

create index advertising_campaigns_ad_account_created_idx
  on private.advertising_campaigns(ad_account_id, created_at desc, id desc);

create index advertising_campaigns_created_by_idx
  on private.advertising_campaigns(created_by);

create table private.advertising_ad_sets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null
    references private.advertising_campaigns(id) on delete cascade,
  name text not null,
  status text not null default 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  creation_idempotency_key uuid not null,
  created_by uuid not null
    references public.user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advertising_ad_sets_name_chk check (
    name = btrim(name)
    and char_length(name) between 2 and 120
  ),
  constraint advertising_ad_sets_status_chk check (status in ('draft', 'archived')),
  constraint advertising_ad_sets_schedule_chk check (
    (starts_at is null and ends_at is null)
    or (starts_at is not null and ends_at is not null and starts_at < ends_at)
  ),
  constraint advertising_ad_sets_campaign_idempotency_key
    unique (campaign_id, creation_idempotency_key)
);

create index advertising_ad_sets_campaign_created_idx
  on private.advertising_ad_sets(campaign_id, created_at, id);

create index advertising_ad_sets_created_by_idx
  on private.advertising_ad_sets(created_by);

create table private.advertising_destinations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null
    references private.advertising_campaigns(id) on delete cascade,
  destination_type text not null,
  external_url text,
  target_user_id uuid references public.user_profiles(id),
  target_business_account_id uuid references private.business_accounts(id),
  target_product_id uuid references public.products(id),
  target_store_id uuid references public.marketplace_stores(id),
  status text not null default 'draft',
  creation_idempotency_key uuid not null,
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advertising_destinations_type_chk check (destination_type in (
    'external_url',
    'nelyon_profile',
    'business_account',
    'marketplace_product',
    'marketplace_store'
  )),
  constraint advertising_destinations_status_chk check (status in ('draft', 'archived')),
  constraint advertising_destinations_external_https_chk check (
    external_url is null
    or (
      external_url = btrim(external_url)
      and external_url ~* '^https://[^[:space:]]+$'
    )
  ),
  constraint advertising_destinations_target_xor_chk check (
    (destination_type = 'external_url'
      and external_url is not null
      and target_user_id is null
      and target_business_account_id is null
      and target_product_id is null
      and target_store_id is null)
    or
    (destination_type = 'nelyon_profile'
      and external_url is null
      and target_user_id is not null
      and target_business_account_id is null
      and target_product_id is null
      and target_store_id is null)
    or
    (destination_type = 'business_account'
      and external_url is null
      and target_user_id is null
      and target_business_account_id is not null
      and target_product_id is null
      and target_store_id is null)
    or
    (destination_type = 'marketplace_product'
      and external_url is null
      and target_user_id is null
      and target_business_account_id is null
      and target_product_id is not null
      and target_store_id is null)
    or
    (destination_type = 'marketplace_store'
      and external_url is null
      and target_user_id is null
      and target_business_account_id is null
      and target_product_id is null
      and target_store_id is not null)
  ),
  constraint advertising_destinations_campaign_idempotency_key
    unique (campaign_id, creation_idempotency_key)
);

create index advertising_destinations_campaign_created_idx
  on private.advertising_destinations(campaign_id, created_at, id);

create index advertising_destinations_created_by_idx
  on private.advertising_destinations(created_by);

create index advertising_destinations_target_user_idx
  on private.advertising_destinations(target_user_id)
  where target_user_id is not null;

create index advertising_destinations_target_business_idx
  on private.advertising_destinations(target_business_account_id)
  where target_business_account_id is not null;

create index advertising_destinations_target_product_idx
  on private.advertising_destinations(target_product_id)
  where target_product_id is not null;

create index advertising_destinations_target_store_idx
  on private.advertising_destinations(target_store_id)
  where target_store_id is not null;

alter table private.advertising_campaigns enable row level security;
alter table private.advertising_campaigns force row level security;
alter table private.advertising_ad_sets enable row level security;
alter table private.advertising_ad_sets force row level security;
alter table private.advertising_destinations enable row level security;
alter table private.advertising_destinations force row level security;

create policy advertising_campaigns_deny_clients
on private.advertising_campaigns for all to anon, authenticated
using (false) with check (false);

create policy advertising_ad_sets_deny_clients
on private.advertising_ad_sets for all to anon, authenticated
using (false) with check (false);

create policy advertising_destinations_deny_clients
on private.advertising_destinations for all to anon, authenticated
using (false) with check (false);

revoke all on table private.advertising_campaigns from public, anon, authenticated, service_role;
revoke all on table private.advertising_ad_sets from public, anon, authenticated, service_role;
revoke all on table private.advertising_destinations from public, anon, authenticated, service_role;

create or replace function private.advertising_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger advertising_campaigns_touch_updated_at
before update on private.advertising_campaigns
for each row execute function private.advertising_touch_updated_at();

create trigger advertising_ad_sets_touch_updated_at
before update on private.advertising_ad_sets
for each row execute function private.advertising_touch_updated_at();

create trigger advertising_destinations_touch_updated_at
before update on private.advertising_destinations
for each row execute function private.advertising_touch_updated_at();

create or replace function private.ads_actor_is_advertiser_age_eligible(
  p_actor uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
    from private.user_age_eligibility as e
    join private.age_eligibility_policy as p
      on p.singleton = true
    where p_actor is not null
      and e.user_id = p_actor
      and e.status = 'eligible'
      and e.age_band = 'age_18_plus'
      and e.minimum_age = p.minimum_age
      and e.policy_version = p.policy_version
      and p.creator_exclusive_minimum_age = 18
      and e.evaluated_at is not null
  ), false);
$$;

create or replace function private.ads_require_owned_draft_campaign(
  p_actor uuid,
  p_campaign_id uuid
)
returns table (
  campaign_id uuid,
  ad_account_id uuid,
  business_account_id uuid,
  owner_user_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select campaign.id, a.id, b.id, b.owner_user_id
  from private.advertising_campaigns as campaign
  join private.ad_accounts as a on a.id = campaign.ad_account_id
  join private.business_accounts as b on b.id = a.business_account_id
  where campaign.id = p_campaign_id
    and campaign.status = 'draft'
    and a.status = 'active'
    and b.status = 'active'
    and b.owner_user_id = p_actor
  for key share of campaign, a, b;

  if not found then
    raise exception using errcode = '42501', message = 'advertising_campaign_draft_access_denied';
  end if;
end;
$$;

create or replace function private.advertising_campaign_result(
  p_campaign_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', campaign.id,
    'ad_account_id', campaign.ad_account_id,
    'business_account_id', a.business_account_id,
    'name', campaign.name,
    'objective', campaign.objective,
    'status', campaign.status,
    'created_at', campaign.created_at,
    'updated_at', campaign.updated_at,
    'archived_at', campaign.archived_at,
    'ad_sets', (
      select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', ad_set.id,
          'name', ad_set.name,
          'status', ad_set.status,
          'starts_at', ad_set.starts_at,
          'ends_at', ad_set.ends_at,
          'created_at', ad_set.created_at
        ) order by ad_set.created_at, ad_set.id
      ), '[]'::jsonb)
      from private.advertising_ad_sets as ad_set
      where ad_set.campaign_id = campaign.id
    ),
    'destinations', (
      select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', destination.id,
          'destination_type', destination.destination_type,
          'external_url', destination.external_url,
          'target_user_id', destination.target_user_id,
          'target_business_account_id', destination.target_business_account_id,
          'target_product_id', destination.target_product_id,
          'target_store_id', destination.target_store_id,
          'status', destination.status,
          'created_at', destination.created_at
        ) order by destination.created_at, destination.id
      ), '[]'::jsonb)
      from private.advertising_destinations as destination
      where destination.campaign_id = campaign.id
    )
  )
  from private.advertising_campaigns as campaign
  join private.ad_accounts as a on a.id = campaign.ad_account_id
  where campaign.id = p_campaign_id;
$$;

create or replace function public.create_my_advertising_campaign_draft(
  p_ad_account_id uuid,
  p_name text,
  p_objective text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_name text := btrim(p_name);
  v_objective text := lower(btrim(p_objective));
  v_campaign private.advertising_campaigns;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'advertising_auth_required';
  end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_actor) then
    raise exception using errcode = '42501', message = 'advertising_adult_eligibility_required';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'advertising_idempotency_key_required';
  end if;
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception using errcode = '22023', message = 'advertising_campaign_name_invalid';
  end if;
  if v_objective is null or v_objective not in (
    'awareness', 'reach', 'traffic', 'engagement', 'video_views',
    'profile_visits', 'messages', 'website_conversions',
    'app_promotion', 'marketplace_sales'
  ) then
    raise exception using errcode = '22023', message = 'advertising_campaign_objective_invalid';
  end if;

  perform 1
  from private.ad_accounts as a
  join private.business_accounts as b on b.id = a.business_account_id
  where a.id = p_ad_account_id
    and a.status = 'active'
    and b.status = 'active'
    and b.owner_user_id = v_actor
  for key share of a, b;

  if not found then
    raise exception using errcode = '42501', message = 'advertising_ad_account_access_denied';
  end if;

  insert into private.advertising_campaigns (
    ad_account_id,
    name,
    objective,
    status,
    created_by,
    creation_idempotency_key
  ) values (
    p_ad_account_id,
    v_name,
    v_objective,
    'draft',
    v_actor,
    p_idempotency_key
  )
  on conflict (ad_account_id, creation_idempotency_key) do nothing
  returning * into v_campaign;

  if v_campaign.id is null then
    select campaign.*
    into strict v_campaign
    from private.advertising_campaigns as campaign
    where campaign.ad_account_id = p_ad_account_id
      and campaign.creation_idempotency_key = p_idempotency_key;

    if v_campaign.name is distinct from v_name
      or v_campaign.objective is distinct from v_objective
      or v_campaign.created_by is distinct from v_actor then
      raise exception using errcode = '23505', message = 'advertising_campaign_idempotency_conflict';
    end if;
  end if;

  return private.advertising_campaign_result(v_campaign.id);
end;
$$;

create or replace function public.create_my_advertising_ad_set_draft(
  p_campaign_id uuid,
  p_name text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_name text := btrim(p_name);
  v_context record;
  v_ad_set private.advertising_ad_sets;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'advertising_auth_required';
  end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_actor) then
    raise exception using errcode = '42501', message = 'advertising_adult_eligibility_required';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'advertising_idempotency_key_required';
  end if;
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception using errcode = '22023', message = 'advertising_ad_set_name_invalid';
  end if;
  if not (
    (p_starts_at is null and p_ends_at is null)
    or (p_starts_at is not null and p_ends_at is not null and p_starts_at < p_ends_at)
  ) then
    raise exception using errcode = '22023', message = 'advertising_ad_set_schedule_invalid';
  end if;

  select * into strict v_context
  from private.ads_require_owned_draft_campaign(v_actor, p_campaign_id);

  insert into private.advertising_ad_sets (
    campaign_id,
    name,
    status,
    starts_at,
    ends_at,
    creation_idempotency_key,
    created_by
  ) values (
    p_campaign_id,
    v_name,
    'draft',
    p_starts_at,
    p_ends_at,
    p_idempotency_key,
    v_actor
  )
  on conflict (campaign_id, creation_idempotency_key) do nothing
  returning * into v_ad_set;

  if v_ad_set.id is null then
    select ad_set.*
    into strict v_ad_set
    from private.advertising_ad_sets as ad_set
    where ad_set.campaign_id = p_campaign_id
      and ad_set.creation_idempotency_key = p_idempotency_key;

    if v_ad_set.name is distinct from v_name
      or v_ad_set.starts_at is distinct from p_starts_at
      or v_ad_set.ends_at is distinct from p_ends_at
      or v_ad_set.created_by is distinct from v_actor then
      raise exception using errcode = '23505', message = 'advertising_ad_set_idempotency_conflict';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_ad_set.id,
    'campaign_id', v_ad_set.campaign_id,
    'name', v_ad_set.name,
    'status', v_ad_set.status,
    'starts_at', v_ad_set.starts_at,
    'ends_at', v_ad_set.ends_at,
    'created_at', v_ad_set.created_at
  );
end;
$$;

create or replace function public.create_my_advertising_destination_draft(
  p_campaign_id uuid,
  p_destination_type text,
  p_idempotency_key uuid,
  p_external_url text default null,
  p_target_user_id uuid default null,
  p_target_business_account_id uuid default null,
  p_target_product_id uuid default null,
  p_target_store_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_destination_type text := lower(btrim(p_destination_type));
  v_external_url text := btrim(p_external_url);
  v_context record;
  v_destination private.advertising_destinations;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'advertising_auth_required';
  end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_actor) then
    raise exception using errcode = '42501', message = 'advertising_adult_eligibility_required';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'advertising_idempotency_key_required';
  end if;

  select * into strict v_context
  from private.ads_require_owned_draft_campaign(v_actor, p_campaign_id);

  case v_destination_type
    when 'external_url' then
      if v_external_url is null
        or v_external_url !~* '^https://[^[:space:]]+$'
        or p_target_user_id is not null
        or p_target_business_account_id is not null
        or p_target_product_id is not null
        or p_target_store_id is not null then
        raise exception using errcode = '22023', message = 'advertising_destination_external_url_invalid';
      end if;
    when 'nelyon_profile' then
      if p_target_user_id is distinct from v_actor
        or v_external_url is not null
        or p_target_business_account_id is not null
        or p_target_product_id is not null
        or p_target_store_id is not null then
        raise exception using errcode = '42501', message = 'advertising_destination_profile_access_denied';
      end if;
    when 'business_account' then
      if p_target_business_account_id is distinct from v_context.business_account_id
        or v_external_url is not null
        or p_target_user_id is not null
        or p_target_product_id is not null
        or p_target_store_id is not null then
        raise exception using errcode = '42501', message = 'advertising_destination_business_access_denied';
      end if;
    when 'marketplace_product' then
      if v_external_url is not null
        or p_target_user_id is not null
        or p_target_business_account_id is not null
        or p_target_product_id is null
        or p_target_store_id is not null
        or not exists (
          select 1
          from private.business_account_marketplace_links as l
          join public.marketplace_sellers as seller
            on seller.user_id = l.marketplace_seller_user_id
           and seller.status = 'approved'
          join public.products as p
            on p.id = p_target_product_id
           and p.seller_id = l.marketplace_seller_user_id
           and p.deleted_at is null
          join public.marketplace_stores as s
            on s.id = p.store_id
           and s.seller_id = l.marketplace_seller_user_id
          where l.business_account_id = v_context.business_account_id
        ) then
        raise exception using errcode = '42501', message = 'advertising_destination_marketplace_product_access_denied';
      end if;
    when 'marketplace_store' then
      if v_external_url is not null
        or p_target_user_id is not null
        or p_target_business_account_id is not null
        or p_target_product_id is not null
        or p_target_store_id is null
        or not exists (
          select 1
          from private.business_account_marketplace_links as l
          join public.marketplace_sellers as seller
            on seller.user_id = l.marketplace_seller_user_id
           and seller.status = 'approved'
          join public.marketplace_stores as s
            on s.id = p_target_store_id
           and s.seller_id = l.marketplace_seller_user_id
          where l.business_account_id = v_context.business_account_id
        ) then
        raise exception using errcode = '42501', message = 'advertising_destination_marketplace_store_access_denied';
      end if;
    else
      raise exception using errcode = '22023', message = 'advertising_destination_type_invalid';
  end case;

  insert into private.advertising_destinations (
    campaign_id,
    destination_type,
    external_url,
    target_user_id,
    target_business_account_id,
    target_product_id,
    target_store_id,
    status,
    creation_idempotency_key,
    created_by
  ) values (
    p_campaign_id,
    v_destination_type,
    v_external_url,
    p_target_user_id,
    p_target_business_account_id,
    p_target_product_id,
    p_target_store_id,
    'draft',
    p_idempotency_key,
    v_actor
  )
  on conflict (campaign_id, creation_idempotency_key) do nothing
  returning * into v_destination;

  if v_destination.id is null then
    select destination.*
    into strict v_destination
    from private.advertising_destinations as destination
    where destination.campaign_id = p_campaign_id
      and destination.creation_idempotency_key = p_idempotency_key;

    if v_destination.destination_type is distinct from v_destination_type
      or v_destination.external_url is distinct from v_external_url
      or v_destination.target_user_id is distinct from p_target_user_id
      or v_destination.target_business_account_id is distinct from p_target_business_account_id
      or v_destination.target_product_id is distinct from p_target_product_id
      or v_destination.target_store_id is distinct from p_target_store_id
      or v_destination.created_by is distinct from v_actor then
      raise exception using errcode = '23505', message = 'advertising_destination_idempotency_conflict';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_destination.id,
    'campaign_id', v_destination.campaign_id,
    'destination_type', v_destination.destination_type,
    'external_url', v_destination.external_url,
    'target_user_id', v_destination.target_user_id,
    'target_business_account_id', v_destination.target_business_account_id,
    'target_product_id', v_destination.target_product_id,
    'target_store_id', v_destination.target_store_id,
    'status', v_destination.status,
    'created_at', v_destination.created_at
  );
end;
$$;

create or replace function public.get_my_advertising_campaigns()
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
    raise exception using errcode = '42501', message = 'advertising_auth_required';
  end if;

  return pg_catalog.jsonb_build_object(
    'campaigns', coalesce((
      with visible as (
        select
          campaign.id,
          campaign.name,
          campaign.status,
          campaign.objective,
          campaign.created_at,
          campaign.ad_account_id,
          a.business_account_id,
          'ads_v2'::text as authority,
          'ads_v2'::text as write_authority
        from private.advertising_campaigns as campaign
        join private.ad_accounts as a on a.id = campaign.ad_account_id
        join private.business_accounts as b on b.id = a.business_account_id
        where b.owner_user_id = v_actor

        union all

        select
          legacy.id,
          legacy.name,
          legacy.status,
          'marketplace_sales'::text,
          legacy.created_at,
          a.id,
          l.business_account_id,
          'marketplace_legacy'::text,
          'marketplace_legacy'::text
        from public.marketplace_ad_campaigns as legacy
        left join private.business_account_marketplace_links as l
          on l.marketplace_seller_user_id = legacy.seller_id
        left join private.ad_accounts as a
          on a.business_account_id = l.business_account_id
         and a.is_default
        where legacy.seller_id = v_actor
          or exists (
            select 1
            from private.business_memberships as membership
            join private.business_membership_capabilities as capability
              on capability.membership_id = membership.id
             and capability.capability_code in ('business.ads.read', 'business.ads.manage')
            where membership.business_owner_id = legacy.seller_id
              and membership.member_user_id = v_actor
              and membership.status = 'active'
          )
      )
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', visible.id,
        'name', visible.name,
        'status', visible.status,
        'objective', visible.objective,
        'ad_account_id', visible.ad_account_id,
        'business_account_id', visible.business_account_id,
        'authority', visible.authority,
        'write_authority', visible.write_authority,
        'created_at', visible.created_at
      ) order by visible.created_at desc, visible.id desc)
      from visible
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_my_advertising_campaign(
  p_campaign_id uuid,
  p_authority text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_authority text := lower(btrim(p_authority));
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'advertising_auth_required';
  end if;

  if v_authority = 'ads_v2' then
    select private.advertising_campaign_result(campaign.id)
      || pg_catalog.jsonb_build_object(
        'authority', 'ads_v2',
        'write_authority', 'ads_v2'
      )
    into v_result
    from private.advertising_campaigns as campaign
    join private.ad_accounts as a on a.id = campaign.ad_account_id
    join private.business_accounts as b on b.id = a.business_account_id
    where campaign.id = p_campaign_id
      and b.owner_user_id = v_actor;
  elsif v_authority = 'marketplace_legacy' then
    select pg_catalog.jsonb_build_object(
      'id', legacy.id,
      'name', legacy.name,
      'status', legacy.status,
      'objective', 'marketplace_sales',
      'authority', 'marketplace_legacy',
      'write_authority', 'marketplace_legacy',
      'created_at', legacy.created_at,
      'updated_at', legacy.updated_at,
      'destination', pg_catalog.jsonb_build_object(
        'destination_type', 'marketplace_product',
        'target_product_id', legacy.product_id,
        'target_store_id', legacy.store_id
      )
    )
    into v_result
    from public.marketplace_ad_campaigns as legacy
    where legacy.id = p_campaign_id
      and (
        legacy.seller_id = v_actor
        or exists (
          select 1
          from private.business_memberships as membership
          join private.business_membership_capabilities as capability
            on capability.membership_id = membership.id
           and capability.capability_code in ('business.ads.read', 'business.ads.manage')
          where membership.business_owner_id = legacy.seller_id
            and membership.member_user_id = v_actor
            and membership.status = 'active'
        )
      );
  else
    raise exception using errcode = '22023', message = 'advertising_campaign_authority_invalid';
  end if;

  if v_result is null then
    raise exception using errcode = '42501', message = 'advertising_campaign_access_denied';
  end if;

  return v_result;
end;
$$;

revoke all on function private.advertising_touch_updated_at() from public, anon, authenticated, service_role;
revoke all on function private.ads_actor_is_advertiser_age_eligible(uuid) from public, anon, authenticated, service_role;
revoke all on function private.ads_require_owned_draft_campaign(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.advertising_campaign_result(uuid) from public, anon, authenticated, service_role;

revoke all on function public.create_my_advertising_campaign_draft(uuid, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_my_advertising_ad_set_draft(uuid, text, timestamptz, timestamptz, uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_my_advertising_destination_draft(uuid, text, uuid, text, uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_my_advertising_campaigns() from public, anon, authenticated, service_role;
revoke all on function public.get_my_advertising_campaign(uuid, text) from public, anon, authenticated, service_role;

grant execute on function public.create_my_advertising_campaign_draft(uuid, text, text, uuid) to authenticated;
grant execute on function public.create_my_advertising_ad_set_draft(uuid, text, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.create_my_advertising_destination_draft(uuid, text, uuid, text, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.get_my_advertising_campaigns() to authenticated;
grant execute on function public.get_my_advertising_campaign(uuid, text) to authenticated;

do $$
begin
  if exists (select 1 from private.advertising_campaigns)
    or exists (select 1 from private.advertising_ad_sets)
    or exists (select 1 from private.advertising_destinations) then
    raise exception 'ads_v2_c_initial_state_not_empty';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
