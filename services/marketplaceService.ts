import { getSupabaseClient } from '@/template';
import { extractRpcUuid } from '@/services/mediaService';

export type MarketplaceCategory = 'digital'|'physical'|'art'|'music'|'clothing'|'other';
export type SellerStatus = 'pending'|'approved'|'rejected'|'suspended';
export type StoreStatus = 'draft'|'active'|'suspended';
export type ProductStatus = 'active'|'paused'|'sold_out'|'deleted';

export interface MarketplaceCategoryRecord {
  id:string; slug:MarketplaceCategory; name:string; parent_id:string|null; sort_order:number;
}
export interface MarketplaceSeller {
  user_id:string; status:SellerStatus; display_name:string; application_note:string|null;
  created_at:string; updated_at:string;
}
export interface MarketplaceStore {
  id:string; seller_id:string; name:string; slug:string; description:string|null;
  logo_asset_id:string|null; banner_asset_id:string|null; status:StoreStatus;
  created_at:string; updated_at:string;
}
export interface Product {
  id:string; seller_id:string; store_id:string; category_id:string; title:string;
  description:string; price:number; currency:'BDAG'; category:MarketplaceCategory;
  images:string[]; stock:number; status:ProductStatus; tags:string[]; total_sales:number;
  brand:string|null; compare_at_price:number|null; product_type:'physical';
  moderation_status:'pending'|'approved'|'rejected'|'suspended';
  published_at:string|null; deleted_at:string|null; created_at:string; updated_at:string;
  variant_price_max:number|null; active_variant_count:number;
  shipping_profile_id:string|null;
  available_quantity:number;publication_readiness_reason:string|null;
  seller?:{username:string;avatar_url:string|null;display_name:string|null};
}

export interface MarketplaceOptionValue {id:string;value:string;position:number}
export interface MarketplaceProductOption {
  id:string;name:string;position:number;values:MarketplaceOptionValue[];
}
export interface MarketplaceVariant {
  id:string;product_id:string;sku:string|null;title:string|null;price:number;
  base_price:number;promotion_id:string|null;promotion_type:'percentage'|'fixed_amount'|'promotional_price'|null;
  discount_percentage:number|null;promotion_ends_at:string|null;
  compare_at_price:number|null;status:'active'|'inactive'|'archived';is_default:boolean;
  image_asset_id:string|null;image_url:string|null;available_quantity:number;
  option_value_ids:string[];
}
export interface MarketplaceProductDetail {
  product:Product;options:MarketplaceProductOption[];variants:MarketplaceVariant[];
  media:MarketplaceProductGalleryItem[];
}
export interface MarketplaceProductGalleryItem {
  kind:'image'|'video';url:string;durationMs:number|null;mimeType:string|null;
  position:number;isCover:boolean;
}
export interface MarketplaceInventoryLevel {
  variant_id:string;on_hand:number;reserved:number;available_quantity:number;
  low_stock_threshold:number;version:number;
}
export interface MarketplaceInventoryMovement {
  id:string;variant_id:string;movement_type:'backfill'|'initial'|'seller_set'|'seller_adjust'|'correction';
  delta:number;resulting_on_hand:number;reason:string|null;created_at:string;
}
export interface MarketplaceProductMediaAsset {id:string;url:string}
export interface SellerProductInventory {
  detail:MarketplaceProductDetail;inventory:MarketplaceInventoryLevel[];
  movements:MarketplaceInventoryMovement[];mediaAssets:MarketplaceProductMediaAsset[];
}

const db=()=>getSupabaseClient();

