import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import test from "node:test";

const read=(path)=>readFileSync(path,"utf8");
const walk=(dir)=>readdirSync(dir).flatMap((name)=>{const path=dir+"/"+name;return statSync(path).isDirectory()&&!path.includes("/node_modules")&&!path.includes("/dist")?walk(path):[path]});
const webFiles=walk("apps/admin-web").filter((path)=>!path.includes("/node_modules")&&!path.includes("/dist"));
const webSource=webFiles.filter((path)=>/\.(ts|tsx|js|json|html|css|example)$/.test(path)).map(read).join("\n");
const migration=read("supabase/migrations/20260811028000_marketplace_admin_web_foundation.sql");
const b8s=read("supabase/migrations/20260811027000_marketplace_admin_identity_hardening.sql");
const proof=read("scripts/prove-marketplace-admin-web-foundation.mjs");
const auditor=read("scripts/audit-marketplace-b8a-remote.mjs");
const rootPackage=JSON.parse(read("package.json"));
const app=JSON.parse(read("app.json"));

test("B8A is an isolated Vite web package outside the Expo router",()=>{
  assert.equal(existsSync("apps/admin-web/package.json"),true);
  assert.equal(rootPackage.main,"expo-router/entry");
  assert.equal(app.expo.ios.buildNumber,"22");
  assert.equal(existsSync("app/marketplace/admin"),false);
  assert.match(read("apps/admin-web/package.json"),/"vite": "7\.1\.3"/);
});
test("browser configuration contains only public Supabase variables",()=>{
  assert.match(read("apps/admin-web/.env.example"),/VITE_SUPABASE_URL/);
  assert.match(read("apps/admin-web/.env.example"),/VITE_SUPABASE_ANON_KEY/);
  assert.doesNotMatch(webSource,/SERVICE_ROLE|service_role|SUPABASE_DB_PASSWORD|PGPASSWORD|JWT_SECRET|STRIPE_SECRET|PRIVATE_KEY|private_key/);
});
test("B8S remains the immutable server-authoritative prerequisite",()=>{
  assert.match(b8s,/protect_user_profile_server_fields/);
  assert.match(b8s,/revoke insert, update, delete/);
  assert.match(migration,/marketplace_actor_is_admin\(\)/);
  assert.match(migration,/auth\.uid\(\)/);
  assert.doesNotMatch(migration,/p_admin_user_id|p_actor_id/);
});
test("B8A migration exposes only read-only admin RPCs",()=>{
  for(const name of["get_my_marketplace_admin_access","get_marketplace_admin_overview","search_marketplace_admin_orders","get_marketplace_admin_order_detail"])assert.match(migration,new RegExp(name));
  assert.match(migration,/revoke all on function public\.get_my_marketplace_admin_access\(\) from public,anon,authenticated,service_role/);
  assert.match(migration,/grant execute on function public\.get_marketplace_admin_overview\(text\) to authenticated,service_role/);
  assert.doesNotMatch(migration,/(insert into|update|delete from) public\.(marketplace_|ledger_|financial_)/i);
});
test("server order search is bounded and cursor paginated",()=>{
  assert.match(migration,/p_cursor_created_at timestamptz/);
  assert.match(migration,/p_cursor_id uuid/);
  assert.match(migration,/p_limit>100/);
  assert.match(migration,/\(o\.created_at,o\.id\)<\(p_cursor_created_at,p_cursor_id\)/);
  assert.match(migration,/limit p_limit\+1/);
});
test("overview and detail use canonical payment and creator facts",()=>{
  assert.match(migration,/marketplace_payment_allocations/);
  assert.match(migration,/marketplace_order_item_creator_allocations/);
  assert.match(migration,/marketplace_settlement_legs/);
  assert.match(migration,/marketplace_settlement_reversal_legs/);
  assert.doesNotMatch(webSource,/commission.*\*|\*.*commission|bps.*\*|\*.*bps/i);
});
test("browser operational access is RPC-only and contains no protected writes",()=>{
  assert.match(webSource,/supabase\.rpc/);
  assert.doesNotMatch(webSource,/supabase\.from\([^)]*\)\.(insert|update|delete)/);
  assert.doesNotMatch(webSource,/ledger_(debit|credit)|resolve_marketplace_dispute|confirm_marketplace_order_delivery_and_release/);
});
test("web routes and shell are limited to B8A Marketplace pages",()=>{
  const appSource=read("apps/admin-web/src/App.tsx");
  for(const route of["/login","/marketplace","/marketplace/orders","/marketplace/orders/:orderId"])assert.equal(appSource.includes(`path="${route}"`),true,route);
  assert.doesNotMatch(appSource,/\/users|\/moderation|\/security|\/ads/);
});
test("typed API validates UUIDs dates money cursors and payload objects",()=>{
  const api=read("apps/admin-web/src/lib/adminApi.ts");
  for(const marker of["const uuid","const date","const money","const object","OrderCursor","next_cursor"])assert.match(api,new RegExp(marker));
});
test("proof covers authorization B8S pagination and exact creator economics",()=>{
  for(const marker of["anonymousDenied","ordinaryDenied","metadataForgeryDenied","b8sInsertEscalationDenied","b8sUpdateEscalationDenied","cursorPaginationExact","noDuplicates","multiCreator","liveCreatorTrace","settlementTrace","reversalTrace","fixtures"])assert.match(proof,new RegExp(marker));
  assert.match(proof,/commissionGenerated:14/);
  assert.match(proof,/commissionReleased:12/);
  assert.match(proof,/commissionReversed:12/);
});
test("remote auditor is read-only and covers pre/post B8A plus B8S",()=>{
  assert.match(auditor,/--expect-pre-b8a/);
  assert.match(auditor,/--require-b8a/);
  assert.match(auditor,/20260811027000/);
  assert.match(auditor,/20260811028000/);
  assert.match(auditor,/b8s_admin_update_denied/);
  assert.doesNotMatch(auditor,/\b(update|insert into|delete from) public\./i);
});
test("B8B mutation authority and hosting deployment are absent",()=>{
  assert.doesNotMatch(webSource,/Refundar|Revertir pago|Liberar liquidación|Ajustar saldo|Aprobar vendedor/);
  assert.equal(existsSync("apps/admin-web/vercel.json"),false);
  assert.equal(existsSync("apps/admin-web/netlify.toml"),false);
});
