import {getSupabaseClient} from '@/template';

export interface ShippingAddressInput {recipientName:string;line1:string;line2?:string;city:string;region:string;postalCode:string;country:string;phone?:string}
export interface CheckoutReservationInputItem {variantId:string;quantity:number}
export type MarketplaceReservationStatus='active'|'consumed'|'released'|'expired';
export type MarketplaceCheckoutStatus='pending_payment'|'payment_processing'|'paid'|'cancelled'|'expired'|'failed';
export interface MarketplaceOrderItem {id:string;productId:string;variantId:string;productTitle:string;variantTitle:string|null;sku:string;options:{option_id:string;option_name:string;value_id:string;value:string}[];imageUrl:string|null;currency:'BDAG';unitPrice:number;quantity:number;lineTotal:number;reservationStatus:MarketplaceReservationStatus}
export interface FrozenMarketplaceShipping {shippingProfileId:string;matchedRuleId:string;countryCode:string;regionCode:string|null;shippingAmount:number;currency:'BDAG';processingDaysMin:number;processingDaysMax:number;transitDaysMin:number;transitDaysMax:number;quoteTimestamp:string;shippingQuoteFingerprint:string;quantityPolicy:'per_order_profile'}
export interface MarketplaceOrderSummary {id:string;orderNumber:string;sellerId:string;storeId:string;status:string;subtotal:number;shippingAmount:number;total:number;reservationExpiresAt:string;frozenShipping:FrozenMarketplaceShipping[];items:MarketplaceOrderItem[]}
export interface MarketplaceCheckoutSummary {id:string;reference:string;status:MarketplaceCheckoutStatus;currency:'BDAG';subtotal:number;shippingAmount:number;total:number;expiresAt:string;createdAt:string;shippingQuotePolicy:'frozen_until_expiry'}
export interface CreateCheckoutReservationResult {checkout:MarketplaceCheckoutSummary&{paidAt?:string|null};shippingAddress:{recipientName:string;city:string;region:string;country:string};orders:MarketplaceOrderSummary[];payment?:{id:string;status:string;currency:'BDAG';grossAmount:number;feeBps:number;paidAt:string}|null}

export const MARKETPLACE_ORDER_ERROR_CODES=[
  'marketplace_active_checkout_exists','marketplace_idempotency_conflict','marketplace_invalid_checkout_items',
  'marketplace_duplicate_variant','marketplace_product_unavailable','marketplace_variant_unavailable',
  'marketplace_insufficient_inventory','marketplace_own_product_forbidden','marketplace_invalid_shipping_address',
  'marketplace_checkout_not_found','marketplace_checkout_not_cancellable',
  'marketplace_shipping_profile_missing','marketplace_shipping_profile_inactive','marketplace_shipping_configuration_required',
  'marketplace_shipping_destination_unsupported','marketplace_shipping_country_invalid','marketplace_shipping_region_invalid',
  'marketplace_shipping_rule_ambiguous','marketplace_shipping_price_invalid','marketplace_shipping_quote_stale',
] as const;
export type MarketplaceOrderErrorCode=typeof MARKETPLACE_ORDER_ERROR_CODES[number]|'marketplace_order_transport'|'marketplace_order_unknown';
export class MarketplaceOrderServiceError extends Error {constructor(public code:MarketplaceOrderErrorCode){super(code);this.name='MarketplaceOrderServiceError';}}
const db=()=>getSupabaseClient();
const numberValue=(value:unknown)=>{const n=Number(value);if(!Number.isFinite(n)||n<0)throw new MarketplaceOrderServiceError('marketplace_order_unknown');return n;};
const requiredString=(value:unknown)=>{if(typeof value!=='string'||!value||value==='undefined'||value==='null')throw new MarketplaceOrderServiceError('marketplace_order_unknown');return value;};
const knownCode=(error:unknown):MarketplaceOrderErrorCode=>{
  const message=typeof error==='object'&&error&&'message'in error?String((error as {message:unknown}).message):'';
  return MARKETPLACE_ORDER_ERROR_CODES.find(code=>message===code||message.includes(code))??'marketplace_order_unknown';
};
type RpcErrorShape={code?:unknown;message?:unknown;details?:unknown;hint?:unknown};
const safeDiagnosticValue=(value:unknown)=>typeof value==='string'?value.slice(0,300):null;
const invokeError=(rpc:string,error:unknown):never=>{
  const value=error&&typeof error==='object'?error as RpcErrorShape:{};
  if(__DEV__)console.error('[MarketplaceOrder] RPC failed',{rpc,code:safeDiagnosticValue(value.code),message:safeDiagnosticValue(value.message),details:safeDiagnosticValue(value.details),hint:safeDiagnosticValue(value.hint)});
  const message=safeDiagnosticValue(value.message)??'';
  const transport=!safeDiagnosticValue(value.code)&&/network request failed|failed to fetch|fetch failed|networkerror/i.test(message);
  throw new MarketplaceOrderServiceError(transport?'marketplace_order_transport':knownCode(error));
};

