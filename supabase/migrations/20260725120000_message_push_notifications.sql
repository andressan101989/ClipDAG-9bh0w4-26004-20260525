begin;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema extensions;

create table if not exists public.message_push_outbox (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  sender_id uuid not null references public.user_profiles(id) on delete cascade,
  recipient_id uuid not null references public.user_profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'skipped', 'retry', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint message_push_outbox_message_uidx unique (message_id),
  constraint message_push_outbox_not_self check (sender_id <> recipient_id)
);

create table if not exists public.message_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.message_push_outbox(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  device_id uuid not null references public.call_devices(id) on delete cascade,
  token_snapshot text not null check (length(trim(token_snapshot)) > 0),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ticketed', 'sent', 'skipped', 'retry', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  locked_at timestamptz,
  locked_until timestamptz,
  attempt_id uuid,
  ticket_id text,
  receipt_status text,
  receipt_attempt_count integer not null default 0 check (receipt_attempt_count >= 0),
  receipt_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint message_push_deliveries_message_device_uidx unique (message_id, device_id)
);

create index if not exists message_push_outbox_claim_idx
  on public.message_push_outbox (status, next_attempt_at, created_at);
create index if not exists message_push_deliveries_claim_idx
  on public.message_push_deliveries (status, next_attempt_at, locked_until, created_at);
create index if not exists message_push_deliveries_receipt_idx
  on public.message_push_deliveries (status, receipt_checked_at, sent_at)
  where ticket_id is not null;

alter table public.message_push_outbox enable row level security;
alter table public.message_push_deliveries enable row level security;
revoke all on public.message_push_outbox from public, anon, authenticated;
revoke all on public.message_push_deliveries from public, anon, authenticated;
grant select, insert, update on public.message_push_outbox to service_role;
grant select, insert, update on public.message_push_deliveries to service_role;

