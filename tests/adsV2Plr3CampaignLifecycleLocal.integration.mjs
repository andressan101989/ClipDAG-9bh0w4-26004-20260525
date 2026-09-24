// Disposable PostgreSQL proof only. NELYON_PLR3_LOCAL=1 enables it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const enabled = process.env.NELYON_PLR3_LOCAL === "1";
const container = "nelyon-ads-v2-d-compile";
const database = `plr3_${process.pid}`;
const owner = "10000000-0000-4000-8000-000000000001";
const viewer = "10000000-0000-4000-8000-000000000002";
const intruder = "10000000-0000-4000-8000-000000000003";
const business = "20000000-0000-4000-8000-000000000001";
const account = "30000000-0000-4000-8000-000000000001";
const campaign = "40000000-0000-4000-8000-000000000001";
const futureCampaign = "40000000-0000-4000-8000-000000000002";
const draftCampaign = "40000000-0000-4000-8000-000000000003";
const adSet = "50000000-0000-4000-8000-000000000001";
const futureAdSet = "50000000-0000-4000-8000-000000000002";
const destination = "60000000-0000-4000-8000-000000000001";
const futureDestination = "60000000-0000-4000-8000-000000000002";
const creative = "70000000-0000-4000-8000-000000000001";
const version = "71000000-0000-4000-8000-000000000001";
const media = "72000000-0000-4000-8000-000000000001";
const ad = "80000000-0000-4000-8000-000000000001";
const futureAd = "80000000-0000-4000-8000-000000000002";

const args = (db, ...extra) => ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db, ...extra];
const run = (sql, db = database) => execFileSync("docker", args(db, "-At"), { input: sql, encoding: "utf8" }).trim();
const asOwner = (sql, actor = owner) => run(`begin;set local request.jwt.claim.sub='${actor}';${sql};commit;`);
const asService = (sql) => run(`begin;set local request.jwt.claim.role='service_role';${sql};commit;`);
const migration = readFileSync(new URL("../supabase/migrations/20260924003147_ads_v2_plr_3_campaign_activation_lifecycle.sql", import.meta.url), "utf8");
const eventsMigration = readFileSync(new URL("../supabase/migrations/20260922234902_ads_v2_g_events_conversions_attribution.sql", import.meta.url), "utf8");
const extractFunction = (source, qualifiedName) => {
  const marker = `create or replace function ${qualifiedName}`;
  const start = source.toLowerCase().indexOf(marker.toLowerCase());
  const end = source.indexOf("$$;", start);
  assert.ok(start >= 0 && end > start, `${qualifiedName} missing`);
  return source.slice(start, end + 3);
};

