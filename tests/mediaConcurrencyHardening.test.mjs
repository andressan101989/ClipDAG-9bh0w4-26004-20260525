import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sql = fs.readFileSync(
  'supabase/migrations/20260726106000_serialize_media_asset_linking_and_deletion.sql',
  'utf8',
);

test('all entity/link RPCs lock media assets before validation', () => {
  for (const signature of [
    'create_carousel_post',
    'create_photo_post_with_media',
    'create_photo_story_with_media',
    'create_product_with_media',
    'set_profile_avatar_with_media',
    'link_media_asset',
  ]) {
    const start = sql.indexOf(`function public.${signature}`);
    assert.notEqual(start, -1, `${signature} missing`);
    const body = sql.slice(start, sql.indexOf('$$;', start) + 3);
    assert.match(body, /for update;/i, `${signature} must lock assets`);
    assert.ok(
      body.indexOf('for update;') < body.indexOf("status='ready'"),
      `${signature} must lock before ready validation`,
    );
  }
});

test('array RPCs acquire locks in deterministic asset-id order', () => {
  for (const signature of ['create_carousel_post', 'create_product_with_media']) {
    const start = sql.indexOf(`function public.${signature}`);
    const body = sql.slice(start, sql.indexOf('$$;', start) + 3);
    assert.match(body, /where a\.id=any\(p_asset_ids\)[\s\S]*order by a\.id[\s\S]*for update;/i);
  }
});

test('defensive finalization requires delete_pending and no valid links', () => {
  const start = sql.indexOf('function public.finalize_media_asset_deletion');
  const body = sql.slice(start, sql.indexOf('$$;', start) + 3);
  assert.match(body, /v_status <> 'delete_pending'/);
  assert.match(body, /media_asset_has_valid_links\(p_asset_id\)/);
  assert.match(body, /if public\.media_asset_has_valid_links\(p_asset_id\) then return false/);
  assert.match(body, /and status='delete_pending'/);
});

