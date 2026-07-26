import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { publishLinkedMedia } from './helpers/mediaEntityFlowHarness.mjs';

const root = new URL('../', import.meta.url);
const migration = await readFile(
  new URL('supabase/migrations/20260726102000_create_carousel_post_rpc.sql', root),
  'utf8',
);
const uploadScreen = await readFile(new URL('app/(tabs)/upload.tsx', root), 'utf8');
const feed = await readFile(new URL('contexts/FeedContext.tsx', root), 'utf8');

for (const count of [2, 3, 10]) {
  test(`carousel preserves order and links ${count} positions`, async () => {
    const links = [];
    const result = await publishLinkedMedia({
      items: Array.from({ length: count }, (_, index) => `item-${index}`),
      upload: async (_item, index) => {
        await new Promise(resolve => setTimeout(resolve, (count - index) % 3));
        return { assetId: `asset-${index}`, url: `https://media.test/${index}.jpg` };
      },
      createEntity: async urls => {
        assert.deepEqual(urls, Array.from({ length: count }, (_, index) => `https://media.test/${index}.jpg`));
        return 'post-id';
      },
      linkAsset: async (assetId, entityId, slot, position) => {
        links.push({ assetId, entityId, slot, position });
      },
      deleteAsset: async () => assert.fail('successful assets must not be deleted'),
      deleteEntity: async () => assert.fail('successful post must not be deleted'),
      slot: 'media',
    });
    assert.equal(result.entityId, 'post-id');
    assert.deepEqual(
      links.sort((a, b) => a.position - b.position).map(link => link.position),
      Array.from({ length: count }, (_, index) => index),
    );
  });
}

test('upload, entity, and link failures compensate every completed asset', async () => {
  for (const failure of ['upload', 'entity', 'link']) {
    const deletedAssets = [];
    const deletedEntities = [];
    await assert.rejects(publishLinkedMedia({
      items: ['a', 'b', 'c'],
      upload: async (_item, index) => {
        if (failure === 'upload' && index === 2) throw new Error('UPLOAD_FAILED');
        return { assetId: `asset-${index}`, url: `https://media.test/${index}.jpg` };
      },
      createEntity: async () => failure === 'entity' ? undefined : 'post-id',
      linkAsset: async (_assetId, _entityId, _slot, position) => {
        if (failure === 'link' && position === 1) throw new Error('LINK_FAILED');
      },
      deleteAsset: async assetId => deletedAssets.push(assetId),
      deleteEntity: async entityId => deletedEntities.push(entityId),
      slot: 'media',
    }));
    assert.ok(deletedAssets.length >= 2);
    if (failure === 'link') assert.deepEqual(deletedEntities, ['post-id']);
  }
});

test('carousel RPC is authenticated, bounded, HTTPS-only, and balance-neutral', () => {
  assert.match(migration, /security definer/i);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /not between 2 and 10/i);
  assert.match(migration, /\^https:\/\//i);
  assert.match(migration, /revoke execute .* from anon/i);
  assert.match(migration, /grant execute .* to authenticated/i);
  assert.doesNotMatch(migration, /ledger|balance|wallet|live_/i);
  assert.match(feed, /supabase\.rpc\('create_carousel_post'/);
  assert.doesNotMatch(uploadScreen, /\(addVideo as any\)/);
  assert.match(uploadScreen, /completedUploads\[index\] = completed/);
});
