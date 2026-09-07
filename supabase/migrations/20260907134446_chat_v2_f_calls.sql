begin;

alter table public.calls
  add column if not exists conversation_id uuid references public.chat_conversations(id) on delete restrict,
  add column if not exists call_scope text not null default 'direct';

alter table public.calls drop constraint if exists calls_scope_check;
alter table public.calls add constraint calls_scope_check check (call_scope in ('direct','group'));
alter table public.calls drop constraint if exists calls_scope_shape_check;
alter table public.calls add constraint calls_scope_shape_check check (
  (call_scope='direct' and conversation_id is null and callee_id is not null)
  or (call_scope='group' and conversation_id is not null and callee_id is null)
) not valid;
alter table public.calls validate constraint calls_scope_shape_check;

create unique index calls_one_joinable_group_per_conversation
  on public.calls(conversation_id)
  where call_scope='group' and status in ('ringing','accepted');
create index calls_conversation_created_idx on public.calls(conversation_id,created_at desc)
  where conversation_id is not null;

create table public.call_participants (
  call_id uuid not null references public.calls(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  state text not null check(state in ('invited','ringing','joined','declined','left')),
  invited_at timestamptz not null default now(),
  ringing_at timestamptz,
  joined_at timestamptz,
  left_at timestamptz,
  declined_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(call_id,user_id)
);
create index call_participants_user_state_idx on public.call_participants(user_id,state,updated_at desc);
create index call_participants_call_state_idx on public.call_participants(call_id,state);

alter table public.call_participants enable row level security;

create or replace function public.call_actor_can_access(p_call_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(
    select 1 from public.calls c
    where c.id=p_call_id and (
      (c.call_scope='direct' and (c.caller_id=(select auth.uid()) or c.callee_id=(select auth.uid())))
      or (c.call_scope='group' and exists(
        select 1 from public.chat_conversation_members cm
        where cm.conversation_id=c.conversation_id and cm.user_id=(select auth.uid()) and cm.is_active
      ))
    )
  )
$$;

revoke all on function public.call_actor_can_access(uuid) from public,anon;
grant execute on function public.call_actor_can_access(uuid) to authenticated,service_role;

drop policy if exists calls_select_participant on public.calls;
create policy calls_select_participant on public.calls for select to authenticated using(public.call_actor_can_access(id));
drop policy if exists calls_insert_caller on public.calls;
drop policy if exists calls_update_participant on public.calls;
revoke insert,update,delete on table public.calls from anon,authenticated;
grant select on table public.calls to authenticated;

create policy call_participants_select_authorized on public.call_participants
for select to authenticated using(public.call_actor_can_access(call_id));

create or replace function public.touch_call_participant_updated_at()
returns trigger language plpgsql set search_path=pg_catalog,public as $$ begin new.updated_at=clock_timestamp(); return new; end $$;
create trigger call_participants_touch_updated_at before update on public.call_participants
for each row execute function public.touch_call_participant_updated_at();

create or replace function public.start_group_call(
  p_conversation_id uuid,
  p_call_type text,
  p_idempotency_key text
) returns table(call_id uuid,conversation_id uuid,caller_id uuid,channel_name text,call_type text,status text)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_type text:=lower(trim(coalesce(p_call_type,''))); v_key text:=nullif(trim(p_idempotency_key),''); v_call public.calls%rowtype;
begin
 if v_actor is null then raise exception 'not authenticated'; end if;
 if v_type not in('audio','video') then raise exception 'invalid call_type'; end if;
 if v_key is null then raise exception 'idempotency_key is required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text,0));
 if not exists(select 1 from public.chat_conversations c join public.chat_conversation_members cm on cm.conversation_id=c.id where c.id=p_conversation_id and c.conversation_type='group' and c.status='active' and cm.user_id=v_actor and cm.is_active) then raise exception 'group call not authorized'; end if;
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
declare v_actor uuid:=(select auth.uid()); v_call public.calls%rowtype;
begin
 if v_actor is null then raise exception 'not authenticated'; end if;
 select c.* into v_call from public.calls c where c.id=p_call_id for update;
 if v_call.id is null or v_call.call_scope<>'group' then raise exception 'group call not found'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_call.conversation_id::text,0));
 if v_call.status<>'accepted' then raise exception 'group call is not joinable'; end if;
 if not exists(select 1 from public.chat_conversations c join public.chat_conversation_members cm on cm.conversation_id=c.id where c.id=v_call.conversation_id and c.status='active' and c.conversation_type='group' and cm.user_id=v_actor and cm.is_active) then raise exception 'group call not authorized'; end if;
 insert into public.call_participants(call_id,user_id,state,joined_at,left_at,declined_at)
 values(v_call.id,v_actor,'joined',clock_timestamp(),null,null)
 on conflict on constraint call_participants_pkey do update
 set state='joined',joined_at=clock_timestamp(),left_at=null,declined_at=null;
 update public.calls set last_heartbeat_at=clock_timestamp() where id=v_call.id;
 return query select v_call.id,v_call.conversation_id,v_call.channel_name,v_call.call_type,v_call.status;
