-- SUPERUSER-A3-F1 marketplace audit least-privilege closure.
-- The global audit remains the only physical source; this changes only its
-- Marketplace client projection.
begin;

create or replace function public.search_marketplace_admin_activity(
  p_actor_id uuid default null,
  p_action text default null,
  p_target_type text default null,
  p_target_id uuid default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare
  v_rows jsonb;
  v_page jsonb;
  v_more boolean;
  v_can_sellers boolean;
  v_can_products boolean;
  v_can_disputes boolean;
  v_can_finance_audit boolean;
begin
  perform public.admin_require_capability('marketplace.audit.read');

  if p_limit is null or p_limit < 1 or p_limit > 100
     or (p_action is not null and char_length(p_action) > 120)
     or (p_target_type is not null and char_length(p_target_type) > 80)
     or ((p_cursor_created_at is null) <> (p_cursor_id is null)) then
    raise exception using
      errcode = '22023',
      message = 'marketplace_admin_activity_search_invalid';
  end if;

  -- Resource visibility is capability-derived and evaluated from the current
  -- server-side assignments. Role names and client claims are not authority.
  v_can_sellers := public.admin_actor_has_capability('marketplace.sellers.read');
  v_can_products := public.admin_actor_has_capability('marketplace.products.read');
  v_can_disputes := public.admin_actor_has_capability('marketplace.disputes.read');
  v_can_finance_audit := public.admin_actor_has_capability('finance.audit.read');

  with visible_rows as (
    select
      a.*,
      case
        when a.target_type = 'seller'
         and a.action in ('seller_approve','seller_reject','seller_suspend','seller_restore')
          then jsonb_build_object(
            'receipt', jsonb_strip_nulls(jsonb_build_object(
              'seller_id', a.metadata->'receipt'->'seller_id',
              'status', a.metadata->'receipt'->'status',
              'store_status', a.metadata->'receipt'->'store_status',
              'action', a.metadata->'receipt'->'action',
              'updated_at', a.metadata->'receipt'->'updated_at'
            ))
          )
        when a.target_type = 'product'
         and a.action in ('product_approve','product_reject','product_suspend')
          then jsonb_build_object(
            'receipt', jsonb_strip_nulls(jsonb_build_object(
              'product_id', a.metadata->'receipt'->'product_id',
              'moderation_status', a.metadata->'receipt'->'moderation_status',
              'moderation_reason', a.metadata->'receipt'->'moderation_reason',
              'publication_status', a.metadata->'receipt'->'publication_status',
              'action', a.metadata->'receipt'->'action',
              'updated_at', a.metadata->'receipt'->'updated_at'
            ))
          )
        when a.target_type = 'dispute'
         and a.action in (
           'dispute_manual_review','dispute_refund_buyer',
           'dispute_release_seller','dispute_reject_claim'
         )
          then jsonb_strip_nulls(
            jsonb_build_object(
              'result_kind', a.metadata->'result_kind',
              'money_moved', a.metadata->'money_moved',
              'already_released', a.metadata->'already_released'
            )
            || case when v_can_finance_audit
              then jsonb_build_object('canonical_id', a.metadata->'canonical_id')
              else '{}'::jsonb
            end
          )
        else '{}'::jsonb
      end as safe_metadata
    from private.admin_action_audit a
    where a.domain = 'marketplace'
      and case
        when a.target_type = 'seller'
         and a.action in ('seller_approve','seller_reject','seller_suspend','seller_restore')
          then v_can_sellers
        when a.target_type = 'product'
         and a.action in ('product_approve','product_reject','product_suspend')
          then v_can_products
        when a.target_type = 'dispute'
         and a.action in (
           'dispute_manual_review','dispute_refund_buyer',
           'dispute_release_seller','dispute_reject_claim'
         )
          then v_can_disputes
        else false
      end
      and (p_actor_id is null or a.actor_id = p_actor_id)
      and (p_action is null or a.action = p_action)
      and (p_target_type is null or a.target_type = p_target_type)
      and (p_target_id is null or a.target_id = p_target_id)
      and (
        p_cursor_created_at is null
        or (a.created_at,a.id) < (p_cursor_created_at,p_cursor_id)
      )
    order by a.created_at desc,a.id desc
    limit p_limit + 1
  ), rows as (
    select jsonb_build_object(
      'id',a.id,
      'actor_id',a.actor_id,
      'actor_username',u.username,
      'actor_display_name',u.display_name,
      'action',a.action,
      'target_type',a.target_type,
      'target_id',a.target_id,
      'reason_code',a.reason,
      'metadata',a.safe_metadata,
      'created_at',a.created_at
    ) j
    from visible_rows a
    left join public.public_user_profiles u on u.id = a.actor_id
    order by a.created_at desc,a.id desc
  )
  select coalesce(jsonb_agg(j),'[]'::jsonb) into v_rows from rows;

  v_more := jsonb_array_length(v_rows) > p_limit;
  select coalesce(jsonb_agg(value order by ord),'[]'::jsonb)
    into v_page
  from jsonb_array_elements(v_rows) with ordinality e(value,ord)
  where ord <= p_limit;

  return jsonb_build_object(
    'activity',v_page,
    'page_size',jsonb_array_length(v_page),
    'next_cursor',case when v_more then jsonb_build_object(
      'created_at',v_page->(p_limit-1)->>'created_at',
      'id',v_page->(p_limit-1)->>'id'
    ) else null end
  );
end;
$$;

revoke all on function public.search_marketplace_admin_activity(
  uuid,text,text,uuid,timestamptz,uuid,integer
) from public,anon,authenticated,service_role;
grant execute on function public.search_marketplace_admin_activity(
  uuid,text,text,uuid,timestamptz,uuid,integer
) to authenticated;

comment on function public.search_marketplace_admin_activity(
  uuid,text,text,uuid,timestamptz,uuid,integer
) is 'Capability-intersected Marketplace audit projection with explicit operational and financial metadata allow-lists; unknown actions fail closed.';

notify pgrst,'reload schema';
commit;
