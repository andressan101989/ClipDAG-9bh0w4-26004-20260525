begin;

lock table public.messages in share row exclusive mode;
lock table public.chat_conversations in share row exclusive mode;
lock table public.chat_conversation_members in share row exclusive mode;
lock table public.chat_message_receipts in share row exclusive mode;

create temporary table chat_v2_e_snapshot on commit drop as
select count(*)::bigint message_count,
  md5(coalesce(string_agg(id::text, ',' order by id), '')) message_digest
from public.messages;

alter table public.messages alter column recipient_id drop not null;

create unique index chat_group_one_active_owner_uidx
  on public.chat_conversation_members(conversation_id)
  where is_active and role = 'owner';

create index chat_group_members_active_joined_idx
  on public.chat_conversation_members(conversation_id, joined_at, user_id)
  where is_active;

create or replace function public.chat_can_read_message(p_conversation_id uuid, p_created_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.chat_conversation_members cm
    join public.chat_conversations c on c.id = cm.conversation_id
    where cm.conversation_id = p_conversation_id
      and cm.user_id = (select auth.uid()) and cm.is_active
      and (c.conversation_type = 'direct' or p_created_at >= cm.joined_at)
  );
$$;
revoke all on function public.chat_can_read_message(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.chat_can_read_message(uuid, timestamptz) to authenticated, service_role;

create or replace function public.chat_enforce_group_owner()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare v_id uuid := coalesce(new.conversation_id, old.conversation_id); v_count integer;
begin
  if exists (select 1 from public.chat_conversations c where c.id=v_id and c.conversation_type='group' and c.status='active') then
    select count(*) into v_count from public.chat_conversation_members
    where conversation_id=v_id and is_active and role='owner';
    if v_count <> 1 then raise exception 'chat_group_owner_invariant'; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.chat_enforce_group_owner() from public, anon, authenticated;
create constraint trigger chat_group_owner_member_guard
after insert or update or delete on public.chat_conversation_members
deferrable initially deferred for each row execute function public.chat_enforce_group_owner();

create or replace function public.chat_enforce_group_conversation_owner()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare v_count integer;
begin
  if new.conversation_type='group' and new.status='active' then
    select count(*) into v_count from public.chat_conversation_members
    where conversation_id=new.id and is_active and role='owner';
    if v_count <> 1 then raise exception 'chat_group_owner_invariant'; end if;
  end if;
  return new;
end; $$;
revoke all on function public.chat_enforce_group_conversation_owner() from public, anon, authenticated;
create constraint trigger chat_group_owner_conversation_guard
after insert or update of status on public.chat_conversations
deferrable initially deferred for each row execute function public.chat_enforce_group_conversation_owner();

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
  v_conversation public.chat_conversations%rowtype;
begin
  if v_actor is not null and new.sender_id <> v_actor then raise exception 'chat_sender_identity_mismatch'; end if;
  if new.sender_id is null then raise exception 'chat_sender_required'; end if;
  if new.media_type not in ('text', 'image', 'video', 'premium_dm', 'one_time_image', 'voice') then raise exception 'chat_message_type_invalid'; end if;
  if length(coalesce(new.text, '')) > 5000 then raise exception 'chat_message_too_long'; end if;
  if new.media_type = 'text' and length(btrim(coalesce(new.text, ''))) = 0 then raise exception 'chat_text_required'; end if;
  if new.media_type in ('image', 'video') and nullif(btrim(coalesce(new.media_url, '')), '') is null and new.media_asset_id is null then raise exception 'chat_media_required'; end if;
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
    else raise exception 'chat_private_media_contract_invalid'; end if;
    if new.media_url is not null then raise exception 'chat_private_media_contract_invalid'; end if;
    if exists (select 1 from public.media_asset_links l where l.asset_id = new.media_asset_id) then raise exception 'chat_media_asset_already_linked'; end if;
  end if;
  if v_actor is not null then new.read := false; end if;

  if new.conversation_id is not null then select * into v_conversation from public.chat_conversations where id = new.conversation_id; end if;
  if v_conversation.conversation_type = 'group' then
    if v_conversation.status <> 'active' then raise exception 'chat_conversation_unavailable'; end if;
    if new.recipient_id is not null then raise exception 'chat_group_recipient_must_be_null'; end if;
    if new.media_type not in ('text', 'image', 'voice') then raise exception 'chat_group_message_type_invalid'; end if;
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
$$;
revoke all on function public.chat_prepare_legacy_message() from public, anon, authenticated;

create or replace function public.chat_create_group(p_group_id uuid, p_group_name text, p_member_ids uuid[])
returns public.chat_conversations
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := (select auth.uid()); v_name text := btrim(coalesce(p_group_name,''));
  v_members uuid[]; v_existing public.chat_conversations%rowtype; v_result public.chat_conversations%rowtype;
begin
  if v_actor is null then raise exception 'chat_auth_required'; end if;
  if p_group_id is null then raise exception 'chat_group_id_required'; end if;
  if length(v_name) not between 1 and 120 then raise exception 'chat_group_name_invalid'; end if;
  select coalesce(array_agg(x order by x), array[]::uuid[]) into v_members
  from (select distinct id x from unnest(coalesce(p_member_ids,array[]::uuid[])) id where id<>v_actor) q;
  if cardinality(v_members) < 1 then raise exception 'chat_group_members_required'; end if;
  if cardinality(v_members)+1 > 256 then raise exception 'chat_group_member_limit'; end if;
  if (select count(*) from public.user_profiles where id=any(v_members)) <> cardinality(v_members) then
    raise exception 'chat_group_member_unknown';
  end if;
  if exists(select 1 from public.blocked_users b where
    (b.blocker_id=v_actor and b.blocked_id=any(v_members)) or
    (b.blocked_id=v_actor and b.blocker_id=any(v_members))) then raise exception 'chat_group_member_blocked'; end if;
  select * into v_existing from public.chat_conversations where id=p_group_id for update;
  if v_existing.id is not null then
    if v_existing.conversation_type<>'group' or v_existing.created_by<>v_actor or v_existing.group_name<>v_name
      or (select array_agg(cm.user_id order by cm.user_id) from public.chat_conversation_members cm
          where cm.conversation_id=p_group_id and cm.is_active) is distinct from
         (select array_agg(x order by x) from unnest(array_append(v_members,v_actor)) x)
    then raise exception 'chat_group_idempotency_conflict'; end if;
    return v_existing;
  end if;
  insert into public.chat_conversations(id,conversation_type,status,created_by,group_name)
  values(p_group_id,'group','active',v_actor,v_name) returning * into v_result;
  insert into public.chat_conversation_members(conversation_id,user_id,role)
  select p_group_id,x,case when x=v_actor then 'owner' else 'member' end
  from unnest(array_append(v_members,v_actor)) x;
  return v_result;
end; $$;

create or replace function public.chat_update_group_name(p_conversation_id uuid,p_group_name text)
returns public.chat_conversations language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_name text:=btrim(coalesce(p_group_name,'')); v_result public.chat_conversations%rowtype;
begin
 if v_actor is null then raise exception 'chat_auth_required'; end if;
 if length(v_name) not between 1 and 120 then raise exception 'chat_group_name_invalid'; end if;
 if not exists(select 1 from public.chat_conversation_members cm join public.chat_conversations c on c.id=cm.conversation_id
   where cm.conversation_id=p_conversation_id and c.conversation_type='group' and c.status='active'
   and cm.user_id=v_actor and cm.is_active and cm.role in('owner','admin')) then raise exception 'chat_group_admin_required'; end if;
 update public.chat_conversations set group_name=v_name where id=p_conversation_id returning * into v_result;
 return v_result;
end; $$;

create or replace function public.chat_add_group_members(p_conversation_id uuid,p_user_ids uuid[])
returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_ids uuid[]; v_count bigint; v_current integer;
begin
 if v_actor is null then raise exception 'chat_auth_required'; end if;
 perform 1 from public.chat_conversations where id=p_conversation_id and conversation_type='group' and status='active' for update;
 if not found then raise exception 'chat_group_unavailable'; end if;
 if not exists(select 1 from public.chat_conversation_members where conversation_id=p_conversation_id and user_id=v_actor and is_active and role in('owner','admin')) then raise exception 'chat_group_admin_required'; end if;
 select coalesce(array_agg(x order by x),array[]::uuid[]) into v_ids from(select distinct id x from unnest(coalesce(p_user_ids,array[]::uuid[])) id where id<>v_actor)q;
 if cardinality(v_ids)=0 then return 0; end if;
 if (select count(*) from public.user_profiles where id=any(v_ids))<>cardinality(v_ids) then raise exception 'chat_group_member_unknown'; end if;
 if exists(select 1 from public.blocked_users b where (b.blocker_id=v_actor and b.blocked_id=any(v_ids)) or (b.blocked_id=v_actor and b.blocker_id=any(v_ids))) then raise exception 'chat_group_member_blocked'; end if;
 select count(*) into v_current from public.chat_conversation_members where conversation_id=p_conversation_id and is_active;
 if v_current+(select count(*) from unnest(v_ids)x where not exists(select 1 from public.chat_conversation_members cm where cm.conversation_id=p_conversation_id and cm.user_id=x and cm.is_active))>256 then raise exception 'chat_group_member_limit'; end if;
 insert into public.chat_conversation_members(conversation_id,user_id,role,joined_at,left_at,is_active)
 select p_conversation_id,x,'member',now(),null,true from unnest(v_ids)x
 on conflict(conversation_id,user_id) do update set role='member',joined_at=now(),left_at=null,is_active=true
 where not public.chat_conversation_members.is_active;
 get diagnostics v_count=row_count; return v_count;
end; $$;

create or replace function public.chat_remove_group_member(p_conversation_id uuid,p_user_id uuid)
returns public.chat_conversation_members language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_role text; v_target public.chat_conversation_members%rowtype;
begin
 if v_actor is null then raise exception 'chat_auth_required'; end if;
 perform 1 from public.chat_conversations where id=p_conversation_id and conversation_type='group' and status='active' for update;
 if not found then raise exception 'chat_group_unavailable'; end if;
 select role into v_role from public.chat_conversation_members where conversation_id=p_conversation_id and user_id=v_actor and is_active;
 select * into v_target from public.chat_conversation_members where conversation_id=p_conversation_id and user_id=p_user_id and is_active for update;
 if v_target.user_id is null then raise exception 'chat_group_member_missing'; end if;
 if p_user_id=v_actor then raise exception 'chat_group_use_leave'; end if;
 if v_target.role='owner' then raise exception 'chat_group_owner_protected'; end if;
 if v_role='admin' and v_target.role<>'member' then raise exception 'chat_group_admin_scope'; end if;
 if v_role<>'owner' and v_role<>'admin' then raise exception 'chat_group_admin_required'; end if;
 update public.chat_conversation_members set is_active=false,left_at=now() where conversation_id=p_conversation_id and user_id=p_user_id returning * into v_target;
 return v_target;
end; $$;

create or replace function public.chat_set_group_admin(p_conversation_id uuid,p_user_id uuid,p_is_admin boolean)
returns public.chat_conversation_members language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_target public.chat_conversation_members%rowtype;
begin
 if v_actor is null then raise exception 'chat_auth_required'; end if;
 perform 1 from public.chat_conversations where id=p_conversation_id and conversation_type='group' and status='active' for update;
 if not exists(select 1 from public.chat_conversation_members where conversation_id=p_conversation_id and user_id=v_actor and is_active and role='owner') then raise exception 'chat_group_owner_required'; end if;
 select * into v_target from public.chat_conversation_members where conversation_id=p_conversation_id and user_id=p_user_id and is_active for update;
 if v_target.user_id is null or v_target.role='owner' then raise exception 'chat_group_role_target_invalid'; end if;
 update public.chat_conversation_members set role=case when p_is_admin then 'admin' else 'member' end where conversation_id=p_conversation_id and user_id=p_user_id returning * into v_target;
 return v_target;
end; $$;

create or replace function public.chat_transfer_group_ownership(p_conversation_id uuid,p_new_owner_id uuid)
returns public.chat_conversations language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_result public.chat_conversations%rowtype;
begin
 if v_actor is null then raise exception 'chat_auth_required'; end if;
 select * into v_result from public.chat_conversations where id=p_conversation_id and conversation_type='group' and status='active' for update;
 if v_result.id is null then raise exception 'chat_group_unavailable'; end if;
 if not exists(select 1 from public.chat_conversation_members where conversation_id=p_conversation_id and user_id=v_actor and is_active and role='owner') then raise exception 'chat_group_owner_required'; end if;
 if p_new_owner_id=v_actor or not exists(select 1 from public.chat_conversation_members where conversation_id=p_conversation_id and user_id=p_new_owner_id and is_active) then raise exception 'chat_group_owner_target_invalid'; end if;
 update public.chat_conversation_members set role='admin' where conversation_id=p_conversation_id and user_id=v_actor;
 update public.chat_conversation_members set role='owner' where conversation_id=p_conversation_id and user_id=p_new_owner_id;
 return v_result;
end; $$;

create or replace function public.chat_leave_group(p_conversation_id uuid)
returns public.chat_conversations language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_result public.chat_conversations%rowtype; v_role text; v_others integer;
begin
 if v_actor is null then raise exception 'chat_auth_required'; end if;
 select * into v_result from public.chat_conversations where id=p_conversation_id and conversation_type='group' and status='active' for update;
 if v_result.id is null then raise exception 'chat_group_unavailable'; end if;
 select role into v_role from public.chat_conversation_members where conversation_id=p_conversation_id and user_id=v_actor and is_active for update;
 if v_role is null then raise exception 'chat_membership_required'; end if;
 select count(*) into v_others from public.chat_conversation_members where conversation_id=p_conversation_id and is_active and user_id<>v_actor;
 if v_role='owner' and v_others>0 then raise exception 'chat_group_transfer_required'; end if;
 update public.chat_conversation_members set is_active=false,left_at=now() where conversation_id=p_conversation_id and user_id=v_actor;
 if v_others=0 then update public.chat_conversations set status='closed' where id=p_conversation_id returning * into v_result; end if;
 return v_result;
end; $$;

create or replace function public.chat_after_message_insert()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.chat_conversations set last_activity_at=greatest(last_activity_at,new.created_at) where id=new.conversation_id;
 insert into public.chat_message_receipts(message_id,user_id,created_at)
 select new.id,cm.user_id,new.created_at from public.chat_conversation_members cm
 where cm.conversation_id=new.conversation_id and cm.is_active and cm.user_id<>new.sender_id
   and (new.recipient_id is null or cm.user_id=new.recipient_id)
 on conflict(message_id,user_id) do nothing;
 if new.media_asset_id is not null then
  insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
  values(new.media_asset_id,'chat_message',new.id,'content',0);
 end if;
 return new;
end; $$;
revoke all on function public.chat_after_message_insert() from public,anon,authenticated;

create or replace function public.chat_sync_legacy_read()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid());
begin
 if old.read and not new.read then raise exception 'chat_read_state_cannot_regress'; end if;
 if new.recipient_id is null and new.read is distinct from old.read then raise exception 'chat_group_legacy_read_forbidden'; end if;
 if v_actor is not null and new.recipient_id<>v_actor then raise exception 'chat_receipt_identity_mismatch'; end if;
 if not old.read and new.read then
  insert into public.chat_message_receipts(message_id,user_id,delivered_at,read_at,created_at,updated_at)
  values(new.id,new.recipient_id,now(),now(),new.created_at,now()) on conflict(message_id,user_id) do update
  set delivered_at=coalesce(public.chat_message_receipts.delivered_at,excluded.delivered_at),read_at=coalesce(public.chat_message_receipts.read_at,excluded.read_at),legacy_delivered=false,legacy_read=false;
 end if; return new;
