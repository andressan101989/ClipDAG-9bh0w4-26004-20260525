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

export async function requireFixtureCleanup(cleanup) {
  const result = await cleanup();
  if (!result || result.quarantined !== true)
    throw new Error("remote_fixture_cleanup_not_confirmed");
  return result;
}
