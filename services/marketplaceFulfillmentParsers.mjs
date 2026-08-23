export class MarketplaceFulfillmentPayloadError extends Error {
  constructor(path) {
    super(`marketplace_fulfillment_payload_invalid:${path}`);
    this.name = "MarketplaceFulfillmentPayloadError";
    this.path = path;
  }
}

const fail = (path) => {
  throw new MarketplaceFulfillmentPayloadError(path);
};
const object = (value, path) =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value : fail(path);
const array = (value, path) => (Array.isArray(value) ? value : fail(path));
const string = (value, path) =>
  typeof value === "string" && value.length > 0 && value !== "undefined" && value !== "null"
    ? value
    : fail(path);
const nullableString = (value, path) => (value === null ? null : string(value, path));
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, path) => {
  const result = string(value, path);
  return UUID.test(result) ? result : fail(path);
};
const number = (value, path) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fail(path);
const integer = (value, path) => {
  const result = number(value, path);
  return Number.isInteger(result) ? result : fail(path);
};
const timestamp = (value, path) => {
  const result = string(value, path);
  return Number.isFinite(Date.parse(result)) ? result : fail(path);
};
const nullableTimestamp = (value, path) => (value === null ? null : timestamp(value, path));
const enumeration = (value, values, path) =>
  typeof value === "string" && values.includes(value) ? value : fail(path);
const boolean = (value, path) => (typeof value === "boolean" ? value : fail(path));
const countryCode = (value, path) => {
  const result = string(value, path);
  return /^[A-Z]{2}$/.test(result) ? result : fail(path);
};
const uniqueUuidArray = (value, path, max) => {
  const result = array(value, path).map((entry, index) => uuid(entry, `${path}[${index}]`));
  if (result.length > max || new Set(result).size !== result.length) fail(path);
  return result;
};

const orderStatuses = [
  "confirmed",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
  "partially_refunded",
];
const buyerPaymentStatuses = ["paid", "partially_refunded", "refunded"];
const allocationStatuses = ["held", "released", "refunded", "partially_refunded"];
const disputeStatuses = ["open", "under_review", "resolved", "rejected", "cancelled"];
const disputeOutcomes = ["refund_buyer", "release_seller", "reject_claim"];
const returnStatuses = ["requested", "approved", "rejected"];
const returnShipmentStatuses = ["awaiting_buyer_shipment", "shipped"];
const returnAttentionReasons = [
  "decision_pending",
  "funds_pending",
  "destination_pending",
  "return_in_transit",
];

const marketplaceReturnShipment = (value, path) => {
  if (value == null) return null;
  const row = object(value, path);
  const destination = object(row.destination, `${path}.destination`);
  const status = enumeration(row.status, returnShipmentStatuses, `${path}.status`);
  const trackingUrl = nullableString(row.tracking_url, `${path}.tracking_url`);
  if (!isSafeMarketplaceTrackingUrl(trackingUrl)) fail(`${path}.tracking_url`);
  const carrierName = nullableString(row.carrier_name, `${path}.carrier_name`);
  const serviceLevel = nullableString(row.service_level, `${path}.service_level`);
  const trackingNumber = nullableString(row.tracking_number, `${path}.tracking_number`);
  const buyerNote = nullableString(row.buyer_note, `${path}.buyer_note`);
  const shippedAt = nullableTimestamp(row.shipped_at, `${path}.shipped_at`);
  if (
    (status === "awaiting_buyer_shipment" &&
      (carrierName !== null || serviceLevel !== null || trackingNumber !== null ||
        trackingUrl !== null || buyerNote !== null || shippedAt !== null)) ||
    (status === "shipped" &&
      (carrierName === null || trackingNumber === null || shippedAt === null))
  )
    fail(`${path}.status`);
  return {
    status,
    destination: {
      recipientName: string(destination.recipient_name, `${path}.destination.recipient_name`),
      line1: string(destination.line1, `${path}.destination.line1`),
      line2: nullableString(destination.line2, `${path}.destination.line2`),
      city: string(destination.city, `${path}.destination.city`),
      region: string(destination.region, `${path}.destination.region`),
      postalCode: string(destination.postal_code, `${path}.destination.postal_code`),
      country: countryCode(destination.country, `${path}.destination.country`),
      phone: nullableString(destination.phone, `${path}.destination.phone`),
    },
    sellerInstructions: nullableString(row.seller_instructions, `${path}.seller_instructions`),
    carrierName,
    serviceLevel,
    trackingNumber,
    trackingUrl,
    buyerNote,
    instructionsProvidedAt: timestamp(
      row.instructions_provided_at,
      `${path}.instructions_provided_at`,
    ),
    shippedAt,
  };
};

