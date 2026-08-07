begin;

create or replace function public.marketplace_payment_refund_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='UPDATE'
    and current_setting('app.marketplace_dispute_refund',true)='on'
    and old.status='paid' and new.status='refunded'
    and(old.id,old.checkout_id,old.buyer_id,old.currency,old.gross_amount,old.escrow_amount,
        old.fee_bps,old.financial_transaction_id,old.idempotency_key,old.request_fingerprint,
        old.paid_at,old.created_at)
       is not distinct from
       (new.id,new.checkout_id,new.buyer_id,new.currency,new.gross_amount,new.escrow_amount,
        new.fee_bps,new.financial_transaction_id,new.idempotency_key,new.request_fingerprint,
        new.paid_at,new.created_at)
    and old.refunded_at is null and new.refunded_at is not null then return new;
  end if;
  raise exception using errcode='42501',message='marketplace_payment_snapshot_immutable';
end$$;

drop trigger marketplace_payments_immutable on public.marketplace_payments;
create trigger marketplace_payments_immutable before update or delete on public.marketplace_payments
for each row execute function public.marketplace_payment_refund_guard();

revoke all on function public.marketplace_payment_refund_guard()from public,anon,authenticated;

commit;
