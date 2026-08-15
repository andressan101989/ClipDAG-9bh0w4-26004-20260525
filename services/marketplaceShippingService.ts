import { getSupabaseClient } from '@/template';
import {rpcCursorPage,rpcNonnegative,rpcNonnegativeInteger,rpcObject,rpcString,rpcTimestamp,rpcUuid} from '@/services/marketplaceRuntimeValidation';

export interface MarketplaceShippingRegion {
  id: string | null;
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
export type MarketplaceShippingErrorCode = 'marketplace_shipping_product_invalid'|'marketplace_shipping_quantity_invalid'|'marketplace_shipping_profile_missing'|'marketplace_shipping_profile_inactive'|'marketplace_shipping_configuration_required'|'marketplace_shipping_destination_unsupported'|'marketplace_shipping_country_invalid'|'marketplace_shipping_region_invalid'|'marketplace_shipping_rule_ambiguous'|'marketplace_shipping_price_invalid'|'marketplace_shipping_product_not_physical'|'marketplace_shipping_quote_stale'|'marketplace_shipping_unknown';
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
  regions: MarketplaceShippingRegion[];
}

const db = () => getSupabaseClient();
const number = (value: unknown) => {
  try{return rpcNonnegative(value,'shipping_profile.number');}catch{throw new Error('marketplace_invalid_shipping_profile');}
};
const quoteNumber=(value:unknown)=>{try{return rpcNonnegative(value,'shipping_quote.money');}catch{throw new MarketplaceShippingError('marketplace_shipping_unknown');}};
const integer=(value:unknown)=>{try{return rpcNonnegativeInteger(value,'shipping_quote.integer');}catch{throw new MarketplaceShippingError('marketplace_shipping_unknown');}};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requiredText=(value:unknown)=>{if(typeof value!=='string'||!value.trim()||value==='undefined'||value==='null')throw new Error('marketplace_invalid_shipping_profile');return value;};
export const parseMarketplaceShippingProfiles = (value: unknown): MarketplaceShippingProfile[] => {
  if (!Array.isArray(value)) throw new Error('marketplace_invalid_shipping_profile');
  return value.map(raw => {
    const row = raw as Record<string, unknown>;
    const regions=Array.isArray(row.regions)?row.regions:[],id=requiredText(row.id),name=requiredText(row.name),status=requiredText(row.status),configurationStatus=requiredText(row.configuration_status),country=requiredText(row.ships_from_country),processingDaysMin=number(row.processing_days_min),processingDaysMax=number(row.processing_days_max),productsUsing=number(row.products_using??0);
    if(!UUID.test(id)||!['active','paused'].includes(status)||!['explicit_ready','configuration_required','invalid_data'].includes(configurationStatus)||!/^[A-Z]{2}$/.test(country)||!Number.isInteger(processingDaysMin)||!Number.isInteger(processingDaysMax)||processingDaysMin>processingDaysMax||!Number.isInteger(productsUsing))throw new Error('marketplace_invalid_shipping_profile');
    return {
      id,name,status:status as MarketplaceShippingProfile['status'],processingDaysMin,processingDaysMax,
      shipsFromCountry:country,returnPolicySummary:requiredText(row.return_policy_summary),
      legacyUnrestricted: row.legacy_unrestricted === true,
      configurationStatus:configurationStatus as MarketplaceShippingProfile['configurationStatus'],productsUsing,
      regions: regions.map(rawRegion => {
        const region=rawRegion as Record<string,unknown>,regionId=requiredText(region.id),regionCountry=requiredText(region.country_code),regionCode=region.region_code==null?null:requiredText(region.region_code),transitDaysMin=number(region.transit_days_min),transitDaysMax=number(region.transit_days_max),regionStatus=requiredText(region.status);
        if(!UUID.test(regionId)||!/^[A-Z]{2}$/.test(regionCountry)||(regionCode!==null&&!/^[A-Z0-9-]{1,10}$/.test(regionCode))||!Number.isInteger(transitDaysMin)||!Number.isInteger(transitDaysMax)||transitDaysMin>transitDaysMax||!['active','paused'].includes(regionStatus))throw new Error('marketplace_invalid_shipping_profile');
        return{id:regionId,countryCode:regionCountry,regionCode,shippingPrice:number(region.shipping_price),freeShippingThreshold:region.free_shipping_threshold==null?null:number(region.free_shipping_threshold),transitDaysMin,transitDaysMax,status:regionStatus as'active'|'paused'};
      }),
    };
  });
};
const shippingCodes:MarketplaceShippingErrorCode[]=['marketplace_shipping_profile_missing','marketplace_shipping_profile_inactive','marketplace_shipping_configuration_required','marketplace_shipping_destination_unsupported','marketplace_shipping_country_invalid','marketplace_shipping_region_invalid','marketplace_shipping_rule_ambiguous','marketplace_shipping_price_invalid','marketplace_shipping_product_not_physical','marketplace_shipping_quote_stale'];
const shippingCode=(error:unknown)=>{const x=error&&typeof error==='object'?error as Record<string,unknown>:{};const text=[x.message,x.details,x.hint,(x.context as Record<string,unknown>|undefined)?.body].filter(v=>typeof v==='string').join(' ');return shippingCodes.find(code=>text.includes(code))??'marketplace_shipping_unknown';};
export const normalizeMarketplaceCountry=(value:string)=>value.trim().toUpperCase();
export const normalizeMarketplaceRegion=(value:string|null|undefined)=>value?.trim().toUpperCase()||null;
export function parseMarketplaceShippingQuote(data:unknown):MarketplaceShippingQuote{
 let x:Record<string,unknown>;try{x=rpcObject(data,'shipping_quote');rpcTimestamp(x.quote_timestamp,'shipping_quote.quote_timestamp');}catch{throw new MarketplaceShippingError('marketplace_shipping_unknown');}if(x.eligible!==true||x.currency!=='BDAG'||typeof x.quote_fingerprint!=='string'||!/^[0-9a-f]{64}$/.test(x.quote_fingerprint)||x.quantity_policy!=='per_order_profile')throw new MarketplaceShippingError('marketplace_shipping_unknown');
 const profile=x.shipping_profile_id==null?null:x.shipping_profile_id,rule=x.matched_rule_id==null?null:x.matched_rule_id;if((profile!==null&&(typeof profile!=='string'||!UUID.test(profile)))||(rule!==null&&(typeof rule!=='string'||!UUID.test(rule))))throw new MarketplaceShippingError('marketplace_shipping_unknown');
 const country=x.country_code==null?null:x.country_code,region=x.region_code==null?null:x.region_code;if(country!==null&&(typeof country!=='string'||!/^[A-Z]{2}$/.test(country))||region!==null&&(typeof region!=='string'||!/^[A-Z0-9-]{1,10}$/.test(region)))throw new MarketplaceShippingError('marketplace_shipping_unknown');
 const processingDaysMin=integer(x.processing_days_min),processingDaysMax=integer(x.processing_days_max),transitDaysMin=integer(x.transit_days_min),transitDaysMax=integer(x.transit_days_max),estimatedDeliveryDaysMin=integer(x.estimated_delivery_days_min),estimatedDeliveryDaysMax=integer(x.estimated_delivery_days_max);
 if(processingDaysMin>processingDaysMax||transitDaysMin>transitDaysMax||estimatedDeliveryDaysMin>estimatedDeliveryDaysMax)throw new MarketplaceShippingError('marketplace_shipping_unknown');
 let code:string,quoteTimestamp:string;try{code=rpcString(x.code,'shipping_quote.code');quoteTimestamp=rpcTimestamp(x.quote_timestamp,'shipping_quote.quote_timestamp');}catch{throw new MarketplaceShippingError('marketplace_shipping_unknown');}return{eligible:true,code,shippingProfileId:profile,matchedRuleId:rule,countryCode:country,regionCode:region,shippingAmount:quoteNumber(x.shipping_amount),currency:'BDAG',processingDaysMin,processingDaysMax,transitDaysMin,transitDaysMax,estimatedDeliveryDaysMin,estimatedDeliveryDaysMax,quoteTimestamp,quoteFingerprint:x.quote_fingerprint,quantityPolicy:'per_order_profile'};
}
export function marketplaceShippingMessage(code:MarketplaceShippingErrorCode){
 if(code==='marketplace_shipping_product_invalid')return 'No pudimos cargar la información de envío de este producto.';
 if(code==='marketplace_shipping_quantity_invalid')return 'Selecciona una cantidad válida.';
 if(code==='marketplace_shipping_country_invalid')return 'Selecciona un país válido.';
 if(code==='marketplace_shipping_destination_unsupported')return 'Este producto no se envía a la dirección seleccionada.';
 if(code==='marketplace_shipping_configuration_required')return 'El vendedor debe completar la configuración de envío de este producto.';
 if(code==='marketplace_shipping_profile_missing'||code==='marketplace_shipping_profile_inactive')return 'Este producto todavía no tiene un método de envío disponible.';
 return 'No pudimos verificar el envío. Inténtalo nuevamente.';
}
export async function quoteMarketplaceShipping(productId:string,countryCode:string,regionCode:string|null,quantity=1):Promise<MarketplaceShippingQuote>{
 if(!UUID.test(productId))throw new MarketplaceShippingError('marketplace_shipping_product_invalid');
 if(!/^[A-Z]{2}$/.test(normalizeMarketplaceCountry(countryCode)))throw new MarketplaceShippingError('marketplace_shipping_country_invalid');
 if(!Number.isInteger(quantity)||quantity<1)throw new MarketplaceShippingError('marketplace_shipping_quantity_invalid');
 const{data,error}=await db().rpc('quote_marketplace_shipping',{p_product_id:productId,p_country_code:normalizeMarketplaceCountry(countryCode),p_region_code:normalizeMarketplaceRegion(regionCode),p_quantity:quantity});if(error)throw new MarketplaceShippingError(shippingCode(error),typeof error.code==='string'?error.code:null);
 return parseMarketplaceShippingQuote(data);
}

