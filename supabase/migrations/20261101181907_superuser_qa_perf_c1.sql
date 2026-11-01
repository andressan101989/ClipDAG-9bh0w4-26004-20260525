-- pg-delta: transaction=false

do $migration$
begin
  if to_regclass('cron.job_run_details') is null
     or not exists(select 1 from information_schema.columns where table_schema='cron' and table_name='job_run_details' and column_name='start_time')
     or not exists(select 1 from information_schema.columns where table_schema='cron' and table_name='job_run_details' and column_name='jobid')
     or not exists(select 1 from information_schema.columns where table_schema='cron' and table_name='job_run_details' and column_name='status')
     or not exists(select 1 from information_schema.columns where table_schema='cron' and table_name='job_run_details' and column_name='end_time') then
    raise exception 'superuser_qa_perf_c1_cron_contract_drift';
  end if;
end
$migration$;

-- A failed concurrent build can leave an invalid index. Removing the exact
-- C1 name first makes the canonical migration retry safe without blocking
-- active pg_cron writers for the duration of the build.
drop index concurrently if exists cron.cron_job_run_details_start_job_cover_idx;

create index concurrently cron_job_run_details_start_job_cover_idx
  on cron.job_run_details(start_time desc nulls last,jobid)
  include(status,end_time);

comment on index cron.cron_job_run_details_start_job_cover_idx is
  'C1 time-leading covering index for bounded Admin cron health projections.';

do $migration$
begin
  if not exists(
    select 1
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    join pg_index i on i.indexrelid=c.oid
    where n.nspname='cron'
      and c.relname='cron_job_run_details_start_job_cover_idx'
      and i.indisvalid and i.indisready
  ) or not exists(
    select 1 from pg_indexes
    where schemaname='cron' and tablename='job_run_details'
      and indexname='cron_job_run_details_start_job_cover_idx'
      and indexdef ilike '%(start_time DESC NULLS LAST, jobid) INCLUDE (status, end_time)%'
  ) then
    raise exception 'superuser_qa_perf_c1_index_postcondition_failed';
  end if;
end
$migration$;

begin;

do $migration$
declare
  v_system_oid oid:=to_regprocedure('public.get_admin_system_health()');
  v_marketplace_oid oid:=to_regprocedure('public.get_marketplace_admin_health()');
begin
  if v_system_oid is null or v_marketplace_oid is null then
    raise exception 'superuser_qa_perf_c1_authority_missing';
  end if;
  if not exists(
    select 1 from pg_proc
    where oid=v_system_oid and prosecdef and pg_get_userbyid(proowner)='postgres'
      and proconfig=array['search_path=""']::text[]
  ) or not exists(
    select 1 from pg_proc
    where oid=v_marketplace_oid and prosecdef and pg_get_userbyid(proowner)='postgres'
      and (
        proconfig=array['search_path=pg_catalog, private, public']::text[]
        or proconfig=array['search_path=pg_catalog, private, public','join_collapse_limit=1','from_collapse_limit=1']::text[]
      )
  ) then
    raise exception 'superuser_qa_perf_c1_function_security_drift';
  end if;
  if has_function_privilege('anon',v_system_oid,'execute')
     or not has_function_privilege('authenticated',v_system_oid,'execute')
     or has_function_privilege('service_role',v_system_oid,'execute')
     or has_function_privilege('anon',v_marketplace_oid,'execute')
     or not has_function_privilege('authenticated',v_marketplace_oid,'execute')
     or has_function_privilege('service_role',v_marketplace_oid,'execute') then
    raise exception 'superuser_qa_perf_c1_function_acl_drift';
  end if;
  if not exists(
    select 1
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    join pg_index i on i.indexrelid=c.oid
    where n.nspname='cron'
      and c.relname='cron_job_run_details_start_job_cover_idx'
      and i.indisvalid and i.indisready
  ) then
    raise exception 'superuser_qa_perf_c1_index_missing';
  end if;
  if not exists(
    select 1 from private.creator_premium_finance_policy
    where singleton and activation_mode='general'
      and purchase_enabled and subscription_enabled and refunds_enabled
      and platform_fee_bps=2000 and active_authorization_id is not null
  ) then
    raise exception 'superuser_qa_perf_c1_finance_policy_drift';
  end if;
end
$migration$;

create or replace function public.get_admin_system_health()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_cutoff timestamptz:=statement_timestamp()-interval '24 hours';
  v_runs_24h bigint;
  v_successes_24h bigint;
  v_non_successes_24h bigint;
  v_last_run_at timestamptz;
