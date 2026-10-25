import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ACCOUNT_ID = "10000000-0000-4000-8000-000000000001";

test("authenticated bootstrap provisions only the caller's canonical BDAG account", async () => {
  const { ensureOwnLedgerAccount } = await import(
    "../services/ledgerAccountProvisioning.mjs"
  );
  const calls = [];
  const result = await ensureOwnLedgerAccount({
    rpc: async (...args) => {
      calls.push(args);
      return { data: ACCOUNT_ID, error: null };
    },
  });

  assert.deepEqual(calls, [["ensure_my_ledger_account"]]);
  assert.deepEqual(result, { ok: true, accountId: ACCOUNT_ID });
});

test("provisioning failures are non-sensitive and fail closed", async () => {
  const { ensureOwnLedgerAccount } = await import(
    "../services/ledgerAccountProvisioning.mjs"
  );
  const secret = "service-role-secret-that-must-not-leak";
  for (const rpc of [
    async () => ({ data: null, error: { message: secret, details: secret } }),
    async () => ({ data: "not-a-uuid", error: null }),
    async () => { throw new Error(secret); },
  ]) {
    const result = await ensureOwnLedgerAccount({ rpc });
    assert.deepEqual(result, {
      ok: false,
      code: "LEDGER_ACCOUNT_PROVISIONING_FAILED",
    });
    assert.doesNotMatch(JSON.stringify(result), /service-role-secret/i);
  }
});

test("Auth bootstrap uses the self-only wrapper and removes the forbidden arbitrary-user RPC", async () => {
  const source = await readFile(new URL("../contexts/AuthContext.tsx", import.meta.url), "utf8");

  assert.match(source, /ensureOwnLedgerAccount\(supabase\)/);
  assert.match(source, /event\s*===\s*['"]INITIAL_SESSION['"]/);
  assert.match(source, /event\s*===\s*['"]SIGNED_IN['"]/);
  assert.match(
    source,
    /const profile\s*=\s*await loadProfile\([\s\S]*?setUser\(profile\)[\s\S]*?if\s*\(\s*profile[\s\S]*?ensureOwnLedgerAccount\(supabase\)/,
    "the profile row must exist before its FK-bound ledger account is provisioned",
  );
  assert.match(source, /ledgerProvisionedUserRef\s*=\s*useRef<string\s*\|\s*null>\(null\)/);
  assert.match(source, /ledgerProvisionedUserRef\.current\s*!==\s*session\.user\.id/);
  assert.match(source, /ledgerProvisionedUserRef\.current\s*=\s*session\.user\.id/);
  assert.match(source, /ledgerProvisionedUserRef\.current\s*=\s*null/);
  assert.doesNotMatch(source, /rpc\(['"]ensure_ledger_account['"]/);
  assert.doesNotMatch(source, /p_user_id\s*:\s*data\.user\.id/);
});
