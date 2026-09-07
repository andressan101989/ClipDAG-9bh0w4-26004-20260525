begin;

-- CHAT-V2-C reuses the existing private R2 media_assets authority. Consumption
-- belongs to the per-recipient receipt so the model remains group-ready.
alter table public.chat_message_receipts
  add column media_consumed_at timestamptz;

comment on column public.chat_message_receipts.media_consumed_at is
  'Server timestamp of the successful one-time media claim for this recipient. NULL means unconsumed.';

create index chat_message_receipts_consumed_idx
  on public.chat_message_receipts (message_id, user_id, media_consumed_at)
  where media_consumed_at is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_media_asset_id_fkey'
  ) then
    alter table public.messages
      add constraint messages_media_asset_id_fkey
      foreign key (media_asset_id) references public.media_assets(id) on delete restrict
      not valid;
    alter table public.messages validate constraint messages_media_asset_id_fkey;
  end if;
end;
$$;

alter table public.messages
  add constraint messages_one_time_media_consistency_check check (
    (message_type = 'one_time_image'
      and consumption_policy = 'one_time'
      and media_asset_id is not null
      and media_url is null)
    or
    (message_type <> 'one_time_image' and consumption_policy = 'standard')
  );

create unique index chat_message_asset_unique
  on public.media_asset_links (asset_id)
  where entity_type = 'chat_message';

create unique index chat_message_content_unique
  on public.media_asset_links (entity_id)
  where entity_type = 'chat_message' and slot = 'content';

