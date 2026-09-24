begin;

do $$
begin
  if pg_catalog.to_regclass('private.advertising_campaigns') is null
    or pg_catalog.to_regclass('private.advertising_campaign_finance') is null
    or pg_catalog.to_regclass('private.advertising_ads') is null
    or pg_catalog.to_regclass('private.advertising_placement_catalog') is null then
    raise exception 'ads_v2_plr_2_foundation_required';
  end if;
  if pg_catalog.to_regclass('private.advertising_campaign_lifecycle_policy') is not null
    or pg_catalog.to_regclass('private.advertising_campaign_lifecycle_events') is not null then
    raise exception 'ads_v2_campaign_lifecycle_authority_conflict';
  end if;
end;
$$;

create table private.advertising_campaign_lifecycle_policy (
  singleton boolean primary key default true check(singleton),
  policy_version text not null,
  activation_enabled boolean not null default false,
  automatic_transitions_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advertising_campaign_lifecycle_policy_version_chk check(
    policy_version ~ '^nelyon-ads-campaign-lifecycle-v[0-9]+$'
  ),
  constraint advertising_campaign_lifecycle_policy_v1_safe_chk check(
    policy_version<>'nelyon-ads-campaign-lifecycle-v1'
    or (not activation_enabled and not automatic_transitions_enabled)
  )
);

insert into private.advertising_campaign_lifecycle_policy(
  singleton,policy_version,activation_enabled,automatic_transitions_enabled
) values (true,'nelyon-ads-campaign-lifecycle-v1',false,false);

create table private.advertising_campaign_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references private.advertising_campaigns(id),
  action text not null check(action in ('activate','pause','resume','complete','cancel')),
  from_status text not null check(from_status in ('draft','scheduled','active','paused','completed','cancelled','archived')),
  to_status text not null check(to_status in ('draft','scheduled','active','paused','completed','cancelled','archived')),
  actor_user_id uuid references auth.users(id) on delete set null,
  source text not null check(source in ('owner','service')),
  idempotency_key uuid,
  reason_code text check(reason_code is null or (reason_code=btrim(reason_code) and char_length(reason_code) between 2 and 120)),
  occurred_at timestamptz not null default clock_timestamp(),
  constraint advertising_campaign_lifecycle_events_owner_shape_chk check(
    (source='owner' and actor_user_id is not null and idempotency_key is not null)
    or (source='service' and actor_user_id is null and idempotency_key is null)
  ),
  constraint advertising_campaign_lifecycle_events_transition_chk check(
    (action='activate' and (
      (from_status='draft' and to_status in ('scheduled','active'))
      or (source='service' and from_status='scheduled' and to_status='active')
    ))
    or (action='pause' and from_status in ('scheduled','active') and to_status='paused')
    or (action='resume' and from_status='paused' and to_status in ('scheduled','active'))
    or (action='complete' and from_status in ('scheduled','active','paused') and to_status='completed')
    or (action='cancel' and from_status in ('draft','scheduled','active','paused') and to_status='cancelled')
  )
);

create unique index advertising_campaign_lifecycle_events_idempotency_idx
  on private.advertising_campaign_lifecycle_events(idempotency_key)
  where idempotency_key is not null;
create index advertising_campaign_lifecycle_events_campaign_occurred_idx
  on private.advertising_campaign_lifecycle_events(campaign_id,occurred_at desc,id desc);
create index advertising_campaign_lifecycle_events_actor_idx
  on private.advertising_campaign_lifecycle_events(actor_user_id)
  where actor_user_id is not null;

alter table private.advertising_campaign_lifecycle_policy enable row level security;
alter table private.advertising_campaign_lifecycle_policy force row level security;
alter table private.advertising_campaign_lifecycle_events enable row level security;
alter table private.advertising_campaign_lifecycle_events force row level security;

create policy advertising_campaign_lifecycle_policy_deny_clients
  on private.advertising_campaign_lifecycle_policy as restrictive for all
  to anon,authenticated using(false) with check(false);
create policy advertising_campaign_lifecycle_events_deny_clients
  on private.advertising_campaign_lifecycle_events as restrictive for all
  to anon,authenticated using(false) with check(false);

revoke all on table private.advertising_campaign_lifecycle_policy from public,anon,authenticated,service_role;
revoke all on table private.advertising_campaign_lifecycle_events from public,anon,authenticated,service_role;

create or replace function private.advertising_campaign_lifecycle_events_immutable()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception using errcode='55000',message='advertising_campaign_lifecycle_events_immutable';
end;
$$;

create trigger advertising_campaign_lifecycle_events_immutable_guard
before update or delete on private.advertising_campaign_lifecycle_events
for each row execute function private.advertising_campaign_lifecycle_events_immutable();

alter table private.advertising_campaigns
  drop constraint advertising_campaigns_status_chk,
  drop constraint advertising_campaigns_archive_state_chk;

alter table private.advertising_campaigns
  add constraint advertising_campaigns_status_chk check(
    status in ('draft','scheduled','active','paused','completed','cancelled','archived')
  ),
  add constraint advertising_campaigns_archive_state_chk check(
    (status='archived' and archived_at is not null)
    or (status<>'archived' and archived_at is null)
  );

