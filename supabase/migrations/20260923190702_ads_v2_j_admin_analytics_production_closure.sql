begin;

do $$
begin
  if pg_catalog.to_regclass('private.admin_capabilities') is null
    or pg_catalog.to_regclass('private.admin_role_capabilities') is null
    or pg_catalog.to_regclass('private.advertising_campaigns') is null
    or pg_catalog.to_regclass('private.advertising_finance_policy') is null then
    raise exception 'ads_v2_b_through_i_foundation_required';
  end if;
  if exists (select 1 from private.admin_capabilities where capability_code='advertising.ads.read')
    and not exists (
      select 1 from private.admin_capabilities
      where capability_code='advertising.ads.read' and domain='advertising' and effect='read'
        and description='Read Ads V2 administration and aggregate analytics projections.'
        and is_sensitive
    ) then
    raise exception 'ads_v2_j_capability_conflict';
  end if;
  if exists (
    select 1 from private.admin_role_capabilities
    where capability_code='advertising.ads.read'
      and role_code not in ('SUPER_ADMIN','PLATFORM_ADMIN')
  ) then
    raise exception 'ads_v2_j_capability_role_conflict';
  end if;
end;
$$;

insert into private.admin_capabilities(
  capability_code, domain, effect, description, is_sensitive
) values (
  'advertising.ads.read',
  'advertising',
  'read',
  'Read Ads V2 administration and aggregate analytics projections.',
  true
) on conflict (capability_code) do nothing;

insert into private.admin_role_capabilities(role_code, capability_code) values
  ('SUPER_ADMIN', 'advertising.ads.read'),
  ('PLATFORM_ADMIN', 'advertising.ads.read')
on conflict (role_code,capability_code) do nothing;

