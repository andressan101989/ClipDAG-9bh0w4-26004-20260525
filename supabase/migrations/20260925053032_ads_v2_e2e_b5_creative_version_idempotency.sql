begin;

alter table private.advertising_creative_versions
  add column creation_idempotency_key uuid;

alter table private.advertising_creative_versions
  disable trigger advertising_creative_versions_immutable;

update private.advertising_creative_versions as version
set creation_idempotency_key = case
  when version.version_number = 1 then creative.creation_idempotency_key
  else version.id
end
from private.advertising_creatives as creative
where creative.id = version.creative_id
  and version.creation_idempotency_key is null;

alter table private.advertising_creative_versions
  enable trigger advertising_creative_versions_immutable;

alter table private.advertising_creative_versions
  alter column creation_idempotency_key set not null,
  add constraint advertising_creative_versions_creation_idempotency_unique
    unique (creative_id, creation_idempotency_key);

create or replace function private.ads_creative_result(p_creative_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', creative.id,
    'ad_account_id', creative.ad_account_id,
    'name', creative.name,
    'status', creative.status,
    'created_at', creative.created_at,
    'updated_at', creative.updated_at,
    'versions', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', version.id,
        'version_number', version.version_number,
        'format', version.format,
        'media_asset_id', version.media_asset_id,
        'video_asset_id', version.video_asset_id,
        'primary_text', version.primary_text,
        'headline', version.headline,
        'description', version.description,
        'call_to_action', version.call_to_action,
        'content_fingerprint', version.content_fingerprint,
        'creation_idempotency_key', version.creation_idempotency_key,
        'created_at', version.created_at
      ) order by version.version_number), '[]'::jsonb)
      from private.advertising_creative_versions as version
      where version.creative_id = creative.id
    )
  )
  from private.advertising_creatives as creative
  where creative.id = p_creative_id;
$$;

create or replace function private.ads_ad_result(p_ad_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', ad.id,
    'ad_set_id', ad.ad_set_id,
    'creative_version_id', ad.creative_version_id,
    'destination_id', ad.destination_id,
    'name', ad.name,
    'status', ad.status,
    'review_status', ad.review_status,
    'submission_fingerprint', ad.submission_fingerprint,
    'creation_idempotency_key', ad.creation_idempotency_key,
    'submitted_at', ad.submitted_at,
    'reviewed_at', ad.reviewed_at,
    'created_at', ad.created_at,
    'updated_at', ad.updated_at
  )
  from private.advertising_ads as ad
  where ad.id = p_ad_id;
$$;

