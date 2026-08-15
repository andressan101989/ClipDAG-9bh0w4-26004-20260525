import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const service=readFileSync('services/marketplaceService.ts','utf8');
const context=readFileSync('contexts/ShopContext.tsx','utf8');
const screen=readFileSync('app/seller/products.tsx','utf8');
const migration=readFileSync('supabase/migrations/20260805102000_restore_seller_product_list.sql','utf8');
const hardening=readFileSync('supabase/migrations/20260811033000_marketplace_production_hardening.sql','utf8');

test('seller list uses its ownership-scoped RPC instead of a direct products select',()=>{
 const body=service.slice(service.indexOf('export async function fetchMyProducts'),service.indexOf('export async function fetchSellerFoundation'));
 assert.match(body,/rpc\('fetch_my_marketplace_products_v2'/);
 assert.doesNotMatch(body,/from\('products'\)/);
 assert.match(body,/MarketplaceSellerProductsError/);
});

test('seller RPC exposes owned manageable products without broad grants',()=>{
 assert.match(migration,/p\.seller_id=actor/);
 assert.match(migration,/s\.seller_id=actor/);
 assert.match(migration,/p\.status<>'deleted'/);
 assert.match(migration,/shipping_profile_id/);
 assert.match(migration,/revoke all on function public\.fetch_my_marketplace_products\(\) from public,anon/);
 assert.match(migration,/grant execute on function public\.fetch_my_marketplace_products\(\) to authenticated,service_role/);
 assert.doesNotMatch(migration,/grant select .*products/i);
 assert.match(hardening,/fetch_my_marketplace_products_v2/);
 assert.match(hardening,/p_limit is null or p_limit<1 or p_limit>100/);
 assert.match(hardening,/fetch_my_marketplace_products_v2\(null,null,100\)->'items'/);
});

test('public projection excludes seller-private shipping configuration',()=>{
 const publicBody=migration.slice(migration.indexOf('create or replace function public.fetch_public_marketplace_products'));
 assert.doesNotMatch(publicBody,/'shipping_profile_id'/);
 assert.match(publicBody,/p\.status='active'/);
 assert.match(publicBody,/ready\.reason_code='ready'/);
 assert.match(publicBody,/not fixture_ops\.is_fixture/);
 const fetchBody=service.slice(service.indexOf('export async function fetchProducts'),service.indexOf('function mapVariant'));
 assert.match(fetchBody,/fetch_public_marketplace_products/);
 assert.doesNotMatch(fetchBody,/PRODUCT_WITH_SELLER|from\('products'\)/);
});

test('seller list distinguishes loading empty and read failure while retaining cached rows',()=>{
 assert.match(context,/SellerProductsState\s*=\s*'idle'\s*\|\s*'loading'\s*\|\s*'loaded'\s*\|\s*'empty'\s*\|\s*'error'/);
 assert.match(context,/setSellerProductsState\(next\.length\s*===\s*0\s*\?\s*'empty'\s*:\s*'loaded'\)/);
 const catchBody=context.slice(context.indexOf('const fetchMyProducts=useCallback'),context.indexOf('useEffect(()=>{void fetchProducts'));
 assert.doesNotMatch(catchBody,/catch[^}]*setMyProducts\(\[\]\)/s);
 assert.match(screen,/No pudimos cargar tus productos\./);
 assert.match(screen,/Tu sesión expiró\. Inicia sesión nuevamente\./);
 assert.match(screen,/Reintentar/);
 assert.match(screen,/sellerProductsState==='error'\?errorMessage:filter==='all'/);
});

test('seller products refreshes on focus and never exposes raw database errors',()=>{
 assert.match(screen,/useFocusEffect/);
 assert.match(screen,/void fetchMyProducts\(\)/);
 assert.doesNotMatch(screen,/42501|marketplace_seller_products_permission/);
 assert.match(service,/\[SellerProducts\] fetch_(start|success|failed)/);
});
