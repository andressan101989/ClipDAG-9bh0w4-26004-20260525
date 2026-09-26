-- ADS-V2-PLR-6B-C2: make the existing launch policies atomically armable
-- only inside the exact, prelaunch social_feed canary envelope.
-- This migration leaves the canary and every operational switch disabled.

begin;

do $$
begin
  if pg_catalog.to_regclass('private.advertising_canary_policy') is null
    or pg_catalog.to_regclass('private.advertising_finance_policy') is null
    or pg_catalog.to_regclass('private.advertising_campaign_lifecycle_policy') is null
    or pg_catalog.to_regclass('private.advertising_delivery_policy') is null
    or pg_catalog.to_regclass('private.advertising_placement_catalog') is null then
    raise exception 'ads_v2_plr_6b_c2_policy_foundation_required';
  end if;
  if (select pg_catalog.count(*) from private.advertising_canary_policy where singleton) <> 1
    or (select pg_catalog.count(*) from private.advertising_finance_policy where singleton) <> 1
    or (select pg_catalog.count(*) from private.advertising_campaign_lifecycle_policy where singleton) <> 1
    or (select pg_catalog.count(*) from private.advertising_delivery_policy where singleton) <> 1 then
    raise exception 'ads_v2_plr_6b_c2_singleton_policy_required';
  end if;
  if pg_catalog.to_regprocedure('private.advertising_assert_canary_launch_envelope()') is not null then
    raise exception 'ads_v2_plr_6b_c2_invariant_conflict';
  end if;
end;
$$;

alter table private.advertising_finance_policy
  add constraint advertising_finance_policy_v2_safe_chk check (
    policy_version <> 'nelyon-ads-finance-v2'
    or (
      currency = 'BDAG'
      and not spend_enabled
      and shared_escrow_account_type = 'marketplace_ads_escrow'
      and shared_revenue_account_type = 'marketplace_ads_revenue'
      and spend_requires_billable_event
    )
  );

alter table private.advertising_campaign_lifecycle_policy
  add constraint advertising_campaign_lifecycle_policy_v2_safe_chk check (
    policy_version <> 'nelyon-ads-campaign-lifecycle-v2'
    or not automatic_transitions_enabled
  );

alter table private.advertising_delivery_policy
  add constraint advertising_delivery_policy_v3_safe_chk check (
    policy_version <> 'nelyon-ads-delivery-v3'
    or (
      require_authenticated_viewer
      and require_adult_viewer
      and require_approved_ad
      and not geo_matching_enabled
      and not language_matching_enabled
      and frequency_enforcement_enabled
    )
  );

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
begin
  select * into v_canary
  from private.advertising_canary_policy
  where singleton;
  if not found then
    raise exception using
      errcode = '23514',
      message = 'advertising_canary_launch_envelope_missing_policy',
      detail = 'policy=canary';
  end if;

  select * into v_finance
  from private.advertising_finance_policy
  where singleton;
  if not found then
    raise exception using
      errcode = '23514',
      message = 'advertising_canary_launch_envelope_missing_policy',
      detail = 'policy=finance';
  end if;

  select * into v_lifecycle
  from private.advertising_campaign_lifecycle_policy
  where singleton;
  if not found then
    raise exception using
      errcode = '23514',
      message = 'advertising_canary_launch_envelope_missing_policy',
      detail = 'policy=lifecycle';
  end if;

  select * into v_delivery
  from private.advertising_delivery_policy
  where singleton;
  if not found then
    raise exception using
      errcode = '23514',
      message = 'advertising_canary_launch_envelope_missing_policy',
      detail = 'policy=delivery';
  end if;

  if not v_canary.canary_enabled then
    if v_finance.funding_enabled
      or v_finance.spend_enabled
      or v_finance.settlement_enabled
      or v_lifecycle.activation_enabled
      or v_lifecycle.automatic_transitions_enabled
      or v_delivery.global_v2_delivery_enabled
      or exists (
        select 1
        from private.advertising_placement_catalog placement
        where placement.v2_delivery_enabled
      ) then
      raise exception using
        errcode = '23514',
        message = 'advertising_canary_launch_envelope_violation',
        detail = 'mode=disarmed';
    end if;
  else
    if not v_finance.funding_enabled
      or v_finance.spend_enabled
      or v_finance.settlement_enabled
      or not v_lifecycle.activation_enabled
      or v_lifecycle.automatic_transitions_enabled
      or not v_delivery.global_v2_delivery_enabled
      or not exists (
        select 1
        from private.advertising_placement_catalog placement
        where placement.code = 'social_feed'
          and placement.v2_delivery_enabled
      )
      or exists (
        select 1
        from private.advertising_placement_catalog placement
        where placement.code <> 'social_feed'
          and placement.v2_delivery_enabled
      ) then
      raise exception using
        errcode = '23514',
        message = 'advertising_canary_launch_envelope_violation',
        detail = 'mode=armed_canary';
    end if;
  end if;

  return null;
end;
$$;

revoke all on function private.advertising_assert_canary_launch_envelope()
from public, anon, authenticated, service_role;

create constraint trigger advertising_canary_launch_envelope_canary_guard
after insert or update or delete on private.advertising_canary_policy
deferrable initially deferred
for each row execute function private.advertising_assert_canary_launch_envelope();

create constraint trigger advertising_canary_launch_envelope_finance_guard
after insert or update or delete on private.advertising_finance_policy
deferrable initially deferred
for each row execute function private.advertising_assert_canary_launch_envelope();

create constraint trigger advertising_canary_launch_envelope_lifecycle_guard
after insert or update or delete on private.advertising_campaign_lifecycle_policy
deferrable initially deferred
for each row execute function private.advertising_assert_canary_launch_envelope();

create constraint trigger advertising_canary_launch_envelope_delivery_guard
after insert or update or delete on private.advertising_delivery_policy
deferrable initially deferred
for each row execute function private.advertising_assert_canary_launch_envelope();

create constraint trigger advertising_canary_launch_envelope_placement_guard
after insert or update or delete on private.advertising_placement_catalog
deferrable initially deferred
for each row execute function private.advertising_assert_canary_launch_envelope();

update private.advertising_finance_policy
set policy_version = 'nelyon-ads-finance-v2',
    funding_enabled = false,
    spend_enabled = false,
    settlement_enabled = false
where singleton;

update private.advertising_campaign_lifecycle_policy
set policy_version = 'nelyon-ads-campaign-lifecycle-v2',
    activation_enabled = false,
    automatic_transitions_enabled = false
where singleton;

update private.advertising_delivery_policy
set policy_version = 'nelyon-ads-delivery-v3',
    global_v2_delivery_enabled = false
where singleton;

update private.advertising_placement_catalog
set v2_delivery_enabled = false;

comment on function private.advertising_assert_canary_launch_envelope() is
  'Deferred final-state guard permitting only fully disarmed or exact social_feed canary launch policy envelopes.';

commit;