-- Preserve every existing media link authority and add only canonical chat
-- messages, so linked private chat assets are never treated as stale orphans.
create or replace function public.media_asset_has_valid_links(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists(
    select 1 from public.media_asset_links l
    join public.media_assets a on a.id = l.asset_id
    where l.asset_id = p_asset_id and (
      (l.entity_type = 'user_profile' and exists(
        select 1 from public.user_profiles u
        where u.id = l.entity_id and u.avatar_url = a.public_url))
      or (l.entity_type = 'video_post' and exists(
        select 1 from public.videos v where v.id = l.entity_id))
      or (l.entity_type = 'story' and exists(
        select 1 from public.stories s where s.id = l.entity_id and s.expires_at > now()))
      or (l.entity_type = 'shop_product' and exists(
        select 1 from public.products p where p.id = l.entity_id and p.status <> 'deleted'))
      or (l.entity_type = 'marketplace_store' and exists(
        select 1 from public.marketplace_stores s where s.id = l.entity_id and (
          (l.slot = 'logo' and s.logo_asset_id = l.asset_id)
          or (l.slot = 'banner' and s.banner_asset_id = l.asset_id))))
      or (l.entity_type = 'marketplace_dispute'
        and l.slot in ('buyer_evidence', 'seller_evidence') and exists(
          select 1 from public.marketplace_order_disputes d where d.id = l.entity_id))
      or (l.entity_type = 'marketplace_return_shipment'
        and l.slot = 'return_label' and exists(
          select 1 from public.marketplace_return_shipments rs
          where rs.id = l.entity_id and rs.return_label_asset_id = l.asset_id))
      or (l.entity_type = 'chat_message' and l.slot = 'content' and exists(
        select 1 from public.messages m
        where m.id = l.entity_id and m.media_asset_id = l.asset_id and m.deleted_at is null))
    )
  );
$$;

revoke all on function public.media_asset_has_valid_links(uuid)
  from public, anon, authenticated;
grant execute on function public.media_asset_has_valid_links(uuid)
  to service_role;

-- Keep the legacy adapter compatible with canonical private images while
-- preventing legacy clients from creating one-time media with a public URL.
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
  v_asset public.media_assets%rowtype;
begin
  if v_actor is not null and new.sender_id <> v_actor then
    raise exception 'chat_sender_identity_mismatch';
  end if;
  if new.sender_id is null or new.recipient_id is null or new.sender_id = new.recipient_id then
    raise exception 'chat_direct_participants_invalid';
  end if;
  if new.media_type not in ('text', 'image', 'video', 'premium_dm', 'one_time_image') then
    raise exception 'chat_message_type_invalid';
  end if;
  if length(coalesce(new.text, '')) > 5000 then raise exception 'chat_message_too_long'; end if;
  if new.media_type = 'text' and length(btrim(coalesce(new.text, ''))) = 0 then
    raise exception 'chat_text_required';
  end if;
  if new.media_type in ('image', 'video')
    and nullif(btrim(coalesce(new.media_url, '')), '') is null
    and new.media_asset_id is null then raise exception 'chat_media_required'; end if;
  if new.media_type = 'one_time_image'
    and (new.media_asset_id is null or new.media_url is not null) then
    raise exception 'chat_one_time_private_asset_required';
  end if;
  if new.media_asset_id is not null then
    select * into v_asset from public.media_assets where id = new.media_asset_id for update;
    if v_asset.id is null or v_asset.owner_id <> new.sender_id or v_asset.status <> 'ready'
      or v_asset.visibility <> 'private' or v_asset.provider <> 'r2'
      or v_asset.media_kind <> 'image' or v_asset.purpose <> 'chat_image'
      or v_asset.public_url is not null then raise exception 'chat_media_asset_invalid'; end if;
    if new.media_type not in ('image', 'one_time_image') or new.media_url is not null then
      raise exception 'chat_private_media_contract_invalid';
    end if;
    if exists (select 1 from public.media_asset_links l where l.asset_id = new.media_asset_id) then
      raise exception 'chat_media_asset_already_linked';
    end if;
  end if;
  if v_actor is not null then new.read := false; end if;

  v_a := case when new.sender_id::text < new.recipient_id::text then new.sender_id else new.recipient_id end;
  v_b := case when new.sender_id::text < new.recipient_id::text then new.recipient_id else new.sender_id end;
  if new.conversation_id is null then
    insert into public.chat_conversations (conversation_type, created_by, direct_user_a, direct_user_b)
    values ('direct', new.sender_id, v_a, v_b)
    on conflict (direct_user_a, direct_user_b) where conversation_type = 'direct' do nothing
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
  ) then raise exception 'chat_message_conversation_mismatch'; end if;

  insert into public.chat_conversation_members (conversation_id, user_id, role)
  values (new.conversation_id, v_a, 'member'), (new.conversation_id, v_b, 'member')
  on conflict (conversation_id, user_id) do nothing;

  new.client_message_id := coalesce(new.client_message_id, new.id, gen_random_uuid());
  new.message_type := coalesce(new.message_type, case
    when new.media_type = 'image' then 'image'
    when new.media_type = 'video' then 'video'
    when new.media_type = 'premium_dm' then 'premium_dm'
    when new.media_type = 'one_time_image' then 'one_time_image'
    else 'text'
  end);
  new.consumption_policy := case when new.message_type = 'one_time_image' then 'one_time' else 'standard' end;
  return new;
end;
$$;

revoke all on function public.chat_prepare_legacy_message()
  from public, anon, authenticated;

-- The existing after-insert authority owns the asset link too. This keeps a
-- compatible direct insert and the canonical RPC on the same atomic path.
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

  if new.media_asset_id is not null then
    insert into public.media_asset_links (asset_id, entity_type, entity_id, slot, position)
    values (new.media_asset_id, 'chat_message', new.id, 'content', 0);
  end if;
  return new;
end;
$$;

