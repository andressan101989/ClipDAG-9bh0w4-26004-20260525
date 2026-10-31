-- Correct terminal cursor truth in existing bounded read authorities only.
-- No financial rows, audit rows, capability mappings or write paths change.
begin;

create or replace function public.search_admin_ledger_accounts(
  p_account_type text default null,
  p_currency text default null,
  p_frozen boolean default null,
  p_owner_id uuid default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('finance.ledger.read');
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then raise exception using errcode='22023',message='invalid_cursor'; end if;
  return (
    with candidates as (
      select a.id,a.owner_id,a.account_type,a.currency,a.balance,a.frozen,a.created_at,a.updated_at,
             p.username,p.display_name,p.avatar_url
      from public.ledger_accounts a left join public.user_profiles p on p.id=a.owner_id
      where (p_account_type is null or a.account_type=p_account_type)
        and (p_currency is null or a.currency=p_currency)
        and (p_frozen is null or a.frozen=p_frozen)
        and (p_owner_id is null or a.owner_id=p_owner_id)
        and (p_cursor_created_at is null or (a.created_at,a.id)<(p_cursor_created_at,p_cursor_id))
      order by a.created_at desc,a.id desc limit v_limit + 1
    ), page as (
      select * from candidates order by created_at desc,id desc limit v_limit
    )
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'id',id,'account_type',account_type,'currency',currency,'balance',balance,'frozen',frozen,
        'created_at',created_at,'updated_at',updated_at,
        'owner',case when owner_id is null then null else jsonb_build_object('id',owner_id,'username',username,'display_name',display_name,'avatar_url',avatar_url) end
      ) order by created_at desc,id desc) from page),'[]'::jsonb),
      'next_cursor',case when (select count(*) from candidates)>v_limit then
        (select jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1)
        else null end
    )
  );
end;
$$;

create or replace function public.search_admin_financial_transactions(
  p_operation_type text default null,
  p_status text default null,
  p_currency text default null,
  p_reference_type text default null,
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('finance.ledger.read');
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then raise exception using errcode='22023',message='invalid_cursor'; end if;
  return (
    with candidates as (
      select t.id,t.operation_type,t.amount,t.fee_amount,t.currency,t.status,t.reference_type,t.created_at,
             (select count(*) from public.ledger_entries e where e.txn_id=t.id) entry_count
      from public.financial_transactions t
      where (p_operation_type is null or t.operation_type=p_operation_type)
        and (p_status is null or t.status=p_status)
        and (p_currency is null or t.currency=p_currency)
        and (p_reference_type is null or t.reference_type=p_reference_type)
        and (p_created_from is null or t.created_at>=p_created_from)
        and (p_created_to is null or t.created_at<p_created_to)
        and (p_cursor_created_at is null or (t.created_at,t.id)<(p_cursor_created_at,p_cursor_id))
      order by t.created_at desc,t.id desc limit v_limit + 1
    ), page as (
      select * from candidates order by created_at desc,id desc limit v_limit
    )
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id desc) from page),'[]'::jsonb),
      'next_cursor',case when (select count(*) from candidates)>v_limit then
        (select jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1)
        else null end
    )
  );
end;
$$;

