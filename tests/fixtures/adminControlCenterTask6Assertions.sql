select version();
select task6_proof.assert(to_regprocedure('public.get_admin_control_center_overview_v1(text,date,date)') is not null,'overview identity exists');
select task6_proof.assert(to_regprocedure('public.search_admin_advertising_ads(text,integer,timestamp with time zone,uuid,uuid)') is not null,'new review identity exists');
select task6_proof.assert(to_regprocedure('public.search_admin_advertising_ads(text,integer)') is null,'old review overload removed');
do $$declare r record;begin
 for r in select * from pg_proc where oid in (
  'public.get_admin_control_center_overview_v1(text,date,date)'::regprocedure,
  'public.search_admin_advertising_ads(text,integer,timestamptz,uuid,uuid)'::regprocedure
 ) loop
  perform task6_proof.assert(pg_get_userbyid(r.proowner)='postgres',r.proname||' owner');
  perform task6_proof.assert(r.prosecdef and r.provolatile='s',r.proname||' stable definer');
  perform task6_proof.assert(r.proconfig @> array['search_path=""'],r.proname||' empty search_path');
  perform task6_proof.assert(has_function_privilege('authenticated',r.oid,'EXECUTE'),r.proname||' authenticated execute');
  perform task6_proof.assert(not has_function_privilege('anon',r.oid,'EXECUTE') and not has_function_privilege('service_role',r.oid,'EXECUTE'),r.proname||' restricted direct ACL');
  perform task6_proof.assert(not exists(select 1 from aclexplode(r.proacl) where grantee=0 and privilege_type='EXECUTE'),r.proname||' no PUBLIC execute');
  raise notice 'METADATA PASS: % owner=% security_definer=% search_path=% args=%',r.proname,pg_get_userbyid(r.proowner),r.prosecdef,r.proconfig,pg_get_function_identity_arguments(r.oid);
 end loop;
