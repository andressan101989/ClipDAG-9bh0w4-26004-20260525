import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/20260807120000_preserve_marketplace_shipping_statuses.sql', 'utf8');
const service = readFileSync('services/marketplaceShippingService.ts', 'utf8');
const screen = readFileSync('app/seller/shipping-profile.tsx', 'utf8');
const proof = readFileSync('scripts/prove-marketplace-shipping.mjs', 'utf8');

test('shipping edit preserves stable rule and profile status', () => {
  assert.match(migration, /where x\.id=rule_id and x\.profile_id=result/);
  assert.doesNotMatch(migration, /status='active',updated_at/);
  assert.match(migration, /not\(x\.id=any\(kept_ids\)\)/);
  assert.match(migration, /'id',r\.id/);
});

test('shipping destinations use authoritative country and region validation', () => {
  assert.match(migration, /marketplace_country_is_valid\(country\)/);
  assert.match(migration, /marketplace_normalize_shipping_region\(country,r->>'region_code'\)/);
  assert.match(migration, /marketplace_shipping_rule_not_owned/);
});

test('client carries rule identity and status without exposing a status toggle', () => {
  assert.match(service, /id: string \| null/);
  assert.match(service, /id:region\.id,status:region\.status/);
  assert.doesNotMatch(screen, /status:_/);
  assert.match(screen, /id:null,status:'active'/);
});

test('linked proof exercises status, validation, security and rollback', () => {
  for (const token of ['paused_rule_not_preserved', 'paused_profile_reactivated', 'marketplace_shipping_rule_not_owned', 'marketplace_shipping_country_invalid', 'marketplace_shipping_region_invalid', 'zero_rule_status_regression', 'rollback_changed']) assert.match(proof, new RegExp(token));
});
