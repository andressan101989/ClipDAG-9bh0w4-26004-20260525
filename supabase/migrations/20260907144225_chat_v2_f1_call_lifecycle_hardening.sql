begin;

-- F1 uses one serialization boundary for every active-membership mutation and
-- every group-call authorization. The global order is:
-- conversation advisory lock -> conversation -> membership -> call -> participant.

create or replace function public.chat_add_group_members(p_conversation_id uuid,p_user_ids uuid[])
returns bigint language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_ids uuid[]; v_count bigint; v_current integer;
begin
 if v_actor is null then raise exception 'chat_auth_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text,0));
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
 select p_conversation_id,x,'member',clock_timestamp(),null,true from unnest(v_ids)x
 on conflict(conversation_id,user_id) do update set role='member',joined_at=clock_timestamp(),left_at=null,is_active=true
 where not public.chat_conversation_members.is_active;
 get diagnostics v_count=row_count; return v_count;
end $$;

create or replace function public.chat_remove_group_member(p_conversation_id uuid,p_user_id uuid)
returns public.chat_conversation_members language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_role text; v_target public.chat_conversation_members%rowtype;
begin
 if v_actor is null then raise exception 'chat_auth_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text,0));
 perform 1 from public.chat_conversations where id=p_conversation_id and conversation_type='group' and status='active' for update;
 if not found then raise exception 'chat_group_unavailable'; end if;
 select role into v_role from public.chat_conversation_members where conversation_id=p_conversation_id and user_id=v_actor and is_active;
 select * into v_target from public.chat_conversation_members where conversation_id=p_conversation_id and user_id=p_user_id and is_active for update;
 if v_target.user_id is null then raise exception 'chat_group_member_missing'; end if;
 if p_user_id=v_actor then raise exception 'chat_group_use_leave'; end if;
 if v_target.role='owner' then raise exception 'chat_group_owner_protected'; end if;
 if v_role='admin' and v_target.role<>'member' then raise exception 'chat_group_admin_scope'; end if;
 if v_role<>'owner' and v_role<>'admin' then raise exception 'chat_group_admin_required'; end if;
 update public.chat_conversation_members set is_active=false,left_at=clock_timestamp() where conversation_id=p_conversation_id and user_id=p_user_id returning * into v_target;
 return v_target;
end $$;

create or replace function public.chat_leave_group(p_conversation_id uuid)
returns public.chat_conversations language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_result public.chat_conversations%rowtype; v_role text; v_others integer;
begin
 if v_actor is null then raise exception 'chat_auth_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text,0));
 select * into v_result from public.chat_conversations where id=p_conversation_id and conversation_type='group' and status='active' for update;
 if v_result.id is null then raise exception 'chat_group_unavailable'; end if;
 select role into v_role from public.chat_conversation_members where conversation_id=p_conversation_id and user_id=v_actor and is_active for update;
 if v_role is null then raise exception 'chat_membership_required'; end if;
 select count(*) into v_others from public.chat_conversation_members where conversation_id=p_conversation_id and is_active and user_id<>v_actor;
 if v_role='owner' and v_others>0 then raise exception 'chat_group_transfer_required'; end if;
 update public.chat_conversation_members set is_active=false,left_at=clock_timestamp() where conversation_id=p_conversation_id and user_id=v_actor;
 if v_others=0 then update public.chat_conversations set status='closed' where id=p_conversation_id returning * into v_result; end if;
 return v_result;
end $$;