export type MarketplaceReadErrorCode='marketplace_read_transport'|'marketplace_read_permission'|'marketplace_product_not_found'|'marketplace_product_unavailable';
export class MarketplaceReadError extends Error {
  readonly code:MarketplaceReadErrorCode;readonly postgresCode:string|null;
  constructor(code:MarketplaceReadErrorCode,postgresCode:string|null=null){super(code);this.name='MarketplaceReadError';this.code=code;this.postgresCode=postgresCode;}
}
export type MarketplaceSellerProductsErrorCode='marketplace_authentication_required'|'marketplace_seller_products_permission'|'marketplace_seller_products_transport'|'marketplace_seller_products_request';
export class MarketplaceSellerProductsError extends Error {
  constructor(public code:MarketplaceSellerProductsErrorCode,public postgresCode:string|null=null){super(code);this.name='MarketplaceSellerProductsError';}
}
export type MarketplaceSellerConfigurationErrorCode='marketplace_product_not_owned'|'marketplace_authentication_required'|'marketplace_private_product_read_denied'|'marketplace_permission_denied'|'marketplace_configuration_transport';
export class MarketplaceSellerConfigurationError extends Error{constructor(public code:MarketplaceSellerConfigurationErrorCode,public postgresCode:string|null=null){super(code);this.name='MarketplaceSellerConfigurationError';}}
export const marketplaceSellerConfigurationMessage=(error:unknown):string|null=>error instanceof MarketplaceSellerConfigurationError?({marketplace_product_not_owned:'Este producto no pertenece a tu tienda.',marketplace_authentication_required:'Tu sesión expiró. Inicia sesión nuevamente.',marketplace_private_product_read_denied:'No pudimos recuperar el borrador privado.',marketplace_permission_denied:'No tienes permiso para modificar este producto.',marketplace_configuration_transport:'No pudimos conectar con Marketplace. El borrador permanece guardado.'} satisfies Record<MarketplaceSellerConfigurationErrorCode,string>)[error.code]:null;
function throwReadError(error:unknown):never {
  const value=error&&typeof error==='object'?error as {code?:unknown;message?:unknown}:{};
  const postgresCode=typeof value.code==='string'?value.code:null;
  if(postgresCode==='42501')throw new MarketplaceReadError('marketplace_read_permission',postgresCode);
  const message=typeof value.message==='string'?value.message.toLowerCase():'';
  if(!postgresCode&&(message.includes('network')||message.includes('fetch')||message.includes('timeout')))throw new MarketplaceReadError('marketplace_read_transport');
  throw new MarketplaceReadError('marketplace_product_unavailable',postgresCode);
}

function mapProduct(row:Record<string,unknown>):Product {
  return {
    ...(row as unknown as Product),
    price:Number(row.price), compare_at_price:row.compare_at_price==null?null:Number(row.compare_at_price),
    stock:Number(row.stock), total_sales:Number(row.total_sales),
    variant_price_max:row.variant_price_max==null?null:Number(row.variant_price_max),
    active_variant_count:Number(row.active_variant_count??1),
    available_quantity:Number(row.available_quantity??row.stock??0),
    publication_readiness_reason:typeof row.publication_readiness_reason==='string'?row.publication_readiness_reason:null,
    images:Array.isArray(row.images)?row.images as string[]:[],
    tags:Array.isArray(row.tags)?row.tags as string[]:[],
    currency:'BDAG', product_type:'physical',
  };
}

export const PRODUCT_CATEGORIES:{key:''|MarketplaceCategory;label:string}[]=[
  {key:'',label:'Todo'},{key:'digital',label:'Digital'},{key:'physical',label:'Físico'},
  {key:'art',label:'Arte'},{key:'music',label:'Música'},{key:'clothing',label:'Ropa'},
  {key:'other',label:'Otros'},
];

export async function fetchCategories():Promise<MarketplaceCategoryRecord[]> {
  const {data,error}=await db().from('marketplace_categories')
    .select('id,slug,name,parent_id,sort_order').eq('status','active')
    .order('sort_order',{ascending:true});
  if(error) throw error;
  return (data??[]) as MarketplaceCategoryRecord[];
}

export async function fetchProducts(opts?:{category?:MarketplaceCategory|'';sellerId?:string;limit?:number;search?:string}):Promise<Product[]> {
  const limit=opts?.limit??30;
  const {data,error}=await db().rpc('fetch_public_marketplace_products',{
    p_category:opts?.category||null,p_seller_id:opts?.sellerId??null,p_search:opts?.search??null,
    p_limit:limit,p_product_id:null,
  });
  if(error) throwReadError(error);
  if(!Array.isArray(data))throw new MarketplaceReadError('marketplace_product_unavailable');
  return data.map((row:unknown)=>mapProduct(row as Record<string,unknown>));
}

export async function fetchProduct(productId:string):Promise<Product|null> {
  const {data,error}=await db().rpc('fetch_public_marketplace_products',{
    p_category:null,p_seller_id:null,p_search:null,p_limit:1,p_product_id:productId,
  });
  if(error) throwReadError(error);
  const row=Array.isArray(data)?data[0]:null;
  return row?mapProduct(row as Record<string,unknown>):null;
}

