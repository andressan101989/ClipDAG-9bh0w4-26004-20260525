begin;

-- Static public cards contain only creator-approved text and transform. Private
-- provenance remains in a forced-RLS relation, outside all public projections.
create or replace function private.story_validate_composition(p_composition jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare v_element jsonb;v_static jsonb:='[]';v_count integer:=0;v_qa integer:=0;v_text text;
  v_trim constant text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  if p_composition is null or pg_catalog.jsonb_typeof(p_composition)<>'object'
    or pg_catalog.octet_length(p_composition::text)>32768
    or not coalesce(p_composition->'version' in('1'::jsonb,'2'::jsonb),false)
    or pg_catalog.jsonb_typeof(p_composition->'elements') is distinct from 'array' then
    raise exception using errcode='22023',message='invalid_story_composition';end if;
  if pg_catalog.jsonb_array_length(p_composition->'elements')>32
    or exists(select 1 from pg_catalog.jsonb_object_keys(p_composition) k where k not in('version','elements')) then
    raise exception using errcode='22023',message='invalid_story_composition';end if;
  for v_element in select value from pg_catalog.jsonb_array_elements(p_composition->'elements') loop
    if pg_catalog.jsonb_typeof(v_element)<>'object' or not v_element ?& array['id','type','x','y','scale','rotation'] then
      raise exception using errcode='22023',message='invalid_story_element';end if;
    if not coalesce(v_element->>'type' in('text','sticker','interactive','question_answer'),false) then
      raise exception using errcode='22023',message='invalid_story_element';end if;
    if not coalesce(v_element->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and pg_catalog.jsonb_typeof(v_element->'x')='number' and pg_catalog.jsonb_typeof(v_element->'y')='number'
      and pg_catalog.jsonb_typeof(v_element->'scale')='number' and pg_catalog.jsonb_typeof(v_element->'rotation')='number',false) then
      raise exception using errcode='22023',message='invalid_story_element';end if;
    if (v_element->>'x')::numeric not between 0 and 1 or (v_element->>'y')::numeric not between 0 and 1
      or (v_element->>'scale')::numeric not between 0.5 and 4 or (v_element->>'rotation')::numeric not between -180 and 180 then
      raise exception using errcode='22023',message='invalid_story_element';end if;
    if v_element->>'type'='interactive' then
      if p_composition->'version'<>'2'::jsonb or not coalesce(v_element->>'element_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false)
        or exists(select 1 from pg_catalog.jsonb_object_keys(v_element) k where k not in('id','type','element_id','x','y','scale','rotation')) then
        raise exception using errcode='22023',message='invalid_story_interactive_placement';end if;
      v_count:=v_count+1;
    elsif v_element->>'type'='question_answer' then
      if p_composition->'version'<>'2'::jsonb or not v_element ?& array['question','answer']
        or exists(select 1 from pg_catalog.jsonb_object_keys(v_element) k where k not in('id','type','x','y','scale','rotation','question','answer')) then
        raise exception using errcode='22023',message='invalid_story_question_answer';end if;
      foreach v_text in array array['question','answer'] loop
        if pg_catalog.jsonb_typeof(v_element->v_text) is distinct from 'string'
          or pg_catalog.char_length(v_element->>v_text) not between 1 and 500
          or v_element->>v_text is distinct from pg_catalog.btrim(v_element->>v_text,v_trim)
          or (v_element->>v_text) ~ U&'[\0001-\001F\007F-\009F<>]' then
          raise exception using errcode='22023',message='invalid_story_question_answer';end if;
      end loop;
      v_qa:=v_qa+1;
    else
      if (v_element->>'type'='text' and not v_element ?& array['text','color','align','size'])
        or (v_element->>'type'='sticker' and not v_element ? 'value') then
        raise exception using errcode='22023',message='invalid_story_element';end if;
      if v_element->>'type'='text' and not coalesce(v_element->>'color' in('#FFFFFF','#111111','#FF2D78','#7C5CFF','#00D4FF','#FFD60A')
        and v_element->>'align' in('left','center','right') and v_element->>'size' in('small','medium','large'),false) then
        raise exception using errcode='22023',message='invalid_story_text_element';end if;
      v_static:=v_static||pg_catalog.jsonb_build_array(v_element);
    end if;
  end loop;
  perform private.story_validate_composition_v1(pg_catalog.jsonb_build_object('version',1,'elements',v_static));
  if (select count(*)<>count(distinct pg_catalog.lower(value->>'id')) from pg_catalog.jsonb_array_elements(p_composition->'elements'))
    or v_count<>(select count(distinct pg_catalog.lower(value->>'element_id')) from pg_catalog.jsonb_array_elements(p_composition->'elements') where value->>'type'='interactive') then
    raise exception using errcode='22023',message='duplicate_story_element_id';end if;
  if v_qa>1 then raise exception using errcode='22023',message='invalid_story_question_answer';end if;
  return p_composition;
end;
$$;
alter function private.story_validate_composition(jsonb) owner to postgres;
revoke all on function private.story_validate_composition(jsonb) from public,anon,authenticated,service_role;

create table private.story_question_answer_links(
  story_id uuid primary key references public.stories(id) on delete cascade,
  source_story_id uuid not null,
  source_element_id uuid not null,
  respondent_id uuid not null,
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key(source_story_id,source_element_id,respondent_id)
    references private.story_interactive_responses(story_id,element_id,respondent_id) on delete cascade
);
alter table private.story_question_answer_links owner to postgres;
alter table private.story_question_answer_links enable row level security;
alter table private.story_question_answer_links force row level security;
revoke all on table private.story_question_answer_links from public,anon,authenticated,service_role;
create index story_question_answer_links_source on private.story_question_answer_links(source_story_id,source_element_id,respondent_id);

create function private.story_question_answer_source_qa_c1_v1(p_source_story_id uuid,p_source_element_id uuid,p_respondent_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_question text;v_raw text;
  v_trim constant text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  if auth.uid() is null or p_source_story_id is null or p_source_element_id is null or p_respondent_id is null
    or p_respondent_id=auth.uid() then
    raise exception using errcode='42501',message='story_question_answer_denied';end if;
  select r.payload->>'text' into v_raw
  from public.stories s
  join private.story_interactive_elements e on e.story_id=s.id and e.element_id=p_source_element_id and e.kind='question'
  join private.story_interactive_responses r on r.story_id=e.story_id and r.element_id=e.element_id and r.respondent_id=p_respondent_id
  join private.story_safety_state safety on safety.story_id=s.id
  where s.id=p_source_story_id and s.user_id=auth.uid() and s.expires_at>pg_catalog.now()
    and r.moderation_state='pending' and pg_catalog.jsonb_typeof(r.payload->'text')='string'
    and private.admin_content_is_visible('story',s.id) and private.story_can_access(s.id,false)
    and safety.publication_status='published' and safety.published_at is not null
    and safety.publication_policy_id='nelyon.stories.general.safety.publish_first.v1'
    and safety.moderation_status not in('reviewed_restrict','reviewed_remove')
    and safety.evidence_fingerprint=private.story_current_fingerprint(s.id)
    and exists(select 1 from private.content_safety_scans scan where scan.id=safety.scan_id
      and scan.target_type='story' and scan.target_id=s.id
      and scan.content_fingerprint=private.content_safety_sha256('story|'||s.id::text||'|'||safety.evidence_fingerprint))
    and not exists(select 1 from public.blocked_users b where
      (b.blocker_id=auth.uid() and b.blocked_id=p_respondent_id) or (b.blocker_id=p_respondent_id and b.blocked_id=auth.uid()));
  v_question:=pg_catalog.btrim(v_raw,v_trim);
  if v_raw is null or v_raw ~ U&'[\0001-\001F\007F-\009F<>]' or pg_catalog.char_length(v_question) not between 1 and 500 then
    raise exception using errcode='42501',message='story_question_answer_denied';end if;
  return pg_catalog.jsonb_build_object('question',v_question,'respondent_id',p_respondent_id);
end;
$$;
alter function private.story_question_answer_source_qa_c1_v1(uuid,uuid,uuid) owner to postgres;
revoke all on function private.story_question_answer_source_qa_c1_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.prepare_story_question_answer(p_source_story_id uuid,p_source_element_id uuid,p_respondent_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select private.story_question_answer_source_qa_c1_v1(p_source_story_id,p_source_element_id,p_respondent_id);
$$;
alter function public.prepare_story_question_answer(uuid,uuid,uuid) owner to postgres;
revoke all on function public.prepare_story_question_answer(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.prepare_story_question_answer(uuid,uuid,uuid) to authenticated;

create function public.create_story_question_answer_with_media(
  p_source_story_id uuid,p_source_element_id uuid,p_respondent_id uuid,p_asset_id uuid,
  p_composition jsonb,p_client_story_id uuid,p_interactive_definitions jsonb
) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_composition jsonb;v_source jsonb;v_card jsonb;v_hash text;v_valid_card boolean;
  v_story uuid;v_scan uuid;v_existing public.stories;v_link private.story_question_answer_links;
begin
  if v_actor is null or p_client_story_id is null or p_asset_id is null then
    raise exception using errcode='42501',message='story_question_answer_denied';end if;
  v_composition:=private.story_validate_composition(p_composition);
  if p_interactive_definitions is null or pg_catalog.jsonb_typeof(p_interactive_definitions)<>'array'
    or pg_catalog.octet_length(p_interactive_definitions::text)>65536 then
    raise exception using errcode='22023',message='invalid_story_definitions';end if;
  if (select count(*) from pg_catalog.jsonb_array_elements(v_composition->'elements') e where e->>'type'='question_answer')<>1 then
    raise exception using errcode='22023',message='invalid_story_question_answer';end if;
  -- Match C2 creation and A5 moderation. Lock order: actor/client -> source
  -- moderation target -> Story -> definition -> response -> safety -> media.
  -- SHARE coordinates with response FOR UPDATE and source deletion/moderation.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('story-create:'||v_actor::text||':'||p_client_story_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin-content-target:story:'||p_source_story_id::text,0));
  perform s.id from public.stories s where s.id=p_source_story_id for share;
  perform e.story_id from private.story_interactive_elements e where e.story_id=p_source_story_id and e.element_id=p_source_element_id for share;
  perform r.story_id from private.story_interactive_responses r where r.story_id=p_source_story_id and r.element_id=p_source_element_id and r.respondent_id=p_respondent_id for share;
  perform safety.story_id from private.story_safety_state safety where safety.story_id=p_source_story_id for share;
  v_source:=private.story_question_answer_source_qa_c1_v1(p_source_story_id,p_source_element_id,p_respondent_id);
  select e into v_card from pg_catalog.jsonb_array_elements(v_composition->'elements') e where e->>'type'='question_answer';
  v_valid_card:=(v_card->>'question' is not distinct from v_source->>'question')
    and (v_card->>'id')::uuid not in(p_source_story_id,p_source_element_id,p_respondent_id);
  v_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'actor',v_actor,'source_story',p_source_story_id,'source_element',p_source_element_id,'respondent',p_respondent_id,
    'asset',p_asset_id,'composition',v_composition,'definitions',p_interactive_definitions)::text,'UTF8')),'hex');
  select * into v_existing from public.stories where user_id=v_actor and client_story_id=p_client_story_id for share;
  if found then
    select * into v_link from private.story_question_answer_links where story_id=v_existing.id;
    if v_link.story_id is null or v_link.source_story_id<>p_source_story_id or v_link.source_element_id<>p_source_element_id
      or v_link.respondent_id<>p_respondent_id or v_link.request_hash<>v_hash or v_existing.story_composition<>v_composition then
      raise exception using errcode='23505',message='story_idempotency_conflict';end if;
    if not v_valid_card or v_existing.expires_at<=pg_catalog.now() or not private.admin_content_is_visible('story',v_existing.id)
      or not exists(select 1 from private.story_safety_state safety where safety.story_id=v_existing.id
        and safety.publication_status='published' and safety.published_at is not null
        and safety.publication_policy_id='nelyon.stories.general.safety.publish_first.v1'
        and safety.moderation_status not in('reviewed_restrict','reviewed_remove')
        and safety.evidence_fingerprint=private.story_current_fingerprint(v_existing.id)
        and exists(select 1 from private.content_safety_scans scan where scan.id=safety.scan_id and scan.target_type='story'
          and scan.target_id=v_existing.id and scan.content_fingerprint=private.content_safety_sha256('story|'||v_existing.id::text||'|'||safety.evidence_fingerprint))) then
      raise exception using errcode='42501',message='story_question_answer_denied';end if;
    return v_existing.id;
  end if;
  if not v_valid_card then raise exception using errcode='42501',message='story_question_answer_denied';end if;
  v_story:=private.create_story_with_media_core(p_asset_id,v_composition,p_client_story_id);
  perform private.story_install_definitions(v_story,p_interactive_definitions);
  insert into private.story_question_answer_links(story_id,source_story_id,source_element_id,respondent_id,request_hash)
    values(v_story,p_source_story_id,p_source_element_id,p_respondent_id,v_hash);
  v_scan:=private.story_enqueue_media_safety_v1(v_story);
  perform private.story_publish_c2_v1(v_story,v_scan);
  return v_story;
end;
$$;
alter function public.create_story_question_answer_with_media(uuid,uuid,uuid,uuid,jsonb,uuid,jsonb) owner to postgres;
revoke all on function public.create_story_question_answer_with_media(uuid,uuid,uuid,uuid,jsonb,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_story_question_answer_with_media(uuid,uuid,uuid,uuid,jsonb,uuid,jsonb) to authenticated;

-- Check only insertion/composition mutation. Source cleanup may cascade a link
-- without deleting or preventing deletion of the independent public answer.
create function private.story_check_question_answer_link_qa_c1_v1()
returns trigger language plpgsql volatile security definer set search_path='' as $$
declare v_composition jsonb;v_card jsonb;v_link private.story_question_answer_links;v_question text;
  v_trim constant text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  if tg_op='UPDATE' and new.story_composition is not distinct from old.story_composition then return null;end if;
  select story_composition into v_composition from public.stories where id=new.id;
  if not found then return null;end if;
  perform private.story_validate_composition(v_composition);
  select e into v_card from pg_catalog.jsonb_array_elements(v_composition->'elements') e where e->>'type'='question_answer';
  if v_card is null then return null;end if;
  select * into v_link from private.story_question_answer_links where story_id=new.id;
  select pg_catalog.btrim(r.payload->>'text',v_trim) into v_question from private.story_interactive_responses r
    join private.story_interactive_elements e on e.story_id=r.story_id and e.element_id=r.element_id and e.kind='question'
    join public.stories s on s.id=r.story_id and s.user_id=new.user_id
    where r.story_id=v_link.source_story_id and r.element_id=v_link.source_element_id and r.respondent_id=v_link.respondent_id;
  if v_link.story_id is null or v_question is null or v_question is distinct from v_card->>'question'
    or (v_card->>'id')::uuid in(v_link.source_story_id,v_link.source_element_id,v_link.respondent_id) then
    raise exception using errcode='23514',message='story_question_answer_provenance_required';end if;
  return null;
end;
$$;
alter function private.story_check_question_answer_link_qa_c1_v1() owner to postgres;
revoke all on function private.story_check_question_answer_link_qa_c1_v1() from public,anon,authenticated,service_role;
create constraint trigger story_question_answer_link_required after insert or update on public.stories
  deferrable initially deferred for each row execute function private.story_check_question_answer_link_qa_c1_v1();

create or replace function private.story_author_text_bundle_c1_v1(p_story_id uuid)
returns text language sql stable security definer set search_path='' as $$
  with definitions as(
    select e.public_config,pg_catalog.row_number() over(order by e.element_id) element_order
    from private.story_interactive_elements e where e.story_id=p_story_id
  )
  select coalesce(pg_catalog.string_agg(parts.value,E'\n' order by parts.section,parts.element_order,parts.option_order),'')
  from(
    select 0 section,x.ordinality element_order,0::bigint option_order,x.element->>'text' value
    from public.stories s cross join lateral pg_catalog.jsonb_array_elements(coalesce(s.story_composition->'elements','[]'::jsonb)) with ordinality x(element,ordinality)
    where s.id=p_story_id and x.element->>'type'='text'
    union all
    select 0,x.ordinality,0::bigint,x.element->>'value'
    from public.stories s cross join lateral pg_catalog.jsonb_array_elements(coalesce(s.story_composition->'elements','[]'::jsonb)) with ordinality x(element,ordinality)
    where s.id=p_story_id and x.element->>'type'='sticker'
    union all
    select 0,x.ordinality,q.option_order,q.value
    from public.stories s cross join lateral pg_catalog.jsonb_array_elements(coalesce(s.story_composition->'elements','[]'::jsonb)) with ordinality x(element,ordinality)
    cross join lateral(values(0::bigint,x.element->>'question'),(1::bigint,x.element->>'answer')) q(option_order,value)
    where s.id=p_story_id and x.element->>'type'='question_answer'
    union all select 1,e.element_order,0::bigint,e.public_config->>'prompt' from definitions e
    union all select 1,e.element_order,1::bigint,e.public_config->>'emoji' from definitions e where e.public_config->>'type' in('slider','reaction')
    union all select 1,e.element_order,o.ordinality+1,o.option->>'label' from definitions e
    cross join lateral pg_catalog.jsonb_array_elements(coalesce(e.public_config->'options','[]'::jsonb)) with ordinality o(option,ordinality)
  ) parts where parts.value is not null;
$$;
alter function private.story_author_text_bundle_c1_v1(uuid) owner to postgres;
revoke all on function private.story_author_text_bundle_c1_v1(uuid) from public,anon,authenticated,service_role;

-- The deferred insert guard cannot intercept an ordinary API's early replay.
-- Reject only QA inputs in all four existing composition-taking APIs, retaining
-- their ordinary media/definitions/enqueue/C2 orchestration unchanged.
create or replace function public.create_story_with_media(p_asset_id uuid,p_composition jsonb,p_client_story_id uuid,p_interactive_definitions jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_story uuid;v_scan uuid;
begin
  if pg_catalog.jsonb_path_exists(p_composition,'$.elements[*] ? (@.type == "question_answer")') then
    raise exception using errcode='42501',message='story_question_answer_requires_authority';end if;
  if auth.uid() is null or p_client_story_id is null then raise exception using errcode='22023',message='invalid_story_identity';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('story-create:'||auth.uid()::text||':'||p_client_story_id::text,0));
  v_story:=private.create_story_with_media_core(p_asset_id,p_composition,p_client_story_id);
  perform private.story_install_definitions(v_story,p_interactive_definitions);
  v_scan:=private.story_enqueue_media_safety_v1(v_story);
  perform private.story_publish_c2_v1(v_story,v_scan);
  return v_story;
end;
$$;
create or replace function public.create_story_with_media(p_asset_id uuid,p_composition jsonb,p_client_story_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_story uuid;v_scan uuid;
begin
  if pg_catalog.jsonb_path_exists(p_composition,'$.elements[*] ? (@.type == "question_answer")') then
    raise exception using errcode='42501',message='story_question_answer_requires_authority';end if;
  v_story:=private.create_story_with_media_core(p_asset_id,p_composition,p_client_story_id);
  v_scan:=private.story_enqueue_media_safety_v1(v_story);
  perform private.story_publish_c2_v1(v_story,v_scan);
  return v_story;
end;
$$;
create or replace function public.create_story_from_content(p_video_id uuid,p_composition jsonb,p_client_story_id uuid,p_interactive_definitions jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_story uuid;v_scan uuid;
begin
  if pg_catalog.jsonb_path_exists(p_composition,'$.elements[*] ? (@.type == "question_answer")') then
    raise exception using errcode='42501',message='story_question_answer_requires_authority';end if;
  if auth.uid() is null or p_client_story_id is null then raise exception using errcode='22023',message='invalid_story_identity';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('story-create:'||auth.uid()::text||':'||p_client_story_id::text,0));
  v_story:=private.create_story_from_content_core_c2_v1(p_video_id,p_composition,p_client_story_id);
  perform private.story_install_definitions(v_story,p_interactive_definitions);
  v_scan:=private.story_enqueue_media_safety_v1(v_story);
  perform private.story_publish_c2_v1(v_story,v_scan);
  return v_story;
end;
$$;
create or replace function public.create_story_from_content(p_video_id uuid,p_composition jsonb,p_client_story_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_story uuid;v_scan uuid;
begin
  if pg_catalog.jsonb_path_exists(p_composition,'$.elements[*] ? (@.type == "question_answer")') then
    raise exception using errcode='42501',message='story_question_answer_requires_authority';end if;
  v_story:=private.create_story_from_content_core_c2_v1(p_video_id,p_composition,p_client_story_id);
  v_scan:=private.story_enqueue_media_safety_v1(v_story);
  perform private.story_publish_c2_v1(v_story,v_scan);
  return v_story;
end;
$$;
alter function public.create_story_with_media(uuid,jsonb,uuid) owner to postgres;
alter function public.create_story_with_media(uuid,jsonb,uuid,jsonb) owner to postgres;
alter function public.create_story_from_content(uuid,jsonb,uuid) owner to postgres;
alter function public.create_story_from_content(uuid,jsonb,uuid,jsonb) owner to postgres;
revoke all on function public.create_story_with_media(uuid,jsonb,uuid),public.create_story_with_media(uuid,jsonb,uuid,jsonb),
  public.create_story_from_content(uuid,jsonb,uuid),public.create_story_from_content(uuid,jsonb,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_story_with_media(uuid,jsonb,uuid),public.create_story_with_media(uuid,jsonb,uuid,jsonb),
  public.create_story_from_content(uuid,jsonb,uuid),public.create_story_from_content(uuid,jsonb,uuid,jsonb) to authenticated;

commit;
