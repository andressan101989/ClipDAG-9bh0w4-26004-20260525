// Disposable PostgreSQL proof only. NELYON_PLR8_LOCAL=1 enables it.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { promisify } from "node:util";

const enabled = process.env.NELYON_PLR8_LOCAL === "1";
const container = "nelyon-ads-v2-d-compile";
const database = `plr8_full_funnel_${process.pid}`;
const migrationNames = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter((name) => name.endsWith("_ads_v2_plr_8_full_funnel_marketplace_attribution.sql"));
const migration = migrationNames.length === 1
  ? readFileSync(new URL(`../supabase/migrations/${migrationNames[0]}`, import.meta.url), "utf8")
  : "";
const args = (db, ...extra) => ["exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db, ...extra];
const run = (sql, db = database) => execFileSync("docker", args(db, "-At"), { input: sql, encoding: "utf8" }).trim();
const execFileAsync = promisify(execFile);
const runAsync = async (sql) =>
  (await execFileAsync("docker", args(database, "-At", "-c", sql), { encoding: "utf8" })).stdout.trim();

const ids = {
  buyer: "10000000-0000-4000-8000-000000000001",
  otherBuyer: "10000000-0000-4000-8000-000000000002",
  seller: "11000000-0000-4000-8000-000000000001",
  business: "12000000-0000-4000-8000-000000000001",
  account: "13000000-0000-4000-8000-000000000001",
  product: "14000000-0000-4000-8000-000000000001",
  otherProduct: "14000000-0000-4000-8000-000000000002",
  store: "15000000-0000-4000-8000-000000000001",
  campaignProduct: "16000000-0000-4000-8000-000000000001",
  campaignStore: "16000000-0000-4000-8000-000000000002",
  adSetProduct: "17000000-0000-4000-8000-000000000001",
  adSetStore: "17000000-0000-4000-8000-000000000002",
  destinationProduct: "18000000-0000-4000-8000-000000000001",
  destinationStore: "18000000-0000-4000-8000-000000000002",
  adProduct: "19000000-0000-4000-8000-000000000001",
  adStore: "19000000-0000-4000-8000-000000000002",
};

const bootstrap = `
create schema auth;
create schema private;
create schema cron;
create function auth.uid() returns uuid language sql stable as $$select '${ids.seller}'::uuid$$;
create function auth.role() returns text language sql stable as $$select null::text$$;

create table cron.job(jobid bigserial primary key,jobname text unique,schedule text,command text,active boolean default true);
create function cron.schedule(text,text,text) returns bigint language plpgsql as $$declare result bigint;begin insert into cron.job(jobname,schedule,command)values($1,$2,$3)returning jobid into result;return result;end$$;
create function cron.unschedule(bigint) returns boolean language plpgsql as $$begin delete from cron.job where jobid=$1;return found;end$$;

create table private.advertising_event_policy(
 singleton boolean primary key,policy_version text not null,
 interaction_max_delay_hours integer not null,click_attribution_window_hours integer not null,
 impression_attribution_window_hours integer not null,external_conversion_ingestion_enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
insert into private.advertising_event_policy values(true,'nelyon-ads-events-v1',24,24,24,false,now());

create table private.business_accounts(id uuid primary key,status text,owner_user_id uuid);
create table private.ad_accounts(id uuid primary key,business_account_id uuid,status text);
create table private.business_account_marketplace_links(business_account_id uuid,marketplace_seller_user_id uuid);
create table public.marketplace_sellers(user_id uuid primary key,status text);
create table public.marketplace_stores(id uuid primary key,seller_id uuid,name text,status text);
create table public.products(id uuid primary key,seller_id uuid,store_id uuid,status text,published_at timestamptz,deleted_at timestamptz,moderation_status text,product_type text,currency text);
create function public.marketplace_product_publication_reason(uuid,uuid)returns text language sql stable as $$select null::text$$;

create table private.advertising_campaigns(id uuid primary key,objective text,ad_account_id uuid,status text);
create table private.advertising_ad_sets(id uuid primary key,campaign_id uuid,status text);
create table private.advertising_destinations(id uuid primary key,campaign_id uuid,destination_type text,target_product_id uuid,target_store_id uuid,status text);
create table private.advertising_creatives(id uuid primary key,status text,ad_account_id uuid);
create table private.advertising_creative_versions(id uuid primary key,creative_id uuid,created_by uuid,format text,media_asset_id uuid,video_asset_id uuid,primary_text text,headline text,description text,call_to_action text,content_fingerprint text);
create table private.advertising_ads(id uuid primary key,ad_set_id uuid,destination_id uuid,creative_version_id uuid,status text,review_status text,submission_fingerprint text,submitted_at timestamptz,reviewed_at timestamptz);
create table private.advertising_ad_review_events(id uuid primary key default gen_random_uuid(),ad_id uuid,event_type text,actor_user_id uuid,submission_fingerprint text,reason_code text,note text,note_is_internal boolean,idempotency_key uuid);
create function private.ads_actor_is_advertiser_age_eligible(uuid)returns boolean language sql stable as $$select true$$;
create function private.ads_ad_result(uuid)returns jsonb language sql stable as $$select jsonb_build_object('id',$1)$$;
create function private.ads_validate_creative_payload(uuid,text,uuid,uuid,text,text,text,text)returns text language sql stable as $$select 'fp'::text$$;
create function private.ads_ad_submission_fingerprint(uuid)returns text language sql stable as $$select 'submission-fp'::text$$;
create function public.submit_my_advertising_ad_for_review(uuid,uuid)returns jsonb language sql security definer set search_path='' as $$select '{}'::jsonb$$;

create table public.marketplace_orders(id uuid primary key,buyer_id uuid,status text,confirmed_at timestamptz,cancelled_at timestamptz,expired_at timestamptz);
create table public.marketplace_order_items(id uuid primary key,order_id uuid,product_id uuid,store_id uuid,line_total numeric(20,8),currency text);
create table private.advertising_events(id uuid primary key,event_type text,viewer_user_id uuid,campaign_id uuid,destination_id uuid,occurred_at timestamptz);
create table private.advertising_conversions(id uuid primary key default gen_random_uuid(),conversion_key uuid unique,conversion_type text,viewer_user_id uuid,source_type text,source_reference_id uuid,value_bdag numeric(20,8),currency text,occurred_at timestamptz,unique(source_type,source_reference_id,conversion_type));
create table private.advertising_attributions(id uuid primary key default gen_random_uuid(),conversion_id uuid unique,touch_event_id uuid,touch_event_type text,campaign_id uuid,attribution_model text,attribution_window_hours integer);
create table public.marketplace_ad_touches(id uuid primary key default gen_random_uuid());
create table public.financial_transactions(id uuid primary key default gen_random_uuid());
create table public.ledger_entries(id uuid primary key default gen_random_uuid());

create or replace function public.record_advertising_marketplace_purchase_conversion_v2(p_order_item_id uuid,p_conversion_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item record;conversion_row private.advertising_conversions;touch private.advertising_events;policy private.advertising_event_policy;attribution_row private.advertising_attributions;
begin
 select i.*,o.buyer_id,o.confirmed_at into strict item from public.marketplace_order_items i join public.marketplace_orders o on o.id=i.order_id where i.id=p_order_item_id;
 insert into private.advertising_conversions(conversion_key,conversion_type,viewer_user_id,source_type,source_reference_id,value_bdag,currency,occurred_at)
 values(p_conversion_key,'marketplace_purchase',item.buyer_id,'marketplace_order_item',item.id,item.line_total,item.currency,item.confirmed_at)
 on conflict(source_type,source_reference_id,conversion_type)do update set source_reference_id=excluded.source_reference_id returning*into conversion_row;
 select*into policy from private.advertising_event_policy where singleton;
 select e.*into touch from private.advertising_events e join private.advertising_campaigns c on c.id=e.campaign_id join private.advertising_destinations d on d.id=e.destination_id
 where e.viewer_user_id=item.buyer_id and e.event_type='click'and e.occurred_at<=item.confirmed_at and e.occurred_at>=item.confirmed_at-make_interval(hours=>policy.click_attribution_window_hours)
 and c.objective='marketplace_sales'and((d.destination_type='marketplace_product'and d.target_product_id=item.product_id)or(d.destination_type='marketplace_store'and d.target_store_id=item.store_id))order by e.occurred_at desc,e.id desc limit 1;
 if touch.id is null then select e.*into touch from private.advertising_events e join private.advertising_campaigns c on c.id=e.campaign_id join private.advertising_destinations d on d.id=e.destination_id
 where e.viewer_user_id=item.buyer_id and e.event_type='impression'and e.occurred_at<=item.confirmed_at and e.occurred_at>=item.confirmed_at-make_interval(hours=>policy.impression_attribution_window_hours)
 and c.objective='marketplace_sales'and((d.destination_type='marketplace_product'and d.target_product_id=item.product_id)or(d.destination_type='marketplace_store'and d.target_store_id=item.store_id))order by e.occurred_at desc,e.id desc limit 1;end if;
 if touch.id is not null then insert into private.advertising_attributions(conversion_id,touch_event_id,touch_event_type,campaign_id,attribution_model,attribution_window_hours)
 values(conversion_row.id,touch.id,touch.event_type,touch.campaign_id,'last_click_then_impression',24)on conflict(conversion_id)do update set conversion_id=excluded.conversion_id returning*into attribution_row;end if;
 return jsonb_build_object('conversion_id',conversion_row.id,'attributed',attribution_row.id is not null,'attribution_model',attribution_row.attribution_model,'authority','ads_v2');
end$$;
revoke all on function public.record_advertising_marketplace_purchase_conversion_v2(uuid,uuid)from public,anon,authenticated;
grant execute on function public.record_advertising_marketplace_purchase_conversion_v2(uuid,uuid)to service_role;

insert into private.business_accounts values('${ids.business}','active','${ids.seller}');
insert into private.ad_accounts values('${ids.account}','${ids.business}','active');
insert into private.business_account_marketplace_links values('${ids.business}','${ids.seller}');
insert into public.marketplace_sellers values('${ids.seller}','approved');
insert into public.marketplace_stores values('${ids.store}','${ids.seller}','Store','active');
insert into public.products values('${ids.product}','${ids.seller}','${ids.store}','active',now(),null,'approved','physical','BDAG'),('${ids.otherProduct}','${ids.seller}','${ids.store}','active',now(),null,'approved','physical','BDAG');
insert into private.advertising_campaigns values('${ids.campaignProduct}','marketplace_sales','${ids.account}','draft'),('${ids.campaignStore}','marketplace_sales','${ids.account}','draft');
insert into private.advertising_ad_sets values('${ids.adSetProduct}','${ids.campaignProduct}','draft'),('${ids.adSetStore}','${ids.campaignStore}','draft');
insert into private.advertising_destinations values('${ids.destinationProduct}','${ids.campaignProduct}','marketplace_product','${ids.product}',null,'draft'),('${ids.destinationStore}','${ids.campaignStore}','marketplace_store',null,'${ids.store}','draft');
insert into private.advertising_creatives values('21000000-0000-4000-8000-000000000001','draft','${ids.account}');
insert into private.advertising_creative_versions values('22000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','${ids.seller}','image',null,null,null,null,null,'shop_now','fp');
insert into private.advertising_ads values('${ids.adProduct}','${ids.adSetProduct}','${ids.destinationProduct}','22000000-0000-4000-8000-000000000001','draft','approved','submission-fp',now(),now()),('${ids.adStore}','${ids.adSetStore}','${ids.destinationStore}','22000000-0000-4000-8000-000000000001','draft','approved','submission-fp',now(),now());
`;

test("PLR-8 cutover reconciler attributes only eligible post-cutover purchases without touching checkout or finance", { skip: !enabled, timeout: 120_000 }, async () => {
  assert.equal(migrationNames.length, 1);
  run(`create database ${database}`, "postgres");
  try {
    run(bootstrap);
    run(migration);
    run(`
      insert into private.advertising_destinations values
        ('18000000-0000-4000-8000-000000000003','${ids.campaignProduct}','external_url',null,null,'draft');
      insert into private.advertising_ads values
        ('19000000-0000-4000-8000-000000000003','${ids.adSetProduct}','18000000-0000-4000-8000-000000000003','22000000-0000-4000-8000-000000000001','draft','not_submitted',null,null,null);
    `);
    assert.equal(run(`select private.advertising_marketplace_sales_ad_destination_valid('${ids.adProduct}')`), "t");
    assert.equal(run(`select private.advertising_marketplace_sales_ad_destination_valid('${ids.adStore}')`), "t");
    assert.equal(run("select private.advertising_marketplace_sales_ad_destination_valid('19000000-0000-4000-8000-000000000003')"), "f");
    assert.throws(
      () => run("select public.submit_my_advertising_ad_for_review('19000000-0000-4000-8000-000000000003',gen_random_uuid())"),
      /advertising_marketplace_sales_destination_invalid/,
    );
    run(`update public.products set deleted_at=clock_timestamp()where id='${ids.product}'`);
    assert.equal(run(`select private.advertising_marketplace_sales_ad_destination_valid('${ids.adProduct}')`), "f");
    run(`update public.products set deleted_at=null,seller_id='${ids.otherBuyer}'where id='${ids.product}'`);
    assert.equal(run(`select private.advertising_marketplace_sales_ad_destination_valid('${ids.adProduct}')`), "f");
    run(`update public.products set seller_id='${ids.seller}'where id='${ids.product}'`);
    run(`
      insert into public.marketplace_stores values
        ('15000000-0000-4000-8000-000000000099','${ids.seller}','Expired Touch Store','active');
      insert into public.products values
        ('14000000-0000-4000-8000-000000000099','${ids.seller}','15000000-0000-4000-8000-000000000099','active',now(),null,'approved','physical','BDAG');
      insert into private.advertising_campaigns values
        ('16000000-0000-4000-8000-000000000099','marketplace_sales','${ids.account}','draft');
      insert into private.advertising_destinations values
        ('18000000-0000-4000-8000-000000000099','16000000-0000-4000-8000-000000000099','marketplace_product','14000000-0000-4000-8000-000000000099',null,'draft');
      insert into private.advertising_events values
        ('30000000-0000-4000-8000-000000000001','impression','${ids.buyer}','${ids.campaignProduct}','${ids.destinationProduct}',clock_timestamp()-interval '2 hours'),
        ('30000000-0000-4000-8000-000000000002','click','${ids.buyer}','${ids.campaignProduct}','${ids.destinationProduct}',clock_timestamp()-interval '1 hour'),
        ('30000000-0000-4000-8000-000000000003','impression','${ids.buyer}','${ids.campaignStore}','${ids.destinationStore}',clock_timestamp()-interval '1 hour'),
        ('30000000-0000-4000-8000-000000000005','click','${ids.buyer}','${ids.campaignProduct}','${ids.destinationProduct}',clock_timestamp()-interval '25 hours'),
        ('30000000-0000-4000-8000-000000000099','click','${ids.buyer}','16000000-0000-4000-8000-000000000099','18000000-0000-4000-8000-000000000099',clock_timestamp()-interval '25 hours');
      insert into public.marketplace_orders values
        ('40000000-0000-4000-8000-000000000001','${ids.buyer}','confirmed',clock_timestamp(),null,null),
        ('40000000-0000-4000-8000-000000000002','${ids.buyer}','confirmed',clock_timestamp()+interval '1 second',null,null),
        ('40000000-0000-4000-8000-000000000003','${ids.otherBuyer}','confirmed',clock_timestamp()+interval '2 seconds',null,null),
        ('40000000-0000-4000-8000-000000000004','${ids.buyer}','confirmed',clock_timestamp()+interval '3 seconds',null,null),
        ('40000000-0000-4000-8000-000000000005','${ids.buyer}','cancelled',clock_timestamp()+interval '4 seconds',clock_timestamp(),null),
        ('40000000-0000-4000-8000-000000000006','${ids.buyer}','confirmed',(select marketplace_purchase_conversion_started_at-interval '1 second'from private.advertising_event_policy where singleton),null,null),
        ('40000000-0000-4000-8000-000000000007','${ids.buyer}','expired',clock_timestamp()+interval '5 seconds',null,clock_timestamp()),
        ('40000000-0000-4000-8000-000000000008','${ids.buyer}','pending_payment',null,null,null),
        ('40000000-0000-4000-8000-000000000009','${ids.buyer}','confirmed',clock_timestamp()+interval '6 seconds',null,null);
      insert into public.marketplace_order_items values
        ('50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','${ids.product}','${ids.store}',12.50000000,'BDAG'),
        ('50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','${ids.otherProduct}','${ids.store}',8.25000000,'BDAG'),
        ('50000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000003','${ids.product}','${ids.store}',7.00000000,'BDAG'),
        ('50000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000004','${ids.otherProduct}','15000000-0000-4000-8000-000000000099',6.00000000,'BDAG'),
        ('50000000-0000-4000-8000-000000000005','40000000-0000-4000-8000-000000000005','${ids.product}','${ids.store}',5.00000000,'BDAG'),
        ('50000000-0000-4000-8000-000000000006','40000000-0000-4000-8000-000000000006','${ids.product}','${ids.store}',4.00000000,'BDAG'),
        ('50000000-0000-4000-8000-000000000007','40000000-0000-4000-8000-000000000007','${ids.product}','${ids.store}',3.00000000,'BDAG'),
        ('50000000-0000-4000-8000-000000000008','40000000-0000-4000-8000-000000000008','${ids.product}','${ids.store}',2.00000000,'BDAG'),
        ('50000000-0000-4000-8000-000000000009','40000000-0000-4000-8000-000000000009','14000000-0000-4000-8000-000000000099','15000000-0000-4000-8000-000000000099',1.00000000,'BDAG');
    `);
    const before = run("select (select count(*)from public.financial_transactions)||':'||(select count(*)from public.ledger_entries)||':'||(select count(*)from public.marketplace_ad_touches)");
    const result = JSON.parse(run("select public.reconcile_advertising_marketplace_purchase_conversions_v2(100)"));
    assert.equal(result.processed, 5);
    assert.equal(result.converted, 2);
    assert.equal(result.attributed, 2);
    assert.equal(result.skipped_no_touch, 3);
    assert.equal(result.errors, 0);
    assert.equal(run("select count(*)from private.advertising_conversions"), "2");
    assert.equal(run("select count(*)from private.advertising_attributions"), "2");
    assert.equal(run("select count(*)from private.advertising_conversions where source_reference_id='50000000-0000-4000-8000-000000000009'"), "0");
    assert.equal(run("select touch_event_type from private.advertising_attributions where campaign_id='16000000-0000-4000-8000-000000000001'"), "click");
    assert.equal(run("select touch_event_type from private.advertising_attributions where campaign_id='16000000-0000-4000-8000-000000000002'"), "impression");
    assert.equal(run("select value_bdag||':'||currency from private.advertising_conversions where source_reference_id='50000000-0000-4000-8000-000000000001'"), "12.50000000:BDAG");
    run("update private.advertising_event_policy set marketplace_purchase_conversion_cursor_confirmed_at=null,marketplace_purchase_conversion_cursor_order_item_id=null where singleton");
    const concurrent = await Promise.all([
      runAsync("select public.reconcile_advertising_marketplace_purchase_conversions_v2(100)"),
      runAsync("select public.reconcile_advertising_marketplace_purchase_conversions_v2(100)"),
    ]);
    assert.deepEqual(concurrent.map((value) => JSON.parse(value).processed).sort((a,b) => a-b), [0,5]);
    assert.equal(run("select count(*)from private.advertising_conversions"), "2");
    assert.equal(run("select count(*)from private.advertising_attributions"), "2");
    assert.equal(run("select (select count(*)from public.financial_transactions)||':'||(select count(*)from public.ledger_entries)||':'||(select count(*)from public.marketplace_ad_touches)"), before);
    assert.equal(run("select count(*)from cron.job where jobname='reconcile-advertising-marketplace-purchase-conversions-v2'and schedule='* * * * *'and active"), "1");
    assert.equal(run("select has_function_privilege('public','public.reconcile_advertising_marketplace_purchase_conversions_v2(integer)','execute')"), "f");
    assert.equal(run("select has_function_privilege('anon','public.reconcile_advertising_marketplace_purchase_conversions_v2(integer)','execute')"), "f");
    assert.equal(run("select has_function_privilege('authenticated','public.reconcile_advertising_marketplace_purchase_conversions_v2(integer)','execute')"), "f");
    assert.equal(run("select has_function_privilege('service_role','public.reconcile_advertising_marketplace_purchase_conversions_v2(integer)','execute')"), "t");
  } finally {
    run(`select pg_terminate_backend(pid)from pg_stat_activity where datname='${database}'and pid<>pg_backend_pid();drop database if exists ${database}`, "postgres");
  }
});
