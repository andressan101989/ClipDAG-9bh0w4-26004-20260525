import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";

const migrationPath=new URL("../supabase/migrations/20260911231907_superuser_a8_finance_audit_system_health.sql",import.meta.url);
const correctivePath=new URL("../supabase/migrations/20260911232103_superuser_a8_finance_audit_system_health_f1_reference_type.sql",import.meta.url);
const appPath=new URL("../apps/admin-web/src/App.tsx",import.meta.url);
const shellPath=new URL("../apps/admin-web/src/layout/AdminShell.tsx",import.meta.url);
const apiPath=new URL("../apps/admin-web/src/lib/adminObservabilityApi.ts",import.meta.url);
const pagePath=new URL("../apps/admin-web/src/pages/AdminFinanceAuditSystemPages.tsx",import.meta.url);
const [sql,app,shell,api,pages]=await Promise.all([migrationPath,appPath,shellPath,apiPath,pagePath].map((path)=>readFile(path,"utf8")));
const corrective=await readFile(correctivePath,"utf8");

const publicFunctions=[
  "get_admin_finance_overview","search_admin_ledger_accounts","search_admin_financial_transactions",
  "get_admin_financial_transaction_detail","get_admin_finance_reconciliation","search_admin_finance_anomalies",
  "search_admin_global_audit","search_admin_finance_audit","search_admin_system_audit",
  "get_admin_system_health","search_admin_system_jobs","get_admin_system_job_detail"
];

test("A8 creates only read projections and no persistent table",()=>{
  assert.doesNotMatch(sql,/\bcreate\s+table\b/i);
  assert.doesNotMatch(sql,/\balter\s+table\b/i);
  assert.doesNotMatch(sql,/\bcreate\s+(?:or\s+replace\s+)?function\s+public\.(?:run|retry|fix|repair|adjust|credit|debit|refund|reverse|settle|reconcile)_admin/i);
  for(const name of publicFunctions)assert.match(sql,new RegExp(`create or replace function public\\.${name}\\b`));
});

test("all A8 public functions are SECURITY DEFINER with fixed search paths",()=>{
  for(const name of publicFunctions){
    const start=sql.indexOf(`create or replace function public.${name}`),end=sql.indexOf("$$;",start);
    const definition=sql.slice(start,end);
    assert.match(definition,/security definer/i,name);
    assert.match(definition,/set search_path\s*=\s*''/i,name);
  }
});

test("A8 uses exact existing capabilities",()=>{
  for(const capability of ["finance.ledger.read","finance.audit.read","finance.reconciliation.read","finance.anomalies.read","admin.audit.read","system.audit.read","system.health.read","system.jobs.read"])
    assert.match(sql,new RegExp(capability.replaceAll(".","\\.")));
  assert.doesNotMatch(sql,/insert\s+into\s+private\.admin_(?:roles|capabilities|role_capabilities|role_grant_rules)/i);
});

test("financial detail requires ledger and audit capabilities",()=>{
  const start=sql.indexOf("create or replace function public.get_admin_financial_transaction_detail"),end=sql.indexOf("$$;",start),definition=sql.slice(start,end);
  assert.match(definition,/admin_require_capability\('finance\.ledger\.read'\)/);
  assert.match(definition,/admin_require_capability\('finance\.audit\.read'\)/);
  assert.doesNotMatch(definition,/metadata/);
  assert.doesNotMatch(definition,/wallet_address|raw_receipt|from_address|to_address/);
});

test("reconciliation is observation-only and never executes a reconciler",()=>{
  const start=sql.indexOf("create or replace function public.get_admin_finance_reconciliation"),end=sql.indexOf("$$;",start),definition=sql.slice(start,end);
  assert.doesNotMatch(definition,/(?:perform|select)\s+(?:public\.|private\.)?reconcile_/i);
  assert.match(definition,/cron\.job_run_details/);
});

test("anomalies are dynamic and tied to five documented contracts",()=>{
  for(const rule of ["LEGACY_PARALLEL_WALLET_ROWS","NEGATIVE_CANONICAL_LEDGER_BALANCE","MARKETPLACE_SETTLEMENT_RUN_FAILURE","CANONICAL_MARKETPLACE_DOUBLE_ENTRY_MISMATCH","MISSING_CANONICAL_REFERENCE"])
    assert.match(sql,new RegExp(rule));
  assert.match(sql,/double_entry_allowlist/);
  assert.doesNotMatch(sql,/operation_type\s+not\s+in/i);
});

