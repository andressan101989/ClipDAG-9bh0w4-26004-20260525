-- SUPERUSER-A4: global admin shell backend, Users, Reports, and ordinary role reads.
-- This migration intentionally does not add roles/capabilities or provision SUPER_ADMIN.

do $a4_precheck$
begin
  if (select count(*) from private.admin_roles) <> 6
     or (select count(*) from private.admin_capabilities) <> 47
     or (select count(*) from private.admin_role_capabilities) <> 142
     or (select count(*) from private.admin_role_grant_rules) <> 7 then
    raise exception 'a4_canonical_catalog_precondition_failed';
  end if;
  if (select count(*) from private.admin_user_roles
      where role_code='SUPER_ADMIN' and revoked_at is null) <> 0 then
    raise exception 'a4_super_admin_precondition_failed';
  end if;
  if to_regclass('private.admin_user_moderation_actions') is not null then
    raise exception 'a4_user_moderation_table_already_exists';
  end if;
  if (select count(*) from private.admin_capabilities
    where capability_code in (
      'users.accounts.read','users.accounts.suspend','users.accounts.restore',
      'reports.cases.read','reports.cases.review','reports.cases.resolve',
      'admin.roles.read'
    ))<>7 then
    raise exception 'a4_required_capability_missing';
  end if;
end
$a4_precheck$;

create table private.admin_user_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on update restrict on delete restrict,
  actor_role_snapshot text[] not null,
  actor_capability text not null references private.admin_capabilities(capability_code)
    on update restrict on delete restrict,
  target_user_id uuid not null references auth.users(id) on update restrict on delete restrict,
  action text not null check(action in('suspend','restore')),
  reason text not null check(reason=btrim(reason) and char_length(reason) between 2 and 500),
  status text not null default 'pending' check(status in('pending','succeeded','failed')),
  idempotency_scope text not null check(
    idempotency_scope=btrim(idempotency_scope) and char_length(idempotency_scope) between 8 and 300
  ),
  idempotency_key uuid not null,
  request_fingerprint text not null check(request_fingerprint ~ '^[0-9a-f]{64}$'),
  auth_banned_until_before timestamptz,
  auth_banned_until_after timestamptz,
  requested_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  provider_error_code text check(
    provider_error_code is null or provider_error_code ~ '^[a-z0-9_.:-]{1,120}$'
  ),
  constraint admin_user_moderation_actor_target_check check(actor_id<>target_user_id),
  constraint admin_user_moderation_capability_check check(
    (action='suspend' and actor_capability='users.accounts.suspend')
    or (action='restore' and actor_capability='users.accounts.restore')
  ),
  constraint admin_user_moderation_state_check check(
    (status='pending' and completed_at is null and provider_error_code is null and auth_banned_until_after is null)
    or (status='succeeded' and completed_at is not null and provider_error_code is null)
    or (status='failed' and completed_at is not null and provider_error_code is not null)
  ),
  unique(idempotency_scope,idempotency_key)
);

create index admin_user_moderation_target_requested_idx
  on private.admin_user_moderation_actions(target_user_id,requested_at desc,id desc);

alter table private.admin_user_moderation_actions enable row level security;
revoke all privileges on table private.admin_user_moderation_actions
  from public,anon,authenticated,service_role;

create function private.admin_guard_user_moderation_action()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
begin
  if tg_op='DELETE' then
    raise exception using errcode='42501',message='admin_user_moderation_action_immutable';
  end if;
  if old.status<>'pending' then
    raise exception using errcode='55000',message='admin_user_moderation_action_final';
  end if;
  if new.id<>old.id or new.actor_id<>old.actor_id
     or new.actor_role_snapshot<>old.actor_role_snapshot
     or new.actor_capability<>old.actor_capability
     or new.target_user_id<>old.target_user_id
     or new.action<>old.action or new.reason<>old.reason
     or new.idempotency_scope<>old.idempotency_scope
     or new.idempotency_key<>old.idempotency_key
     or new.request_fingerprint<>old.request_fingerprint
     or new.auth_banned_until_before is distinct from old.auth_banned_until_before
     or new.requested_at<>old.requested_at then
    raise exception using errcode='42501',message='admin_user_moderation_action_fields_immutable';
  end if;
  if new.status not in('succeeded','failed') then
    raise exception using errcode='55000',message='admin_user_moderation_transition_invalid';
  end if;
  return new;
