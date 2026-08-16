export type WalletTransactionDirection = "credit" | "debit";
export type WalletTransactionKind =
  | "deposit"
  | "withdrawal"
  | "transfer_sent"
  | "transfer_received"
  | "marketplace_purchase"
  | "marketplace_sale"
  | "marketplace_commission"
  | "marketplace_refund"
  | "marketplace_reversal"
  | "advertising_debit"
  | "advertising_credit"
  | "gift_sent"
  | "gift_received"
  | "reward"
  | "content_purchase"
  | "content_sale"
  | "subscription_payment"
  | "subscription_income"
  | "premium_dm_sent"
  | "premium_dm_received"
  | "fee"
  | "other_credit"
  | "other_debit";

export interface WalletTransactionPresentation {
  kind: WalletTransactionKind;
  label: string;
  description: string;
  reference: string | null;
  direction: WalletTransactionDirection;
  amount: number;
  signedAmount: number;
}

export class WalletTransactionPresentationError extends Error {
  readonly code: string;
}

export function presentLedgerTransaction(
  value: Record<string, unknown>,
  accountId: string,
): WalletTransactionPresentation;
export function presentLegacyWalletTransaction(
  value: Record<string, unknown>,
): WalletTransactionPresentation;
