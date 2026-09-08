begin;

create or replace function public.chat_send_message(
  p_conversation_id uuid,
  p_client_message_id uuid,
  p_text text default ''::text,
  p_message_type text default 'text'::text,
  p_media_url text default null::text,
  p_media_asset_id uuid default null::uuid,
  p_reply_to_message_id uuid default null::uuid,
  p_audio_duration_ms integer default null::integer,
  p_audio_waveform smallint[] default null::smallint[]
)
returns public.messages
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_c public.chat_conversations%rowtype;
  v_recipient uuid;
  v_allow text;
  v_asset public.media_assets%rowtype;
  v_existing public.messages%rowtype;
  v_result public.messages%rowtype;
  v_policy text := case when p_message_type = 'one_time_image' then 'one_time' else 'standard' end;
begin
  if v_actor is null then raise exception 'chat_auth_required'; end if;
  if p_client_message_id is null then raise exception 'chat_idempotency_key_required'; end if;

  select * into v_c from public.chat_conversations where id = p_conversation_id and status = 'active';
  if v_c.id is null then raise exception 'chat_conversation_unavailable'; end if;
  if not exists (
    select 1 from public.chat_conversation_members
    where conversation_id = p_conversation_id and user_id = v_actor and is_active
  ) then raise exception 'chat_membership_required'; end if;

  if v_c.conversation_type = 'direct' then
    v_recipient := case when v_c.direct_user_a = v_actor then v_c.direct_user_b else v_c.direct_user_a end;
    if v_recipient is null or v_recipient = v_actor then raise exception 'chat_recipient_invalid'; end if;
    if exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = v_actor and b.blocked_id = v_recipient)
         or (b.blocker_id = v_recipient and b.blocked_id = v_actor)
    ) then raise exception 'chat_interaction_blocked'; end if;
    select coalesce(allow_messages_from, 'everyone') into v_allow from public.user_profiles where id = v_recipient;
    if v_allow = 'nobody' then raise exception 'chat_recipient_messages_disabled'; end if;
    if v_allow = 'followers' and not exists (
      select 1 from public.follows where follower_id = v_actor and following_id = v_recipient
    ) then raise exception 'chat_recipient_followers_only'; end if;
  elsif v_c.conversation_type = 'group' then
    v_recipient := null;
    if p_message_type not in ('text', 'image', 'video', 'voice') then raise exception 'chat_group_message_type_invalid'; end if;
  else
    raise exception 'chat_conversation_type_invalid';
  end if;

  if p_message_type not in ('text', 'image', 'video', 'one_time_image', 'voice') then raise exception 'chat_message_type_invalid'; end if;
  if length(coalesce(p_text, '')) > 5000 then raise exception 'chat_message_too_long'; end if;
  if p_message_type = 'text' and length(btrim(coalesce(p_text, ''))) = 0 then raise exception 'chat_text_required'; end if;
  if p_message_type = 'image' and nullif(btrim(coalesce(p_media_url, '')), '') is null and p_media_asset_id is null then raise exception 'chat_media_required'; end if;
  if p_message_type = 'video' and (p_media_asset_id is null or p_media_url is not null) then raise exception 'chat_video_private_asset_required'; end if;
  if p_message_type = 'one_time_image' and (v_c.conversation_type <> 'direct' or p_media_asset_id is null or p_media_url is not null) then raise exception 'chat_one_time_private_asset_required'; end if;
  if p_message_type = 'voice' and (
    p_media_asset_id is null or p_media_url is not null or p_audio_duration_ms is null
    or p_audio_duration_ms not between 1 and 3600000
    or array_length(p_audio_waveform, 1) is distinct from 48
    or array_position(p_audio_waveform, null) is not null
    or not (0 <= all(p_audio_waveform) and 100 >= all(p_audio_waveform))
  ) then raise exception 'chat_voice_contract_invalid'; end if;
  if p_message_type <> 'voice' and (p_audio_duration_ms is not null or p_audio_waveform is not null) then raise exception 'chat_audio_metadata_not_allowed'; end if;
  if p_reply_to_message_id is not null and not exists (
    select 1 from public.messages m
    where m.id = p_reply_to_message_id and m.conversation_id = p_conversation_id
      and public.chat_can_read_message(m.conversation_id, m.created_at)
  ) then raise exception 'chat_reply_target_invalid'; end if;

  select * into v_existing from public.messages where sender_id = v_actor and client_message_id = p_client_message_id;
  if v_existing.id is not null then
    if v_existing.conversation_id <> p_conversation_id
      or v_existing.message_type <> p_message_type
      or v_existing.consumption_policy <> v_policy
      or v_existing.text <> coalesce(p_text, '')
      or v_existing.media_url is distinct from p_media_url
      or v_existing.media_asset_id is distinct from p_media_asset_id
      or v_existing.reply_to_message_id is distinct from p_reply_to_message_id
      or v_existing.audio_duration_ms is distinct from p_audio_duration_ms
      or v_existing.audio_waveform is distinct from p_audio_waveform
    then raise exception 'chat_idempotency_conflict'; end if;
    return v_existing;
  end if;

  if p_media_asset_id is not null then
    select * into v_asset from public.media_assets where id = p_media_asset_id for update;
    if v_asset.id is null or v_asset.owner_id <> v_actor or v_asset.status <> 'ready'
      or v_asset.visibility <> 'private' or v_asset.provider <> 'r2' or v_asset.public_url is not null
      or exists (select 1 from public.media_asset_links where asset_id = p_media_asset_id)
    then raise exception 'chat_media_asset_invalid'; end if;
    if p_message_type = 'voice' and (v_asset.media_kind <> 'audio' or v_asset.purpose <> 'voice_note') then raise exception 'chat_voice_asset_invalid'; end if;
    if p_message_type in ('image', 'one_time_image') and (v_asset.media_kind <> 'image' or v_asset.purpose <> 'chat_image') then raise exception 'chat_media_asset_invalid'; end if;
    if p_message_type = 'video' and (v_asset.media_kind <> 'video' or v_asset.purpose <> 'chat_video') then raise exception 'chat_video_asset_invalid'; end if;
  end if;

  insert into public.messages (
    sender_id, recipient_id, conversation_id, client_message_id, text, media_url, media_type,
    message_type, media_asset_id, consumption_policy, reply_to_message_id,
    audio_duration_ms, audio_waveform, read
  ) values (
    v_actor, v_recipient, p_conversation_id, p_client_message_id, coalesce(p_text, ''), p_media_url,
    p_message_type, p_message_type, p_media_asset_id, v_policy, p_reply_to_message_id,
    p_audio_duration_ms, p_audio_waveform, false
  ) returning * into v_result;
  return v_result;
