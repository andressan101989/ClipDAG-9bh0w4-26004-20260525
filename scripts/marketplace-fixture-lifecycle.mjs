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

export async function requireFixtureFinalization(finalize) {
  const result = await finalize();
  if (!result || result.quarantined !== true)
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
