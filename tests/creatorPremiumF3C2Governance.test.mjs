import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const migrations = new URL('../supabase/migrations/', import.meta.url);
const foundation = '20261025011000_creator_premium_f3_bounded_financial_activation.sql';
const candidates = readdirSync(migrations).filter(name => name.includes('_creator_premium_f3_c2_'));
const sql = candidates.map(name => readFileSync(new URL(name, migrations), 'utf8')).join('\n');
const executableSql = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

// These source contracts guard the deployment boundary; the companion disposable
// suite exercises the real SQL behavior, ACLs, canonical bytes and accounting.
test('C2 ships one forward-only governance migration after the frozen F3 foundation', () => {
  assert.equal(candidates.length, 1, 'C2 requires exactly one forward-only governance migration; found none');
  assert.match(candidates[0], /^\d{14}_creator_premium_f3_c2_isolated_canary_governance\.sql$/);
  assert.ok(candidates[0] > foundation, 'C2 must follow F3 without rewriting its foundation');
  const bytes = Buffer.from(readFileSync(new URL(foundation, migrations), 'utf8').replace(/\r\n/g, '\n'));
  assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
    '8d3e57ccf78de470c951fa4f43d2aeb6fd2233da', 'forward-only C2 must preserve the frozen F3 foundation bytes');
  assert.match(executableSql, /^\s*begin\s*;/i);
  assert.match(executableSql, /commit\s*;\s*$/i);
});

