// Disposable PostgreSQL proof only. NELYON_E2E_B2_LOCAL=1 enables it.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const enabled = process.env.NELYON_E2E_B2_LOCAL === "1";
const container = "nelyon-ads-v2-d-compile";
const database = `e2eb2_${process.pid}`;
const owner = "10000000-0000-4000-8000-000000000001";
const intruder = "10000000-0000-4000-8000-000000000002";
const business = "20000000-0000-4000-8000-000000000001";
const account = "30000000-0000-4000-8000-000000000001";
const campaign = "40000000-0000-4000-8000-000000000001";
const adSet = "50000000-0000-4000-8000-000000000001";
const concurrentAdSet = "50000000-0000-4000-8000-000000000002";
const destination = "60000000-0000-4000-8000-000000000001";

const args = (db, ...extra) => ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db, ...extra];
const run = (sql, db = database) => execFileSync("docker", args(db, "-At"), { input: sql, encoding: "utf8" }).trim();
const runAsync = (sql, db = database) => new Promise((resolve, reject) => {
  const child = execFile("docker", args(db, "-At"), { encoding: "utf8" }, (error, stdout, stderr) => {
    if (error) reject(Object.assign(error, { stderr }));
    else resolve(stdout.trim());
  });
  child.stdin.end(sql);
});
const asActor = (sql, actor = owner) => run(`begin;set local request.jwt.claim.sub='${actor}';${sql};commit;`);
const migration = readFileSync(new URL("../supabase/migrations/20260925020820_ads_v2_e2e_b2_draft_editability.sql", import.meta.url), "utf8");

const bootstrap = `
create schema auth;create schema private;create extension pgcrypto;
do $$begin if not exists(select 1 from pg_roles where rolname='anon')then create role anon nologin;end if;if not exists(select 1 from pg_roles where rolname='authenticated')then create role authenticated nologin;end if;if not exists(select 1 from pg_roles where rolname='service_role')then create role service_role nologin;end if;end$$;
create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table private.business_accounts(id uuid primary key,owner_user_id uuid not null,status text not null);
create table private.ad_accounts(id uuid primary key,business_account_id uuid not null,status text not null);
create table private.advertising_campaigns(id uuid primary key,ad_account_id uuid not null,name text not null,objective text not null,status text not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),archived_at timestamptz);
create table private.advertising_campaign_lifecycle_policy(singleton boolean primary key,activation_enabled boolean not null,automatic_transitions_enabled boolean not null);
insert into private.advertising_campaign_lifecycle_policy values(true,false,false);
create table private.advertising_campaign_finance(campaign_id uuid primary key,finance_status text not null,funded_bdag numeric not null,spent_bdag numeric not null,released_bdag numeric not null);
create table private.advertising_ad_sets(id uuid primary key,campaign_id uuid not null,name text not null,status text not null,starts_at timestamptz,ends_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table private.advertising_audiences(id uuid primary key,ad_set_id uuid not null,status text not null);
create table private.advertising_audience_versions(id uuid primary key,audience_id uuid not null,version_number integer not null);
create table private.advertising_placement_selections(id uuid primary key,ad_set_id uuid not null,status text not null);
create table private.advertising_placement_selection_versions(id uuid primary key,placement_selection_id uuid not null,version_number integer not null);
create table private.advertising_destinations(id uuid primary key default gen_random_uuid(),campaign_id uuid not null,destination_type text not null,external_url text,target_user_id uuid,target_business_account_id uuid,target_product_id uuid,target_store_id uuid,status text not null,creation_idempotency_key uuid not null,created_by uuid not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(campaign_id,creation_idempotency_key));
create table private.advertising_ads(id uuid primary key,destination_id uuid not null);
create table private.business_account_marketplace_links(business_account_id uuid,marketplace_seller_user_id uuid);
create table public.marketplace_sellers(user_id uuid primary key,status text not null);
create table public.marketplace_stores(id uuid primary key,seller_id uuid not null);
create table public.products(id uuid primary key,seller_id uuid not null,store_id uuid not null,deleted_at timestamptz);
create function private.advertising_touch_updated_at()returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp();return new;end$$;
create trigger ad_set_touch before update on private.advertising_ad_sets for each row execute function private.advertising_touch_updated_at();
create trigger destination_touch before update on private.advertising_destinations for each row execute function private.advertising_touch_updated_at();
create function private.ads_actor_is_advertiser_age_eligible(p_actor uuid)returns boolean language sql stable security definer set search_path='' as $$select p_actor in ('${owner}'::uuid,'${intruder}'::uuid)$$;
create function private.ads_require_owned_draft_campaign(p_actor uuid,p_campaign uuid)returns table(campaign_id uuid,ad_account_id uuid,business_account_id uuid)language plpgsql stable security definer set search_path='' as $$begin return query select c.id,c.ad_account_id,a.business_account_id from private.advertising_campaigns c join private.ad_accounts a on a.id=c.ad_account_id join private.business_accounts b on b.id=a.business_account_id where c.id=p_campaign and c.status='draft' and b.owner_user_id=p_actor and a.status='active' and b.status='active';if not found then raise exception using errcode='42501',message='advertising_campaign_access_denied';end if;end$$;
insert into private.business_accounts values('${business}','${owner}','active');
insert into private.ad_accounts values('${account}','${business}','active');
insert into private.advertising_campaigns(id,ad_account_id,name,objective,status)values('${campaign}','${account}','Draft','traffic','draft');
insert into private.advertising_ad_sets(id,campaign_id,name,status,starts_at,ends_at)values('${adSet}','${campaign}','Primary','draft',null,null);
insert into private.advertising_ad_sets(id,campaign_id,name,status,starts_at,ends_at)values('${concurrentAdSet}','${campaign}','Concurrent','draft',null,null);
insert into private.advertising_destinations(id,campaign_id,destination_type,external_url,status,creation_idempotency_key,created_by)values('${destination}','${campaign}','external_url','https://example.com','draft',gen_random_uuid(),'${owner}');
`;

