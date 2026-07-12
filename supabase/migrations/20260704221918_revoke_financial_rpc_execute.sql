REVOKE EXECUTE ON FUNCTION public.atomic_ledger_transfer FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ledger_credit FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ledger_debit FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.request_withdrawal_from_ledger FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.credit_deposit_to_ledger FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.transfer_bdag_internal FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_ledger_account FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_velocity_limit FROM anon, authenticated;;
