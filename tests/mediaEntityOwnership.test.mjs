import assert from 'node:assert/strict';
import test from 'node:test';
import { canLinkEntity } from './helpers/mediaLifecycleHarness.mjs';

const rows = {
  videos: { mine: { user_id: 'u1' }, foreign: { user_id: 'u2' } },
  stories: { mine: { user_id: 'u1' } },
  products: { mine: { seller_id: 'u1' }, foreign: { seller_id: 'u2' } },
  exclusive_content: { mine: { creator_id: 'u1' } },
};
const lookup = async (table, id) => rows[table]?.[id] ?? null;

test('profile ownership is exact', async () => {
  assert.equal(await canLinkEntity({ type: 'user_profile', entityId: 'u1', userId: 'u1', lookup }), true);
  assert.equal(await canLinkEntity({ type: 'user_profile', entityId: 'u2', userId: 'u1', lookup }), false);
});

test('posts and products owned by another user are rejected', async () => {
  assert.equal(await canLinkEntity({ type: 'video_post', entityId: 'foreign', userId: 'u1', lookup }), false);
  assert.equal(await canLinkEntity({ type: 'shop_product', entityId: 'foreign', userId: 'u1', lookup }), false);
  assert.equal(await canLinkEntity({ type: 'video_post', entityId: 'mine', userId: 'u1', lookup }), true);
});

test('unknown and chat_message entity types remain disabled', async () => {
  assert.equal(await canLinkEntity({ type: 'chat_message', entityId: 'mine', userId: 'u1', lookup }), false);
  assert.equal(await canLinkEntity({ type: 'missing', entityId: 'mine', userId: 'u1', lookup }), false);
});
