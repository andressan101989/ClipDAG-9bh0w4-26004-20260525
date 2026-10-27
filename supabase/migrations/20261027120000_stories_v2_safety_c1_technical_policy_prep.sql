begin;

-- STORIES-V2-SAFETY-C1 installs technical preparation only.
-- Publication still requires a separate, explicitly approved policy release.
do $preconditions$
begin
  if pg_catalog.to_regclass('private.story_safety_state') is null
    or pg_catalog.to_regclass('private.story_interactive_elements') is null
    or pg_catalog.to_regclass('private.content_safety_audio_transcripts') is null
    or pg_catalog.to_regclass('private.content_safety_visual_analyses') is null
    or pg_catalog.to_regprocedure('private.content_safety_target_snapshot_b1_core(text,uuid)') is null
    or pg_catalog.to_regprocedure('private.content_safety_visual_source_b1_core(text,uuid)') is null
    or pg_catalog.to_regprocedure('private.enqueue_content_safety_scan_b1_core(text,uuid,text)') is null
    or pg_catalog.to_regprocedure('private.content_safety_transcript_ruleset_fingerprint()') is null
    or pg_catalog.to_regprocedure('private.story_sync_safety_from_scan_v1()') is null then
    raise exception using errcode='55000',message='stories_safety_c1_requires_b1';
  end if;
  if pg_catalog.to_regprocedure('private.story_content_safety_control_c1_v1()') is not null then
    raise exception using errcode='55000',message='stories_safety_c1_already_installed';
  end if;
end;
$preconditions$;

