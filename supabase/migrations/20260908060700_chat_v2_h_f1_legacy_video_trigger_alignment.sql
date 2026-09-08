-- CHAT-V2-H-F1: align the canonical legacy message trigger with private chat video.
begin;

create or replace function public.chat_prepare_legacy_message()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_a uuid;
  v_b uuid;
  v_asset public.media_assets%rowtype;
  v_conversation public.chat_conversations%rowtype;
begin
  if v_actor is not null and new.sender_id <> v_actor then raise exception 'chat_sender_identity_mismatch'; end if;
  if new.sender_id is null then raise exception 'chat_sender_required'; end if;
  if new.media_type not in ('text', 'image', 'video', 'premium_dm', 'one_time_image', 'voice') then raise exception 'chat_message_type_invalid'; end if;
  if length(coalesce(new.text, '')) > 5000 then raise exception 'chat_message_too_long'; end if;
  if new.media_type = 'text' and length(btrim(coalesce(new.text, ''))) = 0 then raise exception 'chat_text_required'; end if;
  if new.media_type in ('image', 'video') and nullif(btrim(coalesce(new.media_url, '')), '') is null and new.media_asset_id is null then raise exception 'chat_media_required'; end if;
  if new.media_type = 'video' and (new.media_asset_id is null or new.media_url is not null) then raise exception 'chat_video_private_asset_required'; end if;
  if new.media_type = 'one_time_image' and (new.media_asset_id is null or new.media_url is not null) then raise exception 'chat_one_time_private_asset_required'; end if;
  if new.media_type = 'voice' and (
    new.media_asset_id is null or new.media_url is not null
    or new.audio_duration_ms is null or new.audio_duration_ms not between 1 and 3600000
    or array_length(new.audio_waveform, 1) is distinct from 48
    or array_position(new.audio_waveform, null) is not null
    or not (0 <= all(new.audio_waveform) and 100 >= all(new.audio_waveform))
  ) then raise exception 'chat_voice_contract_invalid'; end if;
  if new.media_type <> 'voice' and (new.audio_duration_ms is not null or new.audio_waveform is not null) then raise exception 'chat_audio_metadata_not_allowed'; end if;
  if new.media_asset_id is not null then
    select * into v_asset from public.media_assets where id = new.media_asset_id for update;
    if v_asset.id is null or v_asset.owner_id <> new.sender_id or v_asset.status <> 'ready'
      or v_asset.visibility <> 'private' or v_asset.provider <> 'r2' or v_asset.public_url is not null then raise exception 'chat_media_asset_invalid'; end if;
    if new.media_type = 'voice' then
      if v_asset.media_kind <> 'audio' or v_asset.purpose <> 'voice_note' then raise exception 'chat_voice_asset_invalid'; end if;
    elsif new.media_type in ('image', 'one_time_image') then
      if v_asset.media_kind <> 'image' or v_asset.purpose <> 'chat_image' then raise exception 'chat_media_asset_invalid'; end if;
    elsif new.media_type = 'video' then
      if v_asset.media_kind <> 'video' or v_asset.purpose <> 'chat_video' then raise exception 'chat_video_asset_invalid'; end if;
    else raise exception 'chat_private_media_contract_invalid'; end if;
    if new.media_url is not null then raise exception 'chat_private_media_contract_invalid'; end if;
    if exists (select 1 from public.media_asset_links l where l.asset_id = new.media_asset_id) then raise exception 'chat_media_asset_already_linked'; end if;
  end if;
  if v_actor is not null then new.read := false; end if;

  if new.conversation_id is not null then select * into v_conversation from public.chat_conversations where id = new.conversation_id; end if;
  if v_conversation.conversation_type = 'group' then
    if v_conversation.status <> 'active' then raise exception 'chat_conversation_unavailable'; end if;
    if new.recipient_id is not null then raise exception 'chat_group_recipient_must_be_null'; end if;
    if new.media_type not in ('text', 'image', 'video', 'voice') then raise exception 'chat_group_message_type_invalid'; end if;
    if not exists (select 1 from public.chat_conversation_members cm where cm.conversation_id = new.conversation_id and cm.user_id = new.sender_id and cm.is_active) then raise exception 'chat_membership_required'; end if;
  else
    if new.recipient_id is null or new.sender_id = new.recipient_id then raise exception 'chat_direct_participants_invalid'; end if;
    v_a := case when new.sender_id::text < new.recipient_id::text then new.sender_id else new.recipient_id end;
    v_b := case when new.sender_id::text < new.recipient_id::text then new.recipient_id else new.sender_id end;
    if new.conversation_id is null then
      insert into public.chat_conversations (conversation_type, created_by, direct_user_a, direct_user_b)
      values ('direct', new.sender_id, v_a, v_b)
      on conflict (direct_user_a, direct_user_b) where conversation_type = 'direct' do nothing
      returning id into new.conversation_id;
      if new.conversation_id is null then select id into new.conversation_id from public.chat_conversations where conversation_type = 'direct' and direct_user_a = v_a and direct_user_b = v_b; end if;
    end if;
    if not exists (select 1 from public.chat_conversations c where c.id = new.conversation_id and c.conversation_type = 'direct' and c.status = 'active' and c.direct_user_a = v_a and c.direct_user_b = v_b) then raise exception 'chat_message_conversation_mismatch'; end if;
    insert into public.chat_conversation_members (conversation_id, user_id, role)
    values (new.conversation_id, v_a, 'member'), (new.conversation_id, v_b, 'member')
    on conflict (conversation_id, user_id) do nothing;
  end if;
  new.client_message_id := coalesce(new.client_message_id, new.id, gen_random_uuid());
  new.message_type := coalesce(new.message_type, new.media_type);
  new.consumption_policy := case when new.message_type = 'one_time_image' then 'one_time' else 'standard' end;
  return new;
end;
$function$;

alter function public.chat_prepare_legacy_message() owner to postgres;
revoke all on function public.chat_prepare_legacy_message() from public, anon, authenticated;
grant execute on function public.chat_prepare_legacy_message() to service_role;

commit;
