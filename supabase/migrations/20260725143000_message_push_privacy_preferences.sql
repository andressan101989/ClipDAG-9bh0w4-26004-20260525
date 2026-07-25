begin;

create or replace function public.enqueue_message_push()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_outbox_id uuid;
  v_delivery_count integer := 0;
  v_skip_reason text;
  v_allow_messages_from text;
begin
  if new.sender_id = new.recipient_id then
    return new;
  end if;

  if exists (
    select 1
      from public.blocked_users bu
     where (bu.blocker_id = new.recipient_id and bu.blocked_id = new.sender_id)
        or (bu.blocker_id = new.sender_id and bu.blocked_id = new.recipient_id)
  ) then
    v_skip_reason := 'blocked_relationship';
  else
    select coalesce(up.allow_messages_from, 'everyone')
      into v_allow_messages_from
      from public.user_profiles up
     where up.id = new.recipient_id;

    if v_allow_messages_from = 'nobody' then
      v_skip_reason := 'recipient_messages_disabled';
    elsif v_allow_messages_from = 'followers' and not exists (
      select 1 from public.follows f
       where f.follower_id = new.sender_id
         and f.following_id = new.recipient_id
    ) then
      v_skip_reason := 'recipient_followers_only';
    end if;
  end if;

  insert into public.message_push_outbox (
    message_id, sender_id, recipient_id, status, next_attempt_at, last_error
  )
  values (
    new.id,
    new.sender_id,
    new.recipient_id,
    case when v_skip_reason is null then 'pending' else 'skipped' end,
    now(),
    v_skip_reason
  )
  on conflict (message_id) do nothing
  returning id into v_outbox_id;

  if v_outbox_id is null or v_skip_reason is not null then
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

commit;