revoke all on function public.chat_after_message_insert()
  from public, anon, authenticated;

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
  v_asset public.media_assets%rowtype;
  v_existing public.messages%rowtype;
  v_result public.messages%rowtype;
  v_policy text := case when p_message_type = 'one_time_image' then 'one_time' else 'standard' end;
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
    select 1 from public.follows f where f.follower_id = v_actor and f.following_id = v_recipient
  ) then raise exception 'chat_recipient_followers_only'; end if;

  if p_message_type not in ('text', 'image', 'video', 'one_time_image') then
    raise exception 'chat_message_type_invalid';
  end if;
  if length(coalesce(p_text, '')) > 5000 then raise exception 'chat_message_too_long'; end if;
  if p_message_type = 'text' and length(btrim(coalesce(p_text, ''))) = 0 then
    raise exception 'chat_text_required';
  end if;
  if p_message_type in ('image', 'video')
    and nullif(btrim(coalesce(p_media_url, '')), '') is null
    and p_media_asset_id is null then raise exception 'chat_media_required'; end if;
  if p_message_type = 'one_time_image'
    and (p_media_asset_id is null or p_media_url is not null) then
    raise exception 'chat_one_time_private_asset_required';
  end if;
  if p_reply_to_message_id is not null and not exists (
    select 1 from public.messages where id = p_reply_to_message_id and conversation_id = p_conversation_id
  ) then raise exception 'chat_reply_target_invalid'; end if;

  select * into v_existing from public.messages
  where sender_id = v_actor and client_message_id = p_client_message_id;
  if v_existing.id is not null then
    if v_existing.conversation_id <> p_conversation_id
      or v_existing.message_type <> p_message_type
      or v_existing.consumption_policy <> v_policy
      or v_existing.text <> coalesce(p_text, '')
      or v_existing.media_url is distinct from p_media_url
      or v_existing.media_asset_id is distinct from p_media_asset_id
      or v_existing.reply_to_message_id is distinct from p_reply_to_message_id then
      raise exception 'chat_idempotency_conflict';
    end if;
    if p_media_asset_id is not null and not exists (
      select 1 from public.media_asset_links l
      where l.asset_id = p_media_asset_id and l.entity_type = 'chat_message'
        and l.entity_id = v_existing.id and l.slot = 'content'
    ) then raise exception 'chat_media_link_missing'; end if;
    return v_existing;
  end if;

  if p_media_asset_id is not null then
    select * into v_asset from public.media_assets where id = p_media_asset_id for update;
    if v_asset.id is null or v_asset.owner_id <> v_actor or v_asset.status <> 'ready'
      or v_asset.visibility <> 'private' or v_asset.provider <> 'r2'
      or v_asset.media_kind <> 'image' or v_asset.purpose <> 'chat_image'
      or v_asset.public_url is not null then raise exception 'chat_media_asset_invalid'; end if;
    if p_message_type not in ('image', 'one_time_image') or p_media_url is not null then
      raise exception 'chat_private_media_contract_invalid';
    end if;
    if exists (select 1 from public.media_asset_links l where l.asset_id = p_media_asset_id) then
      raise exception 'chat_media_asset_already_linked';
    end if;
  end if;

  insert into public.messages (
    sender_id, recipient_id, conversation_id, client_message_id, text,
    media_url, media_type, message_type, media_asset_id, consumption_policy,
    reply_to_message_id, read
  ) values (
    v_actor, v_recipient, p_conversation_id, p_client_message_id, coalesce(p_text, ''),
    p_media_url, p_message_type, p_message_type, p_media_asset_id, v_policy,
    p_reply_to_message_id, false
  ) returning * into v_result;

  if p_media_asset_id is not null then
    insert into public.media_asset_links (asset_id, entity_type, entity_id, slot, position)
    values (p_media_asset_id, 'chat_message', v_result.id, 'content', 0)
    on conflict do nothing;
  end if;
  return v_result;
exception
  when unique_violation then
    select * into v_result from public.messages
    where sender_id = v_actor and client_message_id = p_client_message_id;
    if v_result.id is null then raise; end if;
    if v_result.conversation_id <> p_conversation_id
      or v_result.message_type <> p_message_type
      or v_result.consumption_policy <> v_policy
      or v_result.text <> coalesce(p_text, '')
      or v_result.media_url is distinct from p_media_url
      or v_result.media_asset_id is distinct from p_media_asset_id
      or v_result.reply_to_message_id is distinct from p_reply_to_message_id then
      raise exception 'chat_idempotency_conflict';
    end if;
    return v_result;
end;
$$;

revoke all on function public.chat_send_message(uuid, uuid, text, text, text, uuid, uuid)
  from public, anon;
grant execute on function public.chat_send_message(uuid, uuid, text, text, text, uuid, uuid)
  to authenticated, service_role;

