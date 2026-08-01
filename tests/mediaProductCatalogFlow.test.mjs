import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { publishLinkedMedia } from './helpers/mediaEntityFlowHarness.mjs';

const root = new URL('../', import.meta.url);
const sql = await readFile(
  new URL('supabase/migrations/20260726101000_create_product_catalog_schema.sql', root),
  'utf8',
);
const shop = await readFile(new URL('contexts/ShopContext.tsx', root), 'utf8');
const screen = await readFile(new URL('app/create-product.tsx', root), 'utf8');
const catalogScreen = await readFile(new URL('app/(tabs)/shop.tsx', root), 'utf8');
const productScreen = await readFile(new URL('app/product/[id].tsx', root), 'utf8');
const hardening = await readFile(
  new URL('supabase/migrations/20260726103000_harden_media_entity_linking.sql', root),
  'utf8',
);
const mktA1 = await readFile(
  new URL('supabase/migrations/20260727100000_marketplace_mkt_a1_seller_store_product_foundation.sql', root),
  'utf8',
);
const marketplaceService = await readFile(new URL('services/marketplaceService.ts', root), 'utf8');

test('product catalog is BDAG-only, seller-owned, and has no checkout tables', () => {
  assert.match(sql, /create table public\.products/i);
  assert.match(sql, /constraint products_seller_id_fkey/i);
  assert.match(sql, /currency text not null default 'BDAG'/i);
  assert.match(sql, /check \(currency = 'BDAG'\)/i);
  assert.match(sql, /create table public\.product_saves/i);
  assert.match(sql, /seller_id = auth\.uid\(\)/i);
  assert.doesNotMatch(sql, /create table public\.(orders|payments|checkout)/i);
  assert.doesNotMatch(shop, /placeOrder|updateOrderStatus|\.from\('orders'\)/);
  assert.doesNotMatch(shop, /currency: 'USD'/);
  assert.match(marketplaceService, /currency:'BDAG'/);
  assert.match(marketplaceService, /rpc\('create_marketplace_product'/);
  assert.match(screen, /Precio \(BDAG\)/);
  assert.match(catalogScreen, /BDAG/);
  assert.match(productScreen, /Agregar al carrito/);
  assert.doesNotMatch(productScreen, /create_order|reserve_inventory|atomic_ledger_transfer/i);
  assert.doesNotMatch(productScreen, /setOrderModalVisible\(true\)/);
  assert.doesNotMatch(hardening, /from public\.exclusive_content/i);
  assert.match(hardening, /revoke insert, update on public\.products from authenticated/i);
  assert.doesNotMatch(
    hardening,
    /grant update \([^)]*total_sales/is,
  );
  assert.match(mktA1,/revoke insert,update,delete on public\.products from anon,authenticated/);
  assert.doesNotMatch(marketplaceService,/from\('products'\)\.(insert|update|delete)/);
});

test('product images retain positions and compensate a failed link', async () => {
  const deletedAssets = [];
  const deletedProducts = [];
  await assert.rejects(publishLinkedMedia({
    items: ['cover', 'detail'],
    upload: async (_item, index) => ({
      assetId: `product-asset-${index}`,
      url: `https://media.test/product-${index}.jpg`,
    }),
    createEntity: async urls => {
      assert.equal(urls[0], 'https://media.test/product-0.jpg');
      return 'product-id';
    },
    linkAsset: async (_assetId, _entityId, _slot, position) => {
      if (position === 1) throw new Error('LINK_FAILED');
    },
    deleteAsset: async assetId => deletedAssets.push(assetId),
    deleteEntity: async id => deletedProducts.push(id),
    slot: 'image',
  }));
  assert.deepEqual(deletedProducts, ['product-id']);
  assert.deepEqual(deletedAssets.sort(), ['product-asset-0', 'product-asset-1']);
});
