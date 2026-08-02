/* global Buffer */
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import {readFileSync} from 'node:fs';

const source=readFileSync('services/marketplaceVariantSelection.ts','utf8')
  .replace(/^import type .*$/m,'');
const js=ts.transpileModule(source,{
  compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022},
}).outputText;
const logic=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const option=(id,name,values)=>({id,name,position:0,values:values.map((value,index)=>({id:`${id}-${value}`,value,position:index}))});
const variant=(id,values,extra={})=>({
  id,product_id:'p',sku:id,title:null,price:10,compare_at_price:null,status:'active',is_default:false,
  image_asset_id:null,image_url:null,available_quantity:2,option_value_ids:values,...extra,
});
const color=option('color','Color',['Rojo','Azul']);
const size=option('size','Talla',['S','M']);

test('sparse matrix permits switching dimensions and resolves only Azul / M',()=>{
  const variants=[
    variant('red-small',['color-Rojo','size-S'],{is_default:true,price:11,available_quantity:4,image_url:'https://cdn/red.jpg'}),
    variant('blue-medium',['color-Azul','size-M'],{price:17,compare_at_price:20,available_quantity:2,image_url:'https://cdn/blue.jpg'}),
  ];
  const initial=logic.selectionForPreferredVariant([color,size],variants);
  assert.deepEqual(initial,{color:'color-Rojo',size:'size-S'});
  assert.equal(logic.isOptionValueSelectable(variants,'color-Azul'),true);
  const blue=logic.reconcileVariantSelection([color,size],variants,initial,'color','color-Azul');
  assert.deepEqual(blue,{color:'color-Azul'});
  assert.equal(logic.resolveExactVariant([color,size],variants,blue),undefined);
  assert.equal(logic.isOptionValueSelectable(variants,'size-M'),true);
  const blueMedium=logic.reconcileVariantSelection([color,size],variants,blue,'size','size-M');
  const resolved=logic.resolveExactVariant([color,size],variants,blueMedium);
  assert.equal(resolved?.id,'blue-medium');
  assert.deepEqual(
    {price:resolved?.price,stock:resolved?.available_quantity,image:resolved?.image_url},
    {price:17,stock:2,image:'https://cdn/blue.jpg'},
  );
  assert.notEqual(resolved?.id,'blue-small');
});

test('compatible selections remain while incompatible selections clear',()=>{
  const variants=[
    variant('red-small',['color-Rojo','size-S']),
    variant('blue-small',['color-Azul','size-S']),
    variant('blue-medium',['color-Azul','size-M']),
  ];
  assert.deepEqual(
    logic.reconcileVariantSelection([color,size],variants,{color:'color-Rojo',size:'size-S'},'color','color-Azul'),
    {color:'color-Azul',size:'size-S'},
  );
});

test('contextual availability disables impossible sparse combinations',()=>{
  const variants=[
    variant('small-red',['size-S','color-Rojo']),
    variant('large-blue',['size-M','color-Azul']),
  ];
  const selected={size:'size-S',color:'color-Rojo'};
  assert.equal(logic.isOptionValueSelectable(variants,'color-Rojo',selected,'color'),true);
  assert.equal(logic.isOptionValueSelectable(variants,'color-Azul',selected,'color'),false);
  assert.equal(logic.isOptionValueSelectable(variants,'size-M',selected,'size'),false);
});

test('arbitrary three-dimensional options preserve the largest valid previous subset',()=>{
  const finish=option('finish','Acabado',['Mate','Brillante']);
  const capacity=option('capacity','Capacidad',['64 GB','128 GB']);
  const material=option('material','Material',['Metal','Vidrio']);
  const variants=[
    variant('one',['finish-Mate','capacity-64 GB','material-Metal']),
    variant('two',['finish-Brillante','capacity-64 GB','material-Vidrio']),
  ];
  assert.deepEqual(logic.reconcileVariantSelection(
    [finish,capacity,material],variants,
    {finish:'finish-Mate',capacity:'capacity-64 GB',material:'material-Metal'},
    'finish','finish-Brillante',
  ),{finish:'finish-Brillante',capacity:'capacity-64 GB'});
});

test('inactive variants neither enable values nor resolve exact selections',()=>{
  const inactive=variant('inactive',['color-Azul','size-M'],{status:'inactive'});
  assert.equal(logic.isOptionValueSelectable([inactive],'color-Azul'),false);
  assert.equal(logic.resolveExactVariant([color,size],[inactive],{color:'color-Azul',size:'size-M'}),undefined);
  assert.equal(logic.resolveExactVariant([color,size],[variant('active',['color-Azul','size-M'])],{color:'color-Azul'}),undefined);
});
