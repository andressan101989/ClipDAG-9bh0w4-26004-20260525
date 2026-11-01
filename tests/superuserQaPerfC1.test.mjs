import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import {join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const migrationsDir=new URL("../supabase/migrations/",import.meta.url);

async function migrations(){
  const names=(await readdir(migrationsDir)).filter(name=>name.includes("_superuser_qa_perf_c1")).sort();
  assert.equal(names.length,1,"C1 must keep the bounded health projection and atomic function update in one migration history unit");
  return Promise.all(names.map(async name=>({name,sql:await readFile(join(fileURLToPath(migrationsDir),name),"utf8")})));
}

test("C1 never mutates the Supabase-owned pg_cron relation",async()=>{
  const [{sql}]=await migrations();
  assert.doesNotMatch(sql,/^--\s*pg-delta:\s*transaction=false/im);
  assert.doesNotMatch(sql,/(?:create|drop|alter)\s+(?:index|table)[\s\S]{0,120}cron\.(?:job_run_details|job)/i);
  assert.doesNotMatch(sql,/\b(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?|comment\s+on|grant\b[\s\S]{0,80}\bon|revoke\b[\s\S]{0,80}\bon)\s+cron\.(?:job_run_details|job)\b/i);
  assert.match(sql,/pg_get_userbyid\s*\(\s*c\.relowner\s*\)\s*=\s*'supabase_admin'/i);
  assert.match(sql,/pg_get_userbyid\s*\(\s*n\.nspowner\s*\)\s*=\s*'supabase_admin'/i);
  assert.match(sql,/index_class\.relname\s*=\s*'job_run_details_pkey'/i);
  assert.match(sql,/i\.indisprimary\s+and\s+i\.indisunique\s+and\s+i\.indisvalid\s+and\s+i\.indisready/i);
  assert.match(sql,/i\.indnkeyatts\s*=\s*1\s+and\s+i\.indnatts\s*=\s*1/i);
  assert.match(sql,/pg_get_indexdef\s*\(\s*i\.indexrelid\s*,\s*1\s*,\s*true\s*\)\s*=\s*'runid'/i);
  assert.match(sql,/to_regclass\s*\(\s*'cron\.cron_job_run_details_start_job_cover_idx'\s*\)\s+is\s+not\s+null/i);
  assert.match(sql,/\bbegin\s*;/i);
  assert.match(sql,/\bcommit\s*;/i);
});
test("C1 gives cron health one bounded PK probe and fails closed when it cannot cover 24 hours",async()=>{
  const [{sql}]=await migrations();
  const start=sql.search(/create\s+or\s+replace\s+function\s+public\.get_admin_system_health\s*\(\s*\)/i);
  const end=sql.indexOf("$function$;",start);
  assert.ok(start>=0&&end>start,"system-health replacement must exist");
  const body=sql.slice(start,end);
  assert.match(body,/admin_require_capability\s*\(\s*'system\.health\.read'\s*\)/i);
  assert.match(body,/v_cutoff\s+timestamptz\s*:=\s*statement_timestamp\(\)\s*-\s*interval\s*'24 hours'/i);
  assert.match(body,/from\s+cron\.job_run_details\s+order\s+by\s+runid\s+desc\s+limit\s+v_probe_limit/i);
  assert.match(body,/v_probe_limit\s+constant\s+integer\s*:=\s*50000/i);
  assert.match(body,/v_history_window_complete\s*:=\s*v_sampled_rows\s*<\s*v_probe_limit\s*;/i);
  assert.doesNotMatch(body,/v_oldest_sampled_start\s*<=\s*v_cutoff/i);
  assert.match(body,/'run_metrics_available'\s*,\s*v_history_window_complete/i);
  assert.match(body,/'run_metrics_reason'\s*,\s*case\s+when\s+v_history_window_complete\s+then\s+null\s+else\s+'history_probe_limit_reached'/i);
  assert.match(body,/if\s+not\s+v_history_window_complete\s+then[\s\S]*v_runs_24h\s*:=\s*null/i);
  assert.doesNotMatch(body,/from\s+cron\.job_run_details\s+where\s+start_time\s*>=\s*v_cutoff/i);
  assert.doesNotMatch(body,/clock_timestamp\s*\(/i);
  assert.equal((body.match(/from\s+cron\.job_run_details/gi)??[]).length,1,"cron history must be read exactly once");
});

test("C1 contains Marketplace planner limits inside the read-only health RPC",async()=>{
  const [{sql}]=await migrations();
  assert.match(sql,/alter\s+function\s+public\.get_marketplace_admin_health\s*\(\s*\)\s+set\s+join_collapse_limit\s*=\s*1/i);
  assert.match(sql,/alter\s+function\s+public\.get_marketplace_admin_health\s*\(\s*\)\s+set\s+from_collapse_limit\s*=\s*1/i);
  assert.doesNotMatch(sql,/alter\s+(?:role|database|system)\b[\s\S]*collapse_limit/i);
  assert.doesNotMatch(sql,/statement_timeout/i);
  assert.doesNotMatch(sql,/\b(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.(?:ledger_accounts|ledger_entries|financial_transactions)\b/i);
});

test("C1 preserves authenticated-only RPC access and fixed security boundaries",async()=>{
  const [{sql}]=await migrations();
  assert.match(sql,/security\s+definer/i);
  assert.match(sql,/set\s+search_path\s*=\s*''/i);
  assert.match(sql,/revoke\s+all\s+on\s+function\s+public\.get_admin_system_health\s*\(\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
  assert.match(sql,/grant\s+execute\s+on\s+function\s+public\.get_admin_system_health\s*\(\s*\)\s+to\s+authenticated/i);
});

test("the disposable proof verifies bounded truth without mutating the extension-owned cron relation",async()=>{
  const proof=await readFile(new URL("../scripts/prove-superuser-qa-perf-c1-disposable.mjs",import.meta.url),"utf8");
  assert.match(proof,/alter\s+schema\s+cron\s+owner\s+to\s+supabase_admin/i);
  assert.match(proof,/alter\s+table\s+cron\.job_run_details\s+owner\s+to\s+supabase_admin/i);
  assert.match(proof,/historyWindowComplete\s*=\s*true/);
  assert.match(proof,/historyProbeSaturated\s*=\s*true/);
  assert.match(proof,/historyUnavailableReturnsNull\s*=\s*true/);
  assert.match(proof,/cronRelationUnmodified\s*=\s*true/);
  assert.match(proof,/job_run_details_pkey/);
  assert.match(proof,/statement_timeout='8s'/);
  assert.match(proof,/marketplaceAfterExecutionMs<8000/);
  assert.match(proof,/supabase@2\.120\.0/);
  assert.match(proof,/"db","push"/);
  assert.match(proof,/canonicalMarketplaceReconciliations/);
  assert.match(proof,/marketplaceReconcilerCount:15/);
  assert.match(proof,/marketplaceDefinitionChanged:true/);
});

test("the managed-cron recovery evidence pins the failed release and zero productive mutation",async()=>{
  const evidence=JSON.parse(await readFile(new URL("../docs/validation/superuser-qa-perf-c1-managed-cron-recovery-evidence.json",import.meta.url),"utf8"));
  assert.deepEqual(evidence,{
    schema_version:1,
    phase:"SUPERUSER_QA_PERF_C1_RELEASE_RECOVERY",
    project_ref:"aewwdlvbwpczqyvkwvvj",
    timeout_incident:{
      sqlstate:"57014",statement_timeout_ms:8000,logical_events:8,
      service_copies:{postgresql:8,postgrest:8},
      rpc_events:{"public.get_admin_system_health()":7,"public.get_marketplace_admin_health()":1},
    },
    managed_cron_catalog:{
      schema:"cron",table:"job_run_details",schema_owner:"supabase_admin",
      table_owner:"supabase_admin",extension:"pg_cron",estimated_live_rows:1076581,
      estimated_dead_rows:234031,total_size_mb:446,
      primary_index:{
        name:"job_run_details_pkey",key_columns:["runid"],included_columns:[],
        primary:true,unique:true,valid:true,ready:true,predicate:null,expressions:null,
      },
      c1_release_index_present:false,
    },
    bounded_probe:{
      order:"runid DESC",limit:50000,production_execution_ms:3388,
      approximate_24h_rows:38900,observed_start_time_inversions:8840,
      maximum_observed_inversion_seconds:1.164529,
      exactness_contract:"only_when_probe_unsaturated",
    },
    failed_release:{
      run_id:41346031770,status:"failure",sqlstate:"42501",
      failed_operation:"CREATE INDEX CONCURRENTLY cron_job_run_details_start_job_cover_idx",
      reason:"must be owner of table job_run_details",
      migration_recorded:false,c1_index_present:false,
      system_rpc_successor_present:false,marketplace_rpc_successor_present:false,
      admin_bundle_promoted:false,
    },
    safety:{
      read_only_diagnosis:true,persistent_c1_mutations:0,financial_operations:0,
      ledger_mutations:0,finance_general_preserved:true,
    },
  });
});

test("the disposable proof measures nested planning work for all Marketplace reconciliators",async()=>{
  const proof=await readFile(new URL("../scripts/prove-superuser-qa-perf-c1-disposable.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(proof,/returns jsonb language sql stable as \$\$select jsonb_build_object\('fixture_/i,"constant JSON reconciliator stubs cannot exercise collapse limits");
  assert.match(proof,/pg_stat_statements\.track_planning=on/);
  assert.match(proof,/track_functions=all/);
  assert.match(proof,/marketplaceCanonicalSourceShapes/);
  assert.match(proof,/marketplacePlanningPlanCount/);
  assert.match(proof,/marketplaceCanonicalFunctionCalls/);
  assert.match(proof,/marketplacePlanningRatio/);
  assert.match(proof,/marketplaceBeforePlanning\.planCount\s*,\s*expectedMarketplacePlans/);
  assert.match(proof,/marketplaceAfterPlanning\.planCount\s*,\s*expectedMarketplacePlans/);
  assert.match(proof,/marketplacePlanningRatio>=2/);
  assert.match(proof,/marketplacePlanningImprovement\s*=\s*true/);
  assert.match(proof,/catch\(error\)\{proofError=error\}/);
  assert.match(proof,/cleanupErrors/);
  assert.match(proof,/new AggregateError/);
});

test("the immutable production read-only evidence pins the exact Marketplace A/B observation",async()=>{
  const evidence=JSON.parse(await readFile(new URL("../docs/validation/superuser-qa-perf-c1-production-read-only-evidence.json",import.meta.url),"utf8"));
  assert.deepEqual(evidence,{
    schema_version:1,
    phase:"SUPERUSER_QA_PERF_C1",
    project_ref:"aewwdlvbwpczqyvkwvvj",
    observed_window_utc:{from:"2026-11-01T19:47:38.628785Z",to:"2026-11-01T19:48:20.028477Z"},
    database:{engine:"PostgreSQL",version:"17.6"},
    method:{transaction:"BEGIN READ ONLY / ROLLBACK",statement_timeout_scope:"transaction_local_30s_for_explain_only",mutations:0,explain:"ANALYZE, BUFFERS, SETTINGS, FORMAT JSON"},
    single_reconciler_ab:{
      identity:"public.reconcile_marketplace_settlements()",
      sql_shape:"select public.reconcile_marketplace_settlements()",
      default_samples:[
        {execution_ms:4643.597,shared_hit_blocks:6315,shared_read_blocks:0},
        {execution_ms:7995.563,shared_hit_blocks:6315,shared_read_blocks:0},
      ],
      bounded_samples:[
        {join_collapse_limit:1,from_collapse_limit:1,execution_ms:149.091,shared_hit_blocks:6135,shared_read_blocks:0},
        {join_collapse_limit:1,from_collapse_limit:1,execution_ms:177.672,shared_hit_blocks:6135,shared_read_blocks:0},
      ],
      conservative_speedup:26.1357,
      persistent_mutation:false,
    },
    all_reconcilers_bounded:{
      join_collapse_limit:1,
      from_collapse_limit:1,
      execution_ms:626.599,
      shared_hit_blocks:18953,
      shared_read_blocks:0,
      identities:[
        "public.reconcile_marketplace_payments()",
        "public.reconcile_marketplace_settlements()",
        "public.reconcile_marketplace_creator_commerce()",
        "public.reconcile_marketplace_creator_showcase()",
        "public.reconcile_marketplace_creator_content_tags()",
        "public.reconcile_marketplace_multi_creator_allocations()",
        "public.reconcile_marketplace_live_commissions()",
        "public.reconcile_marketplace_creator_commerce_analytics()",
        "public.reconcile_marketplace_settlement_reversals()",
        "public.reconcile_marketplace_ad_finance()",
        "public.reconcile_marketplace_ad_eligibility_clock()",
        "public.reconcile_marketplace_ad_finalization()",
        "public.reconcile_marketplace_ad_delivery()",
        "public.reconcile_marketplace_ad_events()",
        "public.reconcile_marketplace_admin_operations()",
      ],
    },
    safety:{read_only:true,financial_operations:0,ledger_mutations:0,persistent_settings_changed:false},
  });
});
