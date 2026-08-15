import { supabase } from "./supabase";

export const ranges = ["7d", "30d", "90d", "all"] as const;
export type AdminRange = (typeof ranges)[number];
export type Money = string | number;
export type AdminAccess = { user_id: string; username: string | null; display_name: string | null; admin: true; capabilities: string[] };
export type Overview = {
  range: AdminRange; generated_at: string;
  commerce: { orders:number; paid_orders:number; paid_gmv:Money; units:number; pending_fulfillment:number; shipped:number; delivered:number; refunded_orders:number; reversed_orders:number; reversed_gross:Money };
  sellers: { approved:number; active_stores:number };
  products: { active_published:number; requiring_attention:number };
  creator_commerce: { attributed_orders:number; attributed_gmv:Money; commission_generated:Money; commission_released:Money; commission_reversed:Money; commission_net:Money };
  operations: { open_disputes:number; held_allocations:number };
};
export type OrderSummary = { id:string;order_number:string;created_at:string;status:string;currency:string;amount:Money;buyer_name:string;seller_name:string;store_id:string;store_name:string;item_count:number;payment_status:string|null;fulfillment_status:string|null;settlement_status:string|null;dispute_open:boolean;reversed:boolean;creator_commerce:boolean;source_surfaces:string[] };
export type OrderCursor = { created_at:string;id:string };
export type OrderPage = { range:AdminRange;orders:OrderSummary[];next_cursor:OrderCursor|null;page_size:number };
export type OrderDetail = Record<string, unknown> & { order:Record<string,unknown>;items:Array<Record<string,unknown>>;creator_attributions:Array<Record<string,unknown>>;creator_allocations:Array<Record<string,unknown>>;settlement_legs:Array<Record<string,unknown>>;reversal_legs:Array<Record<string,unknown>>;timeline:Array<Record<string,unknown>> };
export type OrderSearch = { query?:string;status?:string;range:AdminRange;storeId?:string;sourceSurface?:string;cursor?:OrderCursor;limit?:number };

const object = (value:unknown,name:string):Record<string,unknown> => { if(!value||typeof value!=="object"||Array.isArray(value))throw new Error(`Respuesta inválida: ${name}`);return value as Record<string,unknown>; };
const string = (value:unknown,name:string) => { if(typeof value!=="string")throw new Error(`Respuesta inválida: ${name}`);return value; };
const nullableString = (value:unknown,name:string) => value===null?null:string(value,name);
const number = (value:unknown,name:string) => { if(typeof value!=="number"||!Number.isFinite(value))throw new Error(`Respuesta inválida: ${name}`);return value; };
const bool = (value:unknown,name:string) => { if(typeof value!=="boolean")throw new Error(`Respuesta inválida: ${name}`);return value; };
const array = (value:unknown,name:string) => { if(!Array.isArray(value))throw new Error(`Respuesta inválida: ${name}`);return value; };
const uuid = (value:unknown,name:string) => { const v=string(value,name);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))throw new Error(`Respuesta inválida: ${name}`);return v; };
const date = (value:unknown,name:string) => { const v=string(value,name);if(Number.isNaN(Date.parse(v)))throw new Error(`Respuesta inválida: ${name}`);return v; };
const money = (value:unknown,name:string):Money => { if((typeof value!=="string"&&typeof value!=="number")||!/^\d+(\.\d+)?$/.test(String(value)))throw new Error(`Respuesta inválida: ${name}`);return value; };
const range = (value:unknown):AdminRange => { if(!ranges.includes(value as AdminRange))throw new Error("Respuesta inválida: range");return value as AdminRange; };

async function rpc(name:string,args:Record<string,unknown>={}) { const {data,error}=await supabase.rpc(name,args);if(error)throw new Error(error.message||"No se pudo consultar Marketplace");return data as unknown; }

export async function getAdminAccess():Promise<AdminAccess>{ const v=object(await rpc("get_my_marketplace_admin_access"),"access");if(v.admin!==true)throw new Error("Acceso administrativo denegado");return {user_id:uuid(v.user_id,"user_id"),username:nullableString(v.username,"username"),display_name:nullableString(v.display_name,"display_name"),admin:true,capabilities:array(v.capabilities,"capabilities").map((x)=>string(x,"capability"))}; }

