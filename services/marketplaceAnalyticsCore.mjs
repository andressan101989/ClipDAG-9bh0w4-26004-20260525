export const MARKETPLACE_ANALYTICS_SOURCES=new Set(['direct','shop','search','feed','clip','live','creator','affiliate','unknown']);

export function parseMarketplaceAnalyticsSource(input={}){
 const type=typeof input.type==='string'&&MARKETPLACE_ANALYTICS_SOURCES.has(input.type)?input.type:'unknown';
 const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)?value:null;
 return{type,entityId:uuid(input.entityId),creatorId:uuid(input.creatorId),liveSessionId:uuid(input.liveSessionId)};
}

export function marketplaceAnalyticsAppliedQuantity(result,requested){
 if(!result||result.ok!==true)return null;
 return result.status==='quantity_adjusted'&&Number.isInteger(result.applied)&&result.applied>0?result.applied:requested;
}

export function marketplaceCheckoutAnalyticsTargets(items){
 const bySeller=new Map();
 for(const item of items??[])if(item?.availability==='available'&&item.productId&&item.sellerId&&!bySeller.has(item.sellerId))bySeller.set(item.sellerId,item.productId);
 return [...bySeller].map(([sellerId,productId])=>({sellerId,productId}));
}
