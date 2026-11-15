const BLOCKED = Object.freeze({ schemaVersion: 1, result: 'BLOCKED', releaseReady: false });

/**
 * Retired compatibility facade. This module is not a plan, authority, gate,
 * snapshot, postcheck, recovery or release entrypoint. Use the public compiler
 * for plan inspection and the protected runtime for B2 authority verification.
 */
export function preparePrivatePlan() {
  return BLOCKED;
}
