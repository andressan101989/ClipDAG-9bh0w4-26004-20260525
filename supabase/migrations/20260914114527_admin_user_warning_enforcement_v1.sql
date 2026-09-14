begin;

do $precheck$
begin
  if to_regclass('private.admin_user_warnings') is not null then
    raise exception 'admin_user_warning_authority_already_exists';
  end if;
  if (select count(*) from private.admin_capabilities
      where capability_code in ('users.accounts.read','users.accounts.moderate','users.accounts.suspend','users.accounts.restore'))<>4 then
    raise exception 'admin_user_warning_capability_precondition_failed';
  end if;
end
$precheck$;

create table private.admin_user_warnings (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references auth.users(id) on update restrict on delete restrict,
  issued_by uuid not null references auth.users(id) on update restrict on delete restrict,
  actor_role_snapshot text[] not null check(cardinality(actor_role_snapshot)>0),
  actor_capability text not null references private.admin_capabilities(capability_code)
    on update restrict on delete restrict,
  reason text not null check(reason=btrim(reason) and char_length(reason) between 2 and 500),
  internal_note text check(internal_note is null or (internal_note=btrim(internal_note) and char_length(internal_note) between 1 and 1000)),
  evidence_type text check(evidence_type is null or evidence_type in('video','story','comment','message','live','battle','report','marketplace','other')),
  evidence_id uuid,
  evidence_note text check(evidence_note is null or (evidence_note=btrim(evidence_note) and char_length(evidence_note) between 1 and 1000)),
  status text not null default 'active' check(status in('active','revoked')),
  warning_level_at_issue integer not null check(warning_level_at_issue between 1 and 3),
  cycle_started_at timestamptz,
  suspension_required boolean not null default false,
  idempotency_scope text not null check(idempotency_scope=btrim(idempotency_scope) and char_length(idempotency_scope) between 8 and 300),
  idempotency_key uuid not null,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  issued_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on update restrict on delete restrict,
  revocation_reason text check(revocation_reason is null or (revocation_reason=btrim(revocation_reason) and char_length(revocation_reason) between 2 and 500)),
  constraint admin_user_warning_actor_target_check check(issued_by<>target_user_id),
  constraint admin_user_warning_capability_check check(actor_capability='users.accounts.moderate'),
  constraint admin_user_warning_evidence_check check(evidence_type is not null or (evidence_id is null and evidence_note is null)),
  constraint admin_user_warning_cycle_check check(cycle_started_at is null or cycle_started_at<=issued_at),
  constraint admin_user_warning_suspension_check check(not suspension_required or warning_level_at_issue=3),
  constraint admin_user_warning_state_check check(
    (status='active' and revoked_at is null and revoked_by is null and revocation_reason is null)
    or (status='revoked' and revoked_at is not null and revoked_by is not null and revocation_reason is not null)
  ),
  unique(idempotency_scope,idempotency_key)
);

create index admin_user_warnings_target_issued_idx
  on private.admin_user_warnings(target_user_id,issued_at desc,id desc);
create index admin_user_warnings_target_active_idx
  on private.admin_user_warnings(target_user_id,issued_at desc,id desc)
  where status='active';

alter table private.admin_user_warnings enable row level security;
revoke all privileges on table private.admin_user_warnings
  from public,anon,authenticated,service_role;

create function private.admin_guard_user_warning()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
begin
  if tg_op='DELETE' then
    raise exception using errcode='42501',message='admin_user_warning_immutable';
  end if;
  if old.status<>'active' then
    raise exception using errcode='55000',message='admin_user_warning_final';
  end if;
  if new.id<>old.id or new.target_user_id<>old.target_user_id or new.issued_by<>old.issued_by
     or new.actor_role_snapshot<>old.actor_role_snapshot or new.actor_capability<>old.actor_capability
     or new.reason<>old.reason or new.internal_note is distinct from old.internal_note
     or new.evidence_type is distinct from old.evidence_type or new.evidence_id is distinct from old.evidence_id
     or new.evidence_note is distinct from old.evidence_note
     or new.warning_level_at_issue<>old.warning_level_at_issue
     or new.cycle_started_at is distinct from old.cycle_started_at
     or new.suspension_required<>old.suspension_required
     or new.idempotency_scope<>old.idempotency_scope or new.idempotency_key<>old.idempotency_key
     or new.request_fingerprint<>old.request_fingerprint or new.issued_at<>old.issued_at then
    raise exception using errcode='42501',message='admin_user_warning_fields_immutable';
  end if;
  if new.status<>'revoked' or new.revoked_at is null or new.revoked_by is null or new.revocation_reason is null then
    raise exception using errcode='55000',message='admin_user_warning_transition_invalid';
  end if;
  return new;