-- Keep D's moderation authority and enrich its read projection with canonical,
-- server-derived media URLs so a content moderator can inspect the exact
-- immutable Creative Version before deciding its assembled Ad.
create or replace function public.search_admin_advertising_ads(
  p_review_status text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  perform public.admin_require_capability('content.items.read');
  if p_review_status is not null
    and p_review_status not in ('not_submitted', 'pending', 'approved', 'rejected') then
    raise exception using errcode = '22023', message = 'advertising_ad_review_status_invalid';
  end if;

  return pg_catalog.jsonb_build_object('items', coalesce((
    select pg_catalog.jsonb_agg(item.payload order by item.submitted_at asc nulls last, item.id)
    from (
      select ad.id, ad.submitted_at, pg_catalog.jsonb_build_object(
        'id', ad.id,
        'name', ad.name,
        'status', ad.status,
        'review_status', ad.review_status,
        'submission_fingerprint', ad.submission_fingerprint,
        'submitted_at', ad.submitted_at,
        'reviewed_at', ad.reviewed_at,
        'campaign', pg_catalog.jsonb_build_object(
          'id', campaign.id, 'name', campaign.name, 'objective', campaign.objective
        ),
        'ad_set', pg_catalog.jsonb_build_object('id', ad_set.id, 'name', ad_set.name),
        'business_account_id', business.id,
        'ad_account_id', account.id,
        'creative', pg_catalog.jsonb_build_object(
          'creative_id', creative.id,
          'creative_version_id', version.id,
          'version_number', version.version_number,
          'format', version.format,
          'media_asset_id', version.media_asset_id,
          'video_asset_id', version.video_asset_id,
          'primary_text', version.primary_text,
          'headline', version.headline,
          'description', version.description,
          'call_to_action', version.call_to_action,
          'media_status', coalesce(media.status, video.status),
          'media_mime_type', coalesce(media.mime_type, video.mime_type),
          'preview_url', case
            when version.format='image' and media.status='ready' and media.deleted_at is null
              and media.visibility='public'
              and media.public_url ~* '^https://pub-d146e3d06d274db4871f5b6020fd850f\.r2\.dev(?:/|$)'
              then media.public_url
            when version.format='video' and video.status='ready' and video.deleted_at is null
              and video.thumbnail_url ~* '^https://[a-z0-9-]+\.(cloudflarestream\.com|videodelivery\.net)(?:/|$)'
              then video.thumbnail_url
            else null
          end,
          'playback_url', case
            when version.format='video' and video.status='ready' and video.deleted_at is null
              and video.hls_url ~* '^https://[a-z0-9-]+\.(cloudflarestream\.com|videodelivery\.net)(?:/|$)'
              then video.hls_url
            else null
          end
        ),
        'destination', pg_catalog.jsonb_build_object(
          'id', destination.id,
          'destination_type', destination.destination_type,
          'external_url', destination.external_url,
          'target_user_id', destination.target_user_id,
          'target_business_account_id', destination.target_business_account_id,
          'target_product_id', destination.target_product_id,
          'target_store_id', destination.target_store_id
        ),
        'latest_decision', case when latest.event_type in ('approved', 'rejected') then
          pg_catalog.jsonb_build_object(
            'event_type', latest.event_type,
            'reason_code', latest.reason_code,
            'note', latest.note,
            'actor_user_id', latest.actor_user_id,
            'created_at', latest.created_at
          ) else null end
      ) payload
      from private.advertising_ads as ad
      join private.advertising_ad_sets as ad_set on ad_set.id = ad.ad_set_id
      join private.advertising_campaigns as campaign on campaign.id = ad_set.campaign_id
      join private.ad_accounts as account on account.id = campaign.ad_account_id
      join private.business_accounts as business on business.id = account.business_account_id
      join private.advertising_creative_versions as version on version.id = ad.creative_version_id
      join private.advertising_creatives as creative on creative.id = version.creative_id
      join private.advertising_destinations as destination on destination.id = ad.destination_id
      left join public.media_assets as media on media.id = version.media_asset_id
      left join public.video_assets as video on video.id = version.video_asset_id
      left join lateral (
        select event.* from private.advertising_ad_review_events as event
        where event.ad_id = ad.id
        order by event.created_at desc, event.id desc limit 1
      ) as latest on true
      where p_review_status is null or ad.review_status = p_review_status
      order by ad.submitted_at asc nulls last, ad.id
      limit v_limit
    ) as item
  ), '[]'::jsonb));
end;
$$;

create or replace function public.search_admin_advertising_campaigns(
  p_query text default null,
  p_objective text default null,
  p_status text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := nullif(pg_catalog.btrim(p_query), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_items jsonb;
  v_next jsonb;
begin
  perform public.admin_require_capability('advertising.ads.read');
  if p_objective is not null and p_objective not in (
    'awareness','reach','traffic','engagement','video_views','profile_visits',
    'messages','website_conversions','app_promotion','marketplace_sales'
  ) then
    raise exception using errcode='22023', message='advertising_campaign_objective_invalid';
  end if;
  if p_status is not null and p_status not in ('draft','archived') then
    raise exception using errcode='22023', message='advertising_campaign_status_invalid';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception using errcode='22023', message='advertising_campaign_cursor_invalid';
  end if;
  if v_query is not null and pg_catalog.char_length(v_query) > 120 then
    raise exception using errcode='22023', message='advertising_campaign_query_invalid';
  end if;

  with page as materialized (
    select campaign.id, campaign.created_at,
      pg_catalog.jsonb_build_object(
        'campaign_id', campaign.id,
        'name', campaign.name,
        'objective', campaign.objective,
        'status', campaign.status,
        'created_at', campaign.created_at,
        'business', pg_catalog.jsonb_build_object(
          'business_account_id', business.id,
          'display_name', business.display_name,
          'status', business.status
        ),
        'ad_account', pg_catalog.jsonb_build_object(
          'id', account.id,
          'name', account.name,
          'status', account.status
        ),
        'counts', pg_catalog.jsonb_build_object(
          'ad_sets', (select count(*) from private.advertising_ad_sets s where s.campaign_id=campaign.id),
          'ads', (select count(*) from private.advertising_ads ad join private.advertising_ad_sets s on s.id=ad.ad_set_id where s.campaign_id=campaign.id),
          'review_pending', (select count(*) from private.advertising_ads ad join private.advertising_ad_sets s on s.id=ad.ad_set_id where s.campaign_id=campaign.id and ad.review_status='pending'),
          'review_approved', (select count(*) from private.advertising_ads ad join private.advertising_ad_sets s on s.id=ad.ad_set_id where s.campaign_id=campaign.id and ad.review_status='approved'),
          'review_rejected', (select count(*) from private.advertising_ads ad join private.advertising_ad_sets s on s.id=ad.ad_set_id where s.campaign_id=campaign.id and ad.review_status='rejected')
        ),
        'finance', case when finance.campaign_id is null then null else pg_catalog.jsonb_build_object(
          'finance_status', finance.finance_status,
          'budget_bdag', finance.budget_bdag,
          'funded_bdag', finance.funded_bdag,
          'spent_bdag', finance.spent_bdag,
          'released_bdag', finance.released_bdag,
          'reserved_bdag', finance.funded_bdag-finance.spent_bdag-finance.released_bdag
        ) end,
        'delivery', pg_catalog.jsonb_build_object(
          'global_enabled', delivery.global_v2_delivery_enabled,
          'campaign_activation_implemented', false
        ),
        'authority', 'ads_v2'
      ) as payload
    from private.advertising_campaigns campaign
    join private.ad_accounts account on account.id=campaign.ad_account_id
    join private.business_accounts business on business.id=account.business_account_id
    left join private.advertising_campaign_finance finance on finance.campaign_id=campaign.id
    cross join private.advertising_delivery_policy delivery
    where delivery.singleton
      and (v_query is null or campaign.name ilike '%'||v_query||'%' or business.display_name ilike '%'||v_query||'%')
      and (p_objective is null or campaign.objective=p_objective)
      and (p_status is null or campaign.status=p_status)
      and (p_cursor_created_at is null or (campaign.created_at,campaign.id)<(p_cursor_created_at,p_cursor_id))
    order by campaign.created_at desc, campaign.id desc
    limit v_limit+1
  ), visible as materialized (
    select * from page order by created_at desc,id desc limit v_limit
  )
  select coalesce(pg_catalog.jsonb_agg(payload order by created_at desc,id desc),'[]'::jsonb),
    case when (select count(*) from page)>v_limit then
      (select pg_catalog.jsonb_build_object('created_at',created_at,'id',id) from visible order by created_at,id limit 1)
    else null end
  into v_items,v_next
  from visible;

  return pg_catalog.jsonb_build_object(
    'items', v_items,
    'next_cursor', v_next,
    'page_size', pg_catalog.jsonb_array_length(v_items),
    'authority', 'ads_v2'
  );
end;
$$;

create or replace function public.get_admin_advertising_campaign_detail(
  p_campaign_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  perform public.admin_require_capability('advertising.ads.read');
  if p_campaign_id is null then
    raise exception using errcode='22023', message='advertising_campaign_id_required';
  end if;

  select pg_catalog.jsonb_build_object(
    'authority','ads_v2',
    'campaign',pg_catalog.jsonb_build_object(
      'id',campaign.id,'name',campaign.name,'objective',campaign.objective,
      'status',campaign.status,'created_at',campaign.created_at,'updated_at',campaign.updated_at
    ),
    'business',pg_catalog.jsonb_build_object(
      'business_account_id',business.id,'display_name',business.display_name,'status',business.status
    ),
    'ad_account',pg_catalog.jsonb_build_object('id',account.id,'name',account.name,'status',account.status),
    'ad_sets',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',ad_set.id,'name',ad_set.name,'status',ad_set.status,
        'starts_at',ad_set.starts_at,'ends_at',ad_set.ends_at,
        'audience',case when audience.id is null then null else pg_catalog.jsonb_build_object(
          'id',audience.id,'status',audience.status,'latest_version_number',audience_version.version_number,
          'age_scope',audience_version.age_scope,'geo_target_count',audience_version.geo_count,
          'language_target_count',audience_version.language_count,
          'daypart_window_count',audience_version.daypart_count,
          'frequency_configured',audience_version.frequency_configured
        ) end,
        'placements',case when selection.id is null then null else pg_catalog.jsonb_build_object(
          'id',selection.id,'status',selection.status,'latest_version_number',selection_version.version_number,
          'codes',selection_version.codes
        ) end
      ) order by ad_set.created_at,ad_set.id)
      from private.advertising_ad_sets ad_set
      left join private.advertising_audiences audience on audience.ad_set_id=ad_set.id
      left join lateral (
        select version.version_number,version.age_scope,
          (select count(*) from private.advertising_geo_targets g where g.audience_version_id=version.id) geo_count,
          (select count(*) from private.advertising_language_targets l where l.audience_version_id=version.id) language_count,
          (select count(*) from private.advertising_daypart_windows d where d.audience_version_id=version.id) daypart_count,
          exists(select 1 from private.advertising_frequency_policies f where f.audience_version_id=version.id) frequency_configured
        from private.advertising_audience_versions version
        where version.audience_id=audience.id order by version.version_number desc limit 1
      ) audience_version on true
      left join private.advertising_placement_selections selection on selection.ad_set_id=ad_set.id
      left join lateral (
        select version.version_number,coalesce((
          select pg_catalog.jsonb_agg(item.placement_code order by item.placement_code)
          from private.advertising_placement_selection_items item where item.placement_selection_version_id=version.id
        ),'[]'::jsonb) codes
        from private.advertising_placement_selection_versions version
        where version.placement_selection_id=selection.id order by version.version_number desc limit 1
      ) selection_version on true
      where ad_set.campaign_id=campaign.id
    ),'[]'::jsonb),
    'destinations',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',destination.id,'destination_type',destination.destination_type,
        'external_url',destination.external_url,'target_user_id',destination.target_user_id,
        'target_business_account_id',destination.target_business_account_id,
        'target_product_id',destination.target_product_id,'target_store_id',destination.target_store_id,
        'status',destination.status
      ) order by destination.created_at,destination.id)
      from private.advertising_destinations destination where destination.campaign_id=campaign.id
    ),'[]'::jsonb),
    'ads',coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',ad.id,'name',ad.name,'ad_set_id',ad.ad_set_id,'status',ad.status,
        'review_status',ad.review_status,'submitted_at',ad.submitted_at,'reviewed_at',ad.reviewed_at,
        'creative',pg_catalog.jsonb_build_object(
          'creative_id',creative.id,'name',creative.name,'status',creative.status,
          'creative_version_id',version.id,'version_number',version.version_number,'format',version.format,
          'primary_text',version.primary_text,'headline',version.headline,'description',version.description,
          'call_to_action',version.call_to_action,'media_asset_id',version.media_asset_id,'video_asset_id',version.video_asset_id
        ),
        'destination_id',ad.destination_id,
        'latest_review',case when decision.event_type is null then null else pg_catalog.jsonb_build_object(
          'event_type',decision.event_type,'reason_code',decision.reason_code,'created_at',decision.created_at
        ) end
      ) order by ad.created_at,ad.id)
      from private.advertising_ads ad
      join private.advertising_ad_sets ad_set on ad_set.id=ad.ad_set_id
      join private.advertising_creative_versions version on version.id=ad.creative_version_id
      join private.advertising_creatives creative on creative.id=version.creative_id
      left join lateral (
        select event.event_type,event.reason_code,event.created_at
        from private.advertising_ad_review_events event
        where event.ad_id=ad.id and event.event_type in ('approved','rejected')
        order by event.created_at desc,event.id desc limit 1
      ) decision on true
      where ad_set.campaign_id=campaign.id
    ),'[]'::jsonb),
    'finance',case when finance.campaign_id is null then null else pg_catalog.jsonb_build_object(
      'currency',finance.currency,'budget_bdag',finance.budget_bdag,'finance_status',finance.finance_status,
      'funded_bdag',finance.funded_bdag,'spent_bdag',finance.spent_bdag,'released_bdag',finance.released_bdag,
      'reserved_bdag',finance.funded_bdag-finance.spent_bdag-finance.released_bdag,
      'funded_at',finance.funded_at,'settled_at',finance.settled_at
    ) end,
    'analytics',pg_catalog.jsonb_build_object(
      'impressions',(select count(*) from private.advertising_events event where event.campaign_id=campaign.id and event.event_type='impression'),
      'clicks',(select count(*) from private.advertising_events event where event.campaign_id=campaign.id and event.event_type='click'),
      'conversions',(select count(*) from private.advertising_attributions attribution where attribution.campaign_id=campaign.id),
      'marketplace_purchase_value_bdag',coalesce((select sum(conversion.value_bdag) from private.advertising_attributions attribution join private.advertising_conversions conversion on conversion.id=attribution.conversion_id where attribution.campaign_id=campaign.id and conversion.conversion_type='marketplace_purchase'),0::numeric)
    ),
    'readiness',pg_catalog.jsonb_build_object(
      'campaign_activation_implemented',false,
      'global_delivery_enabled',delivery.global_v2_delivery_enabled,
      'enabled_placement_count',(select count(*) from private.advertising_placement_catalog where v2_delivery_enabled),
      'funding_enabled',finance_policy.funding_enabled,
      'spend_enabled',finance_policy.spend_enabled,
      'settlement_enabled',finance_policy.settlement_enabled
    )
  ) into v_result
  from private.advertising_campaigns campaign
  join private.ad_accounts account on account.id=campaign.ad_account_id
  join private.business_accounts business on business.id=account.business_account_id
  left join private.advertising_campaign_finance finance on finance.campaign_id=campaign.id
  cross join private.advertising_delivery_policy delivery
  cross join private.advertising_finance_policy finance_policy
  where campaign.id=p_campaign_id and delivery.singleton and finance_policy.singleton;

  if v_result is null then
    raise exception using errcode='22023', message='advertising_campaign_not_found';
  end if;
  return v_result;
