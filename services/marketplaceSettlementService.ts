import { getSupabaseClient } from "@/template";
import {
  rpcBoolean,
  rpcEnum,
  rpcNonnegative,
  rpcObject,
  rpcString,
  rpcTimestamp,
  rpcUuid,
} from "./marketplaceRuntimeValidation";

export type MarketplaceSettlementErrorCode =
  | "marketplace_delivery_invalid_input"
  | "marketplace_order_not_found"
  | "marketplace_order_not_owned"
  | "marketplace_order_not_shipped"
  | "marketplace_shipment_not_shipped"
  | "marketplace_order_not_paid"
  | "marketplace_allocation_not_held"
  | "marketplace_settlement_integrity_error"
  | "marketplace_settlement_idempotency_conflict"
  | "marketplace_escrow_insufficient_balance"
  | "marketplace_settlement_rate_limited"
  | "marketplace_dispute_invalid_input"
  | "marketplace_dispute_order_state_conflict"
  | "marketplace_dispute_settlement_completed"
  | "marketplace_dispute_idempotency_conflict"
  | "marketplace_settlement_transport"
  | "marketplace_settlement_unknown";
export interface MarketplaceSettlementReceipt {
  settlement: {
    id: string;
    status: "completed";
    orderId: string;
    currency: "BDAG";
    grossAmount: number;
    confirmedAt: string;
    releasedAt: string;
  };
  order: { id: string; status: "delivered"; deliveredAt: string };
  shipment: { status: "delivered"; deliveredAt: string };
  allocation: { status: "released"; releasedAt: string };
}
export class MarketplaceSettlementError extends Error {
  constructor(public code: MarketplaceSettlementErrorCode) {
    super(code);
    this.name = "MarketplaceSettlementError";
  }
}
export type MarketplaceDisputeFinalOutcome =
  | "refund_buyer"
  | "release_seller"
  | "reject_claim";
export type MarketplaceDisputeResolutionOutcome =
  | MarketplaceDisputeFinalOutcome
  | "manual_review";
export type MarketplaceDisputeReviewAction =
  | "manual_review_requested"
  | "escalated";
export type MarketplaceDisputeResolutionErrorCode =
  | "marketplace_dispute_not_found"
  | "marketplace_dispute_not_open"
  | "marketplace_dispute_already_resolved"
  | "marketplace_dispute_conflicting_decision"
  | "marketplace_refund_allocation_not_held"
  | "marketplace_refund_requires_manual_review"
  | "marketplace_partial_refund_unsupported"
  | "marketplace_refund_reconciliation_failed"
  | "marketplace_dispute_resolution_forbidden"
  | "marketplace_dispute_resolution_auth_required"
  | "marketplace_refund_payment_not_paid"
  | "marketplace_refund_order_state_invalid"
  | "marketplace_refund_already_completed"
  | "marketplace_dispute_resolution_invalid_input"
  | "marketplace_dispute_resolution_transport"
  | "marketplace_dispute_resolution_unknown";
export interface SupportMarketplaceDisputeDetail {
  dispute: {
    id: string;
    status: string;
    reasonCode: string;
    createdAt: string;
  };
  order: { id: string; status: string };
  payment: { status: string; grossAmount: number };
  allocation: {
    status: string;
    grossAmount: number;
    sellerNetAmount: number;
    creatorCommissionAmount: number;
    platformFeeAmount: number;
  };
}
export interface MarketplaceDisputeFinalResolutionResult {
  kind: "final_resolution";
  finalDecision: {
    id: string;
    disputeId: string;
    orderId: string;
    outcome: MarketplaceDisputeFinalOutcome;
    reasonCode: string;
    financialResult: Record<string, unknown>;
    decidedAt: string;
  };
  dispute: { status: string; resolvedAt: string };
  order: { status: string };
  payment: { status: string; grossAmount: number };
  allocation: {
    status: string;
    grossAmount: number;
    sellerNetAmount: number;
    creatorCommissionAmount: number;
    platformFeeAmount: number;
  };
}
export interface MarketplaceDisputeIntermediateReviewResult {
  kind: "intermediate_review";
  finalDecision: null;
  reviewAction: {
    id: string;
    disputeId: string;
    orderId: string;
    action: MarketplaceDisputeReviewAction;
    reasonCode: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  };
  dispute: { status: "under_review"; resolvedAt: null };
  moneyMoved: false;
  requiresHumanFollowUp: true;
}
export type MarketplaceDisputeResolutionResult =
  | MarketplaceDisputeFinalResolutionResult
  | MarketplaceDisputeIntermediateReviewResult;
