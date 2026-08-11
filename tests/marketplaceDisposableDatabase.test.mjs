import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source=readFileSync(new URL("../scripts/create-marketplace-disposable-db.mjs",import.meta.url),"utf8");
const lifecycleSource=readFileSync(new URL("../scripts/prove-marketplace-order-lifecycle.mjs",import.meta.url),"utf8");
test("disposable marketplace database uses a linked schema-only dump",()=>{
 assert.match(source,/supabase","db","dump","--linked","--schema","public,fixture_ops"/);
 assert.doesNotMatch(source,/--data-only|db push|migration repair/);
 assert.match(source,/disposable_host_must_be_local/);
});
test("disposable marketplace database verifies financial and LIVE authorities",()=>{
 for(const name of ["marketplace_order_settlements","marketplace_settlement_legs","resolve_marketplace_dispute","marketplace_apply_live_commission"])assert.match(source,new RegExp(name));
});
test("self-test proves transactional rollback and always destroys its container",()=>{
 assert.match(source,/begin;insert into public\.marketplace_disposable_candidate_compile default values;rollback/);
 assert.match(source,/if\(action==="self-test"\)destroy\(\)/);
});
test("shipment settlement prerequisites are disposable-only",()=>{
 assert.match(source,/marketplace_settlement_policy/);
 assert.match(source,/settle-eligible-marketplace-orders/);
 assert.match(source,/create schema if not exists cron/);
});
test("order lifecycle honors an explicitly supplied disposable connection",()=>{
 assert.match(lifecycleSource,/process\.env\.MARKETPLACE_DATABASE_URL/);
});