end; $$;
revoke all on function public.chat_sync_legacy_read() from public,anon,authenticated;

drop function public.chat_send_message(uuid,uuid,text,text,text,uuid,uuid,integer,smallint[]);
create function public.chat_send_message(p_conversation_id uuid,p_client_message_id uuid,p_text text default '',p_message_type text default 'text',p_media_url text default null,p_media_asset_id uuid default null,p_reply_to_message_id uuid default null,p_audio_duration_ms integer default null,p_audio_waveform smallint[] default null)
returns public.messages language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_c public.chat_conversations%rowtype; v_recipient uuid; v_allow text; v_asset public.media_assets%rowtype; v_existing public.messages%rowtype; v_result public.messages%rowtype; v_policy text:=case when p_message_type='one_time_image' then 'one_time' else 'standard' end;
begin
 if v_actor is null then raise exception 'chat_auth_required'; end if;
 if p_client_message_id is null then raise exception 'chat_idempotency_key_required'; end if;
 select * into v_c from public.chat_conversations where id=p_conversation_id and status='active';
 if v_c.id is null then raise exception 'chat_conversation_unavailable'; end if;
 if not exists(select 1 from public.chat_conversation_members where conversation_id=p_conversation_id and user_id=v_actor and is_active) then raise exception 'chat_membership_required'; end if;
 if v_c.conversation_type='direct' then
  v_recipient:=case when v_c.direct_user_a=v_actor then v_c.direct_user_b else v_c.direct_user_a end;
  if v_recipient is null or v_recipient=v_actor then raise exception 'chat_recipient_invalid'; end if;
  if exists(select 1 from public.blocked_users b where (b.blocker_id=v_actor and b.blocked_id=v_recipient)or(b.blocker_id=v_recipient and b.blocked_id=v_actor)) then raise exception 'chat_interaction_blocked'; end if;
  select coalesce(allow_messages_from,'everyone') into v_allow from public.user_profiles where id=v_recipient;
  if v_allow='nobody' then raise exception 'chat_recipient_messages_disabled'; end if;
  if v_allow='followers' and not exists(select 1 from public.follows where follower_id=v_actor and following_id=v_recipient) then raise exception 'chat_recipient_followers_only'; end if;
 elsif v_c.conversation_type='group' then
  v_recipient:=null;
  if p_message_type not in('text','image','voice') then raise exception 'chat_group_message_type_invalid'; end if;
 else raise exception 'chat_conversation_type_invalid'; end if;
 if p_message_type not in('text','image','video','one_time_image','voice') then raise exception 'chat_message_type_invalid'; end if;
 if length(coalesce(p_text,''))>5000 then raise exception 'chat_message_too_long'; end if;
 if p_message_type='text' and length(btrim(coalesce(p_text,'')))=0 then raise exception 'chat_text_required'; end if;
 if p_message_type in('image','video') and nullif(btrim(coalesce(p_media_url,'')),'') is null and p_media_asset_id is null then raise exception 'chat_media_required'; end if;
 if p_message_type='one_time_image' and (v_c.conversation_type<>'direct' or p_media_asset_id is null or p_media_url is not null) then raise exception 'chat_one_time_private_asset_required'; end if;
 if p_message_type='voice' and (p_media_asset_id is null or p_media_url is not null or p_audio_duration_ms is null or p_audio_duration_ms not between 1 and 3600000 or array_length(p_audio_waveform,1)is distinct from 48 or array_position(p_audio_waveform,null)is not null or not(0<=all(p_audio_waveform)and 100>=all(p_audio_waveform))) then raise exception 'chat_voice_contract_invalid'; end if;
 if p_message_type<>'voice' and(p_audio_duration_ms is not null or p_audio_waveform is not null) then raise exception 'chat_audio_metadata_not_allowed'; end if;
 if p_reply_to_message_id is not null and not exists(select 1 from public.messages m where m.id=p_reply_to_message_id and m.conversation_id=p_conversation_id and public.chat_can_read_message(m.conversation_id,m.created_at)) then raise exception 'chat_reply_target_invalid'; end if;
 select * into v_existing from public.messages where sender_id=v_actor and client_message_id=p_client_message_id;
 if v_existing.id is not null then
  if v_existing.conversation_id<>p_conversation_id or v_existing.message_type<>p_message_type or v_existing.consumption_policy<>v_policy or v_existing.text<>coalesce(p_text,'') or v_existing.media_url is distinct from p_media_url or v_existing.media_asset_id is distinct from p_media_asset_id or v_existing.reply_to_message_id is distinct from p_reply_to_message_id or v_existing.audio_duration_ms is distinct from p_audio_duration_ms or v_existing.audio_waveform is distinct from p_audio_waveform then raise exception 'chat_idempotency_conflict'; end if;
  return v_existing;
 end if;
 if p_media_asset_id is not null then
  select * into v_asset from public.media_assets where id=p_media_asset_id for update;
  if v_asset.id is null or v_asset.owner_id<>v_actor or v_asset.status<>'ready' or v_asset.visibility<>'private' or v_asset.provider<>'r2' or v_asset.public_url is not null or exists(select 1 from public.media_asset_links where asset_id=p_media_asset_id) then raise exception 'chat_media_asset_invalid'; end if;
  if p_message_type='voice' and(v_asset.media_kind<>'audio' or v_asset.purpose<>'voice_note')then raise exception 'chat_voice_asset_invalid'; end if;
  if p_message_type in('image','one_time_image')and(v_asset.media_kind<>'image' or v_asset.purpose<>'chat_image')then raise exception 'chat_media_asset_invalid'; end if;
 end if;
 insert into public.messages(sender_id,recipient_id,conversation_id,client_message_id,text,media_url,media_type,message_type,media_asset_id,consumption_policy,reply_to_message_id,audio_duration_ms,audio_waveform,read)
 values(v_actor,v_recipient,p_conversation_id,p_client_message_id,coalesce(p_text,''),p_media_url,p_message_type,p_message_type,p_media_asset_id,v_policy,p_reply_to_message_id,p_audio_duration_ms,p_audio_waveform,false)returning * into v_result;
 return v_result;