create or replace function private.advertising_campaign_operational_readiness_at(
  p_campaign_id uuid,
  p_at_time timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_at_time timestamptz:=coalesce(p_at_time,pg_catalog.now());
  v_campaign record;
  v_finance private.advertising_campaign_finance;
  v_delivery private.advertising_delivery_policy;
  v_ad_set private.advertising_ad_sets;
  v_ad record;
  v_audience_version uuid;
  v_selection_version uuid;
  v_blockers text[]:=array[]::text[];
  v_candidate_blockers text[]:=array[]::text[];
  v_set_ready boolean;
  v_media_ready boolean;
  v_ready_ad_count integer:=0;
  v_current_window_count integer:=0;
  v_future_window_count integer:=0;
  v_target_status text;
  v_finance_ready boolean:=false;
  v_age_ready boolean:=false;
  v_structurally_ready boolean:=false;
begin
  select campaign.id,campaign.status,account.id account_id,account.status account_status,
    business.id business_id,business.status business_status,business.owner_user_id
  into v_campaign
  from private.advertising_campaigns campaign
  join private.ad_accounts account on account.id=campaign.ad_account_id
  join private.business_accounts business on business.id=account.business_account_id
  where campaign.id=p_campaign_id;
  if not found then
    return pg_catalog.jsonb_build_object(
      'campaign_id',p_campaign_id,'structurally_ready',false,'target_status',null,
      'blockers',pg_catalog.jsonb_build_array('campaign_not_found'),'ready_ad_count',0,
      'current_window_ad_set_count',0,'future_window_ad_set_count',0,
      'finance_ready',false,'advertiser_age_ready',false
    );
  end if;

  select * into strict v_delivery from private.advertising_delivery_policy where singleton;
  if v_campaign.business_status<>'active' then v_blockers:=pg_catalog.array_append(v_blockers,'business_inactive'); end if;
  if v_campaign.account_status<>'active' then v_blockers:=pg_catalog.array_append(v_blockers,'ad_account_inactive'); end if;
  v_age_ready:=private.ads_actor_is_advertiser_age_eligible(v_campaign.owner_user_id);
  if not v_age_ready then v_blockers:=pg_catalog.array_append(v_blockers,'advertiser_adult_eligibility_required'); end if;

  select * into v_finance from private.advertising_campaign_finance where campaign_id=p_campaign_id;
  if not found or v_finance.finance_status<>'funded' or v_finance.funded_bdag<=0 then
    v_blockers:=pg_catalog.array_append(v_blockers,'campaign_finance_not_funded');
  elsif v_finance.funded_bdag-v_finance.spent_bdag-v_finance.released_bdag<=0 then
    v_blockers:=pg_catalog.array_append(v_blockers,'campaign_budget_exhausted');
  else
    v_finance_ready:=true;
  end if;

  for v_ad_set in
    select * from private.advertising_ad_sets
    where campaign_id=p_campaign_id and status='draft'
    order by created_at,id
  loop
    v_set_ready:=false;
    v_audience_version:=null;
    v_selection_version:=null;

    select version.id into v_audience_version
    from private.advertising_audiences audience
    join lateral(
      select candidate.id from private.advertising_audience_versions candidate
      where candidate.audience_id=audience.id order by candidate.version_number desc limit 1
    ) version on true
    where audience.ad_set_id=v_ad_set.id and audience.status='draft';
    if v_audience_version is null then
      v_candidate_blockers:=pg_catalog.array_append(v_candidate_blockers,'audience_version_missing');
      continue;
    end if;
    if exists(select 1 from private.advertising_geo_targets where audience_version_id=v_audience_version)
      and not v_delivery.geo_matching_enabled then
      v_candidate_blockers:=pg_catalog.array_append(v_candidate_blockers,'viewer_geo_authority_unavailable');
      continue;
    end if;
    if exists(select 1 from private.advertising_language_targets where audience_version_id=v_audience_version)
      and not v_delivery.language_matching_enabled then
      v_candidate_blockers:=pg_catalog.array_append(v_candidate_blockers,'viewer_language_authority_unavailable');
      continue;
    end if;

    select version.id into v_selection_version
    from private.advertising_placement_selections selection
    join lateral(
      select candidate.id from private.advertising_placement_selection_versions candidate
      where candidate.placement_selection_id=selection.id order by candidate.version_number desc limit 1
    ) version on true
    where selection.ad_set_id=v_ad_set.id and selection.status='draft';
    if v_selection_version is null then
      v_candidate_blockers:=pg_catalog.array_append(v_candidate_blockers,'placement_selection_missing');
      continue;
    end if;
    if not exists(select 1 from private.advertising_placement_selection_items where placement_selection_version_id=v_selection_version)
      or exists(
        select 1 from private.advertising_placement_selection_items item
        left join private.advertising_placement_catalog catalog on catalog.code=item.placement_code
        where item.placement_selection_version_id=v_selection_version
          and (catalog.code is null or catalog.status<>'active' or not catalog.surface_verified or not catalog.v2_delivery_enabled)
      ) then
      v_candidate_blockers:=pg_catalog.array_append(v_candidate_blockers,'placement_v2_delivery_disabled');
      continue;
    end if;

    for v_ad in
      select ad.*,destination.status destination_status,destination.campaign_id destination_campaign_id,
        creative.status creative_status,creative.ad_account_id creative_account_id,
        version.format creative_format,version.media_asset_id,version.video_asset_id
      from private.advertising_ads ad
      join private.advertising_destinations destination on destination.id=ad.destination_id
      join private.advertising_creative_versions version on version.id=ad.creative_version_id
      join private.advertising_creatives creative on creative.id=version.creative_id
      where ad.ad_set_id=v_ad_set.id
      order by ad.created_at,ad.id
    loop
      if v_ad.status<>'draft' or v_ad.review_status<>'approved'
        or v_ad.destination_status<>'draft' or v_ad.creative_status<>'draft'
        or v_ad.destination_campaign_id<>p_campaign_id
        or v_ad.creative_account_id<>v_campaign.account_id then
        continue;
      end if;
      if v_ad.submission_fingerprint is null
        or v_ad.submission_fingerprint is distinct from private.ads_ad_submission_fingerprint(v_ad.id) then
        v_candidate_blockers:=pg_catalog.array_append(v_candidate_blockers,'ad_review_fingerprint_mismatch');
        continue;
      end if;
      v_media_ready:=false;
      if v_ad.creative_format='image' then
        select exists(select 1 from public.media_assets where id=v_ad.media_asset_id and status='ready' and deleted_at is null) into v_media_ready;
      elsif v_ad.creative_format='video' then
        select exists(select 1 from public.video_assets where id=v_ad.video_asset_id and status='ready' and deleted_at is null) into v_media_ready;
      end if;
      if not v_media_ready then
        v_candidate_blockers:=pg_catalog.array_append(v_candidate_blockers,'creative_media_unavailable');
        continue;
      end if;
      v_set_ready:=true;
      v_ready_ad_count:=v_ready_ad_count+1;
    end loop;

    if v_set_ready then
      if v_ad_set.starts_at is null then
        v_current_window_count:=v_current_window_count+1;
      elsif v_ad_set.starts_at<=v_at_time and v_at_time<v_ad_set.ends_at then
        v_current_window_count:=v_current_window_count+1;
      elsif v_ad_set.starts_at>v_at_time then
        v_future_window_count:=v_future_window_count+1;
      end if;
    end if;
  end loop;

  if v_ready_ad_count=0 then
    v_blockers:=v_blockers||v_candidate_blockers;
    v_blockers:=pg_catalog.array_append(v_blockers,'no_operational_ad_set');
  end if;
  if v_current_window_count>0 then
    v_target_status:='active';
  elsif v_future_window_count>0 then
    v_target_status:='scheduled';
  elsif v_ready_ad_count>0 then
    v_blockers:=pg_catalog.array_append(v_blockers,'campaign_schedule_expired');
  end if;

  select not exists(select 1 from pg_catalog.unnest(v_blockers) blocker) and v_target_status is not null
  into v_structurally_ready;
  return pg_catalog.jsonb_build_object(
    'campaign_id',p_campaign_id,'structurally_ready',v_structurally_ready,'target_status',v_target_status,
    'blockers',coalesce((select pg_catalog.jsonb_agg(blocker order by blocker) from(
      select distinct pg_catalog.unnest(v_blockers) blocker
    ) distinct_blockers),'[]'::jsonb),
    'ready_ad_count',v_ready_ad_count,
    'current_window_ad_set_count',v_current_window_count,
    'future_window_ad_set_count',v_future_window_count,
    'finance_ready',v_finance_ready,'advertiser_age_ready',v_age_ready
  );
end;
$$;

create or replace function private.advertising_campaign_result(p_campaign_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'id',campaign.id,'ad_account_id',campaign.ad_account_id,
    'business_account_id',account.business_account_id,'name',campaign.name,
    'objective',campaign.objective,'status',campaign.status,
    'created_at',campaign.created_at,'updated_at',campaign.updated_at,'archived_at',campaign.archived_at,
    'lifecycle',pg_catalog.jsonb_build_object(
      'activation_enabled',lifecycle.activation_enabled,
      'automatic_transitions_enabled',lifecycle.automatic_transitions_enabled,
      'requires_financial_settlement',coalesce(
        campaign.status in ('completed','cancelled') and finance.finance_status='funded'
          and finance.funded_bdag-finance.spent_bdag-finance.released_bdag>0,false
      )
    ),
    'ad_sets',(
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',ad_set.id,'name',ad_set.name,'status',ad_set.status,
        'starts_at',ad_set.starts_at,'ends_at',ad_set.ends_at,'created_at',ad_set.created_at,
        'audience',case when audience.id is null then null else pg_catalog.jsonb_build_object(
          'id',audience.id,'status',audience.status,'latest_version_number',audience_version.version_number
        ) end,
        'placement_selection',case when placement_selection.id is null then null else pg_catalog.jsonb_build_object(
          'id',placement_selection.id,'status',placement_selection.status,'latest_version_number',placement_version.version_number
        ) end
      ) order by ad_set.created_at,ad_set.id),'[]'::jsonb)
      from private.advertising_ad_sets ad_set
      left join private.advertising_audiences audience on audience.ad_set_id=ad_set.id
      left join lateral(
        select version.version_number from private.advertising_audience_versions version
        where version.audience_id=audience.id order by version.version_number desc limit 1
      ) audience_version on true
      left join private.advertising_placement_selections placement_selection on placement_selection.ad_set_id=ad_set.id
      left join lateral(
        select version.version_number from private.advertising_placement_selection_versions version
        where version.placement_selection_id=placement_selection.id order by version.version_number desc limit 1
      ) placement_version on true
      where ad_set.campaign_id=campaign.id
    ),
    'destinations',(
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',destination.id,'destination_type',destination.destination_type,
        'external_url',destination.external_url,'target_user_id',destination.target_user_id,
        'target_business_account_id',destination.target_business_account_id,
        'target_product_id',destination.target_product_id,'target_store_id',destination.target_store_id,
        'status',destination.status,'created_at',destination.created_at
      ) order by destination.created_at,destination.id),'[]'::jsonb)
      from private.advertising_destinations destination where destination.campaign_id=campaign.id
    )
  )
  from private.advertising_campaigns campaign
  join private.ad_accounts account on account.id=campaign.ad_account_id
  cross join private.advertising_campaign_lifecycle_policy lifecycle
  left join private.advertising_campaign_finance finance on finance.campaign_id=campaign.id
  where campaign.id=p_campaign_id and lifecycle.singleton;