exception when unique_violation then
  select * into v_result from public.messages where sender_id = v_actor and client_message_id = p_client_message_id;
  if v_result.id is null then raise; end if;
  if v_result.conversation_id <> p_conversation_id
    or v_result.message_type <> p_message_type
    or v_result.consumption_policy <> v_policy
    or v_result.text <> coalesce(p_text, '')
    or v_result.media_url is distinct from p_media_url
    or v_result.media_asset_id is distinct from p_media_asset_id
    or v_result.reply_to_message_id is distinct from p_reply_to_message_id
    or v_result.audio_duration_ms is distinct from p_audio_duration_ms
    or v_result.audio_waveform is distinct from p_audio_waveform
  then raise exception 'chat_idempotency_conflict'; end if;
  return v_result;
end;
$function$;

create or replace function public.chat_authorize_media_access(p_asset_id uuid)
returns table(
  media_asset_id uuid,
  bucket_name text,
  object_key text,
  consumption_policy text,
  consumed_at timestamp with time zone
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_message public.messages%rowtype;
  v_asset public.media_assets%rowtype;
  v_consumed timestamptz;
  v_type text;
begin
  if v_actor is null then raise exception 'chat_auth_required'; end if;
  select m.* into v_message
  from public.media_asset_links l
  join public.messages m on m.id = l.entity_id
  where l.asset_id = p_asset_id and l.entity_type = 'chat_message' and l.slot = 'content'
    and m.media_asset_id = p_asset_id and m.deleted_at is null;
  if v_message.id is null or not public.chat_can_read_message(v_message.conversation_id, v_message.created_at) then raise exception 'chat_media_forbidden'; end if;
  select conversation_type into v_type from public.chat_conversations where id = v_message.conversation_id;
  if v_type = 'direct' and exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = v_actor and b.blocked_id in (v_message.sender_id, v_message.recipient_id))
       or (b.blocked_id = v_actor and b.blocker_id in (v_message.sender_id, v_message.recipient_id))
  ) then raise exception 'chat_media_blocked'; end if;
  select * into v_asset from public.media_assets
  where id = p_asset_id and status = 'ready' and visibility = 'private' and provider = 'r2' and public_url is null;
  if v_asset.id is null then raise exception 'chat_media_unavailable'; end if;

  if v_message.message_type = 'voice' then
    if v_message.consumption_policy <> 'standard' or v_asset.media_kind <> 'audio' or v_asset.purpose <> 'voice_note' then raise exception 'chat_media_policy_invalid'; end if;
  elsif v_message.message_type = 'video' then
    if v_message.consumption_policy <> 'standard' or v_asset.media_kind <> 'video' or v_asset.purpose <> 'chat_video' then raise exception 'chat_media_policy_invalid'; end if;
  elsif v_message.consumption_policy = 'one_time' then
    if v_type <> 'direct' or v_message.message_type <> 'one_time_image' or v_actor <> v_message.recipient_id then raise exception 'chat_one_time_recipient_only'; end if;
    update public.chat_message_receipts
    set media_consumed_at = now(), updated_at = now()
    where message_id = v_message.id and user_id = v_actor and media_consumed_at is null
    returning media_consumed_at into v_consumed;
    if v_consumed is null then raise exception 'chat_media_already_consumed'; end if;
  elsif v_message.message_type <> 'image' or v_asset.media_kind <> 'image' or v_asset.purpose <> 'chat_image' then
    raise exception 'chat_media_policy_invalid';
  end if;
  return query select v_asset.id, v_asset.bucket_name, v_asset.object_key, v_message.consumption_policy, v_consumed;