begin
  perform public.admin_require_capability('system.health.read');

  select
    count(*),
    count(*) filter(where status='succeeded'),
    count(*) filter(where status<>'succeeded')
  into v_runs_24h,v_successes_24h,v_non_successes_24h
  from cron.job_run_details
  where start_time>=v_cutoff;

  select start_time
  into v_last_run_at
  from cron.job_run_details
  order by start_time desc nulls last,runid desc
  limit 1;

  return jsonb_build_object(
    'authority',jsonb_build_object(
      'roles',(select count(*) from private.admin_roles),
      'capabilities',(select count(*) from private.admin_capabilities),
      'role_capabilities',(select count(*) from private.admin_role_capabilities),
      'grant_rules',(select count(*) from private.admin_role_grant_rules),
      'active_assignments_by_role',(select coalesce(jsonb_object_agg(role_code,count),'{}'::jsonb) from (select role_code,count(*) count from private.admin_user_roles where revoked_at is null group by role_code) x),
      'active_super_admins',(select count(*) from private.admin_user_roles where role_code='SUPER_ADMIN' and revoked_at is null)
    ),
    'finance',jsonb_build_object(
      'ledger_accounts',(select count(*) from public.ledger_accounts),
      'financial_transactions',(select count(*) from public.financial_transactions),
      'ledger_entries',(select count(*) from public.ledger_entries),
      'negative_balances',(select count(*) from public.ledger_accounts where balance<0),
      'legacy_app_wallets',(select count(*) from public.app_wallets),
      'legacy_app_wallet_entries',(select count(*) from public.app_wallet_ledger_entries),
      'transaction_statuses',(select coalesce(jsonb_object_agg(status,count),'{}'::jsonb) from (select status,count(*) count from public.financial_transactions group by status) x),
      'settlement_failures',(select count(*) from public.marketplace_settlement_run_failures)
    ),
    'marketplace',jsonb_build_object(
      'settlements',(select count(*) from public.marketplace_order_settlements),
      'refunds',(select count(*) from public.marketplace_return_refunds),
      'settlement_failures',(select count(*) from public.marketplace_settlement_run_failures)
    ),
    'live_battles',jsonb_build_object(
      'active_live_sessions',(select count(*) from public.live_sessions where status='live'),
      'open_battles',(select count(*) from public.live_battles where status in ('pending','accepted','countdown','active'))
    ),
    'media',(select coalesce(jsonb_object_agg(status,count),'{}'::jsonb) from (select status,count(*) count from public.media_assets group by status) x),
    'cron',jsonb_build_object(
      'total_jobs',(select count(*) from cron.job),
      'active_jobs',(select count(*) from cron.job where active),
      'inactive_jobs',(select count(*) from cron.job where not active),
      'runs_24h',v_runs_24h,
      'successes_24h',v_successes_24h,
      'non_successes_24h',v_non_successes_24h,
      'last_run_at',v_last_run_at
    )
  );
end;
$function$;

alter function public.get_marketplace_admin_health()
  set join_collapse_limit=1;
alter function public.get_marketplace_admin_health()
  set from_collapse_limit=1;

revoke all on function public.get_admin_system_health() from public,anon,authenticated,service_role;
grant execute on function public.get_admin_system_health() to authenticated;

comment on function public.get_admin_system_health() is
  'C1 exact Admin health projection with one indexed 24-hour cron aggregate and no global timeout override.';

do $migration$
declare
  v_system_oid oid:='public.get_admin_system_health()'::regprocedure;
  v_marketplace_oid oid:='public.get_marketplace_admin_health()'::regprocedure;
begin
  if not exists(
    select 1
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    join pg_index i on i.indexrelid=c.oid
    where n.nspname='cron'
      and c.relname='cron_job_run_details_start_job_cover_idx'
      and i.indisvalid and i.indisready
  ) then
    raise exception 'superuser_qa_perf_c1_index_postcondition_failed';
  end if;
  if not exists(
    select 1 from pg_proc
    where oid=v_system_oid and prosecdef and pg_get_userbyid(proowner)='postgres'
      and proconfig=array['search_path=""']::text[]
  ) or not exists(
    select 1 from pg_proc
    where oid=v_marketplace_oid and prosecdef and pg_get_userbyid(proowner)='postgres'
      and proconfig=array['search_path=pg_catalog, private, public','join_collapse_limit=1','from_collapse_limit=1']::text[]
  ) then
    raise exception 'superuser_qa_perf_c1_function_postcondition_failed';
  end if;
  if has_function_privilege('anon',v_system_oid,'execute')
     or not has_function_privilege('authenticated',v_system_oid,'execute')
     or has_function_privilege('service_role',v_system_oid,'execute')
     or has_function_privilege('anon',v_marketplace_oid,'execute')
     or not has_function_privilege('authenticated',v_marketplace_oid,'execute')
     or has_function_privilege('service_role',v_marketplace_oid,'execute') then
    raise exception 'superuser_qa_perf_c1_acl_postcondition_failed';
  end if;
  if not exists(
    select 1 from private.creator_premium_finance_policy
    where singleton and activation_mode='general'
      and purchase_enabled and subscription_enabled and refunds_enabled
      and platform_fee_bps=2000 and active_authorization_id is not null
  ) then
    raise exception 'superuser_qa_perf_c1_finance_postcondition_failed';
  end if;
end
$migration$;

commit;