create or replace function public.get_my_advertising_creative_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'advertising_auth_required';
  end if;

  return pg_catalog.jsonb_build_object(
    'creatives', coalesce((
      select pg_catalog.jsonb_agg(private.ads_creative_result(creative.id)
        order by creative.created_at desc, creative.id desc)
      from private.advertising_creatives as creative
      join private.ad_accounts as account on account.id = creative.ad_account_id
      join private.business_accounts as business on business.id = account.business_account_id
      where business.owner_user_id = v_actor
    ), '[]'::jsonb),
    'ads', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', ad.id,
        'name', ad.name,
        'campaign_id', campaign.id,
        'ad_set_id', ad.ad_set_id,
        'creative_version_id', ad.creative_version_id,
        'destination_id', ad.destination_id,
        'creation_idempotency_key', ad.creation_idempotency_key,
        'status', ad.status,
        'review_status', ad.review_status,
        'submitted_at', ad.submitted_at,
        'reviewed_at', ad.reviewed_at,
        'latest_rejection_reason_code', rejection.reason_code,
        'latest_rejection_message', case rejection.reason_code
          when 'policy_violation' then 'The ad does not meet advertising policy.'
          when 'misleading' then 'The ad may be misleading.'
          when 'unsafe_destination' then 'The destination could not be approved.'
          when 'prohibited_content' then 'The ad contains prohibited content.'
          when 'restricted_content' then 'The ad contains restricted content.'
          when 'media_invalid' then 'The ad media could not be approved.'
          when 'copy_invalid' then 'The ad copy could not be approved.'
          when 'other' then 'The ad requires changes before it can be approved.'
          else null
        end,
        'created_at', ad.created_at,
        'updated_at', ad.updated_at
      ) order by ad.created_at desc, ad.id desc)
      from private.advertising_ads as ad
      join private.advertising_ad_sets as ad_set on ad_set.id = ad.ad_set_id
      join private.advertising_campaigns as campaign on campaign.id = ad_set.campaign_id
      join private.ad_accounts as account on account.id = campaign.ad_account_id
      join private.business_accounts as business on business.id = account.business_account_id
      left join lateral (
        select event.reason_code
        from private.advertising_ad_review_events as event
        where event.ad_id = ad.id and event.event_type = 'rejected'
        order by event.created_at desc, event.id desc limit 1
      ) as rejection on true
      where business.owner_user_id = v_actor
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.create_my_advertising_creative(
  p_ad_account_id uuid,
  p_name text,
  p_format text,
  p_media_asset_id uuid,
  p_video_asset_id uuid,
  p_primary_text text,
  p_headline text,
  p_description text,
  p_call_to_action text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_name text := btrim(p_name);
  v_format text := lower(btrim(p_format));
  v_call_to_action text := lower(btrim(p_call_to_action));
  v_fingerprint text;
  v_creative private.advertising_creatives;
  v_version private.advertising_creative_versions;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'advertising_auth_required';
  end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_actor) then
    raise exception using errcode = '42501', message = 'advertising_adult_eligibility_required';
  end if;
  if p_ad_account_id is null or p_idempotency_key is null
    or v_name is null or char_length(v_name) not between 2 and 120 then
    raise exception using errcode = '22023', message = 'advertising_creative_input_invalid';
  end if;

  perform 1
  from private.ad_accounts as account
  join private.business_accounts as business on business.id = account.business_account_id
  where account.id = p_ad_account_id
    and account.status = 'active'
    and business.status = 'active'
    and business.owner_user_id = v_actor
  for key share of account, business;
  if not found then
    raise exception using errcode = '42501', message = 'advertising_ad_account_access_denied';
  end if;

  v_fingerprint := private.ads_validate_creative_payload(
    v_actor, v_format, p_media_asset_id, p_video_asset_id,
    p_primary_text, p_headline, p_description, v_call_to_action
  );

  insert into private.advertising_creatives(
    ad_account_id, name, status, created_by, creation_idempotency_key
  ) values (
    p_ad_account_id, v_name, 'draft', v_actor, p_idempotency_key
  )
  on conflict (ad_account_id, creation_idempotency_key) do nothing
  returning * into v_creative;

  if v_creative.id is null then
    select * into v_creative
    from private.advertising_creatives
    where ad_account_id = p_ad_account_id
      and creation_idempotency_key = p_idempotency_key;
    select * into v_version
    from private.advertising_creative_versions
    where creative_id = v_creative.id and version_number = 1;
    if v_creative.name is distinct from v_name
      or v_creative.created_by is distinct from v_actor
      or v_version.content_fingerprint is distinct from v_fingerprint
      or v_version.creation_idempotency_key is distinct from p_idempotency_key then
      raise exception using errcode = '23505', message = 'advertising_creative_idempotency_conflict';
    end if;
    return private.ads_creative_result(v_creative.id);
  end if;

  insert into private.advertising_creative_versions(
    creative_id, version_number, format, media_asset_id, video_asset_id,
    primary_text, headline, description, call_to_action,
    content_fingerprint, created_by, creation_idempotency_key
  ) values (
    v_creative.id, 1, v_format, p_media_asset_id, p_video_asset_id,
    p_primary_text, p_headline, p_description, v_call_to_action,
    v_fingerprint, v_actor, p_idempotency_key
  );
  return private.ads_creative_result(v_creative.id);
end;
$$;

