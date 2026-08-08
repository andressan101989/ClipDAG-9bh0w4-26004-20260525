export function classifySellerProductStatusCore(product: {
  published_at: string | null;
  status: string;
  available_quantity: number;
  publication_readiness_reason: string | null;
}): "draft" | "published" | "sold_out" | "configuration_required" | "paused";
