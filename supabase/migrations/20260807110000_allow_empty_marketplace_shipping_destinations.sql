begin;

create or replace function public.upsert_my_marketplace_shipping_profile(
  p_profile_id uuid,p_store_id uuid,p_name text,p_processing_days_min integer,p_processing_days_max integer,
  p_ships_from_country text,p_return_policy_summary text,p_regions jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();result uuid:=coalesce(p_profile_id,gen_random_uuid());r jsonb;
begin
 if actor is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
 if not exists(select 1 from public.marketplace_stores s join public.marketplace_sellers ms on ms.user_id=s.seller_id
   where s.id=p_store_id and s.seller_id=actor and s.status='active' and ms.status='approved') then
   raise exception using errcode='42501',message='marketplace_store_inactive';end if;
 if char_length(btrim(coalesce(p_name,''))) not between 2 and 100 or p_processing_days_min not between 0 and 30
   or p_processing_days_max not between p_processing_days_min and 60 or upper(p_ships_from_country)!~'^[A-Z]{2}$'
   or char_length(btrim(coalesce(p_return_policy_summary,''))) not between 2 and 1000
   or jsonb_typeof(p_regions)<>'array' then raise exception using message='marketplace_invalid_shipping_profile';end if;
 if p_profile_id is not null and not exists(select 1 from public.marketplace_shipping_profiles where id=p_profile_id and seller_id=actor and store_id=p_store_id) then
   raise exception using errcode='42501',message='marketplace_shipping_profile_not_owned';end if;
 insert into public.marketplace_shipping_profiles(id,seller_id,store_id,name,processing_days_min,processing_days_max,ships_from_country,return_policy_summary,legacy_unrestricted)
 values(result,actor,p_store_id,btrim(p_name),p_processing_days_min,p_processing_days_max,upper(p_ships_from_country),btrim(p_return_policy_summary),false)
 on conflict(id) do update set name=excluded.name,processing_days_min=excluded.processing_days_min,
 processing_days_max=excluded.processing_days_max,ships_from_country=excluded.ships_from_country,
 return_policy_summary=excluded.return_policy_summary,legacy_unrestricted=false,status='active',updated_at=now();
 delete from public.marketplace_shipping_profile_regions where profile_id=result;
 for r in select * from jsonb_array_elements(p_regions) loop
   if upper(r->>'country_code')!~'^[A-Z]{2}$' or (r->>'shipping_price')::numeric<0
    or (r->>'transit_days_min')::integer not between 1 and 90
    or (r->>'transit_days_max')::integer not between (r->>'transit_days_min')::integer and 180 then
    raise exception using message='marketplace_invalid_shipping_profile';end if;
   insert into public.marketplace_shipping_profile_regions(profile_id,country_code,region_code,shipping_price,free_shipping_threshold,transit_days_min,transit_days_max)
   values(result,upper(r->>'country_code'),nullif(upper(btrim(coalesce(r->>'region_code',''))),''),(r->>'shipping_price')::numeric,
    nullif(r->>'free_shipping_threshold','')::numeric,(r->>'transit_days_min')::integer,(r->>'transit_days_max')::integer);
 end loop;
 -- The existing region trigger derives explicit_ready when rules exist and
 -- configuration_required when the final rule is removed.
 update public.marketplace_shipping_profiles p set configuration_status=case when exists(
   select 1 from public.marketplace_shipping_profile_regions x where x.profile_id=result and x.status='active'
 )then'explicit_ready'else'configuration_required'end,legacy_unrestricted=false where p.id=result;
 return result;
end$$;

revoke all on function public.upsert_my_marketplace_shipping_profile(uuid,uuid,text,integer,integer,text,text,jsonb) from public,anon;
grant execute on function public.upsert_my_marketplace_shipping_profile(uuid,uuid,text,integer,integer,text,text,jsonb) to authenticated,service_role;

commit;