exception when unique_violation then
 select * into v_result from public.messages where sender_id=v_actor and client_message_id=p_client_message_id;
 if v_result.id is null then raise; end if;
 if v_result.conversation_id<>p_conversation_id or v_result.message_type<>p_message_type
   or v_result.consumption_policy<>v_policy or v_result.text<>coalesce(p_text,'')
   or v_result.media_url is distinct from p_media_url or v_result.media_asset_id is distinct from p_media_asset_id
   or v_result.reply_to_message_id is distinct from p_reply_to_message_id
   or v_result.audio_duration_ms is distinct from p_audio_duration_ms
   or v_result.audio_waveform is distinct from p_audio_waveform then raise exception 'chat_idempotency_conflict'; end if;
 return v_result;
end; $$;

create or replace function public.chat_acknowledge_delivery(p_message_id uuid)
returns public.chat_message_receipts language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_result public.chat_message_receipts%rowtype;
begin
 if v_actor is null then raise exception 'chat_auth_required'; end if;
 update public.chat_message_receipts r set delivered_at=coalesce(r.delivered_at,now()),updated_at=case when r.delivered_at is null then now()else r.updated_at end
 from public.messages m where r.message_id=p_message_id and r.user_id=v_actor and m.id=r.message_id and m.sender_id<>v_actor and m.deleted_at is null and public.chat_can_read_message(m.conversation_id,m.created_at)
 returning r.* into v_result;
 if v_result.message_id is null then raise exception 'chat_delivery_not_authorized'; end if; return v_result;
