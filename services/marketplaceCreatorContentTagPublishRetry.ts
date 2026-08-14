import type { MarketplaceCreatorShowcaseProduct } from "./marketplaceCreatorShowcaseService";
import type { MarketplaceCreatorContentType } from "./marketplaceCreatorContentTagService";

export interface PendingCreatorContentTagSave {
  contentId: string;
  contentType: MarketplaceCreatorContentType;
  productIds: string[];
  selectedProducts: MarketplaceCreatorShowcaseProduct[];
  idempotencyKey: string;
  clearIdempotencyKey: string;
}

export function createPendingCreatorContentTagSave(input: PendingCreatorContentTagSave): PendingCreatorContentTagSave {
  return {
    contentId: input.contentId,
    contentType: input.contentType,
    productIds: [...input.productIds],
    selectedProducts: [...input.selectedProducts],
    idempotencyKey: input.idempotencyKey,
    clearIdempotencyKey: input.clearIdempotencyKey,
  };
}

export interface CreatorContentTagClearCommand {
  contentId: string;
  contentType: MarketplaceCreatorContentType;
  productIds: [];
  idempotencyKey: string;
}

export async function attemptCreatorContentTagClear(
  pending: PendingCreatorContentTagSave,
  clear: (command: CreatorContentTagClearCommand) => Promise<unknown>,
): Promise<{ ok: true; pending: null } | { ok: false; pending: PendingCreatorContentTagSave; error: unknown }> {
  try {
    await clear({
      contentId: pending.contentId,
      contentType: pending.contentType,
      productIds: [],
      idempotencyKey: pending.clearIdempotencyKey,
    });
    return { ok: true, pending: null };
  } catch (error) {
    return { ok: false, pending, error };
  }
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