function mapVariant(row:Record<string,unknown>):MarketplaceVariant {
  return {
    ...(row as unknown as MarketplaceVariant),
    price:Number(row.price),compare_at_price:row.compare_at_price==null?null:Number(row.compare_at_price),
    base_price:Number(row.base_price??row.price),promotion_id:row.promotion_id==null?null:String(row.promotion_id),
    promotion_type:row.promotion_type==null?null:String(row.promotion_type) as MarketplaceVariant['promotion_type'],
    discount_percentage:row.discount_percentage==null?null:Number(row.discount_percentage),
    promotion_ends_at:row.promotion_ends_at==null?null:String(row.promotion_ends_at),
    available_quantity:Number(row.available_quantity??0),
    option_value_ids:Array.isArray(row.option_value_ids)?row.option_value_ids as string[]:[],
  };
}

export async function fetchMarketplaceProductDetail(productId:string):Promise<MarketplaceProductDetail|null> {
  const [productResult,detailResult,mediaResult]=await Promise.all([
    fetchProduct(productId),
    db().rpc('fetch_marketplace_product_detail',{p_product_id:productId}),
    db().rpc('fetch_marketplace_product_media',{p_product_id:productId}),
  ]);
  if(detailResult.error) throwReadError(detailResult.error);
  if(mediaResult.error) throwReadError(mediaResult.error);
  if(!productResult||!detailResult.data) return null;
  const payload=detailResult.data as {options?:MarketplaceProductOption[];variants?:Record<string,unknown>[]};
  const media=(Array.isArray(mediaResult.data)?mediaResult.data:[]).map((row:Record<string,unknown>)=>({
    kind:row.kind==='video'?'video' as const:'image' as const,url:String(row.url),
    durationMs:row.duration_ms==null?null:Number(row.duration_ms),mimeType:typeof row.mime_type==='string'?row.mime_type:null,
    position:Number(row.position??0),isCover:row.is_cover===true,
  }));
  return {
    product:productResult,
    options:Array.isArray(payload.options)?payload.options:[],
    variants:Array.isArray(payload.variants)?payload.variants.map(mapVariant):[],
    media,
  };
}

export async function fetchSellerProductVariants(productId:string):Promise<SellerProductInventory> {
  const session=await db().auth.getSession();
  if(session.error||!session.data.session?.user?.id)throw new MarketplaceSellerConfigurationError('marketplace_authentication_required');
  const {data,error}=await db().rpc('fetch_seller_product_inventory',{p_product_id:productId});
  if(error){const text=`${error.message??''} ${error.details??''}`;const code=text.includes('marketplace_product_not_owned')?'marketplace_product_not_owned':text.includes('marketplace_authentication_required')?'marketplace_authentication_required':error.code==='42501'?'marketplace_private_product_read_denied':!error.code&&/network|fetch|timeout/i.test(text)?'marketplace_configuration_transport':'marketplace_permission_denied';throw new MarketplaceSellerConfigurationError(code,error.code??null);}
  const payload=data as {
    product?:Record<string,unknown>;
    detail:{options?:MarketplaceProductOption[];variants?:Record<string,unknown>[]};
    inventory?:MarketplaceInventoryLevel[];movements?:MarketplaceInventoryMovement[];
    media_assets?:MarketplaceProductMediaAsset[];
  };
  if(!payload.product)throw new MarketplaceSellerConfigurationError('marketplace_private_product_read_denied');
  const product=mapProduct(payload.product);
  const mediaAssets=(payload.media_assets??[]).filter(item=>item.url);
  return {
    detail:{product,options:payload.detail?.options??[],variants:(payload.detail?.variants??[]).map(mapVariant),media:[]},
    inventory:payload.inventory??[],movements:payload.movements??[],mediaAssets,
  };
}