end;
$$;

create trigger admin_user_warning_guard
before update or delete on private.admin_user_warnings
for each row execute function private.admin_guard_user_warning();

revoke all on function private.admin_guard_user_warning()
  from public,anon,authenticated,service_role;

create unique index notifications_admin_warning_reference_uidx
  on public.notifications(user_id,type,reference_type,reference_id)
  where type='admin_warning' and reference_type='admin_user_warning';

create function public.admin_issue_user_warning(
  p_target_user_id uuid,
  p_reason text,
  p_idempotency_key uuid,
  p_internal_note text default null,
  p_evidence_type text default null,
  p_evidence_id uuid default null,
  p_evidence_note text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare
  v_actor uuid;
  v_reason text:=nullif(btrim(p_reason),'');
  v_internal_note text:=nullif(btrim(p_internal_note),'');
  v_evidence_type text:=nullif(lower(btrim(p_evidence_type)),'');
  v_evidence_note text:=nullif(btrim(p_evidence_note),'');
  v_scope text;
  v_fingerprint text;
  v_existing private.admin_user_warnings;
  v_warning private.admin_user_warnings;
  v_target auth.users;
  v_cycle_started_at timestamptz;
  v_active_count integer;
  v_warning_level integer;
  v_account_status text;
  v_suspension_required boolean;
  v_notification_id uuid;
begin
  v_actor:=public.admin_require_capability('users.accounts.moderate');
  if p_target_user_id is null or p_idempotency_key is null or v_reason is null
     or char_length(v_reason) not between 2 and 500
     or (v_internal_note is not null and char_length(v_internal_note)>1000)
     or (v_evidence_note is not null and char_length(v_evidence_note)>1000)
     or (v_evidence_type is not null and v_evidence_type not in('video','story','comment','message','live','battle','report','marketplace','other'))
     or (v_evidence_type is null and (p_evidence_id is not null or v_evidence_note is not null)) then
    raise exception using errcode='22023',message='admin_user_warning_invalid';
  end if;
  if v_actor=p_target_user_id then
    raise exception using errcode='42501',message='admin_user_self_target_forbidden';
  end if;

  v_scope:='v1|human|'||v_actor::text||'|users.accounts.moderate|user.warning.issue';
  v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object(
    'contract_version',1,'actor_kind','human_admin','actor_id',v_actor,
    'capability','users.accounts.moderate','action','user.warning.issue','target_type','user',
    'target_id',p_target_user_id,'reason',v_reason,'internal_note',v_internal_note,
    'evidence_type',v_evidence_type,'evidence_id',p_evidence_id,'evidence_note',v_evidence_note));

  perform pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_idempotency_key::text,0));
  select * into v_existing from private.admin_user_warnings
    where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';
    end if;
    select case when u.banned_until is not null and u.banned_until>clock_timestamp()
      then 'suspended' else 'active' end into v_account_status
    from auth.users u where u.id=v_existing.target_user_id;
    return jsonb_build_object(
      'warning_id',v_existing.id,'target_user_id',v_existing.target_user_id,
      'warning_level',v_existing.warning_level_at_issue,
      'active_warning_count',(select count(*) from private.admin_user_warnings w
        where w.target_user_id=v_existing.target_user_id and w.status='active'
          and w.cycle_started_at is not distinct from v_existing.cycle_started_at),
      'cycle_started_at',v_existing.cycle_started_at,
      'suspension_required',v_existing.suspension_required,
      'account_status',v_account_status,
      'notification_created',exists(select 1 from public.notifications n
        where n.user_id=v_existing.target_user_id and n.type='admin_warning'
          and n.reference_type='admin_user_warning' and n.reference_id=v_existing.id::text),
      'warning_applied',true,'replayed',true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('admin-user-moderation-target:'||p_target_user_id::text,0));
  select * into v_target from auth.users where id=p_target_user_id for update;
  if not found or v_target.deleted_at is not null then
    raise exception using errcode='P0002',message='admin_user_target_not_found';
  end if;
  if exists(select 1 from private.admin_user_roles where user_id=p_target_user_id and revoked_at is null) then
    raise exception using errcode='42501',message='admin_user_admin_target_forbidden';
  end if;
  if not exists(select 1 from public.user_profiles where id=p_target_user_id) then
    raise exception using errcode='P0002',message='admin_user_warning_notification_target_missing';
  end if;

  select max(completed_at) into v_cycle_started_at
  from private.admin_user_moderation_actions
  where target_user_id=p_target_user_id and action='restore' and status='succeeded';

  select count(*) into v_active_count from private.admin_user_warnings
  where target_user_id=p_target_user_id and status='active'
    and (v_cycle_started_at is null or issued_at>v_cycle_started_at);
  if v_active_count>=3 then
    raise exception using errcode='23514',message='admin_user_warning_limit_reached';
  end if;

  v_warning_level:=v_active_count+1;
  v_account_status:=case when v_target.banned_until is not null and v_target.banned_until>clock_timestamp()
    then 'suspended' else 'active' end;
  v_suspension_required:=v_warning_level=3 and v_account_status='active';
  if v_suspension_required and not public.admin_actor_has_capability('users.accounts.suspend') then
    raise exception using errcode='42501',message='admin_user_warning_suspend_capability_required';
  end if;

  insert into private.admin_user_warnings(
    target_user_id,issued_by,actor_role_snapshot,actor_capability,reason,internal_note,
    evidence_type,evidence_id,evidence_note,warning_level_at_issue,cycle_started_at,
    suspension_required,idempotency_scope,idempotency_key,request_fingerprint
  ) values(
    p_target_user_id,v_actor,private.admin_active_role_codes(v_actor),'users.accounts.moderate',
    v_reason,v_internal_note,v_evidence_type,p_evidence_id,v_evidence_note,v_warning_level,
    v_cycle_started_at,v_suspension_required,v_scope,p_idempotency_key,v_fingerprint
  ) returning * into v_warning;

  insert into public.notifications(
    user_id,type,from_user_id,from_username,from_avatar,reference_id,reference_type,message,read
  ) values(
    p_target_user_id,'admin_warning',null,'Nelyon',null,v_warning.id::text,'admin_user_warning',
    'Advertencia '||v_warning_level::text||'/3: '||v_reason,false
  ) returning id into v_notification_id;

  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,
    target_id,target_ref,reason,outcome,financial_effect,contains_pii,metadata,
    idempotency_scope,idempotency_key,request_fingerprint
  ) values(
    v_actor,'human_admin',v_warning.actor_role_snapshot,'users.accounts.moderate',
    'users','user.warning.issue','user',p_target_user_id,v_warning.id::text,v_reason,
    'succeeded',false,true,jsonb_build_object(
      'warning_id',v_warning.id,'warning_level',v_warning_level,'cycle_count',v_warning_level,
      'evidence_type',v_evidence_type,'evidence_id',p_evidence_id),
    v_scope,p_idempotency_key,v_fingerprint
  );

  return jsonb_build_object(
    'warning_id',v_warning.id,'target_user_id',v_warning.target_user_id,
    'warning_level',v_warning.warning_level_at_issue,'active_warning_count',v_warning_level,
    'cycle_started_at',v_warning.cycle_started_at,
    'suspension_required',v_warning.suspension_required,'account_status',v_account_status,
    'notification_created',v_notification_id is not null,'warning_applied',true,'replayed',false);
