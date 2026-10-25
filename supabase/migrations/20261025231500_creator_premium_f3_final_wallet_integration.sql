begin;

-- Authenticated clients may provision only their own canonical zero-balance
-- account. The parameterized authority remains service-role only.
create or replace function public.ensure_my_ledger_account()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_account_id uuid;
begin
  if v_actor is null then
    raise exception using errcode='42501',message='ledger_account_auth_required';
  end if;

  if not exists(
    select 1
    from public.user_profiles profile
    where profile.id=v_actor
  ) then
    raise exception using errcode='55000',message='ledger_account_profile_required';
  end if;

  v_account_id := public.ensure_ledger_account(v_actor);

  if v_account_id is null or not exists(
    select 1
    from public.ledger_accounts account
    where account.id=v_account_id
      and account.owner_id=v_actor
      and account.account_type='user'
      and account.currency='BDAG'
  ) then
    raise exception using errcode='23514',message='ledger_account_provisioning_failed';
  end if;

  return v_account_id;
end;
$$;

alter function public.ensure_my_ledger_account() owner to postgres;
revoke all on function public.ensure_my_ledger_account()
  from public,anon,authenticated,service_role;
grant execute on function public.ensure_my_ledger_account() to authenticated;

comment on function public.ensure_my_ledger_account() is
  'Authenticated self-only boundary for the existing canonical BDAG account authority; never accepts an owner id or credits funds.';

