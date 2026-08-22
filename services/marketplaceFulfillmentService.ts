import { getSupabaseClient } from "@/template";
import {
  isSafeMarketplaceTrackingUrl,
  MarketplaceFulfillmentPayloadError,
  mergeMarketplaceOrderLifecyclePayload,
  parseBuyerOrderListPayload,
  parseMarketplaceOrderDetailPayload,
  parseMarketplaceReturnMutationReceipt,
  parseSellerOrderListPayload,
  parseSellerDisputeIndexPayload,
} from "@/services/marketplaceFulfillmentParsers.mjs";
import { reconcileFulfillmentMutation } from "@/services/marketplaceFulfillmentMutationCore.mjs";

export type MarketplaceOrderStatus =
  | "confirmed"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded"
  | "partially_refunded";
export type MarketplaceDisputeStatus =
  | "open"
  | "under_review"
  | "resolved"
  | "rejected"
  | "cancelled";
export type MarketplaceDisputeOutcome = "refund_buyer" | "release_seller" | "reject_claim";
export type MarketplaceReturnStatus = "requested" | "approved" | "rejected";
export interface MarketplaceReturnRequest {
  id: string;
  status: MarketplaceReturnStatus;
  buyerNote: string;
  sellerNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}
export interface MarketplaceOrderEvent {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorRole: string;
  disputeOutcome: MarketplaceDisputeOutcome | null;
  createdAt: string;
}
export interface MarketplaceShipment {
  id: string | null;
  status: string;
  carrierName: string;
  serviceLevel: string | null;
  trackingNumber: string;
  trackingUrl: string | null;
  sellerNote: string | null;
  shippedAt: string;
  deliveredAt: string | null;
  estimatedDeliveryAt: string | null;
}
export interface MarketplaceHeldAllocation {
  grossAmount: number;
  platformFeeAmount: number;
  sellerNetAmount: number;
  status: "held" | "released" | "refunded" | "partially_refunded";
  releasedAt: string | null;
}
export interface MarketplaceOrderListItem {
  id: string;
  orderNumber: string;
  checkoutId: string;
  checkoutReference: string;
  status: MarketplaceOrderStatus;
  storeId: string;
  storeName: string;
  total: number;
  currency: "BDAG";
  createdAt: string;
  confirmedAt: string | null;
  processingAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  firstItemTitle: string | null;
  firstItemImage: string | null;
  distinctLines: number;
  totalQuantity: number;
  carrierName: string | null;
  trackingNumber: string | null;
  recipientName?: string;
  city?: string;
  region?: string;
  country?: string;
  allocation?: MarketplaceHeldAllocation;
  activeDispute?: {
    id: string;
    status: "open" | "under_review";
    reasonCode: string;
    createdAt: string;
    sellerResponseSubmitted: boolean;
  } | null;
}
export interface MarketplaceSellerDisputeSummary {
  id: string;
  status: "open" | "under_review";
  reasonCode: string;
  createdAt: string;
  orderId: string;
  orderNumber: string;
  orderStatus: MarketplaceOrderStatus;
  storeId: string;
  storeName: string;
  sellerResponseSubmitted: boolean;
  affectedItemCount: number;
  buyerEvidenceCount: number;
}
export interface MarketplaceSellerDisputePage {
  activeCount: number;
  openCount: number;
  underReviewCount: number;
  disputes: MarketplaceSellerDisputeSummary[];
  nextCursor: { createdAt: string; id: string } | null;
}
export interface MarketplaceOrderDetail {
  order: {
    id: string;
    orderNumber: string;
    checkoutId: string;
    checkoutReference: string;
    status: MarketplaceOrderStatus;
    currency: "BDAG";
    total: number;
    createdAt: string;
    confirmedAt: string | null;
    processingAt: string | null;
    shippedAt: string | null;
    deliveredAt: string | null;
    fulfillmentVersion: number;
  };
  store: { id: string; name: string; slug: string };
  payment: { status: "paid" | "partially_refunded" | "refunded"; paidAt: string };
  allocation: MarketplaceHeldAllocation | null;
  settlement: {
    status: string;
    grossAmount: number;
    sellerNetAmount: number | null;
    platformFeeAmount: number | null;
    confirmedAt: string;
    releasedAt: string;
    sellerBdagBalance: number | null;
  } | null;
  shippingAddress: {
    recipientName: string;
    line1: string;
    line2: string | null;
    city: string;
    region: string;
    postalCode: string;
    country: string;
    phone: string | null;
  };
  items: {
    id: string;
    productTitle: string;
    variantTitle: string | null;
    sku: string;
    options: { name?: string; value: string }[];
    imageUrl: string | null;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }[];
  shipment: MarketplaceShipment | null;
  events: MarketplaceOrderEvent[];
  escrowProtected: boolean;
  shippingAmount: number;
  shippingEstimate: {
    processingDaysMin: number;
    processingDaysMax: number;
    transitDaysMin: number;
    transitDaysMax: number;
    returnPolicySummary: string;
  } | null;
  dispute: {
    id: string;
    status: MarketplaceDisputeStatus;
    reasonCode: string;
    buyerNote: string | null;
    createdAt: string;
    outcome: MarketplaceDisputeOutcome | null;
    affectedItemIds: string[];
    buyerEvidenceAssetIds: string[];
    sellerResponse: {
      id: string;
      note: string | null;
      createdAt: string;
      evidenceAssetIds: string[];
    } | null;
  } | null;
  returnEligible: boolean;
  returnRequest: MarketplaceReturnRequest | null;
  postMutationRefreshFailed?: boolean;
}
export interface MarketplaceOrderPage {
  items: MarketplaceOrderListItem[];
  nextCursor: { createdAt: string; id: string } | null;
}
export interface ShipmentInput {
  carrierName: string;
  serviceLevel?: string;
  trackingNumber: string;
  trackingUrl?: string;
  sellerNote?: string;
}
export type MarketplaceFulfillmentErrorCode =
  | "marketplace_invalid_cursor"
  | "marketplace_order_not_found"
  | "marketplace_order_not_owned"
  | "marketplace_seller_not_approved"
  | "marketplace_store_inactive"
  | "marketplace_order_not_paid"
  | "marketplace_order_not_fulfillable"
  | "marketplace_invalid_shipment"
  | "marketplace_fulfillment_idempotency_conflict"
  | "marketplace_fulfillment_transport"
  | "marketplace_fulfillment_outcome_unknown"
  | "marketplace_dispute_not_found"
  | "marketplace_dispute_not_owned"
  | "marketplace_dispute_response_invalid_input"
  | "marketplace_dispute_response_state_conflict"
  | "marketplace_dispute_settlement_completed"
  | "marketplace_dispute_response_idempotency_conflict"
  | "marketplace_dispute_response_already_submitted"
  | "marketplace_return_invalid_input"
  | "marketplace_return_order_not_found"
  | "marketplace_return_not_eligible"
  | "marketplace_return_active_dispute"
  | "marketplace_return_already_requested"
  | "marketplace_return_idempotency_conflict"
  | "marketplace_return_not_found"
  | "marketplace_return_not_owned"
  | "marketplace_return_decision_invalid_input"
  | "marketplace_return_decision_idempotency_conflict"
  | "marketplace_return_already_decided"
  | "marketplace_fulfillment_unknown";

