export function syntheticVaultEdgeParity(observedAt) {
  return {
    schemaVersion: 1,
    projectRef: 'aewwdlvbwpczqyvkwvvj',
    functionName: 'process-scheduled-publications',
    vault: {
      secretName: 'call_dispatch_secret',
      revision: 'synthetic-vault-revision',
      secretVersion: 'synthetic-secret-version',
    },
    edge: {
      secretName: 'CALL_DISPATCH_SECRET',
      provisioningGeneration: 'synthetic-edge-generation',
      secretVersion: 'synthetic-secret-version',
    },
    changeFreezeId: 'synthetic-parity-freeze',
    observedAt,
    expiresAt: new Date(Date.parse(observedAt) + 2 * 60 * 60 * 1000).toISOString(),
  };
}
