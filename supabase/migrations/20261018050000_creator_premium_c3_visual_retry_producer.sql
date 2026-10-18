begin;

-- A failed asset-level producer must not permanently fence a later retry for
-- the same immutable media asset. Prefer a still-pending, unanalysed scan while
-- preserving the earliest historical producer when every candidate is failed;
-- admin_retry_content_safety_visual depends on that fallback. Provider/model,
-- prompt and full asset identity remain part of the canonical boundary.
create or replace function private.content_safety_visual_producer_scan_id(
  p_video_asset_id uuid,
  p_media_asset_id uuid
)
returns uuid
language sql
stable
security definer
set search_path=''
as $$
  select scan.id
  from private.content_safety_scans scan
  where scan.target_type in('video','creator_premium')
    and scan.visual_provider='cloudflare_workers_ai'
    and scan.visual_model='@cf/google/gemma-4-26b-a4b-it'
    and scan.visual_prompt_version='visual-safety-v1'
    and (
      (p_media_asset_id is not null
        and scan.visual_media_asset_id=p_media_asset_id
        and scan.visual_source_kind='eligible_image')
      or
      (p_video_asset_id is not null
        and scan.visual_video_asset_id=p_video_asset_id
        and scan.visual_source_kind='eligible_stream_video')
    )
  order by
    case when scan.visual_status='pending' and scan.visual_analysis_id is null then 0 else 1 end,
    scan.created_at,
    scan.id
  limit 1;
$$;

comment on function private.content_safety_visual_producer_scan_id(uuid,uuid) is
  'Prefers the earliest pending canonical scan for an immutable asset, then falls back to the earliest historical producer so audited admin retry remains available. Analyzed assets remain governed by content_safety_visual_analysis_id_for_asset.';

commit;
