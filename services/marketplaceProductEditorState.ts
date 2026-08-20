import type { ProductEditorMedia } from "@/services/marketplaceProductDraftService";

export const replaceEditorMedia = (
  items: ProductEditorMedia[],
  clientKey: string,
  replacement: ProductEditorMedia,
) => items.map((item) => (item.clientKey === clientKey ? replacement : item));

export const readyProductImages = (items: ProductEditorMedia[]) =>
  items
    .filter((item) => item.kind === "image" && item.state === "ready")
    .map((item, position) => ({ ...item, position }));

export const deriveMarketplaceVariantsReady = (payload: {
  detail: {
    variants: {
      id: string;
      status: string;
      is_default: boolean;
      sku: string | null;
      price: number;
    }[];
  };
  inventory: { variant_id: string }[];
}) => {
  const active = payload.detail.variants.filter(
    (variant) => variant.status === "active",
  );
  const inventoryIds = new Set(payload.inventory.map((row) => row.variant_id));
  return (
    active.length > 0 &&
    active.filter((variant) => variant.is_default).length === 1 &&
    active.every(
      (variant) =>
        Boolean(variant.sku?.trim()) &&
        Number.isFinite(variant.price) &&
        variant.price > 0 &&
        inventoryIds.has(variant.id),
    )
  );
};

type PublishedProductVariant = {
  id: string;
  status: string;
  is_default: boolean;
  price: number;
  base_price: number;
};

type PublishedProductInventoryLevel = {
  variant_id: string;
  on_hand: number;
};

export type PublishedProductSyncStage =
  | "variant_fetch_failed"
  | "variant_state_invalid"
  | "inventory_state_invalid"
  | "variant_update_failed"
  | "inventory_update_failed";

export class PublishedProductSyncError extends Error {
  readonly stage: PublishedProductSyncStage;
  readonly originalError: unknown;

  constructor(
    stage: PublishedProductSyncStage,
    originalError: unknown = null,
  ) {
    super(stage);
    this.name = "PublishedProductSyncError";
    this.stage = stage;
    this.originalError = originalError;
  }
}

export type PublishedProductSyncResult = {
  kind: "configurable" | "simple";
  priceUpdated: boolean;
  inventoryUpdated: boolean;
};

export async function syncPublishedSimpleProductChanges(input: {
  variants: PublishedProductVariant[];
  optionsCount: number;
  inventory: PublishedProductInventoryLevel[];
  editorPrice: number;
  editorStock: number;
  updatePrice: (variant: PublishedProductVariant) => Promise<void>;
  updateInventory: (variant: PublishedProductVariant) => Promise<void>;
}): Promise<PublishedProductSyncResult> {
  const configurableVariants = input.variants.filter(
    (variant) => variant.status !== "archived",
  );
  if (configurableVariants.length !== 1 || input.optionsCount !== 0)
    return {
      kind: "configurable",
      priceUpdated: false,
      inventoryUpdated: false,
    };

  const defaultVariant = configurableVariants.find(
    (variant) => variant.is_default,
  );
  if (!defaultVariant)
    throw new PublishedProductSyncError("variant_state_invalid");

  const currentInventory = input.inventory.find(
    (level) => level.variant_id === defaultVariant.id,
  );
  if (!currentInventory)
    throw new PublishedProductSyncError("inventory_state_invalid");

  const priceChanged = defaultVariant.base_price !== input.editorPrice;
  const inventoryChanged = currentInventory.on_hand !== input.editorStock;
  if (priceChanged) {
    try {
      await input.updatePrice(defaultVariant);
    } catch (error) {
      throw new PublishedProductSyncError("variant_update_failed", error);
    }
  }
  if (inventoryChanged) {
    try {
      await input.updateInventory(defaultVariant);
    } catch (error) {
      throw new PublishedProductSyncError("inventory_update_failed", error);
    }
  }
  return {
    kind: "simple",
    priceUpdated: priceChanged,
    inventoryUpdated: inventoryChanged,
  };
}

export class LatestSaveQueue<T> {
  private chain: Promise<void> = Promise.resolve();
  private revision = 0;
  private savedRevision = 0;

  edit() {
    this.revision += 1;
    return this.revision;
  }

  currentRevision() {
    return this.revision;
  }

  isCurrent(revision: number) {
    return revision === this.revision && revision === this.savedRevision;
  }

  enqueue(snapshot: T, worker: (snapshot: T) => Promise<void>) {
    const revision = this.revision;
    let succeeded = false;
    const run = this.chain.then(async () => {
      await worker(snapshot);
      this.savedRevision = Math.max(this.savedRevision, revision);
      succeeded = true;
    });
    this.chain = run.catch(() => undefined);
    return run.then(() => ({
      revision,
      current: this.isCurrent(revision),
      succeeded,
    }));
  }

  wait() {
    return this.chain;
  }
}
