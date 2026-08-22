import type {
  MarketplaceDisputeOutcome,
  MarketplaceDisputeStatus,
  MarketplaceHeldAllocation,
  MarketplaceOrderEvent,
  MarketplaceOrderStatus,
  MarketplaceReturnStatus,
} from "@/services/marketplaceFulfillmentService";

export type MarketplaceDisputeSummary = {
  status: MarketplaceDisputeStatus;
  reasonCode: string;
  outcome: MarketplaceDisputeOutcome | null;
};

export type MarketplaceTimelineSettlement = { status: string; releasedAt: string };
export type MarketplaceTimelineItem = { id: string; label: string; createdAt: string };

export function marketplaceReturnStatusCopy(status: MarketplaceReturnStatus) {
  if (status === "requested")
    return {
      title: "Solicitud de devolución enviada",
      body: "Esperando respuesta del vendedor.",
    };
  if (status === "approved")
    return {
      title: "Devolución aceptada",
      body: "El siguiente paso será coordinar el envío de regreso.",
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
      refund_created: "Fondos reembolsados al comprador",
      return_requested: "Solicitud de devolución enviada",
      return_approved: "Devolución aceptada",
      return_rejected: "Devolución rechazada por el vendedor",
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
