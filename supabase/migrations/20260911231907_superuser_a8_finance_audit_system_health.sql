begin;

-- A8 is intentionally projection-only. No business or financial data is mutated.
do $$
begin
  if (select count(*) from private.admin_roles) <> 6
     or (select count(*) from private.admin_capabilities) <> 47
     or (select count(*) from private.admin_role_capabilities) <> 142
     or (select count(*) from private.admin_role_grant_rules) <> 7 then
    raise exception 'a8_authority_catalog_drift';
  end if;
  if (select count(*) from private.admin_user_roles where role_code='SUPER_ADMIN' and revoked_at is null) <> 0 then
    raise exception 'a8_super_admin_must_remain_unprovisioned';
  end if;
  if (select count(*) from private.admin_capabilities where capability_code in (
    'admin.audit.read','finance.ledger.read','finance.audit.read','finance.reconciliation.read',
    'finance.anomalies.read','system.audit.read','system.health.read','system.jobs.read'
  )) <> 8 then
    raise exception 'a8_capability_contract_drift';
  end if;
end $$;

create or replace function private.admin_audit_safe_metadata(
  p_metadata jsonb,
  p_contains_pii boolean,
  p_financial_scope boolean
) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'result', p_metadata -> 'result',
    'result_kind', p_metadata -> 'result_kind',
    'status', p_metadata -> 'status',
    'previous_status', p_metadata -> 'previous_status',
    'final_status', p_metadata -> 'final_status',
    'changed', p_metadata -> 'changed',
    'money_moved', case when p_financial_scope then p_metadata -> 'money_moved' end,
    'already_released', case when p_financial_scope then p_metadata -> 'already_released' end,
    'migration', case when not p_contains_pii then p_metadata -> 'migration' end,
    'legacy_role', case when not p_contains_pii then p_metadata -> 'legacy_role' end,
    'source', case when not p_contains_pii then p_metadata -> 'source' end,
    'action', case when not p_contains_pii then p_metadata -> 'action' end,
    'target_type', case when not p_contains_pii then p_metadata -> 'target_type' end
  ));
$$;

create or replace function private.admin_audit_row_visible(
  p_domain text,
  p_financial_effect boolean
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (not coalesce(p_financial_effect,false)
      or public.admin_actor_has_capability('finance.audit.read'))
    and case p_domain
      when 'admin' then public.admin_actor_has_capability('admin.roles.read')
      when 'users' then public.admin_actor_has_capability('users.accounts.read')
      when 'reports' then public.admin_actor_has_capability('reports.cases.read')
      when 'content' then public.admin_actor_has_capability('content.items.read')
      when 'stories' then public.admin_actor_has_capability('stories.items.read')
      when 'chat' then public.admin_actor_has_capability('chat.abuse_reports.read')
      when 'live' then public.admin_actor_has_capability('live.sessions.read')
      when 'battles' then public.admin_actor_has_capability('battles.sessions.read')
      when 'media' then public.admin_actor_has_capability('media.assets.read')
      when 'marketplace' then public.admin_actor_has_capability('marketplace.audit.read')
      when 'finance' then public.admin_actor_has_capability('finance.audit.read')
      when 'system' then public.admin_actor_has_capability('system.audit.read')
      else false
    end;
$$;

revoke all on function private.admin_audit_safe_metadata(jsonb,boolean,boolean) from public,anon,authenticated,service_role;
revoke all on function private.admin_audit_row_visible(text,boolean) from public,anon,authenticated,service_role;

create or replace function public.get_admin_finance_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_require_capability('finance.ledger.read');
  return jsonb_build_object(
    'ledger_account_count',(select count(*) from public.ledger_accounts),
    'financial_transaction_count',(select count(*) from public.financial_transactions),
    'ledger_entry_count',(select count(*) from public.ledger_entries),
    'transactions_by_status',(select coalesce(jsonb_agg(jsonb_build_object('status',x.status,'count',x.count) order by x.status),'[]'::jsonb) from (select status,count(*) count from public.financial_transactions group by status) x),
    'transactions_by_operation',(select coalesce(jsonb_agg(jsonb_build_object('operation_type',x.operation_type,'status',x.status,'count',x.count) order by x.operation_type,x.status),'[]'::jsonb) from (select operation_type,status,count(*) count from public.financial_transactions group by operation_type,status) x),
    'accounts_by_type',(select coalesce(jsonb_agg(jsonb_build_object('account_type',x.account_type,'currency',x.currency,'account_count',x.account_count,'balance_total',x.balance_total) order by x.account_type,x.currency),'[]'::jsonb) from (select account_type,currency,count(*) account_count,sum(balance) balance_total from public.ledger_accounts group by account_type,currency) x),
    'frozen_account_count',(select count(*) from public.ledger_accounts where frozen),
    'marketplace_settlement_count',(select count(*) from public.marketplace_order_settlements),
    'marketplace_refund_count',(select count(*) from public.marketplace_return_refunds),
    'blockchain_settlements_by_status',(select coalesce(jsonb_agg(jsonb_build_object('status',x.status,'count',x.count) order by x.status),'[]'::jsonb) from (select status,count(*) count from public.blockchain_settlements group by status) x),
    'legacy_wallet_rows',jsonb_build_object(
      'app_wallets',(select count(*) from public.app_wallets),
      'app_wallet_ledger_entries',(select count(*) from public.app_wallet_ledger_entries)
    )
  );
end;
$$;

create or replace function public.get_admin_system_health()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  perform public.admin_require_capability('system.health.read');
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
      'runs_24h',(select count(*) from cron.job_run_details where start_time>=clock_timestamp()-interval '24 hours'),
      'successes_24h',(select count(*) from cron.job_run_details where start_time>=clock_timestamp()-interval '24 hours' and status='succeeded'),
      'non_successes_24h',(select count(*) from cron.job_run_details where start_time>=clock_timestamp()-interval '24 hours' and status<>'succeeded'),
      'last_run_at',(select max(start_time) from cron.job_run_details)
    )
  );
