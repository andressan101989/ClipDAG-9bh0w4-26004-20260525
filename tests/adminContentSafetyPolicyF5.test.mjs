import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {execFileSync} from "node:child_process";

const root=process.cwd();
const migration=readFileSync(join(root,"supabase","migrations","20260914163245_admin_content_safety_policy_text_rules_v1.sql"),"utf8");
const api=readFileSync(join(root,"apps","admin-web","src","lib","adminSafetyApi.ts"),"utf8");
const page=readFileSync(join(root,"apps","admin-web","src","pages","AdminContentSafetyPages.tsx"),"utf8");
const workerRules=migration.slice(migration.indexOf("create or replace function public.get_content_safety_worker_rules"),migration.indexOf("create or replace function public.search_admin_content_safety_rules"));
const preview=migration.slice(migration.indexOf("create function public.preview_admin_content_safety_rule"),migration.indexOf("revoke all on function private.guard_content_safety_rule_governance"));
const f4=readFileSync(join(root,"supabase","migrations","20260914144028_admin_content_safety_alert_pipeline_v1.sql"),"utf8");

test("policy audit hashes remain traceable and no detector terms are seeded",()=>{
  // C6-C1 deliberately retired the independent mobile copies. Preserve the
  // prior audit snapshot in Git while pinning the compatibility routes now shipped.
  const retiredAt="d13eeec6e1705565cbab9d99cf1d6441c900b336";
  // Blob hashes differ from the former Windows worktree hashes due to CRLF checkout.
  const retiredDocuments={
    "app/legal.tsx":"856316e62df622781ae1d6557406d873bcaa870a507e33ea4bca96938fca9d1b",
    "app/terms-of-service.tsx":"27d816cd1cf97bc9c5b38272bb37bcdcf7e8764a8a3d77fe26c40e35f517ab36",
    "app/privacy-policy.tsx":"c3e4145d6e0b4125d17c9f2c29dbf03e1859136fdad7d1e03111d0e836e2f349",
  };
  for(const [path,expected] of Object.entries(retiredDocuments)){
    const old=execFileSync("git",["show",`${retiredAt}:${path}`]);
    assert.equal(createHash("sha256").update(old).digest("hex"),expected,`retired ${path}`);
  }
  const documents={
    "app/legal.tsx":"22d4137047cbafd7667408f5831e589ac5c00a9982508fb1406aff9a2215ff35",
    "app/terms-of-service.tsx":"ad311f51e80d6eb4fe1b1fc53b588d42becabd642bed00033ee48379fc8b75b2",
    "app/privacy-policy.tsx":"b55f6c10e7ed4a704547947210a3c13810230e0cba8d7514febb9fabe1288904",
  };
  for(const [path,expected] of Object.entries(documents)){
    const normalized=readFileSync(join(root,path),"utf8").replace(/\r\n/g,"\n");
    assert.equal(createHash("sha256").update(normalized).digest("hex"),expected,path);
  }
  assert.doesNotMatch(migration.slice(0,migration.indexOf("create function public.admin_create_content_safety_rule")),/insert\s+into\s+private\.content_safety_rules/i);
});

test("one existing rules authority gains provenance, locale and explicit governance",()=>{
  assert.match(migration,/alter table private\.content_safety_rules/);
  assert.doesNotMatch(migration,/create table (?:private\.)?(?:content_policy_rules|moderation_keyword_rules|blocked_words|safety_dictionary)/i);
  for(const field of ["policy_source","policy_reference","policy_version","locale","rationale","approval_state","approved_by","approved_at","retired_at"]){assert.match(migration,new RegExp(`(?:add column )?${field} text|(?:add column )?${field} uuid|(?:add column )?${field} timestamptz`),field)}
  assert.match(migration,/approval_state in\('draft','approved','retired'\)/);
  assert.match(migration,/enabled and approval_state='approved'/);
  assert.match(migration,/policy_source<>'owner_manual' or rationale is not null/);
});

test("worker can load only approved and enabled deterministic keyword or phrase rules",()=>{
  assert.match(workerRules,/where r\.enabled and r\.approval_state='approved'/);
  assert.match(f4,/detector_type in\('keyword','phrase'\)/);
  assert.doesNotMatch(migration,/'(?:regex|fuzzy|embedding|semantic|llm)'/i);
});

test("preview is bounded, read-only and excludes ordinary private messages",()=>{
  assert.match(preview,/admin_require_capability\('content\.items\.moderate'\)/);
  assert.match(preview,/p_limit<1 or p_limit>20/);
  assert.match(preview,/left\(private\.normalize_content_safety_text\(text_value\),240\)/);
  assert.match(preview,/reported_content_type='message'/);
  assert.match(preview,/'ordinary_private_messages_included',false/);
  assert.doesNotMatch(preview,/\b(insert|update|delete|merge)\b/i);
  assert.match(preview,/'creates_alerts',false,'creates_scans',false/);
});

test("preview and worker use the same NFKC, lowercase, whitespace and boundary contract",()=>{
  assert.match(migration,/normalize\(coalesce\(p_value,''\),NFKC\)/);
  assert.match(migration,/lower\(regexp_replace/);
  assert.match(migration,/\[\[:space:\]\]\+/);
  assert.ok(migration.includes("'^[[:alnum:]_]$'"));
  assert.match(preview,/private\.content_safety_text_matches\(c\.text_value,p_pattern,p_detector_type\)/);
});

test("human approval gates activation and activation reuses the scope-specific F4 queue",()=>{
  assert.match(migration,/content_safety_rule_not_approved/);
  assert.match(migration,/content_safety\.rule\.approve/);
  assert.match(migration,/content_safety\.rule\.'\|\|v_action/);
  assert.match(migration,/private\.content_safety_rule_rescan\(v_rule\.id,500\)/);
  assert.match(migration,/private\.enqueue_content_safety_scan\(v_target\.target_type,v_target\.target_id,'backfill'\)/);
  assert.match(migration,/'reported_message'=any\(v_rule\.scopes\).*exists\(/s);
  assert.doesNotMatch(migration,/create table .*rescan/i);
});

test("rule provenance is snapshotted into versioned alert evidence",()=>{
  assert.match(migration,/new\.alert_fingerprint:=private\.content_safety_sha256[\s\S]*?'\|v'\|\|v_rule\.version/);
  for(const field of ["rule_code","rule_version","policy_source","policy_reference","policy_version","locale"]){assert.match(migration,new RegExp(`'${field}'`),field)}
});

test("admin exposes draft, preview, approve, enable, disable and retire without raw JSON",()=>{
  for(const rpc of ["preview_admin_content_safety_rule","admin_approve_content_safety_rule","admin_set_content_safety_rule_enabled","admin_retire_content_safety_rule"]){assert.match(api,new RegExp(rpc),rpc)}
  for(const copy of ["Guardar borrador","Probar regla","Aprobar regla","Activar","Desactivar","Retirar","Una coincidencia no significa una infracción"]){assert.ok(page.includes(copy),copy)}
  assert.doesNotMatch(page,/JSON\.stringify|<pre/);
});

test("rule governance has no automatic enforcement or financial authority",()=>{
  for(const forbidden of ["admin_issue_user_warning","admin_prepare_user_moderation_action","admin_finalize_user_moderation_action","admin_moderate_content","auth.admin","ledger_entries","ledger_accounts","wallet","escrow"]){assert.doesNotMatch(migration,new RegExp(forbidden,"i"),forbidden)}
});