end $$;
select set_config('request.jwt.claim.sub',task6_proof.id(1)::text,false);
select set_config('task6.capabilities','admin.shell.access,users.accounts.read,content.items.read,stories.items.read,live.sessions.read,marketplace.overview.read,finance.ledger.read,advertising.ads.read,reports.cases.read,admin.audit.read,advertising.billing.read',false);
set role authenticated;
set timezone='America/Los_Angeles';
do $$
declare domain text; data jsonb; invalid record; amount jsonb;
begin
 begin perform count(*) from auth.users;raise exception 'expected direct table denial';exception when insufficient_privilege then null;end;
 foreach domain in array array['users','content','stories','live','marketplace','finance','premium','ads','reports','activity'] loop
  data:=public.get_admin_control_center_overview_v1(domain,'2026-10-30','2026-10-30');
  perform task6_proof.assert(data->>'authority'='admin_control_center_v1' and data->>'module'=domain and data->>'timezone'='UTC',domain||' authority/UTC');
  perform task6_proof.assert(data->>'from'='2026-10-30' and data->>'to'='2026-10-30',domain||' inclusive date echo');
  perform task6_proof.assert(jsonb_array_length(data->'metrics')<=16 and jsonb_array_length(data->'series')<=90 and jsonb_array_length(data->'recent')<=8,domain||' output bounds');
  perform task6_proof.assert(data-array['authority','module','timezone','from','to','metrics','series','recent']='{}'::jsonb,domain||' aggregate-only root keys');
  perform task6_proof.assert(not exists(select 1 from jsonb_array_elements(data->'recent') row where row-array['at','action','domain']<>'{}'::jsonb),domain||' recent contains no identity/target/metadata');
  raise notice 'DOMAIN PASS: % metrics=% buckets=% recent=%',domain,jsonb_array_length(data->'metrics'),jsonb_array_length(data->'series'),jsonb_array_length(data->'recent');
 end loop;
 data:=public.get_admin_control_center_overview_v1('users','2026-10-30','2026-10-30');
 perform task6_proof.assert(task6_proof.metric(data,'users')='3'::jsonb,'UTC midnight/microsecond boundary and deleted exclusion');
 perform task6_proof.assert(data->'series'='[{"day":"2026-10-30","value":3}]'::jsonb,'UTC user trend uses the same cohort despite session timezone');
 perform task6_proof.assert(task6_proof.metric(data,'active')='null'::jsonb and task6_proof.metric(data,'creators')='null'::jsonb,'unsupported activity/creator facts are not zero');
 data:=public.get_admin_control_center_overview_v1('users','2026-08-02','2026-10-30');
 perform task6_proof.assert(jsonb_array_length(data->'series')=90,'inclusive maximum90 returns at most90 daily buckets');
 perform public.get_admin_control_center_overview_v1('users','2024-02-29','2024-02-29');
 for invalid in select * from(values(null::date,'2026-10-30'::date),('2026-10-30'::date,null::date),('2026-10-30'::date,'2026-10-29'::date),('2026-08-01'::date,'2026-10-30'::date),('-infinity'::date,'2026-10-30'::date),('2026-10-30'::date,'infinity'::date)) t(first,last) loop
  begin perform public.get_admin_control_center_overview_v1('users',invalid.first,invalid.last);raise exception 'expected invalid range';exception when invalid_parameter_value then null;end;
 end loop;
 begin perform public.get_admin_control_center_overview_v1('users','2026-02-29'::date,'2026-03-01');raise exception 'expected invalid calendar date';exception when datetime_field_overflow then null;end;
 begin perform public.get_admin_control_center_overview_v1('unknown','2026-10-30','2026-10-30');raise exception 'expected invalid module';exception when invalid_parameter_value then null;end;
 data:=public.get_admin_control_center_overview_v1('content','2026-10-30','2026-10-30');
 perform task6_proof.assert(task6_proof.metric(data,'posts')='2'::jsonb and task6_proof.metric(data,'safety')='2'::jsonb and task6_proof.metric(data,'priority_safety')='1'::jsonb,'canonical content/alert counts');
 data:=public.get_admin_control_center_overview_v1('marketplace','2026-10-30','2026-10-30');
 perform task6_proof.assert(task6_proof.metric(data,'orders')='1'::jsonb and task6_proof.metric(data,'sales')='15.5'::jsonb and task6_proof.metric(data,'sellers')='1'::jsonb,'canonical marketplace facts');
 data:=public.get_admin_control_center_overview_v1('finance','2026-10-30','2026-10-30');
 perform task6_proof.assert(task6_proof.metric(data,'transactions')='1'::jsonb and task6_proof.metric(data,'gift_fees')='3.5'::jsonb and task6_proof.metric(data,'income')='null'::jsonb,'finance count/gift fee/unavailable income');
 data:=public.get_admin_control_center_overview_v1('premium','2026-10-30','2026-10-30');
 perform task6_proof.assert(task6_proof.metric(data,'commission')='6'::jsonb,'premium sum accepts verifier-approved fixture facts');
 data:=public.get_admin_control_center_overview_v1('premium','2026-10-29','2026-10-29');
 perform task6_proof.assert(task6_proof.metric(data,'commission')='null'::jsonb,'premium verifier failure produces unavailable');
 data:=public.get_admin_control_center_overview_v1('ads','2026-10-30','2026-10-30');
 perform task6_proof.assert(task6_proof.metric(data,'spend')='7.25'::jsonb,'Ads spend excludes funding');
 data:=public.get_admin_control_center_overview_v1('activity','2026-10-30','2026-10-30');
 perform task6_proof.assert(jsonb_array_length(data->'recent')=8 and not exists(select 1 from jsonb_array_elements(data->'recent') row where row->>'domain'='hidden'),'recent bounded visibility helper honored');
 data:=public.get_admin_control_center_overview_v1('users','2020-01-01','2020-01-01');
 perform task6_proof.assert(task6_proof.metric(data,'users')='0'::jsonb and data->'series'='[]'::jsonb,'real empty aggregate is zero with empty buckets');
 raise notice 'DATE/DOMAIN BEHAVIOR PASS';
end $$;
select set_config('task6.capabilities','admin.shell.access,advertising.ads.read',false);
do $$declare data jsonb;begin
 data:=public.get_admin_control_center_overview_v1('ads','2026-10-30','2026-10-30');
 perform task6_proof.assert(task6_proof.metric(data,'spend')='null'::jsonb,'Ads spend independently denied without billing');
 begin perform public.get_admin_control_center_overview_v1('users','2026-10-30','2026-10-30');raise exception 'expected domain denial';exception when insufficient_privilege then null;end;
 begin perform public.search_admin_advertising_ads();raise exception 'expected review capability denial';exception when insufficient_privilege then null;end;
end $$;
select set_config('task6.capabilities','content.items.read',false);
do $$begin
 begin perform public.get_admin_control_center_overview_v1('content','2026-10-30','2026-10-30');raise exception 'expected shell denial';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','',false);
do $$begin
 begin perform public.search_admin_advertising_ads();raise exception 'expected unauthenticated denial';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub',task6_proof.id(1)::text,false);
