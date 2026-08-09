begin;

create or replace function public.reconcile_marketplace_ad_finance() returns jsonb
language sql stable security definer set search_path=public as $$
with ad as(
 select e.id event_id,e.campaign_id,e.seller_id,e.event_type,e.amount_bdag,e.financial_transaction_id,
  f.operation_type,f.amount transaction_amount,f.reference_type,f.reference_id,
  src.account_type source_type,src.owner_id source_owner,dst.account_type destination_type,dst.owner_id destination_owner,
  coalesce((select sum(le.amount)from public.ledger_entries le where le.txn_id=f.id and le.entry_type='debit'and le.account_id=f.from_account_id),0) source_debits,
  coalesce((select sum(le.amount)from public.ledger_entries le where le.txn_id=f.id and le.entry_type='credit'and le.account_id=f.to_account_id),0) destination_credits,
  (select count(*)from public.ledger_entries le where le.txn_id=f.id) entry_count
 from public.marketplace_ad_financial_events e
 left join public.financial_transactions f on f.id=e.financial_transaction_id
 left join public.ledger_accounts src on src.id=f.from_account_id
 left join public.ledger_accounts dst on dst.id=f.to_account_id
), directional as(
 select
  coalesce(sum(source_debits)filter(where event_type='fund'),0)-coalesce(sum(amount_bdag)filter(where event_type='fund'),0) funding_source_difference,
  coalesce(sum(destination_credits)filter(where event_type='fund'),0)-coalesce(sum(amount_bdag)filter(where event_type='fund'),0) funding_escrow_difference,
  count(*)filter(where event_type='fund'and(source_type is distinct from'user'or source_owner is distinct from seller_id or destination_type is distinct from'marketplace_ads_escrow'or destination_owner is not null or source_debits is distinct from amount_bdag or destination_credits is distinct from amount_bdag or entry_count<>2)) funding_unexpected_entries,
  coalesce(sum(source_debits)filter(where event_type='spend'),0)-coalesce(sum(amount_bdag)filter(where event_type='spend'),0) spend_escrow_difference,
  coalesce(sum(destination_credits)filter(where event_type='spend'),0)-coalesce(sum(amount_bdag)filter(where event_type='spend'),0) spend_revenue_difference,
  count(*)filter(where event_type='spend'and(source_type is distinct from'marketplace_ads_escrow'or source_owner is not null or destination_type is distinct from'marketplace_ads_revenue'or destination_owner is not null or source_debits is distinct from amount_bdag or destination_credits is distinct from amount_bdag or entry_count<>2)) spend_unexpected_entries,
  coalesce(sum(source_debits)filter(where event_type='release'),0)-coalesce(sum(amount_bdag)filter(where event_type='release'),0) release_escrow_difference,
  coalesce(sum(destination_credits)filter(where event_type='release'),0)-coalesce(sum(amount_bdag)filter(where event_type='release'),0) release_destination_difference,
  count(*)filter(where event_type='release'and(source_type is distinct from'marketplace_ads_escrow'or source_owner is not null or destination_type is distinct from'user'or destination_owner is distinct from seller_id or source_debits is distinct from amount_bdag or destination_credits is distinct from amount_bdag or entry_count<>2)) release_unexpected_entries,
  count(*)filter(where event_type='release'and(destination_type is distinct from'user'or destination_owner is distinct from seller_id)) release_wrong_recipient,
  count(*)filter(where financial_transaction_id is null or operation_type is distinct from case event_type when'fund'then'marketplace_ad_fund'when'spend'then'marketplace_ad_spend'when'release'then'marketplace_ad_release'end or transaction_amount is distinct from amount_bdag or reference_type is distinct from'marketplace_ad_campaign'or reference_id is distinct from campaign_id::text) event_transaction_mismatches
 from ad
), liability as(
 select coalesce(sum(total_budget_bdag-spent_bdag-released_bdag),0) amount from public.marketplace_ad_campaigns where funded_at is not null
), escrow as(
 select coalesce(balance,0) amount from public.ledger_accounts where owner_id is null and account_type='marketplace_ads_escrow'
)
select jsonb_build_object(
 'funding_reconciliation',funding_source_difference-funding_escrow_difference,
 'spend_reconciliation',spend_escrow_difference-spend_revenue_difference,
 'release_reconciliation',release_escrow_difference-release_destination_difference,
 'funding_source_difference',funding_source_difference,'funding_escrow_difference',funding_escrow_difference,'funding_unexpected_entries',funding_unexpected_entries,
 'spend_escrow_difference',spend_escrow_difference,'spend_revenue_difference',spend_revenue_difference,'spend_unexpected_entries',spend_unexpected_entries,
 'release_escrow_difference',release_escrow_difference,'release_destination_difference',release_destination_difference,'release_unexpected_entries',release_unexpected_entries,
 'release_wrong_recipient',release_wrong_recipient,'unexpected_ads_entries',funding_unexpected_entries+spend_unexpected_entries+release_unexpected_entries,
 'event_transaction_mismatches',event_transaction_mismatches,
 'campaign_equation_mismatches',(select count(*)from public.marketplace_ad_campaigns where total_budget_bdag<>spent_bdag+released_bdag+(total_budget_bdag-spent_bdag-released_bdag)),
 'escrow_liability_difference',(select amount from escrow)-(select amount from liability)
)from directional;
$$;

revoke all on function public.reconcile_marketplace_ad_finance() from public,anon,authenticated;
grant execute on function public.reconcile_marketplace_ad_finance() to service_role;
notify pgrst,'reload schema';
commit;
