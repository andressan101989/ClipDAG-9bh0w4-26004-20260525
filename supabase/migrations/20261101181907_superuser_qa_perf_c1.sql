begin;

do $migration$
declare
  v_system_oid oid:=to_regprocedure('public.get_admin_system_health()');
  v_marketplace_oid oid:=to_regprocedure('public.get_marketplace_admin_health()');
begin
  if v_system_oid is null or v_marketplace_oid is null then
    raise exception 'superuser_qa_perf_c1_authority_missing';
  end if;

  -- pg_cron is Supabase-managed. C1 consumes the existing runid PK without
  -- mutating the extension-owned schema or relation.
  if not exists(
    select 1
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='cron' and c.relname='job_run_details' and c.relkind='r'
      and pg_get_userbyid(n.nspowner)='supabase_admin'
      and pg_get_userbyid(c.relowner)='supabase_admin'
  ) or not exists(
    select 1 from pg_attribute a
    where a.attrelid='cron.job_run_details'::regclass and a.attname='runid' and not a.attisdropped
  ) or not exists(
    select 1 from pg_attribute a
    where a.attrelid='cron.job_run_details'::regclass and a.attname='start_time' and not a.attisdropped
  ) or not exists(
    select 1 from pg_attribute a
    where a.attrelid='cron.job_run_details'::regclass and a.attname='status' and not a.attisdropped
  ) or not exists(
    select 1
    from pg_index i
    join pg_class index_class on index_class.oid=i.indexrelid
    where i.indrelid='cron.job_run_details'::regclass
      and index_class.relname='job_run_details_pkey'
      and i.indisprimary and i.indisunique and i.indisvalid and i.indisready
      and i.indnkeyatts=1 and i.indnatts=1
      and i.indexprs is null and i.indpred is null
      and pg_get_indexdef(i.indexrelid,1,true)='runid'
  ) or to_regclass('cron.cron_job_run_details_start_job_cover_idx') is not null then
    raise exception 'superuser_qa_perf_c1_cron_contract_drift';
  end if;

  if not exists(
    select 1 from pg_proc
    where oid=v_system_oid and prosecdef and pg_get_userbyid(proowner)='postgres'
      and proconfig=array['search_path=""']::text[]
  ) or not exists(
    select 1 from pg_proc
    where oid=v_marketplace_oid and prosecdef and pg_get_userbyid(proowner)='postgres'
      and (proconfig=array['search_path=pg_catalog, private, public']::text[]
        or proconfig=array['search_path=pg_catalog, private, public','join_collapse_limit=1','from_collapse_limit=1']::text[])
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
  v_probe_limit constant integer:=50000;
  v_sampled_rows bigint;
  v_oldest_sampled_start timestamptz;
  v_runs_24h bigint;
  v_successes_24h bigint;
  v_non_successes_24h bigint;
  v_last_run_at timestamptz;
  v_history_window_complete boolean;
begin
  perform public.admin_require_capability('system.health.read');

  select count(*),min(start_time) filter(where start_time is not null),
    count(*) filter(where start_time>=v_cutoff),
    count(*) filter(where start_time>=v_cutoff and status='succeeded'),
    count(*) filter(where start_time>=v_cutoff and status<>'succeeded'),max(start_time)
  into v_sampled_rows,v_oldest_sampled_start,v_runs_24h,
    v_successes_24h,v_non_successes_24h,v_last_run_at
  from(
    select start_time,status
    from cron.job_run_details
    order by runid desc
    limit v_probe_limit
  ) recent;

  -- Only an unsaturated probe proves that every retained row was examined.
  -- A saturated sample remains unavailable even when its oldest timestamp is
  -- outside the cutoff; this avoids assuming runid/start_time monotonicity.
  v_history_window_complete:=v_sampled_rows<v_probe_limit;

  if not v_history_window_complete then
    v_runs_24h:=null;
    v_successes_24h:=null;
    v_non_successes_24h:=null;
    v_last_run_at:=null;
  end if;

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
      'last_run_at',v_last_run_at,
      'run_metrics_available',v_history_window_complete,
      'run_metrics_reason',case when v_history_window_complete then null else 'history_probe_limit_reached' end,
      'history_probe_limit',v_probe_limit,
      'history_sampled_rows',v_sampled_rows,
      'history_oldest_sampled_at',v_oldest_sampled_start
    )
  );
end;
$function$;

alter function public.get_marketplace_admin_health() set join_collapse_limit=1;
alter function public.get_marketplace_admin_health() set from_collapse_limit=1;

revoke all on function public.get_admin_system_health() from public,anon,authenticated,service_role;
grant execute on function public.get_admin_system_health() to authenticated;

comment on function public.get_admin_system_health() is
  'C1 bounded Admin health projection: exact 24-hour cron metrics only when a 50k runid probe proves complete; otherwise explicit unavailable.';

do $migration$
declare
  v_system_oid oid:='public.get_admin_system_health()'::regprocedure;
  v_marketplace_oid oid:='public.get_marketplace_admin_health()'::regprocedure;
begin
  if not exists(
    select 1
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='cron' and c.relname='job_run_details' and c.relkind='r'
      and pg_get_userbyid(n.nspowner)='supabase_admin'
      and pg_get_userbyid(c.relowner)='supabase_admin'
  ) or not exists(
    select 1
    from pg_index i
    join pg_class index_class on index_class.oid=i.indexrelid
    where i.indrelid='cron.job_run_details'::regclass
      and index_class.relname='job_run_details_pkey'
      and i.indisprimary and i.indisunique and i.indisvalid and i.indisready
      and i.indnkeyatts=1 and i.indnatts=1
      and i.indexprs is null and i.indpred is null
      and pg_get_indexdef(i.indexrelid,1,true)='runid'
  ) or to_regclass('cron.cron_job_run_details_start_job_cover_idx') is not null then
    raise exception 'superuser_qa_perf_c1_cron_postcondition_failed';
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
