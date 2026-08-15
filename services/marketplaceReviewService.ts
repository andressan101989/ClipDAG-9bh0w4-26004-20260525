import { getSupabaseClient } from "@/template";
import {
  rpcBoolean,
  rpcBoundedInteger,
  rpcCursorPage,
  rpcNullableNonnegative,
  rpcNullableString,
  rpcNullableText,
  rpcNullableUuid,
  rpcNonnegativeInteger,
  rpcObject,
  rpcString,
  rpcTimestamp,
  rpcUuid,
} from "@/services/marketplaceRuntimeValidation";

export interface MarketplaceReviewer {
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
}
export interface MarketplaceReview {
  id: string;
  rating: number;
  comment: string | null;
  verifiedPurchase: true;
  reviewer: MarketplaceReviewer;
  createdAt: string;
  updatedAt: string;
}
export interface MarketplaceReviewCursor { createdAt: string; id: string }
export interface MarketplaceReviewPage {
  items: MarketplaceReview[];
  pageSize: number;
  nextCursor: MarketplaceReviewCursor | null;
}
export interface MarketplaceRatingAggregate {
  averageRating: number | null;
  reviewCount: number;
}
export interface MarketplaceProductRatingAggregate extends MarketplaceRatingAggregate {
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}
export interface MarketplaceStoreBranding {
  id: string;
  sellerId: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  sellerDisplayName: string;
  sellerUsername: string | null;
}
export interface MarketplaceOwnReview {
  id: string;
  rating: number;
  comment: string | null;
  status: "visible" | "hidden";
  createdAt: string;
  updatedAt: string;
}
export interface MarketplaceReviewEligibility {
  eligible: boolean;
  targetId: string | null;
  review: MarketplaceOwnReview | null;
}
export interface MarketplaceProductReputation {
  productId: string;
  productAggregate: MarketplaceProductRatingAggregate;
  store: MarketplaceStoreBranding;
  sellerAggregate: MarketplaceRatingAggregate;
  productEligibility: MarketplaceReviewEligibility;
  sellerEligibility: MarketplaceReviewEligibility;
}
export interface MarketplaceStoreReputation {
  store: MarketplaceStoreBranding;
  sellerAggregate: MarketplaceRatingAggregate;
  productAggregate: MarketplaceRatingAggregate;
}

