-- ADS-V2-PLR-9: production monetization control plane.
-- Initial production state remains DISARMED with no rates or billing windows.

begin;

create extension if not exists btree_gist with schema extensions;

create table private.advertising_objective_capabilities (
  objective text primary key,
  capability_version text not null default 'nelyon-ads-objective-capabilities-v1',
  status text not null check (status in ('supported', 'not_available')),
  setup_enabled boolean not null,
  delivery_runtime_ready boolean not null,
  billing_runtime_ready boolean not null,
  conversion_runtime_ready boolean not null,
  billable_event_type text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint advertising_objective_capabilities_billing_event_chk check (
    (billing_runtime_ready and billable_event_type in ('impression', 'click'))
    or (not billing_runtime_ready and billable_event_type is null)
  ),
  constraint advertising_objective_capabilities_setup_delivery_chk check (
    not delivery_runtime_ready or setup_enabled
  )
);

insert into private.advertising_objective_capabilities (
  objective, status, setup_enabled, delivery_runtime_ready,
  billing_runtime_ready, conversion_runtime_ready, billable_event_type
) values
  ('awareness', 'supported', true, true, true, false, 'impression'),
  ('traffic', 'supported', true, true, true, false, 'click'),
  ('marketplace_sales', 'supported', true, true, true, true, 'click'),
  ('reach', 'not_available', false, false, false, false, null),
  ('engagement', 'not_available', false, false, false, false, null),
  ('video_views', 'not_available', false, false, false, false, null),
  ('profile_visits', 'not_available', false, false, false, false, null),
  ('messages', 'not_available', false, false, false, false, null),
  ('website_conversions', 'not_available', false, false, false, false, null),
  ('app_promotion', 'not_available', false, false, false, false, null);

revoke all on table private.advertising_objective_capabilities
from public, anon, authenticated, service_role;

-- C2 intentionally prohibited Spend and automatic transitions in every state.
-- PLR-9 moves those invariants into the single launch-mode envelope, so the
-- legacy per-row constraints must retain only their mode-independent safety.
alter table private.advertising_finance_policy
  drop constraint advertising_finance_policy_v2_safe_chk,
  add constraint advertising_finance_policy_v2_safe_chk check (
    policy_version <> 'nelyon-ads-finance-v2'
    or (
      currency = 'BDAG'
      and shared_escrow_account_type = 'marketplace_ads_escrow'
      and shared_revenue_account_type = 'marketplace_ads_revenue'
      and spend_requires_billable_event
    )
  );

alter table private.advertising_campaign_lifecycle_policy
  drop constraint advertising_campaign_lifecycle_policy_v2_safe_chk;

alter table private.advertising_canary_policy
  add column launch_mode text,
  add column billing_cutover_at timestamptz,
  add column max_spend_bdag numeric(20,8),
  add column max_billable_events integer;

alter table private.advertising_canary_policy
  drop constraint advertising_canary_policy_budget_chk,
  drop constraint advertising_canary_policy_impressions_chk,
  alter column max_budget_bdag drop not null,
  alter column max_impressions drop not null,
  add constraint advertising_canary_policy_budget_chk check (
    max_budget_bdag is null
    or (max_budget_bdag > 0 and max_budget_bdag <= 0.01000000)
  ),
  add constraint advertising_canary_policy_impressions_chk check (
    max_impressions is null or max_impressions = 1
  );

update private.advertising_canary_policy
set launch_mode = 'DISARMED',
    billing_cutover_at = clock_timestamp(),
    canary_enabled = false,
    business_account_id = null,
    ad_account_id = null,
    campaign_id = null,
    viewer_user_id = null,
    placement_code = null,
    max_budget_bdag = null,
    max_impressions = null,
    max_spend_bdag = null,
    max_billable_events = null,
    enabled_at = null,
    expires_at = null,
    updated_at = clock_timestamp()
where singleton;

-- The existing C2 launch-envelope constraint trigger is deferred and fires
-- for the singleton update above. Flush it while the row is in its legal
-- DISARMED representation before altering the participating policy table,
-- then restore deferred checking for the rest of this transaction.
set constraints all immediate;
set constraints all deferred;

alter table private.advertising_canary_policy
  alter column launch_mode set not null,
  alter column launch_mode set default 'DISARMED',
  alter column billing_cutover_at set not null,
  add constraint advertising_canary_policy_launch_mode_chk check (
    launch_mode in (
      'DISARMED', 'CANARY_DELIVERY', 'CANARY_BILLING',
      'SETTLEMENT_ONLY', 'PRODUCTION'
    )
  ),
  add constraint advertising_canary_policy_mode_enabled_chk check (
    canary_enabled = (launch_mode in ('CANARY_DELIVERY', 'CANARY_BILLING'))
  ),
  add constraint advertising_canary_policy_mode_shape_chk check (
    (
      launch_mode in ('CANARY_DELIVERY', 'CANARY_BILLING')
      and business_account_id is not null
      and ad_account_id is not null
      and campaign_id is not null
      and viewer_user_id is not null
      and placement_code is not null
      and enabled_at is not null
      and expires_at is not null
      and expires_at > enabled_at
      and max_budget_bdag is not null
      and max_budget_bdag > 0
      and max_impressions is not null
      and max_impressions >= 1
    )
    or
    (
      launch_mode not in ('CANARY_DELIVERY', 'CANARY_BILLING')
      and business_account_id is null
      and ad_account_id is null
      and campaign_id is null
      and viewer_user_id is null
      and placement_code is null
      and enabled_at is null
      and expires_at is null
      and max_budget_bdag is null
      and max_impressions is null
    )
  ),
  add constraint advertising_canary_policy_billing_caps_chk check (
    (
      launch_mode = 'CANARY_BILLING'
      and max_spend_bdag is not null
      and max_spend_bdag > 0
      and max_spend_bdag <= max_budget_bdag
      and max_billable_events is not null
      and max_billable_events >= 1
    )
    or
    (
      launch_mode <> 'CANARY_BILLING'
      and max_spend_bdag is null
      and max_billable_events is null
    )
  );

create or replace function private.advertising_guard_billing_cutover()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.billing_cutover_at is distinct from old.billing_cutover_at then
    raise exception using errcode = '23514', message = 'advertising_billing_cutover_immutable';
  end if;
  return new;
end;
$$;

revoke all on function private.advertising_guard_billing_cutover()
from public, anon, authenticated, service_role;

create trigger advertising_billing_cutover_immutable
before update of billing_cutover_at on private.advertising_canary_policy
for each row execute function private.advertising_guard_billing_cutover();

create table private.advertising_billing_authorization_windows (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('CANARY_BILLING', 'PRODUCTION')),
  scope text not null check (scope in ('global', 'canary_campaign')),
  campaign_id uuid references private.advertising_campaigns(id),
  opened_at timestamptz not null,
  expires_at timestamptz,
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  closed_at timestamptz,
  max_spend_bdag numeric(20,8),
  max_billable_events integer,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint advertising_billing_authorization_window_shape_chk check (
    (
      mode = 'CANARY_BILLING'
      and scope = 'canary_campaign'
      and campaign_id is not null
      and expires_at is not null
      and expires_at > opened_at
      and max_spend_bdag is not null
      and max_spend_bdag > 0
      and max_billable_events is not null
      and max_billable_events >= 1
    )
    or
    (
      mode = 'PRODUCTION'
      and scope = 'global'
      and campaign_id is null
      and expires_at is null
      and max_spend_bdag is null
      and max_billable_events is null
    )
  ),
  constraint advertising_billing_authorization_window_status_chk check (
    (status = 'OPEN' and closed_at is null)
    or (status = 'CLOSED' and closed_at is not null and closed_at >= opened_at)
  )
);

create unique index advertising_billing_authorization_single_open_idx
on private.advertising_billing_authorization_windows ((true))
where status = 'OPEN';

create index advertising_billing_authorization_campaign_status_idx
on private.advertising_billing_authorization_windows (campaign_id, status, opened_at);

revoke all on table private.advertising_billing_authorization_windows
from public, anon, authenticated, service_role;

create or replace function private.advertising_guard_authorization_window()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'CLOSED' then
      raise exception using errcode = '23514', message = 'advertising_billing_window_terminal';
    end if;
    if new.id is distinct from old.id
      or new.mode is distinct from old.mode
      or new.scope is distinct from old.scope
      or new.campaign_id is distinct from old.campaign_id
      or new.opened_at is distinct from old.opened_at
      or new.expires_at is distinct from old.expires_at
      or new.max_spend_bdag is distinct from old.max_spend_bdag
      or new.max_billable_events is distinct from old.max_billable_events
      or new.created_at is distinct from old.created_at
      or new.status <> 'CLOSED'
      or new.closed_at is null then
      raise exception using errcode = '23514', message = 'advertising_billing_window_immutable';
    end if;
  elsif tg_op = 'DELETE' then
    raise exception using errcode = '23514', message = 'advertising_billing_window_delete_forbidden';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.advertising_guard_authorization_window()
from public, anon, authenticated, service_role;

create trigger advertising_billing_authorization_window_guard
before update or delete on private.advertising_billing_authorization_windows
for each row execute function private.advertising_guard_authorization_window();

