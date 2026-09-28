-- ADS-V2-PLR-12: owner-approved Pricing V1 and multi-placement pricing truth.
-- Publishing rates is prospective and does not authorize delivery, billing or Spend.

begin;

do $bootstrap$
declare
  v_published_at timestamptz := pg_catalog.clock_timestamp();
  v_effective_from timestamptz;
  v_metadata jsonb;
  v_fingerprint text;
  v_rate_count integer;
begin
  if (select launch_mode from private.advertising_canary_policy where singleton) <> 'DISARMED'
    or (select canary_enabled from private.advertising_canary_policy where singleton)
    or (select funding_enabled or spend_enabled or settlement_enabled from private.advertising_finance_policy where singleton)
    or (select activation_enabled or automatic_transitions_enabled from private.advertising_campaign_lifecycle_policy where singleton)
    or (select global_v2_delivery_enabled from private.advertising_delivery_policy where singleton)
    or exists(select 1 from private.advertising_placement_catalog where v2_delivery_enabled) then
    raise exception using errcode='55000',message='advertising_pricing_v1_requires_disarmed_control_plane';
  end if;
  if exists(select 1 from private.advertising_billing_authorization_windows where status='OPEN') then
    raise exception using errcode='55000',message='advertising_pricing_v1_open_window_present';
  end if;
  if exists(select 1 from private.advertising_billing_rate_versions) then
    raise exception using errcode='55000',message='advertising_pricing_v1_existing_rate_present';
  end if;
  if exists(select 1 from private.advertising_event_billing_materializations) then
    raise exception using errcode='55000',message='advertising_pricing_v1_materialization_present';
  end if;
  if (select count(*) from private.advertising_placement_catalog) <> 6
    or (select count(*) from private.advertising_placement_catalog where code in (
      'social_feed','clips','stories','live','marketplace_home','marketplace_search'
    )) <> 6 then
    raise exception using errcode='55000',message='advertising_pricing_v1_placement_matrix_invalid';
  end if;
  if (select count(*) from private.advertising_objective_capabilities capability
      join (values
        ('awareness','impression'),('reach','impression'),('video_views','impression'),
        ('traffic','click'),('engagement','click'),('profile_visits','click'),
        ('messages','click'),('app_promotion','click'),('marketplace_sales','click')
      ) expected(objective,billable_event_type)
        on expected.objective=capability.objective
       and expected.billable_event_type=capability.billable_event_type
      where capability.setup_enabled and capability.delivery_runtime_ready and capability.billing_runtime_ready) <> 9
    or exists(
      select 1 from private.advertising_objective_capabilities capability
      where capability.billing_runtime_ready
        and capability.objective not in (
          'awareness','reach','video_views','traffic','engagement','profile_visits',
          'messages','app_promotion','marketplace_sales'
        )
    )
    or not exists(
      select 1 from private.advertising_objective_capabilities capability
      where capability.objective='website_conversions'
        and capability.billing_runtime_ready=false
        and capability.delivery_runtime_ready=false
        and capability.setup_enabled=false
    ) then
    raise exception using errcode='55000',message='advertising_pricing_v1_objective_matrix_invalid';
  end if;

  v_effective_from := pg_catalog.date_trunc('minute',v_published_at)+interval '10 minutes';

  insert into private.advertising_billing_rate_versions(
    objective,billable_event_type,placement_code,rate_bdag,currency,scope,
    scope_campaign_id,state,effective_from,effective_to,created_by,published_by,
    created_at,updated_at,published_at
  )
  select matrix.objective,matrix.billable_event_type,placement.code,matrix.rate_bdag,
    'BDAG','global',null,'published',v_effective_from,null,null,null,
    v_published_at,v_published_at,v_published_at
  from (values
    ('awareness','impression',0.30000000::numeric(20,8)),
    ('reach','impression',0.30000000::numeric(20,8)),
    ('video_views','impression',0.36000000::numeric(20,8)),
    ('traffic','click',36.00000000::numeric(20,8)),
    ('engagement','click',36.00000000::numeric(20,8)),
    ('profile_visits','click',40.00000000::numeric(20,8)),
    ('messages','click',50.00000000::numeric(20,8)),
    ('app_promotion','click',50.00000000::numeric(20,8)),
    ('marketplace_sales','click',45.00000000::numeric(20,8))
  ) matrix(objective,billable_event_type,rate_bdag)
  cross join private.advertising_placement_catalog placement
  where placement.code in ('social_feed','clips','stories','live','marketplace_home','marketplace_search');

  get diagnostics v_rate_count = row_count;
  if v_rate_count <> 54 then
    raise exception using errcode='55000',message='advertising_pricing_v1_rate_count_invalid';
  end if;

  v_metadata := jsonb_build_object(
    'pricing_policy','nelyon-ads-pricing-v1',
    'bdag_per_usd_snapshot',100,
    'commercial_pricing',jsonb_build_object(
      'awareness',jsonb_build_object('unit','CPM','usd',3.00),
      'reach',jsonb_build_object('unit','CPM','usd',3.00),
      'video_views',jsonb_build_object('unit','CPM','usd',3.60),
      'traffic',jsonb_build_object('unit','CPC','usd',0.36),
      'engagement',jsonb_build_object('unit','CPC','usd',0.36),
      'profile_visits',jsonb_build_object('unit','CPC','usd',0.40),
      'messages',jsonb_build_object('unit','CPC','usd',0.50),
      'app_promotion',jsonb_build_object('unit','CPC','usd',0.50),
      'marketplace_sales',jsonb_build_object('unit','CPC','usd',0.45)
    ),
    'published_rate_count',54,
    'placement_count',6,
    'effective_from',v_effective_from,
    'receipt',jsonb_build_object(
      'pricing_policy','nelyon-ads-pricing-v1',
      'published_rate_count',54,
      'effective_from',v_effective_from
    )
  );
  v_fingerprint := private.admin_request_fingerprint(v_metadata);
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,
    target_type,target_id,target_ref,outcome,reason,financial_effect,contains_pii,
    idempotency_scope,idempotency_key,request_fingerprint,metadata
  ) values(
    null,'system_workflow','{}'::text[],null,'advertising','advertising.pricing_v1.bootstrap',
    'advertising_pricing_policy','00000000-0000-0000-0000-000000000012'::uuid,
    'nelyon-ads-pricing-v1','succeeded',null,true,false,
    'v1|system|advertising|pricing_v1.bootstrap',
    '12000000-0000-4000-8000-000000000001'::uuid,v_fingerprint,v_metadata
  );