test("E2E-B2 proves draft edit ownership, validation, replay and stale-write protection", { skip: !enabled, timeout: 120_000 }, async () => {
  run(`create database ${database}`, "postgres");
  try {
    run(bootstrap);
    run(migration);
    assert.equal(run("select has_function_privilege('anon','public.update_my_advertising_ad_set_draft(uuid,text,timestamptz,timestamptz,timestamptz,uuid)','EXECUTE')"), "f");
    assert.equal(run("select has_function_privilege('authenticated','public.update_my_advertising_ad_set_draft(uuid,text,timestamptz,timestamptz,timestamptz,uuid)','EXECUTE')"), "t");
    assert.equal(run("select has_function_privilege('anon','public.update_my_advertising_destination_draft(uuid,text,timestamptz,uuid,text,uuid,uuid,uuid,uuid)','EXECUTE')"), "f");

    const adSetInitial = run(`select updated_at from private.advertising_ad_sets where id='${adSet}'`);
    const adSetResult = JSON.parse(asActor(`select public.update_my_advertising_ad_set_draft('${adSet}','Updated','2030-01-01T00:00:00Z','2030-01-02T00:00:00Z','${adSetInitial}',gen_random_uuid())`));
    assert.equal(adSetResult.name, "Updated");
    assert.equal(JSON.parse(asActor(`select public.update_my_advertising_ad_set_draft('${adSet}','Updated','2030-01-01T00:00:00Z','2030-01-02T00:00:00Z','${adSetInitial}',gen_random_uuid())`)).id, adSet);
    assert.throws(() => asActor(`select public.update_my_advertising_ad_set_draft('${adSet}','Stale overwrite',null,null,'${adSetInitial}',gen_random_uuid())`), /advertising_ad_set_draft_stale/);
    assert.throws(() => asActor(`select public.update_my_advertising_ad_set_draft('${adSet}','Bad schedule','2030-01-01T00:00:00Z',null,'${adSetResult.updated_at}',gen_random_uuid())`), /advertising_ad_set_schedule_invalid/);
    assert.throws(() => asActor(`select public.update_my_advertising_ad_set_draft('${adSet}','Intruder',null,null,'${adSetResult.updated_at}',gen_random_uuid())`, intruder), /advertising_campaign_access_denied/);

    const concurrentInitial = run(`select updated_at from private.advertising_ad_sets where id='${concurrentAdSet}'`);
    const concurrent = await Promise.allSettled([
      runAsync(`begin;set local request.jwt.claim.sub='${owner}';select public.update_my_advertising_ad_set_draft('${concurrentAdSet}','Concurrent A',null,null,'${concurrentInitial}',gen_random_uuid());commit;`),
      runAsync(`begin;set local request.jwt.claim.sub='${owner}';select public.update_my_advertising_ad_set_draft('${concurrentAdSet}','Concurrent B',null,null,'${concurrentInitial}',gen_random_uuid());commit;`),
    ]);
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
    assert.match(concurrent.find((result) => result.status === "rejected").reason.stderr, /advertising_ad_set_draft_stale/);
    assert.match(run(`select name from private.advertising_ad_sets where id='${concurrentAdSet}'`), /^Concurrent [AB]$/);

    const destinationInitial = run(`select updated_at from private.advertising_destinations where id='${destination}'`);
    const destinationResult = JSON.parse(asActor(`select public.update_my_advertising_destination_draft('${destination}','external_url','${destinationInitial}',gen_random_uuid(),'https://nelyon.app/business/',null,null,null,null)`));
    assert.equal(destinationResult.external_url, "https://nelyon.app/business/");
    assert.equal(JSON.parse(asActor(`select public.update_my_advertising_destination_draft('${destination}','external_url','${destinationInitial}',gen_random_uuid(),'https://nelyon.app/business/',null,null,null,null)`)).id, destination);
    assert.throws(() => asActor(`select public.update_my_advertising_destination_draft('${destination}','external_url','${destinationInitial}',gen_random_uuid(),'https://stale.example',null,null,null,null)`), /advertising_destination_draft_stale/);
    assert.throws(() => asActor(`select public.update_my_advertising_destination_draft('${destination}','external_url','${destinationResult.updated_at}',gen_random_uuid(),'http:\/\/unsafe.example',null,null,null,null)`), /advertising_destination_external_url_invalid/);
    run(`insert into private.advertising_ads values(gen_random_uuid(),'${destination}')`);
    assert.equal(JSON.parse(asActor(`select public.update_my_advertising_destination_draft('${destination}','external_url','${destinationInitial}',gen_random_uuid(),'https://nelyon.app/business/',null,null,null,null)`)).id, destination);
    assert.throws(() => asActor(`select public.update_my_advertising_destination_draft('${destination}','external_url','${destinationResult.updated_at}',gen_random_uuid(),'https://blocked.example',null,null,null,null)`), /advertising_destination_in_use/);
    assert.equal(run(`select name||':'||external_url from private.advertising_ad_sets cross join private.advertising_destinations where private.advertising_ad_sets.id='${adSet}' and private.advertising_destinations.id='${destination}'`), "Updated:https://nelyon.app/business/");
  } finally {
    run(`select pg_terminate_backend(pid) from pg_stat_activity where datname='${database}' and pid<>pg_backend_pid();drop database if exists ${database}`, "postgres");
  }
});