export class MarketplaceFulfillmentError extends Error {
  constructor(public code: MarketplaceFulfillmentErrorCode) {
    super(code);
  }
}

const db = () => getSupabaseClient();
const invalid = () => new MarketplaceFulfillmentError("marketplace_fulfillment_unknown");
export const isSafeTrackingUrl = isSafeMarketplaceTrackingUrl;

function diagnostic(stage: string, error: unknown) {
  if (!__DEV__) return;
  console.error("[MarketplaceFulfillment] operation failed", {
    stage,
    code: error instanceof MarketplaceFulfillmentError ? error.code : undefined,
    path:
      error instanceof MarketplaceFulfillmentPayloadError
        ? error.path
        : undefined,
  });
}

function parse<T>(stage: string, reader: () => T): T {
  try {
    return reader();
  } catch (error) {
    diagnostic(stage, error);
    throw invalid();
  }
}

function fail(
  rpcName: string,
  stage: string,
  error: { code?: string; message?: string; details?: string; hint?: string },
): never {
  const known = (error.message ?? "").match(
    /marketplace_[a-z_]+/,
  )?.[0] as MarketplaceFulfillmentErrorCode | undefined;
  const rawCode = error.code?.trim();
  const transport =
    !rawCode &&
    /network|fetch|failed to fetch|timeout|timed out|connection|socket|offline/i.test(
      error.message ?? "",
    );
  const normalized = new MarketplaceFulfillmentError(
    known ?? (transport ? "marketplace_fulfillment_transport" : "marketplace_fulfillment_unknown"),
  );
  if (__DEV__)
    console.error("[MarketplaceFulfillment] RPC failed", {
      stage,
      rpc: rpcName,
      code: error.code,
      message: error.message?.slice(0, 200),
      details: error.details?.slice(0, 200),
      hint: error.hint?.slice(0, 200),
    });
  throw normalized;
}

