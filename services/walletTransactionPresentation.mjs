export class WalletTransactionPresentationError extends Error {
  constructor(code) {
    super(code);
    this.name = "WalletTransactionPresentationError";
    this.code = code;
  }
}

const requiredString = (value, code) => {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new WalletTransactionPresentationError(code);
  return value;
};

const amount = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new WalletTransactionPresentationError("wallet_transaction_amount_invalid");
  return parsed;
};

const reference = (referenceType, referenceId) => {
  if (!referenceType || !referenceId) return null;
  const suffix = String(referenceId).replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase();
  if (!suffix) return null;
  if (referenceType === "marketplace_order") return `Pedido · #${suffix}`;
  if (referenceType === "marketplace_checkout") return `Checkout · #${suffix}`;
  if (referenceType === "marketplace_ad_campaign") return `Campaña · #${suffix}`;
  if (referenceType === "deposit_confirmation") return `Depósito · #${suffix}`;
  return null;
};

const classify = (operationType, direction) => {
  const incoming = direction === "credit";
  switch (operationType) {
    case "deposit":
      return { kind: "deposit", label: "Depósito", description: "Crédito confirmado" };
    case "withdrawal":
      return { kind: "withdrawal", label: "Retiro", description: "Retiro de créditos BDAG" };
    case "transfer":
      return incoming
        ? { kind: "transfer_received", label: "Transferencia recibida", description: "Transferencia entre usuarios" }
        : { kind: "transfer_sent", label: "Transferencia enviada", description: "Transferencia entre usuarios" };
    case "marketplace_payment_capture":
      return { kind: "marketplace_purchase", label: "Compra Marketplace", description: "Pago de Marketplace" };
    case "marketplace_seller_settlement":
      return { kind: "marketplace_sale", label: "Venta Marketplace", description: "Liquidación de venta" };
    case "marketplace_creator_commission_settlement":
      return { kind: "marketplace_commission", label: "Comisión Marketplace", description: "Comisión de Creator Commerce" };
    case "marketplace_dispute_refund":
    case "marketplace_post_settlement_refund":
    case "marketplace_fixture_escrow_refund":
      return { kind: "marketplace_refund", label: "Reembolso", description: "Reembolso Marketplace" };
    case "marketplace_seller_settlement_reversal":
    case "marketplace_creator_commission_reversal":
    case "marketplace_platform_fee_reversal":
      return { kind: "marketplace_reversal", label: "Reversión Marketplace", description: "Ajuste por reversión" };
    case "marketplace_ad_fund":
      return { kind: "advertising_debit", label: "Fondos para anuncios", description: "Presupuesto Marketplace Ads" };
    case "marketplace_ad_release":
      return { kind: "advertising_credit", label: "Devolución de anuncios", description: "Presupuesto no utilizado" };
    case "live_gift":
    case "gift":
      return incoming
        ? { kind: "gift_received", label: "Regalo recibido", description: "Regalo LIVE" }
        : { kind: "gift_sent", label: "Regalo enviado", description: "Regalo LIVE" };
    case "reward":
      return { kind: "reward", label: "Recompensa", description: "Crédito de recompensa" };
    case "content_purchase":
      return incoming
        ? { kind: "content_sale", label: "Venta de contenido", description: "Contenido exclusivo" }
        : { kind: "content_purchase", label: "Compra de contenido", description: "Contenido exclusivo" };
    case "subscription":
      return incoming
        ? { kind: "subscription_income", label: "Suscripción recibida", description: "Ingreso de suscripción" }
        : { kind: "subscription_payment", label: "Suscripción", description: "Pago de suscripción" };
    case "premium_dm":
      return incoming
        ? { kind: "premium_dm_received", label: "Ingreso Premium DM", description: "Mensaje Premium" }
        : { kind: "premium_dm_sent", label: "Premium DM", description: "Pago de mensaje Premium" };
    case "boost":
      return { kind: "fee", label: "Tarifa / Comisión", description: "Promoción de contenido" };
    default:
      return incoming
        ? { kind: "other_credit", label: "Otro movimiento", description: "Crédito BDAG" }
        : { kind: "other_debit", label: "Otro movimiento", description: "Débito BDAG" };
  }
};

export function presentLedgerTransaction(value, accountId) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new WalletTransactionPresentationError("wallet_transaction_invalid");
  const currentAccountId = requiredString(accountId, "wallet_account_id_invalid");
  const fromAccountId = value.from_account_id ?? null;
  const toAccountId = value.to_account_id ?? null;
  const isDebit = fromAccountId === currentAccountId;
  const isCredit = toAccountId === currentAccountId;
  if (isDebit === isCredit)
    throw new WalletTransactionPresentationError("wallet_transaction_direction_unknown");
  const direction = isCredit ? "credit" : "debit";
  const canonicalAmount = amount(value.amount);
  const operationType = requiredString(
    value.operation_type,
    "wallet_transaction_operation_invalid",
  );
  const presentation = classify(operationType, direction);
  const safeReference = reference(value.reference_type, value.reference_id);
  return {
    ...presentation,
    direction,
    amount: canonicalAmount,
    signedAmount: direction === "credit" ? canonicalAmount : -canonicalAmount,
    description: safeReference
      ? `${presentation.description} · ${safeReference}`
      : presentation.description,
    reference: safeReference,
  };
}

export function presentLegacyWalletTransaction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new WalletTransactionPresentationError("wallet_transaction_invalid");
  const legacyType = requiredString(value.type, "wallet_transaction_operation_invalid");
  const legacyDirection = {
    deposit: "credit",
    reward: "credit",
    transfer_received: "credit",
    withdraw: "debit",
    withdrawal: "debit",
    transfer_sent: "debit",
  }[legacyType];
  if (!legacyDirection)
    throw new WalletTransactionPresentationError("wallet_transaction_direction_unknown");
  const operationType =
    legacyType === "withdraw" ? "withdrawal" : legacyType.startsWith("transfer_") ? "transfer" : legacyType;
  const canonicalAmount = amount(value.amount);
  const presentation = classify(operationType, legacyDirection);
  return {
    ...presentation,
    direction: legacyDirection,
    amount: canonicalAmount,
    signedAmount: legacyDirection === "credit" ? canonicalAmount : -canonicalAmount,
    description:
      typeof value.description === "string" && value.description.trim()
        ? value.description.trim()
        : presentation.description,
    reference: null,
  };
}
