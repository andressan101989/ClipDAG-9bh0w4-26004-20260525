export const SELLER_ANALYTICS_RANGES=[7,30,90];
export function analyticsUtcRange(days,now=new Date()){
 if(!SELLER_ANALYTICS_RANGES.includes(days))throw new Error('marketplace_analytics_range_invalid');
 const dateTo=new Date(now);const dateFrom=new Date(now);dateFrom.setUTCDate(dateFrom.getUTCDate()-days);
 return{dateFrom:dateFrom.toISOString(),dateTo:dateTo.toISOString()};
}
export const formatBDAG=value=>`${Number.isFinite(Number(value))?Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'0.00'} BDAG`;
export const formatMetricCount=value=>(Number.isFinite(Number(value))?Math.max(0,Math.trunc(Number(value))):0).toLocaleString('en-US');
export const formatEventRate=value=>`${Number.isFinite(Number(value))?Number(value).toLocaleString('en-US',{maximumFractionDigits:2}):'0'}%`;
export const marketplaceSourceLabel=source=>({shop:'Tienda',search:'Búsqueda',feed:'Feed',clip:'Clips',live:'LIVE',creator:'Creador',affiliate:'Afiliados',direct:'Directo',unknown:'Sin identificar'}[source]??'Sin identificar');
export function normalizeDailyAnalytics(rows,days,dateTo){
 const end=new Date(dateTo);const byDay=new Map(rows.map(row=>[row.event_day,row]));const result=[];
 for(let offset=days;offset>0;offset--){const day=new Date(end);day.setUTCDate(day.getUTCDate()-offset);const key=day.toISOString().slice(0,10);result.push(byDay.get(key)??{event_day:key,views:0,add_to_cart:0,orders:0,purchase_items:0,units_sold:0,gmv_bdag:0});}
 return result;
}
export const sellerOrderNeedsAttention=status=>status==='confirmed'||status==='processing';
export function sellerInventoryAttention(levels){return levels.reduce((result,level)=>{const available=Math.max(0,Number(level.available_quantity));if(available===0)result.outOfStock++;else if(available<=Number(level.low_stock_threshold))result.lowStock++;return result;},{outOfStock:0,lowStock:0});}
