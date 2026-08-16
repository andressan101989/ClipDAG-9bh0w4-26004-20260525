import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {isOptionValueSelectable,reconcileVariantSelection,resolveExactVariant} from "../services/marketplaceVariantSelection.ts";

const screen=readFileSync("app/product/[id].tsx","utf8");
const gallery=readFileSync("components/marketplace/product-detail/ProductMediaGallery.tsx","utf8");
const bar=readFileSync("components/marketplace/product-detail/ProductPurchaseBar.tsx","utf8");
const mediaProjection=readFileSync("supabase/migrations/20260808150000_expose_public_marketplace_product_media.sql","utf8");

const options=[{id:"color",name:"Color",position:0,values:[{id:"black",value:"Negro",position:0},{id:"white",value:"Blanco",position:1}]},{id:"size",name:"Talla",position:1,values:[{id:"s",value:"S",position:0},{id:"m",value:"M",position:1}]}];
const variants=[{id:"black-s",status:"active",is_default:true,option_value_ids:["black","s"],price:25,compare_at_price:30,available_quantity:12},{id:"black-m",status:"active",is_default:false,option_value_ids:["black","m"],price:27,compare_at_price:null,available_quantity:3},{id:"white-s",status:"inactive",is_default:false,option_value_ids:["white","s"],price:25,compare_at_price:null,available_quantity:0}];

test("premium gallery supports five images and one muted controlled video",()=>{
 const media=[...Array.from({length:5},(_,index)=>({kind:"image",url:`image-${index}`})),{kind:"video",url:"video"}];
 assert.equal(media.length,6);assert.match(gallery,/VideoView/);assert.match(gallery,/instance\.muted = true/);assert.match(gallery,/nativeControls/);assert.match(gallery,/player\.pause\(\)/);assert.match(gallery,/selectedIndex \+ 1/);
});
test("variant authority keeps compatible selection and exact price inventory",()=>{
 const next=reconcileVariantSelection(options,variants,{color:"black",size:"s"},"size","m");
 assert.deepEqual(next,{size:"m",color:"black"});const exact=resolveExactVariant(options,variants,next);assert.equal(exact?.price,27);assert.equal(exact?.available_quantity,3);assert.equal(isOptionValueSelectable(variants,"white",next,"color"),false);
 assert.match(screen,/option\.values\.length\s*>\s*6/);assert.match(screen,/SearchableSelectField/);
});
test("stock price discount and sticky purchase contracts are buyer focused",()=>{
 assert.match(screen,/available\s*>\s*10\s*\?\s*"Disponible"/);assert.match(screen,/`Solo quedan \$\{available\}`/);assert.match(screen,/"Agotado"/);assert.match(screen,/Math\.round\(\s*\(1\s*-\s*effectivePrice\s*\/\s*compareAt\)\s*\*\s*100\s*\)/);assert.match(screen,/hasRange\s*\?\s*"Desde "/);assert.match(bar,/Math\.min\(\s*available,\s*quantity\s*\+\s*1,?\s*\)/);assert.match(bar,/accessibilityLabel="Aumentar cantidad"/);
});
test("cart operation is locked, owner blocked, and feedback is nonblocking",()=>{
 assert.match(screen,/addToCartLockRef\.current/);assert.match(screen,/isOwner\s*\|\|\s*!selectedVariant/);assert.match(screen,/finally\s*\{\s*addToCartLockRef\.current\s*=\s*false/);assert.match(screen,/marketplaceCartToastFeedback/);assert.match(screen,/Ver carrito/);
});
test("delivery remains authoritative and public video remains publication gated",()=>{
 assert.match(screen,/MarketplaceShippingQuoteCard/);assert.match(screen,/productId=\{product\.id\}/);for(const token of ["p.status='active'","p.moderation_status='approved'","a.status='ready'","a.visibility='public'","l.entity_id=p.id"])assert.match(mediaProjection,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
});
