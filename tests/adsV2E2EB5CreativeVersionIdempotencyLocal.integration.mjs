// Disposable PostgreSQL proof only. NELYON_E2E_B5_LOCAL=1 enables it.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const enabled = process.env.NELYON_E2E_B5_LOCAL === "1";
const container = "nelyon-ads-v2-d-compile";
const database = `e2eb5_${process.pid}`;
const owner = "10000000-0000-4000-8000-000000000001";
const intruder = "10000000-0000-4000-8000-000000000002";
const business = "20000000-0000-4000-8000-000000000001";
const account = "30000000-0000-4000-8000-000000000001";
const historicalCreative = "40000000-0000-4000-8000-000000000001";
const historicalVersion = "50000000-0000-4000-8000-000000000001";
const image = "60000000-0000-4000-8000-000000000001";
const productImage = "60000000-0000-4000-8000-000000000002";
const pendingImage = "60000000-0000-4000-8000-000000000003";
const foreignImage = "60000000-0000-4000-8000-000000000004";

const migrationName = readdirSync(new URL("../supabase/migrations/", import.meta.url)).find((name) => name.endsWith("_ads_v2_e2e_b5_creative_version_idempotency.sql"));
const migration = readFileSync(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), "utf8");
const args = (db, ...extra) => ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db, ...extra];
const run = (sql, db = database) => execFileSync("docker", args(db, "-At"), { input: sql, encoding: "utf8", maxBuffer: 20e6 }).trim();
const runAsync = (sql, db = database) => new Promise((resolve, reject) => {
  const child = execFile("docker", args(db, "-At"), { encoding: "utf8" }, (error, stdout, stderr) => error ? reject(Object.assign(error, { stderr })) : resolve(stdout.trim()));
  child.stdin.end(sql);
});
const asActor = (sql, actor = owner) => run(`begin;set local request.jwt.claim.sub='${actor}';${sql};commit;`);

