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
  seller?:{username:string;avatar_url:string|null;display_name:string|null};
}

const PRODUCT_COLUMNS = [
  'id','seller_id','store_id','category_id','title','description','price','currency',
  'category','images','stock','status','tags','total_sales','brand','compare_at_price',
  'product_type','moderation_status','published_at','deleted_at','created_at','updated_at',
].join(',');
const PRODUCT_WITH_SELLER = `${PRODUCT_COLUMNS},seller:user_profiles!products_seller_id_fkey(username,avatar_url,display_name)`;
const db=()=>getSupabaseClient();

function mapProduct(row:Record<string,unknown>):Product {
  return {
    ...(row as unknown as Product),
    price:Number(row.price), compare_at_price:row.compare_at_price==null?null:Number(row.compare_at_price),
    stock:Number(row.stock), total_sales:Number(row.total_sales),
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
  let query=db().from('products').select(PRODUCT_WITH_SELLER)
    .eq('status','active').eq('currency','BDAG').order('created_at',{ascending:false})
    .limit(opts?.limit??30);
  if(opts?.category) query=query.eq('category',opts.category);
  if(opts?.sellerId) query=query.eq('seller_id',opts.sellerId);
  if(opts?.search) query=query.ilike('title',`%${opts.search}%`);
  const {data,error}=await query;
  if(error) throw error;
  return (data??[]).map(row=>mapProduct(row as unknown as Record<string,unknown>));
}

export async function fetchProduct(productId:string):Promise<Product|null> {
  const {data,error}=await db().from('products').select(PRODUCT_WITH_SELLER)
    .eq('id',productId).eq('currency','BDAG').maybeSingle();
  if(error) throw error;
  return data?mapProduct(data as unknown as Record<string,unknown>):null;
}

export async function fetchMyProducts():Promise<Product[]> {
  const {data,error}=await db().from('products').select(PRODUCT_WITH_SELLER)
    .neq('status','deleted').order('updated_at',{ascending:false});
  if(error) throw error;
  return (data??[]).map(row=>mapProduct(row as unknown as Record<string,unknown>));
}

export async function fetchSellerFoundation():Promise<{seller:MarketplaceSeller|null;store:MarketplaceStore|null}> {
  const [{data:seller,error:sellerError},{data:store,error:storeError}]=await Promise.all([
    db().from('marketplace_sellers').select('user_id,status,display_name,application_note,created_at,updated_at').maybeSingle(),
    db().from('marketplace_stores').select('id,seller_id,name,slug,description,logo_asset_id,banner_asset_id,status,created_at,updated_at').maybeSingle(),
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
export async function updateProduct(id:string,input:Omit<ProductMutation,'storeId'|'assetIds'>):Promise<void> {
  const {error}=await db().rpc('update_marketplace_product',{
    p_product_id:id,p_category_id:input.categoryId,p_title:input.title,
    p_description:input.description,p_price:input.price,p_brand:input.brand||null,
    p_compare_at_price:input.compareAtPrice||null,p_stock:input.stock,p_tags:input.tags,
  });
  if(error) throw error;
}
export async function setProductPublished(id:string,published:boolean):Promise<void> {
  const {error}=await db().rpc(published?'publish_marketplace_product':'pause_marketplace_product',{p_product_id:id});
  if(error) throw error;
}
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
