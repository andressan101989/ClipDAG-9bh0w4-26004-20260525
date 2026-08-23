import type {
  MarketplaceDisputeOutcome,
  MarketplaceDisputeStatus,
  MarketplaceHeldAllocation,
  MarketplaceOrderEvent,
  MarketplaceOrderListItem,
  MarketplaceOrderStatus,
  MarketplaceReturnStatus,
  MarketplaceReturnShipment,
} from "@/services/marketplaceFulfillmentService";

export type MarketplaceDisputeSummary = {
  status: MarketplaceDisputeStatus;
  reasonCode: string;
  outcome: MarketplaceDisputeOutcome | null;
};

export type MarketplaceTimelineSettlement = { status: string; releasedAt: string };
export type MarketplaceTimelineItem = { id: string; label: string; createdAt: string };

export function marketplaceBuyerReturnProgressLabel(
  returnProgress: MarketplaceOrderListItem["returnProgress"],
) {
  if (!returnProgress) return null;
  const { status, shippingStatus, labelSent } = returnProgress;
  if (status === "refunded" && shippingStatus === null) return null;
  if (shippingStatus === "received") return "Producto recibido · Reembolso completado";
  if (shippingStatus === "shipped") return "Devolución enviada";
  if (shippingStatus === "awaiting_buyer_shipment")
    return labelSent ? "Label listo para imprimir" : "Esperando label del vendedor";
  if (status === "approved" && shippingStatus === null)
    return "Esperando label del vendedor";
  return null;
}

export function marketplaceReturnStatusCopy(
  status: MarketplaceReturnStatus,
  refundFunded = false,
  shipmentStatus?: MarketplaceReturnShipment["status"] | null,
  labelSent = false,
  refundMode?: "keep_item" | "returned_item" | null,
) {
  if (status === "requested")
    return {
      title: "Solicitud de devolución enviada",
      body: "Esperando respuesta del vendedor.",
    };
  if (status === "approved")
    return refundFunded && shipmentStatus === "shipped"
      ? {
          title: "Producto enviado",
          body: "Tu reembolso continúa protegido mientras el vendedor recibe el producto.",
        }
      : refundFunded && shipmentStatus === "awaiting_buyer_shipment" && labelSent
        ? {
            title: "Label listo para imprimir",
            body: "Abre e imprime el label antes de entregar el paquete al transportista.",
          }
        : refundFunded && shipmentStatus === "awaiting_buyer_shipment"
          ? {
              title: "Esperando label del vendedor",
              body: "Tu reembolso está protegido. Espera el label antes de enviar el producto.",
          }
        : refundFunded
      ? {
          title: "Fondos del reembolso asegurados",
          body: "Tu reembolso está protegido. Esperando label del vendedor.",
        }
      : {
          title: "Devolución aceptada",
          body: "Espera a que la app confirme que los fondos del reembolso están asegurados antes de enviar el producto.",
        };
  if (status === "refunded")
    return refundMode === "returned_item"
      ? {
          title: "Producto recibido",
          body: "Reembolso completado. El vendedor confirmó la recepción y el dinero fue devuelto.",
        }
      : {
      title: "Reembolso completado",
      body: "El dinero fue devuelto de inmediato y puedes conservar el producto.",
        };
  return {
    title: "Devolución rechazada por el vendedor",
    body: "El vendedor decidió no aceptar esta devolución.",
  };
}

export function marketplaceDisputeResolutionEventLabel(
  outcome: MarketplaceDisputeOutcome | null,
) {
  if (outcome === "refund_buyer") return "Reclamo resuelto: reembolso al comprador";
  if (outcome === "release_seller") return "Reclamo resuelto a favor del vendedor";
  if (outcome === "reject_claim") return "Reclamo rechazado por administración";
  return "Reclamo resuelto";
}