end;
$$;

create or replace function public.search_admin_system_jobs(
  p_query text default null,
  p_active boolean default null,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('system.jobs.read');
  return (
    with page as (
      select j.jobid,j.jobname,j.schedule,j.active,
        lr.status last_status,lr.start_time last_started_at,lr.end_time last_ended_at,
        case when lr.end_time is not null then floor(extract(epoch from (lr.end_time-lr.start_time))*1000)::bigint end duration_ms,
        (select count(*) from cron.job_run_details r where r.jobid=j.jobid and r.start_time>=clock_timestamp()-interval '24 hours') runs_24h,
        (select count(*) from cron.job_run_details r where r.jobid=j.jobid and r.start_time>=clock_timestamp()-interval '24 hours' and r.status<>'succeeded') failures_24h
      from cron.job j
      left join lateral (select r.status,r.start_time,r.end_time from cron.job_run_details r where r.jobid=j.jobid order by r.start_time desc limit 1) lr on true
      where (p_query is null or j.jobname ilike '%'||p_query||'%')
        and (p_active is null or j.active=p_active)
      order by j.jobname,j.jobid limit v_limit
    )
    select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
      'job_id',jobid,'job_name',jobname,'schedule',schedule,'active',active,
      'last_run',case when last_started_at is null then null else jsonb_build_object('status',last_status,'started_at',last_started_at,'ended_at',last_ended_at,'duration_ms',duration_ms) end,
      'runs_24h',runs_24h,'failures_24h',failures_24h
    ) order by jobname,jobid),'[]'::jsonb)) from page
  );
end;
$$;

create or replace function public.get_admin_system_job_detail(p_job_id bigint)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_job record;
begin
  perform public.admin_require_capability('system.jobs.read');
  select jobid,jobname,schedule,active into v_job from cron.job where jobid=p_job_id;
  if not found then raise exception using errcode='P0002',message='system_job_not_found'; end if;
  return jsonb_build_object(
    'job',jsonb_build_object('job_id',v_job.jobid,'job_name',v_job.jobname,'schedule',v_job.schedule,'active',v_job.active),
    'runs',(select coalesce(jsonb_agg(jsonb_build_object(
      'run_id',r.runid,'status',r.status,'started_at',r.start_time,'ended_at',r.end_time,
      'duration_ms',case when r.end_time is not null then floor(extract(epoch from (r.end_time-r.start_time))*1000)::bigint end,
      'error_present',(r.status<>'succeeded')
    ) order by r.start_time desc),'[]'::jsonb) from (select * from cron.job_run_details where jobid=p_job_id order by start_time desc limit 100) r)
  );
