import {getSupabaseClient} from '@/template';
import {rpcArray,rpcEnum,rpcNonnegative,rpcNonnegativeInteger,rpcNullableString,
  rpcObject,rpcString,rpcTimestamp,rpcUuid} from '@/services/marketplaceRuntimeValidation';

export interface ShippingAddressInput {recipientName:string;line1:string;line2?:string;city:string;region:string;postalCode:string;country:string;phone?:string}
export interface CheckoutReservationInputItem {variantId:string;quantity:number;attributionId?:string}
export type MarketplaceReservationStatus='active'|'consumed'|'released'|'expired';
export type MarketplaceCheckoutStatus='pending_payment'|'payment_processing'|'paid'|'cancelled'|'expired'|'failed';
export type MarketplaceOrderStatus='pending_payment'|'confirmed'|'processing'|'shipped'|'delivered'|'cancelled'|'expired'|'refunded'|'partially_refunded';
export type MarketplacePaymentStatus='paid'|'partially_refunded'|'refunded';
export interface MarketplaceOrderItem {id:string;productId:string;variantId:string;productTitle:string;variantTitle:string|null;sku:string;options:{option_id:string;option_name:string;value_id:string;value:string}[];imageUrl:string|null;currency:'BDAG';unitPrice:number;quantity:number;lineTotal:number;reservationStatus:MarketplaceReservationStatus}
export interface FrozenMarketplaceShipping {shippingProfileId:string;matchedRuleId:string;countryCode:string;regionCode:string|null;shippingAmount:number;currency:'BDAG';processingDaysMin:number;processingDaysMax:number;transitDaysMin:number;transitDaysMax:number;quoteTimestamp:string;shippingQuoteFingerprint:string;quantityPolicy:'per_order_profile'}
export interface MarketplaceOrderSummary {id:string;orderNumber:string;sellerId:string;storeId:string;status:MarketplaceOrderStatus;subtotal:number;shippingAmount:number;total:number;reservationExpiresAt:string;frozenShipping:FrozenMarketplaceShipping[];items:MarketplaceOrderItem[]}
export interface MarketplaceCheckoutSummary {id:string;reference:string;status:MarketplaceCheckoutStatus;currency:'BDAG';subtotal:number;shippingAmount:number;total:number;expiresAt:string;createdAt:string;shippingQuotePolicy:'frozen_until_expiry'}
export interface CreateCheckoutReservationResult {checkout:MarketplaceCheckoutSummary&{paidAt?:string|null};shippingAddress:{recipientName:string;city:string;region:string;country:string};orders:MarketplaceOrderSummary[];payment?:{id:string;status:MarketplacePaymentStatus;currency:'BDAG';grossAmount:number;feeBps:number;paidAt:string}|null}

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
const numberValue=(value:unknown)=>{try{return rpcNonnegative(value,'order.number');}catch{throw new MarketplaceOrderServiceError('marketplace_order_unknown');}};
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
 try{
  const root=rpcObject(value,'checkout'),c=rpcObject(root.checkout,'checkout.checkout'),a=rpcObject(root.shipping_address,'checkout.shipping_address');
  const orders=rpcArray(root.orders,'checkout.orders').map((raw,orderIndex)=>{const o=rpcObject(raw,`checkout.orders[${orderIndex}]`);return {
    id:rpcUuid(o.id,`checkout.orders[${orderIndex}].id`),orderNumber:rpcString(o.order_number,`checkout.orders[${orderIndex}].order_number`),sellerId:rpcUuid(o.seller_id,`checkout.orders[${orderIndex}].seller_id`),storeId:rpcUuid(o.store_id,`checkout.orders[${orderIndex}].store_id`),status:rpcEnum(o.status,['pending_payment','confirmed','processing','shipped','delivered','cancelled','expired','refunded','partially_refunded']as const,`checkout.orders[${orderIndex}].status`),subtotal:numberValue(o.subtotal),shippingAmount:numberValue(o.shipping_amount),total:numberValue(o.total),reservationExpiresAt:rpcTimestamp(o.reservation_expires_at,`checkout.orders[${orderIndex}].reservation_expires_at`),
    frozenShipping:rpcArray(o.frozen_shipping,`checkout.orders[${orderIndex}].frozen_shipping`).map((rawShipping,shippingIndex)=>{const s=rpcObject(rawShipping,`checkout.orders[${orderIndex}].frozen_shipping[${shippingIndex}]`);return{shippingProfileId:rpcUuid(s.shipping_profile_id,'shipping_profile_id'),matchedRuleId:rpcUuid(s.matched_rule_id,'matched_rule_id'),countryCode:rpcString(s.country_code,'country_code'),regionCode:rpcNullableString(s.region_code,'region_code'),shippingAmount:numberValue(s.shipping_amount),currency:rpcEnum(s.currency,['BDAG']as const,'shipping.currency'),processingDaysMin:rpcNonnegativeInteger(s.processing_days_min,'shipping.processing_days_min'),processingDaysMax:rpcNonnegativeInteger(s.processing_days_max,'shipping.processing_days_max'),transitDaysMin:rpcNonnegativeInteger(s.transit_days_min,'shipping.transit_days_min'),transitDaysMax:rpcNonnegativeInteger(s.transit_days_max,'shipping.transit_days_max'),quoteTimestamp:rpcTimestamp(s.quote_timestamp,'shipping.quote_timestamp'),shippingQuoteFingerprint:rpcString(s.quote_fingerprint,'shipping.quote_fingerprint'),quantityPolicy:rpcEnum(s.quantity_policy,['per_order_profile']as const,'shipping.quantity_policy')};}),
    items:rpcArray(o.items,`checkout.orders[${orderIndex}].items`).map((rawItem,itemIndex)=>{const i=rpcObject(rawItem,`checkout.orders[${orderIndex}].items[${itemIndex}]`);const options=rpcArray(i.options,'item.options').map((rawOption,optionIndex)=>{const option=rpcObject(rawOption,`item.options[${optionIndex}]`);return{option_id:rpcUuid(option.option_id,'option.option_id'),option_name:rpcString(option.option_name,'option.option_name'),value_id:rpcUuid(option.value_id,'option.value_id'),value:rpcString(option.value,'option.value')}});return {id:rpcUuid(i.id,'item.id'),productId:rpcUuid(i.product_id,'item.product_id'),variantId:rpcUuid(i.variant_id,'item.variant_id'),productTitle:rpcString(i.product_title,'item.product_title'),variantTitle:rpcNullableString(i.variant_title,'item.variant_title'),sku:rpcString(i.sku,'item.sku'),options,imageUrl:rpcNullableString(i.image_url,'item.image_url'),currency:rpcEnum(i.currency,['BDAG']as const,'item.currency'),unitPrice:numberValue(i.unit_price),quantity:rpcNonnegativeInteger(i.quantity,'item.quantity'),lineTotal:numberValue(i.line_total),reservationStatus:rpcEnum(i.reservation_status,['active','consumed','released','expired']as const,'item.reservation_status')};}),
  };});
  const rawPayment=root.payment,payment=rawPayment==null?null:(()=>{const p=rpcObject(rawPayment,'checkout.payment');return{id:rpcUuid(p.id,'checkout.payment.id'),status:rpcEnum(p.status,['paid','partially_refunded','refunded']as const,'checkout.payment.status'),currency:rpcEnum(p.currency,['BDAG']as const,'checkout.payment.currency'),grossAmount:numberValue(p.gross_amount),feeBps:rpcNonnegativeInteger(p.fee_bps,'checkout.payment.fee_bps'),paidAt:rpcTimestamp(p.paid_at,'checkout.payment.paid_at')}})();
  return {checkout:{id:rpcUuid(c.id,'checkout.checkout.id'),reference:rpcString(c.reference,'checkout.checkout.reference'),status:rpcEnum(c.status,['pending_payment','payment_processing','paid','cancelled','expired','failed']as const,'checkout.checkout.status'),currency:rpcEnum(c.currency,['BDAG']as const,'checkout.checkout.currency'),subtotal:numberValue(c.subtotal),shippingAmount:numberValue(c.shipping_amount),total:numberValue(c.total),expiresAt:rpcTimestamp(c.expires_at,'checkout.checkout.expires_at'),createdAt:rpcTimestamp(c.created_at,'checkout.checkout.created_at'),shippingQuotePolicy:rpcEnum(c.shipping_quote_policy,['frozen_until_expiry']as const,'checkout.checkout.shipping_quote_policy'),paidAt:c.paid_at==null?null:rpcTimestamp(c.paid_at,'checkout.checkout.paid_at')},shippingAddress:{recipientName:rpcString(a.recipient_name,'checkout.shipping_address.recipient_name'),city:rpcString(a.city,'checkout.shipping_address.city'),region:rpcString(a.region,'checkout.shipping_address.region'),country:rpcString(a.country,'checkout.shipping_address.country')},orders,payment};
 }catch(error){if(error instanceof MarketplaceOrderServiceError)throw error;throw new MarketplaceOrderServiceError('marketplace_order_unknown');}
}
export async function createCheckoutReservation(items:CheckoutReservationInputItem[],address:ShippingAddressInput,idempotencyKey:string){
  const {data,error}=await db().rpc('create_marketplace_checkout_reservation',{p_items:items.map(item=>({variant_id:item.variantId,quantity:item.quantity})),p_shipping_address:{recipient_name:address.recipientName,line1:address.line1,line2:address.line2??null,city:address.city,region:address.region,postal_code:address.postalCode,country:address.country,phone:address.phone??null},p_idempotency_key:idempotencyKey});
  if(error)invokeError('create_marketplace_checkout_reservation',error);return parseMarketplaceCheckoutReservation(data);
}
export async function createCreatorCheckoutReservation(items:CheckoutReservationInputItem[],address:ShippingAddressInput,idempotencyKey:string){
  const rpc='create_marketplace_creator_checkout_reservation';
  const {data,error}=await db().rpc(rpc,{p_items:items.map(item=>({variant_id:item.variantId,quantity:item.quantity,...(item.attributionId?{attribution_id:item.attributionId}:{})})),p_shipping_address:{recipient_name:address.recipientName,line1:address.line1,line2:address.line2??null,city:address.city,region:address.region,postal_code:address.postalCode,country:address.country,phone:address.phone??null},p_idempotency_key:idempotencyKey});
  if(error)invokeError(rpc,error);return parseMarketplaceCheckoutReservation(data);
}
export async function cancelCheckoutReservation(checkoutId:string){const rpc='cancel_marketplace_checkout_reservation';const {data,error}=await db().rpc(rpc,{p_checkout_id:checkoutId});if(error)invokeError(rpc,error);return parseMarketplaceCheckoutReservation(data);}
export async function fetchMyCheckout(checkoutId:string){const rpc='fetch_my_marketplace_checkout';const {data,error}=await db().rpc(rpc,{p_checkout_id:checkoutId});if(error)invokeError(rpc,error);return parseMarketplaceCheckoutReservation(data);}
export async function fetchMyActiveCheckout(){const rpc='fetch_my_active_marketplace_checkout';const {data,error}=await db().rpc(rpc);if(error)invokeError(rpc,error);return data==null?null:parseMarketplaceCheckoutReservation(data);}
export async function expireMarketplaceCheckoutReservations(){const rpc='expire_marketplace_checkout_reservations';const {data,error}=await db().rpc(rpc,{p_limit:100});if(error)invokeError(rpc,error);try{return rpcNonnegativeInteger(data,'expiration.count');}catch{throw new MarketplaceOrderServiceError('marketplace_order_unknown');}}
