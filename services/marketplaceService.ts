import { getSupabaseClient } from '@/template';
import { extractRpcUuid } from '@/services/mediaService';
import {rpcArray,rpcBoolean,rpcCursorPage,rpcEnum,rpcNonnegative,rpcNonnegativeInteger,rpcNullableNonnegative,
  rpcNullableString,rpcNullableTimestamp,rpcNullableUuid,rpcObject,rpcString,rpcStringArray,
  rpcTimestamp,rpcUuid} from '@/services/marketplaceRuntimeValidation';

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

function mapProduct(row:Record<string,unknown>,sellerProjection=false):Product {
  const seller=row.seller==null?undefined:rpcObject(row.seller,'product.seller');
  const stock=rpcNonnegativeInteger(row.stock,'product.stock');
  return {
    id:rpcUuid(row.id,'product.id'),seller_id:rpcUuid(row.seller_id,'product.seller_id'),
    store_id:rpcUuid(row.store_id,'product.store_id'),category_id:rpcUuid(row.category_id,'product.category_id'),
    title:rpcString(row.title,'product.title'),description:rpcString(row.description,'product.description'),
    price:rpcNonnegative(row.price,'product.price'),currency:rpcEnum(row.currency,['BDAG']as const,'product.currency'),
    category:rpcEnum(row.category,['digital','physical','art','music','clothing','other']as const,'product.category'),
    images:rpcStringArray(row.images,'product.images'),stock,
    status:rpcEnum(row.status,['active','paused','sold_out','deleted']as const,'product.status'),
    tags:rpcStringArray(row.tags,'product.tags'),total_sales:rpcNonnegativeInteger(row.total_sales,'product.total_sales'),
    brand:rpcNullableString(row.brand,'product.brand'),compare_at_price:rpcNullableNonnegative(row.compare_at_price,'product.compare_at_price'),
    product_type:rpcEnum(row.product_type,['physical']as const,'product.product_type'),
    moderation_status:rpcEnum(row.moderation_status,['pending','approved','rejected','suspended']as const,'product.moderation_status'),
    published_at:rpcNullableTimestamp(row.published_at,'product.published_at'),deleted_at:rpcNullableTimestamp(row.deleted_at,'product.deleted_at'),
    created_at:rpcTimestamp(row.created_at,'product.created_at'),updated_at:rpcTimestamp(row.updated_at,'product.updated_at'),
    variant_price_max:rpcNullableNonnegative(row.variant_price_max,'product.variant_price_max'),
    active_variant_count:rpcNonnegativeInteger(row.active_variant_count,'product.active_variant_count'),
    shipping_profile_id:sellerProjection?rpcNullableUuid(row.shipping_profile_id,'product.shipping_profile_id'):null,
    available_quantity:sellerProjection?rpcNonnegativeInteger(row.available_quantity,'product.available_quantity'):stock,
    publication_readiness_reason:sellerProjection?rpcNullableString(row.publication_readiness_reason,'product.publication_readiness_reason'):null,
    seller:seller?{username:rpcString(seller.username,'product.seller.username'),avatar_url:rpcNullableString(seller.avatar_url,'product.seller.avatar_url'),display_name:rpcNullableString(seller.display_name,'product.seller.display_name')}:undefined,
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
    id:rpcUuid(row.id,'variant.id'),product_id:rpcUuid(row.product_id,'variant.product_id'),
    sku:rpcNullableString(row.sku,'variant.sku'),title:rpcNullableString(row.title,'variant.title'),
    price:rpcNonnegative(row.price,'variant.price'),compare_at_price:rpcNullableNonnegative(row.compare_at_price,'variant.compare_at_price'),
    base_price:rpcNonnegative(row.base_price,'variant.base_price'),promotion_id:rpcNullableUuid(row.promotion_id,'variant.promotion_id'),
    promotion_type:row.promotion_type===null?null:rpcEnum(row.promotion_type,['percentage','fixed_amount','promotional_price']as const,'variant.promotion_type'),
    discount_percentage:rpcNullableNonnegative(row.discount_percentage,'variant.discount_percentage'),
    promotion_ends_at:rpcNullableTimestamp(row.promotion_ends_at,'variant.promotion_ends_at'),
    status:rpcEnum(row.status,['active','inactive','archived']as const,'variant.status'),is_default:rpcBoolean(row.is_default,'variant.is_default'),
    image_asset_id:rpcNullableUuid(row.image_asset_id,'variant.image_asset_id'),image_url:rpcNullableString(row.image_url,'variant.image_url'),
    available_quantity:rpcNonnegativeInteger(row.available_quantity,'variant.available_quantity'),
    option_value_ids:rpcArray(row.option_value_ids,'variant.option_value_ids').map((value,index)=>rpcUuid(value,`variant.option_value_ids[${index}]`)),
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
  const payload=rpcObject(detailResult.data,'product_detail');
  const options=rpcArray(payload.options,'product_detail.options').map((raw,index)=>{const option=rpcObject(raw,`product_detail.options[${index}]`);return{id:rpcUuid(option.id,'option.id'),name:rpcString(option.name,'option.name'),position:rpcNonnegativeInteger(option.position,'option.position'),values:rpcArray(option.values,'option.values').map((rawValue,valueIndex)=>{const value=rpcObject(rawValue,`option.values[${valueIndex}]`);return{id:rpcUuid(value.id,'option_value.id'),value:rpcString(value.value,'option_value.value'),position:rpcNonnegativeInteger(value.position,'option_value.position')}})}});
  const media=rpcArray(mediaResult.data,'product_media').map((raw,index)=>{const row=rpcObject(raw,`product_media[${index}]`);return{
    kind:rpcEnum(row.kind,['image','video']as const,'media.kind'),url:rpcString(row.url,'media.url'),
    durationMs:row.duration_ms===null?null:rpcNonnegativeInteger(row.duration_ms,'media.duration_ms'),mimeType:rpcNullableString(row.mime_type,'media.mime_type'),
    position:rpcNonnegativeInteger(row.position,'media.position'),isCover:rpcBoolean(row.is_cover,'media.is_cover'),
  }});
  return {
    product:productResult,
    options,
    variants:rpcArray(payload.variants,'product_detail.variants').map((raw,index)=>mapVariant(rpcObject(raw,`product_detail.variants[${index}]`))),
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

export interface MarketplaceSellerProductPage {items:Product[];nextCursor:{updatedAt:string;productId:string}|null}
export async function fetchMyProductsPage(cursor:{updatedAt:string;productId:string}|null=null,limit=100):Promise<MarketplaceSellerProductPage> {
  const client=db();
  if(__DEV__)console.log('[SellerProducts] fetch_start',{operation:'fetch_my_marketplace_products_v2'});
  const {data:{session},error:authError}=await client.auth.getSession();
  if(authError||!session?.user?.id)throw new MarketplaceSellerProductsError('marketplace_authentication_required');
  const {data,error}=await client.rpc('fetch_my_marketplace_products_v2',{p_cursor_updated_at:cursor?.updatedAt??null,p_cursor_product_id:cursor?.productId??null,p_limit:limit});
  if(error){
    const text=`${error.message??''} ${error.details??''}`;
    const code:MarketplaceSellerProductsErrorCode=/marketplace_authentication_required/i.test(text)?'marketplace_authentication_required':error.code==='42501'?'marketplace_seller_products_permission':!error.code&&/network|fetch|timeout/i.test(text)?'marketplace_seller_products_transport':'marketplace_seller_products_request';
    if(__DEV__)console.warn('[SellerProducts] fetch_failed',{code,postgresCode:error.code??null,operation:'fetch_my_marketplace_products_v2'});
    throw new MarketplaceSellerProductsError(code,error.code??null);
  }
  const page=rpcCursorPage(data,'seller_products');
  const products=page.items.map((row,index)=>mapProduct(rpcObject(row,`seller_products.items[${index}]`),true));
  const rawCursor=page.nextCursor,nextCursor=rawCursor?{updatedAt:rpcTimestamp(rawCursor.updated_at,'seller_products.next_cursor.updated_at'),productId:rpcUuid(rawCursor.product_id,'seller_products.next_cursor.product_id')}:null;
  if(__DEV__)console.log('[SellerProducts] fetch_success',{count:products.length,activeCount:products.filter(item=>item.status==='active').length,pausedCount:products.filter(item=>item.status==='paused').length});
  return{items:products,nextCursor};
}
export async function fetchMyProducts():Promise<Product[]> {return(await fetchMyProductsPage(null,100)).items;}

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
