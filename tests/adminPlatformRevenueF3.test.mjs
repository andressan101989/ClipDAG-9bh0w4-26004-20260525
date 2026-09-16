import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const migration=readFileSync("supabase/migrations/20260914135039_admin_platform_revenue_projection_v1.sql","utf8");
const page=readFileSync("apps/admin-web/src/pages/AdminFinanceAuditSystemPages.tsx","utf8");
const api=readFileSync("apps/admin-web/src/lib/adminObservabilityApi.ts","utf8");
const functionBody=migration.slice(migration.indexOf("create or replace function"),migration.indexOf("revoke all on function"));
const revenueEvents=functionBody.slice(functionBody.indexOf("revenue_events as"),functionBody.indexOf("currencies as"));

test("F3 exposes one read-only, capability-gated revenue projection",()=>{
  assert.match(migration,/get_admin_platform_revenue\(\s*p_period text default 'ytd'/);
  assert.match(migration,/language plpgsql\s+stable\s+security definer\s+set search_path = ''/);
  assert.match(migration,/admin_require_capability\('finance\.ledger\.read'\)/);
  assert.match(migration,/revoke all on function public\.get_admin_platform_revenue\(text\) from public,anon,authenticated,service_role/);
  assert.match(migration,/grant execute on function public\.get_admin_platform_revenue\(text\) to authenticated/);
  assert.doesNotMatch(functionBody,/\b(insert|update|delete|merge|truncate)\b/i);
  assert.doesNotMatch(migration,/create\s+table/i);
});

test("LIVE and withdrawal fees use domain authorities without double counting",()=>{
  assert.match(revenueEvents,/from public\.live_gift_transactions g/);
  assert.match(revenueEvents,/g\.platform_fee_coins::numeric gross/);
  assert.match(revenueEvents,/from public\.withdrawal_requests w[\s\S]*w\.status='completed'/);
  assert.doesNotMatch(revenueEvents,/from public\.financial_transactions/);
  assert.match(functionBody,/f\.fee_amount<>g\.platform_fee_coins/);
  assert.match(functionBody,/f\.fee_amount<>w\.fee_bdag/);
});

test("Marketplace revenue counts platform fee and only proven fee reversals",()=>{
  assert.match(revenueEvents,/marketplace_order_settlements s[\s\S]*s\.platform_fee_amount/);
  assert.match(revenueEvents,/marketplace_return_refund_hold_legs l[\s\S]*l\.leg_type='platform_fee'/);
  assert.match(revenueEvents,/marketplace_settlement_reversal_legs l[\s\S]*l\.leg_type='platform_fee'/);
  assert.doesNotMatch(revenueEvents,/marketplace_return_refunds/);
  assert.doesNotMatch(revenueEvents,/gross_amount/);
  assert.match(functionBody,/osl\.destination_account_id<>l\.source_account_id/);
});

test("Ads recognizes spend and excludes funding and release",()=>{
  assert.match(revenueEvents,/marketplace_ad_financial_events e[\s\S]*e\.event_type='spend'/);
  assert.doesNotMatch(revenueEvents,/event_type='fund'|event_type='release'/);
  assert.match(functionBody,/account_type='marketplace_ads_revenue'/);
  assert.match(functionBody,/account_type='marketplace_ads_escrow'/);
});

test("periods are bounded in UTC and currencies never collapse into one total",()=>{
  for(const period of ["day","month","year"])assert.match(functionBody,new RegExp(`date_trunc\\('${period}'.*time zone 'UTC'`));
  assert.match(functionBody,/group by c\.currency/);
  assert.match(functionBody,/group by 1,currency/);
  assert.match(functionBody,/invalid_revenue_period/);
});

test("known non-revenue operations are absent from the recognition allow-list",()=>{
  for(const operation of ["deposit","transfer","marketplace_payment_capture","marketplace_seller_settlement","marketplace_creator_commission_settlement","marketplace_test_funding","marketplace_fixture_cleanup_sweep","marketplace_ad_fund","marketplace_ad_release"]){
    assert.doesNotMatch(revenueEvents,new RegExp(operation),operation);
  }
});

test("Finance overview renders revenue, reconciliation, and current balances separately",()=>{
  assert.match(api,/getAdminPlatformRevenue[\s\S]*get_admin_platform_revenue[\s\S]*p_period:period/);
  for(const label of ["Saldo actual BDAG","Equivalente USD","Ingresos de Nelyon","Ingresos brutos","Reversiones","Ingresos netos","Detalle de cuentas de plataforma","Estado de reconciliación"])assert.match(page,new RegExp(label));
  assert.match(page,/saldo actual puede diferir del revenue acumulado/i);
  assert.doesNotMatch(page,/JSON\.stringify/);
});