end;
$$;

create trigger admin_user_moderation_action_guard
before update or delete on private.admin_user_moderation_actions
for each row execute function private.admin_guard_user_moderation_action();

revoke all on function private.admin_guard_user_moderation_action()
  from public,anon,authenticated,service_role;

create function public.search_admin_users(
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
          then 'suspended' else 'active' end as account_status
      from auth.users u
      left join public.public_user_profiles p on p.id=u.id
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
        'account_status',account_status,'banned_until',banned_until
      ) order by created_at desc,id desc),'[]'::jsonb),
      'next_cursor',case when count(*)=v_limit then (
        select jsonb_build_object('created_at',created_at,'id',id)
        from filtered order by created_at,id limit 1
      ) else null end
    ) from filtered
  ),jsonb_build_object('items','[]'::jsonb,'next_cursor',null));
end;
$$;

create function public.get_admin_user_detail(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_can_read_roles boolean;v_result jsonb;
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
    ),'[]'::jsonb) else null end
  ) into v_result
  from auth.users u left join public.public_user_profiles p on p.id=u.id
  where u.id=p_user_id and u.deleted_at is null;
  if v_result is null then
    raise exception using errcode='P0002',message='admin_user_not_found';
  end if;
  return v_result;
end;
$$;

create function public.admin_prepare_user_moderation_action(
  p_target_user_id uuid,p_action text,p_reason text,p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare
  v_capability text;v_actor uuid;v_reason text:=nullif(btrim(p_reason),'');
  v_scope text;v_fingerprint text;v_existing private.admin_user_moderation_actions;
  v_command private.admin_user_moderation_actions;v_target auth.users;
begin
  if p_action='suspend' then v_capability:='users.accounts.suspend';
  elsif p_action='restore' then v_capability:='users.accounts.restore';
  else raise exception using errcode='22023',message='admin_user_action_invalid';
  end if;
  v_actor:=public.admin_require_capability(v_capability);
  if p_target_user_id is null or p_idempotency_key is null or v_reason is null
     or char_length(v_reason) not between 2 and 500 then
    raise exception using errcode='22023',message='admin_user_moderation_invalid';
  end if;
  if v_actor=p_target_user_id then
    raise exception using errcode='42501',message='admin_user_self_target_forbidden';
  end if;
  v_scope:='v1|human|'||v_actor::text||'|'||v_capability||'|user.'||p_action;
  v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object(
    'contract_version',1,'actor_kind','human_admin','actor_id',v_actor,
    'capability',v_capability,'action','user.'||p_action,'target_type','user',
    'target_id',p_target_user_id,'reason',v_reason));
  perform pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_idempotency_key::text,0));
  select * into v_existing from private.admin_user_moderation_actions
    where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'id',v_existing.id,'target_user_id',v_existing.target_user_id,
      'action',v_existing.action,'status',v_existing.status,
      'auth_banned_until_before',v_existing.auth_banned_until_before,
      'auth_banned_until_after',v_existing.auth_banned_until_after,
      'provider_error_code',v_existing.provider_error_code
    );
  end if;
  perform pg_advisory_xact_lock(hashtextextended('admin-user-moderation-target:'||p_target_user_id::text,0));
  select * into v_target from auth.users where id=p_target_user_id for update;
  if not found or v_target.deleted_at is not null then
    raise exception using errcode='P0002',message='admin_user_target_not_found';
  end if;
  if exists(select 1 from private.admin_user_roles
    where user_id=p_target_user_id and revoked_at is null) then
    raise exception using errcode='42501',message='admin_user_admin_target_forbidden';
  end if;
  insert into private.admin_user_moderation_actions(
    actor_id,actor_role_snapshot,actor_capability,target_user_id,action,reason,
    idempotency_scope,idempotency_key,request_fingerprint,auth_banned_until_before
  ) values(
    v_actor,private.admin_active_role_codes(v_actor),v_capability,p_target_user_id,
    p_action,v_reason,v_scope,p_idempotency_key,v_fingerprint,v_target.banned_until
  ) returning * into v_command;
  return jsonb_build_object(
    'id',v_command.id,'target_user_id',v_command.target_user_id,
    'action',v_command.action,'status',v_command.status,
    'auth_banned_until_before',v_command.auth_banned_until_before,
    'auth_banned_until_after',null,'provider_error_code',null
  );
