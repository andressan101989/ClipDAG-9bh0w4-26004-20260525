import type {
  MarketplaceOrderDetail,
  MarketplaceOrderPage,
  MarketplaceSellerDisputePage,
  MarketplaceSellerReturnPage,
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
export function parseSellerReturnIndexPayload(
  value: unknown,
  effectiveLimit: number,
): MarketplaceSellerReturnPage;
export function parseMarketplaceOrderDetailPayload(value: unknown): MarketplaceOrderDetail;
export function mergeMarketplaceOrderLifecyclePayload(
  detail: MarketplaceOrderDetail,
  value: unknown,
): MarketplaceOrderDetail;
export function parseMarketplaceReturnMutationReceipt(value: unknown): unknown;
export function parseMarketplaceReturnShipmentMutationReceipt(value: unknown): unknown;
