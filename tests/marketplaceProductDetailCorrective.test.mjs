import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {marketplaceCartToastFeedback,selectVariantMediaIndex} from "../services/marketplaceProductDetailPresentation.ts";

const gallerySource=readFileSync("components/marketplace/product-detail/ProductMediaGallery.tsx","utf8");
const screen=readFileSync("app/product/[id].tsx","utf8");
const gallery=["A","B","C"].map((url,position)=>({kind:"image",url,durationMs:null,mimeType:"image/jpeg",position,isCover:position===0}));
gallery.push({kind:"video",url:"V",durationMs:30000,mimeType:"video/mp4",position:3,isCover:false});

test("variant image navigates once and manual gallery selection remains authoritative",()=>{
 let index=selectVariantMediaIndex(gallery,"B",0);assert.equal(index,1);assert.equal(`${index+1}/${gallery.length}`,"2/4");
 index=2;assert.equal(gallery[index].url,"C");assert.equal(`${index+1}/${gallery.length}`,"3/4");
 index=3;assert.equal(gallery[index].kind,"video");assert.equal(`${index+1}/${gallery.length}`,"4/4");
 index=0;assert.equal(gallery[index].url,"A");assert.equal(`${index+1}/${gallery.length}`,"1/4");
 assert.doesNotMatch(gallerySource,/variantImageUrl\s*\?\?/);
});

test("unmatched variant image leaves current gallery selection and count intact",()=>{
 assert.equal(selectVariantMediaIndex(gallery,"outside-gallery",2),2);
});

test("normal and adjusted cart feedback use authoritative quantities",()=>{
 const item={quantity:3};
 const normal=marketplaceCartToastFeedback({ok:true,status:"added",item},2,"Negro · M");
 assert.equal(normal.title,"Agregado al carrito");assert.equal(normal.quantity,2);assert.match(normal.message,/Cantidad 2/);
 const adjusted=marketplaceCartToastFeedback({ok:true,status:"quantity_adjusted",item,requested:5,applied:3},5,"Negro · M");
 assert.equal(adjusted.title,"Cantidad ajustada");assert.equal(adjusted.quantity,3);assert.match(adjusted.message,/3 unidades/);assert.doesNotMatch(adjusted.message,/5/);
});

test("share uses safe text fallback and catches failures without invented URL",()=>{
 assert.match(screen,/const shareProduct\s*=\s*async/);assert.match(screen,/try\s*\{\s*await Share\.share/);assert.match(screen,/catch\s*\(error\)/);assert.doesNotMatch(screen,/https:\/\/onspace\.app\/product/);
});