export function normalizeShippingAddress(input:ShippingAddressInput):ShippingAddressInput {
  return {recipientName:input.recipientName.trim(),line1:input.line1.trim(),line2:input.line2?.trim()||undefined,
    city:input.city.trim(),region:input.region.trim(),postalCode:input.postalCode.trim(),country:input.country.trim(),phone:input.phone?.trim()||undefined};
}
export function validateShippingAddress(input:ShippingAddressInput):Partial<Record<keyof ShippingAddressInput,string>> {
  const a=normalizeShippingAddress(input);const errors:Partial<Record<keyof ShippingAddressInput,string>>={};
  if(a.recipientName.length<2||a.recipientName.length>120)errors.recipientName='Ingresa un nombre válido.';
  if(a.line1.length<2||a.line1.length>180)errors.line1='Ingresa una dirección válida.';
  if((a.line2?.length??0)>180)errors.line2='La referencia es demasiado larga.';
  if(!a.city||a.city.length>100)errors.city='Ingresa una ciudad válida.';
  if(!a.region||a.region.length>100)errors.region='Ingresa un estado o provincia.';
  if(!a.postalCode||a.postalCode.length>30)errors.postalCode='Ingresa un código postal.';
  if(a.country.length<2||a.country.length>100)errors.country='Ingresa un país válido.';
  if((a.phone?.length??0)>40)errors.phone='Ingresa un teléfono válido.';
  return errors;
}
export function parseMarketplaceCheckoutReservation(value:unknown):CreateCheckoutReservationResult {
  if(!value||typeof value!=='object')throw new MarketplaceOrderServiceError('marketplace_order_unknown');
  const root=value as Record<string,unknown>;const c=root.checkout as Record<string,unknown>;const a=root.shipping_address as Record<string,unknown>;
  if(!c||c.currency!=='BDAG'||!Array.isArray(root.orders))throw new MarketplaceOrderServiceError('marketplace_order_unknown');
  const orders=root.orders.map(raw=>{const o=raw as Record<string,unknown>;if(!Array.isArray(o.items))throw new MarketplaceOrderServiceError('marketplace_order_unknown');const frozen=Array.isArray(o.frozen_shipping)?o.frozen_shipping:[];return {
    id:requiredString(o.id),orderNumber:requiredString(o.order_number),sellerId:requiredString(o.seller_id),storeId:requiredString(o.store_id),status:requiredString(o.status),subtotal:numberValue(o.subtotal),shippingAmount:numberValue(o.shipping_amount??0),total:numberValue(o.total),reservationExpiresAt:requiredString(o.reservation_expires_at),frozenShipping:frozen.map(rawShipping=>{const s=rawShipping as Record<string,unknown>;return{shippingProfileId:requiredString(s.shipping_profile_id),matchedRuleId:requiredString(s.matched_rule_id),countryCode:requiredString(s.country_code),regionCode:s.region_code==null?null:requiredString(s.region_code),shippingAmount:numberValue(s.shipping_amount),currency:'BDAG' as const,processingDaysMin:numberValue(s.processing_days_min),processingDaysMax:numberValue(s.processing_days_max),transitDaysMin:numberValue(s.transit_days_min),transitDaysMax:numberValue(s.transit_days_max),quoteTimestamp:requiredString(s.quote_timestamp),shippingQuoteFingerprint:requiredString(s.quote_fingerprint),quantityPolicy:'per_order_profile' as const};}),
    items:o.items.map(rawItem=>{const i=rawItem as Record<string,unknown>;if(i.currency!=='BDAG'||!Array.isArray(i.options))throw new MarketplaceOrderServiceError('marketplace_order_unknown');return {id:String(i.id),productId:String(i.product_id),variantId:String(i.variant_id),productTitle:String(i.product_title),variantTitle:i.variant_title==null?null:String(i.variant_title),sku:String(i.sku),options:i.options as MarketplaceOrderItem['options'],imageUrl:i.image_url==null?null:String(i.image_url),currency:'BDAG' as const,unitPrice:numberValue(i.unit_price),quantity:numberValue(i.quantity),lineTotal:numberValue(i.line_total),reservationStatus:String(i.reservation_status) as MarketplaceReservationStatus};}),
  };});
  const rawPayment=root.payment as Record<string,unknown>|null|undefined;const payment=rawPayment?{id:String(rawPayment.id),status:String(rawPayment.status),currency:'BDAG' as const,grossAmount:numberValue(rawPayment.gross_amount),feeBps:numberValue(rawPayment.fee_bps),paidAt:String(rawPayment.paid_at)}:null;
  return {checkout:{id:requiredString(c.id),reference:requiredString(c.reference),status:requiredString(c.status) as MarketplaceCheckoutStatus,currency:'BDAG',subtotal:numberValue(c.subtotal),shippingAmount:numberValue(c.shipping_amount??0),total:numberValue(c.total),expiresAt:requiredString(c.expires_at),createdAt:requiredString(c.created_at),shippingQuotePolicy:'frozen_until_expiry',paidAt:c.paid_at==null?null:requiredString(c.paid_at)},shippingAddress:{recipientName:requiredString(a.recipient_name),city:requiredString(a.city),region:requiredString(a.region),country:requiredString(a.country)},orders,payment};
}
export async function createCheckoutReservation(items:CheckoutReservationInputItem[],address:ShippingAddressInput,idempotencyKey:string){
  const {data,error}=await db().rpc('create_marketplace_checkout_reservation',{p_items:items.map(item=>({variant_id:item.variantId,quantity:item.quantity})),p_shipping_address:{recipient_name:address.recipientName,line1:address.line1,line2:address.line2??null,city:address.city,region:address.region,postal_code:address.postalCode,country:address.country,phone:address.phone??null},p_idempotency_key:idempotencyKey});
  if(error)invokeError('create_marketplace_checkout_reservation',error);return parseMarketplaceCheckoutReservation(data);
}
export async function cancelCheckoutReservation(checkoutId:string){const rpc='cancel_marketplace_checkout_reservation';const {data,error}=await db().rpc(rpc,{p_checkout_id:checkoutId});if(error)invokeError(rpc,error);return parseMarketplaceCheckoutReservation(data);}
export async function fetchMyCheckout(checkoutId:string){const rpc='fetch_my_marketplace_checkout';const {data,error}=await db().rpc(rpc,{p_checkout_id:checkoutId});if(error)invokeError(rpc,error);return parseMarketplaceCheckoutReservation(data);}
export async function fetchMyActiveCheckout(){const rpc='fetch_my_active_marketplace_checkout';const {data,error}=await db().rpc(rpc);if(error)invokeError(rpc,error);return data==null?null:parseMarketplaceCheckoutReservation(data);}
export async function expireMarketplaceCheckoutReservations(){const rpc='expire_marketplace_checkout_reservations';const {data,error}=await db().rpc(rpc,{p_limit:100});if(error)invokeError(rpc,error);return Number(data??0);}
