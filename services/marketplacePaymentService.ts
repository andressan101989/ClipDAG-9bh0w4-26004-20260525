import { getSupabaseClient } from "@/template";

export type MarketplacePaymentErrorCode =
  | "marketplace_auth_required"
  | "marketplace_permission_denied"
  | "marketplace_checkout_not_found"
  | "marketplace_checkout_not_payable"
  | "marketplace_checkout_cancelled"
  | "marketplace_checkout_expired"
  | "marketplace_checkout_integrity_error"
  | "marketplace_insufficient_inventory"
  | "marketplace_product_unavailable"
  | "marketplace_insufficient_bdag_balance"
  | "marketplace_payment_idempotency_conflict"
  | "marketplace_payment_already_processed"
  | "marketplace_payment_transport"
  | "marketplace_payment_unknown";

export interface MarketplacePaymentOrderAllocation {
  id: string;
  orderNumber: string;
  status: string;
  grossAmount: number;
  platformFeeAmount: number;
  sellerNetAmount: number;
  allocationStatus: "held" | "released" | "partially_refunded" | "refunded";
}

export interface MarketplacePaymentReceipt {
  payment: {
    id: string;
    checkoutId: string;
    status: "paid";
    currency: "BDAG";
    grossAmount: number;
    escrowAmount: number;
    feeBps: number;
    financialTransactionId: string;
    paidAt: string;
  };
  checkout: {
    id: string;
    reference: string;
    status: "paid";
    total: number;
    currency: "BDAG";
  };
  buyer: { newBdagBalance: number };
  orders: MarketplacePaymentOrderAllocation[];
  inventory: { consumedReservations: number; unitsConsumed: number };
}

const codes: MarketplacePaymentErrorCode[] = [
  "marketplace_auth_required",
  "marketplace_permission_denied",
  "marketplace_checkout_not_found",
  "marketplace_checkout_not_payable",
  "marketplace_checkout_cancelled",
  "marketplace_checkout_expired",
  "marketplace_checkout_integrity_error",
  "marketplace_insufficient_inventory",
  "marketplace_product_unavailable",
  "marketplace_insufficient_bdag_balance",
  "marketplace_payment_idempotency_conflict",
  "marketplace_payment_already_processed",
];

export class MarketplacePaymentError extends Error {
  constructor(
    public code: MarketplacePaymentErrorCode,
    public required?: number,
    public available?: number,
  ) {
    super(code);
    this.name = "MarketplacePaymentError";
  }
}

const finite = (value: unknown) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0)
    throw new MarketplacePaymentError("marketplace_payment_unknown");
  return number;
};

const mapReceipt = (value: unknown): MarketplacePaymentReceipt => {
  if (!value || typeof value !== "object")
    throw new MarketplacePaymentError("marketplace_payment_unknown");
  const root = value as Record<string, unknown>;
  const payment = root.payment as Record<string, unknown>;
  const checkout = root.checkout as Record<string, unknown>;
  const buyer = root.buyer as Record<string, unknown>;
  if (
    !payment ||
    !checkout ||
    !buyer ||
    payment.currency !== "BDAG" ||
    checkout.currency !== "BDAG" ||
    payment.status !== "paid" ||
    checkout.status !== "paid" ||
    !Array.isArray(root.orders)
  )
    throw new MarketplacePaymentError("marketplace_payment_unknown");
  return {
    payment: {
      id: String(payment.id),
      checkoutId: String(payment.checkout_id),
      status: "paid",
      currency: "BDAG",
      grossAmount: finite(payment.gross_amount),
      escrowAmount: finite(payment.escrow_amount),
      feeBps: finite(payment.fee_bps),
      financialTransactionId: String(payment.financial_transaction_id),
      paidAt: String(payment.paid_at),
    },
    checkout: {
      id: String(checkout.id),
      reference: String(checkout.reference),
      status: "paid",
      total: finite(checkout.total),
      currency: "BDAG",
    },
    buyer: { newBdagBalance: finite(buyer.new_bdag_balance) },
    orders: root.orders.map((raw) => {
      const order = raw as Record<string, unknown>;
      return {
        id: String(order.id),
        orderNumber: String(order.order_number),
        status: String(order.status),
        grossAmount: finite(order.gross_amount),
        platformFeeAmount: finite(order.platform_fee_amount),
        sellerNetAmount: finite(order.seller_net_amount),
        allocationStatus: String(order.allocation_status) as MarketplacePaymentOrderAllocation["allocationStatus"],
      };
    }),
    inventory: {
      consumedReservations: finite(
        (root.inventory as Record<string, unknown>)?.consumed_reservations,
      ),
      unitsConsumed: finite(
        (root.inventory as Record<string, unknown>)?.units_consumed,
      ),
    },
  };
};

export async function payMarketplaceCheckout(
  checkoutId: string,
  idempotencyKey: string,
): Promise<MarketplacePaymentReceipt> {
  const checkoutFingerprint = checkoutId.slice(0, 8);
  if (__DEV__)
    console.log("[MarketplacePayment] rpc_start", { checkoutFingerprint });
  try {
    const { data, error } = await getSupabaseClient().functions.invoke(
      "bdag-ledger",
      {
        body: {
          action: "marketplace_checkout_pay",
          checkout_id: checkoutId,
          idempotency_key: idempotencyKey,
        },
      },
    );
    if (error) {
      const response = (error as { context?: unknown }).context;
      if (response instanceof Response) {
        const payload = await response.clone().json().catch(() => null);
        const code = codes.includes(payload?.error)
          ? (payload.error as MarketplacePaymentErrorCode)
          : "marketplace_payment_unknown";
        if (__DEV__)
          console.warn("[MarketplacePayment] rpc_failed", {
            postgresCode: payload?.postgres_code ?? null,
            marketplaceCode: code,
          });
        throw new MarketplacePaymentError(code);
      }
      throw error;
    }
    if (!data?.success) {
      const code = codes.includes(data?.error)
        ? (data.error as MarketplacePaymentErrorCode)
        : "marketplace_payment_unknown";
      if (__DEV__)
        console.warn("[MarketplacePayment] rpc_failed", {
          postgresCode: data?.postgres_code ?? null,
          marketplaceCode: code,
        });
      throw new MarketplacePaymentError(code);
    }
    const receipt = mapReceipt(data.data);
    if (__DEV__)
      console.log("[MarketplacePayment] rpc_success", {
        orderCount: receipt.orders.length,
      });
    return receipt;
  } catch (error) {
    if (error instanceof MarketplacePaymentError) throw error;
    const message = error instanceof Error ? error.message : "";
    const transport = /network request failed|failed to fetch|fetch failed|networkerror/i.test(
      message,
    );
    const code = transport
      ? "marketplace_payment_transport"
      : "marketplace_payment_unknown";
    if (__DEV__)
      console.warn("[MarketplacePayment] rpc_failed", {
        postgresCode: null,
        marketplaceCode: code,
      });
    throw new MarketplacePaymentError(code);
  }
}

export async function fetchAuthoritativeBdagBalance(): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc("get_bdag_wallet_balance");
  if (error) throw error;
  return finite(data ?? 0);
}
