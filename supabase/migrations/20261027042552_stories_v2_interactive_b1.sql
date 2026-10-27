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
declare v_actor uuid:=auth.uid(); v_hash text; v_saved public.idempotency_keys; v_response jsonb;
begin
  if v_actor is null then raise exception using errcode='42501',message='not_authenticated'; end if;
  if p_event_id is null or p_story_id is null or p_event_type is null or p_event_type not in ('impression','completion','forward','back','exit','replay') then
    raise exception using errcode='22023',message='invalid_story_event'; end if;
  v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(p_story_id,p_event_type)::text,'UTF8')),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('story-event:'||v_actor::text||':'||p_event_id::text,0));
  select * into v_saved from public.idempotency_keys where user_id=v_actor and operation_type='story_analytics' and idempotency_key=p_event_id::text;
  if found and v_saved.request_hash is distinct from v_hash then raise exception using errcode='23505',message='story_idempotency_conflict'; end if;
  perform 1 from public.stories where id=p_story_id for share;
  if not private.story_can_access(p_story_id,false) then raise exception using errcode='42501',message='story_not_visible'; end if;
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
alter function private.story_set_reaction_core(uuid,text) set search_path = '';
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
