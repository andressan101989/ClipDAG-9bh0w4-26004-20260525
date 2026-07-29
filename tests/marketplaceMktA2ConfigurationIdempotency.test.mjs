import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const sql=read('supabase/migrations/20260727122000_fix_mkt_a2_configuration_idempotency.sql');
const base=read('supabase/migrations/20260727120000_marketplace_mkt_a2_variants_inventory.sql');

const fingerprint=({product,options,variants})=>
  `${product}:${JSON.stringify(options)}:${JSON.stringify(variants)}`;

function model(){
  const state={
    requests:new Map(),inventory:12,reserved:0,threshold:0,version:0,
    movements:0,initialMovements:0,projection:12,configurationEffects:0,
  };
  const configure=request=>{
    const key=`actor:${request.key}`;
    const fp=fingerprint(request);
    const prior=state.requests.get(key);
    if(prior){
      if(prior.product!==request.product||prior.fingerprint!==fp)
        throw new Error('marketplace_idempotency_conflict');
      return prior.response;
    }
    const existing=request.variants.find(variant=>variant.existing);
    if(existing&&existing.on_hand!==state.inventory)
      throw new Error('marketplace_existing_inventory_requires_inventory_action');
    state.configurationEffects++;
    for(const variant of request.variants){
      if(!variant.existing){
        state.inventory=variant.on_hand;
        state.projection=variant.on_hand-state.reserved;
        state.movements++;
        state.initialMovements++;
      }
    }
    state.threshold=request.variants[0].low_stock_threshold;
    const response=[{id:'variant-1',sku:request.variants[0].sku}];
    state.requests.set(key,{product:request.product,fingerprint:fp,response});
    return response;
  };
  const adjust=delta=>{
    state.inventory+=delta;state.projection=state.inventory-state.reserved;
    state.movements++;state.version++;
  };
  return {state,configure,adjust};
}

const original={
  product:'product-1',key:'K',options:[],
  variants:[{existing:true,sku:'SKU-1',on_hand:12,low_stock_threshold:2}],
};

test('static SQL contract: prior response lookup precedes inventory validation and threshold update',()=>{
  const prior=sql.indexOf('select * into v_prior');
  const inventory=sql.indexOf('from public.marketplace_inventory_levels');
  const threshold=sql.indexOf('set low_stock_threshold=v_threshold');
  assert.ok(prior>0&&prior<inventory&&inventory<threshold);
  assert.match(sql,/if found then[\s\S]*return v_prior\.response/);
  const cachedBranch=sql.slice(sql.indexOf('if found then'),sql.indexOf('-- New keys'));
  assert.doesNotMatch(cachedBranch,/marketplace_inventory_levels/);
  assert.doesNotMatch(cachedBranch,/low_stock_threshold\s*=/);
});

test('static SQL contract: fingerprint is byte-compatible with deployed original',()=>{
  const expected=/md5\(\s*p_product_id::text\|\|':'\|\|p_options_json::text\|\|':'\|\|p_variants_json::text\s*\)/;
  assert.match(sql,expected);
  assert.match(base,expected);
  assert.match(sql,/actor_id=v_user and idempotency_key=p_idempotency_key/);
  assert.match(sql,/marketplace_idempotency_conflict/);
});

test('unit contract A: exact retry after inventory change returns cached response without side effects',()=>{
  const {state,configure,adjust}=model();
  const first=configure(original);
  adjust(3);
  const snapshot={...state,requests:state.requests};
  const retry=configure(original);
  assert.deepEqual(retry,first);
  assert.equal(state.inventory,15);
  assert.equal(state.threshold,2);
  assert.equal(state.movements,snapshot.movements);
  assert.equal(state.version,snapshot.version);
  assert.equal(state.projection,snapshot.projection);
  assert.equal(state.configurationEffects,snapshot.configurationEffects);
});

test('unit contract B: exact retry never reapplies an old threshold',()=>{
  const {state,configure}=model();
  const first=configure(original);
  state.threshold=8;
  const retry=configure(original);
  assert.deepEqual(retry,first);
  assert.equal(state.threshold,8);
});

test('unit contract C: same key with changed payload or product conflicts',()=>{
  const {configure}=model();configure(original);
  for(const changed of [
    {...original,product:'product-2'},
    {...original,variants:[{...original.variants[0],on_hand:13}]},
    {...original,variants:[{...original.variants[0],low_stock_threshold:8}]},
    {...original,variants:[{...original.variants[0],sku:'SKU-2'}]},
    {...original,options:[{name:'Color',values:['Negro']}]},
  ]) assert.throws(()=>configure(changed),/marketplace_idempotency_conflict/);
});

test('unit contract D: new key still enforces authoritative existing inventory',()=>{
  const {state,configure,adjust}=model();configure(original);adjust(3);
  assert.throws(()=>configure({...original,key:'NEW'}),
    /marketplace_existing_inventory_requires_inventory_action/);
  assert.equal(state.inventory,15);
});

test('unit contract E: new variant creates one initial movement and exact retry creates none',()=>{
  const {state,configure}=model();
  const request={...original,variants:[{
    existing:false,sku:'NEW-1',on_hand:7,low_stock_threshold:1,
  }]};
  const first=configure(request);
  const retry=configure(request);
  assert.deepEqual(retry,first);
  assert.equal(state.initialMovements,1);
  assert.equal(state.movements,1);
  assert.equal(state.configurationEffects,1);
});

test('static concurrency contract: same actor/key is serialized before lookup',()=>{
  const lock=sql.indexOf('pg_advisory_xact_lock');
  const prior=sql.indexOf('select * into v_prior');
  const internal=sql.indexOf('configure_marketplace_product_variants_mkt_a2_original(');
  assert.ok(lock>0&&lock<prior&&prior<internal);
  assert.match(sql,/hashtext\(v_user::text\)/);
  assert.match(sql,/hashtext\(p_idempotency_key::text\)/);
  assert.match(sql,/This block is reachable only for a new request record/);
});

test('static privilege and scope contract remains closed',()=>{
  assert.match(sql,/revoke all on function public\.configure_marketplace_product_variants[\s\S]*from public,anon/);
  assert.match(sql,/grant execute on function public\.configure_marketplace_product_variants[\s\S]*to authenticated,service_role/);
  assert.doesNotMatch(sql,/create table public\.(cart|orders|order_items)|checkout|ledger_entries|atomic_ledger_transfer|bdag_transfer/i);
  assert.doesNotMatch(sql,/reserved\s*=/);
});