end;
$function$;

create or replace function public.chat_get_conversations(
  p_limit integer default 30,
  p_before_activity_at timestamp with time zone default null::timestamp with time zone,
  p_before_id uuid default null::uuid
)
returns table(
  conversation_id uuid,
  conversation_type text,
  conversation_status text,
  last_activity_at timestamp with time zone,
  other_user_id uuid,
  other_username text,
  other_avatar_url text,
  group_name text,
  group_avatar_url text,
  member_count bigint,
  current_user_role text,
  last_message jsonb,
  unread_count bigint
)
language sql
set search_path to 'pg_catalog', 'public'
as $function$
  select
    c.id,
    c.conversation_type,
    c.status,
    c.last_activity_at,
    other.user_id,
    profile.username,
    profile.avatar_url,
    c.group_name,
    c.group_avatar_url,
    (select count(*) from public.chat_conversation_members x where x.conversation_id = c.id and x.is_active),
    mine.role,
    case when latest.id is null then null else jsonb_build_object(
      'id', latest.id,
      'sender_id', latest.sender_id,
      'recipient_id', latest.recipient_id,
      'conversation_id', latest.conversation_id,
      'client_message_id', latest.client_message_id,
      'text', latest.text,
      'message_type', latest.message_type,
      'created_at', latest.created_at,
      'delivery_status', case
        when latest.sender_id <> (select auth.uid()) then null
        when receipt_counts.recipient_count > 0 and receipt_counts.read_count = receipt_counts.recipient_count then 'read'
        when receipt_counts.recipient_count > 0 and receipt_counts.delivered_count = receipt_counts.recipient_count then 'delivered'
        else 'sent'
      end,
      'recipient_count', receipt_counts.recipient_count,
      'delivered_count', receipt_counts.delivered_count,
      'read_count', receipt_counts.read_count
    ) end,
    (
      select count(*)
      from public.chat_message_receipts r
      join public.messages um on um.id = r.message_id
      where um.conversation_id = c.id and r.user_id = (select auth.uid())
        and r.read_at is null and not r.legacy_read
    )
  from public.chat_conversation_members mine
  join public.chat_conversations c on c.id = mine.conversation_id
  left join lateral (
    select cm.user_id
    from public.chat_conversation_members cm
    where c.conversation_type = 'direct' and cm.conversation_id = c.id
      and cm.user_id <> (select auth.uid()) and cm.is_active
    limit 1
  ) other on true
  left join public.user_profiles profile on profile.id = other.user_id
  left join lateral (
    select m.*
    from public.messages m
    where m.conversation_id = c.id and m.deleted_at is null
      and public.chat_can_read_message(m.conversation_id, m.created_at)
    order by m.created_at desc, m.id desc
    limit 1
  ) latest on true
  left join lateral (
    select
      count(*)::bigint as recipient_count,
      count(*) filter (where r.delivered_at is not null or r.legacy_delivered or r.read_at is not null or r.legacy_read)::bigint as delivered_count,
      count(*) filter (where r.read_at is not null or r.legacy_read)::bigint as read_count
    from public.chat_message_receipts r
    where r.message_id = latest.id
  ) receipt_counts on true
  where mine.user_id = (select auth.uid()) and mine.is_active
    and (p_before_activity_at is null or (c.last_activity_at, c.id) < (p_before_activity_at, p_before_id))
  order by c.last_activity_at desc, c.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$function$;

revoke all on function public.chat_send_message(uuid, uuid, text, text, text, uuid, uuid, integer, smallint[]) from public, anon;
grant execute on function public.chat_send_message(uuid, uuid, text, text, text, uuid, uuid, integer, smallint[]) to authenticated, service_role;
revoke all on function public.chat_authorize_media_access(uuid) from public, anon;
grant execute on function public.chat_authorize_media_access(uuid) to authenticated, service_role;
revoke all on function public.chat_get_conversations(integer, timestamptz, uuid) from public, anon;
grant execute on function public.chat_get_conversations(integer, timestamptz, uuid) to authenticated, service_role;

commit;