create or replace function public.refresh_message_push_outbox(p_outbox_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total integer;
  v_open integer;
  v_sent integer;
  v_failed integer;
begin
  select count(*),
         count(*) filter (where status in ('pending','processing','ticketed','retry')),
         count(*) filter (where status = 'sent'),
         count(*) filter (where status = 'failed')
    into v_total, v_open, v_sent, v_failed
    from public.message_push_deliveries
   where outbox_id = p_outbox_id;

  update public.message_push_outbox
     set status = case
           when v_total = 0 then 'skipped'
           when v_open > 0 then 'processing'
           when v_sent > 0 then 'sent'
           when v_failed > 0 then 'failed'
           else 'skipped'
         end,
         sent_at = case when v_open = 0 and v_sent > 0 then coalesce(sent_at, now()) else sent_at end,
         last_error = case when v_open = 0 and v_sent = 0 and v_failed > 0
                           then coalesce(last_error, 'all_deliveries_failed') else last_error end
   where id = p_outbox_id;
end;
$$;

revoke all on function public.refresh_message_push_outbox(uuid) from public, anon, authenticated;
grant execute on function public.refresh_message_push_outbox(uuid) to service_role;

create or replace function public.enqueue_message_push()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_outbox_id uuid;
  v_delivery_count integer := 0;
begin
  if new.sender_id = new.recipient_id then
    return new;
  end if;

  insert into public.message_push_outbox (
    message_id, sender_id, recipient_id, status, next_attempt_at, last_error
  )
  values (
    new.id,
    new.sender_id,
    new.recipient_id,
    case when exists (
      select 1
        from public.blocked_users bu
       where (bu.blocker_id = new.recipient_id and bu.blocked_id = new.sender_id)
          or (bu.blocker_id = new.sender_id and bu.blocked_id = new.recipient_id)
    ) then 'skipped' else 'pending' end,
    now(),
    case when exists (
      select 1
        from public.blocked_users bu
       where (bu.blocker_id = new.recipient_id and bu.blocked_id = new.sender_id)
          or (bu.blocker_id = new.sender_id and bu.blocked_id = new.recipient_id)
    ) then 'blocked_relationship' else null end
  )
  on conflict (message_id) do nothing
  returning id into v_outbox_id;

  if v_outbox_id is null then
    return new;
  end if;

  if (select status from public.message_push_outbox where id = v_outbox_id) = 'skipped' then
    return new;
  end if;

  insert into public.message_push_deliveries (
    outbox_id, message_id, device_id, token_snapshot, status, next_attempt_at
  )
  select
    v_outbox_id, new.id, selected.id, selected.expo_push_token, 'pending', now()
  from (
    select distinct on (trim(cd.expo_push_token))
           cd.id, trim(cd.expo_push_token) as expo_push_token
      from public.call_devices cd
     where cd.user_id = new.recipient_id
       and cd.active = true
       and cd.expo_push_token is not null
       and trim(cd.expo_push_token) ~ '^(ExponentPushToken|ExpoPushToken)\[[^]]+\]$'
     order by trim(cd.expo_push_token), cd.last_seen_at desc, cd.updated_at desc, cd.created_at desc
  ) selected
  on conflict (message_id, device_id) do nothing;

  get diagnostics v_delivery_count = row_count;
  if v_delivery_count = 0 then
    update public.message_push_outbox
       set status = 'skipped', last_error = 'no_active_expo_device'
     where id = v_outbox_id;
  end if;

  return new;
end;
$$;

revoke all on function public.enqueue_message_push() from public, anon, authenticated;

drop trigger if exists messages_enqueue_push on public.messages;
create trigger messages_enqueue_push
after insert on public.messages
for each row execute function public.enqueue_message_push();

create or replace function public.claim_message_push_deliveries(p_limit integer default 25)
returns table (
  delivery_id uuid,
  outbox_id uuid,
  message_id uuid,
  device_id uuid,
  token_snapshot text,
  attempt_id uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  return query
  with candidates as (
    select d.id
      from public.message_push_deliveries d
     where d.attempt_count < 5
       and (
         (d.status in ('pending','retry') and coalesce(d.next_attempt_at, d.created_at) <= now())
         or (d.status = 'processing' and coalesce(d.locked_until, d.locked_at, d.created_at) < now())
       )
     order by coalesce(d.next_attempt_at, d.created_at), d.created_at
     for update skip locked
     limit v_limit
  ), claimed as (
    update public.message_push_deliveries d
       set status = 'processing',
           attempt_count = d.attempt_count + 1,
           attempt_id = gen_random_uuid(),
           locked_at = now(),
           locked_until = now() + interval '60 seconds',
           next_attempt_at = null,
           last_error = null
      from candidates
     where d.id = candidates.id
     returning d.*
  )
  select c.id, c.outbox_id, c.message_id, c.device_id, c.token_snapshot,
         c.attempt_id, c.attempt_count
    from claimed c;
end;
$$;

revoke all on function public.claim_message_push_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_message_push_deliveries(integer) to service_role;

create or replace function public.finalize_message_push_delivery(
  p_delivery_id uuid,
  p_attempt_id uuid,
  p_result text,
  p_ticket_id text default null,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_delivery public.message_push_deliveries%rowtype;
  v_next timestamptz;
begin
  if p_result not in ('ticketed','sent','skipped','retry','failed') then
    raise exception 'invalid result';
  end if;

  select * into v_delivery
    from public.message_push_deliveries
   where id = p_delivery_id
   for update;
  if v_delivery.id is null
     or v_delivery.status <> 'processing'
     or v_delivery.attempt_id is distinct from p_attempt_id then
    return false;
  end if;

  if p_result = 'retry' and v_delivery.attempt_count < 5 then
    v_next := now() + case v_delivery.attempt_count
      when 1 then interval '30 seconds'
      when 2 then interval '2 minutes'
      when 3 then interval '10 minutes'
      else interval '30 minutes'
    end;
  end if;

  update public.message_push_deliveries
     set status = case when p_result = 'retry' and attempt_count >= 5 then 'failed' else p_result end,
         ticket_id = coalesce(nullif(trim(p_ticket_id), ''), ticket_id),
         last_error = left(nullif(p_error, ''), 500),
         next_attempt_at = v_next,
         locked_at = null,
         locked_until = null,
         sent_at = case when p_result in ('ticketed','sent') then coalesce(sent_at, now()) else sent_at end
   where id = p_delivery_id;

  perform public.refresh_message_push_outbox(v_delivery.outbox_id);
  return true;
end;
$$;

revoke all on function public.finalize_message_push_delivery(uuid, uuid, text, text, text)
from public, anon, authenticated;
grant execute on function public.finalize_message_push_delivery(uuid, uuid, text, text, text)
to service_role;

create or replace function public.claim_message_push_receipts(p_limit integer default 100)
returns table (
  delivery_id uuid,
  outbox_id uuid,
  device_id uuid,
  token_snapshot text,
  ticket_id text,
  receipt_attempt_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 1000);
begin
  return query
  with candidates as (
    select d.id
      from public.message_push_deliveries d
     where d.status = 'ticketed'
       and d.ticket_id is not null
       and d.sent_at <= now() - interval '15 seconds'
       and (d.receipt_checked_at is null or d.receipt_checked_at <= now() - interval '60 seconds')
       and d.receipt_attempt_count < 10
     order by d.sent_at
     for update skip locked
     limit v_limit
  ), claimed as (
    update public.message_push_deliveries d
       set receipt_checked_at = now(),
           receipt_attempt_count = d.receipt_attempt_count + 1
      from candidates
     where d.id = candidates.id
     returning d.*
  )
  select c.id, c.outbox_id, c.device_id, c.token_snapshot, c.ticket_id,
         c.receipt_attempt_count
    from claimed c;
end;
$$;

revoke all on function public.claim_message_push_receipts(integer) from public, anon, authenticated;
grant execute on function public.claim_message_push_receipts(integer) to service_role;

create or replace function public.finalize_message_push_receipt(
  p_delivery_id uuid,
  p_result text,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_outbox_id uuid;
begin
  if p_result not in ('sent','retry','failed') then raise exception 'invalid result'; end if;
  update public.message_push_deliveries
     set status = p_result,
         receipt_status = p_result,
         last_error = left(nullif(p_error, ''), 500),
         ticket_id = case when p_result = 'retry' then null else ticket_id end,
         next_attempt_at = case when p_result = 'retry' then now() + interval '30 seconds' else null end,
         sent_at = case when p_result = 'sent' then coalesce(sent_at, now()) else sent_at end
   where id = p_delivery_id
     and status = 'ticketed'
  returning outbox_id into v_outbox_id;
  if v_outbox_id is null then return false; end if;
  perform public.refresh_message_push_outbox(v_outbox_id);
  return true;
end;
$$;

revoke all on function public.finalize_message_push_receipt(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.finalize_message_push_receipt(uuid, text, text)
to service_role;

create or replace function public.clear_invalid_message_expo_token(
  p_device_id uuid,
  p_token_snapshot text
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  with cleared as (
    update public.call_devices
       set expo_push_token = null,
           updated_at = now()
     where id = p_device_id
       and expo_push_token = p_token_snapshot
    returning id
  )
  select exists(select 1 from cleared);
$$;

revoke all on function public.clear_invalid_message_expo_token(uuid, text)
from public, anon, authenticated;
grant execute on function public.clear_invalid_message_expo_token(uuid, text)
to service_role;

create or replace function public.wake_message_push_dispatcher(p_receipts boolean default false)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_project_url text;
  v_publishable_key text;
  v_dispatch_secret text;
  v_request_id bigint;
  v_function text := case when p_receipts then 'check-message-push-receipts'
                          else 'dispatch-message-push-deliveries' end;
begin
  select ds.decrypted_secret into v_project_url
    from vault.decrypted_secrets ds where ds.name = 'call_dispatch_project_url' limit 1;
  select ds.decrypted_secret into v_publishable_key
    from vault.decrypted_secrets ds where ds.name = 'call_dispatch_publishable_key' limit 1;
  select ds.decrypted_secret into v_dispatch_secret
    from vault.decrypted_secrets ds where ds.name = 'call_dispatch_secret' limit 1;
  if nullif(trim(v_project_url), '') is null
     or nullif(trim(v_publishable_key), '') is null
     or nullif(v_dispatch_secret, '') is null then
    return null;
  end if;
  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/' || v_function,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_publishable_key,
      'Authorization', 'Bearer ' || v_publishable_key,
      'x-message-dispatch-secret', v_dispatch_secret
    ),
    body := jsonb_build_object('source', case when p_receipts then 'receipt_backstop' else 'message_outbox' end),
    timeout_milliseconds := 10000
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function public.wake_message_push_dispatcher(boolean) from public, anon, authenticated;
grant execute on function public.wake_message_push_dispatcher(boolean) to service_role;

create or replace function public.message_push_delivery_wake()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if current_setting('onspace.message_push_woken', true) = '1' then return new; end if;
  perform set_config('onspace.message_push_woken', '1', true);
  perform public.wake_message_push_dispatcher(false);
  return new;
end;
$$;

drop trigger if exists message_push_deliveries_dispatch on public.message_push_deliveries;
create trigger message_push_deliveries_dispatch
after insert on public.message_push_deliveries
for each statement execute function public.message_push_delivery_wake();

do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'message-push-dispatch-retry';
  if v_job_id is null then
    select cron.schedule(
      'message-push-dispatch-retry', '* * * * *',
      'select public.wake_message_push_dispatcher(false)'
    ) into v_job_id;
  else
    perform cron.alter_job(v_job_id, schedule := '* * * * *',
      command := 'select public.wake_message_push_dispatcher(false)', active := true);
  end if;

  select jobid into v_job_id from cron.job where jobname = 'message-push-receipts';
  if v_job_id is null then
    select cron.schedule(
      'message-push-receipts', '* * * * *',
      'select public.wake_message_push_dispatcher(true)'
    ) into v_job_id;
  else
    perform cron.alter_job(v_job_id, schedule := '* * * * *',
      command := 'select public.wake_message_push_dispatcher(true)', active := true);
  end if;
end;
$$;

commit;
