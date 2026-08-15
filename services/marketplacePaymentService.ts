import { getSupabaseClient } from "@/template";
import {rpcArray,rpcBoolean,rpcEnum,rpcNonnegative,rpcNonnegativeInteger,rpcObject,
  rpcString,rpcTimestamp,rpcUuid} from "@/services/marketplaceRuntimeValidation";

const paymentOrderStatuses = [
  "pending_payment","confirmed","processing","shipped","delivered",
  "cancelled","expired","refunded","partially_refunded",
] as const;

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
  status: (typeof paymentOrderStatuses)[number];
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
  try{return rpcNonnegative(value,'payment.money');}catch{throw new MarketplacePaymentError("marketplace_payment_unknown");}
};

export const parseMarketplacePaymentReceipt = (value: unknown): MarketplacePaymentReceipt => {
 try{
  const root=rpcObject(value,'payment_receipt'),payment=rpcObject(root.payment,'payment_receipt.payment'),checkout=rpcObject(root.checkout,'payment_receipt.checkout'),buyer=rpcObject(root.buyer,'payment_receipt.buyer'),inventory=rpcObject(root.inventory,'payment_receipt.inventory');
  return {
    payment: {
      id: rpcUuid(payment.id,'payment_receipt.payment.id'),
      checkoutId: rpcUuid(payment.checkout_id,'payment_receipt.payment.checkout_id'),
      status: rpcEnum(payment.status,['paid']as const,'payment_receipt.payment.status'),
      currency: rpcEnum(payment.currency,['BDAG']as const,'payment_receipt.payment.currency'),
      grossAmount: finite(payment.gross_amount),
      escrowAmount: finite(payment.escrow_amount),
      feeBps: rpcNonnegativeInteger(payment.fee_bps,'payment_receipt.payment.fee_bps'),
      financialTransactionId: rpcUuid(payment.financial_transaction_id,'payment_receipt.payment.financial_transaction_id'),
      paidAt: rpcTimestamp(payment.paid_at,'payment_receipt.payment.paid_at'),
    },
    checkout: {
      id: rpcUuid(checkout.id,'payment_receipt.checkout.id'),
      reference: rpcString(checkout.reference,'payment_receipt.checkout.reference'),
      status: rpcEnum(checkout.status,['paid']as const,'payment_receipt.checkout.status'),
      total: finite(checkout.total),
      currency: rpcEnum(checkout.currency,['BDAG']as const,'payment_receipt.checkout.currency'),
    },
    buyer: { newBdagBalance: finite(buyer.new_bdag_balance) },
    orders: rpcArray(root.orders,'payment_receipt.orders').map((raw,index) => {
      const order=rpcObject(raw,`payment_receipt.orders[${index}]`);
      return {
        id: rpcUuid(order.id,`payment_receipt.orders[${index}].id`),
        orderNumber: rpcString(order.order_number,`payment_receipt.orders[${index}].order_number`),
        status: rpcEnum(order.status,paymentOrderStatuses,`payment_receipt.orders[${index}].status`),
        grossAmount: finite(order.gross_amount),
        platformFeeAmount: finite(order.platform_fee_amount),
        sellerNetAmount: finite(order.seller_net_amount),
        allocationStatus: rpcEnum(order.allocation_status,["held","released","partially_refunded","refunded"]as const,`payment_receipt.orders[${index}].allocation_status`),
      };
    }),
    inventory: {
      consumedReservations: rpcNonnegativeInteger(inventory.consumed_reservations,'payment_receipt.inventory.consumed_reservations'),
      unitsConsumed: rpcNonnegativeInteger(inventory.units_consumed,'payment_receipt.inventory.units_consumed'),
    },
  };
 }catch(error){if(error instanceof MarketplacePaymentError)throw error;throw new MarketplacePaymentError("marketplace_payment_unknown");}
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
    const envelope=rpcObject(data,"payment_edge_envelope"),
      success=rpcBoolean(envelope.success,"payment_edge_envelope.success");
    if (success === false) {
      const code =
        typeof envelope.error === "string" && codes.includes(envelope.error as MarketplacePaymentErrorCode)
        ? (envelope.error as MarketplacePaymentErrorCode)
        : "marketplace_payment_unknown";
      if (__DEV__)
        console.warn("[MarketplacePayment] rpc_failed", {
          postgresCode: envelope.postgres_code ?? null,
          marketplaceCode: code,
        });
      throw new MarketplacePaymentError(code);
    }
    const receipt = parseMarketplacePaymentReceipt(envelope.data);
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
  return finite(data);
}