const marketplaceReturnRequest = (value, path, includeOrderId = false) => {
  const row = object(value, path);
  const status = enumeration(row.status, returnStatuses, `${path}.status`);
  const decidedAt = nullableTimestamp(row.decided_at, `${path}.decided_at`);
  const rawRefundHold =
    row.refund_hold == null ? null : object(row.refund_hold, `${path}.refund_hold`);
  if ((status === "requested") !== (decidedAt === null)) fail(`${path}.decided_at`);
  if (rawRefundHold && status !== "approved") fail(`${path}.refund_hold`);
  const returnShipment = marketplaceReturnShipment(row.return_shipment, `${path}.return_shipment`);
  if (returnShipment && (!rawRefundHold || status !== "approved"))
    fail(`${path}.return_shipment`);
  const refundHold = rawRefundHold
    ? {
        status: enumeration(rawRefundHold.status, ["held"], `${path}.refund_hold.status`),
        grossAmount: number(rawRefundHold.gross_amount, `${path}.refund_hold.gross_amount`),
        heldAt: timestamp(rawRefundHold.held_at, `${path}.refund_hold.held_at`),
      }
    : null;
  if (refundHold && refundHold.grossAmount <= 0) fail(`${path}.refund_hold.gross_amount`);
  return {
    id: uuid(row.id, `${path}.id`),
    ...(includeOrderId ? { orderId: uuid(row.order_id, `${path}.order_id`) } : {}),
    status,
    buyerNote: string(row.buyer_note, `${path}.buyer_note`),
    sellerNote: nullableString(row.seller_note, `${path}.seller_note`),
    createdAt: timestamp(row.created_at, `${path}.created_at`),
    decidedAt,
    refundHold,
    returnShipment,
  };
};

const sellerHistoryStateIsCompatible = (
  orderStatus,
  paymentStatus,
  allocationStatus,
  hasCanonicalCompletedSettlement,
) =>
  (["confirmed", "processing", "shipped", "cancelled"].includes(orderStatus) &&
    paymentStatus === "paid" &&
    allocationStatus === "held") ||
  (orderStatus === "delivered" &&
    paymentStatus === "paid" &&
    allocationStatus === "released") ||
  (orderStatus === "shipped" &&
    paymentStatus === "paid" &&
    allocationStatus === "released" &&
    hasCanonicalCompletedSettlement) ||
  (orderStatus === "refunded" &&
    ["paid", "refunded"].includes(paymentStatus) &&
    allocationStatus === "refunded") ||
  (orderStatus === "partially_refunded" &&
    ["paid", "partially_refunded"].includes(paymentStatus) &&
    allocationStatus === "partially_refunded");

export const isSafeMarketplaceTrackingUrl = (value) =>
  !value || /^https:\/\/[^\s]+$/i.test(value);

const commonListRow = (value, index) => {
  const row = object(value, `orders[${index}]`);
  if (row.currency !== "BDAG") fail(`orders[${index}].currency`);
  return {
    row,
    item: {
      id: uuid(row.id, `orders[${index}].id`),
      orderNumber: string(row.order_number, `orders[${index}].order_number`),
      checkoutId: uuid(row.checkout_id, `orders[${index}].checkout_id`),
      checkoutReference: string(
        row.checkout_reference,
        `orders[${index}].checkout_reference`,
      ),
      status: enumeration(row.status, orderStatuses, `orders[${index}].status`),
      storeId: uuid(row.store_id, `orders[${index}].store_id`),
      storeName: string(row.store_name, `orders[${index}].store_name`),
      total: number(row.total, `orders[${index}].total`),
      currency: "BDAG",
      createdAt: timestamp(row.created_at, `orders[${index}].created_at`),
      confirmedAt: nullableTimestamp(row.confirmed_at, `orders[${index}].confirmed_at`),
      processingAt: nullableTimestamp(row.processing_at, `orders[${index}].processing_at`),
      shippedAt: nullableTimestamp(row.shipped_at, `orders[${index}].shipped_at`),
      deliveredAt: nullableTimestamp(row.delivered_at, `orders[${index}].delivered_at`),
      distinctLines: integer(row.distinct_lines, `orders[${index}].distinct_lines`),
      totalQuantity: integer(row.total_quantity, `orders[${index}].total_quantity`),
      carrierName: nullableString(row.carrier_name, `orders[${index}].carrier_name`),
      trackingNumber: nullableString(
        row.tracking_number,
        `orders[${index}].tracking_number`,
      ),
    },
  };
};