end;
$$;

create function public.admin_revoke_user_warning(
  p_warning_id uuid,p_reason text,p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare
  v_actor uuid;
  v_reason text:=nullif(btrim(p_reason),'');
  v_scope text;
  v_fingerprint text;
  v_audit private.admin_action_audit;
  v_warning private.admin_user_warnings;
  v_target_user_id uuid;
  v_cycle_started_at timestamptz;
  v_active_count integer;
begin
  v_actor:=public.admin_require_capability('users.accounts.moderate');
  if p_warning_id is null or p_idempotency_key is null or v_reason is null
     or char_length(v_reason) not between 2 and 500 then
    raise exception using errcode='22023',message='admin_user_warning_revocation_invalid';
  end if;
  v_scope:='v1|human|'||v_actor::text||'|users.accounts.moderate|user.warning.revoke';
  v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object(
    'contract_version',1,'actor_kind','human_admin','actor_id',v_actor,
    'capability','users.accounts.moderate','action','user.warning.revoke',
    'target_type','user_warning','target_id',p_warning_id,'reason',v_reason));

  perform pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_idempotency_key::text,0));
  select * into v_audit from private.admin_action_audit
    where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_audit.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';
    end if;
    select * into v_warning from private.admin_user_warnings
      where id=(v_audit.metadata->>'warning_id')::uuid;
    return jsonb_build_object(
      'warning_id',v_warning.id,'target_user_id',v_warning.target_user_id,
      'status',v_warning.status,'active_warning_count',v_audit.metadata->'active_warning_count',
      'revoked_at',v_warning.revoked_at,'replayed',true);
  end if;

  select target_user_id into v_target_user_id from private.admin_user_warnings where id=p_warning_id;
  if not found then raise exception using errcode='P0002',message='admin_user_warning_not_found';end if;
  if v_actor=v_target_user_id then
    raise exception using errcode='42501',message='admin_user_self_target_forbidden';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('admin-user-moderation-target:'||v_target_user_id::text,0));
  select * into v_warning from private.admin_user_warnings where id=p_warning_id for update;
  if exists(select 1 from private.admin_user_roles where user_id=v_warning.target_user_id and revoked_at is null) then
    raise exception using errcode='42501',message='admin_user_admin_target_forbidden';
  end if;
  if v_warning.status<>'active' then
    raise exception using errcode='55000',message='admin_user_warning_already_revoked';
  end if;

  update private.admin_user_warnings set
    status='revoked',revoked_at=clock_timestamp(),revoked_by=v_actor,revocation_reason=v_reason
  where id=v_warning.id returning * into v_warning;

  select max(completed_at) into v_cycle_started_at
  from private.admin_user_moderation_actions
  where target_user_id=v_warning.target_user_id and action='restore' and status='succeeded';
  select count(*) into v_active_count from private.admin_user_warnings
  where target_user_id=v_warning.target_user_id and status='active'
    and (v_cycle_started_at is null or issued_at>v_cycle_started_at);

  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,
    target_id,target_ref,reason,outcome,financial_effect,contains_pii,metadata,
    idempotency_scope,idempotency_key,request_fingerprint
  ) values(
    v_actor,'human_admin',private.admin_active_role_codes(v_actor),'users.accounts.moderate',
    'users','user.warning.revoke','user',v_warning.target_user_id,v_warning.id::text,v_reason,
    'succeeded',false,true,jsonb_build_object(
      'warning_id',v_warning.id,'warning_level',v_warning.warning_level_at_issue,
      'active_warning_count',v_active_count),v_scope,p_idempotency_key,v_fingerprint
  );

  return jsonb_build_object(
    'warning_id',v_warning.id,'target_user_id',v_warning.target_user_id,
    'status',v_warning.status,'active_warning_count',v_active_count,
    'revoked_at',v_warning.revoked_at,'replayed',false);
