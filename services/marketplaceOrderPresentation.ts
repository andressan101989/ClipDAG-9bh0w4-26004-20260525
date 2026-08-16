import type {
  MarketplaceDisputeOutcome,
  MarketplaceDisputeStatus,
  MarketplaceOrderStatus,
} from "@/services/marketplaceFulfillmentService";

export type MarketplaceDisputeSummary = {
  status: MarketplaceDisputeStatus;
  reasonCode: string;
  outcome: MarketplaceDisputeOutcome | null;
};

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