end; $$;

create or replace function public.chat_acknowledge_read(p_message_id uuid)
returns public.chat_message_receipts language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_result public.chat_message_receipts%rowtype;
begin
 if v_actor is null then raise exception 'chat_auth_required'; end if;
 update public.chat_message_receipts r set delivered_at=coalesce(r.delivered_at,now()),read_at=coalesce(r.read_at,now()),legacy_delivered=false,legacy_read=false,updated_at=case when r.read_at is null then now()else r.updated_at end
 from public.messages m where r.message_id=p_message_id and r.user_id=v_actor and m.id=r.message_id and m.sender_id<>v_actor and m.deleted_at is null and public.chat_can_read_message(m.conversation_id,m.created_at)
 returning r.* into v_result;
 if v_result.message_id is null then raise exception 'chat_read_not_authorized'; end if;
 if v_result.read_at is not null and (select conversation_type from public.chat_conversations where id=(select conversation_id from public.messages where id=p_message_id))='direct' then update public.messages set read=true where id=p_message_id; end if;
 return v_result;
end; $$;

create or replace function public.chat_acknowledge_pending_deliveries(p_limit integer default 100)
returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_count bigint;
begin
 if v_actor is null then raise exception 'chat_auth_required'; end if;
 with pending as(select r.message_id from public.chat_message_receipts r join public.messages m on m.id=r.message_id where r.user_id=v_actor and m.sender_id<>v_actor and m.deleted_at is null and r.delivered_at is null and not r.legacy_delivered and public.chat_can_read_message(m.conversation_id,m.created_at) order by m.created_at,m.id limit least(greatest(coalesce(p_limit,100),1),500))
 update public.chat_message_receipts r set delivered_at=now(),updated_at=now() from pending p where r.message_id=p.message_id and r.user_id=v_actor;
 get diagnostics v_count=row_count; return v_count;
