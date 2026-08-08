export function classifySellerProductStatusCore(product) {
  if (!product.published_at) return "draft";
  if (
    product.status === "sold_out" ||
    (product.status === "active" && product.available_quantity <= 0)
  )
    return "sold_out";
  if (product.status === "active") return "published";
  if (product.publication_readiness_reason) return "configuration_required";
  return "paused";
}
