begin;

alter table public.products add column if not exists editor_state jsonb not null default '{}'::jsonb;
alter table public.products add constraint products_editor_state_object_check
 check(jsonb_typeof(editor_state)='object');

update public.products set editor_state=editor_state||jsonb_build_object(
 'title_configured',true,'price_configured',true,'category_configured',true)
where published_at is not null and(not(editor_state?'title_configured')or not(editor_state?'price_configured')or not(editor_state?'category_configured'));

create or replace function public.create_or_resume_marketplace_product_draft(
 p_store_id uuid,p_category_id uuid,p_editor_session_key uuid
)returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();result uuid;slug text;variant_id uuid;draft_sku text;
begin
 if actor is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;
 if p_editor_session_key is null then raise exception using errcode='22023',message='marketplace_draft_key_invalid';end if;
 select id into result from public.products where seller_id=actor and editor_session_key=p_editor_session_key and deleted_at is null;
 if result is not null then return result;end if;
 if not public.marketplace_seller_is_approved(actor)then raise exception using errcode='42501',message='marketplace_seller_not_approved';end if;
 perform 1 from public.marketplace_stores where id=p_store_id and seller_id=actor and status='active'for update;
 if not found then raise exception using errcode='42501',message='marketplace_store_inactive';end if;
 select c.slug into slug from public.marketplace_categories c where c.id=p_category_id and c.status='active';
 if slug is null then raise exception using errcode='22023',message='marketplace_category_inactive';end if;
 insert into public.products(seller_id,store_id,title,description,price,currency,category,category_id,images,stock,status,
  tags,product_type,moderation_status,editor_session_key,editor_saved_at,editor_state)
 values(actor,p_store_id,'Producto sin titulo','',1,'BDAG',slug,p_category_id,'{}',0,'paused','{}','physical','approved',
  p_editor_session_key,now(),jsonb_build_object('title_configured',false,'price_configured',false,'category_configured',false))returning id into result;
 draft_sku:='DRAFT-'||upper(substr(replace(result::text,'-',''),1,12));
 insert into public.marketplace_product_variants(product_id,store_id,seller_id,sku,sku_normalized,title,price,status,is_default,combination_key)
 values(result,p_store_id,actor,draft_sku,draft_sku,'Predeterminada',1,'active',true,'')returning id into variant_id;
 insert into public.marketplace_inventory_levels(variant_id,on_hand,reserved,low_stock_threshold)values(variant_id,0,0,0);
 return result;
exception when unique_violation then
 select id into result from public.products where seller_id=actor and editor_session_key=p_editor_session_key and deleted_at is null;
 if result is null then raise;end if;return result;
end$$;

drop function public.save_my_marketplace_product_draft(uuid,uuid,text,text,numeric,text,numeric,integer,text[],uuid,text);
create function public.save_my_marketplace_product_draft(
 p_product_id uuid,p_category_id uuid,p_title text,p_description text,p_price numeric,p_brand text,
 p_compare_at_price numeric,p_stock integer,p_tags text[],p_shipping_profile_id uuid,p_product_type text,
 p_title_configured boolean,p_price_configured boolean,p_category_configured boolean
)returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();slug text;normalized_price numeric(20,8);normalized_compare_price numeric(20,8);row_status text;
begin
 if actor is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;
 if p_title_configured is null or p_price_configured is null or p_category_configured is null then
  raise exception using errcode='22023',message='marketplace_product_editor_state_invalid';end if;
 perform 1 from public.products p join public.marketplace_stores s on s.id=p.store_id
  where p.id=p_product_id and p.seller_id=actor and p.deleted_at is null and s.seller_id=actor and s.status='active'for update of p;
 if not found then raise exception using errcode='42501',message='marketplace_product_not_editable';end if;
 select c.slug into slug from public.marketplace_categories c where c.id=p_category_id and c.status='active';
 if slug is null then raise exception using errcode='22023',message='marketplace_category_inactive';end if;
 if char_length(btrim(coalesce(p_title,'')))not between 1 and 80 or char_length(coalesce(p_description,''))>2000
  or p_stock is null or p_stock<0 or p_product_type not in('physical','digital')then
  raise exception using errcode='22023',message='marketplace_product_fields_invalid';end if;
 normalized_price:=public.marketplace_normalize_price(p_price);
 if p_compare_at_price is not null then normalized_compare_price:=public.marketplace_normalize_price(p_compare_at_price);
  if normalized_compare_price<normalized_price then raise exception using errcode='22023',message='marketplace_compare_price_invalid';end if;end if;
 if p_product_type='physical'and p_shipping_profile_id is not null and not exists(
  select 1 from public.marketplace_shipping_profiles sp join public.products p on p.store_id=sp.store_id
  where p.id=p_product_id and sp.id=p_shipping_profile_id and sp.seller_id=actor)then
  raise exception using errcode='42501',message='marketplace_shipping_profile_not_owned';end if;
 update public.products set category_id=p_category_id,category=slug,title=btrim(p_title),description=coalesce(p_description,''),
  price=normalized_price,brand=nullif(btrim(p_brand),''),compare_at_price=normalized_compare_price,stock=p_stock,tags=coalesce(p_tags,'{}'),
  shipping_profile_id=case when p_product_type='physical'then p_shipping_profile_id else null end,product_type=p_product_type,
  editor_state=jsonb_build_object('title_configured',p_title_configured,'price_configured',p_price_configured,
   'category_configured',p_category_configured),editor_saved_at=now(),updated_at=now()
 where id=p_product_id returning status into row_status;
 return jsonb_build_object('id',p_product_id,'status',row_status,'saved_at',now());
end$$;

revoke all on function public.create_or_resume_marketplace_product_draft(uuid,uuid,uuid),
 public.save_my_marketplace_product_draft(uuid,uuid,text,text,numeric,text,numeric,integer,text[],uuid,text,boolean,boolean,boolean)from public,anon;
grant execute on function public.create_or_resume_marketplace_product_draft(uuid,uuid,uuid),
 public.save_my_marketplace_product_draft(uuid,uuid,text,text,numeric,text,numeric,integer,text[],uuid,text,boolean,boolean,boolean)to authenticated,service_role;
comment on column public.products.editor_state is 'Advisory seller-editor intent flags only; never publication, payment, inventory, or shipping authority.';
notify pgrst,'reload schema';
commit;
