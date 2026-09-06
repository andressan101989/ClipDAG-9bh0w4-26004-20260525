begin;

-- CHAT-V2-A evolves public.messages in place. Historical message UUIDs remain
-- unchanged so Premium DM and message-push foreign keys remain valid.
lock table public.messages in share row exclusive mode;

do $$
begin
  if exists (select 1 from public.messages where sender_id is null or recipient_id is null) then
    raise exception 'chat_v2_a_precondition_null_direct_participant';
  end if;
  if exists (select 1 from public.messages where sender_id = recipient_id) then
    raise exception 'chat_v2_a_precondition_self_message';
  end if;
end;
$$;

create temporary table _chat_v2_a_counts (
  message_count bigint not null,
  message_id_digest text not null,
  premium_link_count bigint,
  push_outbox_count bigint,
  push_delivery_count bigint
) on commit drop;

do $$
declare
  v_premium bigint := null;
  v_outbox bigint := null;
  v_deliveries bigint := null;
begin
  if to_regclass('public.premium_dm_payments') is not null then
    execute 'select count(*) from public.premium_dm_payments where message_id is not null' into v_premium;
  end if;
  if to_regclass('public.message_push_outbox') is not null then
    execute 'select count(*) from public.message_push_outbox' into v_outbox;
  end if;
  if to_regclass('public.message_push_deliveries') is not null then
    execute 'select count(*) from public.message_push_deliveries' into v_deliveries;
  end if;
  insert into _chat_v2_a_counts
  select count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')), v_premium, v_outbox, v_deliveries
    from public.messages;
end;
$$;

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  conversation_type text not null check (conversation_type in ('direct', 'group')),
  status text not null default 'active' check (status in ('active', 'closed')),
  created_by uuid not null references public.user_profiles(id) on delete restrict,
  group_name text,
  group_avatar_url text,
  direct_user_a uuid references public.user_profiles(id) on delete restrict,
  direct_user_b uuid references public.user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  constraint chat_conversations_direct_shape check (
    (conversation_type = 'direct'
      and direct_user_a is not null and direct_user_b is not null
      and direct_user_a::text < direct_user_b::text
      and group_name is null and group_avatar_url is null)
    or
    (conversation_type = 'group'
      and direct_user_a is null and direct_user_b is null)
  ),
  constraint chat_conversations_group_name_length check (
    group_name is null or length(btrim(group_name)) between 1 and 120
  )
);

create unique index chat_conversations_direct_pair_uidx
  on public.chat_conversations (direct_user_a, direct_user_b)
  where conversation_type = 'direct';
create index chat_conversations_activity_idx
  on public.chat_conversations (last_activity_at desc, id desc);

create table public.chat_conversation_members (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  is_active boolean not null default true,
  notifications_enabled boolean not null default true,
  muted_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id),
  constraint chat_conversation_members_active_shape check (
    (is_active and left_at is null) or (not is_active and left_at is not null)
  )
);

create index chat_conversation_members_user_active_idx
  on public.chat_conversation_members (user_id, conversation_id)
  where is_active;
create index chat_conversation_members_conversation_active_idx
  on public.chat_conversation_members (conversation_id, user_id)
  where is_active;

alter table public.messages
  add column conversation_id uuid,
  add column client_message_id uuid,
  add column message_type text,
  add column reply_to_message_id uuid,
  add column deleted_at timestamptz,
  add column media_asset_id uuid,
  add column consumption_policy text not null default 'standard',
  add column audio_duration_ms integer;

insert into public.chat_conversations (
  id, conversation_type, status, created_by, direct_user_a, direct_user_b,
  created_at, updated_at, last_activity_at
)
select
  md5('clipdag:chat:direct:' || pair.user_a::text || ':' || pair.user_b::text)::uuid,
  'direct', 'active', pair.user_a, pair.user_a, pair.user_b,
  pair.first_message_at, pair.last_message_at, pair.last_message_at
from (
  select
    case when sender_id::text < recipient_id::text then sender_id else recipient_id end as user_a,
    case when sender_id::text < recipient_id::text then recipient_id else sender_id end as user_b,
    min(created_at) as first_message_at,
    max(created_at) as last_message_at
  from public.messages
  group by 1, 2
) pair;

