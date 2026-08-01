import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';
const sql=readFileSync('supabase/migrations/20260731223000_marketplace_mkt_a3b_orders_reservations.sql','utf8');

test('schema creates one checkout, private address, seller orders, immutable items, reservations and append-only events',()=>{
 for(const table of ['marketplace_checkout_sessions','marketplace_checkout_shipping_addresses','marketplace_orders','marketplace_order_items','marketplace_inventory_reservations','marketplace_inventory_reservation_events'])assert.match(sql,new RegExp(`create table public\\.${table}`));
 assert.match(sql,/unique\(checkout_id,store_id\)/);assert.match(sql,/unique\(order_id,variant_id\)/);assert.match(sql,/unique\(checkout_id,variant_id\)/);
 assert.match(sql,/marketplace_order_items_immutable/);assert.match(sql,/marketplace_reservation_events_append_only/);
});

test('checkout creation is authenticated, idempotent, canonical and seller-separated',()=>{
 assert.match(sql,/create_marketplace_checkout_reservation\(p_items jsonb,p_shipping_address jsonb,p_idempotency_key uuid\)/);
 assert.match(sql,/auth\.uid\(\)/);assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/digest\([\s\S]*'sha256'/);
 assert.match(sql,/buyer_id=v_user and idempotency_key=p_idempotency_key/);assert.match(sql,/marketplace_idempotency_conflict/);
 assert.match(sql,/marketplace_active_checkout_exists/);assert.match(sql,/where checkout_id=v_checkout and store_id=v_variant\.store_id/);
 assert.match(sql,/jsonb_object_length\(e\)<>2/);assert.match(sql,/marketplace_duplicate_variant/);
});

test('authoritative validation and snapshots never trust client commerce fields',()=>{
 assert.match(sql,/v_product\.status<>'active'/);assert.match(sql,/v_product\.published_at is null/);assert.match(sql,/v_product\.moderation_status<>'approved'/);
 assert.match(sql,/marketplace_seller_is_approved/);assert.match(sql,/v_variant\.status<>'active'/);assert.match(sql,/marketplace_own_product_forbidden/);
 assert.match(sql,/v_variant\.price\*x\.quantity/);assert.match(sql,/marketplace_variant_option_values/);
 assert.doesNotMatch(sql,/p_(?:price|product_id|seller_id|store_id|subtotal|total|currency|image_url|option)/);
});

test('deterministic row locks prevent overselling and reservations never change on_hand',()=>{
 assert.match(sql,/order by v\.id for update of v,l/);assert.match(sql,/order by \(e->>'variant_id'\)::uuid/);
 assert.match(sql,/v_inventory\.on_hand-v_inventory\.reserved<x\.quantity/);assert.match(sql,/marketplace_insufficient_inventory/);
 assert.match(sql,/set reserved=reserved\+x\.quantity,version=version\+1/);
 assert.match(sql,/set reserved=reserved-r\.quantity,version=version\+1/);
 assert.doesNotMatch(sql,/set\s+on_hand\s*=/i);assert.match(sql,/refresh_marketplace_product_projection/);
});

test('cancellation and expiration release exactly active reservations and are retry safe',()=>{
 assert.match(sql,/cancel_marketplace_checkout_reservation/);assert.match(sql,/c\.status in \('cancelled','expired'\)/);
 assert.match(sql,/where ir\.checkout_id=p_checkout_id and ir\.status='active'/);assert.match(sql,/where id=r\.id and status='active'/);
 assert.match(sql,/marketplace_checkout_not_cancellable/);assert.match(sql,/expire_marketplace_checkout_reservations/);
 assert.match(sql,/for update skip locked limit p_limit/);assert.match(sql,/expire-marketplace-checkout-reservations/);
});

test('RLS blocks direct writes and buyer-scoped reads do not expose pending addresses to sellers',()=>{
 assert.equal((sql.match(/enable row level security/g)||[]).length,6);assert.match(sql,/marketplace_checkout_buyer_read/);
 assert.match(sql,/marketplace_shipping_buyer_read/);assert.match(sql,/buyer_id=auth\.uid\(\)/);
 assert.match(sql,/revoke all on public\.marketplace_checkout_sessions[\s\S]*from public,anon,authenticated/);
 assert.doesNotMatch(sql,/policy[\s\S]{0,120}seller_id=auth\.uid\(\)/);
});

test('financial scope contains no payment, ledger, payout, commission, USDT or consumption implementation',()=>{
 assert.doesNotMatch(sql,/atomic_ledger_transfer|ledger_accounts|ledger_entries|wallet_balance|USDT|payment_intent|seller_payout|platform_commission/i);
 assert.doesNotMatch(sql,/status\s*=\s*'paid'|values\s*\([^;]*'consume'/i);
});