create table private.advertising_billing_rate_versions (
  id uuid primary key default gen_random_uuid(),
  objective text not null references private.advertising_objective_capabilities(objective),
  billable_event_type text not null check (billable_event_type in ('impression', 'click')),
  placement_code text not null references private.advertising_placement_catalog(code),
  rate_bdag numeric(20,8) not null check (rate_bdag > 0),
  currency text not null default 'BDAG' check (currency = 'BDAG'),
  scope text not null check (scope in ('global', 'canary_campaign')),
  scope_campaign_id uuid references private.advertising_campaigns(id),
  state text not null default 'draft' check (state in ('draft', 'published', 'retired')),
  effective_from timestamptz not null,
  effective_to timestamptz,
  created_by uuid,
  published_by uuid,
  retired_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  published_at timestamptz,
  retired_at timestamptz,
  constraint advertising_billing_rate_scope_chk check (
    (scope = 'global' and scope_campaign_id is null)
    or (scope = 'canary_campaign' and scope_campaign_id is not null)
  ),
  constraint advertising_billing_rate_interval_chk check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint advertising_billing_rate_state_chk check (
    (state = 'draft' and published_at is null and retired_at is null)
    or (state = 'published' and published_at is not null and retired_at is null)
    or (
      state = 'retired' and published_at is not null
      and retired_at is not null and effective_to is not null
    )
  ),
  constraint advertising_billing_rate_versions_no_overlap
  exclude using gist (
    objective with =,
    billable_event_type with =,
    placement_code with =,
    scope with =,
    (coalesce(scope_campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    tstzrange(effective_from, effective_to, '[)') with &&
  ) where (state in ('published', 'retired'))
);

create index advertising_billing_rate_resolution_idx
on private.advertising_billing_rate_versions (
  objective, billable_event_type, placement_code, scope, scope_campaign_id, effective_from
)
where state in ('published', 'retired');

revoke all on table private.advertising_billing_rate_versions
from public, anon, authenticated, service_role;

create or replace function private.advertising_billing_rate_published_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.state = 'draft' then
    return new;
  end if;
  if old.state = 'published'
    and new.state = 'retired'
    and new.id = old.id
    and new.objective = old.objective
    and new.billable_event_type = old.billable_event_type
    and new.placement_code = old.placement_code
    and new.rate_bdag = old.rate_bdag
    and new.currency = old.currency
    and new.scope = old.scope
    and new.scope_campaign_id is not distinct from old.scope_campaign_id
    and new.effective_from = old.effective_from
    and new.created_by is not distinct from old.created_by
    and new.published_by is not distinct from old.published_by
    and new.created_at = old.created_at
    and new.published_at = old.published_at
    and new.effective_to is not null
    and new.retired_at is not null
    and new.retired_by is not null then
    return new;
  end if;
  raise exception using errcode = '23514', message = 'advertising_billing_rate_published_immutable';
end;
$$;

revoke all on function private.advertising_billing_rate_published_immutable()
from public, anon, authenticated, service_role;

create trigger advertising_billing_rate_published_immutable
before update on private.advertising_billing_rate_versions
for each row execute function private.advertising_billing_rate_published_immutable();

create or replace function private.resolve_advertising_billing_rate_v2(
  p_campaign_id uuid,
  p_event_type text,
  p_placement_code text,
  p_occurred_at timestamptz,
  p_launch_mode text
)
returns private.advertising_billing_rate_versions
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_objective text;
  v_rate private.advertising_billing_rate_versions;
  v_rate_id uuid;
  v_count integer;
begin
  select campaign.objective
  into v_objective
  from private.advertising_campaigns campaign
  where campaign.id = p_campaign_id;

  if v_objective is null
    or p_launch_mode not in ('CANARY_BILLING', 'PRODUCTION') then
    return null;
  end if;

  select count(*), (array_agg(rate.id order by rate.effective_from desc, rate.id))[1]
  into v_count, v_rate_id
  from private.advertising_billing_rate_versions rate
  where rate.objective = v_objective
    and rate.billable_event_type = p_event_type
    and rate.placement_code = p_placement_code
    and rate.state in ('published', 'retired')
    and rate.effective_from <= p_occurred_at
    and (rate.effective_to is null or p_occurred_at < rate.effective_to)
    and (
      (p_launch_mode = 'PRODUCTION' and rate.scope = 'global' and rate.scope_campaign_id is null)
      or
      (p_launch_mode = 'CANARY_BILLING' and rate.scope = 'canary_campaign' and rate.scope_campaign_id = p_campaign_id)
    );

  if v_count > 1 then
    raise exception using errcode = '23514', message = 'advertising_billing_rate_ambiguous';
  end if;
  if v_count = 0 then
    return null;
  end if;
  select * into strict v_rate
  from private.advertising_billing_rate_versions rate
  where rate.id = v_rate_id;
  return v_rate;
end;
$$;

revoke all on function private.resolve_advertising_billing_rate_v2(
  uuid, text, text, timestamptz, text
) from public, anon, authenticated, service_role;

create or replace function private.advertising_rate_coverage_at(
  p_launch_mode text,
  p_campaign_id uuid,
  p_placement_code text,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_required integer := 0;
  v_covered integer := 0;
begin
  if p_launch_mode = 'PRODUCTION' then
    select count(*) into v_required
    from private.advertising_objective_capabilities capability
    where capability.delivery_runtime_ready
      and capability.billing_runtime_ready;

    select count(*) into v_covered
    from private.advertising_objective_capabilities capability
    where capability.delivery_runtime_ready
      and capability.billing_runtime_ready
      and (
        select count(*)
        from private.advertising_billing_rate_versions rate
        where rate.objective = capability.objective
          and rate.billable_event_type = capability.billable_event_type
          and rate.placement_code = p_placement_code
          and rate.scope = 'global'
          and rate.scope_campaign_id is null
          and rate.state in ('published', 'retired')
          and rate.effective_from <= p_from
          and rate.effective_to is null
      ) = 1;
  elsif p_launch_mode = 'CANARY_BILLING' then
    v_required := 1;
    select count(*) into v_covered
    from private.advertising_campaigns campaign
    join private.advertising_objective_capabilities capability
      on capability.objective = campaign.objective
     and capability.delivery_runtime_ready
     and capability.billing_runtime_ready
    where campaign.id = p_campaign_id
      and (
        select count(*)
        from private.advertising_billing_rate_versions rate
        where rate.objective = campaign.objective
          and rate.billable_event_type = capability.billable_event_type
          and rate.placement_code = p_placement_code
          and rate.scope = 'canary_campaign'
          and rate.scope_campaign_id = campaign.id
          and rate.state in ('published', 'retired')
          and rate.effective_from <= p_from
          and (rate.effective_to is null or rate.effective_to >= p_to)
      ) = 1;
  end if;

  return jsonb_build_object(
    'required_count', v_required,
    'covered_count', v_covered,
    'missing_count', greatest(v_required - v_covered, 0),
    'ready', v_required > 0 and v_required = v_covered
  );
end;
$$;

revoke all on function private.advertising_rate_coverage_at(
  text, uuid, text, timestamptz, timestamptz
) from public, anon, authenticated, service_role;

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
  if not exists (
    select 1
    from private.advertising_objective_capabilities capability
    where capability.objective = v_objective
      and capability.setup_enabled
  ) then
    raise exception using errcode = '22023', message = 'advertising_campaign_objective_unavailable';
  end if;

  perform 1
  from private.ad_accounts account
  join private.business_accounts business on business.id = account.business_account_id
  where account.id = p_ad_account_id
    and account.status = 'active'
    and business.status = 'active'
    and business.owner_user_id = v_actor
  for key share of account, business;
  if not found then
    raise exception using errcode = '42501', message = 'advertising_ad_account_access_denied';
  end if;

  insert into private.advertising_campaigns (
    ad_account_id, name, objective, status, created_by, creation_idempotency_key
  ) values (
    p_ad_account_id, v_name, v_objective, 'draft', v_actor, p_idempotency_key
  )
  on conflict (ad_account_id, creation_idempotency_key) do nothing
  returning * into v_campaign;

  if v_campaign.id is null then
    select campaign.* into strict v_campaign
    from private.advertising_campaigns campaign
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

revoke all on function public.create_my_advertising_campaign_draft(
  uuid, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_my_advertising_campaign_draft(
  uuid, text, text, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- Admin billing capabilities and canonical rate lifecycle
-- ---------------------------------------------------------------------------

insert into private.admin_capabilities(
  capability_code, domain, effect, description, is_sensitive
) values
  (
    'advertising.billing.read', 'advertising', 'read',
    'Read Ads billing configuration, materialization, and operational health.', true
  ),
  (
    'advertising.rates.manage', 'advertising', 'write',
    'Create, publish, and retire canonical Ads billing rate versions.', true
  )
on conflict (capability_code) do nothing;

insert into private.admin_role_capabilities(role_code, capability_code) values
  ('SUPER_ADMIN', 'advertising.billing.read'),
  ('PLATFORM_ADMIN', 'advertising.billing.read'),
  ('FINANCE_AUDITOR', 'advertising.billing.read'),
  ('SUPER_ADMIN', 'advertising.rates.manage')
on conflict (role_code, capability_code) do nothing;

create or replace function private.admin_audit_row_visible(
  p_domain text,
  p_financial_effect boolean
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (not coalesce(p_financial_effect,false)
      or public.admin_actor_has_capability('finance.audit.read'))
    and case p_domain
      when 'admin' then public.admin_actor_has_capability('admin.roles.read')
      when 'users' then public.admin_actor_has_capability('users.accounts.read')
      when 'reports' then public.admin_actor_has_capability('reports.cases.read')
      when 'content' then public.admin_actor_has_capability('content.items.read')
      when 'stories' then public.admin_actor_has_capability('stories.items.read')
      when 'chat' then public.admin_actor_has_capability('chat.abuse_reports.read')
      when 'live' then public.admin_actor_has_capability('live.sessions.read')
      when 'battles' then public.admin_actor_has_capability('battles.sessions.read')
      when 'media' then public.admin_actor_has_capability('media.assets.read')
      when 'marketplace' then public.admin_actor_has_capability('marketplace.audit.read')
      when 'advertising' then public.admin_actor_has_capability('advertising.billing.read')
      when 'finance' then public.admin_actor_has_capability('finance.audit.read')
      when 'system' then public.admin_actor_has_capability('system.audit.read')
      else false
    end;
$$;

revoke all on function private.admin_audit_row_visible(text,boolean)
from public, anon, authenticated, service_role;

create or replace function private.assert_advertising_billing_rate_input(
  p_objective text,
  p_billable_event_type text,
  p_placement_code text,
  p_scope text,
  p_scope_campaign_id uuid,
  p_rate_bdag numeric,
  p_effective_from timestamptz,
  p_effective_to timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_objective is null or p_billable_event_type is null
    or not exists (
      select 1
      from private.advertising_objective_capabilities capability
      where capability.objective = p_objective
        and capability.billing_runtime_ready
        and capability.billable_event_type = p_billable_event_type
    ) then
    raise exception using errcode='22023', message='advertising_billing_rate_objective_event_invalid';
  end if;
  if p_placement_code is null or not exists (
    select 1 from private.advertising_placement_catalog placement
    where placement.code = p_placement_code
  ) then
    raise exception using errcode='22023', message='advertising_billing_rate_placement_invalid';
  end if;
  if p_scope not in ('global','canary_campaign')
    or (p_scope = 'global' and p_scope_campaign_id is not null)
    or (p_scope = 'canary_campaign' and p_scope_campaign_id is null)
    or (
      p_scope = 'canary_campaign'
      and not exists (
        select 1 from private.advertising_campaigns campaign
        where campaign.id = p_scope_campaign_id
      )
    ) then
    raise exception using errcode='22023', message='advertising_billing_rate_scope_invalid';
  end if;
  if p_rate_bdag is null or p_rate_bdag <= 0 or p_rate_bdag <> round(p_rate_bdag,8) then
    raise exception using errcode='22023', message='advertising_billing_rate_amount_invalid';
  end if;
  if p_effective_from is null or (p_effective_to is not null and p_effective_to < p_effective_from) then
    raise exception using errcode='22023', message='advertising_billing_rate_interval_invalid';
  end if;
end;
$$;

revoke all on function private.assert_advertising_billing_rate_input(
  text,text,text,text,uuid,numeric,timestamptz,timestamptz
) from public, anon, authenticated, service_role;

create or replace function public.search_admin_advertising_billing_rates(
  p_state text default null,
  p_scope text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_limit integer := least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('advertising.billing.read');
  if p_state is not null and p_state not in ('draft','published','retired') then
    raise exception using errcode='22023', message='advertising_billing_rate_state_invalid';
  end if;
  if p_scope is not null and p_scope not in ('global','canary_campaign') then
    raise exception using errcode='22023', message='advertising_billing_rate_scope_invalid';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception using errcode='22023', message='invalid_cursor';
  end if;
  return (
    with page as (
      select rate.*
      from private.advertising_billing_rate_versions rate
      where (p_state is null or rate.state=p_state)
        and (p_scope is null or rate.scope=p_scope)
        and (p_cursor_created_at is null or (rate.created_at,rate.id)<(p_cursor_created_at,p_cursor_id))
      order by rate.created_at desc,rate.id desc
      limit v_limit
    )
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'id',id,'objective',objective,'billable_event_type',billable_event_type,
        'placement_code',placement_code,'rate_bdag',rate_bdag,'currency',currency,
        'scope',scope,'scope_campaign_id',scope_campaign_id,'state',state,
        'effective_from',effective_from,'effective_to',effective_to,
        'created_at',created_at,'updated_at',updated_at,
        'published_at',published_at,'retired_at',retired_at
      ) order by created_at desc,id desc) from page),'[]'::jsonb),
      'next_cursor',(select jsonb_build_object('created_at',created_at,'id',id)
        from page order by created_at,id limit 1)
    )
  );
end;
$$;

create or replace function public.admin_create_advertising_billing_rate_draft_v2(
  p_objective text,
  p_billable_event_type text,
  p_placement_code text,
  p_scope text,
  p_scope_campaign_id uuid,
  p_rate_bdag numeric,
  p_effective_from timestamptz,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_scope text;
  v_fingerprint text;
  v_existing private.admin_action_audit;
  v_rate private.advertising_billing_rate_versions;
  v_receipt jsonb;
begin
  v_actor := public.admin_require_capability('advertising.rates.manage');
  if p_idempotency_key is null then raise exception using errcode='22023',message='advertising_idempotency_key_required'; end if;
  v_scope := 'v1|human|'||v_actor::text||'|advertising.rates.manage|advertising.rate.draft.create';
  v_fingerprint := private.admin_request_fingerprint(jsonb_build_object(
    'objective',p_objective,'billable_event_type',p_billable_event_type,
    'placement_code',p_placement_code,'scope',p_scope,'scope_campaign_id',p_scope_campaign_id,
    'rate_bdag',p_rate_bdag,'effective_from',p_effective_from
  ));
  perform pg_advisory_xact_lock(hashtextextended(v_scope||'|'||p_idempotency_key::text,0));
  select * into v_existing from private.admin_action_audit
    where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='admin_idempotency_conflict';end if;
    return (v_existing.metadata->'receipt')||jsonb_build_object('idempotent',true);
  end if;
  perform private.assert_advertising_billing_rate_input(
    p_objective,p_billable_event_type,p_placement_code,p_scope,p_scope_campaign_id,
    p_rate_bdag,p_effective_from,null
  );
  insert into private.advertising_billing_rate_versions(
    objective,billable_event_type,placement_code,rate_bdag,currency,scope,
    scope_campaign_id,state,effective_from,created_by
  ) values(
    p_objective,p_billable_event_type,p_placement_code,p_rate_bdag,'BDAG',p_scope,
    p_scope_campaign_id,'draft',p_effective_from,v_actor
  ) returning * into v_rate;
  v_receipt:=jsonb_build_object('rate_id',v_rate.id,'state',v_rate.state,'idempotent',false);
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,target_ref,
    outcome,financial_effect,contains_pii,idempotency_scope,idempotency_key,request_fingerprint,metadata
  ) values(
    v_actor,'human_admin',private.admin_active_role_codes(v_actor),'advertising.rates.manage','advertising',
    'advertising.rate.draft.create','advertising_billing_rate',v_rate.id,
    v_rate.objective||':'||v_rate.billable_event_type||':'||v_rate.placement_code,
    'succeeded',false,false,v_scope,p_idempotency_key,v_fingerprint,
    jsonb_build_object('receipt',v_receipt,'state','draft','currency','BDAG')
  );
  return v_receipt;
end;
$$;

create or replace function public.admin_update_advertising_billing_rate_draft_v2(
  p_rate_id uuid,
  p_objective text,
  p_billable_event_type text,
  p_placement_code text,
  p_scope text,
  p_scope_campaign_id uuid,
  p_rate_bdag numeric,
  p_effective_from timestamptz,
  p_effective_to timestamptz,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;v_scope text;v_fingerprint text;v_existing private.admin_action_audit;
  v_rate private.advertising_billing_rate_versions;v_receipt jsonb;
begin
  v_actor:=public.admin_require_capability('advertising.rates.manage');
  if p_idempotency_key is null then raise exception using errcode='22023',message='advertising_idempotency_key_required';end if;
  v_scope:='v1|human|'||v_actor::text||'|advertising.rates.manage|advertising.rate.draft.update';
  v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object(
    'rate_id',p_rate_id,'objective',p_objective,'billable_event_type',p_billable_event_type,
    'placement_code',p_placement_code,'scope',p_scope,'scope_campaign_id',p_scope_campaign_id,
    'rate_bdag',p_rate_bdag,'effective_from',p_effective_from,'effective_to',p_effective_to
  ));
  perform pg_advisory_xact_lock(hashtextextended(v_scope||'|'||p_idempotency_key::text,0));
  select * into v_existing from private.admin_action_audit where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='admin_idempotency_conflict';end if;
    return (v_existing.metadata->'receipt')||jsonb_build_object('idempotent',true);
  end if;
  perform private.assert_advertising_billing_rate_input(
    p_objective,p_billable_event_type,p_placement_code,p_scope,p_scope_campaign_id,
    p_rate_bdag,p_effective_from,p_effective_to
  );
  select * into v_rate from private.advertising_billing_rate_versions where id=p_rate_id for update;
  if not found then raise exception using errcode='P0002',message='advertising_billing_rate_not_found';end if;
  if v_rate.state<>'draft' then raise exception using errcode='55000',message='advertising_published_rate_immutable';end if;
  update private.advertising_billing_rate_versions set
    objective=p_objective,billable_event_type=p_billable_event_type,placement_code=p_placement_code,
    scope=p_scope,scope_campaign_id=p_scope_campaign_id,rate_bdag=p_rate_bdag,
    effective_from=p_effective_from,effective_to=p_effective_to,updated_at=clock_timestamp()
  where id=p_rate_id returning * into v_rate;
  v_receipt:=jsonb_build_object('rate_id',v_rate.id,'state',v_rate.state,'idempotent',false);
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,target_ref,
    outcome,financial_effect,contains_pii,idempotency_scope,idempotency_key,request_fingerprint,metadata
  ) values(
    v_actor,'human_admin',private.admin_active_role_codes(v_actor),'advertising.rates.manage','advertising',
    'advertising.rate.draft.update','advertising_billing_rate',v_rate.id,
    v_rate.objective||':'||v_rate.billable_event_type||':'||v_rate.placement_code,
    'succeeded',false,false,v_scope,p_idempotency_key,v_fingerprint,
    jsonb_build_object('receipt',v_receipt,'state','draft','currency','BDAG')
  );
  return v_receipt;
end;
$$;

create or replace function public.admin_publish_advertising_billing_rate_v2(
  p_rate_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;v_scope text;v_fingerprint text;v_existing private.admin_action_audit;
  v_rate private.advertising_billing_rate_versions;v_receipt jsonb;
begin
  v_actor:=public.admin_require_capability('advertising.rates.manage');
  if p_idempotency_key is null then raise exception using errcode='22023',message='advertising_idempotency_key_required';end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null or char_length(btrim(p_reason))>500 then
    raise exception using errcode='22023',message='advertising_billing_rate_reason_required';
  end if;
  v_scope:='v1|human|'||v_actor::text||'|advertising.rates.manage|advertising.rate.publish';
  v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object('rate_id',p_rate_id,'reason',btrim(p_reason)));
  perform pg_advisory_xact_lock(hashtextextended(v_scope||'|'||p_idempotency_key::text,0));
  select * into v_existing from private.admin_action_audit where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='admin_idempotency_conflict';end if;
    return (v_existing.metadata->'receipt')||jsonb_build_object('idempotent',true);
  end if;
  perform 1 from private.advertising_canary_policy where singleton for update;
  if exists(select 1 from private.advertising_billing_authorization_windows where status='OPEN') then
    raise exception using errcode='55000',message='advertising_billing_authorization_window_open';
  end if;
  select * into v_rate from private.advertising_billing_rate_versions where id=p_rate_id for update;
  if not found then raise exception using errcode='P0002',message='advertising_billing_rate_not_found';end if;
  if v_rate.state<>'draft' then raise exception using errcode='55000',message='advertising_billing_rate_not_draft';end if;
  if v_rate.effective_from < clock_timestamp() then
    raise exception using errcode='22023',message='advertising_billing_rate_backdating_forbidden';
  end if;
  perform private.assert_advertising_billing_rate_input(
    v_rate.objective,v_rate.billable_event_type,v_rate.placement_code,v_rate.scope,
    v_rate.scope_campaign_id,v_rate.rate_bdag,v_rate.effective_from,v_rate.effective_to
  );
  update private.advertising_billing_rate_versions set
    state='published',published_by=v_actor,published_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=p_rate_id returning * into v_rate;
  v_receipt:=jsonb_build_object('rate_id',v_rate.id,'state',v_rate.state,'published_at',v_rate.published_at,'idempotent',false);
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,target_ref,
    outcome,reason,financial_effect,contains_pii,idempotency_scope,idempotency_key,request_fingerprint,metadata
  ) values(
    v_actor,'human_admin',private.admin_active_role_codes(v_actor),'advertising.rates.manage','advertising',
    'advertising.rate.publish','advertising_billing_rate',v_rate.id,
    v_rate.objective||':'||v_rate.billable_event_type||':'||v_rate.placement_code,
    'succeeded',btrim(p_reason),true,false,v_scope,p_idempotency_key,v_fingerprint,
    jsonb_build_object('receipt',v_receipt,'state','published','currency','BDAG')
  );
  return v_receipt;
end;
$$;

create or replace function public.admin_retire_advertising_billing_rate_v2(
  p_rate_id uuid,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;v_scope text;v_fingerprint text;v_existing private.admin_action_audit;
  v_rate private.advertising_billing_rate_versions;v_receipt jsonb;v_now timestamptz:=clock_timestamp();
begin
  v_actor:=public.admin_require_capability('advertising.rates.manage');
  if p_idempotency_key is null then raise exception using errcode='22023',message='advertising_idempotency_key_required';end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null or char_length(btrim(p_reason))>500 then
    raise exception using errcode='22023',message='advertising_billing_rate_reason_required';
  end if;
  v_scope:='v1|human|'||v_actor::text||'|advertising.rates.manage|advertising.rate.retire';
  v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object('rate_id',p_rate_id,'reason',btrim(p_reason)));
  perform pg_advisory_xact_lock(hashtextextended(v_scope||'|'||p_idempotency_key::text,0));
  select * into v_existing from private.admin_action_audit where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='admin_idempotency_conflict';end if;
    return (v_existing.metadata->'receipt')||jsonb_build_object('idempotent',true);
  end if;
  perform 1 from private.advertising_canary_policy where singleton for update;
  if exists(select 1 from private.advertising_billing_authorization_windows where status='OPEN') then
    raise exception using errcode='55000',message='advertising_billing_authorization_window_open';
  end if;
  select * into v_rate from private.advertising_billing_rate_versions where id=p_rate_id for update;
  if not found then raise exception using errcode='P0002',message='advertising_billing_rate_not_found';end if;
  if v_rate.state<>'published' then raise exception using errcode='55000',message='advertising_billing_rate_not_published';end if;
  update private.advertising_billing_rate_versions set
    state='retired',effective_to=greatest(v_rate.effective_from,v_now),
    retired_by=v_actor,retired_at=v_now,updated_at=v_now
  where id=p_rate_id returning * into v_rate;
  v_receipt:=jsonb_build_object('rate_id',v_rate.id,'state',v_rate.state,'retired_at',v_rate.retired_at,'idempotent',false);
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,target_ref,
    outcome,reason,financial_effect,contains_pii,idempotency_scope,idempotency_key,request_fingerprint,metadata
  ) values(
    v_actor,'human_admin',private.admin_active_role_codes(v_actor),'advertising.rates.manage','advertising',
    'advertising.rate.retire','advertising_billing_rate',v_rate.id,
    v_rate.objective||':'||v_rate.billable_event_type||':'||v_rate.placement_code,
    'succeeded',btrim(p_reason),true,false,v_scope,p_idempotency_key,v_fingerprint,
    jsonb_build_object('receipt',v_receipt,'state','retired','currency','BDAG')
  );
  return v_receipt;