insert into public.chat_conversation_members (
  conversation_id, user_id, role, joined_at, is_active, created_at, updated_at
)
select c.id, member.user_id, 'member', c.created_at, true, c.created_at, c.created_at
from public.chat_conversations c
cross join lateral (values (c.direct_user_a), (c.direct_user_b)) member(user_id)
where c.conversation_type = 'direct';

update public.messages m
set conversation_id = c.id,
    client_message_id = m.id,
    message_type = case
      when m.media_type = 'image' then 'image'
      when m.media_type = 'video' then 'video'
      when m.media_type = 'premium_dm' then 'premium_dm'
      else 'text'
    end
from public.chat_conversations c
where c.conversation_type = 'direct'
  and c.direct_user_a = case when m.sender_id::text < m.recipient_id::text then m.sender_id else m.recipient_id end
  and c.direct_user_b = case when m.sender_id::text < m.recipient_id::text then m.recipient_id else m.sender_id end;

alter table public.messages
  alter column conversation_id set not null,
  alter column client_message_id set not null,
  alter column message_type set not null,
  add constraint messages_conversation_id_fkey foreign key (conversation_id)
    references public.chat_conversations(id) on delete restrict,
  add constraint messages_reply_to_message_id_fkey foreign key (reply_to_message_id)
    references public.messages(id) on delete set null,
  add constraint messages_message_type_check check (
    message_type in ('text', 'image', 'video', 'premium_dm', 'one_time_image', 'voice', 'system')
  ),
  add constraint messages_consumption_policy_check check (
    consumption_policy in ('standard', 'one_time')
  ),
  add constraint messages_audio_duration_check check (
    audio_duration_ms is null or audio_duration_ms between 1 and 3600000
  ),
  add constraint messages_deleted_at_check check (deleted_at is null or deleted_at >= created_at);

create unique index messages_sender_client_message_uidx
  on public.messages (sender_id, client_message_id);
create index messages_conversation_cursor_idx
  on public.messages (conversation_id, created_at desc, id desc)
  where deleted_at is null;
create index messages_reply_to_idx
  on public.messages (reply_to_message_id)
  where reply_to_message_id is not null;
create index messages_media_asset_idx
  on public.messages (media_asset_id)
  where media_asset_id is not null;

create table public.chat_message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  legacy_delivered boolean not null default false,
  legacy_read boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (message_id, user_id),
  constraint chat_message_receipts_read_delivery_check check (
    read_at is null or delivered_at is not null
  ),
  constraint chat_message_receipts_timestamp_order_check check (
    read_at is null or delivered_at <= read_at
  ),
  constraint chat_message_receipts_legacy_read_check check (
    not legacy_read or legacy_delivered
  )
);

create index chat_message_receipts_user_unread_idx
  on public.chat_message_receipts (user_id, created_at desc, message_id)
  where read_at is null and not legacy_read;
create index chat_message_receipts_message_idx
  on public.chat_message_receipts (message_id, user_id);

-- Historical boolean state is preserved without fabricating delivery/read
-- timestamps. legacy_* records that the state existed before receipts did.
insert into public.chat_message_receipts (
  message_id, user_id, delivered_at, read_at,
  legacy_delivered, legacy_read, created_at, updated_at
)
select m.id, m.recipient_id, null, null, m.read, m.read, m.created_at, now()
from public.messages m;

create or replace function public.chat_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger chat_conversations_touch_updated_at
before update on public.chat_conversations
for each row execute function public.chat_touch_updated_at();
create trigger chat_conversation_members_touch_updated_at
before update on public.chat_conversation_members
for each row execute function public.chat_touch_updated_at();
create trigger chat_message_receipts_touch_updated_at
before update on public.chat_message_receipts
for each row execute function public.chat_touch_updated_at();

create or replace function public.chat_is_active_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.chat_conversation_members member
    where member.conversation_id = p_conversation_id
      and member.user_id = (select auth.uid()) and member.is_active
  );
$$;