async function rpc(name: string, args: Record<string, unknown>, stage: string) {
  const { data, error } = await db().rpc(name, args);
  if (error) fail(name, stage, error);
  return data;
}

const validCursor = (cursor?: { createdAt: string; id: string }) => {
  if (!cursor) return undefined;
  if (
    !Number.isFinite(Date.parse(cursor.createdAt)) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      cursor.id,
    )
  )
    throw new MarketplaceFulfillmentError("marketplace_invalid_cursor");
  return cursor;
};

export async function fetchBuyerOrders(
  filters: {
    status?: MarketplaceOrderStatus | null;
    limit?: number;
    cursor?: { createdAt: string; id: string };
  } = {},
): Promise<MarketplaceOrderPage> {
  const limit = Math.min(50, Math.max(1, filters.limit ?? 20));
  const cursor = validCursor(filters.cursor);
  const response = await rpc(
    "fetch_my_marketplace_orders",
    {
      p_status: filters.status ?? null,
      p_limit: limit,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
    },
    "buyer_list_rpc",
  );
  return parse("buyer_list_parser", () =>
    parseBuyerOrderListPayload(response, limit),
  ) as MarketplaceOrderPage;
}

export async function fetchSellerOrders(
  filters: {
    status?: MarketplaceOrderStatus | null;
    limit?: number;
    cursor?: { createdAt: string; id: string };
  } = {},
): Promise<MarketplaceOrderPage> {
  const limit = Math.min(50, Math.max(1, filters.limit ?? 20));
  const cursor = validCursor(filters.cursor);
  const response = await rpc(
    "fetch_my_marketplace_sales",
    {
      p_status: filters.status ?? null,
      p_limit: limit,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
    },
    "seller_list_rpc",
  );
  return parse("seller_list_parser", () =>
    parseSellerOrderListPayload(response, limit),
  ) as MarketplaceOrderPage;
}

export async function fetchSellerDisputes(
  filters: {
    limit?: number;
    cursor?: { createdAt: string; id: string };
  } = {},
): Promise<MarketplaceSellerDisputePage> {
  const limit = Math.min(50, Math.max(1, filters.limit ?? 20));
  const cursor = validCursor(filters.cursor);
  const response = await rpc(
    "fetch_my_marketplace_disputes",
    {
      p_limit: limit,
      p_before_created_at: cursor?.createdAt ?? null,
      p_before_id: cursor?.id ?? null,
    },
    "seller_dispute_list_rpc",
  );
  return parse("seller_dispute_list_parser", () =>
    parseSellerDisputeIndexPayload(response, limit),
  ) as MarketplaceSellerDisputePage;
}

async function fetchBuyerOrderBase(id: string): Promise<MarketplaceOrderDetail> {
  const response = await rpc(
    "fetch_my_marketplace_order",
    { p_order_id: id },
    "buyer_detail_rpc",
  );
  return parse("buyer_detail_parser", () =>
    parseMarketplaceOrderDetailPayload(response),
  ) as MarketplaceOrderDetail;
}

async function fetchSellerOrderBase(
  id: string,
  stage = "seller_detail",
): Promise<MarketplaceOrderDetail> {
  const response = await rpc(
    "fetch_my_marketplace_sale",
    { p_order_id: id },
    `${stage}_rpc`,
  );
  return parse(`${stage}_parser`, () =>
    parseMarketplaceOrderDetailPayload(response),
  ) as MarketplaceOrderDetail;
}

