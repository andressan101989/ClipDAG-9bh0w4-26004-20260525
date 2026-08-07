import { getSupabaseClient } from '@/template';

export interface MarketplaceShippingRegion {
  countryCode: string;
  regionCode: string | null;
  shippingPrice: number;
  freeShippingThreshold: number | null;
  transitDaysMin: number;
  transitDaysMax: number;
  status: 'active' | 'paused';
}
export interface MarketplaceShippingProfile {
  id: string;
  name: string;
  status: 'active' | 'paused';
  processingDaysMin: number;
  processingDaysMax: number;
  shipsFromCountry: string;
  returnPolicySummary: string;
  legacyUnrestricted: boolean;
  configurationStatus: 'explicit_ready' | 'configuration_required' | 'invalid_data';
  productsUsing: number;
  regions: MarketplaceShippingRegion[];
}
export type MarketplaceShippingErrorCode = 'marketplace_shipping_profile_missing'|'marketplace_shipping_profile_inactive'|'marketplace_shipping_configuration_required'|'marketplace_shipping_destination_unsupported'|'marketplace_shipping_country_invalid'|'marketplace_shipping_region_invalid'|'marketplace_shipping_rule_ambiguous'|'marketplace_shipping_price_invalid'|'marketplace_shipping_product_not_physical'|'marketplace_shipping_quote_stale'|'marketplace_shipping_unknown';
export interface MarketplaceShippingQuote {eligible:true;code:string;shippingProfileId:string|null;matchedRuleId:string|null;countryCode:string|null;regionCode:string|null;shippingAmount:number;currency:'BDAG';processingDaysMin:number;processingDaysMax:number;transitDaysMin:number;transitDaysMax:number;estimatedDeliveryDaysMin:number;estimatedDeliveryDaysMax:number;quoteTimestamp:string;quoteFingerprint:string;quantityPolicy:'per_order_profile'}
export class MarketplaceShippingError extends Error {constructor(public code:MarketplaceShippingErrorCode,public postgresCode:string|null=null){super(code);this.name='MarketplaceShippingError';}}
export interface MarketplaceShippingProfileInput {
  profileId?: string | null;
  storeId: string;
  name: string;
  processingDaysMin: number;
  processingDaysMax: number;
  shipsFromCountry: string;
  returnPolicySummary: string;
  regions: Omit<MarketplaceShippingRegion, 'status'>[];
}

