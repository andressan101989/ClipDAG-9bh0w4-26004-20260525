import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath =
  'supabase/migrations/20260726083000_harden_financial_rpc_execute_privileges.sql';
const sql = fs.readFileSync(path.join(root, migrationPath), 'utf8');

const signatures = [
  'public.atomic_ledger_transfer(uuid, uuid, numeric, numeric, text, text, text, uuid, text)',
  'public.check_velocity_limit(uuid, text, numeric, integer, numeric, integer)',
  'public.credit_deposit_to_ledger(uuid, numeric, text, text, uuid)',
  'public.ensure_ledger_account(uuid)',
  'public.ledger_credit(uuid, uuid, numeric, text, jsonb)',
  'public.ledger_debit(uuid, uuid, numeric, text, jsonb)',
  'public.request_withdrawal_from_ledger(uuid, numeric, text, text, text, text)',
  'public.transfer_bdag_internal(uuid, uuid, numeric, text)',
];

test('all exact financial RPC signatures become service-role only', () => {
  for (const signature of signatures) {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(sql, new RegExp(`REVOKE EXECUTE ON FUNCTION ${escaped} FROM PUBLIC;`));
    assert.match(sql, new RegExp(`REVOKE EXECUTE ON FUNCTION ${escaped} FROM anon;`));
    assert.match(sql, new RegExp(`REVOKE EXECUTE ON FUNCTION ${escaped} FROM authenticated;`));
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION ${escaped} TO service_role;`));
  }
});

test('ensure_ledger_account is not granted to a client role', () => {
  assert.doesNotMatch(
    sql,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.ensure_ledger_account\(uuid\)\s+TO\s+(PUBLIC|anon|authenticated)/i,
  );
});

test('the ACL migration does not redefine financial logic', () => {
  const statements = sql.replaceAll(/--.*$/gm, '');
  assert.doesNotMatch(statements, /\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i);
  assert.doesNotMatch(
    statements,
    /\b(INSERT|UPDATE|DELETE)\s+(INTO|public\.ledger|FROM\s+public\.ledger)/i,
  );
  assert.doesNotMatch(statements, /\bALTER\s+FUNCTION\b/i);
});
