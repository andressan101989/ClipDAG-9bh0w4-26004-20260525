import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import {join} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const migrationsDir=new URL("../supabase/migrations/",import.meta.url);

async function migrations(){
  const names=(await readdir(migrationsDir)).filter(name=>name.includes("_superuser_qa_perf_c1")).sort();
  assert.equal(names.length,1,"C1 must keep the online index and atomic function update in one retry-safe migration history unit");
  return Promise.all(names.map(async name=>({name,sql:await readFile(join(fileURLToPath(migrationsDir),name),"utf8")})));
}

test("C1 builds the cron index online with a recovery-safe nontransactional migration",async()=>{
  const [{sql}]=await migrations();
  assert.match(sql,/^--\s*pg-delta:\s*transaction=false/im);
  assert.match(sql,/drop\s+index\s+concurrently\s+if\s+exists\s+cron\.cron_job_run_details_start_job_cover_idx/i);
  assert.match(sql,/create\s+index\s+concurrently\s+cron_job_run_details_start_job_cover_idx\s+on\s+cron\.job_run_details\s*\(\s*start_time\s+desc\s+nulls\s+last\s*,\s*jobid\s*\)\s*include\s*\(\s*status\s*,\s*end_time\s*\)/i);
  assert.match(sql,/indisvalid\s+and\s+i\.indisready/i);
  const concurrentIndexEnd=sql.search(/comment\s+on\s+index/i);
  const transactionStart=sql.search(/\bbegin\s*;/i);
  assert.ok(transactionStart>concurrentIndexEnd,"the function transaction must begin only after the concurrent index DDL");
  assert.match(sql,/\bcommit\s*;/i);
});
test("C1 gives cron health one stable cutoff and one bounded aggregate",async()=>{
  const [{sql}]=await migrations();
  const start=sql.search(/create\s+or\s+replace\s+function\s+public\.get_admin_system_health\s*\(\s*\)/i);
  const end=sql.indexOf("$function$;",start);
  assert.ok(start>=0&&end>start,"system-health replacement must exist");
  const body=sql.slice(start,end);
  assert.match(body,/admin_require_capability\s*\(\s*'system\.health\.read'\s*\)/i);
  assert.match(body,/v_cutoff\s+timestamptz\s*:=\s*statement_timestamp\(\)\s*-\s*interval\s*'24 hours'/i);
  assert.equal((body.match(/from\s+cron\.job_run_details\s+where\s+start_time\s*>=\s*v_cutoff/gi)??[]).length,1,"recent cron history must be aggregated once");
  assert.doesNotMatch(body,/clock_timestamp\s*\(/i);
  assert.match(body,/order\s+by\s+start_time\s+desc\s+nulls\s+last\s*,\s*runid\s+desc\s+limit\s+1/i);
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

test("the disposable proof exercises a writer while the concurrent index is building",async()=>{
  const proof=await readFile(new URL("../scripts/prove-superuser-qa-perf-c1-disposable.mjs",import.meta.url),"utf8");
  assert.match(proof,/begin\s+isolation\s+level\s+repeatable\s+read/i);
  assert.match(proof,/pg_stat_progress_create_index/i);
  assert.match(proof,/statement_timeout='2s'/i);
  assert.match(proof,/writerDuringConcurrentBuild:true/);
  assert.match(proof,/supabase@2\.120\.0/);
  assert.match(proof,/"db","push"/);
  assert.match(proof,/canonicalMarketplaceReconciliations/);
  assert.match(proof,/marketplaceReconcilerCount:15/);
  assert.match(proof,/marketplaceDefinitionChanged:true/);
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
