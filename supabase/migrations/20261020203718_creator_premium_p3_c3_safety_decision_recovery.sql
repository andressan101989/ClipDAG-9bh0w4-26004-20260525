begin;

-- P3-C3 closes a parity defect between the Edge validator and the database
-- authority. Observable weapon and law-enforcement states are independent
-- evidence for REVIEW/BLOCK. Their ALLOW annotations remain strictly paired
-- and the visual compatibility authority still binds every ALLOW to the
-- canonical sampled-frame result.
create or replace function private.creator_premium_content_safety_context_result_valid_p3_v1(
  p_result jsonb,
  p_transcript_coverage text
) returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_keys text[];
  v_coverage_keys text[];
  v_categories text[];
  v_rationale_codes text[];
  v_decision text;
  v_uncertainty text;
  v_age_uncertainty text;
  v_consent_uncertainty text;
  v_weapon_state text;
  v_law_enforcement_state text;
  v_violence_state text;
  v_allow constant text[] := array[
    'courses','tutorials','education','entertainment','dance','humor','sport',
    'fashion','kissing_and_affection','swimwear','non_explicit_sensual_clothing',
    'non_sexual_artistic_content','non_graphic_law_enforcement_operation',
    'non_threatening_weapon_presence'
  ]::text[];
  v_review constant text[] := array[
    'contextual_artistic_or_medical_nudity',
    'incidental_blood_or_informational_context','documentary_violence',
    'age_uncertain','consent_uncertain','contradictory_signals',
    'low_confidence','incomplete_multimodal_coverage',
    'ambiguous_weapon_or_law_enforcement_context'
  ]::text[];
  v_block constant text[] := array[
    'explicit_sexual_activity','pornography',
    'sexualized_explicit_genital_exposure','child_sexual_exploitation',
    'non_consensual_intimate_content','sexual_violence','torture','mutilation',
    'graphic_murder','graphic_serious_assault',
    'explicit_promotion_of_severe_harm'
  ]::text[];
  v_rationale constant text[] := array[
    'benign_context','educational_context','quoted_or_negated_context',
    'swimwear_or_non_explicit_context','ambiguous_context',
    'age_requires_review','consent_requires_review','severe_explicit_context',
    'violent_threat_context','contradictory_signals','visual_review_signal',
    'no_speech','non_graphic_law_enforcement_context',
    'non_threatening_weapon_context'
  ]::text[];
  v_allow_rationale constant text[] := array[
    'benign_context','educational_context','quoted_or_negated_context',
    'swimwear_or_non_explicit_context','no_speech',
    'non_graphic_law_enforcement_context','non_threatening_weapon_context'
  ]::text[];
  v_review_rationale constant text[] := array[
    'ambiguous_context','age_requires_review','consent_requires_review',
    'violent_threat_context','contradictory_signals','visual_review_signal'
  ]::text[];