export interface MarketplaceShippingProfilePage{items:MarketplaceShippingProfile[];nextCursor:{createdAt:string;profileId:string}|null}
export async function fetchMyMarketplaceShippingProfilesPage(storeId:string,cursor:{createdAt:string;profileId:string}|null=null,limit=100):Promise<MarketplaceShippingProfilePage> {
  const { data, error } = await db().rpc('fetch_my_marketplace_shipping_profiles_v2', { p_store_id:storeId,p_cursor_created_at:cursor?.createdAt??null,p_cursor_profile_id:cursor?.profileId??null,p_limit:limit });
  if (error) throw error;
  const page=rpcCursorPage(data,'shipping_profiles'),items=parseMarketplaceShippingProfiles(page.items),raw=page.nextCursor;
  return{items,nextCursor:raw?{createdAt:rpcTimestamp(raw.created_at,'shipping_profiles.next_cursor.created_at'),profileId:rpcUuid(raw.profile_id,'shipping_profiles.next_cursor.profile_id')}:null};
}
export async function fetchMyMarketplaceShippingProfiles(storeId: string): Promise<MarketplaceShippingProfile[]> {return(await fetchMyMarketplaceShippingProfilesPage(storeId,null,100)).items;}
export async function upsertMyMarketplaceShippingProfile(input: MarketplaceShippingProfileInput): Promise<string> {
  const { data, error } = await db().rpc('upsert_my_marketplace_shipping_profile', {
    p_profile_id: input.profileId ?? null, p_store_id: input.storeId, p_name: input.name,
    p_processing_days_min: input.processingDaysMin, p_processing_days_max: input.processingDaysMax,
    p_ships_from_country: input.shipsFromCountry.toUpperCase(), p_return_policy_summary: input.returnPolicySummary,
    p_regions: input.regions.map(region => ({ id:region.id,status:region.status,country_code: region.countryCode.toUpperCase(), region_code: region.regionCode?.toUpperCase() ?? null,
      shipping_price: region.shippingPrice, free_shipping_threshold: region.freeShippingThreshold,
      transit_days_min: region.transitDaysMin, transit_days_max: region.transitDaysMax })),
  });
  if (error) throw error;
  try{return rpcUuid(data,'shipping_profile.id');}catch{throw new Error('marketplace_invalid_shipping_profile');}
}
export async function setMyMarketplaceProductShippingProfile(productId: string, profileId: string): Promise<void> {
  const { error } = await db().rpc('set_my_marketplace_product_shipping_profile', { p_product_id: productId, p_profile_id: profileId });
  if (error) throw error;
}