const bootstrap = String.raw`
create schema auth;create schema private;create schema extensions;create extension pgcrypto with schema extensions;
do $$begin if not exists(select 1 from pg_roles where rolname='anon')then create role anon nologin;end if;if not exists(select 1 from pg_roles where rolname='authenticated')then create role authenticated nologin;end if;if not exists(select 1 from pg_roles where rolname='service_role')then create role service_role nologin;end if;end$$;
create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.user_profiles(id uuid primary key);
create table public.media_assets(id uuid primary key,owner_id uuid not null,provider text not null,media_kind text not null,purpose text not null,status text not null,deleted_at timestamptz);
create table public.video_assets(id uuid primary key,owner_id uuid not null,provider text not null,purpose text not null,status text not null,deleted_at timestamptz);
create table private.business_accounts(id uuid primary key,owner_user_id uuid not null,status text not null);
create table private.ad_accounts(id uuid primary key,business_account_id uuid not null,status text not null);
create table private.advertising_campaigns(id uuid primary key,ad_account_id uuid not null);
create table private.advertising_ad_sets(id uuid primary key,campaign_id uuid not null);
create table private.advertising_creatives(id uuid primary key default gen_random_uuid(),ad_account_id uuid not null,name text not null,status text not null default 'draft',created_by uuid not null,creation_idempotency_key uuid not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),archived_at timestamptz,unique(ad_account_id,creation_idempotency_key));
create table private.advertising_creative_versions(id uuid primary key default gen_random_uuid(),creative_id uuid not null,version_number integer not null,format text not null,media_asset_id uuid,video_asset_id uuid,primary_text text,headline text,description text,call_to_action text not null,content_fingerprint text not null,created_by uuid not null,created_at timestamptz not null default now(),unique(creative_id,version_number));
create table private.advertising_ads(id uuid primary key default gen_random_uuid(),ad_set_id uuid not null,creative_version_id uuid not null,destination_id uuid not null,name text not null,status text not null default 'draft',review_status text not null default 'not_submitted',submission_fingerprint text,creation_idempotency_key uuid not null,submitted_at timestamptz,reviewed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table private.advertising_ad_review_events(id uuid primary key default gen_random_uuid(),ad_id uuid not null,event_type text not null,reason_code text,created_at timestamptz not null default now());
create function private.advertising_creative_versions_immutable()returns trigger language plpgsql security definer set search_path='' as $$begin raise exception using errcode='42501',message='advertising_creative_version_immutable';end$$;
create trigger advertising_creative_versions_immutable before update or delete on private.advertising_creative_versions for each row execute function private.advertising_creative_versions_immutable();
create function private.ads_actor_is_advertiser_age_eligible(p_actor uuid)returns boolean language sql stable security definer set search_path='' as $$select p_actor is not null$$;
create function private.ads_content_fingerprint(p_format text,p_media_asset_id uuid,p_video_asset_id uuid,p_primary_text text,p_headline text,p_description text,p_call_to_action text)returns text language sql immutable security definer set search_path='' as $$select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('format',p_format,'media_asset_id',p_media_asset_id,'video_asset_id',p_video_asset_id,'primary_text',p_primary_text,'headline',p_headline,'description',p_description,'call_to_action',p_call_to_action)::text,'UTF8'),'sha256'),'hex')$$;
create function private.ads_validate_creative_payload(p_actor uuid,p_format text,p_media_asset_id uuid,p_video_asset_id uuid,p_primary_text text,p_headline text,p_description text,p_call_to_action text)returns text language plpgsql stable security definer set search_path='' as $$begin
 if p_actor is null or p_format not in('image','video') then raise exception using errcode='22023',message='advertising_creative_payload_invalid';end if;
 if p_call_to_action not in('learn_more','shop_now','sign_up','contact_us','send_message','download','visit_profile','none')then raise exception using errcode='22023',message='advertising_creative_call_to_action_invalid';end if;
 if p_format='image' then if p_media_asset_id is null or p_video_asset_id is not null then raise exception using errcode='22023',message='advertising_creative_image_asset_invalid';end if;perform 1 from public.media_assets where id=p_media_asset_id and owner_id=p_actor and provider='r2' and media_kind='image' and purpose='business_library' and status='ready' and deleted_at is null;if not found then raise exception using errcode='42501',message='advertising_creative_image_asset_unavailable';end if;
 else if p_video_asset_id is null or p_media_asset_id is not null then raise exception using errcode='22023',message='advertising_creative_video_asset_invalid';end if;perform 1 from public.video_assets where id=p_video_asset_id and owner_id=p_actor and provider='cloudflare_stream' and purpose='business_library' and status='ready' and deleted_at is null;if not found then raise exception using errcode='42501',message='advertising_creative_video_asset_unavailable';end if;end if;
 return private.ads_content_fingerprint(p_format,p_media_asset_id,p_video_asset_id,p_primary_text,p_headline,p_description,p_call_to_action);end$$;
create function public.create_my_advertising_creative(uuid,text,text,uuid,uuid,text,text,text,text,uuid)returns jsonb language sql security definer set search_path='' as $$select '{}'::jsonb$$;
create function public.create_my_advertising_creative_version(uuid,text,uuid,uuid,text,text,text,text)returns jsonb language sql security definer set search_path='' as $$select '{}'::jsonb$$;
insert into public.user_profiles values('${owner}'),('${intruder}');
insert into private.business_accounts values('${business}','${owner}','active');
insert into private.ad_accounts values('${account}','${business}','active');
insert into public.media_assets values('${image}','${owner}','r2','image','business_library','ready',null),('${productImage}','${owner}','r2','image','product','ready',null),('${pendingImage}','${owner}','r2','image','business_library','processing',null),('${foreignImage}','${intruder}','r2','image','business_library','ready',null);
insert into private.advertising_creatives(id,ad_account_id,name,status,created_by,creation_idempotency_key)values('${historicalCreative}','${account}','Historical','draft','${owner}','70000000-0000-4000-8000-000000000001');
insert into private.advertising_creative_versions(id,creative_id,version_number,format,media_asset_id,video_asset_id,primary_text,headline,description,call_to_action,content_fingerprint,created_by)values('${historicalVersion}','${historicalCreative}',1,'image','${image}',null,'Historical copy',null,null,'learn_more',private.ads_content_fingerprint('image','${image}',null,'Historical copy',null,null,'learn_more'),'${owner}');
`;

