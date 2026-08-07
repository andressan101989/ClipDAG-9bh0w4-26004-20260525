begin;

alter table public.marketplace_order_events drop constraint marketplace_order_events_transition_check;
alter table public.marketplace_order_events add constraint marketplace_order_events_transition_check check(
  (event_type='order_confirmed'and to_status='confirmed')or
  (event_type='processing_started'and from_status='confirmed'and to_status='processing')or
  (event_type in('shipment_created','order_shipped')and from_status='processing'and to_status='shipped')or
  event_type in('shipment_updated','delivery_confirmed','escrow_released','order_cancelled','refund_created','dispute_opened','dispute_resolved')
);

commit;