end;
$$;

create or replace function public.search_admin_ledger_accounts(
  p_account_type text default null,
  p_currency text default null,
  p_frozen boolean default null,
  p_owner_id uuid default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('finance.ledger.read');
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then raise exception using errcode='22023',message='invalid_cursor'; end if;
  return (
    with page as (
      select a.id,a.owner_id,a.account_type,a.currency,a.balance,a.frozen,a.created_at,a.updated_at,
             p.username,p.display_name,p.avatar_url
      from public.ledger_accounts a left join public.user_profiles p on p.id=a.owner_id
      where (p_account_type is null or a.account_type=p_account_type)
        and (p_currency is null or a.currency=p_currency)
        and (p_frozen is null or a.frozen=p_frozen)
        and (p_owner_id is null or a.owner_id=p_owner_id)
        and (p_cursor_created_at is null or (a.created_at,a.id)<(p_cursor_created_at,p_cursor_id))
      order by a.created_at desc,a.id desc limit v_limit
    )
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'id',id,'account_type',account_type,'currency',currency,'balance',balance,'frozen',frozen,
        'created_at',created_at,'updated_at',updated_at,
        'owner',case when owner_id is null then null else jsonb_build_object('id',owner_id,'username',username,'display_name',display_name,'avatar_url',avatar_url) end
      ) order by created_at desc,id desc) from page),'[]'::jsonb),
      'next_cursor',(select jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1)
    )
  );
end;
$$;

create or replace function public.search_admin_financial_transactions(
  p_operation_type text default null,
  p_status text default null,
  p_currency text default null,
  p_reference_type text default null,
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('finance.ledger.read');
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then raise exception using errcode='22023',message='invalid_cursor'; end if;
  return (
    with page as (
      select t.id,t.operation_type,t.amount,t.fee_amount,t.currency,t.status,t.reference_type,t.created_at,
             (select count(*) from public.ledger_entries e where e.txn_id=t.id) entry_count
      from public.financial_transactions t
      where (p_operation_type is null or t.operation_type=p_operation_type)
        and (p_status is null or t.status=p_status)
        and (p_currency is null or t.currency=p_currency)
        and (p_reference_type is null or t.reference_type=p_reference_type)
        and (p_created_from is null or t.created_at>=p_created_from)
        and (p_created_to is null or t.created_at<p_created_to)
        and (p_cursor_created_at is null or (t.created_at,t.id)<(p_cursor_created_at,p_cursor_id))
      order by t.created_at desc,t.id desc limit v_limit
    )
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id desc) from page),'[]'::jsonb),
      'next_cursor',(select jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1)
    )
  );
end;
$$;

create or replace function public.get_admin_financial_transaction_detail(p_transaction_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_tx public.financial_transactions;
begin
  perform public.admin_require_capability('finance.ledger.read');
  perform public.admin_require_capability('finance.audit.read');
  select * into v_tx from public.financial_transactions where id=p_transaction_id;
  if not found then raise exception using errcode='P0002',message='financial_transaction_not_found'; end if;
  return jsonb_build_object(
    'transaction',jsonb_build_object(
      'id',v_tx.id,'operation_type',v_tx.operation_type,'amount',v_tx.amount,'fee_amount',v_tx.fee_amount,
      'currency',v_tx.currency,'status',v_tx.status,'reference_type',v_tx.reference_type,
      'reference_id',v_tx.reference_id,'created_at',v_tx.created_at,'chain_id',v_tx.chain_id,
      'blockchain_txid',v_tx.blockchain_txid
    ),
    'ledger_entries',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',e.id,'entry_type',e.entry_type,'amount',e.amount,'balance_after',e.balance_after,'created_at',e.created_at,
      'account',jsonb_build_object('id',a.id,'account_type',a.account_type,'currency',a.currency,
        'owner',case when a.owner_id is null then null else jsonb_build_object('id',a.owner_id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url) end)
    ) order by e.created_at,e.id),'[]'::jsonb)
      from public.ledger_entries e join public.ledger_accounts a on a.id=e.account_id
      left join public.user_profiles p on p.id=a.owner_id where e.txn_id=v_tx.id)
  );
end;
$$;