create or replace function public.start_group_call(
  p_conversation_id uuid,p_call_type text,p_idempotency_key text
) returns table(call_id uuid,conversation_id uuid,caller_id uuid,channel_name text,call_type text,status text)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_type text:=lower(trim(coalesce(p_call_type,''))); v_key text:=nullif(trim(p_idempotency_key),''); v_call public.calls%rowtype;
begin
 if v_actor is null then raise exception 'not authenticated'; end if;
 if v_type not in('audio','video') then raise exception 'invalid call_type'; end if;
 if v_key is null then raise exception 'idempotency_key is required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text,0));
 perform 1 from public.chat_conversations c where c.id=p_conversation_id and c.conversation_type='group' and c.status='active' for share;
 if not found then raise exception 'group call not authorized'; end if;
 perform 1 from public.chat_conversation_members cm where cm.conversation_id=p_conversation_id and cm.user_id=v_actor and cm.is_active for share;
 if not found then raise exception 'group call not authorized'; end if;
 select c.* into v_call from public.calls c where c.caller_id=v_actor and c.idempotency_key=v_key for update;
 if v_call.id is not null then
   if v_call.call_scope<>'group' or v_call.conversation_id<>p_conversation_id or v_call.call_type<>v_type then raise exception 'call idempotency conflict'; end if;
 else
   select c.* into v_call from public.calls c where c.conversation_id=p_conversation_id and c.call_scope='group' and c.status in('ringing','accepted') order by c.created_at desc limit 1 for update;
   if v_call.id is null then
     insert into public.calls(id,caller_id,callee_id,channel_name,status,call_type,created_at,updated_at,accepted_at,last_heartbeat_at,idempotency_key,conversation_id,call_scope)
     values(gen_random_uuid(),v_actor,null,'c_'||replace(gen_random_uuid()::text,'-',''),'accepted',v_type,clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp(),v_key,p_conversation_id,'group') returning * into v_call;
     insert into public.call_participants(call_id,user_id,state,ringing_at,joined_at)
     select v_call.id,cm.user_id,case when cm.user_id=v_actor then 'joined' else 'ringing' end,
       case when cm.user_id<>v_actor then clock_timestamp() end,case when cm.user_id=v_actor then clock_timestamp() end
     from public.chat_conversation_members cm where cm.conversation_id=p_conversation_id and cm.is_active;
   end if;
 end if;
 return query select v_call.id,v_call.conversation_id,v_call.caller_id,v_call.channel_name,v_call.call_type,v_call.status;
end $$;

create or replace function public.join_group_call(p_call_id uuid)
returns table(call_id uuid,conversation_id uuid,channel_name text,call_type text,status text)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_conversation_id uuid; v_call public.calls%rowtype;
begin
 if v_actor is null then raise exception 'not authenticated'; end if;
 select c.conversation_id into v_conversation_id from public.calls c where c.id=p_call_id and c.call_scope='group';
 if v_conversation_id is null then raise exception 'group call not found'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_conversation_id::text,0));
 perform 1 from public.chat_conversations c where c.id=v_conversation_id and c.status='active' and c.conversation_type='group' for share;
 if not found then raise exception 'group call not authorized'; end if;
 perform 1 from public.chat_conversation_members cm where cm.conversation_id=v_conversation_id and cm.user_id=v_actor and cm.is_active for share;
 if not found then raise exception 'group call not authorized'; end if;
 select c.* into v_call from public.calls c where c.id=p_call_id and c.call_scope='group' for update;
 if v_call.id is null then raise exception 'group call not found'; end if;
 if v_call.status<>'accepted' then raise exception 'group call is not joinable'; end if;
 insert into public.call_participants(call_id,user_id,state,joined_at,left_at,declined_at)
 values(v_call.id,v_actor,'joined',clock_timestamp(),null,null)
 on conflict on constraint call_participants_pkey do update
 set state='joined',joined_at=clock_timestamp(),left_at=null,declined_at=null;
 update public.calls set last_heartbeat_at=clock_timestamp() where id=v_call.id;
 return query select v_call.id,v_call.conversation_id,v_call.channel_name,v_call.call_type,v_call.status;
end $$;

