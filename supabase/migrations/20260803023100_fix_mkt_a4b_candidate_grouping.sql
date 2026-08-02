begin;

-- PostgreSQL cannot infer functional dependencies for the active_pins CTE row.
-- Recreate only the candidate RPC with every referenced pin snapshot field in
-- its aggregate grouping, preserving the deployed lifecycle implementation.
do $migration$
declare
  function_definition text;
  old_grouping text := E'      pin.id,\n      current_offer.id,';
  new_grouping text := E'      pin.id,\n      pin.is_featured,\n      pin.commerce_mode,\n      pin.creator_commission_bps,\n      pin.affiliate_offer_id,\n      current_offer.id,';
begin
  select pg_get_functiondef(
    'public.fetch_my_live_product_candidates(uuid,integer,timestamp with time zone,uuid)'::regprocedure
  ) into function_definition;

  if position(old_grouping in function_definition) = 0 then
    raise exception 'mkt_a4b_candidate_grouping_signature_not_found';
  end if;

  execute replace(function_definition, old_grouping, new_grouping);
end
$migration$;

commit;
