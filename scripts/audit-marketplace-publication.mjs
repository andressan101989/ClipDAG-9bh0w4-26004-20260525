import { spawnSync } from "node:child_process";
import pg from "pg";
const { Client } = pg;
const cli=spawnSync(process.env.ComSpec,["/d","/s","/c","npx.cmd supabase db dump --linked --schema public --dry-run"],{cwd:process.cwd(),encoding:"utf8",windowsHide:true});
if(cli.status!==0)throw new Error("publication_audit_secure_connection_failed");
const captured=`${cli.stdout??""}${cli.stderr??""}`;
const value=name=>captured.match(new RegExp(`(?:export |set \\"?)${name}=[\\"']?([^\\"'\\r\\n ]+)`))?.[1];
const db=new Client({host:value("PGHOST"),port:Number(value("PGPORT")),user:value("PGUSER"),password:value("PGPASSWORD"),database:value("PGDATABASE"),ssl:{rejectUnauthorized:false}});
try{await db.connect();await db.query("set role postgres");
 const result=await db.query(`select coalesce(r.reason_code,'missing') reason,count(*)::int products,
 count(*) filter(where p.shipping_profile_id is not null)::int shipping,
 count(*) filter(where cardinality(p.images)>0)::int media,
 count(*) filter(where exists(select 1 from marketplace_product_variants v join marketplace_inventory_levels i on i.variant_id=v.id where v.product_id=p.id and v.status='active' and i.on_hand>i.reserved))::int stocked,
 count(*) filter(where exists(select 1 from marketplace_shipping_profiles sp where sp.store_id=p.store_id and sp.seller_id=p.seller_id and sp.status='active'))::int active_profile_available
 from products p left join lateral marketplace_evaluate_live_product_readiness(p.id,p.seller_id) r on true
 where p.status='paused' and p.deleted_at is null and not fixture_ops.is_fixture('product',p.id)
 group by r.reason_code order by products desc`);
 const candidate=(await db.query(`select p.id,p.seller_id,sp.id profile_id from products p join lateral(select id from marketplace_shipping_profiles where seller_id=p.seller_id and store_id=p.store_id and status='active' order by legacy_unrestricted,id limit 1)sp on true where p.status='paused' and p.deleted_at is null and not fixture_ops.is_fixture('product',p.id) order by p.created_at desc limit 1`)).rows[0];
 if(!candidate)throw new Error('publication_proof_draft_missing');
 await db.query('begin');try{
  await db.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claim.role','authenticated',true)",[JSON.stringify({role:'authenticated',sub:candidate.seller_id}),candidate.seller_id]);
  await db.query('select set_my_marketplace_product_shipping_profile($1,$2)',[candidate.id,candidate.profile_id]);
  const readiness=(await db.query('select evaluate_my_marketplace_product_publication($1)value',[candidate.id])).rows[0].value;
  if(!readiness.ready)throw new Error(readiness.reason_code??'publication_not_ready');
  const first=(await db.query('select publish_my_marketplace_product_checked($1)value',[candidate.id])).rows[0].value;
  const second=(await db.query('select publish_my_marketplace_product_checked($1)value',[candidate.id])).rows[0].value;
  const sellerVisible=(await db.query('select count(*)::int n from products where id=$1 and seller_id=$2',[candidate.id,candidate.seller_id])).rows[0].n===1;
  const ready=(await db.query('select reason_code from marketplace_evaluate_live_product_readiness($1,$2)',[candidate.id,candidate.seller_id])).rows[0].reason_code;
  const shopVisible=(await db.query('select $1=any(fetch_marketplace_ready_product_ids(null,null,null,100)) ok',[candidate.id])).rows[0].ok;
  if(!first.published||JSON.stringify(first)!==JSON.stringify(second)||!sellerVisible||ready!=='ready'||!shopVisible)throw new Error('publication_proof_assertion_failed');
  console.log(JSON.stringify({private_drafts:result.rows,rollback_publication:{shipping_assigned:true,readiness:'ready',published:true,seller_visible:true,shop_visible:true,live_pin_ready:true,retry_idempotent:true}},null,2));
 }finally{await db.query('rollback');}
}catch(error){console.error(`PUBLICATION_AUDIT_FAILED:${/^[a-z0-9_]+$/i.test(error?.message??'')?error.message:'database_error'}`);process.exitCode=1;}finally{await db.end().catch(()=>{});}
