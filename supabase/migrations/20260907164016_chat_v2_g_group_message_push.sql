begin;

alter table public.message_push_outbox alter column recipient_id drop not null;

create or replace function public.enqueue_message_push()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_outbox uuid;v_count integer:=0;v_skip text;v_allow text;v_type text;v_conversation_status text;
begin
 if new.sender_id=new.recipient_id then return new;end if;
 select conversation_type,status into v_type,v_conversation_status from public.chat_conversations where id=new.conversation_id;
 if v_type='direct' then
  if new.recipient_id is null then return new;end if;
  if exists(select 1 from public.blocked_users b where(b.blocker_id=new.recipient_id and b.blocked_id=new.sender_id)or(b.blocker_id=new.sender_id and b.blocked_id=new.recipient_id))then v_skip:='blocked_relationship';
  else select coalesce(allow_messages_from,'everyone')into v_allow from public.user_profiles where id=new.recipient_id;
   if v_allow='nobody'then v_skip:='recipient_messages_disabled';elsif v_allow='followers'and not exists(select 1 from public.follows where follower_id=new.sender_id and following_id=new.recipient_id)then v_skip:='recipient_followers_only';end if;
  end if;
 elsif v_type='group' then
  if new.recipient_id is not null or v_conversation_status<>'active'then v_skip:='group_not_active';end if;
 else return new;end if;
 insert into public.message_push_outbox(message_id,sender_id,recipient_id,status,next_attempt_at,last_error)values(new.id,new.sender_id,new.recipient_id,case when v_skip is null then'pending'else'skipped'end,now(),v_skip)on conflict(message_id)do nothing returning id into v_outbox;
 if v_outbox is null or v_skip is not null then return new;end if;
 if v_type='direct' then
  insert into public.message_push_deliveries(outbox_id,message_id,device_id,token_snapshot,status,next_attempt_at)
  select v_outbox,new.id,d.id,d.token,'pending',now()from(select distinct on(trim(cd.expo_push_token))cd.id,trim(cd.expo_push_token)token from public.call_devices cd where cd.user_id=new.recipient_id and cd.active and cd.expo_push_token is not null and trim(cd.expo_push_token)~'^(ExponentPushToken|ExpoPushToken)\[[^]]+\]$'order by trim(cd.expo_push_token),cd.last_seen_at desc,cd.updated_at desc,cd.created_at desc)d on conflict(message_id,device_id)do nothing;
 else
  insert into public.message_push_deliveries(outbox_id,message_id,device_id,token_snapshot,status,next_attempt_at)
  select v_outbox,new.id,d.id,d.token,'pending',now()from(select distinct on(trim(cd.expo_push_token))cd.id,trim(cd.expo_push_token)token from public.chat_conversation_members cm join public.call_devices cd on cd.user_id=cm.user_id where cm.conversation_id=new.conversation_id and cm.is_active and cm.user_id<>new.sender_id and cm.joined_at<=new.created_at and cd.active and cd.expo_push_token is not null and trim(cd.expo_push_token)~'^(ExponentPushToken|ExpoPushToken)\[[^]]+\]$'order by trim(cd.expo_push_token),cd.last_seen_at desc,cd.updated_at desc,cd.created_at desc)d on conflict(message_id,device_id)do nothing;
 end if;
 get diagnostics v_count=row_count;if v_count=0 then update public.message_push_outbox set status='skipped',last_error='no_active_expo_device'where id=v_outbox;end if;return new;
end;$$;

revoke all on function public.enqueue_message_push() from public,anon,authenticated;
grant execute on function public.enqueue_message_push() to service_role;
comment on function public.enqueue_message_push() is 'Canonical direct/group message push fanout. One outbox row per message; group deliveries are bounded by active membership and joined_at.';

notify pgrst,'reload schema';
commit;
