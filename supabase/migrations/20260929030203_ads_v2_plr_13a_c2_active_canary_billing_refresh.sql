-- ADS-V2-PLR-13A-C2
-- Permit only an exact, evidence-free refresh of an expired active
-- CANARY_BILLING envelope through the existing launch-mode authority.

create or replace function public.set_advertising_launch_mode_v2(
  p_launch_mode text,
  p_idempotency_key uuid,
  p_business_account_id uuid default null,
  p_ad_account_id uuid default null,
  p_campaign_id uuid default null,
  p_viewer_user_id uuid default null,
  p_placement_code text default null,
  p_expires_at timestamptz default null,
  p_max_budget_bdag numeric default null,
  p_max_impressions integer default null,
  p_max_spend_bdag numeric default null,
  p_max_billable_events integer default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role text:=coalesce(current_setting('request.jwt.claim.role',true),session_user,current_user);
  v_now timestamptz;
  v_from_mode text;
  v_window_id uuid;
  v_fingerprint text;
  v_existing private.admin_action_audit;
  v_receipt jsonb;
  v_campaign private.advertising_campaigns%rowtype;
  v_finance private.advertising_campaign_finance%rowtype;
  v_policy private.advertising_canary_policy%rowtype;
  v_prior_window private.advertising_billing_authorization_windows%rowtype;
  v_coverage jsonb;
  v_active_refresh boolean:=false;
  v_closed_window_count integer:=0;
begin
  if v_role not in ('service_role','postgres','supabase_admin') then
    raise exception using errcode='42501',message='advertising_internal_authority_required';
  end if;
  if p_launch_mode not in ('DISARMED','CANARY_DELIVERY','CANARY_BILLING','SETTLEMENT_ONLY','PRODUCTION') then
    raise exception using errcode='22023',message='advertising_launch_mode_invalid';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode='22023',message='advertising_idempotency_key_required';
  end if;
  v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object(
    'launch_mode',p_launch_mode,'business_account_id',p_business_account_id,
    'ad_account_id',p_ad_account_id,'campaign_id',p_campaign_id,
    'viewer_user_id',p_viewer_user_id,'placement_code',p_placement_code,
    'expires_at',p_expires_at,'max_budget_bdag',p_max_budget_bdag,
    'max_impressions',p_max_impressions,'max_spend_bdag',p_max_spend_bdag,
    'max_billable_events',p_max_billable_events
  ));

  -- This singleton row is the canonical control-plane serialization point.
  select * into strict v_policy
  from private.advertising_canary_policy
  where singleton
  for update;
  v_now:=clock_timestamp();
  v_from_mode:=v_policy.launch_mode;

  select * into v_existing from private.admin_action_audit
  where idempotency_scope='v1|system|advertising|launch_mode.transition'
    and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';
    end if;
    return (v_existing.metadata->'receipt')||jsonb_build_object('idempotent',true);
  end if;

  if p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING') then
    if p_business_account_id is null or p_ad_account_id is null or p_campaign_id is null
      or p_viewer_user_id is null or p_placement_code is null or p_expires_at is null
      or p_expires_at<=v_now or p_max_budget_bdag is null or p_max_budget_bdag<=0
      or p_max_impressions is null or p_max_impressions<1 then
      raise exception using errcode='22023',message='advertising_canary_launch_target_invalid';
    end if;

    select campaign.* into v_campaign
    from private.advertising_campaigns campaign
    join private.ad_accounts account on account.id=campaign.ad_account_id
    join private.business_accounts business on business.id=account.business_account_id
    where campaign.id=p_campaign_id and account.id=p_ad_account_id
      and business.id=p_business_account_id and business.owner_user_id=p_viewer_user_id
    for update of campaign;
    if not found then
      raise exception using errcode='55000',message='advertising_canary_campaign_not_eligible';
    end if;

    if v_campaign.status='active' then
      if p_launch_mode<>'CANARY_BILLING'
        or v_from_mode<>'CANARY_BILLING'
        or not v_policy.canary_enabled
        or v_policy.expires_at is null
        or v_policy.expires_at>=v_now
        or v_policy.business_account_id is distinct from p_business_account_id
        or v_policy.ad_account_id is distinct from p_ad_account_id
        or v_policy.campaign_id is distinct from p_campaign_id
        or v_policy.viewer_user_id is distinct from p_viewer_user_id
        or v_policy.placement_code is distinct from p_placement_code
        or p_placement_code<>'social_feed'
        or v_policy.max_budget_bdag is distinct from 0.30000000::numeric
        or p_max_budget_bdag is distinct from 0.30000000::numeric
        or v_policy.max_impressions is distinct from 1
        or p_max_impressions is distinct from 1
        or v_policy.max_spend_bdag is distinct from 0.30000000::numeric
        or p_max_spend_bdag is distinct from 0.30000000::numeric
        or v_policy.max_billable_events is distinct from 1
        or p_max_billable_events is distinct from 1
        or p_expires_at>v_now+interval '30 minutes' then
        raise exception using errcode='55000',message='advertising_active_canary_billing_refresh_invalid';
      end if;

      if exists(
        select 1
        from private.advertising_billing_authorization_windows window_row
        where window_row.status='OPEN'
          and window_row.opened_at<=v_now
          and (window_row.expires_at is null or v_now<window_row.expires_at)
      ) then
        raise exception using errcode='55000',message='advertising_active_canary_billing_window_still_valid';
      end if;

      select * into v_prior_window
      from private.advertising_billing_authorization_windows window_row
      where window_row.status='OPEN'
      for update;
      if not found
        or v_prior_window.mode<>'CANARY_BILLING'
        or v_prior_window.scope<>'canary_campaign'
        or v_prior_window.campaign_id is distinct from p_campaign_id
        or v_prior_window.opened_at>v_now
        or v_prior_window.expires_at is null
        or v_prior_window.expires_at>=v_now
        or v_prior_window.expires_at is distinct from v_policy.expires_at
        or v_prior_window.max_spend_bdag is distinct from 0.30000000::numeric
        or v_prior_window.max_billable_events is distinct from 1 then
        raise exception using errcode='55000',message='advertising_active_canary_billing_prior_window_invalid';
      end if;
      v_active_refresh:=true;
    elsif v_campaign.status not in ('draft','paused') then
      raise exception using errcode='55000',message='advertising_canary_campaign_not_eligible';
    end if;

    if p_placement_code<>'social_feed' or not exists(
      select 1
      from private.advertising_ad_sets ad_set
      join private.advertising_placement_selections selection
        on selection.ad_set_id=ad_set.id and selection.status='draft'
      join lateral(
        select version.id
        from private.advertising_placement_selection_versions version
        where version.placement_selection_id=selection.id
        order by version.version_number desc limit 1
      ) latest on true
      join private.advertising_placement_selection_items item
        on item.placement_selection_version_id=latest.id
      where ad_set.campaign_id=p_campaign_id and item.placement_code=p_placement_code
    ) or exists(
      select 1
      from private.advertising_ad_sets ad_set
      join private.advertising_placement_selections selection
        on selection.ad_set_id=ad_set.id and selection.status='draft'
      join lateral(
        select version.id
        from private.advertising_placement_selection_versions version
        where version.placement_selection_id=selection.id
        order by version.version_number desc limit 1
      ) latest on true
      join private.advertising_placement_selection_items item
        on item.placement_selection_version_id=latest.id
      where ad_set.campaign_id=p_campaign_id and item.placement_code<>p_placement_code
    ) then
      raise exception using errcode='22023',message='advertising_canary_placement_invalid';
    end if;

    select * into v_finance from private.advertising_campaign_finance finance
    where finance.campaign_id=p_campaign_id for update;
    if not found or v_finance.budget_bdag<>p_max_budget_bdag
      or v_finance.spent_bdag<>0 or v_finance.released_bdag<>0 then
      raise exception using errcode='55000',message='advertising_canary_finance_invalid';
    end if;

    if v_active_refresh then
      if v_finance.finance_status<>'funded'
        or v_finance.budget_bdag<>0.30000000
        or v_finance.funded_bdag<>0.30000000
        or v_finance.spent_bdag<>0
        or v_finance.released_bdag<>0 then
        raise exception using errcode='55000',message='advertising_active_canary_billing_finance_invalid';
      end if;
      if exists(
        select 1 from private.advertising_events event
        where event.campaign_id=p_campaign_id
      ) or exists(
        select 1 from private.advertising_event_billing_materializations materialization
        where materialization.campaign_id=p_campaign_id
      ) or exists(
        select 1 from private.advertising_financial_events financial_event
        where financial_event.campaign_id=p_campaign_id and financial_event.event_type='spend'
      ) then
        raise exception using errcode='55000',message='advertising_active_canary_billing_evidence_present';
      end if;
      if not exists(
        select 1
        from private.advertising_ad_sets ad_set
        join private.advertising_placement_selections selection
          on selection.ad_set_id=ad_set.id and selection.status='draft'
        join lateral(
          select version.id
          from private.advertising_placement_selection_versions version
          where version.placement_selection_id=selection.id
          order by version.version_number desc limit 1
        ) latest on true
        join private.advertising_placement_selection_items item
          on item.placement_selection_version_id=latest.id
         and item.placement_code=p_placement_code
        where ad_set.campaign_id=p_campaign_id
          and ad_set.starts_at is not null and ad_set.starts_at<=v_now
          and ad_set.ends_at is not null and p_expires_at<=ad_set.ends_at
      ) then
        raise exception using errcode='55000',message='advertising_active_canary_billing_schedule_invalid';
      end if;
    end if;

    if p_launch_mode='CANARY_BILLING' then
      if v_finance.finance_status<>'funded' or p_max_spend_bdag is null or p_max_spend_bdag<=0
        or p_max_spend_bdag>p_max_budget_bdag or p_max_billable_events is null or p_max_billable_events<1 then
        raise exception using errcode='55000',message='advertising_canary_billing_caps_invalid';
      end if;
      v_coverage:=private.advertising_rate_coverage_at(
        'CANARY_BILLING',p_campaign_id,p_placement_code,v_now,p_expires_at
      );
      if not coalesce((v_coverage->>'ready')::boolean,false)
        or coalesce((v_coverage->>'required_count')::integer,0)<>1
        or coalesce((v_coverage->>'covered_count')::integer,0)<>1 then
        raise exception using errcode='55000',message='advertising_canary_billing_rate_coverage_incomplete';
      end if;
    elsif p_max_spend_bdag is not null or p_max_billable_events is not null then
      raise exception using errcode='22023',message='advertising_delivery_canary_billing_caps_forbidden';
    end if;
  else
    if p_business_account_id is not null or p_ad_account_id is not null or p_campaign_id is not null
      or p_viewer_user_id is not null or p_placement_code is not null or p_expires_at is not null
      or p_max_budget_bdag is not null or p_max_impressions is not null
      or p_max_spend_bdag is not null or p_max_billable_events is not null then
      raise exception using errcode='22023',message='advertising_non_canary_target_forbidden';
    end if;
    if p_launch_mode='PRODUCTION' then
      v_coverage:=private.advertising_rate_coverage_at('PRODUCTION',null,'social_feed',v_now,null);
      if not coalesce((v_coverage->>'ready')::boolean,false) then
        raise exception using errcode='55000',message='advertising_production_rate_coverage_incomplete';
      end if;
    end if;
  end if;

  -- No authorization is closed until every requested transition guard passes.
  update private.advertising_billing_authorization_windows
  set status='CLOSED',closed_at=v_now,updated_at=v_now
  where status='OPEN';
  get diagnostics v_closed_window_count=row_count;
  if v_active_refresh and v_closed_window_count<>1 then
    raise exception using errcode='55000',message='advertising_active_canary_billing_window_close_invalid';
  end if;

  if p_launch_mode='CANARY_BILLING' then
    insert into private.advertising_billing_authorization_windows(
      mode,scope,campaign_id,opened_at,expires_at,max_spend_bdag,max_billable_events
    ) values(
      'CANARY_BILLING','canary_campaign',p_campaign_id,v_now,p_expires_at,p_max_spend_bdag,p_max_billable_events
    ) returning id into v_window_id;
  elsif p_launch_mode='PRODUCTION' then
    insert into private.advertising_billing_authorization_windows(mode,scope,opened_at)
    values('PRODUCTION','global',v_now) returning id into v_window_id;
  end if;

  update private.advertising_finance_policy set
    funding_enabled=p_launch_mode in ('CANARY_DELIVERY','PRODUCTION'),
    spend_enabled=p_launch_mode in ('CANARY_BILLING','PRODUCTION'),
    settlement_enabled=p_launch_mode in ('SETTLEMENT_ONLY','PRODUCTION'),
    updated_at=v_now
  where singleton;
  update private.advertising_campaign_lifecycle_policy set
    activation_enabled=p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING','PRODUCTION'),
    automatic_transitions_enabled=p_launch_mode='PRODUCTION',updated_at=v_now
  where singleton;
  update private.advertising_delivery_policy set
    global_v2_delivery_enabled=p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING','PRODUCTION'),
    updated_at=v_now
  where singleton;
  update private.advertising_placement_catalog set
    v2_delivery_enabled=(
      p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING') and code=p_placement_code
      or p_launch_mode='PRODUCTION' and code='social_feed'
    ),updated_at=v_now;
  update private.advertising_canary_policy set
    launch_mode=p_launch_mode,
    canary_enabled=p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING'),
    business_account_id=case when p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING') then p_business_account_id end,
    ad_account_id=case when p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING') then p_ad_account_id end,
    campaign_id=case when p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING') then p_campaign_id end,
    viewer_user_id=case when p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING') then p_viewer_user_id end,
    placement_code=case when p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING') then p_placement_code end,
    max_budget_bdag=case when p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING') then p_max_budget_bdag end,
    max_impressions=case when p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING') then p_max_impressions end,
    max_spend_bdag=case when p_launch_mode='CANARY_BILLING' then p_max_spend_bdag end,
    max_billable_events=case when p_launch_mode='CANARY_BILLING' then p_max_billable_events end,
    enabled_at=case when p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING') then v_now end,
    expires_at=case when p_launch_mode in ('CANARY_DELIVERY','CANARY_BILLING') then p_expires_at end,
    updated_at=v_now
  where singleton;

  set constraints all immediate;
  v_receipt:=jsonb_strip_nulls(jsonb_build_object(
    'from_mode',v_from_mode,'to_mode',p_launch_mode,'authorization_window_id',v_window_id,
    'campaign_id',p_campaign_id,'placement_code',p_placement_code,'transitioned_at',v_now,
    'opened_at',case when v_window_id is not null then v_now end,
    'expires_at',case when p_launch_mode='CANARY_BILLING' then p_expires_at end,
    'idempotent',false,
    'active_canary_billing_refresh',case when v_active_refresh then true end,
    'prior_authorization_window_id',case when v_active_refresh then v_prior_window.id end,
    'new_authorization_window_id',case when v_active_refresh then v_window_id end,
    'old_expires_at',case when v_active_refresh then v_prior_window.expires_at end,
    'new_expires_at',case when v_active_refresh then p_expires_at end
  ));
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,target_ref,
    outcome,financial_effect,contains_pii,idempotency_scope,idempotency_key,request_fingerprint,metadata
  ) values(
    null,'system_workflow','{}'::text[],null,'advertising',
    'advertising.launch_mode.transition','advertising_control_plane',
    '00000000-0000-0000-0000-000000000009'::uuid,p_launch_mode,'succeeded',true,false,
    'v1|system|advertising|launch_mode.transition',p_idempotency_key,v_fingerprint,
    jsonb_build_object('receipt',v_receipt)
  );
  return v_receipt;
end;
$$;

revoke all on function public.set_advertising_launch_mode_v2(
  text,uuid,uuid,uuid,uuid,uuid,text,timestamptz,numeric,integer,numeric,integer
) from public,anon,authenticated,service_role;
grant execute on function public.set_advertising_launch_mode_v2(
  text,uuid,uuid,uuid,uuid,uuid,text,timestamptz,numeric,integer,numeric,integer
) to service_role;