create or replace function public.search_admin_finance_anomalies(
  p_rule_code text default null,
  p_severity text default null,
  p_limit integer default 100
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare v_limit integer:=least(greatest(coalesce(p_limit,100),1),100);
begin
  perform public.admin_require_capability('finance.anomalies.read');
  if p_severity is not null and p_severity not in ('critical','high','medium') then
    raise exception using errcode='22023',message='invalid_severity';
  end if;
  return (
    with double_entry_allowlist(operation_type) as (values
      ('marketplace_payment_capture'::text),
      ('marketplace_seller_settlement'),
      ('marketplace_platform_fee_settlement'),
      ('marketplace_creator_commission_settlement'),
      ('marketplace_dispute_refund'),
      ('marketplace_return_platform_hold'),
      ('marketplace_return_seller_hold'),
      ('marketplace_return_refund'),
      ('marketplace_ad_fund'),
      ('marketplace_ad_spend'),
      ('marketplace_ad_release'),
      ('marketplace_seller_settlement_reversal'),
      ('marketplace_platform_fee_reversal'),
      ('marketplace_creator_commission_reversal'),
      ('marketplace_post_settlement_refund')
    ),
    anomalies as (
      select 'LEGACY_PARALLEL_WALLET_ROWS'::text rule_code,'critical'::text severity,
        null::uuid entity_id,'legacy_finance'::text entity_type,
        jsonb_build_object('app_wallets',(select count(*) from public.app_wallets),'app_wallet_ledger_entries',(select count(*) from public.app_wallet_ledger_entries)) facts
      where exists(select 1 from public.app_wallets) or exists(select 1 from public.app_wallet_ledger_entries)
      union all
      select 'NEGATIVE_CANONICAL_LEDGER_BALANCE','critical',a.id,'ledger_account',
        jsonb_build_object('account_type',a.account_type,'currency',a.currency,'balance',a.balance)
      from public.ledger_accounts a where a.balance<0
      union all
      select 'MARKETPLACE_SETTLEMENT_RUN_FAILURE','high',null::uuid,'settlement_run_failure',
        jsonb_build_object('failure_id',f.id,'order_id',f.order_id,'failure_code',f.failure_code,'run_at',f.run_at)
      from public.marketplace_settlement_run_failures f
      union all
      select 'CANONICAL_MARKETPLACE_DOUBLE_ENTRY_MISMATCH','critical',t.id,'financial_transaction',
        jsonb_build_object('operation_type',t.operation_type,'transaction_amount',t.amount,'entry_count',coalesce(e.entry_count,0),'debit_count',coalesce(e.debit_count,0),'credit_count',coalesce(e.credit_count,0),'debit_total',coalesce(e.debit_total,0),'credit_total',coalesce(e.credit_total,0))
      from public.financial_transactions t
      join double_entry_allowlist al on al.operation_type=t.operation_type
      left join lateral (
        select count(*) entry_count,
          count(*) filter(where le.entry_type='debit') debit_count,
          count(*) filter(where le.entry_type='credit') credit_count,
          coalesce(sum(le.amount) filter(where le.entry_type='debit'),0) debit_total,
          coalesce(sum(le.amount) filter(where le.entry_type='credit'),0) credit_total
        from public.ledger_entries le where le.txn_id=t.id
      ) e on true
      where t.status='completed' and not (
        e.entry_count=2 and e.debit_count=1 and e.credit_count=1
        and e.debit_total=e.credit_total and e.debit_total=t.amount
      )
      union all
      select 'MISSING_CANONICAL_REFERENCE','critical',r.id,'marketplace_return_refund',
        jsonb_build_object('expected_operation_type','marketplace_return_refund','financial_transaction_id',r.financial_transaction_id)
      from public.marketplace_return_refunds r
      left join public.financial_transactions t on t.id=r.financial_transaction_id
        and t.operation_type='marketplace_return_refund' and t.status='completed'
        and t.reference_id=r.id
      where t.id is null
    ), filtered as (
      select * from anomalies
      where (p_rule_code is null or rule_code=p_rule_code)
        and (p_severity is null or severity=p_severity)
      order by rule_code,entity_id nulls first limit v_limit
    )
    select jsonb_build_object(
      'items',coalesce(jsonb_agg(jsonb_build_object('rule_code',rule_code,'severity',severity,'entity_type',entity_type,'entity_id',entity_id,'facts',facts) order by rule_code,entity_id nulls first),'[]'::jsonb),
      'rule_contracts',jsonb_build_array(
        jsonb_build_object('rule_code','LEGACY_PARALLEL_WALLET_ROWS','source_tables',array['app_wallets','app_wallet_ledger_entries'],'canonical_contract','Legacy wallet tables must remain empty because canonical finance uses ledger_accounts, financial_transactions, and ledger_entries.','severity','critical','remediation_hint','Investigate unexpected legacy writes; do not repair from this panel.'),
        jsonb_build_object('rule_code','NEGATIVE_CANONICAL_LEDGER_BALANCE','source_tables',array['ledger_accounts'],'canonical_contract','Canonical debit functions reject insufficient balance, so canonical ledger accounts cannot be negative.','severity','critical','remediation_hint','Investigate canonical ledger history; do not adjust balances from this panel.'),
        jsonb_build_object('rule_code','MARKETPLACE_SETTLEMENT_RUN_FAILURE','source_tables',array['marketplace_settlement_run_failures'],'canonical_contract','Each row is an explicit recorded settlement-run failure.','severity','high','remediation_hint','Inspect the settlement workflow outside this read-only panel.'),
        jsonb_build_object('rule_code','CANONICAL_MARKETPLACE_DOUBLE_ENTRY_MISMATCH','source_tables',array['financial_transactions','ledger_entries'],'canonical_contract','Only the explicit Marketplace operation allowlist is required by its active core to have one balanced debit and one credit equal to transaction amount.','severity','critical','remediation_hint','Inspect the originating Marketplace financial workflow; do not create entries here.'),
        jsonb_build_object('rule_code','MISSING_CANONICAL_REFERENCE','source_tables',array['marketplace_return_refunds','financial_transactions'],'canonical_contract','Every canonical return refund records its completed marketplace_return_refund transaction and references the refund row.','severity','critical','remediation_hint','Investigate the return-refund workflow; do not synthesize a transaction here.')
      )
    ) from filtered
  );
end;
$$;

create or replace function public.search_admin_global_audit(
  p_domain text default null,
  p_action text default null,
  p_actor_id uuid default null,
  p_target_type text default null,
  p_target_id uuid default null,
  p_outcome text default null,
  p_financial_effect boolean default null,
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('admin.audit.read');
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then raise exception using errcode='22023',message='invalid_cursor'; end if;
  return (
    with page as (
      select a.id,a.actor_id,a.actor_kind,a.actor_role_snapshot,a.actor_capability,a.domain,a.action,
        a.target_type,a.target_id,a.reason,a.outcome,a.financial_effect,a.contains_pii,a.metadata,a.created_at,
        p.username,p.display_name,p.avatar_url
      from private.admin_action_audit a left join public.user_profiles p on p.id=a.actor_id
      where private.admin_audit_row_visible(a.domain,a.financial_effect)
        and (p_domain is null or a.domain=p_domain)
        and (p_action is null or a.action=p_action)
        and (p_actor_id is null or a.actor_id=p_actor_id)
        and (p_target_type is null or a.target_type=p_target_type)
        and (p_target_id is null or a.target_id=p_target_id)
        and (p_outcome is null or a.outcome=p_outcome)
        and (p_financial_effect is null or a.financial_effect=p_financial_effect)
        and (p_created_from is null or a.created_at>=p_created_from)
        and (p_created_to is null or a.created_at<p_created_to)
        and (p_cursor_created_at is null or (a.created_at,a.id)<(p_cursor_created_at,p_cursor_id))
      order by a.created_at desc,a.id desc limit v_limit
    )
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'id',id,'actor',case when actor_id is null then null else jsonb_build_object('id',actor_id,'username',username,'display_name',display_name,'avatar_url',avatar_url) end,
        'actor_kind',actor_kind,'actor_role_snapshot',actor_role_snapshot,'actor_capability',actor_capability,
        'domain',domain,'action',action,'target_type',target_type,'target_id',target_id,
        'target_ref',null,'reason',case when contains_pii or financial_effect then null else left(reason,500) end,
        'outcome',outcome,'financial_effect',financial_effect,'contains_pii',contains_pii,'created_at',created_at,
        'metadata',private.admin_audit_safe_metadata(metadata,contains_pii,false)
      ) order by created_at desc,id desc) from page),'[]'::jsonb),
      'next_cursor',(select jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1)
    )
  );
