begin;

-- CREATOR-PREMIUM-B1
-- Canonical private metadata and entitlement foundation only.
-- No media originals, public publishing authority, purchase authority,
-- subscription charging, refund processing, or ledger movement is introduced.

create table private.creator_premium_contents (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null,
  client_request_id uuid null,
  title text not null,
  description text not null default '',
  content_kind text not null,
  access_mode text not null,
  lifecycle_status text not null default 'draft',
  published_at timestamptz null,
  quarantined_at timestamptz null,
  removed_at timestamptz null,
  deleted_at timestamptz null,
  removal_reason text null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint creator_premium_contents_creator_fkey
    foreign key (creator_id) references public.user_profiles(id)
    on update restrict on delete restrict,
  constraint creator_premium_contents_id_creator_key unique (id, creator_id),
  constraint creator_premium_contents_title_check
    check (title = pg_catalog.btrim(title) and pg_catalog.char_length(title) between 1 and 120),
  constraint creator_premium_contents_description_check
    check (pg_catalog.char_length(description) <= 2000),
  constraint creator_premium_contents_kind_check
    check (content_kind in ('image','video')),
  constraint creator_premium_contents_access_mode_check
    check (access_mode in ('purchase','subscription','purchase_or_subscription')),
  constraint creator_premium_contents_lifecycle_check
    check (lifecycle_status in ('draft','pending_review','published','quarantined','removed','deleted')),
  constraint creator_premium_contents_reason_check
    check (removal_reason is null or pg_catalog.char_length(pg_catalog.btrim(removal_reason)) between 1 and 500),
  constraint creator_premium_contents_timestamps_check
    check (updated_at >= created_at),
  constraint creator_premium_contents_state_check check (
    (lifecycle_status = 'draft'
      and published_at is null and quarantined_at is null and removed_at is null and deleted_at is null)
    or (lifecycle_status = 'pending_review'
      and published_at is null and quarantined_at is null and removed_at is null and deleted_at is null)
    or (lifecycle_status = 'published'
      and published_at is not null and quarantined_at is null and removed_at is null and deleted_at is null)
    or (lifecycle_status = 'quarantined'
      and quarantined_at is not null and removed_at is null and deleted_at is null)
    or (lifecycle_status = 'removed'
      and removed_at is not null and deleted_at is null)
    or (lifecycle_status = 'deleted' and deleted_at is not null)
  )
);

create unique index creator_premium_contents_creator_request_uidx
  on private.creator_premium_contents(creator_id, client_request_id)
  where client_request_id is not null;
create index creator_premium_contents_catalog_idx
  on private.creator_premium_contents(creator_id, published_at desc, id desc)
  where lifecycle_status = 'published';
create index creator_premium_contents_owner_idx
  on private.creator_premium_contents(creator_id, created_at desc, id desc);

create table private.creator_premium_offer_versions (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null,
  creator_id uuid not null,
  version integer not null,
  price_bdag numeric(20,8) not null,
  currency text not null default 'BDAG',
  status text not null default 'draft',
  activated_at timestamptz null,
  retired_at timestamptz null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint creator_premium_offer_versions_content_fkey
    foreign key (content_id, creator_id)
    references private.creator_premium_contents(id, creator_id)
    on update restrict on delete restrict,
  constraint creator_premium_offer_versions_id_content_creator_key
    unique (id, content_id, creator_id),
  constraint creator_premium_offer_versions_number_key unique (content_id, version),
  constraint creator_premium_offer_versions_number_check check (version > 0),
  constraint creator_premium_offer_versions_price_check
    check (price_bdag > 0 and price_bdag = pg_catalog.round(price_bdag, 8)),
  constraint creator_premium_offer_versions_currency_check check (currency = 'BDAG'),
  constraint creator_premium_offer_versions_status_check
    check (status in ('draft','active','retired')),
  constraint creator_premium_offer_versions_state_check check (
    (status = 'draft' and activated_at is null and retired_at is null)
    or (status = 'active' and activated_at is not null and retired_at is null)
    or (status = 'retired' and activated_at is not null and retired_at is not null and retired_at >= activated_at)
  ),
  constraint creator_premium_offer_versions_timestamps_check check (updated_at >= created_at)
);

