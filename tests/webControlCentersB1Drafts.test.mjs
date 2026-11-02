import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root=path.resolve(import.meta.dirname,'..');
const read=relative=>readFileSync(path.join(root,relative),'utf8');
const migrationNames=readdirSync(path.join(root,'supabase','migrations'))
  .filter(name=>name.endsWith('_web_control_centers_b1_publication_drafts.sql'));
function migration(){
  assert.equal(migrationNames.length,1,
    'B1 requires exactly one forward-only publication/draft migration');
  return read(`supabase/migrations/${migrationNames[0]}`);
}

test('draft source of truth is private, FORCE-RLS, RPC-only, and revisioned',()=>{
  const sql=migration();
  assert.match(sql,/create\s+table\s+private\.publication_drafts/i);
  assert.match(sql,/kind\s+text\s+not\s+null[\s\S]{0,160}photo[\s\S]{0,80}carousel/i);
  assert.match(sql,/composition\s+jsonb\s+not\s+null/i);
  assert.match(sql,/revision\s+bigint\s+not\s+null\s+default\s+1/i);
  assert.match(sql,/state\s+text\s+not\s+null/i);
  assert.match(sql,/unique\s*\(\s*owner_id\s*,\s*client_request_id\s*\)/i);
  assert.match(sql,/alter\s+table\s+private\.publication_drafts\s+enable\s+row\s+level\s+security/i);
  assert.match(sql,/alter\s+table\s+private\.publication_drafts\s+force\s+row\s+level\s+security/i);
  assert.match(sql,/revoke\s+all\s+on\s+table\s+private\.publication_drafts\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
});

test('draft mutations have immutable command receipts for lost-response replay',()=>{
  const sql=migration();
  assert.match(sql,/create\s+table\s+private\.publication_draft_commands/i);
  assert.match(sql,/client_mutation_id\s+uuid\s+not\s+null/i);
  assert.match(sql,/request_fingerprint\s+text\s+not\s+null/i);
  assert.match(sql,/result_revision\s+bigint\s+not\s+null/i);
  assert.match(sql,/unique\s*\(\s*owner_id\s*,\s*client_mutation_id\s*\)/i);
  assert.match(sql,/guard_[a-z0-9_]*draft_command[a-z0-9_]*\s*\(/i);
  assert.match(sql,/before\s+(?:update\s+or\s+delete|delete\s+or\s+update)/i);
  for(const name of ['update_my_publication_draft_v1','delete_my_publication_draft_v1']){
    const start=sql.search(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`,'i'));
    const body=sql.slice(start,sql.indexOf('$function$;',start)+11);
    assert.match(body,/p_client_mutation_id/i);
    assert.match(body,/publication_draft_commands/i);
    assert.match(body,/draft_mutation_(?:conflict|receipt_mismatch)/i);
  }
});

test('draft composition is bounded and cannot persist local, signed, or delivery URLs',()=>{
  const sql=migration();
  assert.match(sql,/pg_column_size\s*\(\s*p_composition\s*\)[\s\S]{0,100}65536/i);
  assert.match(sql,/jsonb_typeof\s*\(\s*p_composition\s*\)\s*(?:<>|!=)\s*'object'/i);
  assert.match(sql,/draft_composition_(?:invalid|unsafe)/i);
  assert.match(sql,/file:|content:|ph:|blob:|data:|https/i);
});

test('draft links are the only durable media reservation and stay private',()=>{
  const sql=migration();
  assert.match(sql,/media_asset_links_entity_type_check[\s\S]{0,700}'publication_draft'/i);
  assert.match(sql,/guard_[a-z0-9_]*publication_draft[a-z0-9_]*media[a-z0-9_]*\s*\(/i);
  assert.match(sql,/new\.entity_type\s*(?:<>|=)\s*'publication_draft'/i);
  assert.match(sql,/asset\.owner_id\s+is\s+(?:not\s+)?distinct\s+from\s+draft\.owner_id|asset\.owner_id\s*(?:=|<>)\s*draft\.owner_id/i);
  assert.match(sql,/asset\.status\s*(?:=|<>)\s*'ready'/i);
  assert.match(sql,/asset\.visibility\s*(?:=|<>)\s*'private'/i);
  assert.match(sql,/asset\.public_url\s+is\s+(?:not\s+)?null/i);
  assert.match(sql,/asset\.purpose[\s\S]{0,300}'post_image'[\s\S]{0,300}'carousel_image'/i);
  assert.match(sql,/create\s+unique\s+index[\s\S]{0,250}media_asset_links[\s\S]{0,250}where\s+entity_type\s*=\s*'publication_draft'/i);
  assert.doesNotMatch(sql,/create\s+table\s+(?:public|private)\.publication_media_reservations/i);
});

test('generic link projections explicitly exclude publication drafts',()=>{
  const sql=migration();
  for(const policy of ['media_asset_links_owner_read','media_asset_links_public_read']){
    const start=sql.search(new RegExp(`create\\s+policy\\s+${policy}`,'i'));
    assert.ok(start>=0,`${policy} must be replaced`);
    const body=sql.slice(start,sql.indexOf(';',start)+1);
    assert.match(body,/entity_type\s+not\s+in\s*\([^)]*'publication_draft'/i);
  }
});

test('draft CRUD derives owner from auth and uses exact CAS plus bounded keyset pagination',()=>{
  const sql=migration();
  for(const name of [
    'create_my_publication_draft_v1','get_my_publication_draft_v1',
    'list_my_publication_drafts_v1','update_my_publication_draft_v1',
    'delete_my_publication_draft_v1',
  ]){
    const start=sql.search(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`,'i'));
    assert.ok(start>=0,`${name} must exist`);
    const body=sql.slice(start,sql.indexOf('$function$;',start)+11);
    assert.match(body,/auth\.uid\s*\(\s*\)/i);
    assert.match(body,/set\s+search_path\s*=\s*''/i);
    assert.doesNotMatch(body,/p_owner_id/i);
  }
  assert.match(sql,/p_expected_revision\s+bigint/i);
  assert.match(sql,/revision\s*=\s*p_expected_revision|where[\s\S]{0,180}revision\s*=\s*p_expected_revision/i);
  assert.match(sql,/draft_revision_(?:conflict|stale)|publication_draft_revision_conflict/i);
  assert.match(sql,/least\s*\(|greatest\s*\(/i);
  assert.match(sql,/p_cursor_updated_at|p_before_updated_at/i);
  assert.match(sql,/p_cursor_id|p_before_id/i);
  assert.match(sql,/order\s+by\s+[a-z0-9_.]*updated_at\s+desc\s*,\s*[a-z0-9_.]*id\s+desc/i);
});

test('draft mutation locks media deterministically and preserves MEDIA-C1 cleanup ownership',()=>{
  const sql=migration();
  assert.match(sql,/order\s+by\s+(?:asset\.)?id[\s\S]{0,80}for\s+update/i);
  assert.match(sql,/delete\s+from\s+public\.media_asset_links[\s\S]{0,220}entity_type\s*=\s*'publication_draft'/i);
  assert.match(sql,/schedule_media_asset_deletion\s*\(/i);
  assert.doesNotMatch(sql,/delete\s+from\s+public\.media_assets/i);
  assert.doesNotMatch(sql,/update\s+public\.media_assets[\s\S]{0,120}(?:visibility|bucket_name|object_key|purpose)\s*=/i);
});

test('draft publish accepts only canonical public assets and atomically releases private reservations',()=>{
  const sql=migration();
  const start=sql.search(/create\s+(?:or\s+replace\s+)?function\s+public\.publish_my_publication_draft_v1\s*\(/i);
  assert.ok(start>=0);
  const body=sql.slice(start,sql.indexOf('$function$;',start)+11);
  assert.match(body,/p_expected_revision/i);
  assert.match(body,/p_client_command_id/i);
  assert.match(body,/p_(?:public_)?asset_ids/i);
  assert.match(body,/visibility\s*=\s*'public'/i);
  assert.match(body,/status\s*=\s*'ready'/i);
  assert.match(body,/create_photo_post_with_media|create_carousel_post/i);
  assert.match(body,/publication_receipts/i);
  assert.match(body,/state\s*=\s*'published'/i);
  assert.match(body,/delete\s+from\s+public\.media_asset_links/i);
});

test('B1 scopes private cloud media drafts honestly to photo and carousel',()=>{
  const sql=migration();
  assert.match(sql,/kind\s+in\s*\(\s*'photo'\s*,\s*'carousel'\s*\)/i);
  assert.doesNotMatch(sql,/kind\s+in\s*\([^)]*'video'/i);
  assert.doesNotMatch(sql,/purpose\s*=\s*'story_video'|purpose\s*=\s*'chat_video'/i);
});
