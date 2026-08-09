import { getSupabaseClient } from "@/template";

export type MarketplacePromotionType = "percentage" | "fixed_amount" | "promotional_price";
export type MarketplacePromotionState = "active" | "scheduled" | "ended";
export interface MarketplacePromotion {
  id: string; productId: string; variantId: string | null; productTitle: string; variantTitle: string | null;
  promotionType: MarketplacePromotionType; percentageOff: number | null; fixedAmountBdag: number | null;
  promotionalPriceBdag: number | null; startsAt: string; endsAt: string; state: MarketplacePromotionState;
}
const db=()=>getSupabaseClient();
const num=(v:unknown)=>v==null?null:Number(v);
const map=(v:Record<string,unknown>):MarketplacePromotion=>({id:String(v.id),productId:String(v.product_id),variantId:v.variant_id==null?null:String(v.variant_id),productTitle:String(v.product_title),variantTitle:v.variant_title==null?null:String(v.variant_title),promotionType:String(v.promotion_type)as MarketplacePromotionType,percentageOff:num(v.percentage_off),fixedAmountBdag:num(v.fixed_amount_bdag),promotionalPriceBdag:num(v.promotional_price_bdag),startsAt:String(v.starts_at),endsAt:String(v.ends_at),state:String(v.state)as MarketplacePromotionState});
export async function listMyMarketplacePromotions(){const{data,error}=await db().rpc("list_my_marketplace_promotions");if(error)throw error;return(Array.isArray(data)?data:[]).map(v=>map(v as Record<string,unknown>));}
export async function createMarketplacePromotion(input:{productId:string;variantId?:string|null;type:MarketplacePromotionType;value:number;startsAt:Date;endsAt:Date;idempotencyKey:string}){const{data,error}=await db().rpc("create_marketplace_product_promotion",{p_product_id:input.productId,p_variant_id:input.variantId??null,p_promotion_type:input.type,p_value:input.value,p_starts_at:input.startsAt.toISOString(),p_ends_at:input.endsAt.toISOString(),p_idempotency_key:input.idempotencyKey});if(error)throw error;return data;}
export async function endMarketplacePromotion(id:string){const{error}=await db().rpc("end_marketplace_product_promotion",{p_promotion_id:id});if(error)throw error;}
export function promotionLabel(p:MarketplacePromotion){return p.promotionType==="percentage"?`${p.percentageOff}% menos`:p.promotionType==="fixed_amount"?`${p.fixedAmountBdag?.toFixed(2)} BDAG menos`:`${p.promotionalPriceBdag?.toFixed(2)} BDAG`;}