drop function public.create_my_advertising_creative_version(
  uuid, text, uuid, uuid, text, text, text, text
);

create function public.create_my_advertising_creative_version(
  p_creative_id uuid,
  p_format text,
  p_media_asset_id uuid,
  p_video_asset_id uuid,
  p_primary_text text,
  p_headline text,
  p_description text,
  p_call_to_action text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_format text := lower(btrim(p_format));
  v_call_to_action text := lower(btrim(p_call_to_action));
  v_creative private.advertising_creatives;
  v_existing private.advertising_creative_versions;
  v_fingerprint text;
  v_version_number integer;
begin
  if v_actor is null then
    raise exception using errcode = '28000', message = 'advertising_auth_required';
  end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_actor) then
    raise exception using errcode = '42501', message = 'advertising_adult_eligibility_required';
  end if;

  select creative.* into v_creative
  from private.advertising_creatives as creative
  join private.ad_accounts as account on account.id = creative.ad_account_id
  join private.business_accounts as business on business.id = account.business_account_id
  where creative.id = p_creative_id
    and creative.status = 'draft'
    and account.status = 'active'
    and business.status = 'active'
    and business.owner_user_id = v_actor
  for update of creative;
  if not found then
    raise exception using errcode = '42501', message = 'advertising_creative_access_denied';
  end if;

  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'advertising_creative_version_input_invalid';
  end if;

  v_fingerprint := private.ads_content_fingerprint(
    v_format, p_media_asset_id, p_video_asset_id,
    p_primary_text, p_headline, p_description, v_call_to_action
  );

  select version.* into v_existing
  from private.advertising_creative_versions as version
  where version.creative_id = p_creative_id
    and version.creation_idempotency_key = p_idempotency_key;

  if v_existing.id is not null then
    if v_existing.content_fingerprint is distinct from v_fingerprint
      or v_existing.created_by is distinct from v_actor then
      raise exception using errcode = '23505', message = 'advertising_creative_version_idempotency_conflict';
    end if;
    return private.ads_creative_result(p_creative_id);
  end if;

  v_fingerprint := private.ads_validate_creative_payload(
    v_actor, v_format, p_media_asset_id, p_video_asset_id,
    p_primary_text, p_headline, p_description, v_call_to_action
  );

  select coalesce(max(version_number), 0) + 1 into v_version_number
  from private.advertising_creative_versions
  where creative_id = p_creative_id;

  insert into private.advertising_creative_versions(
    creative_id, version_number, format, media_asset_id, video_asset_id,
    primary_text, headline, description, call_to_action,
    content_fingerprint, created_by, creation_idempotency_key
  ) values (
    p_creative_id, v_version_number, v_format, p_media_asset_id, p_video_asset_id,
    p_primary_text, p_headline, p_description, v_call_to_action,
    v_fingerprint, v_actor, p_idempotency_key
  );
  return private.ads_creative_result(p_creative_id);
end;
$$;

revoke all on function public.create_my_advertising_creative(
  uuid, text, text, uuid, uuid, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.create_my_advertising_creative_version(
  uuid, text, uuid, uuid, text, text, text, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.ads_ad_result(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_advertising_creative_workspace()
  from public, anon, authenticated, service_role;

grant execute on function public.create_my_advertising_creative(
  uuid, text, text, uuid, uuid, text, text, text, text, uuid
) to authenticated;
grant execute on function public.create_my_advertising_creative_version(
  uuid, text, uuid, uuid, text, text, text, text, uuid
) to authenticated;
grant execute on function public.get_my_advertising_creative_workspace()
  to authenticated;

comment on column private.advertising_creative_versions.creation_idempotency_key is
  'Stable logical-operation key used to replay immutable Creative Version creation safely.';
comment on function public.create_my_advertising_creative_version(
  uuid, text, uuid, uuid, text, text, text, text, uuid
) is 'Creates one immutable Ads V2 Creative Version with exact replay and conflict detection.';

notify pgrst, 'reload schema';

commit;