do $$declare page jsonb; next_page jsonb; tail jsonb; record_ids uuid[]; bad integer;begin
 page:=public.search_admin_advertising_ads(null,50);
 perform task6_proof.assert(jsonb_array_length(page->'items')=50 and page->'next_cursor'->>'id'=task6_proof.id(50)::text,'page1 bounded lookahead and tie ID');
 perform task6_proof.assert(page->'items'->0->>'id'=task6_proof.id(1)::text and page->'items'->0->>'submission_fingerprint'='fingerprint-1','page1 payload/order/fingerprint');
 perform task6_proof.assert(page->'items'->0->'creative'->>'preview_url' like 'https://pub-%/task6-synthetic.png','canonical safe creative preview retained');
 next_page:=public.search_admin_advertising_ads(null,50,(page->'next_cursor'->>'submitted_at')::timestamptz,(page->'next_cursor'->>'id')::uuid);
 perform task6_proof.assert(jsonb_array_length(next_page->'items')=50 and next_page->'items'->0->>'id'=task6_proof.id(51)::text and next_page->'next_cursor'->>'id'=task6_proof.id(100)::text,'page2 real timestamp/ID keyset');
 tail:=public.search_admin_advertising_ads(null,50,(next_page->'next_cursor'->>'submitted_at')::timestamptz,(next_page->'next_cursor'->>'id')::uuid);
 perform task6_proof.assert(jsonb_array_length(tail->'items')=5 and tail->'items'->0->>'id'=task6_proof.id(101)::text and tail->'next_cursor'='null'::jsonb,'nonnull cursor enters null tail and terminal is honest');
 page:=public.search_admin_advertising_ads(null,2,'2026-10-30 11:00Z',task6_proof.id(100));
 perform task6_proof.assert(page->'next_cursor'->'submitted_at'='null'::jsonb and page->'next_cursor'->>'id'=task6_proof.id(102)::text,'nullable cursor emitted within tail');
 next_page:=public.search_admin_advertising_ads(null,2,null,task6_proof.id(102));
 perform task6_proof.assert(next_page->'items'->0->>'id'=task6_proof.id(103)::text and next_page->'next_cursor'->>'id'=task6_proof.id(104)::text,'null cursor remains in null tail');
 page:=public.search_admin_advertising_ads(null,2,null,task6_proof.id(103));
 perform task6_proof.assert(jsonb_array_length(page->'items')=2 and page->'next_cursor'='null'::jsonb,'exact-full terminal has no invented cursor');
 page:=public.search_admin_advertising_ads(null,2,null,task6_proof.id(105));
 perform task6_proof.assert(page='{"items":[],"next_cursor":null}'::jsonb,'empty terminal output');
 page:=public.search_admin_advertising_ads(null,1,null,null,task6_proof.id(105));
 perform task6_proof.assert(jsonb_array_length(page->'items')=1 and page->'items'->0->>'submission_fingerprint'='fingerprint-105' and page->'items'->0->'latest_decision'->>'event_type'='rejected','exact target outside page1 reconciles latest fingerprint/decision');
 page:=public.search_admin_advertising_ads(p_review_status=>'rejected',p_limit=>1);
 perform task6_proof.assert(page->'items'->0->>'id'=task6_proof.id(105)::text and page->'next_cursor'='null'::jsonb,'review status and old named/default caller compatibility');
 page:=public.search_admin_advertising_ads(null,100);
 perform task6_proof.assert(jsonb_array_length(page->'items')=100 and page->'next_cursor'->>'id'=task6_proof.id(100)::text,'maximum bounded100 page');
 foreach bad in array array[0,101,null::integer] loop
  begin perform public.search_admin_advertising_ads(null,bad);raise exception 'expected invalid limit';exception when invalid_parameter_value then null;end;
 end loop;
 begin perform public.search_admin_advertising_ads('invalid');raise exception 'expected invalid status';exception when invalid_parameter_value then null;end;
 begin perform public.search_admin_advertising_ads(null,50,'2026-10-30',null);raise exception 'expected incomplete cursor denial';exception when invalid_parameter_value then null;end;
 begin perform public.search_admin_advertising_ads(null,50,null,task6_proof.id(1),task6_proof.id(2));raise exception 'expected target/cursor conflict denial';exception when invalid_parameter_value then null;end;
 raise notice 'ADS KEYSET/LOOKAHEAD/EXACT-ID PASS';
end $$;
reset role;
select task6_proof.assert(task6_proof.row_snapshot()=(select snapshot from task6_proof.baseline),'every synthetic domain row unchanged by migration and reads');
select 'TASK6 DISPOSABLE PROOF PASS; all 10 overview domains executed; no fixture domain rows mutated' as result;
