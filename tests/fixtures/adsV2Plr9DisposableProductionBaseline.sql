-- Data rows intentionally excluded from the schema-only production dump but
-- required to compile PLR-9 against the exact legal pre-migration state.
begin;
set constraints all deferred;

insert into private.advertising_placement_catalog(
  code,label,surface_family,status,surface_verified,legacy_compatible,
  selection_enabled,v2_delivery_enabled,adapter_version
) values
  ('marketplace_home','Marketplace Home','marketplace','active',true,true,true,false,'legacy-marketplace-v2'),
  ('marketplace_search','Marketplace Search','marketplace','active',true,true,true,false,null),
  ('social_feed','Social Feed','social','active',true,true,true,false,'legacy-marketplace-v2'),
  ('stories','Stories','social','active',true,false,true,false,null),
  ('clips','Clips','social','active',true,false,true,false,null),
  ('live','LIVE','live','active',true,false,true,false,null);

insert into private.advertising_delivery_policy(
  singleton,policy_version,global_v2_delivery_enabled,
  require_authenticated_viewer,require_adult_viewer,require_approved_ad,
  geo_matching_enabled,language_matching_enabled,frequency_enforcement_enabled
) values(true,'nelyon-ads-delivery-v3',false,true,true,true,false,false,true);

insert into private.advertising_finance_policy(
  singleton,policy_version,currency,funding_enabled,spend_enabled,settlement_enabled,
  shared_escrow_account_type,shared_revenue_account_type,spend_requires_billable_event
) values(true,'nelyon-ads-finance-v2','BDAG',false,false,false,
  'marketplace_ads_escrow','marketplace_ads_revenue',true);

insert into private.advertising_campaign_lifecycle_policy(
  singleton,policy_version,activation_enabled,automatic_transitions_enabled
) values(true,'nelyon-ads-campaign-lifecycle-v2',false,false);

insert into private.advertising_canary_policy(
  singleton,policy_version,canary_enabled,business_account_id,ad_account_id,campaign_id,
  viewer_user_id,placement_code,max_budget_bdag,max_impressions,enabled_at,expires_at
) values(true,'nelyon-ads-canary-v1',false,null,null,null,null,null,0.01000000,1,null,null);

insert into private.advertising_event_policy(
  singleton,policy_version,authenticated_viewers_only,anonymous_events_enabled,
  interaction_max_delay_hours,click_attribution_window_hours,impression_attribution_window_hours,
  external_conversion_ingestion_enabled,marketplace_purchase_conversion_enabled,
  marketplace_purchase_conversion_started_at,
  marketplace_purchase_conversion_cursor_confirmed_at,
  marketplace_purchase_conversion_cursor_order_item_id
) values(true,'nelyon-ads-events-v1',true,false,24,24,24,false,true,
  '2026-09-27T18:57:33.378701Z',null,null);

set constraints all immediate;
commit;