create unique index creator_premium_offer_versions_one_active_idx
  on private.creator_premium_offer_versions(content_id)
  where status = 'active';
create index creator_premium_offer_versions_creator_idx
  on private.creator_premium_offer_versions(creator_id, content_id, version desc);
create index creator_premium_offer_versions_content_creator_idx
  on private.creator_premium_offer_versions(content_id, creator_id);

create table private.creator_premium_plans (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null,
  plan_key text not null,
  version integer not null,
  name text not null,
  description text not null default '',
  price_bdag numeric(20,8) not null,
  currency text not null default 'BDAG',
  status text not null default 'draft',
  activated_at timestamptz null,
  retired_at timestamptz null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint creator_premium_plans_creator_fkey
    foreign key (creator_id) references public.user_profiles(id)
    on update restrict on delete restrict,
  constraint creator_premium_plans_id_creator_key unique (id, creator_id),
  constraint creator_premium_plans_version_key unique (creator_id, plan_key, version),
  constraint creator_premium_plans_key_check check (plan_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint creator_premium_plans_version_check check (version > 0),
  constraint creator_premium_plans_name_check
    check (name = pg_catalog.btrim(name) and pg_catalog.char_length(name) between 1 and 80),
  constraint creator_premium_plans_description_check check (pg_catalog.char_length(description) <= 1000),
  constraint creator_premium_plans_price_check
    check (price_bdag > 0 and price_bdag = pg_catalog.round(price_bdag, 8)),
  constraint creator_premium_plans_currency_check check (currency = 'BDAG'),
  constraint creator_premium_plans_status_check check (status in ('draft','active','retired')),
  constraint creator_premium_plans_state_check check (
    (status = 'draft' and activated_at is null and retired_at is null)
    or (status = 'active' and activated_at is not null and retired_at is null)
    or (status = 'retired' and activated_at is not null and retired_at is not null and retired_at >= activated_at)
  ),
  constraint creator_premium_plans_timestamps_check check (updated_at >= created_at)
);

create unique index creator_premium_plans_one_active_idx
  on private.creator_premium_plans(creator_id, plan_key)
  where status = 'active';
create index creator_premium_plans_creator_idx
  on private.creator_premium_plans(creator_id, created_at desc, id desc);

create table private.creator_premium_plan_contents (
  plan_id uuid not null,
  content_id uuid not null,
  creator_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (plan_id, content_id),
  constraint creator_premium_plan_contents_plan_fkey
    foreign key (plan_id, creator_id)
    references private.creator_premium_plans(id, creator_id)
    on update restrict on delete restrict,
  constraint creator_premium_plan_contents_content_fkey
    foreign key (content_id, creator_id)
    references private.creator_premium_contents(id, creator_id)
    on update restrict on delete restrict
);

create index creator_premium_plan_contents_content_idx
  on private.creator_premium_plan_contents(content_id, plan_id);
create index creator_premium_plan_contents_creator_idx
  on private.creator_premium_plan_contents(creator_id, plan_id, content_id);
create index creator_premium_plan_contents_plan_creator_idx
  on private.creator_premium_plan_contents(plan_id, creator_id);
create index creator_premium_plan_contents_content_creator_idx
  on private.creator_premium_plan_contents(content_id, creator_id);

create table private.creator_premium_purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null,
  creator_id uuid not null,
  content_id uuid not null,
  offer_version_id uuid not null,
  financial_transaction_id uuid not null,
  idempotency_key uuid not null,
  access_state text not null default 'pending',
  access_expires_at timestamptz null,
  reversal_financial_transaction_id uuid null,
  purchased_at timestamptz not null default clock_timestamp(),
  activated_at timestamptz null,
  revoked_at timestamptz null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint creator_premium_purchase_receipts_buyer_fkey
    foreign key (buyer_id) references public.user_profiles(id)
    on update restrict on delete restrict,
  constraint creator_premium_purchase_receipts_content_fkey
    foreign key (content_id, creator_id)
    references private.creator_premium_contents(id, creator_id)
    on update restrict on delete restrict,
  constraint creator_premium_purchase_receipts_offer_fkey
    foreign key (offer_version_id, content_id, creator_id)
    references private.creator_premium_offer_versions(id, content_id, creator_id)
    on update restrict on delete restrict,
  constraint creator_premium_purchase_receipts_transaction_fkey
    foreign key (financial_transaction_id) references public.financial_transactions(id)
    on update restrict on delete restrict,
  constraint creator_premium_purchase_receipts_reversal_fkey
    foreign key (reversal_financial_transaction_id) references public.financial_transactions(id)
    on update restrict on delete restrict,
  constraint creator_premium_purchase_receipts_transaction_key unique (financial_transaction_id),
  constraint creator_premium_purchase_receipts_idempotency_key unique (buyer_id, idempotency_key),
  constraint creator_premium_purchase_receipts_self_check check (buyer_id <> creator_id),
  constraint creator_premium_purchase_receipts_state_name_check
    check (access_state in ('pending','active','revoked','refunded')),
  constraint creator_premium_purchase_receipts_reversal_check
    check (reversal_financial_transaction_id is null or reversal_financial_transaction_id <> financial_transaction_id),
  constraint creator_premium_purchase_receipts_expiry_check
    check (access_expires_at is null or (activated_at is not null and access_expires_at > activated_at)),
  constraint creator_premium_purchase_receipts_state_check check (
    (access_state = 'pending' and activated_at is null and revoked_at is null and reversal_financial_transaction_id is null)
    or (access_state = 'active' and activated_at is not null and revoked_at is null and reversal_financial_transaction_id is null)
    or (access_state = 'revoked' and activated_at is not null and revoked_at is not null)
    or (access_state = 'refunded' and activated_at is not null and revoked_at is not null and reversal_financial_transaction_id is not null)
  ),
  constraint creator_premium_purchase_receipts_timestamps_check
    check (updated_at >= created_at)
);

