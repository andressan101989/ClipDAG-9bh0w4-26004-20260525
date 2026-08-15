import { getSupabaseClient } from "@/template";
import {rpcCursorPage,rpcEnum,rpcNullableNonnegative,rpcNullableString,rpcNullableUuid,
  rpcObject,rpcString,rpcTimestamp,rpcUuid} from "@/services/marketplaceRuntimeValidation";

export type MarketplacePromotionType = "percentage" | "fixed_amount" | "promotional_price";
export type MarketplacePromotionState = "active" | "scheduled" | "ended";
export interface MarketplacePromotion {
  id: string; productId: string; variantId: string | null; productTitle: string; variantTitle: string | null;
  promotionType: MarketplacePromotionType; percentageOff: number | null; fixedAmountBdag: number | null;
  promotionalPriceBdag: number | null; startsAt: string; endsAt: string; state: MarketplacePromotionState;
}
const db=()=>getSupabaseClient();
export const parseMarketplacePromotion=(value:unknown,path='promotion'):MarketplacePromotion=>{const v=rpcObject(value,path);return{id:rpcUuid(v.id,`${path}.id`),productId:rpcUuid(v.product_id,`${path}.product_id`),variantId:rpcNullableUuid(v.variant_id,`${path}.variant_id`),productTitle:rpcString(v.product_title,`${path}.product_title`),variantTitle:rpcNullableString(v.variant_title,`${path}.variant_title`),promotionType:rpcEnum(v.promotion_type,["percentage","fixed_amount","promotional_price"]as const,`${path}.promotion_type`),percentageOff:rpcNullableNonnegative(v.percentage_off,`${path}.percentage_off`),fixedAmountBdag:rpcNullableNonnegative(v.fixed_amount_bdag,`${path}.fixed_amount_bdag`),promotionalPriceBdag:rpcNullableNonnegative(v.promotional_price_bdag,`${path}.promotional_price_bdag`),startsAt:rpcTimestamp(v.starts_at,`${path}.starts_at`),endsAt:rpcTimestamp(v.ends_at,`${path}.ends_at`),state:rpcEnum(v.state,["active","scheduled","ended"]as const,`${path}.state`)}};
export interface MarketplacePromotionPage{items:MarketplacePromotion[];nextCursor:{createdAt:string;promotionId:string}|null}
export async function listMyMarketplacePromotionsPage(cursor:{createdAt:string;promotionId:string}|null=null,limit=100):Promise<MarketplacePromotionPage>{const{data,error}=await db().rpc("list_my_marketplace_promotions_v2",{p_cursor_created_at:cursor?.createdAt??null,p_cursor_promotion_id:cursor?.promotionId??null,p_limit:limit});if(error)throw error;const page=rpcCursorPage(data,'promotions'),items=page.items.map((value,index)=>parseMarketplacePromotion(value,`promotions.items[${index}]`)),raw=page.nextCursor;return{items,nextCursor:raw?{createdAt:rpcTimestamp(raw.created_at,'promotions.next_cursor.created_at'),promotionId:rpcUuid(raw.promotion_id,'promotions.next_cursor.promotion_id')}:null};}
export async function listMyMarketplacePromotions(){return(await listMyMarketplacePromotionsPage(null,100)).items;}
export async function createMarketplacePromotion(input:{productId:string;variantId?:string|null;type:MarketplacePromotionType;value:number;startsAt:Date;endsAt:Date;idempotencyKey:string}){const{data,error}=await db().rpc("create_marketplace_product_promotion",{p_product_id:input.productId,p_variant_id:input.variantId??null,p_promotion_type:input.type,p_value:input.value,p_starts_at:input.startsAt.toISOString(),p_ends_at:input.endsAt.toISOString(),p_idempotency_key:input.idempotencyKey});if(error)throw error;return data;}
export async function endMarketplacePromotion(id:string){const{error}=await db().rpc("end_marketplace_product_promotion",{p_promotion_id:id});if(error)throw error;}
export function promotionLabel(p:MarketplacePromotion){return p.promotionType==="percentage"?`${p.percentageOff}% menos`:p.promotionType==="fixed_amount"?`${p.fixedAmountBdag?.toFixed(2)} BDAG menos`:`${p.promotionalPriceBdag?.toFixed(2)} BDAG`;}
