begin;

-- CHAT-V2-B keeps the V2-A migration immutable. This page projection adds
-- receipt state without changing the published chat_get_recent_messages ABI.
create or replace function public.chat_get_recent_messages_v2(
  p_conversation_id uuid,
  p_limit integer default 50,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  conversation_id uuid,
  client_message_id uuid,
  sender_id uuid,
  recipient_id uuid,
  text text,
  media_url text,
  media_type text,
  message_type text,
  reply_to_message_id uuid,
  media_asset_id uuid,
  consumption_policy text,
  audio_duration_ms integer,
  read boolean,
  deleted_at timestamptz,
  created_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  legacy_delivered boolean,
  legacy_read boolean,
  delivery_status text
)
language sql
security invoker
set search_path = pg_catalog, public
as $$
  select m.id, m.conversation_id, m.client_message_id, m.sender_id,
         m.recipient_id, m.text, m.media_url, m.media_type, m.message_type,
         m.reply_to_message_id, m.media_asset_id, m.consumption_policy,
         m.audio_duration_ms, m.read, m.deleted_at, m.created_at,
         r.delivered_at, r.read_at,
         coalesce(r.legacy_delivered, false), coalesce(r.legacy_read, false),
         case
           when r.read_at is not null or coalesce(r.legacy_read, false) or m.read then 'read'
           when r.delivered_at is not null or coalesce(r.legacy_delivered, false) then 'delivered'
           else 'sent'
         end
  from public.messages m
  left join public.chat_message_receipts r
    on r.message_id = m.id and r.user_id = m.recipient_id
  where m.conversation_id = p_conversation_id and m.deleted_at is null
    and exists (
      select 1 from public.chat_conversation_members member
      where member.conversation_id = m.conversation_id
        and member.user_id = (select auth.uid()) and member.is_active
    )
    and (p_before_created_at is null
      or (m.created_at, m.id) < (p_before_created_at, p_before_id))
  order by m.created_at desc, m.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- One bounded call acknowledges everything this authenticated recipient has
-- actually reconciled. It never marks a message read and timestamps only on
-- the server. Repeated calls and concurrent devices are monotonic.
create or replace function public.chat_acknowledge_pending_deliveries(p_limit integer default 100)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_now timestamptz := now();
  v_count bigint;
begin
  if v_actor is null then raise exception 'chat_auth_required'; end if;

  with pending as (
    select m.id, m.created_at
    from public.messages m
    left join public.chat_message_receipts r
      on r.message_id = m.id and r.user_id = v_actor
    where m.recipient_id = v_actor and m.sender_id <> v_actor
      and m.deleted_at is null
      and r.read_at is null and not coalesce(r.legacy_read, false)
      and r.delivered_at is null and not coalesce(r.legacy_delivered, false)
      and exists (
        select 1 from public.chat_conversation_members cm
        where cm.conversation_id = m.conversation_id
          and cm.user_id = v_actor and cm.is_active
      )
    order by m.created_at, m.id
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  )
  insert into public.chat_message_receipts (
    message_id, user_id, delivered_at, created_at, updated_at
  )
  select pending.id, v_actor, v_now, pending.created_at, v_now from pending
  on conflict (message_id, user_id) do update
    set delivered_at = coalesce(public.chat_message_receipts.delivered_at, excluded.delivered_at),
        updated_at = case when public.chat_message_receipts.delivered_at is null
          then excluded.updated_at else public.chat_message_receipts.updated_at end;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.chat_acknowledge_read_batch(p_message_ids uuid[])
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_now timestamptz := now();
  v_count bigint;
begin
  if v_actor is null then raise exception 'chat_auth_required'; end if;
  if coalesce(cardinality(p_message_ids), 0) > 500 then raise exception 'chat_read_batch_too_large'; end if;

  with authorized as (
    select distinct m.id, m.created_at
    from unnest(coalesce(p_message_ids, array[]::uuid[])) requested(id)
    join public.messages m on m.id = requested.id
    where m.recipient_id = v_actor and m.sender_id <> v_actor and m.deleted_at is null
      and exists (
        select 1 from public.chat_conversation_members cm
        where cm.conversation_id = m.conversation_id and cm.user_id = v_actor and cm.is_active
      )
  )
  insert into public.chat_message_receipts (
    message_id, user_id, delivered_at, read_at, created_at, updated_at
  )
  select authorized.id, v_actor, v_now, v_now, authorized.created_at, v_now from authorized
  on conflict (message_id, user_id) do update
    set delivered_at = coalesce(public.chat_message_receipts.delivered_at, excluded.delivered_at),
        read_at = coalesce(public.chat_message_receipts.read_at, excluded.read_at),
        legacy_delivered = false, legacy_read = false,
        updated_at = case when public.chat_message_receipts.read_at is null
          then excluded.updated_at else public.chat_message_receipts.updated_at end;
  get diagnostics v_count = row_count;

  update public.messages m set read = true
  where not m.read and m.recipient_id = v_actor and m.id = any(coalesce(p_message_ids, array[]::uuid[]));
  return v_count;
end;
$$;