end $$;

create or replace function public.decline_group_call(p_call_id uuid)
returns table(call_id uuid,state text) language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid());
begin
 if v_actor is null then raise exception 'not authenticated'; end if;
 update public.call_participants p set state='declined',declined_at=coalesce(p.declined_at,clock_timestamp())
 where p.call_id=p_call_id and p.user_id=v_actor and p.state in('invited','ringing')
 and exists(select 1 from public.calls c join public.chat_conversation_members cm on cm.conversation_id=c.conversation_id where c.id=p.call_id and c.call_scope='group' and c.status='accepted' and cm.user_id=v_actor and cm.is_active);
 if not found then raise exception 'group call decline not authorized'; end if;
 return query select p_call_id,'declined'::text;
end $$;

create or replace function public.leave_group_call(p_call_id uuid)
returns table(call_id uuid,status text,state text) language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_call public.calls%rowtype;
begin
 if v_actor is null then raise exception 'not authenticated'; end if;
 select c.* into v_call from public.calls c where c.id=p_call_id for update;
 if v_call.id is null or v_call.call_scope<>'group' then raise exception 'group call not found'; end if;
 update public.call_participants p set state='left',left_at=coalesce(p.left_at,clock_timestamp()) where p.call_id=p_call_id and p.user_id=v_actor and p.state='joined';
 if not found and v_call.status='accepted' then raise exception 'not an active call participant'; end if;
 if v_call.status='accepted' and not exists(select 1 from public.call_participants p where p.call_id=p_call_id and p.state='joined') then
   update public.calls c set status='ended',ended_at=coalesce(c.ended_at,clock_timestamp()),end_reason=coalesce(c.end_reason,'last_participant_left') where c.id=p_call_id returning * into v_call;
 end if;
 return query select v_call.id,v_call.status,'left'::text;
end $$;

create or replace function public.get_group_call_state(p_conversation_id uuid)
returns table(call_id uuid,conversation_id uuid,caller_id uuid,channel_name text,call_type text,status text,created_at timestamptz)
language sql stable security definer set search_path=pg_catalog,public as $$
 select c.id,c.conversation_id,c.caller_id,c.channel_name,c.call_type,c.status,c.created_at from public.calls c
 join public.chat_conversation_members cm on cm.conversation_id=c.conversation_id
 where c.conversation_id=p_conversation_id and c.call_scope='group' and c.status in('ringing','accepted') and cm.user_id=(select auth.uid()) and cm.is_active order by c.created_at desc limit 1
$$;