create or replace function public.chat_guard_direct_membership()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_conversation public.chat_conversations%rowtype;
begin
  select * into v_conversation
  from public.chat_conversations
  where id = coalesce(new.conversation_id, old.conversation_id);

  if v_conversation.conversation_type = 'direct' then
    if tg_op = 'DELETE' then
      raise exception 'chat_direct_membership_immutable';
    end if;
    if new.user_id not in (v_conversation.direct_user_a, v_conversation.direct_user_b)
      or not new.is_active or new.left_at is not null or new.role <> 'member' then
      raise exception 'chat_direct_membership_invalid';
    end if;
    if tg_op = 'UPDATE'
      and (new.user_id <> old.user_id or new.conversation_id <> old.conversation_id) then
      raise exception 'chat_direct_membership_immutable';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger chat_conversation_members_guard_direct
before insert or update or delete on public.chat_conversation_members
for each row execute function public.chat_guard_direct_membership();

create or replace function public.chat_prepare_legacy_message()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_a uuid;
  v_b uuid;
begin
  if v_actor is not null and new.sender_id <> v_actor then
    raise exception 'chat_sender_identity_mismatch';
  end if;
  if new.sender_id is null or new.recipient_id is null or new.sender_id = new.recipient_id then
    raise exception 'chat_direct_participants_invalid';
  end if;
  if new.media_type not in ('text', 'image', 'video', 'premium_dm') then
    raise exception 'chat_message_type_invalid';
  end if;
  if length(coalesce(new.text, '')) > 5000 then
    raise exception 'chat_message_too_long';
  end if;
  if new.media_type = 'text' and length(btrim(coalesce(new.text, ''))) = 0 then
    raise exception 'chat_text_required';
  end if;
  if new.media_type in ('image', 'video')
    and nullif(btrim(coalesce(new.media_url, '')), '') is null then
    raise exception 'chat_media_required';
  end if;
  if v_actor is not null then
    new.read := false;
  end if;
  v_a := case when new.sender_id::text < new.recipient_id::text then new.sender_id else new.recipient_id end;
  v_b := case when new.sender_id::text < new.recipient_id::text then new.recipient_id else new.sender_id end;

  if new.conversation_id is null then
    insert into public.chat_conversations (
      conversation_type, created_by, direct_user_a, direct_user_b
    ) values ('direct', new.sender_id, v_a, v_b)
    on conflict (direct_user_a, direct_user_b) where conversation_type = 'direct'
    do nothing
    returning id into new.conversation_id;
    if new.conversation_id is null then
      select id into new.conversation_id from public.chat_conversations
      where conversation_type = 'direct' and direct_user_a = v_a and direct_user_b = v_b;
    end if;
  end if;

  if not exists (
    select 1 from public.chat_conversations c
    where c.id = new.conversation_id and c.conversation_type = 'direct'
      and c.status = 'active' and c.direct_user_a = v_a and c.direct_user_b = v_b
  ) then
    raise exception 'chat_message_conversation_mismatch';
  end if;

  insert into public.chat_conversation_members (conversation_id, user_id, role)
  values (new.conversation_id, v_a, 'member'), (new.conversation_id, v_b, 'member')
  on conflict (conversation_id, user_id) do nothing;

  new.client_message_id := coalesce(new.client_message_id, new.id, gen_random_uuid());
  new.message_type := coalesce(new.message_type, case
    when new.media_type = 'image' then 'image'
    when new.media_type = 'video' then 'video'
    when new.media_type = 'premium_dm' then 'premium_dm'
    else 'text'
  end);
  return new;
end;
$$;

revoke all on function public.chat_prepare_legacy_message() from public, anon, authenticated;

create trigger messages_chat_prepare
before insert on public.messages
for each row execute function public.chat_prepare_legacy_message();