-- Close the authorization gap between the legacy push filter and canonical
-- sending. Premium DM uses its existing financial RPC and is unchanged.
create or replace function public.chat_send_message(
  p_conversation_id uuid,
  p_client_message_id uuid,
  p_text text default '',
  p_message_type text default 'text',
  p_media_url text default null,
  p_media_asset_id uuid default null,
  p_reply_to_message_id uuid default null
)
returns public.messages
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_conversation public.chat_conversations%rowtype;
  v_recipient uuid;
  v_allow_messages_from text;
  v_existing public.messages%rowtype;
  v_result public.messages%rowtype;
begin
  if v_actor is null then raise exception 'chat_auth_required'; end if;
  if p_client_message_id is null then raise exception 'chat_idempotency_key_required'; end if;
  select * into v_conversation from public.chat_conversations where id = p_conversation_id;
  if v_conversation.id is null or v_conversation.status <> 'active' then
    raise exception 'chat_conversation_unavailable';
  end if;
  if not exists (
    select 1 from public.chat_conversation_members cm
    where cm.conversation_id = p_conversation_id and cm.user_id = v_actor and cm.is_active
  ) then raise exception 'chat_membership_required'; end if;
  if v_conversation.conversation_type <> 'direct' then raise exception 'chat_group_send_not_enabled'; end if;
  v_recipient := case when v_conversation.direct_user_a = v_actor
    then v_conversation.direct_user_b else v_conversation.direct_user_a end;
  if v_recipient is null or v_recipient = v_actor then raise exception 'chat_recipient_invalid'; end if;

  if exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = v_actor and b.blocked_id = v_recipient)
       or (b.blocker_id = v_recipient and b.blocked_id = v_actor)
  ) then raise exception 'chat_interaction_blocked'; end if;
  select coalesce(up.allow_messages_from, 'everyone') into v_allow_messages_from
  from public.user_profiles up where up.id = v_recipient;
  if v_allow_messages_from = 'nobody' then raise exception 'chat_recipient_messages_disabled'; end if;
  if v_allow_messages_from = 'followers' and not exists (
    select 1 from public.follows f
    where f.follower_id = v_actor and f.following_id = v_recipient
  ) then raise exception 'chat_recipient_followers_only'; end if;

  if p_message_type not in ('text', 'image', 'video') then raise exception 'chat_message_type_invalid'; end if;
  if length(coalesce(p_text, '')) > 5000 then raise exception 'chat_message_too_long'; end if;
  if p_message_type = 'text' and length(btrim(coalesce(p_text, ''))) = 0 then raise exception 'chat_text_required'; end if;
  if p_message_type in ('image', 'video') and nullif(btrim(coalesce(p_media_url, '')), '') is null
    and p_media_asset_id is null then raise exception 'chat_media_required'; end if;
  if p_reply_to_message_id is not null and not exists (
    select 1 from public.messages where id = p_reply_to_message_id and conversation_id = p_conversation_id
  ) then raise exception 'chat_reply_target_invalid'; end if;

  select * into v_existing from public.messages
  where sender_id = v_actor and client_message_id = p_client_message_id;
  if v_existing.id is not null then
    if v_existing.conversation_id <> p_conversation_id
      or v_existing.message_type <> p_message_type
      or v_existing.text <> coalesce(p_text, '')
      or v_existing.media_url is distinct from p_media_url
      or v_existing.media_asset_id is distinct from p_media_asset_id
      or v_existing.reply_to_message_id is distinct from p_reply_to_message_id then
      raise exception 'chat_idempotency_conflict';
    end if;
    return v_existing;
  end if;

  insert into public.messages (
    sender_id, recipient_id, conversation_id, client_message_id, text,
    media_url, media_type, message_type, media_asset_id, reply_to_message_id, read
  ) values (
    v_actor, v_recipient, p_conversation_id, p_client_message_id, coalesce(p_text, ''),
    p_media_url, p_message_type, p_message_type, p_media_asset_id, p_reply_to_message_id, false
  ) returning * into v_result;
  return v_result;
exception
  when unique_violation then
    select * into v_result from public.messages
    where sender_id = v_actor and client_message_id = p_client_message_id;
    if v_result.id is null then raise; end if;
    if v_result.conversation_id <> p_conversation_id
      or v_result.message_type <> p_message_type
      or v_result.text <> coalesce(p_text, '')
      or v_result.media_url is distinct from p_media_url
      or v_result.media_asset_id is distinct from p_media_asset_id
      or v_result.reply_to_message_id is distinct from p_reply_to_message_id then
      raise exception 'chat_idempotency_conflict';
    end if;
    return v_result;
end;
$$;

create or replace function public.chat_realtime_presence_target(p_topic text)
returns uuid
language sql immutable security invoker
set search_path = pg_catalog, public
as $$
  select case when p_topic ~ '^chat-presence:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then substring(p_topic from 15)::uuid else null end;
$$;

create or replace function public.chat_realtime_typing_conversation(p_topic text)
returns uuid
language sql immutable security invoker
set search_path = pg_catalog, public
as $$
  select case when p_topic ~ '^chat-typing:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then split_part(p_topic, ':', 2)::uuid else null end;
