export function syntheticVaultEdgeParity(observedAt) {
  return {
    schemaVersion: 2,
    projectRef: 'aewwdlvbwpczqyvkwvvj',
    functionName: 'process-scheduled-publications',
    mechanism: 'supabase-vault-edge-nonce-hmac-sha256-v1',
    result: 'MATCH',
    observationId: '9'.repeat(64),
    vault: {
      secretName: 'call_dispatch_secret',
    },
    edge: {
      secretName: 'CALL_DISPATCH_SECRET',
    },
    observedAt,
    expiresAt: new Date(Date.parse(observedAt) + 2 * 60 * 60 * 1000).toISOString(),
  };
}