end; $$;

create or replace function public.chat_acknowledge_read_batch(p_message_ids uuid[])
returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_count bigint;
begin
 if v_actor is null then raise exception 'chat_auth_required'; end if;
 if coalesce(cardinality(p_message_ids),0)>500 then raise exception 'chat_read_batch_too_large'; end if;
 with allowed as(select distinct r.message_id from public.chat_message_receipts r join public.messages m on m.id=r.message_id join unnest(coalesce(p_message_ids,array[]::uuid[]))q(id)on q.id=m.id where r.user_id=v_actor and m.sender_id<>v_actor and m.deleted_at is null and public.chat_can_read_message(m.conversation_id,m.created_at))
 update public.chat_message_receipts r set delivered_at=coalesce(r.delivered_at,now()),read_at=coalesce(r.read_at,now()),legacy_delivered=false,legacy_read=false,updated_at=case when r.read_at is null then now()else r.updated_at end from allowed a where r.message_id=a.message_id and r.user_id=v_actor;
 get diagnostics v_count=row_count;
 update public.messages m set read=true where not m.read and m.recipient_id=v_actor and m.id=any(coalesce(p_message_ids,array[]::uuid[])); return v_count;
end; $$;

create or replace function public.chat_mark_conversation_read(p_conversation_id uuid)
returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid());v_count bigint;
begin
 if v_actor is null then raise exception 'chat_auth_required'; end if;
 with allowed as(select r.message_id from public.chat_message_receipts r join public.messages m on m.id=r.message_id where r.user_id=v_actor and m.conversation_id=p_conversation_id and m.sender_id<>v_actor and m.deleted_at is null and public.chat_can_read_message(m.conversation_id,m.created_at))
 update public.chat_message_receipts r set delivered_at=coalesce(r.delivered_at,now()),read_at=coalesce(r.read_at,now()),legacy_delivered=false,legacy_read=false,updated_at=case when r.read_at is null then now()else r.updated_at end from allowed a where r.message_id=a.message_id and r.user_id=v_actor and r.read_at is null;
 get diagnostics v_count=row_count;
 update public.messages m set read=true where not m.read and m.conversation_id=p_conversation_id and m.recipient_id=v_actor; return v_count;