end;
$$;

create or replace function public.search_admin_users(
  p_query text default null,
  p_status text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare
  v_query text:=nullif(btrim(p_query),'');
  v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('users.accounts.read');
  if p_status is not null and p_status not in('active','suspended') then
    raise exception using errcode='22023',message='admin_user_status_invalid';
  end if;
  if v_query is not null and char_length(v_query)>120 then
    raise exception using errcode='22023',message='admin_user_query_invalid';
  end if;
  if (p_cursor_created_at is null)<>(p_cursor_id is null) then
    raise exception using errcode='22023',message='admin_user_cursor_invalid';
  end if;
  return coalesce((
    with matched as (
      select u.id,u.created_at,u.last_sign_in_at,u.banned_until,
        p.username,p.display_name,p.avatar_url,
        case when u.banned_until is not null and u.banned_until>clock_timestamp()
          then 'suspended' else 'active' end as account_status,
        coalesce(w.active_warning_count,0) as active_warning_count
      from auth.users u
      left join public.public_user_profiles p on p.id=u.id
      left join lateral (
        select max(completed_at) as cycle_started_at
        from private.admin_user_moderation_actions
        where target_user_id=u.id and action='restore' and status='succeeded'
      ) cycle on true
      left join lateral (
        select count(*)::integer as active_warning_count
        from private.admin_user_warnings aw
        where aw.target_user_id=u.id and aw.status='active'
          and (cycle.cycle_started_at is null or aw.issued_at>cycle.cycle_started_at)
      ) w on true
      where u.deleted_at is null
        and (p_cursor_created_at is null or (u.created_at,u.id)<(p_cursor_created_at,p_cursor_id))
        and (v_query is null or u.id::text=v_query
          or p.username ilike '%'||v_query||'%' or p.display_name ilike '%'||v_query||'%')
    ), filtered as (
      select * from matched where p_status is null or account_status=p_status
      order by created_at desc,id desc limit v_limit
    )
    select jsonb_build_object(
      'items',coalesce(jsonb_agg(jsonb_build_object(
        'id',id,'username',username,'display_name',display_name,'avatar_url',avatar_url,
        'created_at',created_at,'last_sign_in_at',last_sign_in_at,
        'account_status',account_status,'banned_until',banned_until,
        'active_warning_count',active_warning_count
      ) order by created_at desc,id desc),'[]'::jsonb),
      'next_cursor',case when count(*)=v_limit then (
        select jsonb_build_object('created_at',created_at,'id',id)
        from filtered order by created_at,id limit 1
      ) else null end
    ) from filtered
  ),jsonb_build_object('items','[]'::jsonb,'next_cursor',null));
end;
$$;

create or replace function public.get_admin_user_detail(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare
  v_can_read_roles boolean;
  v_result jsonb;
begin
  perform public.admin_require_capability('users.accounts.read');
  if p_user_id is null then
    raise exception using errcode='22023',message='admin_user_id_required';
  end if;
  v_can_read_roles:=public.admin_actor_has_capability('admin.roles.read');
  select jsonb_build_object(
    'id',u.id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url,
    'bio',p.bio,'created_at',u.created_at,'last_sign_in_at',u.last_sign_in_at,
    'account_status',case when u.banned_until is not null and u.banned_until>clock_timestamp()
      then 'suspended' else 'active' end,
    'banned_until',u.banned_until,
    'public_counters',jsonb_build_object(
      'followers_count',coalesce(p.followers_count,0),
      'following_count',coalesce(p.following_count,0)
    ),
    'active_admin_roles',case when v_can_read_roles then coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignment_id',r.id,'role_code',r.role_code,'granted_at',r.granted_at,'version',r.version
      ) order by r.role_code)
      from private.admin_user_roles r where r.user_id=u.id and r.revoked_at is null
    ),'[]'::jsonb) else null end,
    'discipline',jsonb_build_object(
      'active_warning_count',coalesce(active_warnings.count,0),
      'warning_limit',3,
      'cycle_started_at',cycle.cycle_started_at,
      'historical_warning_count',coalesce(warning_history.count,0),
      'warnings',coalesce(warning_history.items,'[]'::jsonb),
      'last_suspension',last_suspension.item,
      'last_restore',last_restore.item,
      'enforcement_required',coalesce(active_warnings.count,0)>=3
        and not (u.banned_until is not null and u.banned_until>clock_timestamp())
    )
  ) into v_result
  from auth.users u
  left join public.public_user_profiles p on p.id=u.id
  left join lateral (
    select max(completed_at) as cycle_started_at
    from private.admin_user_moderation_actions
    where target_user_id=u.id and action='restore' and status='succeeded'
  ) cycle on true
  left join lateral (
    select count(*)::integer as count
    from private.admin_user_warnings w
    where w.target_user_id=u.id and w.status='active'
      and (cycle.cycle_started_at is null or w.issued_at>cycle.cycle_started_at)
  ) active_warnings on true
  left join lateral (
    select count(*)::integer as count,jsonb_agg(jsonb_build_object(
      'id',w.id,'status',w.status,'warning_level_at_issue',w.warning_level_at_issue,
      'cycle_started_at',w.cycle_started_at,'reason',w.reason,'internal_note',w.internal_note,
      'evidence_type',w.evidence_type,'evidence_id',w.evidence_id,'evidence_note',w.evidence_note,
      'issued_at',w.issued_at,
      'issued_by',jsonb_build_object('id',w.issued_by,'username',ip.username,'display_name',ip.display_name,'avatar_url',ip.avatar_url),
      'revoked_at',w.revoked_at,'revocation_reason',w.revocation_reason,
      'revoked_by',case when w.revoked_by is null then null else jsonb_build_object(
        'id',w.revoked_by,'username',rp.username,'display_name',rp.display_name,'avatar_url',rp.avatar_url) end
    ) order by w.issued_at desc,w.id desc) as items
    from private.admin_user_warnings w
    left join public.public_user_profiles ip on ip.id=w.issued_by
    left join public.public_user_profiles rp on rp.id=w.revoked_by
    where w.target_user_id=u.id
  ) warning_history on true
  left join lateral (
    select jsonb_build_object('id',a.id,'status',a.status,'reason',a.reason,
      'requested_at',a.requested_at,'completed_at',a.completed_at,
      'provider_error_code',a.provider_error_code) as item
    from private.admin_user_moderation_actions a
    where a.target_user_id=u.id and a.action='suspend'
    order by a.requested_at desc,a.id desc limit 1
  ) last_suspension on true
  left join lateral (
    select jsonb_build_object('id',a.id,'status',a.status,'reason',a.reason,
      'requested_at',a.requested_at,'completed_at',a.completed_at,
      'provider_error_code',a.provider_error_code) as item
    from private.admin_user_moderation_actions a
    where a.target_user_id=u.id and a.action='restore'
    order by a.requested_at desc,a.id desc limit 1
  ) last_restore on true
  where u.id=p_user_id and u.deleted_at is null;
  if v_result is null then
    raise exception using errcode='P0002',message='admin_user_not_found';
  end if;
  return v_result;
end;
$$;

revoke all on function public.admin_issue_user_warning(uuid,text,uuid,text,text,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.admin_revoke_user_warning(uuid,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.search_admin_users(text,text,timestamptz,uuid,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.get_admin_user_detail(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_issue_user_warning(uuid,text,uuid,text,text,uuid,text)
  to authenticated;
grant execute on function public.admin_revoke_user_warning(uuid,text,uuid)
  to authenticated;
grant execute on function public.search_admin_users(text,text,timestamptz,uuid,integer)
  to authenticated;
grant execute on function public.get_admin_user_detail(uuid)
  to authenticated;

comment on table private.admin_user_warnings is
  'Canonical immutable warning history. Account suspension remains in admin_user_moderation_actions and Supabase Auth.';
comment on function public.admin_issue_user_warning(uuid,text,uuid,text,text,uuid,text) is
  'Human-admin warning command with target serialization, idempotent notification/audit, and server-side suspension decision.';
comment on function public.admin_revoke_user_warning(uuid,text,uuid) is
  'Human-admin warning revocation command. Revocation never restores an account.';

notify pgrst,'reload schema';

commit;
