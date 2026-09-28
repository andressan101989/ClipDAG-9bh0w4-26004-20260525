-- ADS-V2-PLR-13A-C1: prepare one exact owner-funded billing canary.
-- This bootstrap changes no Finance/Ledger state and leaves launch DISARMED.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $bootstrap$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_effective_from timestamptz := v_now;
  v_campaign_id constant uuid := 'b2ec6689-ece3-4f5b-bc91-ebfc4cf8970d';
  v_global_rate_id constant uuid := '7013f89c-9daf-4ef4-9b50-287ae1a6b24b';
  v_canary_rate_id uuid := gen_random_uuid();
  v_metadata jsonb;
  v_fingerprint text;
  v_constraint_definition text;
  v_count integer;
begin
  -- Serialize with every launch-gated authority on the canonical control row.
  perform 1
  from private.advertising_canary_policy
  where singleton
  for update;

  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
  into v_constraint_definition
  from pg_catalog.pg_constraint constraint_row
  join pg_catalog.pg_class relation_row on relation_row.oid=constraint_row.conrelid
  join pg_catalog.pg_namespace namespace_row on namespace_row.oid=relation_row.relnamespace
  where namespace_row.nspname='private'
    and relation_row.relname='advertising_canary_policy'
    and constraint_row.conname='advertising_canary_policy_budget_chk';

  if v_constraint_definition is null
    or v_constraint_definition not like '%0.01000000%' then
    raise exception using errcode='55000',message='advertising_plr13_canary_budget_constraint_unexpected';
  end if;

  if not exists(
    select 1
    from private.advertising_canary_policy policy
    where policy.singleton
      and policy.policy_version='nelyon-ads-canary-v1'
      and policy.launch_mode='DISARMED'
      and policy.canary_enabled=false
      and policy.business_account_id is null
      and policy.ad_account_id is null
      and policy.campaign_id is null
      and policy.viewer_user_id is null
      and policy.placement_code is null
      and policy.enabled_at is null
      and policy.expires_at is null
      and policy.max_budget_bdag is null
      and policy.max_impressions is null
      and policy.max_spend_bdag is null
      and policy.max_billable_events is null
  )
  or (select funding_enabled or spend_enabled or settlement_enabled
      from private.advertising_finance_policy where singleton)
  or (select activation_enabled or automatic_transitions_enabled
      from private.advertising_campaign_lifecycle_policy where singleton)
  or (select global_v2_delivery_enabled
      from private.advertising_delivery_policy where singleton)
  or exists(select 1 from private.advertising_placement_catalog where v2_delivery_enabled) then
    raise exception using errcode='55000',message='advertising_plr13_requires_disarmed_control_plane';
  end if;

  if exists(
    select 1 from private.advertising_billing_authorization_windows where status='OPEN'
  ) then
    raise exception using errcode='55000',message='advertising_plr13_open_window_present';
  end if;
  if exists(select 1 from private.advertising_event_billing_materializations) then
    raise exception using errcode='55000',message='advertising_plr13_materialization_present';
  end if;

  if not exists(
    select 1
    from private.advertising_campaigns campaign
    join private.ad_accounts ad_account on ad_account.id=campaign.ad_account_id
    join private.business_accounts business on business.id=ad_account.business_account_id
    where campaign.id=v_campaign_id
      and campaign.name='NELYON ADS BILLING CANARY PLR-13'
      and campaign.objective='awareness'
      and campaign.status='draft'
      and campaign.created_by='56990585-7655-47e1-a017-a3c272a49820'::uuid
      and ad_account.id='d4ad759a-fc5f-47a0-bbc1-3036b30f1ee3'::uuid
      and ad_account.status='active'
      and ad_account.billing_currency='BDAG'
      and business.id='83a9a493-c03c-4d34-b41d-3d3a70aea818'::uuid
      and business.owner_user_id='56990585-7655-47e1-a017-a3c272a49820'::uuid
      and business.status='active'
  ) then
    raise exception using errcode='55000',message='advertising_plr13_campaign_invalid';
  end if;

  perform 1
  from private.advertising_campaign_finance finance
  where finance.campaign_id=v_campaign_id
  for update;
  if not exists(
    select 1 from private.advertising_campaign_finance finance
    where finance.campaign_id=v_campaign_id
      and finance.currency='BDAG'
      and finance.finance_status='draft'
      and finance.budget_bdag=0.30000000
      and finance.funded_bdag=0
      and finance.spent_bdag=0
      and finance.released_bdag=0
      and finance.funding_source_account_id is null
      and finance.funded_by_user_id is null
      and finance.funded_at is null
  ) then
    raise exception using errcode='55000',message='advertising_plr13_finance_invalid';
  end if;

  if not exists(
    select 1
    from private.advertising_ad_sets ad_set
    where ad_set.id='51204809-8b40-4d93-91b3-25e13743f8d9'::uuid
      and ad_set.campaign_id=v_campaign_id
      and ad_set.status='draft'
      and ad_set.starts_at <= v_now
      and ad_set.ends_at >= v_now + interval '15 minutes'
      and (select pg_catalog.count(*) from private.advertising_ad_sets candidate
           where candidate.campaign_id=v_campaign_id)=1
  ) then
    raise exception using errcode='55000',message='advertising_plr13_schedule_invalid';
  end if;

  if not exists(
    select 1
    from private.advertising_placement_selection_versions version
    join private.advertising_placement_selections selection on selection.id=version.placement_selection_id
    where version.id='88ee8632-53c5-4a2c-a914-2e5cc98ad8d0'::uuid
      and selection.ad_set_id='51204809-8b40-4d93-91b3-25e13743f8d9'::uuid
      and selection.status='draft'
      and version.version_number=(
        select pg_catalog.max(candidate.version_number)
        from private.advertising_placement_selection_versions candidate
        where candidate.placement_selection_id=selection.id
      )
      and (select pg_catalog.count(*) from private.advertising_placement_selection_items item
           where item.placement_selection_version_id=version.id)=1
      and exists(
        select 1 from private.advertising_placement_selection_items item
        where item.placement_selection_version_id=version.id
          and item.placement_code='social_feed'
      )
  ) then
    raise exception using errcode='55000',message='advertising_plr13_placement_invalid';
  end if;

  if not exists(
    select 1
    from private.advertising_ads ad
    join private.advertising_creative_versions creative_version
      on creative_version.id=ad.creative_version_id
    join private.advertising_creatives creative on creative.id=creative_version.creative_id
    join public.media_assets media on media.id=creative_version.media_asset_id
    join private.advertising_destinations destination on destination.id=ad.destination_id
    where ad.id='2dd92465-5237-4ff8-aba4-1aa2771d8432'::uuid
      and ad.ad_set_id='51204809-8b40-4d93-91b3-25e13743f8d9'::uuid
      and ad.status='draft'
      and ad.review_status='approved'
      and ad.submission_fingerprint ~ '^[0-9a-f]{64}$'
      and (select pg_catalog.count(*) from private.advertising_ads candidate
           where candidate.ad_set_id=ad.ad_set_id)=1
      and creative_version.id='7e940d5e-ca03-43d8-b280-5534079ba410'::uuid
      and creative_version.format='image'
      and creative.id='9cb8210a-8e6b-4559-8d51-72a2ebe2f8b3'::uuid
      and creative.ad_account_id='d4ad759a-fc5f-47a0-bbc1-3036b30f1ee3'::uuid
      and media.id='96deac30-6073-4ce1-819f-fe379ef0b2d4'::uuid
      and media.media_kind='image'
      and media.status='ready'
      and media.deleted_at is null
      and destination.id='cd5726d5-a6ac-4090-843e-148e4e856aa4'::uuid
      and destination.campaign_id=v_campaign_id
      and destination.status='draft'
  ) then
    raise exception using errcode='55000',message='advertising_plr13_ad_invalid';
  end if;

  if not exists(
    select 1
    from private.advertising_audience_versions version
    join private.advertising_audiences audience on audience.id=version.audience_id
    where version.id='e0e6b5ac-f2e0-426c-8dcf-e355b5667236'::uuid
      and audience.ad_set_id='51204809-8b40-4d93-91b3-25e13743f8d9'::uuid
      and audience.status='draft'
      and version.targeting_policy_version='nelyon-ads-targeting-v3'
      and version.min_age=13
      and version.max_age is null
  ) then
    raise exception using errcode='55000',message='advertising_plr13_audience_invalid';
  end if;

  if not exists(
    select 1
    from private.advertising_billing_rate_versions rate
    where rate.id=v_global_rate_id
      and rate.objective='awareness'
      and rate.billable_event_type='impression'
      and rate.placement_code='social_feed'
      and rate.rate_bdag=0.30000000
      and rate.currency='BDAG'
      and rate.scope='global'
      and rate.scope_campaign_id is null
      and rate.state='published'
      and rate.effective_from <= v_now
      and (rate.effective_to is null or rate.effective_to > v_now)
  ) then
    raise exception using errcode='55000',message='advertising_plr13_global_rate_invalid';
  end if;
  if (select pg_catalog.count(*) from private.advertising_billing_rate_versions)<>54
    or (select pg_catalog.count(*) from private.advertising_billing_rate_versions rate
        where rate.scope='global' and rate.scope_campaign_id is null
          and rate.state='published')<>54
    or exists(
    select 1 from private.advertising_billing_rate_versions rate
    where rate.scope='canary_campaign'
  ) then
    raise exception using errcode='55000',message='advertising_plr13_existing_canary_rate';
  end if;

  if exists(select 1 from private.advertising_events event where event.campaign_id=v_campaign_id)
    or exists(select 1 from private.advertising_financial_events event where event.campaign_id=v_campaign_id) then
    raise exception using errcode='55000',message='advertising_plr13_campaign_evidence_present';
  end if;

  -- Preserve the funded historical canary as immutable operational evidence.
  if not exists(
    select 1
    from private.advertising_campaigns campaign
    join private.advertising_campaign_finance finance on finance.campaign_id=campaign.id
    where campaign.id='7a3489b6-2d5c-43bd-9a35-0bf0b37403d0'::uuid
      and campaign.status='paused'
      and finance.finance_status='funded'
      and finance.budget_bdag=0.01000000
      and finance.funded_bdag=0.01000000
      and finance.spent_bdag=0
      and finance.released_bdag=0
  ) then
    raise exception using errcode='55000',message='advertising_plr13_historical_canary_invalid';
  end if;

  alter table private.advertising_canary_policy
    drop constraint advertising_canary_policy_budget_chk;
  alter table private.advertising_canary_policy
    add constraint advertising_canary_policy_budget_chk check (
      max_budget_bdag is null
      or (max_budget_bdag > 0 and max_budget_bdag <= 0.30000000)
    );

  update private.advertising_canary_policy
  set policy_version='nelyon-ads-canary-v2',updated_at=v_now
  where singleton and policy_version='nelyon-ads-canary-v1';
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception using errcode='55000',message='advertising_plr13_policy_version_update_failed';
  end if;

  insert into private.advertising_billing_rate_versions(
    id,objective,billable_event_type,placement_code,rate_bdag,currency,scope,
    scope_campaign_id,state,effective_from,effective_to,created_by,published_by,
    created_at,updated_at,published_at
  ) values(
    v_canary_rate_id,'awareness','impression','social_feed',
    0.30000000::numeric(20,8),'BDAG','canary_campaign',v_campaign_id,'published',
    v_effective_from,null,null,null,v_effective_from,v_effective_from,v_effective_from
  );

  v_metadata := jsonb_build_object(
    'previous_canary_policy_version','nelyon-ads-canary-v1',
    'new_canary_policy_version','nelyon-ads-canary-v2',
    'previous_max_budget_bdag',0.01000000::numeric(20,8),
    'new_max_budget_bdag',0.30000000::numeric(20,8),
    'campaign_id',v_campaign_id,
    'global_rate_version_id',v_global_rate_id,
    'canary_rate_version_id',v_canary_rate_id,
    'objective','awareness',
    'placement','social_feed',
    'billable_event','impression',
    'global_rate_bdag',0.30000000::numeric(20,8),
    'canary_rate_bdag',0.30000000::numeric(20,8),
    'pricing_policy','nelyon-ads-pricing-v1',
    'effective_from',v_effective_from,
    'receipt',jsonb_build_object(
      'policy_version','nelyon-ads-canary-v2',
      'campaign_id',v_campaign_id,
      'canary_rate_version_id',v_canary_rate_id,
      'effective_from',v_effective_from
    )
  );
  v_fingerprint := private.admin_request_fingerprint(v_metadata);

  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,
    target_type,target_id,target_ref,outcome,reason,financial_effect,contains_pii,
    idempotency_scope,idempotency_key,request_fingerprint,metadata
  ) values(
    null,'system_workflow','{}'::text[],null,'advertising',
    'advertising.plr13.canary_policy_rate.bootstrap',
    'advertising_canary_campaign',v_campaign_id,'nelyon-ads-canary-v2',
    'succeeded',null,true,false,
    'v1|system|advertising|plr13.canary_policy_rate.bootstrap',
    '13000000-0000-4000-8000-000000000001'::uuid,v_fingerprint,v_metadata
  );

  set constraints all immediate;
end;
$bootstrap$;

notify pgrst,'reload schema';

commit;