export class MarketplaceDisputeResolutionError extends Error {
  constructor(
    public code: MarketplaceDisputeResolutionErrorCode,
    public postgresCode: string | null = null,
  ) {
    super(code);
    this.name = "MarketplaceDisputeResolutionError";
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const known: MarketplaceSettlementErrorCode[] = [
  "marketplace_delivery_invalid_input",
  "marketplace_order_not_found",
  "marketplace_order_not_owned",
  "marketplace_order_not_shipped",
  "marketplace_shipment_not_shipped",
  "marketplace_order_not_paid",
  "marketplace_allocation_not_held",
  "marketplace_settlement_integrity_error",
  "marketplace_settlement_idempotency_conflict",
  "marketplace_escrow_insufficient_balance",
  "marketplace_settlement_rate_limited",
];
const disputeCodes: MarketplaceSettlementErrorCode[] = [
  "marketplace_dispute_invalid_input",
  "marketplace_order_not_found",
  "marketplace_order_not_owned",
  "marketplace_dispute_order_state_conflict",
  "marketplace_dispute_settlement_completed",
  "marketplace_dispute_idempotency_conflict",
];
const resolutionCodes: MarketplaceDisputeResolutionErrorCode[] = [
  "marketplace_dispute_not_found",
  "marketplace_dispute_not_open",
  "marketplace_dispute_already_resolved",
  "marketplace_dispute_conflicting_decision",
  "marketplace_refund_allocation_not_held",
  "marketplace_refund_requires_manual_review",
  "marketplace_partial_refund_unsupported",
  "marketplace_refund_reconciliation_failed",
  "marketplace_dispute_resolution_forbidden",
  "marketplace_dispute_resolution_auth_required",
  "marketplace_refund_payment_not_paid",
  "marketplace_refund_order_state_invalid",
  "marketplace_refund_already_completed",
  "marketplace_dispute_resolution_invalid_input",
];
const disputeStatuses = [
  "open",
  "under_review",
  "resolved",
  "rejected",
  "cancelled",
] as const;
const orderStatuses = [
  "confirmed",
  "processing",
  "shipped",
  "delivered",
  "refunded",
  "partially_refunded",
] as const;
const paymentStatuses = [
  "paid",
  "partially_refunded",
  "refunded",
] as const;
const allocationStatuses = [
  "held",
  "released",
  "partially_refunded",
  "refunded",
] as const;

export function parseMarketplaceSettlementReceipt(
  value: unknown,
): MarketplaceSettlementReceipt {
  try {
    const root = rpcObject(value, "settlement_receipt"),
      s = rpcObject(root.settlement, "settlement_receipt.settlement"),
      o = rpcObject(root.order, "settlement_receipt.order"),
      shipment = rpcObject(root.shipment, "settlement_receipt.shipment"),
      allocation = rpcObject(root.allocation, "settlement_receipt.allocation");
    return {
      settlement: {
        id: rpcUuid(s.id, "settlement_receipt.settlement.id"),
        status: rpcEnum(
          s.status,
          ["completed"] as const,
          "settlement_receipt.settlement.status",
        ),
        orderId: rpcUuid(s.order_id, "settlement_receipt.settlement.order_id"),
        currency: rpcEnum(
          s.currency,
          ["BDAG"] as const,
          "settlement_receipt.settlement.currency",
        ),
        grossAmount: rpcNonnegative(
          s.gross_amount,
          "settlement_receipt.settlement.gross_amount",
        ),
        confirmedAt: rpcTimestamp(
          s.confirmed_at,
          "settlement_receipt.settlement.confirmed_at",
        ),
        releasedAt: rpcTimestamp(
          s.released_at,
          "settlement_receipt.settlement.released_at",
        ),
      },
      order: {
        id: rpcUuid(o.id, "settlement_receipt.order.id"),
        status: rpcEnum(
          o.status,
          ["delivered"] as const,
          "settlement_receipt.order.status",
        ),
        deliveredAt: rpcTimestamp(
          o.delivered_at,
          "settlement_receipt.order.delivered_at",
        ),
      },
      shipment: {
        status: rpcEnum(
          shipment.status,
          ["delivered"] as const,
          "settlement_receipt.shipment.status",
        ),
        deliveredAt: rpcTimestamp(
          shipment.delivered_at,
          "settlement_receipt.shipment.delivered_at",
        ),
      },
      allocation: {
        status: rpcEnum(
          allocation.status,
          ["released"] as const,
          "settlement_receipt.allocation.status",
        ),
        releasedAt: rpcTimestamp(
          allocation.released_at,
          "settlement_receipt.allocation.released_at",
        ),
      },
    };
  } catch {
    throw new MarketplaceSettlementError("marketplace_settlement_unknown");
  }
}

export async function confirmMarketplaceOrderDelivery(
  orderId: string,
  idempotencyKey: string,
): Promise<MarketplaceSettlementReceipt> {
  if (!UUID.test(orderId) || !UUID.test(idempotencyKey))
    throw new MarketplaceSettlementError("marketplace_delivery_invalid_input");
  try {
    const { data, error } = await getSupabaseClient().functions.invoke(
      "bdag-ledger",
      {
        body:{action:'marketplace_order_confirm_delivery',order_id:orderId,idempotency_key:idempotencyKey},
      },
    );
    if (error) {
      const response = (error as { context?: unknown }).context;
      if (response instanceof Response) {
        const payload = await response
          .clone()
          .json()
          .catch(() => null);
        const code = known.includes(payload?.error)
          ? (payload.error as MarketplaceSettlementErrorCode)
          : "marketplace_settlement_unknown";
        throw new MarketplaceSettlementError(code);
      }
      throw error;
    }
    const envelope = rpcObject(data, "settlement_edge_envelope"),
      success = rpcBoolean(envelope.success, "settlement_edge_envelope.success");
    if (success === false) {
      const code =
        typeof envelope.error === "string" && known.includes(envelope.error as MarketplaceSettlementErrorCode)
        ? (envelope.error as MarketplaceSettlementErrorCode)
        : "marketplace_settlement_unknown";
      throw new MarketplaceSettlementError(code);
    }
    return parseMarketplaceSettlementReceipt(envelope.data);
  } catch (error) {
    if (error instanceof MarketplaceSettlementError) throw error;
    const message = error instanceof Error ? error.message : "";
    const transport =
      /network|fetch|timeout|timed out|connection|socket|offline/i.test(
        message,
      );
    if (__DEV__)
      console.error("[MarketplaceSettlement] gateway failed", {
        action: "marketplace_order_confirm_delivery",
        code: transport ? "transport" : "unknown",
        message: message.slice(0, 200),
      });
    throw new MarketplaceSettlementError(
      transport
        ? "marketplace_settlement_transport"
        : "marketplace_settlement_unknown",
    );
  }
}

export function parseMarketplaceProblemReceipt(value: unknown): {
  status: string;
  reasonCode: string;
  settlementBlocked: true;
  createdAt: string;
} {
  try {
    const row = rpcObject(value, "problem_receipt");
    if (
      rpcBoolean(
        row.settlement_blocked,
        "problem_receipt.settlement_blocked",
      ) !== true
    )
      throw new Error("not_blocked");
    return {
      status: rpcEnum(
        row.status,
        ["open", "under_review"] as const,
        "problem_receipt.status",
      ),
      reasonCode: rpcEnum(
        row.reason_code,
        [
          "not_received",
          "damaged",
          "incorrect_item",
          "missing_items",
          "other",
        ] as const,
        "problem_receipt.reason_code",
      ),
      settlementBlocked: true,
      createdAt: rpcTimestamp(row.created_at, "problem_receipt.created_at"),
    };
  } catch {
    throw new MarketplaceSettlementError("marketplace_settlement_unknown");
  }
}
export async function reportMarketplaceOrderProblem(
  orderId: string,
  reasonCode:
    | "not_received"
    | "damaged"
    | "incorrect_item"
    | "missing_items"
    | "other",
  buyerNote: string,
  idempotencyKey: string,
  orderItemIds: string[],
  evidenceAssetIds: string[],
): Promise<{
  status: string;
  reasonCode: string;
  settlementBlocked: true;
  createdAt: string;
}> {
  if (
    !UUID.test(orderId) ||
    !UUID.test(idempotencyKey) ||
    orderItemIds.length < 1 ||
    orderItemIds.length > 100 ||
    evidenceAssetIds.length > 6 ||
    orderItemIds.some((id) => !UUID.test(id)) ||
    evidenceAssetIds.some((id) => !UUID.test(id))
  )
    throw new MarketplaceSettlementError("marketplace_dispute_invalid_input");
  const { data, error } = await getSupabaseClient().rpc(
    "report_marketplace_order_problem",
    {
      p_order_id: orderId,
      p_reason_code: reasonCode,
      p_buyer_note: buyerNote.trim() || null,
      p_idempotency_key: idempotencyKey,
      p_order_item_ids: orderItemIds,
      p_evidence_asset_ids: evidenceAssetIds,
    },
  );
  if (error) {
    const code = (error.message ?? "").match(/marketplace_[a-z_]+/)?.[0] as
      | MarketplaceSettlementErrorCode
      | undefined;
    throw new MarketplaceSettlementError(
      code && disputeCodes.includes(code)
        ? code
        : "marketplace_settlement_unknown",
    );
  }
  return parseMarketplaceProblemReceipt(data);
}

function resolutionCode(error: unknown): MarketplaceDisputeResolutionErrorCode {
  const source =
      error && typeof error === "object"
        ? (error as Record<string, unknown>)
        : {},
    context =
      source.context && typeof source.context === "object"
        ? (source.context as Record<string, unknown>)
        : {},
    body =
      context.body && typeof context.body === "object"
        ? (context.body as Record<string, unknown>)
        : {};
  const text = [source.error,source.message,source.details,source.hint,context.message,body.error]
    .filter((value) => typeof value === "string")
    .join(" ");
  return (
    resolutionCodes.find((code) => text.includes(code)) ??
    (/network|fetch|timeout|connection|socket|offline/i.test(text)
      ? "marketplace_dispute_resolution_transport"
      : "marketplace_dispute_resolution_unknown")
  );
}

export function parseSupportMarketplaceDispute(
  value: unknown,
): SupportMarketplaceDisputeDetail {
  try {
    const root = rpcObject(value, "support_dispute"),
      d = rpcObject(root.dispute, "support_dispute.dispute"),
      o = rpcObject(root.order, "support_dispute.order"),
      p = rpcObject(root.payment, "support_dispute.payment"),
      a = rpcObject(root.allocation, "support_dispute.allocation");
    return {
      dispute: {
        id: rpcUuid(d.id, "support_dispute.dispute.id"),
        status: rpcEnum(
          d.status,
          disputeStatuses,
          "support_dispute.dispute.status",
        ),
        reasonCode: rpcString(
          d.reason_code,
          "support_dispute.dispute.reason_code",
        ),
        createdAt: rpcTimestamp(
          d.created_at,
          "support_dispute.dispute.created_at",
        ),
      },
      order: {
        id: rpcUuid(o.id, "support_dispute.order.id"),
        status: rpcEnum(
          o.status,
          orderStatuses,
          "support_dispute.order.status",
        ),
      },
      payment: {
        status: rpcEnum(
          p.status,
          paymentStatuses,
          "support_dispute.payment.status",
        ),
        grossAmount: rpcNonnegative(
          p.gross_amount,
          "support_dispute.payment.gross_amount",
        ),
      },
      allocation: {
        status: rpcEnum(
          a.status,
          allocationStatuses,
          "support_dispute.allocation.status",
        ),
        grossAmount: rpcNonnegative(
          a.gross_amount,
          "support_dispute.allocation.gross_amount",
        ),
        sellerNetAmount: rpcNonnegative(
          a.seller_net_amount,
          "support_dispute.allocation.seller_net_amount",
        ),
        creatorCommissionAmount: rpcNonnegative(
          a.creator_commission_amount,
          "support_dispute.allocation.creator_commission_amount",
        ),
        platformFeeAmount: rpcNonnegative(
          a.platform_fee_amount,
          "support_dispute.allocation.platform_fee_amount",
        ),
      },
    };
  } catch {
    throw new MarketplaceDisputeResolutionError(
      "marketplace_dispute_resolution_unknown",
    );
  }
}

function validateFinancialResult(
  value: unknown,
  outcome: MarketplaceDisputeFinalOutcome,
): Record<string, unknown> {
  const result = rpcObject(value, "resolution.finalDecision.financial_result"),
    moved = rpcBoolean(
      result.money_moved,
      "resolution.finalDecision.financial_result.money_moved",
    );
  if (outcome === "refund_buyer") {
    if (!moved) throw new Error("refund_money_moved");
    if (result.reversal_id !== undefined) {
      rpcUuid(result.reversal_id, "resolution.financial_result.reversal_id");
      rpcUuid(
        result.buyer_refund_transaction_id,
        "resolution.financial_result.buyer_refund_transaction_id",
      );
      rpcNonnegative(
        result.gross_refund_amount,
        "resolution.financial_result.gross_refund_amount",
      );
    } else {
      rpcUuid(
        result.financial_transaction_id,
        "resolution.financial_result.financial_transaction_id",
      );
      rpcNonnegative(
        result.refund_amount,
        "resolution.financial_result.refund_amount",
      );
      for (const key of [
        "seller_allocation",
        "creator_allocation",
        "platform_allocation",
      ])
        rpcEnum(
          result[key],
          ["refunded"] as const,
          `resolution.financial_result.${key}`,
        );
    }
  } else if (outcome === "release_seller") {
    if (!moved) throw new Error("release_money_moved");
    const release = rpcObject(
        result.settlement,
        "resolution.financial_result.settlement",
      ),
      settlement = rpcObject(
        release.settlement,
        "resolution.financial_result.settlement.settlement",
      );
    rpcUuid(
      settlement.id,
      "resolution.financial_result.settlement.settlement.id",
    );
    rpcEnum(
      settlement.status,
      ["released", "completed"] as const,
      "resolution.financial_result.settlement.settlement.status",
    );
    rpcTimestamp(
      settlement.released_at,
      "resolution.financial_result.settlement.settlement.released_at",
    );
    const releaseMoved = rpcBoolean(
      release.money_moved,
      "resolution.financial_result.settlement.money_moved",
    );
    if (release.already_released === true) {
      if (releaseMoved) throw new Error("already_released_money");
    } else {
      const allocation = rpcObject(
        release.allocation,
        "resolution.financial_result.settlement.allocation",
      );
      rpcEnum(
        allocation.status,
        ["released"] as const,
        "resolution.financial_result.settlement.allocation.status",
      );
      if (allocation.gross_amount !== undefined)
        rpcNonnegative(
          allocation.gross_amount,
          "resolution.financial_result.settlement.allocation.gross_amount",
        );
      else
        rpcTimestamp(
          allocation.released_at,
          "resolution.financial_result.settlement.allocation.released_at",
        );
      rpcString(
        release.actor_role,
        "resolution.financial_result.settlement.actor_role",
      );
    }
  } else if (
    moved ||
    rpcBoolean(
      result.settlement_eligible,
      "resolution.financial_result.settlement_eligible",
    ) !== true
  )
    throw new Error("reject_result");
  return result;
}

export function parseMarketplaceDisputeResolution(
  value: unknown,
): MarketplaceDisputeResolutionResult {
  try {
    const root = rpcObject(value, "resolution"),
      dispute = rpcObject(root.dispute, "resolution.dispute");
    if (root.kind==='intermediate_review') {
      const action = rpcObject(root.reviewAction, "resolution.reviewAction");
      if (
        root.finalDecision !== null ||
        dispute.status !== "under_review" ||
        dispute.resolved_at !== null ||
        root.moneyMoved !== false ||
        root.requiresHumanFollowUp !== true
      )
        throw new Error("review_shape");
      return {
        kind: "intermediate_review",
        finalDecision: null,
        reviewAction: {
          id: rpcUuid(action.id, "resolution.reviewAction.id"),
          disputeId: rpcUuid(
            action.dispute_id,
            "resolution.reviewAction.dispute_id",
          ),
          orderId: rpcUuid(action.order_id, "resolution.reviewAction.order_id"),
          action: rpcEnum(
            action.action,
            ["manual_review_requested", "escalated"] as const,
            "resolution.reviewAction.action",
          ),
          reasonCode: rpcString(
            action.reason_code,
            "resolution.reviewAction.reason_code",
          ),
          metadata: rpcObject(
            action.metadata,
            "resolution.reviewAction.metadata",
          ),
          createdAt: rpcTimestamp(
            action.created_at,
            "resolution.reviewAction.created_at",
          ),
        },
        dispute: { status: "under_review", resolvedAt: null },
        moneyMoved: false,
        requiresHumanFollowUp: true,
      };
    }
    if (root.kind !== "final_resolution") throw new Error("kind");
    const decision = rpcObject(root.finalDecision, "resolution.finalDecision"),
      order = rpcObject(root.order, "resolution.order"),
      payment = rpcObject(root.payment, "resolution.payment"),
      allocation = rpcObject(root.allocation, "resolution.allocation"),
      outcome = rpcEnum(
        decision.outcome,
        ["refund_buyer", "release_seller", "reject_claim"] as const,
        "resolution.finalDecision.outcome",
      );
    return {
      kind: "final_resolution",
      finalDecision: {
        id: rpcUuid(decision.id, "resolution.finalDecision.id"),
        disputeId: rpcUuid(
          decision.dispute_id,
          "resolution.finalDecision.dispute_id",
        ),
        orderId: rpcUuid(
          decision.order_id,
          "resolution.finalDecision.order_id",
        ),
        outcome,
        reasonCode: rpcString(
          decision.reason_code,
          "resolution.finalDecision.reason_code",
        ),
        financialResult: validateFinancialResult(
          decision.financial_result,
          outcome,
        ),
        decidedAt: rpcTimestamp(
          decision.decided_at,
          "resolution.finalDecision.decided_at",
        ),
      },
      dispute: {
        status: rpcEnum(
          dispute.status,
          ["resolved", "rejected"] as const,
          "resolution.dispute.status",
        ),
        resolvedAt: rpcTimestamp(
          dispute.resolved_at,
          "resolution.dispute.resolved_at",
        ),
      },
      order: {
        status: rpcEnum(order.status, orderStatuses, "resolution.order.status"),
      },
      payment: {
        status: rpcEnum(
          payment.status,
          paymentStatuses,
          "resolution.payment.status",
        ),
        grossAmount: rpcNonnegative(
          payment.gross_amount,
          "resolution.payment.gross_amount",
        ),
      },
      allocation: {
        status: rpcEnum(
          allocation.status,
          allocationStatuses,
          "resolution.allocation.status",
        ),
        grossAmount: rpcNonnegative(
          allocation.gross_amount,
          "resolution.allocation.gross_amount",
        ),
        sellerNetAmount: rpcNonnegative(
          allocation.seller_net_amount,
          "resolution.allocation.seller_net_amount",
        ),
        creatorCommissionAmount: rpcNonnegative(
          allocation.creator_commission_amount,
          "resolution.allocation.creator_commission_amount",
        ),
        platformFeeAmount: rpcNonnegative(
          allocation.platform_fee_amount,
          "resolution.allocation.platform_fee_amount",
        ),
      },
    };
  } catch (error) {
    if (error instanceof MarketplaceDisputeResolutionError) throw error;
    throw new MarketplaceDisputeResolutionError(
      "marketplace_dispute_resolution_unknown",
    );
  }
}

async function supportInvoke(
  action: "marketplace_dispute_fetch" | "marketplace_dispute_resolve",
  body: Record<string, unknown>,
) {
  const { data, error } = await getSupabaseClient().functions.invoke(
    "bdag-ledger",
    { body: { action, ...body } },
  );
  if (error) {
    const code = resolutionCode(error);
    throw new MarketplaceDisputeResolutionError(
      code,
      typeof (error as { code?: unknown }).code === "string"
        ? String((error as { code: string }).code)
        : null,
    );
  }
  let envelope: Record<string, unknown>, success: boolean;
  try {
    envelope = rpcObject(data, "support_edge_envelope");
    success = rpcBoolean(envelope.success, "support_edge_envelope.success");
  } catch {
    throw new MarketplaceDisputeResolutionError(
      "marketplace_dispute_resolution_unknown",
    );
  }
  if (success === false)
    throw new MarketplaceDisputeResolutionError(resolutionCode(envelope));
  return envelope.data;
}
export async function fetchSupportMarketplaceDispute(
  disputeId: string,
  idempotencyKey: string,
): Promise<SupportMarketplaceDisputeDetail> {
  if (!UUID.test(disputeId) || !UUID.test(idempotencyKey))
    throw new MarketplaceDisputeResolutionError(
      "marketplace_dispute_resolution_invalid_input",
    );
  return parseSupportMarketplaceDispute(
    await supportInvoke("marketplace_dispute_fetch", {
      dispute_id: disputeId,
      idempotency_key: idempotencyKey,
    }),
  );
}
export async function resolveMarketplaceDispute(
  disputeId: string,
  outcome: MarketplaceDisputeResolutionOutcome,
  reasonCode: string,
  note: string | null,
  idempotencyKey: string,
): Promise<MarketplaceDisputeResolutionResult> {
  if (
    !UUID.test(disputeId) ||
    !UUID.test(idempotencyKey) ||
    ![
      "refund_buyer",
      "release_seller",
      "reject_claim",
      "manual_review",
    ].includes(outcome) ||
    reasonCode.trim().length < 2
  )
    throw new MarketplaceDisputeResolutionError(
      "marketplace_dispute_resolution_invalid_input",
    );
  return parseMarketplaceDisputeResolution(
    await supportInvoke("marketplace_dispute_resolve", {
      dispute_id: disputeId,
      outcome,
      reason_code: reasonCode.trim(),
      note: note?.trim() || null,
      idempotency_key: idempotencyKey,
    }),
  );
}
