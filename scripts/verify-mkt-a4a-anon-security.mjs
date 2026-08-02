// Run: node scripts/verify-mkt-a4a-anon-security.mjs
import fs from 'node:fs';
const PROJECT='aewwdlvbwpczqyvkwvvj';
const env=Object.fromEntries(fs.readFileSync('.env','utf8').split(/\r?\n/).filter(line=>line&&!line.startsWith('#')).map(line=>{const index=line.indexOf('=');return[line.slice(0,index),line.slice(index+1).replace(/^['"]|['"]$/g,'')]}));
const url=env.EXPO_PUBLIC_SUPABASE_URL,key=env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if(!url?.includes(PROJECT)||!key)throw new Error('unexpected_or_missing_project');
const nil='00000000-0000-4000-8000-000000000001';
async function request(path,method='POST',body={}){const response=await fetch(`${url}${path}`,{method,headers:{apikey:key,'content-type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body)});return{path,status:response.status};}
const results=await Promise.all([
  request('/rest/v1/rpc/fetch_live_session_products','POST',{p_session_id:nil}),
  request('/rest/v1/rpc/pin_live_session_product','POST',{p_session_id:nil,p_product_id:nil,p_featured_variant_id:null,p_idempotency_key:nil}),
  request('/rest/v1/rpc/create_live_marketplace_checkout_reservation','POST',{p_session_id:nil,p_live_session_product_id:nil,p_variant_id:nil,p_quantity:1,p_shipping_address:{},p_idempotency_key:nil}),
  request('/rest/v1/marketplace_live_order_sources?select=id','GET'),
  request('/rest/v1/live_session_products','POST',{id:nil}),
]);
if(results[0].status!==200||results.slice(1).some(result=>result.status<400))throw new Error(`security_invariant_failed:${JSON.stringify(results)}`);
console.log(JSON.stringify(results));