create index creator_premium_purchase_receipts_buyer_library_idx
  on private.creator_premium_purchase_receipts(buyer_id, content_id, activated_at desc)
  where access_state = 'active';
create index creator_premium_purchase_receipts_creator_idx
  on private.creator_premium_purchase_receipts(creator_id, created_at desc, id desc);
create index creator_premium_purchase_receipts_buyer_idx
  on private.creator_premium_purchase_receipts(buyer_id);
create index creator_premium_purchase_receipts_content_creator_idx
  on private.creator_premium_purchase_receipts(content_id, creator_id);
create index creator_premium_purchase_receipts_offer_idx
  on private.creator_premium_purchase_receipts(offer_version_id, content_id, creator_id);
create index creator_premium_purchase_receipts_reversal_idx
  on private.creator_premium_purchase_receipts(reversal_financial_transaction_id);

create table private.creator_premium_subscriptions (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null,
  creator_id uuid not null,
  plan_id uuid not null,
  idempotency_key uuid not null,
  status text not null default 'pending',
  started_at timestamptz null,
  cancelled_at timestamptz null,
  ended_at timestamptz null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint creator_premium_subscriptions_subscriber_fkey
    foreign key (subscriber_id) references public.user_profiles(id)
    on update restrict on delete restrict,
  constraint creator_premium_subscriptions_plan_fkey
    foreign key (plan_id, creator_id)
    references private.creator_premium_plans(id, creator_id)
    on update restrict on delete restrict,
  constraint creator_premium_subscriptions_identity_key
    unique (id, subscriber_id, creator_id, plan_id),
  constraint creator_premium_subscriptions_relationship_key
    unique (subscriber_id, plan_id),
  constraint creator_premium_subscriptions_idempotency_key
    unique (subscriber_id, idempotency_key),
  constraint creator_premium_subscriptions_self_check check (subscriber_id <> creator_id),
  constraint creator_premium_subscriptions_status_check
    check (status in ('pending','active','cancelled','expired','revoked')),
  constraint creator_premium_subscriptions_state_check check (
    (status = 'pending' and started_at is null and cancelled_at is null and ended_at is null)
    or (status = 'active' and started_at is not null and cancelled_at is null and ended_at is null)
    or (status = 'cancelled' and started_at is not null and cancelled_at is not null)
    or (status in ('expired','revoked') and started_at is not null and ended_at is not null)
  ),
  constraint creator_premium_subscriptions_timestamps_check
    check (updated_at >= created_at and (cancelled_at is null or cancelled_at >= started_at)
      and (ended_at is null or ended_at >= started_at))
);