test("forward-only correction compares canonical textual references without rewriting history",()=>{
  assert.match(corrective,/t\.reference_id=r\.id::text/);
  assert.doesNotMatch(corrective,/\b(?:insert\s+into|update|delete\s+from|alter\s+table|create\s+table)\b/i);
});

test("one-entry deposits and zero-entry gift/transfer/withdrawal are outside double-entry anomaly allowlist",()=>{
  const start=sql.indexOf("with double_entry_allowlist"),end=sql.indexOf("),\n    anomalies as",start),allowlist=sql.slice(start,end);
  for(const operation of ["deposit","live_gift","transfer","withdrawal"])assert.doesNotMatch(allowlist,new RegExp(`'${operation}'`));
});

test("global audit intersects domain capabilities and finance audit",()=>{
  for(const pair of [["users","users.accounts.read"],["content","content.items.read"],["stories","stories.items.read"],["chat","chat.abuse_reports.read"],["live","live.sessions.read"],["battles","battles.sessions.read"],["media","media.assets.read"],["marketplace","marketplace.audit.read"],["system","system.audit.read"],["admin","admin.roles.read"]]){
    assert.match(sql,new RegExp(`when '${pair[0]}' then public\\.admin_actor_has_capability\\('${pair[1].replaceAll(".","\\.")}'\\)`));
  }
  assert.match(sql,/p_financial_effect[\s\S]*finance\.audit\.read/);
});

test("audit projection never returns internal idempotency material or raw metadata",()=>{
  for(const name of ["search_admin_global_audit","search_admin_finance_audit","search_admin_system_audit"]){
    const start=sql.indexOf(`create or replace function public.${name}`),end=sql.indexOf("$$;",start),definition=sql.slice(start,end);
    assert.doesNotMatch(definition,/request_fingerprint|idempotency_scope|idempotency_key|raw_metadata/);
    assert.match(definition,/admin_audit_safe_metadata/);
  }
});

test("system jobs omit command and raw return messages",()=>{
  for(const name of ["search_admin_system_jobs","get_admin_system_job_detail"]){
    const start=sql.indexOf(`create or replace function public.${name}`),end=sql.indexOf("$$;",start),definition=sql.slice(start,end);
    assert.doesNotMatch(definition,/j\.command|return_message/);
  }
  assert.match(sql,/error_present/);
});

test("A8 SQL contains no finance, audit, cron, or business DML",()=>{
  const withoutCatalogAssertions=sql.replace(/select[\s\S]*?end \$\$;/," ");
  assert.doesNotMatch(withoutCatalogAssertions,/\b(insert\s+into|update|delete\s+from|merge\s+into|truncate)\s+(?:public\.(?:ledger_accounts|financial_transactions|ledger_entries|marketplace_|app_wallet)|private\.admin_action_audit|cron\.)/i);
});

test("Admin Web exposes every A8 route behind its exact capability",()=>{
  for(const [route,capability] of [["/finance","finance.ledger.read"],["/finance/reconciliation","finance.reconciliation.read"],["/finance/anomalies","finance.anomalies.read"],["/finance/audit","finance.audit.read"],["/audit","admin.audit.read"],["/system","system.health.read"],["/system/jobs","system.jobs.read"],["/system/audit","system.audit.read"]]){
    assert.match(app,new RegExp(`capability="${capability.replaceAll(".","\\.")}"`));
    assert.match(app,new RegExp(`path="${route.replaceAll("/","\\/")}`));
  }
});

test("Admin Web observability API calls only A8 read RPCs",()=>{
  for(const name of publicFunctions)assert.match(api,new RegExp(`"${name}"`));
  assert.doesNotMatch(api,/insert\(|update\(|delete\(|reconcile_|refund|settle|reverse/i);
});

test("A8 UI contains no mutating financial or cron controls",()=>{
  assert.doesNotMatch(pages,/onClick=|<button|updateUserById|schedule_|reconcile_/i);
  assert.match(pages,/READ ONLY|OBSERVATION ONLY/);
});

test("FINANCE and SYSTEM navigation remain capability-driven",()=>{
  assert.match(shell,/group:"FINANZAS"/);
  assert.match(shell,/group:"SISTEMA"/);
  assert.doesNotMatch(shell,/FINANCE_AUDITOR|PLATFORM_ADMIN|SUPER_ADMIN/);
});