create or replace function public.search_admin_global_audit(
  p_domain text default null,
  p_action text default null,
  p_actor_id uuid default null,
  p_target_type text default null,
  p_target_id uuid default null,
  p_outcome text default null,
  p_financial_effect boolean default null,
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('admin.audit.read');
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then raise exception using errcode='22023',message='invalid_cursor'; end if;
  return (
    with candidates as (
      select a.id,a.actor_id,a.actor_kind,a.actor_role_snapshot,a.actor_capability,a.domain,a.action,
        a.target_type,a.target_id,a.reason,a.outcome,a.financial_effect,a.contains_pii,a.metadata,a.created_at,
        p.username,p.display_name,p.avatar_url
      from private.admin_action_audit a left join public.user_profiles p on p.id=a.actor_id
      where private.admin_audit_row_visible(a.domain,a.financial_effect)
        and (p_domain is null or a.domain=p_domain)
        and (p_action is null or a.action=p_action)
        and (p_actor_id is null or a.actor_id=p_actor_id)
        and (p_target_type is null or a.target_type=p_target_type)
        and (p_target_id is null or a.target_id=p_target_id)
        and (p_outcome is null or a.outcome=p_outcome)
        and (p_financial_effect is null or a.financial_effect=p_financial_effect)
        and (p_created_from is null or a.created_at>=p_created_from)
        and (p_created_to is null or a.created_at<p_created_to)
        and (p_cursor_created_at is null or (a.created_at,a.id)<(p_cursor_created_at,p_cursor_id))
      order by a.created_at desc,a.id desc limit v_limit + 1
    ), page as (
      select * from candidates order by created_at desc,id desc limit v_limit
    )
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'id',id,'actor',case when actor_id is null then null else jsonb_build_object('id',actor_id,'username',username,'display_name',display_name,'avatar_url',avatar_url) end,
        'actor_kind',actor_kind,'actor_role_snapshot',actor_role_snapshot,'actor_capability',actor_capability,
        'domain',domain,'action',action,'target_type',target_type,'target_id',target_id,
        'target_ref',null,'reason',case when contains_pii or financial_effect then null else left(reason,500) end,
        'outcome',outcome,'financial_effect',financial_effect,'contains_pii',contains_pii,'created_at',created_at,
        'metadata',private.admin_audit_safe_metadata(metadata,contains_pii,false)
      ) order by created_at desc,id desc) from page),'[]'::jsonb),
      'next_cursor',case when (select count(*) from candidates)>v_limit then
        (select jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1)
        else null end
    )
  );
end;
$$;

create or replace function public.search_admin_finance_audit(
  p_action text default null,
  p_actor_id uuid default null,
  p_target_type text default null,
  p_target_id uuid default null,
  p_outcome text default null,
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('finance.audit.read');
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception using errcode='22023',message='invalid_cursor';
  end if;
  return (
    with candidates as (
      select a.id,a.actor_id,a.actor_kind,a.actor_role_snapshot,a.actor_capability,a.domain,a.action,
        a.target_type,a.target_id,a.reason,a.outcome,a.financial_effect,a.contains_pii,a.metadata,a.created_at,
        p.username,p.display_name,p.avatar_url
      from private.admin_action_audit a
      left join public.user_profiles p on p.id=a.actor_id
      where (
          a.financial_effect
          or a.domain='finance'
          or (
            a.domain='advertising'
            and a.action in (
              'advertising.rate.draft.create','advertising.rate.draft.update',
              'advertising.rate.publish','advertising.rate.retire'
            )
          )
        )
        and private.admin_audit_row_visible(a.domain,a.financial_effect)
        and (p_action is null or a.action=p_action)
        and (p_actor_id is null or a.actor_id=p_actor_id)
        and (p_target_type is null or a.target_type=p_target_type)
        and (p_target_id is null or a.target_id=p_target_id)
        and (p_outcome is null or a.outcome=p_outcome)
        and (p_created_from is null or a.created_at>=p_created_from)
        and (p_created_to is null or a.created_at<p_created_to)
        and (p_cursor_created_at is null or (a.created_at,a.id)<(p_cursor_created_at,p_cursor_id))
      order by a.created_at desc,a.id desc limit v_limit + 1
    ), page as (
      select * from candidates order by created_at desc,id desc limit v_limit
    )
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'id',id,'actor',case when actor_id is null then null else jsonb_build_object(
          'id',actor_id,'username',username,'display_name',display_name,'avatar_url',avatar_url
        ) end,
        'actor_kind',actor_kind,'actor_role_snapshot',actor_role_snapshot,'actor_capability',actor_capability,
        'domain',domain,'action',action,'target_type',target_type,'target_id',target_id,
        'target_ref',null,'reason',null,'outcome',outcome,'financial_effect',financial_effect,
        'contains_pii',contains_pii,'created_at',created_at,
        'metadata',private.admin_audit_safe_metadata(metadata,contains_pii,true)
      ) order by created_at desc,id desc) from page),'[]'::jsonb),
      'next_cursor',case when (select count(*) from candidates)>v_limit then
        (select jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1)
        else null end
    )
  );