create index creator_premium_subscriptions_subscriber_idx
  on private.creator_premium_subscriptions(subscriber_id, status, updated_at desc, id desc);
create index creator_premium_subscriptions_creator_idx
  on private.creator_premium_subscriptions(creator_id, status, updated_at desc, id desc);
create index creator_premium_subscriptions_plan_creator_idx
  on private.creator_premium_subscriptions(plan_id, creator_id);

create table private.creator_premium_subscription_periods (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null,
  subscriber_id uuid not null,
  creator_id uuid not null,
  plan_id uuid not null,
  starts_at timestamptz not null,
  paid_through_at timestamptz not null,
  financial_transaction_id uuid not null,
  access_state text not null default 'active',
  reversal_financial_transaction_id uuid null,
  revoked_at timestamptz null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint creator_premium_subscription_periods_subscription_fkey
    foreign key (subscription_id, subscriber_id, creator_id, plan_id)
    references private.creator_premium_subscriptions(id, subscriber_id, creator_id, plan_id)
    on update restrict on delete restrict,
  constraint creator_premium_subscription_periods_transaction_fkey
    foreign key (financial_transaction_id) references public.financial_transactions(id)
    on update restrict on delete restrict,
  constraint creator_premium_subscription_periods_reversal_fkey
    foreign key (reversal_financial_transaction_id) references public.financial_transactions(id)
    on update restrict on delete restrict,
  constraint creator_premium_subscription_periods_transaction_key unique (financial_transaction_id),
  constraint creator_premium_subscription_periods_window_key
    unique (subscription_id, starts_at, paid_through_at),
  constraint creator_premium_subscription_periods_window_check
    check (paid_through_at > starts_at),
  constraint creator_premium_subscription_periods_state_name_check
    check (access_state in ('active','expired','revoked')),
  constraint creator_premium_subscription_periods_reversal_check
    check (reversal_financial_transaction_id is null or reversal_financial_transaction_id <> financial_transaction_id),
  constraint creator_premium_subscription_periods_state_check check (
    (access_state in ('active','expired') and revoked_at is null and reversal_financial_transaction_id is null)
    or (access_state = 'revoked' and revoked_at is not null)
  ),
  constraint creator_premium_subscription_periods_timestamps_check check (updated_at >= created_at)
);

create index creator_premium_subscription_periods_access_idx
  on private.creator_premium_subscription_periods(subscription_id, starts_at, paid_through_at desc)
  where access_state = 'active';
create index creator_premium_subscription_periods_subscriber_idx
  on private.creator_premium_subscription_periods(subscriber_id, paid_through_at desc, id desc);
create index creator_premium_subscription_periods_subscription_identity_idx
  on private.creator_premium_subscription_periods(subscription_id, subscriber_id, creator_id, plan_id);
create index creator_premium_subscription_periods_reversal_idx
  on private.creator_premium_subscription_periods(reversal_financial_transaction_id);

alter table private.creator_premium_contents enable row level security;
alter table private.creator_premium_contents force row level security;
alter table private.creator_premium_offer_versions enable row level security;
alter table private.creator_premium_offer_versions force row level security;
alter table private.creator_premium_plans enable row level security;
alter table private.creator_premium_plans force row level security;
alter table private.creator_premium_plan_contents enable row level security;
alter table private.creator_premium_plan_contents force row level security;
alter table private.creator_premium_purchase_receipts enable row level security;
alter table private.creator_premium_purchase_receipts force row level security;
alter table private.creator_premium_subscriptions enable row level security;
alter table private.creator_premium_subscriptions force row level security;
alter table private.creator_premium_subscription_periods enable row level security;
alter table private.creator_premium_subscription_periods force row level security;