const bootstrap = String.raw`

create schema auth;create schema private;create schema extensions;
create extension pgcrypto with schema extensions;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
create table auth.users(id uuid primary key);
create table public.user_profiles(id uuid primary key);
create table private.business_accounts(id uuid primary key,owner_user_id uuid not null,display_name text not null,status text not null);
create table private.ad_accounts(id uuid primary key,business_account_id uuid not null,name text not null,status text not null);
create table private.advertising_campaigns(
 id uuid primary key,ad_account_id uuid not null,name text not null,objective text not null,status text not null default 'draft',
 created_by uuid not null,creation_idempotency_key uuid not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),archived_at timestamptz,
 constraint advertising_campaigns_status_chk check(status in('draft','archived')),
 constraint advertising_campaigns_archive_state_chk check((status='draft' and archived_at is null)or(status='archived' and archived_at is not null))
);
create table private.advertising_ad_sets(id uuid primary key,campaign_id uuid not null,name text not null,status text not null,starts_at timestamptz,ends_at timestamptz,created_at timestamptz default now());
create table private.advertising_destinations(id uuid primary key,campaign_id uuid not null,destination_type text not null,external_url text,target_user_id uuid,target_business_account_id uuid,target_product_id uuid,target_store_id uuid,status text not null,created_at timestamptz default now());
create table public.media_assets(id uuid primary key,status text not null,deleted_at timestamptz);
create table public.video_assets(id uuid primary key,status text not null,deleted_at timestamptz);
create table private.advertising_creatives(id uuid primary key,ad_account_id uuid not null,name text not null,status text not null,created_at timestamptz default now());
create table private.advertising_creative_versions(id uuid primary key,creative_id uuid not null,version_number integer not null,format text not null,media_asset_id uuid,video_asset_id uuid,primary_text text,headline text,description text,call_to_action text,content_fingerprint text,created_at timestamptz default now());
create table private.advertising_ads(id uuid primary key,ad_set_id uuid not null,creative_version_id uuid not null,destination_id uuid not null,name text not null,status text not null,review_status text not null,submission_fingerprint text,submitted_at timestamptz,reviewed_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
create table private.advertising_ad_review_events(id uuid primary key,ad_id uuid,event_type text,reason_code text,created_at timestamptz);
create table private.advertising_audiences(id uuid primary key,ad_set_id uuid not null,status text not null,created_at timestamptz default now());
create table private.advertising_audience_versions(id uuid primary key,audience_id uuid not null,version_number integer not null,age_scope text,created_at timestamptz default now());
create table private.advertising_geo_targets(id uuid primary key,audience_version_id uuid not null);
create table private.advertising_language_targets(id uuid primary key,audience_version_id uuid not null);
create table private.advertising_daypart_windows(id uuid primary key,audience_version_id uuid not null,timezone_name text,weekday integer,start_local time,end_local time);
create table private.advertising_frequency_policies(audience_version_id uuid primary key,max_impressions integer,window_hours integer);
create table private.advertising_placement_catalog(code text primary key,label text,surface_family text,status text,surface_verified boolean,legacy_compatible boolean,selection_enabled boolean,v2_delivery_enabled boolean,adapter_version text,created_at timestamptz default now(),updated_at timestamptz default now());
create table private.advertising_placement_selections(id uuid primary key,ad_set_id uuid not null,status text not null,created_at timestamptz default now());
create table private.advertising_placement_selection_versions(id uuid primary key,placement_selection_id uuid not null,version_number integer not null,created_at timestamptz default now());
create table private.advertising_placement_selection_items(placement_selection_version_id uuid not null,placement_code text not null,primary key(placement_selection_version_id,placement_code));
create table private.advertising_delivery_policy(singleton boolean primary key,policy_version text,global_v2_delivery_enabled boolean,require_authenticated_viewer boolean,require_adult_viewer boolean,require_approved_ad boolean,geo_matching_enabled boolean,language_matching_enabled boolean,frequency_enforcement_enabled boolean);
create table private.advertising_campaign_finance(campaign_id uuid primary key,budget_bdag numeric, currency text,finance_status text,funded_bdag numeric,spent_bdag numeric,released_bdag numeric,funded_at timestamptz,settled_at timestamptz);
create table private.advertising_events(id uuid primary key default gen_random_uuid(),event_key uuid unique,event_type text,ad_id uuid,campaign_id uuid,ad_set_id uuid,creative_version_id uuid,destination_id uuid,audience_version_id uuid,placement_selection_version_id uuid,placement_code text,viewer_user_id uuid,parent_impression_event_id uuid,context_fingerprint text,occurred_at timestamptz default clock_timestamp(),created_at timestamptz default clock_timestamp());
create table private.advertising_conversions(id uuid primary key,value_bdag numeric,conversion_type text);
create table private.advertising_attributions(id uuid primary key,campaign_id uuid,conversion_id uuid);
create table private.advertising_targeting_policy(singleton boolean primary key,policy_version text,minor_targeting_allowed boolean,interest_targeting_enabled boolean,behavioral_targeting_enabled boolean,custom_audiences_enabled boolean,lookalike_targeting_enabled boolean,sensitive_targeting_allowed boolean,precise_viewer_location_matching_enabled boolean);
create table private.advertising_event_policy(singleton boolean primary key,policy_version text,authenticated_viewers_only boolean,anonymous_events_enabled boolean,external_conversion_ingestion_enabled boolean);
create table private.advertising_finance_policy(singleton boolean primary key,policy_version text,funding_enabled boolean,spend_enabled boolean,settlement_enabled boolean);
create table private.advertising_financial_events(id uuid primary key);
create table private.advertising_financial_settlements(campaign_id uuid primary key);
create table private.age_eligibility_policy(singleton boolean primary key,minimum_age integer,creator_exclusive_minimum_age integer,policy_version text);
create table private.user_age_eligibility(user_id uuid primary key,status text,age_band text,minimum_age integer,policy_version text,evaluated_at timestamptz);
create table private.test_adults(user_id uuid primary key);
create function private.ads_actor_is_advertiser_age_eligible(p_user uuid)returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from private.test_adults where user_id=p_user)$$;
create function private.ads_delivery_viewer_is_adult(p_user uuid)returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from private.test_adults where user_id=p_user)$$;
create function private.advertising_impression_count_for_frequency(p_set uuid,p_user uuid,p_since timestamptz)returns bigint language sql stable security definer set search_path='' as $$select count(*) from private.advertising_events where ad_set_id=p_set and viewer_user_id=p_user and event_type='impression' and occurred_at>=p_since$$;
create function private.ads_ad_submission_fingerprint(p_ad uuid)returns text language sql stable security definer set search_path='' as $$select encode(extensions.digest(convert_to(concat_ws('|',ad.id,ad.creative_version_id,ad.destination_id),'UTF8'),'sha256'),'hex') from private.advertising_ads ad where ad.id=p_ad$$;
create function public.admin_require_capability(p_code text)returns void language plpgsql security definer set search_path='' as $$begin return;end$$;

insert into auth.users values('${owner}'),('${viewer}'),('${intruder}');insert into public.user_profiles select id from auth.users;
insert into private.test_adults values('${owner}'),('${viewer}');
insert into private.business_accounts values('${business}','${owner}','Studio','active');
insert into private.ad_accounts values('${account}','${business}','Ads','active');
insert into private.advertising_delivery_policy values(true,'nelyon-ads-delivery-v2',true,true,true,true,false,false,true);
insert into private.advertising_targeting_policy values(true,'nelyon-ads-targeting-v1',false,false,false,false,false,false,false);
insert into private.advertising_event_policy values(true,'nelyon-ads-events-v1',true,false,false);
insert into private.advertising_finance_policy values(true,'nelyon-ads-finance-v1',false,false,false);
insert into private.age_eligibility_policy values(true,13,18,'nelyon-age-v2');
insert into private.user_age_eligibility select user_id,'eligible','age_18_plus',13,'nelyon-age-v2',now() from private.test_adults;
insert into private.advertising_placement_catalog values('social_feed','Social Feed','social','active',true,false,true,true,'test',now(),now());
`;

