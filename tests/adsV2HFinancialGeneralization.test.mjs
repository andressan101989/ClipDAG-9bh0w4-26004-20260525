import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../supabase/migrations/20260923033100_ads_v2_h_financial_generalization.sql", import.meta.url), "utf8");

test("H creates one disabled private finance policy using the shared legacy-named accounts", () => {
  assert.match(sql,/create table private\.advertising_finance_policy/i);
  assert.match(sql,/nelyon-ads-finance-v1/);
  assert.match(sql,/funding_enabled boolean not null default false/i);
  assert.match(sql,/spend_enabled boolean not null default false/i);
  assert.match(sql,/settlement_enabled boolean not null default false/i);
  assert.match(sql,/marketplace_ads_escrow/);
  assert.match(sql,/marketplace_ads_revenue/);
  assert.doesNotMatch(sql,/insert into public\.ledger_accounts/i);
});

test("campaign finance is one-per-campaign and snapshots the exact funding source", () => {
  assert.match(sql,/create table private\.advertising_campaign_finance/i);
  assert.match(sql,/campaign_id uuid primary key/i);
  assert.match(sql,/funding_source_account_id uuid[\s\S]+references public\.ledger_accounts\(id\)/i);
  assert.match(sql,/spent_bdag \+ released_bdag <= funded_bdag/i);
  assert.match(sql,/funded_bdag <= budget_bdag/i);
  assert.match(sql,/finance_status text not null[\s\S]+draft[\s\S]+funded[\s\S]+settled/i);
});

test("budget draft is owner-only, adult, idempotent and never moves money", () => {
  const body = functionBody("public.create_my_advertising_campaign_finance_draft");
  assert.match(body,/auth\.uid\(\)/i);
  assert.match(body,/ads_actor_is_advertiser_age_eligible/i);
  assert.match(body,/owner_user_id/i);
  assert.match(body,/creation_idempotency_key/i);
  assert.doesNotMatch(body,/financial_transactions|ledger_debit|ledger_credit|ensure_ledger_account/i);
});

test("fund, spend and settle use the global ledger and safe operation labels", () => {
  const fund=functionBody("public.fund_my_advertising_campaign_budget_v2");
  const spend=functionBody("public.spend_advertising_campaign_budget_v2");
  const settle=functionBody("public.settle_advertising_campaign_budget_v2");
  assert.match(fund,/funding_enabled/i); assert.match(fund,/ensure_ledger_account/i); assert.match(fund,/advertising_campaign_fund/i);
  assert.match(spend,/spend_enabled/i); assert.match(spend,/advertising_campaign_spend/i); assert.match(spend,/billable_event_id/i);
  assert.match(settle,/settlement_enabled/i); assert.match(settle,/funding_source_account_id/i); assert.match(settle,/advertising_campaign_release/i);
  for (const body of [fund,spend,settle]) {
    assert.match(body,/ledger_debit/i); assert.match(body,/ledger_credit/i);
    assert.doesNotMatch(body,/update\s+private\.advertising_campaigns/i);
    assert.doesNotMatch(body,/campaign\.status\s+in\s*\([^)]*(?:active|scheduled)/i);
  }
});

test("financial history is append-only and billable events cannot be charged twice", () => {
  assert.match(sql,/create table private\.advertising_financial_events/i);
  assert.match(sql,/create table private\.advertising_financial_settlements/i);
  assert.match(sql,/advertising_financial_history_append_only/i);
  assert.match(sql,/unique \(financial_transaction_id\)/i);
  assert.match(sql,/unique \(event_type,\s*idempotency_key\)/i);
  assert.match(sql,/unique[\s\S]+billable_event_id[\s\S]+where event_type='spend'/i);
});

test("V2 reconciliation audits shared escrow, directions, state, settlement and billable events", () => {
  const body=functionBody("public.reconcile_advertising_finance");
  for (const key of ["funding_reconciliation","spend_reconciliation","release_reconciliation","funding_unexpected_entries","spend_unexpected_entries","release_unexpected_entries","event_transaction_mismatches","orphan_advertising_financial_events","orphan_advertising_transactions","campaign_finance_state_mismatches","settlement_mismatches","billable_event_mismatches","duplicate_billable_spend_count","wrong_release_destination_count","shared_escrow_liability_difference"]) assert.match(body,new RegExp(`'${key}'`));
});

test("legacy reconciler preserves its contract and includes both liabilities", () => {
  const body=functionBody("public.reconcile_marketplace_ad_finance");
  for (const key of ["orphan_ads_events","spend_reconciliation","funding_reconciliation","release_reconciliation","unexpected_ads_entries","orphan_ads_transactions","release_wrong_recipient","spend_escrow_difference","spend_revenue_difference","spend_unexpected_entries","funding_escrow_difference","funding_source_difference","release_escrow_difference","funding_unexpected_entries","release_unexpected_entries","escrow_liability_difference","campaign_equation_mismatches","event_transaction_mismatches","campaign_accounting_mismatches","release_destination_difference","fund_transaction_event_count_difference","spend_transaction_event_count_difference","release_transaction_event_count_difference"]) assert.match(body,new RegExp(`'${key}'`));
  assert.match(body,/private\.advertising_campaign_finance/i);
  assert.match(body,/legacy_liability/i);
  assert.match(body,/v2_liability/i);
});

test("clients cannot spend, settle, reconcile or access private finance tables", () => {
  for (const table of ["advertising_finance_policy","advertising_campaign_finance","advertising_financial_events","advertising_financial_settlements"]) {
    assert.match(sql,new RegExp(`alter table private\\.${table} force row level security`));
    assert.match(sql,new RegExp(`revoke all on table private\\.${table}[\\s\\S]+from public, anon, authenticated`));
  }
  for (const fn of ["spend_advertising_campaign_budget_v2","settle_advertising_campaign_budget_v2","reconcile_advertising_finance"]) {
    assert.match(sql,new RegExp(`revoke all on function public\\.${fn}[\\s\\S]+from public, anon, authenticated`));
    assert.match(sql,new RegExp(`grant execute on function public\\.${fn}[\\s\\S]+to service_role`));
  }
});

test("H creates no wallet, ledger, escrow, revenue account or delivery activation authority", () => {
  assert.doesNotMatch(sql,/create table (?:private|public)\.(?:advertising_wallets|ad_account_wallets|ads_ledger_accounts|advertising_escrow|ads_v2_escrow|advertising_revenue)/i);
  assert.doesNotMatch(sql,/alter table private\.ad_accounts/i);
  assert.doesNotMatch(sql,/global_v2_delivery_enabled\s*=\s*true|v2_delivery_enabled\s*=\s*true|create.*activate.*advertising/i);
  assert.doesNotMatch(sql,/insert into private\.advertising_events|insert into public\.marketplace_ad_financial_events/i);
});

function functionBody(name) {
  const start=sql.toLowerCase().indexOf(`create or replace function ${name}`.toLowerCase());
  assert.ok(start>=0,`${name} missing`);
  return sql.slice(start,sql.indexOf("$$;",start)+3);
}