end;
$$;

create or replace function public.get_admin_advertising_overview(p_range text default '30d')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_events record;
begin
  perform public.admin_require_capability('advertising.ads.read');
  if p_range is null or p_range not in ('7d','30d','90d','all') then
    raise exception using errcode='22023', message='advertising_overview_range_invalid';
  end if;
  v_from:=case p_range when '7d' then pg_catalog.now()-interval '7 days'
    when '30d' then pg_catalog.now()-interval '30 days'
    when '90d' then pg_catalog.now()-interval '90 days' else '-infinity'::timestamptz end;

  select
    count(*) filter(where event_type='impression') impressions,
    count(*) filter(where event_type='click') clicks,
    count(*) filter(where event_type='destination_open') destination_opens,
    count(*) filter(where event_type='video_view') video_views,
    count(*) filter(where event_type='engagement') engagements
  into v_events from private.advertising_events where occurred_at>=v_from;

  return pg_catalog.jsonb_build_object(
    'authority','ads_v2','range',p_range,'generated_at',pg_catalog.clock_timestamp(),
    'identity',pg_catalog.jsonb_build_object(
      'business_accounts',(select count(*) from private.business_accounts),
      'ad_accounts',(select count(*) from private.ad_accounts)
    ),
    'inventory',pg_catalog.jsonb_build_object(
      'campaigns',(select count(*) from private.advertising_campaigns where created_at>=v_from),
      'ad_sets',(select count(*) from private.advertising_ad_sets where created_at>=v_from),
      'ads',(select count(*) from private.advertising_ads where created_at>=v_from),
      'creatives',(select count(*) from private.advertising_creatives where created_at>=v_from)
    ),
    'review',pg_catalog.jsonb_build_object(
      'not_submitted',(select count(*) from private.advertising_ads where created_at>=v_from and review_status='not_submitted'),
      'pending',(select count(*) from private.advertising_ads where created_at>=v_from and review_status='pending'),
      'approved',(select count(*) from private.advertising_ads where created_at>=v_from and review_status='approved'),
      'rejected',(select count(*) from private.advertising_ads where created_at>=v_from and review_status='rejected')
    ),
    'events',pg_catalog.jsonb_build_object(
      'impressions',v_events.impressions,'clicks',v_events.clicks,
      'destination_opens',v_events.destination_opens,'video_views',v_events.video_views,
      'engagements',v_events.engagements,
      'ctr',case when v_events.impressions=0 then 0 else pg_catalog.round(v_events.clicks::numeric/v_events.impressions::numeric,6) end
    ),
    'conversions',pg_catalog.jsonb_build_object(
      'conversions',(select count(*) from private.advertising_conversions where occurred_at>=v_from),
      'attributions',(select count(*) from private.advertising_attributions where attributed_at>=v_from),
      'marketplace_purchase_value_bdag',coalesce((select sum(value_bdag) from private.advertising_conversions where occurred_at>=v_from and conversion_type='marketplace_purchase'),0::numeric)
    ),
    'finance',(select pg_catalog.jsonb_build_object(
      'campaign_finance_count',count(*),
      'draft_finance_count',count(*) filter(where finance_status='draft'),
      'funded_finance_count',count(*) filter(where finance_status='funded'),
      'settled_finance_count',count(*) filter(where finance_status='settled'),
      'budget_bdag',coalesce(sum(budget_bdag),0::numeric),
      'funded_bdag',coalesce(sum(funded_bdag),0::numeric),
      'spent_bdag',coalesce(sum(spent_bdag),0::numeric),
      'released_bdag',coalesce(sum(released_bdag),0::numeric),
      'reserved_bdag',coalesce(sum(funded_bdag-spent_bdag-released_bdag),0::numeric)
    ) from private.advertising_campaign_finance where created_at>=v_from),
    'placements',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'placement_code',metric.placement_code,'impressions',metric.impressions,'clicks',metric.clicks
    ) order by metric.placement_code) from (
      select placement_code,count(*) filter(where event_type='impression') impressions,
        count(*) filter(where event_type='click') clicks
      from private.advertising_events where occurred_at>=v_from group by placement_code
    ) metric),'[]'::jsonb),
    'objectives',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'objective',metric.objective,'campaign_count',metric.campaign_count
    ) order by metric.objective) from (
      select objective,count(*) campaign_count from private.advertising_campaigns
      where created_at>=v_from group by objective
    ) metric),'[]'::jsonb)
  );