end;
$$;

create or replace function public.search_admin_finance_audit(
  p_action text default null,
  p_actor_id uuid default null,
  p_target_type text default null,
  p_target_id uuid default null,
  p_outcome text default null,
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('finance.audit.read');
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then raise exception using errcode='22023',message='invalid_cursor'; end if;
  return (
    with page as (
      select a.id,a.actor_id,a.actor_kind,a.actor_role_snapshot,a.actor_capability,a.domain,a.action,
        a.target_type,a.target_id,a.reason,a.outcome,a.financial_effect,a.contains_pii,a.metadata,a.created_at,
        p.username,p.display_name,p.avatar_url
      from private.admin_action_audit a left join public.user_profiles p on p.id=a.actor_id
      where (a.financial_effect or a.domain='finance')
        and (p_action is null or a.action=p_action)
        and (p_actor_id is null or a.actor_id=p_actor_id)
        and (p_target_type is null or a.target_type=p_target_type)
        and (p_target_id is null or a.target_id=p_target_id)
        and (p_outcome is null or a.outcome=p_outcome)
        and (p_created_from is null or a.created_at>=p_created_from)
        and (p_created_to is null or a.created_at<p_created_to)
        and (p_cursor_created_at is null or (a.created_at,a.id)<(p_cursor_created_at,p_cursor_id))
      order by a.created_at desc,a.id desc limit v_limit
    )
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'id',id,'actor',case when actor_id is null then null else jsonb_build_object('id',actor_id,'username',username,'display_name',display_name,'avatar_url',avatar_url) end,
        'actor_kind',actor_kind,'actor_role_snapshot',actor_role_snapshot,'actor_capability',actor_capability,
        'domain',domain,'action',action,'target_type',target_type,'target_id',target_id,
        'target_ref',null,'reason',null,'outcome',outcome,'financial_effect',financial_effect,
        'contains_pii',contains_pii,'created_at',created_at,
        'metadata',private.admin_audit_safe_metadata(metadata,contains_pii,true)
      ) order by created_at desc,id desc) from page),'[]'::jsonb),
      'next_cursor',(select jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1)
    )
  );
