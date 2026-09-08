import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { publishLinkedMedia } from './helpers/mediaEntityFlowHarness.mjs';

const root = new URL('../', import.meta.url);
const sql = await readFile(
  new URL('supabase/migrations/20260726100000_create_stories_schema.sql', root),
  'utf8',
);
const hardening = await readFile(
  new URL('supabase/migrations/20260908225020_stories_v2_b_canonical_contract_security_hardening.sql', root),
  'utf8',
);
const context = await readFile(new URL('contexts/StoriesContext.tsx', root), 'utf8');
const feed = await readFile(new URL('app/(tabs)/index.tsx', root), 'utf8');

test('story schema has authoritative identity, expiry, RLS, and views', () => {
  assert.match(sql, /create table public\.stories/i);
  assert.match(sql, /constraint stories_user_id_fkey/i);
  assert.match(sql, /check \(media_type in \('photo', 'video'\)\)/i);
  assert.match(sql, /expires_at > created_at/i);
  assert.match(sql, /create table public\.story_views/i);
  assert.match(sql, /unique\(story_id, viewer_id\)/i);
  assert.match(sql, /with check \(user_id = auth\.uid\(\)\)/i);
  assert.match(sql, /viewer_id = auth\.uid\(\)/i);
});

test('story flow returns remote ID, links position zero, and compensates failures', async () => {
  const links = [];
  const result = await publishLinkedMedia({
    items: ['photo'],
    upload: async () => ({ assetId: 'story-asset', url: 'https://media.test/story.jpg' }),
    createEntity: async () => 'story-id',
    linkAsset: async (assetId, entityId, slot, position) => links.push({ assetId, entityId, slot, position }),
    deleteAsset: async () => assert.fail('successful story asset must remain'),
    deleteEntity: async () => assert.fail('successful story must remain'),
    slot: 'media',
  });
  assert.equal(result.entityId, 'story-id');
  assert.deepEqual(links, [{ assetId: 'story-asset', entityId: 'story-id', slot: 'media', position: 0 }]);

  const deleted = [];
  await assert.rejects(publishLinkedMedia({
    items: ['photo'],
    upload: async () => ({ assetId: 'story-asset', url: 'https://media.test/story.jpg' }),
    createEntity: async () => undefined,
    linkAsset: async () => {},
    deleteAsset: async id => deleted.push(id),
    deleteEntity: async () => {},
    slot: 'media',
  }));
  assert.deepEqual(deleted, ['story-asset']);
});

test('physical story path uses one canonical RPC and never persists a local URI', () => {
  assert.match(context, /rpc\('create_story_with_media'/);
  assert.match(feed, /addStory\(uploaded\.assetId\)/);
  assert.match(feed, /purpose: isVideo \? 'story_video' : 'post_image'/);
  assert.doesNotMatch(feed, /uploadFileFromUri\(/);
  assert.doesNotMatch(context, /from\('stories'\)\.insert/);
  assert.doesNotMatch(feed, /addStory\(asset\.uri/);
  assert.doesNotMatch(feed, /linkMediaAsset\(uploaded\.assetId, 'story'/);
  assert.match(hardening, /create or replace function public\.create_story_with_media\(p_asset_id uuid\)/i);
  assert.match(hardening, /drop policy if exists stories_insert_owned/i);
});