end;
$bootstrap$;

create or replace function public.get_my_advertising_campaign_billing_v2(p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_campaign private.advertising_campaigns;
  v_finance private.advertising_campaign_finance;
  v_capability private.advertising_objective_capabilities;
  v_pending numeric(20,8);
  v_available numeric(20,8);
  v_now timestamptz:=statement_timestamp();
  v_anomaly text;
  v_placement_rates jsonb:='[]'::jsonb;
  v_selected_count integer:=0;
  v_covered_count integer:=0;
  v_max_rate numeric(20,8);
  v_distinct_rate_terms integer:=0;
  v_representative_rate private.advertising_billing_rate_versions;
  v_rate_status text:='unavailable';
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required';end if;
  select campaign.* into v_campaign
  from private.advertising_campaigns campaign
  join private.ad_accounts account on account.id=campaign.ad_account_id
  join private.business_accounts business on business.id=account.business_account_id
  where campaign.id=p_campaign_id and business.owner_user_id=v_actor;
  if not found then raise exception using errcode='42501',message='advertising_campaign_access_denied';end if;
  select * into strict v_finance from private.advertising_campaign_finance where campaign_id=p_campaign_id;
  select * into strict v_capability from private.advertising_objective_capabilities where objective=v_campaign.objective;
  v_pending:=private.advertising_active_pending_reserved_bdag(p_campaign_id,v_now);
  v_available:=v_finance.funded_bdag-v_finance.spent_bdag-v_finance.released_bdag-v_pending;
  if v_pending>v_finance.funded_bdag-v_finance.spent_bdag-v_finance.released_bdag then
    v_anomaly:='active_pending_reservation_exceeds_available_finance';
  end if;

  with selected_placements as(
    select distinct item.placement_code
    from private.advertising_ad_sets ad_set
    join private.advertising_placement_selections selection on selection.ad_set_id=ad_set.id
    cross join lateral(
      select version.id
      from private.advertising_placement_selection_versions version
      where version.placement_selection_id=selection.id
      order by version.version_number desc,version.created_at desc,version.id desc
      limit 1
    ) latest
    join private.advertising_placement_selection_items item
      on item.placement_selection_version_id=latest.id
    where ad_set.campaign_id=p_campaign_id
  ), resolved as(
    select selected.placement_code,rate.id rate_version_id,rate.rate_bdag,rate.currency,
      rate.billable_event_type,rate.effective_from,rate.effective_to,rate.scope
    from selected_placements selected
    left join lateral(
      select candidate.*
      from private.advertising_billing_rate_versions candidate
      where candidate.objective=v_campaign.objective
        and candidate.billable_event_type=v_capability.billable_event_type
        and candidate.placement_code=selected.placement_code
        and candidate.scope='global' and candidate.scope_campaign_id is null
        and candidate.state='published'
        and candidate.effective_from<=v_now
        and(candidate.effective_to is null or v_now<candidate.effective_to)
      order by candidate.effective_from desc,candidate.id
      limit 1
    ) rate on true
  )
  select count(*),count(rate_version_id),max(rate_bdag),
    count(distinct (rate_bdag,currency,billable_event_type,effective_from,effective_to,scope)),
    coalesce(jsonb_agg(jsonb_build_object(
      'placement_code',placement_code,
      'rate_status',case when rate_version_id is null then 'unavailable' else 'available' end,
      'rate_version_id',rate_version_id,
      'rate_bdag',rate_bdag,
      'currency',currency,
      'billable_event_type',billable_event_type,
      'effective_from',effective_from,
      'effective_to',effective_to
    ) order by placement_code),'[]'::jsonb)
  into v_selected_count,v_covered_count,v_max_rate,v_distinct_rate_terms,v_placement_rates
  from resolved;

  if v_covered_count>0 then
    select rate.* into v_representative_rate
    from private.advertising_billing_rate_versions rate
    join jsonb_array_elements(v_placement_rates) projected
      on projected->>'rate_version_id'=rate.id::text
    order by projected->>'placement_code'
    limit 1;
  end if;
  v_rate_status:=case
    when not v_capability.billing_runtime_ready then 'not_applicable'
    when v_selected_count=0 or v_covered_count=0 then 'unavailable'
    when v_covered_count<v_selected_count then 'partial'
    else 'available'
  end;

  return jsonb_build_object(
    'authority','ads_v2','campaign_id',p_campaign_id,'objective',v_campaign.objective,
    'objective_status',v_capability.status,
    'delivery_runtime_ready',v_capability.delivery_runtime_ready,
    'billing_runtime_ready',v_capability.billing_runtime_ready,
    'conversion_runtime_ready',v_capability.conversion_runtime_ready,
    'billable_event_type',v_capability.billable_event_type,
    'billing_basis',case v_capability.billable_event_type when 'impression' then 'per_impression' when 'click' then 'per_click' else null end,
    'rate_status',v_rate_status,
    'selected_placement_count',v_selected_count,'covered_placement_count',v_covered_count,
    'placement_rates',v_placement_rates,
    'rate_version_id',case when v_selected_count=1 and v_covered_count=1 then v_representative_rate.id end,
    'rate_bdag',case when v_selected_count=v_covered_count and v_distinct_rate_terms=1 then v_representative_rate.rate_bdag end,
    'rate_currency',case when v_selected_count=v_covered_count and v_distinct_rate_terms=1 then v_representative_rate.currency end,
    'rate_scope',case when v_selected_count=v_covered_count and v_distinct_rate_terms=1 then v_representative_rate.scope end,
    'rate_effective_from',case when v_selected_count=v_covered_count and v_distinct_rate_terms=1 then v_representative_rate.effective_from end,
    'rate_effective_to',case when v_selected_count=v_covered_count and v_distinct_rate_terms=1 then v_representative_rate.effective_to end,
    'finance_status',v_finance.finance_status,'budget_bdag',v_finance.budget_bdag,
    'funded_bdag',v_finance.funded_bdag,'spent_bdag',v_finance.spent_bdag,
    'released_bdag',v_finance.released_bdag,'pending_reserved_bdag',v_pending,
    'available_to_reserve_bdag',v_available,
    'reservation_consistent',v_anomaly is null,'anomaly_code',v_anomaly,
    'next_billable_unit_ready',v_anomaly is null and v_rate_status='available'
      and v_finance.finance_status='funded' and v_available>=v_max_rate,
    'next_billable_unit_blocker',case
      when v_anomaly is not null then v_anomaly
      when not v_capability.billing_runtime_ready then 'objective_billing_not_available'
      when v_selected_count=0 then 'campaign_placement_not_selected'
      when v_covered_count<v_selected_count then 'billing_rate_not_available'
      when v_finance.finance_status<>'funded' then 'campaign_finance_not_funded'
      when v_available<v_max_rate then 'campaign_budget_insufficient_for_next_billable_event'
      else null end
  );
end;
$$;

revoke all on function public.get_my_advertising_campaign_billing_v2(uuid)
from public,anon,authenticated,service_role;
grant execute on function public.get_my_advertising_campaign_billing_v2(uuid) to authenticated;

create or replace function public.get_admin_advertising_billing_health()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_launch private.advertising_canary_policy;
  v_now timestamptz:=statement_timestamp();
  v_by_placement jsonb;
  v_required integer;
  v_covered integer;
  v_missing integer;
  v_ready boolean;
begin
  perform public.admin_require_capability('advertising.billing.read');
  select * into strict v_launch from private.advertising_canary_policy where singleton;
  with coverage as(
    select placement.code placement_code,
      private.advertising_rate_coverage_at('PRODUCTION',null,placement.code,v_now,v_now+interval '1 hour') value
    from private.advertising_placement_catalog placement
    where placement.code in ('social_feed','clips','stories','live','marketplace_home','marketplace_search')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'placement_code',placement_code,
      'required_count',(value->>'required_count')::integer,
      'covered_count',(value->>'covered_count')::integer,
      'missing_count',(value->>'missing_count')::integer,
      'ready',(value->>'ready')::boolean
    ) order by placement_code),'[]'::jsonb),
    coalesce(sum((value->>'required_count')::integer),0),
    coalesce(sum((value->>'covered_count')::integer),0),
    coalesce(sum((value->>'missing_count')::integer),0),
    count(*)=6 and coalesce(bool_and((value->>'ready')::boolean),false)
  into v_by_placement,v_required,v_covered,v_missing,v_ready
  from coverage;

  return jsonb_build_object(
    'authority','ads_v2','launch_mode',v_launch.launch_mode,'billing_cutover_at',v_launch.billing_cutover_at,
    'pricing_policy',case when exists(
      select 1 from private.admin_action_audit audit
      where audit.action='advertising.pricing_v1.bootstrap' and audit.outcome='succeeded'
    ) then 'nelyon-ads-pricing-v1' end,
    'production_rate_coverage',jsonb_build_object(
      'required_count',v_required,'covered_count',v_covered,'missing_count',v_missing,'ready',v_ready),
    'production_rate_coverage_by_placement',v_by_placement,
    'production_rate_coverage_ready',v_ready,
    'rate_versions',jsonb_build_object(
      'draft',(select count(*)from private.advertising_billing_rate_versions where state='draft'),
      'published',(select count(*)from private.advertising_billing_rate_versions where state='published'),
      'retired',(select count(*)from private.advertising_billing_rate_versions where state='retired')),
    'authorization_windows',jsonb_build_object(
      'open',(select count(*)from private.advertising_billing_authorization_windows where status='OPEN'),
      'closed',(select count(*)from private.advertising_billing_authorization_windows where status='CLOSED')),
    'materializations',jsonb_build_object(
      'pending',(select count(*)from private.advertising_event_billing_materializations where status='pending'),
      'active_pending',(select count(*)from private.advertising_event_billing_materializations materialization join private.advertising_billing_authorization_windows window_row on window_row.id=materialization.authorization_window_id where materialization.status='pending'and window_row.status='OPEN'and window_row.opened_at<=v_now and(window_row.expires_at is null or v_now<window_row.expires_at)),
      'charged',(select count(*)from private.advertising_event_billing_materializations where status='charged'),
      'budget_exhausted',(select count(*)from private.advertising_event_billing_materializations where status='budget_exhausted'),
      'oldest_pending_at',(select min(created_at)from private.advertising_event_billing_materializations where status='pending')),
    'active_pending_reservation_anomalies',(select count(*)from private.advertising_campaign_finance finance where private.advertising_active_pending_reserved_bdag(finance.campaign_id,v_now)>finance.funded_bdag-finance.spent_bdag-finance.released_bdag),
    'cron_jobs',coalesce((select jsonb_agg(jsonb_build_object('name',jobname,'schedule',schedule,'active',active)order by jobname)from cron.job where jobname in('reconcile-advertising-billable-events-v2','reconcile-advertising-campaign-lifecycle-v2','reconcile-advertising-campaign-settlements-v2')),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_admin_advertising_billing_health()
from public,anon,authenticated,service_role;
grant execute on function public.get_admin_advertising_billing_health() to authenticated;

notify pgrst,'reload schema';

commit;