create function private.story_content_safety_policy_c1_v1()
returns jsonb language sql immutable security definer set search_path='' as $$
  select $policy$
{
  "schema_version": "nelyon.stories_content_safety_policy.v1",
  "policy_id": "nelyon.stories.general.safety.candidate.v1",
  "title": "Stories V2 General Content Safety Candidate V1",
  "normative_approval": {
    "status": "pending_owner_approval",
    "source": null,
    "authorized_phase": null,
    "authorized_at": null,
    "owner_bound": false
  },
  "scope": {
    "story_image": true,
    "story_video": true,
    "story_audio": true,
    "story_text": true,
    "interactive_prompts": true,
    "interactive_options": true,
    "viewer_question_responses": true,
    "creator_premium_policy_changed": false,
    "live_battles_policy_changed": false,
    "finance_effect": false
  },
  "decision_matrix": {
    "allow": [
      "ordinary_photo",
      "ordinary_video",
      "permitted_text",
      "legitimate_interactive_prompt",
      "creative_content_without_risk_signals"
    ],
    "review": [
      "low_confidence",
      "contradictory_signals",
      "relevant_user_reports",
      "incomplete_multimodal_coverage",
      "age_uncertain",
      "consent_uncertain",
      "contextual_artistic_or_medical_nudity",
      "documentary_or_non_graphic_violence",
      "ambiguous_private_information_exposure"
    ],
    "block": [
      "child_sexual_exploitation",
      "credible_threat_of_violence",
      "non_consensual_private_information_exposure",
      "prohibited_explicit_sexual_content",
      "direct_incitement_to_violence_or_harm"
    ]
  },
  "thresholds": {
    "status": "pending_owner_approval",
    "numeric_confidence_thresholds": null,
    "automatic_allow_authorized": false,
    "automatic_block_authorized": false,
    "rule": "Until the owner approves an exact contextual decision contract, every completed Story remains in human review and no category or confidence value authorizes publication."
  },
  "evidence_contract": {
    "story_image": {
      "required": [
        "current_private_r2_identity",
        "server_verified_size_at_most_10485760_bytes",
        "current_story_generation_and_fingerprint",
        "visual_analysis",
        "author_text_bundle",
        "visible_text_when_supported",
        "media_metadata_and_provenance"
      ]
    },
    "story_video": {
      "required": [
        "current_private_stream_identity",
        "provider_ready_state",
        "server_verified_duration_at_most_15_seconds",
        "current_story_generation_and_fingerprint",
        "sampled_frame_visual_analysis",
        "author_text_bundle",
        "audio_transcript_or_explicit_no_speech",
        "completed_transcript_rule_evaluation_when_audio_exists"
      ]
    },
    "shared_story": {
      "required": [
        "current_source_identity",
        "current_source_generation_and_fingerprint",
        "compatible_current_source_decision",
        "story_author_text_bundle"
      ]
    },
    "interactive_definition": {
      "required": [
        "prompt_text",
        "option_labels",
        "definition_digest"
      ],
      "private_quiz_answer_is_not_classifier_input": true
    },
    "viewer_question_response": {
      "required": [
        "response_text",
        "response_identity",
        "moderation_result_before_public_exposure"
      ],
      "remains_private_while_pending": true
    }
  },
  "decision_contract": {
    "classify_content_and_context_together": true,
    "keywords_are_context_only": true,
    "isolated_words_do_not_authorize_block": true,
    "all_required_modalities_must_be_current": true,
    "stale_generation_or_fingerprint": {
      "technical_state": "pending",
      "normative_disposition": "review_required"
    },
    "missing_required_evidence": {
      "technical_state": "pending",
      "normative_disposition": "review_required"
    },
    "provider_failure": {
      "technical_state": "pending",
      "normative_disposition": "review_required",
      "retry": "bounded"
    },
    "ambiguous_or_conflicting_evidence": {
      "technical_state": "review",
      "normative_disposition": "human_review_required"
    },
    "http_200_is_evidence": false,
    "human_review_required_until_activation": true
  },
  "collection_contract": {
    "scanner": "content-safety-scan",
    "text_rule_scope": "story_text",
    "visual_prompt_version": "visual-safety-v1",
    "visual_prompt_is_triage_only": true,
    "audio_model": "@cf/openai/whisper-large-v3-turbo",
    "new_provider_enabled": false,
    "new_external_inference_authorized": false
  },
  "publication": {
    "requires_current_generation": true,
    "requires_current_fingerprint": true,
    "requires_current_owner_and_permissions": true,
    "requires_provider_validity": true,
    "requires_active_owner_approved_policy": true,
    "requires_unambiguous_allow": true,
    "historical_decisions_are_not_reclassified_automatically": true,
    "technical_failure": "fail_closed",
    "ambiguous_or_incomplete": "human_review",
    "general_visibility_while_inactive": false
  },
  "administrative_review": {
    "private_by_default": true,
    "authorized_reviewers_only": true,
    "audit_required": true,
    "appeal_or_reconsideration_requires_an_authorized_reviewer": true,
    "manual_decision_is_not_fabricated": true,
    "child_sexual_exploitation_block_cannot_be_overridden_by_ordinary_review": true
  },
  "activation": {
    "status": "technical_preparation_only",
    "enabled": false,
    "owner_approved_policy": false,
    "auto_publish_enabled": false,
    "mode": "fail_closed_review",
    "blockers": [
      "exact_policy_artifact_not_owner_approved",
      "story_contextual_decision_schema_not_approved",
      "automatic_allow_and_block_not_authorized",
      "viewer_question_response_automatic_moderation_not_activated",
      "shared_source_compatibility_contract_not_physically_verified"
    ],
    "activation_strategy": "forward_only_migration_after_exact_owner_approval_and_green_evidence",
    "rollback_strategy": "forward_only_deactivation_to_fail_closed_review"
  },
  "artifact_sha256": "90961e8f5c4859bfdc38e851c0b5518b69e114c53896b740b30e4da491291ee4"
}
  $policy$::jsonb;
$$;
alter function private.story_content_safety_policy_c1_v1() owner to postgres;
revoke all on function private.story_content_safety_policy_c1_v1() from public,anon,authenticated,service_role;

create function private.story_content_safety_control_c1_v1()
returns jsonb language sql immutable security definer set search_path='' as $$
  select $control$
  {
    "policy_artifact_sha256": "90961e8f5c4859bfdc38e851c0b5518b69e114c53896b740b30e4da491291ee4",
    "activation": false,
    "owner_approved_policy": false,
    "auto_publish_enabled": false,
    "mode": "fail_closed_review",
    "automatic_allow_authorized": false,
    "automatic_block_authorized": false
  }
  $control$::jsonb;
$$;
alter function private.story_content_safety_control_c1_v1() owner to postgres;
revoke all on function private.story_content_safety_control_c1_v1() from public,anon,authenticated,service_role;

