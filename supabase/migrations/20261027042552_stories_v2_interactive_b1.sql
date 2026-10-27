begin;

-- STORIES-V2-INTERACTIVE-B1. No normative safety policy is installed or enabled.
-- Existing Story identity, media deletion, moderation, views, velocity and
-- idempotency remain authoritative. A missing safety row is never passed.
create function private.story_valid_definition(p_config jsonb, p_answer text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare v_kind text; v_option jsonb; v_ids text[] := '{}'; v_allowed text[];
begin
  if p_config is null or pg_catalog.jsonb_typeof(p_config) <> 'object'
    or pg_catalog.octet_length(p_config::text)>8192 then return false; end if;
  v_kind := p_config->>'type';
  if not coalesce(p_config->'version'='1'::jsonb
    and (p_config->>'element_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and pg_catalog.jsonb_typeof(p_config->'prompt')='string'
    and pg_catalog.char_length(pg_catalog.btrim(p_config->>'prompt')) between 1 and 200
    and (p_config->>'prompt') !~* '([<>]|[a-z][a-z0-9+.-]*://|javascript:|data:|www\.)'
    and v_kind in ('poll','slider','quiz','question','reaction'),false) then return false; end if;
  v_allowed := array['version','element_id','type','prompt'];
  if v_kind in ('poll','quiz') then
    v_allowed := v_allowed || 'options'::text;
    if pg_catalog.jsonb_typeof(p_config->'options') is distinct from 'array' then return false; end if;
    if pg_catalog.jsonb_array_length(p_config->'options') not between 2 and 6 then return false; end if;
    for v_option in select value from pg_catalog.jsonb_array_elements(p_config->'options') loop
      if pg_catalog.jsonb_typeof(v_option)<>'object' then return false; end if;
      if not coalesce(pg_catalog.jsonb_typeof(v_option->'id')='string'
        and (v_option->>'id') ~ '^[a-zA-Z0-9_-]{1,64}$'
        and pg_catalog.jsonb_typeof(v_option->'label')='string'
        and pg_catalog.char_length(pg_catalog.btrim(v_option->>'label')) between 1 and 80
        and (v_option->>'label') !~* '([<>]|[a-z][a-z0-9+.-]*://|javascript:|data:|www\.)',false)
        or v_option->>'id'=any(v_ids)
        or exists(select 1 from pg_catalog.jsonb_object_keys(v_option) k where k not in ('id','label')) then return false; end if;
      v_ids := v_ids || (v_option->>'id');
    end loop;
    if v_kind='quiz' and p_answer is not null and not p_answer=any(v_ids) then return false; end if;
  elsif v_kind in ('slider','reaction') then
    v_allowed := v_allowed || 'emoji'::text;
    if not coalesce(p_config->>'emoji'=any(array['❤️','😂','😮','😢','🔥','👏','✨','⭐','💯','🎉','😍']),false) then return false; end if;
  end if;
  return not exists(select 1 from pg_catalog.jsonb_object_keys(p_config) k where not k=any(v_allowed))
    and (v_kind='quiz' or p_answer is null);
end;
$$;
revoke all on function private.story_valid_definition(jsonb,text) from public, anon, authenticated, service_role;

-- Fixed UTF8 encoding makes the definition digest independent of caller settings.
create function private.story_definition_digest(p_config jsonb,p_answer text)
returns text language sql immutable set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(p_config,p_answer)::text,'UTF8')),'hex');
$$;
revoke all on function private.story_definition_digest(jsonb,text) from public, anon, authenticated, service_role;

create function private.story_valid_response_payload(p_payload jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload)<>'object'
    or (select count(*) from pg_catalog.jsonb_object_keys(p_payload))<>1 then return false; end if;
  if p_payload ? 'option_id' then
    return coalesce(pg_catalog.jsonb_typeof(p_payload->'option_id')='string' and p_payload->>'option_id' ~ '^[a-zA-Z0-9_-]{1,64}$',false);
  elsif p_payload ? 'value' then
    if pg_catalog.jsonb_typeof(p_payload->'value') is distinct from 'number' then return false; end if;
    return (p_payload->>'value')::numeric between 0 and 1;
  elsif p_payload ? 'text' then
    return coalesce(pg_catalog.jsonb_typeof(p_payload->'text')='string'
      and pg_catalog.char_length(pg_catalog.btrim(p_payload->>'text')) between 1 and 500
      and p_payload->>'text' !~* '([<>]|[a-z][a-z0-9+.-]*://|javascript:|data:|www\.)',false);
  elsif p_payload ? 'emoji' then
    return coalesce(p_payload->>'emoji'=any(array['❤️','😂','😮','😢','🔥','👏','✨','⭐','💯','🎉','😍']),false);
  end if;
  return false;
end;
$$;
revoke all on function private.story_valid_response_payload(jsonb) from public, anon, authenticated, service_role;

create table private.story_interactive_elements (
  story_id uuid not null references public.stories(id) on delete cascade,
  element_id uuid not null,
  kind text not null check(kind in ('poll','slider','quiz','question','reaction')),
  public_config jsonb not null,
  private_answer text,
  definition_digest text generated always as
    (private.story_definition_digest(public_config,private_answer)) stored,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(story_id,element_id),
  check(private.story_valid_definition(public_config,private_answer)),
  check((public_config->>'element_id')::uuid=element_id and public_config->>'type'=kind)
);
create table private.story_interactive_responses (
  story_id uuid not null,
  element_id uuid not null,
  respondent_id uuid not null references public.user_profiles(id) on delete cascade,
  payload jsonb not null check(pg_catalog.jsonb_typeof(payload)='object' and pg_catalog.octet_length(payload::text)<=4096),
  moderation_state text not null default 'not_applicable' check(moderation_state in ('not_applicable','pending','hidden','blocked')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(story_id,element_id,respondent_id),
  check(private.story_valid_response_payload(payload)),
  check((payload ? 'text')=(moderation_state in ('pending','hidden','blocked'))),
  foreign key(story_id,element_id) references private.story_interactive_elements(story_id,element_id) on delete cascade
);
create index story_responses_creator_page on private.story_interactive_responses(story_id,element_id,created_at desc,respondent_id desc);
create index story_responses_respondent on private.story_interactive_responses(respondent_id,story_id);
create table private.story_analytics_events (
  story_id uuid not null references public.stories(id) on delete cascade,
  actor_id uuid not null references public.user_profiles(id) on delete cascade,
  event_id uuid not null,
  event_type text not null check(event_type in ('impression','completion','forward','back','exit','replay')),
  occurred_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(actor_id,event_id)
);
create index story_analytics_story_type on private.story_analytics_events(story_id,event_type,occurred_at);
create table private.story_safety_state (
  story_id uuid primary key references public.stories(id) on delete cascade,
  state text not null default 'pending' check(state in ('pending','review','blocked','passed')),
  generation bigint not null default 1 check(generation>0),
  evidence_generation bigint,
  evidence_fingerprint text check(evidence_fingerprint ~ '^[a-f0-9]{64}$'),
  policy_digest text check(policy_digest ~ '^[a-f0-9]{64}$'),
  scan_id uuid,
  visual_complete boolean not null default false,
  audio_complete boolean not null default false,
  text_complete boolean not null default false,
  decided_at timestamptz,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check(state<>'passed' or (evidence_generation is not null and evidence_generation=generation
    and evidence_fingerprint is not null and policy_digest is not null and decided_at is not null
    and visual_complete and audio_complete and text_complete))
);
create table private.story_operation_policy (
  operation text primary key check(operation in ('create','interaction','reply','question','report','analytics')),
  max_operations integer not null check(max_operations between 1 and 10000),
  window_hours integer not null check(window_hours between 1 and 24)
);
-- Operational abuse limits, not normative content-safety decisions.
insert into private.story_operation_policy values
 ('create',25,24),('interaction',120,1),('reply',50,24),('question',30,1),('report',20,24),('analytics',600,1);

alter table private.story_interactive_elements enable row level security;
alter table private.story_interactive_elements force row level security;
alter table private.story_interactive_responses enable row level security;
alter table private.story_interactive_responses force row level security;
alter table private.story_analytics_events enable row level security;
alter table private.story_analytics_events force row level security;
alter table private.story_safety_state enable row level security;
alter table private.story_safety_state force row level security;
alter table private.story_operation_policy enable row level security;
alter table private.story_operation_policy force row level security;
revoke all on private.story_interactive_elements from public, anon, authenticated, service_role;
revoke all on private.story_interactive_responses from public, anon, authenticated, service_role;
revoke all on private.story_analytics_events from public, anon, authenticated, service_role;
revoke all on private.story_safety_state from public, anon, authenticated, service_role;
revoke all on private.story_operation_policy from public, anon, authenticated, service_role;

create table public.story_interactive_revisions (
  story_id uuid not null,
  element_id uuid not null,
  revision bigint not null default 1 check(revision>0),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(story_id,element_id),
  foreign key(story_id,element_id) references private.story_interactive_elements(story_id,element_id) on delete cascade
);
alter table public.story_interactive_revisions enable row level security;
alter table public.story_interactive_revisions force row level security;
revoke all on public.story_interactive_revisions from public, anon, authenticated, service_role;
grant select on public.story_interactive_revisions to authenticated;

create function private.story_current_fingerprint(p_story_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'story',s.id,'kind',s.story_kind,'source',s.shared_video_id,'legacy',s.media_url,
    'composition',s.story_composition,
    'definitions',(select pg_catalog.jsonb_agg(e.definition_digest order by e.element_id) from private.story_interactive_elements e where e.story_id=s.id),
    'media',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',a.id,'status',a.status,'provider',a.provider,'key',a.object_key) order by a.id)
      from public.media_asset_links l join public.media_assets a on a.id=l.asset_id where l.entity_type='story' and l.entity_id=s.id)
  )::text,'UTF8')),'hex') from public.stories s where s.id=p_story_id;
$$;
revoke all on function private.story_current_fingerprint(uuid) from public, anon, authenticated, service_role;

create function private.story_can_access(p_story_id uuid,p_allow_expired boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.stories s
    where s.id=p_story_id and private.admin_content_is_visible('story',s.id)
    and (p_allow_expired or s.expires_at>pg_catalog.now())
    and (s.user_id=auth.uid() or (private.story_can_view_owner(s.user_id)
      and exists(select 1 from private.story_safety_state safety where safety.story_id=s.id
        and safety.state='passed' and safety.evidence_generation=safety.generation
        and safety.evidence_fingerprint=private.story_current_fingerprint(s.id))))) ;
$$;
revoke all on function private.story_can_access(uuid,boolean) from public, anon, authenticated, service_role;
grant execute on function private.story_can_access(uuid,boolean) to authenticated;

drop policy if exists stories_read_visible on public.stories;
create policy stories_read_visible on public.stories for select to authenticated
  using(private.story_can_access(id,user_id=(select auth.uid())));
drop policy if exists media_asset_links_story_visible_read on public.media_asset_links;
create policy media_asset_links_story_visible_read on public.media_asset_links for select to authenticated
  using(entity_type='story' and slot='media' and position=0 and private.story_can_access(entity_id,false));
create policy story_interactive_revisions_read on public.story_interactive_revisions for select to authenticated
  using(private.story_can_access(story_id,false));

