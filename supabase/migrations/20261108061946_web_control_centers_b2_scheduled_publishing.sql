begin;

-- Private policy is data rather than client-supplied authority.
create table private.publication_schedule_policy (
  singleton boolean primary key default true check (singleton),
  min_lead interval not null default interval '2 minutes' check (min_lead > interval '0'),
  max_horizon interval not null default interval '365 days' check (max_horizon >= min_lead),
  claim_batch integer not null default 10 check (claim_batch between 1 and 10),
  lease interval not null default interval '2 minutes',
  max_attempts integer not null default 5 check (max_attempts between 1 and 5),
  backoff interval not null default interval '30 seconds',
  backoff_cap interval not null default interval '15 minutes'
);
insert into private.publication_schedule_policy default values;

create table private.publication_schedules (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  draft_id uuid not null references private.publication_drafts(id),
  draft_revision bigint not null check (draft_revision > 0),
  publish_command_id uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  state text not null default 'scheduled' check (state in ('scheduled','claimed','materializing','publishing','published','retryable_failed','terminal_failed','cancelled')),
  revision bigint not null default 1 check (revision > 0),
  generation bigint not null default 1 check (generation > 0),
  scheduled_for timestamptz not null,
  timezone_name text not null,
  local_scheduled_at timestamp not null,
  utc_offset_minutes integer,
  attempt_count integer not null default 0 check (attempt_count >= 0 and attempt_count <= max_attempts),
  max_attempts integer not null check (max_attempts between 1 and 5),
  next_attempt_at timestamptz not null,
  claim_token uuid,
  claim_expires_at timestamptz,
  retryable boolean not null default false,
  last_error_code text check (last_error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  post_id uuid,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(owner_id, publish_command_id)
);
create unique index publication_schedules_active_draft_idx on private.publication_schedules(draft_id)
  where state in ('scheduled','claimed','materializing','publishing','retryable_failed');
create index publication_schedules_due_idx on private.publication_schedules(next_attempt_at,id)
  where state in ('scheduled','retryable_failed');
create index publication_schedules_owner_idx on private.publication_schedules(owner_id,created_at desc,id desc);

create table private.publication_schedule_commands (
  owner_id uuid not null references auth.users(id),
  command_id uuid not null,
  schedule_id uuid not null references private.publication_schedules(id),
  operation text not null check (operation in ('schedule','reschedule','cancel','retry')),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (pg_catalog.jsonb_typeof(result)='object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(owner_id,command_id)
);
create table private.publication_schedule_attempts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  schedule_id uuid not null references private.publication_schedules(id),
  generation bigint not null check (generation > 0),
  claim_token uuid not null,
  event text not null,
  error_code text check (error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);
create table private.publication_schedule_materializations (
  schedule_id uuid not null references private.publication_schedules(id),
  generation bigint not null check (generation > 0),
  position integer not null check (position between 0 and 9),
  source_asset_id uuid not null references public.media_assets(id),
  target_asset_id uuid not null references public.media_assets(id),
  finalized_at timestamptz,
  primary key(schedule_id,generation,position),
  unique(target_asset_id)
);

alter table private.publication_schedule_policy enable row level security;
alter table private.publication_schedule_policy force row level security;
alter table private.publication_schedules enable row level security;
alter table private.publication_schedules force row level security;
alter table private.publication_schedule_commands enable row level security;
alter table private.publication_schedule_commands force row level security;
alter table private.publication_schedule_attempts enable row level security;
alter table private.publication_schedule_attempts force row level security;
alter table private.publication_schedule_materializations enable row level security;
alter table private.publication_schedule_materializations force row level security;
revoke all on private.publication_schedule_policy, private.publication_schedules,
  private.publication_schedule_commands, private.publication_schedule_attempts,
  private.publication_schedule_materializations from public, anon, authenticated, service_role;

-- Resolve only candidates that round-trip through the named IANA timezone.
create function private.resolve_publication_schedule_time_v1(
  p_local timestamp, p_zone text, p_offset integer
) returns timestamptz language plpgsql stable set search_path = '' as $function$
declare v_count integer; v_instant timestamptz;
begin
  if p_local is null or not pg_catalog.isfinite(p_local) or p_zone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names where name=p_zone
  ) or (p_offset is not null and p_offset not between -840 and 840) then
    raise exception using errcode='22023', message='publication_schedule_time_invalid';
  end if;
  select pg_catalog.count(*), pg_catalog.min(candidate.instant)
  into v_count, v_instant
  from (
    select (p_local - pg_catalog.make_interval(mins => offsets.minutes)) at time zone 'UTC' as instant
    from pg_catalog.generate_series(-840,840) offsets(minutes)
    where p_offset is null or offsets.minutes=p_offset
  ) candidate
  where candidate.instant at time zone p_zone = p_local;
  if v_count <> 1 then
    raise exception using errcode='22023', message='publication_schedule_time_invalid_or_ambiguous';
  end if;
  return v_instant;
end;
$function$;
revoke all on function private.resolve_publication_schedule_time_v1(timestamp,text,integer)
  from public, anon, authenticated, service_role;

-- Audit records are append-only even for privileged operational callers.
create function private.guard_publication_schedule_audit_v1()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  raise exception using errcode='55000', message='publication_schedule_audit_immutable';
end;
$function$;
create trigger publication_schedule_commands_immutable before update or delete
  on private.publication_schedule_commands for each row
  execute function private.guard_publication_schedule_audit_v1();
create trigger publication_schedule_attempts_immutable before update or delete
  on private.publication_schedule_attempts for each row
  execute function private.guard_publication_schedule_audit_v1();

-- Explicit allowlist: no owner identity, command, fingerprint, source locator,
-- lease expiry or claim token can escape through owner results or audit receipts.
create function private.publication_schedule_json_v1(p_schedule private.publication_schedules)
returns jsonb language sql stable security invoker set search_path = '' as $function$
  select pg_catalog.jsonb_build_object(
    'id',p_schedule.id,'draft_id',p_schedule.draft_id,'draft_revision',p_schedule.draft_revision,
    'state',p_schedule.state,'revision',p_schedule.revision,'generation',p_schedule.generation,
    'scheduled_for',pg_catalog.to_char(p_schedule.scheduled_for at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'timezone_name',p_schedule.timezone_name,
    'local_scheduled_at',pg_catalog.to_char(p_schedule.local_scheduled_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),
    'utc_offset_minutes',p_schedule.utc_offset_minutes,
    'attempt_count',p_schedule.attempt_count,'max_attempts',p_schedule.max_attempts,
    'next_attempt_at',pg_catalog.to_char(p_schedule.next_attempt_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'retryable',p_schedule.retryable,'last_error_code',p_schedule.last_error_code,'post_id',p_schedule.post_id,
    'created_at',pg_catalog.to_char(p_schedule.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'updated_at',pg_catalog.to_char(p_schedule.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )
$function$;

-- Owner writes acquire the per-draft gate before schedule, command, draft and
-- sorted asset locks. The gate also serializes creation when no schedule row
-- exists yet, and is shared by B1 edit/delete/manual and scheduled publication.
create function private.execute_publication_schedule_command_v1(
  p_operation text, p_target_id uuid, p_expected_revision bigint,
  p_client_command_id uuid, p_local_scheduled_at timestamp,
  p_timezone_name text, p_utc_offset_minutes integer
) returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare
  v_actor uuid := auth.uid();
  v_schedule private.publication_schedules;
  v_draft private.publication_drafts;
  v_command private.publication_schedule_commands;
  v_policy private.publication_schedule_policy;
  v_fingerprint text;
  v_instant timestamptz;
  v_now timestamptz;
  v_assets uuid[];
  v_result jsonb;
  v_gate_draft uuid;
begin
  if v_actor is null then
    raise exception using errcode='42501', message='publication_auth_required';
  end if;
  if p_operation is null or p_operation not in ('schedule','reschedule','cancel','retry')
     or p_target_id is null or p_client_command_id is null
     or p_expected_revision is null or p_expected_revision < 1 then
    raise exception using errcode='22023', message='publication_schedule_input_invalid';
  end if;
  if p_operation='schedule' then v_gate_draft:=p_target_id;
  else select draft_id into v_gate_draft from private.publication_schedules where id=p_target_id and owner_id=v_actor; end if;
  perform private.lock_publication_draft_v1(v_gate_draft);
  v_fingerprint := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('operation',p_operation,'target_id',p_target_id,
      'expected_revision',p_expected_revision,
      'local_scheduled_at',pg_catalog.to_char(p_local_scheduled_at,'YYYY-MM-DD"T"HH24:MI:SS.US'),
      'timezone_name',p_timezone_name,'utc_offset_minutes',p_utc_offset_minutes)::text,
    'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'publication-schedule-command:'||v_actor::text||':'||p_client_command_id::text,0));
  select command.* into v_command from private.publication_schedule_commands command
    where command.owner_id=v_actor and command.command_id=p_client_command_id;
  if found then
    if v_command.operation<>p_operation or v_command.fingerprint<>v_fingerprint then
      raise exception using errcode='23505', message='publication_schedule_command_conflict';
    end if;
    return v_command.result;
  end if;

  if p_operation <> 'schedule' then
    select schedule.* into v_schedule from private.publication_schedules schedule
      where schedule.id=p_target_id and schedule.owner_id=v_actor for update;
    if not found then
      raise exception using errcode='42501', message='publication_schedule_not_found';
    end if;
    if v_schedule.revision<>p_expected_revision
       or v_schedule.state in ('published','cancelled')
       or (v_schedule.state='terminal_failed' and p_operation<>'cancel') then
      raise exception using errcode='40001', message='publication_schedule_conflict';
    end if;
  end if;
  select draft.* into v_draft from private.publication_drafts draft
    where draft.id=case when p_operation='schedule' then p_target_id else v_schedule.draft_id end
      and draft.owner_id=v_actor for update;
  if not found then
    raise exception using errcode='42501', message='publication_draft_not_found';
  end if;
  -- Cancellation remains possible after edits/deletion/source loss. It needs
  -- no ready media, but cannot cancel a draft whose publication already won.
  if p_operation='cancel' then
    if v_draft.state='published' then
      raise exception using errcode='40001', message='publication_schedule_conflict';
    end if;
  else
    if v_draft.state<>'draft' or v_draft.revision<>
      (case when p_operation='schedule' then p_expected_revision else v_schedule.draft_revision end) then
      raise exception using errcode='40001', message='publication_draft_conflict';
    end if;
    if p_operation='schedule' and exists(select 1 from private.publication_schedules schedule
      where schedule.draft_id=v_draft.id and schedule.state in
        ('scheduled','claimed','materializing','publishing','retryable_failed')) then
      raise exception using errcode='23505', message='publication_schedule_exists';
    end if;
    select pg_catalog.array_agg(link.asset_id order by link.position) into v_assets
      from public.media_asset_links link where link.entity_type='publication_draft'
        and link.entity_id=v_draft.id and link.slot='media';
    perform private.require_publication_asset_set_v1(v_actor,v_draft.kind,v_assets,'private');
  end if;

  select policy.* into strict v_policy from private.publication_schedule_policy policy where policy.singleton;
  v_now := pg_catalog.clock_timestamp();
  if p_operation in ('schedule','reschedule') then
    v_instant := private.resolve_publication_schedule_time_v1(
      p_local_scheduled_at,p_timezone_name,p_utc_offset_minutes);
    -- Calendar interval arithmetic must use UTC, never the caller's session zone.
    if v_instant < (((v_now at time zone 'UTC')+v_policy.min_lead) at time zone 'UTC')
       or v_instant > (((v_now at time zone 'UTC')+v_policy.max_horizon) at time zone 'UTC') then
      raise exception using errcode='22023', message='publication_schedule_time_bounds';
    end if;
  end if;
  if p_operation='retry' and (v_schedule.state<>'retryable_failed'
    or not v_schedule.retryable or v_schedule.attempt_count>=v_schedule.max_attempts) then
    raise exception using errcode='55000', message='publication_schedule_retry_forbidden';
  end if;
  if p_operation='reschedule' and (v_schedule.attempt_count>=v_schedule.max_attempts
    or (v_schedule.state='retryable_failed' and not v_schedule.retryable)) then
    raise exception using errcode='55000', message='publication_schedule_retry_forbidden';
  end if;

  if p_operation='schedule' then
    insert into private.publication_schedules(owner_id,draft_id,draft_revision,publish_command_id,
      request_fingerprint,scheduled_for,timezone_name,local_scheduled_at,utc_offset_minutes,max_attempts,next_attempt_at)
    values(v_actor,v_draft.id,v_draft.revision,pg_catalog.gen_random_uuid(),v_fingerprint,v_instant,
      p_timezone_name,p_local_scheduled_at,p_utc_offset_minutes,v_policy.max_attempts,v_instant)
    returning * into v_schedule;
  else
    update private.publication_schedules schedule set
      state=case when p_operation='cancel' then 'cancelled' else 'scheduled' end,
      -- Retry reuses the frozen target set; the next claim's token fences attempts.
      revision=schedule.revision+1,
      generation=case when p_operation='retry' then schedule.generation else schedule.generation+1 end,
      scheduled_for=case when p_operation='reschedule' then v_instant else schedule.scheduled_for end,
      timezone_name=case when p_operation='reschedule' then p_timezone_name else schedule.timezone_name end,
      local_scheduled_at=case when p_operation='reschedule' then p_local_scheduled_at else schedule.local_scheduled_at end,
      utc_offset_minutes=case when p_operation='reschedule' then p_utc_offset_minutes else schedule.utc_offset_minutes end,
      next_attempt_at=case when p_operation='reschedule' then v_instant
        when p_operation='retry' then greatest(v_now,schedule.scheduled_for) else schedule.next_attempt_at end,
      claim_token=null,claim_expires_at=null,retryable=false,last_error_code=null,updated_at=v_now
      where schedule.id=v_schedule.id returning schedule.* into v_schedule;
  end if;
  v_result := private.publication_schedule_json_v1(v_schedule);
  insert into private.publication_schedule_commands(owner_id,command_id,schedule_id,operation,fingerprint,result)
    values(v_actor,p_client_command_id,v_schedule.id,p_operation,v_fingerprint,v_result);
  return v_result;
end;
$function$;

create function public.schedule_my_publication_draft_v1(
  p_draft_id uuid, p_expected_revision bigint, p_client_command_id uuid,
  p_local_scheduled_at timestamp, p_timezone_name text, p_utc_offset_minutes integer default null
) returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  if auth.uid() is null then raise exception using errcode='42501', message='publication_auth_required'; end if;
  return private.execute_publication_schedule_command_v1('schedule',p_draft_id,p_expected_revision,
    p_client_command_id,p_local_scheduled_at,p_timezone_name,p_utc_offset_minutes);
end;
$function$;

create function public.reschedule_my_publication_v1(
  p_schedule_id uuid, p_expected_revision bigint, p_client_command_id uuid,
  p_local_scheduled_at timestamp, p_timezone_name text, p_utc_offset_minutes integer default null
) returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  if auth.uid() is null then raise exception using errcode='42501', message='publication_auth_required'; end if;
  return private.execute_publication_schedule_command_v1('reschedule',p_schedule_id,p_expected_revision,
    p_client_command_id,p_local_scheduled_at,p_timezone_name,p_utc_offset_minutes);
end;
$function$;

create function public.cancel_my_publication_schedule_v1(
  p_schedule_id uuid, p_expected_revision bigint, p_client_command_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  if auth.uid() is null then raise exception using errcode='42501', message='publication_auth_required'; end if;
  return private.execute_publication_schedule_command_v1('cancel',p_schedule_id,p_expected_revision,
    p_client_command_id,null,null,null);
end;
$function$;

create function public.retry_my_publication_schedule_v1(
  p_schedule_id uuid, p_expected_revision bigint, p_client_command_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  if auth.uid() is null then raise exception using errcode='42501', message='publication_auth_required'; end if;
  return private.execute_publication_schedule_command_v1('retry',p_schedule_id,p_expected_revision,
    p_client_command_id,null,null,null);
end;
$function$;

create function public.list_my_publication_schedules_v1(
  p_limit integer default 20, p_before_created_at timestamptz default null, p_before_id uuid default null
) returns setof jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception using errcode='42501', message='publication_auth_required'; end if;
  if (p_before_created_at is null) <> (p_before_id is null)
    or (p_before_created_at is not null and not pg_catalog.isfinite(p_before_created_at)) then
    raise exception using errcode='22023', message='publication_schedule_cursor_invalid';
  end if;
  return query select private.publication_schedule_json_v1(schedule)
    from private.publication_schedules schedule where schedule.owner_id=v_actor
      and (p_before_created_at is null or (schedule.created_at,schedule.id)<(p_before_created_at,p_before_id))
    order by schedule.created_at desc,schedule.id desc
    limit greatest(1,least(coalesce(p_limit,20),50));
end;
$function$;

revoke all on function private.guard_publication_schedule_audit_v1(),
  private.publication_schedule_json_v1(private.publication_schedules),
  private.execute_publication_schedule_command_v1(text,uuid,bigint,uuid,timestamp,text,integer)
  from public, anon, authenticated, service_role;
revoke all on function public.schedule_my_publication_draft_v1(uuid,bigint,uuid,timestamp,text,integer),
  public.reschedule_my_publication_v1(uuid,bigint,uuid,timestamp,text,integer),
  public.cancel_my_publication_schedule_v1(uuid,bigint,uuid),
  public.retry_my_publication_schedule_v1(uuid,bigint,uuid),
  public.list_my_publication_schedules_v1(integer,timestamptz,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.schedule_my_publication_draft_v1(uuid,bigint,uuid,timestamp,text,integer),
  public.reschedule_my_publication_v1(uuid,bigint,uuid,timestamp,text,integer),
  public.cancel_my_publication_schedule_v1(uuid,bigint,uuid),
  public.retry_my_publication_schedule_v1(uuid,bigint,uuid),
  public.list_my_publication_schedules_v1(integer,timestamptz,uuid) to authenticated;



-- One gate closes the absent-schedule-row race. All draft writers acquire it
-- before schedule -> command/receipt -> draft -> sorted asset row locks.
create function private.lock_publication_draft_v1(p_draft_id uuid)
returns void language plpgsql security invoker set search_path='' as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('publication-draft-gate:'||p_draft_id::text,0));
  perform schedule.id from private.publication_schedules schedule
    where schedule.draft_id=p_draft_id and schedule.state in ('scheduled','claimed','materializing','publishing','retryable_failed')
    order by schedule.id for update;
end;
$function$;
revoke all on function private.lock_publication_draft_v1(uuid) from public,anon,authenticated,service_role;

-- Explicit-actor insertion authority shared by old public wrappers and B1/B2.
-- The photo branch deliberately omits media_urls, exactly as before.
create function private.create_media_post_as_actor_v1(p_actor uuid,p_kind text,p_caption text,p_music text,p_asset_ids uuid[])
returns uuid language plpgsql security invoker set search_path='' as $function$
declare v_post_id uuid; v_count integer:=coalesce(pg_catalog.array_length(p_asset_ids,1),0); v_urls text[];
begin
  if p_actor is null then raise exception using errcode='42501',message='not_authenticated'; end if;
  if p_kind='carousel' then
    if v_count not between 2 and 10 then raise exception using errcode='22023',message='invalid_media_count'; end if;
    if (select pg_catalog.count(distinct id) from pg_catalog.unnest(p_asset_ids) id)<>v_count then
      raise exception using errcode='22023',message='duplicate_asset'; end if;
  end if;
  perform asset.id from public.media_assets asset where asset.id=any(p_asset_ids) order by asset.id for update;
  select pg_catalog.array_agg(asset.public_url order by ids.ordinality) into v_urls
    from pg_catalog.unnest(p_asset_ids) with ordinality ids(id,ordinality)
    join public.media_assets asset on asset.id=ids.id
    where asset.owner_id=p_actor and asset.status='ready' and asset.visibility='public'
      and asset.purpose=case when p_kind='photo' then 'post_image' else 'carousel_image' end and asset.public_url is not null;
  if (p_kind='photo' and v_urls[1] is null) or (p_kind='carousel' and coalesce(pg_catalog.array_length(v_urls,1),0)<>v_count) then
    raise exception using errcode='42501',message='asset_not_ready_or_owned'; end if;
  if p_kind='photo' then
    insert into public.videos(user_id,video_url,thumbnail_url,caption,music)
      values(p_actor,v_urls[1],v_urls[1],coalesce(p_caption,''),coalesce(nullif(pg_catalog.btrim(p_music),''),'Sin musica')) returning id into v_post_id;
  else
    insert into public.videos(user_id,video_url,thumbnail_url,caption,music,media_urls)
      values(p_actor,v_urls[1],v_urls[1],coalesce(p_caption,''),coalesce(nullif(pg_catalog.btrim(p_music),''),'Sin musica'),v_urls) returning id into v_post_id;
  end if;
  insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
    select p_asset_ids[i],'video_post',v_post_id,'media',i-1 from pg_catalog.generate_subscripts(p_asset_ids,1) i;
  return v_post_id;
end;
$function$;
revoke all on function private.create_media_post_as_actor_v1(uuid,text,text,text,uuid[]) from public,anon,authenticated,service_role;
create or replace function public.create_photo_post_with_media(p_caption text,p_music text,p_asset_id uuid)
returns uuid language plpgsql security definer set search_path=public as $function$
begin return private.create_media_post_as_actor_v1(auth.uid(),'photo',p_caption,p_music,array[p_asset_id]); end;
$function$;
create or replace function public.create_carousel_post(p_caption text,p_music text,p_asset_ids uuid[])
returns uuid language plpgsql security definer set search_path=public as $function$
begin return private.create_media_post_as_actor_v1(auth.uid(),'carousel',p_caption,p_music,p_asset_ids); end;
$function$;

create or replace function public.update_my_publication_draft_v1(
  p_draft_id uuid,
  p_expected_revision bigint,
  p_client_mutation_id uuid,
  p_kind text,
  p_caption text,
  p_music text,
  p_composition jsonb,
  p_asset_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_caption text := pg_catalog.btrim(coalesce(p_caption,''));
  v_music text := coalesce(nullif(pg_catalog.btrim(coalesce(p_music,'')),''),'Sin musica');
  v_composition jsonb := coalesce(p_composition,'{}'::jsonb);
  v_fingerprint text;
  v_command private.publication_draft_commands;
  v_draft private.publication_drafts;
  v_updated private.publication_drafts;
  v_result jsonb;
  v_old_assets uuid[];
  v_asset_id uuid;
  v_position integer;
begin
  if v_actor is null then raise exception using errcode='42501',message='publication_auth_required'; end if;
  if p_draft_id is null or p_expected_revision is null or p_expected_revision < 1
     or p_client_mutation_id is null or p_kind not in ('photo','carousel')
     or pg_catalog.char_length(v_caption)>300 or pg_catalog.char_length(v_music)>300 then
    raise exception using errcode='22023',message='publication_draft_invalid';
  end if;
  if not private.publication_draft_composition_safe_v1(v_composition) then
    raise exception using errcode='22023',message='draft_composition_unsafe';
  end if;
  perform private.lock_publication_draft_v1(p_draft_id);
  v_fingerprint:=private.publication_draft_payload_fingerprint_v1(
    'update',p_kind,v_caption,v_music,v_composition,p_asset_ids,p_expected_revision,p_draft_id
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'publication-draft-mutation:'||v_actor::text||':'||p_client_mutation_id::text,0
  ));
  select command.* into v_command from private.publication_draft_commands command
  where command.owner_id=v_actor and command.client_mutation_id=p_client_mutation_id;
  if found then
    if v_command.operation<>'update' or v_command.draft_id<>p_draft_id
       or v_command.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='draft_mutation_conflict';
    end if;
    return v_command.result_payload;
  end if;

  select draft.* into v_draft from private.publication_drafts draft
  where draft.id=p_draft_id and draft.owner_id=v_actor for update;
  if not found then raise exception using errcode='P0002',message='publication_draft_not_found'; end if;
  if v_draft.state<>'draft' or v_draft.revision<>p_expected_revision then
    raise exception using errcode='40001',message='publication_draft_revision_conflict';
  end if;
  perform asset.id from public.media_assets asset where asset.id in
    (select link.asset_id from public.media_asset_links link where link.entity_type='publication_draft' and link.entity_id=p_draft_id) or asset.id=any(p_asset_ids)
    order by asset.id for update;
  perform private.require_publication_asset_set_v1(v_actor,p_kind,p_asset_ids,'private');
  select pg_catalog.array_agg(link.asset_id order by link.position) into v_old_assets
  from public.media_asset_links link
  where link.entity_type='publication_draft' and link.entity_id=p_draft_id;
  delete from public.media_asset_links link
  where link.entity_type='publication_draft' and link.entity_id=p_draft_id;
  update private.publication_drafts draft
  set kind=p_kind,caption=v_caption,music=v_music,composition=v_composition,
      revision=draft.revision+1,updated_at=pg_catalog.clock_timestamp()
  where draft.id=p_draft_id and draft.revision=p_expected_revision
  returning * into v_updated;
  if not found then raise exception using errcode='40001',message='publication_draft_revision_conflict'; end if;
  for v_position in 1..pg_catalog.cardinality(p_asset_ids) loop
    insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
    values(p_asset_ids[v_position],'publication_draft',p_draft_id,'media',v_position-1);
  end loop;
  v_result:=private.publication_draft_json_v1(v_updated);
  insert into private.publication_draft_commands(
    owner_id,client_mutation_id,draft_id,operation,request_fingerprint,
    result_revision,result_state,result_payload
  ) values (v_actor,p_client_mutation_id,p_draft_id,'update',v_fingerprint,
    v_updated.revision,'draft',v_result);
  foreach v_asset_id in array coalesce(v_old_assets,'{}'::uuid[]) loop
    if not (v_asset_id=any(p_asset_ids)) then
      perform public.schedule_media_asset_deletion(v_asset_id,v_actor);
    end if;
  end loop;
  return v_result;
end;
$function$;


create or replace function public.delete_my_publication_draft_v1(
  p_draft_id uuid,
  p_expected_revision bigint,
  p_client_mutation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid:=auth.uid();
  v_fingerprint text;
  v_command private.publication_draft_commands;
  v_draft private.publication_drafts;
  v_deleted private.publication_drafts;
  v_result jsonb;
  v_old_assets uuid[];
  v_asset_id uuid;
begin
  if v_actor is null then raise exception using errcode='42501',message='publication_auth_required'; end if;
  if p_draft_id is null or p_expected_revision is null or p_expected_revision<1
     or p_client_mutation_id is null then
    raise exception using errcode='22023',message='publication_draft_invalid';
  end if;
  perform private.lock_publication_draft_v1(p_draft_id);
  v_fingerprint:=private.publication_draft_payload_fingerprint_v1(
    'delete','photo','', '','{}'::jsonb,'{}'::uuid[],p_expected_revision,p_draft_id
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'publication-draft-mutation:'||v_actor::text||':'||p_client_mutation_id::text,0
  ));
  select command.* into v_command from private.publication_draft_commands command
  where command.owner_id=v_actor and command.client_mutation_id=p_client_mutation_id;
  if found then
    if v_command.operation<>'delete' or v_command.draft_id<>p_draft_id
       or v_command.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='draft_mutation_conflict';
    end if;
    return v_command.result_payload;
  end if;
  select draft.* into v_draft from private.publication_drafts draft
  where draft.id=p_draft_id and draft.owner_id=v_actor for update;
  if not found then raise exception using errcode='P0002',message='publication_draft_not_found'; end if;
  if v_draft.state<>'draft' or v_draft.revision<>p_expected_revision then
    raise exception using errcode='40001',message='publication_draft_revision_conflict';
  end if;
  perform asset.id from public.media_assets asset where asset.id in
    (select link.asset_id from public.media_asset_links link where link.entity_type='publication_draft' and link.entity_id=p_draft_id)
    order by asset.id for update;
  select pg_catalog.array_agg(link.asset_id order by link.position) into v_old_assets
  from public.media_asset_links link
  where link.entity_type='publication_draft' and link.entity_id=p_draft_id;
  delete from public.media_asset_links link
  where link.entity_type='publication_draft' and link.entity_id=p_draft_id;
  update private.publication_drafts draft
  set state='deleted',revision=draft.revision+1,deleted_at=pg_catalog.clock_timestamp(),
      updated_at=pg_catalog.clock_timestamp()
  where draft.id=p_draft_id and draft.revision=p_expected_revision
  returning * into v_deleted;
  if not found then raise exception using errcode='40001',message='publication_draft_revision_conflict'; end if;
  v_result:=private.publication_draft_json_v1(v_deleted);
  insert into private.publication_draft_commands(
    owner_id,client_mutation_id,draft_id,operation,request_fingerprint,
    result_revision,result_state,result_payload
  ) values (v_actor,p_client_mutation_id,p_draft_id,'delete',v_fingerprint,
    v_deleted.revision,'deleted',v_result);
  foreach v_asset_id in array coalesce(v_old_assets,'{}'::uuid[]) loop
    perform public.schedule_media_asset_deletion(v_asset_id,v_actor);
  end loop;
  return v_result;
end;
$function$;


create function private.publish_publication_draft_as_actor_v1(
  p_actor uuid,
  p_draft_id uuid,
  p_expected_revision bigint,
  p_client_command_id uuid,
  p_public_asset_ids uuid[]
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_actor uuid:=p_actor;
  v_existing private.publication_receipts;
  v_draft private.publication_drafts;
  v_request_fingerprint text;
  v_linked_assets uuid[];
  v_private_assets uuid[];
  v_asset_id uuid;
  v_post_id uuid;
begin
  if v_actor is null then raise exception using errcode='42501',message='publication_auth_required'; end if;
  if p_draft_id is null or p_expected_revision is null or p_expected_revision<1
     or p_client_command_id is null then
    raise exception using errcode='22023',message='publication_request_invalid';
  end if;
  perform private.lock_publication_draft_v1(p_draft_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'publication-command:'||v_actor::text||':'||p_client_command_id::text,0
  ));
  select receipt.* into v_existing from private.publication_receipts receipt
  where receipt.owner_id=v_actor and receipt.client_command_id=p_client_command_id for update;
  if found then
    if v_existing.operation is distinct from 'draft'
       or v_existing.draft_id is distinct from p_draft_id
       or v_existing.draft_revision is distinct from p_expected_revision
       or v_existing.ordered_asset_ids is distinct from p_public_asset_ids then
      raise exception using errcode='23505',message='publication_receipt_conflict';
    end if;
    select pg_catalog.array_agg(link.asset_id order by link.position) into v_linked_assets
    from public.videos post
    join public.media_asset_links link on link.entity_type='video_post'
      and link.entity_id=post.id and link.slot='media'
    where post.id=v_existing.post_id and post.user_id=v_actor;
    if v_linked_assets is distinct from v_existing.ordered_asset_ids then
      raise exception using errcode='P0002',message='publication_receipt_target_missing';
    end if;
    return v_existing.post_id;
  end if;
  select draft.* into v_draft from private.publication_drafts draft
  where draft.id=p_draft_id and draft.owner_id=v_actor for update;
  if not found then raise exception using errcode='P0002',message='publication_draft_not_found'; end if;
  if v_draft.state<>'draft' or v_draft.revision<>p_expected_revision then
    raise exception using errcode='40001',message='publication_draft_revision_conflict';
  end if;
  perform asset.id from public.media_assets asset where asset.id=any(p_public_asset_ids) or asset.id in
    (select link.asset_id from public.media_asset_links link where link.entity_type='publication_draft' and link.entity_id=p_draft_id)
    order by asset.id for update;
  perform private.require_publication_asset_set_v1(v_actor,v_draft.kind,p_public_asset_ids,'public');
  if (
    select pg_catalog.count(*)
    from public.media_assets asset
    where asset.id = any(p_public_asset_ids)
      and asset.visibility = 'public'
      and asset.status = 'ready'
  ) <> pg_catalog.cardinality(p_public_asset_ids) then
    raise exception using errcode='42501',message='publication_asset_not_ready_or_owned';
  end if;
  v_request_fingerprint:=private.publication_draft_payload_fingerprint_v1(
    'publish',v_draft.kind,v_draft.caption,v_draft.music,v_draft.composition,
    p_public_asset_ids,p_expected_revision,p_draft_id
  );
  if v_draft.kind='photo' then
    v_post_id:=private.create_media_post_as_actor_v1(v_actor,'photo',v_draft.caption,v_draft.music,array[p_public_asset_ids[1]]);
  else
    v_post_id:=private.create_media_post_as_actor_v1(v_actor,'carousel',v_draft.caption,v_draft.music,p_public_asset_ids);
  end if;
  insert into private.publication_receipts(
    owner_id,client_command_id,operation,kind,draft_id,draft_revision,
    ordered_asset_ids,request_fingerprint,post_id
  ) values (
    v_actor,p_client_command_id,'draft',v_draft.kind,p_draft_id,p_expected_revision,
    p_public_asset_ids,v_request_fingerprint,v_post_id
  );
  select pg_catalog.array_agg(link.asset_id order by link.position) into v_private_assets
  from public.media_asset_links link
  where link.entity_type='publication_draft' and link.entity_id=p_draft_id;
  delete from public.media_asset_links link
  where link.entity_type='publication_draft' and link.entity_id=p_draft_id;
  update private.publication_drafts draft
  set state='published',published_post_id=v_post_id,published_at=pg_catalog.clock_timestamp(),
      revision=draft.revision+1,updated_at=pg_catalog.clock_timestamp()
  where draft.id=p_draft_id and draft.revision=p_expected_revision;
  if not found then raise exception using errcode='40001',message='publication_draft_revision_conflict'; end if;
  foreach v_asset_id in array coalesce(v_private_assets,'{}'::uuid[]) loop
    perform public.schedule_media_asset_deletion(v_asset_id,v_actor);
  end loop;
  return v_post_id;
end;
$function$;

revoke all on function private.publish_publication_draft_as_actor_v1(uuid,uuid,bigint,uuid,uuid[]) from public,anon,authenticated,service_role;
create or replace function public.publish_my_publication_draft_v1(p_draft_id uuid,p_expected_revision bigint,p_client_command_id uuid,p_public_asset_ids uuid[])
returns uuid language plpgsql security definer set search_path='' as $function$
declare v_post uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='publication_auth_required'; end if;
  perform private.lock_publication_draft_v1(p_draft_id);
  v_post:=private.publish_publication_draft_as_actor_v1(auth.uid(),p_draft_id,p_expected_revision,p_client_command_id,p_public_asset_ids);
  update private.publication_schedules set state='cancelled',generation=generation+1,revision=revision+1,
    claim_token=null,claim_expires_at=null,retryable=false,last_error_code=null,updated_at=pg_catalog.clock_timestamp()
    where draft_id=p_draft_id and owner_id=auth.uid() and state in ('scheduled','claimed','materializing','publishing','retryable_failed');
  return v_post;
end;
$function$;
-- Provider locations are privileged, non-secret configuration. Deployment must
-- set these to the same R2_PUBLIC_BUCKET/R2_PUBLIC_BASE_URL as existing media.
-- HTTPS origin/path only: no query, fragment, userinfo, percent escapes or ports.
alter table private.publication_schedule_policy
  add column public_bucket text check(public_bucket ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'),
  add column public_base_url text check(public_base_url ~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(/[A-Za-z0-9_-]+)*$'),
  add column object_environment text not null default 'production' check(object_environment in ('production','development')),
  add column provider_guard interval not null default interval '3 minutes' check(provider_guard=interval '3 minutes'),
  add constraint publication_schedule_lease_bound check(lease between interval '1 minute' and interval '2 minutes'),
  add constraint publication_schedule_backoff_bound check(backoff=interval '30 seconds' and backoff_cap=interval '15 minutes');
alter table private.publication_schedule_materializations
  add column source_fingerprint text not null,
  add column target_fingerprint text not null,
  add column provider_write_until timestamptz not null,
  add column released_at timestamptz,
  add column provider_etag text check(provider_etag ~ '^[0-9a-f]{32}(-[1-9][0-9]{0,4})?$'),
  add column provider_size_bytes bigint check(provider_size_bytes between 1 and 25000000),
  add column source_sha256 text check(source_sha256 ~ '^[0-9a-f]{64}$'),
  add column target_sha256 text check(target_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint publication_schedule_content_proof_check check(
    (finalized_at is null and source_sha256 is null and target_sha256 is null)
    or (finalized_at is not null and source_sha256 is not null and target_sha256 is not null and source_sha256=target_sha256)),
  add column created_at timestamptz not null default pg_catalog.clock_timestamp();
create index publication_schedule_materializations_release_idx
  on private.publication_schedule_materializations(provider_write_until,schedule_id) where released_at is null;
alter table public.media_asset_links drop constraint media_asset_links_entity_type_check;
alter table public.media_asset_links add constraint media_asset_links_entity_type_check check(entity_type in
  ('user_profile','video_post','story','chat_message','shop_product','exclusive_content','marketplace_store',
   'marketplace_dispute','marketplace_return_shipment','creator_premium_content','publication_draft','publication_schedule'));
create unique index publication_schedule_media_target_idx on public.media_asset_links(asset_id) where entity_type='publication_schedule';

-- C1's READY-only link guard gets exactly one reservation exception. The private
-- mapping must exist first; arbitrary public link callers cannot create it.
create or replace function private.guard_media_asset_link_lifecycle_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
declare v_status text;
begin
  select asset.status into v_status from public.media_assets asset where asset.id=new.asset_id for update;
  if not found then return new; end if;
  if new.entity_type='publication_schedule' then
    if tg_op='UPDATE' or new.slot<>'media' or not exists(
      select 1 from private.publication_schedule_materializations item
      join private.publication_schedules schedule on schedule.id=item.schedule_id
      join public.media_assets asset on asset.id=item.target_asset_id
      where item.schedule_id=new.entity_id and item.target_asset_id=new.asset_id and item.position=new.position
        and item.released_at is null and asset.owner_id=schedule.owner_id
        and asset.visibility='public' and asset.provider='r2' and asset.media_kind='image'
        and asset.purpose in ('post_image','carousel_image') and asset.status in ('pending','ready')
    ) then raise exception using errcode='55000',message='publication_schedule_link_invalid'; end if;
    return new;
  end if;
  if v_status<>'ready' then raise exception using errcode='55000',message='media_asset_link_lifecycle_invalid'; end if;
  return new;
end;
$function$;
revoke all on function private.guard_media_asset_link_lifecycle_v1() from public,anon,authenticated,service_role;
-- Keep schedule reservations private even after their targets become READY.
drop policy media_asset_links_owner_read on public.media_asset_links;
create policy media_asset_links_owner_read on public.media_asset_links for select to authenticated using(
  entity_type not in ('story','creator_premium_content','publication_draft','publication_schedule')
  and exists(select 1 from public.media_assets asset where asset.id=media_asset_links.asset_id and asset.owner_id=(select auth.uid())));
drop policy media_asset_links_public_read on public.media_asset_links;
create policy media_asset_links_public_read on public.media_asset_links for select to anon,authenticated using(
  entity_type not in ('story','creator_premium_content','publication_draft','publication_schedule')
  and exists(select 1 from public.media_assets asset where asset.id=media_asset_links.asset_id and asset.visibility='public' and asset.status='ready'));

create function private.require_publication_service_v1()
returns void language plpgsql security invoker set search_path='' as $function$
begin
  -- SET ROLE is trusted database authorization, never a caller-writable JWT GUC.
  if coalesce(pg_catalog.current_setting('role',true),'')<>'service_role'
    and not (session_user='service_role' and pg_catalog.current_setting('role',true)='none') then
    raise exception using errcode='42501',message='publication_service_required'; end if;
end;
$function$;
create function private.publication_source_fingerprint_v1(p_asset public.media_assets)
returns text language sql immutable security invoker set search_path='' as $function$
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array(
    p_asset.id,p_asset.owner_id,p_asset.provider,p_asset.media_kind,p_asset.purpose,p_asset.visibility,
    p_asset.bucket_name,p_asset.object_key,p_asset.mime_type,p_asset.size_bytes,p_asset.etag)::text,'UTF8'),'sha256'),'hex')
$function$;

create function private.publication_target_fingerprint_v1(p_asset public.media_assets)
returns text language sql immutable security invoker set search_path='' as $function$
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array(
    p_asset.id,p_asset.owner_id,p_asset.provider,p_asset.media_kind,p_asset.purpose,p_asset.visibility,
    p_asset.bucket_name,p_asset.object_key,p_asset.mime_type,p_asset.size_bytes,p_asset.public_url)::text,'UTF8'),'sha256'),'hex')
$function$;
-- Callers hold the draft gate and sorted source/target locks before inspecting.
create function private.publication_schedule_integrity_error_v1(p_schedule private.publication_schedules)
returns text language plpgsql security invoker set search_path='' as $function$
declare v_draft private.publication_drafts; v_count integer;
begin
  select * into v_draft from private.publication_drafts where id=p_schedule.draft_id;
  if v_draft.owner_id is distinct from p_schedule.owner_id or v_draft.state<>'draft' or v_draft.revision<>p_schedule.draft_revision then return 'draft_changed'; end if;
  select pg_catalog.count(*) into v_count from public.media_asset_links where entity_type='publication_draft' and entity_id=p_schedule.draft_id and slot='media';
  if (v_draft.kind='photo' and v_count<>1) or (v_draft.kind='carousel' and v_count not between 2 and 10) then return 'source_missing'; end if;
  if exists(select 1 from public.media_asset_links link join public.media_assets asset on asset.id=link.asset_id
    where link.entity_type='publication_draft' and link.entity_id=p_schedule.draft_id
      and (asset.owner_id<>p_schedule.owner_id or asset.provider<>'r2' or asset.media_kind<>'image' or asset.visibility<>'private'
        or asset.purpose<>case when v_draft.kind='photo' then 'post_image' else 'carousel_image' end or asset.status in ('deleted','delete_pending'))) then return 'source_invalid'; end if;
  if exists(select 1 from private.publication_schedule_materializations item
    join public.media_assets source on source.id=item.source_asset_id join public.media_assets target on target.id=item.target_asset_id
    where item.schedule_id=p_schedule.id and item.generation=p_schedule.generation and
      (item.source_fingerprint<>private.publication_source_fingerprint_v1(source)
       or item.target_fingerprint<>private.publication_target_fingerprint_v1(target) or target.status not in ('pending','ready')
       or not exists(select 1 from public.media_asset_links link where link.entity_type='publication_draft' and link.entity_id=p_schedule.draft_id and link.position=item.position and link.asset_id=item.source_asset_id)
       or not exists(select 1 from public.media_asset_links link where link.entity_type='publication_schedule' and link.entity_id=p_schedule.id and link.asset_id=item.target_asset_id and link.position=item.position))) then return 'identity_conflict'; end if;
  return null;
end;
$function$;
revoke all on function private.publication_target_fingerprint_v1(public.media_assets),private.publication_schedule_integrity_error_v1(private.publication_schedules)
 from public,anon,authenticated,service_role;

-- The gate protects the draft between validation and canonical core entry.
-- Publish defers the draft row lock to the shared core so receipt precedes draft.
create function private.require_publication_claim_v1(p_schedule_id uuid,p_generation bigint,p_claim_token uuid,p_lock_draft boolean default true,p_validate_draft boolean default true)
returns private.publication_schedules language plpgsql security invoker set search_path='' as $function$
declare v_schedule private.publication_schedules; v_draft private.publication_drafts; v_id uuid;
begin
  select draft_id into v_id from private.publication_schedules where id=p_schedule_id;
  perform private.lock_publication_draft_v1(v_id);
  select schedule.* into v_schedule from private.publication_schedules schedule where schedule.id=p_schedule_id for update;
  if not found or p_generation is null or p_claim_token is null or v_schedule.generation<>p_generation
    or v_schedule.claim_token is distinct from p_claim_token or v_schedule.state not in ('claimed','materializing','publishing')
    or v_schedule.claim_expires_at is null or v_schedule.claim_expires_at<=pg_catalog.clock_timestamp()
    or v_schedule.attempt_count not between 1 and v_schedule.max_attempts then
    raise exception using errcode='40001',message='publication_schedule_fence_invalid'; end if;
  if p_lock_draft then
    select draft.* into v_draft from private.publication_drafts draft where draft.id=v_schedule.draft_id for update;
  else select draft.* into v_draft from private.publication_drafts draft where draft.id=v_schedule.draft_id; end if;
  if p_validate_draft and (v_draft.owner_id is distinct from v_schedule.owner_id or v_draft.state<>'draft' or v_draft.revision<>v_schedule.draft_revision) then
    raise exception using errcode='40001',message='publication_schedule_draft_changed'; end if;
  return v_schedule;
end;
$function$;

create function public.claim_publication_schedules_v1(p_limit integer default 10)
returns setof jsonb language plpgsql security definer set search_path='' as $function$
declare v_schedule private.publication_schedules; v_policy private.publication_schedule_policy; v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  perform private.require_publication_service_v1();
  select * into strict v_policy from private.publication_schedule_policy where singleton;
  for v_schedule in select schedule.* from private.publication_schedules schedule
    where schedule.state in ('scheduled','retryable_failed') and (schedule.state='scheduled' or schedule.retryable)
      and schedule.scheduled_for<=v_now and schedule.next_attempt_at<=v_now and schedule.attempt_count<schedule.max_attempts
    order by schedule.next_attempt_at,schedule.id limit greatest(1,least(coalesce(p_limit,v_policy.claim_batch),v_policy.claim_batch))
    for update skip locked loop
    update private.publication_schedules set state='claimed',attempt_count=attempt_count+1,
      claim_token=pg_catalog.gen_random_uuid(),claim_expires_at=v_now+v_policy.lease,retryable=false,
      revision=revision+1,updated_at=v_now where id=v_schedule.id returning * into v_schedule;
    insert into private.publication_schedule_attempts(schedule_id,generation,claim_token,event)
      values(v_schedule.id,v_schedule.generation,v_schedule.claim_token,'claimed');
    return next pg_catalog.jsonb_build_object('schedule_id',v_schedule.id,'generation',v_schedule.generation,
      'claim_token',v_schedule.claim_token,'claim_expires_at',v_schedule.claim_expires_at,'attempt_count',v_schedule.attempt_count,'revision',v_schedule.revision);
  end loop;
end;
$function$;

create function public.prepare_publication_schedule_v1(p_schedule_id uuid,p_generation bigint,p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_schedule private.publication_schedules; v_policy private.publication_schedule_policy;
  v_kind text; v_assets uuid[]; v_source public.media_assets; v_target public.media_assets;
  v_item private.publication_schedule_materializations; v_position integer; v_target_id uuid;
  v_key text; v_extension text; v_items jsonb;
begin
  perform private.require_publication_service_v1();
  v_schedule:=private.require_publication_claim_v1(p_schedule_id,p_generation,p_claim_token);
  select * into strict v_policy from private.publication_schedule_policy where singleton;
  if v_policy.public_bucket is null or v_policy.public_base_url is null then
    raise exception using errcode='55000',message='publication_schedule_configuration_missing'; end if;
  select kind into v_kind from private.publication_drafts where id=v_schedule.draft_id;
  select pg_catalog.array_agg(link.asset_id order by link.position) into v_assets from public.media_asset_links link
    where link.entity_type='publication_draft' and link.entity_id=v_schedule.draft_id and link.slot='media';
  -- Lock existing sources and targets together, sorted, before validations.
  perform asset.id from public.media_assets asset where asset.id=any(v_assets) or asset.id in
    (select target_asset_id from private.publication_schedule_materializations where schedule_id=p_schedule_id and generation=p_generation)
    order by asset.id for update;
  perform private.require_publication_asset_set_v1(v_schedule.owner_id,v_kind,v_assets,'private');
  for v_position in 1..pg_catalog.cardinality(v_assets) loop
    select * into strict v_source from public.media_assets where id=v_assets[v_position];
    v_extension:=case v_source.mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'image/gif' then 'gif' end;
    if v_extension is null or v_source.size_bytes is null or v_source.size_bytes not between 1 and 25000000
      or v_source.etag is null or v_source.etag !~ '^[0-9a-f]{32}(-[1-9][0-9]{0,4})?$' then
      raise exception using errcode='22023',message='publication_schedule_source_invalid'; end if;
    v_target_id:=pg_catalog.md5('publication-schedule-target-v1:'||p_schedule_id::text||':'||p_generation::text||':'||(v_position-1)::text)::uuid;
    select * into v_item from private.publication_schedule_materializations where schedule_id=p_schedule_id and generation=p_generation and position=v_position-1;
    if found then
      if v_item.source_asset_id<>v_source.id or v_item.target_asset_id<>v_target_id or v_item.released_at is not null
        or v_item.source_fingerprint<>private.publication_source_fingerprint_v1(v_source) then
        raise exception using errcode='23505',message='publication_schedule_identity_conflict'; end if;
      select * into strict v_target from public.media_assets where id=v_target_id;
      if v_target.owner_id<>v_schedule.owner_id or v_target.status not in ('pending','ready') or v_target.visibility<>'public'
        or v_target.provider<>'r2' or v_target.media_kind<>'image' or v_target.purpose<>v_source.purpose
        or v_target.mime_type<>v_source.mime_type or v_target.size_bytes<>v_source.size_bytes
        or v_item.target_fingerprint<>private.publication_target_fingerprint_v1(v_target) then
        raise exception using errcode='23505',message='publication_schedule_identity_conflict'; end if;
    else
      v_key:=v_policy.object_environment||'/'||v_source.purpose||'/'||v_schedule.owner_id::text||'/'||
        pg_catalog.to_char(v_schedule.created_at at time zone 'UTC','YYYY/MM')||'/'||v_target_id::text||'.'||v_extension;
      -- No ON CONFLICT overwrite: collisions fail closed and roll back completely.
      insert into public.media_assets(id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,mime_type,size_bytes,
        public_url,status,upload_authorization_expires_at,lifecycle_contract_version)
      values(v_target_id,v_schedule.owner_id,'r2','image',v_source.purpose,'public',v_policy.public_bucket,v_key,v_source.mime_type,v_source.size_bytes,
        v_policy.public_base_url||'/'||v_key,'pending',v_schedule.claim_expires_at+v_policy.provider_guard,1) returning * into v_target;
      insert into private.publication_schedule_materializations(schedule_id,generation,position,source_asset_id,target_asset_id,source_fingerprint,target_fingerprint,provider_write_until)
      values(p_schedule_id,p_generation,v_position-1,v_source.id,v_target_id,private.publication_source_fingerprint_v1(v_source),private.publication_target_fingerprint_v1(v_target),v_schedule.claim_expires_at+v_policy.provider_guard);
      insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
        values(v_target_id,'publication_schedule',p_schedule_id,'media',v_position-1);
    end if;
  end loop;
  update private.publication_schedule_materializations set provider_write_until=greatest(provider_write_until,v_schedule.claim_expires_at+v_policy.provider_guard)
    where schedule_id=p_schedule_id and generation=p_generation;
  update public.media_assets set upload_authorization_expires_at=greatest(upload_authorization_expires_at,v_schedule.claim_expires_at+v_policy.provider_guard)
    where id in(select target_asset_id from private.publication_schedule_materializations where schedule_id=p_schedule_id and generation=p_generation);
  if v_schedule.state='claimed' then
    insert into private.publication_schedule_attempts(schedule_id,generation,claim_token,event) values(p_schedule_id,p_generation,p_claim_token,'prepared');
  end if;
  update private.publication_schedules set state='materializing' where id=p_schedule_id;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('position',item.position,'source_bucket',source.bucket_name,'source_key',source.object_key,
    'source_etag',source.etag,'target_asset_id',target.id,'target_bucket',target.bucket_name,'target_key',target.object_key,
    'mime_type',target.mime_type,'size_bytes',target.size_bytes,'finalized',item.finalized_at is not null) order by item.position) into v_items
    from private.publication_schedule_materializations item join public.media_assets source on source.id=item.source_asset_id
    join public.media_assets target on target.id=item.target_asset_id where item.schedule_id=p_schedule_id and item.generation=p_generation;
  if v_schedule.claim_expires_at<=pg_catalog.clock_timestamp() then
    raise exception using errcode='40001',message='publication_schedule_fence_invalid'; end if;
  return pg_catalog.jsonb_build_object('schedule_id',p_schedule_id,'generation',p_generation,'claim_expires_at',v_schedule.claim_expires_at,'items',v_items);
end;
$function$;

create function public.confirm_publication_schedule_item_v1(p_schedule_id uuid,p_generation bigint,p_claim_token uuid,p_position integer,p_size_bytes bigint,p_etag text,p_source_sha256 text,p_target_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_schedule private.publication_schedules; v_item private.publication_schedule_materializations; v_source public.media_assets; v_target public.media_assets;
begin
  perform private.require_publication_service_v1();
  v_schedule:=private.require_publication_claim_v1(p_schedule_id,p_generation,p_claim_token);
  select * into v_item from private.publication_schedule_materializations where schedule_id=p_schedule_id and generation=p_generation and position=p_position;
  if not found or v_item.released_at is not null then raise exception using errcode='22023',message='publication_schedule_item_invalid'; end if;
  perform asset.id from public.media_assets asset where asset.id in(v_item.source_asset_id,v_item.target_asset_id) order by asset.id for update;
  select * into strict v_source from public.media_assets where id=v_item.source_asset_id;
  select * into strict v_target from public.media_assets where id=v_item.target_asset_id;
  if v_source.status<>'ready' or private.publication_source_fingerprint_v1(v_source)<>v_item.source_fingerprint
    or v_target.owner_id<>v_schedule.owner_id or v_target.status not in ('pending','ready')
    or private.publication_target_fingerprint_v1(v_target)<>v_item.target_fingerprint then
    raise exception using errcode='23505',message='publication_schedule_identity_conflict'; end if;
  if p_size_bytes is null or p_size_bytes<>v_source.size_bytes or p_etag is null or p_etag !~ '^[0-9a-f]{32}(-[1-9][0-9]{0,4})?$'
    or (v_item.finalized_at is not null and (v_item.provider_size_bytes is distinct from p_size_bytes or v_item.provider_etag is distinct from p_etag)) then
    raise exception using errcode='22023',message='publication_schedule_provider_mismatch'; end if;
  -- Worker verifies the actual immutable source and final target bytes. ETags
  -- remain provider identities, not content digests (multipart copies differ).
  -- Equal full-object SHA-256 facts bind that verification to this reserved map.
  if p_source_sha256 is null or p_target_sha256 is null
    or p_source_sha256 !~ '^[0-9a-f]{64}$' or p_target_sha256 !~ '^[0-9a-f]{64}$'
    or p_source_sha256<>p_target_sha256
    or (v_item.finalized_at is not null and (v_item.source_sha256 is distinct from p_source_sha256 or v_item.target_sha256 is distinct from p_target_sha256)) then
    raise exception using errcode='22023',message='publication_schedule_content_mismatch'; end if;
  if v_item.finalized_at is null then
    update public.media_assets set status='ready',etag=p_etag,ready_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() where id=v_item.target_asset_id;
    update private.publication_schedule_materializations set finalized_at=pg_catalog.clock_timestamp(),provider_size_bytes=p_size_bytes,provider_etag=p_etag,
      source_sha256=p_source_sha256,target_sha256=p_target_sha256
      where schedule_id=p_schedule_id and generation=p_generation and position=p_position;
    insert into private.publication_schedule_attempts(schedule_id,generation,claim_token,event)
      values(p_schedule_id,p_generation,p_claim_token,'item_finalized');
  end if;
  if v_schedule.claim_expires_at<=pg_catalog.clock_timestamp() then
    raise exception using errcode='40001',message='publication_schedule_fence_invalid'; end if;
  return pg_catalog.jsonb_build_object('schedule_id',p_schedule_id,'generation',p_generation,'position',p_position,'target_asset_id',v_item.target_asset_id,'finalized',true);
end;
$function$;

create function public.publish_publication_schedule_v1(p_schedule_id uuid,p_generation bigint,p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_schedule private.publication_schedules; v_assets uuid[]; v_sources uuid[]; v_post uuid; v_id uuid;
begin
  perform private.require_publication_service_v1();
  select draft_id into v_id from private.publication_schedules where id=p_schedule_id;
  perform private.lock_publication_draft_v1(v_id);
  select * into v_schedule from private.publication_schedules where id=p_schedule_id for update;
  -- Only a successful exact fence can replay after lease expiry. The shared B1
  -- core still verifies its receipt and canonical post links, never a cached ID.
  if v_schedule.state='published' and v_schedule.generation=p_generation and v_schedule.claim_token=p_claim_token then
    select pg_catalog.array_agg(target_asset_id order by position) into v_assets from private.publication_schedule_materializations where schedule_id=p_schedule_id and generation=p_generation;
  else
    v_schedule:=private.require_publication_claim_v1(p_schedule_id,p_generation,p_claim_token,false);
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('publication-command:'||v_schedule.owner_id::text||':'||v_schedule.publish_command_id::text,0));
    perform receipt.post_id from private.publication_receipts receipt where receipt.owner_id=v_schedule.owner_id and receipt.client_command_id=v_schedule.publish_command_id for update;
    perform draft.id from private.publication_drafts draft where draft.id=v_schedule.draft_id for update;
    perform asset.id from public.media_assets asset where asset.id in
      (select link.asset_id from public.media_asset_links link where link.entity_type='publication_draft' and link.entity_id=v_schedule.draft_id)
      or asset.id in(select target_asset_id from private.publication_schedule_materializations where schedule_id=p_schedule_id and generation=p_generation)
      order by asset.id for update;
    if private.publication_schedule_integrity_error_v1(v_schedule) is not null then
      raise exception using errcode='23505',message='publication_schedule_identity_conflict'; end if;
    select pg_catalog.array_agg(link.asset_id order by link.position) into v_sources from public.media_asset_links link
      where link.entity_type='publication_draft' and link.entity_id=v_schedule.draft_id and link.slot='media';
    if v_sources is null or v_sources is distinct from (select pg_catalog.array_agg(source_asset_id order by position)
      from private.publication_schedule_materializations where schedule_id=p_schedule_id and generation=p_generation)
      or exists(select 1 from private.publication_schedule_materializations where schedule_id=p_schedule_id and generation=p_generation and (finalized_at is null or released_at is not null)) then
      raise exception using errcode='55000',message='publication_schedule_not_finalized'; end if;
    if exists(select 1 from private.publication_schedule_materializations item join public.media_assets source on source.id=item.source_asset_id
      where item.schedule_id=p_schedule_id and item.generation=p_generation and (source.status<>'ready' or private.publication_source_fingerprint_v1(source)<>item.source_fingerprint)) then
      raise exception using errcode='23505',message='publication_schedule_identity_conflict'; end if;
    select pg_catalog.array_agg(target_asset_id order by position) into v_assets from private.publication_schedule_materializations where schedule_id=p_schedule_id and generation=p_generation;
  end if;
  v_post:=private.publish_publication_draft_as_actor_v1(v_schedule.owner_id,v_schedule.draft_id,v_schedule.draft_revision,v_schedule.publish_command_id,v_assets);
  if v_schedule.state<>'published' then
  if v_schedule.claim_expires_at<=pg_catalog.clock_timestamp() then
    raise exception using errcode='40001',message='publication_schedule_fence_invalid'; end if;
    update private.publication_schedules set state='published',post_id=v_post,retryable=false,last_error_code=null,revision=revision+1,updated_at=pg_catalog.clock_timestamp() where id=p_schedule_id;
    insert into private.publication_schedule_attempts(schedule_id,generation,claim_token,event) values(p_schedule_id,p_generation,p_claim_token,'published');
  end if;
  return pg_catalog.jsonb_build_object('schedule_id',p_schedule_id,'generation',p_generation,'state','published','post_id',v_post);
end;
$function$;

create function private.fail_publication_claim_v1(p_schedule private.publication_schedules,p_error_code text,p_retryable boolean)
returns jsonb language plpgsql security invoker set search_path='' as $function$
declare v_retry boolean; v_policy private.publication_schedule_policy; v_now timestamptz:=pg_catalog.clock_timestamp(); v_schedule private.publication_schedules;
begin
  if p_error_code is null or p_error_code not in ('provider_timeout','provider_unavailable','network_error','lease_expired','media_not_ready',
    'source_missing','source_invalid','draft_changed','ownership_invalid','identity_conflict','fingerprint_mismatch','integrity_failed','content_blocked','configuration_missing') then
    raise exception using errcode='22023',message='publication_schedule_error_invalid'; end if;
  select * into strict v_policy from private.publication_schedule_policy where singleton;
  v_retry:=coalesce(p_retryable,false) and p_error_code in ('provider_timeout','provider_unavailable','network_error','lease_expired','media_not_ready')
    and p_schedule.attempt_count<p_schedule.max_attempts;
  update private.publication_schedules set state=case when v_retry then 'retryable_failed' else 'terminal_failed' end,
    retryable=v_retry,last_error_code=p_error_code,claim_token=null,claim_expires_at=null,revision=revision+1,updated_at=v_now,
    next_attempt_at=v_now+least(v_policy.backoff*pg_catalog.power(2::double precision,p_schedule.attempt_count-1),v_policy.backoff_cap)
    where id=p_schedule.id returning * into v_schedule;
  insert into private.publication_schedule_attempts(schedule_id,generation,claim_token,event,error_code)
    values(p_schedule.id,p_schedule.generation,p_schedule.claim_token,v_schedule.state,p_error_code);
  return pg_catalog.jsonb_build_object('schedule_id',v_schedule.id,'state',v_schedule.state,'retryable',v_schedule.retryable,'last_error_code',v_schedule.last_error_code,'next_attempt_at',v_schedule.next_attempt_at,'attempt_count',v_schedule.attempt_count);
end;
$function$;
create function public.fail_publication_schedule_v1(p_schedule_id uuid,p_generation bigint,p_claim_token uuid,p_error_code text,p_retryable boolean)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_schedule private.publication_schedules; v_error text;
begin
  perform private.require_publication_service_v1();
  v_schedule:=private.require_publication_claim_v1(p_schedule_id,p_generation,p_claim_token,true,false);
  perform asset.id from public.media_assets asset where asset.id in
    (select link.asset_id from public.media_asset_links link where link.entity_type='publication_draft' and link.entity_id=v_schedule.draft_id)
    or asset.id in(select target_asset_id from private.publication_schedule_materializations where schedule_id=p_schedule_id and generation=p_generation)
    order by asset.id for update;
  if v_schedule.claim_expires_at<=pg_catalog.clock_timestamp() then
    raise exception using errcode='40001',message='publication_schedule_fence_invalid'; end if;
  v_error:=private.publication_schedule_integrity_error_v1(v_schedule);
  if v_error is not null then return private.fail_publication_claim_v1(v_schedule,v_error,false); end if;
  return private.fail_publication_claim_v1(v_schedule,p_error_code,p_retryable);
end;
$function$;

create function public.reconcile_publication_schedules_v1(p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_candidate record; v_schedule private.publication_schedules; v_item record;
  v_recovered integer:=0; v_released integer:=0; v_error text;
  v_schedule_recovered integer; v_schedule_released integer;
  v_limit integer:=greatest(1,least(coalesce(p_limit,10),10));
begin
  perform private.require_publication_service_v1();
  for v_candidate in select id,draft_id from private.publication_schedules where
    (state in ('claimed','materializing','publishing') and claim_expires_at<=pg_catalog.clock_timestamp())
    or exists(select 1 from private.publication_schedule_materializations item where item.schedule_id=publication_schedules.id
      and item.released_at is null and item.provider_write_until<=pg_catalog.clock_timestamp()
      and (item.generation<>publication_schedules.generation or publication_schedules.state in ('cancelled','terminal_failed','published')))
    order by id limit v_limit loop
    -- Locks survive across candidates in this transaction. Never wait for a
    -- shared asset after processing an earlier candidate: per-schedule sorting
    -- alone cannot prevent opposite X/Y orders across two reconcilers' batches.
    -- This subtransaction acquires the COMPLETE asset union with NOWAIT. Any
    -- contention rolls back the entire candidate, releasing its partial locks,
    -- gate and writes. SKIP LOCKED on assets would silently accept a partial set.
    begin
      v_schedule_recovered:=0; v_schedule_released:=0;
      if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('publication-draft-gate:'||v_candidate.draft_id::text,0)) then continue; end if;
      select * into v_schedule from private.publication_schedules where id=v_candidate.id for update skip locked;
      if not found then continue; end if;
      perform draft.id from private.publication_drafts draft where draft.id=v_schedule.draft_id for update nowait;
      perform asset.id from public.media_assets asset where asset.id in
        (select link.asset_id from public.media_asset_links link where link.entity_type='publication_draft' and link.entity_id=v_schedule.draft_id)
        or asset.id in(select target_asset_id from private.publication_schedule_materializations where schedule_id=v_schedule.id)
        order by asset.id for update nowait;
      if v_schedule.state in ('claimed','materializing','publishing') and v_schedule.claim_expires_at<=pg_catalog.clock_timestamp() then
        v_error:=private.publication_schedule_integrity_error_v1(v_schedule);
        perform private.fail_publication_claim_v1(v_schedule,coalesce(v_error,'lease_expired'),v_error is null);
        v_schedule_recovered:=1;
        select * into v_schedule from private.publication_schedules where id=v_candidate.id;
      end if;
      for v_item in select item.* from private.publication_schedule_materializations item
        where item.schedule_id=v_schedule.id and item.released_at is null and item.provider_write_until<=pg_catalog.clock_timestamp()
          and (item.generation<>v_schedule.generation or v_schedule.state in ('cancelled','terminal_failed','published')) order by item.target_asset_id loop
        -- Every target is already held from the complete NOWAIT set above.
        delete from public.media_asset_links where entity_type='publication_schedule' and entity_id=v_schedule.id and asset_id=v_item.target_asset_id;
        perform public.schedule_media_asset_deletion(v_item.target_asset_id,v_schedule.owner_id);
        update private.publication_schedule_materializations set released_at=pg_catalog.clock_timestamp()
          where schedule_id=v_item.schedule_id and generation=v_item.generation and position=v_item.position;
        v_schedule_released:=v_schedule_released+1;
      end loop;
      v_recovered:=v_recovered+v_schedule_recovered; v_released:=v_released+v_schedule_released;
    exception when lock_not_available then
      -- Retry on the next wake; partial recovery/release never escapes.
      null;
    end;
  end loop;
  return pg_catalog.jsonb_build_object('recovered',v_recovered,'released',v_released);
end;
$function$;

revoke all on function private.require_publication_service_v1(),private.publication_source_fingerprint_v1(public.media_assets),
  private.require_publication_claim_v1(uuid,bigint,uuid,boolean,boolean),private.fail_publication_claim_v1(private.publication_schedules,text,boolean)
  from public,anon,authenticated,service_role;
revoke all on function public.claim_publication_schedules_v1(integer),public.prepare_publication_schedule_v1(uuid,bigint,uuid),
  public.confirm_publication_schedule_item_v1(uuid,bigint,uuid,integer,bigint,text,text,text),public.publish_publication_schedule_v1(uuid,bigint,uuid),
  public.fail_publication_schedule_v1(uuid,bigint,uuid,text,boolean),public.reconcile_publication_schedules_v1(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.claim_publication_schedules_v1(integer),public.prepare_publication_schedule_v1(uuid,bigint,uuid),
  public.confirm_publication_schedule_item_v1(uuid,bigint,uuid,integer,bigint,text,text,text),public.publish_publication_schedule_v1(uuid,bigint,uuid),
  public.fail_publication_schedule_v1(uuid,bigint,uuid,text,boolean),public.reconcile_publication_schedules_v1(integer) to service_role;

-- SOURCE-ONLY WAKE CONTRACT (no cron registration, secret, URL, or HTTP call):
-- Once per minute, the later authorized Edge wake calls reconcile(10), then
-- claim(10); process each returned fence via prepare -> copy -> confirm -> publish.
-- Copy may start only before claim_expires_at and must abort within 60 seconds.
-- Provider writes must be conditional/idempotent at the returned target key,
-- source-conditioned by source_etag. Before confirm, compute full-object SHA-256
-- independently from the immutable source and final target bytes. The source
-- read must match source_etag; the target read must match the confirmed target
-- ETag. Recovery must re-read/hash both objects; size/HEAD/ETag alone is not a
-- content proof. Never copy one reported digest into both confirmation inputs.
-- Never initiate another copy from an old prepare response after its lease.
-- Every stale target remains linked through claim_expires_at + 3 minutes.
commit;