create or replace function public.leave_group_call(p_call_id uuid)
returns table(call_id uuid,status text,state text) language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_conversation_id uuid; v_call public.calls%rowtype;
begin
 if v_actor is null then raise exception 'not authenticated'; end if;
 select c.conversation_id into v_conversation_id from public.calls c where c.id=p_call_id and c.call_scope='group';
 if v_conversation_id is null then raise exception 'group call not found'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_conversation_id::text,0));
 perform 1 from public.chat_conversations c where c.id=v_conversation_id for share;
 select c.* into v_call from public.calls c where c.id=p_call_id and c.call_scope='group' for update;
 if v_call.id is null then raise exception 'group call not found'; end if;
 update public.call_participants p set state='left',left_at=coalesce(p.left_at,clock_timestamp()) where p.call_id=p_call_id and p.user_id=v_actor and p.state='joined';
 if not found and v_call.status='accepted' then raise exception 'not an active call participant'; end if;
 if v_call.status='accepted' and not exists(select 1 from public.call_participants p where p.call_id=p_call_id and p.state='joined') then
   update public.calls c set status='ended',ended_at=coalesce(c.ended_at,clock_timestamp()),end_reason=coalesce(c.end_reason,'last_participant_left') where c.id=p_call_id returning * into v_call;
 end if;
 return query select v_call.id,v_call.status,'left'::text;
end $$;

create or replace function public.authorize_group_call_token(p_call_id uuid)
returns table(call_id uuid,channel_name text,agora_uid integer,call_type text)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_conversation_id uuid; v_call public.calls%rowtype;
begin
 if v_actor is null then raise exception 'not authenticated'; end if;
 select c.conversation_id into v_conversation_id from public.calls c where c.id=p_call_id and c.call_scope='group';
 if v_conversation_id is null then raise exception 'group call not found'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_conversation_id::text,0));
 perform 1 from public.chat_conversations c where c.id=v_conversation_id and c.status='active' and c.conversation_type='group' for share;
 if not found then raise exception 'group call not authorized'; end if;
 perform 1 from public.chat_conversation_members cm where cm.conversation_id=v_conversation_id and cm.user_id=v_actor and cm.is_active for share;
 if not found then raise exception 'group call not authorized'; end if;
 select c.* into v_call from public.calls c where c.id=p_call_id and c.call_scope='group' for share;
 if v_call.id is null then raise exception 'group call not found'; end if;
 if v_call.status<>'accepted' then raise exception 'group call is not joinable'; end if;
 perform 1 from public.call_participants p where p.call_id=v_call.id and p.user_id=v_actor and p.state='joined' for share;
 if not found then raise exception 'participant has not joined'; end if;
 -- Compatibility-only output. agora-token remains the canonical UID authority
 -- and intentionally ignores this field.
 return query select v_call.id,v_call.channel_name,abs(hashtextextended(v_actor::text,0)%2147483647)::integer,v_call.call_type;
end $$;

create or replace function public.mark_call_joined(p_call_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_scope text; v_conversation_id uuid; v_updated_id uuid;
begin
 if v_actor is null then raise exception 'not authenticated'; end if;
 select c.call_scope,c.conversation_id into v_scope,v_conversation_id from public.calls c where c.id=p_call_id;
 if v_scope='direct' then
   update public.calls c set joined_at=coalesce(c.joined_at,clock_timestamp())
   where c.id=p_call_id and c.status='accepted' and v_actor in(c.caller_id,c.callee_id) returning c.id into v_updated_id;
   return v_updated_id is not null;
 end if;
 if v_scope<>'group' or v_conversation_id is null then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_conversation_id::text,0));
 perform 1 from public.chat_conversations c where c.id=v_conversation_id and c.status='active' for share;
 if not found then return false; end if;
 perform 1 from public.chat_conversation_members cm where cm.conversation_id=v_conversation_id and cm.user_id=v_actor and cm.is_active for share;
 if not found then return false; end if;
 perform 1 from public.calls c where c.id=p_call_id and c.call_scope='group' and c.status='accepted' for update;
 if not found then return false; end if;
 perform 1 from public.call_participants p where p.call_id=p_call_id and p.user_id=v_actor and p.state='joined' for share;
 if not found then return false; end if;
 update public.calls c set joined_at=coalesce(c.joined_at,clock_timestamp()) where c.id=p_call_id returning c.id into v_updated_id;
 return v_updated_id is not null;
end $$;

