begin;

drop policy if exists marketplace_allocations_buyer_read
  on public.marketplace_payment_allocations;

revoke all on function public.get_bdag_wallet_balance() from public;
revoke all on function public.get_bdag_wallet_balance() from anon;
grant execute on function public.get_bdag_wallet_balance() to authenticated;
grant execute on function public.get_bdag_wallet_balance() to service_role;

commit;
