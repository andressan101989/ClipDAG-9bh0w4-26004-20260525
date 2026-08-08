import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/20260808100000_archive_historical_marketplace_shipping_rules.sql', 'utf8');
const proof = readFileSync('scripts/prove-marketplace-shipping.mjs', 'utf8');

test('referenced removed rules are archived while unused rules are deleted', () => {
  assert.match(migration, /set status='paused',archived_at=coalesce/);
  assert.match(migration, /exists\(\s*select 1 from public\.marketplace_order_shipping_snapshots s where s\.matched_rule_id=x\.id\)/);
  assert.match(migration, /delete from public\.marketplace_shipping_profile_regions x/);
  assert.match(migration, /not exists\(select 1 from public\.marketplace_order_shipping_snapshots s where s\.matched_rule_id=x\.id\)/);
});

test('archived rules are excluded and exact destinations reactivate the same identity', () => {
  assert.match(migration, /x\.archived_at is not null for update/);
  assert.match(migration, /status='active',archived_at=null/);
  assert.match(migration, /r\.archived_at is null/);
  assert.match(migration, /x\.status='active'and x\.archived_at is null/);
});

test('linked rollback proof covers historical immutability and reservation lifecycle', () => {
  for (const token of [
    'historical_rule_not_archived',
    'unused_rule_not_deleted',
    'historical_snapshot_changed',
    'archived_only_not_configuration_required',
    'other_active_rule_not_ready',
    'historical_rule_not_reactivated',
    'readded_quote_ambiguous',
    'frozen_reservation_changed_after_archive',
    'removed_rule_created_checkout',
    'new_reservation_not_readded_price',
  ]) assert.match(proof, new RegExp(token));
});

test('financial and protected integration formulas remain outside the archival migration', () => {
  assert.doesNotMatch(migration, /ledger_entries|financial_transactions|commission_bps|agora|deepar|walletconnect|callkit/i);
});
