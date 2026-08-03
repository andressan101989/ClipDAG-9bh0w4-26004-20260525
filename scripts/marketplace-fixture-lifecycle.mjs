export async function executeFixtureRun({ begin, register, test, cleanup }) {
  await begin();
  let testFailure;
  try {
    await register();
    return await test();
  } catch (error) {
    testFailure = error;
    throw error;
  } finally {
    try {
      await cleanup();
    } catch (cleanupFailure) {
      if (testFailure && cleanupFailure instanceof Error)
        cleanupFailure.cause = testFailure;
      throw cleanupFailure;
    }
  }
}

export async function requireFixtureFinalization(finalize, expected = {}) {
  const result = await finalize();
  if (!result)
    throw new Error("remote_fixture_quarantine_not_confirmed");
  if (expected.fixtureSuite && result.fixture_suite !== expected.fixtureSuite)
    throw new Error("remote_fixture_suite_mismatch");
  if (expected.fixtureRunId && result.fixture_run_id !== expected.fixtureRunId)
    throw new Error("remote_fixture_run_id_mismatch");
  if (result.status !== "quarantined" || result.failure_code != null)
    throw new Error("remote_fixture_run_not_quarantined");
  if (result.quarantined !== true)
    throw new Error("remote_fixture_quarantine_not_confirmed");
  if (result.financial_neutralized !== true)
    throw new Error("remote_fixture_financial_neutralization_not_confirmed");
  for (const field of [
    "products_active",
    "stores_active",
    "sessions_live",
    "pins_active",
    "offers_active",
    "fixture_user_spendable",
    "fixture_attributable_escrow",
    "active_reservations",
    "unresolved_allocations",
    "net_platform_impact",
  ]) {
    if (typeof result[field] !== "number" || result[field] !== 0)
      throw new Error(`remote_fixture_finalization_nonzero:${field}`);
  }
  return result;
}
