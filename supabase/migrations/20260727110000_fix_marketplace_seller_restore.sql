begin;

-- Corrective migration applied after MKT-A1. New suspensions rely on the
-- approved-seller public gate and therefore preserve the store lifecycle
-- state. Restoration also repairs stores suspended by the original function.
create or replace function public.set_marketplace_seller_status(
  p_user_id uuid,
  p_status text,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path=public
as $$
declare v_actor uuid:=auth.uid();
begin
  if not public.marketplace_actor_is_admin() then
    raise exception using errcode='42501',message='marketplace_admin_required';
  end if;
  if v_actor is not null and v_actor=p_user_id then
    raise exception using errcode='42501',message='seller_self_moderation_forbidden';
  end if;
  if p_status not in ('approved','rejected','suspended') then
    raise exception using errcode='22023',message='invalid_seller_status';
  end if;

  update public.marketplace_sellers
  set status=p_status,
      approved_at=case when p_status='approved' then now() else approved_at end,
      approved_by=case when p_status='approved' then v_actor else approved_by end,
      suspended_at=case when p_status='suspended' then now() else null end,
      suspension_reason=case
        when p_status in ('rejected','suspended')
          then left(nullif(btrim(p_reason),''),500)
        else null
      end
  where user_id=p_user_id;
  if not found then
    raise exception using errcode='P0002',message='seller_not_found';
  end if;

  -- Do not overwrite marketplace_stores.status. Seller approval is already a
  -- required public/read and mutation gate, so suspension remains immediate.
end;
$$;

create or replace function public.restore_marketplace_seller(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare v_actor uuid:=auth.uid();
begin
  if not public.marketplace_actor_is_admin() then
    raise exception using errcode='42501',message='marketplace_admin_required';
  end if;
  if v_actor is not null and v_actor=p_user_id then
    raise exception using errcode='42501',message='seller_self_moderation_forbidden';
  end if;

  update public.marketplace_sellers
  set status='approved',
      approved_at=coalesce(approved_at,now()),
      approved_by=v_actor,
      suspended_at=null,
      suspension_reason=null
  where user_id=p_user_id and status='suspended';
  if not found then
    raise exception using errcode='P0002',message='suspended_seller_not_found';
  end if;

  -- MKT-A1 had only one primary store and changed it to suspended as a side
  -- effect of seller suspension. Repair that historical state. Product status,
  -- moderation and soft-deletion fields are intentionally untouched.
  update public.marketplace_stores
  set status='active'
  where seller_id=p_user_id and status='suspended';
end;
$$;

revoke all on function public.set_marketplace_seller_status(uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.set_marketplace_seller_status(uuid,text,text)
  to service_role;

revoke all on function public.restore_marketplace_seller(uuid)
  from public,anon;
grant execute on function public.restore_marketplace_seller(uuid)
  to authenticated,service_role;

-- The legacy media URL/product creator remains intentionally unavailable.
revoke execute on function public.create_product_with_media(
  text,text,numeric,text,uuid[],integer,text[]
) from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
