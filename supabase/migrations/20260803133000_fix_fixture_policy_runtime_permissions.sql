begin;

-- Stored RLS expressions execute this boolean predicate as the caller. Grant only
-- the function capability needed to evaluate product visibility; the private
-- schema and registry remain non-enumerable to API roles.
grant execute on function fixture_ops.is_fixture(text, uuid)
to anon, authenticated;

revoke all on schema fixture_ops
from public, anon, authenticated;

revoke all on table fixture_ops.internal_test_fixture_registry
from public, anon, authenticated;

revoke all on table fixture_ops.fixture_cleanup_audits
from public, anon, authenticated;

revoke all on table fixture_ops.fixture_runs
from public, anon, authenticated;

revoke all on table fixture_ops.fixture_financial_cleanup
from public, anon, authenticated;

commit;