const page = (items, effectiveLimit) => {
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      items.length === effectiveLimit && last
        ? { createdAt: last.createdAt, id: last.id }
        : null,
  };
};

export function parseBuyerOrderListPayload(value, effectiveLimit) {
  const items = array(value, "buyer_orders").map((entry, index) => {
    const { row, item } = commonListRow(entry, index);
    const rawReturnProgress =
      row.return_progress == null
        ? null
        : object(row.return_progress, `orders[${index}].return_progress`);
    enumeration(
      row.payment_status,
      buyerPaymentStatuses,
      `orders[${index}].payment_status`,
    );
    return {
      ...item,
      firstItemTitle: nullableString(row.first_item_title, `orders[${index}].first_item_title`),
      firstItemImage: nullableString(row.first_item_image, `orders[${index}].first_item_image`),
      returnProgress: rawReturnProgress
        ? {
            id: uuid(rawReturnProgress.return_id, `orders[${index}].return_progress.return_id`),
            status: enumeration(
              rawReturnProgress.status,
              ["approved"],
              `orders[${index}].return_progress.status`,
            ),
            shippingStatus:
              rawReturnProgress.return_shipping_status == null
                ? null
                : enumeration(
                    rawReturnProgress.return_shipping_status,
                    returnShipmentStatuses,
                    `orders[${index}].return_progress.return_shipping_status`,
                  ),
          }
        : null,
    };
  });
  return page(items, effectiveLimit);
}

export function parseSellerOrderListPayload(value, effectiveLimit) {
  const items = array(value, "seller_orders").map((entry, index) => {
    const { row, item } = commonListRow(entry, index);
    const activeDispute =
      row.active_dispute == null
        ? null
        : object(row.active_dispute, `orders[${index}].active_dispute`);
    const activeReturnRequest =
      row.active_return_request == null
        ? null
        : object(row.active_return_request, `orders[${index}].active_return_request`);
    return {
      ...item,
      firstItemTitle: nullableString(
        row.first_item_title ?? null,
        `orders[${index}].first_item_title`,
      ),
      firstItemImage: nullableString(
        row.first_item_image ?? null,
        `orders[${index}].first_item_image`,
      ),
      recipientName: string(row.recipient_name, `orders[${index}].recipient_name`),
      city: string(row.city, `orders[${index}].city`),
      region: string(row.region, `orders[${index}].region`),
      country: string(row.country, `orders[${index}].country`),
      allocation: {
        grossAmount: number(row.gross_amount, `orders[${index}].gross_amount`),
        platformFeeAmount: number(
          row.platform_fee_amount,
          `orders[${index}].platform_fee_amount`,
        ),
        sellerNetAmount: number(row.seller_net_amount, `orders[${index}].seller_net_amount`),
        status: enumeration(
          row.allocation_status,
          allocationStatuses,
          `orders[${index}].allocation_status`,
        ),
        releasedAt: nullableTimestamp(row.released_at, `orders[${index}].released_at`),
      },
      activeDispute: activeDispute
        ? {
            id: uuid(activeDispute.id, `orders[${index}].active_dispute.id`),
            status: enumeration(
              activeDispute.status,
              ["open", "under_review"],
              `orders[${index}].active_dispute.status`,
            ),
            reasonCode: string(
              activeDispute.reason_code,
              `orders[${index}].active_dispute.reason_code`,
            ),
            createdAt: timestamp(
              activeDispute.created_at,
              `orders[${index}].active_dispute.created_at`,
            ),
            sellerResponseSubmitted: boolean(
              activeDispute.seller_response_submitted,
              `orders[${index}].active_dispute.seller_response_submitted`,
            ),
          }
        : null,
      activeReturnRequest: activeReturnRequest
        ? {
            id: uuid(
              activeReturnRequest.id,
              `orders[${index}].active_return_request.id`,
            ),
            status: enumeration(
              activeReturnRequest.status,
              ["requested", "approved"],
              `orders[${index}].active_return_request.status`,
            ),
            createdAt: timestamp(
              activeReturnRequest.created_at,
              `orders[${index}].active_return_request.created_at`,
            ),
            attentionReason: enumeration(
              activeReturnRequest.attention_reason ??
                (activeReturnRequest.status === "requested"
                  ? "decision_pending"
                  : "funds_pending"),
              returnAttentionReasons,
              `orders[${index}].active_return_request.attention_reason`,
            ),
          }
        : null,
    };
  });
  return page(items, effectiveLimit);
}