end; $$;

drop function public.chat_get_conversations(integer,timestamptz,uuid);
create function public.chat_get_conversations(p_limit integer default 30,p_before_activity_at timestamptz default null,p_before_id uuid default null)
returns table(conversation_id uuid,conversation_type text,conversation_status text,last_activity_at timestamptz,other_user_id uuid,other_username text,other_avatar_url text,group_name text,group_avatar_url text,member_count bigint,current_user_role text,last_message jsonb,unread_count bigint)
language sql security invoker set search_path=pg_catalog,public as $$
 select c.id,c.conversation_type,c.status,c.last_activity_at,other.user_id,profile.username,profile.avatar_url,c.group_name,c.group_avatar_url,
 (select count(*) from public.chat_conversation_members x where x.conversation_id=c.id and x.is_active),mine.role,
 case when latest.id is null then null else jsonb_build_object('id',latest.id,'sender_id',latest.sender_id,'recipient_id',latest.recipient_id,'conversation_id',latest.conversation_id,'client_message_id',latest.client_message_id,'text',latest.text,'message_type',latest.message_type,'created_at',latest.created_at)end,
 (select count(*) from public.chat_message_receipts r join public.messages um on um.id=r.message_id where um.conversation_id=c.id and r.user_id=(select auth.uid())and r.read_at is null and not r.legacy_read)
 from public.chat_conversation_members mine join public.chat_conversations c on c.id=mine.conversation_id
 left join lateral(select cm.user_id from public.chat_conversation_members cm where c.conversation_type='direct' and cm.conversation_id=c.id and cm.user_id<>(select auth.uid())and cm.is_active limit 1)other on true
 left join public.user_profiles profile on profile.id=other.user_id
 left join lateral(select m.* from public.messages m where m.conversation_id=c.id and m.deleted_at is null and public.chat_can_read_message(m.conversation_id,m.created_at) order by m.created_at desc,m.id desc limit 1)latest on true
 where mine.user_id=(select auth.uid())and mine.is_active and(p_before_activity_at is null or(c.last_activity_at,c.id)<(p_before_activity_at,p_before_id))
 order by c.last_activity_at desc,c.id desc limit least(greatest(coalesce(p_limit,30),1),100);
$$;

drop function public.chat_get_recent_messages_v3(uuid,integer,timestamptz,uuid);
create function public.chat_get_recent_messages_v3(p_conversation_id uuid,p_limit integer default 50,p_before_created_at timestamptz default null,p_before_id uuid default null)
returns table(id uuid,conversation_id uuid,client_message_id uuid,sender_id uuid,recipient_id uuid,text text,media_url text,media_type text,message_type text,reply_to_message_id uuid,media_asset_id uuid,consumption_policy text,audio_duration_ms integer,audio_waveform smallint[],read boolean,deleted_at timestamptz,created_at timestamptz,delivered_at timestamptz,read_at timestamptz,legacy_delivered boolean,legacy_read boolean,delivery_status text,media_consumed_at timestamptz,media_available boolean,conversation_type text,sender_username text,sender_avatar_url text,recipient_count bigint,delivered_count bigint,read_count bigint)
language sql security invoker set search_path=pg_catalog,public as $$
 select m.id,m.conversation_id,m.client_message_id,m.sender_id,m.recipient_id,m.text,case when m.media_asset_id is null then m.media_url else null end,m.media_type,m.message_type,m.reply_to_message_id,m.media_asset_id,m.consumption_policy,m.audio_duration_ms,m.audio_waveform,m.read,m.deleted_at,m.created_at,
 mine.delivered_at,mine.read_at,coalesce(mine.legacy_delivered,false),coalesce(mine.legacy_read,false),
 case when m.sender_id=(select auth.uid()) then case when counts.recipient_count>0 and counts.read_count=counts.recipient_count then 'read' when counts.recipient_count>0 and counts.delivered_count=counts.recipient_count then 'delivered' else 'sent' end else case when mine.read_at is not null or mine.legacy_read then 'read' when mine.delivered_at is not null or mine.legacy_delivered then 'delivered' else 'sent' end end,
 mine.media_consumed_at,case when m.consumption_policy='one_time' then mine.media_consumed_at is null else m.media_asset_id is not null or m.media_url is not null end,c.conversation_type,p.username,p.avatar_url,counts.recipient_count,counts.delivered_count,counts.read_count
 from public.messages m join public.chat_conversations c on c.id=m.conversation_id left join public.user_profiles p on p.id=m.sender_id
 left join public.chat_message_receipts mine on mine.message_id=m.id and mine.user_id=(select auth.uid())
 cross join lateral(select count(*) recipient_count,count(*)filter(where r.delivered_at is not null or r.legacy_delivered or r.read_at is not null or r.legacy_read)delivered_count,count(*)filter(where r.read_at is not null or r.legacy_read)read_count from public.chat_message_receipts r where r.message_id=m.id)counts
 where m.conversation_id=p_conversation_id and m.deleted_at is null and public.chat_can_read_message(m.conversation_id,m.created_at) and(p_before_created_at is null or(m.created_at,m.id)<(p_before_created_at,p_before_id))
 order by m.created_at desc,m.id desc limit least(greatest(coalesce(p_limit,50),1),100);
