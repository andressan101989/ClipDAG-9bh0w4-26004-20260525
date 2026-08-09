import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {MARKETPLACE_SHIPPING_COUNTRIES,shippingRegionsForCountry} from "../services/marketplaceShippingSetup.ts";
import {cartesianVariantValues} from "../services/marketplaceVariantDraft.ts";
const checkout=readFileSync("app/checkout.tsx","utf8"),product=readFileSync("app/product/[id].tsx","utf8"),gallery=readFileSync("components/marketplace/product-detail/ProductMediaGallery.tsx","utf8"),seller=readFileSync("app/seller/product/[id]/variants.tsx","utf8"),picker=readFileSync("services/marketplaceMediaPickerService.ts","utf8"),migration=readFileSync("supabase/migrations/20260808150000_expose_public_marketplace_product_media.sql","utf8");

test("checkout uses friendly country and canonical US/CA region selectors",()=>{
 assert.equal(MARKETPLACE_SHIPPING_COUNTRIES.find(x=>x.label==="Venezuela")?.code,"VE");
 assert.equal(shippingRegionsForCountry("US").find(x=>x[1]==="Florida")?.[0],"FL");
 assert.equal(shippingRegionsForCountry("CA").find(x=>x[1]==="Ontario")?.[0],"ON");
 assert.match(checkout,/SearchableSelectField/);assert.match(checkout,/country,\s*region:["']{2}/);assert.match(checkout,/countryCode=\{address\.country\}/);assert.match(checkout,/regionCode=\{address\.region\}/);
});
test("public media projection is exact-product ready public and publication gated",()=>{
 for(const token of ["l.entity_id=p.id","a.status='ready'","a.visibility='public'","product_video","p.status='active'","p.moderation_status='approved'"])assert.match(migration,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
 assert.match(gallery,/VideoView/);assert.match(gallery,/nativeControls/);assert.match(gallery,/kind === "video"/);assert.match(gallery,/Video/);
});
test("buyer options adapt and seller standard values are selection driven",()=>{
 assert.match(product,/option.values.length\s*>\s*6/);assert.match(product,/reconcileVariantSelection/);assert.match(product,/isOptionValueSelectable/);
 assert.match(seller,/VARIANT_TYPES/);assert.match(seller,/VALUE_SUGGESTIONS/);assert.match(seller,/Otro/);
 assert.equal(cartesianVariantValues([["Negro","Blanco"],["S","M","L"]]).length,6);
});
test("old Photos assets materialize from iCloud and Files use local duration inspection",()=>{
 assert.match(picker,/shouldDownloadFromNetwork: true/);assert.match(picker,/localUri/);assert.match(picker,/createVideoPlayer/);
 assert.match(readFileSync("app/seller/product-editor/[productId].tsx","utf8"),/DocumentPicker\.getDocumentAsync/);
});