$$;

create or replace function public.chat_realtime_typing_publisher(p_topic text)
returns uuid
language sql immutable security invoker
set search_path = pg_catalog, public
as $$
  select case when p_topic ~ '^chat-typing:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then split_part(p_topic, ':', 3)::uuid else null end;
$$;

create or replace function public.chat_can_observe_presence(p_target uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select (select auth.uid()) is not null and p_target is not null
    and coalesce((select not up.hide_activity from public.user_profiles up where up.id = p_target), false)
    and not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = (select auth.uid()) and b.blocked_id = p_target)
         or (b.blocker_id = p_target and b.blocked_id = (select auth.uid()))
    )
    and (
      p_target = (select auth.uid()) or exists (
        select 1
        from public.chat_conversations c
        join public.chat_conversation_members mine on mine.conversation_id = c.id
        join public.chat_conversation_members other_member on other_member.conversation_id = c.id
        where c.conversation_type = 'direct' and c.status = 'active'
          and mine.user_id = (select auth.uid()) and mine.is_active
          and other_member.user_id = p_target and other_member.is_active
      )
    );
$$;

create or replace function public.chat_can_access_realtime_conversation(p_conversation uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select (select auth.uid()) is not null and p_conversation is not null
    and exists (
      select 1 from public.chat_conversation_members mine
      join public.chat_conversations c on c.id = mine.conversation_id
      where mine.conversation_id = p_conversation
        and mine.user_id = (select auth.uid()) and mine.is_active
        and c.status = 'active'
    )
    and not exists (
      select 1 from public.chat_conversation_members other_member
      join public.blocked_users b
        on (b.blocker_id = (select auth.uid()) and b.blocked_id = other_member.user_id)
        or (b.blocker_id = other_member.user_id and b.blocked_id = (select auth.uid()))
      where other_member.conversation_id = p_conversation
        and other_member.user_id <> (select auth.uid()) and other_member.is_active
    );
$$;

-- PostgreSQL combines permissive policies with OR. Refuse deployment if a
-- dashboard-created policy could broaden these private chat topics.
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'realtime' and tablename = 'messages'
      and policyname not in ('chat_v2_b_realtime_receive', 'chat_v2_b_realtime_send')
      and cmd in ('ALL', 'SELECT', 'INSERT')
      and roles::text ~ '(public|authenticated)'
  ) then raise exception 'chat_realtime_broad_policy_detected'; end if;
end;
$$;

drop policy if exists chat_v2_b_realtime_receive on realtime.messages;
create policy chat_v2_b_realtime_receive on realtime.messages
for select to authenticated using (
  (extension = 'presence' and public.chat_can_observe_presence(
    public.chat_realtime_presence_target((select realtime.topic()))
  )) or
  (extension = 'broadcast' and public.chat_can_access_realtime_conversation(
    public.chat_realtime_typing_conversation((select realtime.topic()))
  ))
);

drop policy if exists chat_v2_b_realtime_send on realtime.messages;
create policy chat_v2_b_realtime_send on realtime.messages
for insert to authenticated with check (
  (extension = 'presence'
    and public.chat_realtime_presence_target((select realtime.topic())) = (select auth.uid())
    and public.chat_can_observe_presence((select auth.uid()))) or
  (extension = 'broadcast' and public.chat_can_access_realtime_conversation(
    public.chat_realtime_typing_conversation((select realtime.topic()))
  ) and public.chat_realtime_typing_publisher((select realtime.topic())) = (select auth.uid()))
);

revoke all on function public.chat_get_recent_messages_v2(uuid, integer, timestamptz, uuid) from public, anon;
revoke all on function public.chat_acknowledge_pending_deliveries(integer) from public, anon;
revoke all on function public.chat_acknowledge_read_batch(uuid[]) from public, anon;
revoke all on function public.chat_realtime_presence_target(text) from public, anon;
revoke all on function public.chat_realtime_typing_conversation(text) from public, anon;
revoke all on function public.chat_realtime_typing_publisher(text) from public, anon;
revoke all on function public.chat_can_observe_presence(uuid) from public, anon;
revoke all on function public.chat_can_access_realtime_conversation(uuid) from public, anon;
revoke all on function public.chat_send_message(uuid, uuid, text, text, text, uuid, uuid) from public, anon;

grant execute on function public.chat_get_recent_messages_v2(uuid, integer, timestamptz, uuid) to authenticated;
grant execute on function public.chat_acknowledge_pending_deliveries(integer) to authenticated;
grant execute on function public.chat_acknowledge_read_batch(uuid[]) to authenticated;
grant execute on function public.chat_realtime_presence_target(text) to authenticated;
grant execute on function public.chat_realtime_typing_conversation(text) to authenticated;
grant execute on function public.chat_realtime_typing_publisher(text) to authenticated;
grant execute on function public.chat_can_observe_presence(uuid) to authenticated;
grant execute on function public.chat_can_access_realtime_conversation(uuid) to authenticated;
grant execute on function public.chat_send_message(uuid, uuid, text, text, text, uuid, uuid) to authenticated;

commit;