create or replace function public.get_call_participants(p_call_id uuid)
returns table(user_id uuid,state text,joined_at timestamptz,left_at timestamptz,username text,avatar_url text)
language sql stable security definer set search_path=pg_catalog,public as $$
 select p.user_id,p.state,p.joined_at,p.left_at,u.username,u.avatar_url from public.call_participants p join public.user_profiles u on u.id=p.user_id
 where p.call_id=p_call_id and public.call_actor_can_access(p.call_id) order by p.joined_at nulls last,p.invited_at,p.user_id
$$;

create or replace function public.authorize_group_call_token(p_call_id uuid)
returns table(call_id uuid,channel_name text,agora_uid integer,call_type text)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=(select auth.uid()); v_call public.calls%rowtype;
begin
 if v_actor is null then raise exception 'not authenticated'; end if;
 select c.* into v_call from public.calls c where c.id=p_call_id;
 if v_call.id is null or v_call.call_scope<>'group' then raise exception 'group call not found'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_call.conversation_id::text,0));
 if v_call.status<>'accepted' then raise exception 'group call is not joinable'; end if;
 if not exists(select 1 from public.chat_conversations c join public.chat_conversation_members cm on cm.conversation_id=c.id where c.id=v_call.conversation_id and c.status='active' and cm.user_id=v_actor and cm.is_active) then raise exception 'group call not authorized'; end if;
 if not exists(select 1 from public.call_participants p where p.call_id=v_call.id and p.user_id=v_actor and p.state='joined') then raise exception 'participant has not joined'; end if;
 return query select v_call.id,v_call.channel_name,abs(hashtextextended(v_actor::text,0)%2147483647)::integer,v_call.call_type;
end $$;

create or replace function public.remove_departed_group_call_participant()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_call_id uuid;
begin
 if old.is_active and not new.is_active then
   for v_call_id in
     select c.id from public.calls c
     where c.conversation_id=new.conversation_id and c.call_scope='group' and c.status='accepted'
     for update
   loop
     update public.call_participants p set state='left',left_at=coalesce(p.left_at,clock_timestamp())
     where p.call_id=v_call_id and p.user_id=new.user_id and p.state in('invited','ringing','joined');
     if not exists(select 1 from public.call_participants p where p.call_id=v_call_id and p.state='joined') then
       update public.calls c set status='ended',ended_at=coalesce(c.ended_at,clock_timestamp()),end_reason=coalesce(c.end_reason,'system_cleanup')
       where c.id=v_call_id and c.status='accepted';
     end if;
   end loop;
 end if;
 return new;
end $$;

create trigger chat_members_remove_call_participant
after update of is_active on public.chat_conversation_members
for each row when(old.is_active is distinct from new.is_active)
execute function public.remove_departed_group_call_participant();

revoke all on function public.touch_call_participant_updated_at() from public,anon,authenticated;
revoke all on function public.remove_departed_group_call_participant() from public,anon,authenticated;

revoke all on table public.call_participants from public,anon;
grant select on table public.call_participants to authenticated;
grant all on table public.call_participants to service_role;

do $$ declare f regprocedure; begin
 foreach f in array array[
  'public.start_group_call(uuid,text,text)'::regprocedure,
  'public.join_group_call(uuid)'::regprocedure,
  'public.decline_group_call(uuid)'::regprocedure,
  'public.leave_group_call(uuid)'::regprocedure,
  'public.get_group_call_state(uuid)'::regprocedure,
  'public.get_call_participants(uuid)'::regprocedure,
  'public.authorize_group_call_token(uuid)'::regprocedure
 ] loop execute format('revoke all on function %s from public, anon',f); execute format('grant execute on function %s to authenticated, service_role',f); end loop;
end $$;

alter publication supabase_realtime add table public.call_participants;

comment on table public.call_participants is 'Canonical per-user lifecycle for direct/group call participation; CHAT group calls remain rows in public.calls.';
comment on table public.group_call_rooms is 'Legacy link-room compatibility only. CHAT-V2 group calls use public.calls and public.call_participants.';

commit;
