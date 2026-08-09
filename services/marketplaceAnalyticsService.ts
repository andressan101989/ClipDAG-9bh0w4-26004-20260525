import{randomUUID}from'expo-crypto';
import{getSupabaseClient}from'@/template';
import{marketplaceAnalyticsAppliedQuantity,marketplaceCheckoutAnalyticsTargets,parseMarketplaceAnalyticsSource}from'./marketplaceAnalyticsCore.mjs';

export type MarketplaceAnalyticsSourceType='direct'|'shop'|'search'|'feed'|'clip'|'live'|'creator'|'affiliate'|'unknown';
export interface MarketplaceCommerceSource{type:MarketplaceAnalyticsSourceType;entityId:string|null;creatorId:string|null;liveSessionId:string|null}
export interface MarketplaceSellerSummary{product_views:number;unique_viewer_sessions:number;add_to_cart_events:number;checkout_started:number;orders:number;purchase_items:number;units_sold:number;gross_merchandise_bdag:number;view_to_cart_event_rate:number;view_to_purchase_event_rate:number}
export interface MarketplaceProductAnalyticsRow{product_id:string;title:string|null;views:number;add_to_cart:number;purchase_orders:number;purchase_items:number;units_sold:number;gmv_bdag:number;view_to_cart_event_rate:number;view_to_purchase_event_rate:number}
export interface MarketplaceDailyAnalyticsRow{event_day:string;views:number;add_to_cart:number;orders:number;purchase_items:number;units_sold:number;gmv_bdag:number}
export interface MarketplaceSourceAnalyticsRow{source_type:MarketplaceAnalyticsSourceType;views:number;add_to_cart:number;orders:number;purchase_items:number;units_sold:number;gmv_bdag:number}
export interface MarketplaceVariantAnalyticsRow{product_id:string;variant_id:string;product_title:string|null;sku:string|null;selections:number;add_to_cart:number;purchase_orders:number;purchase_items:number;units_sold:number;gmv_bdag:number}
export interface MarketplaceSellerAnalytics{date_from:string;date_to:string;timezone:'UTC';summary:MarketplaceSellerSummary;products:MarketplaceProductAnalyticsRow[];daily:MarketplaceDailyAnalyticsRow[];sources:MarketplaceSourceAnalyticsRow[]}
type RecordInput={eventName:'product_view'|'product_media_view'|'variant_selected'|'add_to_cart'|'checkout_started';productId:string;variantId?:string|null;quantity?:number|null;source?:MarketplaceCommerceSource;metadata?:Record<string,number|string|boolean>;idempotencyKey?:string};
const clientSessionId=randomUUID();
const db=()=>getSupabaseClient();

export const marketplaceCommerceSessionId=()=>clientSessionId;
export const marketplaceCommerceEventKey=(prefix:string)=>`${prefix}:${randomUUID()}`;
export const marketplaceSourceFromParams=(params:{source?:string;sourceId?:string;creatorId?:string;liveSessionId?:string}):MarketplaceCommerceSource=>parseMarketplaceAnalyticsSource({type:params.source,entityId:params.sourceId,creatorId:params.creatorId,liveSessionId:params.liveSessionId});

async function record(input:RecordInput){
 const source=input.source??{type:'unknown' as const,entityId:null,creatorId:null,liveSessionId:null};
 if(__DEV__)console.info('[MarketplaceAnalytics]',{operation:'event_record_start',event:input.eventName,productIdPresent:Boolean(input.productId),sourceType:source.type});
 try{
  const{error}=await db().rpc('record_marketplace_commerce_event',{p_event_name:input.eventName,p_product_id:input.productId,p_variant_id:input.variantId??null,p_client_session_id:clientSessionId,p_source_type:source.type,p_source_entity_id:source.entityId,p_source_creator_id:source.creatorId,p_source_live_session_id:source.liveSessionId,p_quantity:input.quantity??null,p_metadata:input.metadata??{},p_idempotency_key:input.idempotencyKey??null});
  if(error)throw error;
  if(__DEV__)console.info('[MarketplaceAnalytics]',{operation:'event_record_success',event:input.eventName});
  return true;
 }catch(error){
  if(__DEV__)console.info('[MarketplaceAnalytics]',{operation:'event_record_failed',event:input.eventName,code:typeof error==='object'&&error&&'code'in error?String(error.code):'unknown'});
  return false;
 }
}

export const recordProductView=(input:Omit<RecordInput,'eventName'>)=>record({...input,eventName:'product_view'});
export const recordProductMediaView=(input:Omit<RecordInput,'eventName'>)=>record({...input,eventName:'product_media_view'});
export const recordVariantSelected=(input:Omit<RecordInput,'eventName'>)=>record({...input,eventName:'variant_selected'});
export const recordAddToCart=(input:Omit<RecordInput,'eventName'>)=>record({...input,eventName:'add_to_cart'});
export const recordCheckoutStarted=(input:Omit<RecordInput,'eventName'>)=>record({...input,eventName:'checkout_started'});

export async function fetchMyMarketplaceCommerceAnalytics(dateFrom:string,dateTo:string):Promise<MarketplaceSellerAnalytics>{
 if(__DEV__)console.info('[MarketplaceAnalytics]',{operation:'seller_summary_load'});
 const{data,error}=await db().rpc('get_my_marketplace_commerce_analytics',{p_date_from:dateFrom,p_date_to:dateTo});
 if(error){if(__DEV__)console.info('[MarketplaceAnalytics]',{operation:'seller_summary_failed',code:error.code});throw error;}
 return data as MarketplaceSellerAnalytics;
}
export async function fetchMyMarketplaceVariantAnalytics(dateFrom:string,dateTo:string):Promise<MarketplaceVariantAnalyticsRow[]>{
 const{data,error}=await db().rpc('get_my_marketplace_variant_analytics',{p_date_from:dateFrom,p_date_to:dateTo});if(error)throw error;return data as MarketplaceVariantAnalyticsRow[];
}

export{marketplaceAnalyticsAppliedQuantity,marketplaceCheckoutAnalyticsTargets,parseMarketplaceAnalyticsSource};
