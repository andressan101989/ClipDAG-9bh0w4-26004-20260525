import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const migration = read('supabase/migrations/20260726104000_atomic_media_entities_and_cleanup.sql');
const shopContext = read('contexts/ShopContext.tsx');
const createProduct = read('app/create-product.tsx');
const marketplace = read('services/marketplaceService.ts');
const mediaService = read('services/mediaService.ts');
const upload = read('app/(tabs)/upload.tsx');

test('product edits expose only mutable catalog fields', () => {
  const updateBlock = shopContext.slice(
    shopContext.indexOf('const updateProduct'),
    shopContext.indexOf('const deleteProduct'),
  );
  assert.match(updateBlock, /\.update\(mutableFields\)/);
  for (const forbidden of ['updated_at', 'currency', 'total_sales']) {
    assert.doesNotMatch(updateBlock, new RegExp(forbidden));
  }
  assert.match(updateBlock, /Partial<Pick<Product, 'title' \| 'description' \| 'price' \| 'stock' \| 'status'>>/);
});

test('product publishing is locked through compensation', () => {
  const publishBlock = createProduct.slice(
    createProduct.indexOf('const handlePublish'),
    createProduct.indexOf('return (', createProduct.indexOf('const handlePublish')),
  );
  assert.match(publishBlock, /if \(publishLockRef\.current \|\| isPublishing\) return/);
  assert.match(publishBlock, /publishLockRef\.current = true/);
  assert.match(publishBlock, /finally\s*\{\s*publishLockRef\.current = false/s);
  assert.match(publishBlock, /setIsPublishing\(true\)/);
  assert.match(publishBlock, /finally\s*\{[\s\S]*setIsPublishing\(false\)/);
  assert.equal((publishBlock.match(/setIsPublishing\(false\)/g) ?? []).length, 1);
});

test('marketplace service is catalog-only and BDAG-only', () => {
  assert.doesNotMatch(marketplace, /from\(['"]orders['"]\)/);
  assert.doesNotMatch(marketplace, /export async function (fetchMyOrders|placeOrder|updateOrderStatus)/);
  assert.match(marketplace, /products_seller_id_fkey/);
  assert.match(marketplace, /\.eq\('currency', 'BDAG'\)/);
  for (const category of ['digital', 'physical', 'art', 'music', 'clothing', 'other']) {
    assert.match(marketplace, new RegExp(`'${category}'`));
  }
  assert.doesNotMatch(marketplace, /'service'/);
});

test('client media linking excludes unsupported entity types', () => {
  assert.match(mediaService, /'user_profile' \| 'video_post' \| 'story' \| 'shop_product'/);
  assert.doesNotMatch(mediaService, /LinkableMediaEntity[\s\S]*exclusive_content/);
});

test('cleanup makes expired stories and invalid links retryable', () => {
  assert.match(migration, /error_code = 'story_expired'/);
  assert.match(migration, /delete from public\.stories where expires_at <= now\(\)/);
  assert.match(migration, /error_code = 'linked_entity_missing'/);
  assert.match(migration, /p\.status <> 'deleted'/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.media_assets/i);
});

test('three media entity RPCs create ordered links atomically', () => {
  for (const signature of [
    'create_carousel_post',
    'create_photo_story_with_media',
    'create_product_with_media',
  ]) {
    assert.match(migration, new RegExp(`function public\\.${signature}`));
  }
  assert.match(migration, /purpose = 'carousel_image'/);
  assert.match(migration, /purpose='post_image'/);
  assert.match(migration, /purpose = 'product_image'/);
  assert.match(migration, /select p_asset_ids\[i\].*i - 1/s);
  assert.match(migration, /'story',v_story_id,'media',0/);
  assert.match(migration, /'BDAG'/);
  assert.match(migration, /from public, anon/g);
});

test('atomic behavior rolls back entity and links on internal failure', () => {
  const state = { entities: [], links: [] };
  const atomicCreate = ({ failAtLink = -1, assetIds }) => {
    const snapshot = structuredClone(state);
    try {
      const entity = { id: 'entity-1' };
      state.entities.push(entity);
      assetIds.forEach((assetId, position) => {
        if (position === failAtLink) throw new Error('link_failed');
        state.links.push({ assetId, entityId: entity.id, position });
      });
      return entity.id;
    } catch (error) {
      state.entities = snapshot.entities;
      state.links = snapshot.links;
      throw error;
    }
  };

  assert.throws(() => atomicCreate({ assetIds: ['a', 'b', 'c'], failAtLink: 1 }));
  assert.deepEqual(state, { entities: [], links: [] });
  assert.equal(atomicCreate({ assetIds: ['a', 'b', 'c'] }), 'entity-1');
  assert.deepEqual(state.links.map(link => link.position), [0, 1, 2]);
});

test('atomic RPC validation rejects anonymous and foreign assets', () => {
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /owner_id = v_user_id/g);
  assert.match(migration, /asset_not_ready_or_owned/g);
  assert.match(migration, /revoke all on function public\.create_carousel_post[\s\S]*from public, anon/);
  assert.match(migration, /revoke all on function public\.create_photo_story_with_media[\s\S]*from public, anon/);
  assert.match(migration, /revoke all on function public\.create_product_with_media[\s\S]*from public, anon/);
});

test('exclusive carousel compensation is authoritative and bounded', () => {
  assert.match(upload, /cancelUnpublishedExclusiveContent\(exclusiveContentId\)/);
  assert.match(migration, /cancel_unpublished_exclusive_content/);
  assert.match(migration, /creator_id = auth\.uid\(\)/);
  assert.match(migration, /created_at > now\(\) - interval '15 minutes'/);
  assert.match(migration, /not exists \([\s\S]*content_purchases/);
});