export function parseSellerDisputeIndexPayload(value, effectiveLimit) {
  const root = object(value, "seller_disputes");
  const disputes = array(root.disputes, "seller_disputes.disputes").map((entry, index) => {
    const row = object(entry, `seller_disputes.disputes[${index}]`);
    return {
      id: uuid(row.dispute_id, `seller_disputes.disputes[${index}].dispute_id`),
      status: enumeration(
        row.status,
        ["open", "under_review"],
        `seller_disputes.disputes[${index}].status`,
      ),
      reasonCode: string(
        row.reason_code,
        `seller_disputes.disputes[${index}].reason_code`,
      ),
      createdAt: timestamp(
        row.created_at,
        `seller_disputes.disputes[${index}].created_at`,
      ),
      orderId: uuid(row.order_id, `seller_disputes.disputes[${index}].order_id`),
      orderNumber: string(
        row.order_number,
        `seller_disputes.disputes[${index}].order_number`,
      ),
      orderStatus: enumeration(
        row.order_status,
        orderStatuses,
        `seller_disputes.disputes[${index}].order_status`,
      ),
      storeId: uuid(row.store_id, `seller_disputes.disputes[${index}].store_id`),
      storeName: string(
        row.store_name,
        `seller_disputes.disputes[${index}].store_name`,
      ),
      sellerResponseSubmitted: boolean(
        row.seller_response_submitted,
        `seller_disputes.disputes[${index}].seller_response_submitted`,
      ),
      affectedItemCount: integer(
        row.affected_item_count,
        `seller_disputes.disputes[${index}].affected_item_count`,
      ),
      buyerEvidenceCount: integer(
        row.buyer_evidence_count,
        `seller_disputes.disputes[${index}].buyer_evidence_count`,
      ),
    };
  });
  if (disputes.length > effectiveLimit || new Set(disputes.map((row) => row.id)).size !== disputes.length)
    fail("seller_disputes.disputes");
  const activeCount = integer(root.active_count, "seller_disputes.active_count");
  const openCount = integer(root.open_count, "seller_disputes.open_count");
  const underReviewCount = integer(
    root.under_review_count,
    "seller_disputes.under_review_count",
  );
  if (openCount + underReviewCount !== activeCount) fail("seller_disputes.active_count");
  const rawCursor = root.next_cursor == null ? null : object(root.next_cursor, "seller_disputes.next_cursor");
  return {
    activeCount,
    openCount,
    underReviewCount,
    disputes,
    nextCursor: rawCursor
      ? {
          createdAt: timestamp(rawCursor.created_at, "seller_disputes.next_cursor.created_at"),
          id: uuid(rawCursor.id, "seller_disputes.next_cursor.id"),
        }
      : null,
  };
}

