import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";

const root=process.cwd();
const migration=readFileSync(join(root,"supabase","migrations","20260914144028_admin_content_safety_alert_pipeline_v1.sql"),"utf8");
const hardening=readFileSync(join(root,"supabase","migrations","20260914150906_admin_content_safety_runtime_hardening.sql"),"utf8");
const worker=readFileSync(join(root,"supabase","functions","content-safety-scan","index.ts"),"utf8");
const page=readFileSync(join(root,"apps","admin-web","src","pages","AdminContentSafetyPages.tsx"),"utf8");
const navigation=readFileSync(join(root,"apps","admin-web","src","layout","adminNavigation.ts"),"utf8");
const app=readFileSync(join(root,"apps","admin-web","src","App.tsx"),"utf8");

test("F4 creates exactly the three private authorities and no policy seed",()=>{
  assert.deepEqual([...migration.matchAll(/create table private\.(content_safety_[a-z_]+)/g)].map(match=>match[1]),["content_safety_rules","content_safety_scans","content_safety_alerts"]);
  const schemaBootstrap=migration.slice(0,migration.indexOf("create function public.admin_create_content_safety_rule"));
  assert.doesNotMatch(schemaBootstrap,/insert into private\.content_safety_rules/i);
  assert.match(migration,/alter table private\.content_safety_rules enable row level security/);
  assert.match(migration,/revoke all privileges on table private\.content_safety_alerts from public,anon,authenticated,service_role/);
});

test("ingestion covers public content and reports but never bulk private messages",()=>{
  assert.match(migration,/videos_enqueue_content_safety/);
  assert.match(migration,/comments_enqueue_content_safety/);
  assert.match(migration,/stories_enqueue_content_safety/);
  assert.match(migration,/live_messages_enqueue_content_safety/);
  assert.match(migration,/reports_enqueue_content_safety/);
  assert.doesNotMatch(migration,/create trigger messages_enqueue_content_safety/i);
  assert.match(migration,/reported_content_type='message'/);
  assert.match(migration,/'private_messages',0,'private_message_policy','reported_only'/);
});

test("shared Stories reuse a canonical source-video scan",()=>{
  assert.match(migration,/media_source_scan_id uuid null references private\.content_safety_scans/);
  assert.match(migration,/enqueue_content_safety_scan\('video',\(v_snapshot->>'shared_video_id'\)::uuid,'shared_source'\)/);
  assert.match(page,/reutiliza el scan del video canónico/);
});

test("priority implements the exact deterministic boosts and clamp",()=>{
  for(const fragment of ["when 'critical' then 90","when 'high' then 70","when 'medium' then 45","else 20","*2,10",">=10 then 10",">=3 then 6","when 1 then 3","when 2 then 6","when 3 then 9",">=100000 then 8",">=10000 then 5",">=1000 then 3","least(100,greatest(0"]){assert.ok(migration.includes(fragment),fragment)}
});

test("worker remains authenticated internally and preserves safe text claims after the F6 extension",()=>{
  assert.match(migration,/for update skip locked limit p_limit/);
  assert.match(migration,/attempt_count<5/);
  assert.match(worker,/x-content-safety-secret/);
  assert.match(worker,/CALL_DISPATCH_SECRET/);
  assert.match(worker,/external_providers: audioClaimed/);
  assert.match(worker,/claim_content_safety_scans/);
  assert.match(worker,/complete_content_safety_scan/);
});

test("automatic pipeline has no enforcement or financial authority",()=>{
  const automatic=migration.slice(migration.indexOf("create function public.get_content_safety_worker_rules"),migration.indexOf("create function public.search_admin_content_safety_alerts"))+hardening+worker;
  for(const forbidden of ["admin_issue_user_warning","admin_prepare_user_moderation_action","admin_finalize_user_moderation_action","admin_moderate_content","admin_moderate_story","auth.admin","delete media","delete content","ledger","wallet"]){assert.doesNotMatch(automatic,new RegExp(forbidden,"i"),forbidden)}
});

test("runtime hardening handles empty text and refreshes report signals across clean retry cycles",()=>{
  assert.match(hardening,/'text_value',coalesce\(v\.caption,''\)/);
  assert.match(hardening,/attempt_count=case when private\.content_safety_scans\.status='processing' then private\.content_safety_scans\.attempt_count else 0 end/);
  assert.match(hardening,/started_at=case when private\.content_safety_scans\.status='processing' then private\.content_safety_scans\.started_at else null end/);
  assert.match(hardening,/if v_total_reports>0 then/);
  assert.match(hardening,/'pending_report_count',v_pending_reports/);
});

test("admin uses capabilities and canonical deep links without raw JSON",()=>{
  assert.match(migration,/admin_require_capability\('content\.items\.read'\)/);
  assert.match(migration,/admin_require_capability\('content\.items\.moderate'\)/);
  assert.match(navigation,/content-safety.*content\.items\.read/);
  assert.match(app,/CapabilityRoute capability="content\.items\.moderate"/);
  assert.match(page,/Abrir contenido canónico/);
  assert.match(page,/Abrir usuario \/ disciplina F2/);
  assert.match(page,/Abrir Reports/);
  assert.doesNotMatch(page,/JSON\.stringify|<pre/);
});

test("coverage is honest when audio and visual providers are unavailable",()=>{
  assert.match(migration,/v_audio:=case[\s\S]*then 'not_configured'/);
  assert.match(migration,/v_visual:=case[\s\S]*then 'not_configured'/);
  assert.match(page,/El análisis automático no cubrió audio\/visual/);
  assert.doesNotMatch(page,/completamente analizado|contenido limpio|fully analyzed/i);
});