const fixture = String.raw`
insert into private.advertising_campaigns values
('${campaign}','${account}','Current','awareness','draft','${owner}',gen_random_uuid(),now(),now(),null),
('${futureCampaign}','${account}','Future','awareness','draft','${owner}',gen_random_uuid(),now(),now(),null);
insert into private.advertising_campaign_finance values
('${campaign}',100,'BDAG','funded',100,0,0,now(),null),('${futureCampaign}',100,'BDAG','funded',100,0,0,now(),null);
insert into public.media_assets values('${media}','ready',null);
insert into private.advertising_creatives values('${creative}','${account}','Creative','draft',now());
insert into private.advertising_creative_versions values('${version}','${creative}',1,'image','${media}',null,'Copy','Headline',null,'learn_more',repeat('a',64),now());
insert into private.advertising_ad_sets values
('${adSet}','${campaign}','Current set','draft',null,null,now()),
('${futureAdSet}','${futureCampaign}','Future set','draft','2030-01-01T00:00:00Z','2030-01-02T00:00:00Z',now());
insert into private.advertising_destinations values
('${destination}','${campaign}','external_url','https://example.com',null,null,null,null,'draft',now()),
('${futureDestination}','${futureCampaign}','external_url','https://example.com/future',null,null,null,null,'draft',now());
insert into private.advertising_ads values
('${ad}','${adSet}','${version}','${destination}','Ad','draft','approved',null,now(),now(),now(),now()),
('${futureAd}','${futureAdSet}','${version}','${futureDestination}','Future Ad','draft','approved',null,now(),now(),now(),now());
update private.advertising_ads set submission_fingerprint=private.ads_ad_submission_fingerprint(id);
insert into private.advertising_audiences values
('81000000-0000-4000-8000-000000000001','${adSet}','draft',now()),
('81000000-0000-4000-8000-000000000002','${futureAdSet}','draft',now());
insert into private.advertising_audience_versions values
('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',1,'adults_only',now()),
('82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000002',1,'adults_only',now());
insert into private.advertising_placement_selections values
('83000000-0000-4000-8000-000000000001','${adSet}','draft',now()),
('83000000-0000-4000-8000-000000000002','${futureAdSet}','draft',now());
insert into private.advertising_placement_selection_versions values
('84000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001',1,now()),
('84000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000002',1,now());
insert into private.advertising_placement_selection_items values
('84000000-0000-4000-8000-000000000001','social_feed'),('84000000-0000-4000-8000-000000000002','social_feed');
`;

