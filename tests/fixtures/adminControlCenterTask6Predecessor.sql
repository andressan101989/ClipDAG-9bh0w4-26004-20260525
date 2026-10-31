-- Synthetic minimal predecessor, for the Task 6 migration only. No production data.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create schema private;
create schema task6_proof;
create function task6_proof.id(n integer) returns uuid language sql immutable as $$
 select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
-- These fixture helpers model only the capability/visibility/verifier inputs
-- needed by this projection. They do not claim to prove the real Auth or ledger.
create function public.admin_actor_has_capability(cap text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and cap=any(string_to_array(current_setting('task6.capabilities',true),','))
$$;
create function public.admin_require_capability(cap text) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(public.admin_actor_has_capability(cap),false) then
  raise exception using errcode='42501',message='fixture_capability_forbidden';
 end if;
end $$;
create function private.admin_audit_row_visible(domain text,financial boolean) returns boolean
language sql stable security definer set search_path='' as $$
 select domain<>'hidden' and (not financial or public.admin_actor_has_capability('finance.audit.read'))
$$;
create table auth.users(id uuid primary key,created_at timestamptz,last_sign_in_at timestamptz,deleted_at timestamptz);
create table public.videos(id uuid primary key,created_at timestamptz);
create table private.content_safety_alerts(id uuid primary key,created_at timestamptz,status text,severity text);
create table public.stories(id uuid primary key,created_at timestamptz);
create table public.live_sessions(id uuid primary key,started_at timestamptz);
create table public.marketplace_orders(id uuid primary key,created_at timestamptz,confirmed_at timestamptz,currency text,total numeric);
create table public.marketplace_sellers(id uuid primary key,created_at timestamptz);
create table public.financial_transactions(id uuid primary key,created_at timestamptz);
create table public.live_gift_transactions(id uuid primary key,created_at timestamptz,platform_fee_coins numeric);
create table private.creator_premium_purchase_receipts(id uuid primary key,created_at timestamptz,platform_fee_bdag numeric,verified boolean);
create table private.creator_premium_subscription_periods(id uuid primary key,created_at timestamptz,platform_fee_bdag numeric,verified boolean);
create function private.creator_premium_purchase_binding_is_valid_v1(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select verified from private.creator_premium_purchase_receipts where id=p_id),false)
$$;
create function private.creator_premium_subscription_period_fact_is_valid_f2_v1(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select verified from private.creator_premium_subscription_periods where id=p_id),false)
$$;
create table private.business_accounts(id uuid primary key,created_at timestamptz);
create table private.ad_accounts(id uuid primary key,business_account_id uuid);
create table private.advertising_campaigns(id uuid primary key,ad_account_id uuid,name text,objective text,status text,created_at timestamptz);
create table private.advertising_ad_sets(id uuid primary key,campaign_id uuid,name text);
create table private.advertising_creatives(id uuid primary key);
create table private.advertising_creative_versions(id uuid primary key,creative_id uuid,version_number integer,format text,media_asset_id uuid,video_asset_id uuid,primary_text text,headline text,description text,call_to_action text);
create table private.advertising_destinations(id uuid primary key,destination_type text,external_url text,target_user_id uuid,target_business_account_id uuid,target_product_id uuid,target_store_id uuid);
create table private.advertising_ads(id uuid primary key,ad_set_id uuid,creative_version_id uuid,destination_id uuid,name text,status text,review_status text,submission_fingerprint text,submitted_at timestamptz,reviewed_at timestamptz);
create table private.advertising_ad_review_events(id uuid primary key,ad_id uuid,event_type text,reason_code text,note text,actor_user_id uuid,created_at timestamptz);
create table public.media_assets(id uuid primary key,status text,deleted_at timestamptz,visibility text,public_url text,mime_type text);
create table public.video_assets(id uuid primary key,status text,deleted_at timestamptz,thumbnail_url text,hls_url text,mime_type text);
create table private.advertising_financial_events(id uuid primary key,created_at timestamptz,event_type text,amount_bdag numeric);
create table private.admin_action_audit(id uuid primary key,created_at timestamptz,action text,domain text,financial_effect boolean);
-- Minimal old function identity must survive a failed migration transaction.
create function public.search_admin_advertising_ads(p_review_status text default null,p_limit integer default 50)
returns jsonb language sql stable as $$select '{"items":[]}'::jsonb$$;

insert into auth.users select task6_proof.id(n),('2026-08-02'::date+n-1)::timestamp at time zone 'UTC','2026-10-30 12:00Z',null from generate_series(1,90) n;
insert into auth.users values
 (task6_proof.id(100),'2026-10-29 23:59:59.999999Z','2026-10-29 23:59Z',null),
 (task6_proof.id(101),'2026-10-30 00:00Z','2026-10-30 00:00Z',null),
 (task6_proof.id(102),'2026-10-30 23:59:59.999999Z','2026-10-31 00:00Z',null),
 (task6_proof.id(103),'2026-10-31 00:00Z','2026-10-31 00:00Z',null),
 (task6_proof.id(104),'2026-10-30 11:00Z','2026-10-30 11:00Z','2026-10-30 12:00Z');