export interface VariantConfigurationOption {name:string;values:string[]}
export interface VariantConfiguration {
  id?:string;sku:string;title?:string;price:string|number;compare_at_price?:string|number|null;
  status:'active'|'inactive';is_default:boolean;image_asset_id?:string|null;barcode?:string|null;
  option_values:string[];on_hand?:number;low_stock_threshold?:number;
}
export async function configureProductVariants(productId:string,options:VariantConfigurationOption[],
  variants:VariantConfiguration[],idempotencyKey:string):Promise<void> {
  const {error}=await db().rpc('configure_marketplace_product_variants',{
    p_product_id:productId,p_options_json:options,p_variants_json:variants,
    p_idempotency_key:idempotencyKey,
  });
  if(error) throw error;
}
export async function updateVariant(variantId:string,input:{
  sku:string;price:string|number;compareAtPrice?:string|number|null;
  status:'active'|'inactive';imageAssetId?:string|null;title?:string|null;barcode?:string|null;
}):Promise<void> {
  const {error}=await db().rpc('update_marketplace_product_variant',{
    p_variant_id:variantId,p_sku:input.sku,p_price:input.price,
    p_compare_at_price:input.compareAtPrice??null,p_status:input.status,
    p_image_asset_id:input.imageAssetId??null,p_title:input.title??null,p_barcode:input.barcode??null,
  });
  if(error) throw error;
}
export async function setDefaultVariant(variantId:string):Promise<void> {
  const {error}=await db().rpc('set_marketplace_default_variant',{p_variant_id:variantId});
  if(error) throw error;
}
export async function archiveVariant(variantId:string,replacementDefaultId?:string|null):Promise<void> {
  const {error}=await db().rpc('archive_marketplace_product_variant',{
    p_variant_id:variantId,p_replacement_default_id:replacementDefaultId??null,
  });
  if(error) throw error;
}
export async function restoreVariant(variantId:string):Promise<void> {
  const {error}=await db().rpc('restore_marketplace_product_variant',{p_variant_id:variantId});
  if(error) throw error;
}
export async function setVariantInventory(variantId:string,newOnHand:number,reason:string,
  idempotencyKey:string):Promise<void> {
  const {error}=await db().rpc('set_marketplace_variant_inventory',{
    p_variant_id:variantId,p_new_on_hand:newOnHand,p_reason:reason||null,
    p_idempotency_key:idempotencyKey,
  });
  if(error) throw error;
}
export async function adjustVariantInventory(variantId:string,delta:number,reason:string,
  idempotencyKey:string):Promise<void> {
  const {error}=await db().rpc('adjust_marketplace_variant_inventory',{
    p_variant_id:variantId,p_delta:delta,p_reason:reason||null,p_idempotency_key:idempotencyKey,
  });
  if(error) throw error;
}
export async function setVariantLowStockThreshold(variantId:string,threshold:number):Promise<void> {
  const {error}=await db().rpc('set_marketplace_variant_low_stock_threshold',{
    p_variant_id:variantId,p_threshold:threshold,
  });
  if(error) throw error;
}

export async function fetchMyProducts():Promise<Product[]> {
  const client=db();
  if(__DEV__)console.log('[SellerProducts] fetch_start',{operation:'fetch_my_marketplace_products'});
  const {data:{session},error:authError}=await client.auth.getSession();
  if(authError||!session?.user?.id)throw new MarketplaceSellerProductsError('marketplace_authentication_required');
  const {data,error}=await client.rpc('fetch_my_marketplace_products');
  if(error){
    const text=`${error.message??''} ${error.details??''}`;
    const code:MarketplaceSellerProductsErrorCode=/marketplace_authentication_required/i.test(text)?'marketplace_authentication_required':error.code==='42501'?'marketplace_seller_products_permission':!error.code&&/network|fetch|timeout/i.test(text)?'marketplace_seller_products_transport':'marketplace_seller_products_request';
    if(__DEV__)console.warn('[SellerProducts] fetch_failed',{code,postgresCode:error.code??null,operation:'fetch_my_marketplace_products'});
    throw new MarketplaceSellerProductsError(code,error.code??null);
  }
  if(!Array.isArray(data))throw new MarketplaceSellerProductsError('marketplace_seller_products_request');
  const products=data.map(row=>mapProduct(row as Record<string,unknown>));
  if(__DEV__)console.log('[SellerProducts] fetch_success',{count:products.length,activeCount:products.filter(item=>item.status==='active').length,pausedCount:products.filter(item=>item.status==='paused').length});
  return products;
}

