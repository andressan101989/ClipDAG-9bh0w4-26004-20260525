export interface FulfillmentMutationOutcome<T> {
  value: T;
  reconciled: boolean;
  postMutationRefreshFailed: boolean;
}

export function reconcileFulfillmentMutation<T>(options: {
  execute: () => Promise<unknown>;
  parse: (value: unknown) => T;
  readBack: () => Promise<T>;
  enrich: (value: T) => Promise<T>;
  provesCommitted: (value: T) => boolean;
  isAmbiguousError: (error: unknown) => boolean;
  createUnknownError: (cause?: unknown) => Error;
  onReconciled?: () => void;
  onPostMutationRefreshFailure?: (error: unknown) => void;
}): Promise<FulfillmentMutationOutcome<T>>;
