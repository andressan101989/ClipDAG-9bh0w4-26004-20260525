import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  presentLedgerTransaction,
  WalletTransactionPresentationError,
} from "../services/walletTransactionPresentation.mjs";

const USER = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const SYSTEM = "10000000-0000-4000-8000-000000000003";
const row = (operation_type, from_account_id, to_account_id, amount = 25, extra = {}) => ({
  operation_type,
  from_account_id,
  to_account_id,
  amount,
  reference_type: null,
  reference_id: null,
  ...extra,
});

test("deposit is a positive user-perspective credit", () => {
  const result = presentLedgerTransaction(row("deposit", SYSTEM, USER, 200), USER);
  assert.equal(result.label, "Depósito");
  assert.equal(result.direction, "credit");
  assert.equal(result.signedAmount, 200);
});

test("withdrawal is a negative user-perspective debit", () => {
  const result = presentLedgerTransaction(row("withdrawal", USER, SYSTEM, 100), USER);
  assert.equal(result.label, "Retiro");
  assert.equal(result.direction, "debit");
  assert.equal(result.signedAmount, -100);
});

test("the same transfer has opposite semantics for sender and receiver", () => {
  const transfer = row("transfer", USER, OTHER, 25);
  const sent = presentLedgerTransaction(transfer, USER);
  const received = presentLedgerTransaction(transfer, OTHER);
  assert.deepEqual([sent.label, sent.signedAmount], ["Transferencia enviada", -25]);
  assert.deepEqual([received.label, received.signedAmount], ["Transferencia recibida", 25]);
});

test("Marketplace buyer capture is a negative purchase", () => {
  const result = presentLedgerTransaction(
    row("marketplace_payment_capture", USER, SYSTEM, 35, {
      reference_type: "marketplace_checkout",
      reference_id: "20000000-0000-4000-8000-00000000c41a",
    }),
    USER,
  );
  assert.equal(result.label, "Compra Marketplace");
  assert.equal(result.signedAmount, -35);
  assert.match(result.description, /Checkout · #00C41A/);
});

test("Marketplace seller settlement is a positive sale credit", () => {
  const result = presentLedgerTransaction(
    row("marketplace_seller_settlement", SYSTEM, USER, 28.5),
    USER,
  );
  assert.equal(result.label, "Venta Marketplace");
  assert.equal(result.signedAmount, 28.5);
});

test("Marketplace buyer refund is positive and never inferred from order total", () => {
  const result = presentLedgerTransaction(
    row("marketplace_dispute_refund", SYSTEM, USER, 35),
    USER,
  );
  assert.equal(result.label, "Reembolso");
  assert.equal(result.signedAmount, 35);
});

test("a user-paid fee remains a negative canonical debit", () => {
  const result = presentLedgerTransaction(row("boost", USER, SYSTEM, 4), USER);
  assert.equal(result.label, "Tarifa / Comisión");
  assert.equal(result.signedAmount, -4);
});

test("seller reversal is a negative Marketplace adjustment", () => {
  const result = presentLedgerTransaction(
    row("marketplace_seller_settlement_reversal", USER, SYSTEM, 28.5),
    USER,
  );
  assert.equal(result.label, "Reversión Marketplace");
  assert.equal(result.signedAmount, -28.5);
});

test("unknown operation keeps canonical direction without a fake specific label", () => {
  const result = presentLedgerTransaction(row("future_credit", SYSTEM, USER, 3), USER);
  assert.equal(result.label, "Otro movimiento");
  assert.equal(result.direction, "credit");
  assert.equal(result.signedAmount, 3);
});

test("missing or ambiguous account direction fails closed", () => {
  assert.throws(
    () => presentLedgerTransaction(row("transfer", OTHER, SYSTEM), USER),
    (error) =>
      error instanceof WalletTransactionPresentationError &&
      error.code === "wallet_transaction_direction_unknown",
  );
  assert.throws(
    () => presentLedgerTransaction(row("transfer", USER, USER), USER),
    /wallet_transaction_direction_unknown/,
  );
});

test("presentation does not mutate canonical ledger amounts or rows", () => {
  const canonical = row("withdrawal", USER, SYSTEM, 12.75);
  const snapshot = structuredClone(canonical);
  const result = presentLedgerTransaction(canonical, USER);
  assert.deepEqual(canonical, snapshot);
  assert.equal(canonical.amount, 12.75);
  assert.equal(result.amount, 12.75);
  assert.equal(result.signedAmount, -12.75);
});

test("Wallet history uses participant direction and never text matching for signs", async () => {
  const hook = await readFile(new URL("../hooks/useWallet.tsx", import.meta.url), "utf8");
  const rowSource = await readFile(
    new URL("../components/wallet/TransactionRow.tsx", import.meta.url),
    "utf8",
  );
  const migration = await readFile(
    new URL("../supabase/migrations/20260703212533_migration_to_supabase.sql", import.meta.url),
    "utf8",
  );
  assert.match(hook, /from_account_id, to_account_id/);
  assert.match(hook, /presentLedgerTransaction\(t, acct\.id\)/);
  assert.doesNotMatch(hook, /function opTypeToTxType/);
  assert.match(rowSource, /item\.direction === 'debit'/);
  assert.doesNotMatch(rowSource, /item\.type === 'withdraw'/);
  assert.match(migration, /financial_transactions_select_participant/);
  assert.match(migration, /la\.owner_id = auth\.uid\(\)/);
});
