begin;

-- ALGO-6-L5-F2 extends the one canonical semantic row. Installation is
-- deliberately dormant: no existing profile may be transformed or processed.
do $$
begin
  if pg_catalog.to_regclass('private.video_semantic_profiles') is null then
    raise exception using errcode = '55000', message = 'algo_l5_semantic_authority_missing';
  end if;
  if exists (select 1 from private.video_semantic_profiles) then
    raise exception using errcode = '55000', message = 'algo_l5_f2_requires_dormant_empty_profiles';
  end if;
  if pg_catalog.to_regprocedure('private.content_safety_visual_source(text,uuid)') is null then
    raise exception using errcode = '55000', message = 'algo_l5_visual_source_authority_missing';
  end if;
end;
$$;

alter table private.video_semantic_profiles
  drop constraint video_semantic_profiles_input_version_check,
  alter column semantic_input_version set default 'video-semantic-v2',
  add column visual_semantic_status text not null default 'not_configured',
  add column visual_source_kind text null,
  add column visual_source_fingerprint text null,
  add column visual_source_video_asset_id uuid null,
  add column visual_source_media_asset_id uuid null,
  add column visual_provider text not null default 'cloudflare_workers_ai',
  add column visual_model text not null default '@cf/google/gemma-4-26b-a4b-it',
  add column visual_prompt_version text not null default 'video-semantic-visual-v1',
  add column visual_sample_strategy text null,
  add column visual_frame_timestamps_ms integer[] null,
  add column visual_semantic_text text null,
  add column visual_semantic_fingerprint text null,
  add column visual_attempt_count integer not null default 0,
  add column visual_available_at timestamptz not null default clock_timestamp(),
  add column visual_started_at timestamptz null,
  add column visual_completed_at timestamptz null,
  add column visual_last_error_code text null,
  add column visual_provider_call_count integer not null default 0,
  add constraint video_semantic_profiles_input_version_check
    check (semantic_input_version = 'video-semantic-v2'),
  add constraint video_semantic_profiles_visual_status_check
    check (visual_semantic_status in (
      'pending','processing','ready','failed','not_applicable','not_configured'
    )),
  add constraint video_semantic_profiles_visual_source_kind_check
    check (visual_source_kind is null or visual_source_kind in (
      'eligible_stream_video','eligible_image','not_applicable','not_configured'
    )),
  add constraint video_semantic_profiles_visual_source_fingerprint_check
    check (
      visual_source_fingerprint is null
      or visual_source_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  add constraint video_semantic_profiles_visual_semantic_fingerprint_check
    check (
      visual_semantic_fingerprint is null
      or visual_semantic_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  add constraint video_semantic_profiles_visual_provider_check
    check (visual_provider = 'cloudflare_workers_ai'),
  add constraint video_semantic_profiles_visual_model_check
    check (visual_model = '@cf/google/gemma-4-26b-a4b-it'),
  add constraint video_semantic_profiles_visual_prompt_check
    check (visual_prompt_version = 'video-semantic-visual-v1'),
  add constraint video_semantic_profiles_visual_sample_check
    check (
      (visual_source_kind = 'eligible_image' and visual_sample_strategy = 'single_image_v1')
      or (visual_source_kind = 'eligible_stream_video' and visual_sample_strategy = 'percentile_5_v1')
      or (visual_source_kind in ('not_applicable','not_configured') and visual_sample_strategy is null)
      or (visual_source_kind is null and visual_sample_strategy is null)
    ),
  add constraint video_semantic_profiles_visual_source_shape_check
    check (
      (
        visual_source_kind = 'eligible_image'
        and visual_source_fingerprint is not null
        and visual_source_media_asset_id is not null
        and visual_source_video_asset_id is null
      )
      or (
        visual_source_kind = 'eligible_stream_video'
        and visual_source_fingerprint is not null
        and visual_source_video_asset_id is not null
        and visual_source_media_asset_id is null
      )
      or (
        visual_source_kind in ('not_applicable','not_configured')
        and visual_source_fingerprint is null
        and visual_source_video_asset_id is null
        and visual_source_media_asset_id is null
      )
      or (
        visual_source_kind is null
        and visual_source_fingerprint is null
        and visual_source_video_asset_id is null
        and visual_source_media_asset_id is null
      )
    ),
  add constraint video_semantic_profiles_visual_attempt_check
    check (visual_attempt_count between 0 and 5),
  add constraint video_semantic_profiles_visual_provider_calls_check
    check (visual_provider_call_count >= 0),
  add constraint video_semantic_profiles_visual_text_check
    check (
      visual_semantic_text is null
      or (
        visual_semantic_text = btrim(visual_semantic_text)
        and visual_semantic_text <> ''
        and char_length(visual_semantic_text) <= 2500
      )
    ),
  add constraint video_semantic_profiles_visual_error_check
    check (
      visual_last_error_code is null
      or (
        visual_last_error_code = btrim(visual_last_error_code)
        and visual_last_error_code ~ '^[a-z0-9][a-z0-9_:-]{1,99}$'
      )
    ),
  add constraint video_semantic_profiles_visual_frames_check
    check (
      visual_frame_timestamps_ms is null
      or (
        cardinality(visual_frame_timestamps_ms) between 1 and 5
        and 0 <= all(visual_frame_timestamps_ms)
      )
    ),
  add constraint video_semantic_profiles_visual_state_check
    check (
      (
        visual_semantic_status = 'pending'
        and visual_source_kind in ('eligible_image','eligible_stream_video')
        and visual_semantic_text is null
        and visual_semantic_fingerprint is null
        and visual_started_at is null
        and visual_completed_at is null
      )
      or (
        visual_semantic_status = 'processing'
        and visual_source_kind in ('eligible_image','eligible_stream_video')
        and visual_semantic_text is null
        and visual_semantic_fingerprint is null
        and visual_started_at is not null
        and visual_completed_at is null
      )
      or (
        visual_semantic_status = 'ready'
        and visual_source_kind in ('eligible_image','eligible_stream_video')
        and visual_semantic_text is not null
        and visual_semantic_fingerprint is not null
        and visual_started_at is null
        and visual_completed_at is not null
      )
      or (
        visual_semantic_status = 'failed'
        and visual_source_kind in ('eligible_image','eligible_stream_video')
        and visual_semantic_text is null
        and visual_semantic_fingerprint is null
        and visual_started_at is null
        and visual_completed_at is not null
      )
      or (
        visual_semantic_status in ('not_applicable','not_configured')
        and visual_source_kind = visual_semantic_status
        and visual_semantic_text is null
        and visual_semantic_fingerprint is null
        and visual_started_at is null
        and visual_completed_at is null
      )
    ),
  add constraint video_semantic_profiles_visual_timestamps_check
    check (
      visual_available_at is not null
      and (visual_started_at is null or visual_started_at >= created_at)
      and (visual_completed_at is null or visual_completed_at >= created_at)
    );

create index video_semantic_profiles_visual_pending_idx
  on private.video_semantic_profiles(visual_available_at, video_id)
  where visual_semantic_status = 'pending' and visual_attempt_count < 5;

alter table private.video_semantic_profiles enable row level security;
revoke all on table private.video_semantic_profiles
  from public, anon, authenticated, service_role;

create or replace function private.video_semantic_visual_source_v1(p_video_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_source jsonb;
  v_identity jsonb;
  v_fingerprint text;
begin
  v_source := private.content_safety_visual_source('video', p_video_id);

  if v_source ->> 'kind' = 'eligible_stream_video' then
    v_identity := jsonb_build_object(
      'kind', 'eligible_stream_video',
      'video_asset_id', v_source ->> 'video_asset_id',
      'cloudflare_uid', v_source ->> 'cloudflare_uid',
      'duration_seconds', v_source ->> 'duration_seconds',
      'mime_type', v_source ->> 'mime_type'
    );
    v_fingerprint := private.content_safety_sha256(
      'video-semantic-visual-source-v1|' || v_identity::text
    );
    return v_identity || jsonb_build_object(
      'visual_source_fingerprint', v_fingerprint,
      'sample_strategy', 'percentile_5_v1'
    );
  elsif v_source ->> 'kind' = 'eligible_image' then
    v_identity := jsonb_build_object(
      'kind', 'eligible_image',
      'media_asset_id', v_source ->> 'media_asset_id',
      'bucket_name', v_source ->> 'bucket_name',
      'object_key', v_source ->> 'object_key',
      'mime_type', v_source ->> 'mime_type',
      'size_bytes', v_source ->> 'size_bytes'
    );
    v_fingerprint := private.content_safety_sha256(
      'video-semantic-visual-source-v1|' || v_identity::text
    );
    return v_identity || jsonb_build_object(
      'visual_source_fingerprint', v_fingerprint,
      'sample_strategy', 'single_image_v1'
    );
  end if;

  return jsonb_build_object(
    'kind', case
      when v_source ->> 'kind' = 'not_applicable' then 'not_applicable'
      else 'not_configured'
    end,
    'reason', coalesce(v_source ->> 'reason', 'canonical_visual_source_unavailable'),
    'visual_source_fingerprint', null,
    'sample_strategy', null
  );
end;
$$;

revoke all on function private.video_semantic_visual_source_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.video_semantic_input_v2(p_video_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_text jsonb;
  v_source jsonb;
  v_profile private.video_semantic_profiles;
  v_input_text text;
  v_visual_text text;
  v_components jsonb;
  v_eligible boolean;
  v_reason text;
  v_fingerprint text;
begin
  v_text := private.video_semantic_input_v1(p_video_id);
  if coalesce(v_text ->> 'reason', '') = 'video_not_found' then
    return v_text || jsonb_build_object('semantic_input_version', 'video-semantic-v2');
  end if;

  v_source := private.video_semantic_visual_source_v1(p_video_id);
  select p.* into v_profile
  from private.video_semantic_profiles p
  where p.video_id = p_video_id;

  v_input_text := coalesce(v_text ->> 'input_text', '');
  v_components := coalesce(v_text -> 'components', '[]'::jsonb);
  if found
     and v_profile.visual_semantic_status = 'ready'
     and v_profile.visual_source_fingerprint = v_source ->> 'visual_source_fingerprint'
     and btrim(coalesce(v_profile.visual_semantic_text, '')) <> '' then
    v_visual_text := left(btrim(v_profile.visual_semantic_text), 2500);
    v_input_text := v_input_text ||
      case when v_input_text = '' then '' else E'\n\n' end ||
      E'visual:\n' || v_visual_text;
    v_components := v_components || jsonb_build_array('visual');
  end if;

  v_input_text := left(v_input_text, 18000);
  v_eligible := v_input_text <> '';
  v_reason := case when v_eligible then 'eligible' else 'no_semantic_text' end;
  v_fingerprint := private.content_safety_sha256(
    'video-semantic-v2|' || coalesce(v_text ->> 'source_content_fingerprint', '') || '|' || v_input_text
  );

  return jsonb_build_object(
    'video_id', p_video_id,
    'source_content_fingerprint', v_text ->> 'source_content_fingerprint',
    'semantic_input_version', 'video-semantic-v2',
    'semantic_input_fingerprint', v_fingerprint,
    'caption_fingerprint', v_text ->> 'caption_fingerprint',
    'source_transcript_id', v_text ->> 'source_transcript_id',
    'source_transcript_fingerprint', v_text ->> 'source_transcript_fingerprint',
    'detected_language', v_text ->> 'detected_language',
    'visual_source_fingerprint', v_source ->> 'visual_source_fingerprint',
    'input_text', v_input_text,
    'components', v_components,
    'eligible', v_eligible,
    'reason', v_reason
  );
end;
$$;

revoke all on function private.video_semantic_input_v2(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.sync_video_semantic_profile_v1(p_video_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source jsonb;
  v_input jsonb;
  v_profile private.video_semantic_profiles;
  v_visual_status text;
  v_status text;
  v_visual_changed boolean := false;
begin
  v_source := private.video_semantic_visual_source_v1(p_video_id);
  v_input := private.video_semantic_input_v2(p_video_id);
  if coalesce(v_input ->> 'reason', '') = 'video_not_found' then
    raise exception using errcode = 'P0002', message = 'video_semantic_video_not_found';
  end if;

  v_visual_status := case
    when v_source ->> 'kind' in ('eligible_image','eligible_stream_video') then 'pending'
    when v_source ->> 'kind' = 'not_applicable' then 'not_applicable'
    else 'not_configured'
  end;
  v_status := case when (v_input ->> 'eligible')::boolean then 'pending' else 'not_eligible' end;

  insert into private.video_semantic_profiles(
    video_id, source_content_fingerprint, semantic_input_version,
    semantic_input_fingerprint, caption_fingerprint, source_transcript_id,
    source_transcript_fingerprint, detected_language, provider, model,
    embedding_dimensions, status, attempt_count, available_at,
    provider_call_count, visual_semantic_status, visual_source_kind,
    visual_source_fingerprint, visual_source_video_asset_id,
    visual_source_media_asset_id, visual_provider, visual_model,
    visual_prompt_version, visual_sample_strategy, visual_attempt_count,
    visual_available_at, visual_provider_call_count, created_at, updated_at
  ) values (
    p_video_id, v_input ->> 'source_content_fingerprint', 'video-semantic-v2',
    v_input ->> 'semantic_input_fingerprint', v_input ->> 'caption_fingerprint',
    (v_input ->> 'source_transcript_id')::uuid,
    v_input ->> 'source_transcript_fingerprint', v_input ->> 'detected_language',
    'cloudflare_workers_ai', '@cf/baai/bge-m3', 1024, v_status, 0,
    clock_timestamp(), 0, v_visual_status, v_source ->> 'kind',
    v_source ->> 'visual_source_fingerprint',
    (v_source ->> 'video_asset_id')::uuid,
    (v_source ->> 'media_asset_id')::uuid,
    'cloudflare_workers_ai', '@cf/google/gemma-4-26b-a4b-it',
    'video-semantic-visual-v1', v_source ->> 'sample_strategy', 0,
    clock_timestamp(), 0, clock_timestamp(), clock_timestamp()
  ) on conflict (video_id) do nothing;

  select p.* into v_profile
  from private.video_semantic_profiles p
  where p.video_id = p_video_id
  for update;

  v_visual_changed :=
    v_profile.visual_source_kind is distinct from v_source ->> 'kind'
    or v_profile.visual_source_fingerprint is distinct from v_source ->> 'visual_source_fingerprint'
    or v_profile.visual_source_video_asset_id is distinct from (v_source ->> 'video_asset_id')::uuid
    or v_profile.visual_source_media_asset_id is distinct from (v_source ->> 'media_asset_id')::uuid;

  if v_visual_changed then
    update private.video_semantic_profiles p
    set
      visual_semantic_status = v_visual_status,
      visual_source_kind = v_source ->> 'kind',
      visual_source_fingerprint = v_source ->> 'visual_source_fingerprint',
      visual_source_video_asset_id = (v_source ->> 'video_asset_id')::uuid,
      visual_source_media_asset_id = (v_source ->> 'media_asset_id')::uuid,
      visual_provider = 'cloudflare_workers_ai',
      visual_model = '@cf/google/gemma-4-26b-a4b-it',
      visual_prompt_version = 'video-semantic-visual-v1',
      visual_sample_strategy = v_source ->> 'sample_strategy',
      visual_frame_timestamps_ms = null,
      visual_semantic_text = null,
      visual_semantic_fingerprint = null,
      visual_attempt_count = 0,
      visual_available_at = clock_timestamp(),
      visual_started_at = null,
      visual_completed_at = null,
      visual_last_error_code = null,
      visual_provider_call_count = 0,
      updated_at = clock_timestamp()
    where p.video_id = p_video_id;
  end if;

  v_input := private.video_semantic_input_v2(p_video_id);
  v_status := case when (v_input ->> 'eligible')::boolean then 'pending' else 'not_eligible' end;

  select p.* into v_profile
  from private.video_semantic_profiles p
  where p.video_id = p_video_id
  for update;

  if v_visual_changed
     or v_profile.semantic_input_version <> 'video-semantic-v2'
     or v_profile.semantic_input_fingerprint <> v_input ->> 'semantic_input_fingerprint'
     or v_profile.source_content_fingerprint <> v_input ->> 'source_content_fingerprint'
     or v_profile.source_transcript_id is distinct from (v_input ->> 'source_transcript_id')::uuid
     or v_profile.source_transcript_fingerprint is distinct from v_input ->> 'source_transcript_fingerprint'
     or v_profile.detected_language is distinct from v_input ->> 'detected_language' then
    update private.video_semantic_profiles p
    set
      source_content_fingerprint = v_input ->> 'source_content_fingerprint',
      semantic_input_version = 'video-semantic-v2',
      semantic_input_fingerprint = v_input ->> 'semantic_input_fingerprint',
      caption_fingerprint = v_input ->> 'caption_fingerprint',
      source_transcript_id = (v_input ->> 'source_transcript_id')::uuid,
      source_transcript_fingerprint = v_input ->> 'source_transcript_fingerprint',
      detected_language = v_input ->> 'detected_language',
      provider = 'cloudflare_workers_ai',
      model = '@cf/baai/bge-m3',
      embedding_dimensions = 1024,
      embedding = null,
      status = v_status,
      attempt_count = 0,
      available_at = clock_timestamp(),
      started_at = null,
      completed_at = null,
      last_error_code = null,
      provider_call_count = 0,
      updated_at = clock_timestamp()
    where p.video_id = p_video_id;
  end if;

  select p.* into v_profile from private.video_semantic_profiles p where p.video_id = p_video_id;
  return jsonb_build_object(
    'video_id', v_profile.video_id,
    'status', v_profile.status,
    'visual_semantic_status', v_profile.visual_semantic_status,
    'semantic_input_fingerprint', v_profile.semantic_input_fingerprint,
    'eligible', (v_input ->> 'eligible')::boolean,
    'reason', v_input ->> 'reason'
  );
end;
$$;

revoke all on function private.sync_video_semantic_profile_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.refresh_video_semantic_profile_v1(p_video_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_input jsonb;
begin
  v_result := private.sync_video_semantic_profile_v1(p_video_id);
  v_input := private.video_semantic_input_v2(p_video_id);

  update private.video_semantic_profiles p
  set status = 'pending', attempt_count = 0, available_at = clock_timestamp(),
      completed_at = null, last_error_code = null, updated_at = clock_timestamp()
  where p.video_id = p_video_id and p.status = 'failed'
    and (v_input ->> 'eligible')::boolean;

  update private.video_semantic_profiles p
  set visual_semantic_status = 'pending', visual_attempt_count = 0,
      visual_available_at = clock_timestamp(), visual_completed_at = null,
      visual_last_error_code = null, updated_at = clock_timestamp()
  where p.video_id = p_video_id and p.visual_semantic_status = 'failed'
    and p.visual_source_kind in ('eligible_image','eligible_stream_video');

  select jsonb_build_object(
    'video_id', p.video_id, 'status', p.status,
    'visual_semantic_status', p.visual_semantic_status,
    'semantic_input_fingerprint', p.semantic_input_fingerprint,
    'eligible', (v_input ->> 'eligible')::boolean,
    'reason', v_input ->> 'reason'
  ) into v_result from private.video_semantic_profiles p where p.video_id = p_video_id;
  return v_result;
end;
$$;

revoke all on function public.refresh_video_semantic_profile_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.refresh_video_semantic_profile_v1(uuid) to service_role;

create or replace function public.claim_video_semantic_profiles_v1(p_limit integer default 8)
returns table(
  video_id uuid, semantic_input_fingerprint text, input_text text,
  provider text, model text, embedding_dimensions integer, attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile private.video_semantic_profiles;
  v_input jsonb;
  v_attempt_count integer;
begin
  if p_limit is null or not (p_limit between 1 and 25) then
    raise exception using errcode = '22023', message = 'invalid_video_semantic_claim_limit';
  end if;

  for v_profile in
    select p.* from private.video_semantic_profiles p
    where p.status = 'pending' and p.attempt_count < 5
      and p.available_at <= clock_timestamp()
      and p.visual_semantic_status in ('ready','failed','not_applicable','not_configured')
    order by p.available_at, p.video_id
    for update skip locked limit p_limit
  loop
    perform private.sync_video_semantic_profile_v1(v_profile.video_id);
    select p.* into v_profile from private.video_semantic_profiles p
    where p.video_id = v_profile.video_id for update;
    v_input := private.video_semantic_input_v2(v_profile.video_id);
    if v_profile.visual_semantic_status not in ('ready','failed','not_applicable','not_configured')
       or not coalesce((v_input ->> 'eligible')::boolean, false)
       or v_profile.semantic_input_fingerprint <> v_input ->> 'semantic_input_fingerprint' then
      continue;
    end if;
    update private.video_semantic_profiles p
    set status = 'processing', attempt_count = p.attempt_count + 1,
        started_at = clock_timestamp(), completed_at = null,
        last_error_code = null, updated_at = clock_timestamp()
    where p.video_id = v_profile.video_id
    returning p.attempt_count into v_attempt_count;
    video_id := v_profile.video_id;
    semantic_input_fingerprint := v_input ->> 'semantic_input_fingerprint';
    input_text := v_input ->> 'input_text';
    provider := 'cloudflare_workers_ai'; model := '@cf/baai/bge-m3';
    embedding_dimensions := 1024; attempt_count := v_attempt_count;
    return next;
  end loop;
end;
$$;

revoke all on function public.claim_video_semantic_profiles_v1(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_video_semantic_profiles_v1(integer) to service_role;

create or replace function public.complete_video_semantic_profile_v1(
  p_video_id uuid,
  p_semantic_input_fingerprint text,
  p_embedding extensions.vector(1024)
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile private.video_semantic_profiles;
  v_input jsonb;
begin
  select p.* into v_profile from private.video_semantic_profiles p
  where p.video_id = p_video_id for update;
  if not found then raise exception using errcode='P0002', message='video_semantic_profile_not_found'; end if;
  v_input := private.video_semantic_input_v2(p_video_id);
  if p_semantic_input_fingerprint is null
     or p_semantic_input_fingerprint !~ '^[0-9a-f]{64}$'
     or v_profile.semantic_input_fingerprint <> p_semantic_input_fingerprint
     or v_input ->> 'semantic_input_fingerprint' <> p_semantic_input_fingerprint then
    perform private.sync_video_semantic_profile_v1(p_video_id);
    return jsonb_build_object('video_id',p_video_id,'status','stale','stored',false);
  end if;
  if v_profile.status <> 'processing' then
    raise exception using errcode='55000', message='video_semantic_profile_not_processing';
  end if;
  if v_profile.visual_semantic_status not in ('ready','failed','not_applicable','not_configured')
     or v_profile.provider <> 'cloudflare_workers_ai'
     or v_profile.model <> '@cf/baai/bge-m3'
     or v_profile.embedding_dimensions <> 1024 then
    raise exception using errcode='55000', message='video_semantic_provider_contract_mismatch';
  end if;
  if p_embedding is null or extensions.vector_dims(p_embedding) <> 1024 then
    raise exception using errcode='22023', message='invalid_video_semantic_embedding_dimensions';
  end if;
  update private.video_semantic_profiles p
  set embedding=p_embedding,status='ready',started_at=null,
      completed_at=clock_timestamp(),last_error_code=null,
      provider_call_count=p.provider_call_count+1,updated_at=clock_timestamp()
  where p.video_id=p_video_id;
  return jsonb_build_object('video_id',p_video_id,'status','ready','stored',true,'embedding_dimensions',1024);
end;
$$;

revoke all on function public.complete_video_semantic_profile_v1(uuid,text,extensions.vector)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_video_semantic_profile_v1(uuid,text,extensions.vector) to service_role;

create or replace function public.fail_video_semantic_profile_v1(
  p_video_id uuid,
  p_semantic_input_fingerprint text,
  p_error_code text,
  p_retryable boolean default true,
  p_provider_called boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile private.video_semantic_profiles;
  v_input jsonb;
  v_error_code text;
  v_retry boolean;
  v_available_at timestamptz;
begin
  select p.* into v_profile from private.video_semantic_profiles p
  where p.video_id=p_video_id for update;
  if not found then raise exception using errcode='P0002',message='video_semantic_profile_not_found';end if;
  v_input:=private.video_semantic_input_v2(p_video_id);
  if p_semantic_input_fingerprint is null
     or p_semantic_input_fingerprint !~ '^[0-9a-f]{64}$'
     or v_profile.semantic_input_fingerprint<>p_semantic_input_fingerprint
     or v_input->>'semantic_input_fingerprint'<>p_semantic_input_fingerprint then
    perform private.sync_video_semantic_profile_v1(p_video_id);
    return jsonb_build_object('video_id',p_video_id,'status','stale','stored',false);
  end if;
  if v_profile.status<>'processing' then
    raise exception using errcode='55000',message='video_semantic_profile_not_processing';
  end if;
  v_error_code:=left(lower(regexp_replace(btrim(coalesce(p_error_code,'')),'[^a-z0-9_:-]+','_','g')),100);
  if char_length(v_error_code)<2 then v_error_code:='semantic_worker_error';end if;
  v_retry:=coalesce(p_retryable,false) and v_profile.attempt_count<5;
  v_available_at:=case when v_retry then clock_timestamp()+make_interval(
    secs=>least(1800,(30*power(2,greatest(v_profile.attempt_count-1,0)))::integer)
  ) else clock_timestamp() end;
  update private.video_semantic_profiles p
  set status=case when v_retry then 'pending' else 'failed' end,
      available_at=v_available_at,started_at=null,
      completed_at=case when v_retry then null else clock_timestamp() end,
      last_error_code=v_error_code,
      provider_call_count=p.provider_call_count+case when coalesce(p_provider_called,false) then 1 else 0 end,
      updated_at=clock_timestamp()
  where p.video_id=p_video_id;
  return jsonb_build_object('video_id',p_video_id,'status',case when v_retry then 'pending' else 'failed' end,
    'retryable',v_retry,'available_at',v_available_at,'attempt_count',v_profile.attempt_count);
end;
$$;

revoke all on function public.fail_video_semantic_profile_v1(uuid,text,text,boolean,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_video_semantic_profile_v1(uuid,text,text,boolean,boolean) to service_role;

create or replace function public.claim_video_semantic_visual_v1(p_limit integer default 2)
returns table(
  video_id uuid, visual_source_kind text, visual_source_fingerprint text,
  video_asset_id uuid, cloudflare_uid text, duration_seconds numeric, mime_type text,
  media_asset_id uuid, bucket_name text, object_key text, size_bytes bigint,
  visual_provider text, visual_model text, visual_prompt_version text,
  visual_attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile private.video_semantic_profiles;
  v_source jsonb;
  v_attempt integer;
begin
  if p_limit is null or not (p_limit between 1 and 5) then
    raise exception using errcode='22023',message='invalid_video_semantic_visual_claim_limit';
  end if;
  for v_profile in
    select p.* from private.video_semantic_profiles p
    where p.visual_semantic_status='pending' and p.visual_attempt_count<5
      and p.visual_available_at<=clock_timestamp()
    order by p.visual_available_at,p.video_id
    for update skip locked limit p_limit
  loop
    v_source:=private.video_semantic_visual_source_v1(v_profile.video_id);
    if v_profile.visual_source_fingerprint is distinct from v_source->>'visual_source_fingerprint'
       or v_profile.visual_source_kind is distinct from v_source->>'kind' then
      perform private.sync_video_semantic_profile_v1(v_profile.video_id);
      continue;
    end if;
    update private.video_semantic_profiles p
    set visual_semantic_status='processing',visual_attempt_count=p.visual_attempt_count+1,
        visual_started_at=clock_timestamp(),visual_completed_at=null,
        visual_last_error_code=null,updated_at=clock_timestamp()
    where p.video_id=v_profile.video_id returning p.visual_attempt_count into v_attempt;
    video_id:=v_profile.video_id;
    visual_source_kind:=v_source->>'kind';
    visual_source_fingerprint:=v_source->>'visual_source_fingerprint';
    video_asset_id:=(v_source->>'video_asset_id')::uuid;
    cloudflare_uid:=v_source->>'cloudflare_uid';
    duration_seconds:=(v_source->>'duration_seconds')::numeric;
    mime_type:=v_source->>'mime_type';
    media_asset_id:=(v_source->>'media_asset_id')::uuid;
    bucket_name:=v_source->>'bucket_name'; object_key:=v_source->>'object_key';
    size_bytes:=(v_source->>'size_bytes')::bigint;
    visual_provider:='cloudflare_workers_ai';
    visual_model:='@cf/google/gemma-4-26b-a4b-it';
    visual_prompt_version:='video-semantic-visual-v1';
    visual_attempt_count:=v_attempt;
    return next;
  end loop;
end;
$$;

revoke all on function public.claim_video_semantic_visual_v1(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_video_semantic_visual_v1(integer) to service_role;

create or replace function public.complete_video_semantic_visual_v1(
  p_video_id uuid,
  p_visual_source_fingerprint text,
  p_visual_semantic_text text,
  p_frame_timestamps_ms integer[],
  p_provider_call_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile private.video_semantic_profiles;
  v_source jsonb;
  v_text text;
  v_semantic_fingerprint text;
  v_frame_count integer;
  v_duration_ms integer;
begin
  select p.* into v_profile from private.video_semantic_profiles p
  where p.video_id=p_video_id for update;
  if not found then raise exception using errcode='P0002',message='video_semantic_profile_not_found';end if;
  v_source:=private.video_semantic_visual_source_v1(p_video_id);
  if p_visual_source_fingerprint is null
     or p_visual_source_fingerprint !~ '^[0-9a-f]{64}$'
     or v_profile.visual_source_fingerprint<>p_visual_source_fingerprint
     or v_source->>'visual_source_fingerprint'<>p_visual_source_fingerprint then
    perform private.sync_video_semantic_profile_v1(p_video_id);
    return jsonb_build_object('video_id',p_video_id,'status','stale','stored',false);
  end if;
  if v_profile.visual_semantic_status<>'processing' then
    raise exception using errcode='55000',message='video_semantic_visual_not_processing';
  end if;
  if v_profile.visual_provider<>'cloudflare_workers_ai'
     or v_profile.visual_model<>'@cf/google/gemma-4-26b-a4b-it'
     or v_profile.visual_prompt_version<>'video-semantic-visual-v1' then
    raise exception using errcode='55000',message='video_semantic_visual_provider_contract_mismatch';
  end if;
  v_text:=btrim(coalesce(p_visual_semantic_text,''));
  if v_text='' or char_length(v_text)>2500 then
    raise exception using errcode='22023',message='invalid_video_semantic_visual_text';
  end if;
  v_frame_count:=coalesce(cardinality(p_frame_timestamps_ms),0);
  if v_source->>'kind'='eligible_image' then
    if p_provider_call_count<>1 or v_frame_count<>0 then
      raise exception using errcode='22023',message='invalid_video_semantic_visual_image_receipt';
    end if;
  elsif v_source->>'kind'='eligible_stream_video' then
    v_duration_ms:=floor((v_source->>'duration_seconds')::numeric*1000)::integer;
    if p_provider_call_count not between 1 and 5 or v_frame_count not between 1 and 5
       or exists(select 1 from unnest(p_frame_timestamps_ms) t where t<0 or t>v_duration_ms)
       or (select count(*) from unnest(p_frame_timestamps_ms)) <>
          (select count(distinct t) from unnest(p_frame_timestamps_ms) t) then
      raise exception using errcode='22023',message='invalid_video_semantic_visual_stream_receipt';
    end if;
  else
    raise exception using errcode='55000',message='video_semantic_visual_source_not_eligible';
  end if;
  v_semantic_fingerprint:=private.content_safety_sha256(
    'video-semantic-visual-v1|'||p_visual_source_fingerprint||'|'||v_text
  );
  update private.video_semantic_profiles p
  set visual_semantic_status='ready',visual_frame_timestamps_ms=p_frame_timestamps_ms,
      visual_semantic_text=v_text,visual_semantic_fingerprint=v_semantic_fingerprint,
      visual_started_at=null,visual_completed_at=clock_timestamp(),visual_last_error_code=null,
      visual_provider_call_count=p.visual_provider_call_count+p_provider_call_count,
      updated_at=clock_timestamp()
  where p.video_id=p_video_id;
  perform private.sync_video_semantic_profile_v1(p_video_id);
  return jsonb_build_object('video_id',p_video_id,'status','ready','stored',true,
    'visual_semantic_fingerprint',v_semantic_fingerprint);
end;
$$;

revoke all on function public.complete_video_semantic_visual_v1(uuid,text,text,integer[],integer)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_video_semantic_visual_v1(uuid,text,text,integer[],integer) to service_role;

create or replace function public.fail_video_semantic_visual_v1(
  p_video_id uuid,
  p_visual_source_fingerprint text,
  p_error_code text,
  p_retryable boolean default true,
  p_provider_call_count integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile private.video_semantic_profiles;
  v_source jsonb;
  v_error text;
  v_retry boolean;
  v_available timestamptz;
  v_max_calls integer;
begin
  select p.* into v_profile from private.video_semantic_profiles p
  where p.video_id=p_video_id for update;
  if not found then raise exception using errcode='P0002',message='video_semantic_profile_not_found';end if;
  v_source:=private.video_semantic_visual_source_v1(p_video_id);
  if p_visual_source_fingerprint is null
     or p_visual_source_fingerprint !~ '^[0-9a-f]{64}$'
     or v_profile.visual_source_fingerprint<>p_visual_source_fingerprint
     or v_source->>'visual_source_fingerprint'<>p_visual_source_fingerprint then
    perform private.sync_video_semantic_profile_v1(p_video_id);
    return jsonb_build_object('video_id',p_video_id,'status','stale','stored',false);
  end if;
  if v_profile.visual_semantic_status<>'processing' then
    raise exception using errcode='55000',message='video_semantic_visual_not_processing';
  end if;
  v_max_calls:=case when v_source->>'kind'='eligible_image' then 1 else 5 end;
  if p_provider_call_count is null or p_provider_call_count not between 0 and v_max_calls then
    raise exception using errcode='22023',message='invalid_video_semantic_visual_provider_call_count';
  end if;
  v_error:=left(lower(regexp_replace(btrim(coalesce(p_error_code,'')),'[^a-z0-9_:-]+','_','g')),100);
  if char_length(v_error)<2 then v_error:='visual_semantic_worker_error';end if;
  v_retry:=coalesce(p_retryable,false) and v_profile.visual_attempt_count<5;
  v_available:=case when v_retry then clock_timestamp()+make_interval(
    secs=>least(1800,(30*power(2,greatest(v_profile.visual_attempt_count-1,0)))::integer)
  ) else clock_timestamp() end;
  update private.video_semantic_profiles p
  set visual_semantic_status=case when v_retry then 'pending' else 'failed' end,
      visual_available_at=v_available,visual_started_at=null,
      visual_completed_at=case when v_retry then null else clock_timestamp() end,
      visual_frame_timestamps_ms=null,visual_semantic_text=null,
      visual_semantic_fingerprint=null,visual_last_error_code=v_error,
      visual_provider_call_count=p.visual_provider_call_count+p_provider_call_count,
      updated_at=clock_timestamp()
  where p.video_id=p_video_id;
  perform private.sync_video_semantic_profile_v1(p_video_id);
  return jsonb_build_object('video_id',p_video_id,
    'status',case when v_retry then 'pending' else 'failed' end,
    'retryable',v_retry,'available_at',v_available,'attempt_count',v_profile.visual_attempt_count);
end;
$$;

revoke all on function public.fail_video_semantic_visual_v1(uuid,text,text,boolean,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_video_semantic_visual_v1(uuid,text,text,boolean,integer) to service_role;

create or replace function public.reconcile_algo_l1_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ranking_function as (
    select p.oid, p.proacl, p.proconfig, pg_get_functiondef(p.oid) as definition
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_ranked_feed_l1_v1'
      and pg_catalog.pg_get_function_identity_arguments(p.oid) =
        'p_client_session_id uuid, p_limit integer, p_as_of timestamp with time zone, p_before_score numeric, p_before_created_at timestamp with time zone, p_before_id uuid, p_policy_version text'
  ),
  request_function as (
    select p.oid, p.proconfig
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'request_my_algo_l1_canary_v1'
      and pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
  ),
  manage_function as (
    select p.oid, p.proconfig
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'manage_algo_l1_canary_v1'
      and pg_catalog.pg_get_function_identity_arguments(p.oid) =
        'p_action text, p_request_id uuid, p_ttl_minutes integer'
  ),
  semantic_input_function as (
    select p.oid, p.proacl, p.proconfig, pg_catalog.pg_get_functiondef(p.oid) as definition
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('video_semantic_input_v1','video_semantic_input_v2','video_semantic_visual_source_v1')
      and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_video_id uuid'
  ),
  semantic_queue_functions as (
    select p.oid, p.proname, p.prosecdef, p.proconfig
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'refresh_video_semantic_profile_v1',
        'claim_video_semantic_profiles_v1',
        'complete_video_semantic_profile_v1',
        'fail_video_semantic_profile_v1'
      )
  )
  select jsonb_build_object(
    'l5_visual_semantic_authority_missing', (
      select case when
        pg_catalog.to_regprocedure('private.video_semantic_visual_source_v1(uuid)') is not null
        and pg_catalog.to_regprocedure('private.video_semantic_input_v2(uuid)') is not null
        and (
          select count(*) = 18
          from pg_catalog.pg_attribute a
          join pg_catalog.pg_class c on c.oid = a.attrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'private'
            and c.relname = 'video_semantic_profiles'
            and a.attnum > 0
            and not a.attisdropped
            and a.attname in (
              'visual_semantic_status','visual_source_kind',
              'visual_source_fingerprint','visual_source_video_asset_id',
              'visual_source_media_asset_id','visual_provider','visual_model',
              'visual_prompt_version','visual_sample_strategy',
              'visual_frame_timestamps_ms','visual_semantic_text',
              'visual_semantic_fingerprint','visual_attempt_count',
              'visual_available_at','visual_started_at','visual_completed_at',
              'visual_last_error_code','visual_provider_call_count'
            )
        )
        and (
          select count(*) = 3
            and bool_and(
              p.prosecdef
              and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']::text[]
              and pg_catalog.has_function_privilege('service_role', p.oid, 'execute')
              and not pg_catalog.has_function_privilege('public', p.oid, 'execute')
              and not pg_catalog.has_function_privilege('anon', p.oid, 'execute')
              and not pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')
            )
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in (
              'claim_video_semantic_visual_v1',
              'complete_video_semantic_visual_v1',
              'fail_video_semantic_visual_v1'
            )
        )
        and exists (
          select 1 from pg_catalog.pg_constraint con
          where con.conrelid = 'private.video_semantic_profiles'::regclass
            and position('cloudflare_workers_ai' in pg_catalog.pg_get_constraintdef(con.oid)) > 0
        )
        and exists (
          select 1 from pg_catalog.pg_constraint con
          where con.conrelid = 'private.video_semantic_profiles'::regclass
            and position('@cf/google/gemma-4-26b-a4b-it' in pg_catalog.pg_get_constraintdef(con.oid)) > 0
        )
        and exists (
          select 1 from pg_catalog.pg_constraint con
          where con.conrelid = 'private.video_semantic_profiles'::regclass
            and position('video-semantic-visual-v1' in pg_catalog.pg_get_constraintdef(con.oid)) > 0
        )
        and not exists (
          select 1
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname in ('public','private')
            and c.relkind in ('r','p','v','m')
            and c.relname in (
              'visual_semantic_profiles','video_visual_embeddings',
              'video_semantic_visuals','visual_semantic_queue'
            )
        )
      then 0 else 1 end
    ),
    'l5_visual_semantic_sensitive_inference_present', (
      select count(*)
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private'
        and p.proname in (
          'video_semantic_visual_source_v1',
          'video_semantic_input_v2',
          'sync_video_semantic_profile_v1'
        )
        and (
          lower(pg_catalog.pg_get_functiondef(p.oid)) ~
            '(content_safety_visual_analyses|content_safety_alerts|public\\.reports|admin_user_warnings)'
          or lower(pg_catalog.pg_get_functiondef(p.oid)) ~
            '(person_identity|identity_inference|face_recognition|race_inference|ethnicity_inference|nationality_inference|religion_inference|sexual_orientation|gender_identity|health_inference|disability_inference|political_affiliation)'
          or lower(pg_catalog.pg_get_functiondef(p.oid)) ~
            '(advertising|marketplace|shipping|orders|financial_transactions|ledger_entries|wallet)'
          or lower(pg_catalog.pg_get_functiondef(p.oid)) ~
            '(public\\.messages|private_chat|user_profiles\\.location|gps|ip_address|device_model|network_type|network_state)'
        )
    ),
    'l5_vector_extension_missing', (
      select case when count(*) = 1
        and bool_and(n.nspname = 'extensions')
      then 0 else 1 end
      from pg_catalog.pg_extension e
      join pg_catalog.pg_namespace n on n.oid = e.extnamespace
      where e.extname = 'vector'
    ),
    'l5_semantic_profile_authority_missing', (
      select case when
        pg_catalog.to_regclass('private.video_semantic_profiles') is not null
        and exists (
          select 1
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'private'
            and c.relname = 'video_semantic_profiles'
            and c.relkind = 'r'
            and c.relrowsecurity
        )
        and exists (
          select 1
          from pg_catalog.pg_attribute a
          join pg_catalog.pg_class c on c.oid = a.attrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          join pg_catalog.pg_type t on t.oid = a.atttypid
          join pg_catalog.pg_namespace tn on tn.oid = t.typnamespace
          where n.nspname = 'private'
            and c.relname = 'video_semantic_profiles'
            and a.attname = 'embedding'
            and not a.attisdropped
            and tn.nspname = 'extensions'
            and t.typname = 'vector'
            and pg_catalog.format_type(a.atttypid, a.atttypmod) ~ 'vector\(1024\)$'
        )
        and (
          select count(*) = 39
            and count(*) filter (
              where a.attname in (
                'video_id',
                'source_content_fingerprint',
                'semantic_input_version',
                'semantic_input_fingerprint',
                'caption_fingerprint',
                'source_transcript_id',
                'source_transcript_fingerprint',
                'detected_language',
                'provider',
                'model',
                'embedding_dimensions',
                'embedding',
                'status',
                'attempt_count',
                'available_at',
                'started_at',
                'completed_at',
                'last_error_code',
                'provider_call_count',
                'created_at',
                'updated_at'
              )
            ) = 21
          from pg_catalog.pg_attribute a
          join pg_catalog.pg_class c on c.oid = a.attrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'private'
            and c.relname = 'video_semantic_profiles'
            and a.attnum > 0
            and not a.attisdropped
        )
        and (
          select count(*) = 15
          from pg_catalog.pg_constraint con
          where con.conrelid = 'private.video_semantic_profiles'::regclass
            and con.conname in (
              'video_semantic_profiles_source_fingerprint_check',
              'video_semantic_profiles_input_version_check',
              'video_semantic_profiles_input_fingerprint_check',
              'video_semantic_profiles_caption_fingerprint_check',
              'video_semantic_profiles_transcript_fingerprint_check',
              'video_semantic_profiles_language_check',
              'video_semantic_profiles_provider_check',
              'video_semantic_profiles_model_check',
              'video_semantic_profiles_dimensions_check',
              'video_semantic_profiles_status_check',
              'video_semantic_profiles_attempt_check',
              'video_semantic_profiles_provider_calls_check',
              'video_semantic_profiles_error_check',
              'video_semantic_profiles_state_check',
              'video_semantic_profiles_timestamps_check'
            )
        )
        and exists (
          select 1
          from pg_catalog.pg_index i
          join pg_catalog.pg_class c on c.oid = i.indrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'private'
            and c.relname = 'video_semantic_profiles'
            and i.indisprimary
        )
        and not pg_catalog.has_table_privilege(
          'public', 'private.video_semantic_profiles', 'select,insert,update,delete'
        )
        and not pg_catalog.has_table_privilege(
          'anon', 'private.video_semantic_profiles', 'select,insert,update,delete'
        )
        and not pg_catalog.has_table_privilege(
          'authenticated', 'private.video_semantic_profiles', 'select,insert,update,delete'
        )
        and not pg_catalog.has_table_privilege(
          'service_role', 'private.video_semantic_profiles', 'select,insert,update,delete'
        )
      then 0 else 1 end
    ),
    'l5_semantic_queue_authority_missing', (
      select case when count(*) = 4
        and bool_and(
          prosecdef
          and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']::text[]
          and pg_catalog.has_function_privilege('service_role', oid, 'execute')
          and not pg_catalog.has_function_privilege('public', oid, 'execute')
          and not pg_catalog.has_function_privilege('anon', oid, 'execute')
          and not pg_catalog.has_function_privilege('authenticated', oid, 'execute')
        )
        and pg_catalog.to_regprocedure('private.video_semantic_input_v1(uuid)') is not null
        and pg_catalog.to_regprocedure('private.sync_video_semantic_profile_v1(uuid)') is not null
        and (
          select count(*) = 2
          from pg_catalog.pg_trigger t
          where not t.tgisinternal
            and t.tgname in (
              'video_semantic_profile_sync',
              'video_semantic_profile_transcript_sync'
            )
        )
      then 0 else 1 end
      from semantic_queue_functions
    ),
    'l5_parallel_semantic_authority_present', (
      select count(*)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public','private')
        and c.relkind in ('r','p','v','m')
        and c.relname in (
          'video_embeddings',
          'content_embeddings',
          'semantic_embeddings',
          'video_semantic_scores',
          'semantic_ranking_cache',
          'user_interest_vectors',
          'user_semantic_profiles',
          'visual_semantic_profiles',
          'video_visual_embeddings',
          'video_semantic_visuals',
          'visual_semantic_queue'
        )
    ),
    'l5_sensitive_semantic_source_present', (
      select count(*)
      from semantic_input_function
      where position('content_safety_alerts' in lower(definition)) > 0
         or position('public.reports' in lower(definition)) > 0
         or position('admin_user_warnings' in lower(definition)) > 0
         or position('content_safety_visual_analyses' in lower(definition)) > 0
         or position('analysis_result' in lower(definition)) > 0
         or position('review_required' in lower(definition)) > 0
         or lower(definition) ~ '(advertising|marketplace|shipping|orders)'
         or lower(definition) ~ '(financial_transactions|ledger_entries|wallet)'
         or lower(definition) ~ '(public\\.messages|private_chat)'
         or lower(definition) ~ '(user_profiles\\.location|gps|ip_address)'
         or lower(definition) ~ '(call_devices|device_model|network_type|network_state)'
    ),
    'policy_singleton_invalid', (
      select case when count(*) = 1 and bool_and(singleton) then 0 else 1 end
      from private.algo_l1_policy
    ),
    'policy_values_invalid', (
      select count(*)
      from private.algo_l1_policy p
      where p.production_rollout_bps not between 0 and 10000
         or p.candidate_pool_size not between 1 and 1000
         or p.max_page_size not between 1 and 50
         or p.freshness_horizon_hours not between 1 and 720
         or p.short_watch_ratio_threshold not between 0 and 1
         or p.minimum_watch_samples not between 1 and 100
         or p.creator_page_cap not between 1 and 50
         or p.cursor_ttl_minutes not between 1 and 1440
         or least(
           p.freshness_weight,p.follow_weight,p.like_weight,p.comment_weight,
           p.save_weight,p.completion_weight,p.rewatch_weight,p.exploration_weight,
           p.short_watch_penalty,p.recent_completed_penalty,p.repeat_view_penalty,
           p.repeat_view_penalty_cap,p.same_session_penalty
         ) < 0
    ),
    'l2_affinity_policy_invalid', (
      select count(*)
      from private.algo_l1_policy p
      where p.l2_affinity_horizon_days not between 1 and 365
         or p.l2_affinity_long_watch_ratio_threshold not between 0 and 1
         or p.l2_affinity_negative_min_distinct_videos < 1
         or least(
           p.l2_affinity_like_weight,
           p.l2_affinity_comment_weight,
           p.l2_affinity_save_weight,
           p.l2_affinity_completed_weight,
           p.l2_affinity_long_watch_weight,
           p.l2_affinity_rewatch_weight,
           p.l2_affinity_short_watch_penalty,
           p.l2_affinity_per_video_positive_cap,
           p.l2_affinity_per_video_negative_cap,
           p.l2_affinity_creator_positive_cap,
           p.l2_affinity_creator_negative_cap
         ) < 0
    ),
    'l2_affinity_unexpectedly_enabled', (
      select count(*)
      from private.algo_l1_policy
      where l2_affinity_enabled
    ),
    'l2_affinity_authority_missing', (
      select case when count(*) = 1
        and bool_and(
          position('affinity_creator_scores as' in lower(definition)) > 0
          and position('creator_affinity_points' in lower(definition)) > 0
          and position('behavioral_l2' in lower(definition)) > 0
        )
      then 0 else 1 end
      from ranking_function
    ),
    'l2_affinity_materialization_present', (
      select count(*)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public','private')
        and c.relkind in ('r','p','v','m')
        and (
          c.relname ~ '(affinity|creator_interest|user_interest)'
          or c.relname in ('creator_scores','user_creator_scores','affinity_cache')
        )
    ),
    'l3_policy_invalid', (
      select count(*)
      from private.algo_l1_policy p
      where p.l3_retention_horizon_days not between 1 and 365
         or p.l3_quality_min_samples not between 1 and 100
         or p.l3_quality_full_confidence_samples
              not between p.l3_quality_min_samples and 1000
         or p.l3_long_watch_ratio_threshold not between 0 and 1
         or p.l3_creator_burst_horizon_hours not between 1 and 720
         or p.l3_creator_burst_free_posts not between 0 and 1000
         or p.l3_duplicate_horizon_days not between 1 and 3650
         or p.l3_creator_history_cap not between 1 and 1000
         or least(
           p.l3_quality_weight,
           p.l3_creator_burst_penalty_per_post,
           p.l3_creator_burst_penalty_cap,
           p.l3_duplicate_penalty
         ) < 0
         or greatest(
           p.l3_quality_weight,
           p.l3_creator_burst_penalty_per_post,
           p.l3_creator_burst_penalty_cap,
           p.l3_duplicate_penalty
         ) > 1000
    ),
    'l3_unexpectedly_enabled', (
      select count(*)
      from private.algo_l1_policy
      where l3_quality_enabled
    ),
    'l3_retention_authority_missing', (
      select case when count(*) = 1
        and bool_and(
          position('l3_retention_ranked as' in lower(definition)) > 0
          and position('l3_retention_features as' in lower(definition)) > 0
          and position('l3_quality_points' in lower(definition)) > 0
          and position('behavioral_l3' in lower(definition)) > 0
          and position('public.video_views' in lower(definition)) > 0
        )
      then 0 else 1 end
      from ranking_function
    ),
    'l3_duplicate_fingerprint_authority_missing', (
      select case when count(*) = 1
        and bool_and(
          position('l3_creator_burst_features as' in lower(definition)) > 0
          and position('l3_creator_history as materialized' in lower(definition)) > 0
          and position('private.content_safety_scans' in lower(definition)) > 0
          and position('content_fingerprint' in lower(definition)) > 0
          and position('private.admin_content_is_visible' in lower(definition)) > 0
        )
      then 0 else 1 end
      from ranking_function
    ),
    'l3_materialization_present', (
      select count(*)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public','private')
        and c.relkind in ('r','p','v','m')
        and c.relname in (
          'l3_quality_scores','video_quality_scores','creator_quality_scores',
          'creator_spam_scores','l3_ranking_cache','quality_ranking_cache'
        )
    ),
    'l3_raw_report_signal_present', (
      select count(*)
      from ranking_function
      where position('public.reports' in lower(definition)) > 0
         or position('content_safety_alerts' in lower(definition)) > 0
    ),
    'l4_policy_invalid', (
      select count(*)
      from private.algo_l1_policy p
      where p.l4_session_horizon_minutes not between 1 and 1440
         or p.l4_session_history_cap not between 1 and 200
         or p.l4_positive_watch_ratio_threshold not between 0 and 1
         or p.l4_negative_min_distinct_videos not between 1 and 50
         or p.l4_creator_repeat_free_videos not between 0 and 50
         or least(
           p.l4_positive_creator_weight,
           p.l4_positive_creator_cap,
           p.l4_negative_creator_penalty_per_video,
           p.l4_negative_creator_penalty_cap,
           p.l4_creator_repeat_penalty_per_video,
           p.l4_creator_repeat_penalty_cap
         ) < 0
         or greatest(
           p.l4_positive_creator_weight,
           p.l4_positive_creator_cap,
           p.l4_negative_creator_penalty_per_video,
           p.l4_negative_creator_penalty_cap,
           p.l4_creator_repeat_penalty_per_video,
           p.l4_creator_repeat_penalty_cap
         ) > 100
    ),
    'l4_unexpectedly_enabled', (
      select count(*)
      from private.algo_l1_policy
      where l4_context_enabled
    ),
    'l4_session_authority_missing', (
      select case when count(*) = 1
        and bool_and(
          position('l4_raw_session_history as materialized' in lower(definition)) > 0
          and position('l4_session_history as materialized' in lower(definition)) > 0
          and position('l4_latest_exposure as' in lower(definition)) > 0
          and position('l4_valid_retention_ranked as' in lower(definition)) > 0
          and position('l4_creator_context as' in lower(definition)) > 0
          and position('vv.client_session_id = p_client_session_id' in lower(definition)) > 0
          and position('limit v_policy.l4_session_history_cap' in lower(definition)) > 0
          and position('v_l4_effective' in lower(definition)) > 0
          and position('behavioral_l4' in lower(definition)) > 0
          and position('public.video_views' in lower(definition)) > 0
          and position('public.videos' in lower(definition)) > 0
        )
      then 0 else 1 end
      from ranking_function
    ),
    'l4_materialization_present', (
      select count(*)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public','private')
        and c.relkind in ('r','p','v','m')
        and c.relname in (
          'l4_context_scores','session_context_scores','creator_session_context',
          'l4_ranking_cache','session_ranking_cache','context_ranking_cache'
        )
    ),
    'l4_sensitive_context_dependency_present', (
      select count(*)
      from ranking_function
      where position('user_profiles.location' in lower(definition)) > 0
         or position('advertising_geo_targets' in lower(definition)) > 0
         or position('advertising_language_targets' in lower(definition)) > 0
         or lower(definition) ~ 'marketplace_(checkout|shipping|address|destination)'
         or position('call_devices' in lower(definition)) > 0
         or position('device_model' in lower(definition)) > 0
         or lower(definition) ~ 'network_(type|state)'
         or position('ip_address' in lower(definition)) > 0
         or position('context_fingerprint' in lower(definition)) > 0
         or lower(definition) ~ '(^|[^a-z0-9_])(gps|latitude|longitude|location|geo_lat|geo_lng)([^a-z0-9_]|$)'
         or position('public.reports' in lower(definition)) > 0
         or position('content_safety_alerts' in lower(definition)) > 0
    ),
    'canary_target_invalid', (
      select count(*)
      from private.algo_l1_policy
      where canary_target_layer not in ('l1','l2','l3','l4')
    ),
    'l2_directed_canary_authority_missing', (
      select case when
        (select count(*) = 1 and bool_and(
          position('v_directed_l2_canary' in lower(definition)) > 0
          and position('v_l2_effective' in lower(definition)) > 0
          and position('canary_target_layer = ''l2''' in lower(definition)) > 0
          and position('behavioral_l2' in lower(definition)) > 0
        ) from ranking_function)
        and
        (select count(*) = 1 and bool_and(
          position('arm_l2' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
          and position('canary_target_layer = v_target_layer' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
        ) from manage_function)
        and not exists (
          select 1
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public','private')
            and p.proname ~ '(manage|request|get_ranked_feed|reconcile).*l2.*canary|l2.*canary.*(manage|request|get_ranked_feed|reconcile)'
        )
      then 0 else 1 end
    ),
    'l2_directed_canary_state_invalid', (
      select count(*)
      from private.algo_l1_policy
      where canary_enabled
        and canary_target_layer = 'l2'
        and (
          not enabled
          or production_rollout_bps <> 0
          or l2_affinity_enabled
        )
    ),
    'l3_directed_canary_authority_missing', (
      select case when
        (select count(*) = 1 and bool_and(
          position('v_directed_l3_canary' in lower(definition)) > 0
          and position('v_l3_effective' in lower(definition)) > 0
          and position('canary_target_layer = ''l3''' in lower(definition)) > 0
          and position('behavioral_l3' in lower(definition)) > 0
        ) from ranking_function)
        and
        (select count(*) = 1 and bool_and(
          position('arm_l3' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
          and position('algo_l3_canary_global_enabled' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
          and position('algo_l3_canary_l2_global_enabled' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
          and position('canary_target_layer = v_target_layer' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
        ) from manage_function)
        and not exists (
          select 1
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public','private')
            and p.proname ~ '(manage|request|get_ranked_feed|reconcile).*l3.*canary|l3.*canary.*(manage|request|get_ranked_feed|reconcile)'
        )
        and not exists (
          select 1
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname in ('public','private')
            and c.relkind in ('r','p','v','m')
            and c.relname ~ '(l3.*canary|canary.*l3)'
        )
      then 0 else 1 end
    ),
    'l3_directed_canary_state_invalid', (
      select count(*)
      from private.algo_l1_policy
      where canary_enabled
        and canary_target_layer = 'l3'
        and (
          not enabled
          or production_rollout_bps <> 0
          or l3_quality_enabled
          or l2_affinity_enabled
        )
    ),
    'l4_directed_canary_authority_missing', (
      select case when
        (select count(*) = 1 and bool_and(
          position('v_directed_l4_canary' in lower(definition)) > 0
          and position('v_l4_effective' in lower(definition)) > 0
          and position('canary_target_layer = ''l4''' in lower(definition)) > 0
          and position('behavioral_l4' in lower(definition)) > 0
        ) from ranking_function)
        and
        (select count(*) = 1 and bool_and(
          position('arm_l4' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
          and position('algo_l4_canary_global_enabled' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
          and position('algo_l4_canary_l3_global_enabled' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
          and position('algo_l4_canary_l2_global_enabled' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
          and position('canary_target_layer = v_target_layer' in lower(pg_catalog.pg_get_functiondef(oid))) > 0
        ) from manage_function)
        and not exists (
          select 1
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public','private')
            and p.proname ~ '(manage|request|get_ranked_feed|reconcile).*l4.*canary|l4.*canary.*(manage|request|get_ranked_feed|reconcile)'
        )
        and not exists (
          select 1
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname in ('public','private')
            and c.relkind in ('r','p','v','m')
            and c.relname ~ '(l4.*canary|canary.*l4)'
        )
      then 0 else 1 end
    ),
    'l4_directed_canary_state_invalid', (
      select count(*)
      from private.algo_l1_policy
      where canary_enabled
        and canary_target_layer = 'l4'
        and (
          not enabled
          or production_rollout_bps <> 0
          or l4_context_enabled
          or l3_quality_enabled
          or l2_affinity_enabled
        )
    ),
    'production_rollout_nonzero', (
      select count(*) from private.algo_l1_policy where production_rollout_bps <> 0
    ),
    'ranking_rpc_missing', (select case when count(*) = 1 then 0 else 1 end from ranking_function),
    'ranking_rpc_acl_invalid', (
      select case when count(*) = 1
        and bool_and(
          pg_catalog.has_function_privilege('anon', oid, 'execute')
          and pg_catalog.has_function_privilege('authenticated', oid, 'execute')
          and not pg_catalog.has_function_privilege('public', oid, 'execute')
        )
      then 0 else 1 end
      from ranking_function
    ),
    'ranking_rpc_search_path_invalid', (
      select case when count(*) = 1
        and bool_and(coalesce(proconfig, '{}'::text[]) @> array['search_path=""']::text[])
      then 0 else 1 end
      from ranking_function
    ),
    'policy_browser_readable', (
      select (
        pg_catalog.has_table_privilege('anon', 'private.algo_l1_policy', 'select')
        or pg_catalog.has_table_privilege('authenticated', 'private.algo_l1_policy', 'select')
      )::integer
    ),
    'policy_browser_writable', (
      select (
        pg_catalog.has_table_privilege('anon', 'private.algo_l1_policy', 'insert,update,delete')
        or pg_catalog.has_table_privilege('authenticated', 'private.algo_l1_policy', 'insert,update,delete')
      )::integer
    ),
    'policy_version_guard_missing', (
      select (count(*) <> 1)::integer
      from pg_catalog.pg_trigger t
      join pg_catalog.pg_class c on c.oid = t.tgrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'private'
        and c.relname = 'algo_l1_policy'
        and t.tgname = 'algo_l1_policy_version_guard'
        and not t.tgisinternal
        and t.tgenabled = 'O'
        and t.tgtype = 19
        and t.tgfoid = pg_catalog.to_regprocedure('private.guard_algo_l1_policy_v1()')
    ),
    'raw_signal_authority_missing', (
      select (pg_catalog.to_regclass('public.video_views') is null)::integer
    ),
    'video_eligibility_authority_missing', (
      select (
        pg_catalog.to_regprocedure('private.video_can_view_owner(uuid)') is null
        or pg_catalog.to_regprocedure('private.admin_content_is_visible(text,uuid)') is null
      )::integer
    ),
    'required_indexes_missing', (
      select count(*)
      from (
        values
          ('likes_video_created_idx'),
          ('comments_video_created_idx'),
          ('video_saves_video_created_idx'),
          ('video_views_session_video_created_idx'),
          ('videos_created_id_desc_idx'),
          ('video_views_video_created_idx'),
          ('video_views_viewer_created_idx')
      ) required(index_name)
      where not exists (
        select 1 from pg_catalog.pg_indexes i
        where i.schemaname = 'public' and i.indexname = required.index_name
      )
    ),
    'ranking_materialization_present', (
      select count(*)
      from information_schema.tables t
      where t.table_schema in ('public', 'private')
        and t.table_name in (
          'ranking_scores','ranked_feed','user_ranked_feed','feed_cache',
          'user_feed_cache','recommendation_scores'
        )
    ),
    'duplicate_feed_ranking_authority', (
      select greatest(count(*) - 1, 0)
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname like '%ranked_feed%'
    ),
    'ads_dependency_present', (
      select count(*)
      from ranking_function
      where lower(definition) ~ '(advertising|campaign|billing|ad_spend|marketplace_ads)'
    ),
    'canary_state_invalid', (
      select count(*)
      from private.algo_l1_policy p
      where (
          num_nonnulls(p.canary_user_id,p.canary_request_id,p.canary_requested_at) not in (0,3)
          or num_nonnulls(p.canary_armed_at,p.canary_expires_at) not in (0,2)
          or (p.canary_armed_at is not null and p.canary_request_id is null)
          or (p.canary_expires_at is not null and p.canary_expires_at <= p.canary_armed_at)
          or (
            p.canary_enabled
            and num_nonnulls(
              p.canary_user_id,p.canary_request_id,p.canary_requested_at,
              p.canary_armed_at,p.canary_expires_at
            ) <> 5
          )
          or (
            p.canary_user_id is not null
            and not exists (select 1 from auth.users u where u.id = p.canary_user_id)
          )
        )
    ),
    'canary_request_acl_invalid', (
      select case when count(*) = 1
        and bool_and(
          pg_catalog.has_function_privilege('authenticated', oid, 'execute')
          and not pg_catalog.has_function_privilege('anon', oid, 'execute')
          and not pg_catalog.has_function_privilege('public', oid, 'execute')
          and not pg_catalog.has_function_privilege('service_role', oid, 'execute')
          and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']::text[]
        )
      then 0 else 1 end
      from request_function
    ),
    'canary_acl_invalid', (
      select case when count(*) = 1
        and bool_and(
          pg_catalog.has_function_privilege('service_role', oid, 'execute')
          and not pg_catalog.has_function_privilege('authenticated', oid, 'execute')
          and not pg_catalog.has_function_privilege('anon', oid, 'execute')
          and not pg_catalog.has_function_privilege('public', oid, 'execute')
          and coalesce(proconfig, '{}'::text[]) @> array['search_path=""']::text[]
        )
      then 0 else 1 end
      from manage_function
    ),
    'canary_expired_but_effective', (
      select case when count(*) = 1
        and bool_and(
          position('v_now < v_policy.canary_expires_at' in definition) > 0
          and position('v_as_of < v_policy.canary_expires_at' in definition) > 0
        )
      then 0 else 1 end
      from ranking_function
    ),
    'canary_rollout_conflict', (
      select count(*)
      from private.algo_l1_policy
      where canary_enabled and production_rollout_bps <> 0
    ),
    'canary_generation_invalid', (
      select count(*)
      from private.algo_l1_policy
      where canary_generation is null or canary_generation < 0
    )
  );
$$;

revoke all on function public.reconcile_algo_l1_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_algo_l1_v1() to service_role;

commit;