$$;

drop function public.chat_get_members(uuid);
create function public.chat_get_members(p_conversation_id uuid)
returns table(conversation_id uuid,user_id uuid,role text,joined_at timestamptz,left_at timestamptz,is_active boolean,username text,avatar_url text)
language sql security invoker set search_path=pg_catalog,public as $$
 select cm.conversation_id,cm.user_id,cm.role,cm.joined_at,cm.left_at,cm.is_active,p.username,p.avatar_url
 from public.chat_conversation_members cm join public.user_profiles p on p.id=cm.user_id
 where cm.conversation_id=p_conversation_id and public.chat_is_active_member(p_conversation_id)
 order by cm.is_active desc,case cm.role when'owner'then 0 when'admin'then 1 else 2 end,cm.joined_at,cm.user_id;
$$;

create function public.chat_get_message_receipts(p_message_id uuid)
returns table(user_id uuid,username text,avatar_url text,delivered_at timestamptz,read_at timestamptz,status text)
language sql security definer set search_path=pg_catalog,public as $$
 select r.user_id,p.username,p.avatar_url,r.delivered_at,r.read_at,case when r.read_at is not null or r.legacy_read then'read'when r.delivered_at is not null or r.legacy_delivered then'delivered'else'sent'end
 from public.messages m join public.chat_message_receipts r on r.message_id=m.id join public.user_profiles p on p.id=r.user_id
 where m.id=p_message_id and m.sender_id=(select auth.uid()) order by r.read_at desc nulls last,r.delivered_at desc nulls last,r.user_id;
$$;

create or replace function public.chat_authorize_media_access(p_asset_id uuid)
returns table(media_asset_id uuid,bucket_name text,object_key text,consumption_policy text,consumed_at timestamptz)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid());v_message public.messages%rowtype;v_asset public.media_assets%rowtype;v_consumed timestamptz;v_type text;
begin
 if v_actor is null then raise exception 'chat_auth_required'; end if;
 select m.* into v_message from public.media_asset_links l join public.messages m on m.id=l.entity_id where l.asset_id=p_asset_id and l.entity_type='chat_message'and l.slot='content'and m.media_asset_id=p_asset_id and m.deleted_at is null;
 if v_message.id is null or not public.chat_can_read_message(v_message.conversation_id,v_message.created_at) then raise exception 'chat_media_forbidden'; end if;
 select conversation_type into v_type from public.chat_conversations where id=v_message.conversation_id;
 if v_type='direct'and exists(select 1 from public.blocked_users b where(b.blocker_id=v_actor and b.blocked_id in(v_message.sender_id,v_message.recipient_id))or(b.blocked_id=v_actor and b.blocker_id in(v_message.sender_id,v_message.recipient_id)))then raise exception 'chat_media_blocked';end if;
 select * into v_asset from public.media_assets where id=p_asset_id and status='ready'and visibility='private'and provider='r2'and public_url is null;
 if v_asset.id is null then raise exception 'chat_media_unavailable';end if;
 if v_message.message_type='voice' then if v_message.consumption_policy<>'standard'or v_asset.media_kind<>'audio'or v_asset.purpose<>'voice_note'then raise exception 'chat_media_policy_invalid';end if;
 elsif v_message.consumption_policy='one_time' then if v_type<>'direct'or v_message.message_type<>'one_time_image'or v_actor<>v_message.recipient_id then raise exception 'chat_one_time_recipient_only';end if;update public.chat_message_receipts set media_consumed_at=now(),updated_at=now()where message_id=v_message.id and user_id=v_actor and media_consumed_at is null returning media_consumed_at into v_consumed;if v_consumed is null then raise exception 'chat_media_already_consumed';end if;
 elsif v_message.message_type<>'image'or v_asset.media_kind<>'image'or v_asset.purpose<>'chat_image'then raise exception 'chat_media_policy_invalid';end if;
 return query select v_asset.id,v_asset.bucket_name,v_asset.object_key,v_message.consumption_policy,v_consumed;
end;$$;