export async function fetchSellerFoundation():Promise<{seller:MarketplaceSeller|null;store:MarketplaceStore|null}> {
  const client=db();
  const {data:{user},error:authError}=await client.auth.getUser();
  if(authError||!user) return {seller:null,store:null};
  const [{data:seller,error:sellerError},{data:store,error:storeError}]=await Promise.all([
    client.from('marketplace_sellers')
      .select('user_id,status,display_name,application_note,created_at,updated_at')
      .eq('user_id',user.id).maybeSingle(),
    client.from('marketplace_stores')
      .select('id,seller_id,name,slug,description,logo_asset_id,banner_asset_id,status,created_at,updated_at')
      .eq('seller_id',user.id).maybeSingle(),
  ]);
  if(sellerError) throw sellerError;
  if(storeError) throw storeError;
  return {seller:seller as MarketplaceSeller|null,store:store as MarketplaceStore|null};
}

export async function applySeller(displayName:string,note:string):Promise<void> {
  const {error}=await db().rpc('apply_marketplace_seller',{p_display_name:displayName,p_application_note:note||null});
  if(error) throw error;
}
export async function updateSellerApplication(displayName:string,note:string):Promise<void> {
  const {error}=await db().rpc('update_marketplace_seller_application',{
    p_display_name:displayName,p_application_note:note||null,
  });
  if(error) throw error;
}
export async function createStore(name:string,slug:string,description:string):Promise<string> {
  const {data,error}=await db().rpc('create_marketplace_store',{p_name:name,p_slug:slug,p_description:description||null});
  if(error) throw error;
  return extractRpcUuid(data,'create_marketplace_store');
}
export async function updateStore(id:string,name:string,slug:string,description:string):Promise<void> {
  const {error}=await db().rpc('update_marketplace_store',{p_store_id:id,p_name:name,p_slug:slug,p_description:description||null});
  if(error) throw error;
}
export async function setStoreMedia(id:string,logoAssetId:string|null,bannerAssetId:string|null):Promise<void> {
  const {error}=await db().rpc('set_marketplace_store_media',{p_store_id:id,p_logo_asset_id:logoAssetId,p_banner_asset_id:bannerAssetId});
  if(error) throw error;
}