end;
$$;

revoke all on function public.search_admin_advertising_billing_rates(text,text,timestamptz,uuid,integer)
from public, anon, authenticated, service_role;
grant execute on function public.search_admin_advertising_billing_rates(text,text,timestamptz,uuid,integer)
to authenticated;

revoke all on function public.admin_create_advertising_billing_rate_draft_v2(text,text,text,text,uuid,numeric,timestamptz,uuid)
from public, anon, authenticated, service_role;
grant execute on function public.admin_create_advertising_billing_rate_draft_v2(text,text,text,text,uuid,numeric,timestamptz,uuid)
to authenticated;
revoke all on function public.admin_update_advertising_billing_rate_draft_v2(uuid,text,text,text,text,uuid,numeric,timestamptz,timestamptz,uuid)
from public, anon, authenticated, service_role;
grant execute on function public.admin_update_advertising_billing_rate_draft_v2(uuid,text,text,text,text,uuid,numeric,timestamptz,timestamptz,uuid)
to authenticated;
revoke all on function public.admin_publish_advertising_billing_rate_v2(uuid,text,uuid)
from public, anon, authenticated, service_role;
grant execute on function public.admin_publish_advertising_billing_rate_v2(uuid,text,uuid)
to authenticated;
revoke all on function public.admin_retire_advertising_billing_rate_v2(uuid,text,uuid)
from public, anon, authenticated, service_role;
grant execute on function public.admin_retire_advertising_billing_rate_v2(uuid,text,uuid)
to authenticated;

create or replace function public.search_admin_finance_audit(
  p_action text default null,
  p_actor_id uuid default null,
  p_target_type text default null,
  p_target_id uuid default null,
  p_outcome text default null,
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('finance.audit.read');
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception using errcode='22023',message='invalid_cursor';
  end if;
  return (
    with page as (
      select a.id,a.actor_id,a.actor_kind,a.actor_role_snapshot,a.actor_capability,a.domain,a.action,
        a.target_type,a.target_id,a.reason,a.outcome,a.financial_effect,a.contains_pii,a.metadata,a.created_at,
        p.username,p.display_name,p.avatar_url
      from private.admin_action_audit a
      left join public.user_profiles p on p.id=a.actor_id
      where (
          a.financial_effect
          or a.domain='finance'
          or (
            a.domain='advertising'
            and a.action in (
              'advertising.rate.draft.create','advertising.rate.draft.update',
              'advertising.rate.publish','advertising.rate.retire'
            )
          )
        )
        and private.admin_audit_row_visible(a.domain,a.financial_effect)
        and (p_action is null or a.action=p_action)
        and (p_actor_id is null or a.actor_id=p_actor_id)
        and (p_target_type is null or a.target_type=p_target_type)
        and (p_target_id is null or a.target_id=p_target_id)
        and (p_outcome is null or a.outcome=p_outcome)
        and (p_created_from is null or a.created_at>=p_created_from)
        and (p_created_to is null or a.created_at<p_created_to)
        and (p_cursor_created_at is null or (a.created_at,a.id)<(p_cursor_created_at,p_cursor_id))
      order by a.created_at desc,a.id desc limit v_limit
    )
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'id',id,'actor',case when actor_id is null then null else jsonb_build_object(
          'id',actor_id,'username',username,'display_name',display_name,'avatar_url',avatar_url
        ) end,
        'actor_kind',actor_kind,'actor_role_snapshot',actor_role_snapshot,'actor_capability',actor_capability,
        'domain',domain,'action',action,'target_type',target_type,'target_id',target_id,
        'target_ref',null,'reason',null,'outcome',outcome,'financial_effect',financial_effect,
        'contains_pii',contains_pii,'created_at',created_at,
        'metadata',private.admin_audit_safe_metadata(metadata,contains_pii,true)
      ) order by created_at desc,id desc) from page),'[]'::jsonb),
      'next_cursor',(select jsonb_build_object('created_at',created_at,'id',id)
        from page order by created_at,id limit 1)
    )
  );
end;
$$;

revoke all on function public.search_admin_finance_audit(
  text,uuid,text,uuid,text,timestamptz,timestamptz,timestamptz,uuid,integer
) from public,anon,authenticated,service_role;
grant execute on function public.search_admin_finance_audit(
  text,uuid,text,uuid,text,timestamptz,timestamptz,timestamptz,uuid,integer
) to authenticated;

-- ---------------------------------------------------------------------------
-- Sole launch-mode authority and five-mode deferred envelope
-- ---------------------------------------------------------------------------

create or replace function private.advertising_assert_canary_launch_envelope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_canary private.advertising_canary_policy%rowtype;
  v_finance private.advertising_finance_policy%rowtype;
  v_lifecycle private.advertising_campaign_lifecycle_policy%rowtype;
  v_delivery private.advertising_delivery_policy%rowtype;
  v_enabled_count integer;
  v_open private.advertising_billing_authorization_windows%rowtype;
  v_coverage jsonb;
begin
  select * into strict v_canary from private.advertising_canary_policy where singleton;
  select * into strict v_finance from private.advertising_finance_policy where singleton;
  select * into strict v_lifecycle from private.advertising_campaign_lifecycle_policy where singleton;
  select * into strict v_delivery from private.advertising_delivery_policy where singleton;
  select count(*) into v_enabled_count
  from private.advertising_placement_catalog placement where placement.v2_delivery_enabled;
  select * into v_open
  from private.advertising_billing_authorization_windows window_row
  where window_row.status='OPEN';

  if v_canary.canary_enabled <> (v_canary.launch_mode in ('CANARY_DELIVERY','CANARY_BILLING')) then
    raise exception using errcode='23514',message='advertising_launch_mode_canary_authority_conflict';
  end if;

  if v_canary.launch_mode='DISARMED' then
    if v_finance.funding_enabled or v_finance.spend_enabled or v_finance.settlement_enabled
      or v_lifecycle.activation_enabled or v_lifecycle.automatic_transitions_enabled
      or v_delivery.global_v2_delivery_enabled or v_enabled_count<>0 or v_open.id is not null then
      raise exception using errcode='23514',message='advertising_launch_envelope_violation',detail='mode=DISARMED';
    end if;
  elsif v_canary.launch_mode='CANARY_DELIVERY' then
    if not v_finance.funding_enabled or v_finance.spend_enabled or v_finance.settlement_enabled
      or not v_lifecycle.activation_enabled or v_lifecycle.automatic_transitions_enabled
      or not v_delivery.global_v2_delivery_enabled or v_enabled_count<>1
      or not exists(
        select 1 from private.advertising_placement_catalog placement
        where placement.code=v_canary.placement_code and placement.v2_delivery_enabled
      ) or v_open.id is not null then
      raise exception using errcode='23514',message='advertising_launch_envelope_violation',detail='mode=CANARY_DELIVERY';
    end if;
  elsif v_canary.launch_mode='CANARY_BILLING' then
    if v_finance.funding_enabled or not v_finance.spend_enabled or v_finance.settlement_enabled
      or not v_lifecycle.activation_enabled or v_lifecycle.automatic_transitions_enabled
      or not v_delivery.global_v2_delivery_enabled or v_enabled_count<>1
      or not exists(
        select 1 from private.advertising_placement_catalog placement
        where placement.code=v_canary.placement_code and placement.v2_delivery_enabled
      ) or v_open.id is null or v_open.mode<>'CANARY_BILLING'
      or v_open.scope<>'canary_campaign' or v_open.campaign_id<>v_canary.campaign_id
      or v_open.opened_at<>v_canary.enabled_at or v_open.expires_at<>v_canary.expires_at
      or v_open.max_spend_bdag<>v_canary.max_spend_bdag
      or v_open.max_billable_events<>v_canary.max_billable_events then
      raise exception using errcode='23514',message='advertising_launch_envelope_violation',detail='mode=CANARY_BILLING';
    end if;
    v_coverage:=private.advertising_rate_coverage_at(
      'CANARY_BILLING',v_canary.campaign_id,v_canary.placement_code,
      v_canary.enabled_at,v_canary.expires_at
    );
    if not coalesce((v_coverage->>'ready')::boolean,false) then
      raise exception using errcode='23514',message='advertising_canary_billing_rate_coverage_incomplete';
    end if;
  elsif v_canary.launch_mode='SETTLEMENT_ONLY' then
    if v_finance.funding_enabled or v_finance.spend_enabled or not v_finance.settlement_enabled
      or v_lifecycle.activation_enabled or v_lifecycle.automatic_transitions_enabled
      or v_delivery.global_v2_delivery_enabled or v_enabled_count<>0 or v_open.id is not null then
      raise exception using errcode='23514',message='advertising_launch_envelope_violation',detail='mode=SETTLEMENT_ONLY';
    end if;
  elsif v_canary.launch_mode='PRODUCTION' then
    if not v_finance.funding_enabled or not v_finance.spend_enabled or not v_finance.settlement_enabled
      or not v_lifecycle.activation_enabled or not v_lifecycle.automatic_transitions_enabled
      or not v_delivery.global_v2_delivery_enabled or v_enabled_count<>1
      or not exists(
        select 1 from private.advertising_placement_catalog placement
        where placement.code='social_feed' and placement.v2_delivery_enabled
      ) or v_open.id is null or v_open.mode<>'PRODUCTION' or v_open.scope<>'global'
      or v_open.campaign_id is not null or v_open.expires_at is not null then
      raise exception using errcode='23514',message='advertising_launch_envelope_violation',detail='mode=PRODUCTION';
    end if;
    v_coverage:=private.advertising_rate_coverage_at('PRODUCTION',null,'social_feed',v_open.opened_at,null);
    if not coalesce((v_coverage->>'ready')::boolean,false) then
      raise exception using errcode='23514',message='advertising_production_rate_coverage_incomplete';
    end if;
  else
    raise exception using errcode='23514',message='advertising_launch_mode_invalid';
  end if;
  return null;
end;
$$;

revoke all on function private.advertising_assert_canary_launch_envelope()
from public,anon,authenticated,service_role;