begin
  if pg_catalog.jsonb_typeof(p_result) is distinct from 'object'
     or pg_catalog.pg_column_size(p_result) > 16384
     or p_transcript_coverage not in ('complete','no_speech','not_applicable') then
    return false;
  end if;
  select pg_catalog.array_agg(key order by key) into v_keys
  from pg_catalog.jsonb_object_keys(p_result) key;
  if v_keys is distinct from array[
    'age_uncertainty','categories','certainty_basis','consent_uncertainty',
    'coverage','decision','law_enforcement_state','policy_id','rationale_codes',
    'schema_version','uncertainty','violence_state','weapon_state'
  ]::text[] then return false; end if;
  if p_result->>'schema_version' is distinct from
       'creator-premium-context-p3-v1'
     or p_result->>'policy_id' is distinct from
       'nelyon.creator_premium.general.p1.v2'
     or p_result->>'certainty_basis' is distinct from 'discrete_contract'
     or p_result->>'decision' is null
     or p_result->>'decision' not in ('allow','review','block')
     or p_result->>'uncertainty' is null
     or p_result->>'uncertainty' not in ('unambiguous','ambiguous')
     or p_result->>'age_uncertainty' is null
     or p_result->>'age_uncertainty' not in ('not_relevant','present')
     or p_result->>'consent_uncertainty' is null
     or p_result->>'consent_uncertainty' not in ('not_relevant','present')
     or p_result->>'weapon_state' is null
     or p_result->>'weapon_state' not in (
       'not_observed','visible_non_threatening',
       'pointed_brandished_fired_or_threatening','uncertain'
     )
     or p_result->>'law_enforcement_state' is null
     or p_result->>'law_enforcement_state' not in (
       'not_observed','routine_peaceful','force_or_confrontation','uncertain'
     )
     or p_result->>'violence_state' is null
     or p_result->>'violence_state' not in (
       'none_observed','real_non_graphic_or_incidental_injury',
       'graphic_or_severe','uncertain'
     ) then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(p_result->'coverage') is distinct from 'object' then
    return false;
  end if;
  select pg_catalog.array_agg(key order by key) into v_coverage_keys
  from pg_catalog.jsonb_object_keys(p_result->'coverage') key;
  if v_coverage_keys is distinct from array['text','transcript','visual']::text[]
     or p_result#>>'{coverage,text}' is distinct from 'complete'
     or p_result#>>'{coverage,transcript}' is distinct from p_transcript_coverage
     or p_result#>>'{coverage,visual}' is distinct from 'complete' then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(p_result->'categories') is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_result->'categories') not between 1 and 8
     or exists(
       select 1 from pg_catalog.jsonb_array_elements(p_result->'categories') item
       where pg_catalog.jsonb_typeof(item) <> 'string'
     ) then return false; end if;
  select pg_catalog.array_agg(value order by value) into v_categories
  from pg_catalog.jsonb_array_elements_text(p_result->'categories') value;
  if pg_catalog.cardinality(v_categories)
       <> pg_catalog.cardinality(array(select distinct value from unnest(v_categories) value))
     or not v_categories <@ (v_allow||v_review||v_block) then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(p_result->'rationale_codes') is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_result->'rationale_codes') not between 1 and 8
     or exists(
       select 1 from pg_catalog.jsonb_array_elements(p_result->'rationale_codes') item
       where pg_catalog.jsonb_typeof(item) <> 'string'
     ) then return false; end if;
  select pg_catalog.array_agg(value order by value) into v_rationale_codes
  from pg_catalog.jsonb_array_elements_text(p_result->'rationale_codes') value;
  if pg_catalog.cardinality(v_rationale_codes)
       <> pg_catalog.cardinality(array(select distinct value from unnest(v_rationale_codes) value))
     or not v_rationale_codes <@ v_rationale then
    return false;
  end if;
  v_decision := p_result->>'decision';
  v_uncertainty := p_result->>'uncertainty';
  v_age_uncertainty := p_result->>'age_uncertainty';
  v_consent_uncertainty := p_result->>'consent_uncertainty';
  v_weapon_state := p_result->>'weapon_state';
  v_law_enforcement_state := p_result->>'law_enforcement_state';
  v_violence_state := p_result->>'violence_state';
  if v_decision='allow' and (
       not v_categories <@ v_allow
       or not v_rationale_codes <@ v_allow_rationale
       or v_uncertainty<>'unambiguous'
       or v_age_uncertainty<>'not_relevant'
       or v_consent_uncertainty<>'not_relevant'
       or v_weapon_state not in ('not_observed','visible_non_threatening')
       or v_law_enforcement_state not in ('not_observed','routine_peaceful')
       or v_violence_state<>'none_observed'
       or (('non_graphic_law_enforcement_operation'=any(v_categories))
         is distinct from (v_law_enforcement_state='routine_peaceful'))
       or (('non_threatening_weapon_presence'=any(v_categories))
         is distinct from (v_weapon_state='visible_non_threatening'))
     ) then return false; end if;
  if v_decision='review' and (
       v_categories && v_block
       or 'severe_explicit_context'=any(v_rationale_codes)
       or not v_rationale_codes && v_review_rationale
       or v_violence_state='graphic_or_severe'
       or (not v_categories && v_review
         and v_uncertainty<>'ambiguous'
         and v_age_uncertainty<>'present'
         and v_consent_uncertainty<>'present')
     ) then return false; end if;
  if v_decision='block' and (
       v_uncertainty<>'unambiguous' or not v_categories <@ v_block
       or not ('severe_explicit_context'=any(v_rationale_codes))
     ) then return false; end if;
  if v_violence_state='graphic_or_severe' and v_decision<>'block'
     then return false; end if;
  if v_age_uncertainty='present'
     and not v_categories && array['age_uncertain','child_sexual_exploitation']::text[]
     then return false; end if;
  if 'age_uncertain'=any(v_categories) and v_age_uncertainty<>'present'
     then return false; end if;
  if v_consent_uncertainty='present'
     and not v_categories && array[
       'consent_uncertain','non_consensual_intimate_content','sexual_violence'
     ]::text[] then return false; end if;
  if 'consent_uncertain'=any(v_categories)
     and v_consent_uncertainty<>'present' then return false; end if;
  if 'child_sexual_exploitation'=any(v_categories)
     and v_age_uncertainty<>'present' then return false; end if;
  if v_categories && array[
       'non_consensual_intimate_content','sexual_violence'
     ]::text[] and v_consent_uncertainty<>'present' then return false; end if;
  if ('non_graphic_law_enforcement_operation'=any(v_categories))
       is distinct from
       ('non_graphic_law_enforcement_context'=any(v_rationale_codes)) then
    return false;
  end if;
  if ('non_threatening_weapon_presence'=any(v_categories))
       is distinct from
       ('non_threatening_weapon_context'=any(v_rationale_codes)) then
    return false;
  end if;
  return true;
end;
$$;

revoke all on function
  private.creator_premium_content_safety_context_result_valid_p3_v1(jsonb,text)
  from public,anon,authenticated,service_role;
grant execute on function
  private.creator_premium_content_safety_context_result_valid_p3_v1(jsonb,text)
  to postgres,supabase_admin;

comment on function
  private.creator_premium_content_safety_context_result_valid_p3_v1(jsonb,text) is
  'Validates the P3/v2 decision contract. Safe law-enforcement and weapon states require paired ALLOW annotations only for ALLOW; REVIEW and BLOCK retain independent observable states.';

commit;
