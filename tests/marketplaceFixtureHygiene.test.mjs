import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const verifiers=['scripts/verify-mkt-a4a-remote.mjs','scripts/verify-mkt-a4b-remote.mjs','scripts/verify-mkt-a3d2-remote-settlement.mjs','scripts/verify-mkt-a3d2-multiseller.mjs'];
const hygiene=read('supabase/migrations/20260803120000_marketplace_fixture_hygiene.sql');
const lifecycle=read('supabase/migrations/20260803123000_remote_fixture_lifecycle.sql');

test('every remote verifier is fail-closed behind the explicit fixture gate',()=>{
  for(const file of verifiers){
    const source=read(file);
    assert.match(source,/ALLOW_REMOTE_MARKETPLACE_FIXTURES/);
    assert.match(source,/remote_marketplace_fixtures_not_allowed/);
    assert.match(source,/SUPABASE_ENVIRONMENT.*production/s);
    const run=spawnSync(process.execPath,[file],{encoding:'utf8',env:{...process.env,ALLOW_REMOTE_MARKETPLACE_FIXTURES:''}});
    assert.notEqual(run.status,0,file);
    assert.match(run.stderr,/remote_marketplace_fixtures_not_allowed/,file);
  }
});

test('every remote verifier registers fixtures and atomically finalizes from finally',()=>{
  for(const file of verifiers){
    const source=read(file);
    assert.match(source,/(p_phase:\s*["']begin["']|lifecycle\('begin'\))/);
    assert.match(source,/(p_phase:\s*["']register["']|lifecycle\('register'\))/);
    assert.match(source,/finally\s*\{/);
    assert.match(source,/finalize_marketplace_fixture_run/);
  }
});

test('registry is private, idempotent and ownership-rooted',()=>{
  assert.match(hygiene,/revoke all on schema fixture_ops from public, anon, authenticated/);
  assert.match(hygiene,/primary key \(entity_type, entity_id\)/);
  assert.match(lifecycle,/on conflict do nothing/g);
  assert.match(lifecycle,/join fixture_ops\.internal_test_fixture_registry/);
});

test('cleanup quarantines public entities and preserves financial history',()=>{
  assert.match(lifecycle,/update public\.products set status='paused',moderation_status='suspended'/);
  assert.match(lifecycle,/update public\.marketplace_stores set status='suspended'/);
  assert.match(lifecycle,/update public\.live_sessions set status='ended'/);
  assert.match(lifecycle,/update public\.live_session_products set status='removed'/);
  assert.match(lifecycle,/update public\.marketplace_live_affiliate_offers set status='removed'/);
  assert.doesNotMatch(lifecycle,/delete\s+from\s+public\.(financial_transactions|ledger_entries|marketplace_payments|marketplace_payment_allocations|marketplace_order_settlements)/i);
});

test('discovery cannot mutate a real product by title alone',()=>{
  assert.match(hygiene,/join fixture_ops\.internal_test_fixture_registry r on r\.entity_type='store' and r\.entity_id=p\.store_id/);
  assert.doesNotMatch(hygiene,/delete\s+from[\s\S]{0,200}(title|description)\s+(like|~)/i);
  assert.doesNotMatch(hygiene,/auth\.users[\s\S]{0,100}delete/i);
});

test('audit proves protected hashes and reconciliation are captured on both sides',()=>{
  assert.match(hygiene,/select 'pre_quarantine'/);
  assert.match(hygiene,/select 'post_quarantine'/);
  assert.match(hygiene,/reconcile_marketplace_payments\(\)/);
  assert.match(hygiene,/reconcile_marketplace_settlements\(\)/);
  assert.match(hygiene,/reconcile_marketplace_live_commissions\(\)/);
  assert.match(hygiene,/where not fixture_ops\.is_fixture\('product',p\.id\)/);
});