test('C2 computes versioned canonical configuration and attestation digests on the server', () => {
  for (const kind of ['configuration', 'attestation']) {
    for (const operation of ['payload', 'digest']) assert.match(executableSql,
      new RegExp(`create(?: or replace)? function private\\.creator_premium_finance_${kind}_${operation}_f3_c2_v1\\s*\\(`, 'i'),
      `missing server-side ${kind} ${operation} contract`);
  }
  assert.match(executableSql, /octet_length/i, 'length prefixes must count UTF-8 bytes');
  assert.match(executableSql, /convert_to\s*\([\s\S]*?'UTF8'/i);
  assert.match(executableSql, /extract\s*\(\s*epoch/i, 'timestamps must canonicalize as UTC epoch microseconds');
  assert.match(executableSql, /sha256/i);
  for (const field of ['buyer_id', 'creator_id', 'buyer_account_id', 'creator_account_id',
    'platform_account_id', 'purchase_content_id', 'purchase_offer_version_id', 'subscription_plan_id',
    'client_contract', 'purchase_amount_bdag', 'subscription_amount_bdag', 'max_purchase_count',
    'max_subscription_count', 'max_refund_count', 'max_gross_bdag', 'platform_fee_bps',
    'charge_starts_at', 'charge_expires_at', 'refund_expires_at']) assert.ok(executableSql.includes(field), field);
});

test('C2 owner attestation is private, immutable, owner-bound and cannot be minted by runtime roles', () => {
  assert.match(executableSql, /create table private\.creator_premium_finance_owner_attestations_f3_c2\s*\(/i);
  for (const field of ['configuration_digest', 'approval_digest', 'approval_reference', 'evidence_digest',
    'repository', 'protected_source_sha', 'environment', 'approved_at', 'attestation_version']) {
    assert.ok(executableSql.includes(field), `missing attestation provenance ${field}`);
  }
  assert.match(executableSql, /creator_premium_finance_owner_attestations_f3_c2[\s\S]*?owner to postgres/i);
  assert.match(executableSql, /creator_premium_finance_owner_attestations_f3_c2 enable row level security/i);
  assert.match(executableSql, /creator_premium_finance_owner_attestations_f3_c2 force row level security/i);
  assert.match(executableSql, /before update or delete on private\.creator_premium_finance_owner_attestations_f3_c2/i);
  assert.match(executableSql, /foreign key\s*\(\s*approval_digest\s*,\s*configuration_digest\s*\)/i,
    'authorization must bind both approval and configuration, not a caller SHA alone');
  assert.match(executableSql, /revoke all on (?:table )?private\.creator_premium_finance_owner_attestations_f3_c2\s+from public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
  assert.doesNotMatch(executableSql, /grant\s+(?:all|insert|update|delete|execute)[^;]*attestation[^;]*to\s+(?:public|anon|authenticated|service_role)/i);
  assert.doesNotMatch(executableSql, /create(?: or replace)? function public\.[^(]*(?:attest|approv|activat|close|finaliz)[^(]*\(/i);
});

test('C2 permits only OPEN to CLOSED and provides owner-only policy-first closure and final OFF', () => {
  for (const helper of ['close_creator_premium_finance_authorization_f3_c2_v1',
    'finalize_creator_premium_finance_authorization_f3_c2_v1']) {
    assert.match(executableSql, new RegExp(`create(?: or replace)? function private\\.${helper}\\s*\\(`, 'i'));
  }
  assert.match(executableSql, /old\.status\s*=\s*'OPEN'[\s\S]*?new\.status\s*=\s*'CLOSED'/i);
  assert.match(executableSql, /lock_creator_premium_finance_f3_v1\s*\(/i);
  assert.match(executableSql, /purchase_enabled\s*=\s*false/i);
  assert.match(executableSql, /subscription_enabled\s*=\s*false/i);
  assert.match(executableSql, /activation_mode\s*=\s*'off'/i);
  assert.match(executableSql, /active_authorization_id\s*=\s*null/i);
  assert.match(executableSql, /revoke all on function[\s\S]*?from public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i);
});

test('C2 leaves foundation OFF and its insertion blocker effective without registering any activation', () => {
  assert.ok(sql.length > 0, 'missing C2 migration preserving the foundation deployment boundary');
  assert.doesNotMatch(executableSql, /(?:drop constraint|disable trigger|drop trigger)\s+(?:if exists\s+)?creator_premium_finance_(?:policy_f3_foundation_off_check|auth_f3_foundation_insert_guard)/i);
  assert.doesNotMatch(executableSql, /session_replication_role\s*=\s*replica/i);
  assert.doesNotMatch(executableSql, /insert into\s+(?:private\.)?creator_premium_finance_(?:authorizations|owner_attestations)/i);
  assert.doesNotMatch(executableSql, /update\s+private\.creator_premium_finance_policy\s+set\s+activation_mode\s*=\s*'canary'/i);
});

test('C2 keeps refunds admitted in CLOSED but charges require OPEN and reconciliation binds exact provenance', () => {
  assert.match(executableSql, /(?:status\s+(?:not\s+)?in\s*\(\s*'OPEN'\s*,\s*'CLOSED'\s*\)|status\s*=\s*'CLOSED')/i);
  assert.match(executableSql, /admit_creator_premium_refund_f3_v1/i);
  assert.match(executableSql, /assert_creator_premium_finance_deadline_f3_v1/i);
  assert.match(executableSql, /creator_premium_authorization_binding_f3_v1/i);
  assert.match(executableSql, /search_admin_creator_premium_finance_v1/i);
  for (const field of ['finance_authorization_id', 'financial_transaction_id', 'reversal_financial_transaction_id',
    'ledger_entries', 'orphan_creator_premium_transactions']) assert.ok(executableSql.includes(field), field);
});

test('C2 adds no parallel wallet, ledger, escrow or monetary authority', () => {
  assert.ok(sql.length > 0, 'missing C2 governance extension of the existing financial authority');
  const tables = [...executableSql.matchAll(/create table\s+(?:if not exists\s+)?([\w.]+)/gi)].map(match => match[1]);
  assert.deepEqual(tables, ['private.creator_premium_finance_owner_attestations_f3_c2']);
  assert.doesNotMatch(executableSql, /create(?: or replace)? function [\w.]*(?:post|purchase|subscribe|refund)[\w.]*f3_c2[\w.]*\s*\(/i);
  assert.doesNotMatch(executableSql, /create table[^;]*(?:wallet|ledger|escrow)/i);
});
