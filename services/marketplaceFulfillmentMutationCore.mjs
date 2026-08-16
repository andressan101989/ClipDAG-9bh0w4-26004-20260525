export async function reconcileFulfillmentMutation({
  execute,
  parse,
  readBack,
  enrich,
  provesCommitted,
  isAmbiguousError,
  createUnknownError,
  onReconciled,
  onPostMutationRefreshFailure,
}) {
  let canonical;
  let reconciled = false;
  let responseReceived = false;
  let originalError;

  try {
    const response = await execute();
    responseReceived = true;
    canonical = parse(response);
  } catch (error) {
    originalError = error;
    if (!responseReceived && !isAmbiguousError(error)) throw error;
  }

  if (!canonical || !provesCommitted(canonical)) {
    if (!originalError && canonical) originalError = createUnknownError();
    try {
      const readBackValue = await readBack();
      if (!provesCommitted(readBackValue)) {
        if (!responseReceived && originalError) throw originalError;
        throw createUnknownError(originalError);
      }
      canonical = readBackValue;
      reconciled = true;
      onReconciled?.();
    } catch (readBackError) {
      if (readBackError === originalError) throw readBackError;
      throw createUnknownError(originalError ?? readBackError);
    }
  }

  try {
    return {
      value: await enrich(canonical),
      reconciled,
      postMutationRefreshFailed: false,
    };
  } catch (error) {
    onPostMutationRefreshFailure?.(error);
    return {
      value: canonical,
      reconciled,
      postMutationRefreshFailed: true,
    };
  }
}