end;
$$;

create or replace function public.get_admin_advertising_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_targeting private.advertising_targeting_policy;
  v_delivery private.advertising_delivery_policy;
  v_events private.advertising_event_policy;
  v_finance private.advertising_finance_policy;
  v_age_rows bigint;
  v_adult_eligible_rows bigint;
  v_enabled bigint;
  v_blockers text[] := array['campaign_activation_not_implemented','finance_idempotency_preactivation_hardening_required'];
  v_capability_not_enabled text[] := array[]::text[];
begin
  perform public.admin_require_capability('advertising.ads.read');
  select * into strict v_targeting from private.advertising_targeting_policy where singleton;
  select * into strict v_delivery from private.advertising_delivery_policy where singleton;
  select * into strict v_events from private.advertising_event_policy where singleton;
  select * into strict v_finance from private.advertising_finance_policy where singleton;
  select count(*) into v_age_rows from private.user_age_eligibility;
  select count(*) into v_adult_eligible_rows
  from private.user_age_eligibility eligibility
  join private.age_eligibility_policy policy on policy.singleton
  where eligibility.status='eligible'
    and eligibility.age_band='age_18_plus'
    and eligibility.minimum_age=policy.minimum_age
    and eligibility.policy_version=policy.policy_version
    and eligibility.evaluated_at is not null
    and policy.creator_exclusive_minimum_age=18;
  select count(*) into v_enabled from private.advertising_placement_catalog where v2_delivery_enabled;

  if v_adult_eligible_rows=0 then v_blockers:=pg_catalog.array_append(v_blockers,'age_authority_unavailable'); end if;
  if not v_finance.funding_enabled then v_blockers:=pg_catalog.array_append(v_blockers,'finance_funding_disabled'); end if;
  if not v_finance.spend_enabled then v_blockers:=pg_catalog.array_append(v_blockers,'finance_spend_disabled'); end if;
  if not v_finance.settlement_enabled then v_blockers:=pg_catalog.array_append(v_blockers,'finance_settlement_disabled'); end if;
  if not v_delivery.global_v2_delivery_enabled then v_blockers:=pg_catalog.array_append(v_blockers,'global_delivery_disabled'); end if;
  if v_enabled=0 then v_blockers:=pg_catalog.array_append(v_blockers,'no_v2_placement_enabled'); end if;
  if not v_delivery.geo_matching_enabled then v_capability_not_enabled:=pg_catalog.array_append(v_capability_not_enabled,'geo_matching_disabled'); end if;
  if not v_delivery.language_matching_enabled then v_capability_not_enabled:=pg_catalog.array_append(v_capability_not_enabled,'language_matching_disabled'); end if;

  return pg_catalog.jsonb_build_object(
    'authority','ads_v2','production_delivery_ready',false,
    'blockers',pg_catalog.to_jsonb(v_blockers),
    'capability_not_enabled',pg_catalog.to_jsonb(v_capability_not_enabled),
    'identity',pg_catalog.jsonb_build_object(
      'business_accounts',(select count(*) from private.business_accounts),
      'ad_accounts',(select count(*) from private.ad_accounts)
    ),
    'age',pg_catalog.jsonb_build_object(
      'age_eligibility_rows',v_age_rows,
      'advertiser_eligible_rows',v_adult_eligible_rows,
      'advertiser_eligibility_operational',v_adult_eligible_rows>0
    ),
    'targeting',pg_catalog.jsonb_build_object(
      'targeting_policy_version',v_targeting.policy_version,
      'minor_targeting_allowed',v_targeting.minor_targeting_allowed,
      'interest_targeting_enabled',v_targeting.interest_targeting_enabled,
      'behavioral_targeting_enabled',v_targeting.behavioral_targeting_enabled,
      'custom_audiences_enabled',v_targeting.custom_audiences_enabled,
      'lookalike_targeting_enabled',v_targeting.lookalike_targeting_enabled,
      'sensitive_targeting_allowed',v_targeting.sensitive_targeting_allowed,
      'precise_viewer_location_matching_enabled',v_targeting.precise_viewer_location_matching_enabled
    ),
    'delivery',pg_catalog.jsonb_build_object(
      'delivery_policy_version',v_delivery.policy_version,
      'global_v2_delivery_enabled',v_delivery.global_v2_delivery_enabled,
      'enabled_placement_count',v_enabled,
      'frequency_enforcement_enabled',v_delivery.frequency_enforcement_enabled,
      'geo_matching_enabled',v_delivery.geo_matching_enabled,
      'language_matching_enabled',v_delivery.language_matching_enabled,
      'campaign_activation_implemented',false
    ),
    'events',pg_catalog.jsonb_build_object(
      'event_policy_version',v_events.policy_version,
      'events',(select count(*) from private.advertising_events),
      'conversions',(select count(*) from private.advertising_conversions),
      'attributions',(select count(*) from private.advertising_attributions),
      'anonymous_events_enabled',v_events.anonymous_events_enabled,
      'external_conversion_ingestion_enabled',v_events.external_conversion_ingestion_enabled
    ),
    'finance',pg_catalog.jsonb_build_object(
      'finance_policy_version',v_finance.policy_version,
      'funding_enabled',v_finance.funding_enabled,
      'spend_enabled',v_finance.spend_enabled,
      'settlement_enabled',v_finance.settlement_enabled,
      'campaign_finance_rows',(select count(*) from private.advertising_campaign_finance),
      'financial_event_rows',(select count(*) from private.advertising_financial_events),
      'settlement_rows',(select count(*) from private.advertising_financial_settlements)
    )
  );
