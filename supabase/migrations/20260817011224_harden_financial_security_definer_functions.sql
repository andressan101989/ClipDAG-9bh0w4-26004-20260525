begin;

alter function public.atomic_ledger_transfer(uuid, uuid, numeric, numeric, text, text, text, uuid, text)
  set search_path to pg_catalog, public;
revoke all on function public.atomic_ledger_transfer(uuid, uuid, numeric, numeric, text, text, text, uuid, text) from public;
revoke all on function public.atomic_ledger_transfer(uuid, uuid, numeric, numeric, text, text, text, uuid, text) from anon;
revoke all on function public.atomic_ledger_transfer(uuid, uuid, numeric, numeric, text, text, text, uuid, text) from authenticated;
grant execute on function public.atomic_ledger_transfer(uuid, uuid, numeric, numeric, text, text, text, uuid, text) to service_role;

alter function public.check_velocity_limit(uuid, text, numeric, integer, numeric, integer)
  set search_path to pg_catalog, public;
revoke all on function public.check_velocity_limit(uuid, text, numeric, integer, numeric, integer) from public;
revoke all on function public.check_velocity_limit(uuid, text, numeric, integer, numeric, integer) from anon;
revoke all on function public.check_velocity_limit(uuid, text, numeric, integer, numeric, integer) from authenticated;
grant execute on function public.check_velocity_limit(uuid, text, numeric, integer, numeric, integer) to service_role;

alter function public.credit_deposit_to_ledger(uuid, numeric, text, text, uuid)
  set search_path to pg_catalog, public;
revoke all on function public.credit_deposit_to_ledger(uuid, numeric, text, text, uuid) from public;
revoke all on function public.credit_deposit_to_ledger(uuid, numeric, text, text, uuid) from anon;
revoke all on function public.credit_deposit_to_ledger(uuid, numeric, text, text, uuid) from authenticated;
grant execute on function public.credit_deposit_to_ledger(uuid, numeric, text, text, uuid) to service_role;

alter function public.ensure_ledger_account(uuid)
  set search_path to pg_catalog, public;
revoke all on function public.ensure_ledger_account(uuid) from public;
revoke all on function public.ensure_ledger_account(uuid) from anon;
revoke all on function public.ensure_ledger_account(uuid) from authenticated;
grant execute on function public.ensure_ledger_account(uuid) to service_role;

alter function public.ledger_credit(uuid, uuid, numeric, text, jsonb)
  set search_path to pg_catalog, public;
revoke all on function public.ledger_credit(uuid, uuid, numeric, text, jsonb) from public;
revoke all on function public.ledger_credit(uuid, uuid, numeric, text, jsonb) from anon;
revoke all on function public.ledger_credit(uuid, uuid, numeric, text, jsonb) from authenticated;
grant execute on function public.ledger_credit(uuid, uuid, numeric, text, jsonb) to service_role;

alter function public.ledger_debit(uuid, uuid, numeric, text, jsonb)
  set search_path to pg_catalog, public;
revoke all on function public.ledger_debit(uuid, uuid, numeric, text, jsonb) from public;
revoke all on function public.ledger_debit(uuid, uuid, numeric, text, jsonb) from anon;
revoke all on function public.ledger_debit(uuid, uuid, numeric, text, jsonb) from authenticated;
grant execute on function public.ledger_debit(uuid, uuid, numeric, text, jsonb) to service_role;

alter function public.refund_withdrawal_to_ledger(uuid, text)
  set search_path to pg_catalog, public;
revoke all on function public.refund_withdrawal_to_ledger(uuid, text) from public;
revoke all on function public.refund_withdrawal_to_ledger(uuid, text) from anon;
revoke all on function public.refund_withdrawal_to_ledger(uuid, text) from authenticated;
grant execute on function public.refund_withdrawal_to_ledger(uuid, text) to service_role;

alter function public.request_withdrawal_from_ledger(uuid, numeric, text, text, text, text)
  set search_path to pg_catalog, public;
revoke all on function public.request_withdrawal_from_ledger(uuid, numeric, text, text, text, text) from public;
revoke all on function public.request_withdrawal_from_ledger(uuid, numeric, text, text, text, text) from anon;
revoke all on function public.request_withdrawal_from_ledger(uuid, numeric, text, text, text, text) from authenticated;
grant execute on function public.request_withdrawal_from_ledger(uuid, numeric, text, text, text, text) to service_role;

alter function public.transfer_bdag_internal(uuid, uuid, numeric, text)
  set search_path to pg_catalog, public;
revoke all on function public.transfer_bdag_internal(uuid, uuid, numeric, text) from public;
revoke all on function public.transfer_bdag_internal(uuid, uuid, numeric, text) from anon;
revoke all on function public.transfer_bdag_internal(uuid, uuid, numeric, text) from authenticated;
grant execute on function public.transfer_bdag_internal(uuid, uuid, numeric, text) to service_role;

commit;