create or replace function public.set_advertising_launch_mode_v2(
  p_launch_mode text,
  p_idempotency_key uuid,
  p_business_account_id uuid default null,
  p_ad_account_id uuid default null,
  p_campaign_id uuid default null,
  p_viewer_user_id uuid default null,
  p_placement_code text default null,
  p_expires_at timestamptz default null,
  p_max_budget_bdag numeric default null,
  p_max_impressions integer default null,
  p_max_spend_bdag numeric default null,
  p_max_billable_events integer default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text:=coalesce(current_setting('request.jwt.claim.role',true),session_user,current_user);
  v_now timestamptz:=clock_timestamp();
  v_from_mode text;
  v_window_id uuid;
  v_fingerprint text;
  v_existing private.admin_action_audit;
  v_receipt jsonb;
  v_campaign private.advertising_campaigns%rowtype;
  v_finance private.advertising_campaign_finance%rowtype;
  v_coverage jsonb;
begin
  if v_role not in ('service_role','postgres','supabase_admin') then
    raise exception using errcode='42501',message='advertising_internal_authority_required';
  end if;
  if p_launch_mode not in ('DISARMED','CANARY_DELIVERY','CANARY_BILLING','SETTLEMENT_ONLY','PRODUCTION') then
    raise exception using errcode='22023',message='advertising_launch_mode_invalid';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode='22023',message='advertising_idempotency_key_required';
  end if;
  v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object(
    'launch_mode',p_launch_mode,'business_account_id',p_business_account_id,
    'ad_account_id',p_ad_account_id,'campaign_id',p_campaign_id,
    'viewer_user_id',p_viewer_user_id,'placement_code',p_placement_code,
    'expires_at',p_expires_at,'max_budget_bdag',p_max_budget_bdag,
    'max_impressions',p_max_impressions,'max_spend_bdag',p_max_spend_bdag,
    'max_billable_events',p_max_billable_events
  ));

  perform 1 from private.advertising_canary_policy where singleton for update;
  select launch_mode into strict v_from_mode from private.advertising_canary_policy where singleton;
  select * into v_existing from private.admin_action_audit
  where idempotency_scope='v1|system|advertising|launch_mode.transition'
    and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';
    end if;
    return (v_existing.metadata->'receipt')||jsonb_build_object('idempotent',true);
  end if;

  update private.advertising_billing_authorization_windows
  set status='CLOSED',closed_at=v_now,updated_at=v_now
  where status='OPEN';

  if p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING') then
    if p_business_account_id is null or p_ad_account_id is null or p_campaign_id is null
      or p_viewer_user_id is null or p_placement_code is null or p_expires_at is null
      or p_expires_at<=v_now or p_max_budget_bdag is null or p_max_budget_bdag<=0
      or p_max_impressions is null or p_max_impressions<1 then
      raise exception using errcode='22023',message='advertising_canary_launch_target_invalid';
    end if;
    select campaign.* into v_campaign
    from private.advertising_campaigns campaign
    join private.ad_accounts account on account.id=campaign.ad_account_id
    join private.business_accounts business on business.id=account.business_account_id
    where campaign.id=p_campaign_id and account.id=p_ad_account_id
      and business.id=p_business_account_id and business.owner_user_id=p_viewer_user_id
    for update of campaign;
    if not found or v_campaign.status not in ('draft','paused') then
      raise exception using errcode='55000',message='advertising_canary_campaign_not_eligible';
    end if;
    if p_placement_code<>'social_feed' or not exists(
      select 1
      from private.advertising_ad_sets ad_set
      join private.advertising_placement_selections selection
        on selection.ad_set_id=ad_set.id and selection.status='draft'
      join lateral(
        select version.id
        from private.advertising_placement_selection_versions version
        where version.placement_selection_id=selection.id
        order by version.version_number desc limit 1
      ) latest on true
      join private.advertising_placement_selection_items item
        on item.placement_selection_version_id=latest.id
      where ad_set.campaign_id=p_campaign_id and item.placement_code=p_placement_code
    ) or exists(
      select 1
      from private.advertising_ad_sets ad_set
      join private.advertising_placement_selections selection
        on selection.ad_set_id=ad_set.id and selection.status='draft'
      join lateral(
        select version.id
        from private.advertising_placement_selection_versions version
        where version.placement_selection_id=selection.id
        order by version.version_number desc limit 1
      ) latest on true
      join private.advertising_placement_selection_items item
        on item.placement_selection_version_id=latest.id
      where ad_set.campaign_id=p_campaign_id and item.placement_code<>p_placement_code
    ) then
      raise exception using errcode='22023',message='advertising_canary_placement_invalid';
    end if;
    select * into v_finance from private.advertising_campaign_finance finance
    where finance.campaign_id=p_campaign_id for update;
    if not found or v_finance.budget_bdag<>p_max_budget_bdag
      or v_finance.spent_bdag<>0 or v_finance.released_bdag<>0 then
      raise exception using errcode='55000',message='advertising_canary_finance_invalid';
    end if;
    if p_launch_mode='CANARY_BILLING' then
      if v_finance.finance_status<>'funded' or p_max_spend_bdag is null or p_max_spend_bdag<=0
        or p_max_spend_bdag>p_max_budget_bdag or p_max_billable_events is null or p_max_billable_events<1 then
        raise exception using errcode='55000',message='advertising_canary_billing_caps_invalid';
      end if;
      v_coverage:=private.advertising_rate_coverage_at(
        'CANARY_BILLING',p_campaign_id,p_placement_code,v_now,p_expires_at
      );
      if not coalesce((v_coverage->>'ready')::boolean,false) then
        raise exception using errcode='55000',message='advertising_canary_billing_rate_coverage_incomplete';
      end if;
      insert into private.advertising_billing_authorization_windows(
        mode,scope,campaign_id,opened_at,expires_at,max_spend_bdag,max_billable_events
      ) values(
        'CANARY_BILLING','canary_campaign',p_campaign_id,v_now,p_expires_at,p_max_spend_bdag,p_max_billable_events
      ) returning id into v_window_id;
    elsif p_max_spend_bdag is not null or p_max_billable_events is not null then
      raise exception using errcode='22023',message='advertising_delivery_canary_billing_caps_forbidden';
    end if;
  else
    if p_business_account_id is not null or p_ad_account_id is not null or p_campaign_id is not null
      or p_viewer_user_id is not null or p_placement_code is not null or p_expires_at is not null
      or p_max_budget_bdag is not null or p_max_impressions is not null
      or p_max_spend_bdag is not null or p_max_billable_events is not null then
      raise exception using errcode='22023',message='advertising_non_canary_target_forbidden';
    end if;
    if p_launch_mode='PRODUCTION' then
      v_coverage:=private.advertising_rate_coverage_at('PRODUCTION',null,'social_feed',v_now,null);
      if not coalesce((v_coverage->>'ready')::boolean,false) then
        raise exception using errcode='55000',message='advertising_production_rate_coverage_incomplete';
      end if;
      insert into private.advertising_billing_authorization_windows(mode,scope,opened_at)
      values('PRODUCTION','global',v_now) returning id into v_window_id;
    end if;
  end if;

  update private.advertising_finance_policy set
    funding_enabled=p_launch_mode in ('CANARY_DELIVERY','PRODUCTION'),
    spend_enabled=p_launch_mode in ('CANARY_BILLING','PRODUCTION'),
    settlement_enabled=p_launch_mode in ('SETTLEMENT_ONLY','PRODUCTION'),
    updated_at=v_now
  where singleton;
  update private.advertising_campaign_lifecycle_policy set
    activation_enabled=p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING','PRODUCTION'),
    automatic_transitions_enabled=p_launch_mode='PRODUCTION',updated_at=v_now
  where singleton;
  update private.advertising_delivery_policy set
    global_v2_delivery_enabled=p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING','PRODUCTION'),
    updated_at=v_now
  where singleton;
  update private.advertising_placement_catalog set
    v2_delivery_enabled=(
      p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING') and code=p_placement_code
      or p_launch_mode='PRODUCTION' and code='social_feed'
    ),updated_at=v_now;
  update private.advertising_canary_policy set
    launch_mode=p_launch_mode,
    canary_enabled=p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING'),
    business_account_id=case when p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING') then p_business_account_id end,
    ad_account_id=case when p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING') then p_ad_account_id end,
    campaign_id=case when p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING') then p_campaign_id end,
    viewer_user_id=case when p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING') then p_viewer_user_id end,
    placement_code=case when p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING') then p_placement_code end,
    max_budget_bdag=case when p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING') then p_max_budget_bdag end,
    max_impressions=case when p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING') then p_max_impressions end,
    max_spend_bdag=case when p_launch_mode='CANARY_BILLING' then p_max_spend_bdag end,
    max_billable_events=case when p_launch_mode='CANARY_BILLING' then p_max_billable_events end,
    enabled_at=case when p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING') then v_now end,
    expires_at=case when p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING') then p_expires_at end,
    updated_at=v_now
  where singleton;

  set constraints all immediate;
  v_receipt:=jsonb_strip_nulls(jsonb_build_object(
    'from_mode',v_from_mode,'to_mode',p_launch_mode,'authorization_window_id',v_window_id,
    'campaign_id',p_campaign_id,'placement_code',p_placement_code,'transitioned_at',v_now,
    'opened_at',case when v_window_id is not null then v_now end,
    'expires_at',case when p_launch_mode='CANARY_BILLING' then p_expires_at end,
    'idempotent',false
  ));
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,target_ref,
    outcome,financial_effect,contains_pii,idempotency_scope,idempotency_key,request_fingerprint,metadata
  ) values(
    null,'system_workflow','{}'::text[],null,'advertising',
    'advertising.launch_mode.transition','advertising_control_plane',
    '00000000-0000-0000-0000-000000000009'::uuid,p_launch_mode,'succeeded',true,false,
    'v1|system|advertising|launch_mode.transition',p_idempotency_key,v_fingerprint,
    jsonb_build_object('receipt',v_receipt)
  );
  return v_receipt;
end;
$$;

revoke all on function public.set_advertising_launch_mode_v2(
  text,uuid,uuid,uuid,uuid,uuid,text,timestamptz,numeric,integer,numeric,integer
) from public,anon,authenticated,service_role;
grant execute on function public.set_advertising_launch_mode_v2(
  text,uuid,uuid,uuid,uuid,uuid,text,timestamptz,numeric,integer,numeric,integer
) to service_role;

-- ---------------------------------------------------------------------------
-- One materialization per billable event and synchronous reservation classifier
-- ---------------------------------------------------------------------------

create table private.advertising_event_billing_materializations (
  id uuid primary key default gen_random_uuid(),
  billable_event_id uuid not null unique references private.advertising_events(id),
  campaign_id uuid not null references private.advertising_campaigns(id),
  authorization_window_id uuid references private.advertising_billing_authorization_windows(id),
  billing_rate_version_id uuid references private.advertising_billing_rate_versions(id),
  status text not null check (status in (
    'pending','charged','not_billable_no_rate','not_billable_outside_authorization',
    'not_billable_before_cutover','not_billable_objective','budget_exhausted'
  )),
  amount_bdag numeric(20,8) not null default 0 check (amount_bdag>=0 and amount_bdag=round(amount_bdag,8)),
  financial_event_id uuid unique references private.advertising_financial_events(id),
  reason_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  finalized_at timestamptz,
  constraint advertising_event_billing_materialization_shape_chk check (
    (
      status='pending' and amount_bdag>0 and authorization_window_id is not null
      and billing_rate_version_id is not null and financial_event_id is null
      and finalized_at is null
    ) or (
      status='charged' and amount_bdag>0 and authorization_window_id is not null
      and billing_rate_version_id is not null and financial_event_id is not null
      and finalized_at is not null
    ) or (
      status='budget_exhausted' and amount_bdag=0 and authorization_window_id is not null
      and billing_rate_version_id is not null and financial_event_id is null
      and finalized_at is not null
    ) or (
      status in (
        'not_billable_no_rate','not_billable_outside_authorization',
        'not_billable_before_cutover','not_billable_objective'
      ) and amount_bdag=0 and financial_event_id is null and finalized_at is not null
    )
  )
);

create index advertising_event_billing_pending_idx
on private.advertising_event_billing_materializations(status,created_at,id)
where status='pending';
create index advertising_event_billing_campaign_status_idx
on private.advertising_event_billing_materializations(campaign_id,status,created_at);
create index advertising_event_billing_window_status_idx
on private.advertising_event_billing_materializations(authorization_window_id,status);
create index advertising_event_billing_rate_idx
on private.advertising_event_billing_materializations(billing_rate_version_id);

revoke all on table private.advertising_event_billing_materializations
from public,anon,authenticated,service_role;

create or replace function private.guard_advertising_event_billing_materialization()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE' then
    raise exception using errcode='23514',message='advertising_billing_materialization_delete_forbidden';
  end if;
  if old.status<>'pending' then
    raise exception using errcode='23514',message='advertising_billing_materialization_terminal';
  end if;
  if new.id<>old.id or new.billable_event_id<>old.billable_event_id
    or new.campaign_id<>old.campaign_id
    or new.authorization_window_id is distinct from old.authorization_window_id
    or new.billing_rate_version_id is distinct from old.billing_rate_version_id
    or new.created_at<>old.created_at then
    raise exception using errcode='23514',message='advertising_billing_materialization_provenance_immutable';
  end if;
  if new.status not in ('charged','budget_exhausted','not_billable_outside_authorization') then
    raise exception using errcode='23514',message='advertising_billing_materialization_transition_invalid';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_advertising_event_billing_materialization()
from public,anon,authenticated,service_role;
create trigger advertising_event_billing_materialization_guard
before update or delete on private.advertising_event_billing_materializations
for each row execute function private.guard_advertising_event_billing_materialization();

create or replace function private.advertising_active_pending_reserved_bdag(
  p_campaign_id uuid,p_at_time timestamptz default statement_timestamp()
)
returns numeric
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(sum(materialization.amount_bdag),0)::numeric(20,8)
  from private.advertising_event_billing_materializations materialization
  join private.advertising_billing_authorization_windows window_row
    on window_row.id=materialization.authorization_window_id
  where materialization.campaign_id=p_campaign_id
    and materialization.status='pending'
    and window_row.status='OPEN'
    and window_row.opened_at<=coalesce(p_at_time,statement_timestamp())
    and (window_row.expires_at is null or coalesce(p_at_time,statement_timestamp())<window_row.expires_at)
$$;

revoke all on function private.advertising_active_pending_reserved_bdag(uuid,timestamptz)
from public,anon,authenticated,service_role;

create or replace function private.advertising_campaign_billing_state_at(
  p_campaign_id uuid,p_at_time timestamptz default statement_timestamp()
)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'campaign_id',finance.campaign_id,
    'funded_bdag',finance.funded_bdag,
    'spent_bdag',finance.spent_bdag,
    'released_bdag',finance.released_bdag,
    'pending_reserved_bdag',private.advertising_active_pending_reserved_bdag(finance.campaign_id,p_at_time),
    'available_to_reserve_bdag',
      finance.funded_bdag-finance.spent_bdag-finance.released_bdag
      -private.advertising_active_pending_reserved_bdag(finance.campaign_id,p_at_time),
    'reservation_consistent',
      private.advertising_active_pending_reserved_bdag(finance.campaign_id,p_at_time)
      <=finance.funded_bdag-finance.spent_bdag-finance.released_bdag
  )
  from private.advertising_campaign_finance finance
  where finance.campaign_id=p_campaign_id
$$;

revoke all on function private.advertising_campaign_billing_state_at(uuid,timestamptz)
from public,anon,authenticated,service_role;

create or replace function private.classify_advertising_billable_event_v2()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_policy private.advertising_canary_policy%rowtype;
  v_campaign private.advertising_campaigns%rowtype;
  v_capability private.advertising_objective_capabilities%rowtype;
  v_window private.advertising_billing_authorization_windows%rowtype;
  v_rate private.advertising_billing_rate_versions%rowtype;
  v_finance private.advertising_campaign_finance%rowtype;
  v_pending numeric(20,8):=0;
  v_window_amount numeric(20,8):=0;
  v_window_count integer:=0;