async function enrichLifecycle(
  value: MarketplaceOrderDetail,
  stage: string,
): Promise<MarketplaceOrderDetail> {
  const response = await rpc(
    "fetch_my_marketplace_order_lifecycle",
    { p_order_id: value.order.id },
    `${stage}_lifecycle_rpc`,
  );
  return parse(`${stage}_lifecycle_parser`, () =>
    mergeMarketplaceOrderLifecyclePayload(value, response),
  ) as MarketplaceOrderDetail;
}

export async function fetchBuyerOrder(id: string) {
  return enrichLifecycle(await fetchBuyerOrderBase(id), "buyer_detail");
}

export async function fetchSellerOrder(id: string) {
  return enrichLifecycle(await fetchSellerOrderBase(id), "seller_detail");
}

const sameOrderedValues = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export async function respondToMarketplaceDispute(
  orderId: string,
  disputeId: string,
  note: string,
  evidenceAssetIds: string[],
  idempotencyKey: string,
): Promise<MarketplaceOrderDetail> {
  const normalizedNote = note.trim();
  const expectedNote = normalizedNote || null;
  const provesCommitted = (value: MarketplaceOrderDetail) => {
    const response = value.dispute?.sellerResponse;
    return Boolean(
      value.dispute?.id === disputeId &&
        response &&
        (response.note?.trim() || null) === expectedNote &&
        sameOrderedValues(response.evidenceAssetIds, evidenceAssetIds),
    );
  };
  try {
    await rpc(
      "respond_to_marketplace_dispute",
      {
        p_dispute_id: disputeId,
        p_seller_note: normalizedNote,
        p_evidence_asset_ids: evidenceAssetIds,
        p_idempotency_key: idempotencyKey,
      },
      "seller_dispute_response_rpc",
    );
  } catch (error) {
    if (!isAmbiguousMutationError(error)) throw error;
    try {
      const recovered = await fetchSellerOrder(orderId);
      if (provesCommitted(recovered)) return recovered;
    } catch {
      // An ambiguous mutation outcome must never trigger evidence cleanup.
    }
    throw unknownOutcome();
  }
  try {
    const canonical = await fetchSellerOrder(orderId);
    if (provesCommitted(canonical)) return canonical;
  } catch (error) {
    diagnostic("seller_dispute_response_readback", error);
  }
  throw unknownOutcome();
}

export async function requestMarketplaceReturn(
  orderId: string,
  buyerNote: string,
  idempotencyKey: string,
): Promise<MarketplaceOrderDetail> {
  const normalizedNote = buyerNote.trim();
  const provesCommitted = (value: MarketplaceOrderDetail) =>
    value.returnRequest?.buyerNote.trim() === normalizedNote;
  try {
    const receipt = await rpc(
      "request_marketplace_return",
      {
        p_order_id: orderId,
        p_buyer_note: normalizedNote,
        p_idempotency_key: idempotencyKey,
      },
      "buyer_return_request_rpc",
    );
    parse("buyer_return_request_receipt", () =>
      parseMarketplaceReturnMutationReceipt(receipt),
    );
  } catch (error) {
    if (!isAmbiguousMutationError(error)) throw error;
    try {
      const recovered = await fetchBuyerOrder(orderId);
      if (provesCommitted(recovered)) return recovered;
    } catch {
      // Keep the idempotency key stable when the transport result is unknown.
    }
    throw unknownOutcome();
  }
  try {
    const canonical = await fetchBuyerOrder(orderId);
    if (provesCommitted(canonical)) return canonical;
  } catch (error) {
    diagnostic("buyer_return_request_readback", error);
  }
  throw unknownOutcome();
}