insert into public.videos values(task6_proof.id(1),'2026-10-30 00:00Z'),(task6_proof.id(2),'2026-10-30 23:59:59.999999Z'),(task6_proof.id(3),'2026-10-31 00:00Z');
insert into private.content_safety_alerts values
 (task6_proof.id(1),'2026-10-30 12:00Z','open','critical'),
 (task6_proof.id(2),'2026-10-30 12:00Z','in_review','low'),
 (task6_proof.id(3),'2026-10-30 12:00Z','resolved','high');
insert into public.stories values(task6_proof.id(1),'2026-10-30 12:00Z');
insert into public.live_sessions values(task6_proof.id(1),'2026-10-30 12:00Z');
insert into public.marketplace_orders values(task6_proof.id(1),'2026-10-30 12:00Z','2026-10-30 13:00Z','BDAG',15.5);
insert into public.marketplace_sellers values(task6_proof.id(1),'2026-10-30 12:00Z');
insert into public.financial_transactions values(task6_proof.id(1),'2026-10-30 12:00Z');
insert into public.live_gift_transactions values(task6_proof.id(1),'2026-10-30 12:00Z',3.5);
insert into private.creator_premium_purchase_receipts values(task6_proof.id(1),'2026-10-30 12:00Z',2,true),(task6_proof.id(2),'2026-10-29 12:00Z',99,false);
insert into private.creator_premium_subscription_periods values(task6_proof.id(1),'2026-10-30 12:00Z',4,true);
insert into private.business_accounts values(task6_proof.id(1),'2026-10-30 12:00Z');
insert into private.ad_accounts values(task6_proof.id(1),task6_proof.id(1));
insert into private.advertising_campaigns values(task6_proof.id(1),task6_proof.id(1),'Synthetic campaign','awareness','active','2026-10-30 12:00Z');
insert into private.advertising_ad_sets values(task6_proof.id(1),task6_proof.id(1),'Synthetic set');
insert into private.advertising_creatives values(task6_proof.id(1));
insert into public.media_assets values(task6_proof.id(1),'ready',null,'public','https://pub-d146e3d06d274db4871f5b6020fd850f.r2.dev/task6-synthetic.png','image/png');
insert into private.advertising_creative_versions values(task6_proof.id(1),task6_proof.id(1),1,'image',task6_proof.id(1),null,'Synthetic copy','Synthetic headline','Synthetic description','learn_more');
insert into private.advertising_destinations values(task6_proof.id(1),'external_url','https://example.invalid/task6',null,null,null,null);
insert into private.advertising_ads select task6_proof.id(n),task6_proof.id(1),task6_proof.id(1),task6_proof.id(1),'Synthetic ad '||n,'draft',case when n=105 then 'rejected' else 'pending' end,'fingerprint-'||n,
 case when n<=50 then '2026-10-30 10:00Z'::timestamptz when n<=100 then '2026-10-30 11:00Z'::timestamptz else null end,null from generate_series(1,105) n;
insert into private.advertising_ad_review_events values
 (task6_proof.id(1),task6_proof.id(105),'approved',null,null,task6_proof.id(1),'2026-10-30 11:00Z'),
 (task6_proof.id(2),task6_proof.id(105),'rejected','policy_violation','Synthetic internal note',task6_proof.id(1),'2026-10-30 12:00Z');
insert into private.advertising_financial_events values(task6_proof.id(1),'2026-10-30 12:00Z','spend',7.25),(task6_proof.id(2),'2026-10-30 12:00Z','fund',100);
insert into private.admin_action_audit select task6_proof.id(n),'2026-10-30 12:00Z','synthetic.read',case when n=12 then 'hidden' else 'users' end,false from generate_series(1,12) n;
create table public.reports(id uuid primary key,created_at timestamptz,status text);
insert into public.reports values(task6_proof.id(1),'2026-10-30 12:00Z','pending'),(task6_proof.id(2),'2026-10-30 12:00Z','reviewed');

create function task6_proof.row_snapshot() returns jsonb language plpgsql set timezone='UTC' as $$
declare r record; digest text; result jsonb:='{}'::jsonb;
begin
 for r in select schemaname,tablename from pg_tables where schemaname in ('auth','public','private') order by 1,2 loop
  execute format('select md5(coalesce(string_agg(to_jsonb(t)::text,%L order by id),%L)) from %I.%I t','','',r.schemaname,r.tablename) into digest;
  result:=result||jsonb_build_object(r.schemaname||'.'||r.tablename,digest);
 end loop;
 return result;
end $$;
create table task6_proof.baseline(snapshot jsonb);
insert into task6_proof.baseline select task6_proof.row_snapshot();
create function task6_proof.assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERT: %',message;end if;end $$;
create function task6_proof.metric(data jsonb,key text) returns jsonb language sql immutable as $$
 select value->'value' from jsonb_array_elements(data->'metrics') where value->>'key'=$2
$$;
-- Fixture data is not directly readable by the browser roles.
revoke all on all tables in schema public,private,auth from public,anon,authenticated,service_role;
grant usage on schema task6_proof to authenticated;
grant execute on all functions in schema task6_proof to authenticated;