-- Extend the single canonical platform-revenue projection. Creator Premium
-- revenue is the immutable fee snapshot, never gross buyer spend and never an
-- arbitrary financial_transactions fee without a proven receipt/period.
create or replace function private.get_admin_platform_revenue_projection_v1(
  p_period text default 'ytd'
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_period text;
  v_period_start timestamptz;
begin
  perform public.admin_require_capability('finance.ledger.read');

  v_period := case lower(trim(coalesce(p_period,'ytd')))
    when 'today' then 'today'
    when 'month' then 'month'
    when 'year' then 'year'
    when 'ytd' then 'year'
    when 'all' then 'all'
    else null
  end;
  if v_period is null then
    raise exception using errcode='22023',message='invalid_revenue_period';
  end if;

  v_period_start := case v_period
    when 'today' then pg_catalog.date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC'
    when 'month' then pg_catalog.date_trunc('month',v_now at time zone 'UTC') at time zone 'UTC'
    when 'year' then pg_catalog.date_trunc('year',v_now at time zone 'UTC') at time zone 'UTC'
    else null
  end;

  return (
    with
    source_catalog(source_code,source_label,display_order) as (values
      ('live_gifts'::text,'LIVE Gifts'::text,1),
      ('marketplace'::text,'Marketplace Fees'::text,2),
      ('marketplace_ads'::text,'Marketplace Ads'::text,3),
      ('withdrawal_fees'::text,'Withdrawal Fees'::text,4),
      ('creator_premium'::text,'Creator Premium Fees'::text,5)
    ),
    creator_premium_facts as materialized (
      select
        'creator_premium_purchase_receipt'::text reference_type,
        'creator_premium_purchase'::text charge_operation_type,
        'creator_premium_purchase_refund'::text refund_operation_type,
        receipt.id reference_id,
        receipt.financial_transaction_id charge_transaction_id,
        receipt.reversal_financial_transaction_id refund_transaction_id,
        receipt.platform_account_id,
        receipt.platform_fee_bdag,
        coalesce(charge_tx.created_at,receipt.created_at) charge_event_at,
        coalesce(refund_tx.created_at,receipt.refunded_at) refund_event_at,
        charge_tx.fee_amount charge_crosscheck,
        refund_tx.fee_amount refund_crosscheck,
        coalesce((select sum(entry.amount) from public.ledger_entries entry
          where entry.txn_id=receipt.financial_transaction_id
            and entry.account_id=receipt.platform_account_id
            and entry.entry_type='credit'
            and entry.metadata->>'financial_leg'='platform_fee_credit'),0)::numeric charge_ledger,
        coalesce((select sum(entry.amount) from public.ledger_entries entry
          where entry.txn_id=receipt.reversal_financial_transaction_id
            and entry.account_id=receipt.platform_account_id
            and entry.entry_type='debit'
            and entry.metadata->>'financial_leg'='platform_fee_debit'),0)::numeric refund_ledger,
        private.creator_premium_financial_fact_is_valid_v1(
          receipt.financial_transaction_id,receipt.reversal_financial_transaction_id,
          receipt.access_state,receipt.buyer_id,receipt.creator_id,
          receipt.buyer_account_id,receipt.creator_account_id,receipt.platform_account_id,
          'creator_premium_purchase_receipt',receipt.id,
          'creator_premium_purchase','creator_premium_purchase_refund',
          receipt.idempotency_key,receipt.refund_idempotency_key,
          receipt.gross_amount_bdag,receipt.platform_fee_bdag,receipt.creator_net_bdag,
          receipt.platform_fee_bps
        ) verified
      from private.creator_premium_purchase_receipts receipt
      left join public.financial_transactions charge_tx
        on charge_tx.id=receipt.financial_transaction_id
      left join public.financial_transactions refund_tx
        on refund_tx.id=receipt.reversal_financial_transaction_id

      union all

      select
        'creator_premium_subscription_period',
        'creator_premium_subscription',
        'creator_premium_subscription_refund',
        period.id,
        period.financial_transaction_id,
        period.reversal_financial_transaction_id,
        period.platform_account_id,
        period.platform_fee_bdag,
        coalesce(charge_tx.created_at,period.created_at),
        coalesce(refund_tx.created_at,period.refunded_at),
        charge_tx.fee_amount,
        refund_tx.fee_amount,
        coalesce((select sum(entry.amount) from public.ledger_entries entry
          where entry.txn_id=period.financial_transaction_id
            and entry.account_id=period.platform_account_id
            and entry.entry_type='credit'
            and entry.metadata->>'financial_leg'='platform_fee_credit'),0)::numeric,
        coalesce((select sum(entry.amount) from public.ledger_entries entry
          where entry.txn_id=period.reversal_financial_transaction_id
            and entry.account_id=period.platform_account_id
            and entry.entry_type='debit'
            and entry.metadata->>'financial_leg'='platform_fee_debit'),0)::numeric,
        private.creator_premium_financial_fact_is_valid_v1(
          period.financial_transaction_id,period.reversal_financial_transaction_id,
          period.access_state,period.subscriber_id,period.creator_id,
          period.subscriber_account_id,period.creator_account_id,period.platform_account_id,
          'creator_premium_subscription_period',period.id,
          'creator_premium_subscription','creator_premium_subscription_refund',
          period.idempotency_key,period.refund_idempotency_key,
          period.gross_amount_bdag,period.platform_fee_bdag,period.creator_net_bdag,
          period.platform_fee_bps
        )
      from private.creator_premium_subscription_periods period
      left join public.financial_transactions charge_tx
        on charge_tx.id=period.financial_transaction_id
      left join public.financial_transactions refund_tx
        on refund_tx.id=period.reversal_financial_transaction_id
    ),
    creator_premium_canonical_transactions as (
      select charge_transaction_id transaction_id,charge_operation_type operation_type,
        reference_type,reference_id
      from creator_premium_facts
      union all
      select refund_transaction_id,refund_operation_type,reference_type,reference_id
      from creator_premium_facts
      where refund_transaction_id is not null
    ),
    creator_premium_orphans as (
      select orphan.transaction_id
      from (
        select finance_tx.id transaction_id
        from public.financial_transactions finance_tx
        where finance_tx.operation_type in (
            'creator_premium_purchase','creator_premium_purchase_refund',
            'creator_premium_subscription','creator_premium_subscription_refund'
          )
          and (v_period_start is null or finance_tx.created_at>=v_period_start)
          and finance_tx.created_at<v_now
          and (
            not exists(
              select 1 from creator_premium_canonical_transactions fact
              where fact.transaction_id=finance_tx.id
                and fact.operation_type=finance_tx.operation_type
                and fact.reference_type=finance_tx.reference_type
                and fact.reference_id::text=finance_tx.reference_id
            )
            or exists(
              select 1 from public.ledger_entries entry
              where entry.txn_id=finance_tx.id
                and not exists(
                  select 1 from creator_premium_canonical_transactions fact
                  where fact.transaction_id=finance_tx.id
                    and fact.operation_type=finance_tx.operation_type
                    and fact.reference_type=finance_tx.reference_type
                    and fact.reference_id::text=finance_tx.reference_id
                    and entry.metadata->>'fin_txn_id'=fact.transaction_id::text
                    and entry.metadata->>'reference_type'=fact.reference_type
                    and entry.metadata->>'reference_id'=fact.reference_id::text
                )
            )
          )

        union

        select entry.txn_id
        from public.ledger_entries entry
        left join public.financial_transactions finance_tx on finance_tx.id=entry.txn_id
        where entry.metadata->>'reference_type' in (
            'creator_premium_purchase_receipt','creator_premium_subscription_period'
          )
          and (v_period_start is null or entry.created_at>=v_period_start)
          and entry.created_at<v_now
          and (finance_tx.id is null or finance_tx.operation_type not in (
            'creator_premium_purchase','creator_premium_purchase_refund',
            'creator_premium_subscription','creator_premium_subscription_refund'
          ))
      ) orphan
    ),
    revenue_events as (
      -- LIVE gift rows are the primary domain authority. The linked financial
      -- transaction fee is a reconciliation copy and is not counted again.
      select 'live_gifts'::text source_code,'BDAG'::text currency,
        g.created_at event_at,g.id event_id,g.platform_fee_coins::numeric gross,0::numeric reversal
      from public.live_gift_transactions g
      where g.platform_fee_coins>0

      union all

      select 'withdrawal_fees','BDAG',w.updated_at,w.id,w.fee_bdag,0::numeric
      from public.withdrawal_requests w
      where w.status='completed' and w.fee_bdag>0

      union all

      select 'marketplace',s.currency,s.released_at,s.id,s.platform_fee_amount,0::numeric
      from public.marketplace_order_settlements s
      where s.status='completed' and s.released_at is not null and s.platform_fee_amount>0

      union all

      select 'marketplace',h.currency,l.created_at,l.id,0::numeric,l.amount
      from public.marketplace_return_refund_hold_legs l
      join public.marketplace_return_refund_holds h on h.id=l.hold_id
      where l.leg_type='platform_fee' and l.amount>0

      union all

      select 'marketplace',r.currency,l.created_at,l.id,0::numeric,l.reversal_amount
      from public.marketplace_settlement_reversal_legs l
      join public.marketplace_settlement_reversals r on r.id=l.reversal_id
      where l.leg_type='platform_fee' and l.reversal_amount>0

      union all

      select 'marketplace_ads','BDAG',e.created_at,e.id,e.amount_bdag,0::numeric
      from public.marketplace_ad_financial_events e
      where e.event_type='spend' and e.amount_bdag>0

      union all

      select 'creator_premium','BDAG',fact.charge_event_at,fact.reference_id,
        fact.platform_fee_bdag,0::numeric
      from creator_premium_facts fact
      where fact.verified and fact.platform_fee_bdag>0

      union all

      select 'creator_premium','BDAG',fact.refund_event_at,fact.reference_id,
        0::numeric,fact.platform_fee_bdag
      from creator_premium_facts fact
      where fact.verified and fact.refund_transaction_id is not null
        and fact.platform_fee_bdag>0
    ),
    currencies as (
      select distinct currency from revenue_events
      union select distinct currency from public.ledger_accounts
        where owner_id is null and account_type in('platform','marketplace_ads_revenue')
      union select 'BDAG'
    ),
    selected_events as (
      select * from revenue_events
      where (v_period_start is null or event_at>=v_period_start) and event_at<v_now
    ),
    kpis as (
      select c.currency,
        coalesce(sum(e.gross-e.reversal) filter(where e.event_at>=pg_catalog.date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC' and e.event_at<v_now),0) today_net,
        coalesce(sum(e.gross-e.reversal) filter(where e.event_at>=pg_catalog.date_trunc('month',v_now at time zone 'UTC') at time zone 'UTC' and e.event_at<v_now),0) month_net,
        coalesce(sum(e.gross-e.reversal) filter(where e.event_at>=pg_catalog.date_trunc('year',v_now at time zone 'UTC') at time zone 'UTC' and e.event_at<v_now),0) year_net,
        coalesce(sum(e.gross-e.reversal) filter(where e.event_at<v_now),0) all_net
      from currencies c left join revenue_events e on e.currency=c.currency
      group by c.currency
    ),
    selected_summary as (
      select c.currency,coalesce(sum(e.gross),0) gross,
        coalesce(sum(e.reversal),0) reversals,
        coalesce(sum(e.gross-e.reversal),0) net,
        count(e.event_id)::bigint event_count
      from currencies c left join selected_events e on e.currency=c.currency
      group by c.currency
    ),
    selected_sources as (
      select s.source_code,s.source_label,s.display_order,c.currency,
        coalesce(sum(e.gross),0) gross,
        coalesce(sum(e.reversal),0) reversals,
        coalesce(sum(e.gross-e.reversal),0) net,
        count(e.event_id)::bigint event_count
      from source_catalog s cross join currencies c
      left join selected_events e on e.source_code=s.source_code and e.currency=c.currency
      group by s.source_code,s.source_label,s.display_order,c.currency
    ),
    trend as (
      select case v_period
          when 'today' then pg_catalog.date_trunc('hour',event_at at time zone 'UTC') at time zone 'UTC'
          when 'month' then pg_catalog.date_trunc('day',event_at at time zone 'UTC') at time zone 'UTC'
          else pg_catalog.date_trunc('month',event_at at time zone 'UTC') at time zone 'UTC'
        end bucket_start,
        currency,sum(gross) gross,sum(reversal) reversals,sum(gross-reversal) net,
        count(*)::bigint event_count
      from selected_events
      group by 1,currency
    ),
    live_reconciliation as (
      select 'live_gifts'::text source_code,'LIVE Gifts'::text source_label,'BDAG'::text currency,
        coalesce(sum(g.platform_fee_coins),0)::numeric primary_gross,0::numeric primary_reversals,
        coalesce(sum(f.fee_amount) filter(where f.status='completed' and f.operation_type='live_gift'),0)::numeric crosscheck_gross,
        0::numeric crosscheck_reversals,null::numeric ledger_net,
        count(*) filter(where f.id is null or f.operation_type<>'live_gift' or f.status<>'completed'
          or f.currency<>'BDAG' or f.fee_amount<>g.platform_fee_coins)::bigint mismatch_count
      from public.live_gift_transactions g
      left join public.financial_transactions f on f.id=g.financial_transaction_id
      where (v_period_start is null or g.created_at>=v_period_start) and g.created_at<v_now
    ),
    withdrawal_reconciliation as (
      select 'withdrawal_fees'::text source_code,'Withdrawal Fees'::text source_label,'BDAG'::text currency,
        coalesce(sum(w.fee_bdag),0)::numeric primary_gross,0::numeric primary_reversals,
        coalesce(sum(f.fee_amount) filter(where f.status='completed' and f.operation_type='withdrawal'),0)::numeric crosscheck_gross,
        0::numeric crosscheck_reversals,null::numeric ledger_net,
        count(*) filter(where f.id is null or f.operation_type<>'withdrawal' or f.status<>'completed'
          or f.currency<>'BDAG' or f.fee_amount<>w.fee_bdag)::bigint mismatch_count
      from public.withdrawal_requests w
      left join public.financial_transactions f on f.id=w.fin_txn_id
      where w.status='completed' and (v_period_start is null or w.updated_at>=v_period_start) and w.updated_at<v_now
    ),
    marketplace_gross_checks as (
      select s.currency,s.platform_fee_amount primary_amount,
        case when f.status='completed' and f.operation_type='marketplace_platform_fee_settlement' then f.amount else 0 end crosscheck_amount,
        case when f.id is null or l.id is null or l.amount<>s.platform_fee_amount
          or f.operation_type<>'marketplace_platform_fee_settlement' or f.status<>'completed'
          or f.currency<>s.currency or f.amount<>l.amount
          or (select count(*) from public.ledger_entries le where le.txn_id=f.id)<>2
          or not exists(select 1 from public.ledger_entries le where le.txn_id=f.id and le.account_id=f.from_account_id and le.entry_type='debit' and le.amount=l.amount)
          or not exists(select 1 from public.ledger_entries le where le.txn_id=f.id and le.account_id=l.destination_account_id and le.entry_type='credit' and le.amount=l.amount)
          then 1 else 0 end mismatch,
        coalesce((select sum(le.amount) from public.ledger_entries le
          where le.txn_id=f.id and le.account_id=l.destination_account_id and le.entry_type='credit'),0) ledger_amount
      from public.marketplace_order_settlements s
      left join public.marketplace_settlement_legs l on l.settlement_id=s.id and l.leg_type='platform_fee'
      left join public.financial_transactions f on f.id=l.financial_transaction_id
      where s.status='completed' and s.released_at is not null
        and (v_period_start is null or s.released_at>=v_period_start) and s.released_at<v_now
    ),
    marketplace_reversal_checks as (
      select h.currency,l.amount primary_amount,
        case when f.status='completed' and f.operation_type='marketplace_return_platform_hold' then f.amount else 0 end crosscheck_amount,
        case when f.id is null or osl.id is null or osl.leg_type<>'platform_fee' or osl.amount<>l.amount
          or osl.destination_account_id<>l.source_account_id or f.operation_type<>'marketplace_return_platform_hold'
          or f.status<>'completed' or f.currency<>h.currency or f.amount<>l.amount
          or (select count(*) from public.ledger_entries le where le.txn_id=f.id)<>2
          or not exists(select 1 from public.ledger_entries le where le.txn_id=f.id and le.account_id=l.source_account_id and le.entry_type='debit' and le.amount=l.amount)
          or not exists(select 1 from public.ledger_entries le where le.txn_id=f.id and le.account_id=l.destination_account_id and le.entry_type='credit' and le.amount=l.amount)
          then 1 else 0 end mismatch,
        coalesce((select sum(le.amount) from public.ledger_entries le
          where le.txn_id=f.id and le.account_id=l.source_account_id and le.entry_type='debit'),0) ledger_amount
      from public.marketplace_return_refund_hold_legs l
      join public.marketplace_return_refund_holds h on h.id=l.hold_id
      left join public.marketplace_settlement_legs osl on osl.id=l.original_settlement_leg_id
      left join public.financial_transactions f on f.id=l.financial_transaction_id
      where l.leg_type='platform_fee' and (v_period_start is null or l.created_at>=v_period_start) and l.created_at<v_now

      union all

      select r.currency,l.reversal_amount,
        case when f.status='completed' and f.operation_type='marketplace_platform_fee_reversal' then f.amount else 0 end,
        case when f.id is null or osl.id is null or osl.leg_type<>'platform_fee' or osl.amount<>l.original_amount
          or l.original_amount<>l.reversal_amount or osl.destination_account_id<>l.source_account_id
          or f.operation_type<>'marketplace_platform_fee_reversal' or f.status<>'completed'
          or f.currency<>r.currency or f.amount<>l.reversal_amount
          or (select count(*) from public.ledger_entries le where le.txn_id=f.id)<>2
          or not exists(select 1 from public.ledger_entries le where le.txn_id=f.id and le.account_id=l.source_account_id and le.entry_type='debit' and le.amount=l.reversal_amount)
          or not exists(select 1 from public.ledger_entries le where le.txn_id=f.id and le.account_id=l.destination_account_id and le.entry_type='credit' and le.amount=l.reversal_amount)
          then 1 else 0 end,
        coalesce((select sum(le.amount) from public.ledger_entries le
          where le.txn_id=f.id and le.account_id=l.source_account_id and le.entry_type='debit'),0)
      from public.marketplace_settlement_reversal_legs l
      join public.marketplace_settlement_reversals r on r.id=l.reversal_id
      left join public.marketplace_settlement_legs osl on osl.id=l.original_settlement_leg_id
      left join public.financial_transactions f on f.id=l.reversal_financial_transaction_id
      where l.leg_type='platform_fee' and (v_period_start is null or l.created_at>=v_period_start) and l.created_at<v_now
    ),
    marketplace_reconciliation as (
      select 'marketplace'::text source_code,'Marketplace Fees'::text source_label,c.currency,
        coalesce(g.primary_gross,0) primary_gross,coalesce(r.primary_reversals,0) primary_reversals,
        coalesce(g.crosscheck_gross,0) crosscheck_gross,coalesce(r.crosscheck_reversals,0) crosscheck_reversals,
        coalesce(g.ledger_gross,0)-coalesce(r.ledger_reversals,0) ledger_net,
        coalesce(g.mismatches,0)+coalesce(r.mismatches,0) mismatch_count
      from currencies c
      left join (select currency,sum(primary_amount) primary_gross,sum(crosscheck_amount) crosscheck_gross,
          sum(ledger_amount) ledger_gross,sum(mismatch)::bigint mismatches from marketplace_gross_checks group by currency) g on g.currency=c.currency
      left join (select currency,sum(primary_amount) primary_reversals,sum(crosscheck_amount) crosscheck_reversals,
          sum(ledger_amount) ledger_reversals,sum(mismatch)::bigint mismatches from marketplace_reversal_checks group by currency) r on r.currency=c.currency
    ),
    ads_reconciliation as (
      select 'marketplace_ads'::text source_code,'Marketplace Ads'::text source_label,'BDAG'::text currency,
        coalesce(sum(e.amount_bdag),0)::numeric primary_gross,0::numeric primary_reversals,
        coalesce(sum(f.amount) filter(where f.status='completed' and f.operation_type='marketplace_ad_spend'),0)::numeric crosscheck_gross,
        0::numeric crosscheck_reversals,
        coalesce(sum(ledger.credit_amount),0)::numeric ledger_net,
        count(*) filter(where f.id is null or f.operation_type<>'marketplace_ad_spend' or f.status<>'completed' or f.amount<>e.amount_bdag
          or (select count(*) from public.ledger_entries le where le.txn_id=f.id)<>2
          or not exists(select 1 from public.ledger_entries le join public.ledger_accounts a on a.id=le.account_id
            where le.txn_id=f.id and le.entry_type='debit' and a.owner_id is null and a.account_type='marketplace_ads_escrow' and le.amount=e.amount_bdag)
          or not exists(select 1 from public.ledger_entries le join public.ledger_accounts a on a.id=le.account_id
            where le.txn_id=f.id and le.entry_type='credit' and a.owner_id is null and a.account_type='marketplace_ads_revenue' and le.amount=e.amount_bdag))::bigint mismatch_count
      from public.marketplace_ad_financial_events e
      left join public.financial_transactions f on f.id=e.financial_transaction_id
      left join lateral (select coalesce(sum(le.amount),0) credit_amount
        from public.ledger_entries le join public.ledger_accounts a on a.id=le.account_id
        where le.txn_id=f.id and le.entry_type='credit' and a.owner_id is null and a.account_type='marketplace_ads_revenue') ledger on true
      where e.event_type='spend' and (v_period_start is null or e.created_at>=v_period_start) and e.created_at<v_now
    ),
    creator_premium_reconciliation as (
      select 'creator_premium'::text source_code,'Creator Premium Fees'::text source_label,
        'BDAG'::text currency,
        coalesce(sum(fact.platform_fee_bdag) filter(where
          (v_period_start is null or fact.charge_event_at>=v_period_start)
          and fact.charge_event_at<v_now),0)::numeric primary_gross,
        coalesce(sum(fact.platform_fee_bdag) filter(where fact.refund_transaction_id is not null
          and (v_period_start is null or fact.refund_event_at>=v_period_start)
          and fact.refund_event_at<v_now),0)::numeric primary_reversals,
        coalesce(sum(fact.charge_crosscheck) filter(where
          (v_period_start is null or fact.charge_event_at>=v_period_start)
          and fact.charge_event_at<v_now),0)::numeric crosscheck_gross,
        coalesce(sum(fact.refund_crosscheck) filter(where fact.refund_transaction_id is not null
          and (v_period_start is null or fact.refund_event_at>=v_period_start)
          and fact.refund_event_at<v_now),0)::numeric crosscheck_reversals,
        (coalesce(sum(fact.charge_ledger) filter(where
          (v_period_start is null or fact.charge_event_at>=v_period_start)
          and fact.charge_event_at<v_now),0)
          -coalesce(sum(fact.refund_ledger) filter(where fact.refund_transaction_id is not null
          and (v_period_start is null or fact.refund_event_at>=v_period_start)
          and fact.refund_event_at<v_now),0))::numeric ledger_net,
        ((count(*) filter(where not fact.verified and (
          ((v_period_start is null or fact.charge_event_at>=v_period_start) and fact.charge_event_at<v_now)
          or (fact.refund_transaction_id is not null
            and (v_period_start is null or fact.refund_event_at>=v_period_start)
            and fact.refund_event_at<v_now)
        )))+(select count(*) from creator_premium_orphans))::bigint mismatch_count
      from creator_premium_facts fact
    ),
    reconciliation_rows as (
      select * from live_reconciliation
      union all select * from marketplace_reconciliation
      union all select * from ads_reconciliation
      union all select * from withdrawal_reconciliation
      union all select * from creator_premium_reconciliation
    ),
    reconciliation_status as (
      select *,primary_gross-primary_reversals primary_net,
        crosscheck_gross-crosscheck_reversals crosscheck_net,
        case when mismatch_count=0
          and primary_gross-primary_reversals=crosscheck_gross-crosscheck_reversals
          and (ledger_net is null or ledger_net=primary_gross-primary_reversals)
          then 'pass' else 'fail' end status
      from reconciliation_rows
    )
    select jsonb_build_object(
      'period',v_period,
      'period_start',v_period_start,
      'period_end',v_now,
      'timezone','UTC',
      'generated_at',v_now,
      'kpis',(select coalesce(jsonb_agg(jsonb_build_object(
        'currency',currency,'today_net',today_net,'month_net',month_net,'year_net',year_net,'all_net',all_net
      ) order by currency),'[]'::jsonb) from kpis),
      'summary',(select coalesce(jsonb_agg(jsonb_build_object(
        'currency',currency,'gross_revenue',gross,'reversals',reversals,'net_revenue',net,'event_count',event_count
      ) order by currency),'[]'::jsonb) from selected_summary),
      'sources',(select coalesce(jsonb_agg(jsonb_build_object(
        'source_code',source_code,'label',source_label,'currency',currency,
        'gross_revenue',gross,'reversals',reversals,'net_revenue',net,'event_count',event_count
      ) order by display_order,currency),'[]'::jsonb) from selected_sources),
      'trend',(select coalesce(jsonb_agg(jsonb_build_object(
        'bucket_start',bucket_start,'currency',currency,'gross_revenue',gross,
        'reversals',reversals,'net_revenue',net,'event_count',event_count
      ) order by bucket_start,currency),'[]'::jsonb) from trend),
      'current_balances',(select coalesce(jsonb_agg(jsonb_build_object(
        'account_type',account_type,'currency',currency,'balance',balance
      ) order by account_type,currency),'[]'::jsonb) from (
        select account_type,currency,sum(balance) balance from public.ledger_accounts
        where owner_id is null and account_type in('platform','marketplace_ads_revenue')
        group by account_type,currency
      ) balances),
      'current_balance_totals',(select coalesce(jsonb_agg(jsonb_build_object(
        'currency',currency,'balance',balance
      ) order by currency),'[]'::jsonb) from (
        select currency,sum(balance) balance from public.ledger_accounts
        where owner_id is null and account_type in('platform','marketplace_ads_revenue') group by currency
      ) totals),
      'reconciliation',jsonb_build_object(
        'overall_status',case when exists(select 1 from reconciliation_status where status<>'pass') then 'fail' else 'pass' end,
        'sources',(select coalesce(jsonb_agg(jsonb_build_object(
          'source_code',source_code,'label',source_label,'currency',currency,'status',status,
          'primary_gross',primary_gross,'primary_reversals',primary_reversals,'primary_net',primary_net,
          'crosscheck_gross',crosscheck_gross,'crosscheck_reversals',crosscheck_reversals,'crosscheck_net',crosscheck_net,
          'ledger_net',ledger_net,'difference',primary_net-crosscheck_net,'mismatch_count',mismatch_count
        ) order by source_code,currency),'[]'::jsonb) from reconciliation_status)
      )
    )
  );
end;
$$;

alter function private.get_admin_platform_revenue_projection_v1(text) owner to postgres;
revoke all on function private.get_admin_platform_revenue_projection_v1(text)
  from public,anon,authenticated,service_role;

comment on function private.get_admin_platform_revenue_projection_v1(text) is
  'Canonical read-only platform revenue projection including validated Creator Premium fee snapshots and exact reversals.';

notify pgrst, 'reload schema';
commit;