create or replace function public.chat_after_message_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is not null and new.sender_id <> v_actor then
    raise exception 'chat_sender_identity_mismatch';
  end if;
  update public.chat_conversations
  set last_activity_at = greatest(last_activity_at, new.created_at)
  where id = new.conversation_id;

  insert into public.chat_message_receipts (message_id, user_id, created_at)
  values (new.id, new.recipient_id, new.created_at)
  on conflict (message_id, user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.chat_after_message_insert() from public, anon, authenticated;

create trigger messages_chat_after_insert
after insert on public.messages
for each row execute function public.chat_after_message_insert();

create or replace function public.chat_sync_legacy_read()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if old.read and not new.read then
    raise exception 'chat_read_state_cannot_regress';
  end if;
  if v_actor is not null and new.recipient_id <> v_actor then
    raise exception 'chat_receipt_identity_mismatch';
  end if;
  if not old.read and new.read then
    insert into public.chat_message_receipts (
      message_id, user_id, delivered_at, read_at, created_at, updated_at
    ) values (new.id, new.recipient_id, now(), now(), new.created_at, now())
    on conflict (message_id, user_id) do update
      set delivered_at = coalesce(public.chat_message_receipts.delivered_at, excluded.delivered_at),
          read_at = coalesce(public.chat_message_receipts.read_at, excluded.read_at),
          legacy_delivered = false,
          legacy_read = false;
  end if;
  return new;
end;
$$;

revoke all on function public.chat_sync_legacy_read() from public, anon, authenticated;

create trigger messages_chat_sync_legacy_read
before update of read on public.messages
for each row execute function public.chat_sync_legacy_read();

create or replace function public.chat_get_or_create_direct(p_other_user_id uuid)
returns public.chat_conversations
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_a uuid;
  v_b uuid;
  v_result public.chat_conversations%rowtype;
begin
  if v_actor is null then raise exception 'chat_auth_required'; end if;
  if p_other_user_id is null or p_other_user_id = v_actor then
    raise exception 'chat_direct_participants_invalid';
  end if;
  if not exists (select 1 from public.user_profiles where id = p_other_user_id) then
    raise exception 'chat_recipient_not_found';
  end if;
  v_a := case when v_actor::text < p_other_user_id::text then v_actor else p_other_user_id end;
  v_b := case when v_actor::text < p_other_user_id::text then p_other_user_id else v_actor end;

  insert into public.chat_conversations (conversation_type, created_by, direct_user_a, direct_user_b)
  values ('direct', v_actor, v_a, v_b)
  on conflict (direct_user_a, direct_user_b) where conversation_type = 'direct'
  do nothing
  returning * into v_result;
  if v_result.id is null then
    select * into v_result from public.chat_conversations
    where conversation_type = 'direct' and direct_user_a = v_a and direct_user_b = v_b;
  end if;

  insert into public.chat_conversation_members (conversation_id, user_id, role)
  values (v_result.id, v_a, 'member'), (v_result.id, v_b, 'member')
  on conflict (conversation_id, user_id) do nothing;
  return v_result;
end;
$$;

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
  if v_conversation.conversation_type <> 'direct' then
    raise exception 'chat_group_send_not_enabled';
  end if;
  v_recipient := case when v_conversation.direct_user_a = v_actor
    then v_conversation.direct_user_b else v_conversation.direct_user_a end;
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

create or replace function public.chat_acknowledge_delivery(p_message_id uuid)
returns public.chat_message_receipts
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_message public.messages%rowtype;
  v_result public.chat_message_receipts%rowtype;
begin
  if v_actor is null then raise exception 'chat_auth_required'; end if;
  select * into v_message from public.messages where id = p_message_id;
  if v_message.id is null or v_message.sender_id = v_actor or v_message.recipient_id <> v_actor then
    raise exception 'chat_receipt_not_authorized';
  end if;
  insert into public.chat_message_receipts (message_id, user_id, delivered_at, created_at, updated_at)
  values (p_message_id, v_actor, now(), v_message.created_at, now())
  on conflict (message_id, user_id) do update
    set delivered_at = coalesce(public.chat_message_receipts.delivered_at, excluded.delivered_at),
        legacy_delivered = public.chat_message_receipts.legacy_read
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.chat_acknowledge_read(p_message_id uuid)
returns public.chat_message_receipts
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_message public.messages%rowtype;
  v_now timestamptz := now();
  v_result public.chat_message_receipts%rowtype;
begin
  if v_actor is null then raise exception 'chat_auth_required'; end if;
  select * into v_message from public.messages where id = p_message_id;
  if v_message.id is null or v_message.sender_id = v_actor or v_message.recipient_id <> v_actor then
    raise exception 'chat_receipt_not_authorized';
  end if;
  insert into public.chat_message_receipts (
    message_id, user_id, delivered_at, read_at, created_at, updated_at
  ) values (p_message_id, v_actor, v_now, v_now, v_message.created_at, v_now)
  on conflict (message_id, user_id) do update
    set delivered_at = coalesce(public.chat_message_receipts.delivered_at, excluded.delivered_at),
        read_at = coalesce(public.chat_message_receipts.read_at, excluded.read_at),
        legacy_delivered = false, legacy_read = false
  returning * into v_result;
  update public.messages set read = true where id = p_message_id and not read;
  return v_result;
end;
$$;

create or replace function public.chat_mark_conversation_read(p_conversation_id uuid)
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
  if not exists (
    select 1 from public.chat_conversation_members
    where conversation_id = p_conversation_id and user_id = v_actor and is_active
  ) then raise exception 'chat_membership_required'; end if;

  insert into public.chat_message_receipts (
    message_id, user_id, delivered_at, read_at, created_at, updated_at
  )
  select m.id, v_actor, v_now, v_now, m.created_at, v_now
  from public.messages m
  where m.conversation_id = p_conversation_id and m.sender_id <> v_actor
  on conflict (message_id, user_id) do update
    set delivered_at = coalesce(public.chat_message_receipts.delivered_at, excluded.delivered_at),
        read_at = coalesce(public.chat_message_receipts.read_at, excluded.read_at),
        legacy_delivered = false, legacy_read = false;
  get diagnostics v_count = row_count;
  update public.messages set read = true
  where conversation_id = p_conversation_id and recipient_id = v_actor and not read;
  return v_count;
end;
$$;

create or replace function public.chat_get_conversations(
  p_limit integer default 30,
  p_before_activity_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  conversation_id uuid,
  conversation_type text,
  conversation_status text,
  last_activity_at timestamptz,
  other_user_id uuid,
  other_username text,
  other_avatar_url text,
  last_message jsonb,
  unread_count bigint
)
language sql
security invoker
set search_path = pg_catalog, public
as $$
  select c.id, c.conversation_type, c.status, c.last_activity_at,
         other.user_id, profile.username, profile.avatar_url,
         case when latest.id is null then null else jsonb_build_object(
           'id', latest.id, 'sender_id', latest.sender_id, 'recipient_id', latest.recipient_id,
           'conversation_id', latest.conversation_id, 'client_message_id', latest.client_message_id,
           'text', latest.text, 'media_url', latest.media_url, 'media_type', latest.media_type,
           'message_type', latest.message_type, 'read', latest.read, 'created_at', latest.created_at
         ) end,
         (select count(*) from public.chat_message_receipts receipt
          join public.messages unread_message on unread_message.id = receipt.message_id
          where unread_message.conversation_id = c.id and receipt.user_id = (select auth.uid())
            and receipt.read_at is null and not receipt.legacy_read)
  from public.chat_conversation_members mine
  join public.chat_conversations c on c.id = mine.conversation_id
  left join lateral (
    select member.user_id from public.chat_conversation_members member
    where member.conversation_id = c.id and member.user_id <> (select auth.uid()) and member.is_active
    order by member.user_id limit 1
  ) other on true
  left join public.user_profiles profile on profile.id = other.user_id
  left join lateral (
    select m.* from public.messages m where m.conversation_id = c.id and m.deleted_at is null
    order by m.created_at desc, m.id desc limit 1
  ) latest on true
  where mine.user_id = (select auth.uid()) and mine.is_active
    and (p_before_activity_at is null
      or (c.last_activity_at, c.id) < (p_before_activity_at, p_before_id))
  order by c.last_activity_at desc, c.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

create or replace function public.chat_get_recent_messages(
  p_conversation_id uuid,
  p_limit integer default 50,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns setof public.messages
language sql
security invoker
set search_path = pg_catalog, public
as $$
  select m.* from public.messages m
  where m.conversation_id = p_conversation_id and m.deleted_at is null
    and exists (
      select 1 from public.chat_conversation_members member
      where member.conversation_id = m.conversation_id
        and member.user_id = (select auth.uid()) and member.is_active
    )
    and (p_before_created_at is null or (m.created_at, m.id) < (p_before_created_at, p_before_id))
  order by m.created_at desc, m.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.chat_get_members(p_conversation_id uuid)
returns setof public.chat_conversation_members
language sql
security invoker
set search_path = pg_catalog, public
as $$
  select member.* from public.chat_conversation_members member
  where member.conversation_id = p_conversation_id
    and exists (
      select 1 from public.chat_conversation_members mine
      where mine.conversation_id = p_conversation_id
        and mine.user_id = (select auth.uid()) and mine.is_active
    )
  order by member.joined_at, member.user_id;
$$;

alter table public.chat_conversations enable row level security;
alter table public.chat_conversation_members enable row level security;
alter table public.chat_message_receipts enable row level security;

drop policy if exists chat_conversations_member_select on public.chat_conversations;
create policy chat_conversations_member_select on public.chat_conversations
for select to authenticated using (
  public.chat_is_active_member(id)
);

drop policy if exists chat_conversation_members_member_select on public.chat_conversation_members;
create policy chat_conversation_members_member_select on public.chat_conversation_members
for select to authenticated using (
  public.chat_is_active_member(chat_conversation_members.conversation_id)
);

drop policy if exists chat_message_receipts_member_select on public.chat_message_receipts;
create policy chat_message_receipts_member_select on public.chat_message_receipts
for select to authenticated using (
  exists (select 1 from public.messages message
    where message.id = chat_message_receipts.message_id
      and public.chat_is_active_member(message.conversation_id))
);

drop policy if exists messages_select_participant on public.messages;
drop policy if exists "messages_select_participant" on public.messages;
create policy messages_select_participant on public.messages
for select to authenticated using (
  public.chat_is_active_member(messages.conversation_id)
);

drop policy if exists messages_insert_own on public.messages;
drop policy if exists "messages_insert_own" on public.messages;
create policy messages_insert_own on public.messages
for insert to authenticated with check ((select auth.uid()) = sender_id);

drop policy if exists messages_update_recipient on public.messages;
drop policy if exists "messages_update_recipient" on public.messages;
create policy messages_update_recipient on public.messages
for update to authenticated
using ((select auth.uid()) = recipient_id)
with check ((select auth.uid()) = recipient_id);

revoke all on table public.chat_conversations, public.chat_conversation_members,
  public.chat_message_receipts from public, anon, authenticated;
grant select on table public.chat_conversations, public.chat_conversation_members,
  public.chat_message_receipts to authenticated;
grant all on table public.chat_conversations, public.chat_conversation_members,
  public.chat_message_receipts to service_role;

revoke all on table public.messages from public, anon;
revoke insert, update, delete on table public.messages from authenticated;
grant select on table public.messages to authenticated;
grant insert (sender_id, recipient_id, text, media_url, media_type, read)
  on public.messages to authenticated;
grant update (read) on public.messages to authenticated;

revoke all on function public.chat_touch_updated_at() from public, anon, authenticated;
revoke all on function public.chat_guard_direct_membership() from public, anon, authenticated;
revoke all on function public.chat_is_active_member(uuid) from public, anon;
revoke all on function public.chat_get_or_create_direct(uuid) from public, anon;
revoke all on function public.chat_send_message(uuid, uuid, text, text, text, uuid, uuid) from public, anon;
revoke all on function public.chat_acknowledge_delivery(uuid) from public, anon;
revoke all on function public.chat_acknowledge_read(uuid) from public, anon;
revoke all on function public.chat_mark_conversation_read(uuid) from public, anon;
revoke all on function public.chat_get_conversations(integer, timestamptz, uuid) from public, anon;
revoke all on function public.chat_get_recent_messages(uuid, integer, timestamptz, uuid) from public, anon;
revoke all on function public.chat_get_members(uuid) from public, anon;
grant execute on function public.chat_get_or_create_direct(uuid) to authenticated;
grant execute on function public.chat_is_active_member(uuid) to authenticated;
grant execute on function public.chat_send_message(uuid, uuid, text, text, text, uuid, uuid) to authenticated;
grant execute on function public.chat_acknowledge_delivery(uuid) to authenticated;
grant execute on function public.chat_acknowledge_read(uuid) to authenticated;
grant execute on function public.chat_mark_conversation_read(uuid) to authenticated;
grant execute on function public.chat_get_conversations(integer, timestamptz, uuid) to authenticated;
grant execute on function public.chat_get_recent_messages(uuid, integer, timestamptz, uuid) to authenticated;
grant execute on function public.chat_get_members(uuid) to authenticated;

-- Trigger functions do not need client EXECUTE. Reassert the existing push
-- trigger's intended ACL without changing its dispatcher behavior.
revoke all on function public.message_push_delivery_wake() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'chat_conversations'
  ) then alter publication supabase_realtime add table public.chat_conversations; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'chat_conversation_members'
  ) then alter publication supabase_realtime add table public.chat_conversation_members; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'chat_message_receipts'
  ) then alter publication supabase_realtime add table public.chat_message_receipts; end if;
