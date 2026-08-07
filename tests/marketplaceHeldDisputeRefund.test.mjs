import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration=fs.readFileSync(new URL("../supabase/migrations/20260806100000_held_marketplace_dispute_refunds.sql",import.meta.url),"utf8");
const semantics=fs.readFileSync(new URL("../supabase/migrations/20260806110000_fix_dispute_review_release_semantics.sql",import.meta.url),"utf8");
const gateway=fs.readFileSync(new URL("../supabase/functions/bdag-ledger/index.ts",import.meta.url),"utf8");
const service=fs.readFileSync(new URL("../services/marketplaceSettlementService.ts",import.meta.url),"utf8");
const buyer=fs.readFileSync(new URL("../app/orders/[id].tsx",import.meta.url),"utf8");
const seller=fs.readFileSync(new URL("../app/seller/orders/[id].tsx",import.meta.url),"utf8");

test("final decisions remain immutable while manual review is append-only",()=>{
 assert.match(semantics,/check\(outcome in\('refund_buyer','release_seller','reject_claim'\)\)/);
 assert.match(migration,/dispute_id uuid not null unique/);
 assert.match(migration,/unique\(resolver_id,idempotency_key\)/);
 assert.match(migration,/marketplace_dispute_decisions_immutable/);
 assert.match(migration,/revoke all on public\.marketplace_dispute_decisions from public,anon,authenticated/);
 assert.match(semantics,/marketplace_dispute_review_actions_immutable/);
 assert.match(semantics,/revoke all on public\.marketplace_dispute_review_actions from public,anon,authenticated/);
 assert.match(semantics,/'finalDecision',null/);
});

test("manual review remains intermediate and later terminal resolution is possible",()=>{
 assert.match(semantics,/insert into public\.marketplace_dispute_review_actions/);
 assert.match(semantics,/set status='under_review',resolved_at=null/);
 assert.match(semantics,/return public\.marketplace_dispute_review_receipt\(action_id\)/);
 assert.match(semantics,/delete from public\.marketplace_dispute_decisions where outcome='manual_review'/);
});

test("support seller release has admin semantics and never confirms buyer delivery",()=>{
 const support=semantics.slice(semantics.indexOf('create or replace function public.release_marketplace_order_after_dispute_resolution'),semantics.indexOf('create or replace function public.resolve_marketplace_dispute'));
 assert.match(support,/p_resolver_id/);
 assert.match(support,/initiated_by\)values[\s\S]*p_resolver_id/);
 assert.doesNotMatch(support,/confirm_marketplace_order_delivery_and_release/);
 assert.doesNotMatch(support,/delivery_confirmed/);
 assert.doesNotMatch(support,/actor_role[^\n]*buyer/);
 assert.match(semantics,/'admin',case when p_outcome='release_seller'then'dispute_release_seller'/);
});

test("held refund uses the frozen exact gross and canonical ledger",()=>{
 assert.match(migration,/a\.gross_amount<>p\.gross_amount/);
 assert.match(migration,/a\.gross_amount<>a\.seller_net_amount\+a\.creator_commission_amount\+a\.platform_fee_amount/);
 assert.match(migration,/ledger_debit\(tx,escrow,a\.gross_amount/);
 assert.match(migration,/ledger_credit\(tx,buyer_account,a\.gross_amount/);
 assert.match(migration,/shipping_amount/);
 assert.doesNotMatch(migration,/fee_bps\s*\/\s*10000/);
});

test("refund changes all frozen allocation outcomes without debiting beneficiaries",()=>{
 assert.match(migration,/seller_allocation','refunded'/);
 assert.match(migration,/creator_allocation','refunded'/);
 assert.match(migration,/platform_allocation','refunded'/);
 assert.doesNotMatch(migration,/ledger_debit\([^,]+,[^,]*(seller|creator|platform)/i);
});

test("unsupported and conflict outcomes are explicit",()=>{
 for(const code of['marketplace_dispute_conflicting_decision','marketplace_refund_requires_manual_review','marketplace_partial_refund_unsupported','marketplace_refund_allocation_not_held','marketplace_refund_reconciliation_failed'])assert.match(migration,new RegExp(code));
 assert.match(migration,/allocation_count<>1 or a\.status<>'held'/);
});

test("trusted gateway derives admin authority and exposes no arbitrary financial input",()=>{
 assert.match(gateway,/\.from\('user_profiles'\)\.select\('is_admin'\)\.eq\('id', user\.id\)/);
 assert.match(gateway,/p_resolver_id: user\.id/);
 assert.match(gateway,/p_partial_amount: null/);
 assert.doesNotMatch(gateway,/buyer_id.*marketplace_dispute_resolve/);
 assert.doesNotMatch(gateway,/seller_id.*marketplace_dispute_resolve/);
 assert.doesNotMatch(gateway,/ledger_account_id.*marketplace_dispute_resolve/);
});

test("RPC is service-role only and uses explicit search paths and locks",()=>{
 assert.match(migration,/coalesce\(auth\.jwt\(\)->>'role',''\)<>'service_role'/);
 assert.match(migration,/revoke all on function[\s\S]*resolve_marketplace_dispute[\s\S]*from public,anon,authenticated/);
 assert.match(migration,/security definer set search_path=public/);
 assert.match(migration,/pg_advisory_xact_lock/);
 assert.match(migration,/marketplace_order_disputes where id=p_dispute_id for update/);
 assert.match(migration,/marketplace_payment_allocations where payment_id=p\.id order by id for update/);
 assert.match(migration,/ledger_accounts where id=any\(array\[escrow,buyer_account\]\)order by id for update/);
});

test("support service exposes typed outcomes and safe error normalization",()=>{
 assert.match(service,/MarketplaceDisputeFinalOutcome/);
 assert.match(service,/MarketplaceDisputeIntermediateReviewResult/);
 assert.match(service,/root\.kind==='intermediate_review'/);
 assert.match(service,/UUID\.test/);
 assert.match(service,/MarketplaceDisputeResolutionOutcome/);
 assert.match(service,/SupportMarketplaceDisputeDetail/);
 assert.match(service,/MarketplaceDisputeResolutionResult/);
 assert.match(service,/MarketplaceDisputeResolutionError/);
 assert.match(service,/source\.message,source\.details,source\.hint,context\.message,body\.error/);
 assert.doesNotMatch(service,/P0001/);
});

test("buyer and seller order screens have no privileged resolution action",()=>{
 for(const source of[buyer,seller]){
  assert.doesNotMatch(source,/resolveMarketplaceDispute/);
  assert.doesNotMatch(source,/refund_buyer|release_seller|reject_claim/);
 }
});