create function private.story_consume_velocity(p_actor uuid,p_operation text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_policy private.story_operation_policy;
begin
  if p_actor is null or p_actor is distinct from auth.uid() then
    raise exception using errcode='42501',message='not_authenticated'; end if;
  -- check_velocity_limit is shared; serialize this caller's read/increment pair.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('story-rate:'||p_actor::text||':'||p_operation,0));
  select * into strict v_policy from private.story_operation_policy where operation=p_operation;
  if not public.check_velocity_limit(p_actor,'story_'||p_operation,0,v_policy.max_operations,0,v_policy.window_hours) then
    raise exception using errcode='54000',message='story_rate_limited'; end if;
end;
$$;
revoke all on function private.story_consume_velocity(uuid,text) from public, anon, authenticated, service_role;

create function private.story_initialize_safety()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then perform private.story_consume_velocity(auth.uid(),'create'); end if;
  insert into private.story_safety_state(story_id) values(new.id);
  return new;
end;
$$;
revoke all on function private.story_initialize_safety() from public, anon, authenticated, service_role;
create trigger story_initialize_safety after insert on public.stories for each row execute function private.story_initialize_safety();
-- Historical rows remain pending, including direct media and shared Stories.
insert into private.story_safety_state(story_id) select id from public.stories;

create function private.story_interactive_aggregate(p_story_id uuid,p_element_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_kind text; v_result jsonb;
begin
  select kind into v_kind from private.story_interactive_elements where story_id=p_story_id and element_id=p_element_id;
  if v_kind='slider' then
    select pg_catalog.jsonb_build_object('total',count(*),'average',avg((payload->>'value')::numeric)) into v_result
    from private.story_interactive_responses where story_id=p_story_id and element_id=p_element_id;
  elsif v_kind in ('poll','quiz') then
    select pg_catalog.jsonb_build_object('total',coalesce(sum(n),0),'options',coalesce(pg_catalog.jsonb_object_agg(choice,n),'{}'::jsonb)) into v_result
    from (select payload->>'option_id' choice,count(*) n from private.story_interactive_responses
      where story_id=p_story_id and element_id=p_element_id group by payload->>'option_id') counts;
  else
    select pg_catalog.jsonb_build_object('total',count(*)) into v_result from private.story_interactive_responses
      where story_id=p_story_id and element_id=p_element_id;
  end if;
  return v_result;
end;
$$;
revoke all on function private.story_interactive_aggregate(uuid,uuid) from public, anon, authenticated, service_role;

create function public.get_story_interactive_state(p_story_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_story public.stories; v_element private.story_interactive_elements;
  v_response private.story_interactive_responses; v_item jsonb; v_items jsonb:='[]';
begin
  if not private.story_can_access(p_story_id,exists(select 1 from public.stories where id=p_story_id and user_id=v_actor)) then raise exception using errcode='42501',message='story_not_visible'; end if;
  select * into strict v_story from public.stories where id=p_story_id;
  for v_element in select * from private.story_interactive_elements where story_id=p_story_id order by element_id limit 32 loop
    select * into v_response from private.story_interactive_responses where story_id=p_story_id and element_id=v_element.element_id and respondent_id=v_actor;
    v_item:=pg_catalog.jsonb_build_object('element_id',v_element.element_id,'definition',v_element.public_config,
      'revision',coalesce((select revision from public.story_interactive_revisions where story_id=p_story_id and element_id=v_element.element_id),0));
    if v_response.respondent_id is not null then
      v_item:=v_item||pg_catalog.jsonb_build_object('response',pg_catalog.jsonb_build_object('payload',v_response.payload,'moderation_state',v_response.moderation_state));
    end if;
    if v_actor=v_story.user_id or (v_element.kind in ('poll','slider','quiz') and (v_response.respondent_id is not null or v_story.expires_at<=pg_catalog.now())) then
      v_item:=v_item||pg_catalog.jsonb_build_object('aggregate',private.story_interactive_aggregate(p_story_id,v_element.element_id));
    end if;
    -- Expiry alone never discloses the quiz key.
    if v_element.kind='quiz' and v_element.private_answer is not null and (v_actor=v_story.user_id or v_response.respondent_id is not null) then
      v_item:=v_item||pg_catalog.jsonb_build_object('correct_option_id',v_element.private_answer);
    end if;
    v_items:=v_items||pg_catalog.jsonb_build_array(v_item);
  end loop;
  return pg_catalog.jsonb_build_object('story_id',p_story_id,'elements',v_items);
end;
$$;
revoke all on function public.get_story_interactive_state(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_story_interactive_state(uuid) to authenticated;

create function public.respond_to_story_element(p_story_id uuid,p_element_id uuid,p_idempotency_key uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_hash text; v_saved public.idempotency_keys;
  v_element private.story_interactive_elements; v_previous private.story_interactive_responses;
  v_owner uuid; v_payload jsonb; v_response jsonb; v_revision bigint; v_moderation text;
begin
  if v_actor is null then raise exception using errcode='42501',message='not_authenticated'; end if;
  if p_story_id is null or p_element_id is null or p_idempotency_key is null or p_payload is null
    or pg_catalog.jsonb_typeof(p_payload)<>'object' or pg_catalog.octet_length(p_payload::text)>4096 then
    raise exception using errcode='22023',message='invalid_story_response'; end if;
  v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(p_story_id,p_element_id,p_payload)::text,'UTF8')),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('story-command:'||v_actor::text||':'||p_idempotency_key::text,0));
  select * into v_saved from public.idempotency_keys where user_id=v_actor and operation_type='story_interaction' and idempotency_key=p_idempotency_key::text;
  if found and v_saved.request_hash is distinct from v_hash then raise exception using errcode='23505',message='story_idempotency_conflict'; end if;
  select user_id into v_owner from public.stories where id=p_story_id for share;
  -- Replay is authorized against current deletion, moderation, block and safety state.
  if not private.story_can_access(p_story_id,false) then raise exception using errcode='42501',message='story_not_visible'; end if;
  if v_saved.status='completed' then return v_saved.response_body; end if;
  if v_owner=v_actor then raise exception using errcode='42501',message='story_owner_cannot_respond'; end if;
  select * into v_element from private.story_interactive_elements where story_id=p_story_id and element_id=p_element_id for update;
  if not found then raise exception using errcode='22023',message='invalid_story_element'; end if;
  if v_element.kind in ('poll','quiz') then
    if (p_payload - 'option_id')<>'{}'::jsonb or pg_catalog.jsonb_typeof(p_payload->'option_id') is distinct from 'string'
      or not exists(select 1 from pg_catalog.jsonb_array_elements(v_element.public_config->'options') o where o->>'id'=p_payload->>'option_id') then
      raise exception using errcode='22023',message='invalid_story_response'; end if;
  elsif v_element.kind='slider' then
    if (p_payload - 'value')<>'{}'::jsonb or pg_catalog.jsonb_typeof(p_payload->'value') is distinct from 'number' then
      raise exception using errcode='22023',message='invalid_story_response'; end if;
    if (p_payload->>'value')::numeric not between 0 and 1 then raise exception using errcode='22023',message='invalid_story_response'; end if;
  elsif v_element.kind='question' then
    if (p_payload - 'text')<>'{}'::jsonb or pg_catalog.jsonb_typeof(p_payload->'text') is distinct from 'string'
      or pg_catalog.char_length(pg_catalog.btrim(p_payload->>'text')) not between 1 and 500
      or p_payload->>'text' ~* '([<>]|[a-z][a-z0-9+.-]*://|javascript:|data:|www\.)' then
      raise exception using errcode='22023',message='invalid_story_response'; end if;
  else
    if (p_payload - 'emoji')<>'{}'::jsonb or (p_payload->>'emoji') is distinct from (v_element.public_config->>'emoji') then
      raise exception using errcode='22023',message='invalid_story_response'; end if;
  end if;
  v_payload:=case when v_element.kind='question' then pg_catalog.jsonb_build_object('text',pg_catalog.btrim(p_payload->>'text')) else p_payload end;
  select * into v_previous from private.story_interactive_responses where story_id=p_story_id and element_id=p_element_id and respondent_id=v_actor;
  if found and v_element.kind<>'slider' and v_previous.payload<>v_payload then
    raise exception using errcode='23505',message='story_response_immutable'; end if;
  if v_previous.payload is distinct from v_payload then
    perform private.story_consume_velocity(v_actor,'interaction');
    if v_element.kind='question' then perform private.story_consume_velocity(v_actor,'question'); end if;
    v_moderation:=case when v_element.kind='question' then 'pending' else 'not_applicable' end;
    insert into private.story_interactive_responses(story_id,element_id,respondent_id,payload,moderation_state)
    values(p_story_id,p_element_id,v_actor,v_payload,v_moderation)
    on conflict(story_id,element_id,respondent_id) do update set payload=excluded.payload,updated_at=pg_catalog.clock_timestamp();
    insert into public.story_interactive_revisions as r(story_id,element_id) values(p_story_id,p_element_id)
    on conflict(story_id,element_id) do update set revision=r.revision+1,updated_at=pg_catalog.clock_timestamp()
    returning revision into v_revision;
  else
    select revision into v_revision from public.story_interactive_revisions where story_id=p_story_id and element_id=p_element_id;
  end if;
  v_response:=pg_catalog.jsonb_build_object('story_id',p_story_id,'element_id',p_element_id,'status','recorded','revision',v_revision);
  insert into public.idempotency_keys(idempotency_key,operation_type,user_id,request_hash,status,response_body)
    values(p_idempotency_key::text,'story_interaction',v_actor,v_hash,'completed',v_response);
  return v_response;
end;
$$;
revoke all on function public.respond_to_story_element(uuid,uuid,uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.respond_to_story_element(uuid,uuid,uuid,jsonb) to authenticated;

create function public.get_story_interactive_results(p_story_id uuid,p_element_id uuid,p_limit integer default 50,p_before_created_at timestamptz default null,p_before_respondent_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_responses jsonb; v_analytics jsonb; v_has_more boolean; v_cursor jsonb:=null;
begin
  if v_actor is null or not exists(select 1 from public.stories where id=p_story_id and user_id=v_actor)
    or not private.admin_content_is_visible('story',p_story_id) then raise exception using errcode='42501',message='story_results_owner_only'; end if;
  if p_limit is null or p_limit not between 1 and 100 or (p_before_created_at is null)<>(p_before_respondent_id is null) then
    raise exception using errcode='22023',message='invalid_story_results_cursor'; end if;
  if not exists(select 1 from private.story_interactive_elements where story_id=p_story_id and element_id=p_element_id) then
    raise exception using errcode='22023',message='invalid_story_element'; end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(page) order by created_at desc,respondent_id desc),'[]'::jsonb) into v_responses from (
    select r.respondent_id,r.payload,r.moderation_state,r.created_at from private.story_interactive_responses r
    join private.story_interactive_elements e using(story_id,element_id)
    where r.story_id=p_story_id and r.element_id=p_element_id and e.kind='question'
      and (p_before_created_at is null or (r.created_at,r.respondent_id)<(p_before_created_at,p_before_respondent_id))
    order by r.created_at desc,r.respondent_id desc limit p_limit+1) page;
  v_has_more:=pg_catalog.jsonb_array_length(v_responses)>p_limit;
  if v_has_more then
    select pg_catalog.jsonb_agg(value order by ordinality) into v_responses
      from pg_catalog.jsonb_array_elements(v_responses) with ordinality where ordinality<=p_limit;
    v_cursor:=pg_catalog.jsonb_build_object('created_at',v_responses->(p_limit-1)->'created_at',
      'respondent_id',v_responses->(p_limit-1)->'respondent_id');
  end if;
  select coalesce(pg_catalog.jsonb_object_agg(event_type,n),'{}'::jsonb) into v_analytics from (
    select event_type,count(*) n from private.story_analytics_events where story_id=p_story_id group by event_type) counts;
  return pg_catalog.jsonb_build_object('aggregate',private.story_interactive_aggregate(p_story_id,p_element_id),'responses',v_responses,'analytics',v_analytics,
    'has_more',v_has_more,'next_cursor',v_cursor);
end;
$$;
revoke all on function public.get_story_interactive_results(uuid,uuid,integer,timestamptz,uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_story_interactive_results(uuid,uuid,integer,timestamptz,uuid) to authenticated;

create function public.moderate_story_question(p_story_id uuid,p_element_id uuid,p_respondent_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_owner uuid; v_state text; v_response private.story_interactive_responses;
begin
  if v_actor is null then raise exception using errcode='42501',message='not_authenticated'; end if;
  if p_action is null or p_action not in ('hide','block','inspect') then raise exception using errcode='22023',message='invalid_question_action'; end if;
  select user_id into v_owner from public.stories where id=p_story_id for share;
  if v_owner is null then raise exception using errcode='42501',message='story_not_visible'; end if;
  if v_owner<>v_actor or p_action in ('block','inspect') then perform public.admin_require_capability('stories.items.moderate'); end if;
  if v_owner=v_actor and not private.admin_content_is_visible('story',p_story_id) then raise exception using errcode='42501',message='story_not_visible'; end if;
  select r.* into v_response from private.story_interactive_responses r
    where r.story_id=p_story_id and r.element_id=p_element_id and r.respondent_id=p_respondent_id
      and exists(select 1 from private.story_interactive_elements e where e.story_id=r.story_id and e.element_id=r.element_id and e.kind='question') for update;
  if not found then raise exception using errcode='22023',message='question_not_found'; end if;
  if p_action='inspect' then return pg_catalog.jsonb_build_object('payload',v_response.payload,'status',v_response.moderation_state); end if;
  -- Neither a creator nor another moderator can downgrade an authoritative block.
  v_state:=case when p_action='block' or v_response.moderation_state='blocked' then 'blocked' else 'hidden' end;
  update private.story_interactive_responses r set moderation_state=v_state,updated_at=pg_catalog.clock_timestamp()
  where r.story_id=p_story_id and r.element_id=p_element_id and r.respondent_id=p_respondent_id
    and exists(select 1 from private.story_interactive_elements e where e.story_id=r.story_id and e.element_id=r.element_id and e.kind='question');
  if not found then raise exception using errcode='22023',message='question_not_found'; end if;
  update public.story_interactive_revisions set revision=revision+1,updated_at=pg_catalog.clock_timestamp() where story_id=p_story_id and element_id=p_element_id;
  return pg_catalog.jsonb_build_object('status',v_state);
end;
$$;
revoke all on function public.moderate_story_question(uuid,uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.moderate_story_question(uuid,uuid,uuid,text) to authenticated;

create function public.record_story_event(p_story_id uuid,p_event_type text,p_event_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_owner uuid; v_hash text; v_saved public.idempotency_keys; v_response jsonb;
begin
  if v_actor is null then raise exception using errcode='42501',message='not_authenticated'; end if;
  if p_event_id is null or p_story_id is null or p_event_type is null or p_event_type not in ('impression','completion','forward','back','exit','replay') then
    raise exception using errcode='22023',message='invalid_story_event'; end if;
  v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(p_story_id,p_event_type)::text,'UTF8')),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('story-event:'||v_actor::text||':'||p_event_id::text,0));
  select user_id into v_owner from public.stories where id=p_story_id for share;
  if v_owner is null or not private.story_can_access(p_story_id,false) then raise exception using errcode='42501',message='story_not_visible'; end if;
  if v_owner=v_actor then
    return pg_catalog.jsonb_build_object('status','owner_ignored','event_id',p_event_id);
  end if;
  select * into v_saved from public.idempotency_keys where user_id=v_actor and operation_type='story_analytics' and idempotency_key=p_event_id::text;
  if found and v_saved.request_hash is distinct from v_hash then raise exception using errcode='23505',message='story_idempotency_conflict'; end if;
  if v_saved.status='completed' then return v_saved.response_body; end if;
  -- Durable event identity also survives routine idempotency receipt expiry.
  if exists(select 1 from private.story_analytics_events where actor_id=v_actor and event_id=p_event_id and (story_id<>p_story_id or event_type<>p_event_type)) then
    raise exception using errcode='23505',message='story_idempotency_conflict'; end if;
  if not exists(select 1 from private.story_analytics_events where actor_id=v_actor and event_id=p_event_id) then
    perform private.story_consume_velocity(v_actor,'analytics');
    insert into private.story_analytics_events(story_id,actor_id,event_id,event_type) values(p_story_id,v_actor,p_event_id,p_event_type);
    -- The client sends impression only after media readiness. Server time owns the event.
    if p_event_type='impression' then perform public.mark_story_viewed(p_story_id); end if;
  end if;
  v_response:=pg_catalog.jsonb_build_object('status','recorded','event_id',p_event_id);
  insert into public.idempotency_keys(idempotency_key,operation_type,user_id,request_hash,status,response_body)
    values(p_event_id::text,'story_analytics',v_actor,v_hash,'completed',v_response);
  return v_response;
end;
$$;
revoke all on function public.record_story_event(uuid,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.record_story_event(uuid,text,uuid) to authenticated;

-- Preserve the existing v1 validator while validating all required members here.
alter function private.story_validate_composition(jsonb) rename to story_validate_composition_v1;
revoke all on function private.story_validate_composition_v1(jsonb) from public, anon, authenticated, service_role;
create function private.story_validate_composition(p_composition jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_element jsonb; v_static jsonb:='[]'; v_count integer:=0;
begin
  if p_composition is null or pg_catalog.jsonb_typeof(p_composition)<>'object'
    or pg_catalog.octet_length(p_composition::text)>32768
    or not coalesce(p_composition->'version' in ('1'::jsonb,'2'::jsonb),false)
    or pg_catalog.jsonb_typeof(p_composition->'elements') is distinct from 'array' then
    raise exception using errcode='22023',message='invalid_story_composition'; end if;
  if pg_catalog.jsonb_array_length(p_composition->'elements')>32
    or exists(select 1 from pg_catalog.jsonb_object_keys(p_composition) k where k not in ('version','elements')) then
    raise exception using errcode='22023',message='invalid_story_composition'; end if;
  for v_element in select value from pg_catalog.jsonb_array_elements(p_composition->'elements') loop
    if pg_catalog.jsonb_typeof(v_element)<>'object' or not v_element ?& array['id','type','x','y','scale','rotation'] then
      raise exception using errcode='22023',message='invalid_story_element'; end if;
    if not coalesce(v_element->>'type' in ('text','sticker','interactive'),false) then
      raise exception using errcode='22023',message='invalid_story_element'; end if;
    if not coalesce(v_element->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and pg_catalog.jsonb_typeof(v_element->'x')='number' and pg_catalog.jsonb_typeof(v_element->'y')='number'
      and pg_catalog.jsonb_typeof(v_element->'scale')='number' and pg_catalog.jsonb_typeof(v_element->'rotation')='number',false) then
      raise exception using errcode='22023',message='invalid_story_element'; end if;
    if (v_element->>'x')::numeric not between 0 and 1 or (v_element->>'y')::numeric not between 0 and 1
      or (v_element->>'scale')::numeric not between 0.5 and 4 or (v_element->>'rotation')::numeric not between -180 and 180 then
      raise exception using errcode='22023',message='invalid_story_element'; end if;
    if v_element->>'type'='interactive' then
      if p_composition->'version'<>'2'::jsonb or not coalesce(v_element->>'element_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
        or exists(select 1 from pg_catalog.jsonb_object_keys(v_element) k where k not in ('id','type','element_id','x','y','scale','rotation')) then
        raise exception using errcode='22023',message='invalid_story_interactive_placement'; end if;
      v_count:=v_count+1;
    else
      if (v_element->>'type'='text' and not v_element ?& array['text','color','align','size'])
        or (v_element->>'type'='sticker' and not v_element ? 'value') then
        raise exception using errcode='22023',message='invalid_story_element'; end if;
      if v_element->>'type'='text' and not coalesce(
        v_element->>'color' in ('#FFFFFF','#111111','#FF2D78','#7C5CFF','#00D4FF','#FFD60A')
        and v_element->>'align' in ('left','center','right')
        and v_element->>'size' in ('small','medium','large'),false) then
        raise exception using errcode='22023',message='invalid_story_text_element'; end if;
      v_static:=v_static||pg_catalog.jsonb_build_array(v_element);
    end if;
  end loop;
  perform private.story_validate_composition_v1(pg_catalog.jsonb_build_object('version',1,'elements',v_static));
  if (select count(*)<>count(distinct pg_catalog.lower(value->>'id')) from pg_catalog.jsonb_array_elements(p_composition->'elements'))
    or v_count<>(select count(distinct pg_catalog.lower(value->>'element_id')) from pg_catalog.jsonb_array_elements(p_composition->'elements') where value->>'type'='interactive') then
    raise exception using errcode='22023',message='duplicate_story_element_id'; end if;
  return p_composition;
end;
$$;
revoke all on function private.story_validate_composition(jsonb) from public, anon, authenticated, service_role;

-- A deferred relational invariant makes Story + definitions one atomic publish.
-- Even the legacy three-argument endpoint cannot commit dangling v2 references.
create function private.story_check_definition_references()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_composition jsonb;
begin
  if tg_table_name='stories' then v_id:=coalesce(new.id,old.id); else v_id:=coalesce(new.story_id,old.story_id); end if;
  select story_composition into v_composition from public.stories where id=v_id;
  if not found then return null; end if;
  perform private.story_validate_composition(v_composition);
  if exists(
    (select (value->>'element_id')::uuid from pg_catalog.jsonb_array_elements(v_composition->'elements') where value->>'type'='interactive'
      except select element_id from private.story_interactive_elements where story_id=v_id)
    union all
    (select element_id from private.story_interactive_elements where story_id=v_id
      except select (value->>'element_id')::uuid from pg_catalog.jsonb_array_elements(v_composition->'elements') where value->>'type'='interactive')
  ) then raise exception using errcode='23514',message='story_definition_reference_mismatch'; end if;
  return null;
end;
$$;
revoke all on function private.story_check_definition_references() from public, anon, authenticated, service_role;
create constraint trigger story_definition_references after insert or update on public.stories
  deferrable initially deferred for each row execute function private.story_check_definition_references();
create constraint trigger story_element_references after insert or update or delete on private.story_interactive_elements
  deferrable initially deferred for each row execute function private.story_check_definition_references();

create function private.story_install_definitions(p_story_id uuid,p_definitions jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_definition jsonb; v_config jsonb; v_answer text; v_existing private.story_interactive_elements;
begin
  if auth.uid() is null or not exists(select 1 from public.stories where id=p_story_id and user_id=auth.uid()) then
    raise exception using errcode='42501',message='story_not_owned'; end if;
  if p_definitions is null or pg_catalog.jsonb_typeof(p_definitions)<>'array' or pg_catalog.octet_length(p_definitions::text)>65536 then
    raise exception using errcode='22023',message='invalid_story_definitions'; end if;
  if pg_catalog.jsonb_array_length(p_definitions)>32 then raise exception using errcode='22023',message='invalid_story_definitions'; end if;
  if (select count(*)<>count(distinct pg_catalog.lower(value->>'element_id')) from pg_catalog.jsonb_array_elements(p_definitions)) then
    raise exception using errcode='22023',message='duplicate_story_element_id'; end if;
  for v_definition in select value from pg_catalog.jsonb_array_elements(p_definitions) loop
    v_config:=v_definition-'correct_option_id'; v_answer:=v_definition->>'correct_option_id';
    if not private.story_valid_definition(v_config,v_answer) then raise exception using errcode='22023',message='invalid_story_definition'; end if;
    select * into v_existing from private.story_interactive_elements where story_id=p_story_id and element_id=(v_config->>'element_id')::uuid;
    if found then
      if v_existing.public_config<>v_config or v_existing.private_answer is distinct from v_answer then
        raise exception using errcode='23505',message='story_idempotency_conflict'; end if;
    else
      insert into private.story_interactive_elements(story_id,element_id,kind,public_config,private_answer)
      values(p_story_id,(v_config->>'element_id')::uuid,v_config->>'type',v_config,v_answer);
      insert into public.story_interactive_revisions(story_id,element_id) values(p_story_id,(v_config->>'element_id')::uuid);
    end if;
  end loop;
  if (select count(*) from private.story_interactive_elements where story_id=p_story_id)<>pg_catalog.jsonb_array_length(p_definitions) then
    raise exception using errcode='23505',message='story_idempotency_conflict'; end if;
end;
$$;
revoke all on function private.story_install_definitions(uuid,jsonb) from public, anon, authenticated, service_role;

create function public.create_story_with_media(p_asset_id uuid,p_composition jsonb,p_client_story_id uuid,p_interactive_definitions jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_story uuid;
begin
  if auth.uid() is null or p_client_story_id is null then raise exception using errcode='22023',message='invalid_story_identity'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('story-create:'||auth.uid()::text||':'||p_client_story_id::text,0));
  v_story:=private.create_story_with_media_core(p_asset_id,p_composition,p_client_story_id);
  perform private.story_install_definitions(v_story,p_interactive_definitions);
  return v_story;
end;
$$;
revoke all on function public.create_story_with_media(uuid,jsonb,uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.create_story_with_media(uuid,jsonb,uuid,jsonb) to authenticated;

create function public.create_story_from_content(p_video_id uuid,p_composition jsonb,p_client_story_id uuid,p_interactive_definitions jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_story uuid;
begin
  if auth.uid() is null or p_client_story_id is null then raise exception using errcode='22023',message='invalid_story_identity'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('story-create:'||auth.uid()::text||':'||p_client_story_id::text,0));
  v_story:=public.create_story_from_content(p_video_id,p_composition,p_client_story_id);
  perform private.story_install_definitions(v_story,p_interactive_definitions);
  return v_story;
end;
$$;
revoke all on function public.create_story_from_content(uuid,jsonb,uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.create_story_from_content(uuid,jsonb,uuid,jsonb) to authenticated;

-- Move the existing implementations behind narrow authorization wrappers.
-- The original chat, preview, reporting and view authorities are reused verbatim.
alter function public.mark_story_viewed(uuid) set schema private;
alter function private.mark_story_viewed(uuid) rename to story_mark_viewed_core;
alter function private.story_mark_viewed_core(uuid) set search_path = '';
revoke all on function private.story_mark_viewed_core(uuid) from public, anon, authenticated, service_role;
create function public.mark_story_viewed(p_story_id uuid)
returns table(status text,viewed_at timestamptz) language plpgsql security definer set search_path = '' as $$
begin
  if not private.story_can_access(p_story_id,false) then raise exception using errcode='42501',message='story_not_visible'; end if;
  return query select * from private.story_mark_viewed_core(p_story_id);
end;
$$;
revoke all on function public.mark_story_viewed(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mark_story_viewed(uuid) to authenticated;

alter function public.get_story_shared_content(uuid) set schema private;
alter function private.get_story_shared_content(uuid) rename to story_shared_content_core;
alter function private.story_shared_content_core(uuid) set search_path = '';
revoke all on function private.story_shared_content_core(uuid) from public, anon, authenticated, service_role;
create function public.get_story_shared_content(p_story_id uuid)
returns table(status text,source_video_id uuid,content_type text,owner_id uuid,username text,avatar_url text,caption text,preview_url text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.story_can_access(p_story_id,false) then raise exception using errcode='42501',message='story_not_visible'; end if;
  return query select * from private.story_shared_content_core(p_story_id);
end;
$$;
revoke all on function public.get_story_shared_content(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_story_shared_content(uuid) to authenticated;

alter function public.set_story_reaction(uuid,text) set schema private;
alter function private.set_story_reaction(uuid,text) rename to story_set_reaction_core;
create or replace function private.story_set_reaction_core(p_story_id uuid,p_reaction text)
returns table(status text,reaction text,updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid:=auth.uid(); v_owner uuid; v_expires_at timestamptz; v_prior text;
  v_updated_at timestamptz; v_deleted boolean;
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_story_id is null or (p_reaction is not null and p_reaction not in('heart','laugh','wow','sad','fire','clap')) then
    raise exception using errcode='22023',message='invalid_story_reaction';
  end if;
  select s.user_id,s.expires_at into v_owner,v_expires_at from public.stories s
    where s.id=p_story_id and private.admin_content_is_visible('story',s.id) for share;
  if v_owner is null or v_expires_at<=pg_catalog.now() then raise exception using errcode='42501',message='story_not_available'; end if;
  if v_owner=v_actor then raise exception using errcode='42501',message='story_owner_cannot_react'; end if;
  if not private.story_can_view_owner(v_owner) then raise exception using errcode='42501',message='story_not_visible'; end if;
  if p_reaction is null then
    delete from public.story_reactions r where r.story_id=p_story_id and r.reactor_id=v_actor
      returning r.updated_at into v_updated_at;
    v_deleted:=found;
    return query select case when v_deleted then 'removed' else 'unchanged' end::text,null::text,v_updated_at;
    return;
  end if;
  select r.reaction into v_prior from public.story_reactions r
    where r.story_id=p_story_id and r.reactor_id=v_actor for update;
  insert into public.story_reactions as r(story_id,reactor_id,reaction)
    values(p_story_id,v_actor,p_reaction)
    on conflict(story_id,reactor_id) do update set
      reaction=excluded.reaction,
      updated_at=case when r.reaction is distinct from excluded.reaction
        then pg_catalog.clock_timestamp() else r.updated_at end
    returning r.updated_at into v_updated_at;
  return query select case when v_prior=p_reaction then 'unchanged' else 'set' end::text,p_reaction,v_updated_at;
end;
$$;
revoke all on function private.story_set_reaction_core(uuid,text) from public, anon, authenticated, service_role;
create function public.set_story_reaction(p_story_id uuid,p_reaction text)
returns table(status text,reaction text,updated_at timestamptz) language plpgsql security definer set search_path = '' as $$
declare v_prior text;
begin
  if not private.story_can_access(p_story_id,false) then raise exception using errcode='42501',message='story_not_visible'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('story-legacy-reaction:'||auth.uid()::text||':'||p_story_id::text,0));
  select r.reaction into v_prior from public.story_reactions r where r.story_id=p_story_id and r.reactor_id=auth.uid();
  if v_prior is distinct from p_reaction then perform private.story_consume_velocity(auth.uid(),'interaction'); end if;
  return query select * from private.story_set_reaction_core(p_story_id,p_reaction);
end;
$$;
revoke all on function public.set_story_reaction(uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.set_story_reaction(uuid,text) to authenticated;

alter function public.reply_to_story(uuid,uuid,text) set schema private;
alter function private.reply_to_story(uuid,uuid,text) rename to story_reply_core;
alter function private.story_reply_core(uuid,uuid,text) set search_path = '';
revoke all on function private.story_reply_core(uuid,uuid,text) from public, anon, authenticated, service_role;
create function public.reply_to_story(p_story_id uuid,p_client_message_id uuid,p_text text)
returns public.messages language plpgsql security definer set search_path = '' as $$
declare v_saved public.idempotency_keys; v_hash text; v_message public.messages;
begin
  if not private.story_can_access(p_story_id,false) then raise exception using errcode='42501',message='story_not_visible'; end if;
  if p_client_message_id is null then raise exception using errcode='22023',message='invalid_story_reply'; end if;
  v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(p_story_id,pg_catalog.btrim(p_text))::text,'UTF8')),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('story-reply:'||auth.uid()::text||':'||p_client_message_id::text,0));
  select * into v_saved from public.idempotency_keys where user_id=auth.uid() and operation_type='story_reply' and idempotency_key=p_client_message_id::text;
  if found then
    if v_saved.request_hash is distinct from v_hash then raise exception using errcode='23505',message='story_idempotency_conflict'; end if;
    return pg_catalog.jsonb_populate_record(null::public.messages,v_saved.response_body);
  end if;
  -- Chat already owns durable message identity, including older Story replies.
  if not exists(select 1 from public.messages where sender_id=auth.uid() and client_message_id=p_client_message_id) then
    perform private.story_consume_velocity(auth.uid(),'reply'); end if;
  select * into v_message from private.story_reply_core(p_story_id,p_client_message_id,p_text);
  insert into public.idempotency_keys(idempotency_key,operation_type,user_id,request_hash,status,response_body)
    values(p_client_message_id::text,'story_reply',auth.uid(),v_hash,'completed',pg_catalog.to_jsonb(v_message));
  return v_message;
end;
$$;
revoke all on function public.reply_to_story(uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.reply_to_story(uuid,uuid,text) to authenticated;

alter function public.report_story(uuid,text,text) set schema private;
alter function private.report_story(uuid,text,text) rename to story_report_core;
alter function private.story_report_core(uuid,text,text) set search_path = '';
revoke all on function private.story_report_core(uuid,text,text) from public, anon, authenticated, service_role;
create function public.report_story(p_story_id uuid,p_reason text,p_details text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_report uuid;
begin
  if not private.story_can_access(p_story_id,false) then raise exception using errcode='42501',message='story_not_visible'; end if;
  -- One canonical report per actor/Story. Retries preserve the first report's
  -- text and identity, even after its moderation workflow changes status.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('story-report:'||auth.uid()::text||':'||p_story_id::text,0));
  select id into v_report from public.reports where reporter_user_id=auth.uid()
    and reported_content_type='story' and reported_content_id=p_story_id order by created_at,id limit 1;
  if found then return v_report; end if;
  perform private.story_consume_velocity(auth.uid(),'report');
  return private.story_report_core(p_story_id,p_reason,p_details);
end;
$$;
revoke all on function public.report_story(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.report_story(uuid,text,text) to authenticated;
create index story_report_replay on public.reports(reporter_user_id,reported_content_id,created_at,id) where reported_content_type='story';

-- B1 media safety: photos remain on canonical private R2. New Story videos
-- use the existing private Cloudflare Stream authority and are never accepted
-- from the legacy R2 story_video lane. Historical R2 rows remain readable and
-- cleanable, but this migration creates no new R2 video allocation authority.
alter table public.video_assets
  drop constraint video_assets_purpose_check,
  drop constraint video_assets_duration_limit_check,
  drop constraint video_assets_creator_premium_contract_check,
  drop constraint video_assets_ready_invariants_check;

alter table public.video_assets
  add constraint video_assets_purpose_check check (
    purpose in ('feed_video','business_library','creator_premium_video','story_video')
  ),
  add constraint video_assets_duration_limit_check check (
    (purpose='creator_premium_video' and max_duration_seconds between 1 and 180)
    or (purpose='story_video' and max_duration_seconds=15)
    or (purpose not in ('creator_premium_video','story_video') and max_duration_seconds between 1 and 60)
  ),
  add constraint video_assets_creator_premium_contract_check check (
    purpose not in ('creator_premium_video','story_video')
    or (
      provider='cloudflare_stream' and visibility='private'
      and mime_type in ('video/mp4','video/quicktime','video/webm')
      and size_bytes between 1 and 200000000
      and (
        (purpose='creator_premium_video' and max_duration_seconds between 1 and 180)
        or (purpose='story_video' and max_duration_seconds=15)
      )
    )
  ),
  add constraint video_assets_ready_invariants_check check (
    (
      status='ready' and nullif(pg_catalog.btrim(cloudflare_uid),'') is not null
      and ready_at is not null and duration_seconds is not null
      and duration_seconds>0 and duration_seconds<=max_duration_seconds
      and (
        (purpose in ('creator_premium_video','story_video')
          and visibility='private' and hls_url is null and dash_url is null
          and thumbnail_url is null
          and (provider_metadata->'require_signed_urls'='true'::jsonb) is true)
        or
        (purpose not in ('creator_premium_video','story_video')
          and hls_url is not null and hls_url~'^https://'
          and (dash_url is null or dash_url~'^https://')
          and (thumbnail_url is null or thumbnail_url~'^https://'))
      )
    )
    or (status<>'ready' and hls_url is null and dash_url is null and thumbnail_url is null)
  );

alter table public.video_asset_links
  add constraint video_asset_links_story_shape_check check (
    entity_type<>'story' or (slot='media' and "position"=0)
  );
create unique index story_stream_video_story_uidx on public.video_asset_links(entity_id)
  where entity_type='story' and slot='media' and "position"=0;
create unique index story_stream_video_asset_uidx on public.video_asset_links(asset_id)
  where entity_type='story';

create or replace function public.reserve_stream_upload_asset(
  p_asset_id uuid,p_owner_id uuid,p_mime_type text,p_size_bytes bigint,
  p_original_filename text,p_purpose text
) returns text language plpgsql security definer set search_path='' as $$
declare v_recent_count integer;v_active_count integer;
begin
  if p_asset_id is null or p_owner_id is null
     or p_purpose not in('feed_video','business_library','creator_premium_video','story_video')
     or p_mime_type not in('video/mp4','video/quicktime','video/webm')
     or p_size_bytes not between 1 and 200000000 then
    raise exception using errcode='22023',message='invalid_stream_reservation';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text,0));
  select count(*) into v_recent_count from public.video_assets asset
    where asset.owner_id=p_owner_id and asset.created_at>=pg_catalog.now()-interval '60 seconds';
  if v_recent_count>=5 then return 'rate_limited';end if;
  select count(*) into v_active_count from public.video_assets asset
    where asset.owner_id=p_owner_id and asset.status in('pending','uploading','processing');
  if v_active_count>=3 then return 'active_limit_reached';end if;
  insert into public.video_assets(
    id,owner_id,provider,purpose,visibility,status,mime_type,size_bytes,
    original_filename,max_duration_seconds,upload_expires_at,lifecycle_contract_version
  ) values(
    p_asset_id,p_owner_id,'cloudflare_stream',p_purpose,
    case when p_purpose in('creator_premium_video','story_video') then 'private' else 'public' end,
    'pending',p_mime_type,p_size_bytes,p_original_filename,
    case when p_purpose='creator_premium_video' then 180 when p_purpose='story_video' then 15 else 60 end,
    pg_catalog.clock_timestamp()+interval '15 minutes',1
  );
  return 'created';
end;
$$;
revoke all on function public.reserve_stream_upload_asset(uuid,uuid,text,bigint,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.reserve_stream_upload_asset(uuid,uuid,text,bigint,text,text)
  to service_role;

create function private.guard_story_video_link_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_asset public.video_assets;v_story public.stories;
begin
  select * into v_asset from public.video_assets where id=new.asset_id for update;
  if not found then
    if new.entity_type='story' then raise exception using errcode='23503',message='story_video_asset_not_found';end if;
    return new;
  end if;
  if v_asset.purpose='story_video' and new.entity_type<>'story' then
    raise exception using errcode='23514',message='story_video_entity_required';
  end if;
  if new.entity_type<>'story' then return new;end if;
  select * into v_story from public.stories where id=new.entity_id for update;
  if not found then raise exception using errcode='23503',message='story_not_found';end if;
  if new.slot<>'media' or new."position"<>0 or new.owner_id is distinct from v_asset.owner_id
     or v_story.user_id is distinct from v_asset.owner_id or v_story.media_type<>'video'
     or v_story.story_kind<>'media' or v_asset.provider<>'cloudflare_stream'
     or v_asset.purpose<>'story_video' or v_asset.visibility<>'private'
     or v_asset.status<>'ready' or v_asset.deleted_at is not null
     or nullif(pg_catalog.btrim(v_asset.cloudflare_uid),'') is null
     or v_asset.ready_at is null or v_asset.duration_seconds is null
     or v_asset.duration_seconds<=0 or v_asset.duration_seconds>15
     or v_asset.max_duration_seconds<>15 or v_asset.hls_url is not null
     or v_asset.dash_url is not null or v_asset.thumbnail_url is not null
     or v_asset.provider_metadata->'require_signed_urls' is distinct from 'true'::jsonb then
    raise exception using errcode='23514',message='story_video_asset_invalid';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_story_video_link_v1() from public,anon,authenticated,service_role;
create trigger video_asset_links_guard_story_video
before insert or update on public.video_asset_links for each row
execute function private.guard_story_video_link_v1();

-- One create authority accepts either a READY private R2 Story image or a
-- READY private Stream Story video. Ambiguous UUIDs and R2 video are rejected.
create or replace function private.create_story_with_media_core(
  p_asset_id uuid,p_composition jsonb,p_client_story_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();v_story_id uuid;v_media public.media_assets;
  v_video public.video_assets;v_composition jsonb;v_media_matches integer;v_video_matches integer;
begin
  if v_actor is null then raise exception using errcode='42501',message='not_authenticated';end if;
  if p_asset_id is null then raise exception using errcode='22023',message='invalid_asset_id';end if;
  v_composition:=private.story_validate_composition(p_composition);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('story-media:'||p_asset_id::text,0));
  select count(*) into v_media_matches from public.media_assets where id=p_asset_id;
  select count(*) into v_video_matches from public.video_assets where id=p_asset_id;
  if v_media_matches+v_video_matches<>1 then
    raise exception using errcode='23514',message='story_asset_identity_ambiguous';
  end if;
  if p_client_story_id is not null then
    select s.id into v_story_id from public.stories s
    where s.user_id=v_actor and s.client_story_id=p_client_story_id
      and s.story_kind='media' and s.story_composition=v_composition
      and (exists(select 1 from public.media_asset_links l where l.entity_type='story'
        and l.entity_id=s.id and l.slot='media' and l.position=0 and l.asset_id=p_asset_id)
        or exists(select 1 from public.video_asset_links l where l.entity_type='story'
        and l.entity_id=s.id and l.slot='media' and l.position=0 and l.asset_id=p_asset_id));
    if v_story_id is not null then return v_story_id;end if;
    if exists(select 1 from public.stories s where s.user_id=v_actor and s.client_story_id=p_client_story_id) then
      raise exception using errcode='23505',message='story_idempotency_conflict';end if;
  end if;
  if v_media_matches=1 then
    select * into v_media from public.media_assets where id=p_asset_id for update;
    if v_media.owner_id<>v_actor or v_media.provider<>'r2' or v_media.media_kind<>'image'
       or v_media.purpose<>'story_image' or v_media.visibility<>'private'
       or v_media.public_url is not null or v_media.status<>'ready' or v_media.deleted_at is not null
       or nullif(pg_catalog.btrim(v_media.bucket_name),'') is null
       or nullif(pg_catalog.btrim(v_media.object_key),'') is null
       or v_media.mime_type not in('image/jpeg','image/png','image/webp')
       or v_media.size_bytes not between 1 and 25000000 then
      raise exception using errcode='42501',message='story_asset_not_ready_or_owned';end if;
    if exists(select 1 from public.media_asset_links where asset_id=p_asset_id) then
      raise exception using errcode='23505',message='story_asset_already_linked';end if;
    insert into public.stories(user_id,media_url,media_type,story_kind,story_composition,client_story_id)
      values(v_actor,null,'photo','media',v_composition,p_client_story_id) returning id into v_story_id;
    insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
      values(p_asset_id,'story',v_story_id,'media',0);
  else
    select * into v_video from public.video_assets where id=p_asset_id for update;
    if v_video.owner_id<>v_actor or v_video.provider<>'cloudflare_stream'
       or v_video.purpose<>'story_video' or v_video.visibility<>'private'
       or v_video.status<>'ready' or v_video.deleted_at is not null
       or nullif(pg_catalog.btrim(v_video.cloudflare_uid),'') is null
       or v_video.duration_seconds is null or v_video.duration_seconds<=0 or v_video.duration_seconds>15
       or v_video.max_duration_seconds<>15 or v_video.hls_url is not null
       or v_video.dash_url is not null or v_video.thumbnail_url is not null
       or v_video.provider_metadata->'require_signed_urls' is distinct from 'true'::jsonb then
      raise exception using errcode='42501',message='story_asset_not_ready_or_owned';end if;
    if exists(select 1 from public.video_asset_links where asset_id=p_asset_id) then
      raise exception using errcode='23505',message='story_asset_already_linked';end if;
    insert into public.stories(user_id,media_url,media_type,story_kind,story_composition,client_story_id)
      values(v_actor,null,'video','media',v_composition,p_client_story_id) returning id into v_story_id;
    insert into public.video_asset_links(asset_id,owner_id,entity_type,entity_id,slot,position)
      values(p_asset_id,v_actor,'story',v_story_id,'media',0);
  end if;
  return v_story_id;
end;
$$;
revoke all on function private.create_story_with_media_core(uuid,jsonb,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.delete_story(p_story_id uuid)
returns table(deleted_story_id uuid,media_asset_id uuid,media_cleanup_status text)
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();v_story public.stories;v_r2 uuid;v_stream uuid;
  v_owner uuid;v_cleanup text:='none';v_affected integer;
begin
  if v_actor is null then raise exception using errcode='42501',message='not_authenticated';end if;
  if p_story_id is null then raise exception using errcode='22023',message='invalid_story_id';end if;
  select * into v_story from public.stories where id=p_story_id and user_id=v_actor for update;
  if not found then raise exception using errcode='42501',message='story_not_found_or_not_owned';end if;
  select asset_id into v_r2 from public.media_asset_links where entity_type='story'
    and entity_id=v_story.id and slot='media' and position=0;
  select asset_id into v_stream from public.video_asset_links where entity_type='story'
    and entity_id=v_story.id and slot='media' and position=0;
  if v_r2 is not null and v_stream is not null then
    raise exception using errcode='55000',message='story_media_contract_invalid';end if;
  if v_r2 is not null then
    select owner_id into v_owner from public.media_assets where id=v_r2 for update;
    if v_owner is distinct from v_actor then raise exception using errcode='55000',message='story_media_contract_invalid';end if;
    delete from public.media_asset_links where asset_id=v_r2 and entity_type='story'
      and entity_id=v_story.id and slot='media' and position=0;
  elsif v_stream is not null then
    select owner_id into v_owner from public.video_assets where id=v_stream for update;
    if v_owner is distinct from v_actor then raise exception using errcode='55000',message='story_media_contract_invalid';end if;
    delete from public.video_asset_links where asset_id=v_stream and entity_type='story'
      and entity_id=v_story.id and slot='media' and position=0;
  end if;
  delete from public.stories where id=v_story.id and user_id=v_actor;
  get diagnostics v_affected=row_count;
  if v_affected<>1 then raise exception using errcode='55000',message='story_delete_failed';end if;
  if v_r2 is not null then v_cleanup:=public.schedule_media_asset_deletion(v_r2,v_actor);
  elsif v_stream is not null then v_cleanup:=public.schedule_video_asset_deletion_v1(v_stream,v_actor);
  end if;
  if v_cleanup not in('none','scheduled','deleted','asset_in_use') then
    raise exception using errcode='55000',message='story_media_schedule_failed';end if;
  return query select v_story.id,coalesce(v_r2,v_stream),v_cleanup;
end;
$$;
revoke all on function public.delete_story(uuid) from public,anon,authenticated,service_role;
grant execute on function public.delete_story(uuid) to authenticated;

create or replace function private.story_current_fingerprint(p_story_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'story',s.id,'owner',s.user_id,'kind',s.story_kind,'source',s.shared_video_id,
    'legacy',s.media_url,'type',s.media_type,'composition',s.story_composition,
    'definitions',(select pg_catalog.jsonb_agg(e.definition_digest order by e.element_id)
      from private.story_interactive_elements e where e.story_id=s.id),
    'r2',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'link',l.id,'id',a.id,'owner',a.owner_id,'status',a.status,'provider',a.provider,
        'purpose',a.purpose,'visibility',a.visibility,'bucket',a.bucket_name,'key',a.object_key,
        'mime',a.mime_type,'size',a.size_bytes,
        'contract',a.lifecycle_contract_version) order by l.id)
      from public.media_asset_links l join public.media_assets a on a.id=l.asset_id
      where l.entity_type='story' and l.entity_id=s.id and l.slot='media' and l.position=0),
    'stream',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'link',l.id,'id',a.id,'owner',a.owner_id,'status',a.status,'provider',a.provider,
        'purpose',a.purpose,'visibility',a.visibility,'uid',a.cloudflare_uid,
        'mime',a.mime_type,'size',a.size_bytes,'duration',a.duration_seconds,
        'max_duration',a.max_duration_seconds,
        'signed',a.provider_metadata->'require_signed_urls',
        'contract',a.lifecycle_contract_version) order by l.id)
      from public.video_asset_links l join public.video_assets a on a.id=l.asset_id
      where l.entity_type='story' and l.entity_id=s.id and l.slot='media' and l.position=0)
  )::text,'UTF8')),'hex') from public.stories s where s.id=p_story_id;
$$;
revoke all on function private.story_current_fingerprint(uuid) from public,anon,authenticated,service_role;

-- Preserve every non-Story snapshot branch verbatim. The wrapper replaces only
-- Story content_version with the final media/definition fingerprint.
alter function private.content_safety_target_snapshot(text,uuid)
  rename to content_safety_target_snapshot_b1_core;
create function private.content_safety_target_snapshot(p_target_type text,p_target_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_snapshot jsonb;v_r2 uuid;v_stream uuid;
begin
  v_snapshot:=private.content_safety_target_snapshot_b1_core(p_target_type,p_target_id);
  if p_target_type<>'story' or v_snapshot is null then return v_snapshot;end if;
  select l.asset_id into v_r2 from public.media_asset_links l where l.entity_type='story'
    and l.entity_id=p_target_id and l.slot='media' and l.position=0;
  select l.asset_id into v_stream from public.video_asset_links l where l.entity_type='story'
    and l.entity_id=p_target_id and l.slot='media' and l.position=0;
  return v_snapshot||pg_catalog.jsonb_build_object(
    'content_version',private.story_current_fingerprint(p_target_id),
    'media_asset_id',v_r2,'video_asset_id',v_stream
  );
end;
$$;
revoke all on function private.content_safety_target_snapshot(text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.content_safety_target_snapshot_b1_core(text,uuid)
  from public,anon,authenticated,service_role;

-- Extend only the Story direct-media branch. Shared Stories continue through
-- the historical source scan; every other target delegates to the prior core.
alter function private.content_safety_audio_source(text,uuid)
  rename to content_safety_audio_source_b1_core;
create function private.content_safety_audio_source(p_target_type text,p_target_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_story public.stories;v_asset public.video_assets;v_image public.media_assets;
  v_r2_count integer;v_stream_count integer;
begin
  if p_target_type<>'story' then
    return private.content_safety_audio_source_b1_core(p_target_type,p_target_id);end if;
  select * into v_story from public.stories where id=p_target_id;
  if not found or v_story.shared_video_id is not null then
    return private.content_safety_audio_source_b1_core(p_target_type,p_target_id);end if;
  select count(*)::integer into v_r2_count from public.media_asset_links l
    where l.entity_type='story' and l.entity_id=v_story.id and l.slot='media' and l.position=0;
  select count(*)::integer into v_stream_count from public.video_asset_links l
    where l.entity_type='story' and l.entity_id=v_story.id and l.slot='media' and l.position=0;
  if v_r2_count+v_stream_count<>1 then
    return pg_catalog.jsonb_build_object('kind','not_configured','reason',
      case when v_r2_count+v_stream_count=0 then 'story_media_source_incomplete'
        else 'story_media_source_ambiguous' end);
  end if;
  select a.* into v_asset from public.video_asset_links l
    join public.video_assets a on a.id=l.asset_id
    where l.entity_type='story' and l.entity_id=v_story.id and l.slot='media'
      and l.position=0 and l.owner_id=v_story.user_id and a.owner_id=v_story.user_id
      and a.purpose='story_video' limit 1;
  if found and v_asset.provider='cloudflare_stream' and v_asset.visibility='private'
     and v_asset.status='ready' and v_asset.deleted_at is null
     and nullif(pg_catalog.btrim(v_asset.cloudflare_uid),'') is not null
     and v_asset.mime_type in('video/mp4','video/quicktime','video/webm')
     and v_asset.duration_seconds>0 and v_asset.duration_seconds<=15
     and v_asset.max_duration_seconds=15
     and v_asset.provider_metadata->'require_signed_urls'='true'::jsonb
     and v_asset.hls_url is null and v_asset.dash_url is null and v_asset.thumbnail_url is null then
    return pg_catalog.jsonb_build_object('kind','eligible','source_asset_id',v_asset.id,
      'cloudflare_uid',v_asset.cloudflare_uid,'duration_seconds',v_asset.duration_seconds,
      'provider',v_asset.provider,'purpose','story_video',
      'model','@cf/openai/whisper-large-v3-turbo');
  end if;
  select a.* into v_image from public.media_asset_links l join public.media_assets a on a.id=l.asset_id
    where l.entity_type='story' and l.entity_id=v_story.id and l.slot='media' and l.position=0
      and a.owner_id=v_story.user_id and a.purpose='story_image' limit 1;
  if found and v_image.provider='r2' and v_image.visibility='private'
     and v_image.status='ready' and v_image.deleted_at is null
     and v_image.media_kind='image' and v_image.mime_type in('image/jpeg','image/png','image/webp') then
    return pg_catalog.jsonb_build_object('kind','not_applicable','reason','canonical_image');end if;
  return pg_catalog.jsonb_build_object('kind','not_configured','reason','story_audio_source_incomplete');
end;
$$;
revoke all on function private.content_safety_audio_source(text,uuid) from public,anon,authenticated,service_role;
revoke all on function private.content_safety_audio_source_b1_core(text,uuid) from public,anon,authenticated,service_role;

alter function private.content_safety_visual_source(text,uuid)
  rename to content_safety_visual_source_b1_core;
create function private.content_safety_visual_source(p_target_type text,p_target_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_story public.stories;v_video public.video_assets;v_image public.media_assets;
  v_r2_count integer;v_stream_count integer;
begin
  if p_target_type<>'story' then
    return private.content_safety_visual_source_b1_core(p_target_type,p_target_id);end if;
  select * into v_story from public.stories where id=p_target_id;
  if not found or v_story.shared_video_id is not null then
    return private.content_safety_visual_source_b1_core(p_target_type,p_target_id);end if;
  select count(*)::integer into v_r2_count from public.media_asset_links l
    where l.entity_type='story' and l.entity_id=v_story.id and l.slot='media' and l.position=0;
  select count(*)::integer into v_stream_count from public.video_asset_links l
    where l.entity_type='story' and l.entity_id=v_story.id and l.slot='media' and l.position=0;
  if v_r2_count+v_stream_count<>1 then
    return pg_catalog.jsonb_build_object('kind','not_configured','reason',
      case when v_r2_count+v_stream_count=0 then 'story_media_source_incomplete'
        else 'story_media_source_ambiguous' end);
  end if;
  select a.* into v_image from public.media_asset_links l join public.media_assets a on a.id=l.asset_id
    where l.entity_type='story' and l.entity_id=v_story.id and l.slot='media' and l.position=0
      and a.owner_id=v_story.user_id and a.purpose='story_image' limit 1;
  if found and v_image.provider='r2' and v_image.status='ready' and v_image.deleted_at is null
     and v_image.visibility='private' and v_image.public_url is null and v_image.media_kind='image'
     and v_image.mime_type in('image/jpeg','image/png','image/webp')
     and nullif(pg_catalog.btrim(v_image.bucket_name),'') is not null
     and nullif(pg_catalog.btrim(v_image.object_key),'') is not null
     and v_image.size_bytes between 1 and 25000000 then
    return pg_catalog.jsonb_build_object('kind','eligible_image','media_asset_id',v_image.id,
      'bucket_name',v_image.bucket_name,'object_key',v_image.object_key,
      'mime_type',v_image.mime_type,'size_bytes',v_image.size_bytes,'purpose','story_image');
  end if;
  select a.* into v_video from public.video_asset_links l join public.video_assets a on a.id=l.asset_id
    where l.entity_type='story' and l.entity_id=v_story.id and l.slot='media' and l.position=0
      and l.owner_id=v_story.user_id and a.owner_id=v_story.user_id and a.purpose='story_video' limit 1;
  if found and v_video.provider='cloudflare_stream' and v_video.status='ready'
     and v_video.deleted_at is null and v_video.visibility='private'
     and v_video.provider_metadata->'require_signed_urls'='true'::jsonb
     and nullif(pg_catalog.btrim(v_video.cloudflare_uid),'') is not null
     and v_video.mime_type in('video/mp4','video/quicktime','video/webm')
     and v_video.duration_seconds>0 and v_video.duration_seconds<=15
     and v_video.max_duration_seconds=15 and v_video.hls_url is null
     and v_video.dash_url is null and v_video.thumbnail_url is null then
    return pg_catalog.jsonb_build_object('kind','eligible_stream_video','video_asset_id',v_video.id,
      'cloudflare_uid',v_video.cloudflare_uid,'duration_seconds',v_video.duration_seconds,
      'mime_type',v_video.mime_type,'purpose','story_video');
  end if;
  return pg_catalog.jsonb_build_object('kind','not_configured','reason','story_visual_source_incomplete');
end;
$$;
revoke all on function private.content_safety_visual_source(text,uuid) from public,anon,authenticated,service_role;
revoke all on function private.content_safety_visual_source_b1_core(text,uuid) from public,anon,authenticated,service_role;

alter function private.enqueue_content_safety_scan(text,uuid,text)
  rename to enqueue_content_safety_scan_b1_core;
create function private.enqueue_content_safety_scan(
  p_target_type text,p_target_id uuid,p_requested_reason text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_scan_id uuid;v_audio jsonb;v_visual jsonb;
begin
  v_scan_id:=private.enqueue_content_safety_scan_b1_core(
    p_target_type,p_target_id,p_requested_reason
  );
  if p_target_type<>'story' or v_scan_id is null then return v_scan_id;end if;
  v_audio:=private.content_safety_audio_source('story',p_target_id);
  v_visual:=private.content_safety_visual_source('story',p_target_id);
  update private.content_safety_scans scan set
    audio_status=case v_audio->>'kind'
      when 'eligible' then 'pending' when 'not_applicable' then 'not_applicable'
      when 'shared_video' then scan.audio_status else 'not_configured' end,
    audio_provider=case when v_audio->>'kind'='eligible' then 'cloudflare_workers_ai' else scan.audio_provider end,
    audio_model=case when v_audio->>'kind'='eligible' then '@cf/openai/whisper-large-v3-turbo' else scan.audio_model end,
    audio_source_asset_id=case when v_audio->>'source_asset_id' is null then scan.audio_source_asset_id
      else (v_audio->>'source_asset_id')::uuid end,
    audio_available_at=case when v_audio->>'kind'='eligible' then pg_catalog.clock_timestamp() else scan.audio_available_at end,
    audio_last_error_code=case when v_audio->>'kind' in('eligible','not_applicable','shared_video') then null
      else coalesce(v_audio->>'reason','story_audio_source_incomplete') end,
    visual_status=case when v_visual->>'kind' in('eligible_image','eligible_stream_video') then 'pending'
      when v_visual->>'kind' in('shared_image','shared_stream_video') then scan.visual_status else 'not_configured' end,
    visual_provider=case when v_visual->>'kind' in('eligible_image','eligible_stream_video')
      then 'cloudflare_workers_ai' else scan.visual_provider end,
    visual_model=case when v_visual->>'kind' in('eligible_image','eligible_stream_video')
      then '@cf/google/gemma-4-26b-a4b-it' else scan.visual_model end,
    visual_prompt_version=case when v_visual->>'kind' in('eligible_image','eligible_stream_video')
      then 'visual-safety-v1' else scan.visual_prompt_version end,
    visual_source_kind=case when v_visual->>'kind' in('eligible_image','eligible_stream_video')
      then v_visual->>'kind' else scan.visual_source_kind end,
    visual_video_asset_id=case when v_visual->>'video_asset_id' is null then scan.visual_video_asset_id
      else (v_visual->>'video_asset_id')::uuid end,
    visual_media_asset_id=case when v_visual->>'media_asset_id' is null then scan.visual_media_asset_id
      else (v_visual->>'media_asset_id')::uuid end,
    visual_analysis_id=case when v_visual->>'kind' in('eligible_image','eligible_stream_video') then null
      else scan.visual_analysis_id end,
    visual_frame_cursor=case when v_visual->>'kind' in('eligible_image','eligible_stream_video') then 0
      else scan.visual_frame_cursor end,
    visual_partial_result=case when v_visual->>'kind' in('eligible_image','eligible_stream_video') then null
      else scan.visual_partial_result end,
    visual_provider_call_count=case when v_visual->>'kind' in('eligible_image','eligible_stream_video') then 0
      else scan.visual_provider_call_count end,
    visual_attempt_count=case when v_visual->>'kind' in('eligible_image','eligible_stream_video') then 0
      else scan.visual_attempt_count end,
    visual_available_at=case when v_visual->>'kind' in('eligible_image','eligible_stream_video')
      then pg_catalog.clock_timestamp() else scan.visual_available_at end,
    visual_last_error_code=case when v_visual->>'kind' in('eligible_image','eligible_stream_video','shared_image','shared_stream_video') then null
      else coalesce(v_visual->>'reason','story_visual_source_incomplete') end,
    updated_at=pg_catalog.clock_timestamp()
  where scan.id=v_scan_id;
  return v_scan_id;
end;
$$;
revoke all on function private.enqueue_content_safety_scan(text,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function private.enqueue_content_safety_scan_b1_core(text,uuid,text)
  from public,anon,authenticated,service_role;

create function private.story_enqueue_media_safety_v1(p_story_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_scan uuid;v_fingerprint text;v_analysis uuid;
begin
  v_fingerprint:=private.story_current_fingerprint(p_story_id);
  if v_fingerprint is null then raise exception using errcode='P0002',message='story_not_found';end if;
  v_scan:=private.enqueue_content_safety_scan('story',p_story_id,'content_updated');
  if v_scan is null then raise exception using errcode='55000',message='story_safety_enqueue_failed';end if;
  update private.story_safety_state state set
    generation=case
      when state.scan_id is distinct from v_scan
        or state.evidence_fingerprint is distinct from v_fingerprint
      then state.generation+1 else state.generation end,
    state='pending',scan_id=v_scan,evidence_generation=null,
    evidence_fingerprint=v_fingerprint,policy_digest=null,
    visual_complete=false,audio_complete=false,text_complete=false,
    decided_at=null,updated_at=pg_catalog.clock_timestamp()
  where state.story_id=p_story_id;
  -- Reuse immutable visual evidence only after the final Story link and
  -- fingerprint have been hydrated. The attachment authority revalidates the
  -- current Story/asset fence before changing scan state.
  select private.content_safety_visual_analysis_id_for_asset(
    scan.visual_video_asset_id,scan.visual_media_asset_id,'visual-safety-v1'
  ) into v_analysis
  from private.content_safety_scans scan where scan.id=v_scan;
  if v_analysis is not null then
    perform private.content_safety_attach_visual_analysis(v_analysis);
  end if;
  return v_scan;
end;
$$;
revoke all on function private.story_enqueue_media_safety_v1(uuid)
  from public,anon,authenticated,service_role;
comment on function private.story_enqueue_media_safety_v1(uuid) is
  'Hydrates final Story media/definition evidence. missing_owner_approved_story_policy remains fail-closed and never converts completed scans to passed.';

create function private.story_content_safety_scan_fence_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_snapshot jsonb;v_expected text;
begin
  if new.target_type<>'story' then return new;end if;
  if (new.audio_status='analyzed' and old.audio_status is distinct from 'analyzed')
     or (new.visual_status='analyzed' and old.visual_status is distinct from 'analyzed')
     or (new.text_status='analyzed' and old.text_status is distinct from 'analyzed') then
    v_snapshot:=private.content_safety_target_snapshot('story',new.target_id);
    if v_snapshot is null then raise exception using errcode='55000',message='story_safety_target_missing';end if;
    v_expected:=private.content_safety_sha256(
      'story|'||new.target_id::text||'|'||coalesce(v_snapshot->>'content_version','')
    );
    if new.content_fingerprint is distinct from v_expected then
      raise exception using errcode='55000',message='story_safety_stale_evidence';
    end if;
    if not exists(select 1 from private.story_safety_state state
      where state.story_id=new.target_id and state.scan_id=new.id
        and state.evidence_fingerprint=private.story_current_fingerprint(new.target_id)) then
      raise exception using errcode='55000',message='story_safety_stale_generation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.story_content_safety_scan_fence_v1()
  from public,anon,authenticated,service_role;
create trigger content_safety_story_scan_fence_b1
before update on private.content_safety_scans for each row
execute function private.story_content_safety_scan_fence_v1();

create function private.story_sync_safety_from_scan_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_current text;v_visual boolean;v_audio boolean;v_text boolean;
begin
  if new.target_type<>'story' then return new;end if;
  v_current:=private.story_current_fingerprint(new.target_id);
  if v_current is null then return new;end if;
  v_visual:=new.visual_status in('analyzed','not_applicable');
  v_audio:=new.audio_status in('analyzed','not_applicable');
  v_text:=new.text_status='analyzed';
  update private.story_safety_state state set
    scan_id=new.id,
    evidence_fingerprint=v_current,
    visual_complete=v_visual,audio_complete=v_audio,text_complete=v_text,
    evidence_generation=case when v_visual and v_audio and v_text then state.generation else null end,
    -- Evidence completion is triage only. No owner-approved Story policy is
    -- installed in B1, so even complete evidence remains human review.
    state=case when v_visual and v_audio and v_text then 'review' else 'pending' end,
    policy_digest=null,decided_at=null,updated_at=pg_catalog.clock_timestamp()
  where state.story_id=new.target_id
    and state.scan_id=new.id
    and new.content_fingerprint=private.content_safety_sha256(
      'story|'||new.target_id::text||'|'||v_current
    );
  return new;
end;
$$;
revoke all on function private.story_sync_safety_from_scan_v1()
  from public,anon,authenticated,service_role;
create trigger content_safety_story_sync_b1
after insert or update on private.content_safety_scans for each row
execute function private.story_sync_safety_from_scan_v1();

-- Re-run the final enqueue after both the physical link and interactive
-- definitions exist. The earlier global trigger remains for shared/update
-- paths, but its pre-link fingerprint can never make a Story visible.
create or replace function public.create_story_with_media(
  p_asset_id uuid,p_composition jsonb,p_client_story_id uuid,p_interactive_definitions jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_story uuid;
begin
  if auth.uid() is null or p_client_story_id is null then
    raise exception using errcode='22023',message='invalid_story_identity';end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('story-create:'||auth.uid()::text||':'||p_client_story_id::text,0)
  );
  v_story:=private.create_story_with_media_core(p_asset_id,p_composition,p_client_story_id);
  perform private.story_install_definitions(v_story,p_interactive_definitions);
  perform private.story_enqueue_media_safety_v1(v_story);
  return v_story;
end;
$$;

create or replace function public.create_story_with_media(
  p_asset_id uuid,p_composition jsonb,p_client_story_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_story uuid;
begin
  v_story:=private.create_story_with_media_core(p_asset_id,p_composition,p_client_story_id);
  perform private.story_enqueue_media_safety_v1(v_story);
  return v_story;
end;
$$;

create or replace function public.create_story_with_media(p_asset_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_story uuid;
begin
  v_story:=private.create_story_with_media_core(
    p_asset_id,'{"version":1,"elements":[]}'::jsonb,null
  );
  perform private.story_enqueue_media_safety_v1(v_story);
  return v_story;
end;
$$;

create or replace function public.create_story_from_content(
  p_video_id uuid,p_composition jsonb,p_client_story_id uuid,p_interactive_definitions jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_story uuid;
begin
  if auth.uid() is null or p_client_story_id is null then
    raise exception using errcode='22023',message='invalid_story_identity';end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('story-create:'||auth.uid()::text||':'||p_client_story_id::text,0)
  );
  v_story:=public.create_story_from_content(p_video_id,p_composition,p_client_story_id);
  perform private.story_install_definitions(v_story,p_interactive_definitions);
  perform private.story_enqueue_media_safety_v1(v_story);
  return v_story;
end;
$$;

-- A durable cursor, serialized per worker, keeps the established and Story
-- queues progressing even when unrelated transactions consume XIDs between
-- worker polls. It is scheduling metadata only; the canonical claim and
-- cleanup RPCs remain the sole authorities for their operations.
create table private.story_b1_worker_lane_state(
  worker_name text primary key check(worker_name in('audio','visual','stream_cleanup')),
  next_lane text not null check(next_lane in('story','core')),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table private.story_b1_worker_lane_state enable row level security;
alter table private.story_b1_worker_lane_state force row level security;
revoke all on private.story_b1_worker_lane_state from public,anon,authenticated,service_role;

create function private.story_b1_take_worker_lane_v1(p_worker_name text)
returns text language plpgsql security definer set search_path='' as $$
declare v_lane text;
begin
  if p_worker_name not in('audio','visual','stream_cleanup') then
    raise exception using errcode='22023',message='invalid_story_worker_lane';end if;
  insert into private.story_b1_worker_lane_state(worker_name,next_lane)
  values(p_worker_name,'story') on conflict(worker_name) do nothing;
  select state.next_lane into v_lane
  from private.story_b1_worker_lane_state state
  where state.worker_name=p_worker_name for update;
  update private.story_b1_worker_lane_state set
    next_lane=case v_lane when 'story' then 'core' else 'story' end,
    updated_at=pg_catalog.clock_timestamp()
  where worker_name=p_worker_name;
  return v_lane;
end;
$$;
revoke all on function private.story_b1_take_worker_lane_v1(text)
  from public,anon,authenticated,service_role;

-- Audio claims use the same public RPC. Story direct video is claimed from the
-- private signed Stream lane; all historical targets delegate to the prior
-- implementation unchanged.
alter function public.claim_content_safety_audio_scans(integer) set schema private;
alter function private.claim_content_safety_audio_scans(integer)
  rename to claim_content_safety_audio_scans_b1_core;
create function public.claim_content_safety_audio_scans(p_limit integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row record;v_core jsonb;v_story_first boolean;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='content_safety_service_role_required';end if;
  if p_limit<1 or p_limit>1 then raise exception using errcode='22023',message='invalid_audio_claim_limit';end if;
  v_story_first:=private.story_b1_take_worker_lane_v1('audio')='story';
  if not v_story_first then
    v_core:=private.claim_content_safety_audio_scans_b1_core(p_limit);
    if pg_catalog.jsonb_array_length(v_core)>0 then return v_core;end if;
  end if;
  select scan.id,scan.target_type,scan.target_id,scan.content_fingerprint,
    scan.audio_source_asset_id,scan.audio_attempt_count,asset.cloudflare_uid,asset.duration_seconds
  into v_row from private.content_safety_scans scan
  join public.video_assets asset on asset.id=scan.audio_source_asset_id
  where scan.target_type='story' and scan.audio_status='pending'
    and scan.content_fingerprint=private.content_safety_sha256(
      'story|'||scan.target_id::text||'|'||coalesce(private.story_current_fingerprint(scan.target_id),'')
    )
    and scan.audio_attempt_count<5 and scan.audio_available_at<=pg_catalog.clock_timestamp()
    and (scan.audio_started_at is null or scan.audio_started_at<pg_catalog.clock_timestamp()-interval '10 minutes')
    and asset.provider='cloudflare_stream' and asset.purpose='story_video'
    and asset.visibility='private' and asset.status='ready' and asset.deleted_at is null
    and asset.provider_metadata->'require_signed_urls'='true'::jsonb
    and asset.hls_url is null and asset.dash_url is null and asset.thumbnail_url is null
    and asset.duration_seconds>0 and asset.duration_seconds<=15
  order by scan.audio_available_at,scan.created_at,scan.id
  for update of scan skip locked limit 1;
  if found then
    update private.content_safety_scans set audio_attempt_count=audio_attempt_count+1,
      audio_started_at=pg_catalog.clock_timestamp(),audio_last_error_code=null,
      updated_at=pg_catalog.clock_timestamp() where id=v_row.id;
    return pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'scan_id',v_row.id,'target_type',v_row.target_type,'target_id',v_row.target_id,
      'content_fingerprint',v_row.content_fingerprint,'source_asset_id',v_row.audio_source_asset_id,
      'cloudflare_uid',v_row.cloudflare_uid,'duration_seconds',v_row.duration_seconds,
      'purpose','story_video','attempt_count',v_row.audio_attempt_count+1));
  end if;
  if v_story_first then
    return private.claim_content_safety_audio_scans_b1_core(p_limit);
  end if;
  return coalesce(v_core,'[]'::jsonb);
end;
$$;
revoke all on function public.claim_content_safety_audio_scans(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.claim_content_safety_audio_scans(integer) to service_role;
revoke all on function private.claim_content_safety_audio_scans_b1_core(integer)
  from public,anon,authenticated,service_role;

alter function public.complete_content_safety_audio_transcription(
  uuid,uuid,text,text,text,integer,jsonb,boolean,text,boolean
) set schema private;
alter function private.complete_content_safety_audio_transcription(
  uuid,uuid,text,text,text,integer,jsonb,boolean,text,boolean
) rename to complete_content_safety_audio_transcription_b1_core;
create function public.complete_content_safety_audio_transcription(
  p_scan_id uuid,p_source_asset_id uuid,p_content_fingerprint text,
  p_detected_language text,p_transcript_text text,p_word_count integer,
  p_segments jsonb,p_no_speech boolean,p_transcript_fingerprint text,
  p_cleanup_pending boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_scan private.content_safety_scans;v_transcript_id uuid;v_snapshot jsonb;v_expected text;
begin
  select * into v_scan from private.content_safety_scans where id=p_scan_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_audio_scan_not_found';end if;
  if v_scan.target_type<>'story' then
    return private.complete_content_safety_audio_transcription_b1_core(
      p_scan_id,p_source_asset_id,p_content_fingerprint,p_detected_language,
      p_transcript_text,p_word_count,p_segments,p_no_speech,
      p_transcript_fingerprint,p_cleanup_pending);end if;
  v_snapshot:=private.content_safety_target_snapshot('story',v_scan.target_id);
  v_expected:=private.content_safety_sha256(
    'story|'||v_scan.target_id::text||'|'||coalesce(v_snapshot->>'content_version','')
  );
  if v_scan.audio_status<>'pending' or v_scan.audio_source_asset_id is distinct from p_source_asset_id
     or v_scan.content_fingerprint is distinct from p_content_fingerprint
     or v_scan.content_fingerprint is distinct from v_expected
     or p_transcript_fingerprint!~'^[0-9a-f]{64}$' or p_word_count<0
     or pg_catalog.jsonb_typeof(p_segments)<>'array' or pg_catalog.pg_column_size(p_segments)>65536
     or pg_catalog.char_length(coalesce(p_transcript_text,''))>100000 then
    raise exception using errcode='22023',message='invalid_content_safety_audio_completion';end if;
  insert into private.content_safety_audio_transcripts(
    source_scan_id,source_asset_id,source_content_fingerprint,provider,model,
    detected_language,transcript_text,word_count,segments,no_speech,
    transcript_fingerprint,rule_eval_status,rule_eval_available_at
  ) values(
    v_scan.id,p_source_asset_id,p_content_fingerprint,'cloudflare_workers_ai',
    '@cf/openai/whisper-large-v3-turbo',nullif(pg_catalog.btrim(coalesce(p_detected_language,'')),''),
    coalesce(p_transcript_text,''),p_word_count,p_segments,coalesce(p_no_speech,false),
    p_transcript_fingerprint,'pending',pg_catalog.clock_timestamp()
  ) on conflict(source_scan_id,source_content_fingerprint,provider,model)
    do update set updated_at=pg_catalog.clock_timestamp()
  returning id into v_transcript_id;
  update private.content_safety_scans set audio_status='analyzed',
    audio_provider='cloudflare_workers_ai',audio_model='@cf/openai/whisper-large-v3-turbo',
    audio_completed_at=pg_catalog.clock_timestamp(),audio_started_at=null,audio_last_error_code=null,
    audio_cleanup_pending=coalesce(p_cleanup_pending,false),
    audio_cleanup_attempt_count=case when coalesce(p_cleanup_pending,false) then 0 else audio_cleanup_attempt_count end,
    audio_cleanup_available_at=case when coalesce(p_cleanup_pending,false)
      then pg_catalog.clock_timestamp()+interval '1 minute' else null end,
    audio_provider_call_count=audio_provider_call_count+1,updated_at=pg_catalog.clock_timestamp()
  where id=v_scan.id;
  return pg_catalog.jsonb_build_object('scan_id',v_scan.id,'transcript_id',v_transcript_id,
    'audio_status','analyzed','cleanup_pending',coalesce(p_cleanup_pending,false));
end;
$$;
revoke all on function public.complete_content_safety_audio_transcription(
  uuid,uuid,text,text,text,integer,jsonb,boolean,text,boolean
) from public,anon,authenticated,service_role;
grant execute on function public.complete_content_safety_audio_transcription(
  uuid,uuid,text,text,text,integer,jsonb,boolean,text,boolean
) to service_role;
revoke all on function private.complete_content_safety_audio_transcription_b1_core(
  uuid,uuid,text,text,text,integer,jsonb,boolean,text,boolean
) from public,anon,authenticated,service_role;

alter function private.claim_content_safety_visual_scans_for_prompts(integer,text[])
  rename to claim_content_safety_visual_scans_for_prompts_b1_core;
create function private.claim_content_safety_visual_scans_for_prompts(
  p_limit integer,p_prompt_versions text[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row record;v_core jsonb;v_story_first boolean;
begin
  if p_limit<1 or p_limit>1 then raise exception using errcode='22023',message='invalid_visual_claim_limit';end if;
  if not ('visual-safety-v1'=any(p_prompt_versions)) then
    return private.claim_content_safety_visual_scans_for_prompts_b1_core(p_limit,p_prompt_versions);end if;
  v_story_first:=private.story_b1_take_worker_lane_v1('visual')='story';
  if not v_story_first then
    v_core:=private.claim_content_safety_visual_scans_for_prompts_b1_core(p_limit,p_prompt_versions);
    if pg_catalog.jsonb_array_length(v_core)>0 then return v_core;end if;
  end if;
  select scan.id,scan.target_type,scan.target_id,scan.content_fingerprint,
    scan.visual_source_kind,scan.visual_video_asset_id,scan.visual_media_asset_id,
    scan.visual_prompt_version,scan.visual_attempt_count,scan.visual_provider_call_count,
    scan.visual_frame_cursor,scan.visual_partial_result,video.cloudflare_uid,
    video.duration_seconds,media.bucket_name,media.object_key,media.mime_type,media.size_bytes
  into v_row from private.content_safety_scans scan
  left join public.video_assets video on video.id=scan.visual_video_asset_id
  left join public.media_assets media on media.id=scan.visual_media_asset_id
  where scan.target_type='story' and scan.visual_prompt_version='visual-safety-v1'
    and scan.content_fingerprint=private.content_safety_sha256(
      'story|'||scan.target_id::text||'|'||coalesce(private.story_current_fingerprint(scan.target_id),'')
    )
    and scan.visual_status='pending' and scan.visual_analysis_id is null
    and scan.visual_attempt_count<5 and scan.visual_provider_call_count<5
    and scan.visual_available_at<=pg_catalog.clock_timestamp()
    and (scan.visual_started_at is null or scan.visual_started_at<pg_catalog.clock_timestamp()-interval '10 minutes')
    and scan.id=private.content_safety_visual_producer_scan_id(
      scan.visual_video_asset_id,scan.visual_media_asset_id,scan.visual_prompt_version
    )
    and private.content_safety_visual_analysis_id_for_asset(
      scan.visual_video_asset_id,scan.visual_media_asset_id,scan.visual_prompt_version
    ) is null
    and (
      (scan.visual_source_kind='eligible_stream_video' and video.provider='cloudflare_stream'
        and video.purpose='story_video' and video.visibility='private' and video.status='ready'
        and video.deleted_at is null and video.duration_seconds>0 and video.duration_seconds<=15
        and video.provider_metadata->'require_signed_urls'='true'::jsonb
        and video.hls_url is null and video.dash_url is null and video.thumbnail_url is null)
      or
      (scan.visual_source_kind='eligible_image' and media.provider='r2'
        and media.purpose='story_image' and media.visibility='private' and media.public_url is null
        and media.status='ready' and media.deleted_at is null and media.media_kind='image'
        and media.mime_type in('image/jpeg','image/png','image/webp')
        and media.size_bytes between 1 and 25000000)
    )
  order by scan.visual_available_at,scan.created_at,scan.id
  for update of scan skip locked limit 1;
  if not found then
    if v_story_first then
      return private.claim_content_safety_visual_scans_for_prompts_b1_core(p_limit,p_prompt_versions);
    end if;
    return coalesce(v_core,'[]'::jsonb);
  end if;
  update private.content_safety_scans set visual_attempt_count=visual_attempt_count+1,
    visual_started_at=pg_catalog.clock_timestamp(),visual_last_error_code=null,
    updated_at=pg_catalog.clock_timestamp() where id=v_row.id;
  return pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'scan_id',v_row.id,'target_type',v_row.target_type,'target_id',v_row.target_id,
    'content_fingerprint',v_row.content_fingerprint,'source_kind',v_row.visual_source_kind,
    'visual_prompt_version',v_row.visual_prompt_version,'video_asset_id',v_row.visual_video_asset_id,
    'media_asset_id',v_row.visual_media_asset_id,'cloudflare_uid',v_row.cloudflare_uid,
    'duration_seconds',v_row.duration_seconds,'bucket_name',v_row.bucket_name,
    'object_key',v_row.object_key,'mime_type',v_row.mime_type,'size_bytes',v_row.size_bytes,
    'frame_cursor',v_row.visual_frame_cursor,'partial_result',v_row.visual_partial_result,
    'attempt_count',v_row.visual_attempt_count+1,'provider_call_count',v_row.visual_provider_call_count));
end;
$$;
revoke all on function private.claim_content_safety_visual_scans_for_prompts(integer,text[])
  from public,anon,authenticated,service_role;
grant execute on function private.claim_content_safety_visual_scans_for_prompts(integer,text[])
  to postgres,supabase_admin;
revoke all on function private.claim_content_safety_visual_scans_for_prompts_b1_core(integer,text[])
  from public,anon,authenticated,service_role;

-- A direct Story asset is its own canonical producer. Shared Stories retain
-- media_source_scan_id and therefore continue to reuse the source producer.
create or replace function private.content_safety_visual_producer_scan_id(
  p_video_asset_id uuid,p_media_asset_id uuid,p_prompt_version text
) returns uuid language sql stable security definer set search_path='' as $$
  select scan.id
  from private.content_safety_scans scan
  where p_prompt_version in('visual-safety-v1','creator-premium-visual-safety-p3-v1')
    and scan.target_type in('video','creator_premium','story')
    and (scan.target_type<>'story' or (
      scan.media_source_scan_id is null and p_prompt_version='visual-safety-v1'
      and scan.content_fingerprint=private.content_safety_sha256(
        'story|'||scan.target_id::text||'|'||coalesce(private.story_current_fingerprint(scan.target_id),'')
      )
    ))
    and scan.visual_provider='cloudflare_workers_ai'
    and scan.visual_model='@cf/google/gemma-4-26b-a4b-it'
    and scan.visual_prompt_version=p_prompt_version
    and (
      (p_media_asset_id is not null and scan.visual_media_asset_id=p_media_asset_id
        and scan.visual_source_kind='eligible_image')
      or
      (p_video_asset_id is not null and scan.visual_video_asset_id=p_video_asset_id
        and scan.visual_source_kind='eligible_stream_video')
    )
  order by case when scan.visual_status='pending' and scan.visual_analysis_id is null then 0 else 1 end,
    scan.created_at,scan.id
  limit 1;
$$;
revoke all on function private.content_safety_visual_producer_scan_id(uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function private.content_safety_visual_producer_scan_id(uuid,uuid,text)
  to postgres,supabase_admin;

-- Keep the public RPC stable while adding the direct Story producer lane.
alter function public.advance_content_safety_visual_scan(uuid,integer,integer,jsonb)
  set schema private;
alter function private.advance_content_safety_visual_scan(uuid,integer,integer,jsonb)
  rename to advance_content_safety_visual_scan_b1_core;
create function public.advance_content_safety_visual_scan(
  p_scan_id uuid,p_expected_cursor integer,p_frame_timestamp_ms integer,p_frame_result jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_scan private.content_safety_scans;v_frames jsonb;v_current text;v_expected text;
begin
  select * into v_scan from private.content_safety_scans where id=p_scan_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_visual_scan_not_found';end if;
  if v_scan.target_type<>'story' then
    return private.advance_content_safety_visual_scan_b1_core(
      p_scan_id,p_expected_cursor,p_frame_timestamp_ms,p_frame_result);end if;
  v_current:=private.story_current_fingerprint(v_scan.target_id);
  v_expected:=private.content_safety_sha256(
    'story|'||v_scan.target_id::text||'|'||coalesce(v_current,''));
  if v_current is null or v_scan.media_source_scan_id is not null
     or v_scan.content_fingerprint is distinct from v_expected
     or v_scan.visual_prompt_version<>'visual-safety-v1'
     or v_scan.visual_status<>'pending'
     or v_scan.visual_source_kind<>'eligible_stream_video'
     or v_scan.visual_frame_cursor<>p_expected_cursor
     or p_expected_cursor not between 0 and 3 or p_frame_timestamp_ms<0
     or v_scan.visual_provider_call_count>=5
     or not private.content_safety_visual_result_valid_for_prompt(
       p_frame_result,'visual-safety-v1','eligible_stream_video',p_expected_cursor,5)
     or exists(select 1 from pg_catalog.jsonb_array_elements(
       coalesce(v_scan.visual_partial_result->'frames','[]'::jsonb)) frame
       where frame->'result'->>'schema_version' is distinct from 'visual-safety-v1') then
    raise exception using errcode='22023',message='invalid_content_safety_visual_advance';end if;
  v_frames:=coalesce(v_scan.visual_partial_result->'frames','[]'::jsonb)
    ||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'frame_index',p_expected_cursor,'timestamp_ms',p_frame_timestamp_ms,'result',p_frame_result));
  if pg_catalog.pg_column_size(pg_catalog.jsonb_build_object('frames',v_frames))>32768 then
    raise exception using errcode='22023',message='content_safety_visual_partial_too_large';end if;
  update private.content_safety_scans set
    visual_frame_cursor=visual_frame_cursor+1,
    visual_partial_result=pg_catalog.jsonb_build_object('frames',v_frames),
    visual_provider_call_count=visual_provider_call_count+1,visual_attempt_count=0,
    visual_started_at=null,visual_available_at=pg_catalog.clock_timestamp(),
    updated_at=pg_catalog.clock_timestamp() where id=v_scan.id;
  return pg_catalog.jsonb_build_object('scan_id',v_scan.id,'visual_status','pending',
    'visual_prompt_version','visual-safety-v1','frame_cursor',v_scan.visual_frame_cursor+1,
    'provider_call_count',v_scan.visual_provider_call_count+1);
end;
$$;
revoke all on function public.advance_content_safety_visual_scan(uuid,integer,integer,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.advance_content_safety_visual_scan(uuid,integer,integer,jsonb)
  to service_role;
revoke all on function private.advance_content_safety_visual_scan_b1_core(uuid,integer,integer,jsonb)
  from public,anon,authenticated,service_role;

alter function private.content_safety_create_visual_alerts_for_scan(uuid,uuid)
  rename to content_safety_create_visual_alerts_for_scan_b1_core;
create function private.content_safety_create_visual_alerts_for_scan(
  p_scan_id uuid,p_analysis_id uuid
) returns integer language plpgsql security definer set search_path='' as $$
declare
  v_scan private.content_safety_scans;v_analysis private.content_safety_visual_analyses;
  v_category text;v_severity text;v_description text;v_frame_indexes integer[];
  v_frame_times integer[];v_snapshot jsonb;v_total integer;v_pending integer;
  v_recent integer;v_latest timestamptz;v_warnings integer;v_reach bigint;
  v_priority integer;v_count integer:=0;v_current text;v_expected text;
begin
  select * into v_scan from private.content_safety_scans where id=p_scan_id;
  if not found or v_scan.target_type<>'story' or v_scan.media_source_scan_id is not null then
    return private.content_safety_create_visual_alerts_for_scan_b1_core(p_scan_id,p_analysis_id);end if;
  select * into v_analysis from private.content_safety_visual_analyses where id=p_analysis_id;
  if not found or v_analysis.prompt_version<>'visual-safety-v1' then return 0;end if;
  v_current:=private.story_current_fingerprint(v_scan.target_id);
  v_expected:=private.content_safety_sha256(
    'story|'||v_scan.target_id::text||'|'||coalesce(v_current,''));
  if v_current is null or v_scan.content_fingerprint is distinct from v_expected
     or not coalesce((v_analysis.analysis_result->>'review_required')::boolean,false) then
    return 0;end if;
  v_snapshot:=private.content_safety_target_snapshot('story',v_scan.target_id);
  select count(*)::integer,count(*) filter(where report.status='pending')::integer,
    count(*) filter(where report.status='pending' and report.created_at>=pg_catalog.clock_timestamp()-interval '15 minutes')::integer,
    max(report.created_at) into v_total,v_pending,v_recent,v_latest
  from public.reports report
  where report.reported_content_type='story' and report.reported_content_id=v_scan.target_id;
  select count(*)::integer into v_warnings from private.admin_user_warnings warning
  where warning.target_user_id=v_scan.owner_user_id and warning.status='active'
    and warning.issued_at>coalesce((select max(action.completed_at)
      from private.admin_user_moderation_actions action
      where action.target_user_id=v_scan.owner_user_id and action.action='restore'
        and action.status='succeeded'),'-infinity'::timestamptz);
  v_warnings:=least(coalesce(v_warnings,0),3);
  v_reach:=greatest(coalesce((v_snapshot->>'reach')::bigint,0),0);
  for v_category in select distinct finding.value->>'category'
    from pg_catalog.jsonb_array_elements(v_analysis.analysis_result->'findings') finding(value)
  loop
    select finding.value->>'triage_level' into v_severity
    from pg_catalog.jsonb_array_elements(v_analysis.analysis_result->'findings') finding(value)
    where finding.value->>'category'=v_category
    order by case finding.value->>'triage_level'
      when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end desc limit 1;
    select left(pg_catalog.string_agg(finding.value->>'description',' · ' order by finding.ordinality),240),
      coalesce(pg_catalog.array_agg(distinct (finding.value->>'frame_index')::integer
        order by (finding.value->>'frame_index')::integer)
        filter(where pg_catalog.jsonb_typeof(finding.value->'frame_index')='number'),'{}'::integer[])
    into v_description,v_frame_indexes
    from pg_catalog.jsonb_array_elements(v_analysis.analysis_result->'findings')
      with ordinality finding(value,ordinality)
    where finding.value->>'category'=v_category;
    if v_analysis.video_asset_id is not null then
      select coalesce(pg_catalog.array_agg(v_analysis.frame_timestamps_ms[index+1] order by index),'{}'::integer[])
      into v_frame_times from pg_catalog.unnest(v_frame_indexes) index
      where index>=0 and index<pg_catalog.cardinality(v_analysis.frame_timestamps_ms);
    else v_frame_times:='{}'::integer[];end if;
    v_priority:=private.content_safety_priority(v_severity,v_pending,v_recent,v_warnings,v_reach);
    insert into private.content_safety_alerts(
      scan_id,target_type,target_id,owner_user_id,source_type,rule_id,category,severity,
      confidence,priority_score,alert_fingerprint,reach,related_report_count,
      pending_report_count,reports_last_15m,latest_report_at,active_warning_count,evidence
    ) values(
      v_scan.id,'story',v_scan.target_id,v_scan.owner_user_id,'visual_classifier',null,
      v_category,v_severity,null,v_priority,
      private.content_safety_sha256(v_scan.id::text||'|'||v_analysis.id::text||
        '|visual_classifier|'||v_category||'|visual-safety-v1'),
      v_reach,v_total,v_pending,v_recent,v_latest,v_warnings,
      pg_catalog.jsonb_build_object('visual_analysis_id',v_analysis.id,
        'provider',v_analysis.provider,'model',v_analysis.model,
        'prompt_version',v_analysis.prompt_version,'sample_strategy',v_analysis.sample_strategy,
        'category',v_category,'model_triage_level',v_severity,'description',v_description,
        'frame_indexes',pg_catalog.to_jsonb(v_frame_indexes),
        'frame_timestamps_ms',pg_catalog.to_jsonb(v_frame_times),
        'analysis_fingerprint',v_analysis.analysis_fingerprint)
    ) on conflict(alert_fingerprint) do update set
      priority_score=excluded.priority_score,reach=excluded.reach,
      related_report_count=excluded.related_report_count,
      pending_report_count=excluded.pending_report_count,
      reports_last_15m=excluded.reports_last_15m,latest_report_at=excluded.latest_report_at,
      active_warning_count=excluded.active_warning_count,evidence=excluded.evidence,
      updated_at=pg_catalog.clock_timestamp();
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.content_safety_create_visual_alerts_for_scan(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.content_safety_create_visual_alerts_for_scan_b1_core(uuid,uuid)
  from public,anon,authenticated,service_role;

alter function private.content_safety_attach_visual_analysis(uuid)
  rename to content_safety_attach_visual_analysis_b1_core;
create function private.content_safety_attach_visual_analysis(p_analysis_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_analysis private.content_safety_visual_analyses;v_core jsonb;v_story_count integer:=0;
  v_alert_count integer:=0;v_scan_id uuid;
begin
  select * into v_analysis from private.content_safety_visual_analyses where id=p_analysis_id;
  if not found then raise exception using errcode='P0002',message='content_safety_visual_analysis_not_found';end if;
  v_core:=private.content_safety_attach_visual_analysis_b1_core(p_analysis_id);
  if v_analysis.prompt_version='visual-safety-v1' then
    update private.content_safety_scans scan set
      visual_analysis_id=v_analysis.id,visual_status='analyzed',
      visual_provider=v_analysis.provider,visual_model=v_analysis.model,
      visual_prompt_version=v_analysis.prompt_version,
      visual_completed_at=coalesce(scan.visual_completed_at,pg_catalog.clock_timestamp()),
      visual_started_at=null,visual_last_error_code=null,visual_attempt_count=0,
      visual_partial_result=null,updated_at=pg_catalog.clock_timestamp()
    where scan.target_type='story' and scan.media_source_scan_id is null
      and scan.visual_prompt_version='visual-safety-v1'
      and scan.visual_provider=v_analysis.provider and scan.visual_model=v_analysis.model
      and scan.content_fingerprint=private.content_safety_sha256(
        'story|'||scan.target_id::text||'|'||coalesce(private.story_current_fingerprint(scan.target_id),''))
      and (
        (v_analysis.media_asset_id is not null
          and scan.visual_media_asset_id=v_analysis.media_asset_id
          and scan.visual_source_kind='eligible_image')
        or
        (v_analysis.video_asset_id is not null
          and scan.visual_video_asset_id=v_analysis.video_asset_id
          and scan.visual_source_kind='eligible_stream_video')
      );
    get diagnostics v_story_count=row_count;
    for v_scan_id in select scan.id from private.content_safety_scans scan
      where scan.target_type='story' and scan.media_source_scan_id is null
        and scan.visual_analysis_id=v_analysis.id
    loop
      v_alert_count:=v_alert_count+
        private.content_safety_create_visual_alerts_for_scan(v_scan_id,v_analysis.id);
    end loop;
  end if;
  return pg_catalog.jsonb_build_object(
    'analysis_id',v_analysis.id,
    'scans_attached',coalesce((v_core->>'scans_attached')::integer,0)+v_story_count,
    'stories_attached',coalesce((v_core->>'stories_attached')::integer,0)+v_story_count,
    'alerts_processed',coalesce((v_core->>'alerts_processed')::integer,0)+v_alert_count
  );
end;
$$;
revoke all on function private.content_safety_attach_visual_analysis(uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.content_safety_attach_visual_analysis_b1_core(uuid)
  from public,anon,authenticated,service_role;

alter function public.complete_content_safety_visual_analysis(uuid,text,jsonb,text,integer[])
  set schema private;
alter function private.complete_content_safety_visual_analysis(uuid,text,jsonb,text,integer[])
  rename to complete_content_safety_visual_analysis_b1_core;
create function public.complete_content_safety_visual_analysis(
  p_scan_id uuid,p_content_fingerprint text,p_analysis_result jsonb,
  p_analysis_fingerprint text,p_frame_timestamps_ms integer[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_scan private.content_safety_scans;v_analysis private.content_safety_visual_analyses;
  v_provider_calls integer;v_frame_count integer;v_strategy text;v_existing_id uuid;
  v_producer_id uuid;v_attach jsonb;v_inserted boolean:=false;
  v_current text;v_expected text;
begin
  select * into v_scan from private.content_safety_scans where id=p_scan_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_visual_scan_not_found';end if;
  if v_scan.target_type<>'story' then
    return private.complete_content_safety_visual_analysis_b1_core(
      p_scan_id,p_content_fingerprint,p_analysis_result,p_analysis_fingerprint,p_frame_timestamps_ms);end if;
  v_current:=private.story_current_fingerprint(v_scan.target_id);
  v_expected:=private.content_safety_sha256(
    'story|'||v_scan.target_id::text||'|'||coalesce(v_current,''));
  v_strategy:=case when v_scan.visual_source_kind='eligible_image'
    then 'single_image_v1' else 'percentile_5_v1' end;
  -- Validate the current Story fence before reusing immutable analysis for the
  -- exact linked asset. A stale worker must not attach evidence or consume a
  -- provider-call budget merely because that asset was analyzed previously.
  if v_current is null or v_scan.media_source_scan_id is not null
     or v_scan.visual_status<>'pending'
     or v_scan.content_fingerprint is distinct from p_content_fingerprint
     or v_scan.content_fingerprint is distinct from v_expected
     or v_scan.visual_prompt_version<>'visual-safety-v1'
     or v_scan.visual_source_kind not in('eligible_image','eligible_stream_video') then
    raise exception using errcode='22023',message='invalid_content_safety_visual_completion';
  end if;
  v_existing_id:=private.content_safety_visual_analysis_id_for_asset(
    v_scan.visual_video_asset_id,v_scan.visual_media_asset_id,'visual-safety-v1');
  v_provider_calls:=v_scan.visual_provider_call_count+1;
  if v_existing_id is not null then
    update private.content_safety_scans set visual_provider_call_count=v_provider_calls,
      visual_started_at=null,updated_at=pg_catalog.clock_timestamp() where id=v_scan.id;
    v_attach:=private.content_safety_attach_visual_analysis(v_existing_id);
    return pg_catalog.jsonb_build_object('scan_id',v_scan.id,'analysis_id',v_existing_id,
      'visual_status','analyzed','visual_prompt_version','visual-safety-v1',
      'alerts_processed',coalesce((v_attach->>'alerts_processed')::integer,0),
      'provider_call_count',v_provider_calls,'race_reused',true);
  end if;
  v_producer_id:=private.content_safety_visual_producer_scan_id(
    v_scan.visual_video_asset_id,v_scan.visual_media_asset_id,'visual-safety-v1');
  v_frame_count:=case when v_scan.visual_source_kind='eligible_image'
    then 1 else pg_catalog.cardinality(p_frame_timestamps_ms) end;
  if v_current is null or v_scan.media_source_scan_id is not null
     or v_scan.id is distinct from v_producer_id or v_scan.visual_status<>'pending'
     or v_scan.content_fingerprint is distinct from p_content_fingerprint
     or v_scan.content_fingerprint is distinct from v_expected
     or v_scan.visual_prompt_version<>'visual-safety-v1'
     or v_scan.visual_source_kind not in('eligible_image','eligible_stream_video')
     or v_provider_calls not between 1 and 5
     or p_analysis_fingerprint!~'^[0-9a-f]{64}$'
     or (v_scan.visual_source_kind='eligible_image'
       and pg_catalog.cardinality(p_frame_timestamps_ms)<>0)
     or (v_scan.visual_source_kind='eligible_stream_video' and (
       v_frame_count<1 or v_frame_count>5
       or v_scan.visual_frame_cursor<>v_frame_count-1))
     or not private.content_safety_visual_result_valid_for_prompt(
       p_analysis_result,'visual-safety-v1',v_scan.visual_source_kind,null,v_frame_count) then
    raise exception using errcode='22023',message='invalid_content_safety_visual_completion';end if;
  if exists(select 1 from pg_catalog.unnest(p_frame_timestamps_ms) with ordinality a(value,pos)
      join pg_catalog.unnest(p_frame_timestamps_ms) with ordinality b(value,pos)
        on b.pos=a.pos+1 where b.value<=a.value)
     or exists(select 1 from pg_catalog.unnest(p_frame_timestamps_ms) value where value<0) then
    raise exception using errcode='22023',message='invalid_visual_frame_timestamps';end if;
  insert into private.content_safety_visual_analyses(
    source_scan_id,video_asset_id,media_asset_id,source_content_fingerprint,
    provider,model,prompt_version,sample_strategy,frame_count,frame_timestamps_ms,
    analysis_result,analysis_fingerprint,provider_call_count
  ) values(
    v_scan.id,v_scan.visual_video_asset_id,v_scan.visual_media_asset_id,
    v_scan.content_fingerprint,'cloudflare_workers_ai','@cf/google/gemma-4-26b-a4b-it',
    'visual-safety-v1',v_strategy,v_frame_count,p_frame_timestamps_ms,
    p_analysis_result,p_analysis_fingerprint,v_provider_calls
  ) on conflict do nothing returning * into v_analysis;
  if v_analysis.id is null then
    v_existing_id:=private.content_safety_visual_analysis_id_for_asset(
      v_scan.visual_video_asset_id,v_scan.visual_media_asset_id,'visual-safety-v1');
    if v_existing_id is null then raise exception using errcode='23505',
      message='content_safety_visual_analysis_race_unresolved';end if;
    select * into v_analysis from private.content_safety_visual_analyses where id=v_existing_id;
  else v_inserted:=true;end if;
  update private.content_safety_scans set visual_provider_call_count=v_provider_calls,
    visual_frame_cursor=v_frame_count,visual_started_at=null,
    updated_at=pg_catalog.clock_timestamp() where id=v_scan.id;
  v_attach:=private.content_safety_attach_visual_analysis(v_analysis.id);
  return pg_catalog.jsonb_build_object('scan_id',v_scan.id,'analysis_id',v_analysis.id,
    'visual_status','analyzed','visual_prompt_version','visual-safety-v1',
    'alerts_processed',coalesce((v_attach->>'alerts_processed')::integer,0),
    'provider_call_count',v_provider_calls,'frame_count',v_frame_count,
    'race_reused',not v_inserted);
end;
$$;
revoke all on function public.complete_content_safety_visual_analysis(uuid,text,jsonb,text,integer[])
  from public,anon,authenticated,service_role;
grant execute on function public.complete_content_safety_visual_analysis(uuid,text,jsonb,text,integer[])
  to service_role;
revoke all on function private.complete_content_safety_visual_analysis_b1_core(uuid,text,jsonb,text,integer[])
  from public,anon,authenticated,service_role;

alter function public.fail_content_safety_visual_scan(uuid,text,boolean,boolean)
  set schema private;
alter function private.fail_content_safety_visual_scan(uuid,text,boolean,boolean)
  rename to fail_content_safety_visual_scan_b1_core;
create function public.fail_content_safety_visual_scan(
  p_scan_id uuid,p_error_code text,p_retryable boolean default true,
  p_provider_called boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_scan private.content_safety_scans;v_producer uuid;v_calls integer;
  v_retry boolean;v_error text;v_frames_remaining integer;v_next timestamptz;
begin
  if auth.role()<>'service_role' then raise exception using errcode='42501',
    message='content_safety_service_role_required';end if;
  select * into v_scan from private.content_safety_scans where id=p_scan_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_visual_scan_not_found';end if;
  if v_scan.target_type<>'story' or v_scan.media_source_scan_id is not null then
    return private.fail_content_safety_visual_scan_b1_core(
      p_scan_id,p_error_code,p_retryable,p_provider_called);end if;
  if v_scan.visual_analysis_id is not null then
    perform private.content_safety_attach_visual_analysis(v_scan.visual_analysis_id);
    return pg_catalog.jsonb_build_object('scan_id',v_scan.id,'visual_status','analyzed',
      'reused',true,'provider_call_count',v_scan.visual_provider_call_count);end if;
  v_producer:=private.content_safety_visual_producer_scan_id(
    v_scan.visual_video_asset_id,v_scan.visual_media_asset_id,v_scan.visual_prompt_version);
  if v_scan.id is distinct from v_producer then raise exception using errcode='55000',
    message='content_safety_visual_not_canonical_producer';end if;
  v_calls:=v_scan.visual_provider_call_count+
    case when coalesce(p_provider_called,false) then 1 else 0 end;
  v_frames_remaining:=case when v_scan.visual_source_kind='eligible_stream_video'
    then 5-v_scan.visual_frame_cursor else 1 end;
  v_retry:=coalesce(p_retryable,false) and v_scan.visual_attempt_count<5 and v_calls<5
    and (v_scan.visual_source_kind='eligible_image' or v_calls+v_frames_remaining<=5);
  v_error:=left(pg_catalog.lower(pg_catalog.regexp_replace(
    coalesce(nullif(pg_catalog.btrim(p_error_code),''),'visual_processing_error'),
    '[^a-z0-9_]+','_','g')),100);
  v_next:=case when v_retry then pg_catalog.clock_timestamp()
    +least(30,pg_catalog.power(2,greatest(v_scan.visual_attempt_count,1)))::integer*
      interval '1 minute' else v_scan.visual_available_at end;
  update private.content_safety_scans set
    visual_status=case when v_retry then 'pending' else 'failed' end,
    visual_provider_call_count=v_calls,visual_available_at=v_next,visual_started_at=null,
    visual_completed_at=case when v_retry then null else pg_catalog.clock_timestamp() end,
    visual_last_error_code=v_error,updated_at=pg_catalog.clock_timestamp()
  where id=v_scan.id;
  return pg_catalog.jsonb_build_object('scan_id',v_scan.id,
    'visual_status',case when v_retry then 'pending' else 'failed' end,
    'retryable',v_retry,'provider_call_count',v_calls,'canonical_producer',true,
    'visual_prompt_version',v_scan.visual_prompt_version);
end;
$$;
revoke all on function public.fail_content_safety_visual_scan(uuid,text,boolean,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.fail_content_safety_visual_scan(uuid,text,boolean,boolean)
  to service_role;
revoke all on function private.fail_content_safety_visual_scan_b1_core(uuid,text,boolean,boolean)
  from public,anon,authenticated,service_role;

-- Expiry cleanup deletes Story rows directly. Route that path through the
-- same fenced Stream tombstone scheduler used by explicit owner deletion.
create function private.story_schedule_stream_on_delete_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_asset uuid;
begin
  select link.asset_id into v_asset
  from public.video_asset_links link join public.video_assets asset on asset.id=link.asset_id
  where link.entity_type='story' and link.entity_id=old.id
    and link.slot='media' and link.position=0 and link.owner_id=old.user_id
    and asset.owner_id=old.user_id and asset.purpose='story_video'
  for update of asset;
  if v_asset is not null then
    delete from public.video_asset_links where asset_id=v_asset and entity_type='story'
      and entity_id=old.id and slot='media' and position=0;
    perform private.schedule_video_asset_deletion_v1(v_asset,old.user_id,'story_video');
  end if;
  return old;
end;
$$;
revoke all on function private.story_schedule_stream_on_delete_v1()
  from public,anon,authenticated,service_role;
create trigger stories_schedule_stream_on_delete_b1
before delete on public.stories for each row
execute function private.story_schedule_stream_on_delete_v1();

-- Preserve the single Stream reconciler RPC. The prior core continues to
-- process Feed/Business/Premium, while this wrapper adds only Story assets.
alter function public.cleanup_stale_creator_premium_video_records(integer)
  set schema private;
alter function private.cleanup_stale_creator_premium_video_records(integer)
  rename to cleanup_stale_stream_video_records_b1_core;
create function public.cleanup_stale_creator_premium_video_records(p_limit integer default 50)
returns table(id uuid,cloudflare_uid text,purpose text,delete_attempts integer,
  operation text,failure_exhausts boolean)
language plpgsql security definer set search_path='' as $$
declare v_limit integer:=greatest(1,least(coalesce(p_limit,50),100));
  v_core_budget integer;v_story_budget integer;v_batch integer:=0;
  v_total integer:=0;v_story_returned integer:=0;v_story_first boolean;
  v_claim record;v_reaper record;
begin
  v_story_first:=private.story_b1_take_worker_lane_v1('stream_cleanup')='story';
  if v_limit=1 then
    v_core_budget:=case when v_story_first then 0 else 1 end;
  else
    v_core_budget:=v_limit/2;
    if not v_story_first and pg_catalog.mod(v_limit,2)=1 then
      v_core_budget:=v_core_budget+1;end if;
  end if;
  v_story_budget:=v_limit-v_core_budget;

  if v_core_budget>0 then
    return query select *
    from private.cleanup_stale_stream_video_records_b1_core(v_core_budget);
    get diagnostics v_batch=row_count;
    v_total:=v_total+v_batch;
    -- Lend unused core capacity to Story while preserving the hard total cap.
    v_story_budget:=v_story_budget+(v_core_budget-v_batch);
  end if;
  v_story_budget:=least(v_story_budget,v_limit-v_total);
  if v_story_budget<=0 then return;end if;

  with abandoned as(
    select asset.id from public.video_assets asset
    where asset.lifecycle_contract_version=1 and asset.provider='cloudflare_stream'
      and asset.purpose='story_video'
      and asset.status in('pending','uploading','processing','ready','failed')
      and asset.created_at<pg_catalog.clock_timestamp()-interval '24 hours'
      and not exists(select 1 from public.video_asset_links link where link.asset_id=asset.id)
    order by asset.created_at,asset.id for update of asset skip locked limit v_story_budget
  ) update public.video_assets asset set status='delete_pending',hls_url=null,dash_url=null,
    thumbnail_url=null,error_code='story_video_abandoned',error_message=null,
    delete_attempts=0,post_delete_verification_attempts=0,
    next_cleanup_attempt_at=coalesce(asset.next_cleanup_attempt_at,pg_catalog.clock_timestamp()),
    updated_at=pg_catalog.clock_timestamp()
  from abandoned where asset.id=abandoned.id;

  for v_reaper in
    with expired_final_claim as(
      select asset.id,asset.status,asset.delete_attempts from public.video_assets asset
      where asset.lifecycle_contract_version=1 and asset.provider='cloudflare_stream'
        and asset.purpose='story_video'
        and ((asset.status='delete_pending' and asset.provider_absence_verified_at is null
              and asset.delete_attempts>=12 and asset.next_cleanup_attempt_at is not null
              and asset.next_cleanup_attempt_at<=pg_catalog.clock_timestamp())
          or (asset.status='delete_pending' and asset.provider_absence_verified_at is not null
              and asset.delete_attempts>=13 and asset.provider_absence_recheck_after is not null
              and asset.provider_absence_recheck_after<=pg_catalog.clock_timestamp())
          or (asset.status='deleted' and asset.post_delete_verification_attempts>=3
              and asset.provider_absence_recheck_after is not null
              and asset.provider_absence_recheck_after<=pg_catalog.clock_timestamp()))
        and not exists(select 1 from public.video_asset_links link where link.asset_id=asset.id)
      order by coalesce(asset.provider_absence_recheck_after,asset.next_cleanup_attempt_at,asset.updated_at),asset.id
      for update of asset skip locked limit v_story_budget
    ) update public.video_assets asset set
      error_code=case when expired_final_claim.status='deleted'
        then 'stream_post_delete_verification_exhausted' else 'stream_cleanup_attempts_exhausted' end,
      error_message=null,next_cleanup_attempt_at=null,provider_absence_recheck_after=null,
      updated_at=pg_catalog.clock_timestamp()
    from expired_final_claim where asset.id=expired_final_claim.id
    returning asset.id as reaped_id,asset.delete_attempts as reaped_attempt,
      expired_final_claim.status as reaped_status
  loop
    perform private.record_media_lifecycle_audit_v1(v_reaper.reaped_id,'video_asset',
      'cloudflare_stream',case when v_reaper.reaped_status='deleted'
        then 'post_delete_verification_exhausted' else 'cleanup_exhausted' end,
      v_reaper.reaped_attempt,'claim_lease_expired',null,'failed');
  end loop;

  for v_claim in
    with claimed as(
      select asset.id,asset.status,asset.provider_absence_verified_at
      from public.video_assets asset
      where asset.lifecycle_contract_version=1 and asset.provider='cloudflare_stream'
        and asset.purpose='story_video'
        and ((asset.status='delete_pending' and (
              (asset.provider_absence_verified_at is null and asset.delete_attempts<12
                and coalesce(asset.next_cleanup_attempt_at,pg_catalog.clock_timestamp())<=pg_catalog.clock_timestamp()
                and coalesce(asset.upload_expires_at,'-infinity'::timestamptz)<=pg_catalog.clock_timestamp())
              or (asset.provider_absence_verified_at is not null and asset.delete_attempts<13
                and asset.provider_absence_recheck_after is not null
                and asset.provider_absence_recheck_after<=pg_catalog.clock_timestamp())))
          or (asset.status='deleted' and asset.post_delete_verification_attempts<3
              and asset.provider_absence_verified_at is not null
              and asset.provider_absence_recheck_after is not null
              and asset.provider_absence_recheck_after<=pg_catalog.clock_timestamp()))
        and not exists(select 1 from public.video_asset_links link where link.asset_id=asset.id)
      order by coalesce(asset.provider_absence_recheck_after,asset.next_cleanup_attempt_at,asset.created_at),asset.id
      for update of asset skip locked limit v_story_budget
    ) update public.video_assets asset set
      delete_attempts=asset.delete_attempts+1,
      post_delete_verification_attempts=case when claimed.status='deleted'
        then asset.post_delete_verification_attempts+1 else asset.post_delete_verification_attempts end,
      next_cleanup_attempt_at=case when claimed.status='delete_pending'
        then pg_catalog.clock_timestamp()+pg_catalog.make_interval(
          secs=>least(21600,30*pg_catalog.power(2,least(asset.delete_attempts,9))::integer))
        else asset.next_cleanup_attempt_at end,
      provider_absence_recheck_after=case when claimed.status='deleted'
        then pg_catalog.clock_timestamp()+interval '15 minutes'
        when claimed.status='delete_pending' and claimed.provider_absence_verified_at is not null
        then pg_catalog.clock_timestamp()+pg_catalog.make_interval(
          secs=>least(21600,30*pg_catalog.power(2,least(asset.delete_attempts,9))::integer))
        else asset.provider_absence_recheck_after end,
      updated_at=pg_catalog.clock_timestamp()
    from claimed where asset.id=claimed.id
      and not exists(select 1 from public.video_asset_links link where link.asset_id=asset.id)
    returning asset.id as claimed_id,asset.cloudflare_uid as claimed_provider_identity,
      asset.purpose as claimed_purpose,asset.delete_attempts as claimed_attempt,
      case when claimed.status='deleted' or claimed.provider_absence_verified_at is not null
        then 'verify_absence' else 'delete' end as claimed_operation,
      ((claimed.status='delete_pending' and asset.delete_attempts>=12)
        or (claimed.status='deleted' and asset.post_delete_verification_attempts>=3))
        as claimed_failure_exhausts
  loop
    perform private.record_media_lifecycle_audit_v1(v_claim.claimed_id,'video_asset',
      'cloudflare_stream',case when v_claim.claimed_operation='delete'
        then 'delete_requested' else 'absence_check_requested' end,
      v_claim.claimed_attempt,'claim_acquired',null,'succeeded');
    id:=v_claim.claimed_id;cloudflare_uid:=v_claim.claimed_provider_identity;
    purpose:=v_claim.claimed_purpose;delete_attempts:=v_claim.claimed_attempt;
    operation:=v_claim.claimed_operation;failure_exhausts:=v_claim.claimed_failure_exhausts;
    return next;v_story_returned:=v_story_returned+1;
  end loop;
  v_total:=v_total+v_story_returned;
  -- If the reserved Story share was idle, let the existing lane fill the
  -- remaining slots without ever exceeding the caller's requested batch.
  if v_total<v_limit then
    return query select *
    from private.cleanup_stale_stream_video_records_b1_core(v_limit-v_total);
  end if;
end;
$$;
revoke all on function public.cleanup_stale_creator_premium_video_records(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.cleanup_stale_creator_premium_video_records(integer)
  to service_role;
revoke all on function private.cleanup_stale_stream_video_records_b1_core(integer)
  from public,anon,authenticated,service_role;

alter function private.create_story_with_media_core(uuid,jsonb,uuid) set search_path = '';
alter function public.create_story_with_media(uuid,jsonb,uuid) set search_path = '';
alter function public.create_story_with_media(uuid) set search_path = '';
alter function public.create_story_from_content(uuid,jsonb,uuid) set search_path = '';
alter function public.delete_story(uuid) set search_path = '';
-- ON DELETE CASCADE extends delete_story/expiry cleanup atomically without
-- replacing their media scheduling or retaining orphan response/event rows.
do $$
begin
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.story_interactive_revisions;
  end if;
end;
$$;
notify pgrst, 'reload schema';
commit;
