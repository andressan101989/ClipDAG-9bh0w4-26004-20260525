begin;

do $$
declare definition text;
begin
  select pg_get_functiondef(
    'fixture_ops.neutralize_marketplace_fixture_run(text,text,text)'::regprocedure
  ) into strict definition;
  definition:=replace(
    definition,
    'join fixture_ops.fixture_financial_cleanup c on c.financial_transaction_id=e.txn_id where c.fixture_suite=p_fixture_suite and c.fixture_run_id=p_fixture_run_id',
    'join fixture_ops.fixture_financial_cleanup fc on fc.financial_transaction_id=e.txn_id where fc.fixture_suite=p_fixture_suite and fc.fixture_run_id=p_fixture_run_id'
  );
  if definition not like '%fixture_financial_cleanup fc on fc.financial_transaction_id%' then
    raise exception using message='fixture_run_ledger_alias_patch_failed';
  end if;
  execute definition;
end$$;

commit;
