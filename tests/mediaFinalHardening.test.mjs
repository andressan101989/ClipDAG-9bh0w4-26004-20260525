import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const migration = read('supabase/migrations/20260726104000_atomic_media_entities_and_cleanup.sql');
const createProduct = read('app/seller/product-editor/[productId].tsx');
const marketplace = read('services/marketplaceService.ts');
const mediaService = read('services/mediaService.ts');
const upload = read('app/(tabs)/upload.tsx');

test('product edits expose only mutable catalog fields', () => {
  const updateBlock = marketplace.slice(
    marketplace.indexOf('export async function updateProduct'),
    marketplace.indexOf('export async function setProductPublished'),
  );
  assert.match(updateBlock, /rpc\('update_marketplace_product'/);
  for (const forbidden of ['updated_at', 'currency', 'total_sales']) {
    assert.doesNotMatch(updateBlock, new RegExp(forbidden));
  }
  assert.doesNotMatch(updateBlock,/\.from\('products'\)\.update/);
});

test('product publishing is locked through compensation', () => {
  const publishBlock=createProduct.slice(createProduct.indexOf('const publish = async'),createProduct.indexOf('if (loading)'));
  assert.match(publishBlock,/setPublishing\(true\)/);assert.match(publishBlock,/finally[\s\S]*setPublishing\(false\)/);assert.match(publishBlock,/images\.some/);
});

test('marketplace service is catalog-only and BDAG-only', () => {
  assert.doesNotMatch(marketplace, /from\(['"]orders['"]\)/);
  assert.doesNotMatch(marketplace, /export async function (fetchMyOrders|placeOrder|updateOrderStatus)/);
  assert.match(marketplace, /fetch_public_marketplace_products/);
  assert.match(marketplace, /currency:'BDAG'/);
  for (const category of ['digital', 'physical', 'art', 'music', 'clothing', 'other']) {
    assert.match(marketplace, new RegExp(`'${category}'`));
  }
  assert.doesNotMatch(marketplace, /'service'/);
});

test('client media linking excludes unsupported entity types', () => {
  assert.match(mediaService, /"user_profile"\s*\|\s*"video_post"\s*\|\s*"story"\s*\|\s*"shop_product"/);
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

test('exclusive feed publishing is disabled while legacy cancellation stays available', () => {
  assert.match(upload, /Contenido exclusivo próximamente/);
  assert.doesNotMatch(upload, /<ExclusiveToggle/);
  assert.match(upload, /result\.success !== true \|\| !result\.content_id/);
  assert.match(migration, /cancel_unpublished_exclusive_content/);
  assert.match(migration, /creator_id = auth\.uid\(\)/);
  assert.match(migration, /created_at > now\(\) - interval '15 minutes'/);
  assert.match(migration, /not exists \([\s\S]*content_purchases/);
});