export function marketplaceOrderTimelineItems(
  events: MarketplaceOrderEvent[],
  allocationStatus?: MarketplaceHeldAllocation["status"] | null,
  settlement?: MarketplaceTimelineSettlement | null,
  returnRefundMode?: "keep_item" | "returned_item" | null,
): MarketplaceTimelineItem[] {
  const label = (event: MarketplaceOrderEvent) => {
    if (event.eventType === "dispute_resolved")
      return marketplaceDisputeResolutionEventLabel(event.disputeOutcome);
    return ({
      order_confirmed: "Pedido confirmado",
      processing_started: "El vendedor comenzó a preparar el pedido",
      shipment_created: "Pedido enviado",
      order_shipped: "Pedido enviado",
      shipment_updated: "Información de seguimiento actualizada",
      delivery_confirmed: "Entrega confirmada",
      escrow_released: "Fondos liberados al vendedor",
      dispute_opened: "Problema reportado",
      refund_created:
        returnRefundMode === "returned_item"
          ? "Reembolso de devolución completado"
          : "Fondos reembolsados al comprador",
      return_requested: "Solicitud de devolución enviada",
      return_approved: "Devolución aceptada",
      return_rejected: "Devolución rechazada por el vendedor",
      return_instructions_provided: "Dirección de devolución disponible",
      return_label_sent: "Label de devolución enviado",
      return_shipped: "Producto enviado de regreso",
      return_received: "Producto recibido por el vendedor",
    } as Record<string, string>)[event.eventType] ?? "Actualización del pedido";
  };
  const items = events.map((event, sourceIndex) => ({
    id: event.id,
    label: label(event),
    createdAt: event.createdAt,
    sourceIndex,
  }));
  if (
    !events.some((event) => event.eventType === "escrow_released") &&
    allocationStatus === "released" &&
    settlement?.status === "completed"
  )
    items.push({
      id: "derived-settlement-release",
      label: "Fondos liberados al vendedor",
      createdAt: settlement.releasedAt,
      sourceIndex: events.length,
    });
  return items
    .sort((left, right) => {
      const timestampDifference = Date.parse(left.createdAt) - Date.parse(right.createdAt);
      return timestampDifference || left.sourceIndex - right.sourceIndex;
    })
    .map(({ id, label: itemLabel, createdAt }) => ({ id, label: itemLabel, createdAt }));
}

export function formatOrderNumberForList(orderNumber: string) {
  const normalized = orderNumber.trim();
  if (normalized.length <= 14) return normalized;
  return `${normalized.slice(0, 8)}…${normalized.slice(-5)}`;
}

export function marketplaceDisputeReasonLabel(reasonCode: string) {
  return ({
    not_received: "No recibí el pedido",
    damaged: "Producto dañado",
    incorrect_item: "Producto incorrecto",
    missing_items: "Faltan artículos",
    other: "Otro problema",
  } as Record<string, string>)[reasonCode] ?? "Problema reportado";
}

export function marketplaceDisputeOutcomeMessage(dispute: MarketplaceDisputeSummary) {
  if (dispute.status === "open" || dispute.status === "under_review")
    return "El pago permanece pausado mientras revisamos el problema.";
  if (dispute.status === "resolved" && dispute.outcome === "refund_buyer")
    return "El reembolso fue completado.";
  if (dispute.status === "resolved" && dispute.outcome === "release_seller")
    return "La revisión terminó y los fondos fueron liberados al vendedor.";
  if (dispute.status === "rejected" || dispute.outcome === "reject_claim")
    return "El reclamo fue rechazado.";
  if (dispute.status === "cancelled") return "El reclamo fue cancelado.";
  return "La revisión del problema terminó.";
}

export function buyerOrderProtectionMessage(
  status: MarketplaceOrderStatus,
  dispute: MarketplaceDisputeSummary | null,
) {
  if (dispute) return marketplaceDisputeOutcomeMessage(dispute);
  if (status === "delivered")
    return "Entrega confirmada y fondos liquidados de forma segura.";
  if (status === "refunded" || status === "partially_refunded")
    return "El estado del reembolso está reflejado en este pedido.";
  return "Tu pago permanece protegido durante la entrega.";
}