create or replace function public.enqueue_message_push()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_outbox uuid;v_count integer:=0;v_skip text;v_allow text;
begin
 if new.recipient_id is null or new.sender_id=new.recipient_id then return new;end if;
 if exists(select 1 from public.blocked_users b where(b.blocker_id=new.recipient_id and b.blocked_id=new.sender_id)or(b.blocker_id=new.sender_id and b.blocked_id=new.recipient_id))then v_skip:='blocked_relationship';else select coalesce(allow_messages_from,'everyone')into v_allow from public.user_profiles where id=new.recipient_id;if v_allow='nobody'then v_skip:='recipient_messages_disabled';elsif v_allow='followers'and not exists(select 1 from public.follows where follower_id=new.sender_id and following_id=new.recipient_id)then v_skip:='recipient_followers_only';end if;end if;
 insert into public.message_push_outbox(message_id,sender_id,recipient_id,status,next_attempt_at,last_error)values(new.id,new.sender_id,new.recipient_id,case when v_skip is null then'pending'else'skipped'end,now(),v_skip)on conflict(message_id)do nothing returning id into v_outbox;
 if v_outbox is null or v_skip is not null then return new;end if;
 insert into public.message_push_deliveries(outbox_id,message_id,device_id,token_snapshot,status,next_attempt_at)select v_outbox,new.id,s.id,s.token,'pending',now()from(select distinct on(trim(expo_push_token))id,trim(expo_push_token)token from public.call_devices where user_id=new.recipient_id and active and expo_push_token is not null and trim(expo_push_token)~'^(ExponentPushToken|ExpoPushToken)\[[^]]+\]$'order by trim(expo_push_token),last_seen_at desc,updated_at desc,created_at desc)s on conflict(message_id,device_id)do nothing;
 get diagnostics v_count=row_count;if v_count=0 then update public.message_push_outbox set status='skipped',last_error='no_active_expo_device'where id=v_outbox;end if;return new;
end;$$;
revoke all on function public.enqueue_message_push() from public,anon,authenticated;

drop policy if exists messages_select_participant on public.messages;
create policy messages_select_participant on public.messages for select to authenticated using(public.chat_can_read_message(conversation_id,created_at));
drop policy if exists chat_message_receipts_member_select on public.chat_message_receipts;
create policy chat_message_receipts_member_select on public.chat_message_receipts for select to authenticated using(
 user_id=(select auth.uid())or exists(select 1 from public.messages m where m.id=chat_message_receipts.message_id and m.sender_id=(select auth.uid())));

revoke all on function public.chat_create_group(uuid,text,uuid[]) from public,anon,authenticated;
revoke all on function public.chat_update_group_name(uuid,text) from public,anon,authenticated;
revoke all on function public.chat_add_group_members(uuid,uuid[]) from public,anon,authenticated;
revoke all on function public.chat_remove_group_member(uuid,uuid) from public,anon,authenticated;
revoke all on function public.chat_set_group_admin(uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.chat_transfer_group_ownership(uuid,uuid) from public,anon,authenticated;
revoke all on function public.chat_leave_group(uuid) from public,anon,authenticated;
revoke all on function public.chat_get_message_receipts(uuid) from public,anon,authenticated;
grant execute on function public.chat_create_group(uuid,text,uuid[]),public.chat_update_group_name(uuid,text),public.chat_add_group_members(uuid,uuid[]),public.chat_remove_group_member(uuid,uuid),public.chat_set_group_admin(uuid,uuid,boolean),public.chat_transfer_group_ownership(uuid,uuid),public.chat_leave_group(uuid),public.chat_get_message_receipts(uuid) to authenticated,service_role;
revoke all on function public.chat_send_message(uuid,uuid,text,text,text,uuid,uuid,integer,smallint[]),public.chat_acknowledge_delivery(uuid),public.chat_acknowledge_read(uuid),public.chat_acknowledge_pending_deliveries(integer),public.chat_acknowledge_read_batch(uuid[]),public.chat_mark_conversation_read(uuid),public.chat_get_conversations(integer,timestamptz,uuid),public.chat_get_recent_messages_v3(uuid,integer,timestamptz,uuid),public.chat_get_members(uuid),public.chat_authorize_media_access(uuid) from public,anon,authenticated;
grant execute on function public.chat_send_message(uuid,uuid,text,text,text,uuid,uuid,integer,smallint[]),public.chat_acknowledge_delivery(uuid),public.chat_acknowledge_read(uuid),public.chat_acknowledge_pending_deliveries(integer),public.chat_acknowledge_read_batch(uuid[]),public.chat_mark_conversation_read(uuid),public.chat_get_conversations(integer,timestamptz,uuid),public.chat_get_recent_messages_v3(uuid,integer,timestamptz,uuid),public.chat_get_members(uuid),public.chat_authorize_media_access(uuid) to authenticated,service_role;

do $$ declare v_count bigint;v_digest text;v_expected_count bigint;v_expected_digest text;begin
 select count(*),md5(coalesce(string_agg(id::text,','order by id),''))into v_count,v_digest from public.messages;
 select message_count,message_digest into v_expected_count,v_expected_digest from chat_v2_e_snapshot;
 if v_count is distinct from v_expected_count or v_digest is distinct from v_expected_digest then raise exception 'chat_v2_e_message_integrity_failed';end if;
 if exists(select 1 from public.messages m join public.chat_conversations c on c.id=m.conversation_id where(c.conversation_type='direct'and m.recipient_id is null)or(c.conversation_type='group'and m.recipient_id is not null))then raise exception 'chat_v2_e_message_shape_failed';end if;
end$$;

comment on column public.messages.recipient_id is 'Direct recipient; NULL for the single canonical row of a group message.';
notify pgrst,'reload schema';
commit;