export function parseSellerReturnIndexPayload(value, effectiveLimit) {
  const root = object(value, "seller_returns");
  const returns = array(root.returns, "seller_returns.returns").map((entry, index) => {
    const row = object(entry, `seller_returns.returns[${index}]`);
    return {
      id: uuid(row.return_id, `seller_returns.returns[${index}].return_id`),
      status: enumeration(
        row.status,
        ["requested", "approved"],
        `seller_returns.returns[${index}].status`,
      ),
      createdAt: timestamp(
        row.created_at,
        `seller_returns.returns[${index}].created_at`,
      ),
      orderId: uuid(row.order_id, `seller_returns.returns[${index}].order_id`),
      orderNumber: string(
        row.order_number,
        `seller_returns.returns[${index}].order_number`,
      ),
      orderStatus: enumeration(
        row.order_status,
        orderStatuses,
        `seller_returns.returns[${index}].order_status`,
      ),
      storeId: uuid(row.store_id, `seller_returns.returns[${index}].store_id`),
      storeName: string(
        row.store_name,
        `seller_returns.returns[${index}].store_name`,
      ),
      attentionReason: enumeration(
        row.attention_reason ?? (row.status === "requested" ? "decision_pending" : "funds_pending"),
        returnAttentionReasons,
        `seller_returns.returns[${index}].attention_reason`,
      ),
      shippingStatus:
        row.return_shipping_status == null
          ? null
          : enumeration(
              row.return_shipping_status,
              returnShipmentStatuses,
              `seller_returns.returns[${index}].return_shipping_status`,
            ),
    };
  });
  if (
    returns.length > effectiveLimit ||
    new Set(returns.map((row) => row.id)).size !== returns.length
  )
    fail("seller_returns.returns");
  const attentionCount = integer(root.attention_count, "seller_returns.attention_count");
  const requestedCount = integer(root.requested_count, "seller_returns.requested_count");
  const approvedCount = integer(root.approved_count, "seller_returns.approved_count");
  const fundingPendingCount = integer(
    root.funding_pending_count ?? approvedCount,
    "seller_returns.funding_pending_count",
  );
  const destinationPendingCount = integer(
    root.destination_pending_count ?? 0,
    "seller_returns.destination_pending_count",
  );
  const inTransitCount = integer(
    root.in_transit_count ?? 0,
    "seller_returns.in_transit_count",
  );
  if (attentionCount !== requestedCount + approvedCount || returns.length > attentionCount)
    fail("seller_returns.attention_count");
  if (approvedCount !== fundingPendingCount + destinationPendingCount + inTransitCount)
    fail("seller_returns.approved_count");
  const rawCursor =
    root.next_cursor == null
      ? null
      : object(root.next_cursor, "seller_returns.next_cursor");
  return {
    attentionCount,
    requestedCount,
    approvedCount,
    fundingPendingCount,
    destinationPendingCount,
    inTransitCount,
    returns,
    nextCursor: rawCursor
      ? {
          createdAt: timestamp(
            rawCursor.created_at,
            "seller_returns.next_cursor.created_at",
          ),
          id: uuid(rawCursor.id, "seller_returns.next_cursor.id"),
        }
      : null,
  };
}

const shipment = (value) => {
  if (value == null) return null;
  const row = object(value, "order_detail.shipment");
  const trackingUrl = nullableString(row.tracking_url, "order_detail.shipment.tracking_url");
  if (!isSafeMarketplaceTrackingUrl(trackingUrl)) fail("order_detail.shipment.tracking_url");
  return {
    id: row.id == null ? null : uuid(row.id, "order_detail.shipment.id"),
    status: string(row.status, "order_detail.shipment.status"),
    carrierName: string(row.carrier_name, "order_detail.shipment.carrier_name"),
    serviceLevel: nullableString(row.service_level, "order_detail.shipment.service_level"),
    trackingNumber: string(row.tracking_number, "order_detail.shipment.tracking_number"),
    trackingUrl,
    sellerNote: nullableString(row.seller_note ?? null, "order_detail.shipment.seller_note"),
    shippedAt: timestamp(row.shipped_at, "order_detail.shipment.shipped_at"),
    deliveredAt: nullableTimestamp(
      row.delivered_at,
      "order_detail.shipment.delivered_at",
    ),
    estimatedDeliveryAt: nullableTimestamp(
      row.estimated_delivery_at ?? null,
      "order_detail.shipment.estimated_delivery_at",
    ),
  };
};

