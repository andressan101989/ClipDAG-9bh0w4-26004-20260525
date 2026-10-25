export type LedgerAccountProvisioningResult =
  | { ok: true; accountId: string }
  | { ok: false; code: "LEDGER_ACCOUNT_PROVISIONING_FAILED" };

export function ensureOwnLedgerAccount(client: {
  rpc(functionName: string): PromiseLike<{ data: unknown; error: unknown }>;
}): Promise<LedgerAccountProvisioningResult>;
