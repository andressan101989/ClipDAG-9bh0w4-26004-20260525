import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root=path.resolve(import.meta.dirname,'..');
const read=relative=>readFileSync(path.join(root,relative),'utf8');
const migrationNames=readdirSync(path.join(root,'supabase','migrations'))
  .filter(name=>name.endsWith('_web_control_centers_b1_publication_drafts.sql'));

function candidateMigration(){
  assert.equal(migrationNames.length,1,
    'B1 requires exactly one forward-only publication/draft migration');
  return read(`supabase/migrations/${migrationNames[0]}`);
}

test('B1 adds one immutable owner-scoped publication receipt authority',()=>{
  const sql=candidateMigration();
  assert.match(sql,/create\s+table\s+private\.publication_receipts/i);
  assert.match(sql,/owner_id\s+uuid\s+not\s+null/i);
  assert.match(sql,/client_command_id\s+uuid\s+not\s+null/i);
  assert.match(sql,/request_fingerprint\s+text\s+not\s+null/i);
  assert.match(sql,/post_id\s+uuid\s+not\s+null/i);
  assert.match(sql,/unique\s*\(\s*owner_id\s*,\s*client_command_id\s*\)/i);
  assert.match(sql,/enable\s+row\s+level\s+security/i);
  assert.match(sql,/force\s+row\s+level\s+security/i);
  assert.match(sql,/guard_[a-z0-9_]*publication_receipt[a-z0-9_]*\s*\(/i);
  assert.match(sql,/before\s+(?:update\s+or\s+delete|delete\s+or\s+update)/i);
});

test('publication replay validates the receipt target instead of recreating a deleted post',()=>{
  const sql=candidateMigration();
  const start=sql.search(/create\s+(?:or\s+replace\s+)?function\s+public\.publish_my_media_post_v1\s*\(/i);
  const body=sql.slice(start,sql.indexOf('$function$;',start)+11);
  assert.match(body,/publication_receipt_target_missing/i);
  assert.match(body,/public\.videos[\s\S]{0,300}(?:user_id|owner_id)/i);
  assert.ok(body.indexOf('publication_receipt_target_missing')<body.indexOf('create_photo_post_with_media'),
    'receipt replay must validate the existing target before any publisher call');
});

test('photo and carousel publication use one versioned receipt-backed wrapper',()=>{
  const sql=candidateMigration();
  const start=sql.search(/create\s+(?:or\s+replace\s+)?function\s+public\.publish_my_media_post_v1\s*\(/i);
  assert.ok(start>=0,'publish_my_media_post_v1 must exist');
  const body=sql.slice(start,sql.indexOf('$function$;',start)+11);
  assert.match(body,/auth\.uid\s*\(\s*\)/i);
  assert.match(body,/security\s+definer/i);
  assert.match(body,/set\s+search_path\s*=\s*''/i);
  assert.match(body,/pg_advisory_xact_lock|for\s+update/i);
  assert.match(body,/request_fingerprint/i);
  assert.match(body,/digest\s*\(|sha256|encode\s*\(/i);
  assert.match(body,/create_photo_post_with_media\s*\(/i);
  assert.match(body,/create_carousel_post\s*\(/i);
  assert.match(body,/publication_receipts/i);
  assert.match(body,/return\s+v_(?:post_id|existing_post_id)|returns\s+uuid/i);
  assert.doesNotMatch(body,/insert\s+into\s+public\.videos/i,
    'the wrapper must delegate instead of creating a parallel Feed publisher');
});

test('publication receipt replay is exact and a reused command with changed payload fails closed',()=>{
  const sql=candidateMigration();
  assert.match(sql,/client_command_id[\s\S]{0,1200}request_fingerprint/i);
  assert.match(sql,/publication_(?:command|receipt)_(?:mismatch|conflict)|idempotency_(?:key_)?conflict/i);
  assert.match(sql,/ordered_asset_ids|array_to_json|to_jsonb\s*\(\s*p_asset_ids/i);
  assert.match(sql,/coalesce\s*\(\s*p_caption/i);
  assert.match(sql,/coalesce\s*\(\s*(?:nullif\s*\(\s*btrim\s*\(\s*)?p_music/i);
});

test('new B1 RPCs expose only authenticated execution and pin empty search paths',()=>{
  const sql=candidateMigration();
  for(const signature of [
    'publish_my_media_post_v1',
    'publish_my_publication_draft_v1',
  ]){
    assert.match(sql,new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${signature}\\s*\\(`,'i'));
    assert.match(sql,new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${signature}\\s*\\([\\s\\S]{0,300}?to\\s+authenticated`,'i'));
  }
  const definitions=sql.match(/create\s+(?:or\s+replace\s+)?function\s+public\.(?:publish_my_media_post_v1|publish_my_publication_draft_v1)[\s\S]*?\$function\$;/gi)??[];
  assert.equal(definitions.length,2);
  for(const definition of definitions){
    assert.match(definition,/security\s+definer/i);
    assert.match(definition,/set\s+search_path\s*=\s*''/i);
    assert.match(definition,/auth\.uid\s*\(\s*\)/i);
  }
});

test('B1 does not introduce scheduler, finance, or parallel media authorities',()=>{
  const sql=candidateMigration();
  assert.doesNotMatch(sql,/cron\.schedule|pg_cron|scheduled_at|publish_at/i);
  assert.doesNotMatch(sql,/\b(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.(?:ledger_accounts|ledger_entries|financial_transactions|wallets?)\b/i);
  assert.doesNotMatch(sql,/create\s+table\s+(?:public|private)\.(?:media_assets|publication_media_reservations|publication_jobs|publication_queue)\b/i);
});

test('B1 disposable proof and security fixture are present',()=>{
  assert.equal(existsSync(path.join(root,'scripts','prove-web-control-centers-b1-disposable.mjs')),true,
    'B1 needs a real PostgreSQL disposable proof');
  assert.equal(existsSync(path.join(root,'tests','fixtures','web-control-centers-b1-security.sql')),true);
});