export function parseMarketplaceOrderDetailPayload(value) {
  const root = object(value, "order_detail");
  const order = object(root.order, "order_detail.order");
  const store = object(root.store, "order_detail.store");
  const payment = object(root.payment, "order_detail.payment");
  const address = object(root.shipping_address, "order_detail.shipping_address");
  if (order.currency !== "BDAG") fail("order_detail.order.currency");
  const rawAllocation = root.allocation == null ? null : object(root.allocation, "order_detail.allocation");
  const rawSettlement = root.settlement == null ? null : object(root.settlement, "order_detail.settlement");
  const orderStatus = enumeration(order.status, orderStatuses, "order_detail.order.status");
  const paymentStatus = enumeration(
    payment.status,
    buyerPaymentStatuses,
    "order_detail.payment.status",
  );
  const allocationStatus = rawAllocation
    ? enumeration(rawAllocation.status, allocationStatuses, "order_detail.allocation.status")
    : null;
  const parsedAllocation = rawAllocation
    ? {
        grossAmount: number(rawAllocation.gross_amount, "order_detail.allocation.gross_amount"),
        platformFeeAmount: number(
          rawAllocation.platform_fee_amount,
          "order_detail.allocation.platform_fee_amount",
        ),
        sellerNetAmount: number(
          rawAllocation.seller_net_amount,
          "order_detail.allocation.seller_net_amount",
        ),
        status: allocationStatus,
        releasedAt: nullableTimestamp(
          rawAllocation.released_at,
          "order_detail.allocation.released_at",
        ),
      }
    : null;
  const parsedSettlement = rawSettlement
    ? {
        status: string(rawSettlement.status, "order_detail.settlement.status"),
        grossAmount: number(
          rawSettlement.gross_amount,
          "order_detail.settlement.gross_amount",
        ),
        sellerNetAmount:
          rawSettlement.seller_net_amount == null
            ? null
            : number(
                rawSettlement.seller_net_amount,
                "order_detail.settlement.seller_net_amount",
              ),
        platformFeeAmount:
          rawSettlement.platform_fee_amount == null
            ? null
            : number(
                rawSettlement.platform_fee_amount,
                "order_detail.settlement.platform_fee_amount",
              ),
        confirmedAt: timestamp(
          rawSettlement.confirmed_at,
          "order_detail.settlement.confirmed_at",
        ),
        releasedAt: timestamp(
          rawSettlement.released_at,
          "order_detail.settlement.released_at",
        ),
        sellerBdagBalance:
          rawSettlement.seller_bdag_balance == null
            ? null
            : number(
                rawSettlement.seller_bdag_balance,
                "order_detail.settlement.seller_bdag_balance",
              ),
      }
    : null;
  const hasCanonicalCompletedSettlement =
    parsedAllocation != null &&
    parsedSettlement != null &&
    parsedSettlement.status === "completed" &&
    parsedSettlement.sellerNetAmount != null &&
    parsedSettlement.platformFeeAmount != null &&
    parsedSettlement.grossAmount === parsedAllocation.grossAmount &&
    parsedSettlement.sellerNetAmount === parsedAllocation.sellerNetAmount &&
    parsedSettlement.platformFeeAmount === parsedAllocation.platformFeeAmount;
  if (
    allocationStatus &&
    !sellerHistoryStateIsCompatible(
      orderStatus,
      paymentStatus,
      allocationStatus,
      hasCanonicalCompletedSettlement,
    )
  )
    fail("order_detail.allocation.status");
  return {
    order: {
      id: uuid(order.id, "order_detail.order.id"),
      orderNumber: string(order.order_number, "order_detail.order.order_number"),
      checkoutId: uuid(order.checkout_id, "order_detail.order.checkout_id"),
      checkoutReference: string(
        order.checkout_reference,
        "order_detail.order.checkout_reference",
      ),
      status: orderStatus,
      currency: "BDAG",
      total: number(order.total, "order_detail.order.total"),
      createdAt: timestamp(order.created_at, "order_detail.order.created_at"),
      confirmedAt: nullableTimestamp(
        order.confirmed_at,
        "order_detail.order.confirmed_at",
      ),
      processingAt: nullableTimestamp(
        order.processing_at,
        "order_detail.order.processing_at",
      ),
      shippedAt: nullableTimestamp(order.shipped_at, "order_detail.order.shipped_at"),
      deliveredAt: nullableTimestamp(
        order.delivered_at,
        "order_detail.order.delivered_at",
      ),
      fulfillmentVersion: integer(
        order.fulfillment_version,
        "order_detail.order.fulfillment_version",
      ),
    },
    store: {
      id: uuid(store.id, "order_detail.store.id"),
      name: string(store.name, "order_detail.store.name"),
      slug: string(store.slug, "order_detail.store.slug"),
    },
    payment: {
      status: paymentStatus,
      paidAt: timestamp(payment.paid_at, "order_detail.payment.paid_at"),
    },
    allocation: parsedAllocation,
    settlement: parsedSettlement,
    shippingAddress: {
      recipientName: string(address.recipient_name, "order_detail.shipping_address.recipient_name"),
      line1: string(address.line1, "order_detail.shipping_address.line1"),
      line2: nullableString(address.line2, "order_detail.shipping_address.line2"),
      city: string(address.city, "order_detail.shipping_address.city"),
      region: string(address.region, "order_detail.shipping_address.region"),
      postalCode: string(address.postal_code, "order_detail.shipping_address.postal_code"),
      country: string(address.country, "order_detail.shipping_address.country"),
      phone: nullableString(address.phone, "order_detail.shipping_address.phone"),
    },
    items: array(root.items, "order_detail.items").map((entry, index) => {
      const item = object(entry, `order_detail.items[${index}]`);
      return {
        id: uuid(item.id, `order_detail.items[${index}].id`),
        productTitle: string(
          item.product_title,
          `order_detail.items[${index}].product_title`,
        ),
        variantTitle: nullableString(
          item.variant_title,
          `order_detail.items[${index}].variant_title`,
        ),
        sku: string(item.sku, `order_detail.items[${index}].sku`),
        options: array(item.options, `order_detail.items[${index}].options`).map(
          (optionValue, optionIndex) => {
            const option = object(
              optionValue,
              `order_detail.items[${index}].options[${optionIndex}]`,
            );
            return {
              name:
                option.name == null
                  ? undefined
                  : string(
                      option.name,
                      `order_detail.items[${index}].options[${optionIndex}].name`,
                    ),
              value: string(
                option.value,
                `order_detail.items[${index}].options[${optionIndex}].value`,
              ),
            };
          },
        ),
        imageUrl: nullableString(item.image_url, `order_detail.items[${index}].image_url`),
        unitPrice: number(item.unit_price, `order_detail.items[${index}].unit_price`),
        quantity: integer(item.quantity, `order_detail.items[${index}].quantity`),
        lineTotal: number(item.line_total, `order_detail.items[${index}].line_total`),
      };
    }),
    shipment: shipment(root.shipment),
    events: array(root.events, "order_detail.events").map((entry, index) => {
      const event = object(entry, `order_detail.events[${index}]`);
      const eventType = string(event.event_type, `order_detail.events[${index}].event_type`);
      const disputeOutcome =
        event.dispute_outcome == null
          ? null
          : enumeration(
              event.dispute_outcome,
              disputeOutcomes,
              `order_detail.events[${index}].dispute_outcome`,
            );
      if (eventType !== "dispute_resolved" && disputeOutcome !== null)
        fail(`order_detail.events[${index}].dispute_outcome`);
      return {
        id: uuid(event.id, `order_detail.events[${index}].id`),
        eventType,
        fromStatus: nullableString(
          event.from_status,
          `order_detail.events[${index}].from_status`,
        ),
        toStatus: nullableString(event.to_status, `order_detail.events[${index}].to_status`),
        actorRole: string(event.actor_role, `order_detail.events[${index}].actor_role`),
        disputeOutcome,
        createdAt: timestamp(event.created_at, `order_detail.events[${index}].created_at`),
      };
    }),
    escrowProtected: boolean(root.escrow_protected, "order_detail.escrow_protected"),
    shippingAmount: 0,
    shippingEstimate: null,
    dispute: null,
    returnEligible: false,
    returnRequest: null,
  };
}

