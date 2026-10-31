import assert from "node:assert/strict";
import {readdirSync,readFileSync} from "node:fs";
import test from "node:test";
const dir=new URL("../supabase/migrations/",import.meta.url);
const name=readdirSync(dir).find((file)=>file.endsWith("_superuser_control_center_mfa_aal2.sql"));
const sql=name?readFileSync(new URL(name,dir),"utf8"):"";
test("versioned AAL policy extends the existing catalog and protects future sensitive writes",()=>{
  assert.ok(name,"forward-only MFA migration exists");
  assert.match(sql,/alter table private\.admin_capabilities[\s\S]*required_aal text not null default 'aal1'/i);
  assert.match(sql,/required_aal in\('aal1','aal2'\)/);
  assert.match(sql,/update private\.admin_capabilities set required_aal='aal2'\s+where is_sensitive and effect in\('write','workflow'\)/);
  assert.match(sql,/check\(not \(is_sensitive and effect in\('write','workflow'\)\) or required_aal='aal2'\)/);
  assert.doesNotMatch(sql,/creator_premium\.refunds\.write|create table|update public\./i);
});
test("both canonical guards reject inactive actors and enforce AAL coherently without changing read access",()=>{
  for(const name of ["admin_actor_has_capability","admin_require_capability"]){
    const body=sql.match(new RegExp(`create or replace function public\\.${name}\\(p_capability text\\)[\\s\\S]*?\\$\\$;`))?.[0]??"";
    assert.match(body,/security definer/);assert.match(body,/set search_path to 'pg_catalog','private','public'/);
    assert.match(body,/auth\.users/);assert.match(body,/deleted_at is null/);assert.match(body,/banned_until/);
    assert.match(body,/admin_role_set_is_valid/);assert.match(body,/admin_effective_capabilities/);
    assert.match(body,/required_aal/);assert.match(body,/auth\.jwt\(\)->>'aal'/);
    assert.match(sql,new RegExp(`revoke all on function public\\.${name}\\(text\\) from public,anon,authenticated,service_role`));
    assert.match(sql,new RegExp(`grant execute on function public\\.${name}\\(text\\) to authenticated`));
  }
  assert.match(sql,/errcode='42501',message='admin_aal2_required'/);
});
test("canonical bootstrap validates active accounts without imposing AAL2 and preserves its privilege boundary",()=>{
  const body=sql.match(/create or replace function public\.get_my_admin_access\(\)[\s\S]*?\$\$;/)?.[0]??"";
  assert.match(body,/security definer/);assert.match(body,/set search_path to 'pg_catalog','private','public'/);
  assert.match(body,/auth\.users/);assert.match(body,/deleted_at is null/);assert.match(body,/banned_until/);assert.match(body,/admin_actor_inactive/);
  assert.match(body,/admin_role_set_is_valid/);assert.match(body,/admin_effective_capabilities/);assert.doesNotMatch(body,/admin_aal2_required/);
  assert.match(sql,/revoke all on function public\.get_my_admin_access\(\) from public,anon,authenticated,service_role/);
  assert.match(sql,/grant execute on function public\.get_my_admin_access\(\) to authenticated/);
});
test("moderation prepare denies SQL 42501 before reconciliation can mutate Auth",()=>{
  const edge=readFileSync(new URL("../supabase/functions/admin-user-moderation/index.ts",import.meta.url),"utf8");
  const denial=edge.indexOf("if(prepareError)");const run=edge.indexOf("await runPreparedModeration(prepared",denial);
  assert.ok(denial>0&&run>denial);const branch=edge.slice(denial,run);
  assert.match(branch,/prepareError.code==='42501'/);assert.match(branch,/forbidden\?'forbidden'/);assert.match(branch,/forbidden\?403/);
});