$$;

create or replace function public.get_my_advertising_campaign_activation_readiness(p_campaign_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_status text;
  v_policy private.advertising_campaign_lifecycle_policy;
  v_readiness jsonb;
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required'; end if;
  select campaign.status into v_status
  from private.advertising_campaigns campaign
  join private.ad_accounts account on account.id=campaign.ad_account_id
  join private.business_accounts business on business.id=account.business_account_id
  where campaign.id=p_campaign_id and business.owner_user_id=v_actor;
  if not found then raise exception using errcode='42501',message='advertising_campaign_access_denied'; end if;
  select * into strict v_policy from private.advertising_campaign_lifecycle_policy where singleton;
  v_readiness:=private.advertising_campaign_operational_readiness_at(p_campaign_id,pg_catalog.now());
  return v_readiness||pg_catalog.jsonb_build_object(
    'current_status',v_status,'activation_enabled',v_policy.activation_enabled,
    'automatic_transitions_enabled',v_policy.automatic_transitions_enabled
  );
end;
$$;

create or replace function public.activate_my_advertising_campaign_v2(
  p_campaign_id uuid,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_campaign private.advertising_campaigns;
  v_prior private.advertising_campaign_lifecycle_events;
  v_policy private.advertising_campaign_lifecycle_policy;
  v_readiness jsonb;
  v_target text;
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required'; end if;
  if p_campaign_id is null or p_idempotency_key is null then raise exception using errcode='22023',message='advertising_campaign_lifecycle_input_invalid'; end if;
  if not exists(
    select 1 from private.advertising_campaigns campaign
    join private.ad_accounts account on account.id=campaign.ad_account_id
    join private.business_accounts business on business.id=account.business_account_id
    where campaign.id=p_campaign_id and business.owner_user_id=v_actor
  ) then raise exception using errcode='42501',message='advertising_campaign_access_denied'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ads-campaign-lifecycle:'||p_idempotency_key::text,0));
  select * into v_campaign from private.advertising_campaigns where id=p_campaign_id for update;
  select * into v_prior from private.advertising_campaign_lifecycle_events where idempotency_key=p_idempotency_key;
  if found then
    if v_prior.campaign_id<>p_campaign_id or v_prior.action<>'activate' or v_prior.actor_user_id is distinct from v_actor then
      raise exception using errcode='23505',message='advertising_campaign_lifecycle_idempotency_conflict';
    end if;
    return private.advertising_campaign_result(p_campaign_id);
  end if;
  select * into strict v_policy from private.advertising_campaign_lifecycle_policy where singleton;
  if not v_policy.activation_enabled then raise exception using errcode='55000',message='advertising_campaign_activation_disabled'; end if;
  if v_campaign.status<>'draft' then raise exception using errcode='55000',message='advertising_campaign_activation_state_invalid'; end if;
  v_readiness:=private.advertising_campaign_operational_readiness_at(p_campaign_id,pg_catalog.now());
  if not coalesce((v_readiness->>'structurally_ready')::boolean,false) then
    raise exception using errcode='55000',message='advertising_campaign_not_operationally_ready',detail=v_readiness::text;
  end if;
  v_target:=v_readiness->>'target_status';
  update private.advertising_campaigns set status=v_target,updated_at=clock_timestamp() where id=p_campaign_id;
  insert into private.advertising_campaign_lifecycle_events(
    campaign_id,action,from_status,to_status,actor_user_id,source,idempotency_key,reason_code
  ) values(p_campaign_id,'activate','draft',v_target,v_actor,'owner',p_idempotency_key,'owner_activation');
  return private.advertising_campaign_result(p_campaign_id);
end;
$$;

create or replace function public.pause_my_advertising_campaign_v2(
  p_campaign_id uuid,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_campaign private.advertising_campaigns;
  v_prior private.advertising_campaign_lifecycle_events;
  v_from text;
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required'; end if;
  if p_campaign_id is null or p_idempotency_key is null then raise exception using errcode='22023',message='advertising_campaign_lifecycle_input_invalid'; end if;
  if not exists(select 1 from private.advertising_campaigns campaign join private.ad_accounts account on account.id=campaign.ad_account_id join private.business_accounts business on business.id=account.business_account_id where campaign.id=p_campaign_id and business.owner_user_id=v_actor) then
    raise exception using errcode='42501',message='advertising_campaign_access_denied';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ads-campaign-lifecycle:'||p_idempotency_key::text,0));
  select * into v_campaign from private.advertising_campaigns where id=p_campaign_id for update;
  select * into v_prior from private.advertising_campaign_lifecycle_events where idempotency_key=p_idempotency_key;
  if found then
    if v_prior.campaign_id<>p_campaign_id or v_prior.action<>'pause' or v_prior.actor_user_id is distinct from v_actor then raise exception using errcode='23505',message='advertising_campaign_lifecycle_idempotency_conflict'; end if;
    return private.advertising_campaign_result(p_campaign_id);
  end if;
  if v_campaign.status not in ('scheduled','active') then raise exception using errcode='55000',message='advertising_campaign_pause_state_invalid'; end if;
  v_from:=v_campaign.status;
  update private.advertising_campaigns set status='paused',updated_at=clock_timestamp() where id=p_campaign_id;
  insert into private.advertising_campaign_lifecycle_events(campaign_id,action,from_status,to_status,actor_user_id,source,idempotency_key,reason_code)
  values(p_campaign_id,'pause',v_from,'paused',v_actor,'owner',p_idempotency_key,'owner_pause');
  return private.advertising_campaign_result(p_campaign_id);
end;
$$;

create or replace function public.resume_my_advertising_campaign_v2(
  p_campaign_id uuid,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_campaign private.advertising_campaigns;
  v_prior private.advertising_campaign_lifecycle_events;
  v_policy private.advertising_campaign_lifecycle_policy;
  v_readiness jsonb;
  v_target text;
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required'; end if;
  if p_campaign_id is null or p_idempotency_key is null then raise exception using errcode='22023',message='advertising_campaign_lifecycle_input_invalid'; end if;
  if not exists(select 1 from private.advertising_campaigns campaign join private.ad_accounts account on account.id=campaign.ad_account_id join private.business_accounts business on business.id=account.business_account_id where campaign.id=p_campaign_id and business.owner_user_id=v_actor) then
    raise exception using errcode='42501',message='advertising_campaign_access_denied';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ads-campaign-lifecycle:'||p_idempotency_key::text,0));
  select * into v_campaign from private.advertising_campaigns where id=p_campaign_id for update;
  select * into v_prior from private.advertising_campaign_lifecycle_events where idempotency_key=p_idempotency_key;
  if found then
    if v_prior.campaign_id<>p_campaign_id or v_prior.action<>'resume' or v_prior.actor_user_id is distinct from v_actor then raise exception using errcode='23505',message='advertising_campaign_lifecycle_idempotency_conflict'; end if;
    return private.advertising_campaign_result(p_campaign_id);
  end if;
  select * into strict v_policy from private.advertising_campaign_lifecycle_policy where singleton;
  if not v_policy.activation_enabled then raise exception using errcode='55000',message='advertising_campaign_activation_disabled'; end if;
  if v_campaign.status<>'paused' then raise exception using errcode='55000',message='advertising_campaign_resume_state_invalid'; end if;
  v_readiness:=private.advertising_campaign_operational_readiness_at(p_campaign_id,pg_catalog.now());
  if not coalesce((v_readiness->>'structurally_ready')::boolean,false) then raise exception using errcode='55000',message='advertising_campaign_not_operationally_ready',detail=v_readiness::text; end if;
  v_target:=v_readiness->>'target_status';
  update private.advertising_campaigns set status=v_target,updated_at=clock_timestamp() where id=p_campaign_id;
  insert into private.advertising_campaign_lifecycle_events(campaign_id,action,from_status,to_status,actor_user_id,source,idempotency_key,reason_code)
  values(p_campaign_id,'resume','paused',v_target,v_actor,'owner',p_idempotency_key,'owner_resume');
  return private.advertising_campaign_result(p_campaign_id);
end;
$$;

create or replace function public.cancel_my_advertising_campaign_v2(
  p_campaign_id uuid,p_idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_campaign private.advertising_campaigns;
  v_prior private.advertising_campaign_lifecycle_events;
  v_from text;
begin
  if v_actor is null then raise exception using errcode='28000',message='advertising_auth_required'; end if;
  if p_campaign_id is null or p_idempotency_key is null then raise exception using errcode='22023',message='advertising_campaign_lifecycle_input_invalid'; end if;
  if not exists(select 1 from private.advertising_campaigns campaign join private.ad_accounts account on account.id=campaign.ad_account_id join private.business_accounts business on business.id=account.business_account_id where campaign.id=p_campaign_id and business.owner_user_id=v_actor) then
    raise exception using errcode='42501',message='advertising_campaign_access_denied';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ads-campaign-lifecycle:'||p_idempotency_key::text,0));
  select * into v_campaign from private.advertising_campaigns where id=p_campaign_id for update;
  select * into v_prior from private.advertising_campaign_lifecycle_events where idempotency_key=p_idempotency_key;
  if found then
    if v_prior.campaign_id<>p_campaign_id or v_prior.action<>'cancel' or v_prior.actor_user_id is distinct from v_actor then raise exception using errcode='23505',message='advertising_campaign_lifecycle_idempotency_conflict'; end if;
    return private.advertising_campaign_result(p_campaign_id);
  end if;
  if v_campaign.status not in ('draft','scheduled','active','paused') then raise exception using errcode='55000',message='advertising_campaign_cancel_state_invalid'; end if;
  v_from:=v_campaign.status;
  update private.advertising_campaigns set status='cancelled',updated_at=clock_timestamp() where id=p_campaign_id;
  insert into private.advertising_campaign_lifecycle_events(campaign_id,action,from_status,to_status,actor_user_id,source,idempotency_key,reason_code)
  values(p_campaign_id,'cancel',v_from,'cancelled',v_actor,'owner',p_idempotency_key,'owner_cancel');
  return private.advertising_campaign_result(p_campaign_id);
end;
$$;

create or replace function public.reconcile_advertising_campaign_lifecycle(
  p_limit integer default 100,
  p_at_time timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_role text:=coalesce((select auth.role()),'');
  v_policy private.advertising_campaign_lifecycle_policy;
  v_campaign private.advertising_campaigns;
  v_readiness jsonb;
  v_remaining numeric;
  v_processed integer:=0;
  v_activated integer:=0;
  v_completed integer:=0;
  v_reason text;
begin
  if v_role<>'service_role' and session_user not in ('postgres','supabase_admin') then
    raise exception using errcode='42501',message='advertising_campaign_lifecycle_service_required';
  end if;
  if p_limit is null or p_limit<1 or p_limit>500 then raise exception using errcode='22023',message='advertising_campaign_lifecycle_limit_invalid'; end if;
  select * into strict v_policy from private.advertising_campaign_lifecycle_policy where singleton;
  for v_campaign in
    select * from private.advertising_campaigns
    where status in ('scheduled','active','paused')
    order by updated_at,id
    for update skip locked limit p_limit
  loop
    v_processed:=v_processed+1;
    select finance.funded_bdag-finance.spent_bdag-finance.released_bdag
    into v_remaining from private.advertising_campaign_finance finance where finance.campaign_id=v_campaign.id;
    v_readiness:=private.advertising_campaign_operational_readiness_at(v_campaign.id,coalesce(p_at_time,pg_catalog.now()));

    if v_remaining is not null and v_remaining<=0 then
      v_reason:='campaign_budget_exhausted';
    elsif coalesce((v_readiness->>'ready_ad_count')::integer,0)>0
      and coalesce((v_readiness->>'current_window_ad_set_count')::integer,0)=0
      and coalesce((v_readiness->>'future_window_ad_set_count')::integer,0)=0 then
      v_reason:='campaign_schedule_expired';
    else
      v_reason:=null;
    end if;

    if v_reason is not null then
      update private.advertising_campaigns set status='completed',updated_at=clock_timestamp() where id=v_campaign.id;
      insert into private.advertising_campaign_lifecycle_events(
        campaign_id,action,from_status,to_status,actor_user_id,source,idempotency_key,reason_code
      ) values(v_campaign.id,'complete',v_campaign.status,'completed',null,'service',null,v_reason);
      v_completed:=v_completed+1;
    elsif v_campaign.status='scheduled'
      and v_policy.activation_enabled and v_policy.automatic_transitions_enabled
      and coalesce((v_readiness->>'structurally_ready')::boolean,false)
      and v_readiness->>'target_status'='active' then
      update private.advertising_campaigns set status='active',updated_at=clock_timestamp() where id=v_campaign.id;
      insert into private.advertising_campaign_lifecycle_events(
        campaign_id,action,from_status,to_status,actor_user_id,source,idempotency_key,reason_code
      ) values(v_campaign.id,'activate','scheduled','active',null,'service',null,'schedule_window_started');
      v_activated:=v_activated+1;
    end if;
  end loop;
  return pg_catalog.jsonb_build_object(
    'processed',v_processed,'activated',v_activated,'completed',v_completed,
    'activation_enabled',v_policy.activation_enabled,
    'automatic_transitions_enabled',v_policy.automatic_transitions_enabled
  );
end;
$$;

create or replace function private.advertising_delivery_preflight_at(
  p_ad_id uuid,p_placement_code text,p_viewer_user_id uuid,p_at_time timestamptz
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_ad record;
  v_catalog private.advertising_placement_catalog;
  v_policy private.advertising_delivery_policy;
  v_finance private.advertising_campaign_finance;
  v_audience_version uuid;
  v_selection_version uuid;
  v_reasons text[]:=array[]::text[];
  v_structural boolean:=true;
  v_viewer boolean:=true;
  v_media_ready boolean:=false;
  v_frequency private.advertising_frequency_policies;
  v_impression_count bigint;
  v_at_time timestamptz:=coalesce(p_at_time,pg_catalog.now());
  v_production_deliverable boolean:=false;
begin
  select * into strict v_policy from private.advertising_delivery_policy where singleton;
  select ad.id ad_id,ad.status ad_status,ad.review_status,ad.submission_fingerprint,
    ad_set.id ad_set_id,ad_set.status ad_set_status,ad_set.starts_at,ad_set.ends_at,
    campaign.id campaign_id,campaign.status campaign_status,
    account.id account_id,account.status account_status,
    business.id business_id,business.status business_status,business.owner_user_id,
    destination.id destination_id,destination.status destination_status,destination.campaign_id destination_campaign_id,
    version.id creative_version_id,version.format creative_format,version.media_asset_id,version.video_asset_id,
    creative.id creative_id,creative.status creative_status,creative.ad_account_id creative_account_id
  into v_ad
  from private.advertising_ads ad
  join private.advertising_ad_sets ad_set on ad_set.id=ad.ad_set_id
  join private.advertising_campaigns campaign on campaign.id=ad_set.campaign_id
  join private.ad_accounts account on account.id=campaign.ad_account_id
  join private.business_accounts business on business.id=account.business_account_id
  join private.advertising_destinations destination on destination.id=ad.destination_id
  join private.advertising_creative_versions version on version.id=ad.creative_version_id
  join private.advertising_creatives creative on creative.id=version.creative_id
  where ad.id=p_ad_id;
  if not found then
    return pg_catalog.jsonb_build_object('structurally_ready',false,'viewer_match',false,'production_deliverable',false,'reason_codes',pg_catalog.jsonb_build_array('ad_not_found'));
  end if;

  if v_ad.business_status<>'active' then v_reasons:=pg_catalog.array_append(v_reasons,'business_inactive');v_structural:=false;end if;
  if v_ad.account_status<>'active' then v_reasons:=pg_catalog.array_append(v_reasons,'ad_account_inactive');v_structural:=false;end if;
  if not private.ads_actor_is_advertiser_age_eligible(v_ad.owner_user_id) then v_reasons:=pg_catalog.array_append(v_reasons,'advertiser_adult_eligibility_required');v_structural:=false;end if;
  if v_ad.campaign_status<>'active' then
    v_reasons:=pg_catalog.array_append(v_reasons,case v_ad.campaign_status
      when 'paused' then 'campaign_paused' when 'completed' then 'campaign_completed'
      when 'cancelled' then 'campaign_cancelled' when 'archived' then 'campaign_unavailable'
      else 'campaign_not_active' end);
    v_structural:=false;
  end if;
  if v_ad.ad_set_status<>'draft' then v_reasons:=pg_catalog.array_append(v_reasons,'ad_set_unavailable');v_structural:=false;end if;
  if v_ad.starts_at is not null and (v_at_time<v_ad.starts_at or v_at_time>=v_ad.ends_at) then v_reasons:=pg_catalog.array_append(v_reasons,'ad_set_outside_schedule');v_structural:=false;end if;

  select * into v_finance from private.advertising_campaign_finance where campaign_id=v_ad.campaign_id;
  if not found or v_finance.finance_status<>'funded' or v_finance.funded_bdag<=0 then
    v_reasons:=pg_catalog.array_append(v_reasons,'campaign_finance_not_funded');v_structural:=false;
  elsif v_finance.funded_bdag-v_finance.spent_bdag-v_finance.released_bdag<=0 then
    v_reasons:=pg_catalog.array_append(v_reasons,'campaign_budget_exhausted');v_structural:=false;
  end if;

  if v_ad.ad_status<>'draft' then v_reasons:=pg_catalog.array_append(v_reasons,'ad_unavailable');v_structural:=false;end if;
  if not v_policy.require_approved_ad or v_ad.review_status<>'approved' then v_reasons:=pg_catalog.array_append(v_reasons,'ad_not_approved');v_structural:=false;end if;
  if v_ad.review_status='approved' and (v_ad.submission_fingerprint is null or v_ad.submission_fingerprint is distinct from private.ads_ad_submission_fingerprint(v_ad.ad_id)) then
    v_reasons:=pg_catalog.array_append(v_reasons,'ad_review_fingerprint_mismatch');v_structural:=false;
  end if;
  if v_ad.creative_status<>'draft' then v_reasons:=pg_catalog.array_append(v_reasons,'creative_unavailable');v_structural:=false;end if;
  if v_ad.destination_status<>'draft' then v_reasons:=pg_catalog.array_append(v_reasons,'destination_unavailable');v_structural:=false;end if;
  if v_ad.destination_campaign_id<>v_ad.campaign_id or v_ad.creative_account_id<>v_ad.account_id then v_reasons:=pg_catalog.array_append(v_reasons,'same_authority_violation');v_structural:=false;end if;
  if v_ad.creative_format='image' then
    select exists(select 1 from public.media_assets where id=v_ad.media_asset_id and status='ready' and deleted_at is null) into v_media_ready;
  elsif v_ad.creative_format='video' then
    select exists(select 1 from public.video_assets where id=v_ad.video_asset_id and status='ready' and deleted_at is null) into v_media_ready;
  end if;
  if not v_media_ready then v_reasons:=pg_catalog.array_append(v_reasons,'creative_media_unavailable');v_structural:=false;end if;

  select version.id into v_audience_version from private.advertising_audiences audience
  join lateral(select candidate.id from private.advertising_audience_versions candidate where candidate.audience_id=audience.id order by candidate.version_number desc limit 1) version on true
  where audience.ad_set_id=v_ad.ad_set_id and audience.status='draft';
  if v_audience_version is null then v_reasons:=pg_catalog.array_append(v_reasons,'audience_version_missing');v_structural:=false;end if;
  select version.id into v_selection_version from private.advertising_placement_selections selection
  join lateral(select candidate.id from private.advertising_placement_selection_versions candidate where candidate.placement_selection_id=selection.id order by candidate.version_number desc limit 1) version on true
  where selection.ad_set_id=v_ad.ad_set_id and selection.status='draft';
  if v_selection_version is null then v_reasons:=pg_catalog.array_append(v_reasons,'placement_selection_missing');v_structural:=false;end if;

  select * into v_catalog from private.advertising_placement_catalog where code=p_placement_code;
  if not found then v_reasons:=pg_catalog.array_append(v_reasons,'placement_unknown');v_structural:=false;
  else
    if v_catalog.status<>'active' or not v_catalog.surface_verified then v_reasons:=pg_catalog.array_append(v_reasons,'placement_surface_unavailable');v_structural:=false;end if;
    if not v_catalog.v2_delivery_enabled then v_reasons:=pg_catalog.array_append(v_reasons,'placement_v2_delivery_disabled');end if;
  end if;
  if v_selection_version is not null and not exists(select 1 from private.advertising_placement_selection_items where placement_selection_version_id=v_selection_version and placement_code=p_placement_code) then v_reasons:=pg_catalog.array_append(v_reasons,'placement_not_selected');v_structural:=false;end if;

  if v_policy.require_authenticated_viewer and p_viewer_user_id is null then v_reasons:=pg_catalog.array_append(v_reasons,'authenticated_viewer_required');v_viewer:=false;end if;
  if v_policy.require_adult_viewer and not private.ads_delivery_viewer_is_adult(p_viewer_user_id) then v_reasons:=pg_catalog.array_append(v_reasons,'viewer_adult_eligibility_required');v_viewer:=false;end if;
  if v_audience_version is not null then
    if exists(select 1 from private.advertising_geo_targets where audience_version_id=v_audience_version) then v_reasons:=pg_catalog.array_append(v_reasons,'viewer_geo_authority_unavailable');v_viewer:=false;end if;
    if exists(select 1 from private.advertising_language_targets where audience_version_id=v_audience_version) then v_reasons:=pg_catalog.array_append(v_reasons,'viewer_language_authority_unavailable');v_viewer:=false;end if;
    select * into v_frequency from private.advertising_frequency_policies where audience_version_id=v_audience_version;
    if found then
      if not v_policy.frequency_enforcement_enabled then v_reasons:=pg_catalog.array_append(v_reasons,'frequency_enforcement_disabled');v_viewer:=false;
      elsif p_viewer_user_id is null then v_reasons:=pg_catalog.array_append(v_reasons,'authenticated_viewer_required');v_viewer:=false;
      else
        v_impression_count:=private.advertising_impression_count_for_frequency(v_ad.ad_set_id,p_viewer_user_id,v_at_time-pg_catalog.make_interval(hours=>v_frequency.window_hours));
        if v_impression_count>=v_frequency.max_impressions then v_reasons:=pg_catalog.array_append(v_reasons,'frequency_cap_reached');v_viewer:=false;end if;
      end if;
    end if;
    if exists(select 1 from private.advertising_daypart_windows where audience_version_id=v_audience_version)
      and not exists(select 1 from private.advertising_daypart_windows daypart where daypart.audience_version_id=v_audience_version
        and daypart.weekday=extract(isodow from(v_at_time at time zone daypart.timezone_name))::integer
        and (v_at_time at time zone daypart.timezone_name)::time>=daypart.start_local
        and (v_at_time at time zone daypart.timezone_name)::time<daypart.end_local) then
      v_reasons:=pg_catalog.array_append(v_reasons,'outside_daypart');v_viewer:=false;
    end if;
  end if;
  if not v_policy.global_v2_delivery_enabled then v_reasons:=pg_catalog.array_append(v_reasons,'global_delivery_disabled');end if;
  v_production_deliverable:=v_structural and v_viewer and v_policy.global_v2_delivery_enabled
    and coalesce(v_catalog.v2_delivery_enabled,false);
  return pg_catalog.jsonb_build_object(
    'structurally_ready',v_structural,'viewer_match',v_viewer,'production_deliverable',v_production_deliverable,
    'reason_codes',coalesce((select pg_catalog.jsonb_agg(reason order by reason) from(select distinct pg_catalog.unnest(v_reasons) reason) reasons),'[]'::jsonb)
  );
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
  if p_status is not null and p_status not in ('draft','scheduled','active','paused','completed','cancelled','archived') then
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
          'campaign_activation_implemented', true,
          'activation_enabled', lifecycle.activation_enabled
        ),
        'authority', 'ads_v2'
      ) as payload
    from private.advertising_campaigns campaign
    join private.ad_accounts account on account.id=campaign.ad_account_id
    join private.business_accounts business on business.id=account.business_account_id
    left join private.advertising_campaign_finance finance on finance.campaign_id=campaign.id
    cross join private.advertising_delivery_policy delivery
    cross join private.advertising_campaign_lifecycle_policy lifecycle
    where delivery.singleton and lifecycle.singleton
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
      'campaign_activation_implemented',true,
      'activation_enabled',lifecycle.activation_enabled,
      'automatic_transitions_enabled',lifecycle.automatic_transitions_enabled,
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
  cross join private.advertising_campaign_lifecycle_policy lifecycle
  where campaign.id=p_campaign_id and delivery.singleton and finance_policy.singleton and lifecycle.singleton;

  if v_result is null then
    raise exception using errcode='22023', message='advertising_campaign_not_found';
  end if;
  return v_result;
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
  v_lifecycle private.advertising_campaign_lifecycle_policy;
  v_age_rows bigint;
  v_adult_eligible_rows bigint;
  v_enabled bigint;
  v_blockers text[] := array[]::text[];
  v_capability_not_enabled text[] := array[]::text[];
begin
  perform public.admin_require_capability('advertising.ads.read');
  select * into strict v_targeting from private.advertising_targeting_policy where singleton;
  select * into strict v_delivery from private.advertising_delivery_policy where singleton;
  select * into strict v_events from private.advertising_event_policy where singleton;
  select * into strict v_finance from private.advertising_finance_policy where singleton;
  select * into strict v_lifecycle from private.advertising_campaign_lifecycle_policy where singleton;
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

  if not v_lifecycle.activation_enabled then v_blockers:=pg_catalog.array_append(v_blockers,'campaign_activation_disabled'); end if;
  if not v_lifecycle.automatic_transitions_enabled then v_blockers:=pg_catalog.array_append(v_blockers,'campaign_automatic_transitions_disabled'); end if;
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
      'campaign_activation_implemented',true
    ),
    'lifecycle',pg_catalog.jsonb_build_object(
      'policy_version',v_lifecycle.policy_version,
      'activation_enabled',v_lifecycle.activation_enabled,
      'automatic_transitions_enabled',v_lifecycle.automatic_transitions_enabled
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

comment on table private.advertising_campaign_lifecycle_policy is
  'Fail-closed policy for Ads V2 owner activation and automatic lifecycle transitions.';
comment on table private.advertising_campaign_lifecycle_events is
  'Immutable audit history for canonical advertising_campaigns.status transitions.';
comment on function private.advertising_campaign_operational_readiness_at(uuid,timestamptz) is
  'Server-derived activation readiness over canonical identity, age, finance, reviewed assembly, audience, placement and schedule authorities.';
comment on function public.get_my_advertising_campaign_activation_readiness(uuid) is
  'Owner-only safe Campaign activation readiness projection.';
comment on function public.reconcile_advertising_campaign_lifecycle(integer,timestamptz) is
  'Service-only bounded lifecycle transition reconciler; no scheduler is installed by PLR-3.';

revoke all on function private.advertising_campaign_lifecycle_events_immutable() from public,anon,authenticated,service_role;
revoke all on function private.advertising_campaign_operational_readiness_at(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function private.advertising_campaign_result(uuid) from public,anon,authenticated,service_role;
revoke all on function private.advertising_delivery_preflight_at(uuid,text,uuid,timestamptz) from public,anon,authenticated;

revoke all on function public.get_my_advertising_campaign_activation_readiness(uuid) from public,anon,authenticated,service_role;
revoke all on function public.activate_my_advertising_campaign_v2(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.pause_my_advertising_campaign_v2(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.resume_my_advertising_campaign_v2(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.cancel_my_advertising_campaign_v2(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.reconcile_advertising_campaign_lifecycle(integer,timestamptz) from public,anon,authenticated,service_role;

grant execute on function public.get_my_advertising_campaign_activation_readiness(uuid) to authenticated;
grant execute on function public.activate_my_advertising_campaign_v2(uuid,uuid) to authenticated;
grant execute on function public.pause_my_advertising_campaign_v2(uuid,uuid) to authenticated;
grant execute on function public.resume_my_advertising_campaign_v2(uuid,uuid) to authenticated;
grant execute on function public.cancel_my_advertising_campaign_v2(uuid,uuid) to authenticated;
grant execute on function public.reconcile_advertising_campaign_lifecycle(integer,timestamptz) to service_role;

notify pgrst,'reload schema';

commit;
