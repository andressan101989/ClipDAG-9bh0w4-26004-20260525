import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
 const published=(await db.query(`select p.status,p.moderation_status,count(*)::int products,
 count(*) filter(where p.shipping_profile_id is not null)::int shipping_ready,
 count(*) filter(where p.published_at is not null)::int published,
 count(*) filter(where exists(select 1 from marketplace_product_variants v where v.product_id=p.id and v.status='active'))::int with_active_variant,
 count(*) filter(where exists(select 1 from marketplace_product_variants v join marketplace_inventory_levels i on i.variant_id=v.id where v.product_id=p.id and v.status='active' and i.on_hand>i.reserved))::int with_inventory,
 count(*) filter(where r.reason_code='ready')::int live_ready,max(p.published_at) latest_publication
 from products p left join lateral marketplace_evaluate_live_product_readiness(p.id,p.seller_id)r on true
 where p.deleted_at is null and not fixture_ops.is_fixture('product',p.id)
 group by p.status,p.moderation_status order by p.status,p.moderation_status`)).rows;
 const activeCandidate=(await db.query(`select p.id,p.seller_id from products p where p.status='active' and p.published_at is not null and p.deleted_at is null and not fixture_ops.is_fixture('product',p.id) order by p.published_at desc limit 1`)).rows[0];
 if(!activeCandidate)throw new Error('published_product_missing');
 const candidate=(await db.query(`select p.id,p.seller_id,sp.id profile_id from products p join lateral(select id from marketplace_shipping_profiles where seller_id=p.seller_id and store_id=p.store_id and status='active' order by legacy_unrestricted,id limit 1)sp on true where p.status='paused' and p.deleted_at is null and not fixture_ops.is_fixture('product',p.id) order by p.created_at desc limit 1`)).rows[0];
 if(!candidate)throw new Error('publication_proof_draft_missing');
 await db.query('begin');try{
  await db.query('set local role authenticated');
  await db.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claim.role','authenticated',true)",[JSON.stringify({role:'authenticated',sub:candidate.seller_id}),candidate.seller_id]);
  const configuration=(await db.query('select fetch_seller_product_inventory($1)value',[candidate.id])).rows[0].value;
  if(!configuration?.product||!configuration?.detail?.variants?.length||!configuration?.inventory?.length)throw new Error('seller_private_read_failed');
  const ownerProducts=(await db.query('select fetch_my_marketplace_products() value')).rows[0].value;
  if(!Array.isArray(ownerProducts)||!ownerProducts.some(product=>product.id===candidate.id))throw new Error('seller_list_owner_missing');
  await db.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)",[JSON.stringify({role:'authenticated',sub:activeCandidate.seller_id}),activeCandidate.seller_id]);
  const publishedOwnerProducts=(await db.query('select fetch_my_marketplace_products() value')).rows[0].value;
  if(!Array.isArray(publishedOwnerProducts)||!publishedOwnerProducts.some(product=>product.id===activeCandidate.id&&product.status==='active'&&product.published_at))throw new Error('published_seller_list_owner_missing');
  await db.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)",[JSON.stringify({role:'authenticated',sub:candidate.seller_id}),candidate.seller_id]);
  let legacyCode=null;await db.query('savepoint legacy_read');try{await db.query('select id,shipping_profile_id from products where seller_id=auth.uid() limit 1');}catch(error){legacyCode=error.code;await db.query('rollback to savepoint legacy_read');}await db.query('release savepoint legacy_read');
  const unrelated=randomUUID();let unrelatedDenied=false;await db.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)",[JSON.stringify({role:'authenticated',sub:unrelated}),unrelated]);const unrelatedList=(await db.query('select fetch_my_marketplace_products() value')).rows[0].value;await db.query('savepoint unrelated_read');try{await db.query('select fetch_seller_product_inventory($1)',[candidate.id]);}catch(error){unrelatedDenied=error.code==='42501';await db.query('rollback to savepoint unrelated_read');}await db.query('release savepoint unrelated_read');
  await db.query('set local role anon');await db.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub','',true)",[JSON.stringify({role:'anon'})]);let anonDenied=false;await db.query('savepoint anon_read');try{await db.query('select fetch_my_marketplace_products()');}catch(error){anonDenied=error.code==='42501';await db.query('rollback to savepoint anon_read');}await db.query('release savepoint anon_read');
  if(legacyCode!=='42501')throw new Error('legacy_direct_read_not_reproduced');if(!unrelatedDenied||!Array.isArray(unrelatedList)||unrelatedList.some(product=>product.id===candidate.id))throw new Error('unrelated_seller_not_denied');if(!anonDenied)throw new Error('anon_not_denied');
  await db.query('set local role authenticated');await db.query("select set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true)",[JSON.stringify({role:'authenticated',sub:candidate.seller_id}),candidate.seller_id]);
  const entityCounts=async()=>{await db.query('set local role postgres');const row=(await db.query(`select (select count(*) from products where id=$1)products,(select count(*) from marketplace_product_variants where product_id=$1)variants,(select count(*) from marketplace_inventory_levels i join marketplace_product_variants v on v.id=i.variant_id where v.product_id=$1)inventory,(select count(*) from media_asset_links where entity_type='shop_product' and entity_id=$1)media`,[candidate.id])).rows[0];await db.query('set local role authenticated');return row;};
  const beforeCounts=await entityCounts();
  await db.query('select set_my_marketplace_product_shipping_profile($1,$2)',[candidate.id,candidate.profile_id]);
  const readiness=(await db.query('select evaluate_my_marketplace_product_publication($1)value',[candidate.id])).rows[0].value;
  if(!readiness.ready)throw new Error(readiness.reason_code??'publication_not_ready');
  const first=(await db.query('select publish_my_marketplace_product_checked($1)value',[candidate.id])).rows[0].value;
  const second=(await db.query('select publish_my_marketplace_product_checked($1)value',[candidate.id])).rows[0].value;
  const afterCounts=await entityCounts();
  const sellerVisible=((await db.query('select fetch_my_marketplace_products() value')).rows[0].value??[]).some(product=>product.id===candidate.id);
  await db.query('set local role postgres');const ready=(await db.query('select reason_code from marketplace_evaluate_live_product_readiness($1,$2)',[candidate.id,candidate.seller_id])).rows[0].reason_code;await db.query('set local role authenticated');
  const shopVisible=((await db.query('select fetch_public_marketplace_products(null,null,null,100,$1)value',[candidate.id])).rows[0].value??[]).some(product=>product.id===candidate.id);
  if(!first.published||JSON.stringify(first)!==JSON.stringify(second)||JSON.stringify(beforeCounts)!==JSON.stringify(afterCounts)||!sellerVisible||ready!=='ready'||!shopVisible)throw new Error('publication_proof_assertion_failed');
  console.log(JSON.stringify({published_product_aggregate:published,legacy_direct_read:{postgres_code:legacyCode,shipping_profile_column_denied:true},seller_list:{published_owner_visible:true,paused_owner_visible:true,unrelated_seller_hidden:true,anon_denied:true},private_drafts:result.rows,private_read:{owner:true,unrelated_seller_denied:true,anon_denied:true},rollback_publication:{shipping_assigned:true,readiness:'ready',published:true,seller_visible:true,shop_visible:true,live_pin_ready:true,retry_idempotent:true,entity_counts_unchanged:true}},null,2));
 }finally{await db.query('rollback');}
}catch(error){console.error(`PUBLICATION_AUDIT_FAILED:${/^[a-z0-9_]+$/i.test(error?.message??'')?error.message:'database_error'}`);process.exitCode=1;}finally{await db.end().catch(()=>{});}