-- Ordering is independent of row insertion order. Only author-visible text is
-- classifier input; definition identity remains a separate fingerprint field.
create function private.story_author_text_bundle_c1_v1(p_story_id uuid)
returns text language sql stable security definer set search_path='' as $$
  with definitions as (
    select e.public_config,pg_catalog.row_number() over(order by e.element_id) element_order
    from private.story_interactive_elements e where e.story_id=p_story_id
  )
  select coalesce(pg_catalog.string_agg(parts.value,E'\n' order by parts.section,parts.element_order,parts.option_order),'')
  from (
    select 0 section,x.ordinality element_order,0::bigint option_order,x.element->>'text' value
    from public.stories s
    cross join lateral pg_catalog.jsonb_array_elements(coalesce(s.story_composition->'elements','[]'::jsonb))
      with ordinality x(element,ordinality)
    where s.id=p_story_id and x.element->>'type'='text'
    union all
    select 1,e.element_order,0::bigint,e.public_config->>'prompt'
    from definitions e
    union all
    select 1,e.element_order,o.ordinality,o.option->>'label'
    from definitions e
    cross join lateral pg_catalog.jsonb_array_elements(coalesce(e.public_config->'options','[]'::jsonb))
      with ordinality o(option,ordinality)
  ) parts where parts.value is not null;
$$;
alter function private.story_author_text_bundle_c1_v1(uuid) owner to postgres;
revoke all on function private.story_author_text_bundle_c1_v1(uuid) from public,anon,authenticated,service_role;

create or replace function private.story_current_fingerprint(p_story_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'version','stories-safety-evidence-c1-v1',
    'story',s.id,'owner',s.user_id,'kind',s.story_kind,'source',s.shared_video_id,
    'legacy',s.media_url,'type',s.media_type,'composition',s.story_composition,
    'author_text',private.story_author_text_bundle_c1_v1(p_story_id),
    'shared_source',case when s.shared_video_id is not null then pg_catalog.jsonb_build_object(
      'owner',source.snapshot->>'owner_user_id','content_version',source.snapshot->>'content_version') end,
    'definitions',(select pg_catalog.jsonb_agg(e.definition_digest order by e.element_id)
      from private.story_interactive_elements e where e.story_id=s.id),
    'r2',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'link',l.id,'id',a.id,'owner',a.owner_id,'status',a.status,'provider',a.provider,
        'purpose',a.purpose,'visibility',a.visibility,'bucket',a.bucket_name,'key',a.object_key,
        'mime',a.mime_type,'size',a.size_bytes,'deleted_at',a.deleted_at,'public_url',a.public_url,
        'contract',a.lifecycle_contract_version) order by l.id)
      from public.media_asset_links l join public.media_assets a on a.id=l.asset_id
      where l.entity_type='story' and l.entity_id=s.id and l.slot='media' and l.position=0),
    'stream',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'link',l.id,'id',a.id,'owner',a.owner_id,'status',a.status,'provider',a.provider,
        'purpose',a.purpose,'visibility',a.visibility,'uid',a.cloudflare_uid,
        'mime',a.mime_type,'size',a.size_bytes,'duration',a.duration_seconds,
        'max_duration',a.max_duration_seconds,'deleted_at',a.deleted_at,
        'hls_url',a.hls_url,'dash_url',a.dash_url,'thumbnail_url',a.thumbnail_url,
        'signed',a.provider_metadata->'require_signed_urls',
        'contract',a.lifecycle_contract_version) order by l.id)
      from public.video_asset_links l join public.video_assets a on a.id=l.asset_id
      where l.entity_type='story' and l.entity_id=s.id and l.slot='media' and l.position=0)
  )::text,'UTF8')),'hex')
  from public.stories s
  left join lateral (select private.content_safety_target_snapshot_b1_core('video',s.shared_video_id) snapshot
    where s.shared_video_id is not null) source on true
  where s.id=p_story_id;
$$;
alter function private.story_current_fingerprint(uuid) owner to postgres;
revoke all on function private.story_current_fingerprint(uuid) from public,anon,authenticated,service_role;