revoke all on table private.creator_premium_contents from public, anon, authenticated, service_role;
revoke all on table private.creator_premium_offer_versions from public, anon, authenticated, service_role;
revoke all on table private.creator_premium_plans from public, anon, authenticated, service_role;
revoke all on table private.creator_premium_plan_contents from public, anon, authenticated, service_role;
revoke all on table private.creator_premium_purchase_receipts from public, anon, authenticated, service_role;
revoke all on table private.creator_premium_subscriptions from public, anon, authenticated, service_role;
revoke all on table private.creator_premium_subscription_periods from public, anon, authenticated, service_role;

create function private.creator_premium_actor_is_operational_v1(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
    from auth.users u
    join public.user_profiles profile on profile.id = u.id
    where u.id = p_user_id
      and u.deleted_at is null
      and not u.is_anonymous
      and (u.banned_until is null or u.banned_until <= pg_catalog.clock_timestamp())
  ), false);
$$;

revoke all on function private.creator_premium_actor_is_operational_v1(uuid)
  from public, anon, authenticated, service_role;

create function private.creator_premium_pair_is_unblocked_v1(
  p_actor_id uuid,
  p_creator_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_actor_id = p_creator_id or not exists (
    select 1
    from public.blocked_users blocked
    where (blocked.blocker_id = p_actor_id and blocked.blocked_id = p_creator_id)
       or (blocked.blocker_id = p_creator_id and blocked.blocked_id = p_actor_id)
  );
$$;

revoke all on function private.creator_premium_pair_is_unblocked_v1(uuid,uuid)
  from public, anon, authenticated, service_role;

create function private.resolve_creator_premium_entitlement_v1(p_content_id uuid)
returns table (
  allowed boolean,
  source text,
  reason text,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
  v_expires_at timestamptz;
begin
  if v_actor is null then
    return query select false, 'none'::text, 'auth_required'::text, null::timestamptz;
    return;
  end if;

  if not private.current_user_is_creator_exclusive_age_eligible() then
    return query select false, 'none'::text, 'age_eligibility_required'::text, null::timestamptz;
    return;
  end if;

  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    return query select false, 'none'::text, 'actor_account_restricted'::text, null::timestamptz;
    return;
  end if;

  select content.* into v_content
  from private.creator_premium_contents content
  where content.id = p_content_id;

  if not found then
    return query select false, 'none'::text, 'content_not_found'::text, null::timestamptz;
    return;
  end if;

  if not private.creator_premium_actor_is_operational_v1(v_content.creator_id) then
    return query select false, 'none'::text, 'creator_account_restricted'::text, null::timestamptz;
    return;
  end if;

  if v_content.lifecycle_status in ('quarantined','removed','deleted') then
    return query select false, 'none'::text, 'content_unavailable'::text, null::timestamptz;
    return;
  end if;

  if v_actor = v_content.creator_id then
    return query select true, 'owner'::text, 'owner'::text, null::timestamptz;
    return;
  end if;

  if v_content.lifecycle_status <> 'published' then
    return query select false, 'none'::text, 'content_not_published'::text, null::timestamptz;
    return;
  end if;

  if not private.creator_premium_pair_is_unblocked_v1(v_actor, v_content.creator_id) then
    return query select false, 'none'::text, 'blocked_relationship'::text, null::timestamptz;
    return;
  end if;

  if v_content.access_mode in ('purchase','purchase_or_subscription') then
    select receipt.access_expires_at into v_expires_at
    from private.creator_premium_purchase_receipts receipt
    join private.creator_premium_offer_versions offer
      on offer.id = receipt.offer_version_id
     and offer.content_id = receipt.content_id
     and offer.creator_id = receipt.creator_id
    join public.financial_transactions finance_tx
      on finance_tx.id = receipt.financial_transaction_id
    where receipt.buyer_id = v_actor
      and receipt.content_id = v_content.id
      and receipt.access_state = 'active'
      and receipt.revoked_at is null
      and receipt.reversal_financial_transaction_id is null
      and (receipt.access_expires_at is null or receipt.access_expires_at > pg_catalog.clock_timestamp())
      and finance_tx.status = 'completed'
      and finance_tx.currency = 'BDAG'
      and finance_tx.initiated_by = receipt.buyer_id
      and finance_tx.amount = offer.price_bdag
    order by receipt.activated_at desc, receipt.id desc
    limit 1;
    if found then
      return query select true, 'purchase'::text, 'active_purchase'::text, v_expires_at;
      return;
    end if;
  end if;

  if v_content.access_mode in ('subscription','purchase_or_subscription') then
    select period.paid_through_at into v_expires_at
    from private.creator_premium_subscriptions subscription
    join private.creator_premium_subscription_periods period
      on period.subscription_id = subscription.id
     and period.subscriber_id = subscription.subscriber_id
     and period.creator_id = subscription.creator_id
     and period.plan_id = subscription.plan_id
    join private.creator_premium_plan_contents grant_map
      on grant_map.plan_id = subscription.plan_id
     and grant_map.creator_id = subscription.creator_id
     and grant_map.content_id = v_content.id
    join private.creator_premium_plans plan
      on plan.id = subscription.plan_id
     and plan.creator_id = subscription.creator_id
    join public.financial_transactions finance_tx
      on finance_tx.id = period.financial_transaction_id
    where subscription.subscriber_id = v_actor
      and subscription.creator_id = v_content.creator_id
      and subscription.status in ('active','cancelled')
      and period.access_state = 'active'
      and period.revoked_at is null
      and period.reversal_financial_transaction_id is null
      and period.starts_at <= pg_catalog.clock_timestamp()
      and period.paid_through_at > pg_catalog.clock_timestamp()
      and finance_tx.status = 'completed'
      and finance_tx.currency = 'BDAG'
      and finance_tx.initiated_by = subscription.subscriber_id
      and finance_tx.amount = plan.price_bdag
    order by period.paid_through_at desc, period.id desc
    limit 1;
    if found then
      return query select true, 'subscription'::text, 'active_subscription_period'::text, v_expires_at;
      return;
    end if;
  end if;

  return query select false, 'none'::text, 'not_entitled'::text, null::timestamptz;
end;
$$;

revoke all on function private.resolve_creator_premium_entitlement_v1(uuid)
  from public, anon, authenticated, service_role;

create function public.get_creator_premium_catalog_v1(
  p_creator_id uuid,
  p_limit integer default 24,
  p_cursor_published_at timestamptz default null,
  p_cursor_id uuid default null
) returns table (
  id uuid,
  creator_id uuid,
  title text,
  description text,
  content_kind text,
  access_mode text,
  published_at timestamptz,
  created_at timestamptz,
  entitled boolean,
  entitlement_source text,
  entitlement_expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if p_creator_id is null then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_creator';
  end if;
  if p_limit is null or not (p_limit between 1 and 100) then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_limit';
  end if;
  if (p_cursor_published_at is null) <> (p_cursor_id is null) then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_cursor';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor)
     or not private.creator_premium_actor_is_operational_v1(p_creator_id) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;
  if not private.creator_premium_pair_is_unblocked_v1(v_actor, p_creator_id) then
    raise exception using errcode = '42501', message = 'creator_premium_blocked_relationship';
  end if;

  return query
  select content.id, content.creator_id, content.title, content.description,
    content.content_kind, content.access_mode, content.published_at, content.created_at,
    entitlement.allowed, entitlement.source, entitlement.expires_at
  from private.creator_premium_contents content
  cross join lateral private.resolve_creator_premium_entitlement_v1(content.id) entitlement
  where content.creator_id = p_creator_id
    and content.lifecycle_status = 'published'
    and content.published_at is not null
    and (p_cursor_published_at is null
      or (content.published_at, content.id) < (p_cursor_published_at, p_cursor_id))
  order by content.published_at desc, content.id desc
  limit p_limit;
end;
$$;

revoke all on function public.get_creator_premium_catalog_v1(uuid,integer,timestamptz,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_creator_premium_catalog_v1(uuid,integer,timestamptz,uuid)
  to authenticated;

create function public.create_my_creator_premium_draft_v1(
  p_title text,
  p_description text,
  p_content_kind text,
  p_access_mode text,
  p_client_request_id uuid
) returns table (
  id uuid,
  created boolean,
  lifecycle_status text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_title text := pg_catalog.btrim(coalesce(p_title, ''));
  v_description text := pg_catalog.btrim(coalesce(p_description, ''));
  v_existing private.creator_premium_contents;
  v_inserted private.creator_premium_contents;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;
  if p_client_request_id is null
     or pg_catalog.char_length(v_title) not between 1 and 120
     or pg_catalog.char_length(v_description) > 2000
     or p_content_kind not in ('image','video')
     or p_access_mode not in ('purchase','subscription','purchase_or_subscription') then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_draft';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-draft:' || v_actor::text || ':' || p_client_request_id::text, 0)
  );

  select content.* into v_existing
  from private.creator_premium_contents content
  where content.creator_id = v_actor
    and content.client_request_id = p_client_request_id;

  if found then
    if v_existing.title is distinct from v_title
       or v_existing.description is distinct from v_description
       or v_existing.content_kind is distinct from p_content_kind
       or v_existing.access_mode is distinct from p_access_mode then
      raise exception using errcode = '23505', message = 'creator_premium_idempotency_conflict';
    end if;
    return query select v_existing.id, false, v_existing.lifecycle_status,
      v_existing.created_at, v_existing.updated_at;
    return;
  end if;

  insert into private.creator_premium_contents(
    creator_id, client_request_id, title, description, content_kind, access_mode, lifecycle_status
  ) values (
    v_actor, p_client_request_id, v_title, v_description, p_content_kind, p_access_mode, 'draft'
  ) returning * into v_inserted;

  return query select v_inserted.id, true, v_inserted.lifecycle_status,
    v_inserted.created_at, v_inserted.updated_at;
end;
$$;

revoke all on function public.create_my_creator_premium_draft_v1(text,text,text,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_my_creator_premium_draft_v1(text,text,text,text,uuid)
  to authenticated;

create function public.update_my_creator_premium_draft_v1(
  p_content_id uuid,
  p_title text,
  p_description text,
  p_content_kind text,
  p_access_mode text
) returns table (
  id uuid,
  lifecycle_status text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_title text := pg_catalog.btrim(coalesce(p_title, ''));
  v_description text := pg_catalog.btrim(coalesce(p_description, ''));
  v_content private.creator_premium_contents;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;
  if p_content_id is null
     or pg_catalog.char_length(v_title) not between 1 and 120
     or pg_catalog.char_length(v_description) > 2000
     or p_content_kind not in ('image','video')
     or p_access_mode not in ('purchase','subscription','purchase_or_subscription') then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_draft';
  end if;

  select content.* into v_content
  from private.creator_premium_contents content
  where content.id = p_content_id
    and content.creator_id = v_actor
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_content_not_found';
  end if;
  if v_content.lifecycle_status <> 'draft' then
    raise exception using errcode = '55000', message = 'creator_premium_draft_only';
  end if;

  update private.creator_premium_contents content
  set title = v_title,
      description = v_description,
      content_kind = p_content_kind,
      access_mode = p_access_mode,
      updated_at = pg_catalog.clock_timestamp()
  where content.id = v_content.id
  returning content.* into v_content;

  return query select v_content.id, v_content.lifecycle_status,
    v_content.created_at, v_content.updated_at;
end;
$$;

revoke all on function public.update_my_creator_premium_draft_v1(uuid,text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_my_creator_premium_draft_v1(uuid,text,text,text,text)
  to authenticated;

create function public.get_my_creator_premium_contents_v1(
  p_limit integer default 24,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
) returns table (
  id uuid,
  title text,
  description text,
  content_kind text,
  access_mode text,
  lifecycle_status text,
  published_at timestamptz,
  quarantined_at timestamptz,
  removed_at timestamptz,
  deleted_at timestamptz,
  removal_reason text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if p_limit is null or not (p_limit between 1 and 100) then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_limit';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_cursor';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;

  return query
  select content.id, content.title, content.description, content.content_kind,
    content.access_mode, content.lifecycle_status, content.published_at,
    content.quarantined_at, content.removed_at, content.deleted_at,
    content.removal_reason, content.created_at, content.updated_at
  from private.creator_premium_contents content
  where content.creator_id = v_actor
    and (p_cursor_created_at is null
      or (content.created_at, content.id) < (p_cursor_created_at, p_cursor_id))
  order by content.created_at desc, content.id desc
  limit p_limit;
end;
$$;

revoke all on function public.get_my_creator_premium_contents_v1(integer,timestamptz,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_creator_premium_contents_v1(integer,timestamptz,uuid)
  to authenticated;

create function public.get_my_creator_premium_entitlement_v1(p_content_id uuid)
returns table (
  allowed boolean,
  source text,
  reason text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select entitlement.allowed, entitlement.source, entitlement.reason, entitlement.expires_at
  from private.resolve_creator_premium_entitlement_v1(p_content_id) entitlement;
$$;

revoke all on function public.get_my_creator_premium_entitlement_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_creator_premium_entitlement_v1(uuid)
  to authenticated;

create function public.get_my_creator_premium_library_v1(
  p_limit integer default 24,
  p_cursor_published_at timestamptz default null,
  p_cursor_id uuid default null
) returns table (
  id uuid,
  creator_id uuid,
  title text,
  description text,
  content_kind text,
  access_mode text,
  published_at timestamptz,
  created_at timestamptz,
  entitlement_source text,
  entitlement_expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if p_limit is null or not (p_limit between 1 and 100) then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_limit';
  end if;
  if (p_cursor_published_at is null) <> (p_cursor_id is null) then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_cursor';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;

  return query
  with candidate_content as (
    select receipt.content_id
    from private.creator_premium_purchase_receipts receipt
    where receipt.buyer_id = v_actor
      and receipt.access_state = 'active'
    union
    select grant_map.content_id
    from private.creator_premium_subscriptions subscription
    join private.creator_premium_subscription_periods period
      on period.subscription_id = subscription.id
     and period.subscriber_id = subscription.subscriber_id
     and period.creator_id = subscription.creator_id
     and period.plan_id = subscription.plan_id
    join private.creator_premium_plan_contents grant_map
      on grant_map.plan_id = subscription.plan_id
     and grant_map.creator_id = subscription.creator_id
    where subscription.subscriber_id = v_actor
      and subscription.status in ('active','cancelled')
      and period.access_state = 'active'
      and period.starts_at <= pg_catalog.clock_timestamp()
      and period.paid_through_at > pg_catalog.clock_timestamp()
  )
  select content.id, content.creator_id, content.title, content.description,
    content.content_kind, content.access_mode, content.published_at, content.created_at,
    entitlement.source, entitlement.expires_at
  from candidate_content candidate
  join private.creator_premium_contents content on content.id = candidate.content_id
  cross join lateral private.resolve_creator_premium_entitlement_v1(content.id) entitlement
  where entitlement.allowed
    and entitlement.source in ('purchase','subscription')
    and content.lifecycle_status = 'published'
    and content.published_at is not null
    and (p_cursor_published_at is null
      or (content.published_at, content.id) < (p_cursor_published_at, p_cursor_id))
  order by content.published_at desc, content.id desc
  limit p_limit;
end;
$$;

revoke all on function public.get_my_creator_premium_library_v1(integer,timestamptz,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_creator_premium_library_v1(integer,timestamptz,uuid)
  to authenticated;

-- The stale legacy function remains for historical cleanup, but no ordinary
-- application role may execute it after B1.
revoke all on function public.cancel_unpublished_exclusive_content(uuid)
  from public, anon, authenticated;

comment on table private.creator_premium_contents is
  'Canonical Creator Premium metadata/lifecycle authority. B1 contains no media originals.';
comment on function private.resolve_creator_premium_entitlement_v1(uuid) is
  'Single derived Creator Premium entitlement authority. It trusts auth.uid(), canonical age/account/block state, canonical finance facts, and content lifecycle.';
comment on function public.get_creator_premium_catalog_v1(uuid,integer,timestamptz,uuid) is
  'Age-gated bounded Premium metadata catalog; never returns private media or financial internals.';

commit;