create or replace function public.mark_call_media_connected(p_call_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_scope text; v_conversation_id uuid; v_updated_id uuid;
begin
 if v_actor is null then raise exception 'not authenticated'; end if;
 select c.call_scope,c.conversation_id into v_scope,v_conversation_id from public.calls c where c.id=p_call_id;
 if v_scope='direct' then
   update public.calls c set handoff_completed_at=coalesce(c.handoff_completed_at,clock_timestamp()),joined_at=coalesce(c.joined_at,clock_timestamp()),media_connected_at=coalesce(c.media_connected_at,clock_timestamp()),last_heartbeat_at=clock_timestamp()
   where c.id=p_call_id and c.status='accepted' and v_actor in(c.caller_id,c.callee_id) returning c.id into v_updated_id;
   return v_updated_id is not null;
 end if;
 if v_scope<>'group' or v_conversation_id is null then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_conversation_id::text,0));
 perform 1 from public.chat_conversations c where c.id=v_conversation_id and c.status='active' for share;
 if not found then return false; end if;
 perform 1 from public.chat_conversation_members cm where cm.conversation_id=v_conversation_id and cm.user_id=v_actor and cm.is_active for share;
 if not found then return false; end if;
 perform 1 from public.calls c where c.id=p_call_id and c.call_scope='group' and c.status='accepted' for update;
 if not found then return false; end if;
 perform 1 from public.call_participants p where p.call_id=p_call_id and p.user_id=v_actor and p.state='joined' for share;
 if not found then return false; end if;
 update public.calls c set handoff_completed_at=coalesce(c.handoff_completed_at,clock_timestamp()),joined_at=coalesce(c.joined_at,clock_timestamp()),media_connected_at=coalesce(c.media_connected_at,clock_timestamp()),last_heartbeat_at=clock_timestamp()
 where c.id=p_call_id returning c.id into v_updated_id;
 return v_updated_id is not null;
end $$;

create or replace function public.heartbeat_call(p_call_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_scope text; v_conversation_id uuid; v_updated_id uuid;
begin
 if v_actor is null then raise exception 'not authenticated'; end if;
 select c.call_scope,c.conversation_id into v_scope,v_conversation_id from public.calls c where c.id=p_call_id;
 if v_scope='direct' then
   update public.calls c set handoff_completed_at=coalesce(c.handoff_completed_at,clock_timestamp()),joined_at=coalesce(c.joined_at,clock_timestamp()),media_connected_at=coalesce(c.media_connected_at,clock_timestamp()),last_heartbeat_at=clock_timestamp()
   where c.id=p_call_id and c.status='accepted' and v_actor in(c.caller_id,c.callee_id) returning c.id into v_updated_id;
   return v_updated_id is not null;
 end if;
 if v_scope<>'group' or v_conversation_id is null then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_conversation_id::text,0));
 perform 1 from public.chat_conversations c where c.id=v_conversation_id and c.status='active' for share;
 if not found then return false; end if;
 perform 1 from public.chat_conversation_members cm where cm.conversation_id=v_conversation_id and cm.user_id=v_actor and cm.is_active for share;
 if not found then return false; end if;
 perform 1 from public.calls c where c.id=p_call_id and c.call_scope='group' and c.status='accepted' for update;
 if not found then return false; end if;
 perform 1 from public.call_participants p where p.call_id=p_call_id and p.user_id=v_actor and p.state='joined' for share;
 if not found then return false; end if;
 update public.calls c set handoff_completed_at=coalesce(c.handoff_completed_at,clock_timestamp()),joined_at=coalesce(c.joined_at,clock_timestamp()),media_connected_at=coalesce(c.media_connected_at,clock_timestamp()),last_heartbeat_at=clock_timestamp()
 where c.id=p_call_id returning c.id into v_updated_id;
 return v_updated_id is not null;
end $$;

