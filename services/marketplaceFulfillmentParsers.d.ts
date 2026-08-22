import type {
  MarketplaceOrderDetail,
  MarketplaceOrderPage,
  MarketplaceSellerDisputePage,
} from "./marketplaceFulfillmentService";

export class MarketplaceFulfillmentPayloadError extends Error {
  readonly path: string;
}

export function isSafeMarketplaceTrackingUrl(value: string | null | undefined): boolean;
export function parseBuyerOrderListPayload(
  value: unknown,
  effectiveLimit: number,
): MarketplaceOrderPage;
export function parseSellerOrderListPayload(
  value: unknown,
  effectiveLimit: number,
): MarketplaceOrderPage;
export function parseSellerDisputeIndexPayload(
  value: unknown,
  effectiveLimit: number,
): MarketplaceSellerDisputePage;
export function parseMarketplaceOrderDetailPayload(value: unknown): MarketplaceOrderDetail;
export function mergeMarketplaceOrderLifecyclePayload(
  detail: MarketplaceOrderDetail,
  value: unknown,
): MarketplaceOrderDetail;