-- The pre-B1 core is the unchanged snapshot authority for every other target.
create or replace function private.content_safety_target_snapshot(p_target_type text,p_target_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_snapshot jsonb;v_r2 uuid;v_stream uuid;
begin
  if p_target_type is null or p_target_type<>'story' then
    return private.content_safety_target_snapshot_b1_core(p_target_type,p_target_id);end if;
  v_snapshot:=private.content_safety_target_snapshot_b1_core('story',p_target_id);
  if v_snapshot is null then return null;end if;
  select l.asset_id into v_r2 from public.media_asset_links l where l.entity_type='story'
    and l.entity_id=p_target_id and l.slot='media' and l.position=0;
  select l.asset_id into v_stream from public.video_asset_links l where l.entity_type='story'
    and l.entity_id=p_target_id and l.slot='media' and l.position=0;
  return v_snapshot||pg_catalog.jsonb_build_object(
    'content_version',private.story_current_fingerprint(p_target_id),
    'text',private.story_author_text_bundle_c1_v1(p_target_id),
    'text_value',private.story_author_text_bundle_c1_v1(p_target_id),
    'summary',pg_catalog.left(private.story_author_text_bundle_c1_v1(p_target_id),300),
    'media_asset_id',v_r2,'video_asset_id',v_stream);
end;
$$;
alter function private.content_safety_target_snapshot(text,uuid) owner to postgres;
revoke all on function private.content_safety_target_snapshot(text,uuid) from public,anon,authenticated,service_role;

create or replace function private.content_safety_visual_source(p_target_type text,p_target_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_story public.stories;v_video public.video_assets;v_image public.media_assets;
  v_r2_count integer;v_stream_count integer;
begin
  if p_target_type is null or p_target_type<>'story' then
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
     and v_image.size_bytes between 1 and 10485760 then
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
alter function private.content_safety_visual_source(text,uuid) owner to postgres;
revoke all on function private.content_safety_visual_source(text,uuid) from public,anon,authenticated,service_role;

create or replace function private.enqueue_content_safety_scan(
  p_target_type text,p_target_id uuid,p_requested_reason text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_scan_id uuid;v_audio jsonb;v_visual jsonb;v_fingerprint text;
begin
  if p_target_type is null or p_target_type<>'story' then
    return private.enqueue_content_safety_scan_b1_core(p_target_type,p_target_id,p_requested_reason);end if;
  if p_requested_reason is null or p_requested_reason not in
    ('content_created','content_updated','report_signal','shared_source','backfill','retry') then return null;end if;
  perform 1 from private.story_safety_state state where state.story_id=p_target_id for update;
  v_fingerprint:=private.story_current_fingerprint(p_target_id);
  select scan.id into v_scan_id
  from private.story_safety_state state join private.content_safety_scans scan on scan.id=state.scan_id
  where state.story_id=p_target_id and state.evidence_fingerprint=v_fingerprint
    and scan.target_type='story' and scan.target_id=p_target_id
    and scan.content_fingerprint=private.content_safety_sha256('story|'||p_target_id::text||'|'||v_fingerprint);
  if p_requested_reason<>'retry' and v_scan_id is not null then return v_scan_id;end if;
  v_scan_id:=private.enqueue_content_safety_scan_b1_core(p_target_type,p_target_id,p_requested_reason);
  if v_scan_id is null then return null;end if;
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
alter function private.enqueue_content_safety_scan(text,uuid,text) owner to postgres;
revoke all on function private.enqueue_content_safety_scan(text,uuid,text) from public,anon,authenticated,service_role;

create or replace function private.story_enqueue_media_safety_v1(p_story_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_scan uuid;v_fingerprint text;v_analysis uuid;
begin
  perform 1 from private.story_safety_state state where state.story_id=p_story_id for update;
  v_fingerprint:=private.story_current_fingerprint(p_story_id);
  if v_fingerprint is null then raise exception using errcode='P0002',message='story_not_found';end if;
  select scan.id into v_scan
  from private.story_safety_state state join private.content_safety_scans scan on scan.id=state.scan_id
  where state.story_id=p_story_id and state.evidence_fingerprint=v_fingerprint
    and scan.target_type='story' and scan.target_id=p_story_id
    and scan.content_fingerprint=private.content_safety_sha256('story|'||p_story_id::text||'|'||v_fingerprint);
  if v_scan is not null then return v_scan;end if;
  v_scan:=private.enqueue_content_safety_scan('story',p_story_id,'content_updated');
  if v_scan is null then raise exception using errcode='55000',message='story_safety_enqueue_failed';end if;
  update private.story_safety_state state set
    generation=case when state.scan_id is distinct from v_scan
      or state.evidence_fingerprint is distinct from v_fingerprint then state.generation+1 else state.generation end,
    state='pending',scan_id=v_scan,evidence_generation=null,
    evidence_fingerprint=v_fingerprint,policy_digest=null,
    visual_complete=false,audio_complete=false,text_complete=false,
    decided_at=null,updated_at=pg_catalog.clock_timestamp()
  where state.story_id=p_story_id;
  select private.content_safety_visual_analysis_id_for_asset(
    scan.visual_video_asset_id,scan.visual_media_asset_id,'visual-safety-v1') into v_analysis
  from private.content_safety_scans scan where scan.id=v_scan;
  if v_analysis is not null then perform private.content_safety_attach_visual_analysis(v_analysis);end if;
  return v_scan;
end;
$$;
alter function private.story_enqueue_media_safety_v1(uuid) owner to postgres;
revoke all on function private.story_enqueue_media_safety_v1(uuid) from public,anon,authenticated,service_role;

create or replace function private.story_sync_safety_from_scan_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_current text;v_visual boolean;v_audio boolean;v_text boolean;
begin
  if new.target_type<>'story' then return new;end if;
  v_current:=private.story_current_fingerprint(new.target_id);
  if v_current is null then return new;end if;
  v_visual:=new.visual_status='not_applicable' or (new.visual_status='analyzed' and new.visual_analysis_id is not null and exists(
    select 1 from private.content_safety_scans source_scan
    join private.content_safety_visual_analyses analysis on analysis.id=new.visual_analysis_id
    join private.content_safety_scans analysis_scan on analysis_scan.id=analysis.source_scan_id
    where source_scan.id=coalesce(new.media_source_scan_id,new.id)
      and analysis.source_content_fingerprint=analysis_scan.content_fingerprint
      and analysis.source_content_fingerprint ~ '^[a-f0-9]{64}$'
      and analysis.analysis_fingerprint ~ '^[a-f0-9]{64}$'
      and source_scan.visual_status='analyzed' and source_scan.visual_analysis_id=analysis.id
      and analysis.prompt_version=new.visual_prompt_version
      and analysis.prompt_version=source_scan.visual_prompt_version
      and analysis.provider=new.visual_provider and analysis.provider=source_scan.visual_provider
      and analysis.model=new.visual_model and analysis.model=source_scan.visual_model
      and analysis.video_asset_id is not distinct from new.visual_video_asset_id
      and analysis.media_asset_id is not distinct from new.visual_media_asset_id
      and analysis.video_asset_id is not distinct from source_scan.visual_video_asset_id
      and analysis.media_asset_id is not distinct from source_scan.visual_media_asset_id
      and source_scan.content_fingerprint=private.content_safety_sha256(
        source_scan.target_type||'|'||source_scan.target_id::text||'|'||
        coalesce(private.content_safety_target_snapshot(source_scan.target_type,source_scan.target_id)->>'content_version',''))
  ));
  v_audio:=new.audio_status='not_applicable' or (new.audio_status='analyzed' and exists(
    select 1 from private.content_safety_scans source_scan
    join private.content_safety_audio_transcripts transcript on transcript.source_scan_id=source_scan.id
    where transcript.source_scan_id=coalesce(new.media_source_scan_id,new.id)
      and transcript.source_content_fingerprint=source_scan.content_fingerprint
      and transcript.source_asset_id=source_scan.audio_source_asset_id
      and transcript.provider=source_scan.audio_provider and transcript.model=source_scan.audio_model
      and source_scan.audio_status='analyzed'
      and source_scan.content_fingerprint=private.content_safety_sha256(
        source_scan.target_type||'|'||source_scan.target_id::text||'|'||
        coalesce(private.content_safety_target_snapshot(source_scan.target_type,source_scan.target_id)->>'content_version',''))
      and transcript.rule_eval_status='completed'
      and transcript.rule_eval_ruleset_fingerprint=private.content_safety_transcript_ruleset_fingerprint()
      and (select count(*) from private.content_safety_audio_transcripts current_transcript
        where current_transcript.source_scan_id=source_scan.id
          and current_transcript.source_content_fingerprint=source_scan.content_fingerprint)=1
  ));
  v_text:=new.text_status='analyzed';
  update private.story_safety_state state set
    scan_id=new.id,evidence_fingerprint=v_current,
    visual_complete=v_visual,audio_complete=v_audio,text_complete=v_text,
    evidence_generation=case when v_visual and v_audio and v_text then state.generation else null end,
    state=case when v_visual and v_audio and v_text then 'review' else 'pending' end,
    policy_digest=null,decided_at=null,updated_at=pg_catalog.clock_timestamp()
  where state.story_id=new.target_id and state.scan_id=new.id
    and new.content_fingerprint=private.content_safety_sha256('story|'||new.target_id::text||'|'||v_current);
  return new;
end;
$$;
alter function private.story_sync_safety_from_scan_v1() owner to postgres;
revoke all on function private.story_sync_safety_from_scan_v1() from public,anon,authenticated,service_role;

-- Rule evaluation is a separate transaction from transcription. Touch only
-- linked Story scans so the existing sync trigger observes completion, failure,
-- reevaluation and deletion without changing any producer modality or P3 row.
create function private.story_refresh_safety_from_transcript_c1_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_old_source uuid;v_new_source uuid;
begin
  if tg_op<>'INSERT' then v_old_source:=old.source_scan_id;end if;
  if tg_op<>'DELETE' then v_new_source:=new.source_scan_id;end if;
  update private.content_safety_scans scan set updated_at=pg_catalog.clock_timestamp()
  from private.story_safety_state state
  where scan.target_type='story' and state.story_id=scan.target_id and state.scan_id=scan.id
    and coalesce(scan.media_source_scan_id,scan.id) in(v_old_source,v_new_source);
  return null;
end;
$$;
alter function private.story_refresh_safety_from_transcript_c1_v1() owner to postgres;
revoke all on function private.story_refresh_safety_from_transcript_c1_v1() from public,anon,authenticated,service_role;
create trigger content_safety_story_transcript_refresh_c1
after insert or update or delete on private.content_safety_audio_transcripts for each row
execute function private.story_refresh_safety_from_transcript_c1_v1();

create function private.story_content_safety_candidate_c1_v1(p_story_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_control jsonb:=private.story_content_safety_control_c1_v1();
  v_state private.story_safety_state;v_current text;v_complete boolean;
begin
  v_current:=private.story_current_fingerprint(p_story_id);
  select * into v_state from private.story_safety_state where story_id=p_story_id;
  v_complete:=coalesce(v_current is not null and v_state.evidence_fingerprint=v_current
    and v_state.evidence_generation=v_state.generation
    and v_state.visual_complete and v_state.audio_complete and v_state.text_complete
    and exists(select 1 from private.content_safety_scans scan where scan.id=v_state.scan_id
      and scan.target_type='story' and scan.target_id=p_story_id
      and scan.content_fingerprint=private.content_safety_sha256('story|'||p_story_id::text||'|'||v_current)),false);
  return pg_catalog.jsonb_build_object('story_id',p_story_id,
    'policy_artifact_sha256',v_control->>'policy_artifact_sha256','control',v_control,
    'decision',case when v_complete then 'review' else 'pending' end,
    'activation_effect',false,'evidence_current',v_complete,
    'reason',case when v_complete then 'missing_owner_approved_story_policy' else 'incomplete_or_stale_evidence' end,
    'visual_complete',coalesce(v_state.visual_complete,false),
    'audio_complete',coalesce(v_state.audio_complete,false),'text_complete',coalesce(v_state.text_complete,false));
end;
$$;
alter function private.story_content_safety_candidate_c1_v1(uuid) owner to postgres;
revoke all on function private.story_content_safety_candidate_c1_v1(uuid) from public,anon,authenticated,service_role;

-- This existing RLS authority retains its authenticated execute permission and
-- the owner/expiry/admin behavior. Third-party reads require policy activation.
create or replace function private.story_can_access(p_story_id uuid,p_allow_expired boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.stories s
    where s.id=p_story_id and private.admin_content_is_visible('story',s.id)
    and (p_allow_expired or s.expires_at>pg_catalog.now())
    and (s.user_id=auth.uid() or (private.story_can_view_owner(s.user_id)
      and exists(select 1 from private.story_safety_state safety
        cross join lateral (select private.story_content_safety_control_c1_v1() value) control
        where safety.story_id=s.id and safety.state='passed'
          and safety.evidence_generation=safety.generation
          and safety.evidence_fingerprint=private.story_current_fingerprint(s.id)
          and (control.value->>'activation')::boolean is true
          and (control.value->>'owner_approved_policy')::boolean is true
          and safety.policy_digest=control.value->>'policy_artifact_sha256'))));
$$;
alter function private.story_can_access(uuid,boolean) owner to postgres;
revoke all on function private.story_can_access(uuid,boolean) from public,anon,service_role;

commit;