-- The Edge gateway calls this under the caller JWT. For one-time media the
-- conditional receipt update is the single atomic winner across all devices.
create function public.chat_authorize_media_access(p_asset_id uuid)
returns table (
  media_asset_id uuid,
  bucket_name text,
  object_key text,
  consumption_policy text,
  consumed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := (select auth.uid());
  v_message public.messages%rowtype;
  v_asset public.media_assets%rowtype;
  v_consumed_at timestamptz;
begin
  if v_actor is null then raise exception 'chat_auth_required'; end if;
  select m.* into v_message
  from public.media_asset_links l
  join public.messages m on m.id = l.entity_id
  where l.asset_id = p_asset_id and l.entity_type = 'chat_message'
    and l.slot = 'content' and m.media_asset_id = p_asset_id and m.deleted_at is null;
  if v_message.id is null then raise exception 'chat_media_not_found'; end if;
  if not exists (
    select 1 from public.chat_conversation_members cm
    where cm.conversation_id = v_message.conversation_id
      and cm.user_id = v_actor and cm.is_active
  ) then raise exception 'chat_media_forbidden'; end if;
  if exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = v_actor and b.blocked_id in (v_message.sender_id, v_message.recipient_id))
       or (b.blocked_id = v_actor and b.blocker_id in (v_message.sender_id, v_message.recipient_id))
  ) then raise exception 'chat_media_blocked'; end if;

  select * into v_asset from public.media_assets
  where id = p_asset_id and status = 'ready' and visibility = 'private'
    and provider = 'r2' and media_kind = 'image' and purpose = 'chat_image'
    and public_url is null;
  if v_asset.id is null then raise exception 'chat_media_unavailable'; end if;

  if v_message.consumption_policy = 'one_time' then
    if v_message.message_type <> 'one_time_image' or v_actor <> v_message.recipient_id then
      raise exception 'chat_one_time_recipient_only';
    end if;
    update public.chat_message_receipts r
    set media_consumed_at = now(), updated_at = now()
    where r.message_id = v_message.id and r.user_id = v_actor
      and r.media_consumed_at is null
    returning r.media_consumed_at into v_consumed_at;
    if v_consumed_at is null then raise exception 'chat_media_already_consumed'; end if;
  elsif v_message.consumption_policy <> 'standard' or v_message.message_type <> 'image' then
    raise exception 'chat_media_policy_invalid';
  end if;

  return query select v_asset.id, v_asset.bucket_name, v_asset.object_key,
    v_message.consumption_policy, v_consumed_at;
end;
$$;

revoke all on function public.chat_authorize_media_access(uuid)
  from public, anon;
grant execute on function public.chat_authorize_media_access(uuid)
  to authenticated, service_role;

-- V3 adds consumption state without changing either published V2 ABI.
create function public.chat_get_recent_messages_v3(
  p_conversation_id uuid,
  p_limit integer default 50,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid, conversation_id uuid, client_message_id uuid, sender_id uuid,
  recipient_id uuid, text text, media_url text, media_type text,
  message_type text, reply_to_message_id uuid, media_asset_id uuid,
  consumption_policy text, audio_duration_ms integer, read boolean,
  deleted_at timestamptz, created_at timestamptz, delivered_at timestamptz,
  read_at timestamptz, legacy_delivered boolean, legacy_read boolean,
  delivery_status text, media_consumed_at timestamptz, media_available boolean
)
language sql
security invoker
set search_path = pg_catalog, public
as $$
  select m.id, m.conversation_id, m.client_message_id, m.sender_id,
    m.recipient_id, m.text,
    case when m.media_asset_id is null then m.media_url else null end,
    m.media_type, m.message_type, m.reply_to_message_id, m.media_asset_id,
    m.consumption_policy, m.audio_duration_ms, m.read, m.deleted_at, m.created_at,
    r.delivered_at, r.read_at, coalesce(r.legacy_delivered, false),
    coalesce(r.legacy_read, false),
    case
      when r.read_at is not null or coalesce(r.legacy_read, false) or m.read then 'read'
      when r.delivered_at is not null or coalesce(r.legacy_delivered, false) then 'delivered'
      else 'sent'
    end,
    r.media_consumed_at,
    case when m.consumption_policy = 'one_time' then r.media_consumed_at is null
      else m.media_asset_id is not null or m.media_url is not null end
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

revoke all on function public.chat_get_recent_messages_v3(uuid, integer, timestamptz, uuid)
  from public, anon;
grant execute on function public.chat_get_recent_messages_v3(uuid, integer, timestamptz, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
