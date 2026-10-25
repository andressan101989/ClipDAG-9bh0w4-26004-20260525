import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "supabase/migrations/20261025231500_creator_premium_f3_final_wallet_integration.sql";
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

test("F3 final adds a self-only ledger provisioning boundary without widening the canonical helper", () => {
  assert.ok(migration, `missing ${migrationPath}`);
  assert.match(
    migration,
    /create or replace function public\.ensure_my_ledger_account\(\)\s+returns uuid\s+language plpgsql\s+security definer\s+set search_path\s*=\s*''/i,
  );
  assert.match(migration, /v_actor\s+uuid\s*:=\s*auth\.uid\(\)/i);
  assert.match(migration, /errcode\s*=\s*'42501'.*ledger_account_auth_required/is);
  assert.match(migration, /errcode\s*=\s*'55000'.*ledger_account_profile_required/is);
  assert.match(migration, /public\.ensure_ledger_account\(v_actor\)/i);
  assert.match(
    migration,
    /revoke all on function public\.ensure_my_ledger_account\(\)\s+from public,\s*anon,\s*authenticated,\s*service_role/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.ensure_my_ledger_account\(\)\s+to authenticated/i,
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.ensure_ledger_account\(uuid\)\s+to\s+(?:public|anon|authenticated)/i,
  );
});

test("F3 final extends the existing global revenue core with proven Premium fees and reversals", () => {
  assert.ok(migration, `missing ${migrationPath}`);
  assert.match(
    migration,
    /create or replace function private\.get_admin_platform_revenue_projection_v1\(\s*p_period text default 'ytd'/i,
  );
  assert.match(migration, /'creator_premium'::text\s*,\s*'Creator Premium Fees'::text/i);
  assert.match(migration, /private\.creator_premium_purchase_receipts/i);
  assert.match(migration, /private\.creator_premium_subscription_periods/i);
  assert.match(migration, /private\.creator_premium_financial_fact_is_valid_v1\(/i);
  assert.match(migration, /creator_premium_purchase_refund/i);
  assert.match(migration, /creator_premium_subscription_refund/i);
  assert.match(migration, /platform_fee_credit/i);
  assert.match(migration, /platform_fee_debit/i);
  assert.match(migration, /creator_premium_reconciliation/i);
});

test("F3 final is projection/provisioning only and cannot arm Finance or post money", () => {
  assert.ok(migration, `missing ${migrationPath}`);
  assert.doesNotMatch(
    migration,
    /update\s+private\.creator_premium_finance_policy|insert\s+into\s+public\.financial_transactions|ledger_(?:debit|credit)\s*\(/i,
  );
  assert.doesNotMatch(migration, /purchase_enabled\s*=\s*true|subscription_enabled\s*=\s*true|refunds_enabled\s*=\s*true/i);
  assert.match(migration, /notify pgrst,\s*'reload schema'/i);
});
