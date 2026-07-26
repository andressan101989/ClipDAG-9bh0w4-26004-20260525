-- Financial ledger RPCs are internal backend primitives. They must only be
-- callable through authenticated Edge Functions using the service role.
-- This migration changes privileges only; it does not alter function bodies,
-- owners, SECURITY DEFINER settings, balances, or ledger data.

REVOKE EXECUTE ON FUNCTION public.atomic_ledger_transfer(uuid, uuid, numeric, numeric, text, text, text, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.atomic_ledger_transfer(uuid, uuid, numeric, numeric, text, text, text, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.atomic_ledger_transfer(uuid, uuid, numeric, numeric, text, text, text, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_ledger_transfer(uuid, uuid, numeric, numeric, text, text, text, uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.check_velocity_limit(uuid, text, numeric, integer, numeric, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_velocity_limit(uuid, text, numeric, integer, numeric, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_velocity_limit(uuid, text, numeric, integer, numeric, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_velocity_limit(uuid, text, numeric, integer, numeric, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.credit_deposit_to_ledger(uuid, numeric, text, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.credit_deposit_to_ledger(uuid, numeric, text, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.credit_deposit_to_ledger(uuid, numeric, text, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.credit_deposit_to_ledger(uuid, numeric, text, text, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.ensure_ledger_account(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_ledger_account(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ensure_ledger_account(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_ledger_account(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.ledger_credit(uuid, uuid, numeric, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ledger_credit(uuid, uuid, numeric, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ledger_credit(uuid, uuid, numeric, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ledger_credit(uuid, uuid, numeric, text, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.ledger_debit(uuid, uuid, numeric, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ledger_debit(uuid, uuid, numeric, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ledger_debit(uuid, uuid, numeric, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ledger_debit(uuid, uuid, numeric, text, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.request_withdrawal_from_ledger(uuid, numeric, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.request_withdrawal_from_ledger(uuid, numeric, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.request_withdrawal_from_ledger(uuid, numeric, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal_from_ledger(uuid, numeric, text, text, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.transfer_bdag_internal(uuid, uuid, numeric, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transfer_bdag_internal(uuid, uuid, numeric, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.transfer_bdag_internal(uuid, uuid, numeric, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_bdag_internal(uuid, uuid, numeric, text) TO service_role;
