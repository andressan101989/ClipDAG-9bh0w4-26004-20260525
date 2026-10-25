const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const failed = () => ({
  ok: false,
  code: "LEDGER_ACCOUNT_PROVISIONING_FAILED",
});

export async function ensureOwnLedgerAccount(client) {
  if (!client || typeof client.rpc !== "function") return failed();
  try {
    const result = await client.rpc("ensure_my_ledger_account");
    if (result?.error || typeof result?.data !== "string" || !UUID_RE.test(result.data))
      return failed();
    return { ok: true, accountId: result.data };
  } catch {
    return failed();
  }
}
