import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";

const read=(path)=>readFileSync(path,"utf8");
const edge=read("supabase/functions/get-media-url/index.ts");
const migration=read("supabase/migrations/20260913182333_superuser_admin_human_media_projection.sql");

test("admin pages contain no primary raw JSON renderer",()=>{for(const name of readdirSync("apps/admin-web/src/pages").filter((item)=>item.endsWith(".tsx"))){const source=read(join("apps/admin-web/src/pages",name));assert.doesNotMatch(source,/<pre[\s\S]{0,120}JSON\.stringify|JSON\.stringify\([^)]*\)[\s\S]{0,120}<\/pre>/,name)}});
test("one canonical media signer authorizes scoped admin contexts",()=>{assert.match(edge,/surface:'story'\|'reported_message'\|'marketplace_dispute'/);assert.match(edge,/stories\.items\.read/);assert.match(edge,/chat\.abuse_reports\.read/);assert.match(edge,/marketplace\.disputes\.read/);assert.match(edge,/reported_content_type','message'/);assert.match(edge,/reported_content_id/);assert.match(edge,/media_asset_id/);assert.doesNotMatch(edge,/admin-get-media-url|admin-media-signer/)});
test("reported-message admin preview never invokes the consuming chat authorization",()=>{const start=edge.indexOf("async function adminContextAllows"),end=edge.indexOf("async function returnParticipantMayReadLabel");const scoped=edge.slice(start,end);assert.doesNotMatch(scoped,/chat_authorize_media_access|media_consumed_at|chat_message_receipts/)});
test("media signer validates entity ownership before signing",()=>{const handler=edge.slice(edge.indexOf("if(admin_context!==undefined)"),edge.indexOf("const storyKindMatches"));assert.ok(handler.indexOf("adminContextAllows")<handler.indexOf("signGet"));assert.match(edge,/entity_type','story'.*entity_id',context\.entity_id.*slot','media'/s);assert.match(edge,/entity_type','marketplace_dispute'.*entity_id',context\.entity_id/s)});
test("projection migration preserves security and reveals no storage location",()=>{for(const capability of ["content.items.read","stories.items.read","reports.cases.read","chat.abuse_reports.read"])assert.match(migration,new RegExp(capability.replaceAll(".","\\.")));assert.match(migration,/security definer/gi);assert.match(migration,/set search_path/gi);assert.match(migration,/revoke all on function[\s\S]*grant execute on function/);assert.doesNotMatch(migration,/bucket_name|object_key|service_role_key|provider_metadata/i)});
test("presentation projection returns only the reported message asset",()=>{assert.match(migration,/'media_asset_id',m\.media_asset_id/);const context=migration.slice(migration.indexOf("select coalesce(jsonb_agg(item"));assert.doesNotMatch(context,/'media_asset_id'/)});
