import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sql=fs.readFileSync(new URL('../supabase/migrations/20260802043000_fix_marketplace_settlement_reconciliation.sql',import.meta.url),'utf8');
const required=['released_without_settlement','settlement_without_release','delivered_with_held_allocation','released_order_not_delivered','released_shipment_not_delivered','delivery_timestamp_mismatch','settlement_amount_mismatch','settlement_leg_sum_mismatch','missing_seller_leg','missing_platform_leg','duplicate_seller_leg','duplicate_platform_leg','positive_leg_without_transaction','transaction_amount_mismatch','transaction_currency_mismatch','transaction_status_mismatch','transaction_operation_type_mismatch','transaction_reference_mismatch','transaction_source_account_mismatch','transaction_destination_account_mismatch','seller_beneficiary_mismatch','platform_beneficiary_mismatch','settlement_order_identity_mismatch','settlement_payment_identity_mismatch','settlement_allocation_identity_mismatch','escrow_expected_held_total','escrow_actual_balance','escrow_difference','escrow_shortage','escrow_surplus'];

test('settlement reconciliation reports every required invariant independently',()=>{
  for(const key of required)assert.match(sql,new RegExp(`'${key}'`),key);
  assert.match(sql,/actual\.total-held\.total/);
});

test('transaction legs validate authoritative operations, identities, accounts and BDAG',()=>{
  assert.match(sql,/marketplace_seller_settlement/);
  assert.match(sql,/marketplace_platform_fee_settlement/);
  assert.match(sql,/reference_type<>'marketplace_order'/);
  assert.match(sql,/initiated_by<>buyer_id/);
  assert.match(sql,/account_type='marketplace_escrow'/);
  assert.match(sql,/account_type='platform'/);
  assert.match(sql,/account_type='user'/);
  assert.match(sql,/transaction_currency<>'BDAG'/);
});

test('reconciliation stays read-only and service-role-only',()=>{
  assert.doesNotMatch(sql,/\b(insert|update|delete)\s+(into|public\.)/i);
  assert.match(sql,/language sql\s+stable\s+security definer/i);
  assert.match(sql,/revoke all on function public\.reconcile_marketplace_settlements\(\) from public,anon,authenticated/);
  assert.match(sql,/grant execute on function public\.reconcile_marketplace_settlements\(\) to service_role/);
});