end;
$$;

do $$
declare
  v_before _chat_v2_a_counts%rowtype;
  v_count bigint;
  v_digest text;
  v_compare bigint;
begin
  select * into v_before from _chat_v2_a_counts;
  select count(*), md5(coalesce(string_agg(id::text, ',' order by id), ''))
    into v_count, v_digest from public.messages;
  if v_count <> v_before.message_count or v_digest <> v_before.message_id_digest then
    raise exception 'chat_v2_a_message_identity_mismatch';
  end if;
  if exists (select 1 from public.messages where conversation_id is null) then
    raise exception 'chat_v2_a_orphan_message';
  end if;
  if (select count(*) from public.chat_message_receipts) <> v_before.message_count then
    raise exception 'chat_v2_a_receipt_backfill_mismatch';
  end if;
  if exists (
    select direct_user_a, direct_user_b from public.chat_conversations
    where conversation_type = 'direct' group by direct_user_a, direct_user_b having count(*) <> 1
  ) then raise exception 'chat_v2_a_duplicate_direct_conversation'; end if;
  if exists (
    select c.id from public.chat_conversations c
    left join public.chat_conversation_members member on member.conversation_id = c.id and member.is_active
    where c.conversation_type = 'direct' group by c.id having count(member.user_id) <> 2
  ) then raise exception 'chat_v2_a_direct_membership_mismatch'; end if;

  if v_before.premium_link_count is not null then
    execute 'select count(*) from public.premium_dm_payments where message_id is not null' into v_compare;
    if v_compare <> v_before.premium_link_count then raise exception 'chat_v2_a_premium_link_mismatch'; end if;
    execute 'select count(*) from public.premium_dm_payments payment left join public.messages message on message.id = payment.message_id where payment.message_id is not null and message.id is null' into v_compare;
    if v_compare <> 0 then raise exception 'chat_v2_a_premium_orphan'; end if;
  end if;
  if v_before.push_outbox_count is not null then
    execute 'select count(*) from public.message_push_outbox' into v_compare;
    if v_compare <> v_before.push_outbox_count then raise exception 'chat_v2_a_push_outbox_mismatch'; end if;
  end if;
  if v_before.push_delivery_count is not null then
    execute 'select count(*) from public.message_push_deliveries' into v_compare;
    if v_compare <> v_before.push_delivery_count then raise exception 'chat_v2_a_push_delivery_mismatch'; end if;
  end if;
end;
$$;

comment on column public.messages.recipient_id is
  'Temporary direct-message compatibility column. CHAT-V2-B must update group push/read consumers before allowing NULL for group messages.';
comment on column public.chat_message_receipts.legacy_read is
  'True when only the historical messages.read boolean is known; no read timestamp was invented during backfill.';
comment on function public.chat_prepare_legacy_message() is
  'Temporary one-way compatibility adapter for legacy direct inserts. Remove after all supported clients use chat_send_message.';

commit;