export interface ProductMutation {
  storeId:string;categoryId:string;title:string;description:string;price:string|number;
  brand?:string;compareAtPrice?:string|number|null;assetIds:string[];stock:number;tags:string[];
}
export async function createProduct(input:ProductMutation):Promise<string> {
  const {data,error}=await db().rpc('create_marketplace_product',{
    p_store_id:input.storeId,p_category_id:input.categoryId,p_title:input.title,
    p_description:input.description,p_price:input.price,p_brand:input.brand||null,
    p_compare_at_price:input.compareAtPrice||null,p_asset_ids:input.assetIds,
    p_stock:input.stock,p_tags:input.tags,
  });
  if(error) throw error;
  return extractRpcUuid(data,'create_marketplace_product');
}
export async function createProductDraft(input:ProductMutation):Promise<string> {
  const {data,error}=await db().rpc('create_marketplace_product_draft',{
    p_store_id:input.storeId,p_category_id:input.categoryId,p_title:input.title,
    p_description:input.description,p_price:input.price,p_brand:input.brand||null,
    p_compare_at_price:input.compareAtPrice||null,p_asset_ids:input.assetIds,
    p_stock:input.stock,p_tags:input.tags,
  });
  if(error) throw error;
  return extractRpcUuid(data,'create_marketplace_product_draft');
}
export async function updateProduct(id:string,input:Omit<ProductMutation,'storeId'|'assetIds'>):Promise<void> {
  const {error}=await db().rpc('update_marketplace_product',{
    p_product_id:id,p_category_id:input.categoryId,p_title:input.title,
    p_description:input.description,p_price:input.price,p_brand:input.brand||null,
    p_compare_at_price:input.compareAtPrice||null,p_stock:input.stock,p_tags:input.tags,
  });
  if(error) throw error;
}
export async function setProductPublished(id:string,published:boolean):Promise<void> {
  const {data,error}=await db().rpc(published?'publish_my_marketplace_product_checked':'pause_marketplace_product',{p_product_id:id});
  if(error) {
    throw normalizeMarketplacePublicationError(error);
  }
  if(published&&(!(data as {published?:unknown}|null)?.published))throw new MarketplacePublicationError('not_ready','marketplace_publication_result_invalid');
}
export type MarketplacePublicationReadinessReason='seller_not_approved'|'store_not_active'|'product_not_active'|'product_not_approved'|'product_deleted'|'unsupported_product_type'|'unsupported_currency'|'no_active_variant'|'inventory_not_configured'|'out_of_stock'|'shipping_incomplete'|'not_ready';
export class MarketplacePublicationError extends Error {
  constructor(public reason:MarketplacePublicationReadinessReason,public safeCode=`marketplace_product_not_ready_${reason}`,public postgresCode:string|null=null){super(safeCode);this.name='MarketplacePublicationError';}
}
const publicationTokens=['marketplace_product_not_ready_shipping_incomplete','marketplace_product_not_ready_no_active_variant','marketplace_product_not_ready_inventory_not_configured','marketplace_product_not_ready_out_of_stock','marketplace_product_not_ready_product_not_approved','marketplace_product_media_required','marketplace_shipping_profile_not_owned','marketplace_store_inactive','marketplace_seller_not_approved','marketplace_sku_exists','marketplace_permission_denied'] as const;
export function normalizeMarketplacePublicationError(error:unknown):MarketplacePublicationError{
 const row=error&&typeof error==='object'?error as Record<string,unknown>:{};const text=[row.message,row.details,row.hint,JSON.stringify(row)].filter(value=>typeof value==='string').join(' ');
 const token=publicationTokens.find(value=>text.includes(value))??(String(row.code)==='42501'?'marketplace_permission_denied':'marketplace_publication_failed');
 const reason=(token.match(/^marketplace_product_not_ready_(.+)$/)?.[1]??({marketplace_store_inactive:'store_not_active',marketplace_seller_not_approved:'seller_not_approved'} as Record<string,string>)[token]??'not_ready') as MarketplacePublicationReadinessReason;
 return new MarketplacePublicationError(reason,token,typeof row.code==='string'?row.code:null);
}
export async function evaluateMarketplaceProductPublication(id:string):Promise<{ready:boolean;reasonCode:string|null}>{const{data,error}=await db().rpc('evaluate_my_marketplace_product_publication',{p_product_id:id});if(error)throw normalizeMarketplacePublicationError(error);const row=data as Record<string,unknown>|null;return{ready:row?.ready===true,reasonCode:row?.reason_code==null?null:String(row.reason_code)};}
export const marketplacePublicationMessage=(error:unknown):string|null=>{
  if(!(error instanceof MarketplacePublicationError))return null;
  const exact:Record<string,string>={marketplace_product_media_required:'Agrega al menos una imagen válida.',marketplace_shipping_profile_not_owned:'El perfil de envío no pertenece a esta tienda.',marketplace_permission_denied:'No tienes permiso para publicar este producto.',marketplace_sku_exists:'Ese SKU ya existe en tu tienda.'};
  if(exact[error.safeCode])return exact[error.safeCode];
  return ({seller_not_approved:'Tu cuenta de vendedor todavía no está aprobada.',store_not_active:'Activa tu tienda antes de publicar.',product_not_active:'El producto no está activo.',product_not_approved:'El producto todavía está en revisión.',product_deleted:'Este producto fue eliminado.',unsupported_product_type:'Revisa el tipo de producto.',unsupported_currency:'El producto debe usar BDAG.',no_active_variant:'Configura al menos una variante activa.',inventory_not_configured:'Completa el inventario antes de publicar.',out_of_stock:'Agrega inventario disponible antes de publicar.',shipping_incomplete:'Configura un perfil de envío válido antes de publicar.',not_ready:'Completa la configuración requerida antes de publicar.'} satisfies Record<MarketplacePublicationReadinessReason,string>)[error.reason];
};
export async function softDeleteProduct(id:string):Promise<void> {
  const {error}=await db().rpc('soft_delete_marketplace_product',{p_product_id:id});
  if(error) throw error;
}
export async function replaceProductMedia(id:string,assetIds:string[]):Promise<void> {
  const {error}=await db().rpc('replace_marketplace_product_media',{p_product_id:id,p_asset_ids:assetIds});
  if(error) throw error;
}

export async function toggleProductSave(userId:string,productId:string,saved:boolean):Promise<boolean> {
  const query=saved
    ?db().from('product_saves').insert({user_id:userId,product_id:productId})
    :db().from('product_saves').delete().eq('user_id',userId).eq('product_id',productId);
  const {error}=await query; return !error;
}
export async function fetchSavedProductIds(userId:string):Promise<Set<string>> {
  const {data,error}=await db().from('product_saves').select('product_id').eq('user_id',userId);
  if(error) return new Set();
  return new Set((data??[]).map((row:{product_id:string})=>row.product_id));
}