const db = () => getSupabaseClient();
const parseAggregate = (value: unknown, path: string): MarketplaceRatingAggregate => {
  const row = rpcObject(value, path);
  return {
    averageRating: rpcNullableNonnegative(row.average_rating, `${path}.average_rating`),
    reviewCount: rpcNonnegativeInteger(row.review_count, `${path}.review_count`),
  };
};
const parseProductAggregate = (value: unknown, path: string): MarketplaceProductRatingAggregate => {
  const aggregate = parseAggregate(value, path), distribution = rpcObject(rpcObject(value, path).distribution, `${path}.distribution`);
  return {
    ...aggregate,
    distribution: {
      1: rpcNonnegativeInteger(distribution["1"], `${path}.distribution.1`),
      2: rpcNonnegativeInteger(distribution["2"], `${path}.distribution.2`),
      3: rpcNonnegativeInteger(distribution["3"], `${path}.distribution.3`),
      4: rpcNonnegativeInteger(distribution["4"], `${path}.distribution.4`),
      5: rpcNonnegativeInteger(distribution["5"], `${path}.distribution.5`),
    },
  };
};
const parseStore = (value: unknown, path: string): MarketplaceStoreBranding => {
  const row = rpcObject(value, path);
  return {
    id: rpcUuid(row.id, `${path}.id`),
    sellerId: rpcUuid(row.seller_id, `${path}.seller_id`),
    name: rpcString(row.name, `${path}.name`),
    slug: rpcString(row.slug, `${path}.slug`),
    description: rpcNullableText(row.description, `${path}.description`),
    logoUrl: rpcNullableString(row.logo_url, `${path}.logo_url`),
    bannerUrl: rpcNullableString(row.banner_url, `${path}.banner_url`),
    sellerDisplayName: rpcString(row.seller_display_name, `${path}.seller_display_name`),
    sellerUsername: rpcNullableString(row.seller_username, `${path}.seller_username`),
  };
};
const parseOwnReview = (value: unknown, path: string): MarketplaceOwnReview | null => {
  if (value === null) return null;
  const row = rpcObject(value, path), status = rpcString(row.status, `${path}.status`);
  if (status !== "visible" && status !== "hidden") throw new Error(`marketplace_review_payload_invalid:${path}.status`);
  return {
    id: rpcUuid(row.id, `${path}.id`),
    rating: rpcBoundedInteger(row.rating, 1, 5, `${path}.rating`),
    comment: rpcNullableText(row.comment, `${path}.comment`),
    status,
    createdAt: rpcTimestamp(row.created_at, `${path}.created_at`),
    updatedAt: rpcTimestamp(row.updated_at, `${path}.updated_at`),
  };
};
const parseEligibility = (value: unknown, targetKey: "order_item_id" | "order_id", path: string): MarketplaceReviewEligibility => {
  const row = rpcObject(value, path), eligible = rpcBoolean(row.eligible, `${path}.eligible`), targetId = rpcNullableUuid(row[targetKey], `${path}.${targetKey}`);
  if (eligible !== (targetId !== null)) throw new Error(`marketplace_review_payload_invalid:${path}.eligible`);
  return { eligible, targetId, review: parseOwnReview(row.review, `${path}.review`) };
};
export function parseMarketplaceReview(value: unknown, path = "review"): MarketplaceReview {
  const row = rpcObject(value, path), reviewer = rpcObject(row.reviewer, `${path}.reviewer`);
  if (rpcBoolean(row.verified_purchase, `${path}.verified_purchase`) !== true)
    throw new Error(`marketplace_review_payload_invalid:${path}.verified_purchase`);
  return {
    id: rpcUuid(row.id, `${path}.id`),
    rating: rpcBoundedInteger(row.rating, 1, 5, `${path}.rating`),
    comment: rpcNullableText(row.comment, `${path}.comment`),
    verifiedPurchase: true,
    reviewer: {
      displayName: rpcString(reviewer.display_name, `${path}.reviewer.display_name`),
      username: rpcNullableString(reviewer.username, `${path}.reviewer.username`),
      avatarUrl: rpcNullableString(reviewer.avatar_url, `${path}.reviewer.avatar_url`),
    },
    createdAt: rpcTimestamp(row.created_at, `${path}.created_at`),
    updatedAt: rpcTimestamp(row.updated_at, `${path}.updated_at`),
  };
}
export function parseMarketplaceReviewPage(value: unknown, path = "review_page"): MarketplaceReviewPage {
  const page = rpcCursorPage(value, path);
  const nextCursor = page.nextCursor === null ? null : {
    createdAt: rpcTimestamp(page.nextCursor.created_at, `${path}.next_cursor.created_at`),
    id: rpcUuid(page.nextCursor.id, `${path}.next_cursor.id`),
  };
  return { items: page.items.map((item, index) => parseMarketplaceReview(item, `${path}.items[${index}]`)), pageSize: page.pageSize, nextCursor };
}
export function parseMarketplaceProductReputation(value: unknown): MarketplaceProductReputation {
  const row = rpcObject(value, "product_reputation");
  return {
    productId: rpcUuid(row.product_id, "product_reputation.product_id"),
    productAggregate: parseProductAggregate(row.product_aggregate, "product_reputation.product_aggregate"),
    store: parseStore(row.store, "product_reputation.store"),
    sellerAggregate: parseAggregate(row.seller_aggregate, "product_reputation.seller_aggregate"),
    productEligibility: parseEligibility(row.product_eligibility, "order_item_id", "product_reputation.product_eligibility"),
    sellerEligibility: parseEligibility(row.seller_eligibility, "order_id", "product_reputation.seller_eligibility"),
  };
}
export function parseMarketplaceStoreReputation(value: unknown): MarketplaceStoreReputation {
  const row = rpcObject(value, "store_reputation");
  return {
    store: parseStore(row.store, "store_reputation.store"),
    sellerAggregate: parseAggregate(row.seller_aggregate, "store_reputation.seller_aggregate"),
    productAggregate: parseAggregate(row.product_aggregate, "store_reputation.product_aggregate"),
  };
}
export async function fetchMarketplaceProductReputation(productId: string): Promise<MarketplaceProductReputation> {
  const { data, error } = await db().rpc("get_marketplace_product_reputation", { p_product_id: productId });
  if (error) throw error;
  return parseMarketplaceProductReputation(data);
}
export async function fetchMarketplaceStoreReputation(storeId: string): Promise<MarketplaceStoreReputation> {
  const { data, error } = await db().rpc("get_marketplace_store_reputation", { p_store_id: storeId });
  if (error) throw error;
  return parseMarketplaceStoreReputation(data);
}
async function fetchReviews(functionName: "search_marketplace_product_reviews" | "search_marketplace_store_reviews", idKey: "p_product_id" | "p_store_id", id: string, cursor: MarketplaceReviewCursor | null, limit: number) {
  const boundedLimit = Math.min(50, Math.max(1, limit));
  const { data, error } = await db().rpc(functionName, {
    [idKey]: id,
    p_before_created_at: cursor?.createdAt ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: boundedLimit,
  });
  if (error) throw error;
  return parseMarketplaceReviewPage(data);
}
export const fetchMarketplaceProductReviews = (productId: string, cursor: MarketplaceReviewCursor | null = null, limit = 10) => fetchReviews("search_marketplace_product_reviews", "p_product_id", productId, cursor, limit);
export const fetchMarketplaceStoreReviews = (storeId: string, cursor: MarketplaceReviewCursor | null = null, limit = 10) => fetchReviews("search_marketplace_store_reviews", "p_store_id", storeId, cursor, limit);
export async function submitMarketplaceProductReview(orderItemId: string, rating: number, comment: string): Promise<MarketplaceReview> {
  const { data, error } = await db().rpc("submit_my_marketplace_product_review", { p_order_item_id: orderItemId, p_rating: rating, p_comment: comment.trim() || null });
  if (error) throw error;
  return parseMarketplaceReview(data, "product_review_receipt");
}
export async function submitMarketplaceSellerReview(orderId: string, rating: number, comment: string): Promise<MarketplaceReview> {
  const { data, error } = await db().rpc("submit_my_marketplace_seller_review", { p_order_id: orderId, p_rating: rating, p_comment: comment.trim() || null });
  if (error) throw error;
  return parseMarketplaceReview(data, "seller_review_receipt");
}