export async function respondToMarketplaceReturn(
  orderId: string,
  returnId: string,
  decision: "approve" | "reject",
  sellerNote: string,
  idempotencyKey: string,
): Promise<MarketplaceOrderDetail> {
  const normalizedNote = sellerNote.trim();
  const expectedStatus: MarketplaceReturnStatus =
    decision === "approve" ? "approved" : "rejected";
  const provesCommitted = (value: MarketplaceOrderDetail) =>
    value.returnRequest?.id === returnId &&
    value.returnRequest.status === expectedStatus &&
    (value.returnRequest.sellerNote?.trim() || null) === (normalizedNote || null);
  try {
    const receipt = await rpc(
      "respond_to_marketplace_return",
      {
        p_return_id: returnId,
        p_decision: decision,
        p_seller_note: normalizedNote,
        p_idempotency_key: idempotencyKey,
      },
      "seller_return_decision_rpc",
    );
    parse("seller_return_decision_receipt", () =>
      parseMarketplaceReturnMutationReceipt(receipt),
    );
  } catch (error) {
    if (!isAmbiguousMutationError(error)) throw error;
    try {
      const recovered = await fetchSellerOrder(orderId);
      if (provesCommitted(recovered)) return recovered;
    } catch {
      // Never retry a possibly committed seller decision with a new key.
    }
    throw unknownOutcome();
  }
  try {
    const canonical = await fetchSellerOrder(orderId);
    if (provesCommitted(canonical)) return canonical;
  } catch (error) {
    diagnostic("seller_return_decision_readback", error);
  }
  throw unknownOutcome();
}

const isAmbiguousMutationError = (error: unknown) =>
  error instanceof MarketplaceFulfillmentError &&
  error.code === "marketplace_fulfillment_transport";
const unknownOutcome = () =>
  new MarketplaceFulfillmentError("marketplace_fulfillment_outcome_unknown");

async function committedMutation(
  stage: "seller_processing" | "seller_shipping",
  execute: () => Promise<unknown>,
  readBack: () => Promise<MarketplaceOrderDetail>,
  provesCommitted: (value: MarketplaceOrderDetail) => boolean,
): Promise<MarketplaceOrderDetail> {
  const outcome = (await reconcileFulfillmentMutation({
    execute,
    parse: (response: unknown) =>
      parse(`${stage}_mutation_parser`, () =>
        parseMarketplaceOrderDetailPayload(response),
      ) as MarketplaceOrderDetail,
    readBack,
    enrich: (value: MarketplaceOrderDetail) =>
      enrichLifecycle(value, `${stage}_post_mutation`),
    provesCommitted,
    isAmbiguousError: isAmbiguousMutationError,
    createUnknownError: unknownOutcome,
    onReconciled: () => {
      if (__DEV__)
        console.warn("[MarketplaceFulfillment] mutation reconciled", { stage });
    },
    onPostMutationRefreshFailure: (error: unknown) =>
      diagnostic(`${stage}_post_mutation_enrichment`, error),
  })) as {
    value: MarketplaceOrderDetail;
    reconciled: boolean;
    postMutationRefreshFailed: boolean;
  };
  return outcome.postMutationRefreshFailed
    ? { ...outcome.value, postMutationRefreshFailed: true }
    : outcome.value;
}

export async function startSellerOrderProcessing(id: string, key: string) {
  return committedMutation(
    "seller_processing",
    () =>
      rpc(
        "seller_start_marketplace_order_processing",
        { p_order_id: id, p_idempotency_key: key },
        "seller_processing_mutation_rpc",
      ),
    () => fetchSellerOrderBase(id, "seller_processing_readback"),
    (value) => ["processing", "shipped", "delivered"].includes(value.order.status),
  );
}

export async function shipSellerOrder(id: string, input: ShipmentInput, key: string) {
  if (
    input.carrierName.trim().length < 2 ||
    input.trackingNumber.trim().length < 2 ||
    !isSafeTrackingUrl(input.trackingUrl)
  )
    throw new MarketplaceFulfillmentError("marketplace_invalid_shipment");
  const expectedCarrier = input.carrierName.trim();
  const expectedTracking = input.trackingNumber.trim();
  return committedMutation(
    "seller_shipping",
    () =>
      rpc(
        "seller_ship_marketplace_order",
        {
          p_order_id: id,
          p_carrier_name: input.carrierName,
          p_service_level: input.serviceLevel ?? null,
          p_tracking_number: input.trackingNumber,
          p_tracking_url: input.trackingUrl ?? null,
          p_seller_note: input.sellerNote ?? null,
          p_idempotency_key: key,
        },
        "seller_shipping_mutation_rpc",
      ),
    () => fetchSellerOrderBase(id, "seller_shipping_readback"),
    (value) =>
      ["shipped", "delivered"].includes(value.order.status) &&
      value.shipment?.carrierName === expectedCarrier &&
      value.shipment.trackingNumber === expectedTracking,
  );
}
