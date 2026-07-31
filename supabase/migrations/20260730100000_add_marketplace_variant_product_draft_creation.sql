begin;

-- Variant creation needs a product id before its option combinations can be
-- configured. Keep the existing authoritative create RPC intact, but wrap it
-- so the product and its media/default variant commit in a paused state.
create or replace function public.create_marketplace_product_draft(
  p_store_id uuid,
  p_category_id uuid,
  p_title text,
  p_description text,
  p_price numeric,
  p_brand text,
  p_compare_at_price numeric,
  p_asset_ids uuid[],
  p_stock integer,
  p_tags text[]
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
begin
  v_product_id := public.create_marketplace_product(
    p_store_id,
    p_category_id,
    p_title,
    p_description,
    p_price,
    p_brand,
    p_compare_at_price,
    p_asset_ids,
    p_stock,
    p_tags
  );
  perform public.pause_marketplace_product(v_product_id);
  return v_product_id;
end;
$$;

revoke all on function public.create_marketplace_product_draft(
  uuid, uuid, text, text, numeric, text, numeric, uuid[], integer, text[]
) from public, anon;
grant execute on function public.create_marketplace_product_draft(
  uuid, uuid, text, text, numeric, text, numeric, uuid[], integer, text[]
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
