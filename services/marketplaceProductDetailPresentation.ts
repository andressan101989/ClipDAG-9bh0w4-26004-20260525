import type { CartMutationResult } from "./marketplaceCart";
import type { MarketplaceProductGalleryItem } from "./marketplaceService";

export function selectVariantMediaIndex(items: MarketplaceProductGalleryItem[], variantImageUrl: string | null | undefined, currentIndex: number): number {
  if (!variantImageUrl) return currentIndex;
  const match = items.findIndex(item => item.kind === "image" && item.url === variantImageUrl);
  return match >= 0 ? match : currentIndex;
}

export interface MarketplaceCartToastFeedback { adjusted: boolean; title: "Agregado al carrito" | "Cantidad ajustada"; quantity: number; message: string }
export function marketplaceCartToastFeedback(result: Extract<CartMutationResult, { ok: true }>, requestedQuantity: number, selectionLabel: string): MarketplaceCartToastFeedback {
  if (result.status === "quantity_adjusted") return { adjusted: true, title: "Cantidad ajustada", quantity: result.applied, message: `Solo se pudieron agregar ${result.applied} unidades.` };
  return { adjusted: false, title: "Agregado al carrito", quantity: requestedQuantity, message: `${selectionLabel} · Cantidad ${requestedQuantity}` };
}
