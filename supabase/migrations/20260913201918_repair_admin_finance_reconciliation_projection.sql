begin;

-- Repair the read-only reconciliation projection. Reversal rows are immutable
-- events and expose reason_code, not a lifecycle status column.
create or replace function public.get_admin_finance_reconciliation()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  perform public.admin_require_capability('finance.reconciliation.read');
  return jsonb_build_object(
    'marketplace_payments',(select coalesce(jsonb_object_agg(status,count), '{}'::jsonb) from (select status,count(*) count from public.marketplace_payments group by status) x),
    'marketplace_settlements',(select coalesce(jsonb_object_agg(status,count), '{}'::jsonb) from (select status,count(*) count from public.marketplace_order_settlements group by status) x),
    'settlement_legs',(select count(*) from public.marketplace_settlement_legs),
    'settlement_reversals',(select coalesce(jsonb_object_agg(reason_code,count), '{}'::jsonb) from (select reason_code,count(*) count from public.marketplace_settlement_reversals group by reason_code) x),
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

revoke all on function public.get_admin_finance_reconciliation() from public,anon,authenticated,service_role;
grant execute on function public.get_admin_finance_reconciliation() to authenticated;

comment on function public.get_admin_finance_reconciliation() is
  'Read-only canonical finance reconciliation projection; reversal events are grouped by reason code.';

commit;
