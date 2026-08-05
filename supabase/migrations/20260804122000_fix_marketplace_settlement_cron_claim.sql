begin;

create or replace function public.run_scheduled_marketplace_settlement()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform set_config('request.jwt.claim.role','service_role',true);
  return public.settle_eligible_marketplace_orders(100);
end$$;

revoke all on function public.run_scheduled_marketplace_settlement() from public,anon,authenticated;
grant execute on function public.run_scheduled_marketplace_settlement() to service_role;

commit;
