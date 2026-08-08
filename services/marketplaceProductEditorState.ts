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
