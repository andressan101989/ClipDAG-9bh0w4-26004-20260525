drop policy if exists products_read_public_or_owned on public.products;
create policy products_read_public_or_owned on public.products for select to anon,authenticated
using (
  seller_id=auth.uid()
  or (
    status='active' and moderation_status='approved' and deleted_at is null
    and product_type='physical'
    and public.marketplace_seller_is_approved(seller_id)
    and not fixture_ops.is_fixture('product',id)
  )
);

-- Fixture ownership remains visible to its verifier principal, while ordinary
-- users cannot resolve a registered fixture product through direct table reads.
