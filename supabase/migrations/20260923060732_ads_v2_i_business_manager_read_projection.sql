begin;

create or replace function private.advertising_campaign_result(
  p_campaign_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', campaign.id,
    'ad_account_id', campaign.ad_account_id,
    'business_account_id', account.business_account_id,
    'name', campaign.name,
    'objective', campaign.objective,
    'status', campaign.status,
    'created_at', campaign.created_at,
    'updated_at', campaign.updated_at,
    'archived_at', campaign.archived_at,
    'ad_sets', (
      select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', ad_set.id,
          'name', ad_set.name,
          'status', ad_set.status,
          'starts_at', ad_set.starts_at,
          'ends_at', ad_set.ends_at,
          'created_at', ad_set.created_at,
          'audience', case when audience.id is null then null else pg_catalog.jsonb_build_object(
            'id', audience.id,
            'status', audience.status,
            'latest_version_number', audience_version.version_number
          ) end,
          'placement_selection', case when placement_selection.id is null then null else pg_catalog.jsonb_build_object(
            'id', placement_selection.id,
            'status', placement_selection.status,
            'latest_version_number', placement_version.version_number
          ) end
        ) order by ad_set.created_at, ad_set.id
      ), '[]'::jsonb)
      from private.advertising_ad_sets as ad_set
      left join private.advertising_audiences as audience
        on audience.ad_set_id = ad_set.id
      left join lateral (
        select version.version_number
        from private.advertising_audience_versions as version
        where version.audience_id = audience.id
        order by version.version_number desc
        limit 1
      ) as audience_version on true
      left join private.advertising_placement_selections as placement_selection
        on placement_selection.ad_set_id = ad_set.id
      left join lateral (
        select version.version_number
        from private.advertising_placement_selection_versions as version
        where version.placement_selection_id = placement_selection.id
        order by version.version_number desc
        limit 1
      ) as placement_version on true
      where ad_set.campaign_id = campaign.id
    ),
    'destinations', (
      select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', destination.id,
          'destination_type', destination.destination_type,
          'external_url', destination.external_url,
          'target_user_id', destination.target_user_id,
          'target_business_account_id', destination.target_business_account_id,
          'target_product_id', destination.target_product_id,
          'target_store_id', destination.target_store_id,
          'status', destination.status,
          'created_at', destination.created_at
        ) order by destination.created_at, destination.id
      ), '[]'::jsonb)
      from private.advertising_destinations as destination
      where destination.campaign_id = campaign.id
    )
  )
  from private.advertising_campaigns as campaign
  join private.ad_accounts as account on account.id = campaign.ad_account_id
  where campaign.id = p_campaign_id;
$$;

comment on function private.advertising_campaign_result(uuid) is
  'Canonical Ads V2 campaign read model, including server-derived Audience and Placement Selection resume references.';

commit;