end;
$$;

create function public.admin_finalize_user_moderation_action(
  p_action_id uuid,p_result text,p_auth_banned_until_before timestamptz,
  p_auth_banned_until_after timestamptz,p_provider_error_code text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare
  v_command private.admin_user_moderation_actions;v_error text:=nullif(lower(btrim(p_provider_error_code)),'');
  v_receipt jsonb;v_previous_sub text;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then
    raise exception using errcode='42501',message='admin_user_finalize_service_role_required';
  end if;
  if p_action_id is null or p_result not in('succeeded','failed') then
    raise exception using errcode='22023',message='admin_user_finalize_invalid';
  end if;
  if p_result='failed' and (v_error is null or v_error!~'^[a-z0-9_.:-]{1,120}$') then
    raise exception using errcode='22023',message='admin_user_provider_error_invalid';
  end if;
  if p_result='succeeded' then v_error:=null;end if;
  select * into v_command from private.admin_user_moderation_actions
    where id=p_action_id for update;
  if not found then raise exception using errcode='P0002',message='admin_user_action_not_found';end if;
  if v_command.status<>'pending' then
    if v_command.status=p_result
       and v_command.auth_banned_until_before is not distinct from p_auth_banned_until_before
       and v_command.auth_banned_until_after is not distinct from p_auth_banned_until_after
       and v_command.provider_error_code is not distinct from v_error then
      return jsonb_build_object('id',v_command.id,'status',v_command.status,
        'target_user_id',v_command.target_user_id,'action',v_command.action,
        'auth_banned_until_after',v_command.auth_banned_until_after,
        'provider_error_code',v_command.provider_error_code);
    end if;
    raise exception using errcode='23505',message='admin_user_finalize_conflict';
  end if;
  if v_command.auth_banned_until_before is distinct from p_auth_banned_until_before then
    raise exception using errcode='23505',message='admin_user_auth_state_conflict';
  end if;
  if p_result='succeeded' and v_command.action='suspend'
     and (p_auth_banned_until_after is null or p_auth_banned_until_after<=clock_timestamp()) then
    raise exception using errcode='22023',message='admin_user_suspend_result_invalid';
  end if;
  if p_result='succeeded' and v_command.action='restore'
     and p_auth_banned_until_after is not null and p_auth_banned_until_after>clock_timestamp() then
    raise exception using errcode='22023',message='admin_user_restore_result_invalid';
  end if;
  update private.admin_user_moderation_actions set
    status=p_result,auth_banned_until_after=p_auth_banned_until_after,
    completed_at=clock_timestamp(),provider_error_code=v_error
  where id=v_command.id returning * into v_command;
  v_receipt:=jsonb_build_object('id',v_command.id,'status',v_command.status,
    'target_user_id',v_command.target_user_id,'action',v_command.action,
    'auth_banned_until_after',v_command.auth_banned_until_after,
    'provider_error_code',v_command.provider_error_code);
  -- The external Auth operation was authorized by this human command. Rebind only
  -- auth.uid() for the immutable audit trigger; service_role remains the DB caller.
  v_previous_sub:=current_setting('request.jwt.claim.sub',true);
  perform set_config('request.jwt.claim.sub',v_command.actor_id::text,true);
  begin
    insert into private.admin_action_audit(
      actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,
      target_id,target_ref,reason,outcome,financial_effect,contains_pii,metadata,
      idempotency_scope,idempotency_key,request_fingerprint
    ) values(
      v_command.actor_id,'human_admin',v_command.actor_role_snapshot,v_command.actor_capability,
      'users','user.'||v_command.action,'user',v_command.target_user_id,v_command.id::text,
      v_command.reason,case when p_result='succeeded' then 'succeeded' else 'failed' end,
      false,true,jsonb_build_object('receipt',v_receipt,'moderation_action_id',v_command.id),
      v_command.idempotency_scope,v_command.idempotency_key,v_command.request_fingerprint
    );
  exception when others then
    perform set_config('request.jwt.claim.sub',coalesce(v_previous_sub,''),true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub',coalesce(v_previous_sub,''),true);
  return v_receipt;
end;
$$;

-- Reports retain only legitimate reporter self-service through RLS. Administration is RPC-only.
drop policy if exists "Admins can manage all reports" on public.reports;
drop policy if exists reports_insert_own on public.reports;
drop policy if exists reports_select_own on public.reports;
create policy reports_insert_own on public.reports
for insert to authenticated with check(reporter_user_id=auth.uid());
create policy reports_select_own on public.reports
for select to authenticated using(reporter_user_id=auth.uid());
revoke all privileges on table public.reports from public,anon,authenticated,service_role;
grant select on table public.reports to authenticated;
grant insert(reporter_user_id,reported_content_id,reported_content_type,reason,details)
  on table public.reports to authenticated;

create function public.search_admin_reports(
  p_query text default null,p_status text default null,p_content_type text default null,
  p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_query text:=nullif(btrim(p_query),'');v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('reports.cases.read');
  if p_status is not null and p_status not in('pending','reviewed','dismissed') then
    raise exception using errcode='22023',message='admin_report_status_invalid';
  end if;
  if p_content_type is not null and p_content_type not in('video','comment','user') then
    raise exception using errcode='22023',message='admin_report_content_type_invalid';
  end if;
  if v_query is not null and char_length(v_query)>120 then
    raise exception using errcode='22023',message='admin_report_query_invalid';
  end if;
  if (p_cursor_created_at is null)<>(p_cursor_id is null) then
    raise exception using errcode='22023',message='admin_report_cursor_invalid';
  end if;
  return coalesce((
    with page as (
      select r.*,p.username,p.display_name,p.avatar_url
      from public.reports r left join public.public_user_profiles p on p.id=r.reporter_user_id
      where (p_status is null or r.status=p_status)
        and (p_content_type is null or r.reported_content_type=p_content_type)
        and (v_query is null or r.id::text=v_query or r.reported_content_id::text=v_query
          or p.username ilike '%'||v_query||'%' or p.display_name ilike '%'||v_query||'%')
        and (p_cursor_created_at is null or (r.created_at,r.id)<(p_cursor_created_at,p_cursor_id))
      order by r.created_at desc,r.id desc limit v_limit
    )
    select jsonb_build_object(
      'items',coalesce(jsonb_agg(jsonb_build_object(
        'id',id,'reporter',jsonb_build_object('id',reporter_user_id,'username',username,
          'display_name',display_name,'avatar_url',avatar_url),
        'reported_content_id',reported_content_id,'reported_content_type',reported_content_type,
        'reason',reason,'status',status,'created_at',created_at
      ) order by created_at desc,id desc),'[]'::jsonb),
      'next_cursor',case when count(*)=v_limit then (
        select jsonb_build_object('created_at',created_at,'id',id)
        from page order by created_at,id limit 1
      ) else null end
    ) from page
  ),jsonb_build_object('items','[]'::jsonb,'next_cursor',null));
end;
$$;

create function public.get_admin_report_detail(p_report_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_report public.reports;v_reporter jsonb;v_subject jsonb;
begin
  perform public.admin_require_capability('reports.cases.read');
  select * into v_report from public.reports where id=p_report_id;
  if not found then raise exception using errcode='P0002',message='admin_report_not_found';end if;
  select jsonb_build_object('id',id,'username',username,'display_name',display_name,'avatar_url',avatar_url)
    into v_reporter from public.public_user_profiles where id=v_report.reporter_user_id;
  if v_report.reported_content_type='video' then
    select jsonb_build_object('type','video','id',v.id,'caption',left(coalesce(v.caption,''),500),
      'thumbnail_url',v.thumbnail_url,'created_at',v.created_at,'owner_id',v.user_id)
      into v_subject from public.videos v where v.id=v_report.reported_content_id;
  elsif v_report.reported_content_type='comment' then
    select jsonb_build_object('type','comment','id',c.id,'text',left(coalesce(c.text,''),500),
      'created_at',c.created_at,'owner_id',c.user_id,'video_id',c.video_id)
      into v_subject from public.comments c where c.id=v_report.reported_content_id;
  elsif v_report.reported_content_type='user' then
    select jsonb_build_object('type','user','id',p.id,'username',p.username,
      'display_name',p.display_name,'avatar_url',p.avatar_url)
      into v_subject from public.public_user_profiles p where p.id=v_report.reported_content_id;
  end if;
  return jsonb_build_object('id',v_report.id,'reporter',v_reporter,
    'reported_content_id',v_report.reported_content_id,
    'reported_content_type',v_report.reported_content_type,'reason',v_report.reason,
    'details',v_report.details,'status',v_report.status,'created_at',v_report.created_at,
    'subject',v_subject);
end;
$$;

create function public.admin_review_report(
  p_report_id uuid,p_note text,p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare
  v_actor uuid;v_note text:=nullif(btrim(p_note),'');v_scope text;v_fingerprint text;
  v_prior private.admin_action_audit;v_report public.reports;v_receipt jsonb;
begin
  v_actor:=public.admin_require_capability('reports.cases.review');
  if p_report_id is null or p_idempotency_key is null or v_note is null
     or char_length(v_note) not between 2 and 500 then
    raise exception using errcode='22023',message='admin_report_review_invalid';
  end if;
  v_scope:='v1|human|'||v_actor::text||'|reports.cases.review|report.review';
  v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object(
    'contract_version',1,'actor_kind','human_admin','actor_id',v_actor,
    'capability','reports.cases.review','action','report.review','target_type','report',
    'target_id',p_report_id,'reason',v_note));
  perform pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_idempotency_key::text,0));
  select * into v_prior from private.admin_action_audit
    where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';
    end if;
    return v_prior.metadata->'receipt';
  end if;
  select * into v_report from public.reports where id=p_report_id for update;
  if not found then raise exception using errcode='P0002',message='admin_report_not_found';end if;
  if v_report.status<>'pending' then
    raise exception using errcode='55000',message='admin_report_transition_invalid';
  end if;
  update public.reports set status='reviewed' where id=v_report.id returning * into v_report;
  v_receipt:=jsonb_build_object('report_id',v_report.id,'status',v_report.status);
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,
    target_id,reason,outcome,financial_effect,contains_pii,metadata,idempotency_scope,
    idempotency_key,request_fingerprint
  ) values(v_actor,'human_admin',private.admin_active_role_codes(v_actor),'reports.cases.review',
    'reports','report.review','report',v_report.id,v_note,'succeeded',false,true,
    jsonb_build_object('receipt',v_receipt),v_scope,p_idempotency_key,v_fingerprint);
  return v_receipt;
end;
$$;

create function public.admin_dismiss_report(
  p_report_id uuid,p_reason text,p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare
  v_actor uuid;v_reason text:=nullif(btrim(p_reason),'');v_scope text;v_fingerprint text;
  v_prior private.admin_action_audit;v_report public.reports;v_receipt jsonb;
begin
  v_actor:=public.admin_require_capability('reports.cases.resolve');
  if p_report_id is null or p_idempotency_key is null or v_reason is null
     or char_length(v_reason) not between 2 and 500 then
    raise exception using errcode='22023',message='admin_report_dismiss_invalid';
  end if;
  v_scope:='v1|human|'||v_actor::text||'|reports.cases.resolve|report.dismiss';
  v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object(
    'contract_version',1,'actor_kind','human_admin','actor_id',v_actor,
    'capability','reports.cases.resolve','action','report.dismiss','target_type','report',
    'target_id',p_report_id,'reason',v_reason));
  perform pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_idempotency_key::text,0));
  select * into v_prior from private.admin_action_audit
    where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';
    end if;
    return v_prior.metadata->'receipt';
  end if;
  select * into v_report from public.reports where id=p_report_id for update;
  if not found then raise exception using errcode='P0002',message='admin_report_not_found';end if;
  if v_report.status not in('pending','reviewed') then
    raise exception using errcode='55000',message='admin_report_transition_invalid';
  end if;
  update public.reports set status='dismissed' where id=v_report.id returning * into v_report;
  v_receipt:=jsonb_build_object('report_id',v_report.id,'status',v_report.status);
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,
    target_id,reason,outcome,financial_effect,contains_pii,metadata,idempotency_scope,
    idempotency_key,request_fingerprint
  ) values(v_actor,'human_admin',private.admin_active_role_codes(v_actor),'reports.cases.resolve',
    'reports','report.dismiss','report',v_report.id,v_reason,'succeeded',false,true,
    jsonb_build_object('receipt',v_receipt),v_scope,p_idempotency_key,v_fingerprint);
  return v_receipt;