const db = () => getSupabaseClient();
const number = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('marketplace_invalid_shipping_profile');
  return parsed;
};
const quoteNumber=(value:unknown)=>{const parsed=Number(value);if(!Number.isFinite(parsed)||parsed<0)throw new MarketplaceShippingError('marketplace_shipping_unknown');return parsed;};
const integer=(value:unknown)=>{const parsed=quoteNumber(value);if(!Number.isInteger(parsed))throw new MarketplaceShippingError('marketplace_shipping_unknown');return parsed;};
const parse = (value: unknown): MarketplaceShippingProfile[] => {
  if (!Array.isArray(value)) throw new Error('marketplace_invalid_shipping_profile');
  return value.map(raw => {
    const row = raw as Record<string, unknown>;
    const regions = Array.isArray(row.regions) ? row.regions : [];
    return {
      id: String(row.id), name: String(row.name), status: String(row.status) as MarketplaceShippingProfile['status'],
      processingDaysMin: number(row.processing_days_min), processingDaysMax: number(row.processing_days_max),
      shipsFromCountry: String(row.ships_from_country), returnPolicySummary: String(row.return_policy_summary),
      legacyUnrestricted: row.legacy_unrestricted === true,
      configurationStatus: String(row.configuration_status) as MarketplaceShippingProfile['configurationStatus'],
      productsUsing: number(row.products_using ?? 0),
      regions: regions.map(rawRegion => {
        const region = rawRegion as Record<string, unknown>;
        return { countryCode: String(region.country_code), regionCode: region.region_code == null ? null : String(region.region_code),
          shippingPrice: number(region.shipping_price), freeShippingThreshold: region.free_shipping_threshold == null ? null : number(region.free_shipping_threshold),
          transitDaysMin: number(region.transit_days_min), transitDaysMax: number(region.transit_days_max), status: String(region.status) as 'active' | 'paused' };
      }),
    };
  });
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const shippingCodes:MarketplaceShippingErrorCode[]=['marketplace_shipping_profile_missing','marketplace_shipping_profile_inactive','marketplace_shipping_configuration_required','marketplace_shipping_destination_unsupported','marketplace_shipping_country_invalid','marketplace_shipping_region_invalid','marketplace_shipping_rule_ambiguous','marketplace_shipping_price_invalid','marketplace_shipping_product_not_physical','marketplace_shipping_quote_stale'];
const shippingCode=(error:unknown)=>{const x=error&&typeof error==='object'?error as Record<string,unknown>:{};const text=[x.message,x.details,x.hint,(x.context as Record<string,unknown>|undefined)?.body].filter(v=>typeof v==='string').join(' ');return shippingCodes.find(code=>text.includes(code))??'marketplace_shipping_unknown';};
export const normalizeMarketplaceCountry=(value:string)=>value.trim().toUpperCase();
export const normalizeMarketplaceRegion=(value:string|null|undefined)=>value?.trim().toUpperCase()||null;
export function parseMarketplaceShippingQuote(data:unknown):MarketplaceShippingQuote{
 const x=data as Record<string,unknown>;if(!x||typeof x!=='object'||x.eligible!==true||x.currency!=='BDAG'||!Number.isFinite(Date.parse(typeof x.quote_timestamp==='string'?x.quote_timestamp:''))||typeof x.quote_fingerprint!=='string'||!/^[0-9a-f]{64}$/.test(x.quote_fingerprint)||x.quantity_policy!=='per_order_profile')throw new MarketplaceShippingError('marketplace_shipping_unknown');
 const profile=x.shipping_profile_id==null?null:x.shipping_profile_id,rule=x.matched_rule_id==null?null:x.matched_rule_id;if((profile!==null&&(typeof profile!=='string'||!UUID.test(profile)))||(rule!==null&&(typeof rule!=='string'||!UUID.test(rule))))throw new MarketplaceShippingError('marketplace_shipping_unknown');
 const country=x.country_code==null?null:x.country_code,region=x.region_code==null?null:x.region_code;if(country!==null&&(typeof country!=='string'||!/^[A-Z]{2}$/.test(country))||region!==null&&(typeof region!=='string'||!/^[A-Z0-9-]{1,10}$/.test(region)))throw new MarketplaceShippingError('marketplace_shipping_unknown');
 const processingDaysMin=integer(x.processing_days_min),processingDaysMax=integer(x.processing_days_max),transitDaysMin=integer(x.transit_days_min),transitDaysMax=integer(x.transit_days_max),estimatedDeliveryDaysMin=integer(x.estimated_delivery_days_min),estimatedDeliveryDaysMax=integer(x.estimated_delivery_days_max);
 if(processingDaysMin>processingDaysMax||transitDaysMin>transitDaysMax||estimatedDeliveryDaysMin>estimatedDeliveryDaysMax)throw new MarketplaceShippingError('marketplace_shipping_unknown');
 return{eligible:true,code:typeof x.code==='string'?x.code:'marketplace_shipping_eligible',shippingProfileId:profile,matchedRuleId:rule,countryCode:country,regionCode:region,shippingAmount:quoteNumber(x.shipping_amount),currency:'BDAG',processingDaysMin,processingDaysMax,transitDaysMin,transitDaysMax,estimatedDeliveryDaysMin,estimatedDeliveryDaysMax,quoteTimestamp:x.quote_timestamp as string,quoteFingerprint:x.quote_fingerprint,quantityPolicy:'per_order_profile'};
}
export function marketplaceShippingMessage(code:MarketplaceShippingErrorCode){
 if(code==='marketplace_shipping_destination_unsupported')return 'Este producto no se envía a la dirección seleccionada.';
 if(code==='marketplace_shipping_configuration_required')return 'El vendedor debe completar la configuración de envío de este producto.';
 if(code==='marketplace_shipping_profile_missing'||code==='marketplace_shipping_profile_inactive')return 'Este producto todavía no tiene un método de envío disponible.';
 return 'No pudimos verificar el envío. Inténtalo nuevamente.';
}
export async function quoteMarketplaceShipping(productId:string,countryCode:string,regionCode:string|null,quantity=1):Promise<MarketplaceShippingQuote>{
 if(!UUID.test(productId)||!/^[A-Z]{2}$/.test(normalizeMarketplaceCountry(countryCode))||!Number.isInteger(quantity)||quantity<1)throw new MarketplaceShippingError('marketplace_shipping_country_invalid');
 const{data,error}=await db().rpc('quote_marketplace_shipping',{p_product_id:productId,p_country_code:normalizeMarketplaceCountry(countryCode),p_region_code:normalizeMarketplaceRegion(regionCode),p_quantity:quantity});if(error)throw new MarketplaceShippingError(shippingCode(error),typeof error.code==='string'?error.code:null);
 return parseMarketplaceShippingQuote(data);
}

export async function fetchMyMarketplaceShippingProfiles(storeId: string): Promise<MarketplaceShippingProfile[]> {
  const { data, error } = await db().rpc('fetch_my_marketplace_shipping_profiles', { p_store_id: storeId });
  if (error) throw error;
  return parse(data);
}
export async function upsertMyMarketplaceShippingProfile(input: MarketplaceShippingProfileInput): Promise<string> {
  const { data, error } = await db().rpc('upsert_my_marketplace_shipping_profile', {
    p_profile_id: input.profileId ?? null, p_store_id: input.storeId, p_name: input.name,
    p_processing_days_min: input.processingDaysMin, p_processing_days_max: input.processingDaysMax,
    p_ships_from_country: input.shipsFromCountry.toUpperCase(), p_return_policy_summary: input.returnPolicySummary,
    p_regions: input.regions.map(region => ({ country_code: region.countryCode.toUpperCase(), region_code: region.regionCode?.toUpperCase() ?? null,
      shipping_price: region.shippingPrice, free_shipping_threshold: region.freeShippingThreshold,
      transit_days_min: region.transitDaysMin, transit_days_max: region.transitDaysMax })),
  });
  if (error) throw error;
  return String(data);
}
export async function setMyMarketplaceProductShippingProfile(productId: string, profileId: string): Promise<void> {
  const { error } = await db().rpc('set_my_marketplace_product_shipping_profile', { p_product_id: productId, p_profile_id: profileId });
  if (error) throw error;
}
