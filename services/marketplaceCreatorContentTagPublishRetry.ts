import type { MarketplaceCreatorShowcaseProduct } from "./marketplaceCreatorShowcaseService";
import type { MarketplaceCreatorContentType } from "./marketplaceCreatorContentTagService";

export interface PendingCreatorContentTagSave {
  contentId: string;
  contentType: MarketplaceCreatorContentType;
  productIds: string[];
  selectedProducts: MarketplaceCreatorShowcaseProduct[];
  idempotencyKey: string;
}

export function createPendingCreatorContentTagSave(input: PendingCreatorContentTagSave): PendingCreatorContentTagSave {
  return {
    contentId: input.contentId,
    contentType: input.contentType,
    productIds: [...input.productIds],
    selectedProducts: [...input.selectedProducts],
    idempotencyKey: input.idempotencyKey,
  };
}

export async function attemptCreatorContentTagSave(
  pending: PendingCreatorContentTagSave,
  save: (command: PendingCreatorContentTagSave) => Promise<unknown>,
): Promise<{ ok: true; pending: null } | { ok: false; pending: PendingCreatorContentTagSave; error: unknown }> {
  try {
    await save(pending);
    return { ok: true, pending: null };
  } catch (error) {
    return { ok: false, pending, error };
  }
}
