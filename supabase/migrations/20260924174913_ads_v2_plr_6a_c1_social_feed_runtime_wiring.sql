begin;

do $$
begin
  if pg_catalog.to_regprocedure('private.advertising_delivery_preflight_at(uuid,text,uuid,timestamp with time zone)') is null
    or pg_catalog.to_regprocedure('public.fetch_advertising_delivery_candidates_v2(text,uuid,integer,timestamp with time zone)') is null
    or pg_catalog.to_regprocedure('public.record_advertising_impression_v2(uuid,text,uuid,uuid)') is null then
    raise exception 'ads_v2_plr_4_delivery_foundation_required';
  end if;
  if pg_catalog.to_regprocedure('public.get_advertising_delivery_render_payload_v2(uuid,text,uuid)') is not null then
    raise exception 'ads_v2_delivery_render_projection_conflict';
  end if;
end;
$$;

create or replace function public.get_advertising_delivery_render_payload_v2(
  p_ad_id uuid,
  p_placement_code text,
  p_viewer_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_preflight jsonb;
  v_payload jsonb;
begin
  if p_ad_id is null or p_viewer_user_id is null then
    raise exception using errcode = '22023', message = 'advertising_delivery_render_input_invalid';
  end if;
  if p_placement_code is distinct from 'social_feed' then
    raise exception using errcode = '22023', message = 'advertising_delivery_render_placement_invalid';
  end if;

  v_preflight := private.advertising_delivery_preflight_at(
    p_ad_id,
    p_placement_code,
    p_viewer_user_id,
    pg_catalog.clock_timestamp()
  );
  if not coalesce((v_preflight ->> 'production_deliverable')::boolean, false) then
    return null;
  end if;

  select pg_catalog.jsonb_build_object(
    'ad_id', ad.id,
    'advertiser', pg_catalog.jsonb_build_object(
      'business_account_id', business.id,
      'display_name', business.display_name
    ),
    'creative', pg_catalog.jsonb_build_object(
      'format', version.format,
      'primary_text', version.primary_text,
      'headline', version.headline,
      'description', version.description,
      'call_to_action', version.call_to_action,
      'media', pg_catalog.jsonb_build_object(
        'kind', version.format,
        'url', case when version.format = 'image' then media.public_url else video.hls_url end,
        'thumbnail_url', case when version.format = 'video' then video.thumbnail_url else null end
      )
    ),
    'destination', pg_catalog.jsonb_build_object(
      'destination_type', destination.destination_type,
      'external_url', destination.external_url,
      'target_user_id', destination.target_user_id,
      'target_business_account_id', destination.target_business_account_id,
      'target_product_id', destination.target_product_id,
      'target_store_id', destination.target_store_id
    )
  )
  into v_payload
  from private.advertising_ads ad
  join private.advertising_ad_sets ad_set on ad_set.id = ad.ad_set_id
  join private.advertising_campaigns campaign on campaign.id = ad_set.campaign_id
  join private.ad_accounts account on account.id = campaign.ad_account_id
  join private.business_accounts business on business.id = account.business_account_id
  join private.advertising_creative_versions version on version.id = ad.creative_version_id
  join private.advertising_destinations destination on destination.id = ad.destination_id
  left join public.media_assets media on media.id = version.media_asset_id
  left join public.video_assets video on video.id = version.video_asset_id
  where ad.id = p_ad_id
    and (
      (
        version.format = 'image'
        and media.status = 'ready'
        and media.deleted_at is null
        and media.provider = 'r2'
        and media.visibility = 'public'
        and media.purpose = 'business_library'
        and media.public_url ~* '^https://pub-d146e3d06d274db4871f5b6020fd850f\.r2\.dev(?:/|$)'
      )
      or
      (
        version.format = 'video'
        and video.status = 'ready'
        and video.deleted_at is null
        and video.provider = 'cloudflare_stream'
        and video.visibility = 'public'
        and video.purpose = 'business_library'
        and video.hls_url ~* '^https://[a-z0-9-]+\.(cloudflarestream\.com|videodelivery\.net)(?:/|$)'
        and (
          video.thumbnail_url is null
          or video.thumbnail_url ~* '^https://[a-z0-9-]+\.(cloudflarestream\.com|videodelivery\.net)(?:/|$)'
        )
      )
    );

  return v_payload;
end;
$$;

comment on function public.get_advertising_delivery_render_payload_v2(uuid,text,uuid) is
  'Service-only, preflight-gated Ads V2 render projection for the canonical social_feed runtime.';

revoke all on function public.get_advertising_delivery_render_payload_v2(uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.get_advertising_delivery_render_payload_v2(uuid,text,uuid)
  to service_role;

commit;