export function mergeMarketplaceOrderLifecyclePayload(detail, value) {
  const root = object(value, "order_lifecycle");
  const rawShipping = root.shipping == null ? null : object(root.shipping, "order_lifecycle.shipping");
  const rawSnapshot =
    root.shipping_snapshot == null
      ? null
      : object(root.shipping_snapshot, "order_lifecycle.shipping_snapshot");
  const rawDispute =
    root.dispute == null ? null : object(root.dispute, "order_lifecycle.dispute");
  const rawSellerResponse =
    rawDispute?.seller_response == null
      ? null
      : object(rawDispute.seller_response, "order_lifecycle.dispute.seller_response");
  const rawReturnRequest =
    root.return_request == null
      ? null
      : object(root.return_request, "order_lifecycle.return_request");
  const shippingAmount = number(root.shipping_amount, "order_lifecycle.shipping_amount");
  const snapshotHasValues =
    rawSnapshot != null &&
    [
      rawSnapshot.processing_days_min,
      rawSnapshot.processing_days_max,
      rawSnapshot.transit_days_min,
      rawSnapshot.transit_days_max,
      rawSnapshot.return_policy_summary,
    ].some((entry) => entry != null);
  if (rawSnapshot && !snapshotHasValues && shippingAmount !== 0)
    fail("order_lifecycle.shipping_snapshot");
  const estimatedDeliveryAt = rawShipping
    ? nullableTimestamp(
        rawShipping.estimated_delivery_at,
        "order_lifecycle.shipping.estimated_delivery_at",
      )
    : null;
  return {
    ...detail,
    shipment: detail.shipment
      ? { ...detail.shipment, estimatedDeliveryAt }
      : detail.shipment,
    shippingAmount,
    shippingEstimate:
      rawSnapshot && snapshotHasValues
        ? {
            processingDaysMin: integer(
              rawSnapshot.processing_days_min,
              "order_lifecycle.shipping_snapshot.processing_days_min",
            ),
            processingDaysMax: integer(
              rawSnapshot.processing_days_max,
              "order_lifecycle.shipping_snapshot.processing_days_max",
            ),
            transitDaysMin: integer(
              rawSnapshot.transit_days_min,
              "order_lifecycle.shipping_snapshot.transit_days_min",
            ),
            transitDaysMax: integer(
              rawSnapshot.transit_days_max,
              "order_lifecycle.shipping_snapshot.transit_days_max",
            ),
            returnPolicySummary: string(
              rawSnapshot.return_policy_summary,
              "order_lifecycle.shipping_snapshot.return_policy_summary",
            ),
          }
        : null,
    dispute: rawDispute
      ? {
          id: uuid(rawDispute.id, "order_lifecycle.dispute.id"),
          status: enumeration(
            rawDispute.status,
            disputeStatuses,
            "order_lifecycle.dispute.status",
          ),
          reasonCode: string(rawDispute.reason_code, "order_lifecycle.dispute.reason_code"),
          buyerNote: nullableString(
            rawDispute.buyer_note,
            "order_lifecycle.dispute.buyer_note",
          ),
          createdAt: timestamp(rawDispute.created_at, "order_lifecycle.dispute.created_at"),
          outcome:
            rawDispute.outcome == null
              ? null
              : enumeration(
                  rawDispute.outcome,
                  disputeOutcomes,
                  "order_lifecycle.dispute.outcome",
                ),
          affectedItemIds: uniqueUuidArray(
            rawDispute.affected_item_ids,
            "order_lifecycle.dispute.affected_item_ids",
            100,
          ),
          buyerEvidenceAssetIds: uniqueUuidArray(
            rawDispute.buyer_evidence_asset_ids,
            "order_lifecycle.dispute.buyer_evidence_asset_ids",
            6,
          ),
          sellerResponse: rawSellerResponse
            ? {
                id: uuid(
                  rawSellerResponse.id,
                  "order_lifecycle.dispute.seller_response.id",
                ),
                note: nullableString(
                  rawSellerResponse.note,
                  "order_lifecycle.dispute.seller_response.note",
                ),
                createdAt: timestamp(
                  rawSellerResponse.created_at,
                  "order_lifecycle.dispute.seller_response.created_at",
                ),
                evidenceAssetIds: uniqueUuidArray(
                  rawSellerResponse.evidence_asset_ids,
                  "order_lifecycle.dispute.seller_response.evidence_asset_ids",
                  6,
                ),
              }
            : null,
        }
      : null,
    returnEligible:
      root.return_eligible == null
        ? false
        : boolean(root.return_eligible, "order_lifecycle.return_eligible"),
    returnRequest: rawReturnRequest
      ? marketplaceReturnRequest(rawReturnRequest, "order_lifecycle.return_request")
      : null,
  };
}