end;
$$;

create or replace function public.search_admin_system_audit(
  p_action text default null,
  p_outcome text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('system.audit.read');
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then raise exception using errcode='22023',message='invalid_cursor'; end if;
  return (
    with page as (
      select a.id,a.actor_id,a.actor_kind,a.actor_role_snapshot,a.actor_capability,a.action,
        a.target_type,a.target_id,a.outcome,a.contains_pii,a.metadata,a.created_at,
        p.username,p.display_name,p.avatar_url
      from private.admin_action_audit a left join public.user_profiles p on p.id=a.actor_id
      where a.domain='system'
        and (p_action is null or a.action=p_action)
        and (p_outcome is null or a.outcome=p_outcome)
        and (p_cursor_created_at is null or (a.created_at,a.id)<(p_cursor_created_at,p_cursor_id))
      order by a.created_at desc,a.id desc limit v_limit
    )
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'id',id,'actor',case when actor_id is null then null else jsonb_build_object('id',actor_id,'username',username,'display_name',display_name,'avatar_url',avatar_url) end,
        'actor_kind',actor_kind,'actor_role_snapshot',actor_role_snapshot,'actor_capability',actor_capability,
        'domain','system','action',action,'target_type',target_type,'target_id',target_id,'target_ref',null,
        'reason',null,'outcome',outcome,'financial_effect',false,'contains_pii',contains_pii,'created_at',created_at,
        'metadata',private.admin_audit_safe_metadata(metadata,contains_pii,false)
      ) order by created_at desc,id desc) from page),'[]'::jsonb),
      'next_cursor',(select jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1)
    )
  );
end;
$$;

