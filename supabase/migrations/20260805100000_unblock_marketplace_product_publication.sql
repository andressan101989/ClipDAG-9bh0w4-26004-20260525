begin;

create or replace function public.marketplace_product_publication_reason(p_product_id uuid,p_actor_id uuid)
returns text language plpgsql stable security definer set search_path=public as $$
declare p public.products; active_count integer; inventory_count integer; default_count integer; available integer;
begin
 select * into p from public.products where id=p_product_id;
 if p.id is null or p.seller_id<>p_actor_id then return 'marketplace_permission_denied';end if;
 if not public.marketplace_seller_is_approved(p_actor_id) then return 'marketplace_seller_not_approved';end if;
 if not exists(select 1 from public.marketplace_stores s where s.id=p.store_id and s.seller_id=p_actor_id and s.status='active') then return 'marketplace_store_inactive';end if;
 if not exists(select 1 from public.marketplace_categories c where c.id=p.category_id and c.status='active') then return 'marketplace_category_inactive';end if;
 if p.deleted_at is not null then return 'marketplace_product_deleted';end if;
 if p.moderation_status<>'approved' then return 'marketplace_product_not_ready_product_not_approved';end if;
 if p.product_type<>'physical' or p.currency<>'BDAG' then return 'marketplace_product_not_ready_unsupported_product_type';end if;
 if cardinality(p.images)<1 or not exists(select 1 from public.media_asset_links l join public.media_assets a on a.id=l.asset_id
   where l.entity_type='shop_product' and l.entity_id=p.id and a.owner_id=p_actor_id and a.status='ready' and a.visibility='public' and a.media_kind='image' and a.purpose='product_image') then return 'marketplace_product_media_required';end if;
 if not exists(select 1 from public.marketplace_shipping_profiles sp where sp.id=p.shipping_profile_id and sp.seller_id=p_actor_id and sp.store_id=p.store_id and sp.status='active') then return 'marketplace_product_not_ready_shipping_incomplete';end if;
 select count(*) filter(where v.status='active' and v.archived_at is null),count(i.variant_id) filter(where v.status='active' and v.archived_at is null),
  count(*) filter(where v.status='active' and v.archived_at is null and v.is_default),coalesce(sum(greatest(i.on_hand-i.reserved,0)) filter(where v.status='active' and v.archived_at is null),0)
 into active_count,inventory_count,default_count,available from public.marketplace_product_variants v left join public.marketplace_inventory_levels i on i.variant_id=v.id where v.product_id=p.id;
 if active_count=0 then return 'marketplace_product_not_ready_no_active_variant';end if;
 if default_count<>1 or inventory_count<active_count then return 'marketplace_product_not_ready_inventory_not_configured';end if;
 if available<=0 then return 'marketplace_product_not_ready_out_of_stock';end if;
 return null;
end$$;

create or replace function public.evaluate_my_marketplace_product_publication(p_product_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=auth.uid();reason text;
begin
 if actor is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;
 reason:=public.marketplace_product_publication_reason(p_product_id,actor);
 return jsonb_build_object('ready',reason is null,'reason_code',reason);
end$$;

create or replace function public.publish_my_marketplace_product_checked(p_product_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();reason text;result jsonb;
begin
 if actor is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('marketplace-publish:'||p_product_id::text,0));
 perform 1 from public.products where id=p_product_id for update;
 reason:=public.marketplace_product_publication_reason(p_product_id,actor);
 if reason is not null then raise exception using message=reason;end if;
 update public.products set status='active',published_at=coalesce(published_at,now()),updated_at=now() where id=p_product_id and seller_id=actor;
 perform public.refresh_marketplace_product_projection(p_product_id);
 result:=jsonb_build_object('published',true,'ready',true,'reason_code',null,'status','active');
 return result;
end$$;

revoke all on function public.marketplace_product_publication_reason(uuid,uuid) from public,anon,authenticated;
revoke all on function public.evaluate_my_marketplace_product_publication(uuid),public.publish_my_marketplace_product_checked(uuid) from public,anon;
grant execute on function public.evaluate_my_marketplace_product_publication(uuid),public.publish_my_marketplace_product_checked(uuid) to authenticated,service_role;

commit;