begin
  if new.event_type not in ('impression','click') then return new; end if;
  select * into strict v_policy from private.advertising_canary_policy where singleton for update;
  if new.occurred_at<v_policy.billing_cutover_at then return new; end if;

  select * into strict v_campaign from private.advertising_campaigns where id=new.campaign_id;
  select * into v_capability from private.advertising_objective_capabilities
  where objective=v_campaign.objective;
  if not found or not v_capability.billing_runtime_ready
    or v_capability.billable_event_type is distinct from new.event_type then
    insert into private.advertising_event_billing_materializations(
      billable_event_id,campaign_id,status,reason_code,finalized_at
    ) values(new.id,new.campaign_id,'not_billable_objective','objective_event_not_billable',clock_timestamp());
    return new;
  end if;

  if v_policy.launch_mode not in ('CANARY_BILLING','PRODUCTION') then
    insert into private.advertising_event_billing_materializations(
      billable_event_id,campaign_id,status,reason_code,finalized_at
    ) values(new.id,new.campaign_id,'not_billable_outside_authorization','launch_mode_not_billing',clock_timestamp());
    return new;
  end if;
  select * into v_window from private.advertising_billing_authorization_windows window_row
  where window_row.status='OPEN' for update;
  if not found or new.occurred_at<v_window.opened_at
    or (v_window.expires_at is not null and new.occurred_at>=v_window.expires_at)
    or (v_policy.launch_mode='CANARY_BILLING' and (
      v_window.mode<>'CANARY_BILLING' or v_window.campaign_id<>new.campaign_id
      or v_policy.campaign_id<>new.campaign_id or v_policy.viewer_user_id is distinct from new.viewer_user_id
      or v_policy.placement_code<>new.placement_code
    ))
    or (v_policy.launch_mode='PRODUCTION' and (v_window.mode<>'PRODUCTION' or v_window.scope<>'global')) then
    insert into private.advertising_event_billing_materializations(
      billable_event_id,campaign_id,authorization_window_id,status,reason_code,finalized_at
    ) values(new.id,new.campaign_id,v_window.id,'not_billable_outside_authorization','billing_window_not_applicable',clock_timestamp());
    return new;
  end if;

  v_rate:=private.resolve_advertising_billing_rate_v2(
    new.campaign_id,new.event_type,new.placement_code,new.occurred_at,v_policy.launch_mode
  );
  if v_rate.id is null then
    insert into private.advertising_event_billing_materializations(
      billable_event_id,campaign_id,authorization_window_id,status,reason_code,finalized_at
    ) values(new.id,new.campaign_id,v_window.id,'not_billable_no_rate','no_applicable_rate',clock_timestamp());
    return new;
  end if;

  select * into v_finance from private.advertising_campaign_finance finance
  where finance.campaign_id=new.campaign_id for update;
  v_pending:=private.advertising_active_pending_reserved_bdag(new.campaign_id,new.occurred_at);
  if not found or v_finance.finance_status<>'funded'
    or v_pending>v_finance.funded_bdag-v_finance.spent_bdag-v_finance.released_bdag
    or v_rate.rate_bdag>v_finance.funded_bdag-v_finance.spent_bdag-v_finance.released_bdag-v_pending then
    insert into private.advertising_event_billing_materializations(
      billable_event_id,campaign_id,authorization_window_id,billing_rate_version_id,
      status,amount_bdag,reason_code,finalized_at
    ) values(new.id,new.campaign_id,v_window.id,v_rate.id,'budget_exhausted',0,'insufficient_unreserved_budget',clock_timestamp());
    return new;
  end if;

  if v_policy.launch_mode='CANARY_BILLING' then
    select coalesce(sum(case when status='charged' then amount_bdag when status='pending' then amount_bdag else 0 end),0),
      count(*) filter(where status in ('pending','charged'))
    into v_window_amount,v_window_count
    from private.advertising_event_billing_materializations
    where authorization_window_id=v_window.id;
    if v_window_amount+v_rate.rate_bdag>v_window.max_spend_bdag
      or v_window_count+1>v_window.max_billable_events then
      insert into private.advertising_event_billing_materializations(
        billable_event_id,campaign_id,authorization_window_id,billing_rate_version_id,
        status,amount_bdag,reason_code,finalized_at
      ) values(new.id,new.campaign_id,v_window.id,v_rate.id,'budget_exhausted',0,'canary_billing_cap_exhausted',clock_timestamp());
      return new;
    end if;
  end if;

  insert into private.advertising_event_billing_materializations(
    billable_event_id,campaign_id,authorization_window_id,billing_rate_version_id,status,amount_bdag
  ) values(new.id,new.campaign_id,v_window.id,v_rate.id,'pending',v_rate.rate_bdag);
  return new;
end;
$$;

revoke all on function private.classify_advertising_billable_event_v2()
from public,anon,authenticated,service_role;
create trigger advertising_billable_event_classifier
after insert on private.advertising_events
for each row when (new.event_type in ('impression','click'))
execute function private.classify_advertising_billable_event_v2();

alter table private.advertising_financial_events
  add column billing_rate_version_id uuid references private.advertising_billing_rate_versions(id),
  add column unit_rate_bdag numeric(20,8),
  add constraint advertising_financial_events_rate_provenance_chk check (
    (event_type='spend' and billing_rate_version_id is not null
      and unit_rate_bdag=amount_bdag and unit_rate_bdag>0)
    or (event_type in ('fund','release') and billing_rate_version_id is null and unit_rate_bdag is null)
  );

create index advertising_financial_events_rate_version_idx
on private.advertising_financial_events(billing_rate_version_id)
where billing_rate_version_id is not null;

create or replace function private.advertising_canary_spend_allowed(
  p_billable_event_id uuid,
  p_at_time timestamptz default statement_timestamp()
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from private.advertising_canary_policy launch
    join private.advertising_events event on event.id=p_billable_event_id
    join private.advertising_event_billing_materializations materialization
      on materialization.billable_event_id=event.id
    join private.advertising_billing_authorization_windows window_row
      on window_row.id=materialization.authorization_window_id
    join private.advertising_billing_rate_versions rate
      on rate.id=materialization.billing_rate_version_id
    where launch.singleton
      and launch.launch_mode='CANARY_BILLING'
      and launch.canary_enabled
      and launch.campaign_id=event.campaign_id
      and launch.viewer_user_id is not distinct from event.viewer_user_id
      and launch.placement_code=event.placement_code
      and event.occurred_at>=launch.enabled_at
      and event.occurred_at<launch.expires_at
      and window_row.status='OPEN'
      and window_row.mode='CANARY_BILLING'
      and window_row.scope='canary_campaign'
      and window_row.campaign_id=event.campaign_id
      and window_row.opened_at<=coalesce(p_at_time,statement_timestamp())
      and coalesce(p_at_time,statement_timestamp())<window_row.expires_at
      and rate.scope='canary_campaign'
      and rate.scope_campaign_id=event.campaign_id
      and (
        select coalesce(sum(candidate.amount_bdag),0)
        from private.advertising_event_billing_materializations candidate
        where candidate.authorization_window_id=window_row.id
          and candidate.status in ('pending','charged')
      )<=window_row.max_spend_bdag
      and (
        select count(*)
        from private.advertising_event_billing_materializations candidate
        where candidate.authorization_window_id=window_row.id
          and candidate.status in ('pending','charged')
      )<=window_row.max_billable_events
  )
$$;

revoke all on function private.advertising_canary_spend_allowed(uuid,timestamptz)
from public,anon,authenticated,service_role;

