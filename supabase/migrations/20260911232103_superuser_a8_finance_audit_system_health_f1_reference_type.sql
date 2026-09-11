begin;

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
      ('marketplace_payment_capture'::text),('marketplace_seller_settlement'),
      ('marketplace_platform_fee_settlement'),('marketplace_creator_commission_settlement'),
      ('marketplace_dispute_refund'),('marketplace_return_platform_hold'),
      ('marketplace_return_seller_hold'),('marketplace_return_refund'),
      ('marketplace_ad_fund'),('marketplace_ad_spend'),('marketplace_ad_release'),
      ('marketplace_seller_settlement_reversal'),('marketplace_platform_fee_reversal'),
      ('marketplace_creator_commission_reversal'),('marketplace_post_settlement_refund')
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
      from public.financial_transactions t join double_entry_allowlist al on al.operation_type=t.operation_type
      left join lateral (
        select count(*) entry_count,count(*) filter(where le.entry_type='debit') debit_count,
          count(*) filter(where le.entry_type='credit') credit_count,
          coalesce(sum(le.amount) filter(where le.entry_type='debit'),0) debit_total,
          coalesce(sum(le.amount) filter(where le.entry_type='credit'),0) credit_total
        from public.ledger_entries le where le.txn_id=t.id
      ) e on true
      where t.status='completed' and not (e.entry_count=2 and e.debit_count=1 and e.credit_count=1 and e.debit_total=e.credit_total and e.debit_total=t.amount)
      union all
      select 'MISSING_CANONICAL_REFERENCE','critical',r.id,'marketplace_return_refund',
        jsonb_build_object('expected_operation_type','marketplace_return_refund','financial_transaction_id',r.financial_transaction_id)
      from public.marketplace_return_refunds r
      left join public.financial_transactions t on t.id=r.financial_transaction_id
        and t.operation_type='marketplace_return_refund' and t.status='completed'
        and t.reference_id=r.id::text
      where t.id is null
    ), filtered as (
      select * from anomalies
      where (p_rule_code is null or rule_code=p_rule_code) and (p_severity is null or severity=p_severity)
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

revoke all on function public.search_admin_finance_anomalies(text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.search_admin_finance_anomalies(text,text,integer) to authenticated;

commit;
