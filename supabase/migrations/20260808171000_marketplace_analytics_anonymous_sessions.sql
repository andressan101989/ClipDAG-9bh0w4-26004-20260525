begin;

create unique index marketplace_commerce_session_idempotency_unique
  on public.marketplace_commerce_events(client_session_id,event_name,idempotency_key)
  where client_session_id is not null and idempotency_key is not null and event_name<>'purchase_completed';

grant execute on function public.record_marketplace_commerce_event(text,uuid,uuid,uuid,text,uuid,uuid,uuid,integer,jsonb,text) to anon;

comment on index public.marketplace_commerce_session_idempotency_unique is 'Makes privacy-safe anonymous and authenticated app-session event retries duplicate-proof.';

commit;