create or replace function public.spend_advertising_campaign_budget_v2(
  p_campaign_id uuid,
  p_billable_event_id uuid,
  p_amount_bdag numeric,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text:=coalesce((select auth.role()),'');
  v_launch private.advertising_canary_policy;
  v_policy private.advertising_finance_policy;
  v_finance private.advertising_campaign_finance;
  v_event private.advertising_events;
  v_prior private.advertising_financial_events;
  v_materialization private.advertising_event_billing_materializations;
  v_window private.advertising_billing_authorization_windows;
  v_rate private.advertising_billing_rate_versions;
  v_amount numeric(20,8);
  v_escrow uuid;v_revenue uuid;v_tx uuid;v_financial_event_id uuid;
  v_window_amount numeric(20,8);v_window_count integer;
begin
  if v_role<>'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception using errcode='42501',message='advertising_finance_internal_only';
  end if;
  if p_idempotency_key is null or p_billable_event_id is null or p_amount_bdag is null
    or p_amount_bdag<=0 or p_amount_bdag<>round(p_amount_bdag,8) then
    raise exception using errcode='22023',message='advertising_spend_invalid';
  end if;
  v_amount:=p_amount_bdag::numeric(20,8);

  select * into strict v_launch from private.advertising_canary_policy where singleton for update;
  select * into v_materialization
  from private.advertising_event_billing_materializations
  where billable_event_id=p_billable_event_id;
  if not found then raise exception using errcode='22023',message='advertising_billing_materialization_required';end if;
  select * into v_window from private.advertising_billing_authorization_windows
  where id=v_materialization.authorization_window_id for update;
  select * into v_finance from private.advertising_campaign_finance
  where campaign_id=p_campaign_id for update;
  if not found then raise exception using errcode='P0002',message='advertising_campaign_finance_not_found';end if;
  select * into strict v_materialization
  from private.advertising_event_billing_materializations
  where billable_event_id=p_billable_event_id for update;

  select * into v_prior from private.advertising_financial_events
  where event_type='spend' and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.campaign_id<>p_campaign_id or v_prior.billable_event_id<>p_billable_event_id
      or v_prior.amount_bdag<>v_amount
      or v_prior.billing_rate_version_id is distinct from v_materialization.billing_rate_version_id then
      raise exception using errcode='23505',message='advertising_finance_idempotency_conflict';
    end if;
    return private.advertising_campaign_finance_result(p_campaign_id);
  end if;

  select * into strict v_policy from private.advertising_finance_policy where singleton;
  if not v_policy.spend_enabled or v_launch.launch_mode not in ('CANARY_BILLING','PRODUCTION') then
    raise exception using errcode='55000',message='advertising_finance_spend_disabled';
  end if;
  if v_window.id is null or v_window.status<>'OPEN'
    or clock_timestamp()<v_window.opened_at
    or (v_window.expires_at is not null and clock_timestamp()>=v_window.expires_at) then
    raise exception using errcode='55000',message='advertising_billing_authorization_closed';
  end if;
  if v_materialization.status<>'pending' or v_materialization.campaign_id<>p_campaign_id
    or p_amount_bdag<>v_materialization.amount_bdag then
    raise exception using errcode='22023',message='advertising_billing_materialization_not_chargeable';
  end if;
  select * into strict v_event from private.advertising_events where id=p_billable_event_id;
  if v_event.campaign_id<>p_campaign_id or v_event.event_type not in ('impression','click') then
    raise exception using errcode='22023',message='advertising_billable_event_invalid';
  end if;
  select * into strict v_rate from private.advertising_billing_rate_versions
  where id=v_materialization.billing_rate_version_id;
  if v_rate.rate_bdag<>v_amount or v_rate.objective<>(select objective from private.advertising_campaigns where id=p_campaign_id)
    or v_rate.billable_event_type<>v_event.event_type or v_rate.placement_code<>v_event.placement_code
    or v_event.occurred_at<v_rate.effective_from
    or (v_rate.effective_to is not null and v_event.occurred_at>=v_rate.effective_to) then
    raise exception using errcode='23514',message='advertising_billing_rate_provenance_invalid';
  end if;
  if v_launch.launch_mode='CANARY_BILLING' then
    if not private.advertising_canary_spend_allowed(p_billable_event_id,clock_timestamp()) then
      raise exception using errcode='55000',message='advertising_canary_spend_denied';
    end if;
    select coalesce(sum(amount_bdag) filter(where status in ('pending','charged')),0),
      count(*) filter(where status in ('pending','charged'))
    into v_window_amount,v_window_count
    from private.advertising_event_billing_materializations
    where authorization_window_id=v_window.id;
    if v_window_amount>v_window.max_spend_bdag or v_window_count>v_window.max_billable_events then
      raise exception using errcode='55000',message='advertising_canary_spend_cap_exceeded';
    end if;
  elsif v_window.mode<>'PRODUCTION' or v_window.scope<>'global'
    or v_rate.scope<>'global' or v_rate.scope_campaign_id is not null then
    raise exception using errcode='55000',message='advertising_production_spend_scope_invalid';
  end if;
  if v_finance.finance_status<>'funded' then
    raise exception using errcode='22023',message='advertising_campaign_not_spendable';
  end if;
  if exists(select 1 from private.advertising_financial_events where event_type='spend' and billable_event_id=p_billable_event_id) then
    raise exception using errcode='23505',message='advertising_billable_event_already_charged';
  end if;
  if v_amount>v_finance.funded_bdag-v_finance.spent_bdag-v_finance.released_bdag then
    raise exception using errcode='22023',message='advertising_campaign_overspend';
  end if;

  v_escrow:=public.ensure_marketplace_ads_account(v_policy.shared_escrow_account_type);
  v_revenue:=public.ensure_marketplace_ads_account(v_policy.shared_revenue_account_type);
  perform 1 from public.ledger_accounts where id=any(array[v_escrow,v_revenue]) order by id for update;
  v_tx:=gen_random_uuid();
  insert into public.financial_transactions(
    id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,
    reference_type,reference_id,idempotency_key,initiated_by
  ) values(
    v_tx,v_escrow,v_revenue,'advertising_campaign_spend',v_amount,0,'BDAG','completed',
    'advertising_campaign',p_campaign_id::text,p_idempotency_key::text,v_finance.funded_by_user_id
  );
  perform public.ledger_debit(v_tx,v_escrow,v_amount,'Advertising campaign billable spend',
    jsonb_build_object('campaign_id',p_campaign_id,'billable_event_id',p_billable_event_id));
  perform public.ledger_credit(v_tx,v_revenue,v_amount,'Shared Ads revenue',
    jsonb_build_object('campaign_id',p_campaign_id,'billable_event_id',p_billable_event_id));
  insert into private.advertising_financial_events(
    campaign_id,event_type,amount_bdag,financial_transaction_id,idempotency_key,billable_event_id,
    billing_rate_version_id,unit_rate_bdag
  ) values(
    p_campaign_id,'spend',v_amount,v_tx,p_idempotency_key,p_billable_event_id,v_rate.id,v_rate.rate_bdag
  ) returning id into v_financial_event_id;
  update private.advertising_campaign_finance
  set spent_bdag=spent_bdag+v_amount,updated_at=clock_timestamp()
  where campaign_id=p_campaign_id;
  update private.advertising_event_billing_materializations
  set status='charged',financial_event_id=v_financial_event_id,finalized_at=clock_timestamp(),
    updated_at=clock_timestamp(),reason_code='charged_by_canonical_spend'
  where id=v_materialization.id;
  return private.advertising_campaign_finance_result(p_campaign_id);
end;
$$;

revoke all on function public.spend_advertising_campaign_budget_v2(uuid,uuid,numeric,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.spend_advertising_campaign_budget_v2(uuid,uuid,numeric,uuid)
to service_role;

create or replace function private.advertising_campaign_billing_readiness_at(
  p_campaign_id uuid,
  p_placement_code text,
  p_at_time timestamptz default statement_timestamp()
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_launch private.advertising_canary_policy;v_campaign private.advertising_campaigns;
  v_capability private.advertising_objective_capabilities;v_finance private.advertising_campaign_finance;
  v_window private.advertising_billing_authorization_windows;v_rate private.advertising_billing_rate_versions;
  v_pending numeric(20,8);v_available numeric(20,8);v_at_time timestamptz:=coalesce(p_at_time,statement_timestamp());
begin
  select * into strict v_launch from private.advertising_canary_policy where singleton;
  if v_launch.launch_mode='CANARY_DELIVERY' then
    return jsonb_build_object('ready',true,'status','delivery_canary_unbilled','blocker',null);
  end if;
  if v_launch.launch_mode not in ('CANARY_BILLING','PRODUCTION') then
    return jsonb_build_object('ready',false,'status','not_authorized','blocker','billing_not_authorized');
  end if;
  select * into v_campaign from private.advertising_campaigns where id=p_campaign_id;
  if not found then return jsonb_build_object('ready',false,'status','blocked','blocker','campaign_not_found');end if;
  select * into v_capability from private.advertising_objective_capabilities where objective=v_campaign.objective;
  if not found or not v_capability.delivery_runtime_ready or not v_capability.billing_runtime_ready then
    return jsonb_build_object('ready',false,'status','blocked','blocker','objective_billing_not_available');
  end if;
  select * into v_window from private.advertising_billing_authorization_windows window_row
  where window_row.status='OPEN'
    and window_row.opened_at<=v_at_time
    and(window_row.expires_at is null or v_at_time<window_row.expires_at);
  if not found or(v_launch.launch_mode='PRODUCTION'and(v_window.mode<>'PRODUCTION'or v_window.scope<>'global'))
    or(v_launch.launch_mode='CANARY_BILLING'and(v_window.mode<>'CANARY_BILLING'or v_window.scope<>'canary_campaign'or v_window.campaign_id<>p_campaign_id))then
    return jsonb_build_object('ready',false,'status','blocked','blocker','billing_authorization_window_unavailable');
  end if;
  v_rate:=private.resolve_advertising_billing_rate_v2(
    p_campaign_id,v_capability.billable_event_type,p_placement_code,v_at_time,v_launch.launch_mode
  );
  if v_rate.id is null then
    return jsonb_build_object('ready',false,'status','blocked','blocker','billing_rate_not_available');
  end if;
  select * into v_finance from private.advertising_campaign_finance where campaign_id=p_campaign_id;
  if not found or v_finance.finance_status<>'funded' then
    return jsonb_build_object('ready',false,'status','blocked','blocker','campaign_finance_not_funded');
  end if;
  v_pending:=private.advertising_active_pending_reserved_bdag(p_campaign_id,v_at_time);
  v_available:=v_finance.funded_bdag-v_finance.spent_bdag-v_finance.released_bdag-v_pending;
  if v_pending>v_finance.funded_bdag-v_finance.spent_bdag-v_finance.released_bdag then
    return jsonb_build_object('ready',false,'status','anomaly','blocker','active_pending_reservation_exceeds_available_finance','available_to_reserve_bdag',v_available);
  end if;
  if v_available<v_rate.rate_bdag then
    return jsonb_build_object('ready',false,'status','blocked','blocker','campaign_budget_insufficient_for_next_billable_event','available_to_reserve_bdag',v_available,'next_rate_bdag',v_rate.rate_bdag);
  end if;
  return jsonb_build_object('ready',true,'status','ready','blocker',null,'available_to_reserve_bdag',v_available,'next_rate_bdag',v_rate.rate_bdag,'billing_rate_version_id',v_rate.id);
end;
$$;

revoke all on function private.advertising_campaign_billing_readiness_at(uuid,text,timestamptz)
from public,anon,authenticated,service_role;

alter function private.advertising_delivery_preflight_at(uuid,text,uuid,timestamptz)
  rename to advertising_delivery_preflight_structural_at;
revoke all on function private.advertising_delivery_preflight_structural_at(uuid,text,uuid,timestamptz)
from public,anon,authenticated,service_role;

create or replace function private.advertising_delivery_preflight_at(
  p_ad_id uuid,p_placement_code text,p_viewer_user_id uuid,p_at_time timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_result jsonb;v_billing jsonb;v_campaign_id uuid;v_launch_mode text;v_blocker text;
  v_delivery_runtime_ready boolean:=false;
begin
  v_result:=private.advertising_delivery_preflight_structural_at(p_ad_id,p_placement_code,p_viewer_user_id,p_at_time);
  select ad_set.campaign_id,coalesce(capability.delivery_runtime_ready,false)
  into v_campaign_id,v_delivery_runtime_ready
  from private.advertising_ads ad
  join private.advertising_ad_sets ad_set on ad_set.id=ad.ad_set_id
  join private.advertising_campaigns campaign on campaign.id=ad_set.campaign_id
  left join private.advertising_objective_capabilities capability on capability.objective=campaign.objective
  where ad.id=p_ad_id;
  select launch_mode into strict v_launch_mode from private.advertising_canary_policy where singleton;
  if v_campaign_id is not null and not v_delivery_runtime_ready then
    v_result:=jsonb_set(v_result,'{structurally_ready}','false'::jsonb,true);
    v_result:=jsonb_set(v_result,'{production_deliverable}','false'::jsonb,true);
    v_result:=jsonb_set(v_result,'{reason_codes}',coalesce(v_result->'reason_codes','[]'::jsonb)||jsonb_build_array('objective_delivery_not_available'),true);
  elsif v_campaign_id is not null and v_launch_mode in ('CANARY_BILLING','PRODUCTION') then
    v_billing:=private.advertising_campaign_billing_readiness_at(v_campaign_id,p_placement_code,p_at_time);
    if not coalesce((v_billing->>'ready')::boolean,false) then
      v_blocker:=v_billing->>'blocker';
      v_result:=jsonb_set(v_result,'{structurally_ready}','false'::jsonb,true);
      v_result:=jsonb_set(v_result,'{production_deliverable}','false'::jsonb,true);
      v_result:=jsonb_set(v_result,'{reason_codes}',coalesce(v_result->'reason_codes','[]'::jsonb)||jsonb_build_array(v_blocker),true);
    end if;
    v_result:=v_result||jsonb_build_object('billing_readiness',v_billing);
  end if;
  return v_result;
end;
$$;

revoke all on function private.advertising_delivery_preflight_at(uuid,text,uuid,timestamptz)
from public,anon,authenticated,service_role;

create or replace function public.activate_my_advertising_campaign_v2(
  p_campaign_id uuid,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());v_campaign private.advertising_campaigns;
  v_prior private.advertising_campaign_lifecycle_events;
  v_policy private.advertising_campaign_lifecycle_policy;v_launch private.advertising_canary_policy;
  v_readiness jsonb;v_target text;
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required';end if;
  if p_campaign_id is null or p_idempotency_key is null then raise exception using errcode='22023',message='advertising_campaign_lifecycle_input_invalid';end if;
  if not exists(select 1 from private.advertising_campaigns campaign join private.ad_accounts account on account.id=campaign.ad_account_id join private.business_accounts business on business.id=account.business_account_id where campaign.id=p_campaign_id and business.owner_user_id=v_actor) then
    raise exception using errcode='42501',message='advertising_campaign_access_denied';end if;
  perform pg_advisory_xact_lock(hashtextextended('ads-campaign-lifecycle:'||p_idempotency_key::text,0));
  select * into strict v_launch from private.advertising_canary_policy where singleton for update;
  select * into v_campaign from private.advertising_campaigns where id=p_campaign_id for update;
  select * into v_prior from private.advertising_campaign_lifecycle_events where idempotency_key=p_idempotency_key;
  if found then
    if v_prior.campaign_id<>p_campaign_id or v_prior.action<>'activate' or v_prior.actor_user_id is distinct from v_actor then
      raise exception using errcode='23505',message='advertising_campaign_lifecycle_idempotency_conflict';end if;
    return private.advertising_campaign_result(p_campaign_id);
  end if;
  select * into strict v_policy from private.advertising_campaign_lifecycle_policy where singleton;
  if not v_policy.activation_enabled or v_launch.launch_mode not in ('CANARY_DELIVERY','CANARY_BILLING','PRODUCTION') then
    raise exception using errcode='55000',message='advertising_campaign_activation_disabled';end if;
  if not private.advertising_canary_campaign_allowed(p_campaign_id,clock_timestamp(),true,null) then
    raise exception using errcode='55000',message='advertising_canary_campaign_denied';end if;
  if v_campaign.status<>'draft' then raise exception using errcode='55000',message='advertising_campaign_activation_state_invalid';end if;
  if not exists(
    select 1 from private.advertising_objective_capabilities capability
    where capability.objective=v_campaign.objective and capability.delivery_runtime_ready
  ) then raise exception using errcode='55000',message='advertising_campaign_objective_not_available';end if;
  v_readiness:=private.advertising_campaign_operational_readiness_at(p_campaign_id,now());
  if not coalesce((v_readiness->>'structurally_ready')::boolean,false) then
    raise exception using errcode='55000',message='advertising_campaign_not_operationally_ready',detail=v_readiness::text;end if;
  if v_launch.launch_mode in ('CANARY_BILLING','PRODUCTION')
    and not coalesce((private.advertising_campaign_billing_readiness_at(p_campaign_id,'social_feed',now())->>'ready')::boolean,false) then
    raise exception using errcode='55000',message='advertising_campaign_billing_not_ready';end if;
  v_target:=v_readiness->>'target_status';
  update private.advertising_campaigns set status=v_target,updated_at=clock_timestamp() where id=p_campaign_id;
  insert into private.advertising_campaign_lifecycle_events(
    campaign_id,action,from_status,to_status,actor_user_id,source,idempotency_key,reason_code
  ) values(p_campaign_id,'activate','draft',v_target,v_actor,'owner',p_idempotency_key,'owner_activation');
  return private.advertising_campaign_result(p_campaign_id);
end;
$$;

create or replace function public.resume_my_advertising_campaign_v2(
  p_campaign_id uuid,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());v_campaign private.advertising_campaigns;
  v_prior private.advertising_campaign_lifecycle_events;
  v_policy private.advertising_campaign_lifecycle_policy;v_launch private.advertising_canary_policy;
  v_readiness jsonb;v_target text;
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required';end if;
  if p_campaign_id is null or p_idempotency_key is null then raise exception using errcode='22023',message='advertising_campaign_lifecycle_input_invalid';end if;
  if not exists(select 1 from private.advertising_campaigns campaign join private.ad_accounts account on account.id=campaign.ad_account_id join private.business_accounts business on business.id=account.business_account_id where campaign.id=p_campaign_id and business.owner_user_id=v_actor) then
    raise exception using errcode='42501',message='advertising_campaign_access_denied';end if;
  perform pg_advisory_xact_lock(hashtextextended('ads-campaign-lifecycle:'||p_idempotency_key::text,0));
  select * into strict v_launch from private.advertising_canary_policy where singleton for update;
  select * into v_campaign from private.advertising_campaigns where id=p_campaign_id for update;
  select * into v_prior from private.advertising_campaign_lifecycle_events where idempotency_key=p_idempotency_key;
  if found then
    if v_prior.campaign_id<>p_campaign_id or v_prior.action<>'resume' or v_prior.actor_user_id is distinct from v_actor then
      raise exception using errcode='23505',message='advertising_campaign_lifecycle_idempotency_conflict';end if;
    return private.advertising_campaign_result(p_campaign_id);
  end if;
  select * into strict v_policy from private.advertising_campaign_lifecycle_policy where singleton;
  if not v_policy.activation_enabled or v_launch.launch_mode not in ('CANARY_DELIVERY','CANARY_BILLING','PRODUCTION') then
    raise exception using errcode='55000',message='advertising_campaign_activation_disabled';end if;
  if not private.advertising_canary_campaign_allowed(p_campaign_id,clock_timestamp(),true,null) then
    raise exception using errcode='55000',message='advertising_canary_campaign_denied';end if;
  if v_campaign.status<>'paused' then raise exception using errcode='55000',message='advertising_campaign_resume_state_invalid';end if;
  if not exists(
    select 1 from private.advertising_objective_capabilities capability
    where capability.objective=v_campaign.objective and capability.delivery_runtime_ready
  ) then raise exception using errcode='55000',message='advertising_campaign_objective_not_available';end if;
  v_readiness:=private.advertising_campaign_operational_readiness_at(p_campaign_id,now());
  if not coalesce((v_readiness->>'structurally_ready')::boolean,false) then
    raise exception using errcode='55000',message='advertising_campaign_not_operationally_ready',detail=v_readiness::text;end if;
  if v_launch.launch_mode in ('CANARY_BILLING','PRODUCTION')
    and not coalesce((private.advertising_campaign_billing_readiness_at(p_campaign_id,'social_feed',now())->>'ready')::boolean,false) then
    raise exception using errcode='55000',message='advertising_campaign_billing_not_ready';end if;
  v_target:=v_readiness->>'target_status';
  update private.advertising_campaigns set status=v_target,updated_at=clock_timestamp() where id=p_campaign_id;
  insert into private.advertising_campaign_lifecycle_events(
    campaign_id,action,from_status,to_status,actor_user_id,source,idempotency_key,reason_code
  ) values(p_campaign_id,'resume','paused',v_target,v_actor,'owner',p_idempotency_key,'owner_resume');
  return private.advertising_campaign_result(p_campaign_id);
end;
$$;

create or replace function public.fund_my_advertising_campaign_budget_v2(
  p_campaign_id uuid,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());v_launch private.advertising_canary_policy;
  v_policy private.advertising_finance_policy;v_finance private.advertising_campaign_finance;
  v_prior private.advertising_financial_events;v_source uuid;v_escrow uuid;v_balance numeric;v_tx uuid;
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required';end if;
  if p_idempotency_key is null then raise exception using errcode='22023',message='advertising_idempotency_key_required';end if;
  perform 1 from private.advertising_campaigns campaign join private.ad_accounts account on account.id=campaign.ad_account_id join private.business_accounts business on business.id=account.business_account_id where campaign.id=p_campaign_id and business.owner_user_id=v_actor;
  if not found then raise exception using errcode='42501',message='advertising_campaign_finance_access_denied';end if;
  select * into strict v_launch from private.advertising_canary_policy where singleton for update;
  select * into v_finance from private.advertising_campaign_finance where campaign_id=p_campaign_id for update;
  if not found then raise exception using errcode='P0002',message='advertising_campaign_finance_not_found';end if;
  select * into v_prior from private.advertising_financial_events where event_type='fund' and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.campaign_id<>p_campaign_id or v_prior.amount_bdag<>v_finance.budget_bdag then
      raise exception using errcode='23505',message='advertising_finance_idempotency_conflict';end if;
    return private.advertising_campaign_finance_result(p_campaign_id);
  end if;
  select * into strict v_policy from private.advertising_finance_policy where singleton;
  if not v_policy.funding_enabled or v_launch.launch_mode not in ('CANARY_DELIVERY','PRODUCTION') then
    raise exception using errcode='55000',message='advertising_finance_funding_disabled';end if;
  if not private.advertising_canary_campaign_allowed(p_campaign_id,clock_timestamp(),true,v_finance.budget_bdag) then
    raise exception using errcode='55000',message='advertising_canary_funding_denied';end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_actor) then raise exception using errcode='42501',message='advertising_adult_eligibility_required';end if;
  perform 1 from private.advertising_campaigns campaign join private.ad_accounts account on account.id=campaign.ad_account_id join private.business_accounts business on business.id=account.business_account_id where campaign.id=p_campaign_id and campaign.status='draft' and account.status='active' and business.status='active' and business.owner_user_id=v_actor;
  if not found then raise exception using errcode='42501',message='advertising_campaign_finance_access_denied';end if;
  if v_finance.finance_status<>'draft' then raise exception using errcode='23505',message='advertising_campaign_already_funded';end if;
  v_source:=public.ensure_ledger_account(v_actor);v_escrow:=public.ensure_marketplace_ads_account(v_policy.shared_escrow_account_type);
  perform 1 from public.ledger_accounts where id=any(array[v_source,v_escrow]) order by id for update;
  select balance into v_balance from public.ledger_accounts where id=v_source and owner_id=v_actor and account_type='user' and currency=v_policy.currency and not frozen;
  if v_balance is null or v_balance<v_finance.budget_bdag then raise exception using errcode='P0001',message='advertising_insufficient_bdag_balance';end if;
  v_tx:=gen_random_uuid();
  insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)
  values(v_tx,v_source,v_escrow,'advertising_campaign_fund',v_finance.budget_bdag,0,'BDAG','completed','advertising_campaign',p_campaign_id::text,p_idempotency_key::text,v_actor);
  perform public.ledger_debit(v_tx,v_source,v_finance.budget_bdag,'Advertising campaign funding',jsonb_build_object('campaign_id',p_campaign_id));
  perform public.ledger_credit(v_tx,v_escrow,v_finance.budget_bdag,'Shared Ads escrow funding',jsonb_build_object('campaign_id',p_campaign_id));
  insert into private.advertising_financial_events(campaign_id,event_type,amount_bdag,financial_transaction_id,idempotency_key)
  values(p_campaign_id,'fund',v_finance.budget_bdag,v_tx,p_idempotency_key);
  update private.advertising_campaign_finance set finance_status='funded',funded_bdag=budget_bdag,
    funding_source_account_id=v_source,funded_by_user_id=v_actor,funded_at=clock_timestamp(),updated_at=clock_timestamp()
  where campaign_id=p_campaign_id;
  return private.advertising_campaign_finance_result(p_campaign_id);
end;
$$;

create or replace function public.settle_advertising_campaign_budget_v2(
  p_campaign_id uuid,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_role text:=coalesce((select auth.role()),'');v_launch private.advertising_canary_policy;
  v_policy private.advertising_finance_policy;v_finance private.advertising_campaign_finance;
  v_prior private.advertising_financial_events;v_settlement private.advertising_financial_settlements;
  v_unused numeric(20,8);v_escrow uuid;v_tx uuid;v_settled_at timestamptz:=clock_timestamp();
begin
  if v_role<>'service_role' and session_user not in ('postgres','supabase_admin') then raise exception using errcode='42501',message='advertising_finance_internal_only';end if;
  if p_idempotency_key is null then raise exception using errcode='22023',message='advertising_idempotency_key_required';end if;
  select * into strict v_launch from private.advertising_canary_policy where singleton for update;
  select * into v_finance from private.advertising_campaign_finance where campaign_id=p_campaign_id for update;
  if not found then raise exception using errcode='P0002',message='advertising_campaign_finance_not_found';end if;
  select * into v_settlement from private.advertising_financial_settlements where idempotency_key=p_idempotency_key;
  if found then
    if v_settlement.campaign_id<>p_campaign_id then raise exception using errcode='23505',message='advertising_finance_idempotency_conflict';end if;
    return private.advertising_campaign_finance_result(p_campaign_id);
  end if;
  select * into strict v_policy from private.advertising_finance_policy where singleton;
  if not v_policy.settlement_enabled or v_launch.launch_mode not in ('SETTLEMENT_ONLY','PRODUCTION') then
    raise exception using errcode='55000',message='advertising_finance_settlement_disabled';end if;
  select * into v_settlement from private.advertising_financial_settlements where campaign_id=p_campaign_id;
  if found then return private.advertising_campaign_finance_result(p_campaign_id);end if;
  if not exists(
    select 1 from private.advertising_campaigns campaign
    where campaign.id=p_campaign_id and campaign.status in ('completed','cancelled')
  ) then
    raise exception using errcode='55000',message='advertising_campaign_not_terminal';
  end if;
  if v_finance.finance_status<>'funded' then raise exception using errcode='22023',message='advertising_campaign_not_settleable';end if;
  v_unused:=v_finance.funded_bdag-v_finance.spent_bdag-v_finance.released_bdag;
  if v_unused<0 then raise exception using errcode='23514',message='advertising_campaign_finance_equation_invalid';end if;
  if v_unused>0 then
    select * into v_prior from private.advertising_financial_events where event_type='release' and idempotency_key=p_idempotency_key;
    if found and (v_prior.campaign_id<>p_campaign_id or v_prior.amount_bdag<>v_unused) then raise exception using errcode='23505',message='advertising_finance_idempotency_conflict';end if;
    v_escrow:=public.ensure_marketplace_ads_account(v_policy.shared_escrow_account_type);
    perform 1 from public.ledger_accounts where id=any(array[v_escrow,v_finance.funding_source_account_id]) order by id for update;
    v_tx:=gen_random_uuid();
    insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)
    values(v_tx,v_escrow,v_finance.funding_source_account_id,'advertising_campaign_release',v_unused,0,'BDAG','completed','advertising_campaign',p_campaign_id::text,p_idempotency_key::text,v_finance.funded_by_user_id);
    perform public.ledger_debit(v_tx,v_escrow,v_unused,'Advertising campaign unused budget release',jsonb_build_object('campaign_id',p_campaign_id));
    perform public.ledger_credit(v_tx,v_finance.funding_source_account_id,v_unused,'Advertising budget returned to original source',jsonb_build_object('campaign_id',p_campaign_id));
    insert into private.advertising_financial_events(campaign_id,event_type,amount_bdag,financial_transaction_id,idempotency_key)
    values(p_campaign_id,'release',v_unused,v_tx,p_idempotency_key);
  end if;
  update private.advertising_campaign_finance set released_bdag=released_bdag+v_unused,
    finance_status='settled',settled_at=v_settled_at,updated_at=v_settled_at where campaign_id=p_campaign_id;
  insert into private.advertising_financial_settlements(
    campaign_id,idempotency_key,budget_bdag,funded_bdag,spent_bdag,released_before_bdag,released_on_settlement_bdag,settled_at
  ) values(p_campaign_id,p_idempotency_key,v_finance.budget_bdag,v_finance.funded_bdag,v_finance.spent_bdag,v_finance.released_bdag,v_unused,v_settled_at);
  return private.advertising_campaign_finance_result(p_campaign_id);
end;
$$;

revoke all on function public.activate_my_advertising_campaign_v2(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.activate_my_advertising_campaign_v2(uuid,uuid) to authenticated;
revoke all on function public.resume_my_advertising_campaign_v2(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.resume_my_advertising_campaign_v2(uuid,uuid) to authenticated;
revoke all on function public.fund_my_advertising_campaign_budget_v2(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.fund_my_advertising_campaign_budget_v2(uuid,uuid) to authenticated,service_role;
revoke all on function public.settle_advertising_campaign_budget_v2(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.settle_advertising_campaign_budget_v2(uuid,uuid) to service_role;

create or replace function public.reconcile_advertising_billable_events_v2(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text:=coalesce((select auth.role()),'');v_launch private.advertising_canary_policy;
  v_finance_policy private.advertising_finance_policy;v_candidate record;
  v_processed integer:=0;v_charged integer:=0;v_terminalized integer:=0;v_key uuid;
begin
  if v_role<>'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception using errcode='42501',message='advertising_billing_reconciler_internal_only';end if;
  if p_limit is null or p_limit<1 or p_limit>500 then
    raise exception using errcode='22023',message='advertising_billing_reconciler_limit_invalid';end if;
  select * into strict v_launch from private.advertising_canary_policy where singleton for update;
  select * into strict v_finance_policy from private.advertising_finance_policy where singleton;

  with stale as (
    select materialization.id
    from private.advertising_event_billing_materializations materialization
    join private.advertising_billing_authorization_windows window_row
      on window_row.id=materialization.authorization_window_id
    where materialization.status='pending'
      and (window_row.status='CLOSED'
        or (window_row.expires_at is not null and clock_timestamp()>=window_row.expires_at))
    order by materialization.created_at,materialization.id
    limit p_limit
  )
  update private.advertising_event_billing_materializations materialization
  set status='not_billable_outside_authorization',amount_bdag=0,
    reason_code='authorization_window_closed',finalized_at=clock_timestamp(),updated_at=clock_timestamp()
  from stale where stale.id=materialization.id;
  get diagnostics v_terminalized=row_count;

  if not v_finance_policy.spend_enabled or v_launch.launch_mode not in ('CANARY_BILLING','PRODUCTION') then
    return jsonb_build_object('processed',0,'charged',0,'terminalized',v_terminalized,'mode',v_launch.launch_mode);
  end if;
  for v_candidate in
    select materialization.id,materialization.billable_event_id,materialization.campaign_id,materialization.amount_bdag
    from private.advertising_event_billing_materializations materialization
    join private.advertising_billing_authorization_windows window_row
      on window_row.id=materialization.authorization_window_id
    where materialization.status='pending' and window_row.status='OPEN'
      and window_row.opened_at<=clock_timestamp()
      and (window_row.expires_at is null or clock_timestamp()<window_row.expires_at)
    order by materialization.created_at,materialization.id
    limit greatest(p_limit-v_terminalized,0)
    for update of window_row skip locked
  loop
    v_processed:=v_processed+1;
    v_key:=md5('ads-v2-billing-spend:'||v_candidate.billable_event_id::text)::uuid;
    perform public.spend_advertising_campaign_budget_v2(
      v_candidate.campaign_id,v_candidate.billable_event_id,v_candidate.amount_bdag,v_key
    );
    v_charged:=v_charged+1;
  end loop;
  return jsonb_build_object(
    'processed',v_processed,'charged',v_charged,'terminalized',v_terminalized,'mode',v_launch.launch_mode
  );
end;
$$;

revoke all on function public.reconcile_advertising_billable_events_v2(integer)
from public,anon,authenticated,service_role;
grant execute on function public.reconcile_advertising_billable_events_v2(integer) to service_role;

create or replace function public.reconcile_advertising_campaign_lifecycle(
  p_limit integer default 100,
  p_at_time timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_role text:=coalesce((select auth.role()),'');v_launch private.advertising_canary_policy;
  v_policy private.advertising_campaign_lifecycle_policy;v_campaign private.advertising_campaigns;
  v_readiness jsonb;v_remaining numeric;v_processed integer:=0;v_activated integer:=0;
  v_completed integer:=0;v_reason text;
begin
  if v_role<>'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception using errcode='42501',message='advertising_campaign_lifecycle_service_required';end if;
  if p_limit is null or p_limit<1 or p_limit>500 then raise exception using errcode='22023',message='advertising_campaign_lifecycle_limit_invalid';end if;
  select * into strict v_launch from private.advertising_canary_policy where singleton for update;
  select * into strict v_policy from private.advertising_campaign_lifecycle_policy where singleton;
  if not (v_launch.launch_mode='PRODUCTION' and v_policy.automatic_transitions_enabled) then
    return jsonb_build_object('processed',0,'activated',0,'completed',0,'mode',v_launch.launch_mode);
  end if;
  for v_campaign in
    select * from private.advertising_campaigns
    where status in ('scheduled','active') order by updated_at,id for update skip locked limit p_limit
  loop
    v_processed:=v_processed+1;
    select finance.funded_bdag-finance.spent_bdag-finance.released_bdag
    into v_remaining from private.advertising_campaign_finance finance where finance.campaign_id=v_campaign.id;
    v_readiness:=private.advertising_campaign_operational_readiness_at(v_campaign.id,coalesce(p_at_time,now()));
    if v_campaign.status='active' and (
      (v_remaining is not null and v_remaining<=0)
      or exists(select 1 from private.advertising_event_billing_materializations materialization
        where materialization.campaign_id=v_campaign.id and materialization.status='budget_exhausted')
    ) then
      v_reason:='campaign_budget_exhausted';
    elsif coalesce((v_readiness->>'ready_ad_count')::integer,0)>0
      and coalesce((v_readiness->>'current_window_ad_set_count')::integer,0)=0
      and coalesce((v_readiness->>'future_window_ad_set_count')::integer,0)=0 then
      v_reason:='campaign_schedule_expired';
    else v_reason:=null;end if;
    if v_reason is not null then
      update private.advertising_campaigns set status='completed',updated_at=clock_timestamp() where id=v_campaign.id;
      insert into private.advertising_campaign_lifecycle_events(
        campaign_id,action,from_status,to_status,actor_user_id,source,idempotency_key,reason_code
      ) values(v_campaign.id,'complete',v_campaign.status,'completed',null,'service',null,v_reason);
      v_completed:=v_completed+1;
    elsif v_campaign.status='scheduled' and v_policy.activation_enabled
      and coalesce((v_readiness->>'structurally_ready')::boolean,false)
      and coalesce((private.advertising_campaign_billing_readiness_at(v_campaign.id,'social_feed',coalesce(p_at_time,now()))->>'ready')::boolean,false)
      and v_readiness->>'target_status'='active' then
      update private.advertising_campaigns set status='active',updated_at=clock_timestamp() where id=v_campaign.id;
      insert into private.advertising_campaign_lifecycle_events(
        campaign_id,action,from_status,to_status,actor_user_id,source,idempotency_key,reason_code
      ) values(v_campaign.id,'activate','scheduled','active',null,'service',null,'schedule_window_started');
      v_activated:=v_activated+1;
    end if;
  end loop;
  return jsonb_build_object('processed',v_processed,'activated',v_activated,'completed',v_completed,'mode',v_launch.launch_mode);
end;
$$;

revoke all on function public.reconcile_advertising_campaign_lifecycle(integer,timestamptz)
from public,anon,authenticated,service_role;
grant execute on function public.reconcile_advertising_campaign_lifecycle(integer,timestamptz) to service_role;

create or replace function public.reconcile_advertising_campaign_settlements_v2(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_role text:=coalesce((select auth.role()),'');v_launch private.advertising_canary_policy;
  v_candidate record;v_processed integer:=0;v_settled integer:=0;v_key uuid;
begin
  if v_role<>'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception using errcode='42501',message='advertising_settlement_reconciler_internal_only';end if;
  if p_limit is null or p_limit<1 or p_limit>500 then raise exception using errcode='22023',message='advertising_settlement_reconciler_limit_invalid';end if;
  select * into strict v_launch from private.advertising_canary_policy where singleton for update;
  if v_launch.launch_mode not in ('SETTLEMENT_ONLY','PRODUCTION')
    or not (select settlement_enabled from private.advertising_finance_policy where singleton) then
    return jsonb_build_object('processed',0,'settled',0,'mode',v_launch.launch_mode);
  end if;
  for v_candidate in
    select campaign.id
    from private.advertising_campaigns campaign
    join private.advertising_campaign_finance finance on finance.campaign_id=campaign.id
    left join private.advertising_financial_settlements settlement on settlement.campaign_id=campaign.id
    where campaign.status in ('completed','cancelled') and finance.finance_status='funded'
      and settlement.campaign_id is null
    order by campaign.updated_at,campaign.id limit p_limit
  loop
    v_processed:=v_processed+1;
    v_key:=md5('ads-v2-settlement:'||v_candidate.id::text)::uuid;
    perform public.settle_advertising_campaign_budget_v2(v_candidate.id,v_key);
    v_settled:=v_settled+1;
  end loop;
  return jsonb_build_object('processed',v_processed,'settled',v_settled,'mode',v_launch.launch_mode);
end;
$$;

revoke all on function public.reconcile_advertising_campaign_settlements_v2(integer)
from public,anon,authenticated,service_role;
grant execute on function public.reconcile_advertising_campaign_settlements_v2(integer) to service_role;

create or replace function public.get_my_advertising_objective_capabilities_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_actor uuid:=(select auth.uid());v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode='28000',message='advertising_auth_required';
  end if;
  select jsonb_build_object(
    'authority','ads_v2',
    'capability_version',max(capability.capability_version),
    'objectives',coalesce(jsonb_agg(jsonb_build_object(
      'objective',capability.objective,
      'status',capability.status,
      'setup_enabled',capability.setup_enabled,
      'delivery_runtime_ready',capability.delivery_runtime_ready,
      'billing_runtime_ready',capability.billing_runtime_ready,
      'conversion_runtime_ready',capability.conversion_runtime_ready,
      'billable_event_type',capability.billable_event_type
    ) order by capability.objective),'[]'::jsonb)
  ) into v_result
  from private.advertising_objective_capabilities capability;
  return v_result;
end;
$$;

revoke all on function public.get_my_advertising_objective_capabilities_v2()
from public,anon,authenticated,service_role;
grant execute on function public.get_my_advertising_objective_capabilities_v2() to authenticated;

create or replace function public.get_my_advertising_campaign_billing_v2(p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());v_campaign private.advertising_campaigns;
  v_finance private.advertising_campaign_finance;v_capability private.advertising_objective_capabilities;
  v_launch private.advertising_canary_policy;v_rate private.advertising_billing_rate_versions;
  v_pending numeric(20,8);v_available numeric(20,8);v_now timestamptz:=statement_timestamp();
  v_rate_scope text;v_anomaly text;v_rate_status text:='unavailable';
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required';end if;
  select campaign.* into v_campaign
  from private.advertising_campaigns campaign
  join private.ad_accounts account on account.id=campaign.ad_account_id
  join private.business_accounts business on business.id=account.business_account_id
  where campaign.id=p_campaign_id and business.owner_user_id=v_actor;
  if not found then raise exception using errcode='42501',message='advertising_campaign_access_denied';end if;
  select * into strict v_finance from private.advertising_campaign_finance where campaign_id=p_campaign_id;
  select * into strict v_capability from private.advertising_objective_capabilities where objective=v_campaign.objective;
  select * into strict v_launch from private.advertising_canary_policy where singleton;
  v_pending:=private.advertising_active_pending_reserved_bdag(p_campaign_id,v_now);
  v_available:=v_finance.funded_bdag-v_finance.spent_bdag-v_finance.released_bdag-v_pending;
  if v_pending>v_finance.funded_bdag-v_finance.spent_bdag-v_finance.released_bdag then
    v_anomaly:='active_pending_reservation_exceeds_available_finance';
  end if;
  v_rate_scope:=case when v_launch.launch_mode='CANARY_BILLING' and v_launch.campaign_id=p_campaign_id
    then 'canary_campaign' else 'global' end;
  select rate.* into v_rate
  from private.advertising_billing_rate_versions rate
  where rate.objective=v_campaign.objective
    and rate.billable_event_type=v_capability.billable_event_type
    and rate.placement_code='social_feed'
    and rate.scope=v_rate_scope
    and ((v_rate_scope='global' and rate.scope_campaign_id is null)
      or (v_rate_scope='canary_campaign' and rate.scope_campaign_id=p_campaign_id))
    and rate.state='published'
    and rate.effective_from<=v_now
    and (rate.effective_to is null or v_now<rate.effective_to)
  order by rate.effective_from desc,rate.id
  limit 1;
  if found then v_rate_status:='available';end if;
  return jsonb_build_object(
    'authority','ads_v2','campaign_id',p_campaign_id,'objective',v_campaign.objective,
    'objective_status',v_capability.status,
    'delivery_runtime_ready',v_capability.delivery_runtime_ready,
    'billing_runtime_ready',v_capability.billing_runtime_ready,
    'conversion_runtime_ready',v_capability.conversion_runtime_ready,
    'billable_event_type',v_capability.billable_event_type,
    'billing_basis',case v_capability.billable_event_type when 'impression' then 'per_impression' when 'click' then 'per_click' else null end,
    'rate_status',case when not v_capability.billing_runtime_ready then 'not_applicable' else v_rate_status end,
    'rate_version_id',v_rate.id,'rate_bdag',v_rate.rate_bdag,'rate_currency',v_rate.currency,
    'rate_scope',v_rate.scope,'rate_effective_from',v_rate.effective_from,'rate_effective_to',v_rate.effective_to,
    'finance_status',v_finance.finance_status,'budget_bdag',v_finance.budget_bdag,
    'funded_bdag',v_finance.funded_bdag,'spent_bdag',v_finance.spent_bdag,
    'released_bdag',v_finance.released_bdag,'pending_reserved_bdag',v_pending,
    'available_to_reserve_bdag',v_available,
    'reservation_consistent',v_anomaly is null,'anomaly_code',v_anomaly,
    'next_billable_unit_ready',v_anomaly is null and v_rate.id is not null and v_finance.finance_status='funded' and v_available>=v_rate.rate_bdag,
    'next_billable_unit_blocker',case
      when v_anomaly is not null then v_anomaly
      when not v_capability.billing_runtime_ready then 'objective_billing_not_available'
      when v_rate.id is null then 'billing_rate_not_available'
      when v_finance.finance_status<>'funded' then 'campaign_finance_not_funded'
      when v_available<v_rate.rate_bdag then 'campaign_budget_insufficient_for_next_billable_event'
      else null end
  );
end;
$$;

revoke all on function public.get_my_advertising_campaign_billing_v2(uuid)
from public,anon,authenticated,service_role;
grant execute on function public.get_my_advertising_campaign_billing_v2(uuid) to authenticated;

create or replace function public.get_my_advertising_event_summary(p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());v_objective text;v_conversion_ready boolean;
  v_impressions bigint;v_clicks bigint;v_destination_opens bigint;v_video_views bigint;v_engagements bigint;
  v_conversions bigint;v_attributed bigint;v_value numeric(20,8);v_spent numeric(20,8);
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required';end if;
  select campaign.objective,capability.conversion_runtime_ready
  into v_objective,v_conversion_ready
  from private.advertising_campaigns campaign
  join private.ad_accounts account on account.id=campaign.ad_account_id
  join private.business_accounts business on business.id=account.business_account_id
  join private.advertising_objective_capabilities capability on capability.objective=campaign.objective
  where campaign.id=p_campaign_id and business.owner_user_id=v_actor;
  if not found then raise exception using errcode='42501',message='advertising_campaign_access_denied';end if;
  select count(*)filter(where event_type='impression'),count(*)filter(where event_type='click'),
    count(*)filter(where event_type='destination_open'),count(*)filter(where event_type='video_view'),
    count(*)filter(where event_type='engagement')
  into v_impressions,v_clicks,v_destination_opens,v_video_views,v_engagements
  from private.advertising_events where campaign_id=p_campaign_id;
  select count(distinct conversion.id),count(attribution.id),
    coalesce(sum(conversion.value_bdag)filter(where conversion.conversion_type='marketplace_purchase'),0)
  into v_conversions,v_attributed,v_value
  from private.advertising_attributions attribution
  join private.advertising_conversions conversion on conversion.id=attribution.conversion_id
  where attribution.campaign_id=p_campaign_id;
  select coalesce(spent_bdag,0) into v_spent from private.advertising_campaign_finance where campaign_id=p_campaign_id;
  return jsonb_build_object(
    'authority','ads_v2','objective',v_objective,'impressions',v_impressions,'clicks',v_clicks,
    'destination_opens',v_destination_opens,'video_views',v_video_views,'engagements',v_engagements,
    'conversions',v_conversions,'attributed_conversions',v_attributed,
    'marketplace_purchase_value_bdag',v_value,'spent_bdag',v_spent,
    'ctr',case when v_impressions=0 then null else round(v_clicks::numeric/v_impressions,8)end,
    'ctr_status',case when v_impressions=0 then 'no_data' else 'available'end,
    'cpc_bdag',case when v_clicks=0 then null else round(v_spent/v_clicks,8)end,
    'cpc_status',case when v_clicks=0 then 'no_data' else 'available'end,
    'cpm_bdag',case when v_impressions=0 then null else round(v_spent/v_impressions*1000,8)end,
    'cpm_status',case when v_impressions=0 then 'no_data' else 'available'end,
    'conversion_rate',case when not v_conversion_ready or v_clicks=0 then null else round(v_attributed::numeric/v_clicks,8)end,
    'conversion_rate_status',case when not v_conversion_ready then 'not_applicable' when v_clicks=0 then 'no_data' else 'available'end,
    'roas',case when not v_conversion_ready or v_spent=0 then null else round(v_value/v_spent,8)end,
    'roas_status',case when not v_conversion_ready then 'not_applicable' when v_spent=0 then 'no_data' else 'available'end
  );
end;
$$;

revoke all on function public.get_my_advertising_event_summary(uuid)
from public,anon,authenticated,service_role;
grant execute on function public.get_my_advertising_event_summary(uuid) to authenticated;

create or replace function public.get_admin_advertising_billing_health()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_launch private.advertising_canary_policy;v_coverage jsonb;v_now timestamptz:=statement_timestamp();
begin
  perform public.admin_require_capability('advertising.billing.read');
  select * into strict v_launch from private.advertising_canary_policy where singleton;
  v_coverage:=private.advertising_rate_coverage_at('PRODUCTION',null,'social_feed',v_now,v_now+interval '1 hour');
  return jsonb_build_object(
    'authority','ads_v2','launch_mode',v_launch.launch_mode,'billing_cutover_at',v_launch.billing_cutover_at,
    'production_rate_coverage',v_coverage,
    'production_rate_coverage_ready',coalesce((v_coverage->>'ready')::boolean,false),
    'rate_versions',jsonb_build_object(
      'draft',(select count(*)from private.advertising_billing_rate_versions where state='draft'),
      'published',(select count(*)from private.advertising_billing_rate_versions where state='published'),
      'retired',(select count(*)from private.advertising_billing_rate_versions where state='retired')),
    'authorization_windows',jsonb_build_object(
      'open',(select count(*)from private.advertising_billing_authorization_windows where status='OPEN'),
      'closed',(select count(*)from private.advertising_billing_authorization_windows where status='CLOSED')),
    'materializations',jsonb_build_object(
      'pending',(select count(*)from private.advertising_event_billing_materializations where status='pending'),
      'active_pending',(select count(*)from private.advertising_event_billing_materializations materialization join private.advertising_billing_authorization_windows window_row on window_row.id=materialization.authorization_window_id where materialization.status='pending'and window_row.status='OPEN'and window_row.opened_at<=v_now and(window_row.expires_at is null or v_now<window_row.expires_at)),
      'charged',(select count(*)from private.advertising_event_billing_materializations where status='charged'),
      'budget_exhausted',(select count(*)from private.advertising_event_billing_materializations where status='budget_exhausted'),
      'oldest_pending_at',(select min(created_at)from private.advertising_event_billing_materializations where status='pending')),
    'active_pending_reservation_anomalies',(select count(*)from private.advertising_campaign_finance finance where private.advertising_active_pending_reserved_bdag(finance.campaign_id,v_now)>finance.funded_bdag-finance.spent_bdag-finance.released_bdag),
    'cron_jobs',coalesce((select jsonb_agg(jsonb_build_object('name',jobname,'schedule',schedule,'active',active)order by jobname)from cron.job where jobname in('reconcile-advertising-billable-events-v2','reconcile-advertising-campaign-lifecycle-v2','reconcile-advertising-campaign-settlements-v2')),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_admin_advertising_billing_health()
from public,anon,authenticated,service_role;
grant execute on function public.get_admin_advertising_billing_health() to authenticated;

alter function public.reconcile_advertising_finance() set schema private;
alter function private.reconcile_advertising_finance() rename to advertising_finance_reconciliation_base;
revoke all on function private.advertising_finance_reconciliation_base()
from public,anon,authenticated,service_role;

create or replace function public.reconcile_advertising_finance()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  with launch as(
    select * from private.advertising_canary_policy where singleton
  ), materialization_audit as(
    select
      count(*)filter(where materialization.status='charged'and(financial_event.id is null or materialization.financial_event_id is null)) materialization_without_financial_event,
      count(*)filter(where materialization.status='charged'and(materialization.amount_bdag is distinct from rate.rate_bdag or financial_event.amount_bdag is distinct from rate.rate_bdag or financial_event.unit_rate_bdag is distinct from rate.rate_bdag)) charged_materialization_amount_rate_mismatch,
      count(*)filter(where event.campaign_id is distinct from materialization.campaign_id) billable_event_campaign_mismatch,
      count(*)filter(where materialization.status='charged'and(event.occurred_at<launch.billing_cutover_at)) billing_before_cutover,
      count(*)filter(where materialization.status='charged'and(event.occurred_at<window_row.opened_at or(window_row.expires_at is not null and event.occurred_at>=window_row.expires_at)or(window_row.closed_at is not null and materialization.finalized_at>window_row.closed_at))) billing_outside_authorization,
      count(*)filter(where materialization.status='charged'and(rate.id is null or rate.objective is distinct from campaign.objective or rate.billable_event_type is distinct from event.event_type or rate.placement_code is distinct from event.placement_code or event.occurred_at<rate.effective_from or(rate.effective_to is not null and event.occurred_at>=rate.effective_to))) wrong_rate_version
    from private.advertising_event_billing_materializations materialization
    left join private.advertising_events event on event.id=materialization.billable_event_id
    left join private.advertising_campaigns campaign on campaign.id=materialization.campaign_id
    left join private.advertising_billing_rate_versions rate on rate.id=materialization.billing_rate_version_id
    left join private.advertising_billing_authorization_windows window_row on window_row.id=materialization.authorization_window_id
    left join private.advertising_financial_events financial_event on financial_event.id=materialization.financial_event_id
    cross join launch
  ), spend_audit as(
    select count(*) spend_without_materialization
    from private.advertising_financial_events financial_event
    left join private.advertising_event_billing_materializations materialization
      on materialization.billable_event_id=financial_event.billable_event_id
    where financial_event.event_type='spend'
      and(materialization.id is null or materialization.financial_event_id is distinct from financial_event.id or materialization.status<>'charged')
  ), duplicate_audit as(
    select
      coalesce((select sum(candidate.count-1)from(select count(*)count from private.advertising_event_billing_materializations group by billable_event_id having count(*)>1)candidate),0)::bigint duplicate_materialization_count,
      coalesce((select sum(candidate.count-1)from(select count(*)count from private.advertising_event_billing_materializations where status='charged'group by billable_event_id having count(*)>1)candidate),0)::bigint duplicate_charged_event_count
  ), pending_audit as(
    select count(*) active_pending_reservation_overflow
    from private.advertising_campaign_finance finance
    where private.advertising_active_pending_reserved_bdag(finance.campaign_id,statement_timestamp())
      >finance.funded_bdag-finance.spent_bdag-finance.released_bdag
  ), mode_audit as(
    select
      case when launch.launch_mode='PRODUCTION' then
        (private.advertising_rate_coverage_at('PRODUCTION',null,'social_feed',statement_timestamp(),statement_timestamp()+interval '1 hour')->>'missing_count')::bigint else 0 end production_rate_coverage_gap,
      case when launch.launch_mode='CANARY_BILLING' then
        (private.advertising_rate_coverage_at('CANARY_BILLING',launch.campaign_id,launch.placement_code,launch.enabled_at,launch.expires_at)->>'missing_count')::bigint else 0 end canary_rate_scope_mismatch
    from launch
  )
  select private.advertising_finance_reconciliation_base()||jsonb_build_object(
    'materialization_without_financial_event',materialization_without_financial_event,
    'charged_materialization_amount_rate_mismatch',charged_materialization_amount_rate_mismatch,
    'spend_without_materialization',spend_without_materialization,
    'wrong_rate_version',wrong_rate_version,
    'duplicate_materialization_count',duplicate_materialization_count,
    'duplicate_charged_event_count',duplicate_charged_event_count,
    'billable_event_campaign_mismatch',billable_event_campaign_mismatch,
    'billing_before_cutover',billing_before_cutover,
    'billing_outside_authorization',billing_outside_authorization,
    'active_pending_reservation_overflow',active_pending_reservation_overflow,
    'production_rate_coverage_gap',production_rate_coverage_gap,
    'canary_rate_scope_mismatch',canary_rate_scope_mismatch
  )
  from materialization_audit cross join spend_audit cross join duplicate_audit cross join pending_audit cross join mode_audit
$$;

revoke all on function public.reconcile_advertising_finance()
from public,anon,authenticated,service_role;
grant execute on function public.reconcile_advertising_finance() to service_role;

create or replace function public.get_admin_advertising_finance_health()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  perform public.admin_require_capability('advertising.billing.read');
  perform public.admin_require_capability('finance.reconciliation.read');
  return jsonb_build_object(
    'authority','ads_v2','reconciliation',public.reconcile_advertising_finance(),
    'shared_legacy_reconciliation',public.reconcile_marketplace_ad_finance(),
    'finalization',public.reconcile_marketplace_ad_finalization(),
    'legacy_events',public.reconcile_marketplace_ad_events()
  );
end;
$$;

revoke all on function public.get_admin_advertising_finance_health()
from public,anon,authenticated,service_role;
grant execute on function public.get_admin_advertising_finance_health() to authenticated;

do $$
declare v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname in (
    'reconcile-advertising-billable-events-v2',
    'reconcile-advertising-campaign-lifecycle-v2',
    'reconcile-advertising-campaign-settlements-v2'
  ) loop perform cron.unschedule(v_job_id);end loop;
  perform cron.schedule('reconcile-advertising-billable-events-v2','* * * * *',
    'select public.reconcile_advertising_billable_events_v2(100);');
  perform cron.schedule('reconcile-advertising-campaign-lifecycle-v2','* * * * *',
    'select public.reconcile_advertising_campaign_lifecycle(100,now());');
  perform cron.schedule('reconcile-advertising-campaign-settlements-v2','* * * * *',
    'select public.reconcile_advertising_campaign_settlements_v2(100);');
end;
$$;

commit;