test("E2E-B5 proves Creative Version backfill, replay, conflicts, media guards and concurrency", { skip: !enabled, timeout: 120_000 }, async () => {
  run(`create database ${database}`, "postgres");
  try {
    run(bootstrap);
    run(migration);
    assert.equal(run(`select version.creation_idempotency_key=creative.creation_idempotency_key from private.advertising_creative_versions version join private.advertising_creatives creative on creative.id=version.creative_id where version.id='${historicalVersion}'`), "t");
    assert.doesNotThrow(() => asActor(`select public.create_my_advertising_creative('${account}','Historical','image','${image}',null,'Historical copy',null,null,'learn_more','70000000-0000-4000-8000-000000000001')`));
    assert.equal(run("select is_nullable from information_schema.columns where table_schema='private' and table_name='advertising_creative_versions' and column_name='creation_idempotency_key'"), "NO");
    assert.equal(run("select to_regprocedure('public.create_my_advertising_creative_version(uuid,text,uuid,uuid,text,text,text,text)') is null"), "t");
    assert.equal(run("select has_function_privilege('anon','public.create_my_advertising_creative_version(uuid,text,uuid,uuid,text,text,text,text,uuid)','EXECUTE')"), "f");
    assert.equal(run("select has_function_privilege('authenticated','public.create_my_advertising_creative_version(uuid,text,uuid,uuid,text,text,text,text,uuid)','EXECUTE')"), "t");
    assert.equal(run("select has_function_privilege('anon','public.get_my_advertising_creative_workspace()','EXECUTE')"), "f");
    assert.equal(run("select has_function_privilege('authenticated','public.get_my_advertising_creative_workspace()','EXECUTE')"), "t");

    const createKey = "70000000-0000-4000-8000-000000000002";
    const created = JSON.parse(asActor(`select public.create_my_advertising_creative('${account}','New Creative','image','${image}',null,'Initial copy',null,null,'learn_more','${createKey}')`));
    const createdId = created.id;
    assert.equal(run(`select creation_idempotency_key='${createKey}' and version_number=1 from private.advertising_creative_versions where creative_id='${createdId}'`), "t");

    const replayKey = "70000000-0000-4000-8000-000000000003";
    const replaySql = `select public.create_my_advertising_creative_version('${createdId}','image','${image}',null,'Changed copy','Headline',null,'shop_now','${replayKey}')`;
    const first = JSON.parse(asActor(replaySql));
    const replay = JSON.parse(asActor(replaySql));
    assert.equal(first.versions.length, 2);
    assert.equal(replay.versions.length, 2);
    assert.equal(run(`select count(*) from private.advertising_creative_versions where creative_id='${createdId}' and creation_idempotency_key='${replayKey}'`), "1");
    run(`update public.media_assets set status='processing' where id='${image}'`);
    assert.doesNotThrow(() => asActor(replaySql));
    run(`update public.media_assets set status='ready' where id='${image}'`);
    assert.throws(() => asActor(`select public.create_my_advertising_creative_version('${createdId}','image','${image}',null,'Different payload',null,null,'learn_more','${replayKey}')`), /advertising_creative_version_idempotency_conflict/);

    assert.throws(() => asActor(`select public.create_my_advertising_creative_version('${createdId}','image','${productImage}',null,'Product media',null,null,'learn_more',gen_random_uuid())`), /advertising_creative_image_asset_unavailable/);
    assert.throws(() => asActor(`select public.create_my_advertising_creative_version('${createdId}','image','${pendingImage}',null,'Pending media',null,null,'learn_more',gen_random_uuid())`), /advertising_creative_image_asset_unavailable/);
    assert.throws(() => asActor(`select public.create_my_advertising_creative_version('${createdId}','image','${foreignImage}',null,'Foreign media',null,null,'learn_more',gen_random_uuid())`), /advertising_creative_image_asset_unavailable/);
    assert.throws(() => asActor(`select public.create_my_advertising_creative_version('${createdId}','image','${foreignImage}',null,'Intruder',null,null,'learn_more',gen_random_uuid())`, intruder), /advertising_creative_access_denied/);

    const concurrent = await Promise.all([
      runAsync(`begin;set local request.jwt.claim.sub='${owner}';select public.create_my_advertising_creative_version('${createdId}','image','${image}',null,'Concurrent A',null,null,'learn_more','70000000-0000-4000-8000-000000000004');commit;`),
      runAsync(`begin;set local request.jwt.claim.sub='${owner}';select public.create_my_advertising_creative_version('${createdId}','image','${image}',null,'Concurrent B',null,null,'learn_more','70000000-0000-4000-8000-000000000005');commit;`),
    ]);
    assert.equal(concurrent.length, 2);
    assert.equal(run(`select string_agg(version_number::text,',' order by version_number) from private.advertising_creative_versions where creative_id='${createdId}'`), "1,2,3,4");
    assert.equal(run(`select count(*)=count(distinct version_number) from private.advertising_creative_versions where creative_id='${createdId}'`), "t");
  } finally {
    run(`select pg_terminate_backend(pid) from pg_stat_activity where datname='${database}' and pid<>pg_backend_pid();drop database if exists ${database}`, "postgres");
  }
});
