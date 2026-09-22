begin;

create or replace function public.preview_my_advertising_delivery(
  p_ad_id uuid,
  p_placement_code text,
  p_viewer_user_id uuid,
  p_at_time timestamptz
)
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

  if p_viewer_user_id is not null and p_viewer_user_id <> v_actor then
    raise exception using
      errcode = '42501',
      message = 'advertising_delivery_preview_viewer_access_denied';
  end if;

  perform 1
  from private.advertising_ads as ad
  join private.advertising_ad_sets as ad_set on ad_set.id = ad.ad_set_id
  join private.advertising_campaigns as campaign on campaign.id = ad_set.campaign_id
  join private.ad_accounts as account on account.id = campaign.ad_account_id
  join private.business_accounts as business on business.id = account.business_account_id
  where ad.id = p_ad_id
    and business.owner_user_id = v_actor;
  if not found then
    raise exception using errcode = '42501', message = 'advertising_delivery_preview_access_denied';
  end if;

  return private.advertising_delivery_preflight_at(
    p_ad_id,
    p_placement_code,
    v_actor,
    coalesce(p_at_time, now())
  );
end;
$$;

revoke all on function public.preview_my_advertising_delivery(uuid,text,uuid,timestamptz)
  from public, anon;
grant execute on function public.preview_my_advertising_delivery(uuid,text,uuid,timestamptz)
  to authenticated;

commit;
