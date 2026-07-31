import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const helperSource=fs.readFileSync('services/marketplaceVariantDraft.ts','utf8');
const helperJs=ts.transpileModule(helperSource,{
  compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022},
}).outputText;
const helper=await import(`data:text/javascript;base64,${Buffer.from(helperJs).toString('base64')}`);
const createSource=fs.readFileSync('app/create-product.tsx','utf8');
const variantsSource=fs.readFileSync('app/seller/product/[id]/variants.tsx','utf8');
const serviceSource=fs.readFileSync('services/marketplaceService.ts','utf8');
const migrationSource=fs.readFileSync(
  'supabase/migrations/20260730100000_add_marketplace_variant_product_draft_creation.sql','utf8',
);

const options=[
  {name:'Acabado',valuesText:'Mate, Brillante'},
  {name:'Capacidad',valuesText:'64 GB, 128 GB, 256 GB'},
];

test('unit: arbitrary option names produce the Cartesian product',()=>{
  const variants=helper.generateCreationVariants(options,{price:'2.5',stock:'4',skuPrefix:'CAMARA-A1B2'});
  assert.equal(variants.length,6);
  assert.deepEqual(variants.map(item=>item.optionValues),[
    ['Mate','64 GB'],['Mate','128 GB'],['Mate','256 GB'],
    ['Brillante','64 GB'],['Brillante','128 GB'],['Brillante','256 GB'],
  ]);
});

test('unit: three options are supported and four are rejected',()=>{
  assert.equal(helper.generateCreationVariants([
    ...options,{name:'Modelo',valuesText:'A, B'},
  ],{price:'1',stock:'0',skuPrefix:'P-1234'}).length,12);
  assert.throws(()=>helper.parseVariantOptions([
    ...options,{name:'Modelo',valuesText:'A'},{name:'Estilo',valuesText:'B'},
  ]),error=>error.code==='too_many_options');
});

test('unit: duplicate option names and values are case-insensitively rejected',()=>{
  assert.throws(()=>helper.parseVariantOptions([
    {name:'Material',valuesText:'Algodón'},{name:' material ',valuesText:'Lino'},
  ]),error=>error.code==='duplicate_option_name');
  assert.throws(()=>helper.parseVariantOptions([
    {name:'Talla',valuesText:'M, m'},
  ]),error=>error.code==='duplicate_option_value');
});

test('unit: more than one hundred combinations are rejected',()=>{
  const values=Array.from({length:11},(_,index)=>`V${index}`).join(',');
  assert.throws(()=>helper.generateCreationVariants([
    {name:'A',valuesText:values},{name:'B',valuesText:values},
  ],{price:'1',stock:'0',skuPrefix:'P-1234'}),error=>error.code==='too_many_variants');
});

test('unit: generated SKUs are normalized, product-specific and payload-unique',()=>{
  const variants=helper.generateCreationVariants(options,{price:'1',stock:'0',skuPrefix:'Cámara-f91e22a1'});
  assert.equal(new Set(variants.map(item=>item.sku)).size,variants.length);
  assert.ok(variants.every(item=>/^[A-Z0-9._-]{1,64}$/.test(item.sku)));
  assert.ok(variants.every(item=>item.sku.startsWith('CAMARA-F91E22A1-')));
});

test('unit: exactly one default variant is required',()=>{
  const variants=helper.generateCreationVariants(options,{price:'1',stock:'0',skuPrefix:'P-1234'});
  assert.equal(variants.filter(item=>item.isDefault).length,1);
  assert.throws(()=>helper.validateCreationVariants(variants.map(item=>({...item,isDefault:false}))),
    error=>error.code==='default_required');
});

test('unit: variant prices, stock, thresholds and compare-at prices are validated',()=>{
  const variants=helper.generateCreationVariants(options,{price:'2.5',stock:'4',skuPrefix:'P-1234'});
  helper.validateCreationVariants(variants);
  assert.throws(()=>helper.validateCreationVariants(variants.map((item,index)=>index?item:{...item,onHand:'-1'})),
    error=>error.code==='invalid_stock');
  assert.throws(()=>helper.validateCreationVariants(variants.map((item,index)=>index?item:{...item,compareAtPrice:'1'})),
    error=>error.code==='invalid_compare_at_price');
});

test('static client integration: simple mode preserves the original createProduct path',()=>{
  assert.match(createSource,/if\(hasVariants\)\{/);
  assert.match(createSource,/const result = await createProduct\(productInput\)/);
});

test('static client integration: variant mode creates a private draft before configuration and publication',()=>{
  const draft=createSource.indexOf('await createProductDraft');
  const configure=createSource.indexOf('await configureProductVariants');
  const publish=createSource.indexOf('await setProductPublished');
  assert.ok(draft>0&&draft<configure&&configure<publish);
  assert.match(createSource,/createProductDraft\(\{\.\.\.productInput,stock:0\}\)/);
});

test('static client integration: exact retries reuse draft identity and configuration key',()=>{
  assert.match(createSource,/let productId=activeDraftId/);
  assert.match(createSource,/configurationKeyRef\.current/);
  assert.doesNotMatch(createSource,/setVariantInventory|adjustVariantInventory/);
});

test('static client integration: guided UI supports arbitrary options, bulk actions and images',()=>{
  assert.match(createSource,/Nombre de la opción/);
  assert.match(createSource,/Capacidad, Modelo o Estilo/);
  assert.match(createSource,/Precio para todas/);
  assert.match(createSource,/Stock para todas/);
  assert.match(createSource,/image_asset_id:item\.imageAssetId/);
  assert.doesNotMatch(createSource,/name:'Color'/);
});

test('static client integration: failed variant creation remains private and recoverable',()=>{
  assert.match(createSource,/El borrador sigue privado/);
  assert.match(createSource,/Reintentar y publicar/);
  assert.match(createSource,/deleteIncompleteDraft/);
  assert.match(createSource,/softDeleteProduct/);
});

test('static client integration: edit conversion and regeneration warnings remain explicit',()=>{
  assert.match(variantsSource,/Convertir en producto con variantes/);
  assert.match(variantsSource,/puede descartar cambios sin guardar/);
  assert.match(variantsSource,/Inventario actual \(solo lectura\)/);
  assert.match(variantsSource,/Establecer/);
  assert.match(variantsSource,/Ajustar/);
});

test('static service contract: draft creation remains an authoritative RPC',()=>{
  assert.match(serviceSource,/rpc\('create_marketplace_product_draft'/);
  assert.match(serviceSource,/rpc\('configure_marketplace_product_variants'/);
  assert.doesNotMatch(createSource,/\.from\('products'\)\.(insert|update)/);
});

test('static SQL contract: additive wrapper creates then pauses in one transaction',()=>{
  const create=migrationSource.indexOf('public.create_marketplace_product(');
  const pause=migrationSource.indexOf('public.pause_marketplace_product(v_product_id)');
  assert.ok(create>0&&create<pause);
  assert.match(migrationSource,/revoke all on function public\.create_marketplace_product_draft[\s\S]+from public, anon/);
  assert.match(migrationSource,/grant execute on function public\.create_marketplace_product_draft[\s\S]+to authenticated, service_role/);
  assert.doesNotMatch(migrationSource,/create table|alter table|ledger|order|cart/i);
});