export function parseMarketplaceReturnMutationReceipt(value) {
  const root = object(value, "marketplace_return_receipt");
  const moneyMoved = boolean(root.money_moved, "marketplace_return_receipt.money_moved");
  const returnRequest = marketplaceReturnRequest(
    root.return_request,
    "marketplace_return_receipt.return_request",
    true,
  );
  if (moneyMoved && returnRequest.refundHold == null)
    fail("marketplace_return_receipt.money_moved");
  return {
    returnRequest,
    moneyMoved,
  };
}

export function parseMarketplaceReturnShipmentMutationReceipt(value) {
  const root = object(value, "marketplace_return_shipment_receipt");
  const moneyMoved = boolean(
    root.money_moved,
    "marketplace_return_shipment_receipt.money_moved",
  );
  const returnShipment = marketplaceReturnShipment(
    root.return_shipment,
    "marketplace_return_shipment_receipt.return_shipment",
  );
  if (moneyMoved || returnShipment == null)
    fail("marketplace_return_shipment_receipt.money_moved");
  return {
    returnId: uuid(root.return_id, "marketplace_return_shipment_receipt.return_id"),
    orderId: uuid(root.order_id, "marketplace_return_shipment_receipt.order_id"),
    returnShipment,
    moneyMoved: false,
  };
}
