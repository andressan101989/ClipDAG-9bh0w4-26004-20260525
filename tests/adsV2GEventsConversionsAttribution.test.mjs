import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../supabase/migrations/20260922234902_ads_v2_g_events_conversions_attribution.sql", import.meta.url), "utf8");

test("G creates one private append-only events, conversions and attribution authority", () => {
  for (const table of ["advertising_event_policy","advertising_events","advertising_conversions","advertising_attributions"]) assert.match(sql,new RegExp(`create table private\\.${table}`));
  assert.match(sql,/event_type text not null[\s\S]+impression[\s\S]+destination_open[\s\S]+video_view[\s\S]+engagement/i);
  assert.match(sql,/event_key uuid not null unique/i);
  assert.match(sql,/viewer_user_id uuid[\s\S]+references auth\.users\(id\)[\s\S]+on delete set null/i);
  assert.match(sql,/advertising_g_append_only/i);
});

test("service-only recorders derive context and never expose client event writes", () => {
  for (const fn of ["record_advertising_impression_v2","record_advertising_interaction_v2","record_advertising_marketplace_purchase_conversion_v2"]) {
    assert.match(sql,new RegExp(`function public\\.${fn}`));
    assert.match(sql,new RegExp(`revoke all on function public\\.${fn}[\\s\\S]+from public, anon, authenticated`));
    assert.match(sql,new RegExp(`grant execute on function public\\.${fn}[\\s\\S]+to service_role`));
  }
  assert.match(sql,/production_deliverable/i);
  const start=sql.indexOf("create or replace function public.record_advertising_impression_v2");
  const body=sql.slice(start,sql.indexOf("$$;",start)+3);
  assert.doesNotMatch(body,/p_campaign_id|p_ad_set_id|p_creative_version_id|p_destination_id|p_audience_version_id|p_metadata/i);
});

test("frequency uses only V2 impressions and delivery remains disabled", () => {
  assert.match(sql,/function private\.advertising_impression_count_for_frequency/i);
  assert.match(sql,/event_type\s*=\s*'impression'/i);
  assert.match(sql,/frequency_cap_reached/);
  assert.match(sql,/frequency_enforcement_disabled/);
  assert.match(sql,/nelyon-ads-delivery-v2/);
  assert.match(sql,/not global_v2_delivery_enabled/i);
  assert.doesNotMatch(sql,/v2_delivery_enabled\s*=\s*true/i);
  assert.doesNotMatch(sql,/marketplace_ad_events[\s\S]{0,300}frequency/i);
});

test("Marketplace purchase conversion is server-derived and attribution is last click then impression", () => {
  assert.match(sql,/marketplace_purchase/);
  assert.match(sql,/source_type[^;]+marketplace_order_item/is);
  assert.match(sql,/last_click_then_impression/);
  assert.match(sql,/objective\s*=\s*'marketplace_sales'/i);
  assert.match(sql,/destination_type\s*=\s*'marketplace_product'/i);
  assert.match(sql,/destination_type\s*=\s*'marketplace_store'/i);
  const start=sql.indexOf("create or replace function public.record_advertising_marketplace_purchase_conversion_v2");
  const body=sql.slice(start,sql.indexOf("$$;",start)+3);
  assert.doesNotMatch(body,/p_value|p_currency|website_pixel|device_fingerprint|device_id|ip_address|latitude|longitude/i);
});

test("owner analytics is aggregate-only and contains no viewer or source identities", () => {
  assert.match(sql,/function public\.get_my_advertising_event_summary/i);
  for (const metric of ["impressions","clicks","destination_opens","video_views","engagements","conversions","attributed_conversions","marketplace_purchase_value_bdag","ctr"]) assert.match(sql,new RegExp(`'${metric}'`));
  const start=sql.indexOf("create or replace function public.get_my_advertising_event_summary");
  const body=sql.slice(start,sql.indexOf("$$;",start)+3);
  assert.doesNotMatch(body,/viewer_user_id|event_key|source_reference_id/);
});

test("legacy reconciler accepts all six canonical legacy event surfaces", () => {
  const start=sql.indexOf("create or replace function public.reconcile_marketplace_ad_events");
  const body=sql.slice(start,sql.indexOf("$$;",start)+3);
  for (const surface of ["marketplace_home","marketplace_search","social_feed","product_detail","cart","checkout"]) assert.match(body,new RegExp(`'${surface}'`));
});

test("G keeps finance, clients, Edge, activation and raw metadata out of scope", () => {
  assert.doesNotMatch(sql,/insert into public\.(financial_transactions|ledger_entries|marketplace_ad_events)|update public\.marketplace_|create.*edge|alter table private\.advertising_campaigns|metadata jsonb/i);
  assert.doesNotMatch(sql,/grant execute[^;]+record_advertising_(?:impression|interaction|marketplace_purchase)[^;]+to authenticated/i);
});
