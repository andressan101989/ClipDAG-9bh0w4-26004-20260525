begin;

-- ALGO-6 FINAL MACRO C1
-- Forward-only correction of the deployed personalization authority. No new
-- ranking, event, model, or Ads authority is introduced here.

alter table private.user_personalization_profiles
  add column account_region_code text null;

alter table private.user_personalization_profiles
  drop constraint user_personalization_profiles_onboarding_version_check,
  drop constraint user_personalization_profiles_completion_check;

alter table private.user_personalization_profiles
  add constraint user_personalization_profiles_onboarding_version_check
    check (onboarding_version in ('personalization-onboarding-v1','personalization-onboarding-v2')),
  add constraint user_personalization_profiles_account_region_check
    check (account_region_code is null or account_region_code ~ '^[A-Z]{2}$'),
  add constraint user_personalization_profiles_completion_check
    check (
      onboarding_completed_at is null
      or (
        primary_language_tag is not null
        and account_region_code is not null
        and content_region_code is not null
      )
    );

create function private.personalization_validate_selection_v2(
  p_primary_language_tag text,
  p_additional_language_tags text[],
  p_account_region_code text,
  p_content_region_code text,
  p_interest_slugs text[]
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_validation jsonb;
begin
  if p_account_region_code is null
     or p_account_region_code = 'GLOBAL'
     or p_account_region_code !~ '^[A-Z]{2}$' then
    raise exception using errcode = '22023', message = 'personalization_account_region_invalid';
  end if;

  v_validation := private.personalization_validate_selection_v1(
    p_primary_language_tag,
    p_additional_language_tags,
    p_content_region_code,
    p_interest_slugs
  );

  return v_validation || jsonb_build_object(
    'account_region_code', p_account_region_code,
    'content_region_code', p_content_region_code
  );
end;
$$;

revoke all on function private.personalization_validate_selection_v2(text,text[],text,text,text[])
  from public, anon, authenticated, service_role;

create function public.get_personalization_onboarding_catalog_v2()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'contract_version','personalization-onboarding-v2',
    'languages',jsonb_build_array('es','en','pt','fr'),
    'account_region_contract','ISO_3166_1_ALPHA_2',
    'content_region_contract','GLOBAL_OR_ISO_3166_1_ALPHA_2',
    'minimum_parent_interests',3,
    'maximum_parent_interests',8,
    'maximum_creator_follows',5,
    'topics',coalesce(jsonb_agg(jsonb_build_object(
      'slug',t.slug,
      'parent_slug',p.slug,
      'level',t.level,
      'labels',t.labels,
      'minor_safe',t.minor_safe
    ) order by coalesce(p.sort_order,t.sort_order),t.level,t.sort_order,t.slug),'[]'::jsonb)
  )
  from private.personalization_interest_taxonomy t
  left join private.personalization_interest_taxonomy p on p.id = t.parent_id
  where t.active and t.minor_safe;
$$;

revoke all on function public.get_personalization_onboarding_catalog_v2()
  from public, anon, authenticated, service_role;
grant execute on function public.get_personalization_onboarding_catalog_v2() to authenticated;

