import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";

const read=(path)=>readFileSync(path,"utf8");
const migration=read("supabase/migrations/20260914041251_admin_shared_story_secure_inspection.sql");
const page=read("apps/admin-web/src/pages/AdminStoriesPages.tsx");
const api=read("apps/admin-web/src/lib/adminApi.ts");
const edge=read("supabase/functions/get-media-url/index.ts");
const mobile=read("contexts/StoriesContext.tsx");

const body=(name)=>{
  const start=migration.search(new RegExp(`create or replace function public\\.${name}\\b`,"i"));
  assert.notEqual(start,-1,`missing ${name}`);
  const end=migration.indexOf("$$;",start);
  assert.notEqual(end,-1,`unterminated ${name}`);
  return migration.slice(start,end+3);
};

test("shared Story projection follows the canonical video asset relations",()=>{
  const list=body("search_admin_stories"),detail=body("get_admin_story_detail");
  for(const sql of [list,detail]){
    assert.match(sql,/s\.shared_video_id/);
    assert.match(sql,/public\.video_asset_links/);
    assert.match(sql,/public\.video_assets/);
    assert.match(sql,/public\.media_asset_links/);
    assert.match(sql,/public\.media_assets/);
    assert.match(sql,/entity_type='video_post'/);
    assert.match(sql,/provider='cloudflare_stream'/);
    assert.match(sql,/provider='r2'/);
    assert.match(sql,/status='ready'/);
    assert.match(sql,/visibility='public'/);
    assert.doesNotMatch(sql,/then\s+v\.video_url|then\s+s\.media_url/i);
  }
});

test("direct private Story media remains on the canonical signer path",()=>{
  const detail=body("get_admin_story_detail");
  assert.match(detail,/entity_type='story'/);
  assert.match(detail,/direct_media\.visibility='private'/);
  assert.match(page,/getAdminMediaUrl\(assetId,\{surface:"story",entityId:id\}\)/);
  assert.match(edge,/surface:'story'/);
  assert.match(edge,/stories\.items\.read/);
  assert.doesNotMatch(page,/service_role|object_key|bucket_name|r2_secret/i);
});

test("Story inspection is capability-gated with least-privilege RPC ACL",()=>{
  for(const name of ["search_admin_stories","get_admin_story_detail"]){
    const sql=body(name);
    assert.match(sql,/security definer/);
    assert.match(sql,/set search_path to 'pg_catalog','private','public'/);
    assert.match(sql,/admin_require_capability\('stories\.items\.read'\)/);
  }
  assert.match(migration,/revoke all on function public\.search_admin_stories[\s\S]*from public,anon,authenticated,service_role/);
  assert.match(migration,/grant execute on function public\.get_admin_story_detail\(uuid\)[\s\S]*to authenticated/);
  assert.match(page,/hasCapability\("stories\.items\.moderate"\)/);
  assert.match(api,/rpc\("admin_moderate_story"/);
  assert.doesNotMatch(page,/role\s*===\s*["']SUPER_ADMIN/);
});

test("untrusted and HTTP URLs are not promoted by the projection or UI",()=>{
  assert.match(migration,/public_url~\*'\^https:\/\//);
  assert.match(migration,/hls_url~\*'\^https:\/\//);
  assert.match(page,/trustedMediaOrigins/);
  assert.match(page,/safeHttpsUrl\(value\)/);
  assert.match(page,/canonicalR2Host/);
  assert.match(page,/cloudflarestream\.com/);
  assert.match(page,/videodelivery\.net/);
  assert.doesNotMatch(page,/^\s*return\s+value\s*;/m);
});

test("missing shared sources and composition are presented for investigation without raw JSON",()=>{
  assert.match(migration,/then 'missing'/);
  assert.match(migration,/'composition',s\.story_composition/);
  assert.match(migration,/reported_content_type='story'/);
  assert.match(page,/Contenido de origen no disponible/);
  assert.match(page,/Composición publicada/);
  assert.match(page,/Emoji \/ sticker/);
  assert.doesNotMatch(page,/JSON\.stringify|<pre/);
  assert.match(mobile,/get_story_shared_content/);
});

test("migration creates no parallel tables, services, or data mutation authority",()=>{
  assert.doesNotMatch(migration,/create\s+table|alter\s+table|insert\s+into|update\s+(?:public|private)\.|delete\s+from|ledger|wallet|escrow/i);
  assert.doesNotMatch(migration,/get-story-media-url|admin-story-media-url|secure-story-url/i);
});
