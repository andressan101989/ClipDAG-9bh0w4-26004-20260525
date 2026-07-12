begin;

create table if not exists public.call_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls(id) on delete cascade,
  device_id uuid not null references public.call_devices(id) on delete cascade,
  event_type text not null,
  status text not null default 'pending',
  provider text not null default 'expo',
  provider_ticket_id text,
  error_code text,
  error_message text,
  attempted_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint call_push_deliveries_event_type_check
    check (event_type in ('incoming_call', 'call_cancelled', 'call_ended')),
  constraint call_push_deliveries_status_check
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  constraint call_push_deliveries_provider_check
    check (provider in ('expo'))
);

create unique index if not exists call_push_deliveries_call_device_event_uidx
  on public.call_push_deliveries (call_id, device_id, event_type);

create index if not exists call_push_deliveries_call_idx
  on public.call_push_deliveries (call_id, event_type, status);

create index if not exists call_push_deliveries_device_idx
  on public.call_push_deliveries (device_id, created_at desc);

create index if not exists call_push_deliveries_pending_idx
  on public.call_push_deliveries (event_type, status, created_at)
  where status in ('pending', 'failed');

alter table public.call_push_deliveries enable row level security;

revoke all on public.call_push_deliveries from anon, authenticated;

create or replace function public.touch_call_push_delivery_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists call_push_deliveries_touch_updated_at on public.call_push_deliveries;
create trigger call_push_deliveries_touch_updated_at
before update on public.call_push_deliveries
for each row execute function public.touch_call_push_delivery_updated_at();

commit;