end;
$$;

create or replace function public.get_admin_advertising_finance_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_require_capability('finance.reconciliation.read');
  return pg_catalog.jsonb_build_object(
    'authority','ads_v2',
    'reconciliation',public.reconcile_advertising_finance(),
    'shared_legacy_reconciliation',public.reconcile_marketplace_ad_finance(),
    'finalization',public.reconcile_marketplace_ad_finalization(),
    'legacy_events',public.reconcile_marketplace_ad_events()
  );
end;
$$;

comment on function public.search_admin_advertising_campaigns(text,text,text,timestamptz,uuid,integer) is
  'Capability-gated Ads V2 campaign administration search; aggregate and privacy-safe.';
comment on function public.get_admin_advertising_campaign_detail(uuid) is
  'Capability-gated Ads V2 campaign hierarchy and readiness detail without viewer or ledger identity.';
comment on function public.get_admin_advertising_overview(text) is
  'Capability-gated aggregate Ads V2 administration analytics.';
comment on function public.get_admin_advertising_health() is
  'Capability-gated fail-closed Ads V2 pre-launch health projection.';
comment on function public.get_admin_advertising_finance_health() is
  'Finance reconciliation capability wrapper over canonical Ads V2 and legacy reconcilers.';

revoke all on function public.search_admin_advertising_campaigns(text,text,text,timestamptz,uuid,integer)
  from public, anon, authenticated, service_role;
revoke all on function public.get_admin_advertising_campaign_detail(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_admin_advertising_overview(text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_admin_advertising_health()
  from public, anon, authenticated, service_role;
revoke all on function public.get_admin_advertising_finance_health()
  from public, anon, authenticated, service_role;
revoke all on function public.search_admin_advertising_ads(text,integer)
  from public, anon, authenticated, service_role;

grant execute on function public.search_admin_advertising_campaigns(text,text,text,timestamptz,uuid,integer)
  to authenticated;
grant execute on function public.get_admin_advertising_campaign_detail(uuid)
  to authenticated;
grant execute on function public.get_admin_advertising_overview(text)
  to authenticated;
grant execute on function public.get_admin_advertising_health()
  to authenticated;
grant execute on function public.get_admin_advertising_finance_health()
  to authenticated;
grant execute on function public.search_admin_advertising_ads(text,integer)
  to authenticated;

notify pgrst, 'reload schema';

commit;
