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

export type CreatorContentTagOperation = "idle" | "saving" | "clearing";

export function canStartCreatorContentPublication(
  pending: PendingCreatorContentTagSave | null,
  operation: CreatorContentTagOperation,
): boolean {
  return pending === null && operation === "idle";
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

export interface CreatorContentTagAuthorityCommand {
  contentId: string;
  contentType: MarketplaceCreatorContentType;
  productIds: string[];
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

export async function attemptCreatorContentTagAuthoritativeDiscard(
  pending: PendingCreatorContentTagSave,
  setTags: (command: CreatorContentTagAuthorityCommand) => Promise<unknown>,
): Promise<
  | { ok: true; pending: null }
  | {
      ok: false;
      pending: PendingCreatorContentTagSave;
      stage: "save_fence" | "clear";
      error: unknown;
    }
> {
  try {
    await setTags({
      contentId: pending.contentId,
      contentType: pending.contentType,
      productIds: [...pending.productIds],
      idempotencyKey: pending.idempotencyKey,
    });
  } catch (error) {
    return { ok: false, pending, stage: "save_fence", error };
  }

  const clearResult = await attemptCreatorContentTagClear(pending, setTags);
  if (!clearResult.ok) {
    return { ...clearResult, stage: "clear" };
  }
  return clearResult;
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