create or replace function public.expire_stale_calls()
returns table(closed_count integer,closed_ids uuid[])
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_call record; v_ids uuid[]:='{}';
begin
 for v_call in
  with candidates as(
   select c.id from public.calls c where c.status='ringing'
   and ((c.expires_at is not null and c.expires_at<clock_timestamp()) or (c.expires_at is null and c.created_at<clock_timestamp()-interval '45 seconds'))
   for update of c skip locked
  ),closed as(
   update public.calls c set status='expired',end_reason=coalesce(c.end_reason,'timeout'),ended_at=coalesce(c.ended_at,clock_timestamp())
   from candidates where c.id=candidates.id and c.status='ringing' returning c.id,c.end_reason,c.call_scope
  ) select * from closed
 loop
  v_ids:=array_append(v_ids,v_call.id);
  perform public.invalidate_incoming_call_presentations(v_call.id,'timeout');
  perform public.enqueue_call_terminal_deliveries(v_call.id,'call_expired','expired',coalesce(v_call.end_reason,'timeout'));
 end loop;

 for v_call in
  with candidates as(
   select c.id from public.calls c where c.status='accepted'
   and exists(select 1 from public.call_presentation_config cfg where cfg.id=true and cfg.call_liveness_cleanup_enabled=true)
   and (
    (c.call_scope='direct' and (
      (c.handoff_completed_at is null and coalesce(c.accepted_at,c.updated_at,c.created_at)<clock_timestamp()-interval '3 minutes')
      or (c.handoff_completed_at is not null and c.media_connected_at is null and c.handoff_completed_at<clock_timestamp()-interval '3 minutes')
      or (c.media_connected_at is not null and coalesce(c.last_heartbeat_at,c.media_connected_at)<clock_timestamp()-interval '10 minutes')
    ))
    or (c.call_scope='group' and (
      (not exists(select 1 from public.call_participants p where p.call_id=c.id and p.state='joined')
       and coalesce(c.updated_at,c.accepted_at,c.created_at)<clock_timestamp()-interval '3 minutes')
      or (exists(select 1 from public.call_participants p where p.call_id=c.id and p.state='joined')
       and coalesce(c.last_heartbeat_at,c.accepted_at,c.updated_at,c.created_at)<clock_timestamp()-interval '10 minutes')
    ))
   ) for update of c skip locked
  ),closed as(
   update public.calls c set status='ended',end_reason=coalesce(c.end_reason,'system_cleanup'),ended_at=coalesce(c.ended_at,clock_timestamp())
   from candidates where c.id=candidates.id and c.status='accepted' returning c.id,c.end_reason,c.call_scope
  ) select * from closed
 loop
  v_ids:=array_append(v_ids,v_call.id);
  if v_call.call_scope='group' then
   update public.call_participants p set state='left',left_at=coalesce(p.left_at,clock_timestamp()) where p.call_id=v_call.id and p.state='joined';
  end if;
  perform public.invalidate_incoming_call_presentations(v_call.id,'terminal');
  perform public.enqueue_call_terminal_deliveries(v_call.id,'call_ended','ended',coalesce(v_call.end_reason,'system_cleanup'));
 end loop;
 return query select coalesce(array_length(v_ids,1),0),v_ids;
end $$;

do $$ declare f regprocedure; begin
 foreach f in array array[
  'public.chat_add_group_members(uuid,uuid[])'::regprocedure,
  'public.chat_remove_group_member(uuid,uuid)'::regprocedure,
  'public.chat_leave_group(uuid)'::regprocedure,
  'public.start_group_call(uuid,text,text)'::regprocedure,
  'public.join_group_call(uuid)'::regprocedure,
  'public.leave_group_call(uuid)'::regprocedure,
  'public.authorize_group_call_token(uuid)'::regprocedure,
  'public.mark_call_joined(uuid)'::regprocedure,
  'public.mark_call_media_connected(uuid)'::regprocedure,
  'public.heartbeat_call(uuid)'::regprocedure
 ] loop
  execute format('revoke all on function %s from public, anon',f);
  execute format('grant execute on function %s to authenticated, service_role',f);
 end loop;
end $$;
revoke all on function public.expire_stale_calls() from public,anon,authenticated;
grant execute on function public.expire_stale_calls() to service_role;

comment on function public.expire_stale_calls() is 'Single CALL cleanup authority. Direct thresholds remain unchanged; group calls use joined participants and canonical heartbeat liveness.';
comment on function public.authorize_group_call_token(uuid) is 'Serializes group authorization with membership changes. agora_uid is compatibility metadata; agora-token computes the canonical UID.';

commit;