end;
$$;

create or replace function public.search_admin_system_audit(
  p_action text default null,
  p_outcome text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('system.audit.read');
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then raise exception using errcode='22023',message='invalid_cursor'; end if;
  return (
    with candidates as (
      select a.id,a.actor_id,a.actor_kind,a.actor_role_snapshot,a.actor_capability,a.action,
        a.target_type,a.target_id,a.outcome,a.contains_pii,a.metadata,a.created_at,
        p.username,p.display_name,p.avatar_url
      from private.admin_action_audit a left join public.user_profiles p on p.id=a.actor_id
      where a.domain='system'
        and (p_action is null or a.action=p_action)
        and (p_outcome is null or a.outcome=p_outcome)
        and (p_cursor_created_at is null or (a.created_at,a.id)<(p_cursor_created_at,p_cursor_id))
      order by a.created_at desc,a.id desc limit v_limit + 1
    ), page as (
      select * from candidates order by created_at desc,id desc limit v_limit
    )
    select jsonb_build_object(
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'id',id,'actor',case when actor_id is null then null else jsonb_build_object('id',actor_id,'username',username,'display_name',display_name,'avatar_url',avatar_url) end,
        'actor_kind',actor_kind,'actor_role_snapshot',actor_role_snapshot,'actor_capability',actor_capability,
        'domain','system','action',action,'target_type',target_type,'target_id',target_id,'target_ref',null,
        'reason',null,'outcome',outcome,'financial_effect',false,'contains_pii',contains_pii,'created_at',created_at,
        'metadata',private.admin_audit_safe_metadata(metadata,contains_pii,false)
      ) order by created_at desc,id desc) from page),'[]'::jsonb),
      'next_cursor',case when (select count(*) from candidates)>v_limit then
        (select jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1)
        else null end
    )
  );
end;
$$;

alter function public.search_admin_ledger_accounts(text,text,boolean,uuid,timestamptz,uuid,integer) owner to postgres;
revoke all on function public.search_admin_ledger_accounts(text,text,boolean,uuid,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.search_admin_ledger_accounts(text,text,boolean,uuid,timestamptz,uuid,integer) to authenticated;
alter function public.search_admin_financial_transactions(text,text,text,text,timestamptz,timestamptz,timestamptz,uuid,integer) owner to postgres;
revoke all on function public.search_admin_financial_transactions(text,text,text,text,timestamptz,timestamptz,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.search_admin_financial_transactions(text,text,text,text,timestamptz,timestamptz,timestamptz,uuid,integer) to authenticated;
alter function public.search_admin_global_audit(text,text,uuid,text,uuid,text,boolean,timestamptz,timestamptz,timestamptz,uuid,integer) owner to postgres;
revoke all on function public.search_admin_global_audit(text,text,uuid,text,uuid,text,boolean,timestamptz,timestamptz,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.search_admin_global_audit(text,text,uuid,text,uuid,text,boolean,timestamptz,timestamptz,timestamptz,uuid,integer) to authenticated;
alter function public.search_admin_finance_audit(text,uuid,text,uuid,text,timestamptz,timestamptz,timestamptz,uuid,integer) owner to postgres;
revoke all on function public.search_admin_finance_audit(text,uuid,text,uuid,text,timestamptz,timestamptz,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.search_admin_finance_audit(text,uuid,text,uuid,text,timestamptz,timestamptz,timestamptz,uuid,integer) to authenticated;
alter function public.search_admin_system_audit(text,text,timestamptz,uuid,integer) owner to postgres;
revoke all on function public.search_admin_system_audit(text,text,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.search_admin_system_audit(text,text,timestamptz,uuid,integer) to authenticated;

commit;