test("PLR-3 compiles and proves locked policy, lifecycle, delivery and reconciliation in disposable PostgreSQL", { skip: !enabled, timeout: 180_000 }, () => {
  run(`create database ${database}`, "postgres");
  try {
    run(bootstrap);
    run(migration);
    run(`${extractFunction(eventsMigration, "private.advertising_current_delivery_context(")}\n${extractFunction(eventsMigration, "public.record_advertising_impression_v2(")}`);
    assert.equal(run("select activation_enabled||':'||automatic_transitions_enabled from private.advertising_campaign_lifecycle_policy"), "false:false");
    run("alter table private.advertising_campaign_lifecycle_policy drop constraint advertising_campaign_lifecycle_policy_v1_safe_chk;update private.advertising_campaign_lifecycle_policy set activation_enabled=true,automatic_transitions_enabled=true");
    run(fixture);

    const readiness = JSON.parse(asOwner(`select public.get_my_advertising_campaign_activation_readiness('${campaign}')`));
    assert.equal(readiness.structurally_ready, true);
    assert.equal(readiness.target_status, "active");
    run(`update private.business_accounts set status='inactive' where id='${business}'`);
    assert.ok(JSON.parse(asOwner(`select public.get_my_advertising_campaign_activation_readiness('${campaign}')`)).blockers.includes("business_inactive"));
    run(`update private.business_accounts set status='active' where id='${business}';update private.ad_accounts set status='inactive' where id='${account}'`);
    assert.ok(JSON.parse(asOwner(`select public.get_my_advertising_campaign_activation_readiness('${campaign}')`)).blockers.includes("ad_account_inactive"));
    run(`update private.ad_accounts set status='active' where id='${account}';delete from private.test_adults where user_id='${owner}'`);
    assert.ok(JSON.parse(asOwner(`select public.get_my_advertising_campaign_activation_readiness('${campaign}')`)).blockers.includes("advertiser_adult_eligibility_required"));
    run(`insert into private.test_adults values('${owner}');update private.advertising_campaign_finance set finance_status='draft' where campaign_id='${campaign}'`);
    assert.ok(JSON.parse(asOwner(`select public.get_my_advertising_campaign_activation_readiness('${campaign}')`)).blockers.includes("campaign_finance_not_funded"));
    run(`update private.advertising_campaign_finance set finance_status='funded' where campaign_id='${campaign}';update private.advertising_placement_catalog set v2_delivery_enabled=false where code='social_feed'`);
    assert.ok(JSON.parse(asOwner(`select public.get_my_advertising_campaign_activation_readiness('${campaign}')`)).blockers.includes("placement_v2_delivery_disabled"));
    run(`update private.advertising_placement_catalog set v2_delivery_enabled=true where code='social_feed';insert into private.advertising_geo_targets values(gen_random_uuid(),'82000000-0000-4000-8000-000000000001')`);
    assert.ok(JSON.parse(asOwner(`select public.get_my_advertising_campaign_activation_readiness('${campaign}')`)).blockers.includes("viewer_geo_authority_unavailable"));
    run("delete from private.advertising_geo_targets;insert into private.advertising_language_targets values(gen_random_uuid(),'82000000-0000-4000-8000-000000000001')");
    assert.ok(JSON.parse(asOwner(`select public.get_my_advertising_campaign_activation_readiness('${campaign}')`)).blockers.includes("viewer_language_authority_unavailable"));
    run("delete from private.advertising_language_targets");
    const activationKey = "90000000-0000-4000-8000-000000000001";
    assert.match(asOwner(`select public.activate_my_advertising_campaign_v2('${campaign}','${activationKey}')`), /"status": "active"/);
    run("update private.advertising_campaign_lifecycle_policy set activation_enabled=false");
    assert.match(asOwner(`select public.activate_my_advertising_campaign_v2('${campaign}','${activationKey}')`), /"status": "active"/);
    assert.throws(() => asOwner(`select public.activate_my_advertising_campaign_v2('${futureCampaign}','90000000-0000-4000-8000-000000000099')`), /advertising_campaign_activation_disabled/);
    assert.throws(() => asOwner(`select public.activate_my_advertising_campaign_v2('${campaign}','${activationKey}')`, intruder), /advertising_campaign_access_denied/);
    assert.throws(() => asOwner(`select public.pause_my_advertising_campaign_v2('${campaign}','${activationKey}')`), /advertising_campaign_lifecycle_idempotency_conflict/);

    const preflightAt = () => JSON.parse(run(`select private.advertising_delivery_preflight_at('${ad}','social_feed','${viewer}',now())`));
    const preflight = preflightAt();
    assert.equal(preflight.production_deliverable, true);
    for (const [status, reason] of [["draft","campaign_not_active"],["scheduled","campaign_not_active"],["paused","campaign_paused"],["completed","campaign_completed"],["cancelled","campaign_cancelled"]]) {
      run(`update private.advertising_campaigns set status='${status}' where id='${campaign}'`);
      const blocked = preflightAt();
      assert.equal(blocked.production_deliverable, false);
      assert.ok(blocked.reason_codes.includes(reason));
    }
    run(`update private.advertising_campaigns set status='archived',archived_at=now() where id='${campaign}'`);
    assert.ok(preflightAt().reason_codes.includes("campaign_unavailable"));
    run(`update private.advertising_campaigns set status='active',archived_at=null where id='${campaign}';update private.advertising_campaign_finance set finance_status='draft' where campaign_id='${campaign}'`);
    assert.ok(preflightAt().reason_codes.includes("campaign_finance_not_funded"));
    run(`update private.advertising_campaign_finance set finance_status='funded',spent_bdag=100 where campaign_id='${campaign}'`);
    assert.ok(preflightAt().reason_codes.includes("campaign_budget_exhausted"));
    run(`update private.advertising_campaign_finance set spent_bdag=0 where campaign_id='${campaign}';delete from private.test_adults where user_id='${owner}'`);
    assert.ok(preflightAt().reason_codes.includes("advertiser_adult_eligibility_required"));
    run(`insert into private.test_adults values('${owner}');update private.advertising_ad_sets set starts_at=now()+interval '1 hour',ends_at=now()+interval '2 hours' where id='${adSet}'`);
    assert.ok(preflightAt().reason_codes.includes("ad_set_outside_schedule"));
    run(`update private.advertising_ad_sets set starts_at=null,ends_at=null where id='${adSet}';update private.advertising_ads set submission_fingerprint=repeat('f',64) where id='${ad}'`);
    assert.ok(preflightAt().reason_codes.includes("ad_review_fingerprint_mismatch"));
    run(`update private.advertising_ads set submission_fingerprint=private.ads_ad_submission_fingerprint(id) where id='${ad}';update private.advertising_placement_catalog set v2_delivery_enabled=false where code='social_feed'`);
    assert.equal(preflightAt().production_deliverable, false);
    assert.ok(preflightAt().reason_codes.includes("placement_v2_delivery_disabled"));
    run("update private.advertising_placement_catalog set v2_delivery_enabled=true where code='social_feed';update private.advertising_delivery_policy set global_v2_delivery_enabled=false where singleton");
    assert.ok(preflightAt().reason_codes.includes("global_delivery_disabled"));
    run("update private.advertising_delivery_policy set global_v2_delivery_enabled=true where singleton");
    assert.equal(JSON.parse(run(`select private.advertising_delivery_preflight_at('${ad}','social_feed','${intruder}',now())`)).viewer_match, false);
    assert.equal(preflightAt().production_deliverable, true);
    const impressionKey = "91000000-0000-4000-8000-000000000001";
    assert.match(asService(`select public.record_advertising_impression_v2('${ad}','social_feed','${viewer}','${impressionKey}')`), /"event_type": "impression"/);
    assert.equal(run(`select count(*) from private.advertising_events where event_key='${impressionKey}'`), "1");
    const pauseKey = "90000000-0000-4000-8000-000000000002";
    asOwner(`select public.pause_my_advertising_campaign_v2('${campaign}','${pauseKey}')`);
    assert.match(asOwner(`select public.pause_my_advertising_campaign_v2('${campaign}','${pauseKey}')`), /"status": "paused"/);
    const paused = JSON.parse(run(`select private.advertising_delivery_preflight_at('${ad}','social_feed','${viewer}',now())`));
    assert.equal(paused.production_deliverable, false);
    assert.ok(paused.reason_codes.includes("campaign_paused"));
    assert.throws(() => asService(`select public.record_advertising_impression_v2('${ad}','social_feed','${viewer}','91000000-0000-4000-8000-000000000002')`), /advertising_impression_not_deliverable/);
    run("update private.advertising_campaign_lifecycle_policy set activation_enabled=true");
    const resumeKey = "90000000-0000-4000-8000-000000000003";
    asOwner(`select public.resume_my_advertising_campaign_v2('${campaign}','${resumeKey}')`);
    run("update private.advertising_campaign_lifecycle_policy set activation_enabled=false");
    assert.match(asOwner(`select public.resume_my_advertising_campaign_v2('${campaign}','${resumeKey}')`), /"status": "active"/);
    run("update private.advertising_campaign_lifecycle_policy set activation_enabled=true");
    const cancelKey = "90000000-0000-4000-8000-000000000004";
    assert.match(asOwner(`select public.cancel_my_advertising_campaign_v2('${campaign}','${cancelKey}')`), /"requires_financial_settlement": true/);
    assert.match(asOwner(`select public.cancel_my_advertising_campaign_v2('${campaign}','${cancelKey}')`), /"status": "cancelled"/);
    assert.equal(run(`select status from private.advertising_campaigns where id='${campaign}'`), "cancelled");

    assert.match(asOwner(`select public.activate_my_advertising_campaign_v2('${futureCampaign}','90000000-0000-4000-8000-000000000005')`), /"status": "scheduled"/);
    assert.match(asOwner(`select public.pause_my_advertising_campaign_v2('${futureCampaign}','90000000-0000-4000-8000-000000000006')`), /"status": "paused"/);
    assert.match(asOwner(`select public.resume_my_advertising_campaign_v2('${futureCampaign}','90000000-0000-4000-8000-000000000007')`), /"status": "scheduled"/);
    assert.match(asService("select public.reconcile_advertising_campaign_lifecycle(100,'2029-12-31T23:59:59Z')"), /"activated": 0/);
    run("update private.advertising_campaign_lifecycle_policy set automatic_transitions_enabled=false");
    assert.match(asService("select public.reconcile_advertising_campaign_lifecycle(100,'2030-01-01T00:00:00Z')"), /"activated": 0/);
    run("update private.advertising_campaign_lifecycle_policy set automatic_transitions_enabled=true");
    assert.match(asService("select public.reconcile_advertising_campaign_lifecycle(100,'2030-01-01T00:00:00Z')"), /"activated": 1/);
    assert.equal(run(`select status from private.advertising_campaigns where id='${futureCampaign}'`), "active");
    assert.match(asService("select public.reconcile_advertising_campaign_lifecycle(100,'2030-01-02T00:00:00Z')"), /"completed": 1/);
    assert.equal(run(`select status from private.advertising_campaigns where id='${futureCampaign}'`), "completed");
    run(`insert into private.advertising_campaigns values('${draftCampaign}','${account}','Draft cancel','awareness','draft','${owner}',gen_random_uuid(),now(),now(),null)`);
    assert.match(asOwner(`select public.cancel_my_advertising_campaign_v2('${draftCampaign}','90000000-0000-4000-8000-000000000008')`), /"status": "cancelled"/);
    assert.equal(run("select count(*) from private.advertising_campaign_lifecycle_events"), "10");
  } finally {
    run(`select pg_terminate_backend(pid) from pg_stat_activity where datname='${database}' and pid<>pg_backend_pid();drop database if exists ${database}`, "postgres");
  }
});
