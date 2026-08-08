begin;

-- Profile edits preserve lifecycle status. Existing destination rules are
-- updated by stable ID; new rules default active and removed rules are deleted.
create or replace function public.upsert_my_marketplace_shipping_profile(
 p_profile_id uuid,p_store_id uuid,p_name text,p_processing_days_min integer,p_processing_days_max integer,
 p_ships_from_country text,p_return_policy_summary text,p_regions jsonb
)returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();result uuid:=coalesce(p_profile_id,gen_random_uuid());r jsonb;
 country text;region text;rule_id uuid;kept_ids uuid[]:='{}';price numeric;threshold numeric;days_min int;days_max int;
begin
 if actor is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
 if not exists(select 1 from public.marketplace_stores s join public.marketplace_sellers ms on ms.user_id=s.seller_id
  where s.id=p_store_id and s.seller_id=actor and s.status='active'and ms.status='approved')then
  raise exception using errcode='42501',message='marketplace_store_inactive';end if;
 country:=upper(btrim(coalesce(p_ships_from_country,'')));
 if not public.marketplace_country_is_valid(country)then
  raise exception using errcode='22023',message='marketplace_shipping_country_invalid';end if;
 if char_length(btrim(coalesce(p_name,'')))not between 2 and 100 or p_processing_days_min not between 0 and 30
  or p_processing_days_max not between p_processing_days_min and 60
  or char_length(btrim(coalesce(p_return_policy_summary,'')))not between 2 and 1000
  or jsonb_typeof(p_regions)<>'array'then
  raise exception using errcode='22023',message='marketplace_invalid_shipping_profile';end if;
 if p_profile_id is not null and not exists(select 1 from public.marketplace_shipping_profiles
  where id=p_profile_id and seller_id=actor and store_id=p_store_id)then
  raise exception using errcode='42501',message='marketplace_shipping_profile_not_owned';end if;
 if p_profile_id is null then
  insert into public.marketplace_shipping_profiles(id,seller_id,store_id,name,processing_days_min,processing_days_max,
   ships_from_country,return_policy_summary,legacy_unrestricted)
  values(result,actor,p_store_id,btrim(p_name),p_processing_days_min,p_processing_days_max,country,btrim(p_return_policy_summary),false);
 else
  update public.marketplace_shipping_profiles set name=btrim(p_name),processing_days_min=p_processing_days_min,
   processing_days_max=p_processing_days_max,ships_from_country=country,return_policy_summary=btrim(p_return_policy_summary),
   legacy_unrestricted=false,updated_at=now()where id=result and seller_id=actor and store_id=p_store_id;
 end if;
 for r in select*from jsonb_array_elements(p_regions)loop
  country:=upper(btrim(coalesce(r->>'country_code','')));
  if not public.marketplace_country_is_valid(country)then
   raise exception using errcode='22023',message='marketplace_shipping_country_invalid';end if;
  region:=case when nullif(btrim(coalesce(r->>'region_code','')),'')is null then null
   else public.marketplace_normalize_shipping_region(country,r->>'region_code')end;
  if coalesce(r->>'shipping_price','')!~'^[0-9]+([.][0-9]+)?$'
   or coalesce(r->>'transit_days_min','')!~'^[0-9]+$'or coalesce(r->>'transit_days_max','')!~'^[0-9]+$'
   or(nullif(r->>'free_shipping_threshold','')is not null and(r->>'free_shipping_threshold')!~'^[0-9]+([.][0-9]+)?$')then
   raise exception using errcode='22023',message='marketplace_invalid_shipping_profile';end if;
  price:=(r->>'shipping_price')::numeric;threshold:=nullif(r->>'free_shipping_threshold','')::numeric;
  days_min:=(r->>'transit_days_min')::int;days_max:=(r->>'transit_days_max')::int;
  if price<0 or(threshold is not null and threshold<=0)or days_min not between 1 and 90
   or days_max not between days_min and 180 then
   raise exception using errcode='22023',message='marketplace_invalid_shipping_profile';end if;
  if nullif(btrim(coalesce(r->>'id','')),'')is null then
   insert into public.marketplace_shipping_profile_regions(profile_id,country_code,region_code,shipping_price,
    free_shipping_threshold,transit_days_min,transit_days_max)
   values(result,country,region,price,threshold,days_min,days_max)returning id into rule_id;
  else
   if(r->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'then
    raise exception using errcode='22023',message='marketplace_shipping_rule_invalid';end if;
   rule_id:=(r->>'id')::uuid;
   if not exists(select 1 from public.marketplace_shipping_profile_regions x where x.id=rule_id and x.profile_id=result)then
    raise exception using errcode='42501',message='marketplace_shipping_rule_not_owned';end if;
   update public.marketplace_shipping_profile_regions x set country_code=country,region_code=region,shipping_price=price,
    free_shipping_threshold=threshold,transit_days_min=days_min,transit_days_max=days_max,updated_at=now()
   where x.id=rule_id and x.profile_id=result and
    (x.country_code,x.region_code,x.shipping_price,x.free_shipping_threshold,x.transit_days_min,x.transit_days_max)
    is distinct from(country,region,price,threshold,days_min,days_max);
  end if;
  kept_ids:=array_append(kept_ids,rule_id);
 end loop;
 delete from public.marketplace_shipping_profile_regions x where x.profile_id=result and not(x.id=any(kept_ids));
 update public.marketplace_shipping_profiles p set configuration_status=case when exists(
  select 1 from public.marketplace_shipping_profile_regions x where x.profile_id=result and x.status='active'
 )then'explicit_ready'else'configuration_required'end,legacy_unrestricted=false where p.id=result;
 return result;
end$$;

create or replace function public.fetch_my_marketplace_shipping_profiles(p_store_id uuid)returns jsonb
language sql stable security definer set search_path=public as $$select coalesce(jsonb_agg(jsonb_build_object(
 'id',p.id,'name',p.name,'status',p.status,'configuration_status',p.configuration_status,
 'processing_days_min',p.processing_days_min,'processing_days_max',p.processing_days_max,
 'ships_from_country',p.ships_from_country,'return_policy_summary',p.return_policy_summary,
 'legacy_unrestricted',false,'products_using',(select count(*)from public.products x where x.shipping_profile_id=p.id and x.deleted_at is null),
 'regions',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'country_code',r.country_code,
  'region_code',r.region_code,'shipping_price',r.shipping_price,'free_shipping_threshold',r.free_shipping_threshold,
  'transit_days_min',r.transit_days_min,'transit_days_max',r.transit_days_max,'status',r.status)order by r.created_at,r.id)
  from public.marketplace_shipping_profile_regions r where r.profile_id=p.id),'[]'::jsonb))order by p.created_at,p.id),'[]'::jsonb)
from public.marketplace_shipping_profiles p where p.store_id=p_store_id and p.seller_id=auth.uid()$$;

revoke all on function public.upsert_my_marketplace_shipping_profile(uuid,uuid,text,integer,integer,text,text,jsonb),
 public.fetch_my_marketplace_shipping_profiles(uuid)from public,anon;
grant execute on function public.upsert_my_marketplace_shipping_profile(uuid,uuid,text,integer,integer,text,text,jsonb),
 public.fetch_my_marketplace_shipping_profiles(uuid)to authenticated,service_role;
commit;