export async function getOverview(selected:AdminRange):Promise<Overview>{
  const v=object(await rpc("get_marketplace_admin_overview",{p_range:selected}),"overview");const c=object(v.commerce,"commerce"),s=object(v.sellers,"sellers"),p=object(v.products,"products"),cc=object(v.creator_commerce,"creator_commerce"),op=object(v.operations,"operations");
  return {range:range(v.range),generated_at:date(v.generated_at,"generated_at"),commerce:{orders:number(c.orders,"orders"),paid_orders:number(c.paid_orders,"paid_orders"),paid_gmv:money(c.paid_gmv,"paid_gmv"),units:number(c.units,"units"),pending_fulfillment:number(c.pending_fulfillment,"pending_fulfillment"),shipped:number(c.shipped,"shipped"),delivered:number(c.delivered,"delivered"),refunded_orders:number(c.refunded_orders,"refunded_orders"),reversed_orders:number(c.reversed_orders,"reversed_orders"),reversed_gross:money(c.reversed_gross,"reversed_gross")},sellers:{approved:number(s.approved,"approved"),active_stores:number(s.active_stores,"active_stores")},products:{active_published:number(p.active_published,"active_published"),requiring_attention:number(p.requiring_attention,"requiring_attention")},creator_commerce:{attributed_orders:number(cc.attributed_orders,"attributed_orders"),attributed_gmv:money(cc.attributed_gmv,"attributed_gmv"),commission_generated:money(cc.commission_generated,"commission_generated"),commission_released:money(cc.commission_released,"commission_released"),commission_reversed:money(cc.commission_reversed,"commission_reversed"),commission_net:money(cc.commission_net,"commission_net")},operations:{open_disputes:number(op.open_disputes,"open_disputes"),held_allocations:number(op.held_allocations,"held_allocations")}};
}

export async function searchOrders(input:OrderSearch):Promise<OrderPage>{
  const v=object(await rpc("search_marketplace_admin_orders",{p_query:input.query||null,p_status:input.status||null,p_range:input.range,p_store_id:input.storeId||null,p_source_surface:input.sourceSurface||null,p_cursor_created_at:input.cursor?.created_at||null,p_cursor_id:input.cursor?.id||null,p_limit:input.limit??50}),"order_page");
  const orders=array(v.orders,"orders").map((entry):OrderSummary=>{const x=object(entry,"order");return{id:uuid(x.id,"id"),order_number:string(x.order_number,"order_number"),created_at:date(x.created_at,"created_at"),status:string(x.status,"status"),currency:string(x.currency,"currency"),amount:money(x.amount,"amount"),buyer_name:string(x.buyer_name,"buyer_name"),seller_name:string(x.seller_name,"seller_name"),store_id:uuid(x.store_id,"store_id"),store_name:string(x.store_name,"store_name"),item_count:number(x.item_count,"item_count"),payment_status:nullableString(x.payment_status,"payment_status"),fulfillment_status:nullableString(x.fulfillment_status,"fulfillment_status"),settlement_status:nullableString(x.settlement_status,"settlement_status"),dispute_open:bool(x.dispute_open,"dispute_open"),reversed:bool(x.reversed,"reversed"),creator_commerce:bool(x.creator_commerce,"creator_commerce"),source_surfaces:array(x.source_surfaces,"source_surfaces").map((y)=>string(y,"source_surface"))};});
  const next=v.next_cursor===null?null:(()=>{const x=object(v.next_cursor,"cursor");return{created_at:date(x.created_at,"cursor.created_at"),id:uuid(x.id,"cursor.id")};})();
  return {range:range(v.range),orders,next_cursor:next,page_size:number(v.page_size,"page_size")};
}

export async function getOrderDetail(orderId:string):Promise<OrderDetail>{
  uuid(orderId,"orderId");const v=object(await rpc("get_marketplace_admin_order_detail",{p_order_id:orderId}),"detail");
  const order=object(v.order,"order");uuid(order.id,"order.id");
  return {...v,order,items:array(v.items,"items").map((x)=>object(x,"item")),creator_attributions:array(v.creator_attributions,"creator_attributions").map((x)=>object(x,"attribution")),creator_allocations:array(v.creator_allocations,"creator_allocations").map((x)=>object(x,"allocation")),settlement_legs:array(v.settlement_legs,"settlement_legs").map((x)=>object(x,"settlement_leg")),reversal_legs:array(v.reversal_legs,"reversal_legs").map((x)=>object(x,"reversal_leg")),timeline:array(v.timeline,"timeline").map((x)=>object(x,"timeline"))};
}

export const formatBdag=(value:Money)=>`${String(value)} BDAG`;
export const formatDate=(value:unknown)=>typeof value==="string"?new Intl.DateTimeFormat("es",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value)):"—";