end;
$$;

create function public.get_admin_role_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
begin
  perform public.admin_require_capability('admin.roles.read');
  return jsonb_build_object('roles',coalesce((
    select jsonb_agg(jsonb_build_object(
      'role_code',r.role_code,'display_name',r.display_name,'description',r.description,
      'is_assignable',r.is_assignable,'is_root',r.is_root,'is_exclusive',r.is_exclusive,
      'capability_count',(select count(*) from private.admin_role_capabilities rc
        where rc.role_code=r.role_code)
    ) order by r.is_root desc,r.role_code)
    from private.admin_roles r
  ),'[]'::jsonb));
end;
$$;

create function public.search_admin_role_assignments(
  p_query text default null,p_role_code text default null,p_active boolean default null,
  p_cursor_granted_at timestamptz default null,p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_query text:=nullif(btrim(p_query),'');v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('admin.roles.read');
  if p_role_code is not null and not exists(
    select 1 from private.admin_roles where role_code=p_role_code
  ) then raise exception using errcode='22023',message='admin_role_filter_invalid';end if;
  if v_query is not null and char_length(v_query)>120 then
    raise exception using errcode='22023',message='admin_role_query_invalid';
  end if;
  if (p_cursor_granted_at is null)<>(p_cursor_id is null) then
    raise exception using errcode='22023',message='admin_role_cursor_invalid';
  end if;
  return coalesce((
    with page as (
      select a.id,a.user_id,a.role_code,a.grant_actor_kind,a.granted_at,a.revoked_at,a.version,
        p.username,p.display_name,p.avatar_url
      from private.admin_user_roles a
      left join public.public_user_profiles p on p.id=a.user_id
      where (p_role_code is null or a.role_code=p_role_code)
        and (p_active is null or (a.revoked_at is null)=p_active)
        and (v_query is null or a.user_id::text=v_query
          or p.username ilike '%'||v_query||'%' or p.display_name ilike '%'||v_query||'%')
        and (p_cursor_granted_at is null or (a.granted_at,a.id)<(p_cursor_granted_at,p_cursor_id))
      order by a.granted_at desc,a.id desc limit v_limit
    )
    select jsonb_build_object(
      'items',coalesce(jsonb_agg(jsonb_build_object(
        'assignment_id',id,'user',jsonb_build_object('id',user_id,'username',username,
          'display_name',display_name,'avatar_url',avatar_url),
        'role_code',role_code,'grant_actor_kind',grant_actor_kind,'granted_at',granted_at,
        'revoked_at',revoked_at,'version',version
      ) order by granted_at desc,id desc),'[]'::jsonb),
      'next_cursor',case when count(*)=v_limit then (
        select jsonb_build_object('granted_at',granted_at,'id',id)
        from page order by granted_at,id limit 1
      ) else null end
    ) from page
  ),jsonb_build_object('items','[]'::jsonb,'next_cursor',null));
end;
$$;

-- Least-privilege execution contracts.
revoke all on function public.search_admin_users(text,text,timestamptz,uuid,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.get_admin_user_detail(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.admin_prepare_user_moderation_action(uuid,text,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.admin_finalize_user_moderation_action(uuid,text,timestamptz,timestamptz,text)
  from public,anon,authenticated,service_role;
revoke all on function public.search_admin_reports(text,text,text,timestamptz,uuid,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.get_admin_report_detail(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.admin_review_report(uuid,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.admin_dismiss_report(uuid,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.get_admin_role_catalog()
  from public,anon,authenticated,service_role;
revoke all on function public.search_admin_role_assignments(text,text,boolean,timestamptz,uuid,integer)
  from public,anon,authenticated,service_role;

grant execute on function public.search_admin_users(text,text,timestamptz,uuid,integer) to authenticated;
grant execute on function public.get_admin_user_detail(uuid) to authenticated;
grant execute on function public.admin_prepare_user_moderation_action(uuid,text,text,uuid) to authenticated;
grant execute on function public.admin_finalize_user_moderation_action(uuid,text,timestamptz,timestamptz,text) to service_role;
grant execute on function public.search_admin_reports(text,text,text,timestamptz,uuid,integer) to authenticated;
grant execute on function public.get_admin_report_detail(uuid) to authenticated;
grant execute on function public.admin_review_report(uuid,text,uuid) to authenticated;
grant execute on function public.admin_dismiss_report(uuid,text,uuid) to authenticated;
grant execute on function public.get_admin_role_catalog() to authenticated;
grant execute on function public.search_admin_role_assignments(text,text,boolean,timestamptz,uuid,integer) to authenticated;

comment on table private.admin_user_moderation_actions is
  'Canonical idempotent command/receipt state for admin-triggered Supabase Auth suspension and restoration.';
comment on function public.admin_prepare_user_moderation_action(uuid,text,text,uuid) is
  'Human-authorized prepare step; does not modify auth.users.';
comment on function public.admin_finalize_user_moderation_action(uuid,text,timestamptz,timestamptz,text) is
  'service_role-only completion of a previously authorized moderation command.';

do $a4_postcheck$
begin
  if (select count(*) from private.admin_roles)<>6
     or (select count(*) from private.admin_capabilities)<>47
     or (select count(*) from private.admin_role_capabilities)<>142
     or (select count(*) from private.admin_role_grant_rules)<>7 then
    raise exception 'a4_catalog_changed';
  end if;
  if exists(select 1 from private.admin_user_roles
    where role_code='SUPER_ADMIN' and revoked_at is null) then
    raise exception 'a4_super_admin_created';
  end if;
  if exists(select 1 from private.admin_user_moderation_actions) then
    raise exception 'a4_moderation_action_created_by_migration';
  end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename='reports'
    and coalesce(qual,'') ilike '%is_admin%') then
    raise exception 'a4_reports_legacy_admin_policy_remaining';
  end if;
end
$a4_postcheck$;