create or replace function public.get_admin_finance_reconciliation()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  perform public.admin_require_capability('finance.reconciliation.read');
  return jsonb_build_object(
    'marketplace_payments',(select coalesce(jsonb_object_agg(status,count), '{}'::jsonb) from (select status,count(*) count from public.marketplace_payments group by status) x),
    'marketplace_settlements',(select coalesce(jsonb_object_agg(status,count), '{}'::jsonb) from (select status,count(*) count from public.marketplace_order_settlements group by status) x),
    'settlement_legs',(select count(*) from public.marketplace_settlement_legs),
    'settlement_reversals',(select coalesce(jsonb_object_agg(status,count), '{}'::jsonb) from (select status,count(*) count from public.marketplace_settlement_reversals group by status) x),
    'refund_holds',(select coalesce(jsonb_object_agg(status,count), '{}'::jsonb) from (select status,count(*) count from public.marketplace_return_refund_holds group by status) x),
    'refunds',(select count(*) from public.marketplace_return_refunds),
    'settlement_run_failures',(select count(*) from public.marketplace_settlement_run_failures),
    'blockchain_settlements',(select coalesce(jsonb_object_agg(status,count), '{}'::jsonb) from (select status,count(*) count from public.blockchain_settlements group by status) x),
    'financial_transactions',(select coalesce(jsonb_agg(jsonb_build_object('operation_type',operation_type,'status',status,'count',count) order by operation_type,status),'[]'::jsonb) from (select operation_type,status,count(*) count from public.financial_transactions group by operation_type,status) x),
    'jobs',(select coalesce(jsonb_agg(jsonb_build_object('job_name',j.jobname,'active',j.active,'last_run',(
      select jsonb_build_object('status',r.status,'started_at',r.start_time,'ended_at',r.end_time)
      from cron.job_run_details r where r.jobid=j.jobid order by r.start_time desc limit 1
    )) order by j.jobname),'[]'::jsonb) from cron.job j where j.jobname in ('bdag-monitor','settle-eligible-marketplace-orders'))
  );
end;
$$;

do $$
declare v_signature regprocedure;
begin
  foreach v_signature in array array[
    'public.get_admin_finance_overview()'::regprocedure,
    'public.search_admin_ledger_accounts(text,text,boolean,uuid,timestamptz,uuid,integer)'::regprocedure,
    'public.search_admin_financial_transactions(text,text,text,text,timestamptz,timestamptz,timestamptz,uuid,integer)'::regprocedure,
    'public.get_admin_financial_transaction_detail(uuid)'::regprocedure,
    'public.get_admin_finance_reconciliation()'::regprocedure,
    'public.search_admin_finance_anomalies(text,text,integer)'::regprocedure,
    'public.search_admin_global_audit(text,text,uuid,text,uuid,text,boolean,timestamptz,timestamptz,timestamptz,uuid,integer)'::regprocedure,
    'public.search_admin_finance_audit(text,uuid,text,uuid,text,timestamptz,timestamptz,timestamptz,uuid,integer)'::regprocedure,
    'public.search_admin_system_audit(text,text,timestamptz,uuid,integer)'::regprocedure,
    'public.get_admin_system_health()'::regprocedure,
    'public.search_admin_system_jobs(text,boolean,integer)'::regprocedure,
    'public.get_admin_system_job_detail(bigint)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role',v_signature);
    execute format('grant execute on function %s to authenticated',v_signature);
  end loop;
end $$;

comment on function public.get_admin_finance_overview() is 'A8 read-only aggregate over canonical finance.';
comment on function public.search_admin_finance_anomalies(text,text,integer) is 'A8 dynamic anomalies limited to proven canonical contracts; no persistent anomaly authority.';
comment on function public.search_admin_global_audit(text,text,uuid,text,uuid,text,boolean,timestamptz,timestamptz,timestamptz,uuid,integer) is 'A8 global audit projection with domain/capability intersection and allow-list metadata redaction.';
comment on function public.get_admin_system_health() is 'A8 read-only aggregate health facts without arbitrary global status thresholds.';

do $$
begin
  if (select count(*) from private.admin_roles) <> 6
     or (select count(*) from private.admin_capabilities) <> 47
     or (select count(*) from private.admin_role_capabilities) <> 142
     or (select count(*) from private.admin_role_grant_rules) <> 7 then
    raise exception 'a8_postcondition_catalog_drift';
  end if;
  if (select count(*) from private.admin_user_roles where role_code='SUPER_ADMIN' and revoked_at is null) <> 0 then
    raise exception 'a8_postcondition_root_assignment';
  end if;
end $$;

commit;
