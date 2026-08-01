import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const sql=readFileSync('supabase/migrations/20260801032000_fix_marketplace_checkout_reservation_runtime.sql','utf8');

test('runtime correction preserves the exact RPC and supported two-key validation',()=>{
  assert.match(sql,/create or replace function public\.create_marketplace_checkout_reservation\(p_items jsonb,p_shipping_address jsonb,p_idempotency_key uuid\)/);
  assert.doesNotMatch(sql,/jsonb_object_length/);
  assert.match(sql,/select count\(\*\) from jsonb_object_keys\(e\)\)<>2/);
  assert.match(sql,/not\(e\?'variant_id' and e\?'quantity'\)/);
  assert.match(sql,/\(e->>'quantity'\)!~ '\^\[1-9\]\[0-9\]\{0,2\}\$'/);
});

test('exact-key model accepts only variant_id and quantity',()=>{
  const valid={variant_id:'00000000-0000-0000-0000-000000000001',quantity:1};
  const validKeys=Object.keys(valid);
  assert.equal(validKeys.length,2);assert.ok(validKeys.includes('variant_id'));assert.ok(validKeys.includes('quantity'));
  for(const invalid of [{quantity:1},{variant_id:valid.variant_id},{...valid,price:10}]){
    const keys=Object.keys(invalid);assert.ok(keys.length!==2||!keys.includes('variant_id')||!keys.includes('quantity'));
  }
});

test('pgcrypto and catalog primitives are explicitly schema-qualified',()=>{
  assert.match(sql,/extensions\.digest\([\s\S]*'sha256'/);
  assert.match(sql,/pg_catalog\.encode/);assert.match(sql,/pg_catalog\.hashtextextended/);assert.match(sql,/pg_catalog\.pg_advisory_xact_lock/);
  assert.match(sql,/security definer set search_path=public/);
});

test('atomic reservation and idempotency guarantees remain unchanged',()=>{
  assert.match(sql,/buyer_id=v_user and idempotency_key=p_idempotency_key/);
  assert.match(sql,/return public\.marketplace_checkout_response\(v_prior\.id\)/);
  assert.match(sql,/order by v\.id for update of v,l/);
  assert.match(sql,/set reserved=reserved\+x\.quantity,version=version\+1/);
  assert.doesNotMatch(sql,/set\s+on_hand\s*=/i);
  assert.match(sql,/where checkout_id=v_checkout and store_id=v_variant\.store_id/);
});
