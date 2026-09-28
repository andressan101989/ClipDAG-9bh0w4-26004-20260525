-- pgcrypto is installed in production under extensions. Schema-only clones do
-- not recreate extensions, so restore that exact dependency for RPC/audit tests.
create extension if not exists pgcrypto with schema extensions;

set session_replication_role = replica;

insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001');
insert into public.user_profiles(id)
values ('10000000-0000-4000-8000-000000000001');
insert into private.business_accounts(
  id, owner_user_id, display_name, status, origin, creation_idempotency_key
) values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'PLR9 Fixture Business', 'active', 'advertiser_self_service',
  '20000000-0000-4000-8000-000000000099'
);
insert into private.ad_accounts(
  id, business_account_id, name, status, billing_currency, is_default, created_by
) values (
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'PLR9 Ads', 'active', 'BDAG', true,
  '10000000-0000-4000-8000-000000000001'
);
insert into private.advertising_campaigns(
  id, ad_account_id, name, objective, status, created_by, creation_idempotency_key
) values (
  '40000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'PLR9 Billing Fixture', 'awareness', 'active',
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000099'
);
insert into private.advertising_campaign_finance(
  campaign_id, budget_bdag, currency, finance_status, funded_bdag, spent_bdag,
  released_bdag, funding_source_account_id, funded_by_user_id, funded_at,
  created_by, creation_idempotency_key
) values (
  '40000000-0000-4000-8000-000000000001', 0.01000000, 'BDAG', 'funded',
  0.01000000, 0, 0, '90000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001', clock_timestamp(),
  '10000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000099'
);

insert into private.advertising_ad_sets(
  id, campaign_id, name, status, starts_at, ends_at, creation_idempotency_key, created_by
) values (
  '50000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'PLR9 Set', 'draft', clock_timestamp() - interval '1 day', clock_timestamp() + interval '1 day',
  '50000000-0000-4000-8000-000000000099',
  '10000000-0000-4000-8000-000000000001'
);
insert into private.advertising_destinations(
  id, campaign_id, destination_type, external_url, status, creation_idempotency_key, created_by
) values (
  '60000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'external_url', 'https://example.com/plr9', 'draft',
  '60000000-0000-4000-8000-000000000099',
  '10000000-0000-4000-8000-000000000001'
);
insert into private.advertising_creatives(
  id, ad_account_id, name, status, created_by, creation_idempotency_key
) values (
  '70000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'PLR9 Creative', 'draft',
  '10000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000099'
);
insert into private.advertising_creative_versions(
  id, creative_id, version_number, format, media_asset_id, primary_text,
  call_to_action, content_fingerprint, created_by, creation_idempotency_key
) values (
  '71000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001', 1, 'image',
  '72000000-0000-4000-8000-000000000001', 'PLR9 fixture', 'learn_more',
  repeat('a', 64), '10000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000099'
);
insert into private.advertising_ads(
  id, ad_set_id, creative_version_id, destination_id, name, status, review_status,
  submission_fingerprint, submitted_at, reviewed_at, created_by, creation_idempotency_key
) values (
  '80000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  'PLR9 Ad', 'draft', 'approved', repeat('b', 64), clock_timestamp(), clock_timestamp(),
  '10000000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000099'
);
insert into private.advertising_audiences(
  id, ad_set_id, status, created_by, creation_idempotency_key
) values (
  '81000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', 'draft',
  '10000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000099'
);
insert into private.advertising_audience_versions(
  id, audience_id, version_number, age_scope, targeting_policy_version,
  definition_fingerprint, creation_idempotency_key, created_by
) values (
  '82000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001', 1, 'adults_only',
  'nelyon-ads-targeting-v2', repeat('c', 64),
  '82000000-0000-4000-8000-000000000099',
  '10000000-0000-4000-8000-000000000001'
);
insert into private.advertising_placement_selections(
  id, ad_set_id, status, created_by, creation_idempotency_key
) values (
  '83000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', 'draft',
  '10000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000099'
);
insert into private.advertising_placement_selection_versions(
  id, placement_selection_id, version_number, registry_policy_version,
  definition_fingerprint, creation_idempotency_key, created_by
) values (
  '84000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001', 1,
  'nelyon-ads-delivery-v3', repeat('d', 64),
  '84000000-0000-4000-8000-000000000099',
  '10000000-0000-4000-8000-000000000001'
);
insert into private.advertising_placement_selection_items(
  placement_selection_version_id, placement_code
) values (
  '84000000-0000-4000-8000-000000000001', 'social_feed'
);

insert into public.ledger_accounts(id, owner_id, account_type, balance, frozen, currency)
values
  ('90000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','user',1,false,'BDAG'),
  ('90000000-0000-4000-8000-000000000002',null,'marketplace_ads_escrow',0.01000000,false,'BDAG'),
  ('90000000-0000-4000-8000-000000000003',null,'marketplace_ads_revenue',0,false,'BDAG');

update private.advertising_finance_policy
set funding_enabled = true, spend_enabled = true, settlement_enabled = true;
update private.advertising_campaign_lifecycle_policy
set activation_enabled = true, automatic_transitions_enabled = true;
update private.advertising_delivery_policy set global_v2_delivery_enabled = true;
update private.advertising_placement_catalog
set v2_delivery_enabled = (code = 'social_feed');
update private.advertising_canary_policy
set launch_mode = 'PRODUCTION', canary_enabled = false,
    business_account_id = null, ad_account_id = null, campaign_id = null,
    viewer_user_id = null, placement_code = null, enabled_at = null, expires_at = null,
    max_budget_bdag = null, max_impressions = null,
    max_spend_bdag = null, max_billable_events = null;

insert into private.advertising_billing_rate_versions(
  id, objective, billable_event_type, placement_code, rate_bdag, currency,
  scope, state, effective_from, published_at
) values (
  'a0000000-0000-4000-8000-000000000001', 'awareness', 'impression',
  'social_feed', 0.00600000, 'BDAG', 'global', 'published',
  clock_timestamp() - interval '1 minute', clock_timestamp()
);
insert into private.advertising_billing_authorization_windows(
  id, mode, scope, opened_at, status
) values (
  'b0000000-0000-4000-8000-000000000001',
  'PRODUCTION', 'global', clock_timestamp() - interval '1 minute', 'OPEN'
);

set session_replication_role = origin;

-- The production migration runner owns both legacy and PLR-9 authorities.
-- The schema-only disposable clone retains legacy functions under postgres
-- while new fixture tables are owned by supabase_admin, so align only those
-- owner-to-owner privileges for faithful SECURITY DEFINER execution.
grant select, update on private.advertising_billing_authorization_windows to postgres;
grant select on private.advertising_billing_rate_versions to postgres;
grant select, update on private.advertising_event_billing_materializations to postgres;
grant execute on function private.advertising_canary_spend_allowed(uuid,timestamptz) to postgres;
grant execute on function private.advertising_campaign_billing_readiness_at(uuid,text,timestamptz) to postgres;