create function public.get_my_personalization_onboarding_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_profile private.user_personalization_profiles;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'personalization_auth_required';
  end if;

  select * into v_profile
  from private.user_personalization_profiles
  where user_id = v_actor;

  return jsonb_build_object(
    'contract_version','personalization-onboarding-v2',
    'completed',coalesce(v_profile.onboarding_completed_at is not null,false),
    'onboarding_completed_at',v_profile.onboarding_completed_at,
    'primary_language_tag',v_profile.primary_language_tag,
    'additional_language_tags',coalesce(to_jsonb(v_profile.additional_language_tags),'[]'::jsonb),
    'account_region_code',v_profile.account_region_code,
    'content_region_code',v_profile.content_region_code,
    'personalization_enabled',coalesce(v_profile.personalization_enabled,true),
    'ads_personalization_consent',coalesce(v_profile.ads_personalization_consent,false),
    'preferences_updated_at',v_profile.preferences_updated_at,
    'interest_slugs',coalesce((
      select jsonb_agg(t.slug order by t.level,t.sort_order,t.slug)
      from private.user_personalization_interests ui
      join private.personalization_interest_taxonomy t on t.id = ui.interest_id
      where ui.user_id = v_actor
    ),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_my_personalization_onboarding_v2()
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_personalization_onboarding_v2() to authenticated;

create function public.save_my_personalization_preferences_v2(
  p_primary_language_tag text,
  p_additional_language_tags text[],
  p_account_region_code text,
  p_content_region_code text,
  p_interest_slugs text[],
  p_personalization_enabled boolean default true,
  p_ads_personalization_consent boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_account_region_code text := upper(p_account_region_code);
  v_content_region_code text := upper(p_content_region_code);
  v_validation jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'personalization_auth_required';
  end if;
  if not exists (
    select 1
    from private.user_age_eligibility a
    where a.user_id = v_actor
      and a.status = 'eligible'
      and a.evaluated_at is not null
  ) then
    raise exception using errcode = '42501', message = 'personalization_age_eligibility_required';
  end if;

  v_validation := private.personalization_validate_selection_v2(
    p_primary_language_tag,
    p_additional_language_tags,
    v_account_region_code,
    v_content_region_code,
    p_interest_slugs
  );

  insert into private.user_personalization_profiles(
    user_id,onboarding_version,primary_language_tag,additional_language_tags,
    account_region_code,content_region_code,personalization_enabled,
    ads_personalization_consent,preferences_updated_at,updated_at
  ) values (
    v_actor,'personalization-onboarding-v2',p_primary_language_tag,
    coalesce(p_additional_language_tags,'{}'::text[]),v_account_region_code,
    v_content_region_code,coalesce(p_personalization_enabled,true),
    coalesce(p_ads_personalization_consent,false),v_now,v_now
  ) on conflict (user_id) do update set
    onboarding_version = excluded.onboarding_version,
    primary_language_tag = excluded.primary_language_tag,
    additional_language_tags = excluded.additional_language_tags,
    account_region_code = excluded.account_region_code,
    content_region_code = excluded.content_region_code,
    personalization_enabled = excluded.personalization_enabled,
    ads_personalization_consent = excluded.ads_personalization_consent,
    preferences_updated_at = excluded.preferences_updated_at,
    updated_at = excluded.updated_at;

  delete from private.user_personalization_interests where user_id = v_actor;
  insert into private.user_personalization_interests(user_id,interest_id,source,selected_at)
  select v_actor,t.id,'explicit',v_now
  from private.personalization_interest_taxonomy t
  where t.active and t.slug = any(p_interest_slugs);

  return jsonb_build_object(
    'saved',true,
    'contract_version','personalization-onboarding-v2',
    'preferences_updated_at',v_now,
    'validation',v_validation
  );
end;
$$;

revoke all on function public.save_my_personalization_preferences_v2(text,text[],text,text,text[],boolean,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.save_my_personalization_preferences_v2(text,text[],text,text,text[],boolean,boolean)
  to authenticated;

-- V1 profile read/write contracts remain as historical database surfaces only.
-- They are not competing browser authorities after C1.
revoke all on function public.get_personalization_onboarding_catalog_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_personalization_onboarding_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.save_my_personalization_preferences_v1(text,text[],text,text[],boolean,boolean)
  from public, anon, authenticated, service_role;

create or replace function public.get_my_onboarding_creator_recommendations_v1(
  p_limit integer default 12
) returns table(
  creator_id uuid,
  username text,
  display_name text,
  avatar_url text,
  follower_count integer,
  semantic_relevance numeric,
  language_match numeric,
  region_match numeric,
  quality_score numeric,
  recommendation_score numeric,
  already_following boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'personalization_auth_required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 30 then
    raise exception using errcode = '22023', message = 'personalization_creator_limit_invalid';
  end if;
  v_limit := p_limit;

  return query
  with viewer_profile as materialized (
    select p.*
    from private.user_personalization_profiles p
    where p.user_id = v_actor
  ),
  selected_centroid as materialized (
    select extensions.avg(t.embedding) as embedding
    from private.user_personalization_interests ui
    join private.personalization_interest_taxonomy t on t.id = ui.interest_id
    where ui.user_id = v_actor
      and t.active
      and t.embedding_status = 'ready'
      and t.embedding is not null
  ),
  eligible_videos as materialized (
    select v.id,v.user_id,vsp.embedding,vsp.detected_language
    from public.videos v
    left join private.video_semantic_profiles vsp
      on vsp.video_id = v.id
      and vsp.status = 'ready'
      and vsp.embedding is not null
    where v.user_id <> v_actor
      and private.admin_content_is_visible('video',v.id)
      and private.video_can_view_owner(v.user_id)
      and not exists (
        select 1
        from public.blocked_users b
        where (b.blocker_id = v_actor and b.blocked_id = v.user_id)
           or (b.blocker_id = v.user_id and b.blocked_id = v_actor)
      )
  ),
  creator_semantics as materialized (
    select
      ev.user_id,
      max(case when sc.embedding is not null and ev.embedding is not null
        then greatest(0::numeric,least(1::numeric,
          (1 - (ev.embedding operator(extensions.<=>) sc.embedding))::numeric
        )) else 0 end)::numeric as semantic_relevance,
      max(case when ev.detected_language = vp.primary_language_tag then 1::numeric
        when ev.detected_language = any(vp.additional_language_tags) then 0.6::numeric
        else 0 end) as language_match
    from eligible_videos ev
    cross join viewer_profile vp
    cross join selected_centroid sc
    group by ev.user_id
  ),
  quality as materialized (
    select
      v.user_id,
      least(1::numeric,coalesce(avg(case
        when vv.media_duration_ms > 0 and vv.completion_ratio is not null
        then least(1::numeric,greatest(0::numeric,vv.completion_ratio))
      end),0)) as quality_score
    from eligible_videos ev
    join public.videos v on v.id = ev.id
    left join public.video_views vv on vv.video_id = v.id
    group by v.user_id
  ),
  scored as (
    select
      up.id,up.username,up.display_name,up.avatar_url,up.followers_count,
      cs.semantic_relevance,
      cs.language_match,
      case
        when vp.content_region_code <> 'GLOBAL'
          and cp.account_region_code = vp.content_region_code
        then 1::numeric
        else 0::numeric
      end as region_match,
      q.quality_score,
      exists(
        select 1
        from public.follows f
        where f.follower_id = v_actor and f.following_id = up.id
      ) as already_following
    from creator_semantics cs
    join public.user_profiles up on up.id = cs.user_id and not up.is_private
    cross join viewer_profile vp
    left join private.user_personalization_profiles cp on cp.user_id = up.id
    left join quality q on q.user_id = up.id
  )
  select
    s.id,s.username,coalesce(s.display_name,s.username),coalesce(s.avatar_url,''),s.followers_count,
    s.semantic_relevance,s.language_match,s.region_match,coalesce(s.quality_score,0),
    round((
      6*s.semantic_relevance + 1.5*s.language_match + 1*s.region_match
      + 2*coalesce(s.quality_score,0)
      + least(2::numeric,ln(1+greatest(0,s.followers_count))/5)
    )::numeric,6),
    s.already_following
  from scored s
  order by recommendation_score desc, md5(s.id::text || v_actor::text), s.id
  limit v_limit;
end;
$$;

revoke all on function public.get_my_onboarding_creator_recommendations_v1(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_onboarding_creator_recommendations_v1(integer)
  to authenticated;

create or replace function public.complete_my_personalization_onboarding_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_profile private.user_personalization_profiles;
  v_interest_slugs text[];
  v_eligible_count integer := 0;
  v_required_follows integer := 0;
  v_followed_count integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'personalization_auth_required';
  end if;

  select * into v_profile
  from private.user_personalization_profiles
  where user_id = v_actor
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'personalization_preferences_required';
  end if;

  select array_agg(t.slug order by t.slug) into v_interest_slugs
  from private.user_personalization_interests ui
  join private.personalization_interest_taxonomy t on t.id = ui.interest_id
  where ui.user_id = v_actor;

  perform private.personalization_validate_selection_v2(
    v_profile.primary_language_tag,
    v_profile.additional_language_tags,
    v_profile.account_region_code,
    v_profile.content_region_code,
    v_interest_slugs
  );

  -- Creator follows are an onboarding-only gate. A completed user can later
  -- unfollow every recommendation and still edit explicit preferences.
  if v_profile.onboarding_completed_at is null then
    with recommendations as materialized (
      select * from public.get_my_onboarding_creator_recommendations_v1(30)
    )
    select count(*),count(*) filter (where already_following)
      into v_eligible_count,v_followed_count
    from recommendations;

    v_required_follows := least(2,v_eligible_count);
    if v_followed_count < v_required_follows then
      raise exception using errcode = '22023', message = 'personalization_creator_follows_required';
    end if;
  end if;

  update private.user_personalization_profiles
  set onboarding_completed_at = coalesce(onboarding_completed_at,v_now),
      updated_at = v_now
  where user_id = v_actor;

  return jsonb_build_object(
    'completed',true,
    'onboarding_completed_at',coalesce(v_profile.onboarding_completed_at,v_now),
    'required_creator_follows',v_required_follows,
    'eligible_creator_recommendations',v_eligible_count,
    'followed_recommendations',v_followed_count
  );
end;
$$;

revoke all on function public.complete_my_personalization_onboarding_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.complete_my_personalization_onboarding_v1()
  to authenticated;

-- The canonical ranker is intentionally large. C1 patches the exact deployed
-- predecessor definition with guarded, deterministic replacements so the one
-- ranking authority and its complete L6 inference/observation contract remain
-- byte-identical outside the audited corrections. No user input reaches this
-- migration-time dynamic SQL.
do $c1_ranker$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(
    to_regprocedure(
      'public.get_ranked_feed_l1_v1(uuid,integer,timestamp with time zone,numeric,timestamp with time zone,uuid,text)'
    )
  ) into v_definition;

  if v_definition is null then
    raise exception 'algo6_c1_ranker_missing';
  end if;

  -- L2 and L5 were already personalization-aware; guard them as immutable
  -- prerequisites while C1 closes the L3/L4 gap.
  if strpos(v_definition,E'  v_l2_effective := v_viewer_id is not null\n    and (v_policy.l2_affinity_enabled or v_directed_l2_canary or v_personalization_effective);') = 0
     or strpos(v_definition,E'  v_l5_effective := v_behavioral\n    and v_viewer_id is not null\n    and (v_policy.l5_semantic_enabled or v_directed_l5_canary or v_personalization_effective);') = 0 then
    raise exception 'algo6_c1_ranker_personalization_predecessor_mismatch';
  end if;

  v_old := E'  v_l3_effective := v_behavioral\n    and (v_policy.l3_quality_enabled or v_directed_l3_canary);';
  v_new := E'  v_l3_effective := v_behavioral\n    and (v_policy.l3_quality_enabled or v_directed_l3_canary or v_personalization_effective);';
  if strpos(v_definition,v_old) = 0 then raise exception 'algo6_c1_ranker_l3_gate_mismatch'; end if;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := E'  v_l4_effective := v_behavioral\n    and (v_policy.l4_context_enabled or v_directed_l4_canary);';
  v_new := E'  v_l4_effective := v_behavioral\n    and (v_policy.l4_context_enabled or v_directed_l4_canary or v_personalization_effective);';
  if strpos(v_definition,v_old) = 0 then raise exception 'algo6_c1_ranker_l4_gate_mismatch'; end if;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := E'          and l4lvr.exit_reason in (''swipe'', ''background'', ''unmount'')';
  v_new := E'          and l4lvr.exit_reason = ''swipe''';
  if strpos(v_definition,v_old) = 0 then raise exception 'algo6_c1_ranker_l4_exit_mismatch'; end if;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := E'          and lrr.exit_reason in (''swipe'', ''background'', ''unmount'')';
  v_new := E'          and lrr.exit_reason = ''swipe''';
  if strpos(v_definition,v_old) = 0 then raise exception 'algo6_c1_ranker_l3_exit_mismatch'; end if;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := E'          and vv.exit_reason in (''swipe'', ''background'', ''unmount'')';
  v_new := E'          and vv.exit_reason = ''swipe''';
  if (length(v_definition)-length(replace(v_definition,v_old,''))) / length(v_old) <> 1 then
    raise exception 'algo6_c1_ranker_affinity_exit_mismatch';
  end if;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := E'        and vv.exit_reason in (''swipe'', ''background'', ''unmount'')';
  v_new := E'        and vv.exit_reason = ''swipe''';
  if (length(v_definition)-length(replace(v_definition,v_old,''))) / length(v_old) <> 1 then
    raise exception 'algo6_c1_ranker_viewer_history_exit_mismatch';
  end if;
  v_definition := replace(v_definition,v_old,v_new);

  -- Low-retention lifecycle exits are excluded from global L3 quality rather
  -- than silently lowering completion/long-watch quality. Definitive swipes,
  -- ended/completed views, and positive long-watch evidence remain eligible.
  v_old := E'  l3_retention_features as (\n';
  v_new := E'  l3_quality_eligible as (\n'
    || E'    select *\n'
    || E'    from l3_retention_ranked lrr\n'
    || E'    where lrr.audience_rank = 1\n'
    || E'      and (\n'
    || E'        lrr.completed is true\n'
    || E'        or lrr.bounded_completion_ratio >= v_policy.l3_long_watch_ratio_threshold\n'
    || E'        or lrr.exit_reason in (''swipe'', ''ended'')\n'
    || E'      )\n'
    || E'  ),\n'
    || E'  l3_retention_features as (\n';
  if (length(v_definition)-length(replace(v_definition,v_old,''))) / length(v_old) <> 1 then
    raise exception 'algo6_c1_ranker_l3_quality_cte_mismatch';
  end if;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := E'    from l3_retention_ranked lrr\n    where lrr.audience_rank = 1\n    group by lrr.video_id';
  v_new := E'    from l3_quality_eligible lrr\n    group by lrr.video_id';
  if strpos(v_definition,v_old) = 0 then raise exception 'algo6_c1_ranker_l3_quality_source_mismatch'; end if;
  v_definition := replace(v_definition,v_old,v_new);

  v_old := 'creator_profile.content_region_code = v_personalization_profile.content_region_code';
  v_new := 'creator_profile.account_region_code = v_personalization_profile.content_region_code';
  if (length(v_definition)-length(replace(v_definition,v_old,''))) / length(v_old) <> 1 then
    raise exception 'algo6_c1_ranker_region_mismatch';
  end if;
  v_definition := replace(v_definition,v_old,v_new);

  if strpos(v_definition,E'v_l3_effective := v_behavioral\n    and (v_policy.l3_quality_enabled or v_directed_l3_canary or v_personalization_effective)') = 0
     or strpos(v_definition,E'v_l4_effective := v_behavioral\n    and (v_policy.l4_context_enabled or v_directed_l4_canary or v_personalization_effective)') = 0
     or strpos(v_definition,'creator_profile.account_region_code = v_personalization_profile.content_region_code') = 0
     or strpos(v_definition,E'l4lvr.exit_reason in (''swipe'', ''background'', ''unmount'')') > 0
     or strpos(v_definition,E'lrr.exit_reason in (''swipe'', ''background'', ''unmount'')') > 0
     or strpos(v_definition,E'vv.exit_reason in (''swipe'', ''background'', ''unmount'')') > 0 then
    raise exception 'algo6_c1_ranker_patch_verification_failed';
  end if;

  execute v_definition;
end;
$c1_ranker$;

revoke all on function public.get_ranked_feed_l1_v1(
  uuid,integer,timestamp with time zone,numeric,timestamp with time zone,uuid,text
) from public, anon, authenticated, service_role;
grant execute on function public.get_ranked_feed_l1_v1(
  uuid,integer,timestamp with time zone,numeric,timestamp with time zone,uuid,text
) to anon, authenticated;

create or replace function public.manage_algo6_model_v1(
  p_action text,
  p_model_id uuid,
  p_rollback_model_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model private.algo6_model_versions;
  v_target private.algo6_model_versions;
  v_readiness jsonb;
  v_reconcile jsonb;
  v_now timestamptz := clock_timestamp();
begin
  -- Readiness, reconciler validation, and every transition share this lock.
  perform pg_advisory_xact_lock(hashtextextended('algo6-model-promotion',0));

  select * into v_model
  from private.algo6_model_versions
  where id = p_model_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'algo6_model_not_found';
  end if;

  if v_model.feature_contract_version <> 'organic-ranking-features-personalization-v2'
     or v_model.label_contract_version <> 'algo6-l6-label-contract-v1' then
    raise exception using errcode = '55000', message = 'algo6_model_contract_mismatch';
  end if;

  if p_action in ('candidate_to_canary','canary_to_active','rollback') then
    v_readiness := public.get_algo6_l6_training_readiness_v2();
    if (v_readiness->>'overall_status') = 'STRUCTURAL_FAILURE' then
      raise exception using errcode = '55000', message = 'algo6_model_structural_failure';
    end if;

    v_reconcile := public.reconcile_algo_l1_v1();
    if exists (
      select 1
      from jsonb_each(v_reconcile) anomaly
      where jsonb_typeof(anomaly.value) <> 'number'
         or anomaly.value <> '0'::jsonb
    ) then
      raise exception using errcode = '55000', message = 'algo6_model_reconciler_not_clean';
    end if;
  end if;

  if p_action in ('candidate_to_canary','canary_to_active')
     and coalesce((v_model.head_metrics->>'promotion_eligible')::boolean,false) is not true then
    raise exception using errcode = '55000', message = 'algo6_model_metrics_not_eligible';
  end if;

  if p_action = 'candidate_to_canary' then
    if v_model.status <> 'candidate' then
      raise exception using errcode = '22023', message = 'algo6_model_transition_invalid';
    end if;
    update private.algo6_model_versions
    set status = 'retired', retired_at = v_now
    where status = 'canary' and id <> v_model.id;
    update private.algo6_model_versions
    set status = 'canary', promoted_at = v_now
    where id = v_model.id;
    update private.algo_l1_policy
    set l6_canary_model_id = v_model.id,
        policy_version = left(
          'nelyon-algo-l6-canary-' || extract(epoch from v_now)::bigint || '-' || v_model.id::text,
          100
        )
    where singleton;
  elsif p_action = 'canary_to_active' then
    if v_model.status <> 'canary' then
      raise exception using errcode = '22023', message = 'algo6_model_transition_invalid';
    end if;
    update private.algo6_model_versions
    set status = 'retired', retired_at = v_now
    where status = 'active' and id <> v_model.id;
    update private.algo6_model_versions
    set status = 'active', promoted_at = v_now, retired_at = null
    where id = v_model.id;
    update private.algo_l1_policy
    set l6_active_model_id = v_model.id,
        l6_canary_model_id = null,
        l6_ml_enabled = true,
        policy_version = left(
          'nelyon-algo-l6-active-' || extract(epoch from v_now)::bigint || '-' || v_model.id::text,
          100
        )
    where singleton;
  elsif p_action = 'active_to_retired' then
    if v_model.status <> 'active' then
      raise exception using errcode = '22023', message = 'algo6_model_transition_invalid';
    end if;
    update private.algo6_model_versions
    set status = 'retired', retired_at = v_now
    where id = v_model.id;
    update private.algo_l1_policy
    set l6_active_model_id = null,
        l6_ml_enabled = false,
        policy_version = left(
          'nelyon-algo-l6-off-' || extract(epoch from v_now)::bigint || '-' || v_model.id::text,
          100
        )
    where singleton;
  elsif p_action = 'candidate_to_rejected' then
    if v_model.status <> 'candidate' then
      raise exception using errcode = '22023', message = 'algo6_model_transition_invalid';
    end if;
    update private.algo6_model_versions
    set status = 'rejected', retired_at = v_now
    where id = v_model.id;
  elsif p_action = 'rollback' then
    select * into v_target
    from private.algo6_model_versions
    where id = p_rollback_model_id
    for update;
    if not found or v_model.status <> 'active' or v_target.status <> 'retired' then
      raise exception using errcode = '22023', message = 'algo6_model_rollback_invalid';
    end if;
    if v_target.feature_contract_version <> v_model.feature_contract_version
       or v_target.label_contract_version <> v_model.label_contract_version then
      raise exception using errcode = '55000', message = 'algo6_model_rollback_contract_mismatch';
    end if;
    update private.algo6_model_versions
    set status = 'retired', retired_at = v_now
    where id = v_model.id;
    update private.algo6_model_versions
    set status = 'active', promoted_at = v_now, retired_at = null
    where id = v_target.id;
    update private.algo_l1_policy
    set l6_active_model_id = v_target.id,
        l6_ml_enabled = true,
        policy_version = left(
          'nelyon-algo-l6-rollback-' || extract(epoch from v_now)::bigint || '-' || v_target.id::text,
          100
        )
    where singleton;
    v_model := v_target;
  else
    raise exception using errcode = '22023', message = 'algo6_model_action_invalid';
  end if;

  return jsonb_build_object(
    'model_id',v_model.id,
    'action',p_action,
    'status',(select status from private.algo6_model_versions where id = v_model.id),
    'automatic_global_promotion',false
  );
end;
$$;

revoke all on function public.manage_algo6_model_v1(text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.manage_algo6_model_v1(text,uuid,uuid)
  to service_role;

create or replace function private.resolve_safe_personalization_traits_v1(
  p_user_id uuid,
  p_at_time timestamptz default clock_timestamp()
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with profile as materialized (
  select p.*,(e.status = 'eligible' and e.age_band = 'age_18_plus') adult
  from private.user_personalization_profiles p
  join private.user_age_eligibility e on e.user_id = p.user_id
  where p.user_id = p_user_id and p.onboarding_completed_at is not null
), explicit as materialized (
  select coalesce(jsonb_agg(t.slug order by t.slug),'[]'::jsonb) slugs
  from profile p
  join private.user_personalization_interests ui on ui.user_id = p.user_id
  join private.personalization_interest_taxonomy t on t.id = ui.interest_id
  where p.adult
    and p.ads_personalization_consent
    and t.active
    and t.minor_safe
    and t.ads_eligible
), positive_videos as materialized (
  select distinct signal.video_id
  from profile p
  cross join lateral (
    select v.video_id
    from public.video_views v
    where v.viewer_id = p.user_id
      and v.created_at <= p_at_time
      and v.media_duration_ms > 0
      and v.completion_ratio is not null
      and (v.completed or coalesce(v.rewatch_count,0) > 0 or v.completion_ratio >= 0.50)
    union
    select l.video_id
    from public.likes l
    where l.user_id = p.user_id and l.created_at <= p_at_time
    union
    select s.video_id
    from public.video_saves s
    where s.user_id = p.user_id and s.created_at <= p_at_time
  ) signal
  where p.adult and p.ads_personalization_consent
  limit 50
), centroid as materialized (
  select extensions.avg(s.embedding) embedding
  from positive_videos p
  join private.video_semantic_profiles s on s.video_id = p.video_id
  where s.status = 'ready'
    and s.provider = 'cloudflare_workers_ai'
    and s.model = '@cf/baai/bge-m3'
    and s.embedding_dimensions = 1024
    and s.embedding is not null
    and s.completed_at <= p_at_time
), inferred as materialized (
  select coalesce(jsonb_agg(slug order by similarity desc,slug),'[]'::jsonb) slugs
  from (
    select t.slug,1-(t.embedding operator(extensions.<=>) c.embedding) similarity
    from centroid c
    join private.personalization_interest_taxonomy t
      on t.active and t.minor_safe and t.ads_eligible
      and t.embedding_status = 'ready' and t.embedding is not null
    where c.embedding is not null
      and 1-(t.embedding operator(extensions.<=>) c.embedding) >= 0.35
    order by similarity desc,t.slug
    limit 8
  ) ranked
)
select jsonb_build_object(
  'eligible',coalesce(p.adult and p.ads_personalization_consent,false),
  'ads_personalization_consent',coalesce(p.ads_personalization_consent,false),
  'primary_language_tag',p.primary_language_tag,
  'additional_language_tags',coalesce(to_jsonb(p.additional_language_tags),'[]'::jsonb),
  'account_region_code',p.account_region_code,
  'explicit_interest_slugs',coalesce(e.slugs,'[]'::jsonb),
  'behavioral_interest_slugs',coalesce(i.slugs,'[]'::jsonb)
)
from profile p
left join explicit e on true
left join inferred i on true;
$$;

revoke all on function private.resolve_safe_personalization_traits_v1(uuid,timestamptz)
  from public, anon, authenticated, service_role;

create or replace function private.ads_v4_viewer_matches_personalization(
  p_audience_version_id uuid,
  p_viewer_user_id uuid,
  p_at_time timestamptz
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_traits jsonb;
  v_has_targets boolean;
  v_has_interest_targets boolean;
  v_languages text[];
  v_explicit text[];
  v_behavioral text[];
  v_region text;
begin
  select
    exists(
      select 1 from private.advertising_interest_targets
      where audience_version_id = p_audience_version_id
    ),
    exists(
      select 1 from private.advertising_interest_targets
      where audience_version_id = p_audience_version_id
    )
    or exists(
      select 1 from private.advertising_language_targets
      where audience_version_id = p_audience_version_id
    )
    or exists(
      select 1 from private.advertising_geo_targets
      where audience_version_id = p_audience_version_id
    )
  into v_has_interest_targets,v_has_targets;

  if not v_has_targets then return true; end if;
  if p_viewer_user_id is null then return false; end if;

  v_traits := private.resolve_safe_personalization_traits_v1(p_viewer_user_id,p_at_time);
  if v_traits is null then return false; end if;

  if v_has_interest_targets
     and coalesce((v_traits->>'eligible')::boolean,false) is not true then
    return false;
  end if;

  select array_agg(value) into v_languages
  from (
    select v_traits->>'primary_language_tag' value
    union
    select jsonb_array_elements_text(
      coalesce(v_traits->'additional_language_tags','[]'::jsonb)
    )
  ) x
  where value is not null;

  select array_agg(value) into v_explicit
  from jsonb_array_elements_text(coalesce(v_traits->'explicit_interest_slugs','[]'::jsonb));
  select array_agg(value) into v_behavioral
  from jsonb_array_elements_text(coalesce(v_traits->'behavioral_interest_slugs','[]'::jsonb));

  v_region := v_traits->>'account_region_code';

  if exists (
    select 1 from private.advertising_language_targets l
    where l.audience_version_id = p_audience_version_id
      and l.match_mode = 'exclude'
      and l.language_tag = any(coalesce(v_languages,array[]::text[]))
  ) then return false; end if;

  if exists (
    select 1 from private.advertising_language_targets l
    where l.audience_version_id = p_audience_version_id and l.match_mode = 'include'
  ) and not exists (
    select 1 from private.advertising_language_targets l
    where l.audience_version_id = p_audience_version_id
      and l.match_mode = 'include'
      and l.language_tag = any(coalesce(v_languages,array[]::text[]))
  ) then return false; end if;

  if exists (
    select 1 from private.advertising_geo_targets g
    where g.audience_version_id = p_audience_version_id
      and g.match_mode = 'exclude'
      and g.country_code = v_region
  ) then return false; end if;

  if exists (
    select 1 from private.advertising_geo_targets g
    where g.audience_version_id = p_audience_version_id and g.match_mode = 'include'
  ) and not exists (
    select 1 from private.advertising_geo_targets g
    where g.audience_version_id = p_audience_version_id
      and g.match_mode = 'include'
      and g.country_code = v_region
  ) then return false; end if;

  if exists (
    select 1
    from private.advertising_interest_targets i
    join private.personalization_interest_taxonomy t on t.id = i.interest_id
    where i.audience_version_id = p_audience_version_id
      and i.match_mode = 'exclude'
      and (
        (i.signal_source in ('explicit','either')
          and t.slug = any(coalesce(v_explicit,array[]::text[])))
        or (i.signal_source in ('behavioral','either')
          and t.slug = any(coalesce(v_behavioral,array[]::text[])))
      )
  ) then return false; end if;

  if exists (
    select 1 from private.advertising_interest_targets i
    where i.audience_version_id = p_audience_version_id and i.match_mode = 'include'
  ) and not exists (
    select 1
    from private.advertising_interest_targets i
    join private.personalization_interest_taxonomy t on t.id = i.interest_id
    where i.audience_version_id = p_audience_version_id
      and i.match_mode = 'include'
      and (
        (i.signal_source in ('explicit','either')
          and t.slug = any(coalesce(v_explicit,array[]::text[])))
        or (i.signal_source in ('behavioral','either')
          and t.slug = any(coalesce(v_behavioral,array[]::text[])))
      )
  ) then return false; end if;

  return true;
end;
$$;

revoke all on function private.ads_v4_viewer_matches_personalization(uuid,uuid,timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.reconcile_algo_l1_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with base as materialized (
  select private.reconcile_algo_l1_f4_v1() result
), readiness as materialized (
  select p.oid,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_algo6_l6_training_readiness_v2'
    and pg_get_function_identity_arguments(p.oid) = ''
), ranker as materialized (
  select pg_get_functiondef(p.oid) definition
  from pg_proc p
  where p.oid = to_regprocedure(
    'public.get_ranked_feed_l1_v1(uuid,integer,timestamp with time zone,numeric,timestamp with time zone,uuid,text)'
  )
), current_onboarding as materialized (
  select p.oid,p.proname,p.prosecdef,p.proconfig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'get_my_personalization_onboarding_v2',
      'get_personalization_onboarding_catalog_v2',
      'save_my_personalization_preferences_v2',
      'complete_my_personalization_onboarding_v1',
      'get_my_onboarding_creator_recommendations_v1'
    )
), legacy_onboarding as materialized (
  select p.oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'get_my_personalization_onboarding_v1',
      'get_personalization_onboarding_catalog_v1',
      'save_my_personalization_preferences_v1'
    )
), model_manager as materialized (
  select pg_get_functiondef(p.oid) definition
  from pg_proc p
  where p.oid = to_regprocedure('public.manage_algo6_model_v1(text,uuid,uuid)')
), ads_matcher as materialized (
  select pg_get_functiondef(p.oid) definition
  from pg_proc p
  where p.oid = to_regprocedure(
    'private.ads_v4_viewer_matches_personalization(uuid,uuid,timestamp with time zone)'
  )
)
select (
  base.result - array[
    'l6_training_readiness_authority_missing',
    'l6_training_readiness_contract_invalid',
    'l6_training_readiness_forbidden_dependency_present',
    'l6_observation_ranking_contract_missing'
  ]
) || jsonb_build_object(
  'l6_training_readiness_authority_missing',(
    select case when count(*) = 1 and bool_and(
      prosecdef
      and coalesce(proconfig,'{}'::text[]) @> array['search_path=""']::text[]
      and has_function_privilege('service_role',oid,'execute')
      and not has_function_privilege('public',oid,'execute')
      and not has_function_privilege('anon',oid,'execute')
      and not has_function_privilege('authenticated',oid,'execute')
    ) then 0 else 1 end
    from readiness
  ),
  'l6_training_readiness_contract_invalid',(
    select case when count(*) = 1 and bool_and(
      strpos(lower(definition),'algo6-l6-training-readiness-v2') > 0
      and strpos(lower(definition),'organic-ranking-features-personalization-v2') > 0
      and strpos(lower(definition),'algo6-l6-label-contract-v1') > 0
      and strpos(lower(definition),'training_entry_ready') > 0
    ) then 0 else 1 end
    from readiness
  ),
  'l6_training_readiness_forbidden_dependency_present',(
    select count(*)
    from readiness
    where lower(definition) ~
      'marketplace_|financial_transactions|ledger_entries|ledger_accounts|wallet|escrow|stripe|creator_earnings|public\.messages|private_chat|device_fingerprint|network_type'
  ),
  'l6_observation_ranking_contract_missing',(
    select case when count(*) = 1 and bool_and(
      strpos(lower(definition),'ranking_decision_id') > 0
      and strpos(lower(definition),'ranking_organic_position') > 0
      and strpos(lower(definition),'record_organic_ranking_decision_v1') > 0
      and strpos(lower(definition),'organic-ranking-features-personalization-v2') > 0
    ) then 0 else 1 end
    from ranker
  ),
  'personalization_authority_missing',(
    select case when
      (
        select count(*) = 3 and bool_and(c.relrowsecurity and c.relforcerowsecurity)
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'private'
          and c.relname in (
            'personalization_interest_taxonomy',
            'user_personalization_profiles',
            'user_personalization_interests'
          )
      )
      and exists (
        select 1
        from information_schema.columns c
        where c.table_schema = 'private'
          and c.table_name = 'user_personalization_profiles'
          and c.column_name = 'account_region_code'
      )
      then 0 else 1 end
  ),
  'personalization_taxonomy_invalid',(
    select count(*)
    from private.personalization_interest_taxonomy t
    where t.slug <> lower(t.slug)
      or jsonb_typeof(t.labels) <> 'object'
      or not t.minor_safe
      or (
        t.embedding_status = 'ready'
        and (
          t.embedding is null
          or t.embedding_dimensions <> 1024
          or t.embedding_provider <> 'cloudflare_workers_ai'
          or t.embedding_model <> '@cf/baai/bge-m3'
        )
      )
  ),
  'personalization_onboarding_contract_missing',(
    select case when
      (select count(*) from current_onboarding) = 5
      and not exists (
        select 1
        from current_onboarding p
        where not p.prosecdef
          or not (coalesce(p.proconfig,'{}'::text[]) @> array['search_path=""']::text[])
          or not has_function_privilege('authenticated',p.oid,'execute')
          or has_function_privilege('public',p.oid,'execute')
          or has_function_privilege('anon',p.oid,'execute')
      )
      and (select count(*) from legacy_onboarding) = 3
      and not exists (
        select 1
        from legacy_onboarding p
        where has_function_privilege('public',p.oid,'execute')
           or has_function_privilege('anon',p.oid,'execute')
           or has_function_privilege('authenticated',p.oid,'execute')
      )
      then 0 else 1 end
  ),
  'personalization_ranking_contract_missing',(
    select case when count(*) = 1 and bool_and(
      strpos(lower(definition),'explicit_interest_similarity') > 0
      and strpos(lower(definition),'explicit_seed_weight') > 0
      and strpos(lower(definition),'behavioral_confidence') > 0
      and strpos(lower(definition),'organic-ranking-features-personalization-v2') > 0
      and strpos(lower(definition),'v_directed_l3_canary or v_personalization_effective') > 0
      and strpos(lower(definition),'v_directed_l4_canary or v_personalization_effective') > 0
      and strpos(lower(definition),'creator_profile.account_region_code = v_personalization_profile.content_region_code') > 0
      and strpos(lower(definition),'exit_reason in (''swipe'', ''background'', ''unmount'')') = 0
    ) then 0 else 1 end
    from ranker
  ),
  'l6_model_authority_invalid',(
    select case when
      to_regclass('private.algo6_model_versions') is not null
      and to_regprocedure('public.manage_algo6_model_v1(text,uuid,uuid)') is not null
      and to_regprocedure(
        'public.register_algo6_model_candidate_v1(text,timestamp with time zone,timestamp with time zone,bigint,jsonb,jsonb,boolean)'
      ) is not null
      and (select count(*) = 1 and bool_and(
        strpos(lower(definition),'reconcile_algo_l1_v1') > 0
        and strpos(lower(definition),'algo6_model_reconciler_not_clean') > 0
      ) from model_manager)
      then 0 else 1 end
  ),
  'ads_personalization_v4_authority_invalid',(
    select case when
      to_regclass('private.advertising_interest_targets') is not null
      and exists (
        select 1
        from private.advertising_targeting_policy
        where singleton
          and policy_version = 'nelyon-ads-targeting-v4'
          and interest_targeting_enabled
          and behavioral_targeting_enabled
          and language_targeting_enabled
          and geo_targeting_enabled
          and not sensitive_targeting_allowed
          and not precise_viewer_location_matching_enabled
      )
      and (select count(*) = 1 and bool_and(
        strpos(lower(definition),'account_region_code') > 0
        and strpos(lower(definition),'v_region := v_traits->>''content_region_code''') = 0
      ) from ads_matcher)
      then 0 else 1 end
  )
)
from base;
$$;

revoke all on function public.reconcile_algo_l1_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_algo_l1_v1() to service_role;

commit;
